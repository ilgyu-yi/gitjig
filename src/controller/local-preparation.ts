import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { ApplicationLocalConventions } from '../app/local-conventions.js';
import { inspectLocalGit } from './local-git.js';
import { ControllerError } from './types.js';
const refuse = (message: string) => new ControllerError('LOCAL_PREPARATION_UNAVAILABLE', message, 'Inspect the explicit owner-owned UTF-8 message file and configured local conventions, then retry. Preparation performs no commit, review or test execution.');
export function messageSnapshot(file: string) {
    try {
        return readMessage(file);
    }
    catch (error) {
        if (error instanceof ControllerError)
            throw error;
        throw refuse('Commit message file is unavailable or unreadable; select an existing readable owned regular UTF-8 file');
    }
}
function readMessage(file: string) {
    if (!isAbsolute(file) || realpathSync(file) !== file)
        throw refuse('Message file requires a canonical absolute path without symlinks');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || !(stat.mode & 0o400) || (stat.mode & 0o022) || stat.size > 64 * 1024)
            throw refuse('Message requires a readable owned regular file of at most 64 KiB without shared writers');
        const buffer = Buffer.alloc(64 * 1024 + 1);
        let count = 0, n = 0;
        while (count < buffer.length && (n = readSync(fd, buffer, count, buffer.length - count, null)) > 0)
            count += n;
        if (count > 64 * 1024)
            throw refuse('Message exceeds 64 KiB');
        const bytes = buffer.subarray(0, count);
        let text: string;
        try {
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        }
        catch {
            throw refuse('Message file requires valid UTF-8');
        }
        return { bytes, text, digest: createHash('sha256').update(bytes).digest('hex') };
    }
    finally {
        closeSync(fd);
    }
}
export async function prepareLocalChange(input: {
    conventions: ApplicationLocalConventions;
    projectId: string;
    messageFile: string;
    gitBinary: string;
    projectRoots: readonly string[];
    installationHome: string;
    signal: AbortSignal;
}) {
    const edit = input.conventions.prepare(input.projectId), rules = edit.view.rules;
    if (!rules)
        return { status: 'UNAVAILABLE', policy: edit.view, checks: [], nextAction: 'Configure explicit local conventions at revision 0; recommendations are not applied automatically.' };
    const message = messageSnapshot(input.messageFile), git = await inspectLocalGit({ project: edit.project, gitBinary: input.gitBinary, projectRoots: input.projectRoots, installationHome: input.installationHome, signal: input.signal });
    edit.assertCurrent();
    if (!message.bytes.equals(messageSnapshot(input.messageFile).bytes))
        throw refuse('Commit message changed during Git inspection; reopen preparation');
    const lines = message.text.replaceAll('\r\n', '\n').split('\n'), subject = lines[0] ?? '', body = lines.slice(2).some(line => line.trim().length > 0), detached = git.branch === '(detached)';
    const checks: {
        rule: string;
        status: 'PASS' | 'FAIL' | 'UNAVAILABLE';
        reason: string;
    }[] = [];
    const check = (rule: string, pass: boolean, reason: string) => checks.push({ rule, status: pass ? 'PASS' : 'FAIL', reason });
    check('branch-attached', !detached, 'Use a named branch; an unborn named branch is supported.');
    if (detached) {
        for (const rule of ['protected-branch', 'branch-prefix'])
            checks.push({ rule, status: 'UNAVAILABLE', reason: 'Detached HEAD has no branch name to assess.' });
    }
    else {
        check('protected-branch', !rules.protectedBranches.includes(git.branch), 'Protected names match exactly; create or select a permitted working branch.');
        check('branch-prefix', !rules.branchPrefixes.length || rules.branchPrefixes.some(prefix => git.branch.startsWith(prefix)), 'Allowed prefixes are literal; an empty list leaves prefixes unrestricted.');
    }
    check('unmerged-paths', !git.changes.some(c => c.kind === 'unmerged'), 'Resolve all conflicts before preparing a commit.');
    check('staged-change', git.changes.some(c => c.kind !== 'untracked' && c.kind !== 'unmerged' && c.index !== '.'), 'Stage an intended change; unstaged and untracked paths are not included by preparation.');
    check('message-format', !!subject.trim() && subject === subject.trim() && !/[\u0000-\u0009\u000b-\u001f\u007f\ufeff]/u.test(message.text.replaceAll('\r\n', '\n')) && (lines.length < 2 || lines[1] === ''), 'Use a nonempty trimmed subject, no controls/BOM, and a blank second line before a body. CRLF is accepted; comments are literal text.');
    check('subject-length', [...subject].length <= rules.subjectMaxLength, `Subject must contain at most ${rules.subjectMaxLength} Unicode code points.`);
    const typed = /^([a-z][a-z0-9-]{0,31})(?:\([^()\r\n]+\))?!?: \S.*$/u.exec(subject);
    check('commit-type', !rules.commitTypes.length || !!typed && rules.commitTypes.includes(typed[1]!), 'Configured types use type(scope)!: description or type: description; an empty list leaves types unrestricted.');
    check('message-body', !rules.requireBody || body, 'When required, body contains nonblank text after the blank separator.');
    return { status: checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL', policy: edit.view, message: { sha256: message.digest, subjectCodePoints: [...subject].length, hasBody: body },
        observation: { id: createHash('sha256').update(JSON.stringify(git)).digest('hex'), head: git.head, branch: git.branch, changes: git.changes, observedAt: git.observedAt, limitations: git.limitations }, checks,
        scope: 'Configured preparation rules only; not test evidence, independent review, commit approval or execution. Observation identity is not a content-addressed candidate.',
        nextAction: checks.every(c => c.status === 'PASS') ? 'Review the actual staged diff and run applicable local checks. Commit separately with trusted Git; recheck after changes.' : 'Address failed preparation rules and rerun; profile changes require explicit revision-bound configuration.' };
}
