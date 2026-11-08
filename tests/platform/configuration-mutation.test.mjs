import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {policyHash} from '../../dist/platform/github-policy-schema.js';
import {createOwnedConfigurationFixture,openGitHubConfigurationReader} from '../../dist/platform/github-configuration.js';
const target={host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',actorUserId:7,visibility:'public'};
const profile=()=>({version:'p1',ruleset:{name:'team',enforcement:'active',include:['refs/heads/main'],exclude:[],nonFastForward:true,deletion:true,bypassUsers:[]},mergeMethods:{merge:false,rebase:true}});
const repository=()=>({id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},private:false,visibility:'public',permissions:{admin:true},archived:false,disabled:false,has_issues:true,fork:false,allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:false,description:'preserve'});
const rule=(id=41)=>({id,node_id:'RS'+id,name:'external',source_type:'Repository',source:'owner/repo',target:'branch',enforcement:'active',conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},rules:[{type:'non_fast_forward'},{type:'deletion'}],bypass_actors:[],current_user_can_bypass:'never'});
const planInput=(operationId='owner-config',desired=profile(),rest={})=>({operationId,target,desired,...rest});
const prProfile=()=>({version:'native-pr-v1',ruleset:{...profile().ruleset,pullRequest:{approvingCount:1,dismissStale:false,lastPushApproval:false,codeOwner:false,threadResolution:false}}});
const prParameters=()=>({required_approving_review_count:1,dismiss_stale_reviews_on_push:false,require_last_push_approval:false,require_code_owner_review:false,required_review_thread_resolution:false});
const nativeTuple=()=>({required_reviewers:[],allowed_merge_methods:['merge','squash','rebase'],require_extra_approval_for_unattributed_changes:true});
function nativePrFault(row,fault){
 if(!fault)return;const pr=row.rules.find(r=>r.type==='pull_request'),p=pr.parameters;
 if(fault==='count')p.required_approving_review_count=2;
 else if(['dismiss_stale_reviews_on_push','require_last_push_approval','require_code_owner_review','required_review_thread_resolution'].includes(fault))p[fault]=true;
 else if(fault==='false')p.require_extra_approval_for_unattributed_changes=false;
 else if(fault==='string')p.require_extra_approval_for_unattributed_changes='true';
 else if(fault==='null')p.require_extra_approval_for_unattributed_changes=null;
 else if(fault==='unknown')p.future_review_obligation=true;
 else if(fault==='reviewer')p.required_reviewers=[{reviewer:{id:1,type:'Team'},minimum_approvals:1,file_patterns:['**']}];
 else if(fault==='subset')p.allowed_merge_methods=['squash'];
 else if(fault==='duplicate-method')p.allowed_merge_methods=['merge','merge'];
 else if(fault==='duplicate-rule')row.rules.push(structuredClone(pr));
 else if(fault==='missing-rule')row.rules=row.rules.filter(r=>r.type!=='pull_request');
 else if(fault==='extra-rule')row.rules.push({type:'future_review_rule'});
 else throw Error('unknown test fault');
}

