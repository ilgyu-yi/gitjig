/** Real Pi executor + original Agent SDK/MCP transport; controlled native, no model/account/network. */
import '../normal-hosted/no-external.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { Type } from 'typebox';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitjig-thinking-options-')));
fs.chmodSync(root, 0o700);
const cwd = path.join(root, 'project'), agentDir = path.join(root, 'agent');
fs.mkdirSync(cwd, { mode: 0o700 }); fs.mkdirSync(agentDir, { mode: 0o700 });
const retainFixture = process.env.GITJIG_RETAIN_THINKING_FIXTURE === '1';
const evidencePath = process.env.GITJIG_THINKING_EVIDENCE;
for (const key of Object.keys(process.env)) if (!['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SHELL'].includes(key)) delete process.env[key];
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = agentDir; process.env.TMPDIR = root; process.chdir(cwd);
fs.writeFileSync(path.join(agentDir, 'claude-bridge.json'), JSON.stringify({ askClaude: { enabled: false }, provider: { strictMcpConfig: true, autoMemoryEnabled: false, plan: 'pro', longContextExtraUsage: false } }), { mode: 0o600 });
const bridgeEntry = import.meta.resolve('@gitjig/pi-claude-bridge-host');
const bridgePackageUrl = new URL('../', bridgeEntry).href;
const sdkCalls=[];globalThis.__gitjigThinkingCalls=sdkCalls;
const originalSdk=import.meta.resolve('@anthropic-ai/claude-agent-sdk'),shim=path.join(root,'sdk-observer.mjs');
fs.writeFileSync(shim,`import * as sdk from ${JSON.stringify(originalSdk)};export * from ${JSON.stringify(originalSdk)};export function query(input){globalThis.__gitjigThinkingCalls.push({thinking:structuredClone(input.options?.thinking??null),effort:input.options?.effort??null,persistSession:input.options?.persistSession??null});return sdk.query(input);}`,{mode:0o600});
registerHooks({resolve(specifier,context,next){if(specifier==='@anthropic-ai/claude-agent-sdk'&&context.parentURL?.startsWith(bridgePackageUrl))return {url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
const sdk = await import('@earendil-works/pi-coding-agent');
const bridgeVersion = JSON.parse(fs.readFileSync(new URL('../package.json', bridgeEntry))).version;
const { createClaudeBridgeHost } = await import(bridgeEntry);
const pause = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw Error('Permission fixture boundary timed out'); }
const launches = [];
let completed=0;
let selectedScenario;
const settings = { disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, enabledPlugins: { 'agents-md@builtin': false, 'plugin-authoring@builtin': false } };
const host = createClaudeBridgeHost({ cwd, pathToClaudeCodeExecutable: process.execPath, env: { PATH: process.env.PATH, HOME: root }, settingSources: [], settings, observeNative() {}, reportDiagnostic() {},
    spawnNative({ ownerSessionId, purpose, options }) {
        const scenario = selectedScenario, child = new EventEmitter(), stdout = new PassThrough();
        let buffer = '', started = false, sequence = 0, resolveJoin;
        const replies = new Map(), settled = new Promise(resolve => { resolveJoin = resolve; });
        const launch = { ownerSessionId, purpose, scenario, options, frames: [], ready: false, responses: [] };
        const send = frame => { if (!stdout.destroyed && !stdout.writableEnded) stdout.write(JSON.stringify(frame) + '\n'); };
        const request = (subtype, fields) => new Promise(resolve => { const id = 'native-' + (++sequence); replies.set(id, resolve); send({ type: 'control_request', request_id: id, request: { subtype, ...fields } }); });
        const mcp = (method, params) => request('mcp_message', { server_name: 'custom-tools', message: { jsonrpc: '2.0', id: sequence + 1, method, params } });
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
                        if(purpose==='provider'){await mcp('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'controlled-native', version: '1' } });
                        const listing = await mcp('tools/list', {}); assert.deepEqual(listing.response.mcp_response.result.tools.map(tool => tool.name), ['owned_mutation']);}
                        send({ type: 'system', subtype: 'init', session_id: 'native-' + ownerSessionId, model: 'claude-sonnet-4-6', cwd, tools: purpose==='provider'?['mcp__custom-tools__owned_mutation']:[], mcp_servers: purpose==='provider'?[{ name: 'custom-tools', status: 'connected' }]:[], plugins: [] });
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
async function createSession(scenario, thinkingLevel = 'off') {
    selectedScenario = scenario;
    const runtime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' }, { projectTrusted: false });
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: [{ name: 'thinking-options', factory: host.extension }], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, disabledBuiltinExtensions: ['mcp', 'codemode', 'tool_search'], systemPrompt: 'Controlled thinking selection boundary.' });
    await loader.reload();
    const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, settingsManager, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(cwd), thinkingLevel, noTools: 'builtin', tools: ['owned_mutation'], customTools: [{ name: 'owned_mutation', label: 'Owned mutation', description: 'Append to the owned test journal', parameters: Type.Object({ value: Type.Number() }), async execute() { assert.fail('Thinking option probe must not execute tools'); } }] });
    await session.bindExtensions({ mode: 'json', onError() {} }); await session.setModel(runtime.getModel('claude-bridge', 'claude-sonnet-4-6')); session.setActiveToolsByName(['owned_mutation']); return session;
}
const verify=(level,launch,sdkOptions)=>{
 assert.ok(launch);assert.equal(launch.error,undefined);assert.ok(sdkOptions);
 const args=launch.options.args;
 if(level==='off'){assert.deepEqual(sdkOptions.thinking,{type:'disabled'});assert.ok(args.includes('--thinking'));assert.equal(args[args.indexOf('--thinking')+1],'disabled');assert.equal(args.includes('--effort'),false);}
 else {assert.equal(sdkOptions.thinking,null);assert.equal(sdkOptions.effort,'medium');assert.equal(args[args.indexOf('--effort')+1],'medium');assert.equal(args.includes('--thinking'),false);}
};
for(const mode of ['provider','rebuild','summary'])for(const level of ['off','medium'])test(`original SDK thinking selection ${mode}: ${level}`,{timeout:12000},async()=>{
 const session=await createSession(async launch=>launch.finish(),level);
 try{
  session.setThinkingLevel(level);assert.equal(session.thinkingLevel,level);
  if(mode==='summary'){
   const scope=host.openSummaryOperation(session.sessionId,new AbortController().signal,async()=>{});
   try{
    const observed=[],receivers=[];
    const request={sessionId:session.sessionId,cacheRetention:'none',...(level==='off'?{}:{reasoning:level}),onProviderStreamEvent:function(message){observed.push(structuredClone(message));receivers.push(this);if(message.type==='result')message.result='OBSERVER_MUTATION';}};
    const stream=host.registration({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}).provider.config.streamSimple(session.model,{systemPrompt:'Controlled summary.',messages:[{role:'user',content:[{type:'text',text:'Summarize controlled input.'}],timestamp:Date.now()}]},request);
    for await(const event of stream){if(event.type==='error')throw Error(event.error?.errorMessage??'Summary failed');}
    const answer=await stream.result();assert.equal(answer.content[0].text,'CONTROLLED_NATIVE_RESULT');assert.ok(observed.some(v=>v.type==='result'));assert.ok(receivers.every(v=>v===request));
   }finally{await scope.close();}
  }else{
   if(mode==='rebuild'){session.setThinkingLevel(level==='off'?'medium':'off');await session.prompt('First controlled turn.');session.setThinkingLevel(level);}
   await session.prompt('Return the controlled transport result.');
  }
  const launch=launches.filter(v=>v.ownerSessionId===session.sessionId).at(-1),sdkOptions=sdkCalls.at(-1);fs.writeFileSync(path.join(root,mode+'-'+level+'.json'),JSON.stringify({level,mode,sdkOptions,args:launch?.options.args}),{mode:0o600});verify(level,launch,sdkOptions);completed++;
 }finally{await session.abort();assert.equal((await host.closeSession(session.sessionId)).cleanup,'confirmed');session.dispose();}
});
test('isolated summary owner close stops waiting while an original observer remains held', {timeout:12000}, async()=>{
 const session=await createSession(async launch=>launch.finish(),'off');
 let entered=false,rejectObserver;
 const pending=new Promise((_,reject)=>{rejectObserver=reject;});
 const scope=host.openSummaryOperation(session.sessionId,new AbortController().signal,async()=>{});
 const stream=host.registration({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}).provider.config.streamSimple(session.model,{systemPrompt:'Controlled summary.',messages:[{role:'user',content:[{type:'text',text:'Summarize controlled input.'}],timestamp:Date.now()}]},{sessionId:session.sessionId,cacheRetention:'none',onProviderStreamEvent:message=>{if(message.type==='result'){entered=true;return pending;}}});
 const drain=(async()=>{for await(const event of stream){}return stream.result();})();
 try{
  await waitFor(()=>entered);
  let timer;let closed;try{closed=await Promise.race([host.closeSession(session.sessionId),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Summary observer prevented owner close')),1500);})]);}finally{clearTimeout(timer);}
  assert.equal(closed.cleanup,'unknown');assert.equal(closed.pendingObservers,1);
  const result=await drain;assert.equal(result.stopReason,'error');
  rejectObserver(Error('CONTROLLED_LATE_SUMMARY_OBSERVER_REJECTION'));await pause();
  assert.equal((await host.closeSession(session.sessionId)).cleanup,'confirmed');completed++;
 }finally{rejectObserver(Error('CONTROLLED_SUMMARY_OBSERVER_FINALLY'));await drain;await session.abort();await host.closeSession(session.sessionId);session.dispose();}
});
after(async () => {
    assert.equal((await host.close()).cleanup, 'confirmed');
    if (evidencePath) fs.writeFileSync(evidencePath, JSON.stringify({root, sdkCalls}), {mode: 0o600});
    if (completed === 7 && !retainFixture) fs.rmSync(root, {recursive: true, force: true});
    else process.stderr.write('Retained thinking option fixture: ' + root + '\n');
});
