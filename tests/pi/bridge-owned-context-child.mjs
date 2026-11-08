/** Real public SDK contexts and bridge preflight; no native birth, account or model transport. */
import '../normal-hosted/no-external.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import {InMemoryCredentialStore, InMemoryModelsStore} from '@earendil-works/pi-ai';
import {createClaudeBridgeHost} from '@gitjig/pi-claude-bridge-host';
import {ownChatRuntime} from '../../dist/pi/owned-runtime.js';

const [mode, root] = process.argv.slice(2);
const noSink = mode === 'no-sink';
const project = path.join(root, 'project'), state = path.join(root, 'state');
for (const directory of [project, state, process.env.PI_CODING_AGENT_DIR]) fs.mkdirSync(directory, {mode: 0o700});
const configFile = path.join(process.env.PI_CODING_AGENT_DIR, 'claude-bridge.json');
const originalConfig = JSON.stringify(noSink ? {askClaude: {enabled: false}, provider: {strictMcpConfig: true, autoMemoryEnabled: false}} : {ownerSentinel: 'preserve'});
fs.writeFileSync(configFile, originalConfig, {mode: 0o600});
const diagnostics = [], unhandled = [];
process.on('unhandledRejection', error => unhandled.push(String(error)));
let nativeBirths = 0;
const host = createClaudeBridgeHost({
    cwd: root,
    pathToClaudeCodeExecutable: process.execPath,
    env: {HOME: root, CLAUDE_CONFIG_DIR: path.join(root, 'native-account')},
    settingSources: [],
    settings: {disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false,
        enabledPlugins: {'agents-md@builtin': false, 'plugin-authoring@builtin': false}},
    ...(noSink ? {} : {reportDiagnostic(event) {
        assert.ok(Object.isFrozen(this));
        assert.equal(this.env.HOME, root);
        assert.ok(Object.isFrozen(event));
        assert.ok(Object.isFrozen(event.details));
        diagnostics.push(event);
        if (mode === 'sync-failure') throw Error('CONTROLLED_DIAGNOSTIC_FAILURE');
        if (mode === 'async-failure') return Promise.reject(Error('CONTROLLED_ASYNC_FAILURE'));
        if (mode === 'close-owner') void host.close();
    }}),
    assertNativeLaunch() {throw Error('CONTROLLED_NATIVE_PREFLIGHT');},
    spawnNative() {nativeBirths++; throw Error('UNEXPECTED_NATIVE_BIRTH');},
    observeNative() {assert.fail('No native observation is possible');},
});
// Omit the welcome marker and plan deliberately: standalone TUI initialization would persist a notice.
const runtime = await sdk.ModelRuntime.create({credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false});
const manager = sdk.SessionManager.create(project, state);
const owner = ownChatRuntime(runtime, {
    assertModel(model) {assert.equal(model.provider, 'claude-bridge');},
    beforeAuth() {},
    assertRequest(_model, options) {assert.equal(options.sessionId, manager.getSessionId());},
});
let loader, loaded;
if (noSink) {
    // The legacy hosted initializer also requires owned diagnostics when a warning occurs.
    loader = new sdk.DefaultResourceLoader({cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR,
        settingsManager: sdk.SettingsManager.inMemory(), extensionFactories: [host.extension],
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        disabledBuiltinExtensions: ['mcp', 'codemode', 'tool_search'], systemPrompt: 'Controlled owned context'});
    await loader.reload();
    loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
} else {
    const registration = host.registration({askClaude: {enabled: false}, provider: {strictMcpConfig: true, autoMemoryEnabled: false}});
    runtime.registerProvider(registration.provider.name, registration.provider.config);
    const extensionPath = '<inline:owned-context-test>';
    const extension = {path: extensionPath, resolvedPath: extensionPath,
        sourceInfo: sdk.createSyntheticSourceInfo(extensionPath, {source: 'inline'}), handlers: registration.handlers,
        tools: new Map(), messageRenderers: new Map(), entryRenderers: new Map(), commands: new Map(),
        flags: new Map(), shortcuts: new Map()};
    loaded = {extensions: [extension], errors: [], runtime: sdk.createExtensionRuntime()};
    loader = {
        getExtensions: () => loaded, getSkills: () => ({skills: [], diagnostics: []}),
        getPrompts: () => ({prompts: [], diagnostics: []}), getThemes: () => ({themes: [], diagnostics: []}),
        getAgentsFiles: () => ({agentsFiles: []}), getSystemPrompt: () => 'Controlled owned context',
        getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
        extendResources() {throw Error('UNEXPECTED_AMBIENT_RESOURCE');}, async reload() {},
    };
}
const model = runtime.getModel('claude-bridge', 'claude-opus-5-5');
if (!noSink) assert.ok(model);
const {session} = await sdk.createAgentSession({cwd: project, agentDir: state, modelRuntime: runtime, ...(model ? {model} : {}),
    sessionManager: manager, resourceLoader: loader, noTools: 'all', tools: [],
    settingsManager: sdk.SettingsManager.inMemory({compaction: {enabled: false}, retry: {enabled: false}, cacheWarming: 'off'})});
let cleanup;
try {
    await session.bindExtensions({mode: 'tui'});
    if (noSink) {
        const selected = runtime.getModel('claude-bridge', 'claude-opus-5-5');
        assert.ok(selected);
        await session.setModel(selected);
    }
    await session.extensionRunner.emitBeforeAgentStart({messageType: 'user', prompt: 'Controlled context'},
        {cwd: project, customPrompt: 'Controlled owned context', selectedTools: [], skills: [], contextFiles: []});
    await session.extensionRunner.emit({type: 'agent_start'});
    // An empty provider context reaches the real diagnostic/continuation path, not a test-only hook.
    let failure;
    try {
        const result = await runtime.streamSimple(session.model, {systemPrompt: session.systemPrompt, messages: []},
            {sessionId: manager.getSessionId()}).result();
        if (result.stopReason === 'error') failure = result.errorMessage;
    } catch (error) {failure = error.message;}
    const expected = {observe: /CONTROLLED_NATIVE_PREFLIGHT/, 'sync-failure': /CONTROLLED_DIAGNOSTIC_FAILURE/,
        'async-failure': /BRIDGE_HOST_DIAGNOSTIC_ASYNC_UNSUPPORTED/, 'close-owner': /BRIDGE_HOST_OWNER_CLOSED/, 'no-sink': /BRIDGE_HOST_DIAGNOSTIC_REQUIRED/};
    assert.match(failure, expected[mode]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(diagnostics.length, noSink ? 0 : 1);
    if (!noSink) {
    assert.equal(diagnostics[0].label, 'empty_prompt');
    assert.equal(diagnostics[0].details.contextLength, 0);
    }
    assert.equal(nativeBirths, 0);
    assert.equal(fs.readFileSync(configFile, 'utf8'), originalConfig);
    assert.equal(fs.existsSync(path.join(process.env.HOME, '.pi/agent/claude-bridge-diag.log')), false);
} finally {
    session.dispose();
    loaded.runtime.invalidate();
    await owner.close();
    await owner.join();
    cleanup = (await host.close()).cleanup;
    assert.equal(cleanup, 'confirmed');
}
console.log(JSON.stringify({mode, nativeBirths, cleanup, ambientConfigurationPreserved: true, ambientLogCreated: false}));
