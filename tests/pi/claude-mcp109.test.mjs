/** Actual public Pi + original Claude SDK + real public MCP transport; native process synthetic. */
import '../normal-hosted/no-external.mjs';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { Type } from 'typebox';
import Ajv2020 from 'ajv/dist/2020.js';import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
const metadataValidator=new AjvJsonSchemaValidator(new Ajv2020({strict:true,validateSchema:true,coerceTypes:false,useDefaults:false,removeAdditional:false}));
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitjig109-mcp-')));
fs.chmodSync(root, 0o700);
const cwd = path.join(root, 'cwd'), agentDir = path.join(root, 'pi');
fs.mkdirSync(cwd, { mode: 0o700 }); fs.mkdirSync(agentDir, { mode: 0o700 });
for (const key of Object.keys(process.env)) if (!['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SHELL'].includes(key)) delete process.env[key];
process.env.PI_CODING_AGENT_DIR = agentDir; process.env.TMPDIR = root; process.chdir(cwd);
fs.writeFileSync(path.join(agentDir, 'claude-bridge.json'), JSON.stringify({ askClaude: { enabled: false }, provider: { strictMcpConfig: true, autoMemoryEnabled: false, plan: 'pro', longContextExtraUsage: false } }), { mode: 0o600 });
const sdk = await import('@earendil-works/pi-coding-agent');
const hostEntry=import.meta.resolve('@gitjig/pi-claude-bridge-host');
assert.equal(JSON.parse(fs.readFileSync(new URL('../package.json',hostEntry))).version,'0.9.0-gitjig.11','Only current reviewed package; no historical fallback');
const { createClaudeBridgeHost } = await import(hostEntry);
const{BridgeHost}=await import(new URL('./host.js',hostEntry)),queryDescriptor=Object.getOwnPropertyDescriptor(BridgeHost.prototype,'query'),queryAllocations=[];
Object.defineProperty(BridgeHost.prototype,'query',{...queryDescriptor,value:function(...args){const result=Reflect.apply(queryDescriptor.value,this,args);queryAllocations.push({ownerSessionId:args[0],query:result});return result;}});

