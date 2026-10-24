import type { RecoveryNavigation } from './recovery-navigation.js';
import { registerHostedTarget } from './integration-hosted-target-form.js';
import { editIntegrationPaths } from './integration-target-paths.js';
import { browseFirstIntegration } from './integration-start-browser.js';
import { browseIntegrationDelegation } from './integration-delegation-browser.js';
import type { Controller } from '../controller/controller.js';
import type { RegisterLocalTarget } from '../controller/effect-types.js';
import { showExactReview } from './exact-review.js';
interface Host extends RecoveryNavigation {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    register(request: RegisterLocalTarget, fresh: () => void): Promise<{
        targetId: string;
    } | undefined>;
    registerHosted?: Parameters<typeof registerHostedTarget>[0]['register'];
    first?: Parameters<typeof browseFirstIntegration>[0];
}
/** Target observations only. Work delegation and preparation remain separate actions. */
export async function browseIntegrationTargets(host: Host, c: Controller, projectId: string | null, result?: { workId: string; assertCurrent(): void }) {
    if (result) {
        const original = host;
        const guard = () => { original.guard(); result.assertCurrent(); };
        host = { ...original, guard,
            register: (request, fresh) => {
                guard();
                if (request.projectId !== projectId) throw Error('Result delivery must keep its original project');
                return original.register(request, fresh);
            },
            ...(original.registerHosted ? { registerHosted: (request, fresh) => {
                guard();
                if (request.projectId !== projectId) throw Error('Result delivery must keep its original project');
                return original.registerHosted!(request, fresh);
            } } : {}),
            ...(original.first ? { first: { ...original.first, guard: () => { guard(); original.first!.guard(); } } } : {}),
        };
    }
    let before: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    const register = async () => {
        const staged: RegisterLocalTarget = { projectId: projectId ?? '', path: '', ref: 'refs/heads/main', basisCommit: '', publicationInventory: [], authorizedDeltaPaths: [] };
        while (true) {
            host.guard();
            const selected = await host.choose(result ? `Local bare receiver · fixed project ${projectId} · no grant` : 'Local bare receiver · staged fields; no grant', [...result ? [] : [`Project · ${staged.projectId || 'choose'}`], `Receiver path · ${staged.path || 'required'}`, `Branch ref · ${staged.ref}`, `Pinned basis commit · ${staged.basisCommit || 'required'}`, `Publication paths · ${staged.publicationInventory.length}`, `Authorized delta paths · ${staged.authorizedDeltaPaths.length}`, 'Review registration', 'Back without registration']);
            host.guard();
            if (!selected || selected === 'Back without registration')
                return;
            if (selected.startsWith('Project ·')) {
                if (result) throw Error('Result delivery keeps its original project');
                const projects = c.listProjects(), labels = projects.map(p => p.id + ' · ' + p.sourceRoot), pick = await host.choose('Registered source project', [...labels, ...(!projects.length && host.navigate ? ['Select or register project · /project'] : []), 'Back']);
                host.guard();
                if (!pick || pick === 'Back')
                    continue;
                if (pick === 'Select or register project · /project') {
                    const outcome = await host.navigate!('/project');
                    if (outcome !== 'cancelled')
                        return outcome;
                    host.guard();
                    continue;
                }
                const p = projects[labels.indexOf(pick)];
                if (!p)
                    throw Error('Unknown source project');
                staged.projectId = p.id;
                continue;
            }
            const fields = [['Receiver path ·', 'path', 'Existing canonical local bare receiver path'], ['Branch ref ·', 'ref', 'Existing receiver branch · full refs/heads/ path'], ['Pinned basis commit ·', 'basisCommit', 'Exact pinned basis object ID'], ['Publication paths ·', 'publicationInventory', 'Publication inventory'], ['Authorized delta paths ·', 'authorizedDeltaPaths', 'Authorized agent delta']] as const;
            const field = fields.find(([prefix]) => selected.startsWith(prefix));
            if (field) {
                const [, key, title] = field;
                if (key === 'publicationInventory' || key === 'authorizedDeltaPaths') {
                    staged[key] = await editIntegrationPaths(host, staged[key], title);
                    continue;
                }
                const value = await host.input(title, staged[key]);
                host.guard();
                if (value !== undefined)
                    staged[key] = value;
                continue;
            }
            if (selected !== 'Review registration')
                throw Error('Unknown integration receiver field');
            const request = structuredClone(staged), project = c.listProjects().find(p => p.id === request.projectId);
            if (!project)
                throw Error('Choose an existing registered source project');
            const fresh = () => {
                host.guard();
                if (JSON.stringify(c.listProjects().find(p => p.id === request.projectId)) !== JSON.stringify(project))
                    throw Error('Original project changed; reopen receiver registration');
            };
            await showExactReview(host, 'Review exact local integration target', { scope: 'Native receiver identity/configuration and pinned ancestry reads. Creates a local immutable observed target, not a work/grant or continuing permission. No source change, push, work, allowance or preparation is authorized. Receiver and controller/all registered projects must stay disjoint. Native private client artifacts and process cleanup are owned by this request. Repeated explicit registrations retain distinct target IDs; old operations/grants are never replaced.', project, request }, fresh, 'receiver observation');
            const decision = await host.choose('Confirm integration target registration', ['Back without registering', 'Register this observed local receiver']);
            fresh();
            if (!decision || decision === 'Back without registering')
                continue;
            if (decision !== 'Register this observed local receiver')
                throw Error('Unknown receiver registration decision');
            const registered = await host.register(request, fresh);
            host.guard();
            if (registered) {
                completed = true;
                await host.show('Integration target registered · no work or grant created', JSON.stringify(c.inspectIntegrationTarget(registered.targetId), null, 2));
                host.guard();
                return;
            }
        }
    };
    while (true) {
        host.guard();
        const retained = c.listIntegrationTargets({ limit: 25, ...before ? { before } : {} });
        const page = { ...retained, targets: result ? retained.targets.filter(row => row.projectId === projectId) : retained.targets };
        const labels = page.targets.map(row => row.state === 'RETAINED' ? `${row.family} · ${row.projectId} · ${JSON.stringify(row.ref)} · ${row.targetId}` : `Unavailable integration target · ${row.targetId}`), selected = await host.choose(result ? `Branch delivery · project ${projectId} · work ${result.workId} · no publication or PR merge` : 'Integration targets · retained observations only', [...labels, 'Register local bare receiver', ...host.registerHosted ? ['Register GitHub branch receiver'] : [], ...page.nextCursor ? ['Older targets'] : [], ...newer.length ? ['Newer targets'] : [], 'Refresh target list', 'Back']);
        host.guard();
        if (!selected || selected === 'Back')
            return completed;
        if (selected === 'Register local bare receiver') {
            const outcome = await register();
            if (outcome)
                return outcome;
            before = undefined;
            newer.length = 0;
            continue;
        }
        if (selected === 'Register GitHub branch receiver' && host.registerHosted) {
            const outcome = await registerHostedTarget({ ...host, register: host.registerHosted }, c, projectId, !!result);
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            before = undefined;
            newer.length = 0;
            continue;
        }
        if (selected === 'Refresh target list')
            continue;
        if (selected === 'Older targets' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (selected === 'Newer targets' && newer.length) {
            before = newer.pop();
            continue;
        }
        const row = page.targets[labels.indexOf(selected)];
        if (!row)
            throw Error('Unknown retained integration target');
        const current = c.inspectIntegrationTarget(row.targetId);
        if (JSON.stringify(current) !== JSON.stringify(row))
            throw Error('Original target changed; refresh its list');
        const action = await host.choose('Original integration target · actions', ['Inspect observed identity', ...current.state === 'RETAINED' ? ['Delegate ordinary integration to owner work', ...host.first ? ['Prepare first integration for owner work'] : []] : [], 'Back']);
        host.guard();
        if (JSON.stringify(c.inspectIntegrationTarget(row.targetId)) !== JSON.stringify(current))
            throw Error('Original target changed; refresh its list');
        if (!action || action === 'Back')
            continue;
        if (action === 'Delegate ordinary integration to owner work') {
            const outcome = await browseIntegrationDelegation(host, c, row.targetId, result?.workId, !!result);
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            continue;
        }
        if (action === 'Prepare first integration for owner work' && host.first) {
            const outcome = await browseFirstIntegration(host.first, c, row.targetId, result?.workId);
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            if (result)
                return completed;
            continue;
        }
        if (action !== 'Inspect observed identity')
            throw Error('Unknown integration target action');
        await showExactReview(host, 'Original integration target · observed identity only', { scope: 'Historical target registration, not refreshed permission, a grant, a prepared change or a send. Unknown/malformed targets stay retained. Hosted registration and work/delegation/preparation have their separate entries.', target: current }, () => {
            host.guard();
            if (JSON.stringify(c.inspectIntegrationTarget(row.targetId)) !== JSON.stringify(current))
                throw Error('Original target changed; refresh its list');
        }, 'no native request');
    }
}
