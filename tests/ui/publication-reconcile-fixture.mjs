import fs from 'node:fs/promises';
import path from 'node:path';
import {shared,target} from '../contributions/publication-fixture.mjs';
import {configureOwnedPublicationFixture} from '../../.qualification/controller-testing.js';
export async function reconciliationFixture(t){
    const f=await shared();let passed=false;const releases=[];t.after(async()=>{for(const release of releases)release();await f.close({preserve:!passed});});
    const targetId=f.c.registerPublicationTarget({target,visibility:'public'}).targetId;
    const op=await f.c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body:'Exact original comment; no reviewed completion'}});
    const held=f.holdDrop(),sending=f.c.dispatchPublication({operationId:op.operationId});await held.entered;held.release();const uncertain=await sending;if(uncertain.phase!=='UNKNOWN')throw Error('Owned dropped response did not retain uncertainty');
    const source=f.c.createConversation().conversationId,credential=path.join(f.root,'credential');await fs.writeFile(credential,'{"token":"fixture-original"}',{mode:0o600});
    f.c.configurePublicationCredential=options=>configureOwnedPublicationFixture(f.c,{...options,origin:f.origin});
    const listener=f.server.listeners('request')[0];f.server.removeListener('request',listener);let wait,onRead;
    f.server.on('request',async(req,res)=>{if(req.url.startsWith('/repos/owner/repo/issues/8/comments?')){onRead?.();if(wait)await Promise.race([wait,new Promise(resolve=>res.once('close',resolve))]);}return listener(req,res);});
    return {...f,op:uncertain,source,credential,pass(){passed=true;},onRead(callback){onRead=callback;},holdRead(){let enter,release;const entered=new Promise(resolve=>enter=resolve);wait=new Promise(resolve=>release=resolve);onRead=enter;releases.push(release);return {entered,release};}};
}
