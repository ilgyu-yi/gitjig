import fs from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { capture } from '../../dist/controller/capture.js';

export async function prepareLegacyInputHistory(c, root, home) {
    const project = path.join(root, 'project'), staging = path.join(root, 'captured');
    await fs.mkdir(project);
    await fs.mkdir(staging);
    await fs.writeFile(path.join(project, 'source.txt'), 'original file');
    await c.registerProject({ id: 'P', sourceRoot: project });
    const { conversationId } = c.createConversation({ projectId: 'P' });
    const original = await c.queueConversationInputWithContext({ conversationId, expectedGeneration: 0, mode: 'idle', text: 'Review @source.txt' });
    const input = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', original.inputId);
    const manifest = await capture(project, staging, { maxEntries: 32, maxBytes: 1048576, timeoutMs: 1000 }).result;
    const sessions = path.join(home, 'state/sessions');
    await fs.mkdir(sessions, { mode: 0o700 });
    const manager = SessionManager.create(project, sessions), history = manager.getSessionFile(), nativeSessionId = manager.getSessionId();
    const run = { kind: 'ordinary-conversation', conversation: conversationId, initialInputId: input.id, raw: input.text,
        ordinaryRoleBinding: { version: 1, revision: 1, sourceRunId: 'R', conversationId },
        inputContext: JSON.parse(input.data).context, allocatedNative: true, nativePromptAttempted: true,
        attainedCapture: true, manifest, historyRef: history, nativeSessionId, cleanup: 'removed', outcome: 'unavailable' };
    c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', input.source, null, 'W', 'ACTIVE', 1, 1, null, JSON.stringify({ kind: 'ordinary-conversation' }));
    c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 1, 1, 'SETTLED', staging, 'consumed', JSON.stringify(run));
    c.store.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)', 'L', 'W', 'R', 1, 1, 'RELEASED', '{}');
    c.store.run('UPDATE conversations SET generation=1,history=? WHERE id=?', history, conversationId);
    c.store.run('UPDATE conversation_state SET work=?,native_id=?,data=? WHERE conversation=?', 'W', nativeSessionId, JSON.stringify({ runId: 'R', cleanup: { cleanup: 'removed', settled: true } }), conversationId);
    c.store.run("UPDATE conversation_inputs SET work='W',generation=1,state='INITIAL_RESERVED' WHERE id=?", input.id);
    return { conversationId, input, manager, history, sessions, run };
}
