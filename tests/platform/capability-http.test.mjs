import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createOwnedCapabilityFixture } from '../../dist/platform/github-capability.js';

const target={owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9',visibility:'public'};
const request=(action='create-issue',visibility='public')=>({expectedUserId:7,target:{...target,visibility},action});
async function fixture(options={}){
 const requests=[],sockets=new Set();
 const server=http.createServer(async(req,res)=>{try{
  requests.push({method:req.method,path:req.url,authorization:req.headers.authorization});if(options.barrier&&req.url==='/user')await options.barrier();
  const userScope=Object.hasOwn(options,'userScopes')?options.userScopes:'public_repo';const repoScope=Object.hasOwn(options,'repoScopes')?options.repoScopes:'public_repo';
  const scope=req.url==='/user'?userScope:repoScope;
  res.setHeader('content-type','application/json');if(scope!==undefined)res.setHeader('x-oauth-scopes',scope);res.setHeader('x-accepted-oauth-scopes','repo');res.setHeader('x-accepted-github-permissions','issues=write,pull_requests=write');
  if(req.url==='/user'){res.end(JSON.stringify({id:7,type:'User',login:'owner',...options.userPatch}));return;}
  if(req.url==='/repos/owner/repo'){const visibility=options.private?'private':'public';res.end(JSON.stringify({id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},private:Boolean(options.private),visibility,permissions:{admin:true},archived:false,disabled:false,has_issues:true,temp_clone_token:'fixture-never-return-this-field',...options.repoPatch}));return;}
  if(req.url==='/repos/owner/repo/rulesets/5?includes_parents=true'){res.end(JSON.stringify({id:5,node_id:'RS5',source_type:options.parentRule?'Organization':'Repository',source:'owner/repo'}));return;}
  if(req.url==='/repos/owner/repo/rulesets/5/history?per_page=1&page=1'){res.statusCode=options.historyStatus??200;res.end(JSON.stringify(options.emptyHistory?[]:[{version_id:2,actor:{id:7,type:'User'},updated_at:'2026-10-17T00:00:00Z'}]));return;}
  if(req.url==='/repos/owner/repo/rulesets/5/history/2'){res.end(JSON.stringify({version_id:2,state:{id:options.wrongVersion?999:5,source_type:'Repository',source:'owner/repo'}}));return;}
  res.statusCode=404;res.end('{}');
 }catch{res.destroy();}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 return {origin,requests,reader:(token='fixture-strong')=>createOwnedCapabilityFixture({origin,token,limits:{requestTimeoutMs:500}}),async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
const noWrite=f=>assert.ok(f.requests.every(r=>r.method==='GET'));

test('actual granted scopes on BOTH authenticated reads match only native operands; all actions remain disabled',async()=>{
 for(const visibility of ['public','private']){const f=await fixture({private:visibility==='private',userScopes:visibility==='private'?'repo':'public_repo',repoScopes:visibility==='private'?'repo':'public_repo'});try{const c=f.reader();for(const action of ['create-issue','create-draft-pr','create-comment']){const r=await c.observePublicationCapability(request(action,visibility));assert.equal(r.state,'matched',JSON.stringify(r));assert.equal(r.activation,'disabled');assert.equal(r.observedUserId,7);assert.equal(r.receipts.length,2);assert.ok(r.conditions.some(s=>s.includes('THIS action')));assert.ok(!JSON.stringify(r).includes('fixture-never-return-this-field'));}noWrite(f);}finally{await f.close();}}
});

test('same powerful User/admin and metadata-readable weak credentials never borrow accepted requirements as grants',async()=>{
 for(const options of [{userScopes:'',repoScopes:''},{userScopes:'repo:status',repoScopes:'repo:status'},{private:true,userScopes:undefined,repoScopes:undefined}]){const f=await fixture(options);try{const r=await f.reader('fixture-weak').observePublicationCapability(request('create-issue',options.private?'private':'public'));assert.equal(r.state,options.private?'unknown':'denied');assert.equal(r.observedUserId,7);assert.equal(r.receipts.length,2);assert.equal(r.receipts[1].acceptedScopeHeader,'repo');assert.equal(r.activation,'disabled');noWrite(f);}finally{await f.close();}}
 const f=await fixture({private:true});try{assert.equal((await f.reader().observePublicationCapability(request('create-issue','private'))).state,'denied');noWrite(f);}finally{await f.close();}
});

test('missing/malformed/conflicting grants stay UNKNOWN; normalization accepts only matching exact scope sets',async()=>{
 for(const options of [{userScopes:undefined},{userScopes:'repo,,user',repoScopes:'repo,,user'},{userScopes:'repo, repo',repoScopes:'repo, repo'},{userScopes:'repo',repoScopes:'public_repo'},{userScopes:'repo permission',repoScopes:'repo permission'}]){const f=await fixture(options);try{assert.equal((await f.reader().observePublicationCapability(request())).state,'unknown');noWrite(f);}finally{await f.close();}}
 const f=await fixture({userScopes:' user,repo ',repoScopes:'repo,user'});try{const r=await f.reader().observePublicationCapability(request());assert.equal(r.state,'matched');assert.deepEqual(r.grantedScopes,['repo','user']);noWrite(f);}finally{await f.close();}
});

test('native identity/visibility/state operands reject profile mismatch and never infer a missing field',async()=>{
 for(const [options,state]of [[{userPatch:{id:8}},'denied'],[{repoPatch:{id:10,node_id:'R10'}},'unknown'],[{repoPatch:{owner:{id:8,type:'User',login:'other'}}},'denied'],[{repoPatch:{owner:{id:7,type:'Organization',login:'owner'}}},'denied'],[{repoPatch:{private:true,visibility:'public'}},'unknown'],[{repoPatch:{permissions:{admin:false}}},'denied'],[{repoPatch:{permissions:{}}},'unknown'],[{repoPatch:{archived:true}},'denied'],[{repoPatch:{disabled:true}},'denied'],[{repoPatch:{has_issues:false}},'denied'],[{repoPatch:{has_issues:undefined}},'unknown']]){const f=await fixture(options);try{const r=await f.reader().observePublicationCapability(request());assert.equal(r.state,state,JSON.stringify(options)+JSON.stringify(r));noWrite(f);}finally{await f.close();}}
});

test('credential instance and input captured before await; no token/prefix or full native body escapes receipt',async()=>{
 let entered,release;const arrived=new Promise(r=>entered=r),barrier=new Promise(r=>release=r);const f=await fixture({barrier:async()=>{entered();await barrier;}});try{
  const options={origin:f.origin,token:'fixture-original',limits:{requestTimeoutMs:500}},c=createOwnedCapabilityFixture(options),i=request(),pending=c.observePublicationCapability(i);await arrived;options.token='fixture-replaced';options.limits.requestTimeoutMs=1;i.target.repository='other';i.target.repositoryId=999;i.expectedUserId=8;release();const r=await pending;assert.equal(r.state,'matched');assert.equal(r.target.repositoryId,9);assert.ok(f.requests.every(x=>x.authorization==='Bearer fixture-original'));assert.ok(!JSON.stringify(r).includes('fixture-original'));assert.ok(!JSON.stringify(r).includes('fixture-never-return-this-field'));const other=await f.reader().observePublicationCapability(request());assert.notEqual(r.credentialInstanceId,other.credentialInstanceId);noWrite(f);
 }finally{await f.close();}
 assert.throws(()=>createOwnedCapabilityFixture({origin:'https://api.github.com',token:'fixture'}),/loopback/);
});

test('existing ruleset history/version gate is separate readonly evidence, not activated write or complete policy coverage',async()=>{
 const f=await fixture({userScopes:undefined,repoScopes:undefined});try{const r=await f.reader('fixture-adminwrite').observeRulesetAdministration({expectedUserId:7,target,rulesetId:5});assert.equal(r.state,'matched',JSON.stringify(r));assert.equal(r.activation,'disabled');assert.equal(r.action,'repository-ruleset-administration');assert.deepEqual(r.ruleset,{id:5,nodeId:'RS5',versionId:2});assert.equal(r.grantedScopes,null);assert.ok(r.conditions.some(s=>s.includes('discriminator remains pending')));assert.ok(f.requests.some(x=>x.path.endsWith('/history/2')));noWrite(f);}finally{await f.close();}
 const weak=await fixture({historyStatus:403});try{const r=await weak.reader('fixture-adminread').observeRulesetAdministration({expectedUserId:7,target,rulesetId:5});assert.equal(r.state,'unknown');assert.equal(r.activation,'disabled');assert.ok(!weak.requests.some(x=>x.path.endsWith('/history/2')));noWrite(weak);}finally{await weak.close();}
});

test('absent/parent-owned/malformed ruleset history cannot trigger policy creation or unrelated capability',async()=>{
 for(const options of [{parentRule:true},{emptyHistory:true},{wrongVersion:true}]){const f=await fixture(options);try{const r=await f.reader().observeRulesetAdministration({expectedUserId:7,target,rulesetId:5});assert.equal(r.state,'unknown');assert.equal(r.activation,'disabled');if(options.parentRule)assert.ok(!f.requests.some(x=>x.path.includes('/history')));noWrite(f);}finally{await f.close();}}
});

test('missing or unsupported User/owner type/login is UNKNOWN; known wellformed outside-profile identities are DENIED',async()=>{
 const unknowns=[['missing User type',{userPatch:{type:undefined}}],['unsupported User type',{userPatch:{type:'FutureIdentity'}}],['missing User login',{userPatch:{login:undefined}}],['malformed User login',{userPatch:{login:123}}],['missing owner type',{repoPatch:{owner:{id:7,login:'owner'}}}],['unsupported owner type',{repoPatch:{owner:{id:7,type:'FutureIdentity',login:'owner'}}}],['missing owner login',{repoPatch:{owner:{id:7,type:'User'}}}],['malformed owner login',{repoPatch:{owner:{id:7,type:'User',login:123}}}]];
 for(const [label,options]of unknowns){const f=await fixture(options);try{const r=await f.reader().observePublicationCapability(request());assert.equal(r.state,'unknown',label);assert.equal(r.activation,'disabled');noWrite(f);}finally{await f.close();}}
 for(const options of [{userPatch:{type:'Bot'}},{repoPatch:{owner:{id:7,type:'Organization',login:'owner'}}},{repoPatch:{owner:{id:8,type:'User',login:'other'}}}]){const f=await fixture(options);try{assert.equal((await f.reader().observePublicationCapability(request())).state,'denied');noWrite(f);}finally{await f.close();}}
});
