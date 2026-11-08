import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { ApplicationStartup } from '../../dist/app/startup.js';
import { ApplicationSettings } from '../../dist/app/settings.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { configurationCommands } from '../../dist/ui/configuration-commands.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { InspectionDetails } from '../../dist/ui/inspection-details.js';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences, TuiAltScreen } from '@earendil-works/pi-tui';
async function fixture(t) {
    const root = await temporaryDirectory('config-inspection'), home = path.join(root, 'home'), c = await openController({ installationHome: home }), settings = ApplicationSettings.open(c), accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c), view = c.createConversation();
    t.after(async () => {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const base = {
        controller: c, settings, accounts, models, isCurrent: () => true, input: async () => undefined, choose: async () => undefined, notice() { }, apply() { }, assertPresentationChange() { }, commandKey: 'Ctrl+G'
    };
    return {
        root, home, c, settings, accounts, models, cid: view.conversationId, base, commands: extra => new HostCommands(configurationCommands({ ...base, ...extra }))
    };
}
test('startup and project-effective preferences use keyboard-scrollable full details without changing configuration', async (t) => {
    const f = await fixture(t), project = path.join(f.root, 'project');
    await fs.mkdir(project);
    await fs.mkdir(path.join(project, '.gitjig'));
    await fs.writeFile(path.join(project, '.gitjig/settings.json'), JSON.stringify({ steeringMode: 'all' }));
    await f.c.registerProject({ id: 'P', sourceRoot: project });
    f.c.setConversationProject({ conversationId: f.cid, expectedGeneration: 0, projectId: 'P' });
    f.settings.approveProject('P');
    await f.settings.setPreference('steeringMode', 'one-at-a-time');
    const runtime = {
        dockerBinary: '/long/' + ('directory/'.repeat(20)) + 'docker', dockerContext: 'FULL_CONTEXT_AFTER_LONG_PATH', image: 'sha256:' + '1'.repeat(64)
    };
    // This inspection fixture supplies metadata directly; no engine/client or valid save is claimed.
    ApplicationStartup.open(f.c, { configuration: { version: 1, runtime }, sources: { runtime: 'invocation', bridge: 'none' } });
    const before = await fs.readFile(path.join(f.home, 'config/settings.json'), 'utf8'), details = [];
    const commands = f.commands({
        show: async (title, text) => details.push({ title, text }), choose: async () => { assert.fail('Inspection must not hide detail in one-line picker labels'); }
    });
    await commands.execute('/setup inspect', f.cid);
    assert.ok(details[0].text.includes(runtime.dockerBinary));
    assert.ok(details[0].text.includes(runtime.dockerContext));
    assert.match(details[0].text, /Effective in this process/);
    await commands.execute('/settings inspect', f.cid);
    const view = JSON.parse(details[1].text.split('\n\nOmitted preferences')[0]);
    assert.equal(view.application.steeringMode, 'one-at-a-time');
    assert.equal(view.effective.steeringMode, 'all');
    assert.equal(view.sources.steeringMode, 'project');
    assert.equal(await fs.readFile(path.join(f.home, 'config/settings.json'), 'utf8'), before);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n, 0);
    initTheme('dark', false);
    let closed = false;
    const component = new InspectionDetails(details[0].title, details[0].text, () => closed = true), visible = [];
    const terminal = {
        columns: 80, rows: 12, kittyProtocolActive: false, start() { }, stop() { }, async drainInput() { }, write() { }, moveBy() { }, clearLine() { }, clearFromCursor() { }, clearScreen() { }, hideCursor() { }, showCursor() { }, setTitle() { }, setProgress() { }, setProgramStatus() { }
    };
    const screen = new TuiAltScreen(terminal, true);
    screen.setLayoutRoot(component);
    const settle = async (predicate, timeout = 1000) => {
        const end = Date.now() + timeout;
        while (!predicate() && Date.now() < end)
            await new Promise(resolve => setTimeout(resolve, 5));
        return predicate();
    };
    try {
        screen.start();
        assert.ok(await settle(() => screen.getScreenLines().some(line => line.includes('Startup'))));
        for (let i = 0; i < 30; i++) {
            const frame = screen.getScreenLines().join('\n');
            visible.push(frame);
            if (stripTerminalSequences(visible.join('\n')).includes(runtime.dockerContext))
                break;
            component.handleInput('\x1b[6~');
            if (!await settle(() => screen.getScreenLines().join('\n') !== frame))
                break;
        }
        assert.ok(stripTerminalSequences(visible.join('\n')).includes(runtime.dockerContext));
        component.handleInput('\x1b');
        assert.equal(closed, true);
    }
    finally {
        screen.stop();
    }
});
test('role model forms reject source and preference drift across pickers and actual async commit boundary', async (t) => {
    const f = await fixture(t);
    await f.accounts.configure({ providers: { 'role-audit': {
                api: 'openai-completions', baseUrl: 'http://unused.invalid', apiKey: 'DUMMY', models: [{ id: 'one', reasoning: false, contextWindow: 8192, maxTokens: 1000 }]
            } } });
    let current = true;
    const commands = f.commands({
        isCurrent: () => current, chooseItems: async (_title, items) => {
            const value = 'model:["role-audit","one"]';
            assert.ok(items.some(item => item.value === value));
            current = false;
            return value;
        }
    });
    await assert.rejects(commands.execute('/role-model planner', f.cid), /source changed/);
    assert.deepEqual(f.models.rolePreferences(), {});
    current = true;
    const file = path.join(f.home, 'config/role-models.json');
    await fs.writeFile(file, '{}\n', { mode: 0o600 });
    const changed = f.commands({ chooseItems: async (_title, items) => {
            const value = 'model:["role-audit","one"]';
            assert.ok(items.some(item => item.value === value));
            await fs.writeFile(file, '{} \n');
            return value;
        } });
    await assert.rejects(changed.execute('/role-model planner', f.cid), /preferences changed/);
    assert.equal(await fs.readFile(file, 'utf8'), '{} \n');
    const choice = f.models.choice.bind(f.models);
    let enter, release;
    const ready = new Promise(r => enter = r), held = new Promise(r => release = r);
    f.models.choice = async (...args) => {
        const result = await choice(...args);
        enter();
        await held;
        return result;
    };
    const pending = f.models.setRole('planner', { kind: 'managed', provider: 'role-audit', modelId: 'one', thinkingLevel: 'off' }, () => {
        if (!current)
            throw Error('SOURCE_CHANGED');
    });
    await ready;
    current = false;
    release();
    await assert.rejects(pending, /SOURCE_CHANGED/);
    assert.equal(await fs.readFile(file, 'utf8'), '{} \n');
    f.models.choice = choice;
    current = true;
    const healthy = f.commands({ uiLocale: () => 'ko', choose: async (title, labels) => title.includes('요청할 사고 수준') ? 'off' :
        labels.find(label => label === 'role-audit/one · 문맥 8,192 · 최대 출력 1,000') });
    assert.equal(await healthy.execute('/role-model planner', f.cid), 'completed');
    assert.equal(f.models.rolePreferences().planner.modelId, 'one');
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n, 0);
});

