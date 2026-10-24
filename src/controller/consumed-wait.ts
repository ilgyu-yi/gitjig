import { sameNativeIdentity } from './native-identity.js';
import { isDeepStrictEqual } from 'node:util';
import { hash } from './change-files.js';
import { createHash } from 'node:crypto';
import { parseFileReferences } from './input-context.js';
import type { Store } from './store.js';

const bounded = (column: string, limit: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${limit} THEN ${column} ELSE NULL END`;
function unavailable(): never { throw Error('Consumed wait correspondence is unavailable; retain its original continuation records'); }
function object(raw: unknown): any {
    if (typeof raw !== 'string') unavailable();
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
    return value;
}
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 64 &&
    value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128) && new Set(value).size === value.length;
const identity = (value: any) => value && ['conversationId', 'workId', 'runId', 'initialInputId'].every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 128) &&
    value.launchId === null && Number.isSafeInteger(value.generation) && value.generation >= 0 && Number.isSafeInteger(value.directionRevision) && value.directionRevision >= 0;
const prefix = 'Explicitly resumed authorized dependency outcomes (outcome is not success): ';
const textHash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Read-only proof for pre-fix IDLE records. A false authorization flag alone
 * never establishes that their retained scheduler token was actually consumed.
 * Called only by the original owner's separately reviewed admission recovery.
 */
export function consumedWaitProof(store: Store, conversationId: string, workId: string, state: any) {
    const observations: unknown[] = [];
    let bytes = 0;
    const observe = <T>(value: T): T => {
        bytes += Buffer.byteLength(JSON.stringify(value) ?? 'null');
        if (bytes > 1048576) unavailable();
        observations.push(value); return value;
    };
    const handles = state.waitHandles, actor = state.sourceIdentity;
    if (state.continuationAuthorized !== false || !ids(handles) || !identity(actor) || actor.conversationId !== conversationId || actor.workId !== workId) unavailable();
    const waiting = observe(store.one(`SELECT id,work,phase,${bounded('data', 65536)} AS data FROM runs WHERE id=?`, actor.runId));
    const old = waiting && object(waiting.data);
    const original = observe(store.one('SELECT conversation,work,generation,state,source FROM conversation_inputs WHERE id=?', actor.initialInputId));
    if (!waiting || waiting.work !== workId || waiting.phase !== 'SETTLED' || old.kind !== 'ordinary-conversation' || old.conversation !== conversationId || old.outcome !== 'waiting' ||
        old.initialInputId !== actor.initialInputId || !original || original.conversation !== conversationId || original.work !== workId || original.generation !== actor.generation || original.state !== 'CONSUMED') unavailable();
    const originalDirection = observe(store.one(`SELECT source,${bounded('data', 65536)} AS data FROM conversation_directions WHERE conversation=? AND revision=?`, conversationId, actor.directionRevision));
    if (!originalDirection || originalDirection.source !== original.source || object(originalDirection.data).inputId !== actor.initialInputId) unavailable();
    const input = (id: string) => observe(store.one(`SELECT i.id,i.conversation,i.work,i.source,i.state,i.generation,${bounded('i.data', 65536)} AS inputData,${bounded('i.text', 131072)} AS text,${bounded('s.origin', 65536)} AS sourceOrigin,${bounded('s.raw', 131072)} AS sourceRaw,s.conversation AS sourceConversation
        FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.id=?`, id));
    const successor = (next: any, archive: any) => {
        if (!next || next.conversation !== conversationId || next.sourceConversation !== conversationId || next.work !== workId || !['CONSUMED', 'CONFLICTED', 'CANCELLED'].includes(next.state) || typeof next.sourceRaw !== 'string') unavailable();
        const directions = observe(store.all(`SELECT revision,source,${bounded('data', 65536)} AS data FROM conversation_directions WHERE conversation=? AND source=? LIMIT 2`, conversationId, next.source));
        if (directions.length !== 1 || object(directions[0].data).inputId !== next.id || archive.directionRevision !== undefined && archive.directionRevision !== directions[0].revision ||
            archive.sourceId !== undefined && archive.sourceId !== next.source) unavailable();
        const runs = observe(store.all(`SELECT id,work,phase,${bounded('data', 65536)} AS data FROM runs WHERE work=? AND json_valid(data)
            AND json_extract(data,'$.conversation')=? AND json_extract(data,'$.initialInputId')=? LIMIT 2`, workId, conversationId, next.id));
        if (runs.length !== 1 || !['SETTLED', 'INTERRUPTED'].includes(runs[0].phase) || archive.newRunId !== undefined && archive.newRunId !== runs[0].id) unavailable();
        const data = object(runs[0].data);
        if (data.kind !== 'ordinary-conversation' || data.raw !== next.text || typeof next.text !== 'string' || !['removed', 'not-allocated', 'unbound', 'confirmed'].includes(data.cleanup) || runs[0].id === waiting.id) unavailable();
        const origin = object(next.sourceOrigin), context = object(next.inputData).context;
        if (context) {
            // Captured @file/@@ input retains different raw and model text. Bind
            // the three recorded manifests and their bytes; never reopen payloads.
            const parsed = parseFileReferences(next.sourceRaw);
            if (!isDeepStrictEqual(origin.context, context) || !isDeepStrictEqual(data.inputContext, context) ||
                context.format !== 'gitjig-input-context-1' || context.inputId !== next.id || context.sourceId !== next.source || context.conversationId !== conversationId ||
                !Number.isSafeInteger(context.submissionGeneration) || context.submissionGeneration < 0 || context.submissionGeneration > next.generation ||
                context.rawSha256 !== textHash(next.sourceRaw) || context.textSha256 !== textHash(next.text) || parsed.text !== next.text ||
                !isDeepStrictEqual(parsed.references, context.references) || !Array.isArray(context.files) || context.files.length > 16) unavailable();
        }
        else if (origin.context || data.inputContext || next.sourceRaw !== next.text) unavailable();
        return { inputId: next.id as string, sourceId: next.source as string, newRunId: runs[0].id as string };
    };
    const proofs: { kind: 'superseded' | 'explicit'; runId: string; inputId: string; sourceId: string; newRunId: string }[] = [];
    const superseded = state.supersededContinuation;
    if (superseded?.runId === waiting.id) {
        if (!sameNativeIdentity(superseded.sourceIdentity, actor) || !isDeepStrictEqual(superseded.waitHandles, handles)) unavailable();
        const next = input(superseded.inputId), origin = next && object(next.sourceOrigin);
        if (!origin || origin.kind !== 'owner-conversation-input' || origin.uid !== process.getuid?.()) unavailable();
        proofs.push({ kind: 'superseded', runId: waiting.id, ...successor(next, superseded) });
    }
    const explicit = state.explicitContinuation;
    if (explicit?.runId === waiting.id) {
        if (!ids(explicit.resultIds)) unavailable();
        if (explicit.sourceIdentity !== undefined && !sameNativeIdentity(explicit.sourceIdentity, actor) || explicit.waitHandles !== undefined && !isDeepStrictEqual(explicit.waitHandles, handles) || explicit.resultIds.length !== handles.length) unavailable();
        const refs = (next: any) => {
            const origin = object(next.sourceOrigin);
            if (origin.kind !== 'agent-conversation-input' || !sameNativeIdentity(origin.actor, actor) || !next.sourceRaw?.startsWith(prefix)) return null;
            const entries = JSON.parse(next.sourceRaw.slice(prefix.length));
            if (!Array.isArray(entries) || entries.length !== handles.length || !entries.every((entry: any, index: number) => entry?.assignmentId === handles[index] && entry.resultId === explicit.resultIds[index] && ['COMPLETE', 'UNAVAILABLE'].includes(entry.outcome))) return null;
            for (const entry of entries) {
                const result = observe(store.one(`SELECT conversation,work,${bounded('data', 131072)} AS data FROM conversation_results WHERE id=?`, entry.resultId));
                if (!result || result.conversation !== entry.conversationId || result.work !== entry.workId || object(result.data).assignmentId !== entry.assignmentId) unavailable();
            }
            return entries;
        };
        let matches: any[];
        if (explicit.inputId !== undefined) {
            const next = input(explicit.inputId); matches = next && refs(next) ? [next] : [];
        }
        else {
            const candidates = store.all(`SELECT i.id FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.conversation=?
                AND json_valid(s.origin) AND json_extract(s.origin,'$.kind')='agent-conversation-input'
                AND json_extract(s.origin,'$.actor.runId')=? LIMIT 129`, conversationId, waiting.id);
            if (candidates.length > 128) unavailable();
            matches = candidates.map(row => input(row.id)).filter(next => refs(next));
        }
        if (matches.length !== 1) unavailable();
        proofs.push({ kind: 'explicit', runId: waiting.id, ...successor(matches[0], explicit) });
    }
    if (proofs.length !== 1) unavailable();
    return { ...proofs[0]!, waitHandles: handles, sourceIdentity: actor, fingerprint: hash(observations) };
}
