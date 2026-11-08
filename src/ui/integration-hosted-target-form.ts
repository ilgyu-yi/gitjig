import { chooseRecoveryEntry, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { hostedTarget, type RegisterHostedIntegrationTarget } from '../controller/hostedintegration.js';
import type { ConfigurationTarget } from '../platform/github-configuration-types.js';
import { showExactReview } from './exact-review.js';
import { editIntegrationPaths } from './integration-target-paths.js';
interface Host extends RecoveryNavigation {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    register(request: RegisterHostedIntegrationTarget, fresh: () => void): Promise<{
        targetId: string;
    } | undefined>;
}
/** Normal public personal-owner GitHub registration; no delegated work or send. */
export async function registerHostedTarget(host: Host, c: Controller, projectId: string | null, fixedProject = false) {
    const staged = { projectId: projectId ?? '', ref: 'refs/heads/main', basisCommit: '', publicationInventory: [] as string[], authorizedDeltaPaths: [] as string[] };
    let completed = false;
    let repository: {
        targetId: string;
        target: ConfigurationTarget;
        snapshot: string;
    } | undefined;
    const pickRepository = async () => {
        let before: string | undefined;
        const newer: (string | undefined)[] = [];
        while (true) {
            host.guard();
            const page = c.listRepositoryConfigurationTargets({ limit: 25, ...before ? { before } : {} }), labels = page.targets.map(row => row.state === 'RETAINED' ? `${'provider' in row.target ? row.target.provider : 'github'} · ${row.target.owner}/${row.target.repository} · ${row.targetId}` : `Unavailable repository identity · ${row.targetId}`);
            if (!page.targets.length && !before) {
                await host.show('Register repository identity first', 'Open /repo → Register repository to observe the intended GitHub repository and account. Then return here. No identity, credential or grant was created.');
                host.guard();
                return chooseRecoveryEntry(host, host.guard, [{ command: '/repo register', label: 'Register repository identity' }]);
            }
            const selected = await host.choose('Registered repository identity · public personal-owner GitHub only', [...labels, ...host.navigate ? ['Register repository identity · /repo register'] : [], ...page.nextCursor ? ['Older repositories'] : [], ...newer.length ? ['Newer repositories'] : [], 'Back']);
            host.guard();
            if (!selected || selected === 'Back')
                return;
            if (selected === 'Register repository identity · /repo register')
                return host.navigate!('/repo register');
            if (selected === 'Older repositories' && page.nextCursor) {
                newer.push(before);
                before = page.nextCursor;
                continue;
            }
            if (selected === 'Newer repositories' && newer.length) {
                before = newer.pop();
                continue;
            }
            const row = page.targets[labels.indexOf(selected)];
            if (!row)
                throw Error('Unknown registered repository identity');
            if (row.state !== 'RETAINED' || 'provider' in row.target || row.target.visibility !== 'public') {
                await host.show('Receiver registration unavailable', 'This form supports an existing public personal-owner GitHub repository only. Gitea, GitLab and private repository integration are not supported by this entry. Unavailable retained identities need inspection through /repo → Registered targets; register the intended supported identity through Register repository.');
                host.guard();
                continue;
            }
            if (JSON.stringify(c.inspectRepositoryConfigurationTarget(row.targetId)) !== JSON.stringify(row))
                throw Error('Original repository identity changed; reopen its selection');
            repository = { targetId: row.targetId, target: structuredClone(row.target), snapshot: JSON.stringify(row) };
            return;
        }
    };
    while (true) {
        host.guard();
        const selected = await host.choose(fixedProject ? `GitHub branch receiver · fixed project ${projectId} · no grant` : 'GitHub branch receiver · staged fields; no grant', [...fixedProject ? [] : [`Project · ${staged.projectId || 'choose'}`], `Repository · ${repository ? repository.target.owner + '/' + repository.target.repository : 'choose registered identity'}`, `Branch ref · ${staged.ref}`, `Pinned basis commit · ${staged.basisCommit || 'required'}`, `Publication paths · ${staged.publicationInventory.length}`, `Authorized delta paths · ${staged.authorizedDeltaPaths.length}`, 'Review registration', 'Back without registration']);
        host.guard();
        if (!selected || selected === 'Back without registration')
            return completed;
        if (selected.startsWith('Repository ·')) {
            const outcome = await pickRepository();
            if (outcome === 'started')
                return outcome;
            host.guard();
            if (outcome === 'completed')
                completed = true;
            continue;
        }
        if (selected.startsWith('Project ·')) {
            if (fixedProject) throw Error('Result delivery keeps its original project');
            const projects = c.listProjects(), labels = projects.map(p => p.id + ' · ' + p.sourceRoot), picked = await host.choose('Registered source project', [...labels, ...(!projects.length && host.navigate ? ['Select or register project · /project'] : []), 'Back']);
            host.guard();
            if (!picked || picked === 'Back')
                continue;
            if (picked === 'Select or register project · /project') {
                const outcome = await host.navigate!('/project');
                if (outcome !== 'cancelled')
                    return outcome;
                host.guard();
                continue;
            }
            const project = projects[labels.indexOf(picked)];
            if (!project)
                throw Error('Unknown source project');
            staged.projectId = project.id;
            continue;
        }
        const fields = [['Branch ref ·', 'ref', 'Existing receiver branch · full refs/heads/ path'], ['Pinned basis commit ·', 'basisCommit', 'Exact pinned basis object ID'], ['Publication paths ·', 'publicationInventory', 'Publication inventory'], ['Authorized delta paths ·', 'authorizedDeltaPaths', 'Authorized agent delta']] as const;
        const field = fields.find(([prefix]) => selected.startsWith(prefix));
        if (field) {
            const [, key, title] = field;
            if (key === 'publicationInventory' || key === 'authorizedDeltaPaths')
                staged[key] = await editIntegrationPaths(host, staged[key], title);
            else {
                const value = await host.input(title, staged[key]);
                host.guard();
                if (value !== undefined)
                    staged[key] = value;
            }
            continue;
        }
        if (selected !== 'Review registration')
            throw Error('Unknown hosted receiver field');
        const project = c.listProjects().find(p => p.id === staged.projectId);
        if (!project || !repository) {
            await host.show('Receiver fields not ready', 'Choose an existing registered source project and repository identity.');
            host.guard();
            continue;
        }
        const original = structuredClone(repository), request: RegisterHostedIntegrationTarget = { ...structuredClone(staged), repository: { owner: original.target.owner, repository: original.target.repository, repositoryId: original.target.repositoryId, repositoryNodeId: original.target.repositoryNodeId, visibility: original.target.visibility }, expectedUserId: original.target.actorUserId };
        try {
            hostedTarget(request);
            if (request.authorizedDeltaPaths.some(p => !request.publicationInventory.includes(p)))
                throw Error('Authorized delta must remain within publication inventory');
            if (Buffer.byteLength(JSON.stringify(request)) > 131072)
                throw Error('Registration exceeds bounded128KiB inventory limit');
        }
        catch (error) {
            await host.show('Receiver fields not ready', error instanceof Error ? error.message : 'Invalid receiver fields');
            host.guard();
            continue;
        }
        const fresh = () => {
            host.guard();
            if (JSON.stringify(c.listProjects().find(p => p.id === request.projectId)) !== JSON.stringify(project))
                throw Error('Original project changed; reopen receiver registration');
            if (JSON.stringify(c.inspectRepositoryConfigurationTarget(original.targetId)) !== original.snapshot)
                throw Error('Original repository identity changed; reopen receiver registration');
        };
        fresh();
        await showExactReview(host, 'Review exact GitHub integration target', { scope: 'Read the current public personal-owner GitHub identity, existing branch and pinned ancestry through a private native Git client. The credential must identify this registered personal owner; organizations and Bots are unsupported by the normal profile. This records an immutable observed receiver, not current write permission, a work/grant, preparation or send. Exact repeated registration preserves its original target; changed scope refuses replacement. Git and private credential inputs apply to this attempt without changing application settings.', registeredRepositoryId: original.targetId, project, request }, fresh, 'receiver observation');
        const decision = await host.choose('Confirm GitHub integration target registration', ['Back without registering', 'Register this observed GitHub receiver']);
        fresh();
        if (!decision || decision === 'Back without registering')
            continue;
        if (decision !== 'Register this observed GitHub receiver')
            throw Error('Unknown hosted registration decision');
        const result = await host.register(request, fresh);
        host.guard();
        if (result) {
            await host.show('GitHub integration target registered · no work or grant created', JSON.stringify(c.inspectIntegrationTarget(result.targetId), null, 2));
            host.guard();
            return true;
        }
    }
}
