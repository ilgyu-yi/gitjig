import {validateManifest} from './capture.js';
import {delta, effective, hash} from './change-files.js';
import type {ChangeResultView} from './change-types.js';
import {providerUsageLimit} from '../workflow/provider-failure.js';

/** Recorded process/report facts are independent of coverage, verdict and repair eligibility.
 * Never infer a process start from cancellation, or a failure's cause from stderr.
 */
export function recordedCheckProduction(data: unknown): NonNullable<ChangeResultView['checks']['entries'][number]['production']> {
    const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
    const actual = object(data) && object(data.actual) ? data.actual : undefined;
    const termination = actual?.termination;
    const knownTermination = termination === 'timeout' || termination === 'aborted' || termination === 'output-limit';
    const knownExit = actual && Number.isSafeInteger(actual.exitCode);
    const parsed = object(data) && object(data.parsed) ? data.parsed : undefined;
    const issues = parsed?.issues;
    const report = Array.isArray(issues) && issues.every(issue => typeof issue === 'string')
        ? issues.length && parsed?.value === null ? 'rejected' : !issues.length && object(parsed?.value) ? 'accepted' : 'unknown'
        : 'unknown';
    return {exitCode: knownExit ? actual.exitCode as number : null,
        termination: knownTermination ? termination : null, report};
}

/** One interpretation for recorded check outcomes in owner and agent views. */
export function recordedCheckStatus(check: ChangeResultView['checks']['entries'][number]) {
    const baseline = check.target === 'base' && check.purpose === 'baseline';
    return check.status === 'baseline-observed'
        ? baseline && check.observed ? 'baseline-observed' : 'unavailable'
        : check.status === 'pass' && (baseline || !check.passed) ? 'unavailable' : check.status;
}

/** Primary facts from the existing reading model, without another ledger interpretation.
 * Full reading stays in immutable detail. Never shorten an identifier or path.
 */
export function recordedResultSummary(result: ChangeResultView) {
    const roster = <T, A extends string>(value: {availability: A; entries: T[]; total: number | null; omitted: number}) =>
        ({availability: value.availability, entries: value.entries.slice(0, 4).map(entry => ({...entry})),
            total: value.total, omitted: value.omitted + Math.max(0, value.entries.length - 4)});
    const quota = result.recordedPhase === 'BLOCKED' && result.state !== 'UNKNOWN' && !result.reviewReady
        ? providerUsageLimit(result.providerFailure?.usageLimit ?? result.planningFailure?.providerFailure) : undefined;
    const summary = {
        workId: result.workId, projectId: result.projectId, state: result.state,
        recordedPhase: result.recordedPhase, reviewReady: result.reviewReady,
        verificationEvidenceAvailability: result.verificationEvidence?.availability ?? 'unknown',
        ...(result.roleRequestLimit ? {roleRequestLimit: structuredClone(result.roleRequestLimit)} : {}),
        ...(quota ? {providerUsageLimitReset: quota.resetsAt ?? null} : {}),
        blocked: [...result.blocked], blockedOmitted: result.blockedOmitted,
        ...(result.pendingFindings ? {pendingFindings: result.pendingFindings} : {}),
        ...(result.planningClarification ? {planningClarification: {outputId: result.planningClarification.outputId,
            questionCount: result.planningClarification.questions.total}} : {}),
        nextAction: result.nextAction as string | null, nextActionOmitted: false,
        ...(result.heldDirections ? {heldDirections: structuredClone(result.heldDirections)} : {}),
        inspection: {command: '/work ' + result.workId, readOnly: true},
        candidate: result.candidate ? {...result.candidate, path: result.candidate.path as string | null} : null,
        candidateLocationOmitted: false,
        changes: roster(result.changes),
        checks: roster({...result.checks, entries: result.checks.entries.map(check => ({...check, status: recordedCheckStatus(check)}))}),
        reviews: roster(result.reviews),
        limitations: [
            'Recorded isolated candidate and attributed evidence; inspection applies no source files or delivery actions.',
            'Candidate location is recorded metadata, not verified existence or comparison with the original project.',
        ],
    };
    const oversized = () => Buffer.byteLength(JSON.stringify(summary)) > 4096;
    // A long location must not consume the budget for outcomes and navigation.
    if (summary.candidate && Buffer.byteLength(summary.candidate.path!) > 1024) {
        summary.candidate.path = null; summary.candidateLocationOmitted = true;
    }
    if (Buffer.byteLength(summary.nextAction!) > 512) {summary.nextAction = null; summary.nextActionOmitted = true;}
    if (oversized()) for (const check of summary.checks.entries) delete check.outputIssueIds;
    for (const section of [summary.changes, summary.checks, summary.reviews, summary.heldDirections])
        while (section?.entries.length && oversized()) {section.entries.pop(); section.omitted++;}
    if (oversized() && summary.candidate) {summary.candidate.path = null; summary.candidateLocationOmitted = true;}
    while (oversized() && summary.blocked.length) {summary.blocked.pop(); summary.blockedOmitted++;}
    if (oversized()) {summary.nextAction = null; summary.nextActionOmitted = true;}
    if (oversized()) throw Error('Recorded result identity envelope unavailable');
    return summary;
}

