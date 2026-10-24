import type { ApplicationLocalConventions } from '../app/local-conventions.js';
import type { inspectLocalGit } from '../controller/local-git.js';
import type { prepareLocalChange } from '../controller/local-preparation.js';

import { appendObservation, quoteIdentity, summarizeRows } from './inspection-text.js';

type GitObservation = Awaited<ReturnType<typeof inspectLocalGit>>;
const changeName = (status: string) => ({ M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', U: 'unmerged' })[status] ?? status;
function changes(rows: GitObservation['changes']): string {
    if (!rows.length) return 'No staged, unstaged, untracked or conflicting paths observed.';
    return summarizeRows(rows.map(row => {
        const states = row.kind === 'untracked' ? ['Untracked'] : row.kind === 'unmerged' ? ['Conflict'] : [
            ...(row.index !== '.' ? ['Staged ' + changeName(row.index)] : []),
            ...(row.worktree !== '.' ? ['Unstaged ' + changeName(row.worktree)] : []),
        ];
        return `${states.join(' · ')}: ${quoteIdentity(row.path)}${row.originalPath === undefined ? '' : ' ← ' + quoteIdentity(row.originalPath)}`;
    }));
}

export function localGitSummary(value: GitObservation): string {
    const branch = value.branch === '(detached)' ? 'Detached HEAD · select a named branch before preparation' : quoteIdentity(value.branch);
    return appendObservation([
        'Local Git changes',
        'Project: ' + quoteIdentity(value.projectId),
        'Branch: ' + branch + (value.head === '(initial)' ? ' · no commits yet' : ''),
        'Upstream: ' + (value.upstream === null ? 'none recorded' : quoteIdentity(value.upstream) + ' · local information only'),
        '', changes(value.changes), '',
        value.changes.length ? 'Next: review the actual diff with trusted Git; stage the intended files, prepare the message, then run applicable local checks.' : 'Next: no staged, unstaged, untracked or conflicting paths need preparation in this observation. Inspect again after your next edit.',
        'This observation does not run tests, change files or approve a commit. Ignored files and submodule contents are outside this view. Keep repository configuration stable during native reads.',
        '', 'Recent commits · author identity is unverified',
        value.commits.length ? summarizeRows(value.commits.map(commit => `${commit.commit} · ${quoteIdentity(commit.subject, 1024)} · ${quoteIdentity(commit.author, 512)}`), 4000) : 'No commits recorded.',
        '', 'Source: ' + quoteIdentity(value.sourceRoot),
        'Observed: ' + value.observedAt,
    ].join('\n'), value);
}

export function localConventionsSummary(value: ReturnType<ApplicationLocalConventions['inspect']>): string {
    const rules = value.rules;
    return appendObservation([
        rules ? 'Local conventions are saved · revision ' + value.revision : 'Local conventions are not configured (NOT_CONFIGURED).',
        'Project: ' + quoteIdentity(value.projectId), '',
        ...(rules ? [
            'Protected branch names: ' + (rules.protectedBranches.length ? summarizeRows(rules.protectedBranches.map(name => quoteIdentity(name)), 4000) : 'none'),
            'Allowed branch prefixes: ' + (rules.branchPrefixes.length ? summarizeRows(rules.branchPrefixes.map(name => quoteIdentity(name)), 4000) : 'any'),
            'Allowed commit types: ' + (rules.commitTypes.length ? summarizeRows(rules.commitTypes.map(name => quoteIdentity(name)), 4000) : 'any'),
            'Maximum subject length: ' + rules.subjectMaxLength + ' characters',
            'Message body required: ' + (rules.requireBody ? 'yes' : 'no'), '',
            'Next: stage the intended change with trusted Git, save your exact message file, then choose Prepare staged change.',
        ] : ['Next: choose Edit local conventions, review the recommended values, then explicitly Save staged conventions.']),
        'These are developer-local preferences. Hosting rules and agent procedures remain separate; recommendations are never saved by inspection.',
    ].join('\n'), value);
}

const ruleNames: Record<string, string> = {
    'branch-attached': 'Named branch', 'protected-branch': 'Protected branch', 'branch-prefix': 'Branch prefix',
    'unmerged-paths': 'Conflicts', 'staged-change': 'Staged change', 'message-format': 'Message format',
    'subject-length': 'Subject length', 'commit-type': 'Commit type', 'message-body': 'Message body',
};
export function localPreparationSummary(value: Awaited<ReturnType<typeof prepareLocalChange>>): string {
    return appendObservation([
        value.status === 'PASS' ? 'Preparation passed (PASS) · configured rules only.' : value.status === 'FAIL' ? 'Preparation needs changes (FAIL).' : 'Preparation is unavailable (UNAVAILABLE).',
        'Project: ' + quoteIdentity(value.policy.projectId) + ' · conventions revision ' + value.policy.revision, '',
        ...('observation' in value && value.observation ? ['Branch: ' + quoteIdentity(value.observation.branch), changes(value.observation.changes), ''] : []),
        ...value.checks.map(check => `${check.status === 'PASS' ? 'Passed' : check.status === 'FAIL' ? 'Failed' : 'Unavailable'} · ${ruleNames[check.rule] ?? check.rule}${check.status === 'PASS' ? '' : ': ' + check.reason}`), '',
        'Next: ' + value.nextAction,
        'No check, hook or commit ran. This is not test evidence, review or commit approval. Your private message body is not displayed.',
    ].join('\n'), value);
}
