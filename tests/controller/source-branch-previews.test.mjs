import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../../dist/controller/store.js';
import {SourceBranchPreviews} from '../../dist/controller/source-branch-previews.js';

const sha='a'.repeat(64), other='b'.repeat(64);
const snapshot=db=>db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>({...row,rows:db.prepare('SELECT * FROM "'+row.name+'" ORDER BY rowid').all()}));
async function world(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-preview-registry-')),file=path.join(root,'state.sqlite');let store=new Store(file);
 t.after(()=>store.close());t.diagnostic('Retained SQLite-only fixture: '+root);
 const addWork=(id='W')=>{
  store.run('INSERT INTO sources VALUES(?,?,?,?)','source-'+id,null,'{"kind":"storage-test-only"}','Original owner request');
  store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',id,null,'source-'+id,null,id,'ACTIVE',2,3,null,'{"kind":"governed-change","retained":"exact bytes"}');
  for(const kind of ['execution','resolution'])store.run('INSERT INTO budgets VALUES(?,?,?,?,?)',id,kind,0,0,0);
  store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','run-'+id,id,2,3,'SETTLED','/not-an-executed-fixture','consumed','{"kind":"storage-only","cleanup":"removed"}');
 };
 addWork();
 const registry=()=>new SourceBranchPreviews(store,root);
 return {root,file,get s(){return store;},r:registry,addWork,input:(id='W')=>({workId:id,sourceId:'source-'+id,epoch:2,generation:3,profileDigest:sha,inputDigest:other}),reopen(){store.close();store=new Store(file);return registry();}};
}
const attach=(r,p)=>r.attachRoot(p.id,{admissionSourceId:p.admission_source,clientRoot:p.admission.clientRoot,device:'1',inode:'2',ownerUid:process.getuid()});
const terminal=p=>({admissionSourceId:p.admission_source,rootSourceId:p.root_source,kind:'joined-owned-native',cleanup:'confirmed',receiptDigest:sha});
const legacySnapshot=s=>['works','runs','budgets','requirements','obligations','change_state','effect_targets','effect_delegations','effect_operations'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]);

test('free ownership receipts preserve original work/run/budget proof bytes through every transition',async t=>{
 const f=await world(t),r=f.r(),before=legacySnapshot(f.s),original=f.s.one('SELECT * FROM sources WHERE id=?','source-W');
 const p=r.admit(f.input());assert.equal(p.state,'UNRESOLVED');assert.equal(r.active().previews.length,1);assert.deepEqual(legacySnapshot(f.s),before);
 const rooted=attach(r,p);r.markUnknown(p.id,'Controlled host assertion, not native cleanup proof');const reopened=f.reopen();assert.equal(reopened.inspect(p.id).state,'UNKNOWN');
 const settled=reopened.settle(p.id,terminal(rooted));assert.equal(settled.state,'SETTLED');assert.equal(reopened.active().previews.length,0);assert.equal(settled.terminal.kind,'joined-owned-native');
 assert.deepEqual(legacySnapshot(f.s),before);assert.deepEqual(f.s.one('SELECT * FROM sources WHERE id=?','source-W'),original);
 assert.equal(f.s.one('SELECT COUNT(*) AS n FROM sources').n,5); // owner, admission, root, unknown, terminal
 assert.throws(()=>reopened.markUnknown(p.id,'Cannot reopen'),/cannot reopen/);assert.throws(()=>reopened.settle(p.id,terminal(rooted)),/Exact joined/);
});

test('admission/source projection is atomic and duplicate active work cannot orphan a source',async t=>{
 const f=await world(t),r=f.r();r.admit(f.input());const before=snapshot(f.s.db);
 assert.throws(()=>r.admit(f.input()),/UNIQUE/);assert.deepEqual(snapshot(f.s.db),before);
 for(const patch of [{sourceId:'wrong'},{workId:'missing'},{epoch:1},{generation:4},{profileDigest:'not-digest'}])assert.throws(()=>r.admit({...f.input(),...patch}),/changed|operands/);
 assert.deepEqual(snapshot(f.s.db),before);
});

test('root and terminal receipts bind exact original ownership; rootless no-birth settlement is unavailable',async t=>{
 const f=await world(t),r=f.r(),p=r.admit(f.input()),before=snapshot(f.s.db);
 assert.throws(()=>r.settle(p.id,{...terminal(p),rootSourceId:'missing'}),/no-birth/);
 for(const patch of [{admissionSourceId:'foreign'},{clientRoot:f.root},{ownerUid:process.getuid()+1},{inode:''}])assert.throws(()=>r.attachRoot(p.id,{admissionSourceId:p.admission_source,clientRoot:p.admission.clientRoot,device:'1',inode:'2',ownerUid:process.getuid(),...patch}),/root proof/);
 assert.deepEqual(snapshot(f.s.db),before);
 const rooted=attach(r,p),rootBefore=snapshot(f.s.db);
 for(const patch of [{admissionSourceId:'foreign'},{rootSourceId:'foreign'},{kind:'no-birth'},{cleanup:'unknown'},{receiptDigest:''}])assert.throws(()=>r.settle(p.id,{...terminal(rooted),...patch}),/Exact joined/);
 assert.deepEqual(snapshot(f.s.db),rootBefore);assert.throws(()=>attach(r,p),/root proof/);
});

