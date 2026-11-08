/** Exact current bridge preallocation profile, no native birth/account/engine/model. */
import test from 'node:test';
import assert from 'node:assert/strict';
const entry=import.meta.resolve('@gitjig/pi-claude-bridge-host');
const {BridgeHost}=await import(new URL('./host.js',entry));
const {captureStructuredOutput,structuredOutputMetadataKey}=await import(new URL('./structured-output.js',entry));
const name='gitjig_submit_role_result',schema={type:'object',properties:{version:{const:1}},required:['version'],additionalProperties:false};
const request=()=>({version:3,carrier:'tool-submission/v1',requestId:'launch',binding:{launchId:'launch',role:'planner',stage:'planning',inputDigest:'a'.repeat(64)},schema:structuredClone(schema),maxNativeTurns:16});
const format=value=>captureStructuredOutput({sessionId:'owned',metadata:{[structuredOutputMetadataKey]:value},onProviderStreamEvent(){}},true);
const tools=()=>[{name,description:'Host-owned provisional result',parameters:structuredClone(schema)}];
function world(t){let births=0;const host=new BridgeHost({cwd:'/owned-host',pathToClaudeCodeExecutable:'/owned-native',env:{},settingSources:[],settings:{disableAllHooks:true,autoMemoryEnabled:false,syncClaudeAiSkills:false,syncClaudeAiPlugins:false,enabledPlugins:{'agents-md@builtin':false,'plugin-authoring@builtin':false}},observeNative(){},assertNativeLaunch(){throw Error('CONTROLLED_NO_BIRTH');},spawnNative(){births++;throw Error('Forbidden test birth');}});host.bind('owned');t.after(async()=>{assert.equal(births,0);assert.equal((await host.close()).cleanup,'confirmed');});return host;}
for(const variant of ['missing','wrong-name','duplicate','schema-drift'])test('submission profile refuses '+variant+' before claiming query and permits corrected exact admission',async t=>{
 const host=world(t),profile=format(request()),bad=tools();
 if(variant==='missing')bad.length=0;
 if(variant==='wrong-name')bad[0].name='other';
 if(variant==='duplicate')bad.push(structuredClone(bad[0]));
 if(variant==='schema-drift')bad[0].parameters.required=[];
 assert.throws(()=>host.query('owned',bad,profile),/BRIDGE_(?:SUBMISSION_TOOL|HOST_TOOL_PROFILE)_UNAVAILABLE/);
 assert.equal(host.sessions.get('owned').queries.size,0);
 const query=host.query('owned',tools(),profile);assert.equal(query.format.request.version,3);assert.equal(query.options().maxTurns,16);assert.equal(Object.hasOwn(query.options(),'outputFormat'),false);assert.throws(()=>query.options().spawnClaudeCodeProcess({command:'/owned-native',args:[],cwd:'/owned-host',env:{}}),/CONTROLLED_NO_BIRTH/);await query.finishNative();
});
test('submission profile captures original schema and request independently of caller mutation',async t=>{
 const host=world(t),original=request(),captured=format(original);original.schema.required=[];original.binding.inputDigest='b'.repeat(64);
 const query=host.query('owned',tools(),captured);assert.deepEqual(query.expectedTools[0].parameters,schema);assert.equal(query.format.request.binding.inputDigest,'a'.repeat(64));assert.throws(()=>query.options().spawnClaudeCodeProcess({command:'/owned-native',args:[],cwd:'/owned-host',env:{}}),/CONTROLLED_NO_BIRTH/);await query.finishNative();
});
for(const carrier of ['assistant-json/v1','unknown'])test('version3 refuses mismatched captured carrier '+carrier,()=>assert.throws(()=>format({...request(),carrier}),/BRIDGE_STRUCTURED_REQUEST_UNAVAILABLE/));
