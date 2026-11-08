import test from 'node:test';
import assert from 'node:assert/strict';
import { changeCommandResult, changeReplanExitCode, changeResultCommands } from '../../dist/cli/change-result.js';
import { parseInvocation } from '../../dist/cli/arguments.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

test('change status preserves actionable failures and counts without dumping historical evidence', () => {
    const records = Array.from({length: 100}, (_, id) => ({id, raw: 'historical detail '.repeat(1000)}));
    const full = {
        workId: 'W', state: 'ACTIVE', recordedPhase: 'PLANNING', phase: 'BLOCKED', epoch: 4,
        ownerActivation: 'complete', reviewReady: false, modelContextFailure: 'MODEL_CONTEXT_LIMIT',
        planningFailure: {role: 'adjudicator', launchId: 'original-J'},
        blocked: ['Original task exceeds selected capacity. Inspect original-J.'], nextAction: 'Inspect original work W',
        baseVersion: 'B', candidateVersion: 'C', planVersion: null, verificationVersion: null,
        execution: {limit: 7, consumed: 7, reserved: 0}, resolution: {limit: 3, consumed: 3, reserved: 0},
        limitations: ['No publication authority'], modelSource: 'application',
        versions: records, launches: records, checks: records, occurrences: records, dispositions: records,
        verificationEvidence: {availability: 'available', digest: 'bound-digest', requirements: records},
    };
    const before = JSON.stringify(full);
    for (const command of changeResultCommands) {
        const compact = changeCommandResult(command, full, false, '/owned home');
        assert.equal(compact.format, 'change-status-v1'); assert.equal(compact.detailsOmitted, true);
        for (const key of ['workId','state','recordedPhase','phase','epoch','ownerActivation','reviewReady','modelContextFailure','planningFailure','blocked','nextAction','baseVersion','candidateVersion','planVersion','verificationVersion','execution','resolution','limitations','modelSource']) assert.deepEqual(compact[key], full[key], key);
        for (const key of ['versions','launches','checks','occurrences','dispositions']) {assert.equal(compact[key], undefined); assert.equal(compact.recordCounts[key], 100);}
        assert.deepEqual(compact.verificationEvidence, {availability: 'available', digest: 'bound-digest', requirementCount: 100});
        assert.ok(JSON.stringify(compact).length < 2500);
        assert.strictEqual(changeCommandResult(command, full, true, '/owned home'), full);
    }
    assert.equal(JSON.stringify(full), before);
    for (const command of ['change inspect','change list','work extend','effect inspect']) assert.strictEqual(changeCommandResult(command, full, false, '/owned home'), full);
});

test('replan reports success when it adopts a plan for the retained candidate', () => {
    const accepted = { phase: 'CANDIDATE_CAPTURED', blocked: [], verificationReplanAccepted: true };
    assert.equal(changeReplanExitCode({ phase: 'PLAN_READY', blocked: [] }), 0);
    assert.equal(changeReplanExitCode(accepted), 0);
    assert.equal(changeReplanExitCode({ phase: 'CANDIDATE_CAPTURED', blocked: [] }), 2);
    assert.equal(changeReplanExitCode({ ...accepted, blocked: ['Evidence changed'] }), 2);
    assert.equal(changeReplanExitCode({ ...accepted, phase: 'BLOCKED' }), 2);
});

test('bare details flag is limited to supported mutation commands and rejects ambiguous input', () => {
    for (const command of changeResultCommands) {
        assert.equal(parseInvocation([...command.split(' '), '--details', '--home', '/owned']).options.get('details'), 'true');
        for (const tail of [['--details', '--details'], ['--details', 'false'], ['--details', 'true']]) assert.throws(() => parseInvocation([...command.split(' '), ...tail]));
    }
    for (const command of ['change inspect','change list','work extend','project list']) assert.throws(() => parseInvocation([...command.split(' '), '--details']), /Unsupported option/);
});

test('public planning capacity hold keeps its original cause and exit status in both output formats', {timeout: 15000}, async t => {
    const root = await temporaryDirectory('cli-change-status'), home = path.join(root, 'home'), project = path.join(root, 'project');
    await fs.mkdir(project); await fs.writeFile(path.join(project, 'source.cjs'), 'module.exports = 1;\n');
    let passed = false; t.after(async () => {if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained output boundary fixture: ' + root);});
    const execute = promisify(execFile), env = {...process.env, HOME: root, NODE_OPTIONS: '', NODE_PATH: '', TMPDIR: root};
    const run = async words => {try {return {code: 0, ...await execute(process.execPath, ['--import', './tests/ui/readiness-no-execution.mjs', 'dist/cli/entry.js', ...words, '--home', home], {env, timeout: 5000})};} catch(error) {if(typeof error.code === 'number') return error; throw error;}};
    assert.equal((await run(['project', 'register', '--id', 'P', '--root', project])).code, 0);
    const {openController} = await import('../../dist/controller/index.js');
    const {ApplicationAccounts} = await import('../../dist/app/accounts.js');
    const controller = await openController({installationHome: home});
    try {await ApplicationAccounts.open(controller).configure({providers: {'owned-capacity': {api: 'openai-completions', apiKey: 'literal-owned-unused', baseUrl: 'http://127.0.0.1:9/v1', models: [{id: 'small', reasoning: false, contextWindow: 8192, maxTokens: 1000}]}}});} finally {await controller.close();}
    assert.equal((await run(['models', 'default', '--provider', 'owned-capacity', '--model', 'small'])).code, 0);
    const profile = path.join(root, 'explicit-model.json');
    await fs.writeFile(profile, JSON.stringify({provider: 'owned-explicit', modelId: 'small', definition: {api: 'openai-completions', apiKey: 'literal-owned-unused', baseUrl: 'http://127.0.0.1:9/v1', models: [{id: 'small', reasoning: false, contextWindow: 8192, maxTokens: 1000}]}}), {mode: 0o600});
    const args = ['change', 'start', '--project', 'P', '--message', 'Inspect original consumer', '--docker-binary', '/usr/bin/false', '--docker-context', 'NEVER_EXECUTE', '--image', 'sha256:' + '0'.repeat(64)];
    for (const selection of [[], ['--model-profile', profile]]) for (const details of [false, true]) {
        const result = await run([...args, ...selection, ...(details ? ['--details'] : [])]); assert.equal(result.code, 2, result.stderr);
        const view = JSON.parse(result.stdout); assert.equal(view.phase, 'BLOCKED'); assert.equal(view.reviewReady, false);
        assert.equal(view.modelContextFailure, 'MODEL_CONTEXT_LIMIT'); assert.ok(view.nextAction); assert.match(view.blocked.join(' '), /MODEL_CONTEXT_LIMIT/);
        assert.equal(view.format, details ? undefined : 'change-status-v1'); assert.equal(Array.isArray(view.launches), details);
        assert.equal(view.execution.reserved, 0); assert.equal(view.resolution.reserved, 0);
        const inspect = await run(['change', 'inspect', '--work', view.workId]); assert.equal(inspect.code, 0);
        const full = JSON.parse(inspect.stdout); assert.equal(full.format, undefined); assert.deepEqual(full.blocked, view.blocked);
        assert.deepEqual(full.launches, [], 'Known refusal must precede producer allocation');
        assert.deepEqual(full.execution, view.execution); assert.deepEqual(full.resolution, view.resolution);
        if (details) assert.deepEqual(view, full); else assert.equal(view.recordCounts.launches, full.launches.length);
    }
    passed = true;
});
