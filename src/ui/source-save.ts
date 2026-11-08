import { isAbsolute } from 'node:path';
import type { Controller } from '../controller/controller.js';
import { isSourceSaveBranchName } from '../controller/source-save-basis.js';
import type { EffectsProfile } from '../controller/effect-types.js';
import type { SourceSnapshotPreparationStage } from '../controller/source-snapshot-proposals.js';
import { chooseUiItem, type UiChoice } from './choices.js';
import { showExactInspection, showReviewAction, showReviewText, type ReviewPageHost } from './exact-review.js';
import { quoteIdentity, quoteText } from './inspection-text.js';
import { uiText, type MessageId, type UiLocale } from './i18n.js';
import { acceptsSingleLineInput, readSingleLineInput } from './product-input.js';

export interface SourceSaveHost extends ReviewPageHost {
    locale: UiLocale;
    signal: AbortSignal;
    guard(): void;
    guardOriginal?(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    chooseItems?(title: string, items: readonly UiChoice[]): Promise<string | undefined>;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    notice(text: string): void;
    progress?<T>(title: string, task: (signal: AbortSignal, output?: (line: string) => void) => Promise<T>): Promise<T>;
}
type Publication = Awaited<ReturnType<Controller['openSourceSnapshotPublication']>>;
type OriginalSave = ReturnType<Controller['inspectSourceSnapshotOperation']>;
type RetainedSave = Extract<OriginalSave, { state: 'RETAINED' }>;
export type SaveSelection = { kind: 'retained' | 'admitted'; original: RetainedSave };
type SaveMessage = Extract<MessageId, `save.${string}`>;
const text = (host: SourceSaveHost, id: SaveMessage, values: Record<string, string | number> = {}) => uiText(host.locale, id, values);
const fresh = (host: SourceSaveHost) => { host.signal.throwIfAborted(); host.guard(); };
const preparationStage = {
    basis: 'save.preparingBasis', snapshot: 'save.preparingSnapshot', preview: 'save.preparingPreview',
} satisfies Record<SourceSnapshotPreparationStage, SaveMessage>;
async function perform<T>(host: SourceSaveHost, phase: SaveMessage, task: (signal: AbortSignal, output?: (line: string) => void) => Promise<T>, onCancelled?: (reason: unknown) => T): Promise<T> {
    fresh(host);
    const run = async (local: AbortSignal, output?: (line: string) => void) => {
        const signal = AbortSignal.any([host.signal, local]);
        try {
            signal.throwIfAborted(); fresh(host);
            const result = await task(signal, output);
            if (onCancelled) signal.throwIfAborted();
            return result;
        } catch (error) {
            if (!onCancelled || !local.aborted || error !== local.reason || error !== signal.reason) throw error;
            fresh(host); return onCancelled(error);
        }
    };
    return host.progress ? host.progress(text(host, phase), run) : run(host.signal);
}

const canFirstSend = (original: RetainedSave) => original.recordedPhase === 'PREPARED' && !original.nativeAttempt;
const hasSettledAttempt = (original: RetainedSave) => !!original.nativeAttempt?.settlement &&
    ['UNKNOWN', 'REFUSED', 'CONFIRMED'].includes(original.recordedPhase);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function showUnavailablePreview(host: SourceSaveHost, workId: string, proposalId: string, error: unknown) {
    return host.show(text(host, 'save.previewUnavailable', { id: quoteIdentity(proposalId) }),
        text(host, 'save.previewUnavailableBody', { work: quoteIdentity(workId) }) + '\n\n' + quoteIdentity(errorMessage(error)));
}

function readSettledSend(host: SourceSaveHost, operationId: string, read: () => OriginalSave) {
    fresh(host);
    const original = read();
    if (original.state !== 'RETAINED' || original.operationId !== operationId || !hasSettledAttempt(original)) return;
    return original;
}

const sendBinding = (original: RetainedSave) => JSON.stringify([original.workId, original.adoption, original.binding]);
const decisionGuard = (host: SourceSaveHost, signal: AbortSignal) => () => { signal.throwIfAborted(); fresh(host); };
async function choose(host: SourceSaveHost, title: string, entries: [string, SaveMessage][]) {
    fresh(host);
    const result = await chooseUiItem(host, title, entries.map(([value, id]) => ({ value, label: text(host, id) })));
    fresh(host); return result;
}
async function details(host: SourceSaveHost, title: string, value: unknown) {
    fresh(host); await showExactInspection(host, title, value, () => fresh(host), text(host, 'save.recorded'), host.locale); fresh(host);
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
            const last = index === parts.length - 1 && window.nextOffset === null;
            const advanced = await showReviewAction(host, title, parts[index]!, text(host, last ? 'save.fileComplete' : 'save.nextPart'));
            fresh(host);
            if (!advanced) return false;
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
export async function saveSourceProposal(host: SourceSaveHost, c: Controller, input: { workId: string; proposalId: string; expectedArtifactHash?: string }): Promise<SaveSelection | undefined> {
    const opening = structuredClone(input);
    const { workId, proposalId } = opening;
    const request = { workId, proposalId };
    fresh(host);
    let reader: Publication | undefined;
    let originalId: string | undefined;
    const actionFailures: unknown[] = [];
    const originalHost = host.guardOriginal ? { ...host, guard: host.guardOriginal } : host;
    const saveHost = { ...host, guard: () => (originalId ? originalHost : host).guard() };
    try {
        let lookupFailure: { error: unknown } | undefined;
        let existing: RetainedSave | null = null;
        try { existing = c.inspectSourceSnapshotProposalOperation(opening); }
        catch (error) { lookupFailure = { error }; }
        if (existing) {
            fresh(originalHost);
            return { kind: 'retained', original: existing };
        }
        const opened = lookupFailure ?? await perform(host, 'save.opening', async signal => {
            try {
                reader = await c.openSourceSnapshotPublication(opening, { signal });
                return { publication: reader } as const;
            } catch (error) {
                if (signal.aborted) throw error;
                return { error } as const;
            }
        }, () => undefined);
        fresh(host);
        if (!opened) return;
        if ('error' in opened) {
            await showUnavailablePreview(host, workId, proposalId, opened.error);
            fresh(host);
            return;
        }
        const { publication } = opened;
        const { review } = publication, profile = structuredClone(review.nativeProfile);
        let decision: Awaited<ReturnType<Controller['reviewSourceSnapshotSave']>> | undefined, held: string | undefined;
        try {
            decision = await perform(host, 'save.reviewing', signal => c.reviewSourceSnapshotSave(request, { profile, signal }), () => undefined);
            if (!decision) { fresh(host); return; }
        }
        catch (error) {
            fresh(host);
            if (error instanceof Error && error.name === 'AbortError') throw error;
            held = error instanceof Error ? error.message : String(error);
        }
        fresh(host);
        if (decision?.kind === 'original') {
            if (decision.original.binding.artifact.hash !== review.artifact.hash)
                throw Error(text(host, 'save.originalReviewChanged'));
            return { kind: 'retained', original: decision.original };
        }
        const summary = text(host, 'save.review', { work: workId, source: quoteIdentity(review.sourceRoot),
            branch: quoteIdentity(review.destinationRef), commit: review.projectedCommit, files: review.productCount,
            additions: review.wholeFileAdditionCount, omitted: review.omissionCount,
            remaining: decision?.execution ? decision.execution.lim - decision.execution.consumed - decision.execution.reserved : '—' });
        let disclosed = review.wholeFileAdditionCount === 0;
        while (true) {
            const hold = held ?? decision?.holds[0];
            const body = hold ? summary + '\n\n' + text(host, 'save.held') + '\n' + quoteIdentity(hold) : summary;
            const advance = await showReviewAction(host, text(host, 'save.title'), body, text(host, 'save.openOptions'));
            fresh(host);
            if (!advance) return;
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
                // No new input between this exact consent and original first send.
                const outcome = await perform(saveHost, 'save.saving', async signal => {
                    const validate = decisionGuard(host, signal);
                    const original = await c.adoptSourceSnapshotSave({ ...request, expectedReviewFingerprint: decision.fingerprint }, {
                        profile, signal, validate, onAllocated: id => { originalId = id; },
                    });
                    originalId = original.operationId;
                    const validateOriginal = decisionGuard(originalHost, signal);
                    validateOriginal();
                    return c.sendSourceSnapshotSave(originalId, { profile, signal, validate: validateOriginal });
                }, reason => {
                    if (!originalId) return undefined;
                    const original = c.inspectSourceSnapshotOperation({ operationId: originalId });
                    if (original.state === 'RETAINED' && (canFirstSend(original) || hasSettledAttempt(original))) return original;
                    throw reason;
                });
                fresh(saveHost);
                return outcome && { kind: 'admitted', original: outcome };
            }
        }
    } catch (error) {
        actionFailures.push(error);
        if (originalId) {
            try {
                const id = originalId;
                const recovered = readSettledSend(originalHost, id, () => c.inspectSourceSnapshotOperation({ operationId: id }));
                if (recovered) {
                    host.notice(text(host, 'save.outcomeRetained', { id }) + ' · ' + quoteIdentity(errorMessage(error)));
                    fresh(originalHost);
                    return { kind: 'admitted', original: recovered };
                }
            } catch (failure) {
                actionFailures.push(failure);
                throw Error(text(host, 'save.retainedError', { id: originalId }) + ' ' + errorMessage(failure), { cause: new AggregateError([error, failure]) });
            }
            throw Error(text(host, 'save.retainedError', { id: originalId }) + ' ' + errorMessage(error), { cause: error });
        }
        throw error;
    } finally {
        try { await reader?.close(); }
        catch (error) {
            if (!originalId && !actionFailures.length) throw error;
            const failures = [...actionFailures, error];
            const context = originalId ? text(host, 'save.retainedError', { id: originalId }) + ' ' : '';
            throw new AggregateError(failures, context + failures.map(errorMessage).join(' · '));
        }
    }
}

async function saveField(host: SourceSaveHost, title: SaveMessage, initial: string,
    valid: (value: string) => boolean, invalid: SaveMessage): Promise<string | undefined> {
    return readSingleLineInput(async (value, explanation) => {
        fresh(host);
        const entered = await host.input(text(host, title), value, explanation);
        fresh(host);
        return entered;
    }, initial, text(host, 'save.fieldSingleLine'), value => valid(value) ? undefined : text(host, invalid));
}

export async function prepareSourceSave(host: SourceSaveHost, c: Controller, workId: string) {
    const editBranch = (initial: string) => saveField(host, 'save.branch', initial, isSourceSaveBranchName, 'save.branchInvalid');
    const initialBranch = await editBranch('');
    if (initialBranch === undefined) return;
    let branch = initialBranch;
    const suggestion = c.sourceSnapshotProfileSuggestion();
    const configured = suggestion?.gitBinary ?? '';
    let binary = isAbsolute(configured) && acceptsSingleLineInput(configured)
        ? configured : await saveField(host, 'save.git', configured, isAbsolute, 'save.gitInvalid');
    if (binary === undefined) return;
    let previous: 'cancelled' | 'branch-exists' | undefined;
    while (true) {
        const destinationBranch = branch;
        const exists = previous === 'branch-exists';
        const context = [text(host, exists ? 'save.branchExists' : 'save.prepareScope'), quoteIdentity(destinationBranch),
            text(host, 'save.preparedGit', { path: quoteIdentity(binary) }),
            ...(previous === 'cancelled' ? [text(host, 'save.prepareCancelled')] : [])].join('\n');
        const fields: [string, SaveMessage][] = [['back', 'save.back']];
        if (!exists) fields.push(['prepare', 'save.prepare']);
        fields.push(['edit-branch', 'save.editBranch']);
        if (!exists) fields.push(['edit-git', 'save.editGit']);
        const action = await choose(host, context, fields);
        if (action === 'edit-branch') {
            const edited = await editBranch(destinationBranch);
            if (edited !== undefined && edited !== destinationBranch) {
                branch = edited;
                previous = undefined;
            }
            continue;
        }
        if (action === 'edit-git') {
            const edited = await saveField(host, 'save.git', binary, isAbsolute, 'save.gitInvalid');
            if (edited !== undefined) binary = edited;
            continue;
        }
        if (action !== 'prepare') return;
        const profile: EffectsProfile = { ...suggestion, gitBinary: binary };
        const prepared = await perform(host, 'save.preparing', (signal, output) => c.prepareSourceSnapshot({ workId, destinationBranch }, {
            profile, signal, validate: decisionGuard(host, signal),
            ...output ? { onStage(stage: SourceSnapshotPreparationStage) { output(text(host, preparationStage[stage]) + '\n'); } } : {},
        }));
        if (prepared.kind === 'cancelled') {
            fresh(host);
            previous = 'cancelled';
            continue;
        }
        if (prepared.kind === 'held') {
            fresh(host);
            if (!('branchExists' in prepared)) { await details(host, text(host, 'save.held'), prepared); return; }
            previous = 'branch-exists';
            continue;
        }
        try {
            fresh(host);
            return await saveSourceProposal(host, c, { workId, proposalId: prepared.proposalId, expectedArtifactHash: prepared.review.artifact.hash });
        } catch (error) {
            throw Error(text(host, 'save.proposalError', { work: workId, id: prepared.proposalId }) + ' ' + (error instanceof Error ? error.message : String(error)), { cause: error });
        }
    }
}

export function sourceSaveStatus(original: OriginalSave) {
    if (original.state !== 'RETAINED') return 'unavailable';
    if (original.recordedPhase === 'CONFIRMED' && original.recordedOutcome === 'confirmed') return 'confirmed';
    if (original.recordedPhase === 'REFUSED' && original.recordedOutcome === 'definitely-unsent') return 'stopped';
    if (canFirstSend(original)) return 'ready';
    return 'uncertain';
}

export interface SourceSaveHistoryScope {
    workId: string;
    historyOnly?: boolean;
    expectedOriginal?: RetainedSave;
}

/** Historical inspection requires no profile, current standing or Native query. */
export async function inspectSourceSave(host: SourceSaveHost, c: Controller, operationId: string, announceOutcome = false, historyScope?: SourceSaveHistoryScope) {
    let sendDiagnostic: string | undefined;
    const expectedBinding = historyScope?.expectedOriginal && sendBinding(historyScope.expectedOriginal);
    const read = (allowUnavailable = false) => {
        const original = c.inspectSourceSnapshotOperation({ operationId });
        if (historyScope && (original.state === 'RETAINED' ? original.workId !== historyScope.workId : !allowUnavailable))
            throw Error(text(host, 'save.originalReviewChanged'));
        if (original.state === 'RETAINED' && expectedBinding !== undefined && sendBinding(original) !== expectedBinding)
            throw Error(text(host, 'save.originalReviewChanged'));
        return original;
    };
    const scopedHost = historyScope ? { ...host, guard() { host.guard(); read(); } } : host;
    const reopen = text(host, 'save.reopenRoute', { id: operationId });
    const finish = () => {
        fresh(host);
        const current = read();
        if (announceOutcome) {
            const status = text(host, `save.${sourceSaveStatus(current)}`);
            host.notice(current.state === 'RETAINED'
                ? text(host, 'save.editorOutcome', { status, branch: quoteIdentity(current.binding.destinationRef) }) + '\n' + reopen
                : status);
        }
        return current;
    };
    while (true) {
        fresh(host); const original = read(!announceOutcome);
        if (original.state !== 'RETAINED') {
            const diagnostic = historyScope ? { operationId, reason: original.reason } : original;
            await details(host, text(host, 'save.unavailable'), diagnostic);
            return historyScope ? original : finish();
        }
        const phase = original.recordedPhase;
        const status = sourceSaveStatus(original);
        const target = text(host, status === 'confirmed' ? 'save.confirmedTarget' : 'save.intendedTarget', {
            branch: quoteIdentity(original.binding.destinationRef), commit: original.binding.projectedCommit,
        });
        const scope = text(host, 'save.originalScope', { work: original.workId, id: operationId });
        const sendIntentRecorded = !!original.nativeAttempt?.intent;
        const canCheck = sendIntentRecorded && ['UNKNOWN', 'CONFIRMED'].includes(phase);
        const fact = status === 'uncertain' ? text(host, sendIntentRecorded ? 'save.uncertainSendRecorded' : 'save.uncertainSendUnavailable') : undefined;
        const diagnostic = sendDiagnostic === undefined ? [] : [text(host, 'save.sendDiagnostic', { reason: quoteIdentity(sendDiagnostic) })];
        const action = await choose(host, [text(host, `save.${status}`), fact, target, scope, ...diagnostic].filter(Boolean).join('\n'), [['back', 'save.back'], ['details', 'save.details'],
            ...!historyScope?.historyOnly && canFirstSend(original) ? [['send', 'save.resumeSend'] as [string, SaveMessage]] : [],
            ...canCheck ? [['read', 'save.check'] as [string, SaveMessage]] : []]);
        if (!action || action === 'back') return announceOutcome ? finish() : original;
        if (action === 'details') {
            await details(host, text(host, 'save.details'), sendDiagnostic === undefined ? original : { original, sendDiagnostic });
            continue;
        }
        const recorded = JSON.stringify(original);
        const current = () => {
            fresh(host);
            if (JSON.stringify(read()) !== recorded)
                throw Error(text(host, 'save.originalReviewChanged'));
        };
        const proposalId = original.binding.proposalId;
        let proposal: Awaited<ReturnType<Controller['inspectSourceSnapshotProposal']>> | undefined;
        try {
            proposal = await perform(host, 'save.opening', signal => {
                current();
                return c.inspectSourceSnapshotProposal({ workId: original.workId, proposalId }, { signal });
            }, () => undefined);
        } catch (error) {
            current();
            await showUnavailablePreview(host, original.workId, proposalId, error);
            current();
            continue;
        }
        current();
        if (!proposal)
            continue;
        const profile = structuredClone(proposal.nativeProfile);
        const operands = text(host, 'save.originalReview', { work: original.workId, source: quoteText(original.binding.projectRoot),
            branch: quoteText(original.binding.destinationRef), commit: original.binding.projectedCommit });
        const advance = { next: uiText(host.locale, 'review.next'), finish: uiText(host.locale, 'review.confirm') };
        const suffix = uiText(host.locale, 'review.only');
        if (action === 'send') {
            const binding = sendBinding(original);
            const reviewed = await showReviewText(host, text(host, 'save.sendScope'), operands, current, suffix, host.locale, advance);
            if (!reviewed)
                continue;
            const selected = await choose(host, text(host, 'save.sendScope'), [['back', 'save.back'], ['send', 'save.confirm']]);
            current();
            if (selected !== 'send')
                continue;
            let invoked = false;
            const outcome = await perform(host, 'save.saving', signal => {
                current();
                invoked = true;
                return c.sendSourceSnapshotSave(operationId, { profile, signal, validate: decisionGuard(scopedHost, signal) });
            }, () => undefined).catch(error => {
                if (!invoked) throw error;
                let recovered: RetainedSave | undefined;
                try {
                    recovered = readSettledSend(host, operationId, () => {
                        const latest = read();
                        if (latest.state === 'RETAINED' && sendBinding(latest) !== binding) throw Error(text(host, 'save.originalReviewChanged'));
                        return latest;
                    });
                } catch (failure) {
                    throw new AggregateError([error, failure], [error, failure].map(errorMessage).join(' · '));
                }
                if (!recovered) throw error;
                sendDiagnostic = errorMessage(error);
                return recovered;
            });
            fresh(host);
            // The next iteration reads the durable outcome even when Escape raced settlement.
            announceOutcome ||= outcome !== undefined;
        } else if (action === 'read') {
            const review = await perform(host, 'save.reviewing', signal => {
                current();
                return c.reviewSourceSnapshotResult(operationId, { profile, signal });
            }, () => undefined);
            current();
            if (!review)
                continue;
            const remaining = review.execution ? review.execution.lim - review.execution.consumed - review.execution.reserved : 0;
            const summary = [operands, text(host, 'save.readAllowance', { remaining }), ...review.holds.map(quoteText)].join('\n\n');
            const reviewed = await showReviewText(host, text(host, 'save.checkScope'), summary, current, suffix, host.locale,
                review.canRead ? advance : { ...advance, finish: text(host, 'save.reviewOptions') });
            if (!reviewed)
                continue;
            let accepted = false;
            while (true) {
                const selected = await choose(host, text(host, 'save.checkScope'), [['back', 'save.back'], ['details', 'save.details'], ...review.canRead ? [['read', 'save.checkConfirm'] as [string, SaveMessage]] : []]);
                current();
                if (selected === 'details') { await details(host, text(host, 'save.details'), review); current(); continue; }
                accepted = selected === 'read'; break;
            }
            if (!accepted) continue;
            const outcome = await perform(host, 'save.checking', signal => {
                current();
                return c.checkSourceSnapshotResult({ operationId, expectedReviewFingerprint: review.fingerprint }, { profile, signal, validate: decisionGuard(scopedHost, signal) });
            }, () => undefined);
            fresh(host);
            announceOutcome ||= outcome !== undefined;
        }
    }
}
