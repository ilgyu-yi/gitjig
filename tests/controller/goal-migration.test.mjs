import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../../dist/controller/store.js';
const goalTables=['goal_reviews','goal_events','goal_attempts','goals'];
const snapshot=db=>{
 const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 return tables.map(({name,sql})=>({name,sql,rows:db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()}));
};
function seed(db){
 db.prepare('INSERT INTO sources VALUES(?,?,?,?)').run('migration-source','migration-cid','{"kind":"non-authority-storage-fixture"}','Retained raw source');
 db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?)').run('migration-cid',null,null,4,'IDLE');
 db.prepare('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)').run('migration-work',null,'migration-source',null,'migration-lineage','INTERRUPTED',3,2,null,'{"kind":"non-authority-storage-fixture","pending":"preserve"}');
 db.prepare('INSERT INTO budgets VALUES(?,?,?,?,?)').run('migration-lineage','execution',8,3,1);
 db.prepare('INSERT INTO requirements VALUES(?,?,?,?)').run('migration-work',2,'Original criteria','English interpretation');
 db.prepare('INSERT INTO obligations VALUES(?,?,?)').run('migration-obligation','migration-work','{"state":"pending","text":"Storage preservation only"}');
}
test('goal schema migrates reconstructed7 without changing old records',{timeout:6000},async t=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'gitjig-goal-migration-'));t.diagnostic('Retained migration world: '+root);const receipts=[];
 const migrate=(label,Factory,reconstructed)=>{
  const file=path.join(root,label+'.sqlite'),old=new Factory(file);
  if(reconstructed)old.db.exec('DROP TABLE goal_reviews;DROP TABLE goal_events;DROP TABLE goal_attempts;DROP TABLE goals;PRAGMA user_version=7;');
  assert.equal(old.one('PRAGMA user_version').user_version,7);seed(old.db);const before=snapshot(old.db);old.close();
  const migrated=new Store(file);try{
   assert.equal(migrated.one('PRAGMA user_version').user_version,8);
   assert.deepEqual(snapshot(migrated.db).filter(row=>!goalTables.includes(row.name)),before);
   for(const name of goalTables)assert.equal(migrated.one('SELECT COUNT(*) AS n FROM '+name).n,0);
   assert.deepEqual(migrated.all('PRAGMA foreign_key_check'),[]);
  }finally{migrated.close();}
  receipts.push({label,reconstructed,originalTables:before.length,originalRows:before.reduce((n,row)=>n+row.rows.length,0)});return file;
 };
 migrate('portable-reconstructed7',Store,true);
 await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify({receipts,scope:'Portable schema7 reconstruction; no historical installed-input claim'},null,2));
});
test('schema8 missing goal catalogue refuses and retains corruption for explicit repair',{timeout:3000},async t=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'gitjig-goal-corrupt-'));t.diagnostic('Retained corruption world: '+root);const file=path.join(root,'state.sqlite');const s=new Store(file);s.db.exec('DROP TABLE goal_reviews');s.close();
 assert.throws(()=>new Store(file),/Schema8 goal catalogue missing/);
 const db=new DatabaseSync(file);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,8);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='goal_reviews'").get().n,0);}finally{db.close();}
});