/** Keep full entry identities. An over-limit item is omitted, never shortened into another path/ID. */
export function resultEntries<T>(entries: readonly T[], maximumEntries = 100, maximumBytes = 64 * 1024) {
    const visible: T[] = [];
    let bytes = 0;
    for (const entry of entries) {
        const size = Buffer.byteLength(JSON.stringify(entry));
        if (visible.length >= maximumEntries || bytes + size > maximumBytes) break;
        bytes += size;
        visible.push(entry);
    }
    return {entries: visible, total: entries.length, omitted: entries.length - visible.length};
}

/** The comparison comes from retained worker manifests, not a later original project or artifact read. */
export function recordedResultChanges(base: {hash: string; data: Record<string, any>}, candidate: {hash: string; data: Record<string, any>}): ChangeResultView['changes'] {
    const before = validateManifest(base.data.manifest), after = validateManifest(candidate.data.manifest);
    if (hash(effective(before)) !== base.hash || hash(effective(after)) !== candidate.hash)
        throw Error('Selected snapshot manifest identity differs from its recorded version');
    const difference = delta(before, after);
    if (hash(difference) !== hash(candidate.data.delta))
        throw Error('Recorded candidate delta differs from its selected base and candidate manifests');
    const entries: ChangeResultView['changes']['entries'] = difference.files.map(file => ({
        path: file.path,
        kind: file.before === null ? 'added' : file.after === null ? 'removed' : file.before === file.after ? 'mode-changed' : 'modified',
    }));
    for (const link of difference.dependencyLinks ?? [])
        entries.push({path: link.path, kind: link.before === null ? 'link-added' : link.after === null ? 'link-removed' : 'link-modified'});
    const oldDirectories = new Set(difference.directories.before), newDirectories = new Set(difference.directories.after);
    for (const directory of oldDirectories) if (!newDirectories.has(directory)) entries.push({path: directory, kind: 'directory-removed'});
    for (const directory of newDirectories) if (!oldDirectories.has(directory)) entries.push({path: directory, kind: 'directory-added'});
    return {availability: 'recorded', ...resultEntries(entries)};
}

type ResultVersionRecord = { id: string; hash: string; data: string };
const resultComparisonRetentionLimit = 2_000_000; // Combined UTF-16 code units of the retained keys.

/** One bounded projection of freshly selected rows, with candidateData decoded from candidate.data. */
export function createResultChangesReader() {
    const key = ({ id, hash, data }: ResultVersionRecord) => ({ id, hash, data });
    const same = (left: ResultVersionRecord, right: ResultVersionRecord) =>
        left.id === right.id && left.hash === right.hash && left.data === right.data;
    let retained: { base: ResultVersionRecord; candidate: ResultVersionRecord; value: ChangeResultView['changes'] } | undefined;
    return (base: ResultVersionRecord, candidate: ResultVersionRecord, candidateData: Record<string, any>) => {
        if (retained && same(retained.base, base) && same(retained.candidate, candidate))
            return structuredClone(retained.value);
        retained = undefined;
        const value = recordedResultChanges({ hash: base.hash, data: JSON.parse(base.data) }, { hash: candidate.hash, data: candidateData });
        if (base.id.length + base.hash.length + base.data.length +
            candidate.id.length + candidate.hash.length + candidate.data.length > resultComparisonRetentionLimit)
            return value;
        retained = { base: key(base), candidate: key(candidate), value };
        return structuredClone(value);
    };
}
