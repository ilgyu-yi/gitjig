import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {observeNativeConfigurationTarget,observeGitHubConfigurationTarget} from '../../dist/platform/repository-identity.js';
import {nativeConfigurationFixture} from './repository-configuration-fixture.mjs';
import {GitHubReadClient} from '../../dist/platform/github-read-client.js';
import {nativeReadTransport} from '../../dist/platform/github-transport.js';
test('minimal native registration reads only actor/repository identity, rechecks numeric GitLab identity and needs no policies or admin',async()=>{
 for(const provider of ['gitea','gitlab']){
  const f=await nativeConfigurationFixture(provider);try{delete f.state.repository.permissions;const target=await observeNativeConfigurationTarget({provider,apiBase:f.origin+new URL(f.target.apiBase).pathname,token:'fixture-native-token'},{owner:f.target.owner,repository:'repo'},true);assert.deepEqual(target,{...f.target,apiBase:f.origin+new URL(f.target.apiBase).pathname});assert.equal(f.requests.length,4);assert.ok(f.requests.every(r=>r.method==='GET'));if(provider==='gitlab'){assert.match(f.requests[1].path,/group%2Fsubgroup%2Frepo$/);assert.match(f.requests[3].path,/projects\/9$/);}}finally{await f.close();}
 }
});
test('native registration refuses actor/path/id drift, malformed identity, denied visibility, byte exhaustion and cancellation',async()=>{
 for(const kind of ['actor','path','id','malformed','denied','bytes','cancel']){
  let users=0,repos=0;const f=await nativeConfigurationFixture('gitlab',{intercept:({req,relative,state,send})=>{
   if(relative==='/user'&&++users===2&&kind==='actor')state.actorId=8;
   if(relative.startsWith('/projects/')&&req.method==='GET'){
    repos++;if(repos===2&&kind==='path')state.repository.path_with_namespace='renamed/repo';if(repos===2&&kind==='id')state.repository.id=10;
    if(kind==='malformed')state.repository.id='9';if(kind==='denied'){send({},403);return true;}
   }return false;
  }});try{const abort=new AbortController();if(kind==='cancel')abort.abort();await assert.rejects(observeNativeConfigurationTarget({provider:'gitlab',apiBase:f.origin+'/forge/api/v4',token:'fixture-native-token',...(kind==='bytes'?{limits:{collectionBytes:4}}:{})},{owner:'group/subgroup',repository:'repo',signal:abort.signal},true));assert.equal(f.requests.some(r=>r.method!=='GET'),false);if(kind==='bytes')assert.equal(f.requests.length,1);if(kind==='cancel')assert.equal(f.requests.length,0);}finally{await f.close();}
 }
});
test('GitHub identity registration uses existing native HTTP client and refuses node/visibility/actor drift without writes',async()=>{
 for(const mode of ['healthy','node','visibility','actor','path','non-user','denied']){
  let users=0,repos=0;const requests=[];const server=http.createServer((req,res)=>{requests.push({method:req.method,path:req.url});res.setHeader('content-type','application/json');if(mode==='denied')res.statusCode=403;if(req.url==='/user')res.end(JSON.stringify({id:++users===2&&mode==='actor'?8:7,login:'owner',type:mode==='non-user'?'Bot':'User'}));else{repos++;res.end(JSON.stringify({id:9,node_id:repos===2&&mode==='node'?'R10':'R9',full_name:mode==='path'?'other/repo':'owner/repo',url:'https://api.github.com/repos/owner/repo',visibility:repos===2&&mode==='visibility'?'private':'public',private:repos===2&&mode==='visibility'}));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const limits={requestTimeoutMs:1000,responseBytes:8192,pages:4,collectionBytes:32768,collectionItems:10},origin='http://127.0.0.1:'+server.address().port,client=new GitHubReadClient(origin,nativeReadTransport('fixture-only',limits),limits);const run=()=>observeGitHubConfigurationTarget(client,{owner:'owner',repository:'repo'});if(mode==='healthy')assert.deepEqual(await run(),{host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',actorUserId:7,visibility:'public'});else await assert.rejects(run());assert.ok(requests.every(r=>r.method==='GET'));assert.ok(requests.length<=4);}finally{await new Promise(r=>server.close(r));}
 }
});
