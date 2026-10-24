import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { forkCommand } from '../../dist/ui/fork-command.js';
import { conversationCommands } from '../../dist/ui/conversation-commands.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { seedForkUI } from './fork-fixture.mjs';

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/fork-ui-'))), home = path.join(root, 'app');
    for (const folder of ['user', 'tmp']) await fs.mkdir(path.join(root, folder), { mode: 0o700 });
    let controller = await openController({ installationHome: home }), passed = false;
    t.after(async () => { if (controller) await controller.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained fork UI world ' + root); });
    return { root, home, get controller() { return controller; }, async close() { await controller.close(); controller = undefined; },
        async reopen() { controller = await openController({ installationHome: home }); return controller; }, pass() { passed = true; } };
}
const q = (sql, rows, params = []) => ({ sql, rows, params });
const count = n => q('SELECT COUNT(*) FROM conversations', [[n]]);
const selected = cid => q('SELECT selected FROM interaction_view', [[cid]]);
const sourceDraft = (cid, text) => q('SELECT draft FROM conversation_views WHERE conversation=?', [[text]], [cid]);
async function pty(f, source, name, steps, native) {
    const file = path.join(f.root, name + '.json');
    await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/account-ui-no-network.mjs', ...(native?.restoreControl ? ['--import', './tests/ui/fork-lifecycle-control.mjs'] : []), 'dist/cli/main.js', 'conversation', 'ui', '--home', f.home, '--conversation', source],
        env: { HOME: path.join(f.root, 'user'), TMPDIR: path.join(f.root, 'tmp'), PATH: path.dirname(process.execPath), TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', ...(native?.restoreControl ? { GITJIG_UI_RESTORE_CONTROL: native.restoreControl } : {}) },
        database: path.join(f.home, 'state/controller.sqlite'), timeoutSeconds: 3, expectedInputs: 0, steps, output: file + '.terminal', ...(native ?? {}) }), { mode: 0o600 });
    const { stdout } = await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout); assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
}

test('actual fork command awaits cancellation, rejects stale source and reports committed activation failures without duplicate production', async t => {
    const f = await fixture(t), c = f.controller, data = await seedForkUI(c, f.root, f.home), cid = data.source.conversationId;
    const before = c.listConversations().length, notices = []; let activates = 0;
    const host = { controller: c, isCurrent: () => true, chooseEntry: async () => undefined, activate: async () => { activates++; }, notice: text => notices.push(text) };
    const registry = new HostCommands(conversationCommands({ controller: c, resume: async () => 'cancelled', fork: (kind, target) => forkCommand(host, kind, target),
        choose: async () => undefined, input: async () => undefined, copy: async () => {}, notice() {} }));
    assert.ok(registry.help().includes('/fork')); assert.ok(registry.help().includes('/clone'));
    assert.equal(await registry.execute('/fork', cid), 'cancelled'); assert.equal(c.listConversations().length, before); assert.equal(activates, 0);
    await assert.rejects(registry.execute('/clone unexpected', cid), /does not accept arguments/);
    let release; const pending = new Promise(resolve => release = resolve);
    const fork = forkCommand({ ...host, chooseEntry: async () => { await pending; return data.first; } }, 'fork', cid);
    await Promise.resolve();
    await c.setConversationModelChoice({ conversationId: cid, expectedGeneration: 0, expectedRevision: 0, choice: { kind: 'unbound', reason: 'newer source choice' } });
    release(); await assert.rejects(fork, /source history or model changed/); assert.equal(c.listConversations().length, before);
    await assert.rejects(forkCommand({ ...host, activate: async () => { throw Error('controlled activation failure'); } }, 'clone', cid), /Created conversation .*opening failed/);
    assert.equal(c.listConversations().length, before + 1); assert.match(notices.at(-1), /Use \/resume/);
    let owned = true, laterActivations = 0;
    const original = c.forkConversation.bind(c); c.forkConversation = async input => { const created = await original(input); owned = false; return created; };
    assert.equal(await forkCommand({ ...host, isCurrent: () => owned, activate: async () => { laterActivations++; } }, 'clone', cid), 'completed');
    assert.equal(laterActivations, 0); assert.equal(c.listConversations().length, before + 2); assert.match(notices.at(-1), /open it with \/resume/);
    assert.equal(c.store.one('SELECT COUNT(*) AS n FROM works').n, 0); assert.equal(c.inspectConversation(data.sibling.conversationId).draft.text, 'SIBLING_KEEP');
    f.pass();
});

