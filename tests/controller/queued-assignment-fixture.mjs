import { structuredAssignmentWorld } from './structured-assignment-fixture.mjs';

export async function queuedAssignmentWorld(t) {
    const cleanup = [];
    const f = await structuredAssignmentWorld({ after: action => cleanup.push(action), diagnostic: message => t.diagnostic(message) }); let entered, release;
    const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    f.c.ordinary.h.launchChange = async assignmentId => { entered(assignmentId); await gate; return {}; };
    const running = f.assign(); const assignmentId = await ready;
    const assignment = f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
    const input = { conversationId: assignment.target, expectedGeneration: f.c.inspectConversation(assignment.target).generation, assignmentId };
    let finished = false;
    const finish = async () => { if (!finished) { finished = true; release(); await running; } };
    t.after(async () => { try { await finish(); } finally { for (const action of cleanup) await action(); } });
    return { ...f, input, assignment, finish, snapshot() { return f.c.inspectQueuedAssignmentCancellation(input); } };
}
