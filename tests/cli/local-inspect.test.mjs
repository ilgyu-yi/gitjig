import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
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
 const root=await temporaryDirectory('local-inspect'),home=path.join(root,'home with spaces'),source=path.join(root,'project with spaces'),marker=path.join(root,'executed marker');
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

test('local rule and protection reads separate optional runtime failure from common ownership and explicit operands',async t=>{
 const root=await temporaryDirectory('local-inspect-startup'),home=path.join(root,'home'),source=path.join(root,'project'),config=path.join(home,'config'),startup=path.join(config,'startup.json');
 let passed=false;t.after(async()=>{await fs.chmod(home,0o700).catch(()=>{});if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained local startup fixture: '+root);});
 await fs.mkdir(source);await fs.writeFile(path.join(source,'owner.txt'),'Original project evidence\n');
 assert.equal((await run(['project','register','--home',home,'--id','p','--root',source])).code,0);
 await fs.mkdir(config,{mode:0o700,recursive:true});
 const guard=path.join(root,'inspection-guard.mjs');
 await fs.writeFile(guard,`import cp from 'node:child_process';import net from 'node:net';import {registerHooks,syncBuiltinESMExports} from 'node:module';let denied=0;const no=reason=>{denied++;throw Error('UNEXPECTED_INSPECTION_ACTION:'+reason)};for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[method]=()=>no(method);net.Socket.prototype.connect=()=>no('socket');globalThis.fetch=()=>no('fetch');syncBuiltinESMExports();registerHooks({resolve(s,c,next){if(s.startsWith('@earendil-works/')||s==='@gitjig/pi-claude-bridge-host')return no('SDK/bridge');return next(s,c)}});process.on('exit',()=>{if(denied)process.exitCode=1});`,{mode:0o600});
 const read=async(args)=>{try{return {code:0,...await execute(process.execPath,['--import',guard,path.resolve('dist/cli/main.js'),...args],{timeout:10000})}}catch(error){if(typeof error.code==='number')return {code:error.code,stdout:error.stdout,stderr:error.stderr};throw error}};
 const entry=['local','inspect','--home',home,'--project','p'];
 const ledger=()=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]))}finally{db.close()}};
 const journal=path.join(home,'state/runtime','opaque-retained-recovery.json'),journalBytes=Buffer.from('Opaque retained recovery evidence; this read must not interpret or rewrite it.\n');
 await fs.writeFile(journal,journalBytes,{mode:0o600});
 const before=ledger(),runtimeBefore=await fs.readdir(path.join(home,'state/runtime'));
 const binary=path.join(root,'unexecuted-docker');await fs.writeFile(binary,'#!/bin/sh\nexit 79\n',{mode:0o700});
 const runtime={dockerBinary:binary,dockerContext:'selected-only',image:'sha256:'+'a'.repeat(64)};
 const supplied=['--docker-binary',binary,'--docker-context','invocation-only','--image',runtime.image];
 const inspect=async(expected,extra=[])=>{
  const original=await fs.readFile(startup).catch(error=>{if(error.code==='ENOENT')return null;throw error});
  const result=await read([...entry,...extra]);assert.equal(result.code,0,result.stderr);const value=JSON.parse(result.stdout);
  assert.equal(value.enforcement.runtimeConfiguration.state,expected);
  assert.equal(value.enforcement.currentVerification,'not-observed-by-inspection');assert.ok(value.discoveredRules.length);
  assert.deepEqual(await fs.readFile(startup).catch(error=>{if(error.code==='ENOENT')return null;throw error}),original);
  assert.deepEqual(ledger(),before);assert.deepEqual(await fs.readdir(path.join(home,'state/runtime')),runtimeBefore);assert.deepEqual(await fs.readFile(journal),journalBytes);
  return value;
 };
 const absent=await inspect('unconfigured');assert.equal(absent.enforcement.runtimeConfiguration.source,'none');assert.equal(absent.availableChecks[0].state,'runtime-configuration-required');
 const save=async value=>{await fs.writeFile(startup,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});await fs.chmod(startup,0o600)};
 for(const bridge of [undefined,'malformed unrelated bridge',{profile:{kind:'native',cwd:'/missing-private-profile'},nativeAccountDirectory:'/missing-account'}]){
  await save({version:1,runtime,...(bridge===undefined?{}:{bridge})});const configured=await inspect('configured');
  assert.equal(configured.enforcement.runtimeConfiguration.source,'saved');assert.deepEqual(configured.enforcement.configuredRuntime,runtime);assert.equal(configured.availableChecks[0].state,'requires-execution-preflight');
 }
 for(const bad of ['{"version":1,',JSON.stringify({version:2,runtime}),JSON.stringify({version:1,runtime:{...runtime,image:'mutable:latest'}}),'{"version":1,"version":1}']){
  await save(bad);const unavailable=await inspect('unavailable');assert.equal(unavailable.enforcement.configuredRuntime,null);assert.equal(unavailable.availableChecks[0].state,'runtime-configuration-unavailable');assert.match(unavailable.nextAction,/setup inspect/);
  const overridden=await inspect('configured',supplied);assert.equal(overridden.enforcement.runtimeConfiguration.source,'invocation');assert.equal(overridden.enforcement.configuredRuntime.dockerContext,'invocation-only');
  const protection=await read(['local','protection','--home',home,'--project','p']);assert.equal(protection.code,0,protection.stderr);assert.equal(JSON.parse(protection.stdout).configured,false);
 }
 await save({version:1,runtime});await fs.chmod(startup,0o644);await inspect('unavailable');
 await save('{"version":1,');
 const unknown=await read(['local','inspect','--home',home,'--project','missing']);assert.equal(unknown.code,2);assert.match(unknown.stderr,/MISSING_PROJECT/);
 const invalidExplicit=await read([...entry,'--docker-binary',path.join(root,'missing-docker'),'--docker-context','explicit','--image',runtime.image]);assert.equal(invalidExplicit.code,2);
 const partial=await read([...entry,'--docker-context','partial']);assert.equal(partial.code,2);assert.match(partial.stderr,/USAGE/);
 // A write keeps its original startup/admission path, even though adjacent reads are independent.
 const policy=path.join(root,'protection.json');await fs.writeFile(policy,JSON.stringify({protectedPaths:['owner.txt']}),{mode:0o600});
 const write=await read(['local','protect','--home',home,'--project','p','--revision','0','--policy-profile',policy]);assert.equal(write.code,2);assert.match(write.stderr,/startup setup requires repair/);
 await fs.chmod(home,0o777);const unsafe=await read(entry);assert.equal(unsafe.code,2);await fs.chmod(home,0o700);
 assert.deepEqual(ledger(),before);assert.deepEqual(await fs.readdir(path.join(home,'state/runtime')),runtimeBefore);assert.deepEqual(await fs.readFile(journal),journalBytes);assert.equal(await fs.readFile(path.join(source,'owner.txt'),'utf8'),'Original project evidence\n');passed=true;
});
