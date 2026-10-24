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
export const claudeStartupEnvironment = Object.freeze(['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SHELL',
    'TERM_PROGRAM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR', 'COLUMNS', 'LINES', 'TMUX', 'STY',
    ...(process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : []),
    'CLAUDE_AGENT_SDK_VERSION', // Pinned original SDK sets its own informational version at query().
    'PI_CODING_AGENT_DIR', 'PI_OFFLINE', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'NoDefaultCurrentDirectoryInExePath']);
/** Login checks and actual native births must preserve the same finite identity environment. */
export function nativeClaudeEnvironment(source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
    const keys = ['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'CLAUDE_CONFIG_DIR'];
    return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
export function assertNoClaudeRoutingSelectors(): void {
    for (const [name, value] of Object.entries(process.env)) {
        if (value && /(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|BEARER_TOKEN|CREDENTIAL|GOOGLE_CLOUD|GCLOUD_|AWS_|AZURE_|OPENAI_|ANTHROPIC_|CLAUDE_CODE_PROCESS_WRAPPER|CLAUDE_BRIDGE_|NODE_OPTIONS|NODE_PATH)/i.test(name))
            throw new Error('Ambient provider or helper selector is unavailable in the controlled bridge process');
    }
}
export async function parseNativeClaudeProfile(value: unknown, projectRoots: readonly string[]): Promise<NativeClaudeProfile> {
    const p = value as NativeClaudeProfile;
    if (!p || p.kind !== 'installed-claude-bridge' || Object.keys(p).some(key => !['kind', 'cwd', 'agentDir', 'executable'].includes(key)) ||
        !p.executable || Object.keys(p.executable).some(key => !['file', 'sha256'].includes(key)) || !/^[a-f0-9]{64}$/.test(p.executable.sha256))
        throw new Error('Bridge profile requires only kind, canonical cwd/agentDir and pinned executable');
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
    return Object.freeze({ kind: p.kind, cwd: p.cwd, agentDir: p.agentDir, executable: Object.freeze({ ...p.executable }) });
}

/** Metadata only: safe at the synchronous native birth boundary. */
export function assertNativeClaudeAccountRoute(home: unknown, accountDirectory: string | undefined): void {
    if (accountDirectory !== undefined) {
        if (!isAbsolute(accountDirectory) || realpathSync(accountDirectory) !== accountDirectory)
            throw Error('Native account directory must be canonical and absolute');
        const account = lstatSync(accountDirectory);
        if (!account.isDirectory() || account.isSymbolicLink() || account.uid !== process.getuid?.() || account.mode & 0o077)
            throw Error('Native account directory must be owner-private');
    }
    if (home === undefined)
        return;
    if (typeof home !== 'string' || !isAbsolute(home) || realpathSync(home) !== home || accountDirectory !== join(home, '.claude'))
        throw Error('Native account home requires its canonical default .claude account directory');
    const directory = lstatSync(home);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || directory.mode & 0o022)
        throw Error('Native account home must be owned and not writable by others');
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

/** Preserve the asynchronous setup API while sharing the native launch checks. */
export async function validateNativeClaudeAccountHome(home: unknown, accountDirectory: string | undefined): Promise<string | undefined> {
    assertNativeClaudeAccountRoute(home, accountDirectory);
    return typeof home === 'string' ? home : undefined;
}
