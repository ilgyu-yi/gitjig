import { localEvidenceText, localCandidateReviewText, localCandidateText, localAuditReviewText, localAuditText, localUnavailableCandidateText } from './local-evidence-presentation.js';
import type { Controller } from '../controller/controller.js';
import type { LocalCheckView } from '../controller/local-checks.js';
import { listLocalCandidates, LocalCandidateReceiptUnavailable, prepareLocalCandidate } from '../controller/local-candidate.js';
import { showReviewAction, type ReviewPageHost } from './exact-review.js';
import { uiText, type UiLocale } from './i18n.js';
import { ControllerError } from '../controller/types.js';
import { localCheckResultText } from './local-check-result.js';
import { appendObservation } from './inspection-text.js';
interface Host extends ReviewPageHost {
    controller: Controller;
    projectId: string;
    signal: AbortSignal;
    locale: UiLocale;
    guard(): void;
    hasSource(): boolean;
    guardSource(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    readOperand(title: string, initial: string, kind: 'path' | 'commit', fresh: () => void): Promise<string | undefined>;
    inputGit(fresh: () => void): Promise<string | undefined>;
    withMessageFile<T>(title: string, initial: string, fresh: () => void, attempt: (file: string) => Promise<T | undefined>): Promise<T | undefined>;
    notice(text: string): void;
    track<T>(task: Promise<T>): Promise<T>;
}
/** Source-bound local correspondence. Native Git retains commit/hooks/signing ownership. */
export function localEvidenceCommands(h: Host) {
    const c = h.controller;
    const check = async (original: LocalCheckView, action: 'inspect' | 'record') => {
        const snapshot = JSON.stringify(original), guard = () => {
            h.guardSource();
            if (original.projectId !== h.projectId || JSON.stringify(c.inspectLocalCheck(original.workId)) !== snapshot)
                throw Error('Original check changed; reopen its current evidence before continuing');
        };
        const gitBinary = await h.inputGit(guard);
        if (gitBinary === undefined)
            return false;
        guard();
        if (action === 'inspect') {
            h.notice('Inspecting original check correspondence · ' + original.workId + ' · no check execution');
            const result = await h.track(c.inspectLocalCheckEvidence({ projectId: h.projectId, workId: original.workId, gitBinary, signal: h.signal }));
            guard();
            await h.show('Original source/index correspondence · not test adequacy or commit approval', localEvidenceText(result));
            return false;
        }
        const recorded = await h.withMessageFile('Owned exact commit message file · LF and final LF · canonical absolute path', '', guard, async messageFile => {
            const review = localCandidateReviewText({ projectId: h.projectId, workId: original.workId, runId: original.latestRun?.runId, resultId: original.result?.resultId, gitBinary, messageFile, scope: 'Records source/index, parent, message and original check correspondence. No stage, commit, hook, signing, push or review approval. Native Git makes the commit separately; audit it afterward.' });
            if (!await showReviewAction(h, 'Review exact candidate recording', review, uiText(h.locale, 'localEvidence.openRecordingConfirmation')))
                return;
            guard();
            const decision = await h.choose('Explicit candidate recording', ['Back without recording', 'Record exact candidate']);
            guard();
            if (!decision || decision === 'Back without recording')
                return;
            if (decision !== 'Record exact candidate')
                throw Error('Unknown candidate recording action');
            const result = await h.track(c.localCommitCandidate({ projectId: h.projectId, workId: original.workId, gitBinary, messageFile, signal: h.signal }, guard));
            return { messageFile, result };
        });
        if (!recorded)
            return false;
        const { messageFile, result } = recorded;
        const id = result.candidate.id;
        let openActions: boolean;
        try {
            guard();
            h.notice('Candidate retained · ' + id + ' · original check ' + original.workId);
            openActions = await showReviewAction(h, 'Exact candidate retained · commit separately with trusted native Git',
                localCandidateText(result.candidate, {gitBinary, messageFile, receipt:result}), uiText(h.locale, 'localEvidence.openCandidateActions'));
        }
        catch (error) {
            const failure = Error('Candidate ' + id + ' was recorded for project ' + h.projectId + '. Reopen /local retained candidates; no commit was made.', { cause: error });
            Object.assign(failure, { workId: original.workId, candidateId: id });
            throw failure;
        }
        if (openActions)
            await inspectCandidate(id, result.fingerprint);
        return true;
    };
    const openCandidate = async (id: string, fingerprint: string) => {
        const retained = prepareLocalCandidate(c, h.projectId, id);
        if (retained.fingerprint !== fingerprint)
            throw new LocalCandidateReceiptUnavailable('Retained candidate changed since it was shown');
        const guard = () => { h.guard(); retained.assertCurrent(); };
        const originalCheckAction = uiText(h.locale, 'localEvidence.openCandidateCheck');
        const inspectOriginalCheck = async () => {
            let check: Awaited<ReturnType<Controller['inspectLocalCandidateCheck']>>;
            try {
                check = await h.track(c.inspectLocalCandidateCheck({projectId: h.projectId, candidateId: id, signal: h.signal}, guard));
            } catch (error) {
                if (error instanceof LocalCandidateReceiptUnavailable) throw error;
                guard();
                if (!(error instanceof ControllerError) || !['LOCAL_CANDIDATE_UNAVAILABLE', 'LOCAL_EVIDENCE_UNAVAILABLE'].includes(error.code))
                    throw error;
                await h.show(uiText(h.locale, 'localEvidence.candidateCheckUnavailable'), error.message);
                guard();
                return;
            }
            guard();
            const text = localCheckResultText(check.result, check.command, h.locale, { surface: 'candidate' }) + '\n\nOriginal result: ' + check.resultId;
            await h.show(uiText(h.locale, 'localEvidence.candidateCheckTitle'),
                appendObservation(text, check.result, uiText(h.locale, 'localEvidence.candidateCheckDetailsOmitted')));
            guard();
        };
        while (true) {
            guard();
            const available = h.hasSource() && retained.hasSource();
            const title = 'Original candidate · ' + id + (available ? '' : '\n' + uiText(h.locale, 'local.sourceUnavailable'));
            const action = await h.choose(title, ['Inspect original candidate', originalCheckAction, ...(available ? ['Audit native commit'] : []), 'Back']);
            if (!action || action === 'Back')
                return;
            guard();
            if (action === 'Inspect original candidate') {
                await h.show('Original candidate · historical preparation, not approval', localCandidateText(retained.record));
                continue;
            }
            if (action === originalCheckAction) {
                await inspectOriginalCheck();
                continue;
            }
            if (action !== 'Audit native commit' || !available)
                throw Error('Unknown candidate action');
            const guardAudit = () => { h.guardSource(); retained.assertSourceCurrent(); };
            const gitBinary = await h.inputGit(guardAudit);
            guardAudit();
            if (gitBinary === undefined)
                continue;
            const commitRef = await h.readOperand('Explicit native commit reference · resolved once', 'HEAD', 'commit', guardAudit);
            guardAudit();
            if (commitRef === undefined)
                continue;
            const review = localAuditReviewText({ projectId: h.projectId, candidateId: id, commitRef, gitBinary, scope: 'Compare immutable tree, message and parents with this exact retained receipt. MATCH does not establish current eligibility, test adequacy, independent review or repository approval. No native commit is amended or reset.' });
            const proceed = await showReviewAction(h, 'Review historical commit audit', review, uiText(h.locale, 'localEvidence.openAuditConfirmation'));
            guardAudit();
            if (!proceed)
                continue;
            const decision = await h.choose('Explicit commit audit', ['Back without audit', 'Audit selected commit']);
            guardAudit();
            if (!decision || decision === 'Back without audit')
                continue;
            if (decision !== 'Audit selected commit')
                throw Error('Unknown audit action');
            const result = await h.track(c.auditLocalCommit({ projectId: h.projectId, candidateId: id, commitRef, gitBinary, signal: h.signal }, guardAudit));
            guardAudit();
            if (await showReviewAction(h, 'Historical native commit correspondence · ' + result.status, localAuditText(result), originalCheckAction))
                await inspectOriginalCheck();
        }
    };
    const inspectCandidate = async (id: string, fingerprint: string) => {
        h.guard();
        try {
            await openCandidate(id, fingerprint);
        } catch (error) {
            if (!(error instanceof LocalCandidateReceiptUnavailable)) throw error;
            h.guard();
            await h.show(uiText(h.locale, 'localEvidence.candidateUnavailable'), localUnavailableCandidateText(id, error.message));
            h.guard();
        }
    };
    const browse = async () => {
        let offset = 0;
        while (true) {
            h.guard();
            const view = listLocalCandidates(c, h.projectId), records = [...view.candidates.map(record => ({ id: record.candidateId, fingerprint: record.fingerprint, label: 'Candidate · ' + record.createdAt + ' · ' + record.index.intendedBranch + ' · check ' + record.check.workId + ' · ' + record.candidateId, available: true as const })), ...view.unavailableRecords.map(record => ({ id: record.candidateId, fingerprint: null, label: 'Unavailable candidate · ' + record.candidateId, available: false as const }))];
            offset = Math.min(offset, Math.max(0, Math.floor((records.length - 1) / 25) * 25));
            const page = records.slice(offset, offset + 25), labels = page.map(r => r.label);
            const selected = await h.choose('Retained candidates · ' + h.projectId + ' · history only', [...labels, ...offset + 25 < records.length ? ['Next candidates'] : [], ...offset > 0 ? ['Previous candidates'] : [], 'Back']);
            h.guard();
            if (!selected || selected === 'Back')
                return;
            if (selected === 'Next candidates') {
                offset += 25;
                continue;
            }
            if (selected === 'Previous candidates') {
                offset = Math.max(0, offset - 25);
                continue;
            }
            const item = page[labels.indexOf(selected)];
            if (!item)
                throw Error('Candidate selection changed');
            if (!item.available) {
                await h.show(uiText(h.locale, 'localEvidence.candidateUnavailable'), localUnavailableCandidateText(item.id));
                continue;
            }
            await inspectCandidate(item.id, item.fingerprint);
        }
    };
    return { check, browse };
}
