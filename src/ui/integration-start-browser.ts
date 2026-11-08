import { openWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import type { HostCommandOutcome } from './host-commands.js';
import type { Controller } from '../controller/controller.js';
import { showExactReview } from './exact-review.js';
interface Host extends RecoveryNavigation {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    delegate?(workId: string, targetId: string): Promise<boolean | HostCommandOutcome>;
    preparationModel?: {
        provider: string;
        modelId: string;
    };
    prepare(workId: string, targetId: string, context: ReturnType<Controller['inspectFirstIntegrationPreparation']>, fresh: () => void): Promise<unknown | undefined>;
    openOriginal(id: string, targetId: string): Promise<boolean | HostCommandOutcome>;
}
/** First preparation is explicit; an existing original always owns recovery. */
export async function browseFirstIntegration(host: Host, c: Controller, targetId: string, workId?: string) {
    let before: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const page = workId ? { works: [c.inspectIntegrationDelegation(workId, targetId)], nextCursor: null } : c.listIntegrationDelegationWorks(targetId, { limit: 25, ...before ? { before } : {} }), labels = page.works.map(work => `${work.recordedPhase} · ${work.workId}`), pick = workId ? labels[0] : await host.choose(page.works.length ? 'First integration · select original owner work' : 'First integration · no retained work; use /change start', [...labels, ...(!page.works.length && !before && host.navigate ? ['Review a new managed change · /change start'] : []), ...page.nextCursor ? ['Older work'] : [], ...newer.length ? ['Newer work'] : [], 'Refresh work list', 'Back']);
        host.guard();
        if (!pick || pick === 'Back')
            return completed;
        if (pick === 'Review a new managed change · /change start')
            return host.navigate!('/change start');
        if (pick === 'Refresh work list')
            continue;
        if (pick === 'Older work' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (pick === 'Newer work' && newer.length) {
            before = newer.pop();
            continue;
        }
        const selected = page.works[labels.indexOf(pick)];
        if (!selected)
            throw Error('Unknown first integration work');
        const context = c.inspectFirstIntegrationPreparation(selected.workId, targetId);
        if (context.delegation.fingerprint !== selected.fingerprint)
            throw Error('Original integration work changed; refresh its list');
        const fresh = () => {
            host.guard();
            if (c.inspectFirstIntegrationPreparation(selected.workId, targetId).contextFingerprint !== context.contextFingerprint)
                throw Error('First integration context changed; inspect the original work and target');
        };
        if (context.originals.length) {
            const rows = context.originals.map(row => `${row.phase ?? 'Unavailable'} · ${row.id}`), action = await host.choose('Existing original integration · no new allocation', [...rows, 'Back']);
            fresh();
            if (!action || action === 'Back') {
                if (workId) return completed;
                continue;
            }
            const original = context.originals[rows.indexOf(action)];
            if (!original)
                throw Error('Unknown original integration');
            const outcome = await host.openOriginal(original.id, targetId);
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            if (workId)
                return completed;
            continue;
        }
        const baseline = c.getWorkApplicationModelBaseline(selected.workId);
        await showExactReview(host, 'Review first integration preparation', { scope: 'Prepare one original integration for this existing work and grant; never sends. Actual current procedure evidence is required before allocation. Native projection and derived candidate checks/review can consume original execution/resolution allowances and require the configured runtime. No new work or grant, no allowance reset. A retained result must be recovered as that original.', subjectModel: baseline ? { binding: 'captured application baseline', provider: baseline.choice.provider, modelId: baseline.choice.modelId, thinkingLevel: baseline.choice.thinkingLevel } : host.preparationModel ? { binding: 'Explicit legacy invocation recipe; historical identity not verified for unbound work', ...host.preparationModel } : 'Explicit legacy model profile required', ...context }, fresh, 'no send');
        if (context.holds.length) {
            if (host.delegate && context.delegation.eligible && !context.delegation.existing) {
                const action = await host.choose('First integration held · choose recovery', ['Back without action', 'Review integration delegation for this original work', ...host.navigate ? ['Open original work recovery · /work ' + selected.workId] : []]);
                fresh();
                if (!action || action === 'Back without action') {
                    if (workId) return completed;
                    continue;
                }
                if (action === 'Review integration delegation for this original work') {
                    const outcome = await host.delegate(selected.workId, targetId);
                    if (typeof outcome === 'string')
                        return outcome;
                    if (outcome)
                        completed = true;
                    if (workId)
                        return completed;
                    continue;
                }
                if (action === 'Open original work recovery · /work ' + selected.workId && host.navigate)
                    return host.navigate('/work ' + selected.workId);
                throw Error('Unknown first integration recovery action');
            }
            const outcome = await openWorkRecovery(host, selected.workId, fresh);
            if (outcome)
                return outcome;
            if (workId)
                return completed;
            continue;
        }
        const decision = await host.choose('Confirm first integration preparation', ['Back without preparation', 'Prepare first integration for this work']);
        fresh();
        if (!decision || decision === 'Back without preparation') {
            if (workId) return completed;
            continue;
        }
        if (decision !== 'Prepare first integration for this work')
            throw Error('Unknown first integration decision');
        const result = await host.prepare(selected.workId, targetId, context, fresh);
        host.guard();
        if (result !== undefined) {
            completed = true;
            await host.show('First integration preparation retained · sending remains separate', JSON.stringify(result, null, 2));
            host.guard();
        }
        if (workId)
            return completed;
    }
}
