/** Real Pi executor + original Agent SDK/MCP transport; controlled native, no model/account/network. */
import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createCoordinationTools } from '../../dist/pi/coordination.js';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitjig-result-sdk-pages-')));
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
const observation={resultId:'original-result',conversationId:'original-child',workId:'original-work',assignmentId:'original-assignment',result:{phase:'BLOCKED',epoch:4,reviewReady:false,blocked:['Independent adjudicator must decide exact original held inputs'],nextAction:'Request the original independent procedure',detail:'한😀\\\"\u0000'.repeat(3000)}};
let scopeAllowed=true;const reads=[];
const launches = [], sessions = [];
let selectedScenario;
const settings = { disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, enabledPlugins: { 'agents-md@builtin': false, 'bento-slides@bento': false, 'drop@drop': false, 'plugin-authoring@builtin': false } };
const host = createClaudeBridgeHost({ cwd, pathToClaudeCodeExecutable: process.execPath, env: { PATH: process.env.PATH, HOME: root }, settingSources: [], settings, observeNative() {},
    spawnNative({ ownerSessionId, options }) {
        const scenario = selectedScenario, child = new EventEmitter(), stdout = new PassThrough();
        let buffer = '', started = false, sequence = 0, resolveJoin;
        const replies = new Map(), settled = new Promise(resolve => { resolveJoin = resolve; });
        const launch = { ownerSessionId, options, frames: [] };
        const send = frame => { if (!stdout.destroyed && !stdout.writableEnded) stdout.write(JSON.stringify(frame) + '\n'); };
        const request = (subtype, fields) => new Promise(resolve => { const id = 'native-' + (++sequence); replies.set(id, resolve); send({ type: 'control_request', request_id: id, request: { subtype, ...fields } }); });
        const mcp = (method, params) => request('mcp_message', { server_name: 'custom-tools', message: { jsonrpc: '2.0', id: sequence + 1, method, params } });
        launch.invoke = (id, value, name = 'conversation_result') => mcp('tools/call', { name, arguments: value, _meta: { 'claudecode/toolUseId': id } });
        launch.assistant = calls => send({ type: 'assistant', session_id: 'native-' + ownerSessionId, parent_tool_use_id: null, message: { id: 'assistant-' + ownerSessionId, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: calls.map(([id, value]) => ({ type: 'tool_use', id, name: 'mcp__custom-tools__conversation_result', input: value })), stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } });
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
                        const listing = await mcp('tools/list', {}); assert.deepEqual(listing.response.mcp_response.result.tools.map(tool => tool.name), ['conversation_result']);
                        send({ type: 'system', subtype: 'init', session_id: 'native-' + ownerSessionId, model: 'claude-opus-5-5', cwd, tools: ['mcp__custom-tools__conversation_result'], mcp_servers: [{ name: 'custom-tools', status: 'connected' }], plugins: [] });
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
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: [{ name: 'result-sdk-pages', factory: host.extension }], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, disabledBuiltinExtensions: ['mcp', 'codemode', 'tool_search'], systemPrompt: 'Controlled permission boundary.' });
    await loader.reload();
    const tool = createCoordinationTools({ status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),result(input){ reads.push(input); if(!scopeAllowed) throw Error('outside captured result scope'); return observation; } },()=>{}).find(t=>t.name==='conversation_result');
    const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, settingsManager, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(cwd), thinkingLevel: 'off', noTools: 'builtin', tools: ['conversation_result'], customTools: [tool] });
    await session.bindExtensions({ mode: 'json', onError() {} }); await session.setModel(runtime.getModel('claude-bridge', 'claude-opus-5-5')); session.setActiveToolsByName(['conversation_result']); sessions.push(session); return session;
}
async function run(t, scenario, verify) {
    const session = await createSession(scenario);
    try { await session.prompt('Exercise the controlled owned tool.'); const launch = launches.find(item => item.ownerSessionId === session.sessionId); if (launch?.error) throw launch.error; await verify(session, launch); }
    finally { fs.writeFileSync(path.join(root, 'session-' + session.sessionId + '.json'), JSON.stringify(session.messages, null, 2), { mode: 0o600 }); await session.abort(); assert.equal((await host.closeSession(session.sessionId)).cleanup, 'confirmed'); session.dispose(); }
}


const response = frame => frame.response.mcp_response.result;
const decoded = frame => {const result=response(frame); const text=result.content.filter(p=>p.type==='text').map(p=>p.text).join('');assert.ok(Buffer.byteLength(text)<=8192);return {result,text};};
test('original SDK HostedQuery and permission gate carry bounded summary and exact UTF8 pages', {timeout:20000},async t=>{
 let reconstructed='',pages=0;const count=reads.length;
 await run(t,async launch=>{
  let sequence=0;
  const call=async args=>{const id='result-'+sequence++;launch.assistant([[id,args]]);return decoded(await launch.invoke(id,args));};
  const first=await call({resultId:'original-result'});assert.equal(first.result.isError,false);const summary=JSON.parse(first.text);assert.equal(summary.kind,'conversation-result-summary/v1');assert.deepEqual(summary.result.blocked,observation.result.blocked);
  let cursor=0;do{const next=await call({resultId:'original-result',cursor,fingerprint:summary.fullJSON.fingerprint});assert.equal(next.result.isError,false);const page=JSON.parse(next.text);assert.equal(page.cursor,cursor);reconstructed+=page.text;cursor=page.nextCursor;pages++;assert.ok(pages<150);}while(cursor!==null);
  assert.equal(createHash('sha256').update(reconstructed).digest('hex'),summary.fullJSON.fingerprint);launch.finish();
 },session=>{assert.equal(reconstructed,JSON.stringify(observation));assert.ok(pages>1);assert.equal(reads.length-count,pages+1);assert.equal(session.messages.at(-1).stopReason,'stop');});
});
test('original SDK receives hash and scoped-read errors without bypassing captured result authority', {timeout:12000},async t=>{
 await run(t,async launch=>{
  const call=async(id,args)=>{launch.assistant([[id,args]]);return decoded(await launch.invoke(id,args));};
  const bad=await call('bad-hash',{resultId:'original-result',cursor:0,fingerprint:'0'.repeat(64)});assert.equal(bad.result.isError,true);assert.match(bad.text,/fingerprint/);
  scopeAllowed=false;
  const scoped=await call('scope',{resultId:'original-result',cursor:0,fingerprint:'0'.repeat(64)});assert.equal(scoped.result.isError,true);assert.match(scoped.text,/outside captured result scope/);assert.doesNotMatch(scoped.text,/fingerprint mismatch/);scopeAllowed=true;launch.finish();
 },session=>assert.equal(session.messages.at(-1).stopReason,'stop'));
});
test.after(async()=>{for(const session of sessions){await session.abort();await host.closeSession(session.sessionId);}assert.equal((await host.close()).cleanup,'confirmed');assert.ok(reads.every(input=>JSON.stringify(input)==='{"resultId":"original-result"}'));fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify({bridgeEntry,bridgeVersion,node:process.version,actualPi:true,actualSDKMcp:true,syntheticNative:true,modelCalls:0,reads},null,2),{mode:0o600});console.log('Owned SDK result evidence: '+root);});
