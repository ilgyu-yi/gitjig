import type { RecoveryNavigation } from './recovery-navigation.js';
import { browseFirstOwnerMerge } from './merge-start-browser.js';
import { browseMergeDelegation } from './merge-delegation-browser.js';
import type { Controller } from '../controller/controller.js';
import type { RegisterMergeTarget } from '../controller/merge-types.js';
import { showExactReview } from './exact-review.js';
import { mergeBranchName } from '../platform/github-merge-protocol.js';
interface Host extends RecoveryNavigation {
    prepare?: Parameters<typeof browseFirstOwnerMerge>[0]['prepare'];
    guard(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    register(request: RegisterMergeTarget, fresh: () => void): Promise<{
        targetId: string;
    } | undefined>;
}
/** Identity observations only. Grants, procedure standing and sends are separate. */
export async function browseMergeTargets(host: Host, controller: Controller) {
    let completed = false, before: string | undefined;
    const newer: (string | undefined)[] = [];
    async function sourceTarget() {
        let cursor: string | undefined;
        const previous: (string | undefined)[] = [];
        while (true) {
            host.guard();
            const page = controller.listIntegrationTargets({ limit: 25, ...cursor ? { before: cursor } : {} });
            const rows = page.targets.filter(row => row.state === 'RETAINED' && row.family === 'github-existing-ref' && row.configuration.repository.visibility === 'public');
            const labels = rows.map(row => row.state === 'RETAINED' ? `${row.projectId} · ${row.configuration.repository.owner}/${row.configuration.repository.repository} · ${JSON.stringify(row.ref)} · ${row.targetId}` : row.targetId);
            const picked = await host.choose('Registered public GitHub source branches · observations only', [...labels, ...(!rows.length && !cursor && host.navigate ? ['Open source branch targets and registration · /repo integration-targets'] : []), ...page.nextCursor ? ['Older source targets'] : [], ...previous.length ? ['Newer source targets'] : [], 'Back']);
            host.guard();
            if (!picked || picked === 'Back')
                return;
            if (picked === 'Open source branch targets and registration · /repo integration-targets')
                return host.navigate!('/repo integration-targets');
            if (picked === 'Older source targets' && page.nextCursor) {
                previous.push(cursor);
                cursor = page.nextCursor;
                continue;
            }
            if (picked === 'Newer source targets' && previous.length) {
                cursor = previous.pop();
                continue;
            }
            const row = rows[labels.indexOf(picked)];
            if (!row || row.state !== 'RETAINED')
                throw Error('Unknown source branch selection');
            if (JSON.stringify(controller.inspectIntegrationTarget(row.targetId)) !== JSON.stringify(row))
                throw Error('Original source branch target changed; select it again');
            return row;
        }
    }
    async function register() {
        const staged: RegisterMergeTarget = { sourceBranchTargetId: '', resourceId: '', baseRef: 'main' };
        while (true) {
            host.guard();
            const picked = await host.choose('Existing PR merge target · staged fields; no grant', [
                `Source branch target · ${staged.sourceBranchTargetId || 'choose'}`,
                `Tracked pull request · ${staged.resourceId || 'choose'}`,
                `Destination branch · ${JSON.stringify(staged.baseRef)}`,
                'Review registration', 'Back without registration',
            ]);
            host.guard();
            if (!picked || picked === 'Back without registration')
                return;
            if (picked.startsWith('Source branch target ·')) {
                const selected = await sourceTarget();
                if (typeof selected === 'string') {
                    if (selected === 'started')
                        return selected;
                    host.guard();
                    if (selected === 'completed')
                        completed = true;
                    continue;
                }
                if (selected && selected.targetId !== staged.sourceBranchTargetId) {
                    staged.sourceBranchTargetId = selected.targetId;
                    staged.resourceId = '';
                }
                continue;
            }
            if (picked.startsWith('Tracked pull request ·')) {
                if (!staged.sourceBranchTargetId) {
                    await host.show('Choose source branch first', 'Select a registered public GitHub source branch to choose a PR from its repository.');
                    host.guard();
                    continue;
                }
                const source = controller.inspectIntegrationTarget(staged.sourceBranchTargetId);
                if (source.state !== 'RETAINED' || source.family !== 'github-existing-ref')
                    throw Error('Original supported source branch unavailable');
                const repository = source.configuration.repository;
                const rows = controller.listTrackedResources().resources.filter(row => row.state === 'RETAINED' && row.input.kind === 'pull-request' && row.merged === false && row.input.repository.owner === repository.owner && row.input.repository.repository === repository.repository && row.input.repository.repositoryId === repository.repositoryId && row.input.repository.repositoryNodeId === repository.repositoryNodeId);
                const labels = rows.map(row => row.state === 'RETAINED' ? `${row.input.repository.owner}/${row.input.repository.repository} #${row.input.number} · ${row.resourceId}` : row.resourceId);
                const selected = await host.choose('Existing tracked unmerged PR · track it under /repo first if missing', [...labels, ...(!rows.length && host.navigate ? ['Track an existing pull request · /repo targets'] : []), 'Back']);
                host.guard();
                if (!selected || selected === 'Back')
                    continue;
                if (selected === 'Track an existing pull request · /repo targets') {
                    const outcome = await host.navigate!('/repo targets');
                    if (outcome === 'started')
                        return outcome;
                    host.guard();
                    if (outcome === 'completed')
                        completed = true;
                    continue;
                }
                const row = rows[labels.indexOf(selected)];
                if (!row || JSON.stringify(controller.listTrackedResources().resources.find(current => current.resourceId === row.resourceId)) !== JSON.stringify(row))
                    throw Error('Original tracked PR changed; select it again');
                staged.resourceId = row.resourceId;
                continue;
            }
            if (picked.startsWith('Destination branch ·')) {
                const value = await host.input('Literal destination branch · for example main, without refs/heads/', staged.baseRef);
                host.guard();
                if (value !== undefined)
                    staged.baseRef = value;
                continue;
            }
            if (picked !== 'Review registration')
                throw Error('Unknown merge target field');
            if (!staged.sourceBranchTargetId || !staged.resourceId) {
                await host.show('Complete the target fields', 'Choose both an existing source branch target and its tracked PR. Registration grants no merge authority.');
                host.guard();
                continue;
            }
            try {
                mergeBranchName(staged.baseRef);
            }
            catch {
                await host.show('Destination branch needs attention', 'Enter one literal Git branch name such as main; patterns, whitespace and ref expressions are unavailable. Your staged fields are retained.');
                host.guard();
                continue;
            }
            const request = structuredClone(staged), source = controller.inspectIntegrationTarget(request.sourceBranchTargetId), resource = controller.listTrackedResources().resources.find(row => row.resourceId === request.resourceId);
            if (source.state !== 'RETAINED' || !resource || resource.state !== 'RETAINED')
                throw Error('Original registration identities unavailable; select them again');
            const context = controller.inspectMergeRegistration(request);
            const fresh = () => {
                host.guard();
                if (controller.inspectMergeRegistration(request).fingerprint !== context.fingerprint)
                    throw Error('Original PR, source target or project changed; review the registration again');
            };
            await showExactReview(host, 'Review existing PR merge target', {
                project: context.project,
                sourceBranch: { targetId: request.sourceBranchTargetId, branch: context.identity.headRef },
                pullRequest: { resourceId: request.resourceId, repository: context.identity.target, number: context.identity.pullNumber, id: context.identity.pullId, nodeId: context.identity.pullNodeId },
                destinationBranch: context.identity.baseRef,
                expectedNativeAccountId: context.identity.expectedUserId,
                scope: 'Read current native PR/account identity and retain its target observation only. No work, grant, procedure standing, merge eligibility, branch write or merge send. The restrictive destination fence and current CI/approvals are checked later, before a separately authorized merge. Exact duplicate registration retains its original target ID; changed identity/ref scope cannot replace it.',
            }, fresh, 'identity reads only');
            const decision = await host.choose('Confirm PR merge target registration', ['Back without registering', 'Register this existing PR identity']);
            fresh();
            if (!decision || decision === 'Back without registering')
                continue;
            if (decision !== 'Register this existing PR identity')
                throw Error('Unknown PR target registration decision');
            const result = await host.register(request, fresh);
            host.guard();
            if (!result)
                continue;
            completed = true;
            await host.show('PR merge target retained · no work or grant created', JSON.stringify(controller.inspectMergeTarget(result.targetId), null, 2));
            host.guard();
            return;
        }
    }
    while (true) {
        host.guard();
        const page = controller.listMergeTargets({ limit: 25, ...before ? { before } : {} });
        const labels = page.targets.map(row => row.state === 'RETAINED' ? `${row.projectId} · ${row.configuration.identity.target.owner}/${row.configuration.identity.target.repository} #${row.configuration.identity.pullNumber} → ${JSON.stringify(row.configuration.identity.baseRef)} · ${row.targetId}` : `Unavailable retained PR target · ${row.targetId}`);
        const picked = await host.choose('PR merge targets · retained identities, no current eligibility', [...labels, 'Register existing PR merge target', ...page.nextCursor ? ['Older PR targets'] : [], ...newer.length ? ['Newer PR targets'] : [], 'Refresh target list', 'Back']);
        host.guard();
        if (!picked || picked === 'Back')
            return completed;
        if (picked === 'Register existing PR merge target') {
            const outcome = await register();
            if (outcome)
                return outcome;
            before = undefined;
            newer.length = 0;
            continue;
        }
        if (picked === 'Refresh target list')
            continue;
        if (picked === 'Older PR targets' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (picked === 'Newer PR targets' && newer.length) {
            before = newer.pop();
            continue;
        }
        const row = page.targets[labels.indexOf(picked)];
        if (!row)
            throw Error('Unknown retained PR target');
        const current = controller.inspectMergeTarget(row.targetId);
        const fresh = () => {
            host.guard();
            if (JSON.stringify(controller.inspectMergeTarget(row.targetId)) !== JSON.stringify(row))
                throw Error('Original PR target changed; refresh its list');
        };
        fresh();
        await showExactReview(host, 'Retained PR target · identity only', current, fresh, 'no request, grant or send');
        if (current.state === 'RETAINED') {
            const action = await host.choose('Original PR target · separate owner authority', ['Back', 'Delegate ordinary PR merge to owner work', ...host.prepare ? ['Prepare first PR merge'] : []]);
            fresh();
            if (!action || action === 'Back')
                continue;
            if (action === 'Prepare first PR merge' && host.prepare) {
                const outcome = await browseFirstOwnerMerge({ ...host, prepare: host.prepare }, controller, row.targetId);
                if (typeof outcome === 'string')
                    return outcome;
                if (outcome)
                    completed = true;
                continue;
            }
            if (action !== 'Delegate ordinary PR merge to owner work')
                throw Error('Unknown retained PR target action');
            const outcome = await browseMergeDelegation(host, controller, row.targetId);
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
        }
    }
}
