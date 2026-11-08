import { integrationTransmissionHolds } from './integration-transmission.js';
import type { Store } from './store.js';
import type { EffectsProfile } from './effect-types.js';
import { integrationDelegation } from './integration-delegation.js';
import { hash } from './change-files.js';
/** Pure first-operation context. Existing identities always win over a new allocation. */
export function integrationStart(store: Store, workId: string, targetId: string, busy: boolean, gitProfile: EffectsProfile | undefined) {
    const delegation = integrationDelegation(store, workId, targetId, busy), change = store.one('SELECT phase,base,candidate,plan,verification,epoch FROM change_state WHERE work=? AND length(CAST(phase AS BLOB))<=128 AND (base IS NULL OR length(CAST(base AS BLOB))<=4096) AND (candidate IS NULL OR length(CAST(candidate AS BLOB))<=4096) AND (plan IS NULL OR length(CAST(plan AS BLOB))<=4096) AND (verification IS NULL OR length(CAST(verification AS BLOB))<=4096)', workId), work = store.one('SELECT lineage FROM works WHERE id=?', workId), budgets = store.all('SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage=? AND kind IN (\'execution\',\'resolution\') ORDER BY kind', work.lineage);
    const originals = store.all('SELECT id,CASE WHEN length(CAST(phase AS BLOB))<=128 THEN phase ELSE NULL END AS phase FROM effect_operations WHERE work=? AND target=? ORDER BY rowid LIMIT 101', workId, targetId);
    // Bound before JSON inspection; malformed and possible-handoff records hold the target.
    const targetHolds = integrationTransmissionHolds(store, targetId), holds = [...delegation.holds];
    if (!delegation.existing)
        holds.push('Explicit current owner integration grant required; use the separate delegation action');
    else if (delegation.existing.remaining < 1)
        holds.push('Original integration operation allowance exhausted; no new grant or reset is available here');
    if (!change)
        holds.push('Original bounded candidate state unavailable');
    if (originals.length)
        holds.push('An original integration already exists for this work and target; inspect that original instead of allocating another');
    if (targetHolds.length)
        holds.push('Target has unresolved or unavailable original transmission; reconcile its named original first');
    const execution = budgets.find(row => row.kind === 'execution'), resolution = budgets.find(row => row.kind === 'resolution');
    if (!execution || execution.consumed + execution.reserved >= execution.lim)
        holds.push('Original execution allowance exhausted or unavailable');
    if (!resolution)
        holds.push('Original resolution allowance unavailable');
    const current = { delegation, change, execution: execution ?? null, resolution: resolution ?? null, originals: originals.slice(0, 100), originalOverflow: originals.length > 100, targetHolds: targetHolds.slice(0, 128), targetHoldOverflow: targetHolds.length > 128, gitProfile: gitProfile ? structuredClone(gitProfile) : null };
    return { ...current, holds, eligible: holds.length === 0, contextFingerprint: hash(current) };
}
