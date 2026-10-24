// Controlled unstarted records discriminate display states; no execution success is fabricated.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { openController } from '../../dist/controller/index.js';
import { capture } from '../../dist/controller/capture.js';
import { prepareCapturedInput } from '../../dist/controller/input-context.js';
import { conversationCommands } from '../../dist/ui/conversation-commands.js';
import { HostCommands } from '../../dist/ui/host-commands.js';

let requests = 0;
globalThis.fetch = async () => { requests++; throw Error('No fetch in context inspection'); };
net.Socket.prototype.connect = function () { requests++; throw Error('No socket in context inspection'); };
const root = process.argv[2], home = path.join(root, 'app'), source = path.join(root, 'source');
await fs.mkdir(source, { mode: 0o700 });
let c = await openController({ installationHome: home });
const sha = text => createHash('sha256').update(text).digest('hex');
try {
    await c.registerProject({ id: 'P', sourceRoot: source });
    const view = c.createConversation({ projectId: 'P' }), cid = view.conversationId;
    const status = () => c.inspectConversationContext({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation }).rows.join('\n');
    assert.match(status(), /Captured inputs · none/);
    await fs.writeFile(path.join(source, 'AGENTS.md'), 'PRIVATE_ROOT_CONTENT_CANARY');
    await fs.writeFile(path.join(source, 'file.txt'), 'PRIVATE_FILE_CONTENT_CANARY');
    await fs.writeFile(path.join(source, 'gone.txt'), 'PRIVATE_REMOVED_CONTENT_CANARY');
    const input = await c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 0, text: 'PRIVATE_INPUT_CANARY @file.txt @gone.txt', mode: 'idle' });
    assert.match(status(), /queued/); assert.match(status(), /not prepared/); assert.match(status(), /"AGENTS.md"/);
    const original = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', input.inputId);
    await c.close(); c = await openController({ installationHome: home });
    assert.deepEqual({ ...c.store.one('SELECT * FROM conversation_inputs WHERE id=?', input.inputId) }, { ...original }); assert.match(status(), /not prepared/);
    await fs.writeFile(path.join(source, 'file.txt'), 'WORKCOPY_CONTROL'); await fs.rm(path.join(source, 'gone.txt'));
    const workcopy = path.join(root, 'workcopy'); await fs.mkdir(workcopy, { mode: 0o700 });
    const manifest = await capture(source, workcopy, { maxEntries: 100, maxBytes: 1048576, timeoutMs: 1000 }).result;
    const manager = SessionManager.create(source, path.join(home, 'artifacts'));
    manager.appendCustomEntry('fixture', { kind: 'unstarted UI controls; not generated history' });
    manager.appendMessage({ role: 'user', content: 'NON_AUTHORITY_HISTORY_CONTROL', timestamp: Date.now() });
    const file = manager.getSessionFile(), nativeBytes = await fs.readFile(file);
    c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', input.sourceId, null, 'W', 'INTERRUPTED', 1, 1, null, '{"fixture":"unstarted UI record controls"}');
    const base = { fixture: 'unstarted UI record controls; no execution success', conversation: cid, initialInputId: input.inputId, attainedCapture: true, manifest,
        nativeSessionId: manager.getSessionId(), historyRef: file, outcome: 'fixture-unstarted' };
    c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 1, 1, 'INTERRUPTED', workcopy, 'released', JSON.stringify(base));
    c.store.run('UPDATE conversations SET generation=1 WHERE id=?', cid);
    c.store.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?', 'W', JSON.stringify({ runId: 'R' }), cid);
    c.store.run('UPDATE conversation_inputs SET generation=1,work=?,state=? WHERE id=?', 'W', 'INITIAL_RESERVED', input.inputId);
    const prepared = await prepareCapturedInput(c.store, path.join(home, 'state'), input.inputId, { identity: { conversationId: cid, workId: 'W', runId: 'R', launchId: null,
        generation: 1, directionRevision: 1, initialInputId: input.inputId }, kind: 'initial' });
    const data = { ...base, initialInputComparison: prepared.comparison };
    const write = value => c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify(value), 'R'); write(data);
    for (const [state, label] of [['NATIVE_PENDING', 'native pending'], ['CONSUMED', 'consumed'], ['CONFLICTED', 'superseded'], ['RECONCILIATION_REQUIRED', 'reconciliation required'], ['CANCELLED', 'cancelled']]) {
        c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', state, input.inputId);
        assert.match(status(), new RegExp(label)); assert.match(status(), /"file.txt" · different/); assert.match(status(), /"gone.txt" · missing/); assert.match(status(), /"AGENTS.md" · same/);
    }
    for (const state of ['UNKNOWN', 'constructor', 'toString', '__proto__']) {
        c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', state, input.inputId);
        const unavailable = status(); assert.match(unavailable, /unavailable/);
        assert.ok(!unavailable.includes(state)); assert.doesNotMatch(unavailable, /function|\[object Object\]|PRIVATE_|[a-f0-9]{64}/);
    }
    c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'NATIVE_PENDING', input.inputId);
    for (const value of [{ ...data, initialInputComparison: null }, { ...data, initialInputComparison: { ...prepared.comparison, runId: 'OTHER' } },
        { ...data, conversation: c.createConversation().conversationId }, { ...data, manifest: { ...manifest, digest: '0'.repeat(64) } }]) {
        write(value); assert.match(status(), /unavailable/); assert.doesNotMatch(status(), /"gone.txt" · missing/);
    }
    write(base); assert.match(status(), /not prepared/); write(data);
    // Conflicting duplicate preparation remains unavailable, never first-match selection.
    write({ ...data, routedInputs: [{ inputId: input.inputId, sourceId: input.sourceId, generation: 1, context: JSON.parse(original.data).context,
        comparison: { ...prepared.comparison, captureDigest: '0'.repeat(64) } }] }); assert.match(status(), /unavailable/); write(data);
    c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?', '{"context":null}', input.inputId); assert.match(status(), /unavailable/);
    c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?', original.data, input.inputId);
    c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'CONFLICTED', input.inputId);
    // Historical comparison stays valid after operational generation/work advance.
    c.store.run('UPDATE conversations SET generation=2 WHERE id=?', cid); c.store.run('UPDATE works SET generation=2 WHERE id=?', 'W');
    assert.match(status(), /generation 1 · superseded/); assert.match(status(), /"file.txt" · different/);
    assert.throws(() => c.inspectConversationContext({ conversationId: cid, expectedGeneration: 1 }), /changed/);
    const empty = c.createConversation(), noFiles = await c.queueConversationInputWithContext({ conversationId: empty.conversationId, expectedGeneration: 0, text: 'plain', mode: 'idle' });
    assert.ok(noFiles.inputId); assert.match(c.inspectConversationContext({ conversationId: empty.conversationId, expectedGeneration: 0 }).rows.join('\n'), /none captured/);
    // Real captures at16 distinct files and9 inputs exercise actual bounded presentation.
    const bound = c.createConversation({ projectId: 'P' }), names = [];
    const prefix = Array.from({ length: 5 }, (_, i) => 'd' + i + 'x'.repeat(100)).join('/'); await fs.mkdir(path.join(source, prefix), { recursive: true });
    for (let i = 0; i < 15; i++) { const name = prefix + '/bound-' + i; names.push(name); await fs.writeFile(path.join(source, name), 'BOUND_PRIVATE_CANARY'); }
    for (let i = 0; i < 9; i++) await c.queueConversationInputWithContext({ conversationId: bound.conversationId, expectedGeneration: 0, text: names.map(name => '@' + name).join(' '), mode: 'follow-up' });
    const bounded = c.inspectConversationContext({ conversationId: bound.conversationId, expectedGeneration: 0 });
    assert.equal(bounded.more, true); assert.ok(Buffer.byteLength(bounded.rows.join('\n')) <= 16 * 1024); assert.match(bounded.rows.join('\n'), /omitted/); assert.match(bounded.rows.join('\n'), /shortened/);
    assert.ok(bounded.rows.filter(row => row.startsWith('Captured input ')).length <= 8);
    await fs.writeFile(path.join(source, 'rtl\u202e.txt'), 'FORMAT_PRIVATE_CANARY');
    const rtl = c.createConversation({ projectId: 'P' }); await c.queueConversationInputWithContext({ conversationId: rtl.conversationId, expectedGeneration: 0, text: '@rtl\u202e.txt', mode: 'idle' });
    const escaped = c.inspectConversationContext({ conversationId: rtl.conversationId, expectedGeneration: 0 }).rows.join('\n'); assert.ok(!escaped.includes('\u202e')); assert.match(escaped, /u\{202e\}/);
    await c.close(); c = await openController({ installationHome: home });
    assert.match(status(), /"file.txt" · different/); assert.match(status(), /"gone.txt" · missing/);
    let labels; const registry = new HostCommands(conversationCommands({ controller: c, resume: async () => 'cancelled', fork: async () => 'cancelled',
        choose: async (_title, values) => { labels = values; return undefined; }, input: async () => undefined, copy: async () => {}, notice() {} }));
    const before = JSON.stringify([c.store.all('SELECT * FROM conversation_inputs'), c.store.all('SELECT * FROM sources'), c.store.all('SELECT * FROM works'), c.store.all('SELECT * FROM runs')]);
    assert.equal(await registry.execute('/session', cid), 'cancelled');
    const joined = labels.join('\n'); assert.match(joined, /"file.txt" · different/); assert.match(joined, /Recorded usage · unavailable/);
    assert.doesNotMatch(joined, /PRIVATE_|BOUND_PRIVATE|FORMAT_PRIVATE|\/state\/|\/artifacts\/|gitjig-input-context|[a-f0-9]{64}/);
    assert.ok(!joined.includes(root)); assert.ok(!joined.includes(prepared.comparison.inputManifestSha256));
    const history = c.getConversationHistory.bind(c);
    c.getConversationHistory = async id => { const result = await history(id); c.setConversationView({ selectedId: empty.conversationId }); return result; };
    await registry.execute('/session', cid); assert.equal(c.store.one('SELECT selected FROM interaction_view WHERE id=1').selected, empty.conversationId); assert.match(labels.join('\n'), /"gone.txt" · missing/);
    let shown = false;
    const stale = new HostCommands(conversationCommands({ controller: c, resume: async () => 'cancelled', fork: async () => 'cancelled', choose: async () => { shown = true; }, input: async () => undefined, copy: async () => {}, notice() {} }));
    c.getConversationHistory = async id => { const result = await history(id); c.store.run('UPDATE conversations SET generation=3 WHERE id=?', id); return result; };
    await assert.rejects(stale.execute('/session', cid), /history or model changed/); assert.equal(shown, false); c.store.run('UPDATE conversations SET generation=2 WHERE id=?', cid);
    c.getConversationHistory = history;
    assert.equal(JSON.stringify([c.store.all('SELECT * FROM conversation_inputs'), c.store.all('SELECT * FROM sources'), c.store.all('SELECT * FROM works'), c.store.all('SELECT * FROM runs')]), before);
    assert.deepEqual(await fs.readFile(file), nativeBytes); assert.equal(requests, 0);
    await fs.writeFile(path.join(root, 'status-receipt.json'), JSON.stringify({ cid, inputs: c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n, historyFile: file, historyHash: sha(nativeBytes), scope: 'real capture and controlled unstarted UI records only', requests }));
} finally { await c.close(); }
console.log(JSON.stringify({ outcome: 'passed', requests }));
