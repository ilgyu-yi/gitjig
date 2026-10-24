import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initTheme, SessionManager, AssistantMessageComponent } from '@earendil-works/pi-coding-agent';
import { TuiAltScreen } from '@earendil-works/pi-tui';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationSettings } from '../../dist/app/settings.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { configurationCommands } from '../../dist/ui/configuration-commands.js';
import { createNativeEditorFactory } from '../../dist/ui/native-editor.js';
import { NativePane } from '../../dist/ui/native-pane.js';
import { HostPicker } from '../../dist/ui/host-picker.js';
import { stripTerminalSequences } from '@earendil-works/pi-tui';

test('public picker bounds large lists, pages, filters exact values and cancels once', () => {
    initTheme('dark', false); createNativeEditorFactory();
    const labels = Array.from({ length: 1000 }, (_, i) => `item-${String(i).padStart(4, '0')}`);
    const selected = []; let cancelled = 0, rows = 8;
    const picker = new HostPicker('Bounded catalogue', labels, value => selected.push(value), () => cancelled++, () => rows);
    picker.focused = true; assert.equal(picker.focused, true);
    assert.ok(picker.render(80).length <= 12);
    picker.handleInput('\x1b[6~'); assert.match(stripTerminalSequences(picker.render(80).join('\n')), /9\/1000/);
    rows = 3; assert.ok(picker.render(80).length <= 7);
    picker.handleInput('\x1b[5~'); picker.handleInput('\r'); assert.deepEqual(selected, ['item-0005']);
    picker.handleInput('\x1b'); assert.equal(cancelled, 0);
    const raw = '\x1b[31m한국어\nunique\x1b[0m';
    const filtered = new HostPicker('Filter', [...labels, raw], value => selected.push(value), () => cancelled++, () => 8);
    filtered.handleInput('unique'); assert.ok(filtered.render(80).length <= 5);
    filtered.handleInput('\r'); assert.equal(selected.at(-1), raw);
    const empty = new HostPicker('Empty', labels, () => assert.fail('Empty filter submitted stale value'), () => cancelled++, () => 8);
    empty.handleInput('NO_MATCH');
    const noMatches=stripTerminalSequences(empty.render(80).join('\n'));
    assert.match(noMatches,/No matching items\. Clear the search to show all/);assert.match(noMatches,/0\/1000 items/);assert.doesNotMatch(noMatches,/matching commands/);
    empty.handleInput('\r'); empty.handleInput('\x1b'); empty.handleInput('\x1b'); assert.equal(cancelled, 1);
    const recovered=new HostPicker('Models',labels,value=>selected.push(value),()=>cancelled++,()=>8);
    recovered.handleInput('NO_MATCH');recovered.handleInput('\x15');assert.match(stripTerminalSequences(recovered.render(80).join('\n')),/1000\/1000 items/);recovered.handleInput('\r');assert.equal(selected.at(-1),'item-0000');
    const unavailable=new HostPicker('Projects',[],()=>assert.fail('Empty inventory selected'),()=>cancelled++,()=>8);
    const noItems=stripTerminalSequences(unavailable.render(32).join('\n'));assert.match(noItems,/No items available/);assert.match(noItems,/0\/0 items/);assert.doesNotMatch(noItems,/No matching/);unavailable.handleInput('\r');unavailable.handleInput('\x1b');assert.equal(cancelled,2);
});

