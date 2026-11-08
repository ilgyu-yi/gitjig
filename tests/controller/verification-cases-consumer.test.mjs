import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateRuntimeProfile} from '../../dist/execution/container-scope.js';
import {openController} from '../../dist/controller/index.js';
import {runtimeFixtureProfile,runtimeFixtureConfig,runtimeFixtureRoot} from '../runtime/profile.mjs';
import {fixtureRoleText} from '../workflow/current-verification-fixture.mjs';
import {amendmentModel} from './check-amendment-fixture.mjs';
import {verificationReportExample} from '../../dist/workflow/verification-contract.js';
import {parseCheckOutput} from '../../dist/workflow/protocol.js';

const fixed = "module.exports=input=>{if(input.kind!=='ok')throw Error('rejected-'+input.id);return 'accepted-'+input.id};\n";
const cases = Array.from({length: 3}, (_, id) => [
    {id: 'valid-'+id, kind: 'healthy', input: {kind: 'ok', id}, outcome: 'return', value: 'accepted-'+id},
    {id: 'invalid-'+id, kind: 'adverse', input: {kind: 'invalid', id}, outcome: 'rejection', value: 'rejected-'+id},
]).flat();

function modelWithConsumer(inlineCommand) {
    return amendmentModel({presentRole({role,result,tool,context}) {
        if (role === 'implementer' && tool?.name === 'write')
            tool.arguments.content = fixed;
        if (role === 'planner') {
            result.plan.intent = 'Accept valid typed input and reject invalid typed input.';
            result.plan.requirements[0].text = 'Accept kind ok and reject kind invalid, preserving input identity in the observation.';
            const check = result.plan.verification.checks[0];
            check.id = 'routing';
            check.assertions = ['rejects-invalid', 'suite'];
            check.cases = cases.map(({id,kind,input,outcome,value}) => ({
                id, kind, guaranteeIds: ['R1'], consumerPaths: ['consumer.cjs'],
                derivation: kind === 'healthy' ? 'Valid owner input must reach the actual consumer' : 'The actual consumer must reject invalid owner input',
                input: {literalUtf8: JSON.stringify(input), fixturePaths: []},
                expected: {kind: outcome, value},
            }));
            if (inlineCommand) {
                check.command = inlineCommand;
                check.fixturePaths = ['consumer.cjs'];
                check.expectationPaths = [];
                result.plan.verification.requiredPaths = ['consumer.cjs'];
                result.plan.verification.reviewRoles[0].requiredPaths = ['consumer.cjs'];
                result.plan.requirements.push({id:'scope',text:'Change only consumer.cjs.',source:context.ownerSource});
                result.plan.verification.strategies = [
                    {kind:'consumer-cases',requirementId:'R1',checkIds:['routing']},
                    {kind:'manifest-scope-duty',requirementId:'scope',allowedChangePaths:['consumer.cjs'],unchangedPaths:[],reviewKey:'general'},
                ];
            }
        }
        return fixtureRoleText(result, context);
    }});
}

test('actual file-backed and inline commands route every healthy/adverse pair into the candidate function', {timeout: 20000}, async () => {
    const runtimeProfile = {...runtimeFixtureProfile(), dockerConfigDirectory: runtimeFixtureConfig()};
    await validateRuntimeProfile(runtimeProfile);
    const parent = await runtimeFixtureRoot();
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'case-consumer-')));
    const home = path.join(root, 'home');
    const checker = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const descriptor = JSON.parse(fs.readFileSync('/input/verification-cases.json', 'utf8'));
