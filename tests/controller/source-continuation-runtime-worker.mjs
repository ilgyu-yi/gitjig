import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { scripted, withValueCases } from './effect-fixture.mjs';

const [world, scenario] = process.argv.slice(2);
const home = path.join(world, 'home'), source = path.join(world, 'project');
assert.equal(process.env.TMPDIR, path.join(home, 'artifacts'));
const runtimeProfile = JSON.parse(process.env.GITJIG_SOURCE_CONTINUATION_RUNTIME);
const report = { scenario, world, learnedModel: false, contextWindow: 200000, observations: [] };
let c;
try {
    await fs.mkdir(source);
    const original = 'module.exports=2;\n';
    const checker = withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3,actual:String(value)}]}));\n");
    await fs.writeFile(path.join(source, 'consumer.cjs'), original);
    await fs.writeFile(path.join(source, 'check.cjs'), checker);
    c = await openController({ installationHome: home, runtimeProfile });
    await c.registerProject({ id: 'P', sourceRoot: source });
    const { workId } = await c.beginChange({ projectId: 'P', request: 'Consumer exports3 instead of2. Preserve the original source and checker.', executionLimit: 24, resolutionLimit: 12 });
    report.workId = workId;
    const requests = [];
    const completed = scenario.startsWith('complete');
    let failFit = false, failAuthor = false, originalFinding, originalRepair;
    const model = scripted(() => { throw Error('No ordinary request expected'); }, ({ role, body, result }) => {
        requests.push(body.context.stage);
        if (role === 'planner') result.findings = [{ requirementId: 'R1', severity: 'blocking', repair: 'substantive', description: 'Original BASE exports2 instead of3', evidence: ['base:consumer.cjs'] }];
        if (role === 'adjudicator' && body.context.stage === 'planning-adjudication') {
            if (body.context.decisionCarry?.version === 3) assert.ok(body.context.decisionCarry.baseSourceIds.includes('base:consumer.cjs'));
            result.decisions = body.context.occurrences.map(o => ({ occurrenceId: o.id, disposition: 'upheld', reason: 'Actual baseline defect belongs to the independently accepted implementation plan', witnesses: ['base:consumer.cjs'], implementation: { kind: 'assign-to-plan', baselineVersion: body.context.baseVersion, requirementIds: ['R1'], ...(body.context.decisionCarry?.version === 3 ? { baseSourceIds: ['base:consumer.cjs'] } : {}) } }));
        }
        if (role === 'adjudicator' && body.context.stage === 'review-adjudication') {
            result.decisions = body.context.occurrences.map(o => ({ occurrenceId: o.id, disposition: 'upheld', resolution: 'repaired', reason: 'Actual candidate, current checker and selected fresh review prove the remedy', witnesses: body.context.checks.filter(x => x.status === 'pass' && x.candidate === body.context.candidateVersion).map(x => x.id) }));
            if (scenario === 'complete-finding') {
                const states = new Map(body.context.obligationStates.map(o => [o.id, o.data.state]));
                const repaired = body.context.occurrences.find(o => o.id === originalFinding && states.get(o.id) === 'resolved');
                if (repaired) {
                    const original = body.context.dispositions.find(d => d.occurrence === repaired.id && d.data.resolution === 'repaired');
                    assert.ok(original, 'Retain the actual original repair disposition');
                    assert.equal(original.id, originalRepair.id);
                    result.retainedDispositions = [original.id];
                    result.decisions = body.context.occurrences.filter(o => states.get(o.id) === 'pending').map(o => ({ occurrenceId: o.id, disposition: 'equivalent', equivalentTo: repaired.id, reason: 'This duplicate observes the same original BASE export2 defect already repaired by the retained candidate and actual checks', witnesses: [original.id] }));
                }
            }
            if (scenario === 'ambiguous') result.inputDecisions.forEach(d => { d.impact = 'ambiguous'; });
        }
        if (scenario === 'complete-finding' && body.context.stage === 'source-fit' && !failFit) {
            result.findings = [{ requirementId: 'R1', severity: 'blocking', repair: 'substantive', description: 'Original BASE exports2 instead of the required3', evidence: ['base:consumer.cjs'] }];
        }
        if (body.context.stage === 'source-fit') assert.deepEqual(body.context.sourceFitInput, {version: 1});
        if (failFit && body.context.stage === 'source-fit') {
            failFit = false;
            delete result.inputDecisions; // Omit the actual held-input duty; findings remain readable.
        }
        if (failAuthor && role === 'implementer') delete result.summary;
    });
    // Deliberate profile for these new controls, not a retry of the sealed 100k comparison.
    model.definition.models[0].contextWindow = 200000;
    const op = { workId, model };
    const row = () => c.store.one('SELECT * FROM change_state WHERE work=?', workId);
    const data = () => JSON.parse(row().data);
    const held = () => c.changeCore.h.sourceImpacts(workId).filter(i => i.data.effectHold);
    const stages = () => c.store.all("SELECT id,status,json_extract(data,'$.stage') AS stage FROM role_launches WHERE work=? ORDER BY rowid", workId);
    const duties = () => c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid');
    const feedback = async (text, withdraw = true) => {
        const launch = c.store.one("SELECT * FROM role_launches WHERE work=? AND status='COMPLETE' ORDER BY rowid DESC LIMIT 1", workId);
        const view = c.listConversations().find(v => v.workId === workId && c.store.one('SELECT data FROM conversation_state WHERE conversation=?', v.conversationId) && JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', v.conversationId).data).runId === launch.run);
        assert.ok(view);
        const receipt = await c.queueConversationInputWithContext({ conversationId: view.conversationId, expectedGeneration: view.generation, text, mode: 'idle' });
        if (withdraw) {
            const input = c.inspectConversationInputs(view.conversationId).find(i => i.inputId === receipt.inputId);
            assert.equal(input.withdrawEligible, true);
            c.recoverConversationInput({ conversationId: view.conversationId, inputId: input.inputId, expectedContext: input.fingerprint, action: 'withdraw' });
            assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', input.inputId).state, 'CONFLICTED');
        }
        assert.ok(held().some(i => i.source === receipt.sourceId));
        return receipt;
    };
    const preauthor = ['implement', 'author-failed'].includes(scenario);
    const prefix = ['planChange', ...(preauthor ? [] : ['implementChange']), ...(['implement', 'author-failed', 'checks', 'checks-scope'].includes(scenario) ? [] : ['checkChange']), ...(['implement', 'author-failed', 'checks', 'checks-scope', 'review'].includes(scenario) ? [] : ['reviewChange'])];
    for (const method of prefix) {
        const view = await c[method](op);
        assert.notEqual(view.phase, 'BLOCKED', JSON.stringify(view.blocked));
    }
    assert.equal(c.inspectChange(workId).occurrences.length, 1, 'Genuine planner BASE finding must be retained');
    originalFinding = c.inspectChange(workId).occurrences[0].id;
    if (completed) {
        const ready = await c.resolveChange(op);
        assert.equal(ready.phase, 'REVIEW_READY', JSON.stringify(ready.blocked));
        originalRepair = c.store.one('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', originalFinding);
    }
    const small = { ...model, definition: { ...model.definition, models: model.definition.models.map(m => ({ ...m, contextWindow: 1000 })) } };
    if (scenario === 'author-failed') {
        failAuthor = true;
        const failedAuthor = await c.implementChange(op);
        failAuthor = false;
        assert.equal(failedAuthor.phase, 'BLOCKED');
        assert.equal(c.changeCore.hasUnstartedAcceptedPlan(workId), false, 'An admitted failed author must retain the original retry proof');
    }
    const originalStage = completed ? 'complete' : { implement: 'implement', 'author-failed': 'implement', checks: 'checks', 'checks-scope': 'checks', review: 'review' }[scenario];
    await feedback(['scope', 'checks-scope'].includes(scenario) ? 'The requirement now changes: consumer must export value4.' : 'Keep consumer export3; this only explains the original requirement.');
    const before = c.inspectChange(workId), beforeDuties = duties(), judgeBefore = data().verificationJudge;
    const checkpointBefore = row();
    const sourceRows = held().map(i => c.store.one('SELECT * FROM sources WHERE id=?', i.source));
    const offset = stages().length;
    requests.length = 0;
    if (originalStage) {
        assert.equal(c.changeCore.inspectModelPrerequisites(workId).stage, 'source-fit');
        const failed = await c.driveChange({ ...op, model: small, maximumSteps: 1 });
        assert.equal(failed.phase, 'BLOCKED');
        assert.equal(data().resumeStage, originalStage);
        assert.equal(held().length, 1);
        assert.equal(requests.length, 0, 'Context refusal must precede model callback');
        assert.deepEqual(stages().slice(offset), [], 'Known context refusal precedes reservation');
        assert.equal(failed.execution.consumed, before.execution.consumed);
        assert.equal(failed.resolution.consumed, before.resolution.consumed);
        report.observations.push({ step: 'explicit-small-profile-refusal', checkpoint: data().resumeStage, execution: failed.execution, resolution: failed.resolution });
        failFit = true;
        const unusable = await c.driveChange({ ...op, maximumSteps: 1 });
        assert.equal(unusable.phase, 'BLOCKED');
        assert.equal(data().resumeStage, originalStage);
        assert.equal(held().length, 1);
        assert.deepEqual(stages().slice(offset).map(l => [l.stage, l.status]), [['source-fit', 'UNUSABLE']]);
        assert.equal(unusable.execution.consumed, failed.execution.consumed + 1);
        assert.equal(unusable.resolution.consumed, failed.resolution.consumed + 1);
        assert.equal(c.changeCore.pending(workId).filter(o => o.kind === 'diagnostic').length, 1);
        assert.equal(c.changeCore.pending(workId).filter(o => o.kind === 'raw-findings-incomplete').length, 0);
        report.observations.push({ step: 'actual-malformed-producer-refusal', checkpoint: data().resumeStage, execution: unusable.execution, resolution: unusable.resolution });
        requests.length = 0;
        let restoreReady, restoreFit, newFinding;
        if (scenario === 'complete-finding') {
            const core = c.changeCore, fit = core.fitSource;
            core.fitSource = async function(...args) {
                const result = await fit.apply(this, args);
                if (!held().length) {
                    const findings = core.pending(workId).filter(o => o.kind === 'finding');
                    assert.equal(findings.length, 1);
                    newFinding = findings[0].id;
                    assert.notEqual(newFinding, originalFinding);
                    assert.equal(c.inspectChange(workId).occurrences.length, 2);
                    assert.equal(c.inspectChange(workId).reviewReady, false, 'Source-fit alone cannot accept a newly received finding');
                    report.newFinding = newFinding;
                }
                return result;
            };
            restoreFit = () => { core.fitSource = fit; };
        }
        if (scenario === 'complete-stale') {
            const core = c.changeCore, ready = core.ready;
            core.ready = async function(work) {
                const review = c.store.one('SELECT * FROM role_launches WHERE id=?', Object.values(data().selection)[0]);
                const metadata = JSON.parse(review.data);
                try {
                    c.store.run('UPDATE role_launches SET data=? WHERE id=?', JSON.stringify({ ...metadata, verificationInputBinding: 'changed-at-completion' }), review.id);
                    return await ready.call(this, work);
                } finally { c.store.run('UPDATE role_launches SET data=? WHERE id=?', review.data, review.id); }
            };
            restoreReady = () => { core.ready = ready; };
        }
        let after;
        try { after = await c.driveChange({ ...op, maximumSteps: 1 }); } finally { restoreReady?.(); restoreFit?.(); }
        assert.equal(held().length, 0);
        assert.equal(stages().slice(offset)[1].stage, 'source-fit');
        assert.equal(c.changeCore.pending(workId).filter(o => o.kind === 'diagnostic').length, 0);
        if (scenario === 'complete-stale') {
            assert.equal(after.reviewReady, false);
            assert.equal(after.phase, 'BLOCKED');
            assert.match(after.blocked.join(), /review|stale|current|evidence/i);
        } else if (scenario === 'complete') {
            assert.equal(after.phase, 'REVIEW_READY', JSON.stringify(after.blocked));
            assert.equal(after.reviewReady, true);
            assert.deepEqual(requests, ['source-fit']);
        } else if (scenario === 'complete-finding') {
            assert.deepEqual(requests, ['source-fit', 'review-adjudication'], 'Newly received findings require final independent accounting before completion reuse');
            assert.ok(newFinding);
            const judge = stages().at(-1);
            const disposition = c.store.one('SELECT * FROM finding_dispositions WHERE occurrence=? AND launch=?', newFinding, judge.id);
            assert.ok(disposition, 'The new received finding needs an actual independent final disposition');
            assert.equal(disposition.status, 'equivalent');
            assert.equal(JSON.parse(disposition.data).equivalentTo, originalFinding);
            assert.deepEqual(c.store.one('SELECT * FROM finding_dispositions WHERE id=?', originalRepair.id), originalRepair);
            assert.equal(after.reviewReady, true, JSON.stringify(after.blocked));
            report.newFindingDisposition = disposition;
        } else if (scenario === 'checks-scope') {
            assert.equal(after.phase, 'PLAN_READY', JSON.stringify(after.blocked));
            assert.notEqual(after.planVersion, before.planVersion);
            assert.deepEqual(requests, ['source-fit', 'planning', 'planning-challenge', 'planning-adjudication']);
        } else {
            assert.equal(after.phase, { implement: 'CANDIDATE_CAPTURED', 'author-failed': 'CANDIDATE_CAPTURED', checks: 'CHECKED', review: 'RESOLVING' }[scenario], JSON.stringify(after.blocked));
            assert.ok(requests.includes('source-fit'));
        }
        assert.equal(after.execution.limit, before.execution.limit);
        assert.equal(after.resolution.limit, before.resolution.limit);
        assert.ok(after.execution.consumed > failed.execution.consumed);
        report.observations.push({ step: 'explicit-original-profile-recovery', phase: after.phase, execution: after.execution, resolution: after.resolution, blocked: after.blocked });
    } else {
        assert.equal(c.changeCore.inspectModelPrerequisites(workId).stage, 'resolve');
        let restore;
        if (scenario === 'drift') {
            const core = c.changeCore, originalPrevalidate = core.prevalidateDiagnoses;
            core.prevalidateDiagnoses = async function(...args) {
                const proof = await originalPrevalidate.apply(this, args);
                await feedback('A late explanation must be independently accounted as actual new source.', false);
                return proof;
            };
            restore = () => { core.prevalidateDiagnoses = originalPrevalidate; };
        }
        let after;
        try { after = await c.driveChange({ ...op, maximumSteps: 1 }); } finally { restore?.(); }
        assert.deepEqual(stages().slice(offset).map(l => l.stage), ['review-adjudication']);
        assert.deepEqual(requests, ['review-adjudication']);
        if (scenario === 'explanation') {
            assert.equal(after.phase, 'REVIEW_READY', JSON.stringify(after.blocked));
            assert.equal(after.reviewReady, true);
            assert.equal(held().length, 0);
            assert.equal(c.changeCore.pending(workId).filter(o => o.kind === 'finding').length, 0);
            assert.equal(duties().length, beforeDuties.length + 1);
        } else {
            assert.equal(after.reviewReady, false);
            assert.ok(held().length > 0);
            assert.deepEqual(duties(), beforeDuties);
            assert.equal(data().verificationJudge, judgeBefore);
            assert.equal(after.candidateVersion, before.candidateVersion);
            if (scenario === 'drift') assert.deepEqual(row(), checkpointBefore, 'Late source must not overwrite the admitted procedure checkpoint');
            if (scenario === 'scope') {
                assert.equal(data().resumeStage, 'plan');
                assert.equal(c.changeCore.inspectModelPrerequisites(workId).stage, 'plan');
                const replanOffset = stages().length;
                const replanned = await c.driveChange({ ...op, maximumSteps: 1 });
                assert.equal(replanned.phase, 'PLAN_READY', JSON.stringify(replanned.blocked));
                assert.notEqual(replanned.planVersion, before.planVersion);
                assert.deepEqual(stages().slice(replanOffset).map(l => l.stage), ['planning', 'planning-challenge', 'planning-adjudication']);
                assert.equal(held().length, 0);
            }
        }
        assert.equal(after.execution.consumed, before.execution.consumed + 1);
        assert.equal(after.resolution.consumed, before.resolution.consumed + 1);
        report.observations.push({ phase: after.phase, blocked: after.blocked, execution: after.execution, resolution: after.resolution });
    }
    for (const saved of sourceRows) assert.deepEqual(c.store.one('SELECT * FROM sources WHERE id=?', saved.id), saved);
    assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), original);
    assert.equal(await fs.readFile(path.join(source, 'check.cjs'), 'utf8'), checker);
    const final = c.inspectChange(workId);
    assert.equal(final.execution.reserved, 0);
    assert.equal(final.resolution.reserved, 0);
    report.complete = true;
} catch (error) {
    report.error = String(error.stack ?? error);
    process.exitCode = 1;
} finally {
    await c?.close();
    report.closed = !!c;
    await fs.writeFile(path.join(world, 'receipt.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify(report));