async function fixture(options={}){
 const state={repo:repository(),rules:[rule(99)],detailFailures:0,listDenied:false,writes:[],reads:[],nextId:101,drop:!!options.drop,partial:!!options.partial};const sockets=new Set();
 const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const b of req)chunks.push(b);const bytes=Buffer.concat(chunks);const url=new URL(req.url,'https://api.github.com'),path=url.pathname;const strong=req.headers.authorization==='Bearer fixture-original';res.setHeader('content-type','application/json');res.setHeader('x-oauth-scopes',strong&&!options.weak?'repo':'');const send=(value,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
 if(req.method!=='GET'&&path!=='/graphql'){state.writes.push({method:req.method,path,bytes,auth:req.headers.authorization});if(options.denyWrites){send({message:'not enough permissions'},403);return;}let p=JSON.parse(bytes),row;
 if(req.method==='POST'&&path==='/repos/owner/repo/rulesets'){row={...p,id:state.nextId,node_id:'RS'+state.nextId++,source_type:'Repository',source:'owner/repo',current_user_can_bypass:'never'};nativePrFault(row,options.prFault);state.rules.push(row);if(options.failDetail)state.detailFailures=1;if(options.replaceRepo)state.repo.id=10;if(state.drop){req.socket.destroy();return;}send(row,201);return;}
 if(req.method==='PUT'){const id=Number(path.split('/').at(-1));row=state.rules.find(r=>r.id===id);if(!row){send({},404);return;}Object.assign(row,p);if(state.drop){req.socket.destroy();return;}send(options.wrongResponse?{...row,node_id:'WRONG'}:row);return;}
 if(req.method==='PATCH'){for(const[k,v]of Object.entries(p))if(!state.partial||k!=='allow_rebase_merge')state.repo[k]=v;if(state.drop){req.socket.destroy();return;}send(state.repo);return;}
 send({},404);return;}
 state.reads.push(path+url.search);
 if(options.guidance){const oid='b'.repeat(40),ref={__typename:'Ref',id:'REF-main',name:'main',prefix:'refs/heads/',target:{__typename:'Commit',oid}};
 if(path==='/repos/owner/repo/git/ref/heads/main'){send({ref:'refs/heads/main',node_id:'REF-main',url:'https://api.github.com/repos/owner/repo/git/refs/heads/main',object:{type:'commit',sha:oid}});return;}
 if(path==='/repos/owner/repo/rules/branches/main'){send(state.rules.filter(r=>r.target==='branch'&&r.enforcement==='active').flatMap(r=>r.rules.map(rule=>({...rule,ruleset_id:r.id,ruleset_source_type:r.source_type,ruleset_source:r.source}))));return;}
 if(path==='/repos/owner/repo/branches/main/protection'){send({},404);return;}
 if(path==='/graphql'){const query=JSON.parse(bytes).query;assert.ok(query.startsWith('query GitjigClassicInventory'));send({data:{repository:{__typename:'Repository',id:'R9',nameWithOwner:'owner/repo',ref,branchProtectionRules:{nodes:[],totalCount:0,pageInfo:{hasNextPage:false,endCursor:null}}}}});return;}
 }
 if(path==='/user'){send({id:7,type:'User',login:'owner'});return;}
 if(path==='/repos/owner/repo'){send(state.repo);return;}
 if(path==='/repos/owner/repo/rulesets'){if(state.listDenied){send({},403);return;}send(state.rules.map(r=>({id:r.id,node_id:r.node_id,name:r.name,source_type:r.source_type,source:r.source,enforcement:r.enforcement})));return;}
 if(path.startsWith('/repos/owner/repo/rulesets/')){if(state.detailFailures-->0){send({},503);return;}const row=state.rules.find(r=>r.id===Number(path.split('/').at(-1)));send(row??{},row?200:404);return;}
 send({},404);
 }catch{res.destroy();}});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const optionsFor=()=>({origin:'http://127.0.0.1:'+server.address().port,token:'fixture-original',limits:{requestTimeoutMs:1000}});
 return{state,options:optionsFor,reader:(limits={})=>createOwnedConfigurationFixture({...optionsFor(),limits:{requestTimeoutMs:1000,...limits}}),async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
const step=plan=>({plan,stepId:plan.steps[0].id});

test('actual native create/update and merge PATCH preserve unrelated settings; private exact bytes/same credential/one-use',async()=>{
 const f=await fixture();try{const options=f.options(),reader=createOwnedConfigurationFixture(options);options.token='changed';const p=await reader.previewConfiguration(planInput());const first=await reader.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal),sealed=reader.inspectPreparedConfigurationPayload(first);const hash=createHash('sha256').update(sealed.jsonUtf8).digest('hex');sealed.jsonUtf8.fill(0);assert.throws(()=>f.reader().invokePreparedConfigurationStep(first),/Foreign/);const originalName=p.steps[0].payload.name;p.steps[0].payload.name='caller-mutated-after-private-prepare';const created=await reader.invokePreparedConfigurationStep(first);assert.equal(created.outcome,'confirmed',JSON.stringify(created));p.steps[0].payload.name=originalName;assert.ok(created.fieldObservations.every(f=>f.state==='matching'));assert.equal(f.state.rules[0].name,'external');assert.equal(createHash('sha256').update(f.state.writes[0].bytes).digest('hex'),hash);assert.throws(()=>reader.invokePreparedConfigurationStep(first),/consumed/);
 const patch=await reader.prepareConfigurationStep({plan:p,stepId:'patch-merge-methods'},new AbortController().signal);assert.equal((await reader.invokePreparedConfigurationStep(patch)).outcome,'confirmed');assert.deepEqual(JSON.parse(f.state.writes[1].bytes),{allow_merge_commit:false,allow_rebase_merge:true});assert.equal(f.state.repo.allow_squash_merge,true);assert.equal(f.state.repo.description,'preserve');assert.ok(f.state.writes.every(w=>w.auth==='Bearer fixture-original'));
 const id=created.creationHint,newProfile=profile();newProfile.ruleset.name='revised';newProfile.ruleset.enforcement='disabled';delete newProfile.mergeMethods;const update=await reader.previewConfiguration(planInput('owner-update',newProfile,{ownedRuleset:id}));const prepared=await reader.prepareConfigurationStep(step(update),new AbortController().signal);assert.equal((await reader.invokePreparedConfigurationStep(prepared)).outcome,'confirmed');assert.equal(f.state.rules.find(r=>r.id===id.id).enforcement,'disabled');assert.equal(f.state.rules[0].enforcement,'active');
 }finally{await f.close();}
});

