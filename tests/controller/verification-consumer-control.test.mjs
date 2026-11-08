import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {changeResultText} from '../../dist/ui/change-result.js';
import {openController} from '../../dist/controller/index.js';
import {runtimeFixtureProfile, runtimeFixtureConfig, runtimeFixtureRoot} from '../runtime/profile.mjs';
import {fixtureRoleText} from '../workflow/current-verification-fixture.mjs';
import {amendmentModel, correct} from './check-amendment-fixture.mjs';

test('independently accepted consumer replacement must produce the exact planned outcome before review', {timeout:75000}, async () => {
    const runtimeProfile = {...runtimeFixtureProfile(), dockerConfigDirectory: runtimeFixtureConfig()};
    const root = await fs.mkdtemp(path.join(await runtimeFixtureRoot(), 'consumer-control-'));
    const home = path.join(root, 'home'), previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(home, 'artifacts');
    let c, success = false;
    try {
        c = await openController({installationHome: home, runtimeProfile});
        for (const kind of ['exact', 'weak-checker', 'wrong-prediction', 'reviewer-replacement', 'wrong-reviewer-replacement', 'conforming-base', 'overrestrictive-checker', 'conforming-reviewer-replacement']) {
            const source = path.join(root, kind);
            const proposed = kind.endsWith('reviewer-replacement');
            const expectedPass = kind.startsWith('conforming-') || kind === 'overrestrictive-checker';
            const expectedMatch = kind === 'exact' || kind === 'reviewer-replacement' || kind.startsWith('conforming-');
            const replacementFile = expectedPass ? 'alternative.txt' : 'defective.txt';
            const replacement = expectedPass ? "module.exports = Number('3');\n" : 'module.exports=4;\n';
            await fs.mkdir(source);
            await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
            if (!proposed) await fs.writeFile(path.join(source, replacementFile), replacement);
            let checker = correct;
            if (kind === 'weak-checker') checker = correct.replaceAll("require('./consumer.cjs')", '3');
            if (kind === 'overrestrictive-checker') checker = correct.replace('===3', "===3 && require('fs').readFileSync('consumer.cjs','utf8').includes('exports=3')");
            await fs.writeFile(path.join(source, 'check.cjs'), checker);
            const reviewPhases = [];
            const model = amendmentModel({presentRole({result, role, context}) {
                if (context.stage === 'consumer-control-proposal' || context.stage === 'fresh-review') {
                    const current = c.inspectChange(workId);
                    reviewPhases.push({phase: current.recordedPhase, blocked: current.blocked});
                }
                if (role === 'planner') {
                    result.plan.verification.strategies = [{kind:'all-of',requirementId:'R1',parts:[
                        {kind:'consumer-cases',checkIds:['value']},
                        {kind:'manifest-scope-duty',allowedChangePaths:['consumer.cjs'],unchangedPaths:['check.cjs'],reviewKey:'general'},
                    ]}];
                    result.plan.verification.checks[0].consumerControl = {
                        path: 'consumer.cjs',
                        ...(!proposed ? {replacementPath:replacementFile} : {}),
                        failedAssertions: expectedPass ? [] : ['three'],
                        observations: expectedPass ? [] : [
                            {id:'value-healthy',observed:{kind:'rejection',value:kind === 'wrong-prediction' ? '5' : '4'}},
                            {id:'value-adverse',observed:{kind:'return',value:'4'}},
                        ],
                    };
                }
                if (context.stage === 'consumer-control-proposal') {
                    assert.equal(context.consumerControlProposal.path, 'consumer.cjs');
                    delete result.outcome;
                    assert.equal(context.consumerControlProposal.observations.length === 0, expectedPass);
                    const previous = context.consumerControlProposal.previousAttempt;
                    if (previous) {
                        assert.equal(kind, 'wrong-reviewer-replacement');
                        assert.equal(previous.replacement, 'module.exports=5;\n');
                        assert.deepEqual(previous.differences['different predicted observations'].ids, ['value-healthy','value-adverse']);
                    }
                    result.consumerReplacement = expectedMatch || previous ? replacement : 'module.exports=5;\n';
                }
                if (context.stage === 'fresh-review' || context.stage === 'review-adjudication') {
                    const evidence = context.verificationEvidence.find(entry => entry.kind === 'consumer-control-run');
                    assert.equal(evidence.reviewedCandidate.versionId, context.candidateVersion);
                    assert.equal(evidence.expectedOutcome, expectedPass ? 'planned-conforming-pass-matched' : 'planned-adverse-observations-matched');
                    const passing = context.verificationEvidence.find(entry => entry.id === evidence.healthyReceiptId);
                    assert.equal(passing.status, 'pass');
                    assert.equal(passing.candidate, evidence.reviewedCandidate.versionId);
                    assert.notEqual(evidence.isolatedTarget.versionId, evidence.reviewedCandidate.versionId);
                    assert.equal(evidence.executionReceipt.candidate, evidence.isolatedTarget.versionId);
                    assert.equal(evidence.executionReceipt.status, expectedPass ? 'pass' : 'fail');
                    if (proposed) assert.equal(JSON.parse(evidence.executionReceipt.consumerReplacementSource.raw).consumerReplacement, replacement);
                }
                return fixtureRoleText(result, context);
            }});
            await c.registerProject({id: kind, sourceRoot: source});
            const {workId} = await c.beginChange({projectId: kind, request: 'Consumer exports 3. Exercise the planned isolated variant.'});
            const planned = await c.planChange({workId, model});
            assert.equal(planned.phase, 'PLAN_READY', JSON.stringify(planned.blocked));
            if (kind === 'conforming-base') {
                const unrelated = structuredClone(c.changeCore.version(planned.planVersion).data.plan);
                unrelated.verification.checks[0].consumerControl = {path:replacementFile, failedAssertions:[], observations:[]};
                const other = await c.beginChange({projectId:kind, request:'Consumer exports 3.'});
                assert.throws(() => c.changeCore.planningValid(unrelated, other.workId), /must replace a declared consumer/);
            }
            if (kind === 'exact') {
                const dropped = structuredClone(c.changeCore.version(planned.planVersion).data.plan);
                delete dropped.verification.checks[0].consumerControl;
                c.store.run('UPDATE change_state SET plan=NULL,verification=NULL WHERE work=?', workId);
                try {
                    assert.throws(() => c.changeCore.planningValid(dropped, workId), /retain the independently accepted consumer control/);
                } finally {
                    c.store.run('UPDATE change_state SET plan=?,verification=? WHERE work=?', planned.planVersion, planned.verificationVersion, workId);
                }
            }
            await c.implementChange({workId, model});
            const pending = c.inspectChangeResult(workId).checks.entries[0];
            assert.equal(pending.consumerControl, 'pending');
            assert.equal(pending.consumerControlReceiptId, undefined);
            let checked = await c.checkChange({workId});
            if (proposed) {
                assert.equal(checked.phase, 'CHECKED', JSON.stringify(checked.blocked));
                assert.equal(checked.checks.length, 1);
                assert.equal(checked.launches.some(launch => launch.role === 'reviewer'), false);
                checked = await c.reviewChange({workId, model});
                const stages = checked.launches.filter(launch => launch.role === 'reviewer').map(launch => launch.data.stage);
                assert.deepEqual(stages, expectedMatch ? ['consumer-control-proposal','fresh-review'] : ['consumer-control-proposal']);
            }
            const resultView = c.inspectChangeResult(workId);
            const [resultCheck] = resultView.checks.entries;
            assert.equal(resultCheck.status, 'pass');
            assert.equal(resultCheck.consumerControl, expectedMatch ? 'matched' : 'prediction-mismatch');
            assert.equal(resultCheck.consumerControlExpectedPass === true, expectedPass);
            const statusText = changeResultText(resultView, 'en');
            assert.match(statusText, expectedPass ? /Conforming control/i : /fault control/i);
            const candidate = checked.versions.find(version => version.id === checked.candidateVersion);
            assert.equal(await fs.readFile(path.join(candidate.artifact, 'consumer.cjs'), 'utf8'), 'module.exports=3;\n');
            const [healthy,counter] = checked.checks;
            assert.equal(resultView.checks.total, 1);
            assert.equal(resultCheck.receiptId, healthy.id);
            assert.equal(resultCheck.consumerControlReceiptId, expectedMatch ? counter.id : undefined);
            assert.equal(healthy.status, 'pass');
            assert.equal(counter.data.purpose, 'consumer-control');
            assert.notEqual(counter.candidate, healthy.candidate);
            assert.equal(counter.data.cleanup, 'removed');
            assert.equal(counter.data.check.command, healthy.data.check.command);
            if (expectedMatch) {
                assert.equal(checked.phase, proposed ? 'RESOLVING' : 'CHECKED', JSON.stringify(checked.blocked));
                const finished = await c.driveChange({workId, model});
                assert.equal(finished.reviewReady, true, JSON.stringify(finished.blocked));
                const composite = finished.verificationEvidence.requirements.find(item => item.kind === 'all-of');
                const witness = composite.parts.find(part => part.kind === 'consumer-cases');
                assert.deepEqual(witness.witnessIds, [healthy.id, counter.id]);
                const scope = composite.parts.find(part => part.kind === 'manifest-scope-duty');
                assert.equal(scope.witnessAvailability, 'recorded');
                const missing = structuredClone(healthy.data);
                delete missing.actual.stdout;
                c.store.run('UPDATE check_runs SET data=? WHERE id=?', JSON.stringify(missing), healthy.id);
                const unavailable = c.inspectChangeResult(workId);
                assert.equal(unavailable.checks.entries[0].status, 'pass');
                assert.equal(unavailable.checks.entries[0].consumerControl, 'held');
                assert.equal(unavailable.checks.entries[0].consumerControlReceiptId, undefined);
                assert.equal(unavailable.reviewReady, false);
                assert.equal(unavailable.verificationEvidence.availability, 'unavailable');
                const partial = unavailable.verificationEvidence.requirements.find(item => item.kind === 'all-of');
                assert.equal(partial.witnessAvailability, 'unavailable');
                assert.deepEqual(partial.parts.find(part => part.kind === 'manifest-scope-duty'), scope);
                const missingConsumer = partial.parts.find(part => part.kind === 'consumer-cases');
                assert.equal(missingConsumer.witnessAvailability, 'unavailable');
                assert.ok(missingConsumer.reason);
                c.store.run('UPDATE check_runs SET data=? WHERE id=?', JSON.stringify(healthy.data), healthy.id);
                const restored = c.inspectChangeResult(workId);
                assert.equal(restored.reviewReady, true);
                assert.deepEqual(restored.verificationEvidence, finished.verificationEvidence);
                if (proposed) {
                    const proposal = finished.launches.find(launch => launch.data.stage === 'consumer-control-proposal');
                    const output = c.store.one("SELECT id,raw FROM role_outputs WHERE launch=? AND status='usable'", proposal.id);
                    const target = c.store.one('SELECT data FROM change_versions WHERE id=?', counter.candidate);
                    const drifted = JSON.parse(target.data);
                    const replacementRaw = output.raw + ' ';
                    drifted.controlProposal.rawHash = createHash('sha256').update(replacementRaw).digest('hex');
                    c.store.run('UPDATE role_outputs SET raw=? WHERE id=?', replacementRaw, output.id);
                    c.store.run('UPDATE change_versions SET data=? WHERE id=?', JSON.stringify(drifted), counter.candidate);
                    await c.close();
                    c = await openController({installationHome:home, runtimeProfile});
                    const replaced = c.inspectChangeResult(workId);
                    assert.equal(replaced.checks.entries[0].consumerControl, 'held');
                    assert.equal(replaced.checks.entries[0].consumerControlReceiptId, undefined);
                    assert.equal(replaced.reviewReady, false);
                    c.store.run('UPDATE role_outputs SET raw=? WHERE id=?', output.raw, output.id);
                    c.store.run('UPDATE change_versions SET data=? WHERE id=?', target.data, counter.candidate);
                    assert.equal(c.inspectChangeResult(workId).reviewReady, true);
                }
            } else {
                assert.equal(checked.phase, 'BLOCKED', JSON.stringify(checked.blocked));
                assert.match(checked.blocked.join(), /consumer control did not show/);
                if (proposed) {
                    assert.match(checked.nextAction, /request one new independent replacement/);
                    assert.match(checked.blocked.join(), /different predicted observations.*value-healthy.*value-adverse/);
                    const resumed = await c.driveChange({workId, model});
                    assert.equal(resumed.reviewReady, true, JSON.stringify(resumed.blocked));
                    assert.deepEqual(resumed.launches.filter(launch => launch.role === 'reviewer').map(launch => launch.data.stage),
                        ['consumer-control-proposal','consumer-control-proposal','fresh-review']);
                    assert.equal(resumed.checks[0].id, healthy.id);
                    assert.equal(resumed.checks[1].id, counter.id);
                    assert.equal(resumed.candidateVersion, checked.candidateVersion);
                } else {
                    const refused = await c.reviewChange({workId, model});
                    assert.equal(refused.launches.some(launch => launch.data.stage === 'fresh-review'), false);
                }
            }
            if (expectedMatch || proposed) assert.ok(reviewPhases.length);
            for (const view of reviewPhases) assert.deepEqual(view, {phase:'REVIEWING', blocked:[]});
            assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n');
            if (proposed) await assert.rejects(fs.access(path.join(source, replacementFile)), {code:'ENOENT'});
            else assert.equal(await fs.readFile(path.join(source, replacementFile), 'utf8'), replacement);
        }
        success = true;
    } finally {
        await c?.close();
        if (previousTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previousTmp;
        if (success) await fs.rm(root, {recursive:true,force:true});
        else console.error('Preserved ' + root);
    }
});