test('source purpose and root/admission correspondence refuse rather than trust projection foreign keys alone',async t=>{
 const f=await world(t),r=f.r(),p=attach(r,r.admit(f.input()));f.addWork('X');const x=attach(r,r.admit(f.input('X')));
 // Both sources exist and satisfy FKs; assignment of another preview's source is still invalid.
 f.s.run('UPDATE source_branch_previews SET root_source=NULL WHERE id=?',x.id);f.s.run('UPDATE source_branch_previews SET root_source=? WHERE id=?',x.root_source,p.id);
 assert.throws(()=>r.inspect(p.id),/purpose or ownership/);
 f.s.run('UPDATE source_branch_previews SET root_source=? WHERE id=?',p.root_source,p.id);
 const row=f.s.one('SELECT origin FROM sources WHERE id=?',p.admission_source);const origin=JSON.parse(row.origin);
 f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify({...origin,purpose:'terminal'}),p.admission_source);
 assert.throws(()=>r.active(),/purpose or ownership/);
});

test('closed SQL states, terminal iff settled, uniqueness and foreign keys protect the projection',async t=>{
 const f=await world(t),p=f.r().admit(f.input());
 for(const sql of ["UPDATE source_branch_previews SET state='OTHER'", "UPDATE source_branch_previews SET state='SETTLED'", "UPDATE source_branch_previews SET terminal_source='source-W'", "UPDATE source_branch_previews SET root_source='missing'"])
  assert.throws(()=>f.s.db.exec(sql),/CHECK|FOREIGN KEY/);
 assert.equal(f.r().inspect(p.id).state,'UNRESOLVED');
 assert.throws(()=>f.s.run('DELETE FROM works WHERE id=?','W'),/FOREIGN KEY/);
});

test('active index pages unresolved originals independently of settled history and preserves cleanup through work cancellation',async t=>{
 const f=await world(t),r=f.r();
 for(let n=0;n<120;n++){const p=attach(r,r.admit(f.input()));r.settle(p.id,terminal(p));}
 const expected=[];
 for(const id of ['W','X','Y']){if(id!=='W')f.addWork(id);expected.push(r.admit(f.input(id)).id);}
 f.s.run("UPDATE works SET state='CANCELLED',epoch=epoch+1 WHERE id=?",'W');
 const a=r.active({limit:2}),b=r.active({after:a.nextCursor,limit:2});assert.deepEqual([...a.previews,...b.previews].map(p=>p.id),expected.sort());assert.equal(b.nextCursor,null);
 const query=f.s.all("EXPLAIN QUERY PLAN SELECT id FROM source_branch_previews INDEXED BY source_branch_preview_active_id WHERE state!='SETTLED' AND id>? ORDER BY id LIMIT ?",'',3);
 assert.ok(query.some(row=>/source_branch_preview_active_id.*id>/.test(row.detail)),JSON.stringify(query));assert.ok(query.every(row=>!row.detail.includes('TEMP B-TREE')));
 for(const options of [{limit:0},{limit:101},{after:randomUUID()},{extra:true}])assert.throws(()=>r.active(options),/paging/);
});

test('reconstructed schema8 migration preserves every old table/row and adds only empty preview projection',async t=>{
 const f=await world(t);f.s.db.exec('DROP TABLE source_branch_previews;PRAGMA user_version=8');const before=snapshot(f.s.db);
 f.reopen();assert.equal(f.s.one('PRAGMA user_version').user_version,9);assert.deepEqual(snapshot(f.s.db).filter(row=>row.name!=='source_branch_previews'),before);assert.equal(f.s.one('SELECT COUNT(*) AS n FROM source_branch_previews').n,0);assert.deepEqual(f.s.all('PRAGMA foreign_key_check'),[]);
});

