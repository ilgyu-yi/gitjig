/** Hosted native policy metadata only. No native process, account or provider request. */
import '../normal-hosted/no-external.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
const entry=import.meta.resolve('@gitjig/pi-claude-bridge-host');
const {BridgeHost}=await import(new URL('./host.js',entry));
const settings=()=>({disableAllHooks:true,autoMemoryEnabled:false,syncClaudeAiSkills:false,syncClaudeAiPlugins:false,enabledPlugins:{'agents-md@builtin':false,'bento-slides@bento':false,'drop@drop':false,'plugin-authoring@builtin':false}});
const options=()=>({cwd:'/owned-host',pathToClaudeCodeExecutable:'/owned-native',env:{},settingSources:[],settings:settings(),spawnNative(){assert.fail('No native birth in policy inspection');},observeNative(){}});
const builtin={name:'cc-plugin-sec-default',path:'builtin'};
function subject(t){const input=options(),host=new BridgeHost(input);host.bind('policy-session');t.after(()=>host.close());return{host,query:host.query('policy-session')};}
const init=plugins=>({type:'system',subtype:'init',tools:[],mcp_servers:[],plugins});
for(const change of ['missing','enabled'])test(`host policy refuses ${change} optional plugin-authoring suppression`,()=>{
    const input=options();if(change==='missing')delete input.settings.enabledPlugins['plugin-authoring@builtin'];else input.settings.enabledPlugins['plugin-authoring@builtin']=true;
    assert.throws(()=>new BridgeHost(input),/BRIDGE_HOST_POLICY_UNAVAILABLE/);
});
test('fixed native policy does not attempt to disable mandatory security settings',()=>{
    const input=options();input.settings.enabledPlugins['sec-default@builtin']=false;
    assert.throws(()=>new BridgeHost(input),/BRIDGE_HOST_POLICY_UNAVAILABLE/);
});
test('provider and summary options preserve optional-plugin suppression without overriding native security policy',async()=>{
    const input=options(),host=new BridgeHost(input);host.bind('policy-provider');host.bind('policy-summary');
    const scope=host.openSummaryOperation('policy-summary',new AbortController().signal,async()=>{});
    try{
        const provider=host.query('policy-provider'),summary=(await host.summary('policy-summary')).query;
        for(const query of [provider,summary]){
            assert.deepEqual(query.options().settings.enabledPlugins,input.settings.enabledPlugins);
            assert.equal(Object.hasOwn(query.options().settings.enabledPlugins,'sec-default@builtin'),false);
        }
    }finally{await scope.close().catch(()=>{});await host.close();}
});
for(const [label,plugins] of [['no plugins',[]],['only exact mandatory builtin',[builtin]],['observed builtin source metadata',[{...builtin,source:'cc-plugin-sec-default@builtin'}]]])test(`native initialization accepts ${label}`,t=>{
    const {query}=subject(t);assert.doesNotThrow(()=>query.observe(init(plugins)));
});
const refusals=[
    ['optional plugin',[{name:'cc-plugin-plugin-authoring',path:'builtin'}]],
    ['unknown plugin',[{name:'unknown',path:'builtin'}]],
    ['legacy alias',[{name:'sec-default',path:'builtin'}]],
    ['external path',[{name:builtin.name,path:'/owned/external-plugin'}]],
    ['missing path',[{name:builtin.name}]],
    ['duplicate builtin',[builtin,builtin]],
    ['malformed plugins',null],
];
for(const [label,plugins] of refusals)test(`native initialization refuses ${label}`,t=>{
    const {query}=subject(t);assert.throws(()=>query.observe(init(plugins)),/BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: plugins/);
});
test('mandatory builtin cannot permit an unexpected native tool',t=>{
    const {query}=subject(t);assert.throws(()=>query.observe({...init([builtin]),tools:['Bash']}),/BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: tools/);
});
test('mandatory builtin cannot permit an unexpected MCP server',t=>{
    const {query}=subject(t);assert.throws(()=>query.observe({...init([builtin]),mcp_servers:[{name:'unselected',status:'connected'}]}),/BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: MCP-servers/);
});
test('accepted mandatory builtin cannot admit a second native initialization',t=>{
    const {query}=subject(t);query.observe(init([builtin]));assert.throws(()=>query.observe(init([])),/BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: duplicate-init/);
});
