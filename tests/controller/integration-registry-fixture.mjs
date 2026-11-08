import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
export const snapshot=c=>JSON.stringify(c.store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,c.store.all('SELECT * FROM "'+name+'" ORDER BY rowid')]));
export async function integrationWorld(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-integration-registry-'))),home=path.join(root,'home'),source=path.join(root,'source'),receiver=path.join(root,'receiver.git');await fs.mkdir(source);await fs.writeFile(path.join(source,'file.txt'),'Original source');
 const git=await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY??'/opt/homebrew/bin/git'),env={PATH:'/usr/bin:/bin',HOME:root,LANG:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'f@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'f@example.invalid'};
 await execute(git,['init','--initial-branch=main',source],{env});await execute(git,['-C',source,'add','file.txt'],{env});await execute(git,['-C',source,'-c','commit.gpgsign=false','commit','-m','Original basis'],{env});const basis=(await execute(git,['-C',source,'rev-parse','HEAD'],{env})).stdout.trim();await execute(git,['clone','--bare','--template=',source,receiver],{env});await execute(git,['--git-dir='+receiver,'config','--remove-section','remote.origin'],{env});
 let passed=false;const c=await openController({installationHome:home,effectsProfile:{gitBinary:git}});t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained integration fixture: '+root);});await c.registerProject({id:'P',sourceRoot:source});const target=(await c.registerLocalTarget({projectId:'P',path:receiver,ref:'refs/heads/main',basisCommit:basis,publicationInventory:['file.txt'],authorizedDeltaPaths:['file.txt']})).targetId;
 const prepare=async()=>{const work=await c.beginChange({projectId:'P',request:'Retained discovery fixture; no review-ready or landing claim'});c.delegateIntegration({workId:work.workId,targetId:target,mode:'ordinary',operationLimit:8});
 // Native registration/grant/allocation are real. Candidate/procedure evidence is
 // deliberately synthetic: these consumers qualify historical reads, not landing.
 const evidence={workId:work.workId,epoch:1,generation:1,versions:{base:'synthetic-base',candidate:'synthetic-candidate',plan:'synthetic-plan',verification:'synthetic-check',requirements:null,contracts:'synthetic-contracts'},candidateDigest:'synthetic',sourceChainDigest:'synthetic',selectionDigest:'synthetic',checkIds:[],reviewLaunchIds:[],dispositionDigest:'synthetic',carryDigest:null,fingerprint:'synthetic'};
 const operationId=c.effects.allocate(work.workId,target,evidence);return {operationId,workId:work.workId,targetId:target};};
 return {c,root,home,source,receiver,target,basis,git,env,prepare,pass(){passed=true;}};
}