test('validated201 hint survives detail503; exact known-ID recovery works with listing403 and wrong hint never scans',async()=>{
 const f=await fixture({failDetail:true});try{const r=f.reader(),p=await r.previewConfiguration(planInput()),h=await r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal),a=await r.invokePreparedConfigurationStep(h);assert.equal(a.outcome,'unknown');assert.ok(a.creationHint);f.state.listDenied=true;const before=f.state.reads.length,current=await f.reader().reconcileConfigurationStep({plan:p,stepId:'create-ruleset',creationHint:a.creationHint});assert.equal(current.outcome,'confirmed');assert.ok(f.state.reads.slice(before).every(path=>!path.startsWith('/repos/owner/repo/rulesets?')));assert.equal(f.state.writes.length,1);const wrong=await f.reader().reconcileConfigurationStep({plan:p,stepId:'create-ruleset',creationHint:{...a.creationHint,nodeId:'WRONG'}});assert.equal(wrong.outcome,'unknown');assert.equal(f.state.writes.length,1);await assert.rejects(r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal),/previously invoked/);}finally{await f.close();}
});

test('accepted then EOF uses complete correlation readback once, while zero/two/error matches remain UNKNOWN',async()=>{
 const f=await fixture({drop:true});try{const r=f.reader(),p=await r.previewConfiguration(planInput()),h=await r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal),a=await r.invokePreparedConfigurationStep(h);assert.equal(a.outcome,'unknown');assert.equal(a.creationHint,null);assert.equal((await f.reader().reconcileConfigurationStep({plan:p,stepId:'create-ruleset'})).outcome,'confirmed');const created=f.state.rules.pop();assert.equal((await f.reader().reconcileConfigurationStep({plan:p,stepId:'create-ruleset'})).outcome,'unknown');f.state.rules.push(created,{...created,id:102,node_id:'RS102'});assert.equal((await f.reader().reconcileConfigurationStep({plan:p,stepId:'create-ruleset'})).outcome,'unknown');f.state.listDenied=true;assert.equal((await f.reader().reconcileConfigurationStep({plan:p,stepId:'create-ruleset'})).outcome,'unknown');assert.equal(f.state.writes.length,1);}finally{await f.close();}
});

test('preflight drift/account/shape and cancellation send0, native403 stays UNKNOWN not no-creation proof',async()=>{
 for(const options of [{weak:true},{denyWrites:true},{}]){const f=await fixture(options);try{const r=f.reader(),p=await r.previewConfiguration(planInput());if(options.weak){await assert.rejects(r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal),/operands/);assert.equal(f.state.writes.length,0);}else if(options.denyWrites){const h=await r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal);assert.equal((await r.invokePreparedConfigurationStep(h)).outcome,'unknown');assert.equal(f.state.writes.length,1);await assert.rejects(r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal));}else{const abort=new AbortController(),h=await r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},abort.signal);abort.abort();assert.equal((await r.invokePreparedConfigurationStep(h)).handoff,'not-started');assert.equal(f.state.writes.length,0);const bad=structuredClone(p);bad.steps[0].route='/repos/owner/repo/pulls/1/merge';await assert.rejects(r.prepareConfigurationStep({plan:bad,stepId:'create-ruleset'},new AbortController().signal),/family/);f.state.repo.id=10;await assert.rejects(r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal));assert.equal(f.state.writes.length,0);}}finally{await f.close();}}
});