test('actual zero-model PTY empty clone works and no-history fork refuses without dispatch', async t => {
    const f = await fixture(t), c = f.controller, source = c.createConversation(), sibling = c.createConversation();
    c.setConversationName({ conversationId: source.conversationId, expectedGeneration: 0, name: 'EMPTY_SOURCE' });
    c.setDraft({ conversationId: sibling.conversationId, expectedRevision: 0, text: 'SIBLING_KEEP' });
    await f.close();
    await pty(f, source.conversationId, 'empty', [
        { wait: 'Model: not selected', send: '/fork\u001b\r' },
        { wait: 'Fork requires native history', assertDraft: '/fork', queries: [count(2), selected(source.conversationId)], send: '\u0015/clone\u001b\r' },
        { wait: 'Created clone', assertDraft: '', queries: [count(3), sourceDraft(source.conversationId, ''), q('SELECT parent FROM conversation_relations JOIN interaction_view ON child=selected', [[source.conversationId]])], send: '/quit\u001b\r' },
    ]);
    const reopened = await f.reopen(), clones = reopened.listConversations().filter(view => view.parentId === source.conversationId);
    assert.equal(clones.length, 1); assert.equal(clones[0].workId, null); assert.equal(clones[0].historyRef, null); assert.equal(clones[0].nativeSessionId, null);
    assert.equal(reopened.getConversationModelChoice(clones[0].conversationId).kind, 'unbound');
    assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM runs').n, 0); assert.equal(reopened.inspectConversation(sibling.conversationId).draft.text, 'SIBLING_KEEP');
    f.pass();
});

test('actual split source PTY uses original tree for cancel, stale refusal, selected fork/current clone and close without source writes', async t => {
    const f = await fixture(t), seeded = await seedForkUI(f.controller, f.root, f.home), source = seeded.source.conversationId;
    const bytes = await fs.readFile(seeded.file), native = { nativeFile: seeded.file, nativeSHA256: createHash('sha256').update(bytes).digest('hex') };
    const stagingRoot = path.join(f.home, 'state/native-forks'), stagingBefore = await fs.readdir(stagingRoot); await f.close();
    await pty(f, source, 'cancel', [
        { wait: 'Model: not selected', send: '/fork\u001b\r' },
        { wait: 'Fork · choose a context point', assertDraft: '/fork', queries: [count(3), selected(source)], nativeUnchanged: true, send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/fork', queries: [count(3), selected(source)], nativeUnchanged: true, send: '\u0015/quit\u001b\r' },
    ], native);
    assert.deepEqual(await fs.readdir(stagingRoot), stagingBefore);
    await pty(f, source, 'stale', [
        { wait: 'Model: not selected', send: '/fork\u001b\r' },
        { wait: 'Fork · choose a context point', assertDraft: '/fork', mutations: [{ sql: "UPDATE conversation_state SET data=json_set(data,'$.modelChoice',json(?)) WHERE conversation=?", params: [JSON.stringify({ kind: 'unbound', reason: 'controlled stale choice', revision: 1 }), source] }], send: '\r' },
        { wait: 'Fork source history or model changed', assertDraft: '/fork', queries: [count(3), selected(source)], nativeUnchanged: true, send: '\u0015/quit\u001b\r' },
    ], native);
    assert.deepEqual(await fs.readdir(stagingRoot), stagingBefore);
    await pty(f, source, 'confirm', [
        { wait: 'Model: not selected', send: '/fork\u001b\r' },
        { wait: 'Fork · choose a context point', assertDraft: '/fork', nativeUnchanged: true, send: '\u001b[A' },
        { wait: 'FIXTURE_FIRST_CONTEXT', nativeUnchanged: true, send: '\r' },
        { wait: 'Created fork', assertDraft: '', queries: [count(4), sourceDraft(source, ''), q('SELECT parent FROM conversation_relations JOIN interaction_view ON child=selected', [[source]])], nativeUnchanged: true, send: '/resume ' + source + '\u001b\r' },
        { wait: 'UI_SOURCE', queries: [selected(source), sourceDraft(source, '')], send: '/clone\u001b\r' },
        { wait: 'Created clone', assertDraft: '', queries: [count(5), sourceDraft(source, ''), q('SELECT parent FROM conversation_relations JOIN interaction_view ON child=selected', [[source]])], nativeUnchanged: true, send: '/quit\u001b\r' },
    ], native);
    let c = await f.reopen();
    const destinations = c.listConversations().filter(view => view.parentId === source); assert.equal(destinations.length, 2);
    for (const destination of destinations) {
        const data = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', destination.conversationId).data), history = await c.getConversationHistory(destination.conversationId);
        const texts = history.sessionManager.getBranch().filter(entry => entry.type === 'message').map(entry => entry.message.content[0].text);
        assert.deepEqual(texts, data.contextOrigin.kind === 'fork' ? ['FIXTURE_FIRST_CONTEXT'] : ['FIXTURE_FIRST_CONTEXT', 'FIXTURE_SECOND_CONTEXT']);
        assert.equal(destination.workId, null); assert.equal(c.getConversationModelChoice(destination.conversationId).reason, 'controlled stale choice');
    }
    assert.equal(c.inspectConversation(seeded.sibling.conversationId).draft.text, 'SIBLING_KEEP'); assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n, 0);
    await f.close(); const beforeClose = await fs.readdir(stagingRoot);
    await pty(f, source, 'close', [
        { wait: 'Model: not selected', send: '/fork\u001b\r' },
        { wait: 'Fork · choose a context point', assertDraft: '/fork', queries: [count(5)], nativeUnchanged: true, terminate: true, send: '' },
    ], native);
    c = await f.reopen(); assert.equal(c.inspectConversation(source).draft.text, '/fork'); assert.equal(c.listConversations().length, 5);
    assert.deepEqual(await fs.readdir(stagingRoot), beforeClose); assert.deepEqual(await fs.readFile(seeded.file), bytes); f.pass();
});

