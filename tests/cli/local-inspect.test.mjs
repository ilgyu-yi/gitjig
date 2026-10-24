import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile);
async function run(args){
 try{return{code:0,...await execute(process.execPath,['--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),...args],{timeout:10000})};}
 catch(e){if(typeof e.code==='number')return{code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}
}
test('public local inspection discovers registered rules without code/engine/SDK or work; configuration never becomes verification',async t=>{
 await fs.mkdir('.runtime-fixtures',{recursive:true});
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/local inspect-'))),home=path.join(root,'home'),source=path.join(root,'project'),marker=path.join(root,'executed');
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained local inspect fixture: '+root);});
 await fs.mkdir(source);await fs.writeFile(path.join(source,'owner.txt'),'한국어 $() original\n');
 await fs.mkdir(path.join(source,'.pi/extensions'),{recursive:true});await fs.writeFile(path.join(source,'.pi/extensions/canary.mjs'),'import fs from "node:fs";fs.writeFileSync('+JSON.stringify(marker)+',"project code executed");');
 const absentHome=path.join(root,'must-not-allocate');
 for(const args of [['local','inspect','--home',absentHome],['local','inspect','--home',absentHome,'--project','p','--actor','human'],['local','inspect','--home',absentHome,'--project','p','--docker-context','missing']])assert.equal((await run(args)).code,2);
 await assert.rejects(fs.access(absentHome),{code:'ENOENT'});
 const registered=await run(['project','register','--home',home,'--id','p','--root',source]);assert.equal(registered.code,0,registered.stderr);
 const entry=['local','inspect','--home',home,'--project','p'];
 const first=await run(entry);assert.equal(first.code,0,first.stderr);const view=JSON.parse(first.stdout);
 assert.equal(view.source.state,'matches-registration');assert.equal(view.sourceRoot,source);
 assert.ok(view.discoveredRules.some(r=>r.kind==='registered-capture-profile'&&r.values.maxBytes>0));
 assert.ok(view.discoveredRules.some(r=>r.kind==='product-workflow-criteria'&&Object.keys(r.assets).length===4));
 assert.equal(view.availableChecks[0].entry,'local check');assert.equal(view.availableChecks[0].state,'runtime-configuration-required');
 assert.equal(view.enforcement.currentVerification,'not-observed-by-inspection');assert.equal(view.enforcement.configuredRuntime,null);
 assert.equal(view.enforcement.protectedSubpaths.configuration,'registered-project-policy');assert.equal(view.enforcement.protectedSubpaths.configured,false);assert.equal(view.enforcement.protectedSubpaths.revision,0);assert.deepEqual(view.enforcement.protectedSubpaths.boundRuns,[]);assert.equal(view.enforcement.protectedSubpaths.verified,false);
 const binary=path.join(root,'must not execute');await fs.writeFile(binary,"#!/bin/sh\n: > '"+marker.replaceAll("'","'\\''")+"'\nexit 79\n",{mode:0o700});
 const configured=await run([...entry,'--docker-binary',binary,'--docker-context','not-probed','--image','sha256:'+'0'.repeat(64)]);assert.equal(configured.code,0,configured.stderr);
 const selected=JSON.parse(configured.stdout);assert.equal(selected.enforcement.configuredRuntime.dockerBinary,binary);assert.equal(selected.enforcement.currentVerification,'not-observed-by-inspection');assert.equal(selected.availableChecks[0].state,'requires-execution-preflight');
 await assert.rejects(fs.access(marker),{code:'ENOENT'});
 const moved=path.join(root,'moved-project');await fs.rename(source,moved);await fs.symlink(moved,source,'dir');
 const replaced=await run(entry);assert.equal(replaced.code,0,replaced.stderr);assert.equal(JSON.parse(replaced.stdout).source.state,'unavailable');assert.equal(JSON.parse(replaced.stdout).availableChecks[0].state,'source-unavailable');
 await fs.unlink(source);await fs.rename(moved,source);await fs.rename(source,moved);
 const missing=await run(entry);assert.equal(missing.code,0,missing.stderr);assert.equal(JSON.parse(missing.stdout).source.state,'unavailable');
 await fs.rename(moved,source);
 const unknown=await run(['local','inspect','--home',home,'--project','unknown']);assert.equal(unknown.code,2);assert.equal(JSON.parse(unknown.stderr.split('\n').find(line=>line.startsWith('{'))).error,'MISSING_PROJECT');
 const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});
 try{for(const table of ['works','sources','runs','role_launches','check_runs','effect_operations'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);}
 finally{db.close();}
 assert.equal(await fs.readFile(path.join(source,'owner.txt'),'utf8'),'한국어 $() original\n');passed=true;
});
