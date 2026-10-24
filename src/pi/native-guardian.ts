/** Fixed shipped native-birth owner. Never reads or writes native protocol fd0/1/2. */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { absent, ownerDirectory, writeRecord, type OwnerBinding, type Terminal } from './native-owner-records.js';
const [root, nonce, sessionId, purpose, hostText, digest] = process.argv.slice(2);
let binding: OwnerBinding | undefined, directory: string | undefined, child: ChildProcess | undefined;
let configured = false, stopping = false, finished = false, uncertain = false, created = false, exited = false;
let reason = 'NATIVE_EXIT', exitCode: number | null = null, signalCode: NodeJS.Signals | null = null;
let killTimer: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
let configTimer: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;
let lifeline: net.Socket | undefined;
const notify = (value: unknown) => { if (process.connected)
    try {
        process.send?.(value, () => { });
    }
    catch { } };
process.on('error', () => { uncertain = true; stop('HOST_CONTROL_ERROR'); });
const groupGone = () => !child?.pid || absent(child.pid, true);
function signalGroup(signal: NodeJS.Signals) {
    if (child?.pid)
        try {
            process.kill(-child.pid, signal);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
                uncertain = true;
        }
}
function finish(force = false) {
    if (finished || !force && (!exited && created || !groupGone()))
        return;
    finished = true;
    clearTimeout(killTimer);
    clearTimeout(deadline);
    clearTimeout(configTimer);
    clearInterval(poll);
    const groupAbsent = groupGone();
    let stdioReleased = true;
    for (const fd of [0, 1, 2])
        try {
            fs.closeSync(fd);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EBADF')
                stdioReleased = false;
        }
    const terminal: Terminal | undefined = binding ? { ...binding, nativeCreated: created, nativePid: created ? child!.pid! : null, pgid: created ? child!.pid! : null,
        exitCode, signal: signalCode, exited, stdioReleased, groupAbsent, cleanup: !uncertain && stdioReleased && groupAbsent && (!created || exited) ? 'confirmed' : 'unknown', reason, finishedAt: Date.now() } : undefined;
    let durable = false;
    try {
        if (directory && terminal) {
            writeRecord(directory, 'settlement.json', terminal);
            durable = true;
        }
    }
    catch {
        uncertain = true;
    }
    notify({ type: 'settled', terminal, durable });
    lifeline?.destroy();
    // Nothing on protocol stdout/stderr. IPC callback drains only fixed metadata.
    if (process.connected)
        process.disconnect();
    process.exitCode = durable && terminal?.cleanup === 'confirmed' ? 0 : 2;
}
function stop(why: string) {
    if (finished)
        return;
    if (!stopping) {
        reason = why;
        stopping = true;
        clearTimeout(configTimer);
        signalGroup('SIGTERM');
        killTimer = setTimeout(() => signalGroup('SIGKILL'), 2000);
        deadline = setTimeout(() => { signalGroup('SIGKILL'); uncertain ||= !groupGone(); finish(true); }, 5000);
    }
    if (!created)
        finish();
}
try {
    if (!root || !nonce || !sessionId || !['provider', 'summary'].includes(purpose!) || !/^[a-f0-9]{64}$/.test(digest!) || !Number.isSafeInteger(Number(hostText)) || Number(hostText) < 1)
        throw Error('BOOTSTRAP_INVALID');
    directory = ownerDirectory(root, nonce);
    binding = { version: 1, nonce, sessionId, purpose: purpose as 'provider' | 'summary', uid: process.getuid!(), hostPid: Number(hostText), guardianPid: process.pid, executableSha256: digest!, createdAt: Date.now() };
    writeRecord(directory, 'admission.json', binding);
    lifeline = new net.Socket({ fd: 3, readable: true, writable: false });
    lifeline.on('end', () => stop('HOST_LIFELINE_EOF'));
    lifeline.on('error', () => stop('HOST_LIFELINE_ERROR'));
    lifeline.resume();
    process.on('disconnect', () => stop('HOST_CONTROL_CLOSED'));
    process.on('SIGTERM', () => stop('GUARDIAN_STOP'));
    process.on('SIGINT', () => stop('GUARDIAN_STOP'));
    if (process.ppid !== binding.hostPid)
        stop('HOST_ALREADY_GONE');
    if (!finished)
        configTimer = setTimeout(() => stop('CONFIGURATION_TIMEOUT'), 5000);
    process.on('message', (message: any) => {
        if (finished)
            return;
        if (message?.type === 'stop' && Object.keys(message).length === 2 && ['SIGTERM', 'SIGKILL'].includes(message.signal)) {
            stop('OWNER_STOP');
            if (message.signal === 'SIGKILL')
                signalGroup('SIGKILL');
            return;
        }
        if (configured || stopping || message?.type !== 'launch' || Object.keys(message).length !== 2) {
            uncertain = true;
            stop('CONTROL_INVALID');
            return;
        }
        configured = true;
        clearTimeout(configTimer);
        void (async () => {
            try {
                const input = message.options;
                if (!input || Object.keys(input).some(k => !['command', 'args', 'cwd', 'env'].includes(k)) || typeof input.command !== 'string' || !path.isAbsolute(input.command) || !Array.isArray(input.args) || input.args.some((x: unknown) => typeof x !== 'string') || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd) || !input.env || typeof input.env !== 'object' || Array.isArray(input.env) || Object.values(input.env).some(v => typeof v !== 'string') || Buffer.byteLength(JSON.stringify(input)) > 512 * 1024)
                    throw Error('CONFIGURATION_INVALID');
                const info = fs.lstatSync(input.command);
                if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(input.command) !== input.command || (info.mode & 0o022) || !(info.mode & 0o111) || createHash('sha256').update(fs.readFileSync(input.command)).digest('hex') !== binding!.executableSha256)
                    throw Error('EXECUTABLE_CHANGED');
                if (stopping || process.ppid !== binding!.hostPid) {
                    stop('HOST_ALREADY_GONE');
                    return;
                }
                child = spawn(input.command, input.args, { cwd: input.cwd, env: input.env, detached: true, stdio: [0, 1, 2] });
                created = Number.isSafeInteger(child.pid) && child.pid! > 0;
                child.once('error', () => { uncertain = true; stop('NATIVE_SPAWN_ERROR'); });
                child.once('exit', (code, signal) => { exited = true; exitCode = code; signalCode = signal; notify({ type: 'native-exit', code, signal }); if (!groupGone())
                    stop('LEADER_EXIT_WITH_GROUP'); finish(); });
                if (created) {
                    try {
                        writeRecord(directory!, 'birth.json', { ...binding!, nativePid: child.pid!, pgid: child.pid!, startedAt: Date.now() });
                    }
                    catch {
                        uncertain = true;
                        stop('BIRTH_RECORD_FAILED');
                    }
                    notify({ type: 'birth', pid: child.pid });
                    poll = setInterval(() => finish(), 25);
                    if (stopping || process.ppid !== binding!.hostPid)
                        stop('HOST_ALREADY_GONE');
                }
            }
            catch {
                uncertain = true;
                stop('NATIVE_ADMISSION_FAILED');
            }
        })();
    });
}
catch {
    uncertain = true;
    stop('GUARDIAN_BOOTSTRAP_FAILED');
}
