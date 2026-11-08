import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {criteriaWorld} from './criteria-refresh-fixture.mjs';
import {resolveCriteriaDelivery} from '../../dist/workflow/criteria-delivery.js';
import {roleInputEvidenceManifests} from '../../dist/workflow/role-input-evidence.js';

test('Controller uses explicit operating delivery with full retained definitions and no premature execution',async t=>{
    const f=await criteriaWorld(t), state=()=>JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?',f.workId).data);
    const prior=f.c.changes.version(state().contractsVersion);
    await f.change('DESIGN.md','\nCurrent delivery exception must remain explicit.\n');
    await f.c.refreshChangeCriteria({workId:f.workId,reason:'Preserve all prior criteria while changing their declared delivery'});
    const current=f.c.changes.version(state().contractsVersion),before=f.ledger();
    for(const [role,stage,profile]of [['planner','planning','planning-v1'],['challenger','planning-challenge','planning-v1'],['adjudicator','planning-adjudication','planning-v1'],['implementer','implementation','verification-v1'],['reviewer','fresh-review','verification-v1']]){
        const prepared=await f.c.changes.bundle(f.workId,{stage,workflowCriteriaInput:{version:1,id:randomUUID()}},role);
        const {bundle,evidence}=prepared,view=bundle.context.workflowCriteria;
        assert.equal(view.profile,profile);assert.equal(evidence.length,1);
        assert.deepEqual(roleInputEvidenceManifests(bundle.context),[evidence[0].manifest]);
        const resolved=resolveCriteriaDelivery(evidence[0].contents,view);
        assert.equal(resolved.current.text,current.data.text);assert.equal(resolved.prior.text,prior.data.text);
        assert.equal(bundle.contracts,resolved.operating);
        assert.notEqual(bundle.contracts,resolved.current.text);
        assert.equal(bundle.context.criteriaRefresh.previous.text,undefined);
        assert.equal(bundle.context.criteriaRefresh.current.textSource,'context.workflowCriteria current records');
        assert.ok(view.additionalChangedBlocks.some(block=>block.text.includes('Current delivery exception must remain explicit.')));
        assert.equal(bundle.context.ownerRequest,'Preserve original project purpose and owner task requirements');
        prepared.assertCurrent();
        await assert.rejects(fs.access(evidence[0].manifest.path),{code:'ENOENT'},'Assembly cannot publish an artifact or allocate execution');
    }
    assert.deepEqual(f.ledger(),before);f.pass();
});

test('captured criteria versions and current normative sources remain fenced across later awaits',async t=>{
    const f=await criteriaWorld(t),prepared=await f.c.changes.bundle(f.workId,{stage:'planning',workflowCriteriaInput:{version:1,id:randomUUID()}},'planner');
    const version=prepared.bundle.context.workflowCriteria.current.id,row=f.c.store.one('SELECT * FROM change_versions WHERE id=?',version);
    f.c.store.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),changedDuringAwait:true}),version);
    assert.throws(prepared.assertCurrent,/criteria source changed/);
    f.c.store.run('UPDATE change_versions SET data=? WHERE id=?',row.data,version);
    prepared.assertCurrent();
    const file=path.join(f.payload,'PRINCIPLES.md'),original=await fs.readFile(file,'utf8');
    await fs.appendFile(file,'\nChanged after original assembly.\n');
    assert.throws(prepared.assertCurrent,/criteria source changed/);
    await fs.writeFile(file,original);prepared.assertCurrent();f.pass();
});

test('unsupported declared receiver refuses without allocating or falling back to eager legacy',async t=>{
    const f=await criteriaWorld(t),before=f.ledger();
    for(const [role,stage]of [['reviewer','planning'],['adjudicator','source-fit']])
        await assert.rejects(f.c.changes.bundle(f.workId,{stage,workflowCriteriaInput:{version:1,id:randomUUID()}},role),/criteria declaration unavailable/);
    const legacy=(await f.c.changes.bundle(f.workId,{stage:'planning'},'planner')).bundle;
    assert.equal(legacy.context.workflowCriteria,undefined);
    assert.equal(legacy.contracts,f.c.changes.version(JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?',f.workId).data).contractsVersion).data.text);
    assert.deepEqual(f.ledger(),before);f.pass();
});

test('core adjudication delivery keeps changed deferred rules inline and source guards active',async t=>{
    const f=await criteriaWorld(t),file=path.join(f.payload,'CONTRACTS.md'),text=await fs.readFile(file,'utf8');
    await fs.writeFile(file,text.replace('## C1. Task entry and resumption','## C1. Task entry and resumption\n\nNew source-recovery exception must remain explicit.'));
    await f.c.refreshChangeCriteria({workId:f.workId,reason:'Preserve changed source-recovery obligations under explicit core delivery'});
    const before=f.ledger();
    const stage='planning-adjudication';
    const prepared=await f.c.changes.bundle(f.workId,{stage,workflowCriteriaInput:{version:2,id:randomUUID()}},'adjudicator');
    const view=prepared.bundle.context.workflowCriteria;assert.equal(view.version,2);assert.equal(view.profile,'adjudication-v2');
    assert.equal(view.catalogue.find(row=>row.side==='current'&&row.section==='C1').delivery,'read');
    assert.ok(view.additionalChangedBlocks.some(block=>block.text.includes('New source-recovery exception must remain explicit')));
    assert.match(JSON.stringify(prepared.bundle),/New source-recovery exception must remain explicit/);
    const restored=resolveCriteriaDelivery(prepared.evidence[0].contents,view);assert.ok(restored.current.text.includes('New source-recovery exception'));prepared.assertCurrent();
    const row=f.c.store.one('SELECT * FROM change_versions WHERE id=?',view.current.id);
    try {
        f.c.store.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),changedAfterCoreCapture:true}),row.id);
        assert.throws(prepared.assertCurrent,/criteria source changed/);
    } finally {f.c.store.run('UPDATE change_versions SET data=? WHERE id=?',row.data,row.id);}
    prepared.assertCurrent();
    await assert.rejects(fs.access(prepared.evidence[0].manifest.path),{code:'ENOENT'});
    await assert.rejects(f.c.changes.bundle(f.workId,{stage:'review-adjudication',workflowCriteriaInput:{version:2,id:randomUUID()}},'adjudicator'),/SELECTED_REVIEW_EVIDENCE_UNAVAILABLE/);
    await assert.rejects(f.c.changes.bundle(f.workId,{stage:'planning',workflowCriteriaInput:{version:2,id:randomUUID()}},'planner'),/criteria declaration unavailable/);
    assert.deepEqual(f.ledger(),before);f.pass();
});
