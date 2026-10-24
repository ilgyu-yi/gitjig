/** Real Pi executor + original Agent SDK/MCP transport; controlled native, no model/account/network. */
import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { Type } from 'typebox';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitjig-permission-coherence-')));
fs.chmodSync(root, 0o700);
const cwd = path.join(root, 'project'), agentDir = path.join(root, 'agent');
fs.mkdirSync(cwd, { mode: 0o700 }); fs.mkdirSync(agentDir, { mode: 0o700 });
for (const key of Object.keys(process.env)) if (!['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SHELL'].includes(key)) delete process.env[key];
process.env.PI_CODING_AGENT_DIR = agentDir; process.env.TMPDIR = root; process.chdir(cwd);
fs.writeFileSync(path.join(agentDir, 'claude-bridge.json'), JSON.stringify({ askClaude: { enabled: false }, provider: { strictMcpConfig: true, autoMemoryEnabled: false, plan: 'pro', longContextExtraUsage: false } }), { mode: 0o600 });
const sdk = await import('@earendil-works/pi-coding-agent');
const bridgeEntry = import.meta.resolve('@gitjig/pi-claude-bridge-host');
const bridgeVersion = JSON.parse(fs.readFileSync(new URL('../package.json', bridgeEntry))).version;
const { createClaudeBridgeHost } = await import(bridgeEntry);
const pause = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw Error('Permission fixture boundary timed out'); }
const mutations = [], launches = [], sessions = [], executionGates = new Map();
let selectedScenario, expectedHostCleanup = 'confirmed';
const settings = { disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, enabledPlugins: { 'agents-md@builtin': false, 'bento-slides@bento': false, 'drop@drop': false, 'plugin-authoring@builtin': false } };
const host = createClaudeBridgeHost({ cwd, pathToClaudeCodeExecutable: process.execPath, env: { PATH: process.env.PATH, HOME: root }, settingSources: [], settings, observeNative() {},
    spawnNative({ ownerSessionId, options }) {
        const scenario = selectedScenario, child = new EventEmitter(), stdout = new PassThrough();
        let buffer = '', started = false, sequence = 0, resolveJoin;
        const replies = new Map(), settled = new Promise(resolve => { resolveJoin = resolve; });
        const launch = { ownerSessionId, scenario, options, frames: [], ready: false, responses: [] };
        const send = frame => { if (!stdout.destroyed && !stdout.writableEnded) stdout.write(JSON.stringify(frame) + '\n'); };
        const request = (subtype, fields) => new Promise(resolve => { const id = 'native-' + (++sequence); replies.set(id, resolve); send({ type: 'control_request', request_id: id, request: { subtype, ...fields } }); });
        const mcp = (method, params) => request('mcp_message', { server_name: 'custom-tools', message: { jsonrpc: '2.0', id: sequence + 1, method, params } });
        launch.invoke = (id, value, name = 'owned_mutation') => mcp('tools/call', { name, arguments: { value }, _meta: { 'claudecode/toolUseId': id } });
        launch.permission = (id, value, extra = {}) => request('can_use_tool', { tool_name: 'mcp__custom-tools__owned_mutation', input: { value }, tool_use_id: id, mcp_server: { name: 'custom-tools', source: 'sdk' }, ...extra });
        launch.assistant = calls => send({ type: 'assistant', session_id: 'native-' + ownerSessionId, parent_tool_use_id: null, message: { id: 'assistant-' + ownerSessionId, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: calls.map(([id, value]) => ({ type: 'tool_use', id, name: 'mcp__custom-tools__owned_mutation', input: { value } })), stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } });
        launch.stream = (id, value, trailingText) => {
            const event = event => send({ type: 'stream_event', session_id: 'native-' + ownerSessionId, parent_tool_use_id: null, event });
            event({ type: 'message_start', message: { id: 'stream-' + ownerSessionId, role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
            event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'mcp__custom-tools__owned_mutation', input: {} } });
            event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ value }) } });
            event({ type: 'content_block_stop', index: 0 });
            if (trailingText) { event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }); event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: trailingText } }); event({ type: 'content_block_stop', index: 1 }); }
            event({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } }); event({ type: 'message_stop' });
            if (trailingText) send({ type: 'assistant', session_id: 'native-' + ownerSessionId, parent_tool_use_id: null, message: { id: 'stream-' + ownerSessionId, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'mcp__custom-tools__owned_mutation', input: { value } }, { type: 'text', text: trailingText }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } });
        };
        launch.deny = id => send({ type: 'system', subtype: 'permission_denied', session_id: 'native-' + ownerSessionId, uuid: 'denial-' + ownerSessionId, tool_name: 'mcp__custom-tools__owned_mutation', tool_use_id: id, decision_reason_type: 'rule', message: 'Controlled mandatory policy refusal' });
        launch.finish = denials => send({ type: 'result', subtype: 'success', is_error: false, session_id: 'native-' + ownerSessionId, duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: 'CONTROLLED_NATIVE_RESULT', total_cost_usd: 0, permission_denials: denials ?? [], usage: { input_tokens: 1, output_tokens: 1 } });
        const stdin = new Writable({ write(chunk, _encoding, done) {
            buffer += chunk.toString(); let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue;
                const frame = JSON.parse(line); launch.frames.push(frame);
                if (frame.type === 'control_response') { replies.get(frame.response.request_id)?.(frame.response); replies.delete(frame.response.request_id); }
                if (frame.type === 'control_request') queueMicrotask(() => send({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: { commands: [], models: [], output_style: 'default', available_output_styles: [] } } }));
                if (frame.type === 'user' && !started) {
                    started = true;
                    void (async () => {
                        await mcp('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'controlled-native', version: '1' } });
                        const listing = await mcp('tools/list', {}); assert.deepEqual(listing.response.mcp_response.result.tools.map(tool => tool.name), ['owned_mutation']);
                        send({ type: 'system', subtype: 'init', session_id: 'native-' + ownerSessionId, model: 'claude-opus-5-5', cwd, tools: ['mcp__custom-tools__owned_mutation'], mcp_servers: [{ name: 'custom-tools', status: 'connected' }], plugins: [] });
                        launch.ready = true;
                        await scenario(launch);
                    })().catch(error => { launch.error = error; stdout.destroy(error); });
                }
            }
            done();
        } });
        Object.assign(child, { stdin, stdout, killed: false, exitCode: null, kill() { this.killed = true; return true; } });
        stdin.on('finish', () => { child.exitCode = 0; stdout.end(); child.emit('exit', 0, null); const cleanup = launch.cleanup ?? 'confirmed'; resolveJoin({ cleanup, exited: true, pipesClosed: true, scopeJoined: cleanup === 'confirmed' }); });
        launches.push(launch); return { process: child, settled };
    }
});
async function createSession(scenario) {
    selectedScenario = scenario;
    const runtime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' }, { projectTrusted: false });
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: [{ name: 'permission-coherence', factory: host.extension }], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, disabledBuiltinExtensions: ['mcp', 'codemode', 'tool_search'], systemPrompt: 'Controlled permission boundary.' });
    await loader.reload();
    const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, settingsManager, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(cwd), thinkingLevel: 'off', noTools: 'builtin', tools: ['owned_mutation'], customTools: [{ name: 'owned_mutation', label: 'Owned mutation', description: 'Append to the owned test journal', parameters: Type.Object({ value: Type.Number() }), async execute(id, input) { const row = { owner: session.sessionId, id, value: input.value }; fs.appendFileSync(path.join(root, 'mutation-journal.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 }); mutations.push(row); await executionGates.get(session.sessionId); return { content: [{ type: 'text', text: 'OWNED:' + input.value }], details: {} }; } }] });
    await session.bindExtensions({ mode: 'json', onError() {} }); await session.setModel(runtime.getModel('claude-bridge', 'claude-opus-5-5')); session.setActiveToolsByName(['owned_mutation']); sessions.push(session); return session;
}
const owned = session => mutations.filter(row => row.owner === session.sessionId);
async function run(t, scenario, verify) {
    const session = await createSession(scenario);
    try { await session.prompt('Exercise the controlled owned tool.'); const launch = launches.find(item => item.ownerSessionId === session.sessionId); if (launch?.error) throw launch.error; await verify(session, launch); }
    finally { fs.writeFileSync(path.join(root, 'session-' + session.sessionId + '.json'), JSON.stringify(session.messages, null, 2), { mode: 0o600 }); await session.abort(); assert.equal((await host.closeSession(session.sessionId)).cleanup, 'confirmed'); session.dispose(); }
}

test('native MCP invocation before assistant stream allows exactly one owned mutation', { timeout: 12000 }, async t => {
    await run(t, async launch => { const result = launch.invoke('call-before', 1); await pause(); assert.equal(mutations.filter(row => row.owner === launch.ownerSessionId).length, 0); launch.assistant([['call-before', 1]]); launch.responses.push(await result); launch.finish(); }, session => { assert.deepEqual(owned(session).map(row => [row.id, row.value]), [['call-before', 1]]); });
});
test('assistant tool stream cannot mutate before native MCP approval', { timeout: 12000 }, async t => {
    await run(t, async launch => { launch.stream('call-after', 2); for (let i = 0; i < 8; i++) await pause(); assert.equal(mutations.filter(row => row.owner === launch.ownerSessionId).length, 0, 'Streamed tool use is a proposal, not native permission'); launch.responses.push(await launch.invoke('call-after', 2)); launch.finish(); }, session => { assert.deepEqual(owned(session).map(row => [row.id, row.value]), [['call-after', 2]]); });
});
test('native denied tool with no MCP invocation causes zero actual side effects', { timeout: 12000 }, async t => {
    await run(t, async launch => { launch.assistant([['call-denied', 3]]); await pause(); launch.finish([{ tool_name: 'mcp__custom-tools__owned_mutation', tool_use_id: 'call-denied', tool_input: { value: 3 } }]); }, session => { assert.deepEqual(owned(session), []); });
});
test('hook-mutated MCP arguments cannot execute the unapproved assistant arguments', { timeout: 12000 }, async t => {
    await run(t, async launch => { launch.assistant([['call-mutated', 4]]); launch.responses.push(await launch.invoke('call-mutated', 400)); launch.finish(); }, session => { assert.deepEqual(owned(session), [], 'Mismatched native invocation must refuse rather than execute original or modified request'); });
});
test('serial native MCP calls from one assistant message do not wait for every handler', { timeout: 12000 }, async t => {
    await run(t, async launch => { launch.assistant([['serial-a', 5], ['serial-b', 6]]); launch.responses.push(await launch.invoke('serial-a', 5)); assert.deepEqual(mutations.filter(row => row.owner === launch.ownerSessionId).map(row => row.id), ['serial-a']); launch.responses.push(await launch.invoke('serial-b', 6)); launch.finish(); }, session => { assert.deepEqual(owned(session).map(row => [row.id, row.value]), [['serial-a', 5], ['serial-b', 6]]); });
});
test('parallel reversed native invocation preserves exact tool IDs and arguments', { timeout: 12000 }, async t => {
    await run(t, async launch => { launch.assistant([['parallel-a', 7], ['parallel-b', 8]]); launch.responses.push(...await Promise.all([launch.invoke('parallel-b', 8), launch.invoke('parallel-a', 7)])); launch.finish(); }, session => { assert.deepEqual(owned(session).map(row => [row.id, row.value]).sort(), [['parallel-a', 7], ['parallel-b', 8]]); });
});
test('mandatory native denial event cannot be ignored while a streamed tool waits', { timeout: 12000 }, async t => {
    await run(t, async launch => { launch.stream('policy-denied', 9); await pause(); launch.deny('policy-denied'); launch.finish([{ tool_name: 'mcp__custom-tools__owned_mutation', tool_use_id: 'policy-denied', tool_input: { value: 9 } }]); }, session => { assert.deepEqual(owned(session), []); });
});
test('terminal native result without a proposed call invocation cannot execute it', { timeout: 12000 }, async t => {
    await run(t, async launch => { launch.assistant([['uninvoked', 10]]); launch.finish(); }, session => { assert.deepEqual(owned(session), []); });
});
test('closing the original owner while its proposal waits cannot execute that proposal', { timeout: 12000 }, async () => {
    const session = await createSession(async launch => { launch.stream('closed-proposal', 11); launch.parked = true; });
    const turn = session.prompt('Exercise controlled close.');
    await waitFor(() => launches.find(item => item.ownerSessionId === session.sessionId)?.parked);
    await pause();
    assert.equal((await host.closeSession(session.sessionId)).cleanup, 'confirmed'); await turn;
    assert.deepEqual(owned(session), []); fs.writeFileSync(path.join(root, 'session-' + session.sessionId + '.json'), JSON.stringify(session.messages, null, 2), { mode: 0o600 }); session.dispose();
});
test('original SDK permission callback allows only the owned role tool without blanket bypass', { timeout: 12000 }, async t => {
    await run(t, async launch => {
        launch.assistant([['explicit-allow', 12]]); await pause();
        const permission = await launch.permission('explicit-allow', 12);
        assert.equal(permission.response?.behavior, 'allow', JSON.stringify(permission));
        assert.equal(permission.response?.updatedPermissions, undefined, 'A single permission decision cannot persist broader rules');
        assert.equal(launch.options.args.includes('--dangerously-skip-permissions'), false);
        assert.equal(launch.options.args.includes('--allow-dangerously-skip-permissions'), false);
        assert.equal(launch.options.args[launch.options.args.indexOf('--permission-mode') + 1], 'default');
        launch.responses.push(await launch.invoke('explicit-allow', 12)); launch.finish();
    }, session => { assert.deepEqual(owned(session).map(row => [row.id, row.value]), [['explicit-allow', 12]]); });
});
for (const [label, extra] of [
    ['managed forced-human ask', { matched_ask_rule: { source: 'policySettings', tool_name: 'mcp__custom-tools__owned_mutation' } }],
    ['user forced-human ask', { matched_ask_rule: { source: 'userSettings', tool_name: 'mcp__custom-tools__owned_mutation' } }],
    ['native explicit human-interaction requirement', { requires_user_interaction: true }],
    ['configured server masquerading as owned MCP', { mcp_server: { name: 'custom-tools', source: 'plugin' } }],
    ['unserved role tool', { tool_name: 'mcp__custom-tools__forbidden' }],
]) test('original SDK permission callback refuses ' + label, { timeout: 12000 }, async t => {
    await run(t, async launch => {
        launch.assistant([['permission-refused', 13]]); await pause();
        const permission = await launch.permission('permission-refused', 13, extra);
        assert.equal(permission.response?.behavior, 'deny', JSON.stringify(permission));
        assert.equal(permission.response?.updatedPermissions, undefined);
        launch.finish([{ tool_name: 'mcp__custom-tools__owned_mutation', tool_use_id: 'permission-refused', tool_input: { value: 13 } }]);
    }, session => { assert.deepEqual(owned(session), []); });
});
test('duplicate native invocation after a consumed ID cannot execute again or silently succeed', { timeout: 12000 }, async t => {
    await run(t, async launch => {
        launch.assistant([['duplicate-id', 14]]);
        launch.responses.push(await launch.invoke('duplicate-id', 14));
        launch.duplicateAttempted = true;
        launch.responses.push(await launch.invoke('duplicate-id', 14)); launch.finish();
    }, (session, launch) => {
        assert.equal(launch.duplicateAttempted, true);
        assert.deepEqual(owned(session).map(row => [row.id, row.value]), [['duplicate-id', 14]]);
        assert.equal(session.messages.at(-1).stopReason, 'error', 'Consumed-ID replay is an explicit refusal');
    });
});
for (const cleanup of ['confirmed', 'unknown']) test('denial while an approved action is running preserves terminal failure and ' + cleanup + ' cleanup', { timeout: 12000 }, async () => {
    let release; const action = new Promise(resolve => { release = resolve; });
    const session = await createSession(async launch => {
        launch.cleanup = cleanup;
        launch.assistant([['active-approved', 15], ['parallel-denied', 16]]);
        void launch.invoke('active-approved', 15);
        await waitFor(() => mutations.some(row => row.owner === launch.ownerSessionId && row.id === 'active-approved'));
        launch.deny('parallel-denied'); launch.finish([{ tool_name: 'mcp__custom-tools__owned_mutation', tool_use_id: 'parallel-denied', tool_input: { value: 16 } }]); launch.denialSent = true;
    });
    executionGates.set(session.sessionId, action);
    const turn = session.prompt('Exercise denial while approved action is running.');
    try {
        await waitFor(() => launches.find(item => item.ownerSessionId === session.sessionId)?.denialSent);
        for (let i = 0; i < 8; i++) await pause(); release(); await turn;
        assert.deepEqual(owned(session).map(row => [row.id, row.value]), [['active-approved', 15]]);
        assert.equal(session.messages.at(-1).stopReason, 'error', 'A later orphan tool result must not erase the original native denial');
        assert.match(session.messages.at(-1).errorMessage, cleanup === 'confirmed' ? /PERMISSION_DENIED/ : /CLEANUP_UNKNOWN/);
    } finally { if (cleanup === 'unknown') expectedHostCleanup = 'unknown'; fs.writeFileSync(path.join(root, 'session-' + session.sessionId + '.json'), JSON.stringify(session.messages, null, 2), { mode: 0o600 }); release(); executionGates.delete(session.sessionId); await session.abort(); assert.equal((await host.closeSession(session.sessionId)).cleanup, cleanup); session.dispose(); }
});
test('native handler preceding a streamed tool preserves trailing same-message prose exactly once', { timeout: 12000 }, async t => {
    const prose = 'I have requested the owned action and will inspect its result.';
    await run(t, async launch => {
        const result = launch.invoke('stream-with-prose', 17); await pause(); await pause();
        launch.stream('stream-with-prose', 17, prose); launch.responses.push(await result); launch.finish();
    }, session => {
        assert.deepEqual(owned(session).map(row => [row.id, row.value]), [['stream-with-prose', 17]]);
        const text = session.messages.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
        assert.equal(text.split(prose).length - 1, 1, 'Native permission gating cannot discard or duplicate legitimate same-message prose');
    });
});
test('a retained native denial cannot claim a sibling owner result with the same tool-use ID', { timeout: 12000 }, async t => {
    let release; const action = new Promise(resolve => { release = resolve; });
    const original = await createSession(async launch => {
        launch.assistant([['shared-id', 20], ['original-denied', 22]]); void launch.invoke('shared-id', 20);
        await waitFor(() => mutations.some(row => row.owner === launch.ownerSessionId && row.id === 'shared-id'));
        launch.deny('original-denied'); launch.finish([{ tool_name: 'mcp__custom-tools__owned_mutation', tool_use_id: 'original-denied', tool_input: { value: 22 } }]); launch.denialSent = true;
    });
    executionGates.set(original.sessionId, action);
    const originalTurn = original.prompt('Exercise a retained original denial.');
    try {
        await waitFor(() => launches.find(item => item.ownerSessionId === original.sessionId)?.denialSent);
        for (let i = 0; i < 8; i++) await pause();
        await run(t, async launch => { launch.assistant([['shared-id', 21]]); launch.responses.push(await launch.invoke('shared-id', 21)); launch.finish(); }, sibling => {
            assert.deepEqual(owned(sibling).map(row => [row.id, row.value]), [['shared-id', 21]]);
            assert.equal(sibling.messages.at(-1).stopReason, 'stop', 'Sibling result stays with its actual owner');
            assert.equal(sibling.messages.at(-1).errorMessage, undefined);
        });
        release(); await originalTurn;
        assert.deepEqual(owned(original).map(row => [row.id, row.value]), [['shared-id', 20]]);
        assert.equal(original.messages.at(-1).stopReason, 'error'); assert.match(original.messages.at(-1).errorMessage, /PERMISSION_DENIED/);
    } finally { fs.writeFileSync(path.join(root, 'session-' + original.sessionId + '.json'), JSON.stringify(original.messages, null, 2), { mode: 0o600 }); release(); executionGates.delete(original.sessionId); await original.abort(); assert.equal((await host.closeSession(original.sessionId)).cleanup, 'confirmed'); original.dispose(); }
});

test.after(async () => { for (const session of sessions) { await session.abort(); await host.closeSession(session.sessionId); } assert.equal((await host.close()).cleanup, expectedHostCleanup); fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify({ bridgeEntry, bridgeVersion, node: process.version, actualPi: true, actualSDKMcp: true, syntheticNative: true, expectedHostCleanup, mutations }, null, 2), { mode: 0o600 }); console.log('Owned permission evidence: ' + root + ' (' + bridgeVersion + ')'); });
