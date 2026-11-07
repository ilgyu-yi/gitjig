import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../../dist/controller/store.js';
import {ChangeCore} from '../../dist/controller/change-core.js';
import {freeze} from '../../dist/controller/change-files.js';
// Controlled EXISTING evidence boundary; the actual new accessor uses original SQLite rows/capture manifests.
// These tests do not claim to execute or replace governed planning/check/review standing.
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-save-input-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(home,{mode:0o700});await fs.mkdir(source,{mode:0o700});await fs.writeFile(path.join(source,'code.txt'),'base');const base=await freeze(source,path.join(home,'base'),{});await fs.writeFile(path.join(source,'code.txt'),'candidate');const candidate=await freeze(source,path.join(home,'candidate'),{}),s=new Store(':memory:');
 t.after(async()=>{s.close();await fs.rm(root,{recursive:true,force:true});});s.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)','P',source,'{}');s.run('INSERT INTO sources VALUES(?,?,?,?)','source',null,'{}','Original request');s.run('INSERT INTO sources VALUES(?,?,?,?)','other-source',null,'{}','Other request');for(const work of ['W','foreign'])s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',work,'P','source',null,work,'DELIVERED',3,4,null,'{}');
 s.run('INSERT INTO change_state VALUES(?,?,?,?,?,?,?,?)','W','REVIEW_READY','base','candidate','plan','verification',3,'{}');
 for(const [id,kind,capture]of[['base','base',base],['candidate','candidate',candidate],['foreign-candidate','candidate',candidate]])s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,id==='foreign-candidate'?'foreign':'W',kind,null,path.join(home,kind),capture.digest,JSON.stringify({manifest:capture.manifest}));
 for(const kind of ['execution','resolution'])s.run('INSERT INTO budgets VALUES(?,?,?,?,?)','W',kind,0,0,0);
 const evidence={workId:'W',epoch:3,generation:4,versions:{base:'base',candidate:'candidate',plan:'plan',verification:'verification',requirements:null,contracts:'contracts'},candidateDigest:candidate.digest,sourceChainDigest:'source-premise',selectionDigest:'selection',checkIds:[],reviewLaunchIds:[],dispositionDigest:'none',carryDigest:null,fingerprint:'controlled-original-standing'};let open=true,assertions=0;
 const core=new ChangeCore({store:s,options:{installationHome:home},assertOpen(){if(!open)throw Error('host closing');}});core.currentEvidence=async()=>structuredClone(evidence);core.assertCurrentEvidence=value=>{assert.deepEqual(value,evidence);assertions++;};
 const ledger=()=>JSON.stringify(['works','runs','budgets','change_versions','change_state','effect_targets','effect_delegations','effect_operations','sources'].map(table=>[table,s.all(`SELECT * FROM ${table} ORDER BY rowid`)]));
 return{s,core,home,source,evidence,ledger,closeHost(){open=false;},get assertions(){return assertions;}};
}

test('scoped source snapshot is detached, zero-allowance and metadata-only',async t=>{
 const f=await fixture(t),before=f.ledger(),value=await f.core.captureSourceSaveInput('W');assert.equal(value.workId,'W');assert.equal(value.projectId,'P');assert.equal(value.projectRoot,f.source);assert.equal(value.sourceId,'source');assert.equal(value.base.kind,'base');assert.equal(value.candidate.kind,'candidate');assert.equal(value.base.root,path.join(f.home,'base'));assert.equal(value.candidate.digest,f.evidence.candidateDigest);assert.equal(f.assertions,1);value.base.manifest.files[0].sha256='altered';value.evidence.versions.base='altered';assert.equal(f.ledger(),before);assert.equal((await f.core.captureSourceSaveInput('W')).base.versionId,'base');
});

test('foreign selected versions and wrong kinds refuse before evidence can supply an apparent pass',async t=>{
 const f=await fixture(t);f.s.run('UPDATE change_state SET candidate=? WHERE work=?','foreign-candidate','W');await assert.rejects(f.core.captureSourceSaveInput('W'),/another work/);f.s.run('UPDATE change_state SET candidate=? WHERE work=?','candidate','W');f.s.run('UPDATE change_versions SET kind=? WHERE id=?','candidate','base');await assert.rejects(f.core.captureSourceSaveInput('W'),/kind/);
});

test('work/source/project/selection and original version drift across evidence await refuses retargeting',async t=>{
 for(const mutate of [f=>f.s.run('UPDATE works SET epoch=epoch+1 WHERE id=?','W'),f=>f.s.run('UPDATE works SET source=? WHERE id=?','other-source','W'),f=>f.s.run('UPDATE projects SET root=? WHERE id=?',f.source+'-changed','P'),f=>f.s.run('UPDATE change_state SET candidate=? WHERE work=?','foreign-candidate','W'),f=>f.s.run('UPDATE sources SET raw=? WHERE id=?','Changed owner request','source'),f=>f.s.run('UPDATE change_versions SET artifact=? WHERE id=?',path.join(f.home,'other-artifact'),'base')]){
  const f=await fixture(t);let release;const gate=new Promise(r=>release=r);f.core.currentEvidence=async()=>{await gate;return structuredClone(f.evidence);};const pending=f.core.captureSourceSaveInput('W');mutate(f);release();await assert.rejects(pending,/changed|another work/);
 }
});

test('manifest integrity and effective digest are separate original-capture conditions',async t=>{
 const f=await fixture(t),raw=f.s.one('SELECT data FROM change_versions WHERE id=?','base').data,data=JSON.parse(raw);data.manifest.digest='0'.repeat(64);f.s.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify(data),'base');await assert.rejects(f.core.captureSourceSaveInput('W'),/manifest/);f.s.run('UPDATE change_versions SET data=? WHERE id=?',raw,'base');f.s.run('UPDATE change_versions SET hash=? WHERE id=?','0'.repeat(64),'base');await assert.rejects(f.core.captureSourceSaveInput('W'),/capture identity/);
});

test('existing evidence refusal/criteria drift and host close remain authoritative after await',async t=>{
 const f=await fixture(t),before=f.ledger(),failure=Error('Current criteria changed');f.core.assertCurrentEvidence=()=>{throw failure;};await assert.rejects(f.core.captureSourceSaveInput('W'),e=>e===failure);assert.equal(f.ledger(),before);
 f.core.currentEvidence=async()=>{f.closeHost();return structuredClone(f.evidence);};await assert.rejects(f.core.captureSourceSaveInput('W'),/host closing/);assert.equal(f.ledger(),before);
});

test('candidate digest and artifact containment cannot be supplied by a different snapshot',async t=>{
 const f=await fixture(t);f.evidence.candidateDigest='0'.repeat(64);await assert.rejects(f.core.captureSourceSaveInput('W'),/candidate digest/);f.evidence.candidateDigest=f.s.one('SELECT hash FROM change_versions WHERE id=?','candidate').hash;f.s.run('UPDATE change_versions SET artifact=? WHERE id=?',f.source,'candidate');await assert.rejects(f.core.captureSourceSaveInput('W'),/capture identity/);
});
