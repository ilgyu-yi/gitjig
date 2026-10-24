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
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/config-inspection-'))), home = path.join(root, 'home'), c = await openController({ installationHome: home }), settings = ApplicationSettings.open(c), accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c), view = c.createConversation();
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
        isCurrent: () => current, choose: async (title) => {
            if (title.startsWith('planner · inherited')) {
                current = false;
                return 'role-audit/one';
            }
            return 'off';
        }
    });
    await assert.rejects(commands.execute('/role-model planner', f.cid), /source changed/);
    assert.deepEqual(f.models.rolePreferences(), {});
    current = true;
    const file = path.join(f.home, 'config/role-models.json');
    await fs.writeFile(file, '{}\n', { mode: 0o600 });
    const changed = f.commands({ choose: async (title) => {
            if (title.startsWith('planner · inherited')) {
                await fs.writeFile(file, '{} \n');
                return 'role-audit/one';
            }
            return 'off';
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
    const healthy = f.commands({ choose: async (title) => title.includes('thinking level') ? 'off' : 'role-audit/one' });
    assert.equal(await healthy.execute('/role-model planner', f.cid), 'completed');
    assert.equal(f.models.rolePreferences().planner.modelId, 'one');
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n, 0);
});