const launches = [], seen = [], executions = [], languages=new Map();
let mode = 'healthy';
let releaseSibling;
const siblingGate = new Promise(resolve => { releaseSibling = resolve; });
const host = createClaudeBridgeHost({ cwd, pathToClaudeCodeExecutable: process.execPath, env: { PATH: process.env.PATH, HOME: root }, settingSources: [],
    settings: { disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false,
        enabledPlugins: { 'agents-md@builtin': false, 'bento-slides@bento': false, 'drop@drop': false, 'plugin-authoring@builtin': false } },
    observeNative: ({ ownerSessionId, message }) => { seen.push({ ownerSessionId, type: message.type }); },
    spawnNative({ ownerSessionId, options }) {
        const child = new EventEmitter(), stdout = new PassThrough();
        let buffer = '', started = false, nextId = 0, resolveJoin;
        const replies = new Map();
        const settled = new Promise(resolve => { resolveJoin = resolve; });
        const send = value => stdout.write(JSON.stringify(value) + '\n');
        const call = (method, params) => new Promise(resolve => {
            const id = 'native-' + (++nextId); replies.set(id, resolve);
            send({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'custom-tools',
                message: { jsonrpc: '2.0', id: nextId, method, params } } });
        });
        const launch = { ownerSessionId, mode, child, call, sentInit: false, toolResponse: null, frames:[] };
        const init = toolName => {
            launch.sentInit = true;
            send({ type: 'system', subtype: 'init', session_id: 'native-' + ownerSessionId, model: 'claude-opus-5-5', cwd,
                tools: ['mcp__custom-tools__' + toolName], mcp_servers: [{ name: 'custom-tools', status: 'connected' }], plugins: [] });
        };
        launch.admit = () => init(launch.toolName);
        launch.finish = () => send({ type: 'result', subtype: 'success', is_error: false, session_id: 'native-' + ownerSessionId,
            duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: 'SYNTHETIC109', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } });
        const stdin = new Writable({ write(chunk, _encoding, done) {
            buffer += chunk.toString();
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
                if (!line) continue;
                const frame = JSON.parse(line);launch.frames.push(frame);
                if(launch.mode==='language-failure'&&frame.type==='user'&&JSON.stringify(frame).includes('[Host language guidance update')){done(Error('SYNTHETIC_LANGUAGE_STDIN_FAILURE'));return;}
                if (frame.type === 'control_response') { replies.get(frame.response.request_id)?.(frame.response); replies.delete(frame.response.request_id); }
                if (frame.type === 'control_request') queueMicrotask(() => send({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id,
                    response: { commands: [], models: [], output_style: 'default', available_output_styles: [] } } }));
                if (frame.type === 'user' && !started) {
                    started = true;
                    void (async () => {
                        await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'synthetic-native', version: '1' } });
                        const listing = await call('tools/list', {});
                        if (!listing.response?.mcp_response) throw Error('Synthetic MCP listing response: ' + JSON.stringify(listing));
                        launch.listing = listing.response.mcp_response.result.tools;
                        assert.equal(launch.listing.length, 1, 'Actual active role filter excludes forbidden tool');
                        launch.toolName = launch.listing[0].name;
                        let responseBeforeInit = false;
                        launch.pending = call('tools/call', { name: launch.toolName, arguments: { value: 7 }, _meta: { 'claudecode/toolUseId': 'tool-' + ownerSessionId } });
                        void launch.pending.then(() => { responseBeforeInit = true; });
                        await new Promise(resolve => setImmediate(resolve));
                        await new Promise(resolve => setImmediate(resolve));
                        assert.equal(responseBeforeInit, false, 'Original SDK MCP call waits before INIT');
                        assert.equal(executions.filter(item => item.id === 'tool-' + ownerSessionId).length, 0);
                        launch.beforeInitHeld = true;
                        launch.ready = true;
                        if (launch.mode !== 'parked') {
                            init(launch.mode === 'denied' ? 'unselected' : launch.toolName);
                            send({ type: 'assistant', session_id: 'native-' + ownerSessionId, parent_tool_use_id: null,
                                message: { id: 'assistant-' + ownerSessionId, type: 'message', role: 'assistant', model: 'claude-opus-5-5',
                                    content: [{ type: 'tool_use', id: 'tool-' + ownerSessionId, name: 'mcp__custom-tools__' + launch.toolName, input: { value: 7 } }],
                                    stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } });
                            launch.toolResponse = await launch.pending;
                            if(launch.mode==='language'){
                                const id='tool-'+ownerSessionId+'-second';
                                const second=call('tools/call',{name:launch.toolName,arguments:{value:7},_meta:{'claudecode/toolUseId':id}});
                                send({type:'assistant',session_id:'native-'+ownerSessionId,parent_tool_use_id:null,message:{id:'assistant-second-'+ownerSessionId,type:'message',role:'assistant',model:'claude-opus-5-5',content:[{type:'tool_use',id,name:'mcp__custom-tools__'+launch.toolName,input:{value:7}}],stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1}}});
                                launch.secondResponse=await second;
                            }
                            if (launch.mode !== 'denied') launch.finish();
                        }
                    })().catch(error => { launch.error = error; stdout.destroy(error); });
                }
            }
            done();
        } });
        Object.assign(child, { stdin, stdout, killed: false, exitCode: null, kill() { this.killed = true; return true; } });
        stdin.on('error',()=>{if(launch.mode==='language-failure'){child.exitCode=1;stdout.end();child.emit('exit',1,null);resolveJoin({cleanup:'confirmed',exited:true,pipesClosed:true,scopeJoined:true});}});
        stdin.on('finish', () => { child.exitCode = 0; stdout.end(); child.emit('exit', 0, null);
            resolveJoin({ cleanup: 'confirmed', exited: true, pipesClosed: true, scopeJoined: true }); });
        launches.push(launch);
        return { process: child, settled };
    }
});
const waitFor = async predicate => {
    for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
    throw Error('Synthetic public SDK seam did not reach expected boundary');
};
const roleParameters=Type.Union([Type.Object({value:Type.Number(),existingId:Type.String({minLength:1}),observedRevision:Type.Integer({minimum:0})},{additionalProperties:false}),Type.Object({value:Type.Number()},{additionalProperties:false})],{type:'object'}),roleParametersJSON=JSON.stringify(roleParameters),roleKeys=Reflect.ownKeys(roleParameters);
const unsupportedParameters=Type.Union([Type.Object({value:Type.Number()},{additionalProperties:false}),Type.Object({value:Type.Number(),onlyOneAdded:Type.String()},{additionalProperties:false})],{type:'object'});
const tool = name => ({ name, label: name, description: 'Synthetic owned role probe', parameters: name==='role_probe'?roleParameters:name==='unsupported_probe'?unsupportedParameters:Type.Object({ value: Type.Number() }),
    async execute(id, input) { if(name==='role_probe')assert.deepEqual(input,{value:7});executions.push({ name, id, value: input.value });if(name==='language_probe'){const owner=id.slice('tool-'.length).replace(/-second$/,'');languages.set(owner,'ja');if(!id.endsWith('-second'))await sessions.find(item=>item.session.sessionId===owner).session.steer('HUMAN_EXPLICIT_LANGUAGE_REQUEST');} if (name === 'sibling_probe') await siblingGate; return { content: [{ type: 'text', text: 'OWNED_RESULT:' + name }], details: {} }; } });
