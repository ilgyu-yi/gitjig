import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openController} from '../../dist/controller/index.js';
import {Store} from '../../dist/controller/store.js';
test('V4-shaped nonnullable local target migrates to current schema with all target/grant/op/receipt/source rows retained; locked migration rolls back',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-publication-migration-'))),home=path.join(root,'home'),project=path.join(root,'source');await fs.mkdir(project);let c=await openController({installationHome:home}),passed=false;
 try{
  await c.registerProject({id:'P',sourceRoot:project});const w=await c.beginChange({projectId:'P',request:'Retain local source and counters'});
  c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','local-target','P',JSON.stringify({canonicalPath:'/owned/receiver',ref:'refs/heads/main',basisCommit:'a'.repeat(40)}));
  c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','local-grant',w.workId,'local-target',1,JSON.stringify({mode:'ordinary',operationLimit:3}));
  c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','local-op',w.workId,'local-target','local-grant','RESERVED','{"legacy":true}');
  c.store.run('INSERT INTO effect_receipts VALUES(?,?,?,?)','local-receipt','local-op','legacy','{"observed":true}');
  const tables=['works','sources','requirements','budgets','effect_targets','effect_delegations','effect_operations','effect_receipts'],before=Object.fromEntries(tables.map(t=>[t,c.store.all(`SELECT * FROM ${t}`)]));await c.close();
  const filename=path.join(home,'state/controller.sqlite'),db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=OFF;BEGIN;CREATE TABLE v4_targets(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES projects(id),data TEXT NOT NULL);INSERT INTO v4_targets SELECT * FROM effect_targets;DROP TABLE effect_targets;ALTER TABLE v4_targets RENAME TO effect_targets;PRAGMA user_version=4;COMMIT');
  db.exec('BEGIN IMMEDIATE');assert.throws(()=>new Store(filename),/locked/);assert.equal(db.prepare('PRAGMA user_version').get().user_version,4);assert.equal(db.prepare('PRAGMA table_info(effect_targets)').all().find(r=>r.name==='project').notnull,1);db.exec('ROLLBACK');db.close();
  c=await openController({installationHome:home});assert.equal(c.store.one('PRAGMA user_version').user_version,8);for(const t of tables)assert.deepEqual(c.store.all(`SELECT * FROM ${t}`),before[t],t);assert.equal(c.store.all('PRAGMA foreign_key_check').length,0);
  assert.equal(c.store.all('PRAGMA table_info(effect_targets)').find(r=>r.name==='project').notnull,0);await c.close();c=await openController({installationHome:home});assert.deepEqual(c.store.all('SELECT * FROM effect_targets'),before.effect_targets);passed=true;
 }finally{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Retained migration fixture '+root);}
});
