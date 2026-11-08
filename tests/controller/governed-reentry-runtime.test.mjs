/** Fresh processes preserve the Pi helper's process-fixed artifact-root boundary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),worker=fileURLToPath(new URL('./governed-reentry-runtime-worker.mjs',import.meta.url));
for(const scenario of ['owner','automatic'])test('public governed reentry: '+scenario,{timeout:120000},async()=>{
 const env={...process.env,GITJIG_REENTRY_CASE:scenario};delete env.NODE_TEST_CONTEXT;
 try{
  const result=await execute(process.execPath,['--test',worker],{env,maxBuffer:8*1024*1024});
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  assert.match(result.stdout,/pass 1\b/);assert.match(result.stdout,/fail 0\b/);
 }catch(error){if(error.stdout)process.stdout.write(error.stdout);if(error.stderr)process.stderr.write(error.stderr);throw error;}
});
