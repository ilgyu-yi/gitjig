import fs from 'node:fs/promises';
import path from 'node:path';
import { readLocalGitProcess } from './local-git-process.js';
import { ControllerError, type Project } from './types.js';
import { inside } from './ownership.js';
import { createHash } from 'node:crypto';
export interface LocalGitIndex {
    objectFormat: 'sha1' | 'sha256';
    entries: {
        mode: string;
        oid: string;
        stage: number;
        path: string;
    }[];
    fingerprint: string;
    intentToAdd: boolean;
}
export interface LocalGitEntry {
    mode: string;
    oid: string;
    path: string;
}
/** Complete semantic tree roster, including directories (and therefore empty directories). */
export function localRoster(entries: readonly LocalGitEntry[], index = false) {
    const rows = entries.map(e => ({ path: e.path, mode: e.mode, oid: e.mode === '040000' ? '' : e.oid }));
    if (index) {
        const directories = new Set<string>();
        for (const e of entries) {
            const parts = e.path.split('/');
            for (let n = 1; n < parts.length; n++)
                directories.add(parts.slice(0, n).join('/'));
        }
        for (const name of directories)
            rows.push({ path: name, mode: '040000', oid: '' });
    }
    rows.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    if (rows.some((e, n) => !e.path || e.path.split('/').some(p => !p || p === '.' || p === '..') || n > 0 && e.path === rows[n - 1]!.path))
        throw refuse('Invalid or duplicate Git tree paths');
    return { sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), entries: rows.filter(e => e.mode !== '040000').length, directories: rows.filter(e => e.mode === '040000').length };
}
export interface LocalGitCommit {
    oid: string;
    tree: string;
    parents: string[];
    messageSha256: string;
    author: string;
    committer: string;
    objectFormat: 'sha1' | 'sha256';
    roster: ReturnType<typeof localRoster>;
}
const decode = (value: Buffer) => {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(value);
    }
    catch {
        throw refuse('Non-UTF-8 Git output cannot be represented losslessly by this entry', 'Use trusted Git directly to inspect the original path bytes; local git will not substitute replacement characters.');
    }
};
const refuse = (message: string, recovery = 'Inspect the registered repository with trusted Git; repair the reported prerequisite and retry local git.') => new ControllerError('LOCAL_GIT_UNAVAILABLE', message, recovery);
function records(value: Buffer) {
    const text = decode(value);
    if (text && !text.endsWith('\0'))
        throw refuse('Incomplete Git output');
    return text ? text.slice(0, -1).split('\0') : [];
}
function status(value: Buffer) {
    const entries = records(value), headers: Record<string, string> = {}, changes: {
        kind: string;
        index: string;
        worktree: string;
        path: string;
        originalPath?: string;
    }[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        if (entry.startsWith('# ')) {
            const split = entry.indexOf(' ', 2);
            if (split > 2)
                headers[entry.slice(2, split)] = entry.slice(split + 1);
            continue;
        }
        if (entry.startsWith('? ')) {
            changes.push({ kind: 'untracked', index: '?', worktree: '?', path: entry.slice(2) });
            continue;
        }
        const type = entry[0], count = type === '1' ? 8 : type === '2' ? 9 : type === 'u' ? 10 : 0;
        if (!count)
            throw refuse('Unsupported Git status record');
        let offset = 0;
        for (let n = 0; n < count; n++) {
            offset = entry.indexOf(' ', offset) + 1;
            if (!offset)
                throw refuse('Incomplete Git status record');
        }
        const xy = entry.split(' ', 2)[1];
        if (!xy || xy.length !== 2 || !entry.slice(offset))
            throw refuse('Invalid Git status record');
        const row = { kind: type === 'u' ? 'unmerged' : type === '2' ? 'renamed-or-copied' : 'tracked', index: xy[0]!, worktree: xy[1]!, path: entry.slice(offset) };
        if (type === '2') {
            const originalPath = entries[++i];
            if (!originalPath)
                throw refuse('Missing original rename path');
            changes.push({ ...row, originalPath });
        }
        else
            changes.push(row);
    }
    if (!headers['branch.oid'] || !headers['branch.head'])
        throw refuse('Git branch identity unavailable');
    return { head: headers['branch.oid']!, branch: headers['branch.head']!, upstream: headers['branch.upstream'] ?? null, changes };
}
/** Trusted native Git observation, not a sandbox. Repository configuration must remain stable. */
export async function inspectLocalGit(input: {
    project: Project;
    gitBinary: string;
    projectRoots: readonly string[];
    installationHome: string;
    signal: AbortSignal;
    includeIndex?: boolean;
    commitRef?: string;
}) {
    const root = input.project.sourceRoot, binary = await fs.realpath(input.gitBinary), binaryStat = await fs.stat(binary);
    if (!path.isAbsolute(input.gitBinary) || !binaryStat.isFile() || (binaryStat.mode & 0o111) === 0 || inside(input.installationHome, binary) || input.projectRoots.some(p => inside(p, binary)))
        throw refuse('Select a trusted executable outside application storage and registered projects');
    const rootStat = await fs.stat(root);
    const assertRoot = async () => {
        const now = await fs.stat(root);
        if (await fs.realpath(root) !== root || !now.isDirectory() || now.dev !== rootStat.dev || now.ino !== rootStat.ino)
            throw refuse('Registered source changed during Git inspection');
    };
    await assertRoot();
    const env: NodeJS.ProcessEnv = { PATH: path.dirname(binary) + ':/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' };
    const fixed = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'submodule.recurse=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'log.showSignature=false', '-c', 'core.quotePath=false'];
    const run = async (args: string[]) => {
        await assertRoot();
        try {
            const output = await readLocalGitProcess(binary, [...fixed, ...args], { cwd: root, env, signal: input.signal });
            await assertRoot();
            return output;
        }
        catch (error) {
            if (error instanceof ControllerError)
                throw error;
            throw refuse('Git inspection failed, was cancelled, exceeded its 5-second command limit or exceeded 1 MiB of output. No complete observation is available.', 'Inspect the trusted executable and repository configuration, including possible helper effects. Failure does not prove that no helper ran. Stop configuration-changing tools and retry only with stable trusted configuration.');
        }
    };
    // Read effective includes before content comparison. Values may be private; never echo them.
    const configuration = await run(['config', '--includes', '--null', '--list']);
    for (const record of records(configuration)) {
        const split = record.indexOf('\n'), key = (split < 0 ? record : record.slice(0, split)).toLowerCase(), value = split < 0 ? '' : record.slice(split + 1);
        if (/^filter\..*\.(?:clean|process)$/.test(key) && value.trim())
            throw refuse('Repository clean/process filters require helper execution; this read-only entry does not support them.', 'Use trusted Git directly for this repository; local git does not execute its configured content filters.');
        if (key === 'extensions.partialclone' || /^remote\..*\.promisor$/.test(key))
            throw refuse('Partial-clone/promisor repositories are unavailable for offline inspection.', 'Use trusted Git to obtain a complete local repository before retrying; gitjig will not fetch objects.');
    }
    const top = decode(await run(['rev-parse', '--show-toplevel'])).replace(/\n$/u, '');
    if (top !== root)
        throw refuse('Registered project must be the exact Git worktree root', 'Register the canonical Git worktree root explicitly; nested directories and bare repositories are not supported by local git.');
    const readIndex = async (): Promise<LocalGitIndex> => {
        const objectFormat = decode(await run(['rev-parse', '--show-object-format'])).trim();
        if (objectFormat !== 'sha1' && objectFormat !== 'sha256')
            throw refuse('Unsupported Git object format');
        const raw = await run(['ls-files', '--stage', '-z']), entries = records(raw).map(record => {
            const match = /^([0-7]{6}) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/u.exec(record);
            if (!match || match[2]!.length !== (objectFormat === 'sha1' ? 40 : 64))
                throw refuse('Invalid Git index record');
            return { mode: match[1]!, oid: match[2]!, stage: Number(match[3]), path: match[4]! };
        });
        // These two native interpretations distinguish intent-to-add, including empty files and hidden flags.
        const base = ['diff', '--cached', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--no-renames'];
        const visible = await run([...base, '--ita-visible-in-index']), invisible = await run([...base, '--ita-invisible-in-index']);
        const intentToAdd = !visible.equals(invisible), fingerprint = createHash('sha256').update(objectFormat).update(raw).update(visible).update(invisible).digest('hex');
        return { objectFormat, entries, fingerprint, intentToAdd };
    };
    let commit: LocalGitCommit | undefined;
    if (input.commitRef !== undefined) {
        const ref = input.commitRef;
        if (!ref || ref.length > 1024 || /[\u0000-\u001f\u007f]/u.test(ref))
            throw refuse('Select one bounded commit reference without control characters');
        const objectFormat = decode(await run(['rev-parse', '--show-object-format'])).trim();
        if (objectFormat !== 'sha1' && objectFormat !== 'sha256')
            throw refuse('Unsupported Git object format');
        const validOid = (oid: string) => new RegExp('^[a-f0-9]{' + (objectFormat === 'sha1' ? 40 : 64) + '}$', 'u').test(oid);
        // Resolve exactly once. All subsequent reads name immutable object IDs, never the original ref.
        const oid = decode(await run(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'])).trim();
        if (!validOid(oid))
            throw refuse('Invalid resolved commit identity');
        const raw = await run(['cat-file', 'commit', oid]), separator = raw.indexOf(Buffer.from('\n\n'));
        if (separator < 0 || createHash(objectFormat).update(`commit ${raw.length}\0`).update(raw).digest('hex') !== oid)
            throw refuse('Raw commit object identity is invalid');
        const headers = decode(raw.subarray(0, separator)).split('\n').filter(line => !line.startsWith(' '));
        const field = (key: string) => headers.filter(line => line.startsWith(key + ' ')).map(line => line.slice(key.length + 1));
        const trees = field('tree'), authors = field('author'), committers = field('committer'), parents = field('parent');
        if (trees.length !== 1 || !validOid(trees[0]!) || authors.length !== 1 || committers.length !== 1 || parents.some(p => !validOid(p)))
            throw refuse('Raw commit headers are incomplete or ambiguous');
        const tree = trees[0]!, entries = records(await run(['ls-tree', '-r', '-t', '-z', '--full-tree', tree])).map(record => {
            const match = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]+)\t([\s\S]+)$/u.exec(record);
            if (!match || !validOid(match[3]!) || !({ '040000': 'tree', '100644': 'blob', '100755': 'blob', '120000': 'blob', '160000': 'commit' } as Record<string, string>)[match[1]!] || ({ '040000': 'tree', '100644': 'blob', '100755': 'blob', '120000': 'blob', '160000': 'commit' } as Record<string, string>)[match[1]!] !== match[2])
                throw refuse('Invalid commit tree record');
            return { mode: match[1]!, oid: match[3]!, path: match[4]! };
        });
        commit = { oid, tree, parents, messageSha256: createHash('sha256').update(raw.subarray(separator + 2)).digest('hex'), author: authors[0]!, committer: committers[0]!, objectFormat, roster: localRoster(entries) };
    }
    const index = input.includeIndex ? await readIndex() : null;
    const before = status(await run(['status', '--porcelain=v2', '-z', '--branch', '--no-ahead-behind', '--untracked-files=all', '--ignore-submodules=all', '--renames']));
    const commits: {
        commit: string;
        author: string;
        authoredAt: string;
        subject: string;
    }[] = [];
    if (before.head !== '(initial)') {
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(before.head))
            throw refuse('Invalid Git HEAD identity');
        const fields = records(await run(['log', '-10', '--no-show-signature', '--no-notes', '--no-decorate', '--format=%H%x00%an%x00%aI%x00%s', '-z', before.head, '--']));
        if (fields.length % 4)
            throw refuse('Incomplete Git commit output');
        for (let i = 0; i < fields.length; i += 4)
            commits.push({ commit: fields[i]!, author: fields[i + 1]!, authoredAt: fields[i + 2]!, subject: fields[i + 3]! });
    }
    const after = status(await run(['status', '--porcelain=v2', '-z', '--branch', '--no-ahead-behind', '--untracked-files=all', '--ignore-submodules=all', '--renames']));
    if (!configuration.equals(await run(['config', '--includes', '--null', '--list'])) || JSON.stringify(before) !== JSON.stringify(after))
        throw refuse('Repository configuration or observed status changed during inspection; no valid observation is available', 'Stop configuration-changing tools and inspect any configured helpers and their possible effects. This drift refusal does not prove that no helper ran. Retry only with stable trusted configuration.');
    if (index && index.fingerprint !== (await readIndex()).fingerprint)
        throw refuse('Git index changed during inspection; retry with stable source and index');
    return { projectId: input.project.id, sourceRoot: root, gitBinary: binary, observedAt: new Date().toISOString(), ...before, commits,
        ...(index ? { index } : {}), ...(commit ? { commit } : {}),
        observation: 'Read-oriented, non-atomic local observation; not verification, review or commit approval',
        limitations: ['Native Git is not an execution sandbox. Keep repository configuration stable and stop configuration-changing tools during inspection; preflight cannot prevent a concurrently added helper from running.', 'A drift refusal does not prove that no helper or external action occurred.', 'Submodule contents and ignored files are not inspected.', 'Upstream information is local; no remote refresh command is issued.', 'Non-UTF-8 Git output is refused rather than decoded lossily.', 'Concurrent edits can occur after observation; no action may treat this view as a locked candidate.'],
        nextAction: 'Review staged and unstaged changes with trusted Git; run applicable local checks before committing. Commit conventions and commit/push controls remain separate.' };
}
