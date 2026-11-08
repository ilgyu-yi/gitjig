import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedHostedIntegrationFixture,configureOwnedNormalHostedIntegrationFixture} from '../../.qualification/controller-testing.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
import {fixture,policyFixture,overrideSet} from './hosted-integration-fixture.mjs';
const runtimeProfile={dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,...(process.env.GITJIG_DOCKER_CONFIG_DIRECTORY?{dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY}:{}),image:process.env.GITJIG_RUNTIME_IMAGE};
export const initial='// User local choice: 10\n'+Array.from({length:8},(_,i)=>'// Context '+i+'\n').join('')+'module.exports=2;\n';
const checker=withValueCases(`console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n`);
export async function subject(options={}){
 const native=await fixture({files:{'consumer.cjs':initial,'check.cjs':checker},...(options.native??{})}), rest=await policyFixture(native,options),source=path.join(native.root,'source'),home=path.join(native.root,'home');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),initial.replace('choice: 10','choice: 11'));await fs.writeFile(path.join(source,'check.cjs'),checker);
 const c=await openController({installationHome:home,runtimeProfile,effectsProfile:{gitBinary:'/opt/homebrew/bin/git'}});process.env.TMPDIR=path.join(home,'artifacts');await c.registerProject({id:'P',sourceRoot:source});
 const configure=()=> (options.normalNative?configureOwnedNormalHostedIntegrationFixture:configureOwnedHostedIntegrationFixture)(c,{origin:rest.origin,token:native.token,https:{origin:native.origin,caFile:native.ca,execPath:native.execPath},fixtureProfile:'owned-disposable-complete-policy/v1'});
 const registration={projectId:'P',repository:{owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9',visibility:'public'},expectedUserId:7,ref:'refs/heads/main',basisCommit:native.B,publicationInventory:['consumer.cjs','check.cjs'],authorizedDeltaPaths:['consumer.cjs']};
 const model=scripted();let passed=false;
 return{c,native,rest,source,model,configure,registration,async begin(){const w=await c.beginChange({projectId:'P',request:'Export3; publish only agent delta and keep user local edit local',executionLimit:80,resolutionLimit:24});const ready=await c.driveChange({workId:w.workId,model});assert.equal(ready.reviewReady,true,JSON.stringify(ready.blocked));return{...w,ready};},pass(){passed=true;},async close(){await c.close();await rest.close();await native.close();if(passed&&!options.retainSuccess)await fs.rm(native.root,{recursive:true,force:true});else console.error('Retained hosted bridge fixture: '+native.root);}};
}
