import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile);
async function run(args){
 try{return{code:0,...await execute(process.execPath,['--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),...args],{timeout:30000})};}
 catch(e){if(typeof e.code==='number')return{code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}
}
test('the advertised actor-neutral local check really runs captured source and refuses writes without an agent transcript',{timeout:30000},async t=>{
 assert.ok(process.env.GITJIG_DOCKER_CONTEXT&&process.env.GITJIG_RUNTIME_IMAGE,'Explicit real execution profile required');
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/local-inspect-runtime-'))),home=path.join(root,'home'),source=path.join(root,'project');
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained local inspect runtime fixture: '+root);});
 await fs.mkdir(source);await fs.writeFile(path.join(source,'answer.txt'),'owner-source\n');
 assert.equal((await run(['project','register','--home',home,'--id','p','--root',source])).code,0);
 const runtime=['--docker-binary',process.env.GITJIG_DOCKER_BINARY??'/opt/homebrew/bin/docker','--docker-context',process.env.GITJIG_DOCKER_CONTEXT,'--image',process.env.GITJIG_RUNTIME_IMAGE];
 const inspect=['local','inspect','--home',home,'--project','p',...runtime],before=await run(inspect);assert.equal(before.code,0,before.stderr);assert.equal(JSON.parse(before.stdout).availableChecks[0].state,'requires-execution-preflight');
 const check=['local','check','--home',home,'--project','p',...runtime];
 const healthy=await run([...check,'--command','test "$(cat /work/answer.txt)" = owner-source && printf verified']);assert.equal(healthy.code,0,healthy.stderr);const actual=JSON.parse(healthy.stdout);assert.equal(actual.status,'succeeded');assert.equal(actual.stdout,'verified');assert.ok(actual.captureRef);assert.equal(actual.cleanup,'removed');
 const denied=await run([...check,'--command','printf changed > /work/answer.txt']);assert.equal(denied.code,1,denied.stderr);const rejected=JSON.parse(denied.stdout);assert.equal(rejected.status,'failed');assert.notEqual(rejected.exitCode,0);assert.match(rejected.stderr,/read-only|permission denied/i);assert.equal(rejected.cleanup,'removed');
 assert.equal(await fs.readFile(path.join(source,'answer.txt'),'utf8'),'owner-source\n');
 const after=await run(inspect);assert.equal(after.code,0,after.stderr);assert.equal(JSON.parse(after.stdout).enforcement.currentVerification,'not-observed-by-inspection','Historical command success is not a new enforcement certificate');
 const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM role_launches').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requirements WHERE json_extract(interpretation,\'$.status\')!=\'not-applicable-local-command\'').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM results').get().n,2);}finally{db.close();}
 passed=true;
});
