import { localEvidenceText, localCandidateReviewText, localCandidateText, localAuditReviewText, localAuditText, localUnavailableCandidateText } from './local-evidence-presentation.js';
import type { Controller } from '../controller/controller.js';
import type { LocalCheckView } from '../controller/local-checks.js';
import { listLocalCandidates, prepareLocalCandidate } from '../controller/local-candidate.js';
interface Host {
    controller: Controller;
    projectId: string;
    signal: AbortSignal;
    guard(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value?: string): Promise<string | undefined>;
    inputGit?(): Promise<string | undefined>;
    show(title: string, value: unknown): Promise<void>;
    notice(text: string): void;
    track<T>(task: Promise<T>): Promise<T>;
}
/** Source-bound local correspondence. Native Git retains commit/hooks/signing ownership. */
export function localEvidenceCommands(h: Host) {
    const c = h.controller;
    const check = async (original: LocalCheckView, action: 'inspect' | 'record') => {
        const snapshot = JSON.stringify(original), guard = () => {
            h.guard();
            if (original.projectId !== h.projectId || JSON.stringify(c.inspectLocalCheck(original.workId)) !== snapshot)
                throw Error('Original check changed; reopen its current evidence before continuing');
        };
        guard();
        const gitBinary = await (h.inputGit ? h.inputGit() : h.input('Trusted Git executable · absolute path outside projects', '/usr/bin/git'));
        if (gitBinary === undefined)
            return;
        guard();
        if (action === 'inspect') {
            h.notice('Inspecting original check correspondence · ' + original.workId + ' · no check execution');
            const result = await h.track(c.inspectLocalCheckEvidence({ projectId: h.projectId, workId: original.workId, gitBinary, signal: h.signal }));
            guard();
            await h.show('Original source/index correspondence · not test adequacy or commit approval', localEvidenceText(result));
            return;
        }
        const messageFile = await h.input('Owned exact commit message file · LF and final LF · canonical absolute path', '');
        if (messageFile === undefined)
            return;
        guard();
        await h.show('Review exact candidate recording', localCandidateReviewText({ projectId: h.projectId, workId: original.workId, runId: original.latestRun?.runId, resultId: original.result?.resultId, gitBinary, messageFile, scope: 'Records source/index, parent, message and original check correspondence. No stage, commit, hook, signing, push or review approval. Native Git makes the commit separately; audit it afterward.' }));
        guard();
        const decision = await h.choose('Explicit candidate recording', ['Back without recording', 'Record exact candidate']);
        guard();
        if (!decision || decision === 'Back without recording')
            return;
        if (decision !== 'Record exact candidate')
            throw Error('Unknown candidate recording action');
        const result = await h.track(c.localCommitCandidate({ projectId: h.projectId, workId: original.workId, gitBinary, messageFile, signal: h.signal }, guard));
        const id = result.candidate.id;
        try {
            guard();
            h.notice('Candidate retained · ' + id + ' · original check ' + original.workId);
            await h.show('Exact candidate retained · commit separately with trusted native Git', localCandidateText(result.candidate, {gitBinary, messageFile, receipt:result}));
        }
        catch (error) {
            const failure = Error('Candidate ' + id + ' was recorded for project ' + h.projectId + '. Reopen /local retained candidates; no commit was made.', { cause: error });
            Object.assign(failure, { workId: original.workId, candidateId: id });
            throw failure;
        }
    };
    const browse = async () => {
        let offset = 0;
        while (true) {
            h.guard();
            const view = listLocalCandidates(c, h.projectId), records = [...view.candidates.map(record => ({ id: record.candidateId, fingerprint: record.fingerprint, label: 'Candidate · ' + record.createdAt + ' · ' + record.index.intendedBranch + ' · check ' + record.check.workId + ' · ' + record.candidateId, available: true })), ...view.unavailableRecords.map(record => ({ id: record.candidateId, fingerprint: null, label: 'Unavailable candidate · ' + record.candidateId, available: false }))], page = records.slice(offset, offset + 25), labels = page.map(r => r.label);
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
                await h.show('Unavailable original candidate', localUnavailableCandidateText(item.id));
                continue;
            }
            const retained = prepareLocalCandidate(c, h.projectId, item.id);
            if (retained.fingerprint !== item.fingerprint)
                throw Error('Selected candidate changed; reopen retained candidates');
            const guard = () => { h.guard(); retained.assertCurrent(); };
            guard();
            const action = await h.choose('Original candidate · ' + item.id, ['Inspect original candidate', 'Audit native commit', 'Back']);
            guard();
            if (!action || action === 'Back')
                continue;
            if (action === 'Inspect original candidate') {
                await h.show('Original candidate · historical preparation, not approval', localCandidateText(retained.record));
                guard();
                continue;
            }
            if (action !== 'Audit native commit')
                throw Error('Unknown candidate action');
            const gitBinary = await (h.inputGit ? h.inputGit() : h.input('Trusted Git executable · absolute path outside projects', '/usr/bin/git'));
            if (gitBinary === undefined)
                continue;
            guard();
            const commitRef = await h.input('Explicit native commit reference · resolved once', 'HEAD');
            if (commitRef === undefined)
                continue;
            guard();
            if (!commitRef.trim())
                throw Error('Enter an explicit native commit reference');
            await h.show('Review historical commit audit', localAuditReviewText({ projectId: h.projectId, candidateId: item.id, commitRef, gitBinary, scope: 'Compare immutable tree, message and parents with this exact retained receipt. MATCH does not establish current eligibility, test adequacy, independent review or repository approval. No native commit is amended or reset.' }));
            guard();
            const decision = await h.choose('Explicit commit audit', ['Back without audit', 'Audit selected commit']);
            guard();
            if (!decision || decision === 'Back without audit')
                continue;
            if (decision !== 'Audit selected commit')
                throw Error('Unknown audit action');
            const result = await h.track(c.auditLocalCommit({ projectId: h.projectId, candidateId: item.id, commitRef, gitBinary, signal: h.signal }, guard));
            guard();
            await h.show('Historical native commit correspondence · ' + result.status, localAuditText(result));
        }
    };
    return { check, browse };
}
