/** Each original engine journey owns a fresh Pi process and artifact-root singleton. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {caseNames} from './mixed-verification-runtime-worker.mjs';
const execute=promisify(execFile);
for(const name of caseNames)test(name,{timeout:130000},async t=>{
 const env={...process.env,GITJIG_MIXED_RUNTIME_CASE:name};delete env.NODE_TEST_CONTEXT;
 const result=await execute(process.execPath,['--test','--test-reporter=tap','tests/workflow/mixed-verification-runtime-worker.mjs'],{env,timeout:125000,maxBuffer:4*1048576}).catch(error=>{throw Error(error.stdout+'\n'+error.stderr,{cause:error});});
 assert.match(result.stdout,/^# tests 1$/m);assert.match(result.stdout,/^# pass 1$/m);assert.match(result.stdout,/^# fail 0$/m);assert.match(result.stdout,/^# skipped 0$/m);assert.match(result.stdout,/^# cancelled 0$/m);t.diagnostic(result.stdout);
});