test('partial native PATCH retains per-field facts, observable target replacement and wrong update response cannot confirm',async()=>{
 const f=await fixture({partial:true});try{const r=f.reader(),p=await r.previewConfiguration(planInput('partial',{version:'p1',mergeMethods:{merge:false,rebase:true}})),h=await r.prepareConfigurationStep(step(p),new AbortController().signal),a=await r.invokePreparedConfigurationStep(h);assert.equal(a.outcome,'unknown');assert.deepEqual(a.fieldObservations.map(f=>[f.path,f.state]),[['allow_merge_commit','matching'],['allow_rebase_merge','conflicting']]);assert.equal((await f.reader().reconcileConfigurationStep({plan:p,stepId:'patch-merge-methods'})).outcome,'unknown');assert.equal(f.state.repo.description,'preserve');}finally{await f.close();}
 const race=await fixture({replaceRepo:true});try{const r=race.reader(),p=await r.previewConfiguration(planInput()),h=await r.prepareConfigurationStep({plan:p,stepId:'create-ruleset'},new AbortController().signal);assert.equal((await r.invokePreparedConfigurationStep(h)).outcome,'unknown');}finally{await race.close();}
 const wrong=await fixture({wrongResponse:true});try{wrong.state.rules.push(rule(41));const r=wrong.reader(),d=profile();d.ruleset.enforcement='disabled';delete d.mergeMethods;const p=await r.previewConfiguration(planInput('wrong',d,{ownedRuleset:{id:41,nodeId:'RS41'}})),h=await r.prepareConfigurationStep(step(p),new AbortController().signal);assert.equal((await r.invokePreparedConfigurationStep(h)).outcome,'unknown');assert.equal((await r.reconcileConfigurationStep({plan:p,stepId:'update-owned-ruleset'})).outcome,'confirmed');}finally{await wrong.close();}
});

test('normal private-profile mutation refuses offline; guidance unknown branch never invents head or whole setup',async()=>{
 const f=await fixture();try{const p=await f.reader().previewConfiguration(planInput()),production=openGitHubConfigurationReader({token:'fixture-offline'});await assert.rejects(production.prepareConfigurationStep({plan:{...p,target:{...p.target,visibility:'private'}},stepId:'create-ruleset'},new AbortController().signal),/DISABLED/);assert.throws(()=>production.invokePreparedConfigurationStep({}),/Foreign|DISABLED/);const guidance=await f.reader().observeConfigurationGuidance({target,branch:'missing'});assert.equal(guidance.policy,null);assert.equal(guidance.mergeMethods.allow_squash_merge,true);assert.ok(guidance.conditions.length);assert.equal(guidance.activation,'disabled');assert.equal(f.state.writes.length,0);}finally{await f.close();}
});


test('explicit host revision allows remaining-delta PUT/PATCH recovery but cannot reidentify an unknown create',async()=>{
 const f=await fixture({partial:true,drop:true});try{const r=f.reader(),desired={version:'p1',mergeMethods:{merge:false,rebase:true}},p=await r.previewConfiguration(planInput('recover',desired)),h=await r.prepareConfigurationStep({...step(p),revisionId:'host-journal-1'},new AbortController().signal);const first=await r.invokePreparedConfigurationStep(h);assert.equal(first.outcome,'unknown');const facts=await r.reconcileConfigurationStep({plan:p,stepId:'patch-merge-methods'});assert.equal(facts.outcome,'unknown');assert.deepEqual(facts.fieldObservations.map(f=>f.state),['matching','conflicting']);
 f.state.drop=false;f.state.partial=false;const remaining=await r.previewConfiguration(planInput('recover',{version:'p1',mergeMethods:{rebase:true}}));const badBasis=structuredClone(remaining);f.state.repo.allow_squash_merge=false;await assert.rejects(r.prepareConfigurationStep({...step(badBasis),revisionId:'host-conflict'},new AbortController().signal),/drift/);assert.equal(f.state.writes.length,1);f.state.repo.allow_squash_merge=true;
 const fresh=await r.prepareConfigurationStep({...step(remaining),revisionId:'host-journal-2'},new AbortController().signal);assert.equal(fresh.revisionId,'host-journal-2');assert.equal((await r.invokePreparedConfigurationStep(fresh)).outcome,'confirmed');assert.deepEqual(JSON.parse(f.state.writes[1].bytes),{allow_rebase_merge:true});await assert.rejects(r.prepareConfigurationStep({...step(remaining),revisionId:'host-journal-2'},new AbortController().signal),/previously invoked/);assert.equal(f.state.writes.length,2);
 }finally{await f.close();}
 const create=await fixture({drop:true});try{const r=create.reader(),p=await r.previewConfiguration(planInput('no-recreate')),h=await r.prepareConfigurationStep({plan:p,stepId:'create-ruleset',revisionId:'first'},new AbortController().signal);assert.equal((await r.invokePreparedConfigurationStep(h)).outcome,'unknown');await assert.rejects(r.prepareConfigurationStep({plan:p,stepId:'create-ruleset',revisionId:'second'},new AbortController().signal),/previously invoked/);assert.equal(create.state.writes.length,1);}finally{await create.close();}
});


