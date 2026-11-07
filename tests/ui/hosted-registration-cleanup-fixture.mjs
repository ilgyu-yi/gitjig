import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import {integrationReadWorld} from './integration-read-fixture.mjs';
import {fixture,policyFixture} from '../controller/hosted-integration-fixture.mjs';
import {configureOwnedNormalHostedIntegrationFixture} from '../../.qualification/controller-testing.js';
export async function registrationWorld(t){
 const f=await integrationReadWorld(t),native=await fixture(),rest=await policyFixture(native);let passed=false;
 t.after(async()=>{await Promise.allSettled([rest.close(),native.close()]);if(passed)await fs.rm(native.root,{recursive:true,force:true});else t.diagnostic('Retained hosted cleanup native fixture '+native.root);});
 const configure=token=>configureOwnedNormalHostedIntegrationFixture(f.c,{token,origin:rest.origin,https:{origin:native.origin,caFile:native.ca,execPath:native.execPath}});configure(native.token);
 const request={projectId:'P',repository:{owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9',visibility:'public'},expectedUserId:7,ref:'refs/heads/main',basisCommit:native.B,publicationInventory:['file.txt'],authorizedDeltaPaths:['file.txt']};
 return {...f,native,rest,request,configure,pass(){passed=true;f.pass();}};
}
export function denyTerminal(root){
 const open=fsSync.openSync;
 fsSync.openSync=(file,...args)=>{if(String(file).startsWith(root+'/effects/registration-')&&String(file).endsWith('/terminal.json')){const error=Error('Owned fixture denies terminal cleanup observation');error.code='EPERM';throw error;}return open(file,...args);};
 return ()=>{fsSync.openSync=open;};
}
export const domain=c=>Object.fromEntries(['effect_targets','authority_observations','effect_delegations','effect_operations','works','budgets','runs','sources'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
export async function stickyGuards(f,error){
 const before=domain(f.c),native=f.native.requests.length,rest=f.rest.requests.length;
 const assert=(await import('node:assert/strict')).default;
 await assert.rejects(f.c.registerHostedIntegrationTarget(f.request),actual=>actual===error);
 await assert.rejects(f.c.registerLocalTarget({projectId:'P',path:f.receiver,ref:'refs/heads/main',basisCommit:f.basis,publicationInventory:['file.txt'],authorizedDeltaPaths:['file.txt']}),actual=>actual===error);
 assert.deepEqual(domain(f.c),before);assert.equal(f.native.requests.length,native);assert.equal(f.rest.requests.length,rest);
 assert.ok(f.c.listIntegrationTargets().targets.length>=1);
}
