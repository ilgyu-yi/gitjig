import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';
import { openController } from '../../dist/controller/index.js';
import { prepareLegacyInputHistory } from './legacy-input-history-fixture.mjs';

test('legacy captured input requires a fresh allocation-absence proof and keeps the original attempt on retirement', async () => {
    const root = await temporaryDirectory('legacy-input-history'), home = path.join(root, 'app');
    const c = await openController({ installationHome: home });
    try {
        const { conversationId, input, manager, history, sessions, run } = await prepareLegacyInputHistory(c, root, home);
        const inspect = () => c.inspectConversationInputs(conversationId)[0];
        const reviewed = inspect();
        assert.equal(reviewed.retryEligible, true);
        assert.equal(c.inspectConversation(conversationId).historyRef, history);
        const retry = expectedContext => c.recoverConversationInput({ conversationId, inputId: input.id, expectedContext, action: 'retry' });
        manager.appendMessage({ role: 'user', content: 'A genuine native entry appeared', timestamp: Date.now() });
        assert.equal(inspect().legacyHistory, 'held');
        assert.throws(() => retry(reviewed.fingerprint), /not safe to recover/);
        const native = await fs.readFile(history, 'utf8');
        assert.match(native, /genuine native entry/);
        await fs.unlink(history);
        const writeRun = data => c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify(data), 'R');
        writeRun({ ...run, initialInputComparison: {} });
        assert.equal(inspect().retryEligible, false);
        const interrupted = { ...run, outcome: 'interrupted' };
        writeRun(interrupted);
        c.store.run("UPDATE conversation_inputs SET state='QUEUED' WHERE id=?", input.id);
        retry(inspect().fingerprint);
        assert.equal(c.inspectConversation(conversationId).historyRef, null);
        assert.equal(c.inspectConversation(conversationId).nativeSessionId, null);
        assert.equal(c.store.one("SELECT data FROM runs WHERE id='R'").data, JSON.stringify(interrupted));
        assert.equal(inspect().retryEligible, true);
        await fs.writeFile(history, native);
        assert.equal(inspect().retryEligible, false);
        await fs.unlink(history);
        assert.equal(inspect().retryEligible, true);
        c.store.run('INSERT INTO observations VALUES(?,?,?)', 'O', 'R', '{"type":"native-user-boundary"}');
        assert.equal(inspect().retryEligible, false);
        c.store.run("DELETE FROM observations WHERE id='O'");
        await fs.rename(sessions, sessions + '-original');
        await fs.mkdir(sessions, { mode: 0o700 });
        assert.equal(inspect().retryEligible, false);
    } finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
