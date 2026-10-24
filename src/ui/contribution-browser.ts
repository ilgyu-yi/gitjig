import { prepareSummaryPublication, type SummaryPublicationRequest } from './contribution-publication.js';
import type { Controller } from '../controller/controller.js';
interface Host {
    guard(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    show(title: string, value: string): Promise<void>;
    refresh?(resourceId: string, fresh: () => void): Promise<unknown | undefined>;
    preparePublication?(request: SummaryPublicationRequest, fresh: () => void): Promise<unknown | undefined>;
    setParent?(input: {
        childId: string;
        parentId: string | null;
        expectedRevision: number;
    }, fresh: () => void): Promise<unknown | undefined>;
}
const detail = (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    return text.length > 32768 ? text.slice(0, 32768) + '\n[Shortened; use repo contributions/summary with the retained resource ID for full detail]' : text;
};
/** Opening is an offline read; refresh and local summary preparation are explicit actions. */
export async function browseContributions(host: Host, controller: Controller) {
    let completedAction = false;
    while (true) {
        host.guard();
        const page = controller.listTrackedResources();
        const labels = page.resources.map(row => row.state === 'RETAINED'
            ? `github · ${row.input.repository.owner}/${row.input.repository.repository} · ${row.input.kind} #${row.input.number} · ${row.merged ? 'merge observed' : 'no merge observed'} · missing ${row.missingCount} · ${row.resourceId}`
            : `Unavailable retained resource · ${row.resourceId}`);
        const selected = await host.choose('Tracked issues and pull requests · retained GitHub observations, opening does not refresh', [...labels, 'Back']);
        host.guard();
        if (!selected || selected === 'Back')
            return completedAction;
        const row = page.resources[labels.indexOf(selected)];
        if (!row)
            throw Error('Unknown tracked resource selection');
        const freshRow = controller.listTrackedResources().resources.find(current => current.resourceId === row.resourceId);
        if (JSON.stringify(freshRow) !== JSON.stringify(row))
            throw Error('Tracked resource changed; reopen its retained list');
        if (row.state === 'UNAVAILABLE') {
            await host.show('Unavailable retained resource · no repair performed', detail(row));
            continue;
        }
        while (true) {
            host.guard();
            const original = controller.inspectContributions({ resourceId: row.resourceId });
            const fresh = () => {
                host.guard();
                const retained = controller.listTrackedResources().resources.find(current => current.resourceId === row.resourceId);
                if (JSON.stringify(retained) !== JSON.stringify(row))
                    throw Error('Original contribution identity changed; reopen its retained list');
                if (JSON.stringify(controller.inspectContributions({ resourceId: row.resourceId })) !== JSON.stringify(original))
                    throw Error('Original contribution observations changed; inspect the retained resource again');
            };
            const action = await host.choose(`Retained ${row.input.kind} #${row.input.number} · ${row.input.repository.owner}/${row.input.repository.repository}`, ['Inspect retained observations', ...host.refresh ? ['Refresh selected native observations · read requests'] : [], ...host.setParent ? ['Edit summary parent · local routing'] : [], 'Prepare local summary revision · no publication', ...host.preparePublication ? ['Prepare publication from current local summary · no send'] : [], 'Back']);
            fresh();
            if (!action || action === 'Back')
                break;
            if (action === 'Inspect retained observations') {
                await host.show('Retained contribution observations · not current remote state or approval', detail(original));
            }
            else if (action === 'Prepare local summary revision · no publication') {
                // No await separates the captured snapshot recheck and original synchronous transaction.
                const summary = controller.prepareContributionSummary({ resourceId: row.resourceId });
                completedAction = true;
                await host.show('Local summary revision retained · not published · inspect complete and missing', detail(summary));
            }
            else if (action === 'Prepare publication from current local summary · no send' && host.preparePublication) {
                const result = await prepareSummaryPublication({ ...host, prepare: host.preparePublication }, controller, row.resourceId, fresh);
                host.guard();
                if (result !== undefined) {
                    completedAction = true;
                    await host.show('Summary publication preparation retained · inspect original phase and IDs · not sent', detail(result));
                    break;
                }
            }
            else if (action === 'Refresh selected native observations · read requests' && host.refresh) {
                const result = await host.refresh(row.resourceId, fresh);
                host.guard();
                if (result !== undefined) {
                    completedAction = true;
                    await host.show('Native contribution refresh retained · inspect observed/unavailable outcome', detail(result));
                    break; // Re-read the list after an intentional observation change.
                }
            }
            else if (action === 'Edit summary parent · local routing' && host.setParent) {
                const link = original.parent, revision = link?.revision ?? 0;
                if (!Number.isSafeInteger(revision) || revision < 0 || link && (revision < 1 || link.child !== row.resourceId || typeof link.parent !== 'string' && link.parent !== null || link.parent === ''))
                    throw Error('Original summary link is unavailable; inspect its retained record before editing');
                const all = controller.listTrackedResources().resources;
                const candidates = all.filter(candidate => candidate.state === 'RETAINED' && candidate.resourceId !== row.resourceId && candidate.resourceId !== link?.parent && candidate.input.repository.repositoryId === row.input.repository.repositoryId && candidate.input.repository.repositoryNodeId === row.input.repository.repositoryNodeId);
                const parentLabels = candidates.map(candidate => candidate.state === 'RETAINED' ? `${candidate.input.kind} #${candidate.input.number} · ${candidate.input.repository.owner}/${candidate.input.repository.repository} · ${candidate.resourceId}` : '');
                const current = link?.parent ? all.find(candidate => candidate.resourceId === link.parent) : undefined;
                const currentLabel = !link?.parent ? 'none' : current?.state === 'RETAINED' ? `${current.input.kind} #${current.input.number} · ${current.resourceId}` : `unavailable · ${link.parent}`;
                const remove = 'Remove current summary parent', picked = await host.choose(`Summary parent · current ${currentLabel} · revision ${revision} · local routing only`, [...parentLabels, ...link?.parent ? [remove] : [], 'Back']);
                fresh();
                if (!picked || picked === 'Back')
                    continue;
                const parent = picked === remove && link?.parent ? null : candidates[parentLabels.indexOf(picked)];
                if (parent === undefined)
                    throw Error('Unknown summary parent selection');
                const parentView = parent ? controller.inspectContributions({ resourceId: parent.resourceId }) : null;
                const freshPair = () => {
                    fresh();
                    if (parent) {
                        const now = controller.listTrackedResources().resources.find(candidate => candidate.resourceId === parent.resourceId);
                        if (JSON.stringify(now) !== JSON.stringify(parent) || JSON.stringify(controller.inspectContributions({ resourceId: parent.resourceId })) !== JSON.stringify(parentView))
                            throw Error('Selected summary parent changed; reopen its retained list');
                    }
                };
                freshPair();
                const request = { childId: row.resourceId, parentId: parent?.resourceId ?? null, expectedRevision: revision };
                await host.show('Review summary routing · no change yet', detail({ request, child: row, priorParent: currentLabel, nextParent: parent ?? null,
                    scope: 'Re-observe native endpoint identities with read requests, then record a local owner link. This changes future summary membership; earlier summary revisions stay unchanged. No summary is prepared or published automatically. This is not a hosting relationship, conversation parent, agent ancestry or review approval. Cycle and revision checks still apply.' }));
                freshPair();
                const decision = await host.choose('Explicit summary routing action', ['Back without changing', 'Save summary routing']);
                freshPair();
                if (!decision || decision === 'Back without changing')
                    continue;
                if (decision !== 'Save summary routing')
                    throw Error('Unknown summary routing action');
                const result = await host.setParent(request, freshPair);
                host.guard();
                if (result !== undefined) {
                    completedAction = true;
                    await host.show('Summary routing retained · no automatic summary or publication', detail(result));
                    break;
                }
            }
            else
                throw Error('Unknown retained contribution action');
            host.guard();
        }
    }
}
