/** Actual adapter and SDK. Controlled storage/metadata refusals, no native client or model transport. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';

let processAttempts = 0, networkAttempts = 0;
const refuseProcess = () => {processAttempts++; throw Error('UNEXPECTED_DIAGNOSTIC_NATIVE_BIRTH');};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = refuseProcess;
const refuseNetwork = () => {networkAttempts++; throw Error('UNEXPECTED_DIAGNOSTIC_NETWORK');};
globalThis.fetch = refuseNetwork;
net.Socket.prototype.connect = refuseNetwork;
for (const api of [http, https]) for (const name of ['request', 'get']) api[name] = refuseNetwork;
syncBuiltinESMExports();

const root = process.argv[2], agentDir = path.join(root, 'agent'), project = path.join(root, 'project');
const {createOwnedClaudeHost} = await import('../../dist/pi/claude-host.js');
const {initializePiHost, createPiSession} = await import('../../dist/pi/index.js');
const executable = fs.realpathSync(process.execPath);
const owner = await createOwnedClaudeHost({environment: {...process.env},cwd: path.join(root, 'host'), agentDir,
    executable: {file: executable, sha256: createHash('sha256').update(fs.readFileSync(executable)).digest('hex')}});
const host = await initializePiHost({stateRoot: path.join(root, 'state'), artifactRoot: path.join(root, 'artifacts')});
const operations = {workspaceRoot: project, validatePath: p => path.resolve(project, p),
    async exec() {throw Error('NO_PROJECT_EXEC');}, async readFile() {throw Error('NO_PROJECT_READ');},
    async access() {throw Error('NO_PROJECT_ACCESS');}, async writeFile() {throw Error('NO_PROJECT_WRITE');}, async mkdir() {throw Error('NO_PROJECT_MKDIR');}};
const prompt = 'Controlled diagnostic context';
const pi = await createPiSession({host, operations, model: owner.modelSelection, systemPrompt: prompt, maxReadBytes: 1024});
const diagnosticFile = path.join(agentDir, 'bridge-last-diagnostic.json');
const request = async () => {
    try {
        const result = await pi.modelRuntime.streamSimple(pi.session.model,
            {systemPrompt: pi.session.systemPrompt, messages: []}, {sessionId: pi.sessionManager.getSessionId()}).result();
        assert.equal(result.stopReason, 'error');
        return result.errorMessage;
    } catch (error) {return error.message;}
};
try {
    await pi.session.extensionRunner.emitBeforeAgentStart({messageType: 'user', prompt: 'Controlled diagnostic'},
        {cwd: project, customPrompt: prompt, selectedTools: pi.session.getActiveToolNames(), skills: [], contextFiles: []});
    await pi.session.extensionRunner.emit({type: 'agent_start'});
    // The native account refusal is reached only after successful diagnostic persistence.
    fs.chmodSync(path.join(root, 'native-account'), 0o755);
    fs.mkdirSync(diagnosticFile, {mode: 0o700});
    assert.match(await request(), /EISDIR|is a directory/);
    assert.equal(processAttempts, 0);
    assert.equal(fs.readdirSync(agentDir).some(name => name.endsWith('.tmp')), false);
    fs.rmdirSync(diagnosticFile);
    assert.match(await request(), /owner-private/);
    const diagnostic = JSON.parse(fs.readFileSync(diagnosticFile, 'utf8'));
    assert.equal(diagnostic.label, 'empty_prompt');
    assert.equal(diagnostic.details.contextLength, 0);
    assert.equal(fs.lstatSync(diagnosticFile).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(path.join(process.env.HOME, '.pi/agent/claude-bridge-diag.log')), false);
    assert.equal(processAttempts, 0);
    assert.equal(networkAttempts, 0);
} finally {
    fs.chmodSync(path.join(root, 'native-account'), 0o700);
    try {await pi.closeOwned();} finally {await owner.close();}
}
console.log(JSON.stringify({writeFailurePreserved: true, retryDiagnosticPersisted: true, processAttempts, networkAttempts, cleanup: 'joined'}));
