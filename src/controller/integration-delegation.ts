import type { Store } from './store.js';
import { integrationGrantHistory } from './integration-grant-history.js';
import { integrationTransmissionHolds } from './integration-transmission.js';
import { hash } from './change-files.js';
import { ownerRootActivation } from './owner-activation.js';
import { inspectIntegrationTarget } from './integration-targets.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
/** Owner-only delegation preview. Ordinary conversation roots can only retain existing ceilings. */
export function integrationDelegation(store: Store, workId: string, targetId: string, busy = false, purpose: 'declaration' | 'renewal' = 'declaration') {
    const target = inspectIntegrationTarget(store, targetId), work = store.one(`SELECT id,project,source,predecessor,lineage,state,epoch,generation,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, workId), change = store.one('SELECT phase,epoch FROM change_state WHERE work=?', workId);
    if (!work)
        throw Error('Original owner work unavailable');
    const source = store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 32768)} AS raw FROM sources WHERE id=?`, work.source), grants = store.all(`SELECT id,root,target,epoch,${bounded('data', 65536)} AS data FROM effect_delegations WHERE root=? AND target=? LIMIT 2`, workId, targetId), runs = store.all(`SELECT id,phase,reservation,${bounded('data', 65536)} AS data FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 129`, workId), capacities = store.all('SELECT id,state FROM capacity_leases WHERE work=? AND state NOT IN (\'RELEASED\',\'CANCELLED\') LIMIT 129', workId), budgets = store.all("SELECT * FROM budgets WHERE lineage=? AND kind IN ('execution','resolution') ORDER BY kind", work.lineage), grantSources = grants.map(row => {
        try {
            return store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 65536)} AS raw FROM sources WHERE id=?`, JSON.parse(row.data).source);
        }
        catch {
            return null;
        }
    });
    let grantHistory: ReturnType<typeof integrationGrantHistory> | null = null;
    const transmission = purpose === 'renewal' ? integrationTransmissionHolds(store, targetId, null, 1) : [], priorSend = purpose === 'renewal' ? store.one("SELECT id FROM effect_operations o WHERE grant_id IN (SELECT id FROM effect_delegations WHERE root=? AND target=?) AND phase!='CONFIRMED' AND EXISTS(SELECT 1 FROM effect_receipts r WHERE r.operation=o.id AND r.kind='send') LIMIT 1", workId, targetId) : null;
    let ordinaryContext: unknown = null;
    const snapshot = { target, work, change, source, grants, grantSources, runs, capacities, budgets, busy, purpose, transmission, priorSend }, holds: string[] = [];
    let existing: {
        delegationId: string;
        epoch: number;
        rootEpoch: number;
        sourceId: string;
        scope: 'work' | 'delegation-lineage';
        operationLimit: number;
        used: number;
        remaining: number;
    } | null = null;
    try {
        if (target.state !== 'RETAINED')
            throw Error('Original target identity is unavailable');
        const data = JSON.parse(work.data), origin = JSON.parse(source?.origin);
        if (work.project !== target.projectId && !(grants.length === 1 && JSON.parse(grants[0].data).scope === 'delegation-lineage'))
            throw Error('Original work belongs to another project without an original lineage grant');
        if (!source?.raw?.trim())
            throw Error('Original bounded owner request unavailable');
        if (!['governed-change', 'ordinary-conversation'].includes(data.kind) || !String(origin.kind).startsWith('owner-') || origin.uid !== process.getuid?.())
            throw Error('Select work created by this owner');
        if (Object.hasOwn(data, 'contextOrigin') || Object.hasOwn(data, 'contextContinuation') || data.invocation?.assignmentId || data.assignmentId !== undefined && data.assignmentId !== null || work.lineage !== work.id || work.predecessor)
            throw Error('Context or delegated work cannot create a new grant; use its original owner root');
        if (data.kind === 'governed-change' && !change)
            throw Error('Original governed phase unavailable');
        if (data.kind === 'ordinary-conversation') {
            if (change || grants.length !== 1 || origin.kind !== 'owner-conversation-input' || typeof data.conversation !== 'string' || source.conversation !== data.conversation || Object.hasOwn(data, 'invocation'))
                throw Error('Ordinary owner roots can only retain or renew their original grant');
            const conversation = store.one('SELECT * FROM conversations WHERE id=?', data.conversation), view = store.one(`SELECT conversation,work,resource,archived,direction,native_id,${bounded('data', 65536)} AS data FROM conversation_state WHERE conversation=?`, data.conversation), originalInputs = store.all('SELECT id,work,state FROM conversation_inputs WHERE source=? AND conversation=? LIMIT 2', work.source, data.conversation), pending = store.all("SELECT id,state FROM conversation_inputs WHERE conversation=? AND state NOT IN ('CONSUMED','HANDLED','CANCELLED','CONFLICTED') LIMIT 2", data.conversation), goal = store.one("SELECT id,state,revision FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED') LIMIT 1", data.conversation);
            ordinaryContext = { conversation, view, originalInputs, pending, goal };
            const state = view?.data ? JSON.parse(view.data) : null;
            if (!conversation || !state || view.work !== work.id || conversation.project !== work.project || view.archived || state.lifecycle?.deleted || view.resource !== 'IDLE' || Object.hasOwn(state, 'role') || Object.hasOwn(state, 'nativeInputRecovery') || state.waitHandles?.length || state.continuationAuthorized || state.dialogs?.length || pending.length || goal || originalInputs.length !== 1 || originalInputs[0].state !== 'CONSUMED' || originalInputs[0].work !== work.id)
                throw Error('Original ordinary conversation admission, input or goal requires separate recovery');
        }
        const activation = ownerRootActivation(data);
        if (activation && activation.state !== 'COMPLETE')
            throw Error('Original owner activation is pending; recover its captured profile first');
        if (!Number.isSafeInteger(work.epoch) || work.epoch < 1 || !Number.isSafeInteger(work.generation) || work.generation < 1)
            throw Error('Original work epoch or generation is unavailable');
        if (!['ACTIVE', 'DELIVERED'].includes(work.state))
            throw Error('Original work must be active or delivered; recover that work separately');
        if (busy || runs.length > 128 || runs.reduce((n, row) => n + Buffer.byteLength(row.data ?? ''), 0) > 1048576 || runs.some(row => {
            if (!row.data)
                return true;
            const data = JSON.parse(row.data);
            return !['SETTLED', 'INTERRUPTED'].includes(row.phase) || !['consumed', 'released'].includes(row.reservation) || !['removed', 'not-allocated', 'unbound', 'confirmed'].includes(data.cleanup);
        }) || capacities.length)
            throw Error('Original producer or cleanup is unsettled or exceeds the bounded history profile');
        if (budgets.length !== 2 || budgets.some(row => !Number.isSafeInteger(row.lim) || row.lim < 0 || !Number.isSafeInteger(row.consumed) || row.consumed < 0 || !Number.isSafeInteger(row.reserved) || row.reserved !== 0 || row.consumed + row.reserved > row.lim))
            throw Error('Original execution or resolution allowance is invalid or has an unsettled reservation');
        if (purpose === 'renewal' && (transmission.length || priorSend))
            throw Error('Original receiver transmission requires reconciliation before grant renewal');
        if (purpose === 'renewal' && grants.length !== 1)
            throw Error('Select one retained original grant for renewal');
        if (grants.length > 1)
            throw Error('Ambiguous original grants; retain their identities for recovery');
        if (grants.length) {
            const row = grants[0]!, grant = JSON.parse(row.data), grantSource = grantSources[0], issuer = JSON.parse(grantSource?.origin), request = JSON.parse(grantSource?.raw);
            if ((grant.kind ?? 'local-git') !== target.family || grant.mode !== 'ordinary' || !['work', 'delegation-lineage'].includes(grant.scope) || !Number.isSafeInteger(grant.operationLimit) || grant.operationLimit < 1 || grant.operationLimit > 100 || grant.projectId !== target.projectId || grantSource.conversation !== null || issuer.kind !== 'owner-effect-grant' || issuer.uid !== process.getuid?.() || issuer.root !== workId || request.workId !== workId || request.targetId !== targetId || request.mode !== 'ordinary' || request.operationLimit !== grant.operationLimit || (request.scope ?? 'work') !== grant.scope)
                throw Error('Original grant scope or owner source is unavailable; no replacement grant is permitted');
            grantHistory = integrationGrantHistory(store, row);
            if (purpose === 'renewal') {
                if (!Number.isSafeInteger(grant.rootEpoch) || grant.rootEpoch < 1 || grant.rootEpoch >= work.epoch || !Number.isSafeInteger(row.epoch + 1))
                    throw Error('Grant renewal requires an older original root epoch and a finite next grant epoch');
                if (grantHistory.events >= 64)
                    throw Error('Original renewal history reached its bounded limit');
            }
            else if (!Number.isSafeInteger(row.epoch) || row.epoch < 1 || grant.rootEpoch !== work.epoch)
                throw Error('Original grant belongs to a stale work epoch; reusing its ID cannot renew authority');
            const used = store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', row.id).n;
            if (used > grant.operationLimit)
                throw Error('Original grant operation history exceeds its limit');
            existing = { delegationId: row.id, epoch: row.epoch, rootEpoch: grant.rootEpoch, sourceId: grant.source, scope: grant.scope, operationLimit: grant.operationLimit, used, remaining: grant.operationLimit - used };
        }
    }
    catch (error) {
        holds.push(error instanceof Error ? error.message : 'Original bounded delegation context unavailable');
    }
    return { workId, targetId, purpose, sourceId: work.source as string, projectId: work.project as string | null, receiverProjectId: target.projectId, workState: work.state as string, workEpoch: work.epoch as number, recordedPhase: (change?.phase ?? 'ordinary conversation') as string, request: source?.raw as string | null, target, existing, holds, eligible: holds.length === 0, fingerprint: hash({ ...snapshot, ordinaryContext, existing, grantHistory }) };
}
export function integrationDelegationWorks(store: Store, targetId: string, options: {
    limit?: number;
    before?: string;
} = {}, busy: (id: string) => boolean = () => false) {
    const target = inspectIntegrationTarget(store, targetId);
    if (target.state !== 'RETAINED')
        throw Error('Original target identity unavailable');
    const limit = options.limit ?? 25;
    if (Object.keys(options).some(key => !['limit', 'before'].includes(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw Error('Bounded delegation work page requires limit1..100');
    const membership = '((w.project=? AND c.work IS NOT NULL) OR EXISTS(SELECT 1 FROM effect_delegations g WHERE g.root=w.id AND g.target=?))';
    let position: number | undefined;
    if (options.before !== undefined) {
        const row = store.one('SELECT w.rowid AS position FROM works w LEFT JOIN change_state c ON c.work=w.id WHERE w.id=? AND ' + membership, options.before, target.projectId, targetId);
        if (!row)
            throw Error('Original target/work cursor unavailable');
        position = row.position;
    }
    const rows = store.all('SELECT w.id FROM works w LEFT JOIN change_state c ON c.work=w.id WHERE ' + membership + (position === undefined ? '' : ' AND w.rowid<?') + ' ORDER BY w.rowid DESC LIMIT ?', target.projectId, targetId, ...position === undefined ? [] : [position], limit + 1);
    return { works: rows.slice(0, limit).map(row => integrationDelegation(store, row.id, targetId, busy(row.id))), nextCursor: rows.length > limit ? rows[limit - 1].id as string : null };
}
