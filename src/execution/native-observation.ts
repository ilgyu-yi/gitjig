import { spawn } from 'node:child_process';
import { ControllerError } from '../controller/types.js';
/** Finite owner-requested native read, not an agent sandbox. Own the process group and pipes. */
interface NativeObservationOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
    kind: 'Git' | 'Docker discovery' | 'Claude setup';
    allowedExitCodes?: readonly number[];
}
export async function readNativeObservation(file: string, args: string[], options: NativeObservationOptions): Promise<Buffer> {
    return (await readNativeObservationResult(file, args, options)).stdout;
}
export function readNativeObservationResult(file: string, args: string[], options: NativeObservationOptions): Promise<{ stdout: Buffer; exitCode: number }> {
    const name = options.kind, cleanupCode = name === 'Git' ? 'LOCAL_GIT_CLEANUP_UNKNOWN' : name === 'Claude setup' ? 'CLAUDE_SETUP_CLEANUP_UNKNOWN' : 'RUNTIME_DISCOVERY_CLEANUP_UNKNOWN';
    if (process.platform === 'win32')
        return Promise.reject(Error('Native Windows process-group ownership unavailable'));
    if (options.signal.aborted)
        return Promise.reject(options.signal.reason ?? Error(name + ' observation cancelled'));
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let closed = false, finished = false, reason: Error | undefined, bytes = 0, exitCode = -1;
        const accepted = (code: number | null) => code !== null && (options.allowedExitCodes ?? [0]).includes(code);
        const output: Buffer[] = [];
        let cleanup: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;
        const gone = () => {
            if (!child.pid)
                return true;
            try {
                process.kill(-child.pid, 0);
                return false;
            }
            catch (error) {
                return (error as NodeJS.ErrnoException).code === 'ESRCH';
            }
        };
        const kill = () => {
            if (child.pid)
                try {
                    process.kill(-child.pid, 'SIGKILL');
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
                        reason = Error(name + ' group termination unavailable');
                }
        };
        const finish = () => {
            if (finished || !closed || !gone())
                return;
            finished = true;
            clearTimeout(deadline);
            clearTimeout(cleanup);
            clearInterval(poll);
            options.signal.removeEventListener('abort', cancel);
            if (reason)
                reject(reason);
            else
                resolve({ stdout: Buffer.concat(output), exitCode });
        };
        const stop = (failure: Error) => {
            if (finished)
                return;
            reason ??= failure;
            kill();
            if (!cleanup) {
                poll = setInterval(finish, 20);
                cleanup = setTimeout(() => {
                    if (finished)
                        return;
                    kill();
                    if (closed && gone()) {
                        finish();
                        return;
                    }
                    finished = true;
                    clearTimeout(deadline);
                    clearInterval(poll);
                    options.signal.removeEventListener('abort', cancel);
                    child.stdout.destroy();
                    child.stderr.destroy();
                    child.unref();
                    reject(new ControllerError(cleanupCode, 'Native ' + name + ' observation cleanup could not be confirmed', 'Inspect only the recorded native process group ' + (child.pid ?? 'not-started') + ' on this host before retrying. No complete observation, rollback or successful cleanup is claimed.'));
                }, 2000);
            }
            finish();
        };
        const cancel = () => stop(Error(name + ' observation cancelled')), deadline = setTimeout(() => stop(Error(name + ' observation exceeded its five-second deadline')), 5000);
        const collect = (chunk: Buffer, stdout: boolean) => {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) {
                stop(Error(name + ' observation exceeded 1 MiB'));
                return;
            }
            if (stdout)
                output.push(chunk);
        };
        child.stdout.on('data', chunk => collect(chunk, true));
        child.stderr.on('data', chunk => collect(chunk, false));
        child.on('error', error => stop(error));
        child.on('exit', (code, signal) => {
            if (!accepted(code) || signal)
                stop(Error('Native ' + name + ' observation failed'));
            else if (!gone())
                stop(Error('Native ' + name + ' observation left an unsettled process group'));
        });
        child.on('close', (code, signal) => {
            closed = true;
            exitCode = code ?? -1;
            if (!accepted(code) || signal)
                reason ??= Error('Native ' + name + ' observation failed');
            if (!gone())
                stop(Error('Native ' + name + ' observation left an unsettled process group'));
            finish();
        });
        options.signal.addEventListener('abort', cancel, { once: true });
        if (options.signal.aborted)
            cancel();
    });
}
