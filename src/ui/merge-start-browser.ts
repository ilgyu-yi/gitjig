import { openWorkRecovery, chooseRecoveryEntry, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { showExactReview } from './exact-review.js';
interface Host extends RecoveryNavigation {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    prepare(context: ReturnType<Controller['inspectOwnerMergePreparation']>, fresh: () => void): Promise<unknown | undefined>;
}
/** Explicit first preparation only. Any retained original owns its later recovery. */
export async function browseFirstOwnerMerge(host: Host, c: Controller, targetId: string) {
    let before: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    async function publication(workId: string) {
        let cursor: string | undefined;
        const previous: (string | undefined)[] = [];
        while (true) {
            host.guard();
            const page = c.listOwnerMergePublications(workId, targetId, { limit: 25, ...cursor ? { before: cursor } : {} }), labels = page.publications.map(row => `${row.state === 'RECORDED' ? 'Recorded publication' : 'Held publication'} · ${JSON.stringify(row.recordedPhase)} · ${row.operationId}`);
            const pick = await host.choose('Original source branch publication · standing NOT RECHECKED', [...labels, ...page.nextCursor ? ['Older publications'] : [], ...previous.length ? ['Newer publications'] : [], 'Back']);
            host.guard();
            if (!pick || pick === 'Back')
                return;
            if (pick === 'Older publications' && page.nextCursor) {
                previous.push(cursor);
                cursor = page.nextCursor;
                continue;
            }
            if (pick === 'Newer publications' && previous.length) {
                cursor = previous.pop();
                continue;
            }
            const selected = page.publications[labels.indexOf(pick)];
            if (!selected)
                throw Error('Unknown original branch publication');
            return selected.operationId;
        }
    }
    while (true) {
        host.guard();
        const page = c.listMergeDelegationWorks(targetId, { limit: 25, ...before ? { before } : {} }), labels = page.works.map(work => `${work.recordedPhase} · ${work.workId}`);
        const pick = await host.choose('First PR merge preparation · original owner governed work', [...labels, ...(!page.works.length && !before && host.navigate ? ['Review a new managed change · /change start'] : []), ...page.nextCursor ? ['Older work'] : [], ...newer.length ? ['Newer work'] : [], 'Refresh work list', 'Back']);
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
        const work = page.works[labels.indexOf(pick)];
        if (!work)
            throw Error('Unknown original owner work');
        const retained = c.listOwnerMergeOriginals(work.workId, targetId);
        if (retained.originals.length) {
            const fresh = () => {
                host.guard();
                if (JSON.stringify(c.listOwnerMergeOriginals(work.workId, targetId)) !== JSON.stringify(retained))
                    throw Error('Original merges changed; reopen first preparation');
            };
            for (const original of retained.originals)
                await showExactReview(host, 'Original PR merge retained · no replacement preparation', original, fresh, 'no native request');
            const outcome = await chooseRecoveryEntry(host, fresh, retained.originals.map(original => ({ command: '/repo merge ' + original.operationId, label: 'Open this retained PR merge recovery' })));
            if (outcome)
                return outcome;
            continue;
        }
        const branch = await publication(work.workId);
        if (!branch)
            continue;
        const context = c.inspectOwnerMergePreparation(work.workId, targetId, branch), fresh = () => {
            host.guard();
            if (c.inspectOwnerMergePreparation(work.workId, targetId, branch).fingerprint !== context.fingerprint)
                throw Error('Original owner preparation context changed; review this work and publication again');
        };
        if (context.originals.length) {
            for (const row of context.originals)
                await showExactReview(host, 'Original PR merge retained · no replacement preparation', c.inspectRetainedMerge(row.operationId), fresh, 'no native request');
            const outcome = await chooseRecoveryEntry(host, fresh, context.originals.map(row => ({ command: '/repo merge ' + row.operationId, label: 'Open this retained PR merge recovery' })));
            if (outcome)
                return outcome;
            continue;
        }
        await showExactReview(host, 'Review first PR merge preparation', { scope: 'Read current procedure and native eligibility for this exact published candidate, then retain and prepare one original merge under its existing finite grant. This may spend one original execution allowance. No new work or grant, no model call, policy change or merge send. Any admitted original remains the recovery identity on failure.', ...context }, fresh, 'no merge send');
        if (!context.eligible) {
            const outcome = await openWorkRecovery(host, work.workId, fresh);
            if (outcome)
                return outcome;
            continue;
        }
        const decision = await host.choose('Confirm first PR merge preparation', ['Back without preparation', 'Prepare this original PR merge']);
        fresh();
        if (!decision || decision === 'Back without preparation')
            continue;
        if (decision !== 'Prepare this original PR merge')
            throw Error('Unknown owner merge preparation decision');
        const result = await host.prepare(context, fresh);
        host.guard();
        if (result !== undefined) {
            completed = true;
            await host.show('Original PR merge preparation retained · sending remains separate', JSON.stringify(result, null, 2));
            host.guard();
        }
    }
}
