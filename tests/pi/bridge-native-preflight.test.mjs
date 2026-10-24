/** Native launch accounting only; returned launch/settlement records are controlled premises. No process/model/account. */
import test from 'node:test';import assert from 'node:assert/strict';
const entry=import.meta.resolve('@gitjig/pi-claude-bridge-host');
const {BridgeHost}=await import(new URL('./host.js',entry));
const clean={cleanup:'confirmed',exited:true,pipesClosed:true,scopeJoined:true};
const nativeOptions={command:'/owned-native',args:[],cwd:'/owned-host',env:{}};
const settings={disableAllHooks:true,autoMemoryEnabled:false,syncClaudeAiSkills:false,syncClaudeAiPlugins:false,enabledPlugins:{'agents-md@builtin':false,'bento-slides@bento':false,'drop@drop':false,'plugin-authoring@builtin':false}};
const configuration=extra=>({cwd:'/owned-host',pathToClaudeCodeExecutable:'/owned-native',env:{},settingSources:[],settings,observeNative(){},...extra});
function world(t,extra){const host=new BridgeHost(configuration(extra));host.bind('owned');t.after(()=>host.close());return{host,query:host.query('owned')};}
for(const purpose of ['provider','summary'])test(`${purpose} rejected preflight seals the query and proves no native birth`,async t=>{
    const original=Error('Owned native account route changed');let births=0;
    const host=new BridgeHost(configuration({assertNativeLaunch(){throw original;},spawnNative(){births++;assert.fail('Preflight must prevent native callback');}}));host.bind('owned');t.after(()=>host.close());
    let scope,query;
    if(purpose==='summary'){scope=host.openSummaryOperation('owned',new AbortController().signal,async()=>{});query=(await host.summary('owned')).query;}
    else query=host.query('owned');
    const spawn=query.options().spawnClaudeCodeProcess;
    assert.throws(()=>spawn(nativeOptions),error=>error===original);await assert.rejects(query.admission,error=>error===original);
    assert.throws(()=>query.observe({type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[]}),/BRIDGE_HOST_QUERY_CLOSED/);
    assert.throws(()=>query.assertActive('owned'),/BRIDGE_HOST_MCP_OWNER_INACTIVE/);assert.throws(()=>spawn(nativeOptions),/BRIDGE_HOST_SPAWN_CLOSED/);
    await query.finishNative();assert.equal(births,0);await scope?.close();assert.equal((await host.closeSession('owned')).cleanup,'confirmed');
});
test('a throwing native callback with no returned launch remains unknown',async t=>{
    const {host,query}=world(t,{spawnNative(){throw Error('Unaccounted native callback failure');}});
    assert.throws(()=>query.options().spawnClaudeCodeProcess(nativeOptions),/Unaccounted native callback failure/);
    await assert.rejects(query.finishNative(),/BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN/);assert.equal((await host.close()).cleanup,'unknown');
});
test('a malformed returned native owner cannot establish clean nonbirth',async t=>{
    const {query}=world(t,{spawnNative(){return{process:{},settled:null};}});
    assert.throws(()=>query.options().spawnClaudeCodeProcess(nativeOptions),/BRIDGE_HOST_NATIVE_OWNER_UNAVAILABLE/);
    await assert.rejects(query.finishNative(),/BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN/);
});
for(const cleanup of ['confirmed','unknown'])test(`preflight refusal after an existing launch still joins its ${cleanup} settlement`,async t=>{
    let refuse=false,resolve,finished=false;const settlement=new Promise(done=>resolve=done);
    const {query}=world(t,{assertNativeLaunch(){if(refuse)throw Error('Later source changed');},spawnNative(){return{process:{},settled:settlement};}});
    const spawn=query.options().spawnClaudeCodeProcess;spawn(nativeOptions);refuse=true;assert.throws(()=>spawn(nativeOptions),/Later source changed/);
    const finish=query.finishNative();void finish.then(()=>finished=true,()=>finished=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
    resolve({...clean,cleanup});if(cleanup==='confirmed')await finish;else await assert.rejects(finish,/BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN/);
});
test('an earlier unaccounted birth attempt cannot borrow a later preflight nonbirth proof',async t=>{
    let refuse=false;const {query}=world(t,{assertNativeLaunch(){if(refuse)throw Error('Source changed');},spawnNative(){throw Error('Native callback failed');}});
    const spawn=query.options().spawnClaudeCodeProcess;assert.throws(()=>spawn(nativeOptions),/Native callback failed/);refuse=true;assert.throws(()=>spawn(nativeOptions),/Source changed/);
    await assert.rejects(query.finishNative(),/BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN/);
});
test('an async assertion cannot admit native birth or leak its rejection',async t=>{
    let births=0;const {query}=world(t,{assertNativeLaunch:async()=>{throw Error('Async assertion is not a synchronous witness');},spawnNative(){births++;assert.fail('Unsupported preflight cannot authorize birth');}});
    assert.throws(()=>query.options().spawnClaudeCodeProcess(nativeOptions),/BRIDGE_HOST_NATIVE_PREFLIGHT_MUST_BE_SYNCHRONOUS/);
    await query.finishNative();await new Promise(resolve=>setImmediate(resolve));assert.equal(births,0);
});
test('a settled query cannot birth another native process through a saved SDK callback',async t=>{
    let births=0;const {query}=world(t,{spawnNative(){births++;return{process:{},settled:Promise.resolve(clean)};}});
    const spawn=query.options().spawnClaudeCodeProcess;spawn(nativeOptions);await query.finishNative();assert.throws(()=>spawn(nativeOptions),/BRIDGE_HOST_SPAWN_CLOSED/);assert.equal(births,1);
});
test('host preflight option must be a synchronous callable when provided',()=>{
    assert.throws(()=>new BridgeHost(configuration({assertNativeLaunch:'unavailable',spawnNative(){}})),/BRIDGE_HOST_OPTIONS_UNAVAILABLE/);
});
test('an uncalled preflight is not proof of clean native nonbirth',async t=>{
    let checks=0;const {query}=world(t,{assertNativeLaunch(){checks++;throw Error('Not reached');},spawnNative(){assert.fail('No SDK birth request');}});
    await assert.rejects(query.finishNative(),/BRIDGE_HOST_NATIVE_LAUNCH_ABSENT/);assert.equal(checks,0);
});
