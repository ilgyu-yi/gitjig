import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { Input, TuiAltScreen } from '@earendil-works/pi-tui';
import { openController } from '../../dist/controller/index.js';
import { ApplicationKeybindings } from '../../dist/app/keybindings.js';
import { createNativeEditorFactory, nativeHostDefinitions } from '../../dist/ui/native-editor.js';
import { HostPicker } from '../../dist/ui/host-picker.js';
import { CommandMenu } from '../../dist/ui/command-menu.js';

test('app keybindings validate complete candidates and reach existing editor, new Input, picker and menu', async t => {
    const home = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/keys-unit-'))), controller = await openController({ installationHome: home });
    let passed = false; t.after(async () => { await controller.close(); if (passed) await fs.rm(home, { recursive: true, force: true }); });
    const app = new ApplicationKeybindings(controller), save = value => fs.writeFile(app.file, JSON.stringify(value), { mode: 0o600 });
    assert.deepEqual(app.load(nativeHostDefinitions, 'ctrl+g'), {});
    for (const value of [
        { 'fake.action': 'ctrl+t' }, { 'app.clipboard.pasteImage': 'ctrl+t' }, { 'tui.altScreen.search': 'ctrl+t' },
        { 'tui.editor.undo': 'ctrl+ctrl+t' }, { 'tui.editor.undo': 'unknown' }, { 'tui.editor.undo': [42] },
        { 'tui.editor.undo': 'ctrl+g' }, { 'tui.editor.undo': 'ctrl+[' }, { 'tui.editor.undo': 'ctrl+i' },
        { 'tui.editor.undo': 'ctrl+m' }, { 'tui.editor.undo': 'ctrl+u' }, { 'tui.select.down': 'n' }, { 'tui.select.down': 'j' }, { 'tui.select.down': 'e' }, { 'tui.select.down': 't' }, { 'tui.select.cancel': [] },
        { 'tui.input.newLine': 'alt+enter' }, { 'tui.editor.undo': 'ctrl+f9' }, { 'tui.editor.undo': 'shift+escape' },
    ]) { await save(value); assert.throws(() => app.load(nativeHostDefinitions, 'ctrl+g'), /repair .*keybindings.json/); }
    await save({ 'tui.editor.undo': 'ctrl+p' }); assert.throws(() => app.load(nativeHostDefinitions, 'ctrl+p'), /reserved/);
    await save({ 'tui.editor.cursorLeft': 'ctrl++' }); assert.doesNotThrow(() => app.load(nativeHostDefinitions, 'ctrl+g'));
    await save({ 'tui.editor.cursorUp': 'up', 'tui.select.up': 'up', 'tui.editor.deleteToLineStart': 'ctrl+t', 'tui.select.down': 'ctrl+n' });
    initTheme('dark', false); const factory = createNativeEditorFactory(app.load(nativeHostDefinitions, 'ctrl+g'));
    const terminal = { columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} };
    const editor = factory(new TuiAltScreen(terminal, true)); editor.setText('한글 draft'); editor.handleInput('\x14'); assert.equal(editor.getText(), '');
    const picked = []; const picker = new HostPicker('Original list', ['first', 'second'], value => picked.push(value), () => {}, () => 8);
    picker.handleInput('\x0e'); picker.handleInput('\r'); assert.deepEqual(picked, ['second']);
    const menu = new CommandMenu(value => picked.push(value), () => {}); menu.handleInput('\x0e'); menu.handleInput('\r'); assert.equal(picked.at(-1), 'j');
    editor.setText('preserve'); editor.handleInput('\x1b[D'); const cursor = editor.getCursor(), before = factory.bindings.getResolvedBindings();
    await save({ 'tui.editor.deleteToLineStart': 'ctrl+u', 'tui.editor.undo': 'ctrl+u' });
    assert.throws(() => factory.bindings.setUserBindings(app.load(nativeHostDefinitions, 'ctrl+g')), /conflicts/);
    assert.deepEqual(factory.bindings.getResolvedBindings(), before); assert.equal(editor.getText(), 'preserve'); assert.deepEqual(editor.getCursor(), cursor);
    await save({ 'tui.editor.deleteToLineStart': 'ctrl+r', 'tui.select.down': 'ctrl+n' });
    factory.bindings.setUserBindings(app.load(nativeHostDefinitions, 'ctrl+g')); factory.bindings.reload();
    editor.handleInput('\x12'); assert.equal(editor.getText(), 'e');
    const input = new Input(); input.handleInput('new input'); input.handleInput('\x12'); assert.equal(input.getValue(), '');
    passed = true;
});

