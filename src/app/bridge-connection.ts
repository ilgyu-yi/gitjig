import fs from 'node:fs/promises';
import { constants, lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { StartupConfiguration } from './startup.js';
import { assertNativeClaudeAccountRoute, nativeClaudeEnvironment } from '../pi/claude-profile.js';
import { readNativeObservationResult } from '../execution/native-observation.js';
import { parseUniqueJson } from '../workflow/json.js';

export interface ClaudeOperatorEnvironment { home?: string; path?: string; configDirectory?: string; user?: string; logname?: string; shell?: string; lang?: string; lcAll?: string; term?: string; }
export function captureClaudeOperatorEnvironment(env: NodeJS.ProcessEnv = process.env): Readonly<ClaudeOperatorEnvironment> {
    const hasConfigDirectory = Object.hasOwn(env, 'CLAUDE_CONFIG_DIR');
    env = nativeClaudeEnvironment(env);
    return Object.freeze({ ...(env.HOME === undefined ? {} : { home: env.HOME }), ...(env.PATH === undefined ? {} : { path: env.PATH }),
        ...Object.fromEntries((['USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM'] as const).filter(key => env[key] !== undefined).map(key => [{ USER: 'user', LOGNAME: 'logname', SHELL: 'shell', LANG: 'lang', LC_ALL: 'lcAll', TERM: 'term' }[key], env[key]])),
        ...(hasConfigDirectory ? { configDirectory: env.CLAUDE_CONFIG_DIR ?? '' } : {}) });
}
export interface ClaudeBridgeConnectionHost {
    home: string;
    operator: Readonly<ClaudeOperatorEnvironment>;
    savedBridge: StartupConfiguration['bridge'];
    runtimeCompatible: boolean;
    assertCurrent(): void;
    checkPath(file: string): void;
    run<T>(action: (signal: AbortSignal) => Promise<T>, guard?: () => void): Promise<T>;
    save(bridge: NonNullable<StartupConfiguration['bridge']>, guard?: () => void): Promise<unknown>;
}
const policy = JSON.stringify({ askClaude: { enabled: false }, provider: { strictMcpConfig: true, autoMemoryEnabled: false } });
const nativeSettings = JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false,
    enabledPlugins: { 'agents-md@builtin': false, 'bento-slides@bento': false, 'drop@drop': false, 'plugin-authoring@builtin': false } });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const literal = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/u.test(value);
const exactPath = (value: unknown): value is string => literal(value) && path.isAbsolute(value) && path.normalize(value) === value;
const signature = (s: Awaited<ReturnType<typeof fs.lstat>>) => [s.dev, s.ino, s.uid, s.mode, s.size, s.mtimeMs, s.ctimeMs].join(':');
type Candidate = { id: string; label: string; source: string; alias: string; file: string; identity: string };
type Route = { id: string; label: string; kind: 'default-home' | 'explicit-directory'; directory: string; home?: string };
type Repair = { file: string; identity: string; mode: number };
type Account = { loggedIn: boolean; authMethod: string; email?: string; organization?: string; plan?: string };
type ManagedSeal = { directories: { file: string; identity: string }[]; policy: { file: string; identity: string } };
const stableDirectory = (s: Awaited<ReturnType<typeof fs.lstat>>) => [s.dev, s.ino, s.uid, s.mode].join(':');
type Check = { seal: ManagedSeal; routeIdentity: string; candidate: Candidate; route: Route; sha256: string; version: string; identity: string; leaf: string; bridge: NonNullable<StartupConfiguration['bridge']> };

