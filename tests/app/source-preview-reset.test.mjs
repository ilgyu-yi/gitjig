import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {Store} from '../../dist/controller/store.js';
import {SourceBranchPreviews} from '../../dist/controller/source-branch-previews.js';
import {prepareApplicationReset,applyApplicationReset} from '../../dist/app/reset.js';

async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-preview-reset-'))),home=path.join(root,'app');
 const controller=await openController({installationHome:home});await controller.close();
 await fs.mkdir(path.join(home,'config'),{mode:0o700});await fs.writeFile(path.join(home,'config/settings.json'),'original settings',{mode:0o600});
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset fixture '+root);});
 return {home,store:()=>new Store(path.join(home,'state/controller.sqlite')),pass(){passed=true;}};
}
function ownership(s,home){
 // Metadata-only reset admission fixture, never a native cleanup assertion.
 s.run('INSERT INTO sources VALUES(?,?,?,?)','request',null,'{"kind":"reset-storage-fixture"}','Original request');
 s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','work',null,'request',null,'work','ACTIVE',1,1,null,'{}');
 const registry=new SourceBranchPreviews(s,home),preview=registry.admit({workId:'work',sourceId:'request',epoch:1,generation:1,profileDigest:'a'.repeat(64),inputDigest:'b'.repeat(64)});
 return {registry,preview};
}
for(const scope of ['settings','all'])for(const state of ['UNRESOLVED','UNKNOWN'])test(scope+' reset preserves '+state+' preview with no run, reservation or unknown work',async t=>{
 const f=await fixture(t),consent=await prepareApplicationReset(f.home,scope),s=f.store(),{registry,preview}=ownership(s,f.home);
 if(state==='UNKNOWN')registry.markUnknown(preview.id,'Storage fixture retains original uncertainty');
 assert.equal(s.one('SELECT COUNT(*) AS n FROM runs').n,0);assert.equal(s.one('SELECT COUNT(*) AS n FROM budgets').n,0);assert.equal(s.one('SELECT COUNT(*) AS n FROM capacity_leases').n,0);
 s.close();const error=new RegExp('original source preview '+preview.id);
 await assert.rejects(prepareApplicationReset(f.home,scope),error);await assert.rejects(applyApplicationReset(f.home,scope,consent.fingerprint),error);
 const retained=f.store();assert.equal(retained.one('SELECT state FROM source_branch_previews WHERE id=?',preview.id).state,state);retained.close();
 assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');await assert.rejects(fs.stat(path.join(f.home,'reset-backups')),{code:'ENOENT'});f.pass();
});
test('settled metadata history does not block reset; reset admission does not claim physical cleanup',async t=>{
 const f=await fixture(t),s=f.store(),{registry,preview}=ownership(s,f.home);
 const rooted=registry.attachRoot(preview.id,{admissionSourceId:preview.admission_source,clientRoot:preview.admission.clientRoot,device:'1',inode:'2',ownerUid:process.getuid()});
 registry.settle(preview.id,{admissionSourceId:rooted.admission_source,rootSourceId:rooted.root_source,kind:'joined-owned-native',cleanup:'confirmed',receiptDigest:'c'.repeat(64)});s.close();
 const p=await prepareApplicationReset(f.home,'all');assert.ok(p.paths.includes('state/controller.sqlite'));f.pass();
});
test('legacy schema8 without a preview catalogue retains reset compatibility',async t=>{
 const f=await fixture(t),s=f.store();s.db.exec('DROP TABLE source_branch_previews;PRAGMA user_version=8');s.close();
 const p=await prepareApplicationReset(f.home,'all');assert.ok(p.paths.includes('state/controller.sqlite'));f.pass();
});
for(const damage of ['missing-table','missing-index','changed-state-literal'])test('reset refuses schema9 '+damage+' instead of treating lost ownership as empty',async t=>{
 const f=await fixture(t),s=f.store();
 if(damage==='missing-table')s.db.exec('DROP TABLE source_branch_previews');
 else if(damage==='missing-index')s.db.exec('DROP INDEX source_branch_preview_active_id');
 else{
  const ddl=s.one("SELECT sql FROM sqlite_master WHERE name='source_branch_previews'").sql,indexes=s.all("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='source_branch_previews' AND sql IS NOT NULL");
  s.db.exec('DROP TABLE source_branch_previews');s.db.exec(ddl.replace("'UNRESOLVED'","'UN RESOLVED'"));for(const row of indexes)s.db.exec(row.sql);
 }
 s.close();await assert.rejects(prepareApplicationReset(f.home,'all'),/Schema9 source preview catalogue unavailable/);
 assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');await assert.rejects(fs.stat(path.join(f.home,'reset-backups')),{code:'ENOENT'});f.pass();
});
