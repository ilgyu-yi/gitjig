/** Fixed installation migration/health supervisor. Built-ins only; never a task executor. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function read(file: string) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const s = fs.fstatSync(fd);
        if (!s.isFile() || s.uid !== process.getuid?.() || s.nlink !== 1 || (s.mode & 0o077) || s.size > 16384)
            throw Error('Unowned installation command');
        return fs.readFileSync(fd);
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
let disconnected = !process.connected, stop = () => { };
process.on('disconnect', () => { disconnected = true; stop(); });
process.on('message', m => {
    if (m && typeof m === 'object' && 'type' in m && m.type === 'cancel') {
        disconnected = true;
        stop();
    }
});
try {
    const descriptor = process.argv[2]!, bytes = read(descriptor), d = JSON.parse(bytes.toString()), directory = path.dirname(descriptor), descriptorHash = hash(bytes);
    if (d.format !== 1 || !['migrate', 'handshake', 'stable-health', 'loaded-health'].includes(d.kind) || !/^[a-f0-9-]{36}$/.test(d.commandId) || !/^[a-f0-9-]{36}$/.test(d.ownerId) || !/^[a-f0-9]{64}$/.test(d.payloadId) || d.timeoutMs !== 30000 || d.directory !== directory || fs.realpathSync(d.home) !== d.home || directory !== path.join(d.home, 'state', 'installation-children', d.ownerId, d.commandId) || fs.realpathSync(process.execPath) !== path.join(d.home, 'bootstrap/node'))
        throw Error('Installation descriptor identity differs');
    const expectedModule = d.kind === 'stable-health' ? path.join(d.home, 'bootstrap/bootstrap.js') : path.join(d.home, 'versions', d.payloadId, 'dist/installation', d.kind + '.js');
    if (d.module !== expectedModule || d.argument !== (d.kind === 'migrate' ? path.join(d.home, 'state', 'activation-' + d.ownerId, 'candidate.sqlite') : d.kind === 'stable-health' ? 'health' : d.kind === 'loaded-health' ? d.home : path.join(d.home, 'state', 'health-' + d.namespace)))
        throw Error('Installation worker scope differs');
    if (d.kind === 'handshake' && (typeof d.namespace !== 'string' || !d.namespace.startsWith(d.ownerId + '-') || !/^[a-f0-9-]{36}-(?:candidate|bound|rollback|committed-recovery|repeat)$/.test(d.namespace)))
        throw Error('Installation health namespace differs');
    if (fs.existsSync(path.join(directory, 'identity.json')) || fs.existsSync(path.join(directory, 'terminal.json')))
        throw Error('Installation command already admitted');
    atomic(directory, 'identity.json', { format: 1, commandId: d.commandId, descriptorHash, supervisorPid: process.pid, uid: process.getuid?.(), descriptor });
    if (disconnected) {
        atomic(directory, 'terminal.json', { format: 1, commandId: d.commandId, descriptorHash, workerPid: null, workerStarted: false, cleanup: 'confirmed', code: null, reason: 'Parent lifeline absent before worker creation' });
        process.exit(0);
    }
    const child = spawn(process.execPath, [d.module, d.argument], { cwd: d.home, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '', ...(d.kind === 'handshake' ? { TMPDIR: path.join(d.argument, 'artifacts') } : {}) } });
    atomic(directory, 'worker.json', { commandId: d.commandId, descriptorHash, workerPid: child.pid ?? null });
    let reason = 'completed', stopping = false, stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), overflow = false;
    let finalizing = false, workerCode: number | null = null;
    let drainTimer: ReturnType<typeof setTimeout> | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
    const boundDrain = () => {
        if (!drainTimer && !finalizing)
            drainTimer = setTimeout(() => { void finish(workerCode, true); }, 2000);
    };
    const kill = (signal: NodeJS.Signals) => {
        if (child.pid)
            try {
                process.kill(-child.pid, signal);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ESRCH')
                    reason = 'Owned worker group cleanup unavailable';
            }
    };
    stop = () => {
        if (stopping || finalizing)
            return;
        stopping = true;
        if (reason === 'completed')
            reason = disconnected ? 'Parent lifeline ended' : 'Deadline or output limit';
        kill('SIGTERM');
        killTimer = setTimeout(() => kill('SIGKILL'), 500);
        boundDrain();
    };
    const deadline = setTimeout(() => { reason = 'Installation worker deadline'; stop(); }, 30000);
    const collect = (chunk: Buffer, which: 'stdout' | 'stderr') => {
        const max = which === 'stdout' ? 2 * 1024 * 1024 : 256 * 1024, old = which === 'stdout' ? stdout : stderr, remaining = Math.max(0, max - old.length), next = Buffer.concat([old, chunk.subarray(0, remaining)]);
        if (which === 'stdout')
            stdout = next;
        else
            stderr = next;
        if (chunk.length > remaining) {
            overflow = true;
            reason = 'Installation worker output limit';
            stop();
        }
    };
    child.stdout.on('data', b => collect(b, 'stdout'));
    child.stderr.on('data', b => collect(b, 'stderr'));
    child.on('error', e => { reason = 'Worker spawn failed: ' + e.message; });
    child.on('exit', code => { workerCode = code; kill('SIGKILL'); boundDrain(); });
    async function finish(code: number | null, pipeDrainIncomplete = false) {
        if (finalizing) return;
        finalizing = true;
        clearTimeout(deadline);
        clearTimeout(drainTimer);
        clearTimeout(killTimer);
        kill('SIGKILL');
        // A child can exit while an out-of-group descendant retains its pipes.
        // Never turn that missing join into confirmed cleanup or complete output.
        if (pipeDrainIncomplete) {
            reason += '; worker output pipes did not close within the settlement bound';
            child.stdout.destroy();
            child.stderr.destroy();
        }
        let cleanup = pipeDrainIncomplete ? 'unknown' : 'confirmed';
        const until = Date.now() + 2000;
        while (child.pid) {
            try {
                process.kill(-child.pid, 0);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code === 'ESRCH')
                    break;
                cleanup = 'unknown';
                break;
            }
            if (Date.now() >= until) {
                cleanup = 'unknown';
                break;
            }
            await new Promise(r => setTimeout(r, 20));
        }
        for (const [name, data] of [['stdout', stdout], ['stderr', stderr]] as const) {
            const fd = fs.openSync(path.join(directory, name), 'wx', 0o600);
            try {
                fs.writeFileSync(fd, data);
                fs.fsyncSync(fd);
            }
            finally {
                fs.closeSync(fd);
            }
        }
        atomic(directory, 'terminal.json', { format: 1, commandId: d.commandId, descriptorHash, workerPid: child.pid ?? null, workerStarted: !!child.pid, cleanup, code, reason, overflow, ...(pipeDrainIncomplete ? { pipeDrainIncomplete: true } : {}) });
        process.exit(0);
    }
    child.on('close', code => { void finish(code); });
    if (disconnected)
        stop();
}
catch (error) {
    console.error(String(error));
    process.exit(2);
}
