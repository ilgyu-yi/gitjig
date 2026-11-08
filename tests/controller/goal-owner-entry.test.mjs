import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {caseNames} from './goal-owner-entry-worker.mjs';
const execute=promisify(execFile);
for(const name of caseNames)test(name,{timeout:30000},async()=>{
    const env={...process.env,GITJIG_GOAL_OWNER_CASE:name};delete env.NODE_TEST_CONTEXT;
    const result=await execute(process.execPath,['--test','--test-reporter=tap','tests/controller/goal-owner-entry-worker.mjs'],{env,timeout:28000,maxBuffer:1048576}).catch(error=>{throw new Error(error.stdout+'\n'+error.stderr,{cause:error});});
    assert.match(result.stdout,/^# tests 1$/m);assert.match(result.stdout,/^# pass 1$/m);assert.match(result.stdout,/^# skipped 0$/m);
});
