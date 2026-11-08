import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
for(const mode of ['transient','clock','persistent'])test('original owned supervisor bounded probe under '+mode+' observation fault',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-supervisor-probe-'))),log=path.join(root,'events.jsonl');await fs.writeFile(log,'',{mode:0o600});
 const preload=path.resolve('tests/effects/git-process-child-probe-preload.mjs'),env={...process.env,NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${preload}`].filter(Boolean).join(' '),GITJIG_OWNED_PROBE_MODE:mode,GITJIG_OWNED_PROBE_LOG:log};delete env.NODE_TEST_CONTEXT;
 let exit=0,output='';try{const result=await exec(process.execPath,['--test','--test-concurrency=1','tests/effects/git-process-child.test.mjs'],{env,timeout:12000,maxBuffer:1024*1024});output=result.stdout+result.stderr;}catch(error){if(typeof error.code!=='number')throw error;exit=error.code;output=error.stdout+error.stderr;}
 await fs.writeFile(path.join(root,'original.log'),output,{mode:0o600});const events=(await fs.readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),results=events.filter(e=>e.stage==='result');
 assert.equal(results.length,2,'both unchanged original fixture consumers must settle');assert.equal(events.filter(e=>e.stage==='admitted').length,2);
 for(const row of results){assert.equal(row.outcome.cleanup,mode==='persistent'?'unknown':'confirmed');assert.equal(row.outcome.timedOut,false);assert.equal(row.outcome.aborted,false);}
 if(mode==='persistent'){for(const row of results){assert.ok(['probe-unavailable','group-present'].includes(row.outcome.cleanupObservation?.reason));assert.equal(row.outcome.cleanupObservation.lastErrorCode,'EPERM');assert.ok(Number.isFinite(row.outcome.cleanupObservation.elapsedMs)&&row.outcome.cleanupObservation.elapsedMs>=0&&row.outcome.cleanupObservation.elapsedMs<3000);}assert.notEqual(exit,0,'original confirmed-only oracle must reject persistent uncertainty');assert.ok(events.some(e=>e.stage==='injected-error'));}else assert.equal(exit,0,output);
 if(mode==='transient'){assert.ok(events.filter(e=>e.stage==='injected-error').length>=1);for(const directory of new Set(events.filter(e=>e.stage==='injected-error').map(e=>e.directory))){const row=results.find(e=>e.directory===directory);assert.equal(row.outcome.cleanupObservation?.reason,'group-absent');assert.equal(row.outcome.cleanupObservation.lastErrorCode,'EPERM');}}
 if(mode==='clock')assert.ok(events.some(e=>e.stage==='injected-forward-wall-jump'));
 for(const row of results)assert.throws(()=>process.kill(-row.outcome.gitPid,0),{code:'ESRCH'});
 t.diagnostic(JSON.stringify({probeRoot:root,mode,originalExit:exit,results:results.map(e=>({directory:e.directory,outcome:e.outcome}))}));
});