test('actual pending lifecycle restore excludes competing fork and navigation until real restore and activation settle', async t => {
    const f = await fixture(t), seeded = await seedForkUI(f.controller, f.root, f.home), source = seeded.source.conversationId;
    const restored = f.controller.createConversation();
    f.controller.setConversationName({ conversationId: restored.conversationId, expectedGeneration: 0, name: 'RESTORED_TARGET' });
    await f.controller.archiveConversation({ conversationId: restored.conversationId, expectedGeneration: 0 });
    const control = path.join(f.root, 'restore-control'); await f.close();
    await pty(f, source, 'lifecycle-held', [
        { wait: 'Model: not selected', send: '\u001b[19~' },
        { wait: 'Conversation lifecycle', send: '\u001b[B\u001b[B\u001b[B\r' },
        { wait: 'OWNED_RESTORE_BARRIER', queries: [selected(source), count(4)], send: '/fork\u001b\r\u001bOQ\u0007NEWER' },
        { wait: '/forkNEWER', queries: [selected(source), sourceDraft(source, '/forkNEWER'), count(4)], releaseFile: control + '.release', send: '' },
        { wait: 'RESTORED_TARGET', queries: [selected(restored.conversationId), sourceDraft(source, '/forkNEWER')], send: '/session\u001b\r' },
        { wait: 'Gitjig session · inspection only', assertDraft: '/session', queries: [selected(restored.conversationId), count(4)], textFiles: [{ path: control + '.history', value: '0' }], send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/session', send: '\u0015/quit\u001b\r' },
    ], { restoreControl: control });
    const c = await f.reopen();
    assert.equal(c.inspectConversation(restored.conversationId).archived, false);
    assert.equal(c.inspectConversation(source).draft.text, '/forkNEWER'); assert.equal(c.inspectConversation(seeded.sibling.conversationId).draft.text, 'SIBLING_KEEP');
    assert.equal(c.listConversations().length, 4); assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n, 0);
    assert.equal(await fs.readFile(control + '.history', 'utf8'), '0'); f.pass();
});