const rosterPath = '/input/verification-assertions.json';
const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
for (const field of ['runId', 'candidateDigest', 'boundVersions', 'checkBinding']) {
    assert.deepEqual(roster[field], descriptor[field]);
}
assert.equal(roster.caseDescriptorHash, createHash('sha256').update(JSON.stringify(descriptor)).digest('hex'));
assert.deepEqual(roster.assertionIds, ['rejects-invalid', 'suite']);
assert.throws(() => fs.writeFileSync(rosterPath, 'changed'), {code: 'EROFS'});
const consume = require('./consumer.cjs');
${verificationReportExample}
report(literalUtf8 => {
    const input = JSON.parse(literalUtf8);
    try { return {kind: 'return', value: consume(input)}; }
    catch (error) { return {kind: 'rejection', value: error.message}; }
}, new Map([
    ['suite', cases => cases.every(({id, observed}) => {
        const expected = descriptor.cases.find(entry => entry.id === id).declaration.expected;
        return observed.kind === expected.kind && observed.value === expected.value;
    })],
    ['rejects-invalid', cases => cases.filter(({observed}) => observed.kind === 'rejection').length === 3],
]));
`;
    const previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(home, 'artifacts');
    let c, success = false;
    try {
        c = await openController({installationHome: home, runtimeProfile});
        for (const projectId of ['file', 'inline']) {
            const inline = projectId === 'inline';
            const source = path.join(root, projectId);
            await fs.mkdir(source);
            await fs.writeFile(path.join(source, 'consumer.cjs'), "module.exports=input=>'accepted-'+input.id;\n");
            if (!inline) await fs.writeFile(path.join(source, 'check.cjs'), checker);
            const command = inline ? "node - <<'CHECK'\n" + checker + 'CHECK\n' : undefined;
            await c.registerProject({id: projectId, sourceRoot: source});
            const request = 'Consumer accepts kind ok and rejects invalid typed input; preserve input id in return/rejection observation.' +
                (inline ? ' Change only consumer.cjs.' : '');
            const begun = await c.beginChange({projectId, request, executionLimit: 24, resolutionLimit: 12});
            const workId = begun.workId, model = modelWithConsumer(command);
            if (inline) {
                await c.planChange({workId, model});
                await c.implementChange({workId, model});
                const checked = await c.checkChange({workId});
                assert.equal(checked.phase, 'CHECKED');
                const [receipt] = checked.checks;
                assert.equal(receipt.status, 'pass');
                const original = JSON.stringify(receipt.data);
                const withoutStdout = structuredClone(receipt.data);
                delete withoutStdout.actual.stdout;
                c.store.run('UPDATE check_runs SET data=? WHERE id=?', JSON.stringify(withoutStdout), receipt.id);
                const missing = c.inspectChange(workId);
                assert.equal(missing.checks[0].status, 'pass');
                assert.match(missing.verificationEvidence.requirements.find(entry => entry.kind === 'consumer-cases').reason,
                    /lacks an authenticated passing report/);

                const contradictory = structuredClone(receipt.data);
                const report = JSON.parse(contradictory.actual.stdout);
                report.assertions[0].passed = false;
                contradictory.actual.stdout = JSON.stringify(report);
                contradictory.parsed = parseCheckOutput(contradictory.actual.stdout);
                c.store.run('UPDATE check_runs SET data=? WHERE id=?', JSON.stringify(contradictory), receipt.id);
                const refused = await c.reviewChange({workId, model});
                assert.equal(refused.checks[0].status, 'pass');
                assert.match(refused.verificationEvidence.requirements.find(entry => entry.kind === 'consumer-cases').reason,
                    /lacks an authenticated passing report/);
                assert.equal(refused.launches.some(launch => launch.role === 'reviewer'), false);
                assert.deepEqual(refused.execution, checked.execution);
                assert.deepEqual(refused.resolution, checked.resolution);
                c.store.run('UPDATE check_runs SET data=? WHERE id=?', original, receipt.id);
            }
            const view = await c.driveChange({workId, model});
            assert.equal(view.reviewReady, true, JSON.stringify(view.blocked));
            const reviewers = view.launches.filter(launch => launch.role === 'reviewer');
            assert.deepEqual(reviewers.map(launch => [launch.status, launch.data.workflowCriteria.profile]), [['COMPLETE', 'fresh-review-v3']]);
            assert.equal(view.checks.length, 1);
            const [check] = view.checks;
            assert.equal(check.status, 'pass');
            if (inline) {
                assert.equal(check.data.check.command, command);
                assert.deepEqual(c.inspectChangeResult(begun.workId).changes.entries.map(entry => entry.path), ['consumer.cjs']);
            }
            assert.equal(check.data.caseResults.complete, true);
            assert.equal(check.data.actual.exitCode, 0);
            assert.deepEqual(check.data.parsed.value.assertions, ['rejects-invalid', 'suite'].map(id => ({id,passed:true})));
            assert.deepEqual(check.data.parsed.value.cases.map(({id,observed}) => ({id,...observed})),
                cases.map(({id,outcome,value}) => ({id,kind:outcome,value})));
            assert.equal(check.data.caseDescriptor.cases[1].declaration.input.literalUtf8, '{"kind":"invalid","id":0}');
            assert.deepEqual(Object.keys(check.data.caseDescriptor), ['version','runId','candidateDigest','boundVersions','checkBinding','cases']);
            const rosterBytes = await fs.readFile(path.join(check.data.caseInputRoot, 'verification-assertions.json'));
            const run = c.store.one('SELECT data FROM runs WHERE id=?',check.run);
            assert.equal(JSON.parse(run.data).assertionRosterSha256, createHash('sha256').update(rosterBytes).digest('hex'));
            console.log(JSON.stringify({pairedCaseCount: 6, actualInvocations: 1, checkDurationMs: check.data.durationMs, execution: view.execution, resolution: view.resolution}));
        }
        success = true;
    } finally {
        try { await c?.close(); }
        finally {
            if (previousTmp === undefined) delete process.env.TMPDIR;
            else process.env.TMPDIR = previousTmp;
        }
        if (success) await fs.rm(root, {recursive: true, force: true});
        else console.error('Preserved '+root);
    }
});
