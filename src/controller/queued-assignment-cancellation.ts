import type { Store } from './store.js';
import { hash } from './change-files.js';
import { sameNativeIdentity } from './native-identity.js';

export interface QueuedAssignmentCancellationInput {
    conversationId: string;
    expectedGeneration: number;
    assignmentId: string;
}
function record(raw: unknown, limit = 65536): Record<string, any> {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > limit) throw Error('Queued assignment cancellation provenance exceeds its supported bounds');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Queued assignment cancellation provenance is unavailable');
    return value;
}
function held(): never { throw Error('Original queued assignment changed or has admitted work; inspect its original task and recovery'); }

/** Only an original unallocated task on a pristine idle target can be withdrawn here.
 * The controller separately excludes in-memory admission/preparation. All matching
 * inputs and dependencies participate, including records absent from list views.
 */
export function inspectQueuedAssignmentCancellation(store: Store, input: QueuedAssignmentCancellationInput) {
    const assignment = store.one('SELECT * FROM conversation_assignments WHERE id=?', input.assignmentId);
    if (!assignment || assignment.state !== 'QUEUED' || assignment.work !== null ||
        ![assignment.source_conversation, assignment.target].includes(input.conversationId) || assignment.source_conversation === assignment.target) held();
    const data = record(assignment.data);
    if (!['change', 'investigate'].includes(data.operation) || data.contextAssignment || data.contextFamilyRoot || data.reentries ||
        typeof data.inputId !== 'string' || typeof data.instructionsSource !== 'string' || !data.source ||
        data.source.conversationId !== assignment.source_conversation) held();
    const actor = data.source;
    if (typeof actor.workId !== 'string' || typeof actor.runId !== 'string' || typeof actor.initialInputId !== 'string' ||
        actor.launchId !== null || !Number.isSafeInteger(actor.generation) || !Number.isSafeInteger(actor.directionRevision)) held();
    const producer = store.one('SELECT * FROM runs WHERE id=?', actor.runId);
    const producerWork = store.one('SELECT * FROM works WHERE id=?', actor.workId);
    const producerInput = store.one('SELECT * FROM conversation_inputs WHERE id=?', actor.initialInputId);
    if (!producer || !producerWork || !producerInput || producer.work !== producerWork.id || producerInput.work !== producerWork.id ||
        producerInput.conversation !== assignment.source_conversation || producerInput.generation !== actor.generation) held();
    const producerData = record(producer.data, 1048576), producerWorkData = record(producerWork.data, 1048576);
    if (producerData.kind !== 'ordinary-conversation' || producerData.conversation !== assignment.source_conversation ||
        producerData.initialInputId !== producerInput.id || producerWorkData.conversation !== assignment.source_conversation) held();
    const conversation = (id: string) => ({
        conversation: store.one('SELECT * FROM conversations WHERE id=?', id),
        state: store.one('SELECT * FROM conversation_state WHERE conversation=?', id),
    });
    const source = conversation(assignment.source_conversation), target = conversation(assignment.target);
    if (!source.conversation || !source.state || !target.conversation || !target.state) held();
    const caller = input.conversationId === assignment.target ? target : source;
    if (caller.conversation.generation !== input.expectedGeneration) held();
    const targetData = record(target.state.data), sourceData = record(source.state.data);
    if (target.conversation.state !== 'IDLE' || target.state.resource !== 'IDLE' || target.state.archived || target.state.work !== null ||
        target.conversation.history !== null || target.state.native_id !== null || targetData.contextOrigin || targetData.role || targetData.lifecycle?.deleted ||
        sourceData.lifecycle?.deleted || source.state.archived ||
        target.conversation.project !== data.projectId || target.conversation.generation !== data.targetGeneration || target.state.direction !== data.observedTargetRevision) held();
    const assignments = store.all('SELECT * FROM conversation_assignments WHERE target=? OR source_conversation=? ORDER BY rowid LIMIT 3', assignment.target, assignment.target);
    if (assignments.length !== 1 || assignments[0].id !== assignment.id) held();
    const inputs = store.all(`SELECT * FROM conversation_inputs WHERE conversation=? OR
        (json_valid(data) AND json_extract(data,'$.assignment')=?) ORDER BY rowid LIMIT 3`, assignment.target, assignment.id);
    if (inputs.length !== 1) held();
    const original = inputs[0], originalData = record(original.data);
    const instructions = store.one('SELECT * FROM sources WHERE id=?', data.instructionsSource);
    if (!instructions || instructions.conversation !== assignment.target || typeof instructions.raw !== 'string' || Buffer.byteLength(instructions.raw) > 128 * 1024 ||
        original.id !== data.inputId || original.conversation !== assignment.target || original.generation !== data.targetGeneration || original.work !== null ||
        original.state !== 'QUEUED' || original.mode !== 'idle' || original.source !== instructions.id || original.text !== instructions.raw || originalData.assignment !== assignment.id) held();
    const origin = record(instructions.origin);
    if (origin.kind !== 'agent-assignment' || origin.event !== assignment.id || !sameNativeIdentity(origin.actor, data.source)) held();
    const dependencies = store.all('SELECT * FROM conversation_dependencies WHERE assignment=? OR target=? OR waiting=? ORDER BY rowid LIMIT 3', assignment.id, assignment.target, assignment.target);
    if (dependencies.length > 1 || dependencies.length !== (data.resultDependency === true ? 1 : 0)) held();
    for (const dependency of dependencies)
        if (dependency.assignment !== assignment.id || dependency.target !== assignment.target || dependency.waiting !== assignment.source_conversation ||
            dependency.state !== 'PENDING' || !sameNativeIdentity(record(dependency.data).source, data.source)) held();
    if (store.one("SELECT id FROM works WHERE json_valid(data) AND json_extract(data,'$.conversation')=? LIMIT 1", assignment.target) ||
        store.one("SELECT id FROM runs WHERE json_valid(data) AND (json_extract(data,'$.conversation')=? OR json_extract(data,'$.initialInputId')=?) LIMIT 1", assignment.target, original.id) ||
        store.one("SELECT id FROM goals WHERE conversation=? LIMIT 1", assignment.target)) held();
    const snapshot = { assignment, source, target, assignments, inputs, instructions, dependencies, producer, producerWork, producerInput };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 512 * 1024) held();
    return {
        conversationId: input.conversationId, generation: caller.conversation.generation as number,
        assignmentId: assignment.id as string, sourceConversationId: assignment.source_conversation as string,
        targetConversationId: assignment.target as string, projectId: data.projectId as string, operation: data.operation as 'change' | 'investigate',
        inputId: original.id as string, instructions: instructions.raw as string, pendingDependencyCount: dependencies.length,
        fingerprint: hash(snapshot),
    };
}
