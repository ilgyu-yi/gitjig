import type { Store } from './store.js';
import { sameNativeIdentity } from './native-identity.js';

export const effectAssignmentProfiles: Readonly<Record<string, readonly string[]>> = {
    'effect-prepare': ['local-git', 'github-existing-ref'],
    'effect-publication': ['publication'],
    'effect-merge': ['github-merge'],
};
/** Match only known task/operation families; legacy local records omit kind. */
export function matchesEffectAssignmentProfile(operation: string, kind: string | null | undefined): boolean {
    return Object.hasOwn(effectAssignmentProfiles, operation) &&
        effectAssignmentProfiles[operation]!.includes(kind ?? 'local-git');
}

function refuse(): never { throw Error('Cancelled native-task correspondence changed; inspect its original operation, assignment and wait'); }
function object(raw: unknown, limit = 65536): any {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > limit) refuse();
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) refuse();
    return value;
}

export interface EffectAssignmentObligation {
    assignmentId: string;
    conversationId: string;
    workId: string;
    resource: 'IDLE' | 'UNKNOWN';
}

/** Read retained operation, task and pending-wait correspondence for whole works.
 * Cancellation and restart settlement apply their own state transitions afterward.
 * An invalid sibling obligation refuses the whole read; no records are changed.
 */
export function inspectEffectAssignmentObligations(store: Store, works: ReadonlySet<string>) {
    const aliases: EffectAssignmentObligation[] = [];
    for (const workId of works) {
        const rows = store.all(`SELECT * FROM conversation_assignments WHERE work=?
            AND (state IN ('QUEUED','RUNNING','WAITING','UNAVAILABLE') OR
                state='COMPLETE' AND EXISTS (SELECT 1 FROM conversation_dependencies d WHERE d.assignment=conversation_assignments.id AND d.state='PENDING'))
            AND CASE WHEN json_valid(data) THEN json_extract(data,'$.operation') IN ('effect-prepare','effect-publication','effect-merge') ELSE 1 END`, workId);
        for (const alias of rows) {
            const data = object(alias.data), kinds = effectAssignmentProfiles[data.operation];
            if (!kinds) refuse();
            const op = store.one('SELECT * FROM effect_operations WHERE id=?', data.effectOperationId ?? null);
            if (!op || op.work !== workId) refuse();
            const metadata = object(op.data, 1048576), source = data.source;
            const view = store.one('SELECT work,resource FROM conversation_state WHERE conversation=?', alias.target);
            const work = store.one('SELECT state FROM works WHERE id=?', workId);
            const coordinator = source?.workId ? store.one('SELECT data FROM works WHERE id=?', source.workId) : null;
            if (!kinds.includes(metadata.kind ?? 'local-git') || metadata.assignmentId !== alias.id || metadata.conversationId !== alias.target ||
                !view || view.work !== workId || !work || !source || !metadata.origin?.identity ||
                !coordinator || object(coordinator.data, 1048576).conversation !== source.conversationId) refuse();
            if (data.reviewedWorkId !== undefined && data.reviewedWorkId !== workId) refuse();
            if (data.reviewedAssignmentId !== undefined) {
                const reviewed = store.one('SELECT work FROM conversation_assignments WHERE id=?', data.reviewedAssignmentId);
                if (!reviewed || reviewed.work !== workId || metadata.reviewedAssignmentId !== data.reviewedAssignmentId) refuse();
            }
            const grant = store.one('SELECT root FROM effect_delegations WHERE id=?', op.grant_id);
            if (!grant || grant.root !== data.delegationRoot) refuse();
            // Integration/merge preserve the original source in the alias and
            // record a new operation source in the existing reentry history.
            const actors = [source];
            if (!sameNativeIdentity(metadata.origin.identity, source)) {
                if (!Array.isArray(data.reentries) || data.reentries.length > 64 ||
                    !data.reentries.some((entry: any) => sameNativeIdentity(entry?.source, metadata.origin.identity))) refuse();
                actors.push(metadata.origin.identity);
            }
            // Publication reentry updates alias.source; its immutable receipts
            // retain the prior source needed by the original waiting coordinator.
            if (data.operation === 'effect-publication') {
                const receipts = store.all("SELECT data FROM effect_receipts WHERE operation=? AND kind='explicit-agent-reentry' ORDER BY rowid DESC", op.id);
                for (const receipt of receipts) {
                    const event = object(receipt.data, 1048576);
                    if (actors.some(actor => sameNativeIdentity(event.source, actor)) && event.previousOrigin?.identity)
                        actors.push(event.previousOrigin.identity);
                }
            }
            if (!actors.some(actor => actor?.conversationId === alias.source_conversation)) refuse();
            for (const dependency of store.all("SELECT waiting,target,data FROM conversation_dependencies WHERE assignment=? AND state='PENDING'", alias.id)) {
                const actor = object(dependency.data).source;
                const original = actor?.workId ? store.one('SELECT data FROM works WHERE id=?', actor.workId) : null;
                if (dependency.waiting !== alias.source_conversation || dependency.target !== alias.target ||
                    !actor || !actors.some(candidate => sameNativeIdentity(actor, candidate)) || actor.conversationId !== alias.source_conversation || !original ||
                    object(original.data, 1048576).conversation !== alias.source_conversation) refuse();
            }
            aliases.push({ assignmentId: alias.id, conversationId: alias.target, workId,
                resource: ['INVOKING','UNKNOWN'].includes(op.phase) || view.resource === 'UNKNOWN' || work.state === 'UNKNOWN' ? 'UNKNOWN' : 'IDLE' });
        }
    }
    return aliases;
}