for (const unavailable of ['models', 'auth']) test(`role inheritance can be restored with invalid ${unavailable} metadata`, async t => {
    const f = await fixture(t);
    await f.accounts.configure({providers: {fixture: {api: 'openai-completions', baseUrl: 'http://unused.invalid', models: [{id: 'one'}]}}});
    const choice = await f.models.choice('fixture', 'one');
    await f.models.setRole('planner', choice);
    await f.models.setRole('reviewer', choice);
    const metadata = path.join(f.home, 'config', unavailable + '.json');
    const malformed = '{broken';
    await fs.writeFile(metadata, malformed, {mode: 0o600});
    const modelReads = t.mock.method(f.accounts, 'models');
    const action = (value, isCurrent = () => true) => f.commands({isCurrent, chooseItems: async (title, items) => {
        assert.match(title, /Planner · fixture\/one · off/);
        assert.deepEqual(items.map(item => item.value), ['replace', 'inherit']);
        return value;
    }});
    const command = '/role-model planner';
    const prefs = f.models.rolePreferences();
    assert.equal(await action(undefined).execute(command, f.cid), 'cancelled');
    assert.deepEqual(f.models.rolePreferences(), prefs);
    assert.equal(modelReads.mock.callCount(), 0);
    let current = true;
    const stale = f.commands({isCurrent: () => current, chooseItems: async () => { current = false; return 'inherit'; }});
    await assert.rejects(stale.execute(command, f.cid), /source changed/);
    assert.deepEqual(f.models.rolePreferences(), prefs);
    await assert.rejects(action('replace').execute(command, f.cid), /Application configuration requires valid JSON/);
    assert.deepEqual(f.models.rolePreferences(), prefs);
    assert.equal(modelReads.mock.callCount(), 1);
    assert.equal(await action('inherit').execute(command, f.cid), 'completed');
    assert.deepEqual(f.models.rolePreferences(), {reviewer: prefs.reviewer});
    assert.equal(modelReads.mock.callCount(), 1);
    assert.equal(await fs.readFile(metadata, 'utf8'), malformed);
});

test('role model capacities preserve distinct provider and slash-model identities', async t => {
    const f = await fixture(t);
    const model = {reasoning: false, contextWindow: 8192, maxTokens: 1000};
    await f.accounts.configure({providers: {
        'a/b': {api: 'openai-completions', baseUrl: 'http://unused.invalid', models: [{...model, id: 'c'}]},
        a: {api: 'openai-completions', baseUrl: 'http://unused.invalid', models: [{...model, id: 'b/c'}]},
    }});
    const commands = f.commands({chooseItems: async (_title, items) => {
        if (items.some(item => item.value === 'off')) return 'off';
        const values = ['model:["a/b","c"]', 'model:["a","b/c"]'];
        const matched = items.filter(item => values.includes(item.value));
        assert.equal(matched.length, 2);
        assert.notEqual(matched[0].label, matched[1].label);
        for (const item of matched) assert.match(item.label, /context 8,192 · max output 1,000/);
        assert.ok(items.every(item => item.value.startsWith('model:')));
        return values[1];
    }});
    await commands.execute('/role-model adjudicator', f.cid);
    assert.deepEqual(f.models.rolePreferences().adjudicator, {kind: 'managed', provider: 'a', modelId: 'b/c', thinkingLevel: 'off'});
});
