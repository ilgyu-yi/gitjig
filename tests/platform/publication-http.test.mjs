import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createOwnedPublicationFixture, openGitHubPublication } from '../../dist/platform/github-publication.js';

const repo={id:9,node_id:'R9',full_name:'owner/repo'},H='a'.repeat(40),target={host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',actorUserId:7};
const policy={version:'policy-v1',allowedMentions:[],knownPrivateLiterals:['fixture-private-123'],maxTitleBytes:1024,maxBodyBytes:128*1024};
const input=(action={kind:'create-issue',title:' Korean 제목 ',body:'  본문\n{"path":"a b","command":"printf hello"}  '},operationId='O-publication')=>({operationId,target:structuredClone(target),action,carrierPolicy:structuredClone(policy)});
const hash=b=>createHash('sha256').update(b).digest('hex');
function resource(action,payload,n=1){const common={id:100+n,node_id:'N'+n,user:{id:7},body:payload.body};if(action==='comment')return {...common,url:`https://api.github.com/repos/owner/repo/issues/comments/${100+n}`,issue_url:'https://api.github.com/repos/owner/repo/issues/4',html_url:`https://github.com/owner/repo/issues/4#issuecomment-${100+n}`};if(action==='draft')return {...common,number:n,title:payload.title,draft:true,url:`https://api.github.com/repos/owner/repo/pulls/${n}`,html_url:`https://github.com/owner/repo/pull/${n}`,head:{repo,ref:'feature',sha:H},base:{repo,ref:'main'}};return {...common,number:n,title:payload.title,repository_url:'https://api.github.com/repos/owner/repo',url:`https://api.github.com/repos/owner/repo/issues/${n}`,html_url:`https://github.com/owner/repo/issues/${n}`};}
async function fixture(options={}){
 const requests=[],posts=[],rows=[],closures=[],sockets=new Set();let origin,detailCalls=0,replaced=false;
 const server=http.createServer(async(req,res)=>{try{
  const parts=[];for await(const b of req)parts.push(b);const bytes=Buffer.concat(parts);requests.push({method:req.method,path:req.url,bytes});
  const send=(data,status=200,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(data));};
  if(req.method==='POST'){
   closures.push(new Promise(resolve=>req.socket.once('close',resolve)));
   posts.push({path:req.url,bytes,payload:JSON.parse(bytes.toString())});if(options.replaceRepoAfterPost)replaced=true;const kind=req.url.endsWith('/pulls')?'draft':req.url.endsWith('/comments')?'comment':'issue';
   const row=resource(kind,posts.at(-1).payload,rows.length+1);if(kind==='comment'&&options.parentPull)row.html_url=row.html_url.replace('/issues/4#','/pull/4#');rows.push(row);
   if(options.onPost&&await options.onPost({req,res,row}))return;
   if(options.drop){req.socket.destroy();return;}if(options.stall)return;
   if(options.status){send({message:'rate limit secondary or unsupported error'},options.status);return;}
   send(options.bad201?{...row,user:{id:999}}:row,201);return;
  }
  if(req.url==='/user'){if(options.userBarrier)await options.userBarrier();send({id:options.wrongActor?999:7});return;}
  if(req.url==='/repos/owner/repo'){send(options.wrongRepo?{...repo,id:999}:replaced?{...repo,id:10,node_id:'R10'}:repo);return;}
  if(req.url?.startsWith('/repos/owner/repo/git/ref/heads/')){const name=decodeURIComponent(req.url.split('/heads/')[1]);send({ref:'refs/heads/'+name,object:{type:'commit',sha:name==='feature'?(options.wrongHead?'c'.repeat(40):H):'b'.repeat(40)}});return;}
  if(req.url==='/repos/owner/repo/pulls/4'){send({number:4,node_id:options.wrongParent?'PR999':'PR4',url:'https://api.github.com/repos/owner/repo/pulls/4',base:{repo},head:{repo:options.crossFork?{id:88,node_id:'F88',full_name:'someone/fork'}:repo}});return;}
  if(req.url==='/repos/owner/repo/issues/4'){send({number:4,node_id:options.wrongParent?'I999':'I4',repository_url:'https://api.github.com/repos/owner/repo',...(options.parentPull?{pull_request:{url:'https://api.github.com/repos/owner/repo/pulls/4'}}:{})});return;}
  if(req.url?.includes('?')){
   if(options.listForbidden){send({message:'listing unavailable'},403);return;}
   const url=new URL(req.url,origin),page=Number(url.searchParams.get('page'));
   if(options.badPage && page===2){send({message:'unavailable'},500);return;}
   const listed=options.lookupRows?options.lookupRows(rows):rows;
   if(options.pages && page===1){const next=new URL(url);next.searchParams.set('page','2');send([],200,{link:`<${next}>; rel="next", <${next}>; rel="last"`});return;}
   send(listed);return;
  }
  const row=(options.lookupRows?options.lookupRows(rows):rows).find(row=>new URL(row.url).pathname===req.url);
  if(row){if(options.detailFailOnce&&++detailCalls===1){send({message:'temporary unavailable'},503);return;}if(options.replaceRepoOnDetail)replaced=true;send(options.changedReadback?{...row,body:row.body+'changed'}:options.changedHead?{...row,head:{...row.head,sha:'c'.repeat(40)}}:row);return;}
  send({message:'not found'},404);
 }catch(error){res.destroy(error);}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 return {origin,requests,posts,rows,sockets,closed:()=>Promise.all(closures),client:()=>createOwnedPublicationFixture({origin,token:'literal-owned-fixture-key',limits:{requestTimeoutMs:options.timeout??500}}),async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
async function boundedClosed(f){let timer;try{await Promise.race([f.closed(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native cancelled request socket remains open')),500);})]);}finally{clearTimeout(timer);}}
function retained(i,prepared,client){const p=client.inspectPreparedPayload(prepared);return {input:structuredClone(i),payloadUtf8:p.jsonUtf8,payloadHash:p.sha256};}

test('finite healthy issue/draft/comment actualHTTP exact semantic payload and readback; production disabled',async()=>{
 assert.throws(()=>openGitHubPublication(),/HOSTED_PUBLICATION_DISABLED/);assert.throws(()=>createOwnedPublicationFixture({origin:'https://api.github.com',token:'fixture'}),/loopback/);
 const f=await fixture();try{
  for(const a of [input().action,{kind:'create-draft-pr',title:'draft',body:'draft text',headRef:'feature',headCommit:H,baseRef:'main'},{kind:'create-comment',parent:{kind:'issue',number:4,nodeId:'I4'},body:'comment text',purpose:'bootstrap'}]){
   const c=f.client(),i=input(a,'O-healthy-'+f.posts.length),p=await c.preparePublication(i,new AbortController().signal),raw=c.inspectPreparedPayload(p),attempt=c.invokePreparedPublication(p);
   const result=await attempt;assert.equal(result.outcome,'confirmed',JSON.stringify(result));assert.equal(result.handoff,'request-created');assert.equal(hash(f.posts.at(-1).bytes),raw.sha256);assert.equal(f.posts.at(-1).payload.body,i.action.body+'\n\n<!-- gitjig-operation: '+i.operationId+' -->');if(a.kind==='create-draft-pr')assert.equal(f.posts.at(-1).payload.draft,true);
   assert.throws(()=>c.invokePreparedPublication(p),/consumed/);
  }assert.equal(f.posts.length,3);assert.equal(f.posts[0].payload.title,' Korean 제목 ');assert.ok(f.posts[0].payload.body.startsWith('  본문\n{"path":"a b","command":"printf hello"}  '));
 }finally{await f.close();}
});

test('known forbidden carriers zeroPOST; explicit allowed mention and captured/exported input immutability',async()=>{
 let release,entered;const enteredPromise=new Promise(r=>entered=r),barrier=new Promise(r=>release=r);let pause=true;
 const f=await fixture({userBarrier:async()=>{if(pause){entered();await barrier;}}});try{
  const c=f.client();for(const body of ['@team forbidden','bad\rcontrol','fixture-private-123','<!-- gitjig-operation: forged -->'])await assert.rejects(c.preparePublication(input({kind:'create-issue',title:'t',body}),new AbortController().signal));assert.equal(f.posts.length,0);
  const i=input({kind:'create-issue',title:'immutable',body:'@owner allowed'});i.carrierPolicy.allowedMentions=['owner'];const pending=c.preparePublication(i,new AbortController().signal);await enteredPromise;i.action.body='later bad @team';i.target.repository='evil';i.carrierPolicy.allowedMentions=[];pause=false;release();const p=await pending,exported=c.inspectPreparedPayload(p);exported.jsonUtf8.fill(0);const result=await c.invokePreparedPublication(p);assert.equal(result.outcome,'confirmed');assert.ok(f.posts[0].payload.body.startsWith('@owner allowed'));assert.equal(f.posts[0].path,'/repos/owner/repo/issues');assert.equal(hash(f.posts[0].bytes),p.payloadHash);
  assert.throws(()=>f.client().invokePreparedPublication(p),/Foreign/);assert.throws(()=>c.invokePreparedPublication({...p}),/Foreign/);assert.equal(f.posts.length,1);
 }finally{await f.close();}
});

test('serveraccepted then EOF yields UNKNOWN; complete two-page restart lookup confirms without resend',async()=>{
 const f=await fixture({drop:true,pages:true});try{const c=f.client(),i=input(),p=await c.preparePublication(i,new AbortController().signal),saved=retained(i,p,c);const a=await c.invokePreparedPublication(p);assert.equal(a.outcome,'unknown');assert.equal(f.rows.length,1);const lookup=await f.client().reconcilePublication(saved,new AbortController().signal);assert.equal(lookup.outcome,'confirmed',JSON.stringify(lookup));assert.equal(lookup.complete,true);assert.equal(lookup.exactMatches,1);assert.equal(f.posts.length,1);assert.ok(f.requests.some(r=>r.path.includes('page=2')));}finally{await f.close();}
});

test('zero/two/conflicting/incomplete lookups remain UNKNOWN, retain exact bytes, never retry',async()=>{
 for(const mode of ['zero','two','conflict','partial']){
  const f=await fixture({drop:true,pages:mode==='partial',badPage:mode==='partial',lookupRows:rows=>mode==='zero'?[]:mode==='two'?[...rows,{...rows[0],id:999,node_id:'N999',number:999,url:'https://api.github.com/repos/owner/repo/issues/999',html_url:'https://github.com/owner/repo/issues/999'}]:mode==='conflict'?[{...rows[0],title:'wrong'}]:rows});
  try{const c=f.client(),i=input(),p=await c.preparePublication(i,new AbortController().signal),saved=retained(i,p,c);await c.invokePreparedPublication(p);const lookup=await f.client().reconcilePublication(saved,new AbortController().signal);assert.equal(lookup.outcome,'unknown',mode+JSON.stringify(lookup));assert.equal(f.posts.length,1);if(mode==='partial')assert.equal(lookup.complete,false);if(mode==='two')assert.equal(lookup.exactMatches,2);saved.payloadUtf8[0]=0;assert.equal((await f.client().reconcilePublication(saved,new AbortController().signal)).outcome,'unknown');assert.equal(f.posts.length,1);}finally{await f.close();}
 }
});

test('before invocation cancel sends0; postaccept cancel and deadline close actual requests with UNKNOWN',async()=>{
 const f=await fixture();try{const c=f.client(),a=new AbortController(),p=await c.preparePublication(input(),a.signal);a.abort();const result=await c.invokePreparedPublication(p);assert.equal(result.handoff,'not-started');assert.equal(result.outcome,'refused');assert.equal(f.posts.length,0);}finally{await f.close();}
 for(const mode of ['abort','deadline']){let accepted;const entered=new Promise(r=>accepted=r);const f=await fixture({stall:true,timeout:80,onPost:()=>accepted()});try{const c=f.client(),a=new AbortController(),p=await c.preparePublication(input(),a.signal),pending=c.invokePreparedPublication(p);await entered;if(mode==='abort')a.abort();const result=await pending;assert.equal(result.outcome,'unknown');assert.equal(result.handoff,'request-created');assert.equal(f.rows.length,1);assert.equal(f.posts.length,1);await boundedClosed(f);}finally{await f.close();}}
});

test('malformed201/changed readback/numericerror cannot certify delivered or absence',async()=>{
 for(const opt of [{bad201:true},{changedReadback:true},{status:403}]){const f=await fixture(opt);try{const c=f.client(),p=await c.preparePublication(input(),new AbortController().signal);assert.equal((await c.invokePreparedPublication(p)).outcome,'unknown');assert.equal(f.posts.length,1);}finally{await f.close();}}
});


test('actual preflight mismatched actor/repository/parent/published head refuses beforePOST',async()=>{
 for(const [options,action]of [[{wrongActor:true},input().action],[{wrongRepo:true},input().action],[{wrongParent:true},{kind:'create-comment',parent:{kind:'issue',number:4,nodeId:'I4'},body:'scoped',purpose:'bootstrap'}],[{wrongHead:true},{kind:'create-draft-pr',title:'draft',body:'scoped',headRef:'feature',headCommit:H,baseRef:'main'}]]){const f=await fixture(options);try{await assert.rejects(f.client().preparePublication(input(action),new AbortController().signal));assert.equal(f.posts.length,0);}finally{await f.close();}}
});


test('actual PR-parent comment binds kind, and changed draft head readback remains UNKNOWN',async()=>{
 const comment={kind:'create-comment',parent:{kind:'pull-request',number:4,nodeId:'PR4'},body:'PR discussion',purpose:'reviewed-summary'};
 const f=await fixture({parentPull:true,crossFork:true});try{const c=f.client(),p=await c.preparePublication(input(comment),new AbortController().signal);assert.equal((await c.invokePreparedPublication(p)).outcome,'confirmed');assert.equal(f.posts[0].path,'/repos/owner/repo/issues/4/comments');}finally{await f.close();}
 const wrong=await fixture({wrongParent:true});try{await assert.rejects(wrong.client().preparePublication(input(comment),new AbortController().signal),/parent changed/);assert.equal(wrong.posts.length,0);}finally{await wrong.close();}
 const drift=await fixture({changedHead:true});try{const c=drift.client(),p=await c.preparePublication(input({kind:'create-draft-pr',title:'draft',body:'draft',headRef:'feature',headCommit:H,baseRef:'main'}),new AbortController().signal);assert.equal((await c.invokePreparedPublication(p)).outcome,'unknown');assert.equal(drift.posts.length,1);}finally{await drift.close();}
});


test('actual POST malformed/duplicate-key/invalidUTF8/oversized/redirect responses stay UNKNOWN without following',async()=>{
 const destination=await fixture();try{
  for(const mode of ['duplicate','utf8','oversize','redirect']){const f=await fixture({onPost:({res})=>{res.writeHead(mode==='redirect'?307:201,{'content-type':'application/json',...(mode==='redirect'?{location:destination.origin+'/credential-destination'}:{})});res.end(mode==='duplicate'?' {"id":1,"id":2} ':mode==='utf8'?Buffer.from([0xff]):mode==='oversize'?Buffer.alloc(1024*1024+1,32):'{}');return true;}});try{const c=f.client(),p=await c.preparePublication(input(),new AbortController().signal);assert.equal((await c.invokePreparedPublication(p)).outcome,'unknown');assert.equal(f.posts.length,1);}finally{await f.close();}}
  assert.equal(destination.requests.length,0);
 }finally{await destination.close();}
});


test('validated201 hint survives failed detail and recovers by exactGET despite listing403; wrong hints never fall back',async()=>{
 const options={detailFailOnce:true,listForbidden:true},f=await fixture(options);try{const c=f.client(),i=input(),p=await c.preparePublication(i,new AbortController().signal),saved=retained(i,p,c),a=await c.invokePreparedPublication(p);assert.equal(a.outcome,'unknown');assert.equal(a.resource,null);assert.equal(a.creationHint.id,101);saved.creationHint=structuredClone(a.creationHint);const lookup=await f.client().reconcilePublication(saved,new AbortController().signal);assert.equal(lookup.outcome,'confirmed',JSON.stringify(lookup));assert.equal(lookup.resource.id,101);assert.equal(f.requests.filter(r=>r.path.includes('?')).length,0);assert.equal(f.posts.length,1);
 for(const bad of [{...a.creationHint,id:999},{...a.creationHint,nodeId:'wrong-node'},{...a.creationHint,url:'https://github.com/other/repo/issues/1'},{...a.creationHint,id:undefined}]){const invalid={...saved,creationHint:bad};assert.equal((await f.client().reconcilePublication(invalid,new AbortController().signal)).outcome,'unknown');assert.equal(f.requests.filter(r=>r.path.includes('?')).length,0);assert.equal(f.posts.length,1);}
 options.changedReadback=true;assert.equal((await f.client().reconcilePublication(saved,new AbortController().signal)).outcome,'unknown');assert.equal(f.posts.length,1);
 }finally{await f.close();}
});


test('observable same-path repository replacement never CONFIRMED on invoke or nohint/knownhint recovery',async()=>{
 for(const options of [{replaceRepoAfterPost:true},{drop:true,replaceRepoOnDetail:true},{detailFailOnce:true,replaceRepoOnDetail:true}]){const f=await fixture(options);try{const c=f.client(),i=input(),p=await c.preparePublication(i,new AbortController().signal),saved=retained(i,p,c),a=await c.invokePreparedPublication(p);assert.equal(a.outcome,'unknown');if(a.creationHint)saved.creationHint=a.creationHint;const lookup=await f.client().reconcilePublication(saved,new AbortController().signal);assert.equal(lookup.outcome,'unknown');assert.equal(f.posts.length,1);}finally{await f.close();}}
});
