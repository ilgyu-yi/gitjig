import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initTheme, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Input, TuiAltScreen } from '@earendil-works/pi-tui';
import { AccountDialog } from '../../dist/ui/account-dialog.js';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';

initTheme('dark', false);
const terminal = { columns: 100, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {},
    showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} };
const screen = new TuiAltScreen(terminal, true);
const frame = dialog => dialog.render(100).join('\n');
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve }; };

test('secret/manual-code prompts never render original Input and discard prior editing state', async () => {
    const original = Input.prototype.render; let originalRenders = 0;
    Input.prototype.render = function (...args) { originalRenders++; return original.apply(this, args); };
    const dialog = new AccountDialog(screen, () => {}, { forceSecret: true, onLeave() {} }); dialog.focused = true;
    try {
        const first = dialog.interaction.prompt({ type: 'text', message: 'Original API-key prompt tagged text' });
        dialog.handleInput('DUMMY_HIDDEN_KEY'); assert.ok(!frame(dialog).includes('DUMMY_HIDDEN_KEY'));
        dialog.handleInput('\r'); assert.equal(await first, 'DUMMY_HIDDEN_KEY');
        dialog.interaction.notify({ type: 'progress', message: 'DUMMY_HIDDEN_KEY' }); assert.ok(!frame(dialog).includes('DUMMY_HIDDEN_KEY'));
        const next = dialog.interaction.prompt({ type: 'secret', message: 'Next secret' });
        dialog.handleInput('\x1a'); dialog.handleInput('\r'); assert.equal(await next, '', 'Fresh original Input cannot undo/yank the preceding prompt');
        const longSecret = 'DUMMY_LONG_' + 'K'.repeat(6000);
        for (const value of [longSecret, longSecret + 'PRIVATE_SUFFIX']) {
            const pending = dialog.interaction.prompt({ type: 'secret', message: 'Long secret' });
            dialog.handleInput(value); dialog.handleInput('\r'); assert.equal(await pending, value);
            dialog.interaction.notify({ type: 'progress', message: 'Received ' + value });
            assert.ok(!frame(dialog).includes('K'.repeat(32))); assert.ok(!frame(dialog).includes('PRIVATE_SUFFIX'));
        }
        dialog.interaction.notify({ type: 'info', message: 'X'.repeat(64 * 1024 + 1) });
        assert.match(frame(dialog), /exceeds the display limit/);
        assert.equal(originalRenders, 0);
    } finally { dialog.dispose(); Input.prototype.render = original; }
    const code = new AccountDialog(screen, () => {}, { forceSecret: false, openBrowser: async()=>true, onLeave() {} });
    const answer = code.interaction.prompt({ type: 'manual_code', message: 'Paste callback URL' });
    code.handleInput('DUMMY_CALLBACK_CODE'); assert.ok(!frame(code).includes('DUMMY_CALLBACK_CODE'));
    code.handleInput('\r'); assert.equal(await answer, 'DUMMY_CALLBACK_CODE'); assert.ok(!frame(code).includes('DUMMY_CALLBACK_CODE')); code.dispose();
    const controlled = new AccountDialog(screen, () => {}, { forceSecret: false, openBrowser: async()=>true, onLeave() {} });
    const value = 'DUMMY_\x1b[31mCONTROL_CODE\x1b[0m_END';
    const pasted = controlled.interaction.prompt({ type: 'manual_code', message: 'Callback with controls' });
    controlled.handleInput('\x1b[200~' + value + '\x1b[201~'); controlled.handleInput('\r');
    assert.equal(await pasted, value, 'Original Input owns answer semantics; rendering does not rewrite it');
    controlled.interaction.notify({ type: 'progress', message: 'Received ' + value });
    assert.ok(!frame(controlled).includes('CONTROL_CODE')); controlled.dispose();
});

