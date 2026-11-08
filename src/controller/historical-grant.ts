import type { Store } from './store.js';
const json = (value: unknown) => {
    if (typeof value !== 'string')
        throw Error('Unavailable bounded data');
    return JSON.parse(value);
};
/** Read captured lineage edges, never today's activation/epoch/assignment eligibility. */
export function historicalGrantRoot(store: Store, workId: string, root: string, scope: unknown) {
    if (!['work', 'delegation-lineage'].includes(scope as string) || root !== workId && scope !== 'delegation-lineage')
        throw Error('Original grant scope mismatch');
    const seen = new Set<string>();
    let current = workId;
    while (true) {
        if (seen.has(current) || seen.size >= 64)
            throw Error('Historical publication lineage cycle/depth');
        seen.add(current);
        const work = store.one('SELECT id,source,predecessor,CASE WHEN length(CAST(data AS BLOB))<=1048576 THEN data ELSE NULL END AS data FROM works WHERE id=?', current), data = json(work?.data);
        if (current === root)
            return;
        const source = json(store.one('SELECT CASE WHEN length(CAST(origin AS BLOB))<=65536 THEN origin ELSE NULL END AS origin FROM sources WHERE id=?', work.source)?.origin);
        const assignmentId = data.invocation?.assignmentId ?? data.assignmentId;
        let parent: string | undefined;
        if (assignmentId) {
            const assignment = store.one('SELECT work,CASE WHEN length(CAST(data AS BLOB))<=131072 THEN data ELSE NULL END AS data FROM conversation_assignments WHERE id=?', assignmentId), value = json(assignment?.data), actor = data.invocation?.actor ?? value.source;
            if (assignment.work !== current || value.operation === 'effect-prepare' || typeof value.source?.workId !== 'string' || actor?.workId !== value.source.workId || source.actor?.workId && source.actor.workId !== value.source.workId)
                throw Error('Historical assignment mismatch');
            parent = value.source.workId;
        }
        const edge = data.contextContinuation;
        if (edge) {
            if (edge.version !== 1 || edge.effects !== 'original-lineage' || typeof edge.sourceWorkId !== 'string')
                throw Error('Historical context does not carry lineage');
            const event = store.one('SELECT conversation,CASE WHEN length(CAST(origin AS BLOB))<=65536 THEN origin ELSE NULL END AS origin FROM sources WHERE id=?', edge.sourceEventId), proof = json(event?.origin);
            if (edge.kind === 'family-source') {
                if (work.predecessor !== edge.sourceWorkId || proof.kind !== 'controller-family-source-continuation' || proof.targetWorkId !== current || event.conversation !== data.conversation || proof.familyRoot !== edge.familyRoot || JSON.stringify(proof.contextContinuation) !== JSON.stringify(edge))
                    throw Error('Historical family event mismatch');
            }
            else {
                const origin = data.contextOrigin;
                if (!origin || event.conversation !== data.conversation || JSON.stringify(proof.contextOrigin) !== JSON.stringify(origin) || edge.sourceWorkId !== origin.sourceWorkId || edge.sourceConversationId !== origin.sourceConversationId || edge.sourceEventId !== origin.sourceEventId || edge.effects !== origin.effects?.ceiling || edge.sourceEpoch !== origin.effects?.sourceEpoch)
                    throw Error('Historical context event mismatch');
            }
            parent ??= edge.sourceWorkId;
        }
        else if (data.contextOrigin)
            throw Error('Historical context edge missing');
        if (!parent)
            throw Error('Unrelated historical publication grant');
        current = parent;
    }
}
