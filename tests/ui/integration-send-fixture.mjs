import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {integrationWorld} from '../controller/integration-registry-fixture.mjs';
import {execute} from './integration-read-fixture.mjs';
export async function integrationSendWorld(t,{gate=true,binary}={}){
 const f=await integrationWorld(t),op=await f.prepare(),clientRoot=path.join(f.home,'effects',op.operationId,'client');if(typeof binary==='function')binary=await binary(f,op);if(binary)f.c.effects.h.options.effectsProfile={gitBinary:binary};const client=await f.c.effects.client(clientRoot),target=JSON.parse(f.c.store.one('SELECT data FROM effect_targets WHERE id=?',op.targetId).data).target;await client.fetchLocalBasis(target,f.basis);await client.close();
 const command=(args)=>execute(f.git,['--git-dir='+path.join(clientRoot,'client.git'),...args],{env:f.env,timeout:4000}),tree=(await command(['rev-parse',f.basis+'^{tree}'])).stdout.trim(),integration=(await command(['commit-tree',tree,'-p',f.basis,'-m','Owned Gitjig integration\nOperation: '+op.operationId])).stdout.trim();f.c.store.run("UPDATE effect_operations SET phase='RESERVED',data=json_set(data,'$.expectedBase',?,'$.headCommit',?,'$.integrationCommit',?,'$.clientRoot',?,'$.clientInitialized',json('true')) WHERE id=?",f.basis,integration,integration,clientRoot,op.operationId);
 // Synthetic procedure checkpoint only. The ordinary unmodified gate is separately
 // required to refuse this fixture. Native client, conditional send and readback are real.
 const evidence=JSON.parse(f.c.store.one('SELECT data FROM effect_operations WHERE id=?',op.operationId).data).evidence,originalGate=f.c.changeCore.assertCurrentEvidence.bind(f.c.changeCore);if(gate)f.c.changeCore.assertCurrentEvidence=value=>assert.deepEqual(value,evidence,'Synthetic exact checkpoint differs');
 const conversation=f.c.createConversation().conversationId;return {...f,op,clientRoot,integration,evidence,conversation,originalGate,head:async()=>(await execute(f.git,['--git-dir='+f.receiver,'rev-parse','refs/heads/main'],{env:f.env})).stdout.trim()};
}
export const sendChoices=['Retained integrations','local-git','Review and send original prepared integration','Send this original prepared integration','Back','Close'];
export async function holdPreflight(f,act){const client=f.c.effects.client.bind(f.c.effects);f.c.effects.client=async(...args)=>{const native=await client(...args),prepare=native.prepareForwardSend.bind(native);native.prepareForwardSend=async(...input)=>{const result=await prepare(...input);await act();return result;};return native;};}
export async function waitFile(file){for(let i=0;i<500;i++){try{return await fs.readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Owned native marker unavailable: '+file);}
