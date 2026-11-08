import test from 'node:test';
import assert from 'node:assert/strict';
import { commandInputNotice, HostCommandInputError, HostCommands } from '../../dist/ui/host-commands.js';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { TuiAltScreen } from '@earendil-works/pi-tui';
import { createNativeEditorFactory, prepareHostEditorSubmit } from '../../dist/ui/native-editor.js';

test('original public slash completion and host dispatch share explicit commands without file discovery', async () => {
    const calls = [], registry = new HostCommands([
        { name: 'help', descriptionId: 'command.description.help', run: async (_argument, target) => { calls.push(target); } },
        { name: 'cancel', descriptionId: 'command.description.error', run: async () => 'cancelled' },
        { name: 'model', descriptionId: 'command.description.model', argumentHint: '[provider/model]',
            getArgumentCompletions: prefix => ['owned/alpha', 'owned/beta'].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
            run: async (argument, target) => { calls.push({ argument, target }); } },
    ]);
    const get = (text, force = false) => registry.autocomplete.getSuggestions([text], 0, text.length, { signal: new AbortController().signal, force });
    assert.equal((await get('/mo', true)).items[0].value, 'model');
    const argument = await get('/model owned/a');
    assert.equal(argument.items[0].value, 'owned/alpha');
    assert.equal(registry.autocomplete.applyCompletion(['/model owned/a'], 0, 14, argument.items[0], argument.prefix).lines[0], '/model owned/alpha');
    const newDraft = ['/model owned/ax'];
    assert.deepEqual(registry.autocomplete.applyCompletion(newDraft, 0, 15, argument.items[0], argument.prefix), { lines: newDraft, cursorLine: 0, cursorCol: 15 });
    let locale = 'ko';
    const pane = registry.autocompleteFor(() => locale);
    const paneModel = async () => (await pane.getSuggestions(['/mo'], 0, 3, { signal: new AbortController().signal })).items[0];
    const korean = await paneModel();
    assert.deepEqual(korean, { value: 'model', label: 'model', description: '[provider/model] — 이 대화의 모델 선택 또는 모델 연결 경로 확인' });
    assert.match(registry.help('ko'), /\/model \[provider\/model\] — 이 대화의 모델 선택/);
    assert.match((await get('/mo')).items[0].description, /Select this conversation model/);
    locale = 'en';
    const unchanged = {lines:['/mo'],cursorLine:0,cursorCol:3};
    assert.deepEqual(pane.applyCompletion(['/mo'], 0, 3, korean, '/mo'), unchanged);
    assert.deepEqual(pane.applyCompletion(['/mo'], 0, 3, {...await paneModel()}, '/mo'), unchanged);
    assert.match((await paneModel()).description, /Select this conversation model/);
    for (const text of ['@/etc/', '/model @/etc/', '//literal', 'ordinary text']) assert.equal(await get(text, true), null);
    for (const text of ['/model PRIVATE_ARGUMENT', '/ㅡㅐㅇㄷㅣ PRIVATE_ARGUMENT'])
        assert.equal(registry.commandName(text), 'model');
    for (const text of ['/unknown PRIVATE_ARGUMENT', '//model PRIVATE_ARGUMENT', 'ordinary text', '/model\nPRIVATE_ARGUMENT'])
        assert.equal(registry.commandName(text), undefined);
    assert.equal(registry.commandName('/help unexpected'), 'help'); // Identity does not admit invalid arguments.
    assert.deepEqual(calls, []);
    await assert.rejects(registry.execute('/unknown', 'A'), /Unknown command/);
    await assert.rejects(registry.execute('/help accidental-input', 'A'), /does not accept arguments/);
    assert.equal(await registry.execute('//literal', 'A'), 'not-command');
    assert.equal(await registry.execute('ordinary', 'A'), 'not-command');
    assert.equal(await registry.execute('/cancel', 'A'), 'cancelled');
    assert.equal(await registry.execute('/model owned/beta', 'B'), 'completed');
    assert.deepEqual(calls, [{ argument: 'owned/beta', target: 'B' }]);
    assert.match(registry.help(), /\/help — Search commands and run the selected action/);
});

test('invalid host command input suggests only a unique registered name and never forwards an argument', async () => {
    const command = name => ({ name, descriptionId: 'command.description.model', run: async () => assert.fail('Invalid input dispatched') });
    const registry = new HostCommands(['model', 'modal', 'help'].map(command));
    const issue = (text, expected) => {
        assert.throws(() => registry.prepare(text), error => {
            assert.ok(error instanceof HostCommandInputError);
            assert.deepEqual(error.issue, expected);
            for (const locale of ['en', 'ko'])
                assert.doesNotMatch(commandInputNotice(error.issue, locale, 'Ctrl+P'), /PRIVATE|mdoel|modol/);
            return true;
        });
    };
    for (const name of ['mdoel', 'ㅡㅇㅐㄷㅣ', 'modle', 'modeel'])
        issue('/' + name + ' PRIVATE_ARGUMENT', { kind: 'unknown', suggestion: 'model' });
    issue('/modol PRIVATE_ARGUMENT', { kind: 'unknown' });
    issue('/' + 'x'.repeat(200) + ' PRIVATE_ARGUMENT', { kind: 'unknown' });
    issue('/help PRIVATE_ARGUMENT', { kind: 'arguments', command: 'help' });
    issue('/help\nPRIVATE_ARGUMENT', { kind: 'multiline' });
    assert.equal(registry.prepare('//PRIVATE_ARGUMENT'), undefined);
    await assert.rejects(registry.execute('/mdoel PRIVATE_ARGUMENT', 'A'), error => error.issue?.suggestion === 'model');
});

test('command-specific grammar rejects input before dispatch and preserves valid arguments', async () => {
    const calls = [];
    const registry = new HostCommands([{ name: 'model', descriptionId: 'command.description.model',
        argumentHint: '[provider/model]', acceptsArgument: text => /^fixture\/.+$/u.test(text),
        run: async (argument, target) => { calls.push({ argument, target }); } }]);
    await assert.rejects(registry.execute('/model PRIVATE_ARGUMENT', 'A'), error => {
        assert.deepEqual(error.issue, { kind: 'usage', syntax: '/model [provider/model]' });
        assert.doesNotMatch(commandInputNotice(error.issue, 'ko', 'Ctrl+P'), /PRIVATE_ARGUMENT/);
        return true;
    });
    assert.deepEqual(calls, []);
    await registry.execute('/model fixture/path/to/model', 'A');
    await registry.execute('/model', 'B');
    assert.deepEqual(calls, [{ argument: 'fixture/path/to/model', target: 'A' }, { argument: '', target: 'B' }]);
});

test('original autocomplete confirmation admits a bare host command without native draft clearing', async () => {
    initTheme('dark', false);
    const terminal = { columns: 100, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {},
        hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} };
    const screen = new TuiAltScreen(terminal, true), editor = createNativeEditorFactory()(screen);
    let originalSubmitted = false;
    editor.disableSubmit = true; editor.onSubmit = () => { originalSubmitted = true; };
    editor.setAutocompleteProvider(new HostCommands([{ name: 'model', descriptionId: 'command.description.model', run: async () => {} }]).autocomplete);
    editor.handleInput('/mod');
    const deadline = Date.now() + 500;
    while (!editor.isShowingAutocomplete() && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.isShowingAutocomplete(), true);
    assert.equal(prepareHostEditorSubmit(editor, '\r', [{ name: 'model' }]), true);
    assert.equal(editor.getExpandedText(), '/model '); assert.equal(originalSubmitted, false);
    assert.equal(editor.isShowingAutocomplete(), false);
});
