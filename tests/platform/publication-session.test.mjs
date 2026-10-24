import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createOwnedPublicationSession,openPublicationSession } from '../../dist/platform/github-publication-session.js';
import { sealPublicationPayload, validatePublicationTargetPolicy } from '../../dist/platform/github-publication.js';
const target={host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',actorUserId:7};
const input=()=>({operationId:'O-host-session',target:structuredClone(target),action:{kind:'create-issue',title:' 원래 제목 ',body:' literal {"path":"a b"} '},carrierPolicy:{version:'P1',allowedMentions:[],knownPrivateLiterals:['fixture-private-123'],maxTitleBytes:1024,maxBodyBytes:128*1024}});
const capability=()=>({expectedUserId:7,target:{owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9',visibility:'public'},action:'create-issue'});
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture({drop=false}={}){
 const requests=[],rows=[],sockets=new Set();let origin;
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const bytes=Buffer.concat(chunks);const auth=req.headers.authorization;requests.push({method:req.method,path:req.url,auth,bytes});const strong=auth==='Bearer fixture-original';res.setHeader('content-type','application/json');res.setHeader('x-oauth-scopes',strong?'repo':'');const send=(value,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
 if(req.method==='POST'){if(!strong){send({message:'fixture insufficient credential'},403);return;}const p=JSON.parse(bytes);const row={id:101,node_id:'I101',number:1,user:{id:7},title:p.title,body:p.body,url:'https://api.github.com/repos/owner/repo/issues/1',repository_url:'https://api.github.com/repos/owner/repo',html_url:'https://github.com/owner/repo/issues/1'};rows.push(row);if(drop){req.socket.destroy();return;}send(row,201);return;}
 if(req.url==='/user'){send({id:7,type:'User',login:'owner'});return;}
 if(req.url==='/repos/owner/repo'){send({id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},private:false,visibility:'public',permissions:{admin:true},archived:false,disabled:false,has_issues:true});return;}
 if(req.url==='/repos/owner/repo/issues/1'){send(rows[0]??{},rows.length?200:404);return;}
 if(req.url?.startsWith('/repos/owner/repo/issues?')){send(rows);return;}send({},404);
 });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 return {origin,requests,rows,async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}

test('pure final seal precedes approval/preflight and equals actual private native bytes; one captured credential feeds both consumers',async()=>{
 const f=await fixture();try{const options={origin:f.origin,token:'fixture-original',limits:{requestTimeoutMs:500}},session=createOwnedPublicationSession(options);options.token='fixture-mutated';options.limits.requestTimeoutMs=1;const i=input(),sealed=sealPublicationPayload(i);assert.equal(f.requests.length,0);assert.equal(hash(sealed.payloadUtf8),sealed.payloadHash);assert.equal(JSON.parse(Buffer.from(sealed.payloadUtf8)).body,i.action.body+'\n\n<!-- gitjig-operation: O-host-session -->');const approvedHash=sealed.payloadHash;sealed.payloadUtf8.fill(0);
 const observation=await session.observePublicationCapability(capability());assert.equal(observation.state,'matched');assert.equal(observation.activation,'disabled');assert.equal(session.activation,'owned-fixture-only');const p=await session.preparePublication(i,new AbortController().signal);assert.equal(p.payloadHash,approvedHash);const exported=session.inspectPreparedPayload(p);exported.jsonUtf8.fill(0);const result=await session.invokePreparedPublication(p);assert.equal(result.outcome,'confirmed');assert.equal(f.rows.length,1);assert.ok(f.requests.every(r=>r.auth==='Bearer fixture-original'));assert.equal(hash(f.requests.find(r=>r.method==='POST').bytes),approvedHash);assert.equal(Object.isFrozen(session),true);
 }finally{await f.close();}
});

test('same User with another credential is a distinct native session, never an accepted injected observation/handle',async()=>{
 const f=await fixture();try{const a=createOwnedPublicationSession({origin:f.origin,token:'fixture-original'}),b=createOwnedPublicationSession({origin:f.origin,token:'fixture-weak'});assert.notEqual(a.credentialSessionId,b.credentialSessionId);const strong=await a.observePublicationCapability(capability()),weak=await b.observePublicationCapability(capability());assert.equal(strong.observedUserId,weak.observedUserId);assert.equal(strong.state,'matched');assert.equal(weak.state,'denied');assert.notEqual(strong.credentialInstanceId,weak.credentialInstanceId);const p=await a.preparePublication(input(),new AbortController().signal);assert.throws(()=>b.invokePreparedPublication(p),/Foreign/);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
 }finally{await f.close();}
});

test('normal session has no enable switch; aborted prepare and foreign handles refuse without network',async()=>{
 const session=openPublicationSession({token:'literal-offline-only',limits:{requestTimeoutMs:1}});assert.equal(session.activation,'public-personal-owner/v1');assert.ok(Object.isFrozen(session));await assert.rejects(session.preparePublication(input(),AbortSignal.abort()),/unavailable|cancel|abort/i);assert.throws(()=>session.invokePreparedPublication({}),/Foreign/);assert.throws(()=>session.inspectPreparedPayload({}),/Foreign/);
 assert.throws(()=>createOwnedPublicationSession({origin:'https://api.github.com',token:'fixture-original'}),/loopback/);
 const i=input();i.action.body='fixture-private-123';assert.throws(()=>sealPublicationPayload(i),/private literal/);
});

test('fresh captured reader can reconcile an uncertain prior operation without creating another dispatch handle/send',async()=>{
 const f=await fixture({drop:true});try{const i=input(),a=createOwnedPublicationSession({origin:f.origin,token:'fixture-original'}),p=await a.preparePublication(i,new AbortController().signal),exported=a.inspectPreparedPayload(p),unknown=await a.invokePreparedPublication(p);assert.equal(unknown.outcome,'unknown');const fresh=createOwnedPublicationSession({origin:f.origin,token:'fixture-weak'});assert.notEqual(fresh.credentialSessionId,a.credentialSessionId);const observed=await fresh.reconcilePublication({input:i,payloadUtf8:exported.jsonUtf8,payloadHash:exported.sha256},new AbortController().signal);assert.equal(observed.outcome,'confirmed');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(f.rows.length,1);
 }finally{await f.close();}
});


test('registration validates target/policy without dummy action content; actual content remains bounded',()=>{
 const i=input();i.carrierPolicy.maxTitleBytes=1;i.carrierPolicy.knownPrivateLiterals=['Target validation'];
 assert.doesNotThrow(()=>validatePublicationTargetPolicy(i.target,i.carrierPolicy));
 i.action.title='A';assert.equal(JSON.parse(Buffer.from(sealPublicationPayload(i).payloadUtf8)).title,'A');
 i.action.title='AB';assert.throws(()=>sealPublicationPayload(i),/bounds/);
 i.action.title='A';i.action.body='Target validation';assert.throws(()=>sealPublicationPayload(i),/private literal/);
 assert.throws(()=>validatePublicationTargetPolicy({...i.target,repository:'..'},i.carrierPolicy),/segment/);
 assert.throws(()=>validatePublicationTargetPolicy(i.target,{...i.carrierPolicy,maxTitleBytes:0}),/limits/);
});
