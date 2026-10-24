import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {integrationWorld} from '../controller/integration-registry-fixture.mjs';
const execute=promisify(execFile),snapshot=file=>{const db=new DatabaseSync(file,{readOnly:true});try{return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));}finally{db.close();}};
test('original effect list/inspect bypass broken startup, SDK, native clients and recovery while preserving all interrupted families',{timeout:12000},async t=>{
 const f=await integrationWorld(t),op=await f.prepare(),others=[];for(let i=0;i<3;i++)others.push(await f.prepare());await f.c.close();const database=path.join(f.home,'state/controller.sqlite'),db=new DatabaseSync(database);
 try{
  db.prepare("UPDATE effect_operations SET phase='INVOKING' WHERE id=?").run(op.operationId);
  for(const [index,kind,targetKind] of [[0,'publication','github-publication'],[1,'configuration','native-repository-configuration']]){const other=others[index];db.prepare('INSERT INTO effect_targets VALUES(?,?,?)').run('foreign-target'+index,'P',JSON.stringify({kind:targetKind}));db.prepare('INSERT INTO effect_delegations VALUES(?,?,?,?,?)').run('foreign-grant'+index,other.workId,'foreign-target'+index,1,JSON.stringify({kind}));db.prepare('UPDATE effect_operations SET phase=?,target=?,grant_id=?,data=? WHERE id=?').run('INVOKING','foreign-target'+index,'foreign-grant'+index,JSON.stringify({kind}),other.operationId);}
  db.prepare('DELETE FROM effect_operations WHERE id=?').run(others[2].operationId);
  for(const [index,work,kind,operationId] of [[0,op.workId,'native-effect',op.operationId],[1,others[0].workId,'publication-http',others[0].operationId],[2,others[1].workId,'configuration-http',others[1].operationId],[3,others[2].workId,'exec',null]]){db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run('crash-run'+index,work,1,1,'RUNNING',path.join(f.home,'state'),'reserved',JSON.stringify({kind,...operationId?{operationId}:{}}));db.prepare("UPDATE budgets SET reserved=1,consumed=consumed+1 WHERE lineage=? AND kind='execution'").run(work);}
 }finally{db.close();}
 await fs.mkdir(path.join(f.home,'config'),{recursive:true,mode:0o700});await fs.writeFile(path.join(f.home,'config/startup.json'),'{PRIVATE_BROKEN_SETUP',{mode:0o600});const guard=path.join(f.root,'no-recovery.mjs');await fs.writeFile(guard,`import {Controller} from ${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)};Controller.prototype.recover=()=>{throw Error('RECOVERY_CALLED');};Controller.prototype.recoverChanges=()=>{throw Error('CHANGE_RECOVERY_CALLED');};`);
 const before=snapshot(database),cli=args=>execute(process.execPath,['--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/cli/no-sdk-loader.mjs'),'--import',guard,path.resolve('dist/cli/entry.js'),'effect',...args,'--home',f.home],{timeout:4000,env:{PATH:path.dirname(process.execPath),HOME:f.root,TMPDIR:f.root,NODE_OPTIONS:'',NODE_PATH:''}});
 const page=JSON.parse((await cli(['list','--limit','1'])).stdout);assert.equal(page.operations.length,1);assert.equal(page.operations[0].operationId,op.operationId);assert.equal(page.operations[0].recordedPhase,'INVOKING');assert.equal(page.operations[0].transportOutcome,'uncertain');const detail=JSON.parse((await cli(['inspect','--operation',op.operationId])).stdout);assert.equal(detail.operationId,op.operationId);assert.equal(detail.phase,'INVOKING');assert.doesNotMatch(JSON.stringify([page,detail]),/PRIVATE_BROKEN_SETUP/);assert.equal(snapshot(database),before);await assert.rejects(cli(['list','--limit','101']),/between1 and100/);await assert.rejects(cli(['list','--before',others[0].operationId]),/cursor/);assert.equal(snapshot(database),before);f.pass();
});