/** Claude-specific setup. Opaque selections carry trusted paths; no credential is read or copied. */
export function prepareClaudeBridgeConnection(host: ClaudeBridgeConnectionHost) {
    const rawSaved: unknown = host.savedBridge;
    const savedProfile = object(rawSaved) && object(rawSaved.profile) ? rawSaved.profile : undefined;
    const savedExecutable = savedProfile && object(savedProfile.executable) ? savedProfile.executable : undefined;
    const savedBridge = object(rawSaved) && savedProfile?.kind === 'installed-claude-bridge' && exactPath(savedProfile.cwd) && exactPath(savedProfile.agentDir) && savedExecutable && exactPath(savedExecutable.file) && typeof savedExecutable.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(savedExecutable.sha256) && exactPath(rawSaved.nativeAccountDirectory) && (rawSaved.nativeAccountHome === undefined || exactPath(rawSaved.nativeAccountHome) && rawSaved.nativeAccountDirectory === path.join(rawSaved.nativeAccountHome, '.claude')) ? rawSaved as unknown as NonNullable<StartupConfiguration['bridge']> : undefined;
    const leaves = new Map<string, { leaf: string; seal: ManagedSeal }>();
    const candidates = new Map<string, Candidate>(), routes = new Map<string, Route>(), checks = new Map<string, Check>(), repairs = new Map<string, Repair[]>();
    const current = (guard?: () => void, signal?: AbortSignal) => {
        host.assertCurrent(); signal?.throwIfAborted();
        if (guard && guard() !== undefined) throw Error('Synchronous Claude setup guard required');
    };
    const step = async <T>(value: Promise<T>, guard?: () => void, signal?: AbortSignal): Promise<T> => { const result = await value; current(guard, signal); return result; };
    const ownedPath = (file: string, guard?: () => void, signal?: AbortSignal) => { current(guard, signal); host.checkPath(file); };
    const client = async (alias: string, guard?: () => void, signal?: AbortSignal) => {
        ownedPath(alias, guard, signal);
        const file = await step(fs.realpath(alias), guard, signal); ownedPath(file, guard, signal);
        const stat = await step(fs.lstat(file), guard, signal);
        if (!stat.isFile() || stat.isSymbolicLink() || ![0, process.getuid?.()].includes(stat.uid) || stat.mode & 0o022 || !(stat.mode & 0o111) || stat.size > 512 * 1024 * 1024)
            throw Error('Claude executable must be a trusted regular executable outside project inputs');
        if (/\.(?:[cm]?js|ts|tsx|jsx)$/iu.test(file))
            throw Error('The npm JavaScript Claude launcher is not supported here; select an installed Claude executable or use advanced setup');
        return { file, identity: signature(stat) };
    };
    const assertClient = async (candidate: Candidate, guard?: () => void, signal?: AbortSignal) => {
        const now = await client(candidate.alias, guard, signal);
        if (now.file !== candidate.file || now.identity !== candidate.identity) throw Error('Selected Claude executable changed; discover and check it again');
    };
    const hashClient = async (candidate: Candidate, guard?: () => void, signal?: AbortSignal) => {
        await assertClient(candidate, guard, signal);
        const file = await fs.open(candidate.file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            current(guard, signal);
            const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024); let size = 0;
            for (;;) {
                const { bytesRead } = await step(file.read(buffer, 0, buffer.length, null), guard, signal);
                if (!bytesRead) break;
                size += bytesRead; if (size > 512 * 1024 * 1024) throw Error('Claude executable exceeds the supported size');
                hash.update(buffer.subarray(0, bytesRead));
            }
            await assertClient(candidate, guard, signal); return hash.digest('hex');
        } finally { await file.close(); }
    };
    const routeRepairs = async (route: Route, guard?: () => void, signal?: AbortSignal) => {
        const targets: Repair[] = [];
        const inspect = async (file: string, directory: boolean, mode: number, optional = false) => {
            ownedPath(file, guard, signal); let stat;
            try { stat = await step(fs.lstat(file), guard, signal); }
            catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
            if (stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) || await step(fs.realpath(file), guard, signal) !== file)
                throw Error('Claude account route must use canonical owned directories and regular settings files');
            if (stat.mode & 0o077) targets.push({ file, identity: signature(stat), mode });
        };
        await inspect(route.directory, true, 0o700);
        if (route.home) {
            ownedPath(route.home, guard, signal); const stat = await step(fs.lstat(route.home), guard, signal);
            if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o022 || await step(fs.realpath(route.home), guard, signal) !== route.home)
                throw Error('Native Claude home must be canonical, owned and not writable by others');
            await inspect(path.join(route.home, '.claude.json'), false, 0o600, true);
        }
        if (!targets.length) assertNativeClaudeAccountRoute(route.home, route.directory);
        return targets;
    };
    const managed = async (leaf: string, guard?: () => void, signal?: AbortSignal) => {
        for (const file of [path.join(host.home, 'config'), path.join(host.home, 'config', 'claude-bridge'), leaf, path.join(leaf, 'host'), path.join(leaf, 'agent'), path.join(leaf, 'agent', 'home')]) {
            ownedPath(file, guard, signal);
            try { await step(fs.mkdir(file, { mode: 0o700 }), guard, signal); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; current(guard, signal); }
            const stat = await step(fs.lstat(file), guard, signal);
            if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077 || await step(fs.realpath(file), guard, signal) !== file)
                throw Error('Managed Claude setup directory changed or is unsafe');
        }
        const file = path.join(leaf, 'agent', 'claude-bridge.json'); ownedPath(file, guard, signal);
        try { await step(fs.writeFile(file, policy, { flag: 'wx', mode: 0o600 }), guard, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; current(guard, signal); }
        const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            current(guard, signal);
            const stat = await step(handle.stat(), guard, signal);
            if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size !== Buffer.byteLength(policy)) throw Error('Managed bridge policy is unsafe or changed');
            if ((await step(handle.readFile('utf8'), guard, signal)) !== policy) throw Error('Existing managed bridge policy differs; it was not overwritten');
        } finally { await handle.close(); }
        current(guard, signal);
        const directories = [];
        for (const directory of [path.join(host.home, 'config'), path.join(host.home, 'config', 'claude-bridge'), leaf, path.join(leaf, 'host'), path.join(leaf, 'agent'), path.join(leaf, 'agent', 'home')])
            directories.push({ file: directory, identity: stableDirectory(await step(fs.lstat(directory), guard, signal)) });
        return { directories, policy: { file, identity: signature(await step(fs.lstat(file), guard, signal)) } };
    };
    const verifyManaged = async (seal: ManagedSeal, guard?: () => void, signal?: AbortSignal) => {
        for (const directory of seal.directories) {
            ownedPath(directory.file, guard, signal); const stat = await step(fs.lstat(directory.file), guard, signal);
            if (!stat.isDirectory() || stat.isSymbolicLink() || stableDirectory(stat) !== directory.identity || await step(fs.realpath(directory.file), guard, signal) !== directory.file)
                throw Error('Reviewed managed Claude directory changed; discover and check again');
        }
        ownedPath(seal.policy.file, guard, signal); const handle = await fs.open(seal.policy.file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            current(guard, signal); const stat = await step(handle.stat(), guard, signal);
            if (!stat.isFile() || stat.nlink !== 1 || signature(stat) !== seal.policy.identity || stat.size !== Buffer.byteLength(policy) || await step(handle.readFile('utf8'), guard, signal) !== policy)
                throw Error('Reviewed managed bridge policy changed; discover and check again');
        } finally { await handle.close(); }
        current(guard, signal);
    };
    const routeIdentity = async (route: Route, guard?: () => void, signal?: AbortSignal) => {
        current(guard, signal); assertNativeClaudeAccountRoute(route.home, route.directory);
        const identities = [];
        for (const directory of [route.directory, ...(route.home ? [route.home] : [])]) {
            ownedPath(directory, guard, signal); const stat = await step(fs.lstat(directory), guard, signal);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Claude account route changed');
            identities.push([directory, stableDirectory(stat)]);
        }
        assertNativeClaudeAccountRoute(route.home, route.directory); return JSON.stringify(identities);
    };
    const observe = async (candidate: Candidate, route: Route, leaf: string, signal: AbortSignal, guard?: () => void) => {
        const capturedRoute = await routeIdentity(route, guard, signal);
        const sha256 = await hashClient(candidate, guard, signal);
        const env = nativeClaudeEnvironment({ HOME: route.home ?? path.join(leaf, 'agent', 'home'), TMPDIR: path.join(host.home, 'artifacts'),
            ...Object.fromEntries((['path', 'user', 'logname', 'shell', 'lang', 'lcAll', 'term'] as const).filter(key => host.operator[key] !== undefined).map(key => [{ path: 'PATH', user: 'USER', logname: 'LOGNAME', shell: 'SHELL', lang: 'LANG', lcAll: 'LC_ALL', term: 'TERM' }[key], host.operator[key]])),
            ...(route.kind === 'explicit-directory' ? { CLAUDE_CONFIG_DIR: route.directory } : {}) });
        Object.assign(env, { ENABLE_CLAUDEAI_MCP_SERVERS: '0', DISABLE_AUTO_COMPACT: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDE_AGENT_SDK_VERSION: '0.3.284' });
        const read = async (args: string[]) => {
            await assertClient(candidate, guard, signal); if (await routeIdentity(route, guard, signal) !== capturedRoute) throw Error('Claude account route changed during login check'); current(guard, signal);
            const result = await step(readNativeObservationResult(candidate.file, args, { cwd: path.join(leaf, 'host'), env, signal, kind: 'Claude setup', allowedExitCodes: [0, 1] }), guard, signal);
            await assertClient(candidate, guard, signal); if (await routeIdentity(route, guard, signal) !== capturedRoute) throw Error('Claude account route changed during login check'); return result;
        };
        const versionResult = await read(['--version']);
        const decode = (value: Buffer) => new TextDecoder('utf-8', { fatal: true }).decode(value);
        let version: string;
        try { version = decode(versionResult.stdout).trim(); } catch { throw Error('Claude version output is unavailable or malformed'); }
        if (versionResult.exitCode !== 0 || version.length > 256 || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?: \(Claude Code\))?$/u.test(version)) throw Error('Selected executable did not report a supported Claude Code version');
        const result = await read(['--setting-sources', '', '--settings', nativeSettings, 'auth', 'status', '--json']);
        if (result.stdout.length > 128 * 1024) throw Error('Claude login status exceeds the supported bound');
        let raw: unknown;
        try { raw = parseUniqueJson(decode(result.stdout)); } catch { throw Error('Claude login status is unavailable or malformed; no account was selected'); }
        if (!object(raw) || typeof raw.loggedIn !== 'boolean' || raw.loggedIn && !literal(raw.authMethod, 64) || !raw.loggedIn && raw.authMethod !== undefined && raw.authMethod !== null && !literal(raw.authMethod, 64)) throw Error('Claude returned unsupported login status; no account was selected');
        const field = (key: string, max = 320): string | undefined => { const value = raw[key]; if (value === undefined || value === null) return undefined; if (!literal(value, max)) throw Error('Claude returned unsupported account metadata'); return value; };
        const email = field('email'), organization = field('orgName'), plan = field('subscriptionType', 64), organizationId = field('orgId', 128), apiProvider = field('apiProvider', 64);
        const account: Account = { loggedIn: raw.loggedIn, authMethod: literal(raw.authMethod, 64) ? raw.authMethod : 'none', ...(email ? { email } : {}), ...(organization ? { organization } : {}), ...(plan ? { plan } : {}) };
        const identity = JSON.stringify({ account, organizationId, apiProvider });
        const ready = result.exitCode === 0 && account.loggedIn && account.authMethod === 'claude.ai' && (apiProvider === undefined || apiProvider === 'firstParty');
        if (await hashClient(candidate, guard, signal) !== sha256) throw Error('Claude executable changed during login check');
        return { sha256, version, account, identity, ready, routeIdentity: capturedRoute };
    };
    const assertReviewed = (checked: Check, guard?: () => void, signal?: AbortSignal) => {
        current(guard, signal);
        ownedPath(checked.candidate.alias, guard, signal); ownedPath(checked.candidate.file, guard, signal);
        if (realpathSync(checked.candidate.alias) !== checked.candidate.file || signature(lstatSync(checked.candidate.file)) !== checked.candidate.identity)
            throw Error('Reviewed Claude executable changed; check login again');
        assertNativeClaudeAccountRoute(checked.route.home, checked.route.directory);
        const route = [checked.route.directory, ...(checked.route.home ? [checked.route.home] : [])].map(directory => {
            ownedPath(directory, guard, signal); const stat = lstatSync(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Reviewed Claude account route changed');
            return [directory, stableDirectory(stat)];
        });
        if (JSON.stringify(route) !== checked.routeIdentity) throw Error('Reviewed Claude account route changed; check login again');
        for (const directory of checked.seal.directories) {
            ownedPath(directory.file, guard, signal); const stat = lstatSync(directory.file);
            if (!stat.isDirectory() || stat.isSymbolicLink() || stableDirectory(stat) !== directory.identity || realpathSync(directory.file) !== directory.file)
                throw Error('Reviewed managed Claude directory changed; check login again');
        }
        const selected = checked.seal.policy; ownedPath(selected.file, guard, signal);
        const fd = openSync(selected.file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = fstatSync(fd), buffer = Buffer.alloc(Buffer.byteLength(policy) + 1);
            if (!stat.isFile() || stat.nlink !== 1 || signature(stat) !== selected.identity || stat.size !== Buffer.byteLength(policy)) throw Error('Reviewed managed bridge policy changed');
            let count = 0;
            while (count < buffer.length) { const read = readSync(fd, buffer, count, buffer.length - count, count); if (!read) break; count += read; }
            if (buffer.subarray(0, count).toString('utf8') !== policy || signature(fstatSync(fd)) !== selected.identity) throw Error('Reviewed managed bridge policy changed');
        } finally { closeSync(fd); }
        current(guard, signal);
    };
    return {
        assertCurrent: () => current(),
        savedBridge,
        discover: (guard?: () => void) => host.run(async signal => {
            current(guard, signal); candidates.clear(); routes.clear(); checks.clear(); repairs.clear(); leaves.clear();
            const diagnostics: string[] = [], paths: { file: string; source: string }[] = [];
            const saved: unknown = savedBridge;
            if (object(saved) && object(saved.profile) && object(saved.profile.executable) && exactPath(saved.profile.executable.file)) paths.push({ file: saved.profile.executable.file, source: 'Saved bridge client' });
            const entries = (host.operator.path ?? '').slice(0, 32768).split(path.delimiter).filter(exactPath).slice(0, 64);
            for (const directory of entries) paths.push({ file: path.join(directory, 'claude'), source: 'Original operator PATH' });
            if (exactPath(host.operator.home)) for (const relative of ['.local/bin/claude', '.claude/local/claude']) paths.push({ file: path.join(host.operator.home, relative), source: 'Native Claude installation' });
            for (const file of ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude']) paths.push({ file, source: 'System installation' });
            const seen = new Set<string>();
            for (const item of paths) {
                if (seen.has(item.file)) continue; seen.add(item.file);
                try {
                    const found = await client(item.file, guard, signal);
                    if ([...candidates.values()].some(value => value.file === found.file)) continue;
                    const id = randomUUID(); candidates.set(id, { id, label: found.file, source: item.source, alias: item.file, ...found });
                } catch (error) {
                    current(guard, signal);
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(error instanceof Error ? error.message : 'Claude client discovery unavailable');
                }
            }
            const addRoute = (directory: unknown, nativeHome: unknown, source: string) => {
                if (!exactPath(directory) || nativeHome !== undefined && !exactPath(nativeHome) || nativeHome !== undefined && directory !== path.join(nativeHome as string, '.claude')) return;
                const kind = nativeHome === undefined ? 'explicit-directory' : 'default-home';
                if ([...routes.values()].some(value => value.directory === directory && value.home === nativeHome)) return;
                const id = randomUUID(); routes.set(id, { id, directory, kind, ...(nativeHome === undefined ? {} : { home: nativeHome as string }), label: source + (kind === 'default-home' ? ' · native default login (HOME=' + nativeHome + ')' : ' · explicit account directory (CLAUDE_CONFIG_DIR=' + directory + ')') });
            };
            if (object(saved)) addRoute(saved.nativeAccountDirectory, saved.nativeAccountHome, 'Saved Claude login');
            if (Object.hasOwn(host.operator, 'configDirectory')) {
                addRoute(host.operator.configDirectory, undefined, 'Original operator configuration');
                if (!exactPath(host.operator.configDirectory)) diagnostics.push('Original CLAUDE_CONFIG_DIR is empty or unsupported; it was not treated as a default-home route.');
            }
            if (exactPath(host.operator.home)) addRoute(path.join(host.operator.home, '.claude'), host.operator.home, 'Current operator home');
            return { candidates: [...candidates.values()].map(({ id, label, source }) => ({ id, label, source })), routes: [...routes.values()].map(({ id, label, kind }) => ({ id, label, kind })),
                ...(!candidates.size || !routes.size || diagnostics.length ? { diagnostic: diagnostics[0] ?? (!candidates.size ? 'No supported Claude executable found. Install the native Claude client or use advanced bridge setup.' : 'Original native account route is unavailable; choose advanced bridge setup.') } : {}) };
        }, guard),
        check: (candidateId: string, routeId: string, guard?: () => void, outer?: AbortSignal) => host.run(async owned => {
            const signal = outer ? AbortSignal.any([owned, outer]) : owned; current(guard, signal);
            const candidate = candidates.get(candidateId), route = routes.get(routeId);
            if (!candidate || !route) throw Error('Claude setup selection changed; discover clients and routes again');
            await assertClient(candidate, guard, signal);
            const targets = await routeRepairs(route, guard, signal), id = randomUUID();
            const key = candidate.id + ':' + route.id; let prepared = leaves.get(key);
            if (prepared) await verifyManaged(prepared.seal, guard, signal);
            else { const leaf = path.join(host.home, 'config', 'claude-bridge', randomUUID()); const seal = await managed(leaf, guard, signal); prepared = { leaf, seal }; leaves.set(key, prepared); }
            const { leaf, seal } = prepared;
            const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
            const loginCommand = route.kind === 'default-home' ? 'env -u CLAUDE_CONFIG_DIR HOME=' + quote(route.home!) + ' ' + quote(candidate.file) + ' auth login' : 'env HOME=' + quote(path.join(leaf, 'agent', 'home')) + ' CLAUDE_CONFIG_DIR=' + quote(route.directory) + ' ' + quote(candidate.file) + ' auth login';
            if (targets.length) {
                const repairId = randomUUID(); repairs.set(repairId, targets);
                return { id, client: { label: candidate.label, version: 'Not checked' }, account: { loggedIn: false, authMethod: 'unchecked' } as Account, routeLabel: route.label, loginCommand, ready: false as const,
                    permissionRepair: { id: repairId, labels: targets.map(target => 'Set ' + target.file + ' to owner-only ' + (target.mode === 0o700 ? '0700' : '0600')) } };
            }
            const status = await observe(candidate, route, leaf, signal, guard);
            await verifyManaged(seal, guard, signal);
            const bridge: NonNullable<StartupConfiguration['bridge']> = { profile: { kind: 'installed-claude-bridge', cwd: path.join(leaf, 'host'), agentDir: path.join(leaf, 'agent'), executable: { file: candidate.file, sha256: status.sha256 } }, nativeAccountDirectory: route.directory, ...(route.home ? { nativeAccountHome: route.home } : {}) };
            const ready = status.ready && host.runtimeCompatible;
            if (ready) checks.set(id, { candidate, route, seal, routeIdentity: status.routeIdentity, sha256: status.sha256, version: status.version, identity: status.identity, leaf, bridge });
            return { id, client: { label: candidate.label, version: status.version }, account: status.account, routeLabel: route.label, loginCommand, ready,
                ...(!host.runtimeCompatible ? { diagnostic: 'Bridge connection needs an explicit Docker configuration directory in /setup runtime; existing runtime was preserved.' } : !status.ready ? { diagnostic: 'This route needs a native Claude subscription login. No API billing fallback or login was performed.' } : {}),
                review: { clientPath: candidate.file, sha256: status.sha256, managedDirectory: leaf, accountDirectory: route.directory, ...(route.home ? { nativeHome: route.home } : {}), policyFile: path.join(leaf, 'agent', 'claude-bridge.json') } };
        }, guard),
        repairPermissions: (id: string, guard?: () => void) => host.run(async signal => {
            current(guard, signal); const targets = repairs.get(id); if (!targets) throw Error('Permission review changed; check the selected login route again');
            for (const target of targets) {
                ownedPath(target.file, guard, signal); const stat = await step(fs.lstat(target.file), guard, signal);
                if (signature(stat) !== target.identity) throw Error('Claude account permissions changed; check again before repair');
            }
            for (const target of targets) {
                ownedPath(target.file, guard, signal); const handle = await fs.open(target.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try { current(guard, signal); if (signature(await step(handle.stat(), guard, signal)) !== target.identity) throw Error('Reviewed permission target changed'); current(guard, signal); await step(handle.chmod(target.mode), guard, signal); }
                finally { await handle.close(); }
            }
            repairs.delete(id); checks.clear(); current(guard, signal);
        }, guard),
        connect: async (checkId: string, guard?: () => void, outer?: AbortSignal) => {
            const checked = checks.get(checkId); if (!checked) throw Error('Claude login check is unavailable; check login again');
            await host.run(async owned => {
                const signal = outer ? AbortSignal.any([owned, outer]) : owned; current(guard, signal);
                await verifyManaged(checked.seal, guard, signal); if (await routeIdentity(checked.route, guard, signal) !== checked.routeIdentity) throw Error('Reviewed Claude account route changed; check login again'); const status = await observe(checked.candidate, checked.route, checked.leaf, signal, guard);
                if (!status.ready || status.identity !== checked.identity || status.sha256 !== checked.sha256 || status.version !== checked.version || status.routeIdentity !== checked.routeIdentity)
                    throw Error('Claude client or account changed after review; check login again');
                await verifyManaged(checked.seal, guard, signal); assertReviewed(checked, guard, signal);
            }, guard);
            current(guard, outer);
            await host.save(checked.bridge, () => assertReviewed(checked, guard, outer));
            checks.delete(checkId); return { saved: true as const };
        },
    };
}
