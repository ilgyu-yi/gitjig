import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readConfigurationProfile} from '../../dist/cli/configuration-profile.js';
const execute=promisify(execFile);
test('public SDK-free recommendation is a reusable editable owner profile without home/credentials/native writes',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig editable profile '))),cli=path.resolve('dist/cli/main.js'),tripwire=path.resolve('tests/cli/no-sdk-loader.mjs');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const run=(...args)=>execute(process.execPath,['--import',tripwire,cli,'repo','recommend',...args],{cwd:root,timeout:5000});
 const output=await run('--branch','release/한글'),profile=JSON.parse(output.stdout);assert.deepEqual(await fs.readdir(root),[]);assert.deepEqual(profile.ruleset.include,['refs/heads/release/한글']);assert.equal(profile.ruleset.pullRequest.approvingCount,1);assert.deepEqual(profile.ruleset.bypassUsers,[]);assert.equal(profile.ruleset.statusChecks,undefined);assert.equal(profile.mergeMethods,undefined);
 // Customize the recommendation through the same private ingress used by real preview/apply.
 profile.ruleset.pullRequest.approvingCount=0;profile.ruleset.pullRequest.lastPushApproval=false;profile.ruleset.bypassUsers=[{userId:7,mode:'always'}];profile.ruleset.statusChecks={contexts:[{context:'actual-owner-check',integrationId:11}],strict:true};profile.mergeMethods={squash:true};
 const file=path.join(root,'owner-profile.json');await fs.writeFile(file,JSON.stringify(profile),{mode:0o600});assert.deepEqual(await readConfigurationProfile(file,[]),profile);
 for(const branch of ['*','main/*','../main','.hidden','a.lock','@','a//b','main\nother'])await assert.rejects(run('--branch',branch),e=>e.code===2);
 await assert.rejects(run('--branch','main','--home',path.join(root,'forbidden')),e=>e.code===2);await assert.rejects(fs.access(path.join(root,'forbidden')),{code:'ENOENT'});
});
