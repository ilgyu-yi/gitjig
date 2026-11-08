import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {openController} from '../../dist/controller/index.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';

test('grammar2 collection preserves both duplicate literal finding arrays without accepting the malformed reply',async t=>{
 const root=await temporaryDirectory('review-fenced-collection'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'mode.cjs'),'module.exports=3;\n');
 const c=await openController({installationHome:path.join(root,'home')});t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});
 await c.registerProject({id:'P',sourceRoot:source});const w=await c.beginChange({projectId:'P',request:'Preserve original received claims'}),run=c.inspectWork(w.workId).runs[0];
 const metadata={stage:'review-adjudication',reviewResolutionInput:{version:2}};
 c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','judge',w.workId,run.id,'adjudicator',w.epoch,'COMPLETE','none',JSON.stringify(metadata));
 const finding=description=>({requirementId:'R1',severity:'blocking',repair:'substantive',description,evidence:['mode.cjs']});
 const first=finding('First original claim'),second=finding('Second original claim');
 const raw='```json\n{"version":1,"summary":"Duplicate literal arrays","findings":'+JSON.stringify([first])+',"findings":'+JSON.stringify([second])+',"assessedScope":[],"decisions":[]}\n```';
 const parsed=parseRoleOutput(raw,'adjudicator',[],{reviewResolution:{version:2,stage:'review-adjudication'}});assert.equal(parsed.value,null);assert.match(parsed.issues.join(),/duplicate/);
 const id=c.changeCore.collect(w.workId,'judge',{role:'adjudicator',rawFinal:raw,issues:parsed.issues,exposures:[],terminal:'complete',historyRef:null,rawFinalTruncated:false,protocol:null,events:[],providerRequests:0},false);
 const output=c.store.one('SELECT * FROM role_outputs WHERE id=?',id),claims=c.store.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',id).map(x=>JSON.parse(x.data).finding);
 assert.equal(output.raw,raw);assert.equal(output.status,'unusable');assert.deepEqual(claims.slice(0,2),[first,second]);assert.equal(claims.length,3);assert.equal(claims[2].requirementId,'producer-integrity');
});

for (const version of [1, 2, 3]) test(`grammar${version} pending root keeps 74 duties open and repaired syntax cannot invent repair evidence`, async t => {
    const root = await temporaryDirectory('review-resolution'), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'mode.cjs'), 'module.exports = value => value;\n');
    let c = await openController({installationHome: home});
    t.after(async () => { await c.close(); await fs.rm(root, {recursive: true, force: true}); });
    await c.registerProject({id: 'P', sourceRoot: source});
    const work = await c.beginChange({projectId: 'P', request: 'Normalize the actual requested mode'});
    const s = c.store, core = c.changeCore, run = c.inspectWork(work.workId).runs[0];
    const ids = Array.from({length: 74}, (_, index) => 'finding-' + index);
    const refs = {version: 3, occurrenceIds: ids, diagnosisOccurrenceIds: [], pendingOrdinaryIndexes: ids.map((_, i) => i),
        blockingOrdinaryIndexes: ids.map((_, i) => i), retentionChoices: []};
    const profile = {version, stage: 'review-adjudication'};
    s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', 'origin', work.workId, run.id, 'reviewer', work.epoch, 'COMPLETE', 'none',
        JSON.stringify({inputVersions: {candidate: work.baseVersion}}));
    s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)', 'output', 'origin', '{}', 'usable', '{}');
    s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', 'judge', work.workId, run.id, 'adjudicator', work.epoch, 'COMPLETE', 'none',
        JSON.stringify({stage: 'review-adjudication', reviewResolutionInput: {version}, decisionReferences: refs}));
    for (const [index, id] of ids.entries()) {
        const finding = {requirementId: 'R', severity: version === 3 && index % 2 === 0 ? 'optional' : 'blocking', repair: 'substantive', description: 'Actual mode normalization defect', evidence: ['base:mode.cjs']};
        s.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)', id, 'output', index, work.workId, JSON.stringify({finding, launchId: 'origin', role: 'reviewer'}));
        s.run('INSERT INTO obligations VALUES(?,?,?)', id, work.workId, JSON.stringify({kind: 'finding', occurrence: id, state: 'resolved'}));
    }
    const wire = {version: 1, summary: 'Independent current judgments', findings: [], assessedScope: [],
        decisions: ids.map((id, i) => ({occurrenceId: id, disposition: i === 0 ? 'upheld' : 'equivalent',
            ...(i === 0 ? {resolution: 'pending'} : {equivalentTo: ids[0]}), reason: 'Actual reviewed evidence', witnesses: version === 3 ? [] : ['base:mode.cjs']}))};
    const parsed = parseRoleOutput(JSON.stringify(wire), 'adjudicator', [], {decisionReferences: refs, reviewResolution: profile});
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.value.decisions[0].resolution, version === 3 ? 'pending' : undefined);
    const budgets = s.all('SELECT * FROM budgets');
    s.tx(() => core.dispositions(work.workId, 'judge', parsed.value));
    assert.equal(core.pending(work.workId).filter(item => item.kind === 'finding').length, 74);
    assert.deepEqual(s.all('SELECT * FROM budgets'), budgets);
    assert.equal(core.pending(work.workId).some(item => item.kind === 'diagnostic'), false);
    const repaired = structuredClone(wire);
    const repairTarget = version === 3 ? 1 : 0;
    repaired.decisions[repairTarget] = {occurrenceId: ids[repairTarget], disposition: 'upheld', resolution: 'repaired', reason: 'Claimed current repair', witnesses: ['base:mode.cjs']};
    for (const decision of repaired.decisions) decision.witnesses = ['base:mode.cjs'];
    const acceptedSyntax = parseRoleOutput(JSON.stringify(repaired), 'adjudicator', [], {decisionReferences: refs, reviewResolution: profile});
    assert.deepEqual(acceptedSyntax.issues, []);
    const before = s.all('SELECT * FROM finding_dispositions'), duties = s.all('SELECT * FROM obligations');
    assert.throws(() => s.tx(() => core.dispositions(work.workId, 'judge', acceptedSyntax.value)), /Repair closure/);
    assert.deepEqual(s.all('SELECT * FROM finding_dispositions'), before);
    assert.deepEqual(s.all('SELECT * FROM obligations'), duties);
    if (version === 3) {
        await c.close();
        c = await openController({installationHome: home});
        assert.equal(c.changeCore.pending(work.workId).filter(item => item.kind === 'finding').length, 74);
        const retained = c.store.all('SELECT data FROM finding_dispositions').map(row => JSON.parse(row.data));
        assert.equal(retained.find(row => row.occurrenceId === ids[0]).resolution, 'pending');
    }

});
