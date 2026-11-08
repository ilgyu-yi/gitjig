import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {caseNames} from './ordinary-admission-recovery-worker.mjs';
const execute=promisify(execFile);
// Pi intentionally pins its owned helper root per process. Each independent
// home therefore uses a fresh process; this is not a retry or deadline extension.
for(const name of caseNames)test(name,{timeout:10000},async()=>{
 const env={...process.env,GITJIG_ORDINARY_RECOVERY_CASE:name};delete env.NODE_TEST_CONTEXT;
 const result=await execute(process.execPath,['--test','--test-reporter=tap','tests/controller/ordinary-admission-recovery-worker.mjs'],{env,timeout:9000,maxBuffer:1048576}).catch(error=>{throw new Error(error.stdout+'\n'+error.stderr,{cause:error});});
 assert.match(result.stdout,/^# tests 1$/m);assert.match(result.stdout,/^# pass 1$/m);assert.match(result.stdout,/^# skipped 0$/m);
});