test('source UI owns keybindings across reload/restart and keeps fixed hierarchy and account cancellation', { timeout: 8000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/keys-ui-'))), home = path.join(root, 'app');
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained keybinding PTY: ' + root); });
    for (const name of ['user', 'tmp', 'stock']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
    const controller = await openController({ installationHome: home }); const app = new ApplicationKeybindings(controller);
    const parent = controller.createConversation(), child = controller.createConversation();
    controller.setConversationParent({ parentId: parent.conversationId, childId: child.conversationId, expectedRevision: 0 });
    await fs.writeFile(app.file, JSON.stringify({ 'tui.editor.deleteToLineStart': 'ctrl+t', 'tui.select.down': 'ctrl+n' }), { mode: 0o600 }); await controller.close();
    const stockFile = path.join(root, 'stock/keybindings.json'), stock = '{"tui.editor.deleteToLineStart":"ctrl+g"}'; await fs.writeFile(stockFile, stock, { mode: 0o600 });
    const run = async (name, steps) => {
        const file = path.join(root, name + '.json');
        const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'tmp'), PATH: path.dirname(process.execPath), PI_CODING_AGENT_DIR: path.join(root, 'stock'), TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' };
        await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home, '--conversation', child.conversationId], env,
            database: path.join(home, 'state/controller.sqlite'), keybindingsFile: app.file, expectedInputs: 0, timeoutSeconds: 3, steps, output: file + '.terminal' }), { mode: 0o600 });
        return JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', file], { timeout: 4000 })).stdout);
    };
    const steps = [
        { wait: 'Model: not selected', send: 'discarded\u0014/hotkeys\u001b\r' },
        { wait: 'Gitjig keybindings', send: '\u000e\r' },
        { wait: 'Keybindings closed', assertDraft: '', keybindings: { 'tui.editor.deleteToLineStart': 'ctrl+g' }, send: '/reload\u001b\r' },
        { wait: 'Key is reserved', assertDraft: '/reload', send: '\u0014/hotkeys\u001b\r' },
        { wait: 'Gitjig keybindings', send: '\r' },
        { wait: 'Keybindings closed', keybindings: { 'tui.editor.deleteToLineStart': 'ctrl+r', 'tui.select.down': 'ctrl+n' }, send: '/reload\u001b\r' },
        { wait: 'keybindings reloaded', send: 'discarded\u0012/login openai api_key\u001b\r' },
        { wait: 'Secret input (hidden)', send: '\u001b' },
        { wait: 'Account login cancelled; current stored credential: none', assertDraft: '/login openai api_key', send: '\u0012\u0007' },
        { wait: 'Commands · Ctrl+G', send: '\u001b\u001b[1;2A' },
        { wait: '#' + parent.conversationId.slice(0, 8), assertDraft: '', expectedSelected: parent.conversationId, send: '/quit\u001b\r' },
    ];
    const first = await run('first', steps); assert.equal(first.exitCode, 0); assert.equal(first.stages, steps.length); assert.equal(first.terminalRestored, true);
    const restarted = await run('restart', [{ wait: 'Model: not selected', send: 'discarded\u0012/hotkeys\u001b\r' }, { wait: 'Gitjig keybindings', send: '\r' }, { wait: 'Keybindings closed', assertDraft: '', send: '/quit\u001b\r' }]);
    assert.equal(restarted.exitCode, 0); assert.equal(restarted.stages, 3); assert.equal(restarted.terminalRestored, true);
    await fs.writeFile(app.file, '{"unknown.action":"ctrl+t"}', { mode: 0o600 });
    const invalid = await run('invalid-startup', [{ wait: 'Unsupported or fixed keybinding action', send: '' }]);
    assert.equal(invalid.exitCode, 2); assert.equal(invalid.alternateEntered, false); assert.equal(invalid.terminalRestored, true);
    assert.equal(await fs.readFile(stockFile, 'utf8'), stock); passed = true;
});
