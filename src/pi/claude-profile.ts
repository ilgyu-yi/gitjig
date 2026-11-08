import { realpathSync, lstatSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep, join } from 'node:path';
import type { NativeProcessIdentity } from './native-process.js';
/** Persistable configuration only. No host object, environment, auth data, or callbacks. */
export interface NativeClaudeProfile {
    kind: 'installed-claude-bridge';
    cwd: string;
    agentDir: string;
    executable: NativeProcessIdentity;
}
/** Login checks and actual native births must preserve the same finite identity environment. */
export function nativeClaudeEnvironment(source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
    const keys = ['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'CLAUDE_CONFIG_DIR'];
    const environment: NodeJS.ProcessEnv = {};
    for (const key of keys) {
        const value = source[key];
        if (value === undefined)
            continue;
        if (typeof value !== 'string' || value.includes('\0'))
            throw new Error('Native Claude environment requires string values without NUL: ' + key);
        environment[key] = value;
    }
    return environment;
}
/** Fresh settings shared by login observations and owned native execution. */
export function nativeClaudeSettings() {
    return {
        disableAllHooks: true,
        autoMemoryEnabled: false,
        syncClaudeAiSkills: false,
        syncClaudeAiPlugins: false,
        enabledPlugins: {
            'agents-md@builtin': false,
            'plugin-authoring@builtin': false,
        },
    };
}
/** Persisted field shape only. Paths and the pin acquire no native authority here. */
export function parseNativeClaudeProfileShape(value: unknown): NativeClaudeProfile {
    const p = value as NativeClaudeProfile;
    if (!p || typeof p !== 'object' || Array.isArray(p) || p.kind !== 'installed-claude-bridge' || Object.keys(p).some(key => !['kind', 'cwd', 'agentDir', 'executable'].includes(key)) ||
        typeof p.cwd !== 'string' || typeof p.agentDir !== 'string' || !p.executable || typeof p.executable !== 'object' || Array.isArray(p.executable) ||
        Object.keys(p.executable).some(key => !['file', 'sha256'].includes(key)) || typeof p.executable.file !== 'string' || typeof p.executable.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.executable.sha256))
        throw new Error('Bridge profile requires only kind, canonical cwd/agentDir and pinned executable');
    return Object.freeze({ kind: p.kind, cwd: p.cwd, agentDir: p.agentDir, executable: Object.freeze({ ...p.executable }) });
}
export async function parseNativeClaudeProfile(value: unknown, projectRoots: readonly string[]): Promise<NativeClaudeProfile> {
    const p = parseNativeClaudeProfileShape(value);
    for (const file of [p.cwd, p.agentDir, p.executable.file]) {
        if (typeof file !== 'string' || !isAbsolute(file) || await realpath(file) !== file)
            throw new Error('Bridge paths must be canonical absolute host paths');
        for (const root of projectRoots) {
            const rel = relative(root, file);
            if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)))
                throw new Error('Bridge configuration belongs outside project inputs');
        }
    }
    for (const directory of [p.cwd, p.agentDir]) {
        const info = await stat(directory);
        if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077)
            throw new Error('Bridge startup directories must be owner-private');
    }
    return p;
}

/** Native HOME is an explicit identity input, including explicit-directory routes. */
export function assertNativeClaudeHome(home: unknown): asserts home is string {
    if (typeof home !== 'string' || !isAbsolute(home) || realpathSync(home) !== home)
        throw Error('Native account HOME must be canonical and absolute');
    const directory = lstatSync(home);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || directory.mode & 0o022)
        throw Error('Native account home must be owned and not writable by others');
}

/** Metadata only: catalogue may precede first login; native birth must not. */
export function assertNativeClaudeAccountRoute(home: unknown, accountDirectory: string | undefined,
    options: { allowMissingDefaultDirectory?: boolean } = {}): void {
    if (home !== undefined) {
        if (typeof home !== 'string' || !isAbsolute(home) || realpathSync(home) !== home || accountDirectory !== join(home, '.claude'))
            throw Error('Native account home requires its canonical default .claude account directory');
        assertNativeClaudeHome(home);
        try {
            const configuration = lstatSync(join(home, '.claude.json'));
            if (!configuration.isFile() || configuration.isSymbolicLink() || configuration.nlink !== 1 || configuration.uid !== process.getuid?.() || configuration.mode & 0o077)
                throw Error('Default Claude account configuration must be an owner-private regular file');
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
    }
    if (accountDirectory !== undefined) {
        if (!isAbsolute(accountDirectory))
            throw Error('Native account directory must be canonical and absolute');
        let account;
        try {
            // lstat before realpath distinguishes an absent leaf from a dangling link.
            account = lstatSync(accountDirectory);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT' && home !== undefined && options.allowMissingDefaultDirectory)
                return;
            throw error;
        }
        if (realpathSync(accountDirectory) !== accountDirectory)
            throw Error('Native account directory must be canonical and absolute');
        if (!account.isDirectory() || account.isSymbolicLink() || account.uid !== process.getuid?.() || account.mode & 0o077)
            throw Error('Native account directory must be owner-private');
    }
}

/** Preserve the asynchronous setup API while sharing the native launch checks. */
export async function validateNativeClaudeAccountHome(home: unknown, accountDirectory: string | undefined,
    options: { allowMissingDefaultDirectory?: boolean } = {}): Promise<string | undefined> {
    assertNativeClaudeAccountRoute(home, accountDirectory, options);
    return typeof home === 'string' ? home : undefined;
}
