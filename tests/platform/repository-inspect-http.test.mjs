import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectionFixture,HEAD} from './repository-inspect-fixture.mjs';
import {openRepositoryInspector,validateRepositoryInspectionTarget} from '../../dist/platform/repository-inspect.js';
import {repositoryApiBase} from '../../dist/platform/repository-inspect-transport.js';
test('native Gitea/GitLab observations preserve distinct fields, nested namespace, capped pagination and private body exclusion',async t=>{
 for(const provider of ['gitea','gitlab']){
  const f=await inspectionFixture(provider);try{
   const view=await f.inspect();assert.equal(view.status,'OBSERVED');assert.equal(view.repository.id,9);assert.equal(view.repository.fullName,f.namespace+'/repo');assert.equal(view.observations.branch.value.head,HEAD);assert.equal(view.observations.protectionInventory.value.length,2);if(provider==='gitlab')assert.ok(f.requests.some(r=>r.path.includes('page=3')),'Probe beyond capped GitLab pages reaches explicit empty page');else{const inventory=f.requests.filter(r=>r.path.includes('/branch_protections'));assert.equal(inventory.length,1);assert.equal(inventory[0].path,'/forge/api/v1/repos/owner/repo/branch_protections');}assert.ok(f.requests.every(r=>r.method==='GET'));assert.equal(JSON.stringify(view).includes('server-secret'),false);assert.equal(JSON.stringify(view).includes('fixture-only-token'),false);
   if(provider==='gitea'){assert.ok(f.requests.every(r=>r.authorization==='token fixture-only-token'&&!r.privateToken));assert.equal(view.observations.effectiveRule.value.rule_name.value,'feature/*');assert.equal(view.observations.effectiveRule.value.block_admin_merge_override.value,false);assert.equal(view.observations.effectiveRule.value.require_signed_commits.state,'UNAVAILABLE');}
   else{assert.ok(f.requests.every(r=>r.privateToken==='fixture-only-token'&&!r.authorization));assert.ok(f.requests.some(r=>r.path.includes('group%2Fsubgroup%2Frepo')));assert.ok(f.requests.some(r=>r.path.includes('/projects/9/')));const protectedRule=view.observations.protectionInventory.value[0];assert.equal(protectedRule.inherited.value,true);assert.deepEqual(protectedRule.merge_access_levels.value[0].user_id,{state:'OBSERVED',value:null});assert.equal(view.observations.approvalRules.value[0].approvals_required.value,3);assert.equal(view.observations.approvalRules.value[0].contains_hidden_groups.value,true);assert.equal(view.observations.approvalSettings.value.merge_requests_author_approval.value,false);}
   assert.match(view.scope,/No merge permission/);assert.ok(view.limitations.some(l=>l.includes('non-atomic')));
  }finally{await f.close();}
 }
});
test('later-page failure, repeated identities and ignored page arguments never return a successful inventory prefix',async()=>{
 for(const provider of ['gitea','gitlab'])for(const options of provider==='gitea'?[{duplicate:true}]:[{pageError:true},{duplicate:true},{ignoredPage:true}]){
  const f=await inspectionFixture(provider,options);try{const view=await f.inspect();assert.equal(view.status,'PARTIAL');assert.equal(view.observations.protectionInventory.state,'UNAVAILABLE');assert.equal(Object.hasOwn(view.observations.protectionInventory,'value'),false);assert.ok(f.requests.length<20);}finally{await f.close();}
 }
});
test('unavailable approval/protection/branch endpoints and omitted or wrongly typed fields are explicit, never empty or false',async()=>{
 for(const provider of ['gitea','gitlab'])for(const status of [401,403,404]){
  const f=await inspectionFixture(provider,{intercept:({relative,send})=>{if(relative.endsWith('/branch_protections')||relative.endsWith('/approval_rules')){send({secret:'server-secret'},status);return true;}}});
  try{const view=await f.inspect(),field=provider==='gitea'?view.observations.protectionInventory:view.observations.approvalRules;assert.equal(view.status,'PARTIAL');assert.equal(field.state,'UNAVAILABLE');assert.match(field.reason,new RegExp(String(status)));assert.equal(JSON.stringify(view).includes('server-secret'),false);}finally{await f.close();}
 }
 const f=await inspectionFixture('gitea',{branchPatch:{required_approvals:'0',effective_branch_protection_name:undefined,protected:undefined}});try{const v=await f.inspect();assert.equal(v.observations.branch.value.fields.required_approvals.state,'UNAVAILABLE');assert.equal(v.observations.branch.value.fields.protected.state,'UNAVAILABLE');assert.equal(v.observations.effectiveRule.state,'UNAVAILABLE');}finally{await f.close();}
});
test('repository/actor/branch identity drift refuses the observation, while branch paths remain exactly encoded',async()=>{
 for(const provider of ['gitea','gitlab'])for(const options of [{wrongRepository:true},{drift:true},{branchDrift:true}]){
  const f=await inspectionFixture(provider,options);try{await assert.rejects(f.inspect(),/differs|changed/);assert.ok(f.requests.length<20);}finally{await f.close();}
 }
});
test('foreign or scope-changing continuation is refused before any credential forwarding',async()=>{
 let leaked=0;const {createServer}=await import('node:http');const foreign=createServer((_req,res)=>{leaked++;res.end('[]');});await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
 try{for(const variant of ['foreign','path','scope','skip','duplicate','conflict']){
  const f=await inspectionFixture('gitlab',{intercept:({url,relative,send})=>{if(!relative.endsWith('/protected_branches'))return;const next=new URL(url.href);next.protocol='http:';next.host='127.0.0.1:'+foreign.address().port;next.searchParams.set('page','2');if(variant!=='foreign')next.host=url.host;if(variant==='path')next.pathname+='/other';if(variant==='scope')next.searchParams.set('search','hidden');if(variant==='skip')next.searchParams.set('page','3');if(variant==='duplicate')next.searchParams.append('page','2');send([{id:21,name:'main'}],200,{link:'<'+next.href+'>; rel="next"',...(variant==='conflict'?{'x-next-page':''}:{})});return true;}});
  try{const v=await f.inspect();assert.equal(v.status,'PARTIAL');assert.equal(v.observations.protectionInventory.state,'UNAVAILABLE');assert.equal(f.requests.filter(r=>r.path.includes('/protected_branches')).length,1);}finally{await f.close();}
 }}finally{await new Promise(r=>foreign.close(r));}assert.equal(leaked,0);
});
test('global request/byte/item bounds, response limits and cancellation produce no falsely complete observation',async()=>{
 for(const limits of [{pages:1},{collectionBytes:1},{collectionItems:1},{responseBytes:1}]){const f=await inspectionFixture('gitea');try{await assert.rejects(f.inspect(limits),/limit|unavailable/);if(limits.pages)assert.ok(f.requests.length<=limits.pages);}finally{await f.close();}}
 const f=await inspectionFixture('gitlab');try{const abort=new AbortController();abort.abort();await assert.rejects(f.inspect({},abort.signal));assert.equal(f.requests.length,0);}finally{await f.close();}
});
test('production bases and credentials reject cleartext, aliases/escapes, unknown providers and control-bearing input before requests',()=>{
 for(const base of ['http://127.0.0.1/api/v1','https://u:p@forge.example/api/v1','https://forge.example/api/v1?token=x','https://forge.example/p/../api/v1','https://forge.example/%61pi/v1','https://forge.example/api/v4','https://forge.example/api/v1#'])assert.throws(()=>openRepositoryInspector({provider:'gitea',apiBase:base,token:'fixture'}));
 for(const token of ['', 'line\nvalue','space value'])assert.throws(()=>openRepositoryInspector({provider:'gitea',apiBase:'https://forge.example/api/v1',token}));
 assert.equal(repositoryApiBase('gitlab','https://forge.example/team.v2/api/v4/').pathname,'/team.v2/api/v4');assert.throws(()=>validateRepositoryInspectionTarget('gitea','owner/sub','repo'));assert.throws(()=>validateRepositoryInspectionTarget('gitlab','group/..','repo'));assert.throws(()=>validateRepositoryInspectionTarget('gitlab','group','repo','line\nbranch'));
});
test('early empty page or explicit end cannot hide declared later pages',async()=>{
 for(const headers of [{'x-total-pages':'2'},{'x-total-pages':'2','x-next-page':''},{'x-next-page':'2'}]){
  const f=await inspectionFixture('gitlab',{intercept:({relative,send})=>{if(relative.endsWith('/protected_branches')){send([],200,headers);return true;}}});
  try{const result=await f.inspect();assert.equal(result.status,'PARTIAL');assert.equal(result.observations.protectionInventory.state,'UNAVAILABLE');assert.equal(f.requests.filter(r=>r.path.includes('/protected_branches')).length,1);}finally{await f.close();}
 }
 const f=await inspectionFixture('gitea',{intercept:({url,relative,send})=>{if(!relative.endsWith('/branch_protections'))return;const later=new URL(url.href);later.searchParams.set('page','2');send([],200,{link:'<'+later.href+'>; rel="last"'});return true;}});
 try{const result=await f.inspect();assert.equal(result.observations.protectionInventory.state,'UNAVAILABLE');}finally{await f.close();}
});
test('operation-global bytes and items stop dispatch immediately at inventory overflow, including failed JSON bodies',async()=>{
 const baseline=await inspectionFixture('gitlab');let byteLimit;try{const view=await baseline.inspect();byteLimit=view.receipts.slice(0,3).reduce((n,r)=>n+r.bodyBytes,0)+1;}finally{await baseline.close();}
 for(const [limits,lastPage] of [[{collectionItems:1},2],[{collectionBytes:byteLimit},1]]){
  const f=await inspectionFixture('gitlab');try{await assert.rejects(f.inspect(limits),/Operation-global.*limit/);assert.equal(f.requests.length,lastPage+3);assert.match(f.requests.at(-1).path,new RegExp('/protected_branches.*page='+lastPage+'$'));assert.equal(f.requests.some(r=>r.path.includes('/approval')),false);}finally{await f.close();}
 }
 const f=await inspectionFixture('gitlab',{intercept:({relative,send})=>{if(relative.endsWith('/protected_branches')){send('not-json '.repeat(1000));return true;}}});try{await assert.rejects(f.inspect({collectionBytes:byteLimit}),/Operation-global.*byte/);assert.equal(f.requests.length,4);}finally{await f.close();}
});

