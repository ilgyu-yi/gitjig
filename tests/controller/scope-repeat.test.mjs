// Deterministic host-predicate control. Actual charged author/repair is a separate runtime consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeCore } from '../../dist/controller/change-core.js';
test('identical candidate/scope failure holds before further authoring; new content can receive a fresh repair decision', () => {
    const obligations = new Map(), versions = new Map();
    let n = 0, phase;
    const strategy = {
        requirementId: 'scope', kind: 'manifest-scope-duty', allowedChangePaths: [
            'a'
        ], unchangedPaths: [
            'b'
        ], reviewKey: 'review'
    };
    let digest = 'same';
    const core = new ChangeCore({
        store: {
            one(sql, id) {
                return obligations.has(id) ? {
                    data: obligations.get(id)
                } : undefined;
            }, run(sql, id, work, data) {
                obligations.set(id, data);
            }
        }
    });
    core.strategies = () => [
        strategy
    ];
    core.scopeReceipt = () => undefined;
    core.verificationPremises = () => ({
        base: 'B', plan: 'P'
    });
    core.scopeEvidence = () => ({
        candidate: {
            digest
        }, actual: {
            satisfied: false, violationDigest: 'outside-b', deltaDigest: digest
        }
    });
    core.newVersion = (work, kind, artifact, data) => {
        const id = 'E' + (++n);
        versions.set(id, {
            data
        });
        return id;
    };
    core.version = id => versions.get(id);
    core.phase = (work, value, patch) => {
        phase = {
            value, ...patch
        };
    };
    assert.equal(core.observeScopeStrategies('W'), false);
    assert.equal(phase.value, 'REPAIR_REQUIRED');
    assert.equal(core.observeScopeStrategies('W'), false);
    assert.equal(phase.value, 'BLOCKED');
    assert.equal(phase.resumeStage, 'checks');
    assert.match(phase.nextAction, /no automatic author retry/);
    digest = 'meaningfully-different';
    assert.equal(core.observeScopeStrategies('W'), false);
    assert.equal(phase.value, 'REPAIR_REQUIRED');
    assert.equal(versions.size, 3);
});