test('per-prompt abort is distinct from whole operation and cannot clear a newer prompt', async () => {
    let changed = 0, left = 0;
    const dialog = new AccountDialog(screen, () => changed++, { forceSecret: false, onLeave() { left++; } });
    const step = new AbortController(), first = dialog.interaction.prompt({ type: 'manual_code', message: 'Callback', signal: step.signal });
    const rejected = assert.rejects(first, { name: 'AbortError' }); step.abort(); await rejected;
    assert.equal(dialog.signal.aborted, false);
    const second = dialog.interaction.prompt({ type: 'text', message: 'New prompt' });
    step.abort(); assert.match(frame(dialog), /New prompt/); dialog.handleInput('DUMMY_VISIBLE_USER'); dialog.handleInput('\r');
    assert.equal(await second, 'DUMMY_VISIBLE_USER');
    await assert.rejects(dialog.interaction.prompt({ type: 'text', message: 'Already aborted', signal: step.signal }), { name: 'AbortError' });
    const selected = dialog.interaction.prompt({ type: 'select', message: 'Select identity', options: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }] });
    dialog.handleInput('\r'); assert.equal(await selected, 'a');
    dialog.handleInput('\x04'); assert.equal(dialog.signal.aborted, true); assert.equal(left, 1);
    assert.match(frame(dialog), /waiting for account storage/); dialog.dispose(); const before = changed;
    dialog.interaction.notify({ type: 'auth_url', url: 'https://unused.invalid/late' });
    await assert.rejects(dialog.interaction.prompt({ type: 'secret', message: 'Late secret' }), { name: 'AbortError' }); assert.equal(changed, before);
});

test('original Pi OAuth consumer retains account/home ownership through controlled callback and cancelled producer tails', { timeout: 6000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/auth-dialog-'))), home = path.join(root, 'app');
    let passed = false, gate;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained controlled auth world: ' + root); });
    const create = ModelRuntime.create;
    ModelRuntime.create = async function (...args) {
        const runtime = await create.apply(this, args), provider = runtime.getProvider('openai');
        provider.auth.oauth = { name: 'Controlled original consumer', async login(interaction) {
            const step = new AbortController(), answer = interaction.prompt({ type: 'manual_code', message: 'Callback code', signal: step.signal });
            const settled = Promise.allSettled([answer]);
            interaction.notify({ type: 'auth_url', url: 'https://unused.invalid/owned-sign-in' }); gate.enter.resolve(step);
            await gate.release.promise; step.abort(); await settled; interaction.signal.throwIfAborted();
            return { type: 'oauth', access: 'DUMMY_OAUTH_ACCESS', refresh: 'DUMMY_OAUTH_REFRESH', expires: Date.now() + 3600000 };
        }, async refresh() { throw Error('Unexpected refresh'); }, async toAuth(value) { return { apiKey: value.access }; } };
        return runtime;
    };
    const controller = await openController({ installationHome: home }), accounts = ApplicationAccounts.open(controller);
    try {
        for (const cancel of [false, true]) {
            gate = { enter: deferred(), release: deferred() };
            const dialog = new AccountDialog(screen, () => {}, { forceSecret: false, openBrowser: async()=>true, onLeave() {} });
            let finished = false; const login = accounts.login('openai', 'oauth', dialog.interaction);
            const outcome = Promise.allSettled([login]); void outcome.then(() => { finished = true; });
            const step = await gate.enter.promise; dialog.handleInput('DUMMY_MANUAL_CALLBACK');
            assert.ok(!frame(dialog).includes('DUMMY_MANUAL_CALLBACK')); assert.match(frame(dialog), /owned-sign-in/);
            if (cancel) dialog.cancel(); else step.abort();
            await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
            assert.equal(dialog.signal.aborted, cancel);
            await assert.rejects(openController({ installationHome: home }), /owned|OWNER_BUSY|owner/i);
            assert.throws(() => controller.beginApplicationMutation(), /settling/);
            gate.release.resolve(); const [result] = await outcome;
            assert.equal(result.status, cancel ? 'rejected' : 'fulfilled'); dialog.dispose();
            const stored = JSON.parse(await fs.readFile(path.join(home, 'config/auth.json'), 'utf8'));
            assert.equal(stored.openai.access, 'DUMMY_OAUTH_ACCESS'); // Cancellation does not imply rollback of the earlier successful account.
        }
        passed = true;
    } finally { gate?.release.resolve(); await controller.close(); ModelRuntime.create = create; }
});


test('browser failure keeps the original sign-in URL visible through progress updates', async () => {
    const dialog = new AccountDialog(screen, () => {}, {forceSecret:false,onLeave(){},openBrowser:async()=>false});
    try {
        dialog.interaction.notify({type:'auth_url',url:'https://unused.invalid/manual-fallback'});
        for(let i=0;i<8;i++)dialog.interaction.notify({type:'progress',message:'Progress '+i});
        await new Promise(resolve=>setImmediate(resolve));
        assert.match(frame(dialog),/manual-fallback/);assert.match(frame(dialog),/Browser could not open/);
    } finally {dialog.dispose();}
});
