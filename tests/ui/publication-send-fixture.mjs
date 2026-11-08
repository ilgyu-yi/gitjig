import fs from 'node:fs/promises';
import path from 'node:path';
import {shared,target} from '../contributions/publication-fixture.mjs';
import {configureOwnedPublicationFixture} from '../../.qualification/controller-testing.js';
export async function preparedPublicationFixture(t,body='Exact owner-approved bootstrap comment; not software completion'){
 const f=await shared();let passed=false;const releases=[];t.after(async()=>{for(const release of releases)release();await f.close({preserve:!passed});});
 const targetId=f.c.registerPublicationTarget({target,visibility:'public'}).targetId;
 const op=await f.c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body}});
 if(op.phase!=='RESERVED')throw Error('Original owner preparation unavailable');
 const source=f.c.createConversation().conversationId,credential=path.join(f.root,'credential');await fs.writeFile(credential,'{"token":"fixture-original"}',{mode:0o600});
 f.c.configurePublicationCredential=options=>configureOwnedPublicationFixture(f.c,{...options,origin:f.origin});
 const listener=f.server.listeners('request')[0];f.server.removeListener('request',listener);let gate,onPost;const requests=[];
 f.server.on('request',async(req,res)=>{requests.push({method:req.method,path:req.url});if(req.url==='/repos/owner/repo'){res.setHeader('x-oauth-scopes','repo');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},private:false,visibility:'public',permissions:{admin:true},archived:false,disabled:false,has_issues:true,fork:false}));return;}if(req.url==='/user'&&gate){const current=gate;gate=null;current.enter();await Promise.race([current.wait,new Promise(resolve=>res.once('close',resolve))]);}if(req.method==='POST')onPost?.();return listener(req,res);});
 return {...f,requests,op,source,credential,pass(){passed=true;},onPost(callback){onPost=callback;},holdPreflight(){let enter,release;const entered=new Promise(resolve=>enter=resolve),wait=new Promise(resolve=>release=resolve);gate={enter,wait};releases.push(release);return {entered,release};}};
}
