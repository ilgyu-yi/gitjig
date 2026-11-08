// External installed-only qualification. This is not shipped or a general sandbox.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import net from 'node:net';
import workers from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
const payload = fs.realpathSync(process.env.GITJIG_STATUS_PAYLOAD);
const mode = process.env.GITJIG_STATUS_MODE;
if (!['seed', 'ui'].includes(mode)) throw Error('Explicit installed status qualification mode required');
const record = (kind, value) => fs.appendFileSync(process.env.GITJIG_STATUS_TRACE,
    JSON.stringify({label: process.env.GITJIG_STATUS_LABEL, pid: process.pid, kind, ...value}) + '\n', {mode: 0o600});
let denied = 0;
const deny = kind => { denied++; record('denied', {boundary: kind}); throw Error('Installed status qualification denied: ' + kind); };
globalThis.fetch = () => deny('fetch');
net.Socket.prototype.connect = () => deny('socket');
for (const method of ['spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[method] = () => deny(method);
const spawn = cp.spawn;
cp.spawn = (binary, args, ...rest) => {
    if (mode !== 'seed' || binary !== process.execPath || args[0] !== path.join(payload, 'dist/effects/git-process-child.js')) return deny('spawn');
    record('native-module', {file: args[0]});
    return spawn(binary, args, ...rest);
};
const Worker = workers.Worker;
workers.Worker = class extends Worker {
    constructor(file, options) {
        const name = typeof file === 'string' ? path.resolve(file) : fileURLToPath(file);
        if (mode !== 'seed' || name !== path.join(payload, 'dist/controller/capture-worker.js')) deny('worker');
        record('capture-worker', {file: name});
        super(file, options);
    }
};
syncBuiltinESMExports();
registerHooks({resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (result.url.startsWith('file:')) {
        const file = fs.realpathSync(fileURLToPath(result.url));
        if (!file.startsWith(payload + path.sep)) {
            if (mode === 'seed' && context.parentURL === undefined && file === process.env.GITJIG_STATUS_DRIVER) return result;
            return deny('module outside installed payload');
        }
        record('module', {file});
    }
    return result;
}});
process.on('exit', () => { if (denied) process.exitCode = 1; });
