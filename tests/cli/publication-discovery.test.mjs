import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {shared,target} from '../contributions/publication-fixture.mjs';
const execute=promisify(execFile);
const snapshot=file=>{const db=new DatabaseSync(file,{readOnly:true});try{return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));}finally{db.close();}};
test('original publication list/inspect bypass broken setup and preserve synthetic interrupted publication, ordinary and configuration producers',{timeout:12000},async t=>{
    const f=await shared();t.after(()=>f.close());const targetId=f.c.registerPublicationTarget({target,visibility:'public'}).targetId;
    const prepare=body=>f.c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body}}),p=await prepare('Original pending publication'),q=await prepare('Controlled configuration original');
    const home=f.c.applicationHome(),file=path.join(home,'state/controller.sqlite');await f.c.close();
    // Crash-shaped producer state is injected; no real send, cleanup or recovery is asserted.
    const db=new DatabaseSync(file);try{
        db.prepare("UPDATE effect_operations SET phase='INVOKING',data=json_set(data,'$.dispatchIntent',json('true')) WHERE id=?").run(p.operationId);
        db.prepare("UPDATE effect_operations SET phase='INVOKING',data=json_set(data,'$.kind','configuration') WHERE id=?").run(q.operationId);
        db.prepare('INSERT INTO effect_targets VALUES(?,NULL,?)').run('configuration-target','{"kind":"github-configuration"}');db.prepare('INSERT INTO effect_delegations VALUES(?,?,?,?,?)').run('configuration-grant',q.workId,'configuration-target',1,'{"kind":"configuration"}');db.prepare('UPDATE effect_operations SET target=?,grant_id=? WHERE id=?').run('configuration-target','configuration-grant',q.operationId);
        for(const [id,work,kind,operationId] of [['pending-publication',p.workId,'publication-http',p.operationId],['pending-configuration',q.workId,'configuration-http',q.operationId]])db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run(id,work,1,1,'RUNNING',path.join(home,'state'),'reserved',JSON.stringify({kind,operationId}));
        db.prepare('INSERT INTO sources VALUES(?,?,?,?)').run('ordinary-source',null,'{"kind":"owned-crash-fixture"}','Retain ordinary input');db.prepare('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)').run('ordinary-work',null,'ordinary-source',null,'ordinary-work','ACTIVE',1,1,null,'{"kind":"ordinary"}');db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run('ordinary-run','ordinary-work',1,1,'RUNNING',path.join(home,'state'),'reserved','{"kind":"exec"}');db.prepare('INSERT INTO budgets VALUES(?,?,?,?,?)').run('ordinary-work','execution',8,3,1);
    }finally{db.close();}
    await fs.mkdir(path.join(home,'config'),{recursive:true,mode:0o700});await fs.writeFile(path.join(home,'config/startup.json'),'{PRIVATE_INVALID_SETUP',{mode:0o600});
    const guard=path.join(f.root,'no-recovery.mjs');await fs.writeFile(guard,`import {Controller} from ${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)};Controller.prototype.recover=()=>{throw Error('NO_RECOVERY_ALLOWED');};Controller.prototype.recoverChanges=()=>{throw Error('NO_CHANGE_RECOVERY_ALLOWED');};`,{mode:0o600});
    const before=snapshot(file),calls=f.requests.length;
    const cli=async args=>execute(process.execPath,['--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/cli/no-sdk-loader.mjs'),'--import',guard,path.resolve('dist/cli/entry.js'),'publication',...args,'--home',home],{timeout:4000,env:{HOME:f.root,PATH:path.dirname(process.execPath),TMPDIR:f.root,NODE_OPTIONS:'',NODE_PATH:''}});
    const page=JSON.parse((await cli(['list','--limit','1'])).stdout);assert.equal(page.operations.length,1);assert.equal(page.operations[0].operationId,p.operationId);assert.equal(page.operations[0].recordedPhase,'INVOKING');assert.equal(page.operations[0].transportOutcome,'uncertain');
    const detail=JSON.parse((await cli(['inspect','--operation',p.operationId])).stdout);assert.equal(detail.operationId,p.operationId);assert.equal(detail.phase,'INVOKING');assert.doesNotMatch(JSON.stringify([page,detail]),/PRIVATE_INVALID_SETUP|fixture-original/);
    assert.equal(snapshot(file),before);assert.equal(f.requests.length,calls);
});
