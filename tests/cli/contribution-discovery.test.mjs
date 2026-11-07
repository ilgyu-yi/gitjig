import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {fixture,resource,repository} from '../contributions/fixture.mjs';
const execute=promisify(execFile);
function snapshot(file,omit=[]){const db=new DatabaseSync(file,{readOnly:true});try{return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(({name})=>!omit.includes(name)).map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));}finally{db.close();}}
test('original CLI discovers/inspects retained resources with broken startup and pending recovery; explicit summary changes only summary tables',{timeout:15000},async t=>{
 const f=await fixture();t.after(()=>f.close());f.merged.add(1);const pr=await f.c.trackRepositoryResource(resource(1)),issue=await f.c.trackRepositoryResource({repository,kind:'issue',number:8}),home=path.join(f.root,'home'),file=path.join(home,'state/controller.sqlite');await f.c.close();
 // Crash-shaped pending producer is synthetic. Management reads must not recover it.
 const db=new DatabaseSync(file);try{db.prepare('INSERT INTO sources VALUES(?,?,?,?)').run('crash-source',null,'{"kind":"owned-crash-fixture"}','pending original');db.prepare('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)').run('crash-work',null,'crash-source',null,'crash-work','ACTIVE',1,1,null,'{"kind":"ordinary"}');db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run('crash-run','crash-work',1,1,'RUNNING',path.join(home,'state'),'reserved','{"kind":"exec"}');db.prepare('INSERT INTO budgets VALUES(?,?,?,?,?)').run('crash-work','execution',8,3,1);}finally{db.close();}
 await fs.mkdir(path.join(home,'config'),{recursive:true,mode:0o700});const startup=path.join(home,'config/startup.json');await fs.writeFile(startup,'{broken-private-setup',{mode:0o600});const before=snapshot(file),calls=f.calls;
 const cli=async args=>{try{return {code:0,...await execute(process.execPath,['--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/entry.js'),'repo',...args,'--home',home],{timeout:5000,env:{PATH:path.dirname(process.execPath),HOME:f.root,TMPDIR:f.root,NODE_OPTIONS:'',NODE_PATH:''}})};}catch(e){if(typeof e.code==='number')return {code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}};
 const listed=await cli(['resources']);assert.equal(listed.code,0,listed.stderr);assert.equal(JSON.parse(listed.stdout).resources.length,2);assert.ok(listed.stdout.includes(pr.resourceId));assert.doesNotMatch(listed.stdout,/Preserve meaning|fixture-only|broken-private-setup/);
 const detail=await cli(['contributions','--resource',pr.resourceId]);assert.equal(detail.code,0,detail.stderr);assert.equal(JSON.parse(detail.stdout).nativeId,pr.nativeId);assert.equal(snapshot(file),before);assert.equal(f.calls,calls);
 const protectedBefore=snapshot(file,['summary_revisions','summary_members']),prepared=await cli(['summary','--resource',pr.resourceId]);assert.equal(prepared.code,0,prepared.stderr);const summary=JSON.parse(prepared.stdout);assert.equal(summary.complete,true);assert.equal(summary.publication,'not-prepared');assert.equal(snapshot(file,['summary_revisions','summary_members']),protectedBefore);const after=snapshot(file);const again=await cli(['summary','--resource',pr.resourceId]);assert.equal(JSON.parse(again.stdout).revisionId,summary.revisionId);assert.equal(snapshot(file),after);
 assert.equal((await cli(['summary','--resource',issue.resourceId])).code,2);assert.equal((await cli(['summary','--resource',pr.resourceId,'--revision','999'])).code,2);assert.equal(snapshot(file,['summary_revisions','summary_members']),protectedBefore);assert.equal(await fs.readFile(startup,'utf8'),'{broken-private-setup');assert.equal(f.calls,calls);
});
