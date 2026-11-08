import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {caseNames} from './consumed-wait-recovery-worker.mjs';
const execute=promisify(execFile);
// The public Pi host owns a process-local helper root; each independent home
// uses a separate process without reconfiguring that upstream lifetime.
for(const name of caseNames)test(name,{timeout:10000},async()=>{
 const env={...process.env,GITJIG_CONSUMED_WAIT_CASE:name};delete env.NODE_TEST_CONTEXT;
 const result=await execute(process.execPath,['--test','--test-reporter=tap','tests/controller/consumed-wait-recovery-worker.mjs'],{env,timeout:9000,maxBuffer:1048576}).catch(error=>{throw Error(error.stdout+'\n'+error.stderr,{cause:error});});
 assert.match(result.stdout,/^# tests 1$/m);assert.match(result.stdout,/^# pass 1$/m);assert.match(result.stdout,/^# skipped 0$/m);
});
