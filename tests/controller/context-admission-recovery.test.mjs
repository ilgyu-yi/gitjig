import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';

for (const scenario of ['original','missing-history','final-abort','direction-drift','metadata-adverse','concurrent','ui','close-during-read','root-cancel-during-read']) test('actual original context admission recovery: '+scenario,{timeout:25000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/context-recovery-'))),home=path.join(root,'app');
    await fs.mkdir(path.join(root,'user'),{mode:0o700});
    const c=await openController({installationHome:home});await c.close();let passed=false;
    t.after(async()=>{if(passed&&!process.env.GITJIG_CONTEXT_RECOVERY_KEEP)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained actual context recovery world '+root);});
    const {stdout}=await promisify(execFile)(process.execPath,['--import','./tests/cli/account-ui-no-network.mjs','tests/controller/context-producer-handoff-worker.mjs',root],{
        timeout:22000,maxBuffer:1024*1024,env:{HOME:path.join(root,'user'),TMPDIR:path.join(home,'artifacts'),PATH:path.dirname(process.execPath),LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_CONTEXT_RECOVERY_CASE:scenario},
    });
    const result=JSON.parse(stdout);assert.equal(result.outcome,'passed');assert.equal(result.syntheticRequests,scenario==='close-during-read'?4:5);assert.equal(result.socketAttempts,0);
    const receipt=JSON.parse(await fs.readFile(result.evidence,'utf8'));assert.equal(receipt.contextRecovery.case,scenario);assert.equal(receipt.contextRecovery.originPreserved,true);assert.equal(receipt.contextRecovery.oldDescendantHeld,true);assert.equal(receipt.contextRecovery.actualSeparateContinuation,scenario!=='close-during-read');if(scenario==='close-during-read')assert.equal(receipt.contextRecovery.closeJoinedOwnedRead,true);passed=true;
});
