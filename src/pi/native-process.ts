import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Writable, Readable } from 'node:stream';
import { absent, acknowledgeJoined, inspectOwners, ownerRoot, readRecord, type Purpose, type Terminal } from './native-owner-records.js';
export interface NativeProcessIdentity {
    file: string;
    sha256: string;
}
export interface NativeSettlement {
    cleanup: 'confirmed' | 'failed' | 'unknown';
    exited: boolean;
    pipesClosed: boolean;
    scopeJoined: boolean;
}
export interface NativeOwner {
    ownerSessionId: string;
    purpose: Purpose;
}
/** Public SDK process contract: deliberately no pid (guardian is not native). */
class NativeProcess extends EventEmitter {
    killed = false;
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    constructor(readonly stdin: Writable, readonly stdout: Readable, private readonly terminate: (signal: NodeJS.Signals) => boolean) { super(); }
    kill(signal: NodeJS.Signals): boolean { const sent = this.terminate(signal); if (sent)
        this.killed = true; return sent; }
}
function pinned(file: string, digest: string) {
    const s = fs.lstatSync(file);
    if (fs.realpathSync(file) !== file || !s.isFile() || s.isSymbolicLink() || (s.mode & 0o022) || !(s.mode & 0o111) || !/^[a-f0-9]{64}$/.test(digest) || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== digest)
        throw Error('Native executable requires canonical pinned identity');
    return s;
}
/** Local identity check shared by explicit startup saving and actual producer birth. */
export function assertNativeExecutableIdentity(identity: NativeProcessIdentity): void { pinned(identity.file, identity.sha256); }
/** A surviving guardian owns birth and exact native group after host death.
 * No universal setsid/process-tree or simultaneous host+guardian death guarantee. */
