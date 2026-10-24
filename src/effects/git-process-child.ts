/** Installed one-command native Git supervisor. No daemon or project resource. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
interface Descriptor {
    version: 1;
    authProfile?: 'fd4-config-env-v1';
    parentPid: number;
    commandId: string;
    directory: string;
    binary: string;
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    maxStdout: number;
    excerptBytes: number;
    inputBytes: number;
    inputSha256: string;
}
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
let disconnected = !process.connected, cancelled = false, stopping = false;
let authStream: fs.ReadStream | undefined;
let secretLiterals: string[] = [];
const sanitize = (bytes: Buffer): Buffer => {
    let value = bytes.toString('utf8');
    for (const literal of secretLiterals)
        value = value.split(literal).join('[REDACTED]');
    return Buffer.from(value);
};
let stopChild: () => void = () => { };
process.on('disconnect', () => { disconnected = true; stopChild(); });
process.on('message', value => {
    if (value && typeof value === 'object' && 'type' in value && value.type === 'cancel') {
        cancelled = true;
        stopChild();
    }
});
const descriptorPath = process.argv[2];
let admitted: Descriptor | undefined, admittedIdentity: Record<string, unknown> | undefined, actualGitStarted = false;
function ownedFile(file: string, max: number): Buffer {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > max)
            throw new Error('Unowned supervisor input');
        const bytes = Buffer.alloc(stat.size + 1);
        let count = 0;
        while (count < bytes.length) {
            const n = fs.readSync(fd, bytes, count, bytes.length - count, count);
            if (!n)
                break;
            count += n;
        }
        if (count !== stat.size)
            throw new Error('Supervisor input changed');
        return bytes.subarray(0, count);
    }
    finally {
        fs.closeSync(fd);
    }
}
function atomic(directory: string, name: string, value: unknown) {
    const temp = path.join(directory, name + '.tmp'), fd = fs.openSync(temp, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, JSON.stringify(value));
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temp, path.join(directory, name));
    const parent = fs.openSync(directory, 'r');
    try {
        fs.fsyncSync(parent);
    }
    finally {
        fs.closeSync(parent);
    }
}
function writeBytes(file: string, bytes: Buffer) {
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
}
try {
    if (!descriptorPath || !path.isAbsolute(descriptorPath))
        throw new Error('Missing installed supervisor descriptor');
    const d = JSON.parse(ownedFile(descriptorPath, 1024 * 1024).toString('utf8')) as Descriptor;
    const dir = fs.lstatSync(d.directory);
    const parentGone = () => disconnected || !process.connected || Number(execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'ppid='], { env: { PATH: '/usr/bin:/bin', LANG: 'C' }, encoding: 'utf8', timeout: 1000 }).trim()) !== d.parentPid;
    if (d.version !== 1 || !/^[-a-z0-9]+$/.test(d.commandId) || !dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o077) || fs.realpathSync(d.directory) !== d.directory || descriptorPath !== path.join(d.directory, 'descriptor.json'))
        throw new Error('Invalid owned command descriptor');
    if (!path.isAbsolute(d.binary) || fs.realpathSync(d.binary) !== d.binary || !Array.isArray(d.argv) || d.argv.some(v => typeof v !== 'string' || v.includes('\0')) || !Number.isSafeInteger(d.timeoutMs) || d.timeoutMs < 1 || d.timeoutMs > 120000 || !Number.isSafeInteger(d.maxStdout) || d.maxStdout < 1 || d.maxStdout > 512 * 1024 * 1024 + 1)
        throw new Error('Unsupported supervisor command bounds');
    const identity = { commandId: d.commandId, pid: process.pid, uid: process.getuid?.(), startIdentity: execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart=', '-o', 'command='], { env: { PATH: '/usr/bin:/bin', LANG: 'C' }, encoding: 'utf8', timeout: 1000 }).trim() };
    atomic(d.directory, 'lifecycle.json', { ...identity, phase: 'HELPER_READY', gitPid: null });
    admitted = d;
    admittedIdentity = identity;
    let auth: Buffer | undefined;
    if (d.authProfile !== undefined) {
        if (d.authProfile !== 'fd4-config-env-v1')
            throw Error('Unsupported auth profile');
        auth = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            let length = 0, done = false;
            const timer = setTimeout(() => finish(Error('Credential envelope deadline')), d.timeoutMs);
            const finish = (error?: Error) => {
                if (done)
                    return;
                done = true;
                clearTimeout(timer);
                authStream?.destroy();
                if (error) {
                    reject(error);
                    return;
                }
                const frame = Buffer.concat(chunks);
                if (frame.length < 5 || frame.readUInt32BE(0) !== frame.length - 4 || frame.length > 8196) {
                    reject(Error('Credential envelope incomplete'));
                    return;
                }
                resolve(Buffer.from(frame.subarray(4)));
                frame.fill(0);
            };
            authStream = fs.createReadStream('', { fd: 4, autoClose: true });
            const stop = () => finish(Error('Credential owner disconnected/cancelled'));
            stopChild = stop;
            authStream.on('data', (chunk: Buffer | string) => {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                length += bytes.length;
                if (length > 8196) {
                    finish(Error('Credential envelope over limit'));
                    return;
                }
                chunks.push(bytes);
            });
            authStream.once('end', () => finish());
            authStream.once('error', () => finish(Error('Credential pipe unavailable')));
            if (parentGone() || cancelled)
                stop();
        });
        const token = auth.toString('utf8');
        if (!token || /[\x00-\x20\x7f]/.test(token))
            throw Error('Credential envelope invalid');
        const encoded = Buffer.from('x-access-token:' + token).toString('base64');
        secretLiterals = [token, encoded, 'Basic ' + encoded, 'Authorization: Basic ' + encoded];
        // The launcher environment and durable descriptor never contain this value.
        d.env = { ...d.env, GITJIG_HTTP_AUTH: 'Authorization: Basic ' + encoded };
        auth.fill(0);
    }
    let gitPid: number | null = null, gitStarted = false, done = false, aborted = false, timedOut = false, truncated = false, settled = false;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let stdoutBytes = 0, stderrBytes = 0;
    const stdoutHash = createHash('sha256');
    let forceTimer: NodeJS.Timeout | undefined, unknownTimer: NodeJS.Timeout | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    const finish = (exitCode: number | null, cleanup: 'confirmed' | 'unknown') => {
        if (done)
            return;
        done = true;
        clearTimeout(deadline);
        if (forceTimer)
            clearTimeout(forceTimer);
        if (unknownTimer)
            clearTimeout(unknownTimer);
        if (cleanup === 'unknown') {
            // Descendants can retain these pipes after the leader exits. An
            // unavailable group must not keep the supervisor alive indefinitely.
            child?.stdin?.destroy();
            child?.stdout?.destroy();
            child?.stderr?.destroy();
        }
        const rawOut = Buffer.concat(stdout), rawErrors = Buffer.concat(stderr);
        const bytes = d.authProfile ? sanitize(rawOut) : rawOut, errors = d.authProfile ? sanitize(rawErrors) : rawErrors;
        writeBytes(path.join(d.directory, 'stdout.bin'), bytes);
        writeBytes(path.join(d.directory, 'stderr.bin'), errors);
        atomic(d.directory, 'result.json', { identity, gitPid, gitStarted, cleanup, exitCode, stdout: bytes.subarray(0, d.excerptBytes).toString('utf8'), stderr: errors.toString('utf8'), stdoutBytes: d.authProfile ? bytes.length : stdoutBytes, stdoutSha256: d.authProfile ? sha(bytes) : stdoutHash.digest('hex'), sanitizedAuthDiagnostics: !!d.authProfile, stdoutExcerpted: bytes.length > d.excerptBytes, truncated, timedOut, aborted, settled });
        atomic(d.directory, 'terminal.json', { ...identity, gitPid, gitStarted, cleanup });
        if (process.connected)
            process.disconnect();
        process.exitCode = cleanup === 'confirmed' ? 0 : 2;
    };
    const kill = (force: boolean) => {
        try {
            if (gitPid && process.platform !== 'win32')
                process.kill(-gitPid, force ? 'SIGKILL' : 'SIGTERM');
            else
                child?.kill(force ? 'SIGKILL' : 'SIGTERM');
        }
        catch { /* close/owned result determines cleanup */ }
    };
    stopChild = () => {
        if (done)
            return;
        aborted = cancelled || disconnected;
        if (!gitStarted) {
            stopping = true;
            return;
        }
        kill(false);
        if (!forceTimer)
            forceTimer = setTimeout(() => kill(true), 500);
        if (!unknownTimer)
            unknownTimer = setTimeout(() => finish(null, 'unknown'), 2000);
    };
    const deadline = setTimeout(() => { timedOut = true; stopChild(); }, d.timeoutMs);
    if (parentGone() || cancelled || stopping) {
        aborted = true;
        settled = true;
        finish(null, 'confirmed');
    }
    else {
        const input = ownedFile(path.join(d.directory, 'stdin.bin'), d.maxStdout > d.inputBytes ? d.maxStdout : d.inputBytes);
        if (input.length !== d.inputBytes || sha(input) !== d.inputSha256)
            throw new Error('Command stdin changed');
        // Parent lifeline is IPC fd3; Git receives ONLY these three explicit
        // streams and cannot retain the lifeline through a native descendant.
        if (parentGone() || cancelled || stopping) {
            aborted = true;
            settled = true;
            finish(null, 'confirmed');
        }
        else {
            child = spawn(d.binary, d.argv, { cwd: d.cwd, env: d.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
            gitPid = child.pid ?? null;
            gitStarted = gitPid !== null;
            actualGitStarted = gitStarted;
            atomic(d.directory, 'git-start.json', { ...identity, gitPid, gitStarted });
            child.stdout!.on('data', (chunk: Buffer) => {
                stdoutBytes += chunk.length;
                stdoutHash.update(chunk);
                if (stdoutBytes <= d.maxStdout)
                    stdout.push(chunk);
                else {
                    truncated = true;
                    stopChild();
                }
            });
            child.stderr!.on('data', (chunk: Buffer) => {
                stderrBytes += chunk.length;
                if (stderrBytes <= d.excerptBytes)
                    stderr.push(chunk);
                else {
                    truncated = true;
                    stopChild();
                }
            });
            child.once('error', error => { stderr.push(Buffer.from(String(error))); });
            // Leader exit and closed stdio do not establish group cleanup: a
            // helper may close its pipes and continue after Git has exited.
            child.once('exit', () => stopChild());
            child.once('close', async (code) => {
                settled = true;
                const until = Date.now() + 1500;
                while (!done && gitPid && process.platform !== 'win32') {
                    try {
                        process.kill(-gitPid, 0);
                    }
                    catch (error) {
                        finish(code, (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'confirmed' : 'unknown');
                        return;
                    }
                    if (Date.now() >= until) {
                        finish(code, 'unknown');
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                finish(code, 'confirmed');
            });
            child.stdin!.on('error', () => { });
            child.stdin!.end(input);
            if (parentGone() || cancelled)
                stopChild();
        }
    }
}
catch (error) {
    if (admitted && admittedIdentity && !actualGitStarted) {
        try {
            const empty = Buffer.alloc(0), diagnostic = sanitize(Buffer.from(String(error))).toString('utf8');
            writeBytes(path.join(admitted.directory, 'stdout.bin'), empty);
            writeBytes(path.join(admitted.directory, 'stderr.bin'), Buffer.from(diagnostic));
            atomic(admitted.directory, 'result.json', { identity: admittedIdentity, gitPid: null, gitStarted: false, cleanup: 'confirmed', exitCode: null, stdout: '', stderr: diagnostic, stdoutBytes: 0, stdoutSha256: sha(empty), stdoutExcerpted: false, truncated: false, timedOut: false, aborted: true, settled: true });
            atomic(admitted.directory, 'terminal.json', { ...admittedIdentity, gitPid: null, gitStarted: false, cleanup: 'confirmed' });
        }
        catch { /* Missing exact receipt remains UNKNOWN, never inferred clean. */ }
    }
    process.stderr.write('Owned Git supervisor unavailable: ' + sanitize(Buffer.from(String(error))).toString('utf8') + '\n');
    process.exitCode = 2;
    if (process.connected)
        process.disconnect();
}
