import path from 'node:path';
import fs, { constants, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import type { SourceGitEnvironment, SourcePolicyFile, SourceBranchTarget } from './types.js';

/** Default selected operator configuration only. Unsupported redirections are never silently removed. */
export function captureSourceGitEnvironment(source: Readonly<NodeJS.ProcessEnv>): Readonly<SourceGitEnvironment> {
    const redirects = ['GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM',
        'GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_NAMESPACE', 'GIT_SHALLOW_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_EXEC_PATH', 'GIT_PROTOCOL_FROM_USER'];
    if (redirects.some(key => Object.hasOwn(source, key))) throw Error('Source Git configuration/environment redirection is outside this profile');
    if (!source.HOME || !path.isAbsolute(source.HOME) || /[\x00-\x1f\x7f]/u.test(source.HOME)) throw Error('Original operator HOME is required');
    if (Object.hasOwn(source, 'XDG_CONFIG_HOME') && (!source.XDG_CONFIG_HOME || !path.isAbsolute(source.XDG_CONFIG_HOME) || /[\x00-\x1f\x7f]/u.test(source.XDG_CONFIG_HOME)))
        throw Error('Original operator XDG configuration route is unsupported');
    return Object.freeze({ home: source.HOME, ...(Object.hasOwn(source, 'XDG_CONFIG_HOME') ? { xdgConfigHome: source.XDG_CONFIG_HOME! } : {}) });
}

export interface SourceConfigFacts {
    kind: 'source-git-policy-config/v1';
    state: 'observed' | 'unavailable';
    rawSha256: string;
    rawBytes: number;
    origins: string[];
    denyCurrentBranch: string | null;
    unsupported: string[];
}
/** Called inside the existing supervisor BEFORE durable output is written. Raw configuration never enters a journal. */
export function sourceConfigFacts(raw: Buffer, targetPath: string): SourceConfigFacts {
    const facts: SourceConfigFacts = { kind: 'source-git-policy-config/v1', state: 'unavailable',
        rawSha256: createHash('sha256').update(raw).digest('hex'), rawBytes: raw.length, origins: [], denyCurrentBranch: null, unsupported: [] };
    try {
        const value = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        if (value && !value.endsWith('\0')) return facts;
        const fields = value ? value.slice(0, -1).split('\0') : [];
        if (fields.length % 3) return facts;
        const unsupported = new Set<string>(), origins = new Set<string>();
        for (let index = 0; index < fields.length; index += 3) {
            const scope = fields[index]!, origin = fields[index + 1]!, record = fields[index + 2]!;
            if (!['system', 'global', 'local', 'worktree', 'command'].includes(scope)) return facts;
            if (origin.startsWith('file:')) origins.add(origin.slice(5));
            else if (scope !== 'command' || origin !== 'command line:') unsupported.add('non-file-configuration');
            const separator = record.indexOf('\n'), key = (separator < 0 ? record : record.slice(0, separator)).toLowerCase();
            const selected = separator < 0 ? '' : record.slice(separator + 1);
            if (key === 'receive.denycurrentbranch') facts.denyCurrentBranch = ['true', 'refuse', 'false', 'warn', 'ignore', 'updateinstead'].includes(selected.toLowerCase()) ? selected.toLowerCase() : 'unsupported';
            if (key === 'include.path' || /^includeif\..*\.path$/u.test(key)) unsupported.add('included-configuration');
            if ([`remote.${targetPath.toLowerCase()}.url`, `remote.${targetPath.toLowerCase()}.pushurl`, `remote.${targetPath.toLowerCase()}.receivepack`, `remote.${targetPath.toLowerCase()}.uploadpack`].includes(key) && selected) unsupported.add('literal-target-remote-alias');
            if (/^url\..*\.(?:insteadof|pushinsteadof)$/u.test(key) && selected && targetPath.startsWith(selected)) unsupported.add('local-path-rewrite');
            if ((key === 'extensions.partialclone' || key === 'receive.procreceiverefs' || key === 'uploadpack.packobjectshook' || key === 'core.worktree') && selected)
                unsupported.add('native-route-or-helper');
            if ((/^remote\..*\.promisor$/u.test(key) || key === 'extensions.worktreeconfig') && !['false', 'no', 'off', '0'].includes(selected.toLowerCase()))
                unsupported.add('unsupported-object-or-worktree-profile');
            if (key === 'extensions.refstorage' && selected && selected !== 'files') unsupported.add('unsupported-ref-storage');
        }
        facts.origins = [...origins].sort(); facts.unsupported = [...unsupported].sort(); facts.state = 'observed';
    } catch { /* A fixed unavailable fact, never a private parser/key/value diagnostic. */ }
    return facts;
}

export type SourceGitRoute = Readonly<{ kind: 'available'; environment: Readonly<SourceGitEnvironment> } | { kind: 'unavailable'; reason: 'unsupported-operator-route' }>;
export function captureSourceGitRoute(env: Readonly<NodeJS.ProcessEnv>): SourceGitRoute {
    try { return Object.freeze({ kind: 'available', environment: captureSourceGitEnvironment(env) }); }
    catch { return Object.freeze({ kind: 'unavailable', reason: 'unsupported-operator-route' }); }
}
export function retainSourceGitRoute(route: SourceGitRoute): SourceGitRoute {
    if (route?.kind === 'unavailable' && Object.keys(route).sort().join() === 'kind,reason' && route.reason === 'unsupported-operator-route') return Object.freeze({ ...route });
    if (route?.kind !== 'available' || Object.keys(route).sort().join() !== 'environment,kind' || !route.environment || Object.keys(route.environment).some(k => !['home', 'xdgConfigHome'].includes(k))) throw Error('Invalid captured source Git route');
    return Object.freeze({ kind: 'available', environment: captureSourceGitEnvironment({ HOME: route.environment.home, ...(Object.hasOwn(route.environment, 'xdgConfigHome') ? { XDG_CONFIG_HOME: route.environment.xdgConfigHome } : {}) }) });
}
/** Shared finite metadata observation; never invokes Git or changes policy. */
export function sourcePolicyFile(file: string, configurationAncestor = false): SourcePolicyFile {
        let stat: Stats;
        try { stat = fs.lstatSync(file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: file, kind: 'absent' }; throw error; }
        if (fs.realpathSync(file) !== file || stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || stat.uid !== process.getuid?.() && stat.uid !== 0 ||
            stat.mode & (stat.isDirectory() && configurationAncestor ? 0o002 : 0o022))
            throw Error('Source Git policy path has unsupported ownership/type/permissions');
        const common = { path: file, device: String(stat.dev), inode: String(stat.ino), ownerUid: stat.uid, mode: stat.mode };
        if (stat.isDirectory()) return { ...common, kind: 'directory', ...(configurationAncestor ? { configurationAncestor: true as const } : {}) };
        const fd = fs.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const opened = fs.fstatSync(fd);
            if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > 16 * 1024 * 1024)
                throw Error('Source Git policy file changed or exceeds profile');
            const bytes = Buffer.alloc(opened.size + 1), count = fs.readSync(fd, bytes, 0, bytes.length, 0);
            const after = fs.fstatSync(fd);
            if (count !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
                throw Error('Source Git policy file changed while reading');
            return { ...common, kind: 'file', sha256: createHash('sha256').update(bytes.subarray(0, count)).digest('hex') };
        } finally { fs.closeSync(fd); }
    }

export function assertObservedSourcePolicy(target: SourceBranchTarget): void {
    if (target?.kind !== 'source-new-branch' || target.gitDirectory !== path.join(target.canonicalPath, '.git') || target.commonDirectory !== target.gitDirectory || !Array.isArray(target.identity) || target.identity.length > 4096 ||
        !target.identity.some(f => f.path === target.canonicalPath && f.kind === 'directory') || !target.identity.some(f => f.path === target.gitDirectory && f.kind === 'directory') ||
        createHash('sha256').update(JSON.stringify(target.identity)).digest('hex') !== target.policyFingerprint ||
        JSON.stringify(target.identity.map(f => sourcePolicyFile(f.path, f.configurationAncestor === true))) !== JSON.stringify(target.identity)) throw Error('Observed source policy metadata changed or unavailable');
}
