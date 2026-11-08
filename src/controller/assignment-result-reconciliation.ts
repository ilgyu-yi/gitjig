import { effectAssignmentProfiles } from './effect-assignment-provenance.js';
import { sameNativeIdentity } from './native-identity.js';
import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import { coordinationBytes, inspectConversationResult } from './conversation-results.js';
import { inspectAssignedWorkObligations } from './assigned-work-provenance.js';
import { nativeInputRecoveryRequired, runResourceColumns, runResourcesSettled } from './completed-resources.js';
import { unallocatedProducerSql } from './capacity-settlement.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function object(raw: unknown, limit = coordinationBytes): any {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > limit) throw Error('Unbounded assignment result correspondence');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Assignment result correspondence unavailable');
    return value;
}

function resourcesSettled(store: Store, work: any): boolean {
    const runs = store.all(`SELECT ${runResourceColumns('r')} FROM runs r WHERE r.work=?`, work.id);
    if (!runs.length || runs.some(run => !runResourcesSettled(store, run)) ||
        store.one("SELECT id FROM capacity_leases WHERE work=? AND state NOT IN ('RELEASED','CANCELLED') LIMIT 1", work.id)) return false;
    const byId = new Map(runs.map(run => [run.id, run]));
    const launches = store.all(`SELECT id,run,status,resolution_reservation,
        CASE WHEN json_valid(data) THEN json_type(data)='object' ELSE 0 END AS valid,
        CASE WHEN json_valid(data) THEN ${unallocatedProducerSql('data')} ELSE 0 END AS noProducer,
        CASE WHEN json_valid(data) THEN json_extract(data,'$.cleanup') ELSE NULL END AS cleanup
        FROM role_launches WHERE work=?`, work.id);
    for (const launch of launches) {
        const run = byId.get(launch.run);
        if (!run || !launch.valid || !['COMPLETE','UNUSABLE','INTERRUPTED','CANCELLED'].includes(launch.status) ||
            !['none','consumed','released'].includes(launch.resolution_reservation)) return false;
        if (!['removed','not-allocated','unbound'].includes(launch.cleanup)) {
            if (!launch.noProducer || run.phase !== 'INTERRUPTED' || run.reservation !== 'released' || run.admission !== 'never-admitted' || !run.noProducer) return false;
        }
    }
    // Effect aliases and role conversations can share the original subject work.
    // A later owner of a conversation is not this historical producer.
    const owners = store.all('SELECT conversation,resource FROM conversation_state WHERE work=?', work.id);
    return owners.every(owner => owner.resource === 'IDLE' && !nativeInputRecoveryRequired(store, owner.conversation));
}

/** Explicit reclaim only, inside its lifecycle preflight transaction. Old structured
 * callbacks could publish an accepted result without resolving its wait. Reuse that
 * immutable publication; never manufacture a result or change producer authority.
 * Unprovable records retain their existing hold and explicit cancellation path.
 */
export function reconcileCompletedAssignmentResults(store: Store, conversationId: string): void {
    const dependencies = store.all(`SELECT d.* FROM conversation_dependencies d
        JOIN conversation_assignments a ON a.id=d.assignment
        WHERE d.waiting=? AND d.state='PENDING' AND a.state='COMPLETE' ORDER BY d.rowid LIMIT 65`, conversationId);
    if (dependencies.length > 64) return;
    const proven: string[] = [];
    for (const dependency of dependencies) {
        try {
            const assignment = store.one('SELECT * FROM conversation_assignments WHERE id=?', dependency.assignment);
            const data = object(assignment.data), raw = data.result, actor = data.source;
            const waitingActor = object(dependency.data).source;
            const work = store.one('SELECT * FROM works WHERE id=?', assignment.work);
            const coordinator = actor?.workId ? store.one('SELECT * FROM works WHERE id=?', actor.workId) : null;
            if (!work || !coordinator || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(work.state) ||
                !raw || typeof raw !== 'object' || Array.isArray(raw) || raw.runId || raw.workId !== work.id ||
                dependency.target !== assignment.target || assignment.source_conversation !== conversationId ||
                actor?.conversationId !== conversationId || !sameNativeIdentity(waitingActor, actor)) continue;
            const wd = object(work.data, 1048576), cd = object(coordinator.data, 1048576);
            if (cd.conversation !== conversationId || !cd.delegation?.rootWorkId ||
                !cd.delegation.projectIds?.includes(work.project) ||
                !store.one("SELECT id FROM works WHERE id=? AND state NOT IN ('CANCELLED','UNKNOWN')", cd.delegation.rootWorkId) ||
                !resourcesSettled(store, work)) continue;
            if (data.operation === 'change') {
                if (raw.reviewReady !== true || raw.phase !== 'REVIEW_READY' || raw.assignmentHold || raw.epoch !== work.epoch ||
                    wd.kind !== 'governed-change' || !inspectAssignedWorkObligations(store, work.id).includes(assignment.id)) continue;
                const instruction = store.one('SELECT origin FROM sources WHERE id=?', data.instructionsSource);
                const original = store.one('SELECT origin FROM sources WHERE id=?', work.source);
                if (!instruction || !original || !sameNativeIdentity(object(instruction.origin).actor, actor) ||
                    !sameNativeIdentity(object(original.origin).actor, actor)) continue;
            }
            else {
                const kinds = effectAssignmentProfiles[data.operation];
                const op = kinds && store.one('SELECT * FROM effect_operations WHERE id=?', data.effectOperationId ?? null);
                if (!op || op.work !== work.id || op.phase !== 'CONFIRMED' || raw.operationId !== op.id || raw.phase !== 'CONFIRMED') continue;
                const metadata = object(op.data, 1048576);
                const grant = store.one('SELECT root FROM effect_delegations WHERE id=?', op.grant_id);
                if (!kinds.includes(metadata.kind ?? 'local-git') || metadata.assignmentId !== assignment.id ||
                    metadata.conversationId !== assignment.target || !sameNativeIdentity(metadata.origin?.identity, actor) ||
                    !grant || grant.root !== data.delegationRoot || data.reviewedWorkId !== undefined && data.reviewedWorkId !== work.id) continue;
                if (data.reviewedAssignmentId !== undefined) {
                    const reviewed = store.one('SELECT work FROM conversation_assignments WHERE id=?', data.reviewedAssignmentId);
                    if (!reviewed || reviewed.work !== work.id || metadata.reviewedAssignmentId !== data.reviewedAssignmentId) continue;
                }
            }
            const expectedId = 'result-' + hash([assignment.target, ['structured', assignment.id, raw]]);
            if (data.resultId !== undefined && data.resultId !== expectedId) continue;
            const publication = inspectConversationResult(store, expectedId);
            if (publication.assignmentId !== assignment.id || publication.conversationId !== assignment.target ||
                publication.workId !== work.id || publication.projectId !== work.project ||
                publication.publicationHash !== hash(raw) || hash(publication.result) !== hash(raw) ||
                !Array.isArray(publication.audience) || !publication.audience.some((recipient: any) =>
                    recipient.conversationId === conversationId && recipient.rootWorkId === cd.delegation.rootWorkId &&
                    recipient.projectId === work.project)) continue;
            proven.push(dependency.id);
        }
        catch {
            // Malformed, absent, oversized or conflicting evidence retains its hold.
        }
    }
    for (const id of proven)
        store.run("UPDATE conversation_dependencies SET state='RESOLVED' WHERE id=? AND waiting=? AND state='PENDING'", id, conversationId);
}