const sessions = [];
async function sessionFor(name) {
    const runtime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' }, { projectTrusted: false });
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: [{ name: 'full-bridge109', factory: host.extension }],
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        disabledBuiltinExtensions: ['mcp', 'codemode', 'tool_search'], systemPrompt: 'Synthetic role MCP ownership only.' });
    await loader.reload();
    const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, settingsManager, resourceLoader: loader,
        sessionManager: sdk.SessionManager.inMemory(cwd), thinkingLevel: 'off', noTools: 'builtin', tools: [name, 'forbidden'], customTools: [tool(name), tool('forbidden')] });
    const errors = [];
    await session.bindExtensions({ mode: 'json', onError: error => errors.push(error) });
    await session.setModel(runtime.getModel('claude-bridge', 'claude-opus-5-5'));
    session.setActiveToolsByName([name]); // Actual post-construction role filtering.
    if(name==='language_probe'){
        languages.set(session.sessionId,'ko');const prepare=session.agent.prepareRequest;
        session.agent.prepareRequest=async(request,signal)=>{const update=await prepare?.call(session.agent,request,signal),context=update?.context??request.context;return {...update,context:{...context,messages:[...context.messages,{role:'system',content:'',sections:{'gitjig-language':'Host language state '+JSON.stringify({replyLanguage:languages.get(session.sessionId)})},timestamp:Date.now()}]}};};
    }
    sessions.push({ session, errors });
    return session;
}

