import type { Store } from './store.js';
import { mergeGrantHistory } from './merge-grant-history.js';
import { hash } from './change-files.js';
import { ownerRootActivation } from './owner-activation.js';
import { contextWorkContinuation } from './context-origin.js';
import { receiverTransmissionHolds } from './integration-transmission.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
/** A conditional owner ceiling. No procedure evidence, native reads or execution. */
export function mergeDelegation(store: Store, workId: string, targetId: string, target: unknown, busy = false, purpose: 'declaration' | 'renewal' = 'declaration') {
    const work = store.one(`SELECT id,project,source,predecessor,lineage,state,epoch,generation,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, workId);
    if (!work)
        throw Error('Original owner merge work unavailable');
    const project = store.one(`SELECT id,${bounded('root', 4096)} AS root,${bounded('profile', 131072)} AS profile FROM projects WHERE id=?`, work.project);
    const change = store.one('SELECT phase,epoch FROM change_state WHERE work=?', workId), source = store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 32768)} AS raw FROM sources WHERE id=?`, work.source), grants = store.all(`SELECT id,root,target,epoch,${bounded('data', 65536)} AS data FROM effect_delegations WHERE root=? AND target=? LIMIT 2`, workId, targetId), runs = store.all(`SELECT id,phase,reservation,${bounded('data', 65536)} AS data FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 129`, workId), capacities = store.all("SELECT id,state FROM capacity_leases WHERE work=? AND state NOT IN ('RELEASED','CANCELLED') LIMIT 129", workId), budgets = store.all("SELECT * FROM budgets WHERE lineage=? AND kind IN ('execution','resolution') ORDER BY kind", work.lineage);
    const grantSources = grants.map(row => {
        try {
            return store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 65536)} AS raw FROM sources WHERE id=?`, JSON.parse(row.data).source);
        }
        catch {
            return null;
        }
    });
    const settledMerge = (row: Record<string, any>, data: Record<string, any>) => {
        if (data.kind !== 'merge-http' || !(row.phase === 'SETTLED' && data.cleanup === 'in-process-http-settled' || row.phase === 'INTERRUPTED' && data.cleanup === 'owner-dead-http-producer') || typeof data.operationId !== 'string' || !['prepare', 'dispatch', 'reconcile'].includes(data.phase))
            return false;
        const operation = store.one(`SELECT work,CASE WHEN length(CAST(data AS BLOB))<=1048576 AND json_valid(data) THEN json_extract(data,'$.kind') ELSE NULL END AS kind FROM effect_operations WHERE id=?`, data.operationId);
        return operation?.work === workId && operation.kind === 'github-merge';
    };
    const holds: string[] = [];
    let history: ReturnType<typeof mergeGrantHistory> | null = null;
    let transmission: ReturnType<typeof receiverTransmissionHolds> = [], existing: {
        delegationId: string;
        epoch: number;
        rootEpoch: number;
        sourceId: string;
        scope: 'work' | 'delegation-lineage';
        operationLimit: number;
        used: number;
        remaining: number;
    } | null = null;
    const t = target as {
        state: string;
        projectId?: string;
        configuration?: {
            target: Record<string, any>;
        };
    };
    try {
        if (t.state !== 'RETAINED')
            throw Error('Original PR merge target unavailable');
        if (!project || typeof project.root !== 'string' || typeof project.profile !== 'string')
            throw Error('Original bounded registered project unavailable');
        const data = JSON.parse(work.data), origin = JSON.parse(source?.origin);
        if (work.project !== t.projectId)
            throw Error('Original owner work and merge target must share a project');
        if (!source?.raw?.trim() || !origin || !String(origin.kind).startsWith('owner-') || origin.uid !== process.getuid?.())
            throw Error('Original bounded owner request/source unavailable');
        if (data.kind !== 'governed-change' || !change || Object.hasOwn(data, 'contextOrigin') || Object.hasOwn(data, 'contextContinuation') || data.invocation?.assignmentId || data.assignmentId !== undefined && data.assignmentId !== null || contextWorkContinuation(store, workId) || work.lineage !== work.id || work.predecessor)
            throw Error('Independent original owner governed work required; ordinary roots use captured startup authority');
        const activation = ownerRootActivation(data);
        if (activation && activation.state !== 'COMPLETE')
            throw Error('Original captured owner activation requires recovery');
        if (!['ACTIVE', 'DELIVERED'].includes(work.state) || !Number.isSafeInteger(work.epoch) || work.epoch < 1 || !Number.isSafeInteger(work.generation) || work.generation < 1)
            throw Error('Original work state or epoch requires recovery');
        if (busy || runs.length > 128 || runs.reduce((n, row) => n + Buffer.byteLength(row.data ?? ''), 0) > 1048576 || runs.some(row => {
            if (!row.data)
                return true;
            const d = JSON.parse(row.data);
            return !['SETTLED', 'INTERRUPTED'].includes(row.phase) || !['consumed', 'released'].includes(row.reservation) || !(['removed', 'not-allocated', 'unbound', 'confirmed'].includes(d.cleanup) || settledMerge(row, d));
        }) || capacities.length)
            throw Error('Original producer, reservation or cleanup is unsettled');
        if (budgets.length !== 2 || budgets.some(row => !Number.isSafeInteger(row.lim) || row.lim < 0 || !Number.isSafeInteger(row.consumed) || row.consumed < 0 || !Number.isSafeInteger(row.reserved) || row.reserved !== 0 || row.consumed > row.lim))
            throw Error('Original finite work allowance is invalid or reserved');
        transmission = receiverTransmissionHolds(store, { family: 'github-merge', target: t.configuration!.target });
        if (transmission.length)
            throw Error('Original receiver transmission requires reconciliation; delegation cannot recover: ' + transmission.map(row => row.id + ' (work ' + row.work + ')').join(', '));
        if (purpose === 'renewal' && grants.length !== 1)
            throw Error('Select one original merge grant for renewal');
        if (grants.length > 1)
            throw Error('Ambiguous original merge grants; no replacement permitted');
        if (grants.length) {
            const row = grants[0]!, g = JSON.parse(row.data), s = grantSources[0], o = JSON.parse(s?.origin), request = JSON.parse(s?.raw);
            if (g.kind !== 'github-merge' || g.mode !== 'ordinary' || !['work', 'delegation-lineage'].includes(g.scope) || g.projectId !== t.projectId || g.ownerUid !== process.getuid?.() || g.notifications !== 'allow-merge-notifications' || !Number.isSafeInteger(g.operationLimit) || g.operationLimit < 1 || g.operationLimit > 100 || s.conversation !== null || o.kind !== 'owner-merge-grant' || o.uid !== process.getuid?.() || o.root !== workId || request.workId !== workId || request.targetId !== targetId || request.operationLimit !== g.operationLimit || (request.scope ?? 'work') !== g.scope || request.notifications !== g.notifications)
                throw Error('Original merge grant/source/scope/epoch differs; no implicit renewal');
            history = mergeGrantHistory(store, row);
            if (purpose === 'renewal') {
                if (g.scope !== 'work' || !Number.isSafeInteger(g.rootEpoch) || g.rootEpoch < 1 || g.rootEpoch >= work.epoch || !Number.isSafeInteger(row.epoch + 1) || history.events >= 64)
                    throw Error('Separate renewal requires an older independent work-only merge grant and finite bounded history');
            }
            else if (g.rootEpoch !== work.epoch)
                throw Error('Original merge grant belongs to a stale work epoch; no implicit renewal');
            const used = store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', row.id).n;
            if (used > g.operationLimit)
                throw Error('Original merge grant exceeds its finite operation limit');
            existing = { delegationId: row.id, epoch: row.epoch, rootEpoch: g.rootEpoch, sourceId: g.source, scope: g.scope, operationLimit: g.operationLimit, used, remaining: g.operationLimit - used };
        }
    }
    catch (error) {
        holds.push(error instanceof Error ? error.message : 'Original bounded merge delegation unavailable');
    }
    return { workId, targetId, purpose, history, sourceId: work.source as string, projectId: work.project as string | null, sourceRoot: project?.root as string | null, workState: work.state as string, workEpoch: work.epoch as number, recordedPhase: (change?.phase ?? 'unavailable') as string, request: source?.raw as string | null, target, existing, transmission, eligible: holds.length === 0, holds, fingerprint: hash({ work, project, change, source, target, grants, grantSources, runs, capacities, budgets, busy, transmission, existing, history, purpose }) };
}
