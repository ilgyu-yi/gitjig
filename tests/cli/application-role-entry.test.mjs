import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels, applicationModelRoles } from '../../dist/app/models.js';
import { ApplicationSettings } from '../../dist/app/settings.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { configurationCommands } from '../../dist/ui/configuration-commands.js';
const exec = promisify(execFile);

test('reachable role commands and retained governed CLI entry preserve desired model mode without credentials', { timeout: 16000 }, async t => {
    const root = await temporaryDirectory('c2'), home = path.join(root, 'app'), user = path.join(root, 'user'), project = path.join(root, 'project');
    await fs.mkdir(user); await fs.mkdir(project); await fs.writeFile(path.join(project, 'source.txt'), 'OWNED SOURCE');
    const stock = path.join(root, 'stock'); await fs.mkdir(stock); const stockBytes = '{"defaultModel":"NEVER_INHERIT"}'; await fs.writeFile(path.join(stock, 'settings.json'), stockBytes);
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained C2 world ' + root); });
    const env = { HOME: user, TMPDIR: path.join(root, 'unrelated-temporary-directory'), PATH: path.dirname(process.execPath), PI_CODING_AGENT_DIR: stock, LANG: 'C.UTF-8', TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: '' };
    const run = async (words, selectedHome = home) => {
        try { return { code: 0, ...await exec(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/entry.js', ...words, '--home', selectedHome], { env, timeout: 2500 }) }; }
        catch (e) { if (typeof e.code === 'number') return { code: e.code, stdout: e.stdout, stderr: e.stderr }; throw e; }
    };
    const absent = path.join(root, 'absent');
    for (const words of [['models', 'role-set', '--role', 'wrong', '--provider', 'fixture', '--model', 'alpha'], ['models', 'role-set', '--role', 'planner', '--provider', 'fixture'], ['models', 'role-set', '--role', 'planner', '--provider', 'fixture', '--model', 'alpha', '--thinking', 'wrong'], ['change', 'prepare', '--project', 'P', '--message', 'x', '--provider', 'fixture', '--model', 'alpha']]) {
        assert.equal((await run(words, absent)).code, 2); await assert.rejects(fs.access(absent), { code: 'ENOENT' });
    }
    let c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: project });
        await ApplicationAccounts.open(c).configure({ providers: { fixture: { api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', models: [
            { id: 'alpha/slash', reasoning: true, compat: { supportsReasoningEffort: true }, contextWindow: 8192, maxTokens: 256 }, { id: 'beta', reasoning: false, contextWindow: 8192, maxTokens: 256 }] } } });
    } finally { await c.close(); }
    const runtime = ['--docker-binary', '/usr/bin/false', '--docker-context', 'NEVER_EXECUTE', '--image', 'sha256:' + '0'.repeat(64)];
    const missing = await run(['change', 'start', '--project', 'P', '--message', 'missing default', ...runtime]); assert.equal(missing.code, 2); assert.match(missing.stderr, /Save an application default/);
    for (const role of applicationModelRoles) {
        const result = await run(['models', 'role-set', '--role', role, '--provider', 'fixture', '--model', 'alpha/slash', '--thinking', 'high']); assert.equal(result.code, 0, result.stderr);
    }
    let listed = await run(['models', 'roles']); assert.equal(listed.code, 0, listed.stderr); assert.equal(JSON.parse(listed.stdout).length, 7);
    for (const entry of JSON.parse(listed.stdout)) { assert.equal(entry.selection.modelId, 'alpha/slash'); assert.equal(entry.selection.thinkingLevel, 'high'); }
    assert.equal((await run(['models', 'role-reset', '--role', 'planner'])).code, 0);
    listed = JSON.parse((await run(['models', 'roles'])).stdout); assert.equal(listed.find(x => x.role === 'planner').selection.kind, 'inherited-work-baseline'); assert.equal(listed.find(x => x.role === 'reviewer').selection.modelId, 'alpha/slash');
    assert.equal((await run(['models', 'default', '--provider', 'fixture', '--model', 'alpha/slash'])).code, 0);
    const plain = await run(['change', 'prepare', '--project', 'P', '--message', 'plain capture']); assert.equal(plain.code, 0, plain.stderr); const legacy = JSON.parse(plain.stdout); assert.equal(legacy.modelSource, 'explicit-profile-required');
    const prepared = await run(['change', 'prepare', '--project', 'P', '--message', 'application capture', '--model-source', 'application']); assert.equal(prepared.code, 0, prepared.stderr); const app = JSON.parse(prepared.stdout); assert.equal(app.modelSource, 'application');
    const start = await run(['change', 'start', '--project', 'P', '--message', 'new application entry without credentials', ...runtime]); assert.equal(start.code, 2, start.stderr); const begun = JSON.parse(start.stdout); assert.match(begun.blocked.join(' '), /Selected application account is missing/);
    assert.equal(begun.format, 'change-status-v1'); assert.ok(begun.nextAction); assert.equal(begun.launches, undefined);
    const detailedFailure = await run(['change', 'resume', '--details', '--work', begun.workId, ...runtime]);
    assert.equal(detailedFailure.code, start.code, detailedFailure.stderr);
    const detailed = JSON.parse(detailedFailure.stdout); assert.equal(detailed.workId, begun.workId);
    assert.equal(detailed.format, undefined); assert.ok(Array.isArray(detailed.launches));
    assert.deepEqual(detailed.execution, begun.execution); assert.deepEqual(detailed.resolution, begun.resolution);
    assert.match(detailed.blocked.join(' '), /Selected application account is missing/);
    const neverRead = path.join(root, 'never-read.json'); await fs.writeFile(neverRead, 'NOT A PROFILE', { mode: 0o600 });
    for (const command of ['run', 'resume', 'replan']) {
        const conflict = await run(['change', command, '--work', app.workId, '--model-profile', neverRead, ...runtime]); assert.equal(conflict.code, 2); assert.match(conflict.stderr, /omit --model-profile/);
        const missingProfile = await run(['change', command, '--work', legacy.workId, ...runtime]); assert.equal(missingProfile.code, 2); assert.match(missingProfile.stderr, /requires its explicit --model-profile/);
    }
    assert.equal((await run(['models', 'default', '--provider', 'fixture', '--model', 'beta'])).code, 0);
    for (const command of ['run', 'resume', 'replan']) {
        const result = await run(['change', command, '--work', app.workId, ...runtime]); assert.equal(result.code, 2, result.stderr); const view = JSON.parse(result.stdout); assert.equal(view.workId, app.workId); assert.match(view.blocked.join(' '), /Selected application account is missing/);
    }
    c = await openController({ installationHome: home });
    try {
        assert.equal(c.getWorkApplicationModelBaseline(legacy.workId), undefined);
        assert.equal(c.getWorkApplicationModelBaseline(app.workId).choice.modelId, 'alpha/slash'); assert.equal(c.getWorkApplicationModelBaseline(begun.workId).choice.modelId, 'alpha/slash');
        assert.equal(c.store.one('SELECT COUNT(*) AS n FROM works').n, 3);
        const captures = c.store.all('SELECT * FROM runs'); assert.equal(captures.length, 3);
        assert.deepEqual(captures.map(run => run.work).sort(), [legacy.workId, app.workId, begun.workId].sort());
        for (const run of captures) {
            const data = JSON.parse(run.data), checkpoint = c.store.one('SELECT base FROM change_state WHERE work=?', run.work);
            assert.equal(run.phase, 'SETTLED'); assert.equal(run.reservation, 'consumed'); assert.equal(data.kind, 'governed-change');
            assert.equal(data.attainedCapture, true); assert.equal(data.base, checkpoint.base); assert.ok(data.manifest);
            for (const key of ['modelIdentity', 'modelMode', 'modelDispatch', 'historyRef', 'nativeSessionId', 'containerId', 'launchId']) assert.equal(Object.hasOwn(data, key), false, key);
            const execution = c.store.one("SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'", run.work);
            assert.equal(execution.consumed, 1); assert.equal(execution.reserved, 0);
            const resolution = c.store.one("SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='resolution'", run.work);
            assert.equal(resolution.consumed, 0); assert.equal(resolution.reserved, 0);
        }
        assert.equal(c.store.one('SELECT COUNT(*) AS n FROM role_launches').n, 0); assert.equal(c.store.one('SELECT COUNT(*) AS n FROM capacity_leases').n, 0);
        const models = new ApplicationModels(c), accounts = ApplicationAccounts.open(c), settings = ApplicationSettings.open(c), target = await models.newConversation();
        let choices = [], notices = [];
        const commands = new HostCommands(configurationCommands({isCurrent:()=>true, controller: c, models, accounts, settings, choose: async () => choices.shift(),
            chooseItems: async (_title, items) => {
                if (items.some(item => item.value.startsWith('model:')))
                    assert.ok(items.some(item => item.value === 'model:["fixture","alpha/slash"]' && item.label.includes('context 8,192')));
                return choices.shift();
            }, input: async () => undefined, notice: value => notices.push(value), apply() {}, assertPresentationChange() {}, commandKey: 'Ctrl+G' }));
        assert.match(commands.help(), /\/role-model/);
        for (const selection of [[], ['planner'], ['planner', 'model:["fixture","alpha/slash"]']]) {
            const before = models.rolePreferences(); choices = selection; assert.equal(await commands.execute('/role-model', target.conversationId), 'cancelled'); assert.deepEqual(models.rolePreferences(), before);
        }
        choices = ['planner', 'model:["fixture","alpha/slash"]', 'high']; await commands.execute('/role-model', target.conversationId); assert.equal(models.rolePreferences().planner.modelId, 'alpha/slash');
        choices = ['inherit']; await commands.execute('/role-model planner', target.conversationId); assert.equal(models.rolePreferences().planner, undefined);
        await c.queueConversationInput({ conversationId: target.conversationId, expectedGeneration: c.inspectConversation(target.conversationId).generation, text: 'pending', mode: 'idle' });
        choices = ['model:["fixture","beta"]', 'off']; await assert.rejects(commands.execute('/role-model planner', target.conversationId), /Settle active/); assert.equal(models.rolePreferences().planner, undefined);
        const row = c.store.one('SELECT data FROM works WHERE id=?', app.workId), data = JSON.parse(row.data); data.applicationModelBaseline = null; c.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(data), app.workId);
    } finally { await c.close(); }
    const malformed = await run(['change', 'resume', '--work', app.workId, '--model-profile', neverRead, ...runtime]); assert.equal(malformed.code, 2); assert.match(malformed.stderr, /invalid work model baseline/);
    assert.equal(await fs.readFile(path.join(stock, 'settings.json'), 'utf8'), stockBytes); passed = true;
});