test('private194 full public Pi/SDK metadata lowering, admission, denied executor and parked-owner/live-sibling scope', { timeout: 20000 }, async t => {
    t.diagnostic('Retained synthetic full public MCP world: ' + root);
    try {
        const healthy = await sessionFor('role_probe');
        mode = 'healthy';
        await healthy.prompt('Synthetic tool request.');
        const first = launches.at(-1);
        assert.ok(first.toolResponse, JSON.stringify({messages:healthy.messages, error:first.error?.message, ready:first.ready, listing:first.listing}));
        assert.equal(first.toolResponse.response.mcp_response.result.content[0].text, 'OWNED_RESULT:role_probe');
        assert.equal(executions.filter(item => item.name === 'role_probe').length, 1);
        assert.equal(executions[0].id, 'tool-' + healthy.sessionId);
        assert.equal(first.listing[0].inputSchema.properties.value.type, 'number');
        const listed=first.listing[0].inputSchema;assert.equal(listed.anyOf,undefined);assert.equal(listed.allOf,undefined);assert.equal(listed.oneOf,undefined);assert.equal(listed.additionalProperties,false);assert.deepEqual(listed.required,['value']);assert.deepEqual(listed.dependentRequired,{existingId:['observedRevision'],observedRevision:['existingId']});
        const declared=metadataValidator.getValidator(listed);for(const [input,expected]of[[{value:7},true],[{value:7,existingId:'C',observedRevision:0},true],[{value:7,existingId:'C'},false],[{value:7,observedRevision:0},false]])assert.equal(declared(input).valid,expected);
        assert.equal(roleParameters.properties,undefined);assert.equal(JSON.stringify(roleParameters),roleParametersJSON);assert.deepEqual(Reflect.ownKeys(roleParameters),roleKeys);
        const unsupported=await sessionFor('unsupported_probe'),birthsBefore=launches.length,allocationsBefore=queryAllocations.length;await unsupported.prompt('Synthetic unsupported metadata only.').catch(()=>{});assert.equal(launches.length,birthsBefore,'Unsupported lowering refuses before hosted native/query allocation');assert.equal(queryAllocations.length,allocationsBefore,'Original BridgeHost.query allocates no owner query for unsupported metadata');assert.equal((await host.closeSession(unsupported.sessionId)).queryCount,0);assert.equal(executions.filter(item=>item.name==='unsupported_probe').length,0);assert.equal(unsupported.messages.at(-1).stopReason,'error');assert.match(unsupported.messages.at(-1).errorMessage,/BRIDGE_HOST_PROVIDER_SCHEMA_UNSUPPORTED/);
        assert.equal(first.beforeInitHeld, true);
        assert.equal(healthy.messages.at(-1).stopReason, 'stop');
        const live=await sessionFor('language_probe');mode='language';const beforeLive=launches.length;await live.prompt('Synthetic live language update.');const changed=launches.at(-1);assert.equal(launches.length,beforeLive+1,'Language change reuses exactly one native query');assert.equal(live.messages.at(-1).stopReason,'stop',JSON.stringify(live.messages.at(-1)));
        const initial=changed.frames.find(frame=>frame.type==='control_request'&&frame.request.subtype==='initialize');assert.ok(initial);assert.ok(initial.request.appendSystemPrompt.includes('"replyLanguage":"ko"'));
        const updates=changed.frames.map((frame,index)=>({frame,index})).filter(({frame})=>frame.type==='user'&&JSON.stringify(frame).includes('[Host language guidance update'));assert.equal(updates.length,1,'Unchanged guidance is not resent');assert.ok(JSON.stringify(updates[0].frame).includes('ja'));assert.equal(updates[0].frame.priority,'next');const human=changed.frames.findIndex(frame=>frame.type==='user'&&JSON.stringify(frame).includes('HUMAN_EXPLICIT_LANGUAGE_REQUEST'));assert.ok(human>updates[0].index,'Host guidance arrives before the explicit human request');
        const receipt=changed.frames.findIndex(frame=>frame.type==='control_response'&&JSON.stringify(frame).includes('OWNED_RESULT:language_probe'));assert.ok(receipt>updates[0].index,'Native language update is acknowledged before a successful MCP receipt');assert.equal(changed.secondResponse.response.mcp_response.result.content[0].text,'OWNED_RESULT:language_probe');assert.ok(!first.frames.some(frame=>JSON.stringify(frame).includes('[Host language guidance update')),'Sibling query receives no language update');
        const failedLanguage=await sessionFor('language_probe');mode='language-failure';await failedLanguage.prompt('Synthetic required language delivery failure.').catch(()=>{});const failed=launches.at(-1);assert.equal(failedLanguage.messages.at(-1).stopReason,'error');assert.match(failedLanguage.messages.at(-1).errorMessage,/BRIDGE_HOST_LANGUAGE_UPDATE_UNAVAILABLE|Claude Code process exited with code 1/);assert.ok(!failed.frames.some(frame=>frame.type==='control_response'&&JSON.stringify(frame).includes('OWNED_RESULT:language_probe')),'Failed language delivery never releases a successful stale-language tool receipt');assert.equal((await host.closeSession(failedLanguage.sessionId)).cleanup,'confirmed');
        const denied = await sessionFor('denied_probe'); mode = 'denied';
        await denied.prompt('Synthetic denied startup.').catch(() => {});
        assert.equal(executions.filter(item => item.name === 'denied_probe').length, 0);
        assert.equal(denied.messages.at(-1).stopReason, 'error');
        assert.match(denied.messages.at(-1).errorMessage, /BRIDGE_HOST_NATIVE_PROFILE_MISMATCH/);
        const parent = await sessionFor('parent_probe'); mode = 'parked';
        const parentTurn = parent.prompt('Synthetic parked parent.').catch(() => {});
        await waitFor(() => launches.at(-1)?.ownerSessionId === parent.sessionId && launches.at(-1)?.ready);
        const parked = launches.at(-1);
        assert.equal(parked.sentInit, false);
        assert.equal(executions.filter(item => item.name === 'parent_probe').length, 0);
        const sibling = await sessionFor('sibling_probe'); mode = 'healthy';
        let siblingFinished = false;
        const siblingTurn = sibling.prompt('Synthetic live sibling.').then(() => { siblingFinished = true; });
        await waitFor(() => executions.some(item => item.name === 'sibling_probe'));
        const parentClosed = await host.closeSession(parent.sessionId);
        assert.equal(parentClosed.cleanup, 'confirmed');
        assert.equal(siblingFinished, false, 'Sibling actual Pi executor is still live during parent-only close');
        releaseSibling();
        await parentTurn; await siblingTurn;
        assert.equal(executions.filter(item => item.name === 'sibling_probe').length, 1);
        assert.equal(executions.filter(item => item.name === 'parent_probe').length, 0);
        assert.notEqual(parent.sessionId, sibling.sessionId);
        assert.equal(sibling.messages.at(-1).stopReason, 'stop');
        for (const launch of launches) if (launch.error) throw launch.error;
        assert.equal(sessions.flatMap(item => item.errors).length, 0, 'Full extension lifecycle has no swallowed hook error');
        fs.writeFileSync(path.join(root, 'observations.json'), JSON.stringify({ syntheticNative: true, realPi: true, realSDKMcp: true,
            executions, owners: sessions.map(item => item.session.sessionId), seen, parentClosed }, null, 2), { flag: 'wx', mode: 0o600 });
    } finally {
        releaseSibling();
        for (const { session } of sessions) { await session.abort(); await host.closeSession(session.sessionId); session.dispose(); }
        assert.equal((await host.close()).cleanup, 'confirmed');
        Object.defineProperty(BridgeHost.prototype,'query',queryDescriptor);
    }
});