test('actual guidance uses the same native normalized active rules and separately observed merge tuple, without writes',async()=>{
 const f=await fixture({guidance:true});try{const r=await f.reader().observeConfigurationGuidance({target,branch:'main'});assert.ok(r.policy,JSON.stringify(r));assert.equal(r.policy.completeVisibleInputs,true,JSON.stringify(r));assert.equal(r.policy.applicableSetKeys.length,1);assert.deepEqual(r.policy.sets[0].rules.map(r=>r.type),['deletion','non_fast_forward']);assert.equal(r.mergeMethods.allow_squash_merge,true);assert.equal(r.policy.classic.visibility,'not-established');assert.equal(r.activation,'disabled');assert.equal(f.state.writes.length,0);}finally{await f.close();}
});

test('configuration transport adds only internal finite PUT/PATCH while old native GET/POST rejects them before network',async()=>{
 const {nativeJsonTransport,nativeConfigurationTransport}=await import('../../dist/platform/github-transport.js');const f=await fixture();try{const bounds={requestTimeoutMs:1000,responseBytes:1024,pages:10,collectionBytes:10000,collectionItems:100},url=new URL('/repos/owner/repo',f.options().origin);assert.throws(()=>nativeJsonTransport('fixture-original',bounds)(url,{method:'PUT',body:Buffer.from('{}')}),/Unsupported/);assert.throws(()=>nativeConfigurationTransport('fixture-original',bounds)(url,{method:'DELETE'}),/Unsupported/);assert.equal(f.state.writes.length,0);assert.equal(f.state.reads.length,0);}finally{await f.close();}
});


test('production display activation cannot promote native write admission even via runtime property mutation (already-aborted no-I/O probe)',async()=>{
 const f=await fixture();try{const p=await f.reader().previewConfiguration(planInput()),production=openGitHubConfigurationReader({token:'fixture-offline'});assert.throws(()=>{production.activation='owned-fixture-only'},TypeError);await assert.rejects(production.prepareConfigurationStep({plan:{...p,target:{...p.target,visibility:'private'}},stepId:'create-ruleset'},AbortSignal.abort()),/HOSTED_CONFIGURATION_DISABLED/);}finally{await f.close();}
});


test('043 new PR creation seals explicit native tuple and confirms exact full returned semantics',async()=>{
 const f=await fixture();try{const r=f.reader(),p=await r.previewConfiguration(planInput('native-pr-new',prProfile()));const payload=p.steps[0].payload;
 const expected={...nativeTuple(),...prParameters()};assert.deepEqual(payload.rules.find(x=>x.type==='pull_request').parameters,expected);
 const h=await r.prepareConfigurationStep(step(p),new AbortController().signal),sealed=r.inspectPreparedConfigurationPayload(h);assert.deepEqual(JSON.parse(Buffer.from(sealed.jsonUtf8)).rules,payload.rules);
 const actual=await r.invokePreparedConfigurationStep(h);assert.equal(actual.outcome,'confirmed',JSON.stringify(actual));assert.deepEqual(actual.observed.rules.find(x=>x.type==='pull_request').parameters,expected);assert.ok(actual.fieldObservations.every(x=>x.state==='matching'));assert.equal(f.state.writes.length,1);assert.deepEqual(JSON.parse(f.state.writes[0].bytes).rules,payload.rules);
 }finally{await f.close();}
});

