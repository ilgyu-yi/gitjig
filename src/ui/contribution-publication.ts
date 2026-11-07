import type { Controller } from '../controller/controller.js';
import type { RegisterPublicationTarget } from '../controller/publication-types.js';
import { showExactReview } from './exact-review.js';
export type SummaryPublicationRequest = {
    resourceId: string;
    revisionId: string;
} & ({
    targetId: string;
} | {
    registration: RegisterPublicationTarget;
});
interface Host {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    prepare(request: SummaryPublicationRequest, fresh: () => void): Promise<unknown | undefined>;
}
/** Select an exact existing host summary; this is preparation, never dispatch. */
export async function prepareSummaryPublication(host: Host, c: Controller, resourceId: string, sourceFresh: () => void) {
    const proof = c.inspectCurrentContributionSummary(resourceId), same = (target: {
        owner: string;
        repository: string;
        repositoryId: number;
        repositoryNodeId: string;
    }) => {
        const r = proof.repository;
        return target.owner === r.owner && target.repository === r.repository && target.repositoryId === r.repositoryId && target.repositoryNodeId === r.repositoryNodeId;
    }, freshSummary = () => {
        sourceFresh();
        if (JSON.stringify(c.inspectCurrentContributionSummary(resourceId)) !== JSON.stringify(proof))
            throw Error('Original local summary revision or membership changed; prepare and inspect the current summary again');
    };
    const all = c.listPublicationTargets().targets, targets = all.filter(row => row.state === 'RETAINED' && same(row.target)), labels = targets.map(row => row.state === 'RETAINED' ? `${row.target.owner}/${row.target.repository} · actor ${row.target.actorUserId} · ${row.visibility} · ${row.targetId}` : ''), unavailable = all.filter(row => row.state === 'UNAVAILABLE');
    const register = 'Register default-policy target from retained repository identity';
    const picked = await host.choose('Publication target · same native repository, retained identity is not permission', [...labels, ...unavailable.map(row => 'Unavailable publication target · ' + row.targetId), register, 'Back']);
    freshSummary();
    if (!picked || picked === 'Back')
        return;
    if (picked.startsWith('Unavailable publication target'))
        throw Error('Selected retained publication target unavailable; inspect its original identity and policy');
    let request: SummaryPublicationRequest, targetView: unknown, freshTarget: () => void;
    if (picked === register) {
        const candidates = [] as ReturnType<Controller['listRepositoryConfigurationTargets']>['targets'];
        let before: string | undefined;
        do {
            const page = c.listRepositoryConfigurationTargets({ limit: 100, ...before ? { before } : {} });
            candidates.push(...page.targets);
            if (candidates.length > 256)
                throw Error('Registered repository selection exceeds bounded profile');
            before = page.nextCursor ?? undefined;
        } while (before);
        const eligible = candidates.filter(row => row.state === 'RETAINED' && !('provider' in row.target) && same(row.target)), names = eligible.map(row => row.state === 'RETAINED' && !('provider' in row.target) ? `${row.target.owner}/${row.target.repository} · actor ${row.target.actorUserId} · ${row.target.visibility} · ${row.targetId}` : '');
        const selected = await host.choose('Select registered GitHub identity · explicit new publication policy', [...names, 'Back']);
        freshSummary();
        if (!selected || selected === 'Back')
            return;
        const original = eligible[names.indexOf(selected)];
        if (!original || original.state !== 'RETAINED' || 'provider' in original.target)
            throw Error('Registered GitHub identity selection unavailable');
        const { visibility, ...target } = original.target;
        const registration: RegisterPublicationTarget = { target, visibility, carrierPolicy: { version: 'publication-carrier/v1', allowedMentions: [], knownPrivateLiterals: [], maxTitleBytes: 1024, maxBodyBytes: 128 * 1024 } };
        request = { resourceId, revisionId: proof.revisionId, registration };
        targetView = { sourceTarget: original, registration, scope: 'Explicit new target. No allowed mentions or configured private literals. Existing target policies are separate; no repository permission is granted.' };
        freshTarget = () => {
            freshSummary();
            if (JSON.stringify(c.inspectRepositoryConfigurationTarget(original.targetId)) !== JSON.stringify(original))
                throw Error('Original registered repository identity changed; reopen target selection');
        };
    }
    else {
        const selected = targets[labels.indexOf(picked)];
        if (!selected || selected.state !== 'RETAINED')
            throw Error('Unknown same-repository publication target');
        request = { resourceId, revisionId: proof.revisionId, targetId: selected.targetId };
        targetView = selected;
        freshTarget = () => {
            freshSummary();
            if (JSON.stringify(c.listPublicationTargets().targets.find(row => row.targetId === selected.targetId)) !== JSON.stringify(selected))
                throw Error('Original publication target or carrier policy changed; reopen target selection');
        };
    }
    freshTarget();
    await showExactReview(host, 'Review host summary publication preparation', { scope: 'Local target registration if selected, then original work/grant/allowance admission and native preflight GET requests. No POST or publication occurs. One admitted preflight consumes original execution allowance even if cancelled or refused. A duplicate reuses its original operation; uncertain lineage blocks replacement. Sending requires a separate exact-carrier review.', target: targetView, summary: proof }, freshTarget, 'preflight only · no send');
    const decision = await host.choose('Explicit summary publication preparation', ['Back without preparing', 'Prepare this exact summary publication']);
    freshTarget();
    if (!decision || decision === 'Back without preparing')
        return;
    if (decision !== 'Prepare this exact summary publication')
        throw Error('Unknown summary publication preparation decision');
    return host.prepare(request, freshTarget);
}
