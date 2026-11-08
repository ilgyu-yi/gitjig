// Controlled installed consumer only. Never part of the product payload.
import fs from 'node:fs';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {pathToFileURL} from 'node:url';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
const base = pathToFileURL(process.env.GITJIG_TEST_PAYLOAD + '/').href;
const traceFile = process.env.GITJIG_TEST_TRACE;
if (!traceFile || !process.env.GITJIG_TEST_PAYLOAD) throw Error('Explicit installed control inputs required');
const urls = [], counts = {network: 0, process: 0, foreignImport: 0};
let traceLimit = false;
const network = () => {counts.network++;throw Error('Network forbidden in source update control');};
const processAttempt = () => {counts.process++;throw Error('Child process forbidden in source update control');};
globalThis.fetch = network;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = tls.connect = net.Socket.prototype.connect = network;
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = processAttempt;
syncBuiltinESMExports();
registerHooks({resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (result.url.startsWith('file:') && !result.url.startsWith(base)) {
        counts.foreignImport++;throw Error('Foreign installed import refused: ' + result.url);
    }
    if (urls.length >= 8192) {traceLimit = true;throw Error('Installed control import trace limit');}
    urls.push(result.url);return result;
}});
process.on('exit', () => fs.writeFileSync(traceFile, JSON.stringify({urls, counts, traceLimit}), {mode: 0o600}));
