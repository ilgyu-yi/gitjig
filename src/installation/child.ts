import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { privateDirectory, readPrivateJson } from './private-files.js';
const execute = promisify(execFile), hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const json = readPrivateJson;
async function syncJson(file: string, value: unknown) {
    const h = await fs.open(file, 'wx', 0o600);
    try {
        await h.writeFile(JSON.stringify(value));
        await h.sync();
    }
    finally {
        await h.close();
    }
    const d = await fs.open(path.dirname(file), 'r');
    try {
        await d.sync();
    }
    finally {
        await d.close();
    }
}
export interface InstallationCommand {
    home: string;
    ownerId: string;
    payloadId: string;
    kind: 'migrate' | 'handshake' | 'stable-health' | 'loaded-health';
    namespace?: string;
}
/** One fixed child invocation, with a supervisor-owned deadline surviving the updater. */
export async function runInstallationCommand(input: InstallationCommand): Promise<{
    stdout: string;
    stderr: string;
    commandId: string;
}> {
    const d = structuredClone(input);
    if (!/^[a-f0-9-]{36}$/.test(d.ownerId) || !/^[a-f0-9]{64}$/.test(d.payloadId) || !['migrate', 'handshake', 'stable-health', 'loaded-health'].includes(d.kind))
        throw Error('Fixed installation command required');
    if (d.kind === 'handshake' && (!d.namespace || !d.namespace.startsWith(d.ownerId + '-') || !/^[a-f0-9-]{36}-(?:candidate|bound|rollback|committed-recovery|repeat)$/.test(d.namespace)))
        throw Error('Exact isolated health namespace required');
    await privateDirectory(d.home);
    const root = path.join(d.home, 'state', 'installation-children');
    await privateDirectory(root);
    await privateDirectory(path.join(root, d.ownerId));
    const commandId = randomUUID(), directory = path.join(root, d.ownerId, commandId);
    await privateDirectory(directory);
    const descriptor = { format: 1, ...d, commandId, directory, parentPid: process.pid, timeoutMs: 30000, module: d.kind === 'stable-health' ? path.join(d.home, 'bootstrap/bootstrap.js') : path.join(d.home, 'versions', d.payloadId, 'dist/installation', d.kind + '.js'), argument: d.kind === 'migrate' ? path.join(d.home, 'state', 'activation-' + d.ownerId, 'candidate.sqlite') : d.kind === 'stable-health' ? 'health' : d.kind === 'loaded-health' ? d.home : path.join(d.home, 'state', 'health-' + d.namespace) };
    const file = path.join(directory, 'descriptor.json');
    await syncJson(file, descriptor);
    const descriptorHash = hash(await fs.readFile(file));
    const child = spawn(path.join(d.home, 'bootstrap/node'), [path.join(d.home, 'bootstrap/child-supervisor.js'), file], { cwd: d.home, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let diagnostic = '';
    child.stderr?.on('data', b => {
        if (diagnostic.length < 4096)
            diagnostic += b.toString().slice(0, 4096 - diagnostic.length);
    });
    let spawnError: Error | undefined;
    let terminalWrite: Promise<Error | null> = Promise.resolve(null);
    await new Promise<void>(resolve => {
        child.once('error', error => {
            spawnError = error;
            terminalWrite = syncJson(path.join(directory, 'terminal.json'), { format: 1, commandId, descriptorHash, workerStarted: false, workerPid: null, cleanup: 'confirmed', code: null, reason: 'Controller observed supervisor spawn error: ' + error.message, producer: 'controller-no-launch' }).then(() => null, error => error as Error);
        });
        child.once('close', () => resolve());
    });
    const terminalError = await terminalWrite;
    if (terminalError)
        throw new AggregateError([spawnError, terminalError], 'Supervisor launch failed and no-launch receipt is incomplete: ' + directory);
    if (spawnError)
        throw spawnError;
    const terminal = await json(path.join(directory, 'terminal.json'));
    if (terminal.commandId !== commandId || terminal.descriptorHash !== descriptorHash || terminal.cleanup !== 'confirmed')
        throw Error('Installation child cleanup unknown: ' + directory + ' ' + diagnostic);
    if ((terminal.code !== 0 && !(d.kind === 'stable-health' && terminal.code === 2)) || terminal.overflow)
        throw Error('Installation child unavailable: ' + directory + ' ' + terminal.reason + ' ' + await fs.readFile(path.join(directory, 'stderr'), 'utf8').catch(() => ''));
    return { stdout: await fs.readFile(path.join(directory, 'stdout'), 'utf8'), stderr: await fs.readFile(path.join(directory, 'stderr'), 'utf8'), commandId };
}
/** Observe only this exact activation's owned command journals; absence of PID/receipt is not cleanup. */
export async function reconcileInstallationChildren(home: string, ownerId: string, waitMs = 2500) {
    if (!/^[a-f0-9-]{36}$/.test(ownerId))
        throw Error('Exact installation child owner required');
    const root = path.join(home, 'state', 'installation-children', ownerId);
    let names: string[];
    try {
        await privateDirectory(path.dirname(root));
        names = await fs.readdir(root);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return { cleanup: 'confirmed' as const, commands: [] };
        throw e;
    }
    const commands: {
        commandId: string;
        cleanup: 'confirmed' | 'unknown';
        reason?: string;
    }[] = [];
    if (names.length > 32)
        throw Error('Installation child journal limit');
    for (const commandId of names) {
        if (!/^[a-f0-9-]{36}$/.test(commandId))
            throw Error('Unexpected installation child entry');
        const directory = path.join(root, commandId);
        await privateDirectory(directory);
        let descriptor: any;
        try {
            descriptor = await json(path.join(directory, 'descriptor.json'));
        }
        catch {
            commands.push({ commandId, cleanup: 'unknown', reason: 'Owned command directory lacks valid descriptor; no false no-launch inference' });
            continue;
        }
        if (descriptor.home !== home || descriptor.ownerId !== ownerId || descriptor.commandId !== commandId || descriptor.directory !== directory)
            throw Error('Installation child journal ownership differs');
        const digest = hash(await fs.readFile(path.join(directory, 'descriptor.json'))), until = Date.now() + waitMs;
        let result: {
            commandId: string;
            cleanup: 'confirmed' | 'unknown';
            reason?: string;
        } = { commandId, cleanup: 'unknown', reason: 'Missing exact terminal/helper-settlement proof; retain activation gate' };
        do {
            try {
                const t = await json(path.join(directory, 'terminal.json'));
                if (t.commandId !== commandId || t.descriptorHash !== digest || t.cleanup !== 'confirmed')
                    throw Error('Terminal ownership/cleanup differs');
                if (t.producer === 'controller-no-launch') {
                    result = { commandId, cleanup: 'confirmed' };
                    break;
                }
                const identity = await json(path.join(directory, 'identity.json'));
                if (identity.commandId !== commandId || identity.descriptorHash !== digest || identity.uid !== process.getuid?.() || !Number.isSafeInteger(identity.supervisorPid))
                    throw Error('Supervisor identity differs');
                let alive = true;
                try {
                    process.kill(identity.supervisorPid, 0);
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code === 'ESRCH')
                        alive = false;
                    else
                        throw e;
                }
                if (alive) {
                    try {
                        const p = await execute('/bin/ps', ['-ww', '-p', String(identity.supervisorPid), '-o', 'command='], { timeout: 1000, maxBuffer: 16384 });
                        alive = p.stdout.includes(path.join(home, 'bootstrap/child-supervisor.js')) && p.stdout.includes(path.join(directory, 'descriptor.json'));
                    }
                    catch { /* Observation unavailable is not proof that the captured helper ended. */ }
                }
                if (!alive) {
                    result = { commandId, cleanup: 'confirmed' };
                    break;
                }
            }
            catch { }
            if (Date.now() >= until)
                break;
            await new Promise(r => setTimeout(r, 20));
        } while (true);
        commands.push(result);
    }
    return { cleanup: commands.every(c => c.cleanup === 'confirmed') ? 'confirmed' as const : 'unknown' as const, commands };
}
