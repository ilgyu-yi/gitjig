import assert from 'node:assert/strict';
import {publishConversationResult} from '../../dist/controller/conversation-results.js';
import {readGovernedDetail} from '../../dist/controller/governed-result.js';

/** Explicit pre-compact retained-state premise, not a current producer or old-binary qualification.
 * Native allocation/WAIT is real; publish the exact rich legacy body through the
 * original publisher before adopting its historical inline pointer in this owned fixture. */
export async function adoptLegacyInlineOutcome(f, child) {
    const s = f.c.store, row = s.one('SELECT state,data FROM conversation_assignments WHERE id=?', child.assignmentId), data = JSON.parse(row.data);
    assert.equal(data.result.kind, 'governed-work-observation/v1');
    const legacy = JSON.parse((await readGovernedDetail(f.home, data.result.detailRef)).toString('utf8'));
    assert.equal(legacy.workId, child.workId);
    assert.equal(legacy.reviewReady, data.result.reviewReady);
    assert.equal(legacy.epoch, data.result.epoch);
    const resultBytes = Buffer.byteLength(JSON.stringify(legacy));
    assert.ok(resultBytes > 65536 && resultBytes < 128 * 1024, 'Expected a genuine bounded rich legacy observation: ' + resultBytes);
    s.tx(() => {
        const resultId = publishConversationResult(s, child.conversationId, child.assignmentId, legacy);
        s.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify({...data, result: legacy, resultId}), child.assignmentId);
    });
    return legacy;
}