export async function createOwnedNativeProducer(identity: NativeProcessIdentity, signal?: AbortSignal, stateRoot?: string) {
    identity = Object.freeze({ ...identity });
    const original = pinned(identity.file, identity.sha256);
    if (!stateRoot || process.platform === 'win32')
        throw Error('Owned native state and POSIX process groups required');
    const root = ownerRoot(stateRoot);
    const until = performance.now() + 5000;
    for (;;) {
        try {
            inspectOwners(root);
            break;
        }
        catch (error) {
            if ((error as Error).message !== 'NATIVE_OWNER_UNACCOUNTED' || performance.now() >= until)
                throw error;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }
    const helper = fileURLToPath(new URL('./native-guardian.js', import.meta.url));
    const helperInfo = fs.lstatSync(helper), helperDigest = createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
    if (!helperInfo.isFile() || helperInfo.isSymbolicLink() || helperInfo.mode & 0o022 || fs.realpathSync(helper) !== helper)
        throw Error('Shipped native guardian unavailable');
    const node = fs.realpathSync(process.execPath), nodeDigest = createHash('sha256').update(fs.readFileSync(node)).digest('hex');
    pinned(node, nodeDigest);
    let closed = false, unknown = false;
    const active = new Set<Promise<NativeSettlement>>(), stops = new Set<() => void>(), localNonces = new Set<string>();
    const close = async () => { closed = true; for (const stop of stops)
        stop(); const results = await Promise.all([...active]); return { cleanup: !unknown && results.every(x => x.cleanup === 'confirmed') ? 'confirmed' as const : 'unknown' as const }; };
    const launch = (options: {
        command: string;
        args: string[];
        cwd?: string;
        env?: Record<string, string | undefined>;
        signal?: AbortSignal;
    }, owner?: NativeOwner) => {
        if (closed || unknown)
            throw Error('Native producer closed or quarantined');
        signal?.throwIfAborted();
        options.signal?.throwIfAborted();
        if (!owner || typeof owner.ownerSessionId !== 'string' || !owner.ownerSessionId || owner.ownerSessionId.length > 200 || !['provider', 'summary'].includes(owner.purpose))
            throw Error('Actual native session owner required');
        if (options.command !== identity.file)
            throw Error('Native executable differs from selected identity');
        const now = fs.statSync(identity.file);
        if (fs.realpathSync(identity.file) !== identity.file || !now.isFile() || now.dev !== original.dev || now.ino !== original.ino || now.size !== original.size || now.mtimeMs !== original.mtimeMs || now.mode !== original.mode)
            throw Error('Pinned native executable changed before launch');
        if (createHash('sha256').update(fs.readFileSync(helper)).digest('hex') !== helperDigest)
            throw Error('Shipped native guardian changed');
        // Snapshot options privately; never write/hash argv, environment or protocol.
        if (!options.env)
            throw Error('Explicit native environment required');
        const configuration = { command: options.command, args: [...options.args], cwd: options.cwd ?? process.cwd(), env: Object.fromEntries(Object.entries(options.env).filter(([, v]) => v !== undefined)) };
        if (Buffer.byteLength(JSON.stringify(configuration)) > 512 * 1024)
            throw Error('Native launch metadata exceeds bound');
        // Check durable outstanding owners only when no local launch is active.
        // Local in-flight nonce records belong to this producer, not orphan recovery.
        inspectOwners(root, localNonces);
        const nonce = randomUUID(), directory = path.join(root, nonce);
        localNonces.add(nonce);
        const guardian = spawn(node, [helper, root, nonce, owner.ownerSessionId, owner.purpose, String(process.pid), identity.sha256], { cwd: path.dirname(helper), env: {}, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'ipc'] });
        let nativePid: number | undefined, nativeExited = false, pipeClosed = false, guardianClosed = false, failed = false, finished = false, stopped = false;
        let terminal: Terminal | undefined, guardianCode: number | null = null;
        let resolveSettlement!: (value: NativeSettlement) => void;
        const settled = new Promise<NativeSettlement>(resolve => { resolveSettlement = resolve; });
        active.add(settled);
        const lifeline = guardian.stdio[3] as Writable;
        let killTimer: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;
        const killKnown = (sig: NodeJS.Signals) => { if (nativePid && !absent(nativePid, true))
            try {
                process.kill(-nativePid, sig);
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
                    failed = true;
            } };
        let facade: NativeProcess;
        const finish = (force = false) => {
            if (finished || !force && !guardianClosed)
                return;
            const scopeJoined = terminal?.nativeCreated === false && terminal.cleanup === 'confirmed' || !!nativePid && absent(nativePid, true);
            if (!force && !scopeJoined)
                return;
            finished = true;
            clearTimeout(killTimer);
            clearTimeout(deadline);
            clearInterval(poll);
            signal?.removeEventListener('abort', stop);
            options.signal?.removeEventListener('abort', stop);
            stops.delete(stop);
            lifeline.destroy();
            let durable = false, physicalReceipt = false;
            try {
                const a = readRecord(directory, 'admission.json');
                const t = readRecord(directory, 'settlement.json', a);
                durable = !!a && !!t && t.nonce === nonce && t.sessionId === owner.ownerSessionId && t.guardianPid === guardian.pid && t.executableSha256 === identity.sha256 && t.cleanup === 'confirmed' && JSON.stringify(t) === JSON.stringify(terminal);
            }
            catch { }
            if (guardianClosed && pipeClosed && scopeJoined && (nativeExited || terminal?.nativeCreated === false)) {
                try {
                    const binding = readRecord(directory, 'admission.json');
                    if (binding && binding.nonce === nonce && binding.sessionId === owner.ownerSessionId && binding.guardianPid === guardian.pid && binding.executableSha256 === identity.sha256) {
                        acknowledgeJoined(directory, binding, !!nativePid, nativePid);
                        physicalReceipt = true;
                    }
                }
                catch { }
            }
            const result: NativeSettlement = { cleanup: !failed && guardianCode === 0 && guardianClosed && pipeClosed && scopeJoined && durable && physicalReceipt ? 'confirmed' : 'unknown', exited: nativeExited, pipesClosed: pipeClosed, scopeJoined };
            if (result.cleanup !== 'confirmed')
                unknown = true;
            active.delete(settled);
            localNonces.delete(nonce);
            resolveSettlement(result);
        };
        const stop = () => { if (stopped || finished)
            return; stopped = true; facade.stdin.end(); if (guardian.connected)
            guardian.send({ type: 'stop', signal: 'SIGTERM' }, () => { }); killTimer = setTimeout(() => killKnown('SIGKILL'), 2500); deadline = setTimeout(() => { killKnown('SIGKILL'); finish(true); }, 6000); };
        facade = new NativeProcess(guardian.stdin!, guardian.stdout!, sig => {
            if (finished || !['SIGTERM', 'SIGKILL'].includes(sig))
                return false;
            if (guardian.connected) {
                guardian.send({ type: 'stop', signal: sig }, () => { });
                return true;
            }
            killKnown(sig);
            return !!nativePid;
        });
        // Never buffer native diagnostics; original SDK consumes only fd0/fd1.
        guardian.stderr!.resume();
        guardian.on('message', (message: any) => {
            if (message?.type === 'birth' && Number.isSafeInteger(message.pid) && message.pid > 0)
                nativePid = message.pid;
            else if (message?.type === 'native-exit' && !nativeExited) {
                nativeExited = true;
                facade.exitCode = message.code;
                facade.signalCode = message.signal;
                facade.emit('exit', message.code, message.signal);
            }
            else if (message?.type === 'settled') {
                terminal = message.terminal;
                if (!message.durable)
                    failed = true;
            }
            else
                failed = true;
        });
        guardian.once('error', () => { failed = true; facade.emit('error', Error('NATIVE_GUARDIAN_FAILED')); stop(); });
        guardian.once('exit', (code) => {
            guardianCode = code;
            // 'close' waits for native-inherited pipes; do not wait for it to
            // clean a still-live native group after losing its guardian.
            if (code !== 0 || !terminal) {
                failed = true;
                killKnown('SIGTERM');
                clearTimeout(killTimer);
                clearTimeout(deadline);
                killTimer = setTimeout(() => killKnown('SIGKILL'), 2000);
                deadline = setTimeout(() => { killKnown('SIGKILL'); finish(true); }, 5000);
            }
        });
        guardian.once('close', () => {
            guardianClosed = true;
            pipeClosed = true;
            if (!terminal)
                failed = true;
            if (!nativeExited) {
                failed = true;
                facade.emit('error', Error('NATIVE_PROCESS_EXIT_UNAVAILABLE'));
            }
            if (nativePid && !absent(nativePid, true)) {
                failed = true;
                killKnown('SIGTERM');
                clearTimeout(killTimer);
                clearTimeout(deadline);
                killTimer = setTimeout(() => killKnown('SIGKILL'), 2000);
                deadline = setTimeout(() => finish(true), 5000);
                poll = setInterval(() => finish(), 25);
            }
            else
                finish();
        });
        guardian.once('spawn', () => { if (guardian.connected)
            guardian.send({ type: 'launch', options: configuration }, error => { if (error) {
                failed = true;
                stop();
            } }); });
        stops.add(stop);
        signal?.addEventListener('abort', stop, { once: true });
        options.signal?.addEventListener('abort', stop, { once: true });
        if (signal?.aborted || options.signal?.aborted)
            stop();
        return { process: facade, settled };
    };
    return { launch, close };
}
