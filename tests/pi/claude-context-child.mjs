/** Original host/SDK admission, owned metadata only; no native client or transport. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';

const [root, mode] = process.argv.slice(2);
const cwd = path.join(root, 'host'), agentDir = path.join(root, 'agent');
const nativeHome = path.join(root, 'native-home'), account = path.join(nativeHome, '.claude');
const settings = path.join(nativeHome, '.claude.json'), project = path.join(nativeHome, 'project');
const artifacts = path.join(root, 'artifacts');
for (const folder of [cwd, agentDir, nativeHome, project, artifacts, path.join(root, 'state')])
    fs.mkdirSync(folder, {mode: 0o700});
fs.writeFileSync(path.join(agentDir, 'claude-bridge.json'), JSON.stringify({askClaude: {enabled: false}, provider: {strictMcpConfig: true, autoMemoryEnabled: false}}), {mode: 0o600});
let processes = 0, network = 0;
const noProcess = () => {processes++; throw Error('CONTEXT_NATIVE_FORBIDDEN');};
const noNetwork = () => {network++; throw Error('CONTEXT_NETWORK_FORBIDDEN');};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = noProcess;
globalThis.fetch = noNetwork;
net.Socket.prototype.connect = noNetwork;
for (const api of [http, https]) for (const name of ['request', 'get']) api[name] = noNetwork;
syncBuiltinESMExports();

// Seed irrelevant selectors before importing the actual SDK/bridge modules.
process.env.TMPDIR = artifacts;
process.env.CLAUDE_BRIDGE_DEBUG = '1';
process.env.CLAUDE_BRIDGE_DEBUG_PATH = path.join(root, 'ambient-debug');
process.env.CLAUDE_BRIDGE_RECORD_STREAM = path.join(root, 'ambient-record');
process.env.ANTHROPIC_API_KEY = 'DUMMY_NEVER_SELECTED';
process.env.NODE_OPTIONS = 'DUMMY_NEVER_FORWARDED';
process.env.DOCKER_HOST = 'unix:///DUMMY';
// SDK builtin availability may probe ambient credential existence, even though
// these entries have no bridge execution authority. Never read their contents.
const ambientAccount = path.join(root, 'AMBIENT_ADC');
process.env.GOOGLE_APPLICATION_CREDENTIALS = ambientAccount;
let ambientExistence = 0, ambientContent = 0;
const access = fs.promises.access.bind(fs.promises);
fs.promises.access = async (file, ...args) => {
    if (String(file) === ambientAccount) {ambientExistence++; throw Object.assign(Error('ABSENT_OWNED_ADC'), {code: 'ENOENT'});}
    return access(file, ...args);
};
for (const [api, name] of [[fs.promises, 'readFile'], [fs, 'readFileSync']]) {
    const original = api[name].bind(api);
    api[name] = (file, ...args) => {
        if (String(file) === ambientAccount) {ambientContent++; throw Error('AMBIENT_ACCOUNT_CONTENT_FORBIDDEN');}
        return original(file, ...args);
    };
}
syncBuiltinESMExports();
const {createOwnedClaudeHost, ownedClaudeAuthorityRoots} = await import('../../dist/pi/claude-host.js');
const {initializePiHost, createPiSession} = await import('../../dist/pi/index.js');
const {assertNativeClaudeAccountRoute} = await import('../../dist/pi/claude-profile.js');
const environment = {PATH: '/usr/bin:/bin', HOME: nativeHome, TMPDIR: artifacts};
const file = fs.realpathSync(process.execPath);
const input = {cwd, agentDir, environment, executable: {file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')}};
let expected;
if (mode === 'public-account') {fs.mkdirSync(account, {mode: 0o755}); expected = /owner-private/;}
if (mode === 'linked-account') {fs.symlinkSync(project, account); expected = /canonical/;}
if (mode === 'dangling-account') {fs.symlinkSync(path.join(root, 'ABSENT'), account); expected = /ENOENT/;}
if (mode === 'unsafe-settings') {fs.writeFileSync(settings, '{}', {mode: 0o644}); expected = /owner-private regular file/;}
if (mode === 'explicit-missing') {environment.CLAUDE_CONFIG_DIR = account; expected = /ENOENT/;}
if (mode === 'missing-home') {delete environment.HOME; expected = /HOME.*canonical/;}
if (mode === 'invalid-home-override') {input.nativeAccountHome = ''; expected = /HOME.*canonical/;}
if (mode === 'object-path') {environment.PATH = {toString() {throw Error('MUTABLE_VALUE_COERCED');}}; expected = /string values without NUL: PATH/;}
if (mode === 'nul-temp') {environment.TMPDIR += '\0'; expected = /string values without NUL: TMPDIR/;}
if (mode === 'temp-project') environment.TMPDIR = project;
if (mode === 'temp-missing') delete environment.TMPDIR;
if (mode === 'temp-drift') fs.mkdirSync(account, {mode: 0o700});
if (expected) {
    await assert.rejects(createOwnedClaudeHost(input), expected);
} else {
    assert.ok(['snapshot', 'advanced-default', 'advanced-explicit', 'concurrent', 'retry', 'temp-project', 'temp-missing', 'temp-drift'].includes(mode));
    let controller;
    if (mode.startsWith('advanced-')) {
        if (mode === 'advanced-explicit') {
            fs.mkdirSync(account, {mode: 0o700});
            environment.CLAUDE_CONFIG_DIR = account;
        }
        const {openController} = await import('../../dist/controller/index.js');
        controller = await openController({installationHome: path.join(root, 'application')});
    }
    if (mode === 'retry') {
        const configuration = path.join(agentDir, 'claude-bridge.json'), original = fs.readFileSync(configuration);
        fs.writeFileSync(configuration, JSON.stringify({askClaude: {enabled: true}, provider: {strictMcpConfig: true, autoMemoryEnabled: false}}));
        await assert.rejects(createOwnedClaudeHost(input), /fixed no-helper/);
        fs.writeFileSync(configuration, original);
    }
    const parent = {...process.env}, parentDirectory = process.cwd();
    let creating;
    if (controller) {
        const profile = path.join(root, 'model-profile.json');
        fs.writeFileSync(profile, JSON.stringify({provider: 'claude-bridge', modelId: 'claude-opus-5-5',
            native: {kind: 'installed-claude-bridge', cwd, agentDir, executable: input.executable}}), {mode: 0o600});
        const {selectControllerModel} = await import('../../dist/cli/selected-model.js');
        creating = selectControllerModel(profile, controller, environment).then(selection => selection.bridge);
    } else creating = createOwnedClaudeHost(input);
    if (mode === 'concurrent')
        await assert.rejects(createOwnedClaudeHost(input), /One fixed explicit bridge host/);
    environment.HOME = path.join(root, 'MUTATED_INPUT');
    environment.CLAUDE_CONFIG_DIR = path.join(root, 'MUTATED_ACCOUNT');
    const owner = await creating;
    let session;
    try {
        assert.deepEqual({...process.env}, parent);
        assert.equal(process.cwd(), parentDirectory);
        assert.deepEqual(ownedClaudeAuthorityRoots(owner), [cwd, agentDir, file, account, ...(mode === 'advanced-explicit' ? [] : [settings])]);
        process.env.HOME = path.join(root, 'LATER_PARENT_HOME');
        process.env.CLAUDE_CONFIG_DIR = path.join(root, 'LATER_PARENT_ACCOUNT');
        process.env.PI_CODING_AGENT_DIR = path.join(root, 'LATER_PARENT_PI');
        process.chdir(project);
        assert.ok((await owner.models()).length > 1);
        assert.equal(fs.existsSync(account), ['advanced-explicit', 'temp-drift'].includes(mode), 'Catalogue must not create a login store');
        if (!['advanced-explicit', 'temp-drift'].includes(mode))
            assert.throws(() => assertNativeClaudeAccountRoute(nativeHome, account), /ENOENT/, 'Native birth cannot use catalogue absence allowance');
        const host = await initializePiHost({stateRoot: path.join(root, 'state'), artifactRoot: artifacts});
        const operations = workspaceRoot => ({workspaceRoot, validatePath: p => path.resolve(workspaceRoot, p),
            async exec() {throw Error('NO_EXEC');}, async readFile() {throw Error('NO_READ');}, async access() {throw Error('NO_ACCESS');},
            async writeFile() {throw Error('NO_WRITE');}, async mkdir() {throw Error('NO_MKDIR');}});
        const options = {host, model: owner.modelSelection, systemPrompt: 'Unprompted explicit context', maxReadBytes: 1024};
        await assert.rejects(createPiSession({...options, operations: operations(nativeHome)}), /authority paths.*outside/);
        if (['temp-project', 'temp-missing'].includes(mode)) {
            await assert.rejects(createPiSession({...options, operations: operations(project)}), /Native Claude TMPDIR.*owned Pi artifact root/);
        } else {
            session = await createPiSession({...options, operations: operations(project)});
            assert.equal(session.session.model.provider, 'claude-bridge');
            await assert.rejects(session.modelRuntime.getAuth('anthropic'), /another provider credential/);
            const foreign = session.modelRuntime.getModels('anthropic')[0];
            assert.ok(foreign, 'Builtin catalogue entries are metadata, not bridge authority');
            assert.throws(() => session.modelRuntime.streamSimple(foreign, {messages: []}, {sessionId: session.sessionManager.getSessionId()}), /another provider\/model/);
            assert.equal(fs.existsSync(account), ['advanced-explicit', 'temp-drift'].includes(mode));
            if (mode === 'temp-drift') {
                await session.session.extensionRunner.emitBeforeAgentStart({messageType: 'user', prompt: 'Controlled temp preflight'},
                    {cwd: project, customPrompt: session.session.systemPrompt, selectedTools: session.session.getActiveToolNames(), skills: [], contextFiles: []});
                await session.session.extensionRunner.emit({type: 'agent_start'});
                const request = async () => {
                    const result = await session.modelRuntime.streamSimple(session.session.model,
                        {systemPrompt: session.session.systemPrompt, messages: []}, {sessionId: session.sessionManager.getSessionId()}).result();
                    assert.equal(result.stopReason, 'error');
                    return result.errorMessage;
                };
                try {
                    fs.chmodSync(artifacts, 0o755);
                    assert.match(await request(), /Native Claude temporary directory.*owner-private/);
                    assert.equal(processes, 0);
                    fs.chmodSync(artifacts, 0o700);
                    fs.chmodSync(account, 0o755);
                    assert.match(await request(), /owner-private/);
                    assert.equal(processes, 0, 'Pre-native temp refusal creates no cleanup hold');
                } finally {fs.chmodSync(artifacts, 0o700); fs.chmodSync(account, 0o700);}
            }
        }
        assert.equal(process.cwd(), project);
        assert.ok(ambientExistence > 0, 'Retain actual builtin SDK existence-probe evidence');
    } finally {await session?.closeOwned(); await owner.close(); await controller?.close();}
    await assert.rejects(createOwnedClaudeHost({...input, environment: {HOME: nativeHome, TMPDIR: artifacts}}), /One fixed explicit bridge host/);
}
assert.equal(ambientContent, 0);
assert.equal(processes, 0);
assert.equal(network, 0);
assert.equal(fs.existsSync(path.join(root, 'ambient-debug')), false);
assert.equal(fs.existsSync(path.join(root, 'ambient-record')), false);
console.log(JSON.stringify({mode, complete: true, processes, network}));
