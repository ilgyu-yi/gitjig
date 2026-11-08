import { createHash } from 'node:crypto';
import type { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { NativeIdentity } from './interaction-types.js';
import type { PreparedContextComparison } from './input-context.js';
import type { Store } from './store.js';
import { sameNativeIdentity } from './native-identity.js';

type UserMessage = Extract<AgentSession['messages'][number], { role: 'user' }>;
export type CapturedInputPresentation = { text: string; fileCount: number };
export type NativeInputPresentation = CapturedInputPresentation | { kind: 'goal-start'; objective: string } | { kind: 'wait-resume' };

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const key = (conversationId: string, sessionId: string, entryId: string) =>
    'captured-input-view:' + digest(JSON.stringify([conversationId, sessionId, entryId]));

function singleText(message: UserMessage): string | undefined {
    const { content } = message;
    if (typeof content === 'string') return content;
    return content?.length === 1 && content[0]?.type === 'text' ? content[0].text : undefined;
}

/** Pi emits message_end before appending that same message object to its branch. */
export function observeCapturedInputPresentation(store: Store, identity: NativeIdentity, manager: SessionManager,
    message: UserMessage, text: string, comparison: PreparedContextComparison): void {
    if (comparison.runId !== identity.runId || comparison.generation !== identity.generation)
        return;
    observeInputEntry(store, identity, manager, message, text, {
        kind: 'captured-input-presentation', inputId: comparison.inputId, sourceId: comparison.sourceId,
        manifestSha256: comparison.inputManifestSha256,
    });
}

function observeInputEntry(store: Store, identity: NativeIdentity, manager: SessionManager, message: UserMessage, text: string,
    presentation: Record<string, string>): void {
    if (singleText(message) !== text) return;
    const parent = manager.getLeafId(), sessionId = manager.getSessionId();
    queueMicrotask(() => {
        try {
            const id = manager.getLeafId(), entry = id && manager.getEntry(id);
            if (!entry || entry.type !== 'message' || entry.parentId !== parent || entry.message !== message ||
                manager.getSessionId() !== sessionId || singleText(message) !== text)
                return;
            const receipt = { ...presentation, nativeTextSha256: digest(text) };
            store.run('INSERT OR IGNORE INTO observations VALUES(?,?,?)', key(identity.conversationId, sessionId, entry.id), identity.runId, JSON.stringify(receipt));
        } catch { /* Optional presentation evidence must not affect native input accounting. */ }
    });
}

function originalPlainInput(store: Store, conversationId: string, runId: string, sessionId: string) {
    return store.one(`SELECT i.id,i.source,i.text,i.generation,s.origin,json_extract(i.data,'$.ownerGoalStart') AS goalStart
        FROM runs r JOIN conversation_inputs i ON i.id=json_extract(r.data,'$.initialInputId') AND i.work=r.work
        JOIN sources s ON s.id=i.source AND s.conversation=i.conversation
        WHERE r.id=? AND json_extract(r.data,'$.conversation')=? AND json_extract(r.data,'$.nativeSessionId')=? AND i.conversation=?
          AND length(CAST(i.text AS BLOB))<=131072 AND length(CAST(i.data AS BLOB))<=65536
          AND length(CAST(s.origin AS BLOB))<=65536 AND json_valid(i.data) AND json_valid(s.origin)
          AND s.raw=i.text`, runId, conversationId, sessionId, conversationId);
}

/** Only the initial host-owned input held by this actual run may receive a display receipt. */
export function observeHostInputPresentation(store: Store, identity: NativeIdentity, manager: SessionManager, message: UserMessage, text: string): void {
    try {
        const input = originalPlainInput(store, identity.conversationId, identity.runId, manager.getSessionId());
        if (!input || input.id !== identity.initialInputId || input.generation !== identity.generation || input.text !== text)
            return;
        const origin = JSON.parse(input.origin);
        let kind: 'goal-start' | 'wait-resume';
        if (origin.kind === 'owner-conversation-input' && input.goalStart &&
            readOriginalGoalObjective(store, identity.conversationId, input)) {
            kind = 'goal-start';
        } else if (origin.kind === 'agent-conversation-input' && origin.actor) {
            const row = store.one(`SELECT json_extract(data,'$.explicitContinuation') AS wait FROM conversation_state
                WHERE conversation=? AND length(CAST(data AS BLOB))<=131072 AND json_valid(data)`, identity.conversationId);
            const wait = row?.wait && JSON.parse(row.wait);
            if (!wait || wait.newRunId !== identity.runId || wait.inputId !== input.id || wait.sourceId !== input.source ||
                wait.directionRevision !== identity.directionRevision || wait.runId !== origin.actor.runId ||
                !wait.sourceIdentity || !sameNativeIdentity(wait.sourceIdentity, origin.actor) ||
                origin.actor.conversationId !== identity.conversationId || origin.actor.workId !== identity.workId ||
                !Array.isArray(wait.waitHandles) || !Array.isArray(wait.resultIds) || !wait.waitHandles.length ||
                wait.waitHandles.length > 64 || wait.waitHandles.length !== wait.resultIds.length)
                return;
            kind = 'wait-resume';
        } else return;
        observeInputEntry(store, identity, manager, message, text, { kind, inputId: input.id, sourceId: input.source, originSha256: digest(input.origin) });
    } catch { /* Optional presentation evidence must not affect native input accounting. */ }
}

export function readNativeInputPresentation(store: Store, conversationId: string, sessionId: string, entryId: string, nativeText: string): NativeInputPresentation | undefined {
    try {
        const observation = store.one(`SELECT run,data FROM observations WHERE id=? AND length(CAST(data AS BLOB))<=65536`,
            key(conversationId, sessionId, entryId));
        if (!observation) return;
        const receipt = JSON.parse(observation.data);
        if (receipt.kind === 'captured-input-presentation')
            return readCapturedInputPresentation(store, conversationId, sessionId, entryId, nativeText);
        if (!['goal-start', 'wait-resume'].includes(receipt.kind) || digest(nativeText) !== receipt.nativeTextSha256)
            return;
        const input = originalPlainInput(store, conversationId, observation.run, sessionId);
        if (!input || input.id !== receipt.inputId || input.source !== receipt.sourceId || input.text !== nativeText || digest(input.origin) !== receipt.originSha256)
            return;
        const origin = JSON.parse(input.origin);
        if (receipt.kind === 'wait-resume' && origin.kind === 'agent-conversation-input')
            return { kind: 'wait-resume' };
        if (receipt.kind === 'goal-start' && origin.kind === 'owner-conversation-input' && input.goalStart) {
            const objective = readOriginalGoalObjective(store, conversationId, input);
            if (objective) return { kind: 'goal-start', objective };
        }
    } catch { return undefined; }
}

export function readCapturedInputPresentation(store: Store, conversationId: string, sessionId: string, entryId: string, nativeText: string): CapturedInputPresentation | undefined {
    try {
        const row = store.one(`SELECT s.raw, json_array_length(i.data,'$.context.files') AS fileCount,
            json_extract(i.data,'$.context.rawSha256') AS originalDigest, json_extract(i.data,'$.context') AS manifest, o.data AS receipt
            FROM observations o JOIN runs r ON r.id=o.run
            JOIN conversation_inputs i ON i.id=json_extract(o.data,'$.inputId') AND i.conversation=? AND i.work=r.work
            JOIN sources s ON s.id=i.source AND s.id=json_extract(o.data,'$.sourceId') AND s.conversation=i.conversation
            WHERE o.id=? AND json_extract(o.data,'$.kind')='captured-input-presentation' AND json_extract(r.data,'$.nativeSessionId')=? AND
              length(CAST(s.raw AS BLOB))<=524288 AND json_extract(i.data,'$.context')=json_extract(s.origin,'$.context')`,
        conversationId, key(conversationId, sessionId, entryId), sessionId);
        if (!row || !Number.isSafeInteger(row.fileCount) || row.fileCount < 1 || row.fileCount > 16)
            return;
        const receipt = JSON.parse(row.receipt);
        if (digest(row.raw) !== row.originalDigest || digest(row.manifest) !== receipt.manifestSha256 || digest(nativeText) !== receipt.nativeTextSha256)
            return;
        return { text: row.raw, fileCount: row.fileCount };
    } catch { return undefined; }
}

export function readOriginalGoalObjective(store: Store, conversation: string, input: {id: string; source: string; text: string; goalStart: string}): string | undefined {
    let entry, definition;
    try {
        entry = JSON.parse(input.goalStart);
        definition = JSON.parse(input.text);
    } catch { return; }
    if (entry?.version !== 1 || entry.inputId !== input.id || entry.sourceId !== input.source || entry.conversationId !== conversation ||
        typeof entry.goalId !== 'string' || typeof entry.ownerEventId !== 'string' || !Number.isSafeInteger(entry.goalRevision) ||
        definition?.goalId !== entry.goalId || definition.goalRevision !== entry.goalRevision ||
        typeof definition.objective !== 'string' || !definition.objective.trim() || !Array.isArray(definition.criteria))
        return;
    const { objective, criteria } = definition;
    const fingerprint = digest(JSON.stringify({ objective, criteria }));
    if (fingerprint !== entry.definitionHash)
        return;
    const decision = store.one(`SELECT 1 AS matches FROM goal_events e JOIN goals g ON g.id=e.goal
        WHERE e.id=? AND e.goal=? AND g.conversation=? AND e.kind='owner-resume' AND
        CASE WHEN length(CAST(e.data AS BLOB))<=65536 AND json_valid(e.data) THEN
            json_extract(e.data,'$.ownerGoalStart.inputId')=? AND json_extract(e.data,'$.ownerGoalStart.sourceId')=? AND
            json_extract(e.data,'$.ownerGoalStart.definitionHash')=? AND json_extract(e.data,'$.ownerGoalStart.goalRevision')=? END`,
        entry.ownerEventId, entry.goalId, conversation, input.id, input.source, fingerprint, entry.goalRevision);
    return decision ? objective : undefined;
}
