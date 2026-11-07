import type { Controller } from '../controller/controller.js';
import type { EffectsProfile } from '../controller/effect-types.js';
import { chooseUiItem, type UiChoice } from './choices.js';
import { showExactReview } from './exact-review.js';
import { quoteIdentity, quoteText } from './inspection-text.js';
import { uiText, type MessageId, type UiLocale } from './i18n.js';

export interface SourceSaveHost {
    locale: UiLocale;
    signal: AbortSignal;
    guard(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    chooseItems?(title: string, items: readonly UiChoice[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    notice(text: string): void;
    progress?<T>(title: string, task: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
type Publication = Awaited<ReturnType<Controller['openSourceSnapshotPublication']>>;
type SaveMessage = Extract<MessageId, `save.${string}`>;
const text = (host: SourceSaveHost, id: SaveMessage, values: Record<string, string | number> = {}) => uiText(host.locale, id, values);
const fresh = (host: SourceSaveHost) => { host.signal.throwIfAborted(); host.guard(); };
async function perform<T>(host: SourceSaveHost, phase: SaveMessage, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    fresh(host);
    const run = (local: AbortSignal) => { const signal = AbortSignal.any([host.signal, local]); signal.throwIfAborted(); fresh(host); return task(signal); };
    return host.progress ? host.progress(text(host, phase), run) : run(host.signal);
}
const decisionGuard = (host: SourceSaveHost, signal: AbortSignal) => () => { signal.throwIfAborted(); fresh(host); };
async function choose(host: SourceSaveHost, title: string, entries: [string, SaveMessage][]) {
    fresh(host);
    const result = await chooseUiItem(host, title, entries.map(([value, id]) => ({ value, label: text(host, id) })));
    fresh(host); return result;
}
async function details(host: SourceSaveHost, title: string, value: unknown) {
    fresh(host); await showExactReview(host, title, value, () => fresh(host), text(host, 'save.recorded')); fresh(host);
}

/** Split the final escaped display, not the underlying byte window. */
export function sourceFileDisplayParts(content: string): string[] {
    const escaped = content.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu,
        c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const parts: string[] = [];
    for (let offset = 0; offset < escaped.length;) {
        let end = Math.min(offset + 32000, escaped.length);
        if (end < escaped.length && /[\uD800-\uDBFF]/u.test(escaped[end - 1]!)) end--;
        parts.push(escaped.slice(offset, end)); offset = end;
    }
    return parts.length ? parts : [''];
}

async function inspectFile(host: SourceSaveHost, publication: Publication, name: string): Promise<boolean> {
    let offset = 0;
    while (true) {
        fresh(host); const window = await publication.readFile({ path: name, offset }); fresh(host);
        const header = text(host, 'save.fileHeader', { path: quoteText(name), offset: window.offset, total: window.totalBytes, sha: window.sha256 });
        const parts = sourceFileDisplayParts(header + '\n\n' + window.text);
        for (let index = 0; index < parts.length; index++) {
            const title = text(host, 'save.filePart', { offset: window.offset,
                total: window.totalBytes, part: index + 1, parts: parts.length });
            await host.show(title, parts[index]!); fresh(host);
            const last = index === parts.length - 1 && window.nextOffset === null;
            const action = await choose(host, title, [['back', 'save.back'], ['next', last ? 'save.fileComplete' : 'save.nextPart']]);
            if (action !== 'next') return false;
        }
        if (window.nextOffset === null) return true;
        offset = window.nextOffset;
    }
}

async function inspectWholeFiles(host: SourceSaveHost, publication: Publication): Promise<boolean> {
    let cursor = 0;
    while (true) {
        fresh(host); const page = publication.readPage({ section: 'whole-file', cursor, limit: 25 });
        for (const row of page.entries) if (!await inspectFile(host, publication, row.path)) return false;
        if (page.nextCursor === null) return true;
        cursor = page.nextCursor;
    }
}

async function inspectRoster(host: SourceSaveHost, publication: Publication, section: 'product' | 'omissions') {
    let cursor = 0;
    const previous: number[] = [];
    while (true) {
        fresh(host); const page = publication.readPage({ section, cursor, limit: 25 });
        const title = text(host, section === 'product' ? 'save.files' : 'save.omissions');
        const entries: UiChoice[] = [{ value: 'back', label: text(host, 'save.back') },
            { value: 'details', label: text(host, 'save.pageDetails') }];
        if (section === 'product') page.entries.forEach((row, i) => entries.push({ value: 'file:' + i,
            label: text(host, 'save.fileRow', { ordinal: cursor + i + 1, path: quoteIdentity(row.path) }) }));
        if (page.nextCursor !== null) entries.push({ value: 'next', label: text(host, 'save.nextPage') });
        if (previous.length) entries.push({ value: 'previous', label: text(host, 'save.previousPage') });
        const action = await chooseUiItem(host, title, entries); fresh(host);
        if (!action || action === 'back') return;
        if (action === 'details') await details(host, title, page);
        else if (action === 'next' && page.nextCursor !== null) { previous.push(cursor); cursor = page.nextCursor; }
        else if (action === 'previous' && previous.length) cursor = previous.pop()!;
        else if (action.startsWith('file:')) {
            const row = page.entries[Number(action.slice(5))];
            if (!row) throw Error('Original publication row unavailable');
            if ('content' in row && row.content === 'text') await inspectFile(host, publication, row.path);
            else await details(host, title, row);
        }
    }
}

/** One reviewed privacy/save choice, then original atomic adoption and first send. */
export async function saveSourceProposal(host: SourceSaveHost, c: Controller, input: { workId: string; proposalId: string }) {
    input = structuredClone(input);
    fresh(host);
    const { review, publication } = await perform(host, 'save.opening', async signal => {
        const review = await c.inspectSourceSnapshotProposal(input, { signal }); fresh(host); signal.throwIfAborted();
        const publication = await c.openSourceSnapshotPublication({ ...input, expectedArtifactHash: review.artifact.hash }, { signal });
        return { review, publication };
    });
    const profile = structuredClone(review.nativeProfile);
    let originalId: string | undefined;
    try {
        fresh(host);
        let disclosed = review.wholeFileAdditionCount === 0;
        while (true) {
            let decision: Awaited<ReturnType<Controller['reviewSourceSnapshotSave']>> | undefined, held: string | undefined, reviewSignal: AbortSignal | undefined;
            try { decision = await perform(host, 'save.reviewing', signal => { reviewSignal = signal; return c.reviewSourceSnapshotSave(input, { profile, signal }); }); }
            catch (error) {
                fresh(host);
                if (reviewSignal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
                held = error instanceof Error ? error.message : String(error);
            }
            fresh(host);
            if (decision?.kind === 'original') return decision.original;
            const summary = text(host, 'save.review', { work: input.workId, source: quoteIdentity(review.sourceRoot),
                branch: quoteIdentity(review.destinationRef), commit: review.projectedCommit, files: review.productCount,
                additions: review.wholeFileAdditionCount, omitted: review.omissionCount,
                remaining: decision?.execution ? decision.execution.lim - decision.execution.consumed - decision.execution.reserved : '—' });
            await host.show(text(host, 'save.title'), summary + (held || decision?.holds.length ? '\n\n' + text(host, 'save.held') + '\n' + quoteIdentity(held ?? decision!.holds[0]!) : '')); fresh(host);
            const action = await choose(host, text(host, 'save.title'), [['back', 'save.back'],
                ['files', 'save.files'], ['omissions', 'save.omissions'], ['details', 'save.details'],
                ...!disclosed ? [['whole', 'save.wholeFiles'] as [string, SaveMessage]] : [],
                ...disclosed && decision?.canAdopt ? [['save', 'save.confirm'] as [string, SaveMessage]] : []]);
            if (!action || action === 'back') return;
            if (action === 'files') await inspectRoster(host, publication, 'product');
            else if (action === 'omissions') await inspectRoster(host, publication, 'omissions');
            else if (action === 'details') await details(host, text(host, 'save.details'), { review, decision, held });
            else if (action === 'whole') disclosed = await inspectWholeFiles(host, publication);
            else if (action === 'save' && decision?.canAdopt) {
                fresh(host); host.notice(text(host, 'save.saving'));
                // No new input between this exact consent and original first send.
                const outcome = await perform(host, 'save.saving', async signal => {
                    const validate = decisionGuard(host, signal);
                    const original = await c.adoptSourceSnapshotSave({ ...input, expectedReviewFingerprint: decision.fingerprint }, {
                        profile, signal, validate, onAllocated: id => { originalId = id; },
                    });
                    originalId = original.operationId; validate();
                    return c.sendSourceSnapshotSave(originalId, { profile, signal, validate });
                });
                fresh(host); return outcome;
            }
        }
    } catch (error) {
        if (originalId) {
            try {
                fresh(host);
                const original = c.inspectSourceSnapshotOperation({ operationId: originalId });
                if (original.state === 'RETAINED' && original.nativeAttempt?.settlement && ['UNKNOWN', 'REFUSED', 'CONFIRMED'].includes(original.recordedPhase)) {
                    host.notice(text(host, 'save.outcomeRetained', { id: originalId })); fresh(host);
                    return original;
                }
            } catch (failure) {
                throw Error(text(host, 'save.retainedError', { id: originalId }) + ' ' + (failure instanceof Error ? failure.message : String(failure)), { cause: new AggregateError([error, failure]) });
            }
            throw Error(text(host, 'save.retainedError', { id: originalId }) + ' ' + (error instanceof Error ? error.message : String(error)), { cause: error });
        }
        throw error;
    } finally { await publication.close(); }
}

export async function prepareSourceSave(host: SourceSaveHost, c: Controller, workId: string) {
    fresh(host);
    const branch = await host.input(text(host, 'save.branch'), ''); fresh(host);
    if (branch === undefined) return;
    const suggestion = c.sourceSnapshotProfileSuggestion();
    const binary = await host.input(text(host, 'save.git'), suggestion?.gitBinary ?? ''); fresh(host);
    if (binary === undefined) return;
    const profile: EffectsProfile = { ...suggestion, gitBinary: binary };
    const action = await choose(host, text(host, 'save.prepareScope'), [['back', 'save.back'], ['prepare', 'save.prepare']]);
    if (action !== 'prepare') return;
    host.notice(text(host, 'save.preparing'));
    const prepared = await perform(host, 'save.preparing', signal => c.prepareSourceSnapshot({ workId, destinationBranch: branch }, { profile, signal, validate: decisionGuard(host, signal) }));
    try {
    fresh(host);
    if (prepared.kind !== 'prepared') { await details(host, text(host, 'save.held'), prepared); return; }
    return await saveSourceProposal(host, c, { workId, proposalId: prepared.proposalId });
    } catch (error) {
        if (prepared.kind === 'prepared') throw Error(text(host, 'save.proposalError', { work: workId, id: prepared.proposalId }) + ' ' + (error instanceof Error ? error.message : String(error)), { cause: error });
        throw error;
    }
}

/** Historical inspection requires no profile, current standing or Native query. */
export async function inspectSourceSave(host: SourceSaveHost, c: Controller, operationId: string) {
    while (true) {
        fresh(host); const original = c.inspectSourceSnapshotOperation({ operationId });
        if (original.state !== 'RETAINED') { await details(host, text(host, 'save.unavailable'), original); return; }
        const phase = original.recordedPhase;
        const status: SaveMessage = phase === 'CONFIRMED' ? 'save.confirmed' : phase === 'PREPARED' && !original.nativeAttempt ? 'save.ready' : phase === 'UNKNOWN' || phase === 'INVOKING' ? 'save.uncertain' : 'save.stopped';
        const action = await choose(host, text(host, status) + '\n' + text(host, 'save.originalScope', { work: original.workId, branch: quoteIdentity(original.binding.destinationRef), id: operationId }), [['back', 'save.back'], ['details', 'save.details'],
            ...phase === 'PREPARED' && !original.nativeAttempt ? [['send', 'save.resumeSend'] as [string, SaveMessage]] : [],
            ...original.nativeAttempt?.intent && ['UNKNOWN', 'CONFIRMED'].includes(phase) ? [['read', 'save.check'] as [string, SaveMessage]] : []]);
        if (!action || action === 'back') return original;
        if (action === 'details') { await details(host, text(host, 'save.details'), original); continue; }
        const proposal = await perform(host, 'save.opening', signal => c.inspectSourceSnapshotProposal({ workId: original.workId, proposalId: original.binding.proposalId }, { signal })); fresh(host);
        const profile = structuredClone(proposal.nativeProfile);
        if (action === 'send') {
            await host.show(text(host, 'save.sendScope'), text(host, 'save.originalReview', { work: original.workId, source: quoteIdentity(original.binding.projectRoot), branch: quoteIdentity(original.binding.destinationRef), commit: original.binding.projectedCommit })); fresh(host);
            if (await choose(host, text(host, 'save.sendScope'), [['back', 'save.back'], ['send', 'save.confirm']]) !== 'send') continue;
            host.notice(text(host, 'save.saving'));
            await perform(host, 'save.saving', signal => c.sendSourceSnapshotSave(operationId, { profile, signal, validate: decisionGuard(host, signal) })); fresh(host);
        } else if (action === 'read') {
            const review = await perform(host, 'save.reviewing', signal => c.reviewSourceSnapshotResult(operationId, { profile, signal })); fresh(host);
            let accepted = false;
            while (true) {
                await host.show(text(host, 'save.checkScope'), text(host, 'save.originalReview', { work: original.workId, source: quoteIdentity(original.binding.projectRoot), branch: quoteIdentity(original.binding.destinationRef), commit: original.binding.projectedCommit }) + '\n\n' + text(host, 'save.readAllowance', { remaining: review.execution ? review.execution.lim - review.execution.consumed - review.execution.reserved : 0 }) + (review.holds.length ? '\n' + quoteIdentity(review.holds[0]!) : '')); fresh(host);
                const selected = await choose(host, text(host, 'save.checkScope'), [['back', 'save.back'], ['details', 'save.details'], ...review.canRead ? [['read', 'save.checkConfirm'] as [string, SaveMessage]] : []]);
                if (selected === 'details') { await details(host, text(host, 'save.details'), review); continue; }
                accepted = selected === 'read'; break;
            }
            if (!accepted) continue;
            host.notice(text(host, 'save.checking'));
            await perform(host, 'save.checking', signal => c.checkSourceSnapshotResult({ operationId, expectedReviewFingerprint: review.fingerprint }, { profile, signal, validate: decisionGuard(host, signal) })); fresh(host);
        }
    }
}
