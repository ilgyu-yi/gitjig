import { accountedCreatedResource } from './configuration-provenance.js';
import type { Store } from './store.js';
interface RepositoryIdentity {
    repositoryId: number;
    repositoryNodeId: string;
    host: 'github.com';
}
function sameRepository(expected: RepositoryIdentity, actual: any): boolean {
    if (actual?.host !== 'github.com' || actual.repositoryId !== expected.repositoryId)
        return false;
    if (actual.repositoryNodeId !== expected.repositoryNodeId)
        throw Error('Known repository ID has inconsistent node identity; handoff unavailable');
    return true;
}
/** Pure local ledger exclusion, not native applicability, permission or policy CAS. */
export function assertNoPendingRulesetWrite(store: Store, repository: RepositoryIdentity): void {
    for (const row of store.all('SELECT o.id,o.data,t.data AS target_data FROM effect_operations o JOIN effect_targets t ON t.id=o.target')) {
        const operation = JSON.parse(row.data);
        if (operation.kind !== 'configuration')
            continue;
        const target = JSON.parse(row.target_data);
        if (target.kind !== 'github-configuration' || !sameRepository(repository, target.target))
            continue;
        if (!Array.isArray(operation.steps))
            throw Error('Same-repository configuration journal unavailable');
        for (const step of operation.steps) {
            if (!['create-ruleset', 'update-owned-ruleset'].includes(step.kind) || !['INVOKING', 'UNKNOWN'].includes(step.state) || step.intent == null || ['not-started', 'native-success'].includes(step.transportOutcome))
                continue;
            if (step.kind === 'create-ruleset' && step.state === 'UNKNOWN' && accountedCreatedResource(store, row.id, repository, step.journalId))
                continue;
            // forwardRevision is an authorization for another explicit delta,
            // not proof that this original uncertain send is settled.
            throw Error(`Pending same-repository ruleset write ${row.id}/${step.journalId}; read-only reconcile that exact original step before branch handoff`);
        }
    }
}
export function assertNoPendingBranchWrite(store: Store, repository: RepositoryIdentity): void {
    for (const row of store.all('SELECT o.id,o.phase,o.data,t.data AS target_data FROM effect_operations o JOIN effect_targets t ON t.id=o.target')) {
        const operation = JSON.parse(row.data);
        if (operation.kind !== 'github-existing-ref' || !['INVOKING', 'UNKNOWN'].includes(row.phase) || operation.dispatchRun == null)
            continue;
        const target = JSON.parse(row.target_data);
        if (target.kind !== 'github-existing-ref' || !sameRepository(repository, target.target))
            continue;
        throw Error(`Pending same-repository branch write ${row.id}; read-only reconcile original transmission/cleanup before ruleset handoff`);
    }
}
