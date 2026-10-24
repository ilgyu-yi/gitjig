import test from 'node:test';
import assert from 'node:assert/strict';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { TuiAltScreen } from '@earendil-works/pi-tui';
import { createNativeEditorFactory, prepareHostEditorSubmit } from '../../dist/ui/native-editor.js';

test('original public slash completion and host dispatch share explicit commands without file discovery', async () => {
    const calls = [], registry = new HostCommands([
        { name: 'help', description: 'Host help', run: async (_argument, target) => { calls.push(target); } },
        { name: 'cancel', description: 'Controlled local cancellation', run: async () => 'cancelled' },
        { name: 'model', description: 'Target model', argumentHint: '[provider/model]',
            getArgumentCompletions: prefix => ['owned/alpha', 'owned/beta'].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
            run: async (argument, target) => { calls.push({ argument, target }); } },
    ]);
    const get = (text, force = false) => registry.autocomplete.getSuggestions([text], 0, text.length, { signal: new AbortController().signal, force });
    assert.equal((await get('/mo', true)).items[0].value, 'model');
    assert.equal((await get('/model owned/a')).items[0].value, 'owned/alpha');
    for (const text of ['@/etc/', '/model @/etc/', '//literal', 'ordinary text']) assert.equal(await get(text, true), null);
    await assert.rejects(registry.execute('/unknown', 'A'), /Unknown command/);
    await assert.rejects(registry.execute('/help accidental-input', 'A'), /does not accept arguments/);
    assert.equal(await registry.execute('//literal', 'A'), 'not-command');
    assert.equal(await registry.execute('ordinary', 'A'), 'not-command');
    assert.equal(await registry.execute('/cancel', 'A'), 'cancelled');
    assert.equal(await registry.execute('/model owned/beta', 'B'), 'completed');
    assert.deepEqual(calls, [{ argument: 'owned/beta', target: 'B' }]);
    assert.match(registry.help(), /\/help — Host help/);
});

test('original autocomplete confirmation admits a bare host command without native draft clearing', async () => {
    initTheme('dark', false);
    const terminal = { columns: 100, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {},
        hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} };
    const screen = new TuiAltScreen(terminal, true), editor = createNativeEditorFactory()(screen);
    let originalSubmitted = false;
    editor.disableSubmit = true; editor.onSubmit = () => { originalSubmitted = true; };
    editor.setAutocompleteProvider(new HostCommands([{ name: 'model', description: 'Pick model', run: async () => {} }]).autocomplete);
    editor.handleInput('/mod');
    const deadline = Date.now() + 500;
    while (!editor.isShowingAutocomplete() && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.isShowingAutocomplete(), true);
    assert.equal(prepareHostEditorSubmit(editor, '\r', [{ name: 'model' }]), true);
    assert.equal(editor.getExpandedText(), '/model '); assert.equal(originalSubmitted, false);
    assert.equal(editor.isShowingAutocomplete(), false);
});
