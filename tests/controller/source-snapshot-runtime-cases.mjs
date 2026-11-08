import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const execute=promisify(execFile);

// Pi's artifact root is fixed per process. Each genuine app has its own
// process; never reset the production singleton or suppress an actual case.
export function registerSourceRuntimeCases(cases,scope){for(const name of cases)test(scope+': '+name,{timeout:120000},async t=>{
 const parent=process.env.GITJIG_RUNTIME_FIXTURE_ROOT;if(!parent)throw Error('Explicit private runtime fixture root required');
 const root=await fs.mkdtemp(path.join(parent,'case-'+name+'-'));await fs.chmod(root,0o700);
 const argv=['--import','./tests/normal-hosted/no-external.mjs','--test','--test-reporter=tap','--test-concurrency=1','tests/controller/source-snapshot-proposals-runtime-worker.mjs'];
 const env={...process.env,GITJIG_RUNTIME_FIXTURE_ROOT:root,GITJIG_SOURCE_OWNER_RUNTIME_CASE:name};
 delete env.NODE_TEST_CONTEXT;
 const start=performance.now();let output;
 try{output=await execute(process.execPath,argv,{env,timeout:110000,killSignal:'SIGINT',maxBuffer:2*1024*1024});}
 catch(error){await fs.writeFile(path.join(root,'worker.log'),String(error.stdout??'')+String(error.stderr??''),{flag:'wx',mode:0o600});throw Error('Original isolated runtime '+name+' retained at '+root+'; '+String(error.stdout??'')+' '+String(error.stderr??''),{cause:error});}
 const log=output.stdout+output.stderr;await fs.writeFile(path.join(root,'worker.log'),log,{flag:'wx',mode:0o600});
 assert.match(log,/(?:#|ℹ) tests 1(?:\r?\n|$)/);assert.match(log,/(?:#|ℹ) pass 1(?:\r?\n|$)/);assert.match(log,/(?:#|ℹ) fail 0(?:\r?\n|$)/);assert.match(log,/(?:#|ℹ) skipped 0(?:\r?\n|$)/);
 const receipt={case:name,argv,fixtureParent:root,elapsedMs:performance.now()-start,logSha256:createHash('sha256').update(log).digest('hex'),scope:scope+'; one isolated original, scripted Pi judgments and real Docker/Git, no standing seed or paid provider'};
 await fs.writeFile(path.join(root,'worker-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});t.diagnostic(JSON.stringify(receipt));t.diagnostic(log);
});}
