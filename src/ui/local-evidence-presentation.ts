import type { Controller } from '../controller/controller.js';
import type { Candidate } from '../controller/local-candidate.js';
import { escapeJsonControls, quoteText } from './inspection-text.js';
type Evidence = Awaited<ReturnType<Controller['inspectLocalCheckEvidence']>>;
type Recording = Awaited<ReturnType<Controller['localCommitCandidate']>>;
type Audit = Awaited<ReturnType<Controller['auditLocalCommit']>>;
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
const field = (name: string, value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined) return name + ': not available';
    const text = typeof value === 'string' ? quoteText(value) : String(value);
    return name + ': ' + (bytes(text) <= 8192 ? text : '[whole value omitted: exceeds 8192 display bytes; inspect original details with the local CLI]');
};
const quoted = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const outcome = (value: unknown) => value === true ? 'matches' : value === false ? 'differs' : 'unavailable';
/** A single scroll view keeps Escape navigation unchanged. Oversized identities
 * and snapshots are omitted whole, never rendered as shortened plausible values. */
function observation(lines: string[], original: unknown, cli: string) {
    const shown: string[] = []; let used = 0, omitted = 0;
    for (const line of lines) {
        if (used + bytes(line) > 24576) { omitted++; continue; }
        shown.push(line); used += bytes(line) + 2;
    }
    if (omitted) shown.push(`${omitted} summary fields omitted by the display limit. Use ${cli} for the original observation.`);
    const details = escapeJsonControls(JSON.stringify(original, null, 2));
    shown.push('Original observation · details', bytes(details) <= 24576 ? details : `Original details omitted as a whole: exceeds 24576 display bytes. Use ${cli} for the complete retained observation. No shortened IDs or paths are substituted.`);
    return shown.join('\n\n');
}
const checkReferences = (check: Candidate['check']) => [field('Original check work', check.workId), field('Original run', check.runId), field('Original result', check.resultId), field('Original observation', check.observationId)];
export function localEvidenceText(view: Evidence) {
    return observation([
        view.status === 'CURRENT' ? 'CURRENT · Current full source and index files match the original successful check.' : view.status === 'STALE' ? 'STALE · Current source or index no longer matches the original successful check.' : 'UNAVAILABLE · Source correspondence status is not recognized.',
        field('Next', view.nextAction),
        field('Original command', view.command), field('Isolated cwd', view.cwd),
        'Full captured source: ' + outcome(view.sourceMatches),
        field('Regular index files compared', view.index.entries), field('Current branch', view.index.branch), field('Observed HEAD', view.index.head),
        ...view.index.mismatchedPaths.map(path => field('Index mismatch', path)),
        ...(view.index.remainingMismatches ? [field('Additional index mismatches not listed', view.index.remainingMismatches)] : []),
        ...(!view.sourceMatches && !view.index.mismatchedPaths.length ? ['No index mismatch is named, but the full source capture changed. Git metadata, ignored and untracked files are also captured context.'] : []),
        'This is correspondence, not check adequacy, review, commit approval or a reservation. Inspection is non-atomic; scratch and other command dependencies remain mutable or unknown.',
        field('Original check work', view.workId), field('Original run', view.runId), field('Original result', view.resultId), field('Original observation', view.observationId),
    ], view, 'local evidence --project PROJECT --work WORK_ID');
}
interface RecordingContext {
    projectId: string;
    workId: string;
    runId?: string;
    resultId?: string;
    gitBinary: string;
    messageFile: string;
    scope: string;
}
export function localCandidateReviewText(view: RecordingContext) {
    return observation([
        'Record a historical candidate receipt · no native commit',
        field('Project', view.projectId), field('Original check work', view.workId), field('Original run', view.runId), field('Original result', view.resultId),
        field('Trusted Git executable', view.gitBinary), field('Exact owned message file', view.messageFile),
        'The message must use LF with a final LF. Its exact digest is retained; its private body and original file path are not stored in the receipt.',
        view.scope,
        'Next: explicitly record, then review the staged diff and make a separate native Git commit with this exact message. Hooks and signing remain native Git responsibilities.',
    ], view, 'local candidate --project PROJECT --work WORK_ID --message-file MESSAGE_FILE');
}
export function localCandidateText(candidate: Candidate, context?: {gitBinary: string; messageFile: string; receipt: Recording}) {
    const lines = [
        'RECORDED · Historical candidate receipt. No commit was made by recording it.',
        context ? 'Next: review the actual staged diff, commit separately with trusted native Git and its existing hooks/signing, then audit this candidate against the exact resulting commit ID.' : 'Next: if you already made the commit, choose Audit native commit for a fresh comparison. Otherwise review the staged diff and commit separately with native Git and its existing hooks/signing.',
        field('Candidate', candidate.id), field('Project', candidate.projectId), field('Source folder', candidate.source.path), field('Recorded at', candidate.createdAt),
        field('Intended branch (preparation context)', candidate.index.intendedBranch),
        candidate.index.parent === null ? 'Expected parent: none · initial commit' : field('Expected parent', candidate.index.parent),
        field('Whole-tree regular entries', candidate.index.roster.entries), field('Whole-tree directories', candidate.index.roster.directories), field('Whole-tree roster digest', candidate.index.roster.sha256),
        field('Exact message SHA-256', candidate.messageSha256), field('Convention revision at recording', candidate.policy.revision),
        ...checkReferences(candidate.check),
        'This receipt is not a lock, current eligibility, test-adequacy judgment, independent review or repository approval. Captured ignored/untracked/context inputs are not all part of the commit.',
    ];
    if (context) {
        lines.push(field('Selected trusted Git', context.gitBinary), field('Selected exact message file', context.messageFile));
        const command = [quoted(context.gitBinary), '-C', quoted(candidate.source.path), 'commit --cleanup=verbatim -F', quoted(context.messageFile)].join(' ');
        lines.push(bytes(command) <= 8192 && !/[\u0000-\u001f\u007f-\u009f]/u.test(command)
            ? 'Separate native command · review before running:\n' + command
            : 'Native command omitted as a whole because its paths contain display controls or exceed the display limit. Use the exact original Git, project and message-file paths.');
    } else {
        lines.push('The original message path and private body are not retained. Supply an owned message file with this exact digest, LF and final LF; commit with native Git using --cleanup=verbatim -F MESSAGE_FILE.');
    }
    lines.push('This view does not synchronize files, run checks or create a commit.');
    return observation(lines, context?.receipt ?? candidate, 'local candidates --project PROJECT and local audit --project PROJECT --candidate CANDIDATE --commit COMMIT');
}
interface AuditContext {projectId: string; candidateId: string; commitRef: string; gitBinary: string; scope: string}
export function localAuditReviewText(view: AuditContext) {
    return observation([
        'Compare a native commit with one historical candidate receipt',
        field('Project', view.projectId), field('Candidate', view.candidateId), field('Explicit commit reference (resolved once by audit)', view.commitRef), field('Trusted Git executable', view.gitBinary), view.scope,
        'Next: explicitly audit. No commit is created, amended, reset or published.',
    ], view, 'local audit --project PROJECT --candidate CANDIDATE --commit COMMIT');
}
export function localAuditText(view: Audit) {
    const policy = view.current.policy && typeof view.current.policy === 'object' ? view.current.policy as Record<string, unknown> : {};
    return observation([
        view.status === 'MATCH' ? 'MATCH · Native commit matches this historical candidate receipt.' : view.status === 'MISMATCH' ? 'MISMATCH · Native commit differs from this historical candidate receipt. The commit remains intact.' : 'UNAVAILABLE · Historical commit correspondence status is not recognized.',
        field('Next', view.nextAction),
        'This audit is a read-only observation, not a saved audit receipt. The candidate stays retained; choose Audit native commit again after reopening for a fresh comparison.',
        field('Observed immutable commit', view.actual.oid), field('Candidate', view.candidateId),
        'Object format: ' + outcome(view.checks.objectFormat), 'Whole tree: ' + outcome(view.checks.wholeTree), 'Exact message: ' + outcome(view.checks.message), 'Normal parent or initial root: ' + outcome(view.checks.parents),
        view.expected.index.parent === null ? 'Expected parent: none · initial commit' : field('Expected parent', view.expected.index.parent),
        ...(view.actual.parents.length ? view.actual.parents.map(parent => field('Actual parent', parent)) : ['Actual parents: none · initial commit']),
        field('Actual Git tree', view.actual.tree), field('Expected whole-tree roster digest', view.expected.index.roster.sha256), field('Actual whole-tree roster digest', view.actual.roster.sha256),
        field('Expected message SHA-256', view.expected.messageSha256), field('Actual message SHA-256', view.actual.messageSha256),
        field('Original checked command', view.originalCheck.command), field('Original isolated cwd', view.originalCheck.cwd), ...checkReferences(view.expected.check),
        'Later context · shown separately; it does not replace the historical receipt or make its check current.',
        field('Current branch', view.current.branch), field('Current HEAD', view.current.head), field('Current original work state', view.current.work.state), field('Current original work epoch', view.current.work.epoch),
        field('Current result run', view.current.work.currentResultRunId), field('Current work has unsettled input or producers', view.current.work.pending),
        field('Current convention state', typeof policy.state === 'string' ? policy.state : undefined), field('Current convention revision', typeof policy.revision === 'number' ? policy.revision : undefined),
        'Current conventions versus receipt: ' + outcome(policy.matchesOriginal),
        'Historical correspondence only: no current eligibility, test adequacy, independent review, account standing or repository approval. The intended branch is context; a commit cannot prove its original branch. The committed tree alone may not reproduce ignored/untracked/context dependencies. Native author and committer text are unverified metadata.',
    ], view, 'local audit --project PROJECT --candidate CANDIDATE --commit COMMIT');
}
export function localUnavailableCandidateText(candidateId: string) {
    return observation([field('Unavailable candidate', candidateId), 'Missing or unreadable receipts cannot establish acceptance. Inspect the original owned storage; do not edit a receipt to manufacture acceptance. No commit or check was started.'], {candidateId, status:'UNAVAILABLE'}, 'local candidates --project PROJECT');
}