test('configuration host preserves original scope/default semantics, overrides, cancellation and busy refusal', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/config-command-'))), home = path.join(root, 'app');
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained config world: ' + root); });
    const controller = await openController({ installationHome: home }), accounts = ApplicationAccounts.open(controller), settings = ApplicationSettings.open(controller), models = new ApplicationModels(controller);
    initTheme('dark', false); createNativeEditorFactory();
    const notices = []; let chosen, entered, applied = 0, selection = false;
    const registry = new HostCommands(configurationCommands({isCurrent:()=>true, controller, accounts, settings, models, choose: async () => chosen, input: async () => entered,
        notice: value => notices.push(value), apply: () => applied++, assertPresentationChange: () => { if (selection) throw Error('Active selection'); }, commandKey: 'Ctrl+G' }));
    try {
        await accounts.configure({ providers: { 'config-fixture': { api: 'openai-completions', apiKey: 'DUMMY_CONFIG', baseUrl: 'http://127.0.0.1:9/v1', models: [
            { id: 'alpha', reasoning: true, compat: { supportsReasoningEffort: true }, contextWindow: 8192, maxTokens: 256 },
            { id: 'beta', reasoning: false, contextWindow: 8192, maxTokens: 256 }] } } });
        const target = await models.newConversation();
        await assert.rejects(registry.execute('/model-next', target.conversationId), /cycling pool/);
        assert.equal(await registry.execute('/scoped-models', target.conversationId), 'cancelled');
        await assert.rejects(registry.execute('/settings defaultProvider "x"', target.conversationId), /matching default pair/);
        await assert.rejects(registry.execute('/settings enabledModels ["DOES_NOT_EXIST"]', target.conversationId), /cannot be resolved/);
        await registry.execute('/model-default config-fixture/alpha', target.conversationId);
        assert.equal(controller.getConversationModelChoice(target.conversationId).kind, 'unbound');
        const sibling = await models.newConversation(); assert.equal(controller.getConversationModelChoice(sibling.conversationId).modelId, 'alpha');
        await registry.execute('/scoped-models ["config-fixture/alpha:high","config-fixture/beta"]', target.conversationId);
        await registry.execute('/model-next', target.conversationId); assert.equal(controller.getConversationModelChoice(target.conversationId).thinkingLevel, 'high');
        await registry.execute('/model-next', target.conversationId); assert.equal(controller.getConversationModelChoice(target.conversationId).modelId, 'beta');
        assert.equal(controller.getConversationModelChoice(sibling.conversationId).modelId, 'alpha');
        const before = controller.getConversationModelChoice(target.conversationId);
        await assert.rejects(models.next({ conversationId: target.conversationId, expectedGeneration: 0, expectedRevision: before.revision - 1 }), /Stale conversation model revision/);
        selection = true; await assert.rejects(registry.execute('/settings theme "light"', target.conversationId), /Active selection/); selection = false;
        assert.equal(settings.inspect().global.theme, undefined);
        await registry.execute('/settings theme "light"', target.conversationId); assert.equal(settings.inspect().effective.theme, 'light'); assert.equal(applied, 1);
        await registry.execute('/settings steeringMode "all"', target.conversationId);
        await registry.execute('/settings followUpMode "one-at-a-time"', target.conversationId);
        assert.equal(settings.manager().getSteeringMode(), 'all'); assert.equal(settings.manager().getFollowUpMode(), 'one-at-a-time');
        await assert.rejects(registry.execute('/settings steeringMode "invalid"', target.conversationId), /Unsupported preference or invalid value/);
        const project = path.join(root, 'project'); await fs.mkdir(project, { mode: 0o700 }); await fs.mkdir(path.join(project, '.gitjig'));
        await fs.writeFile(path.join(project, '.gitjig/settings.json'), '{"theme":"dark"}', { mode: 0o600 });
        await controller.registerProject({ id: 'owned', sourceRoot: project }); settings.approveProject('owned');
        const projectConversation = controller.createConversation({ projectId: 'owned' });
        await registry.execute('/settings theme "system"', projectConversation.conversationId);
        assert.equal(settings.inspect('owned').effective.theme, 'dark'); assert.match(notices.at(-1), /project override remains/);
        const busy = controller.createConversation();
        await controller.queueConversationInput({ conversationId: busy.conversationId, expectedGeneration: 0, text: 'Pending obligation', mode: 'idle' });
        await assert.rejects(registry.execute('/settings hideThinkingBlock true', target.conversationId), /Settle active/);
        await assert.rejects(registry.execute('/settings steeringMode "one-at-a-time"', target.conversationId), /Settle active/);
        assert.equal(settings.manager().getSteeringMode(), 'all');
        const authority = () => Object.fromEntries(['conversations','conversation_state','conversation_inputs','works','runs','budgets','obligations'].map(table => [table, controller.store.all('SELECT * FROM ' + table + ' ORDER BY rowid')]));
        const retained = authority();
        await registry.execute('/setup save {"version":1}', target.conversationId);
        assert.match(notices.at(-1), /relaunch/); assert.deepEqual(authority(), retained);
        const startupFile = path.join(home, 'config/startup.json'), savedStartup = await fs.readFile(startupFile);
        entered = undefined; assert.equal(await registry.execute('/setup save', target.conversationId), 'cancelled');
        assert.ok((await fs.readFile(startupFile)).equals(savedStartup)); assert.deepEqual(authority(), retained);
        await registry.execute('/setup clear', target.conversationId); assert.deepEqual(authority(), retained);
        assert.equal(settings.inspect().global.hideThinkingBlock, undefined); passed = true;
    } finally { await controller.close(); }
});