test('043 old missing-operand create expectation remains UNKNOWN on actual known-ID read with zero POST',async()=>{
 const f=await fixture();try{const r=f.reader(),p=await r.previewConfiguration(planInput('native-pr-old',prProfile())),s=p.steps[0],legacyRules=structuredClone(s.payload.rules);legacyRules.find(x=>x.type==='pull_request').parameters=prParameters();s.payload.rules=legacyRules;s.payloadHash=policyHash(s.payload);s.fields.find(x=>x.path==='ruleset.rules').intended=structuredClone(legacyRules);
 f.state.rules.push({...rule(41),name:s.payload.name,rules:[{type:'non_fast_forward'},{type:'deletion'},{type:'pull_request',parameters:{...prParameters(),...nativeTuple()}}]});
 const observed=await r.reconcileConfigurationStep({plan:p,stepId:'create-ruleset',creationHint:{id:41,nodeId:'RS41'}});assert.equal(observed.outcome,'unknown');assert.equal(observed.fieldObservations.find(x=>x.path==='ruleset.rules').state,'conflicting');assert.equal(observed.observed.rules.find(x=>x.type==='pull_request').parameters.require_extra_approval_for_unattributed_changes,true);assert.equal(f.state.writes.length,0);assert.ok(f.state.reads.some(x=>x==='/repos/owner/repo/rulesets/41?includes_parents=true'));
 }finally{await f.close();}
});

test('043 existing PR false/subset and absent optional operands survive exact owned PUT; missing PR on existing set receives tuple',async()=>{
 for(const extras of [{require_extra_approval_for_unattributed_changes:false,allowed_merge_methods:['squash'],required_reviewers:[]},{}]){
 const f=await fixture();try{const before={...prParameters(),...extras};f.state.rules.push({...rule(41),rules:[{type:'non_fast_forward'},{type:'deletion'},{type:'pull_request',parameters:before}]});const desired=prProfile();desired.ruleset.name='external';desired.ruleset.enforcement='disabled';const r=f.reader(),p=await r.previewConfiguration(planInput('native-pr-preserve',desired,{ownedRuleset:{id:41,nodeId:'RS41'}})),parameters=p.steps[0].payload.rules.find(x=>x.type==='pull_request').parameters;
 assert.deepEqual(parameters,before);const h=await r.prepareConfigurationStep(step(p),new AbortController().signal),a=await r.invokePreparedConfigurationStep(h);assert.equal(a.outcome,'confirmed',JSON.stringify(a));assert.equal(f.state.writes[0].method,'PUT');assert.deepEqual(JSON.parse(f.state.writes[0].bytes).rules.find(x=>x.type==='pull_request').parameters,before);assert.deepEqual(a.observed.rules.find(x=>x.type==='pull_request').parameters,before);
 }finally{await f.close();}}
 const f=await fixture();try{f.state.rules.push(rule(41));const desired=prProfile();desired.ruleset.name='external';const r=f.reader(),p=await r.previewConfiguration(planInput('native-pr-add',desired,{ownedRuleset:{id:41,nodeId:'RS41'}}));assert.deepEqual(p.steps[0].payload.rules.find(x=>x.type==='pull_request').parameters,{...nativeTuple(),...prParameters()});const h=await r.prepareConfigurationStep(step(p),new AbortController().signal);assert.equal((await r.invokePreparedConfigurationStep(h)).outcome,'confirmed');assert.equal(f.state.writes[0].method,'PUT');}finally{await f.close();}
});

test('043 real native returned mismatches/extensions stay UNKNOWN and are never resent',async()=>{
 for(const prFault of ['count','dismiss_stale_reviews_on_push','require_last_push_approval','require_code_owner_review','required_review_thread_resolution','false','string','null','unknown','reviewer','subset','duplicate-method','duplicate-rule','missing-rule','extra-rule']){
 const f=await fixture({prFault});try{const r=f.reader(),p=await r.previewConfiguration(planInput('native-pr-fault',prProfile())),h=await r.prepareConfigurationStep(step(p),new AbortController().signal),a=await r.invokePreparedConfigurationStep(h);assert.equal(a.outcome,'unknown',prFault);assert.ok(a.creationHint);const current=await r.reconcileConfigurationStep({plan:p,stepId:'create-ruleset',creationHint:a.creationHint});assert.equal(current.outcome,'unknown',prFault);assert.equal(f.state.writes.length,1);await assert.rejects(r.prepareConfigurationStep(step(p),new AbortController().signal),/previously invoked/);assert.equal(f.state.writes.length,1);
 }finally{await f.close();}}
});