for(const corruption of ['missing-table','missing-index','wrong-index','wrong-check','quoted-literal','wrong-fk','missing-column'])test('schema9 refuses '+corruption+' before catalogue reconstruction',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-preview-catalogue-')),file=path.join(root,'state.sqlite'),s=new Store(file);
 const table=s.one("SELECT sql FROM sqlite_master WHERE name='source_branch_previews'").sql,indexes=s.all("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='source_branch_previews' AND sql IS NOT NULL").map(row=>row.sql);
 if(corruption==='missing-table')s.db.exec('DROP TABLE source_branch_previews');
 else if(corruption==='missing-index')s.db.exec('DROP INDEX source_branch_preview_active_id');
 else if(corruption==='wrong-index')s.db.exec('DROP INDEX source_branch_preview_active_id;CREATE INDEX source_branch_preview_active_id ON source_branch_previews(id)');
 else{
  s.db.exec('DROP TABLE source_branch_previews');let bad=table;
  if(corruption==='wrong-check')bad=bad.replace("CHECK(state IN ('UNRESOLVED','UNKNOWN','SETTLED'))",'');
  if(corruption==='quoted-literal')bad=bad.replace("'UNRESOLVED'","'UN RESOLVED'");
  if(corruption==='wrong-fk')bad=bad.replace('REFERENCES works(id)','REFERENCES sources(id)');
  if(corruption==='missing-column')bad=bad.replace('root_source TEXT UNIQUE REFERENCES sources(id),','').replace('CHECK(terminal_source IS NULL OR root_source IS NOT NULL)','CHECK(1)');
  s.db.exec(bad);for(const sql of indexes)s.db.exec(sql);
 }
 const before=snapshot(s.db);s.close();assert.throws(()=>new Store(file),/Schema9 source preview catalogue unavailable/);
 const db=new DatabaseSync(file);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,9);assert.deepEqual(snapshot(db),before);}finally{db.close();await fs.rm(root,{recursive:true,force:true});}
});

test('schema8 failed migration rolls back new catalogue and version without changing original invalid rows',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-preview-rollback-')),file=path.join(root,'state.sqlite'),s=new Store(file);
 s.db.exec("DROP TABLE source_branch_previews;PRAGMA user_version=8;PRAGMA foreign_keys=OFF;INSERT INTO works VALUES('broken',NULL,'missing',NULL,'broken','ACTIVE',1,1,NULL,'{}')");const before=snapshot(s.db);s.close();
 assert.throws(()=>new Store(file),/foreign-key validation/);const db=new DatabaseSync(file);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,8);assert.deepEqual(snapshot(db),before);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='source_branch_previews'").get().n,0);}finally{db.close();await fs.rm(root,{recursive:true,force:true});}
});

test('late schema8 catalogue creation failure rolls back new table while preserving the original conflicting index',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-preview-ddl-rollback-')),file=path.join(root,'state.sqlite'),s=new Store(file);
 s.db.exec('DROP TABLE source_branch_previews;PRAGMA user_version=8;CREATE INDEX source_branch_preview_active_id ON sources(id)');
 const before=snapshot(s.db),index=s.one("SELECT sql FROM sqlite_master WHERE name='source_branch_preview_active_id'").sql;s.close();
 assert.throws(()=>new Store(file),/already exists/);const db=new DatabaseSync(file);try{
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,8);assert.deepEqual(snapshot(db),before);
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='source_branch_preview_active_id'").get().sql,index);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='source_branch_previews'").get().n,0);
 }finally{db.close();await fs.rm(root,{recursive:true,force:true});}
});

test('closed factory stamp requires actual root+runs proof while legacy generic receipts remain inspectable',async t=>{
 const f=await world(t),r=f.r();
 for(const factoryProtocol of [undefined,null,'other'])assert.throws(()=>r.admit({...f.input(),factoryProtocol}),/operands/);
 const p=r.admit({...f.input(),factoryProtocol:'owned-native-git-prebirth/v1'});
 assert.throws(()=>attach(r,p),/root proof/);
 const proof={admissionSourceId:p.admission_source,protocol:'owned-native-git-prebirth/v1',clientRoot:p.admission.clientRoot,device:'1',inode:'2',ownerUid:process.getuid(),runsDirectory:path.join(p.admission.clientRoot,'runs'),runsDevice:'1',runsInode:'3',runsOwnerUid:process.getuid(),gitBinary:'/owned/git'};
 for(const patch of [{protocol:'other'},{runsDirectory:f.root},{runsInode:''},{runsOwnerUid:process.getuid()+1},{gitBinary:'relative'}])assert.throws(()=>r.attachRoot(p.id,{...proof,...patch}),/root proof/);
 const rooted=r.attachRoot(p.id,proof);assert.equal(rooted.root.protocol,'owned-native-git-prebirth/v1');
 r.settle(p.id,terminal(rooted));const generic=attach(r,r.admit(f.input()));assert.equal(generic.admission.factoryProtocol,undefined);assert.equal(generic.root.protocol,undefined);
});

test('heterogeneous owner text cannot be decoded as a preview root before its purpose is checked',async t=>{
 const f=await world(t),r=f.r(),p=r.admit(f.input());f.s.run('UPDATE source_branch_previews SET root_source=? WHERE id=?','source-W',p.id);
 assert.throws(()=>r.inspect(p.id),error=>!(error instanceof SyntaxError)&&error.message==='Original preview source purpose or ownership differs');
 assert.equal(f.s.one('SELECT raw FROM sources WHERE id=?','source-W').raw,'Original owner request');
});