test('inconsistent Gitea native branch/rule requirements stay unavailable without local rule arbitration',async()=>{
 const f=await inspectionFixture('gitea',{branchPatch:{required_approvals:9}});try{const view=await f.inspect();assert.equal(view.status,'PARTIAL');assert.equal(view.observations.effectiveRule.state,'UNAVAILABLE');assert.match(view.observations.effectiveRule.reason,/disagree/);}finally{await f.close();}
});
test('live request cancellation joins the read path without subsequent endpoint dispatch',async()=>{
 let entered;const arrived=new Promise(resolve=>{entered=resolve;});const f=await inspectionFixture('gitea',{intercept:({relative})=>{if(relative==='/user'){entered();return true;}}}),abort=new AbortController();
 try{const task=f.inspect({},abort.signal),outcome=assert.rejects(task,/cancelled|aborted/i);await arrived;abort.abort();await outcome;assert.equal(f.requests.length,1);}finally{await f.close();}
});
test('Gitea complete inventory uses exactly one unpaginated GET and refuses undeclared continuation or incomplete metadata',async()=>{
 for(const [rows,headers] of [[[{rule_name:'main'}],{'x-next-page':'2'}],[[{rule_name:'main'}],{'x-page':'2'}],[[{rule_name:'main'}],{'x-total-pages':'2'}],[[{rule_name:'main'}],{'x-total-count':'2'}],[[{rule_name:'main'}],{'x-total-count':'invalid'}],[[{rule_name:'main'},{rule_name:'main'}],{}],[[{}],{}],[{},{}]]){
  const f=await inspectionFixture('gitea',{intercept:({relative,send})=>{if(relative.endsWith('/branch_protections')){send(rows,200,headers);return true;}}});
  try{const view=await f.inspect();assert.equal(view.observations.protectionInventory.state,'UNAVAILABLE');assert.equal(view.status,'PARTIAL');assert.equal(f.requests.filter(r=>r.path.includes('/branch_protections')).length,1);assert.equal(f.requests.some(r=>r.path.includes('page=')),false);}finally{await f.close();}
 }
 for(const rows of [[],[{branch_name:'main',required_approvals:0}]]){
  const f=await inspectionFixture('gitea',{branchPatch:{protected:false,effective_branch_protection_name:''},intercept:({relative,send})=>{if(relative.endsWith('/branch_protections')){send(rows,200,{'x-total-count':String(rows.length)});return true;}}});
  try{const view=await f.inspect();assert.equal(view.observations.protectionInventory.state,'OBSERVED');assert.equal(view.observations.protectionInventory.value.length,rows.length);assert.equal(f.requests.filter(r=>r.path.includes('/branch_protections')).length,1);}finally{await f.close();}
 }
});
test('Gitea inventory never follows a server-supplied collection link or forwards the credential',async()=>{
 const {createServer}=await import('node:http');let leaked=0;const foreign=createServer((_req,res)=>{leaked++;res.end('[]');});await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
 const f=await inspectionFixture('gitea',{intercept:({relative,send})=>{if(relative.endsWith('/branch_protections')){send([{rule_name:'main'}],200,{link:'<http://127.0.0.1:'+foreign.address().port+'/other>; rel="next"'});return true;}}});
 try{const view=await f.inspect();assert.equal(view.observations.protectionInventory.state,'UNAVAILABLE');assert.equal(f.requests.filter(r=>r.path.includes('/branch_protections')).length,1);assert.equal(leaked,0);}finally{await f.close();await new Promise(r=>foreign.close(r));}
});