for (const [locale, copy] of Object.entries({
    en: {
        unselected: 'Model: not selected', chooser: 'Workflow role model', role: 'Planner',
        cancelled: 'Command cancelled · draft kept', inherited: 'Inherits each work’s captured model',
        capacity: 'context 8,192 · max output 256', thinking: 'Requested thinking level',
        saved: 'Role override saved: Planner', current: 'Planner · fixture/alpha/slash · high',
        inheritedReceipt: 'Work model inheritance selected: Planner', scope: 'Applies to future launches across the app',
    },
    ko: {
        unselected: '모델: 선택되지 않음', chooser: '작업 역할 모델', role: '계획 담당',
        cancelled: '명령 취소 · 초안 유지', inherited: '각 작업에 기록된 모델 상속',
        capacity: '문맥 8,192 · 최대 출력 256', thinking: '요청할 사고 수준',
        saved: '역할 모델 저장: 계획 담당', current: '계획 담당 · fixture/alpha/slash · high',
        inheritedReceipt: '작업 모델 상속 적용: 계획 담당', scope: '앱 전체의 향후 역할 실행에 적용',
    },
})) test(`original source TUI role picker explains save and inheritance in ${locale} without dispatch`, { timeout: 7000 }, async t => {
    const root = await temporaryDirectory('c2-ui'), home = path.join(root, 'app');
    const user = path.join(root, 'user'); await fs.mkdir(user); let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained C2 UI ' + root); });
    const c = await openController({ installationHome: home });
    let conversationId;
    try {
        await ApplicationAccounts.open(c).configure({ providers: { fixture: { api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'alpha/slash', reasoning: true, compat: { supportsReasoningEffort: true }, contextWindow: 8192, maxTokens: 256 }] } } });
        const conversation = c.createConversation();
        conversationId = conversation.conversationId;
        c.setConversationLanguage({conversationId, expectedGeneration: conversation.generation, expectedRevision: 0, replyLanguage: locale});
    } finally { await c.close(); }
    // Frame Escape and Enter separately because legacy ESC+CR also encodes Alt+Enter.
    const dismissCompletionAndSubmit = '\u001b[27u\u001b[13u';
    const file = path.join(root, 'pty.json'), steps = [
        { wait: copy.unselected, send: '/role-model' + dismissCompletionAndSubmit },
        { wait: copy.chooser, send: '\u001b' },
        { wait: copy.cancelled, assertDraft: '/role-model', send: dismissCompletionAndSubmit },
        { wait: 'planner · ' + copy.role, send: '\r' },
        { wait: copy.inherited, send: 'fixture/alpha/slash' },
        { wait: copy.capacity, send: '\r' },
        { wait: copy.thinking, send: 'high\r' },
        { wait: copy.saved + ' · ' + copy.scope, assertDraft: '', send: '/role-model planner' + dismissCompletionAndSubmit },
        { wait: copy.current, send: '\u001b[B\r' },
        { wait: copy.inheritedReceipt + ' · ' + copy.scope, assertDraft: '', send: '/role-model planner' + dismissCompletionAndSubmit },
        { wait: copy.inherited, send: '\u001b' },
        { wait: copy.cancelled, assertDraft: '/role-model planner', send: '\u0015/quit' + dismissCompletionAndSubmit },
    ];
    const env = { HOME: user, TMPDIR: path.join(root, 'unrelated-temporary-directory'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: '' };
    await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/entry.js', 'conversation', 'ui', '--home', home, '--conversation', conversationId], env, steps, timeoutSeconds: 4, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output: file + '.terminal' }), { mode: 0o600 });
    const receipt = JSON.parse((await exec('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', file], { timeout: 5500 })).stdout);
    assert.equal(receipt.exitCode, 0); assert.equal(receipt.stages, steps.length); assert.equal(receipt.terminalRestored, true);
    const reopened = await openController({ installationHome: home });
    try {
        assert.equal(new ApplicationModels(reopened).rolePreferences().planner, undefined);
        for (const table of ['conversation_inputs', 'runs', 'role_launches']) assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM ' + table).n, 0);
    } finally { await reopened.close(); }
    passed = true;
});