test('actual native presentation reload keeps draft/cursor and entry anchor through hide/unhide and scrollbar changes', async () => {
    initTheme('dark', false);
    const terminal = { columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {},
        showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} };
    const screen = new TuiAltScreen(terminal, true), pane = new NativePane('presentation', screen, createNativeEditorFactory());
    const history = SessionManager.inMemory('/');
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    history.appendMessage({ role: 'assistant', api: 'openai-completions', provider: 'owned', model: 'owned', timestamp: Date.now(), stopReason: 'stop', usage,
        content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING_MARKER ' + 'long thinking '.repeat(200) }, { type: 'text', text: 'VISIBLE_REPLY' }] });
    const anchorId = history.appendMessage({ role: 'user', content: 'ANCHOR_MESSAGE ' + 'visible anchor body '.repeat(200), timestamp: Date.now() });
    pane.setHistory(history); pane.editor.setText('보존할 draft'); pane.editor.handleInput('\x1b[D'); const cursor = pane.editor.getCursor();
    const settle = async predicate => {
        const until = Date.now() + 1000;
        while (!predicate()) { assert.ok(Date.now() < until, 'Original native layout acknowledgement missing'); await new Promise(resolve => setTimeout(resolve, 5)); }
    };
    screen.setLayoutRoot(pane.layout); screen.setFocus(pane.editor);
    try {
    screen.start(); await settle(() => pane.scroll.viewportHeight > 0);
    pane.resolveScroll(anchorId, 2, false, 80);
    const anchor = pane.scrollAnchor(80); assert.equal(anchor.entryId, anchorId); assert.equal(anchor.offset, 2);
    for (const hide of [true, false]) {
        pane.setPresentation({ hideThinking: hide, padding: 2, autocomplete: 7, scrollbar: hide ? 'always' : 'hidden' }, 80);
        await settle(() => pane.scroll.afterNextLayout === undefined);
        assert.equal(pane.scrollAnchor(80).entryId, anchorId); assert.equal(pane.scrollAnchor(80).offset, 2);
        assert.equal(pane.editor.getExpandedText(), '보존할 draft'); assert.deepEqual(pane.editor.getCursor(), cursor);
        assert.equal(pane.editor.getPaddingX(), 2); assert.equal(pane.editor.getAutocompleteMaxVisible(), 7);
        assert.equal(pane.scroll.scrollbar, hide ? 'always' : 'hidden');
        assert.equal(pane.body.render(80).join('\n').includes('PRIVATE_REASONING_MARKER'), !hide);
    }
    // Resize after scheduling and before the original next frame. The oracle is
    // original native component height at actual content width, not pane anchor math.
    pane.setPresentation({ hideThinking: false, padding: 2, autocomplete: 7, scrollbar: 'always' }, () => terminal.columns);
    terminal.columns = 48;
    await settle(() => pane.scroll.afterNextLayout === undefined);
    const assistant = history.buildSessionProjection().messages[0];
    const originalMessage = new AssistantMessageComponent(assistant, false);
    const expectedHeight = originalMessage.render(47).length;
    assert.notEqual(expectedHeight, originalMessage.render(79).length, 'Resize must causally change original wrapped height');
    assert.equal(pane.scroll.scrollTop, expectedHeight + 2);
    assert.equal(pane.scrollAnchor(48).entryId, anchorId); assert.equal(pane.scrollAnchor(48).offset, 2);
    assert.equal(pane.editor.getExpandedText(), '보존할 draft'); assert.deepEqual(pane.editor.getCursor(), cursor);
    } finally { pane.dispose(); await screen.stop(); }
});
