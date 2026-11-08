/** Original owned role/Pi/AgentSDK/MCP boundary; controlled native transport.
 * These tests do not qualify a live model, account, engine or native executable. */
import test, {after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import cp from 'node:child_process';
const forkRecoveryFixture=cp.fork.bind(cp);
import net from 'node:net';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {PassThrough,Writable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
import {readFixtureMetadataContext,writeFixtureVerificationDomain} from './current-verification-fixture.mjs';

let registered=false;
export async function registerNativeFormatCases({ordinaryStatusOnly}){
assert.equal(typeof ordinaryStatusOnly,'boolean');assert.equal(registered,false,'Register one bridge owner per process');registered=true;
const root = await temporaryDirectory('native-format-adapter');
const appHome=path.join(root,'application');
const project=path.join(root,'project'), cwd=path.join(root,'native-host'), agentDir=path.join(root,'agent'), account=path.join(root,'.claude'),stateRoot=path.join(appHome,'state'),artifactRoot=path.join(appHome,'artifacts');
for(const dir of [project,cwd,agentDir,account]) fs.mkdirSync(dir,{mode:0o700});
for(const key of Object.keys(process.env)) if(!['PATH','LANG','USER','LOGNAME','SHELL','NODE_TEST_CONTEXT'].includes(key)) delete process.env[key];
process.env.HOME=root;process.env.TMPDIR=artifactRoot;
fs.writeFileSync(path.join(agentDir,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
const denied=[];
const refuse=name=>{denied.push(name);throw Error('UNEXPECTED_NATIVE_FORMAT_TEST_ACTION:'+name);};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[key]=()=>refuse(key);
net.Socket.prototype.connect=()=>refuse('socket');globalThis.fetch=()=>refuse('fetch');syncBuiltinESMExports();
// A controlled arrival at the real asynchronous capacity-preparation boundary.
registerHooks({resolve(s,c,next){const result=next(s,c);if(s==='../pi/context-budget.js'&&c.parentURL?.endsWith('/dist/controller/change-core.js'))globalThis.__nativeRoleBudgetPreparation?.();return result;}});
const originalProducer=new URL('../../dist/pi/native-process.js',import.meta.url).href,shim=path.join(root,'producer-shim.mjs');
fs.writeFileSync(shim,`export * from ${JSON.stringify(originalProducer)};export async function createOwnedNativeProducer(){return {launch(options,binding){return globalThis.__nativeRoleFormatSpawn({...binding,options});},async close(){return {cleanup:'confirmed'};}};}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(s==='./native-process.js'&&c.parentURL?.endsWith('/dist/pi/claude-host.js'))return {url:pathToFileURL(shim).href,shortCircuit:true};return n(s,c);}});
// A synthetic lower-capacity catalogue entry exercises the forward-compatible
// policy boundary; it makes no claim about that real model's served capacity.
const originalBridge=import.meta.resolve('@gitjig/pi-claude-bridge-host'),catalogueShim=path.join(root,'catalogue-shim.mjs');
fs.writeFileSync(catalogueShim,`import * as bridge from ${JSON.stringify(originalBridge)};export * from ${JSON.stringify(originalBridge)};export function createClaudeBridgeHost(options){const host=bridge.createClaudeBridgeHost(options),original=host.registration.bind(host);return {...host,registration:(...args)=>{const r=original(...args);return {...r,provider:{...r.provider,config:{...r.provider.config,streamSimple:(model,context,options)=>{globalThis.__nativeBudgetObserver?.(model,context,options);return r.provider.config.streamSimple(model,context,options);},models:r.provider.config.models.map(m=>m.id==='claude-haiku-4-5'?{...m,maxTokens:16000}:m)}}};}};}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(s==='@gitjig/pi-claude-bridge-host'&&c.parentURL?.endsWith('/dist/pi/claude-host.js'))return {url:pathToFileURL(catalogueShim).href,shortCircuit:true};return n(s,c);}});
// Replace only the physical engine boundary. Controller reservation, capture,
// dispatch checkpoints, settlement, collection and retained readers stay original.
const scopeShim=path.join(root,'scope-shim.mjs');
fs.writeFileSync(scopeShim,`export async function createScope(options){return globalThis.__nativeRoleFormatScope(options);}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(c.parentURL?.endsWith('/controller/change-core.js')&&s.endsWith('/execution/container-scope.js'))return {url:pathToFileURL(scopeShim).href,shortCircuit:true};return n(s,c);}});
// Inject a malformed generated schema only at the Controller framing boundary.
// Current session admission and historical collection remain original consumers.
const originalFraming=new URL('../../dist/workflow/role-framing.js',import.meta.url).href,framingShim=path.join(root,'framing-shim.mjs');
fs.writeFileSync(framingShim,`import {roleFraming as original,nativeRoleFraming as native} from ${JSON.stringify(originalFraming)};export * from ${JSON.stringify(originalFraming)};
function defect(value){const key=globalThis.__nativeFormatRootDefect;if(!key)return value;const schema={...value.schema,[key]:[{type:'object'}]};return {...value,schema,...(value.intent?{intent:{...value.intent,schema}}:{})};}
export function roleFraming(...args){return defect(original(...args));}
export function nativeRoleFraming(role,bundle,id,turns,carrier,requests){let value=defect(native(role,bundle,id,turns,globalThis.__nativeRoleCarrier??carrier,requests));if(globalThis.__nativeCapturePolicy)value={...value,intent:{...value.intent,binding:{...value.intent.binding,nativeEvidencePolicy:globalThis.__nativeCapturePolicy}}};globalThis.__nativeFramingCalls?.push({role,id,version:value.intent.version,prompt:value.prompt,systemPrompt:value.systemPrompt,schema:JSON.stringify(value.schema),inputDigest:value.intent.binding.inputDigest});return value;}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(s.endsWith('/role-framing.js')&&(c.parentURL?.endsWith('/dist/controller/change-core.js')||c.parentURL?.endsWith('/dist/workflow/adapter.js')))return {url:pathToFileURL(framingShim).href,shortCircuit:true};return n(s,c);}});
// Abort only the owned role execution to exercise deadline-shaped recovery;
// leave the parent work active and keep the original dispatch/capture path.
const originalAdapter=new URL('../../dist/workflow/index.js',import.meta.url).href,abortShim=path.join(root,'role-abort-shim.mjs');
fs.writeFileSync(abortShim,`import {runRole as original} from ${JSON.stringify(originalAdapter)};export * from ${JSON.stringify(originalAdapter)};
export function runRole(options){const signal=globalThis.__nativeRoleExecutionAbort;return original(signal?{...options,signal:AbortSignal.any([options.signal,signal].filter(Boolean))}:options);}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(s.endsWith('/workflow/index.js')&&c.parentURL?.endsWith('/dist/controller/change-core.js'))return {url:pathToFileURL(abortShim).href,shortCircuit:true};return n(s,c);}});
const scopes=[];
globalThis.__nativeRoleFormatScope=async options=>{
    const scope={workspaceRoot:options.workRoot,containerId:'controlled-scope-'+randomUUID(),closed:false,
        validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;},
        readFile:async()=>assert.fail('No physical project reads in controller source controls'),access:async()=>{},
        exec:async()=>assert.fail('No engine execution in controller source controls'),writeFile:async()=>assert.fail('Read-only controller source control'),mkdir:async()=>assert.fail('Read-only controller source control'),
        close:async()=>{scope.closed=true;return {state:'removed'};}};
    scopes.push(scope);return scope;
};
let selectedScenario;
const launches=[];
function spawnNative({ownerSessionId,purpose,options}) {
    const scenario=selectedScenario, child=new EventEmitter(),stdout=new PassThrough(), sid='native-'+ownerSessionId;
    let buffer='',started=false,sequence=0,resolveJoin;
    const replies=new Map(),settled=new Promise(resolve=>{resolveJoin=resolve;});
    const launch={ownerSessionId,purpose,options,sid,frames:[],joined:false,settled};
    const send=frame=>{if(!stdout.destroyed&&!stdout.writableEnded)stdout.write(JSON.stringify(frame)+'\n');};
    const request=(subtype,fields)=>new Promise(resolve=>{const id='control-'+(++sequence);replies.set(id,resolve);send({type:'control_request',request_id:id,request:{subtype,...fields}});});
    const mcp=(method,params)=>request('mcp_message',{server_name:'custom-tools',message:{jsonrpc:'2.0',id:++sequence,method,params:method==='tools/call'?{...params,_meta:{'claudecode/toolUseId':randomUUID(),...params._meta}}:params}});
    launch.send=send;launch.mcp=mcp;launch.permission=(tool,input,extra={})=>request('can_use_tool',{tool_name:tool,input,tool_use_id:randomUUID(),...extra});
    launch.finish=(value,{result='',subtype='success',is_error=false,numTurns=1,modelUsage,errors,malformedError=false}={})=>send({type:'result',subtype,is_error,uuid:randomUUID(),session_id:sid,duration_ms:1,duration_api_ms:1,num_turns:numTurns,result,
        ...(value===undefined?{}:{structured_output:value}),...(modelUsage?{modelUsage}:{}),...(subtype==='success'||malformedError?{}:{errors:errors??[result||'Controlled Native execution failure']}),total_cost_usd:0,permission_denials:[],usage:{input_tokens:1,output_tokens:1}});
    launch.text=(raw,mid)=>send({type:'assistant',uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,message:{id:mid,type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[{type:'text',text:raw}],stop_reason:null,usage:{input_tokens:1,output_tokens:1}}});
    launch.format=(raw,{carrier=true,carrierError=false,carrierErrorText='Controlled invalid formatter attempt',complete=true,assistantBeforeStop=false,foreignSession=false,earlyMessageStop=false,interim=[],toolName='StructuredOutput',outputTokens=1}={})=>{
        const mid='message-'+randomUUID(),tid='formatter-'+randomUUID(),streamSession=foreignSession?'foreign-session':sid;
        const event=event=>send({type:'stream_event',uuid:randomUUID(),session_id:streamSession,parent_tool_use_id:null,event});
        event({type:'message_start',message:{id:mid,type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[],usage:{input_tokens:1,output_tokens:0}}});
        for(const text of interim)launch.text(text,mid);
        event({type:'content_block_start',index:0,content_block:{type:'tool_use',id:tid,name:toolName,input:{}}});
        event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});
        if(!complete)return {mid,tid};
        const assistant=()=>send({type:'assistant',uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,message:{id:mid,type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[{type:'tool_use',id:tid,name:toolName,input:JSON.parse(raw)}],stop_reason:null,usage:{input_tokens:1,output_tokens:1}}});
        if(earlyMessageStop)event({type:'message_stop'});
        if(assistantBeforeStop)assistant();
        event({type:'content_block_stop',index:0});
        if(!assistantBeforeStop)assistant();
        event({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:outputTokens}});event({type:'message_stop'});
        if(carrier)send({type:'user',uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:tid,is_error:carrierError,content:carrierError?carrierErrorText:'Structured output provided successfully'}]}});
        return {mid,tid};
    };
    launch.read=async (input,outputTokens=1)=>{
        const {tid}=launch.format(JSON.stringify(input),{toolName:'mcp__custom-tools__read',carrier:false,outputTokens});
        const response=await mcp('tools/call',{name:'read',arguments:input,_meta:{'claudecode/toolUseId':tid}});
        const result=response.response?.mcp_response?.result;
        if(result)send({type:'user',uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:tid,is_error:result.isError??false,content:result.content}]}});
        return response;
    };
    const stdin=new Writable({write(chunk,_encoding,done){
        buffer+=chunk.toString();let end;
        while((end=buffer.indexOf('\n'))>=0){
            const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;
            const frame=JSON.parse(line);launch.frames.push(frame);
            if(frame.type==='control_response'){replies.get(frame.response.request_id)?.(frame.response);replies.delete(frame.response.request_id);}
            if(frame.type==='control_request')queueMicrotask(()=>send({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:{commands:[],models:[],output_style:'default',available_output_styles:[]}}}));
            if(frame.type==='user'&&!started){started=true;void(async()=>{
                launch.tools=[];
                const initialize=launch.frames.find(f=>f.type==='control_request'&&f.request.subtype==='initialize')?.request;
                assert.ok(initialize,'Original public SDK initializes before sending the user turn');
                const servers=initialize.sdkMcpServers??[];assert.ok(Array.isArray(servers));
                if(purpose!=='summary'&&servers.includes('custom-tools')){
                    await mcp('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'controlled-native-role',version:'1'}});
                    const listing=await mcp('tools/list',{});launch.tools=listing.response.mcp_response.result.tools;
                }
                send({type:'system',subtype:'init',uuid:randomUUID(),session_id:sid,model:'claude-sonnet-4-6',cwd,tools:[...launch.tools.map(t=>'mcp__custom-tools__'+t.name),...(options.args.includes('--json-schema')?['StructuredOutput']:[]),...(scenario.extraNativeTools??[])],mcp_servers:launch.tools.length?[{name:'custom-tools',status:'connected'}]:[],plugins:[]});
                await scenario(launch);
            })().catch(error=>{launch.error=error;stdout.destroy(error);});}
        }
        done();
    }});
    Object.assign(child,{stdin,stdout,killed:false,exitCode:null,kill(){this.killed=true;return true;}});
    stdin.on('finish',()=>{child.exitCode=launch.exitCode??0;stdout.end();child.emit('exit',child.exitCode,null);launch.joined=true;resolveJoin({cleanup:launch.cleanup??'confirmed',exited:true,pipesClosed:true,scopeJoined:true});});
    launches.push(launch);return {process:child,settled};
}
globalThis.__nativeRoleFormatSpawn=spawnNative;
const load=relative=>import(new URL('../../dist/'+relative,import.meta.url));
const {createOwnedClaudeHost}=await load('pi/claude-host.js'),{initializePiHost}=await load('pi/index.js'),{runRole}=await load('workflow/adapter.js');
const {parseSessionEntries}=await import('@earendil-works/pi-coding-agent');
const {readSelectedRoleOutput}=await load('controller/history.js');
const {nativeRoleMaterial,nativeRoleEntries}=await load('workflow/native-role-output.js');
const {openController:initializeController}=await load('controller/index.js');
const initialController=await initializeController({installationHome:appHome});
// Configure the owned metadata-only application recipe before any retained
// conversation exists; every physical transport in this file remains controlled.
const {ApplicationAccounts:FixtureAccounts}=await load('app/accounts.js'),{ApplicationModels:FixtureModels}=await load('app/models.js');
const fixtureAccounts=FixtureAccounts.open(initialController);await fixtureAccounts.configure({providers:{'unowned-readonly-fixture':{api:'openai-completions',apiKey:'DUMMY_NO_REQUEST',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'subject',contextWindow:8192,maxTokens:256}]}}});await fixtureAccounts.setDefault('unowned-readonly-fixture','subject');
const retainedApplicationBaseline=await new FixtureModels(initialController).baseline();await initialController.close();
const owner=await createOwnedClaudeHost({cwd,agentDir,executable:{file:fs.realpathSync(process.execPath),sha256:createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex')},nativeAccountHome:root,
    environment:{HOME:root,CLAUDE_CONFIG_DIR:account,PATH:process.env.PATH,TMPDIR:artifactRoot,USER:process.env.USER,LOGNAME:process.env.LOGNAME,SHELL:'/bin/sh',CLAUDE_CODE_MAX_OUTPUT_TOKENS:'128000'}});
const host=await initializePiHost({stateRoot,artifactRoot}),model=await owner.selectModel('claude-sonnet-4-6','off');
const sha=text=>createHash('sha256').update(text).digest('hex');
const value={version:1,summary:'Original native formatter value',findings:[],assessedScope:[]};
const body={requirements:[{id:'R1',text:'Preserve controlled source',source:'S'}],contracts:'Controlled exact producer protocol.',context:{stage:'fresh-review'},sources:[],requiredScope:[]};
const noTool=()=>assert.fail('No project execution in native-format producer controls');
const operations={workspaceRoot:project,validatePath:p=>{const absolute=path.resolve(project,p);assert.ok(absolute===project||absolute.startsWith(project+path.sep));return absolute;},exec:noTool,readFile:noTool,writeFile:noTool,mkdir:noTool,access:noTool};
const initialHome=path.join(root,'initial-application');
fs.cpSync(appHome,initialHome,{recursive:true});
let previousCase, caseNumber=0, retainedFailure=false;
beforeEach(t=>{
    const previous=previousCase, previousNumber=caseNumber++;
    previousCase=t;
    if(previous){
        // The previous case, including its own close hooks, has finished.
        assert.ok(launches.every(launch=>launch.joined),'Previous native launches must be joined');
        for(const name of ['owner.json','recovery.guard'])
            assert.equal(fs.existsSync(path.join(stateRoot,name)),false,'Previous application owner must be released');
        if(previous.passed)
            fs.rmSync(appHome,{recursive:true});
        else {
            const retained=path.join(root,'failed-application-'+previousNumber);
            fs.renameSync(appHome,retained);
            console.error('Retained '+previous.name+' application: '+retained);
            retainedFailure=true;
        }
        // The SDK pins these storage paths. Reopen within a case still uses
        // that case's actual retained database, histories and artifacts.
        fs.cpSync(initialHome,appHome,{recursive:true});
        launches.length=0;
        scopes.length=0;
        selectedScenario=undefined;
    }
});
const ordinaryStatusName='headless ordinary Native retry and rate facts reach the same owned EN/KO status';
const check=(name,body,options={})=>{
    if((name===ordinaryStatusName)!==ordinaryStatusOnly)return;
    return test(name,{timeout:15000,...options},body);
};
// Only fixtures that exercise a recorded formatter recipe opt into this override.
function useFormatterFixture(t){assert.equal(globalThis.__nativeRoleCarrier,undefined);globalThis.__nativeRoleCarrier='formatter/v1';t.after(()=>{delete globalThis.__nativeRoleCarrier;});}
function useTextFixture(t){assert.equal(globalThis.__nativeRoleCarrier,undefined);globalThis.__nativeRoleCarrier='assistant-json/v1';t.after(()=>{delete globalThis.__nativeRoleCarrier;});}
// Deliver the fixture's exact object using the tool advertised by this original
// SDK request. Rejection is retained; this helper never repairs adverse output.
async function completeRoleFixture(launch,output){
 const raw=JSON.stringify(output);
 if(launch.tools.some(tool=>tool.name==='gitjig_submit_role_result')){
  const result=await submitRole(launch,raw);launch.finish(undefined,{result:'Original role query settled after submission'});return result;
 }
 if(launch.options.args.includes('--json-schema')){launch.format(raw);launch.finish(output);}
 else completeText(launch,raw);
}
async function produce(scenario,options={}) {
    selectedScenario=scenario;const before=launches.length,launchId=randomUUID();let checkpoints=0,intentReceipt;
    const result=await runRole({launchId,role:'reviewer',inputBundle:body,operations,host,model,timeoutMs:8000,maxProviderRequests:1,maxNativeTurns:3,assertEntry(){},beforeModelRequest:async(_manager,receipt)=>{checkpoints++;intentReceipt=receipt;},...options});
    assert.deepEqual(denied,[]);const entries=result.historyRef&&fs.existsSync(result.historyRef)?parseSessionEntries(fs.readFileSync(result.historyRef,'utf8')):[];
    return {result,entries,launches:launches.slice(before),checkpoints,intentReceipt};
}
const read=f=>readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'reviewer',stage:'fresh-review',checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource);

check('embedded stage allocation is physically captured before original model dispatch',async t=>{
 globalThis.__nativeCapturePolicy='embedded-envelope/v2';t.after(()=>{delete globalThis.__nativeCapturePolicy;});let captured=false;
 const {decodeNativeStage}=await load('workflow/native-transport.js'),{readNativeHistorySnapshot}=await load('controller/history.js');
 const f=await produce(launch=>{assert.equal(captured,true);completeText(launch,JSON.stringify(value));},{nativeCarrier:'assistant-json/v1',beforeModelRequest:async(manager,intent)=>{
  const snapshot=await readNativeHistorySnapshot(manager.getSessionFile()),allocation=snapshot.entries.find(e=>e.customType===nativeRoleEntries.staging)?.data,original=snapshot.entries.find(e=>e.customType===nativeRoleEntries.intent);
  assert.ok(allocation);assert.equal(allocation.intentEntryId,original.id);assert.equal(allocation.requestDigest,sha(JSON.stringify(original.data.request)));assert.equal(allocation.writerPid,process.pid);assert.equal(allocation.sessionId,manager.getSessionId());
  const file=path.join(path.dirname(manager.getSessionFile()),allocation.stagingName),info=fs.statSync(file),stage=decodeNativeStage(fs.readFileSync(file),allocation);
  assert.equal(String(info.dev),allocation.device);assert.equal(String(info.ino),allocation.inode);assert.equal(stage.frames,0);assert.equal(stage.tailBytes,0);captured=true;
 }});
 assert.equal(captured,true,JSON.stringify(f.result.issues));assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.ok(f.launches.every(l=>l.joined));
});

check('embedded stage allocation persistence failure closes writer before original provider birth',async t=>{
 globalThis.__nativeCapturePolicy='embedded-envelope/v2';t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const {NativeRoleCollector}=await load('workflow/native-role-output.js'),{NativeTransportWriter}=await load('workflow/native-transport.js'),create=NativeRoleCollector.create,open=NativeTransportWriter.open;let writer;
 NativeTransportWriter.open=async function(...args){writer=await open.apply(this,args);return writer;};
 NativeRoleCollector.create=async function(manager,...args){const append=manager.appendCustomEntry;manager.appendCustomEntry=function(kind,data){return kind===nativeRoleEntries.staging?'lost-stage-allocation':append.call(this,kind,data);};try{return await create.call(this,manager,...args);}finally{manager.appendCustomEntry=append;}};
 t.after(()=>{NativeRoleCollector.create=create;NativeTransportWriter.open=open;});
 const f=await produce(()=>assert.fail('Unpersisted stage has no provider authority'),{nativeCarrier:'assistant-json/v1'});
 assert.ok(writer);assert.equal(writer.handle.fd,-1);assert.ok(fs.existsSync(writer.path));assert.equal(f.result.usable,false);assert.equal(f.launches.length,0);assert.equal(f.checkpoints,0);assert.match(f.result.issues.join(),/staging allocation was not persisted/);
});

for(const carrier of ['formatter/v1','assistant-json/v1','tool-submission/v1'])for(const failed of [false,true])check('embedded capture original SDK '+carrier+' failed='+failed,async t=>{
 globalThis.__nativeCapturePolicy='embedded-envelope/v2';t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const role=carrier==='tool-submission/v1'?'planner':'reviewer',context={stage:carrier==='tool-submission/v1'?'planning':'fresh-review',...(carrier==='tool-submission/v1'?{planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8}}:{})};
 const output=carrier==='tool-submission/v1'?writeFixtureVerificationDomain({...value,plan:mixedPlan()},context):value;let scenarioCompleted=false;
 const f=await produce(async launch=>{
  if(carrier==='tool-submission/v1'){const feedback=await submitRole(launch,JSON.stringify(output));assert.notEqual(feedback.isError,true,JSON.stringify(feedback));launch.finish(undefined,{...(failed?{subtype:'error_during_execution',is_error:true}:{result:'Original submission settled'})});}
  else if(carrier==='assistant-json/v1')completeText(launch,JSON.stringify(output),{failed});
  else{launch.format(JSON.stringify(output));launch.finish(output,failed?{subtype:'error_during_execution',is_error:true}:{});}
  scenarioCompleted=true;
 },{role,inputBundle:{...body,context},nativeCarrier:carrier,maxProviderRequests:3});
 assert.equal(scenarioCompleted,true,JSON.stringify(f.result.issues));assert.equal(f.result.usable,!failed,JSON.stringify(f.result.issues));assert.ok(f.launches.every(l=>l.joined));
 const capsules=f.entries.filter(e=>e.customType===nativeRoleEntries.capture);assert.equal(capsules.length,1);assert.equal(capsules[0].data.sealed,true);
 assert.equal(f.entries.some(e=>e.customType===nativeRoleEntries.sdk),false,'Physical history owns one capsule, not a wrapper per packet');
 const originalIntent=f.entries.find(e=>e.customType===nativeRoleEntries.intent),stage=path.join(path.dirname(f.result.historyRef),originalIntent.data.capture.stagingName);assert.equal(fs.existsSync(stage),false);
 const material=nativeRoleMaterial(f.entries,originalIntent.id).materials;assert.ok(material.some(m=>m.raw===JSON.stringify(output)));
 if(!failed){assert.equal(f.result.nativeSource.capture.kind,'embedded-envelope/v2');assert.equal(f.result.nativeSource.capture.entryId,capsules[0].id);
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role,stage:context.stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),JSON.stringify(output));
 if(carrier==='assistant-json/v1'){const assistant=f.entries.findLast(e=>e.type==='message'&&e.message.role==='assistant');assert.throws(()=>readSelectedRoleOutput(f.entries,{entryId:assistant.id,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role,checkpointLeafId:assistant.id}),/captured native intent requires its original carrier source/);}}
});

for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])check('original SDK closed material fault stops same-query correction and joins '+policy,async t=>{
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 let scenarioClosed=false;
 const raw=JSON.stringify({...value,findings:[{requirementId:'R1',severity:'blocking',repair:'unknown',description:'Retain original failed submission claim',evidence:['controlled source']}]}),f=await produce(async launch=>{
  launch.format(raw,{complete:false,toolName:'mcp__custom-tools__gitjig_submit_role_result'});
  launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event:{type:'message_stop'}});
  await launch.settled;scenarioClosed=true;
 },{role:'challenger',inputBundle:{...body,context:{stage:'planning-challenge',planProposal:mixedPlan()}},nativeCarrier:'tool-submission/v1',maxProviderRequests:3});
 assert.equal(f.result.usable,false);assert.equal(f.result.rawFinal,null);assert.equal(f.result.selectedFinalEntryId,null);
 assert.match(f.result.issues.join('\n'),/NATIVE_MATERIAL_CUSTODY_STOPPED/);
 assert.equal(f.result.providerRequests,1);assert.equal(f.launches.length,1);assert.ok(f.launches[0].joined);assert.ok(scenarioClosed);
 const {expandNativeTransport}=await load('workflow/native-transport.js'),entries=expandNativeTransport(f.entries);
 const intent=entries.find(e=>e.customType===nativeRoleEntries.intent),read=nativeRoleMaterial(entries,intent.id);
 assert.ok(read.materials.some(m=>m.raw===raw&&m.invalid&&m.complete===false));assert.equal(read.diagnostics.prefix.count,1);
 const control=entries.filter(e=>e.customType===nativeRoleEntries.settlement);assert.equal(control.length,1);assert.equal(control[0].data.attestation.nativeCleanup,'confirmed');
});
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])check('stopped owned submission prefix has a reachable independent recovery route '+policy,async t=>{
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const claim=finding('Retain this literal stopped submission claim'),raw='{"version":1,"summary":"Original stopped submission","findings":['+JSON.stringify(claim)+',';
 const f=await controllerRole(t,async launch=>{launch.format(raw,{complete:false,toolName:'mcp__custom-tools__gitjig_submit_role_result'});launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event:{type:'message_stop'}});await launch.settled;},'planner',{stage:'planning'});
 const s=f.c.store,core=f.c.changeCore,entries=await core.nativeEntries(f.run.id);
 assert.equal(entries.filter(e=>e.customType===nativeRoleEntries.settlement).length,1,'Joined original custody is present');
 assert.equal(f.launch.status,'UNUSABLE');assert.equal(f.run.phase,'SETTLED');
 const source=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id).find(row=>row.raw===raw);assert.ok(source);
 assert.ok(f.c.inspectChange(f.workId).occurrences.some(o=>o.data.finding.description===claim.description),'Literal claim is retained');
 if(!JSON.parse(source.data).materialAssessment){
  const births=launches.length;selectedScenario=()=>assert.fail('Unavailable original evidence must not spend another model attempt');
  await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
  assert.equal(launches.length,births);assert.ok(core.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'));
  assert.equal(s.one('SELECT raw FROM role_outputs WHERE id=?',source.id).raw,raw);
 }
 assert.ok(JSON.parse(s.one('SELECT data FROM role_outputs WHERE id=?',source.id).data).materialAssessment,
  'A closed, bounded original argument prefix must be eligible for independent material diagnosis without successful-role authority');
});
async function completeLiteralStoppedRole(t,policy,withClaim=true,fault){
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const observed=finding('A discarded draft observation with exact original literal custody'),raw=JSON.stringify({...value,findings:withClaim?[observed]:[]});
 const f=await controllerRole(t,async launch=>{
  const event=event=>launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event});
  if(fault){event({type:'message_start',message:{id:'unrelated-empty',role:'assistant',content:[]}});event(fault==='global'?{type:'content_block_stop',index:0}:{type:'content_block_start',index:0,content_block:{type:'text',text:''}});}
  launch.format(raw,{complete:false,toolName:'mcp__custom-tools__gitjig_submit_role_result'});event({type:'message_stop'});await launch.settled;
 },'planner',{stage:'planning'});return{...f,observed,raw};
}
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])for(const withClaim of [false,true])for(const cold of [false,true])check('complete literal stopped submission keeps plain source and public continuation '+policy+' claim='+withClaim+' cold='+cold,async t=>{
 const f=await completeLiteralStoppedRole(t,policy,withClaim),{observed}=f;
 let c=f.c;if(cold){await c.close();c=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>c.close());}
 const s=c.store,core=c.changeCore,plain=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id),beforeOccurrences=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),oldLaunch=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),originalHistory=JSON.parse(f.run.data).historyRef,historyHash=sha(fs.readFileSync(originalHistory)),births=launches.length,beforeBudgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId);
 assert.equal(oldLaunch.status,'UNUSABLE');assert.ok(JSON.parse(oldLaunch.data).materialAccounting);assert.equal(core.materialAccountingCandidates(f.workId).some(row=>row.id===f.launch.id),false,'Trusted complete accounting receipt needs no reharvest');assert.equal(core.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'),false);assert.ok(plain.every(row=>!JSON.parse(row.data).materialAssessment));assert.equal(plain.length,withClaim?1:0);
 if(withClaim){const source=plain[0],historical=await core.historicalPlanningProducer(f.workId,source.id);assert.deepEqual(historical.receivedFindings,[observed]);assert.equal(historical.witness.materialSource.source.sourceEntryId,JSON.parse(source.data).nativeEntryId);assert.equal(historical.witness.materialSource.source.complete,false);assert.equal(historical.witness.materialSource.submissionAttempt.interpretation,'Exact received literal material from a stopped submission stream only; no complete call, selected final, producer acceptance, diagnosis, semantic census or standing. Original query settlement proves received-byte custody, not a successful role.');}
 assert.equal(launches.length,births,'Reading the original claim must allocate no new model');assert.deepEqual(s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),oldLaunch);
 selectedScenario=async launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[],prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned ')),role=prompt.match(/^Perform the assigned (\w+) task/)[1],supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]);supplied.context=readFixtureMetadataContext(supplied.context);
  const output={...value,assessedScope:supplied.requiredScope};
  if(role==='planner'){const requirement=supplied.requirements[0],plan=mixedPlan(),check=plan.verification.checks[0];plan.requirements=[requirement];plan.verification.checks=[check];check.guaranteeIds=[requirement.id];for(const item of check.cases){item.guaranteeIds=[requirement.id];item.consumerPaths=['consumer.txt'];}plan.verification.strategies=[{kind:'consumer-cases',requirementId:requirement.id,checkIds:[check.id]}];plan.verification.requiredPaths=['consumer.txt'];for(const position of plan.verification.reviewRoles)position.requiredPaths=['consumer.txt'];output.plan=plan;}
  else if(role==='challenger')output.alternatives=[];
  else{assert.equal(role,'adjudicator');output.planAccepted=true;output.decisions=beforeOccurrences.map(o=>({occurrenceId:o.id,disposition:'rejected',reason:'Independent current judgment: discarded draft observation is not a current consumer defect',witnesses:[o.output]}));}
  Object.assign(output,writeFixtureVerificationDomain(output,supplied.context));
  await completeRoleFixture(launch,output);
 };
 const result=await c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.ok(result.planVersion);assert.equal(core.pending(f.workId).length,0);assert.equal(launches.length,births+3);const afterBudgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId);for(const old of beforeBudgets){const current=afterBudgets.find(b=>b.kind===old.kind);assert.equal(current.lim,old.lim);assert.equal(current.reserved,0);if(old.kind==='execution')assert.equal(current.consumed,old.consumed+3);else assert.ok(current.consumed>=old.consumed);}
 assert.deepEqual(s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),oldLaunch);assert.deepEqual(s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id),plain);assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),beforeOccurrences);assert.equal(sha(fs.readFileSync(originalHistory)),historyHash);assert.ok(launches.slice(births).every(l=>l.joined));assert.ok(s.all('SELECT data FROM role_outputs WHERE launch=?',f.launch.id).every(row=>JSON.parse(row.data).nativeSource===null));
});
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])for(const drift of ['raw','occurrence','history-read'])check('complete literal stopped source refuses '+policy+' '+drift+' drift',async t=>{
 const f=await completeLiteralStoppedRole(t,policy),s=f.c.store,core=f.c.changeCore,source=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id)[0];
 if(drift==='raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',source.raw+' ',source.id);
 if(drift==='occurrence'){const row=s.one('SELECT * FROM finding_occurrences WHERE output=?',source.id),data=JSON.parse(row.data);data.finding.description+=' unreceived replacement';s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),row.id);}
 const original=core.nativeEntries;if(drift==='history-read')core.nativeEntries=async function(...args){const entries=await original.apply(this,args);fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');return entries;};
 const births=launches.length,snapshot=()=>Object.fromEntries(['role_outputs','finding_occurrences','obligations','budgets','role_launches','runs'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')])),before=snapshot();
 try{await assert.rejects(core.historicalPlanningProducer(f.workId,source.id),/HISTORICAL_(?:MATERIAL_PROOF_UNAVAILABLE|NATIVE_SOURCE_CHANGED)/);}finally{core.nativeEntries=original;}assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);
});
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])for(const fault of ['global','unrelated-source'])check('complete literal stopped source refuses unrelated uncertainty '+policy+' '+fault,async t=>{
 const f=await completeLiteralStoppedRole(t,policy,true,fault),core=f.c.changeCore,s=f.c.store,source=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id).find(row=>row.raw===f.raw),births=launches.length;
 assert.ok(source);assert.ok(!JSON.parse(source.data).materialAssessment);await assert.rejects(core.historicalPlanningProducer(f.workId,source.id),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);assert.equal(launches.length,births);assert.equal(core.pending(f.workId).filter(o=>o.kind==='finding').length,1);assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',source.id),source);
});
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])for(const fault of ['global','unrelated-source'])check('stopped owned prefix retains unrelated uncertainty '+policy+' '+fault,async t=>{
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const claim=finding('Literal stopped claim with unrelated uncertainty'),raw='{"version":1,"findings":['+JSON.stringify(claim)+',';
 const f=await controllerRole(t,async launch=>{
  const event=event=>launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event});
  event({type:'message_start',message:{id:'unrelated-empty',role:'assistant',content:[]}});
  event(fault==='global'?{type:'content_block_stop',index:0}:{type:'content_block_start',index:0,content_block:{type:'text',text:''}});
  launch.format(raw,{complete:false,toolName:'mcp__custom-tools__gitjig_submit_role_result'});event({type:'message_stop'});await launch.settled;
 },'planner',{stage:'planning'});
 const core=f.c.changeCore,s=f.c.store,entries=await core.nativeEntries(f.run.id),intent=entries.find(e=>e.customType===nativeRoleEntries.intent),read=nativeRoleMaterial(entries,intent.id);
 assert.equal(read.materials.length,1);assert.equal(read.diagnostics.extraction.count,0);assert.equal(read.diagnostics.prefix.sources.size,2);assert.equal(read.diagnostics.prefix.sources.has(null),fault==='global');
 assert.equal(f.launch.status,'UNUSABLE');assert.equal(f.run.phase,'SETTLED');assert.ok(f.c.inspectChange(f.workId).occurrences.some(o=>o.data.finding.description===claim.description));
 assert.ok(s.all('SELECT data FROM role_outputs WHERE launch=?',f.launch.id).every(row=>!JSON.parse(row.data).materialAssessment));
 const births=launches.length;selectedScenario=()=>assert.fail('Unrelated uncertainty cannot spend another model attempt');
 const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.notEqual(result.phase,'PLAN_READY');assert.equal(launches.length,births);
 assert.ok(core.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'));assert.ok(s.all('SELECT raw FROM role_outputs WHERE launch=?',f.launch.id).some(row=>row.raw===raw));
});
check('init observer refusal preserves its primary failure without attempting settlement',async t=>{
 const {NativeRoleCollector}=await load('workflow/native-role-output.js'),{HostedQuery}=await import(new URL('./host.js',originalBridge)),observe=NativeRoleCollector.prototype.observe,settlement=HostedQuery.prototype.settlement;
 let attempts=0;const launchId=randomUUID();
 NativeRoleCollector.prototype.observe=async function(data){await observe.call(this,data);if(data.type==='system'&&data.subtype==='init')throw Error('CONTROLLED_INIT_OBSERVER_REFUSAL');};
 HostedQuery.prototype.settlement=function(...args){if(this.format?.request.binding.launchId===launchId)attempts++;return settlement.apply(this,args);};
 t.after(()=>{NativeRoleCollector.prototype.observe=observe;HostedQuery.prototype.settlement=settlement;});
 const f=await produce(launch=>completeRoleFixture(launch,value),{launchId});
 assert.equal(f.result.usable,false);assert.match(f.result.issues.join('\n'),/CONTROLLED_INIT_OBSERVER_REFUSAL/);assert.equal(attempts,0);assert.equal(f.entries.filter(e=>e.customType===nativeRoleEntries.settlement).length,0);assert.ok(f.launches.every(l=>l.joined));
});
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])for(const failure of ['abort','cleanup'])check('stopped observation settlement rechecks '+policy+' '+failure,async t=>{
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const {HostedQuery}=await import(new URL('./host.js',originalBridge)),finish=HostedQuery.prototype.finishNative,launchId=randomUUID(),cancelled=new AbortController();let interrupted=false;
 HostedQuery.prototype.finishNative=async function(...args){await finish.apply(this,args);if(this.format?.request.binding.launchId===launchId&&!interrupted){interrupted=true;if(failure==='abort')cancelled.abort(Error('Owner cancelled during source-failure cleanup'));else throw Error('BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN');}};
 t.after(()=>{HostedQuery.prototype.finishNative=finish;});
 const f=await produce(async launch=>{launch.format(JSON.stringify(value),{complete:false,toolName:'mcp__custom-tools__gitjig_submit_role_result'});launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event:{type:'message_stop'}});await launch.settled;},
 {launchId,role:'challenger',inputBundle:{...body,context:{stage:'planning-challenge',planProposal:mixedPlan()}},nativeCarrier:'tool-submission/v1',maxProviderRequests:3,signal:cancelled.signal});
 assert.ok(interrupted);assert.equal(f.result.usable,false);assert.equal(f.result.selectedFinalEntryId,null);assert.equal(f.result.providerRequests,1);assert.ok(f.launches.every(l=>l.joined));assert.equal(f.entries.filter(e=>e.customType===nativeRoleEntries.settlement).length,0);
});
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])check('original SDK source wait abort joins '+policy,async t=>{
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const {NativeRoleCollector}=await load('workflow/native-role-output.js'),original=NativeRoleCollector.prototype.submitObserved,cancelled=new AbortController();let entered=false,feedback;
 NativeRoleCollector.prototype.submitObserved=function(...args){const reply=original.call(this,'never-observed-source',args[1],args[2],args[3]);entered=true;cancelled.abort(Error('Original owner cancels pending source custody'));return reply;};t.after(()=>{NativeRoleCollector.prototype.submitObserved=original;});
 const f=await produce(async launch=>{feedback=await submitRole(launch,JSON.stringify({...value,alternatives:[]}));launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:'Original controlled pending tool query ended'});},{role:'challenger',inputBundle:{...body,context:{stage:'planning-challenge',planProposal:mixedPlan()}},nativeCarrier:'tool-submission/v1',maxProviderRequests:2,signal:cancelled.signal});
 assert.equal(entered,true,JSON.stringify(feedback)??'Original SDK callback was not entered');assert.equal(f.result.usable,false);assert.equal(f.result.nativeSource,undefined);assert.ok(f.launches.every(l=>l.joined));
 if(policy==='embedded-envelope/v2'){const intent=f.entries.find(e=>e.customType===nativeRoleEntries.intent);assert.equal(fs.existsSync(path.join(path.dirname(f.result.historyRef),intent.data.capture.stagingName)),false);}
});
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])for(const interruption of ['cancel','revoked'])check('original capture seal rechecks '+policy+' '+interruption,async t=>{
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const {NativeRoleCollector}=await load('workflow/native-role-output.js'),original=NativeRoleCollector.prototype.seal,cancelled=new AbortController();let interrupted=false;
 NativeRoleCollector.prototype.seal=async function(...args){await original.apply(this,args);if(!interrupted){interrupted=true;if(interruption==='cancel')cancelled.abort(Error('Owner cancelled during original capture seal'));}};
 t.after(()=>{NativeRoleCollector.prototype.seal=original;});
 const f=await produce(launch=>completeText(launch,JSON.stringify(value)),{nativeCarrier:'assistant-json/v1',signal:cancelled.signal,assertEntry(){if(interrupted&&interruption==='revoked')throw Error('Original role entry revoked during capture seal');}});
 assert.equal(interrupted,true);assert.equal(f.result.usable,false);assert.equal(f.result.selectedFinalEntryId,null);assert.equal(f.result.nativeSource,undefined);
 assert.equal(f.result.terminal,interruption==='cancel'?'aborted':'error');assert.ok(f.result.nativeCheckpoint);assert.ok(f.launches.every(l=>l.joined));
 if(policy==='embedded-envelope/v2'){const intent=f.entries.find(e=>e.customType===nativeRoleEntries.intent);assert.equal(fs.existsSync(path.join(path.dirname(f.result.historyRef),intent.data.capture.stagingName)),false);}
});

check('embedded capture selects near-bound original SDK text split into single characters',async t=>{
 globalThis.__nativeCapturePolicy='embedded-envelope/v2';t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 let sample='';for(let i=0;sample.length<30000;i++)sample+=sha('public synthetic text '+i);sample=sample.slice(0,30000);
 const output={...value,findings:Array.from({length:4},()=>({requirementId:'R1',severity:'blocking',repair:'unknown',description:sample,evidence:['controlled-source']}))},raw=JSON.stringify(output);
 assert.ok(Buffer.byteLength(raw)<128*1024);
 const f=await produce(launch=>completeText(launch,raw,{fragment:1}),{nativeCarrier:'assistant-json/v1',timeoutMs:45000});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(read(f),raw);
 const capsule=f.entries.find(e=>e.customType===nativeRoleEntries.capture);assert.ok(capsule.data.packets>120000);assert.ok(capsule.data.encodedBytes<8*1024*1024);assert.ok(capsule.data.logicalBytes<32*1024*1024);
 const {nativeCheckpoint}=await load('controller/history.js');assert.ok((await nativeCheckpoint(f.result.historyRef)).bytes<32*1024*1024);assert.ok(f.launches.every(l=>l.joined));
},{timeout:60000});

check('embedded capture retains its original capsule when derived history capacity refuses material',async t=>{
 globalThis.__nativeCapturePolicy='embedded-envelope/v2';const original=fs.statSync;let history,manager;
 fs.statSync=(file,...args)=>{const info=original(file,...args);if(file===history&&manager?.getBranch().some(e=>e.customType===nativeRoleEntries.capture))return {...info,size:32*1024*1024};return info;};syncBuiltinESMExports();
 t.after(()=>{fs.statSync=original;syncBuiltinESMExports();delete globalThis.__nativeCapturePolicy;});
 const f=await produce(launch=>completeText(launch,JSON.stringify(value)),{nativeCarrier:'assistant-json/v1',beforeModelRequest:async current=>{manager=current;history=current.getSessionFile();}});
 assert.equal(f.result.usable,false);assert.match(f.result.issues.join(),/NATIVE_HISTORY_STORAGE_LIMIT/);
 assert.equal(f.entries.filter(e=>e.customType===nativeRoleEntries.capture).length,1);assert.equal(f.entries.filter(e=>e.customType===nativeRoleEntries.material).length,0);
 const intent=f.entries.find(e=>e.customType===nativeRoleEntries.intent);assert.ok(nativeRoleMaterial(f.entries,intent.id).materials.some(m=>m.raw===JSON.stringify(value)));assert.ok(f.launches.every(l=>l.joined));
});

check('opt-in submission producer refuses a working nonbridge model before any dispatch',async()=>{
 const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai/compat');let providerCalls=0;
 const nonbridge={provider:'submission-refusal-control',modelId:'fixture',definition:{baseUrl:'http://unused.invalid',apiKey:'fixture-only',api:'fixture-api',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:4000}],streamSimple(selected){providerCalls++;const stream=createAssistantMessageEventStream();const message={role:'assistant',content:[{type:'text',text:JSON.stringify(value)}],api:selected.api,provider:selected.provider,model:selected.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message});stream.end(message);});return stream;}}};
 const healthy=await produce(()=>assert.fail('Nonbridge control must not create a Native query'),{maxNativeTurns:undefined,model:nonbridge});assert.equal(healthy.result.usable,true,JSON.stringify(healthy.result.issues));assert.equal(providerCalls,1);
 const f=await produce(()=>assert.fail('Unsupported carrier must not create a Native query'),{role:'planner',inputBundle:{...body,context:{stage:'planning'}},nativeCarrier:'tool-submission/v1',maxNativeTurns:undefined,model:nonbridge});
 assert.equal(providerCalls,1);assert.equal(f.checkpoints,0);assert.equal(f.launches.length,0);assert.equal(f.result.providerRequests,0);assert.equal(f.result.usable,false);assert.ok(f.result.issues.some(issue=>issue.includes('NATIVE_SUBMISSION_PROVIDER_UNSUPPORTED')));
});

async function submitRole(launch,raw,{omitReceipt=false,omitFalse=false,interim=[],assistantBeforeStop=false}={}) {
 const {tid}=launch.format(raw,{toolName:'mcp__custom-tools__gitjig_submit_role_result',carrier:false,interim,assistantBeforeStop});
 const response=await launch.mcp('tools/call',{name:'gitjig_submit_role_result',arguments:JSON.parse(raw),_meta:{'claudecode/toolUseId':tid}});
 const result=response.response?.mcp_response?.result;assert.ok(result,'Actual original MCP feedback is required');
 if(!omitReceipt)launch.send({type:'user',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:tid,...(omitFalse&&!result.isError?{}:{is_error:!!result.isError}),content:result.content}]}});
 return result;
}
for(const selection of ['explicit','current-default'])for(const [role,stage]of [['planner','planning'],['challenger','planning-challenge'],['adjudicator','planning-adjudication'],['implementer','implementation'],['repairer','substantive-repair']])for(const terminal of ['success','error','missing-receipt'])check((selection==='explicit'?'opt-in submission producer ':['implementer','repairer'].includes(role)?'current author submission producer ':'current planning submission producer ')+role+' '+terminal,async()=>{
 assert.equal(globalThis.__nativeRoleCarrier,undefined);
 const author=['implementer','repairer'].includes(role);
 const context=author?{stage}:{stage,planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8}};
 const output=writeFixtureVerificationDomain({...value,...(role==='planner'?{plan:mixedPlan()}:role==='challenger'?{alternatives:[]}:role==='adjudicator'?{decisions:[],planAccepted:false}:{})},context);
 const bad=structuredClone(output);if(role==='planner')delete bad.plan.verificationRequirements;else delete bad.findings;
 if(author)delete bad.assessedScope;
 const stagedPath=path.join(project,'author-staged.cjs'),stagedText='module.exports = 42;\n';
 const writes=[];
 const authorOperations={...operations,mkdir:async p=>assert.equal(p,project),writeFile:async(p,c)=>writes.push([p,c])};
 let actualFeedback,exactSchema;
 const f=await produce(async launch=>{
  assert.equal(launch.options.args.includes('--json-schema'),false);const tool=launch.tools.find(tool=>tool.name==='gitjig_submit_role_result');assert.ok(tool);exactSchema=tool.inputSchema;
  assert.match(JSON.stringify([launch.options.args,launch.frames]),/Keep summary to a short prose outcome and supply objects and arrays as native values/);
  const validate=new Ajv2020({strict:false}).compile(exactSchema);assert.equal(validate(output),true,JSON.stringify(validate.errors));assert.equal(validate(bad),false);
  if(author){
   const args={path:stagedPath,content:stagedText};
   const {tid}=launch.format(JSON.stringify(args),{toolName:'mcp__custom-tools__write',carrier:false});
   const response=await launch.mcp('tools/call',{name:'write',arguments:args,_meta:{'claudecode/toolUseId':tid}});
   const written=response.response?.mcp_response?.result;
   assert.ok(written);assert.notEqual(written.isError,true,JSON.stringify(written));
   launch.send({type:'user',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:tid,is_error:false,content:written.content}]}});
  }
  const failed=await submitRole(launch,JSON.stringify(bad));assert.equal(failed.isError,true);assert.match(JSON.stringify(failed),role==='planner'?/verificationRequirements/:/findings/);
  if(author)assert.match(JSON.stringify(failed),/assessedScope/);
  actualFeedback=await submitRole(launch,JSON.stringify(output),{omitReceipt:terminal==='missing-receipt',omitFalse:true});assert.notEqual(actualFeedback.isError,true);
  const receipt=JSON.parse(actualFeedback.content[0].text);
  assert.equal(receipt.provisional,true);
  assert.equal(receipt.nextAction,'Finish this query now with a brief plain final response and no further tool calls.');
  if(terminal==='error')launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:'Controlled failure after receipt'});
  else launch.finish(undefined,{result:'Ordinary final narrative; submitted object remains the only role source.'});
 },{role,inputBundle:{...body,context},...(selection==='explicit'?{nativeCarrier:'tool-submission/v1'}:{}),...(author?{operations:authorOperations,maxNativeTurns:4}:{}),maxProviderRequests:author?4:3});
 assert.equal(f.checkpoints,author?4:3,JSON.stringify(f.result.issues));assert.equal(f.result.providerRequests,f.checkpoints);assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
 if(author)assert.deepEqual(writes,[[stagedPath,stagedText]]);
 assert.equal(f.result.usable,terminal==='success',JSON.stringify(f.result.issues));
 const materials=nativeRoleMaterial(f.entries,f.entries.find(entry=>entry.customType===nativeRoleEntries.intent).id).materials;assert.equal(materials.filter(material=>material.selector==='submission-arguments').length,2);
 if(terminal==='success'){
  assert.equal(f.result.nativeSource.kind,'claude-sdk-tool-submission/v1');assert.equal(f.result.rawFinal,JSON.stringify(output));
  assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role,stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),JSON.stringify(output));
  assert.equal(f.intentReceipt.schemaDigest,sha(JSON.stringify(exactSchema)));
 }else {assert.equal(f.result.nativeSource,undefined);assert.equal(f.result.protocol,null);}
});
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])for(const blocking of [false,true])check('complete planner receives structural coverage feedback within its original submission query: '+policy+' '+blocking,async t=>{
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const context={stage:'planning',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8}},plan=mixedPlan();
 const output=writeFixtureVerificationDomain({...value,plan,...(blocking?{findings:[{requirementId:'behavior',severity:'blocking',repair:'unknown',description:'The current implementation still needs the proposed repair',evidence:['Controlled original consumer']}]}:{})},context);
 const invalid=structuredClone(output);invalid.plan.verification.checks[0].cases=invalid.plan.verification.checks[0].cases.filter(row=>row.kind==='healthy');
 let failed;
 const f=await produce(async launch=>{
  failed=await submitRole(launch,JSON.stringify(invalid));
  if(failed.isError!==true){launch.finish(undefined,{result:'Old producer admission accepted the incomplete consumer coverage'});return;}
  const accepted=await submitRole(launch,JSON.stringify(output));assert.notEqual(accepted.isError,true);
  launch.finish(undefined,{result:'Original planner query corrected its own declaration'});
 },{role:'planner',inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(failed.isError,true);assert.match(JSON.stringify(failed),/PLAN_VERIFICATION/);assert.match(JSON.stringify(failed),/consumer-case-adverse-missing/);
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,JSON.stringify(output));
 assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));assert.equal(f.result.providerRequests,3);
 const intent=f.entries.find(entry=>entry.customType===nativeRoleEntries.intent),materials=nativeRoleMaterial(f.entries,intent.id).materials.filter(material=>material.selector==='submission-arguments');
 assert.equal(materials.length,2);assert.ok(materials.some(material=>material.raw===JSON.stringify(invalid)));assert.ok(materials.some(material=>material.raw===JSON.stringify(output)));
});
for (const form of ['planner', 'adjudicator', 'bound-approval']) check('consumer control input conflict is correctable in the original submission query: '+form, async()=>{
 const role = form === 'planner' ? 'planner' : 'adjudicator';
 const plan = mixedPlan(), checkCase = plan.verification.checks[0], consumer = 'consumer.cjs';
 checkCase.consumerControl = {path:consumer, failedAssertions:[], observations:[]};
 checkCase.fixturePaths = [consumer];
 const invalid = structuredClone(plan);
 invalid.verification.checks[0].expectationPaths = [consumer];
 invalid.verification.checks[0].cases[0].input.fixturePaths = [consumer];
 const context = {stage:role === 'planner' ? 'planning' : 'planning-adjudication', planVersion:null,
  planningVerificationProfile:{...initialVerificationProfile,version:11}};
 if (form === 'bound-approval') Object.assign(context, {planProposal:invalid,
  proposalApproval:{version:1,plannerOutputId:'original-planner-output',proposalHash:sha(JSON.stringify(invalid)),plannerOutputHash:'a'.repeat(64)},
  plannerInputScope:{version:1,role:'planner',stage:'planning',outputId:'original-planner-output',launchId:'original-planner',workId:'original-work'}});
 const encode = proposal => JSON.stringify(writeFixtureVerificationDomain({...value, ...(role === 'planner'
  ? {plan:proposal} : {decisions:[],planAccepted:true,...(proposal ? {acceptedPlan:proposal} : {})})},context));
 const corrected = encode(plan);
 const f = await produce(async launch => {
  const refused = await submitRole(launch,encode(form === 'bound-approval' ? undefined : invalid));
  assert.equal(refused.isError,true);
  assert.match(refused.content[0].text,/PLAN_VERIFICATION.*consumer\.cjs/);
  assert.match(refused.content[0].text,/expectationPaths and case\.input\.fixturePaths/);
  const accepted = await submitRole(launch,corrected);
  assert.notEqual(accepted.isError,true,JSON.stringify(accepted));
  assert.equal(JSON.parse(accepted.content[0].text).provisional,true);
  launch.finish(undefined,{result:'Original query corrected the declared inputs'});
 },{role,inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
 assert.equal(f.result.rawFinal,corrected);
 assert.equal(f.launches.length,1);
 assert.equal(f.result.providerRequests,3);
});
check('planning submission explains diagnosis and field errors before a corrected same-query result',async()=>{
 const context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:10}};
 const output={...value,planAccepted:false,decisions:[{occurrenceId:'original-finding',disposition:'upheld',
  reason:'Original concern remains relevant to this proposal',witnesses:['Original plan and source']}]};
 const wrongPlan=writeFixtureVerificationDomain({...structuredClone(output),planAccepted:true,acceptedPlan:mixedPlan()},context);
 delete wrongPlan.acceptedPlan.verification.checks;
 delete wrongPlan.acceptedPlan.verification.requiredPaths;
 delete wrongPlan.acceptedPlan.verification.reviewRoles;
 const diagnosis=structuredClone(output);
 diagnosis.decisions.unshift({...diagnosis.decisions[0],occurrenceId:'first-original-finding'});
 diagnosis.decisions[1].diagnosis={outputId:'prior-output',rawSha256:'a'.repeat(64),inputReceiptHash:'b'.repeat(64),materialOccurrenceIds:[]};
 const wrongFields=structuredClone(output);
 delete wrongFields.decisions[0].witnesses;
 wrongFields.decisions[0]['unsupported\nfield\u009b\u202e']='ARGUMENT_VALUE_IS_NOT_DIAGNOSTIC';
 const attempts=[wrongPlan,diagnosis,wrongFields,output].map(item=>JSON.stringify(item));
 let schemaDigest;
 const f=await produce(async launch=>{
  const tool=launch.tools.find(tool=>tool.name==='gitjig_submit_role_result');
  schemaDigest=sha(JSON.stringify(tool.inputSchema));
  const validate=new Ajv2020({strict:false}).compile(tool.inputSchema);
  assert.equal(validate(wrongFields),false);assert.equal(validate(output),true);
  const badPlan=await submitRole(launch,attempts[0]),badDiagnosis=await submitRole(launch,attempts[1]),badFields=await submitRole(launch,attempts[2]);
  assert.equal(badPlan.isError,true);
  assert.match(badPlan.content[0].text,/acceptedPlan\.verification:.*missing \["checks","requiredPaths","reviewRoles"\]/);
  assert.equal(badDiagnosis.isError,true);
  assert.match(badDiagnosis.content[0].text,/decisions\[1\]\.diagnosis:.*Omit diagnosis for other outcomes/);
  assert.equal(badFields.isError,true);
  assert.match(badFields.content[0].text,/decisions\[0\]: Unexpected or missing fields/);
  assert.ok(badFields.content[0].text.includes('missing ["witnesses"], unexpected ["unsupported\\nfield\\u009b\\u202e"]'));
  for(const receipt of [badPlan,badDiagnosis,badFields])
   assert.doesNotMatch(receipt.content[0].text,/must match "then"|Received arguments:|ARGUMENT_VALUE_IS_NOT_DIAGNOSTIC|prior-output/);
  const accepted=await submitRole(launch,attempts[3]);
  assert.notEqual(accepted.isError,true);
  assert.equal(JSON.parse(accepted.content[0].text).provisional,true);
  launch.finish(undefined,{result:'Original query completed after correcting the submitted result'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:5});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
 assert.equal(f.result.rawFinal,attempts[3]);
 assert.equal(f.result.providerRequests,5);
 assert.equal(f.intentReceipt.schemaDigest,schemaDigest);
 assert.equal(f.launches.length,1);
 assert.ok(f.launches[0].joined);
 const intent=f.entries.find(entry=>entry.customType===nativeRoleEntries.intent);
 const materials=nativeRoleMaterial(f.entries,intent.id).materials.filter(material=>material.selector==='submission-arguments');
 assert.deepEqual(materials.map(material=>material.raw),attempts);
});

check('structural plan feedback rejects all missing consumer kinds and accepts a corrected same-query submission',async()=>{
 const context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8}};
 const plan=mixedPlan();plan.requirements.push({id:'custom-field',text:'Honor the selected grouping field',source:'owner-request'});
 plan.verification.strategies.push({requirementId:'custom-field',kind:'consumer-cases',checkIds:['behavior-check']});
 plan.verification.checks[0].guaranteeIds.push('custom-field');for(const item of plan.verification.checks[0].cases)item.guaranteeIds.push('custom-field');
 const output=writeFixtureVerificationDomain({...value,decisions:[],planAccepted:true,acceptedPlan:plan},context),invalid=structuredClone(output);
 invalid.acceptedPlan.verification.checks[0].cases=invalid.acceptedPlan.verification.checks[0].cases.filter(row=>row.kind==='healthy');
 const f=await produce(async launch=>{
  const failed=await submitRole(launch,JSON.stringify(invalid));assert.equal(failed.isError,true);
  const feedback=JSON.stringify(failed);assert.match(feedback,/PLAN_VERIFICATION/);assert.match(feedback,/consumer-case-adverse-missing/);assert.match(feedback,/behavior/);assert.match(feedback,/custom-field/);assert.doesNotMatch(feedback,/provisional/);
  const accepted=await submitRole(launch,JSON.stringify(output));assert.notEqual(accepted.isError,true);assert.equal(JSON.parse(accepted.content[0].text).provisional,true);
  launch.finish(undefined,{result:'Original query completed after correcting its actual verification plan'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));assert.equal(f.checkpoints,3);assert.equal(f.result.providerRequests,3);
 assert.equal(f.result.rawFinal,JSON.stringify(output));
 const intent=f.entries.find(entry=>entry.customType===nativeRoleEntries.intent),materials=nativeRoleMaterial(f.entries,intent.id).materials.filter(material=>material.selector==='submission-arguments');
 assert.equal(materials.length,2);assert.ok(materials.some(material=>material.raw===JSON.stringify(invalid)));assert.ok(materials.some(material=>material.raw===JSON.stringify(output)));
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage:context.stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),JSON.stringify(output));
});
check('submission reports role header and bound-plan errors before one same-query correction',async()=>{
 const plan=mixedPlan(),context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8},planProposal:plan,
  proposalApproval:{version:1,plannerOutputId:'original-planner-output',proposalHash:sha(JSON.stringify(plan)),plannerOutputHash:'a'.repeat(64)},
  plannerInputScope:{version:1,role:'planner',stage:'planning',outputId:'original-planner-output',launchId:'original-planner',workId:'original-work'}};
 const output={...value,decisions:[],planAccepted:true}, {version,...rest}=output;
 const omissions=Array.from({length:3},(_,i)=>({occurrenceId:'missing-'+i,disposition:'rejected',reason:'Controlled row without witnesses'}));
 const unpaired={occurrenceId:'diagnostic',disposition:'upheld',reason:'Controlled unpaired diagnosis',witnesses:[],diagnosis:{}};
 const malformed=JSON.stringify({...rest,decisions:[...omissions,unpaired],acceptedPlan:{},['\u202e'.repeat(500)]:'PRIVATE_ARGUMENT_SENTINEL'}),corrected=JSON.stringify({version,...rest});
 const f=await produce(async launch=>{
  const rejection=await submitRole(launch,malformed);
  assert.equal(rejection.isError,true);
  const feedback=rejection.content[0].text;
  assert.match(feedback,/RoleOutput:.*missing \["version"\]/);
  assert.match(feedback,/acceptedPlan is empty.*Omit acceptedPlan/);
  for(const i of [0,1,2])assert.ok(feedback.includes('decisions['+i+']')&&feedback.includes('witnesses'));
  assert.match(feedback,/decisions\[3\]\.diagnosis:.*Omit diagnosis/);
  assert.doesNotMatch(feedback,/PRIVATE_ARGUMENT_SENTINEL|\u202e/);
  assert.ok(Buffer.byteLength(feedback)<2400);
  const accepted=await submitRole(launch,corrected);
  assert.equal(accepted.isError!==true,true);
  assert.equal(JSON.parse(accepted.content[0].text).provisional,true);
  launch.finish(undefined,{result:'Original query completed after one correction'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
 assert.equal(f.result.rawFinal,corrected);
 assert.equal(f.result.providerRequests,3);
 assert.equal(f.launches.length,1);assert.ok(f.launches[0].joined);
 const intent=f.entries.find(entry=>entry.customType===nativeRoleEntries.intent);
 assert.deepEqual(nativeRoleMaterial(f.entries,intent.id).materials.filter(material=>material.selector==='submission-arguments').map(material=>material.raw),[malformed,corrected]);
});
for(const explicit of [false,true])check('structural plan feedback selects '+(explicit?'explicit plan before bound approval':'authenticated unchanged proposal'),async t=>{
 useFormatterFixture(t);
 const plan=mixedPlan(),context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8},planProposal:plan,
  proposalApproval:{version:1,plannerOutputId:'original-planner-output',proposalHash:sha(JSON.stringify(plan)),plannerOutputHash:'a'.repeat(64)},
  plannerInputScope:{version:1,role:'planner',stage:'planning',outputId:'original-planner-output',launchId:'original-planner',workId:'original-work'}};
 const incomplete=structuredClone(plan);incomplete.verification.checks[0].cases=[];
 const output=writeFixtureVerificationDomain({...value,decisions:[],planAccepted:true,...(explicit?{acceptedPlan:incomplete}:{})},context),raw=JSON.stringify(output);
 const f=await produce(launch=>{launch.format(raw);launch.finish(output);},{role:'adjudicator',inputBundle:{...body,context}});
 assert.equal(f.result.usable,!explicit,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);
 if(explicit)assert.ok(f.result.issues.some(issue=>issue.startsWith('PLAN_VERIFICATION:')));
 assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
});
for(const carrier of ['formatter','text'])check('structural plan feedback refuses incomplete accepting selected '+carrier+' output',async t=>{
 if(carrier==='formatter')useFormatterFixture(t);else useTextFixture(t);
 const context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8}},plan=mixedPlan();plan.verification.checks[0].cases=[];
 const output=writeFixtureVerificationDomain({...value,decisions:[],planAccepted:true,acceptedPlan:plan},context),raw=JSON.stringify(output);
 const f=await produce(launch=>{if(carrier==='formatter'){launch.format(raw);launch.finish(output);}else completeText(launch,raw);},{role:'adjudicator',inputBundle:{...body,context}});
 assert.equal(f.result.usable,false);assert.ok(f.result.issues.some(issue=>issue.startsWith('PLAN_VERIFICATION:')));assert.equal(f.result.rawFinal,raw);assert.ok(f.launches.every(launch=>launch.joined));
});
for(const mode of ['planner','decline','clarification'])check('structural plan feedback preserves incomplete '+mode+' entry',async()=>{
 const role=mode==='planner'?'planner':'adjudicator',context={stage:mode==='planner'?'planning':'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8}},plan=mixedPlan();plan.verification.checks[0].cases=[];
 if(mode==='planner')plan.verification.strategies=plan.verification.strategies.filter(strategy=>strategy.requirementId!=='behavior');
 const output=writeFixtureVerificationDomain({...value,...(mode==='planner'?{plan,findings:[{requirementId:'behavior',severity:'blocking',repair:'unknown',description:'The missing consumer contract prevents a complete strategy proposal',evidence:['Controlled owner ambiguity']}]}:{decisions:[],planAccepted:mode==='clarification',acceptedPlan:plan,...(mode==='clarification'?{ownerDecisionRequired:['Choose the intended consumer contract']}:{})})},context);
 const f=await produce(launch=>completeRoleFixture(launch,output),{role,inputBundle:{...body,context},maxProviderRequests:2});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,JSON.stringify(output));assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
});
for(const carrier of ['formatter','text'])check('complete planner final '+carrier+' output remains available to independent challenge',async t=>{
 if(carrier==='formatter')useFormatterFixture(t);else useTextFixture(t);
 const context={stage:'planning',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8}},plan=mixedPlan();plan.verification.checks[0].cases=[];
 const output=writeFixtureVerificationDomain({...value,plan},context),raw=JSON.stringify(output);
 const f=await produce(launch=>{if(carrier==='formatter'){launch.format(raw);launch.finish(output);}else completeText(launch,raw);},{role:'planner',inputBundle:{...body,context}});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);
 assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
});
check('native source-fit refuses an agent amendment and accepts an explanation in the same query',async()=>{
 const context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:11},
  sourceFitReferences:{version:1,stage:'planning-adjudication',inputs:[{inputId:'held-agent-input',directionRevision:2}],requirementIds:[]},
  sourceInputChain:[{input_id:'held-agent-input',revision:2,sourceOrigin:'agent-governed-reentry',
   text:'Correct the check input declaration while keeping the original behavior.',data:{effectHold:true}}]};
 const output=writeFixtureVerificationDomain({...value,decisions:[],planAccepted:true,acceptedPlan:mixedPlan(),
  inputDecisions:[{inputId:'held-agent-input',directionRevision:2,impact:'explanation',reason:'The corrected input keeps the required observation',requirementIds:['behavior']}]},context);
 const invalid=structuredClone(output);invalid.inputDecisions[0].impact='scope-change';
 const f=await produce(async launch=>{
  const refused=await submitRole(launch,JSON.stringify(invalid));
  assert.equal(refused.isError,true);
  assert.match(refused.content[0].text,/SOURCE_FIT_AUTHORITY.*verified owner input/);
  const accepted=await submitRole(launch,JSON.stringify(output));
  assert.equal(JSON.parse(accepted.content[0].text).provisional,true);
  launch.finish(undefined,{result:'Original query settled after classifying the actual compatible direction'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
 assert.equal(f.result.rawFinal,JSON.stringify(output));
 assert.equal(f.launches.length,1);
 assert.equal(f.result.providerRequests,3);
});
check('source-fit references reject unknown planning IDs and accept corrected same-query submission',async()=>{
 const context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8},
  sourceFitReferences:{version:1,stage:'planning-adjudication',inputs:[{inputId:'held-source',directionRevision:2}],requirementIds:[]},
  sourceInputChain:[{input_id:'held-source',revision:2,text:'Continue the original task without expanding its scope',data:{effectHold:true}}]};
 const output=writeFixtureVerificationDomain({...value,decisions:[],planAccepted:true,acceptedPlan:mixedPlan(),
  inputDecisions:[{inputId:'held-source',directionRevision:2,impact:'explanation',reason:'The source preserves the original behavior requirement',requirementIds:['behavior']}]},context);
 const invalid=structuredClone(output);invalid.inputDecisions[0].requirementIds.push('owner-request');
 let rejected,accepted;
 const f=await produce(async launch=>{
  rejected=await submitRole(launch,JSON.stringify(invalid));assert.equal(rejected.isError,true);
  assert.match(JSON.stringify(rejected),/effective plan requirements, not input\/source locators/);assert.doesNotMatch(JSON.stringify(rejected),/provisional/);
  accepted=await submitRole(launch,JSON.stringify(output));assert.notEqual(accepted.isError,true);assert.equal(JSON.parse(accepted.content[0].text).provisional,true);
  launch.finish(undefined,{result:'The original query settled after its corrected provisional submission'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
 assert.equal(f.checkpoints,3);assert.equal(f.result.providerRequests,3);assert.equal(f.result.rawFinal,JSON.stringify(output));
 const intent=f.entries.find(entry=>entry.customType===nativeRoleEntries.intent);
 const materials=nativeRoleMaterial(f.entries,intent.id).materials.filter(material=>material.selector==='submission-arguments');assert.equal(materials.length,2);
 assert.ok(materials.some(material=>material.raw===JSON.stringify(invalid)),'Rejected original remains retained, not silently repaired');
 assert.ok(materials.some(material=>material.raw===JSON.stringify(output)));
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage:context.stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),JSON.stringify(output));
});
for(const mode of ['current','retained','reopened','unknown-proof','optional','partial-subjects','ambiguous-subject'])check('current equivalence accounting feedback preserves '+mode+' graph',async()=>{
 const finding={requirementId:'R',severity:'blocking',repair:'unknown',description:'Original independently received concern',evidence:['Original proposal']};
 const ids=['retained','reopened'].includes(mode)?['M','R','T']:['M','T'];
 const context={stage:'planning-adjudication',planVersion:null,
  decisionReferences:{version:3,occurrenceIds:ids,diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:ids.map((_,i)=>i),retentionChoices:[]},
  occurrences:ids.filter(id=>mode!=='partial-subjects'||id!=='T').map(id=>({id,data:{finding:{...finding,...(mode==='optional'&&id==='T'?{severity:'optional'}:{})}}}))};
 const equivalent=(id,target)=>({occurrenceId:id,disposition:'equivalent',equivalentTo:target,reason:'Same retained condition',witnesses:[]});
 const reject={occurrenceId:'T',disposition:'rejected',reason:'Independent current rejection',witnesses:['Original proposal contradicts the concern']};
 const output={...value,planAccepted:false,decisions:[equivalent('M',ids.includes('R')?'R':'T')]};
 let history,launchId=randomUUID();
 if(ids.includes('R')){
  const {buildDispositionHistory}=await load('workflow/disposition-history.js'),id=randomUUID();
  history=buildDispositionHistory({id,workId:'original-equivalence-work',epoch:1,artifactRoot,records:[
   {id:'prior-edge',occurrence:'R',launch:'original-J',status:'equivalent',data:{...equivalent('R','T'),witnesses:['Original retained correspondence']}},
   {id:'prior-target',occurrence:'T',launch:'original-J',status:'rejected',data:reject}]});
  fs.writeFileSync(history.manifest.path,history.contents,{mode:0o600});
  Object.assign(context,{latestDispositionInput:{version:1},dispositionHistoryInput:{version:1,id},dispositionHistory:history.manifest,dispositions:history.latest,
   obligationStates:['R','T'].map(id=>({id,currentPending:false,data:{state:'resolved'}}))});
 }
 if(mode==='current'||mode==='partial-subjects')output.decisions.push(reject);
 if(mode==='optional'){context.decisionReferences.blockingOrdinaryIndexes=[0];output.decisions.push({...reject,disposition:'upheld'});}
 if(mode==='ambiguous-subject'){context.occurrences.push({id:'T',data:{finding:{...finding,severity:'optional'}}});output.decisions.push({...reject,disposition:'upheld'});}
 if(mode==='reopened')output.decisions.push({...reject,disposition:'upheld',witnesses:[]});
 if(mode==='unknown-proof')output.decisions.push({...reject,disposition:'upheld',resolution:'repaired'});
 const needsWitness=['current','retained','optional'].includes(mode);let attempts=0;
 const f=await produce(async launch=>{
  if(mode==='retained'){
   // Original topology and terminal state must survive caller mutation after capture.
   context.dispositions[0].data.equivalentTo='M';context.obligationStates[1].data.state='pending';
  }
  const first=await submitRole(launch,JSON.stringify(output));attempts++;
  if(needsWitness){
   assert.equal(first.isError,true);assert.match(JSON.stringify(first),/DECISION_EVIDENCE.*Resolved equivalence needs retained witness: M/);
   assert.doesNotMatch(JSON.stringify(first),/provisional/);
   output.decisions[0].witnesses=['Original proposal proves this member matches the independently rejected target'];
   assert.notEqual((await submitRole(launch,JSON.stringify(output))).isError,true);attempts++;
  }else assert.notEqual(first.isError,true,'Pending or unavailable proof cannot be silently turned into closure');
  launch.finish(undefined,{result:'Original declined planning query settled without adopting any plan'});
 },{launchId,role:'adjudicator',inputBundle:{...body,context},...(history?{inputEvidence:{launchId,manifests:[history.manifest]}}:{}),maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.protocol.planAccepted,false);
 assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));assert.equal(f.result.providerRequests,needsWitness?3:2);
 const materials=nativeRoleMaterial(f.entries,f.entries.find(entry=>entry.customType===nativeRoleEntries.intent).id).materials.filter(material=>material.selector==='submission-arguments');
 assert.equal(materials.length,attempts);if(needsWitness)assert.ok(materials.some(m=>JSON.parse(m.raw).decisions[0].witnesses.length===0),'Rejected material remains original');
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId,role:'adjudicator',stage:context.stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),f.result.rawFinal);
});
for(const hasSubject of [true,false])check('current decision evidence feedback uses captured original subjects; available='+hasSubject,async()=>{
 const finding={requirementId:'R',severity:'optional',repair:'unknown',description:'Explicit null handling is unclear',evidence:['Original proposal']};
 const context={stage:'planning-adjudication',planVersion:null,decisionCarry:{version:2},
  decisionReferences:{version:3,occurrenceIds:['O'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[],retentionChoices:[]},
  ...(hasSubject?{occurrences:[{id:'O',data:{finding}}]}:{})};
 const output={...value,planAccepted:false,decisions:[{occurrenceId:'O',disposition:'upheld',reason:'The optional suggestion is explicitly accounted for',witnesses:[],implementation:{kind:'none'}}]};
 let attempts=0;
 const f=await produce(async launch=>{
  // Caller mutation cannot turn the original optional subject into a blocking exception.
  finding.severity='blocking';
  const first=await submitRole(launch,JSON.stringify(output));attempts++;
  if(hasSubject){
   assert.equal(first.isError,true);assert.match(JSON.stringify(first),/DECISION_EVIDENCE.*O/);
   assert.doesNotMatch(JSON.stringify(first),/provisional/);
   output.decisions[0].witnesses=['Original proposal explicitly excludes null records'];
   assert.notEqual((await submitRole(launch,JSON.stringify(output))).isError,true);attempts++;
  }else assert.notEqual(first.isError,true,'Unavailable source cannot be replaced with an invented finding');
  launch.finish(undefined,{result:'Original query settled with selected submission'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
 assert.equal(f.result.nativeSource.kind,'claude-sdk-tool-submission/v1');
 assert.equal(nativeRoleMaterial(f.entries,f.entries.find(entry=>entry.customType===nativeRoleEntries.intent).id).materials.filter(material=>material.selector==='submission-arguments').length,attempts);
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage:context.stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),JSON.stringify(output));
});
for(const carrier of ['formatter','text'])check('fresh decision evidence rejects invalid selected output without rewriting '+carrier+' source',async t=>{
 if(carrier==='formatter')useFormatterFixture(t);else useTextFixture(t);
 const context={stage:'planning-adjudication',planVersion:null,
  decisionReferences:{version:3,occurrenceIds:['O'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[],retentionChoices:[]},
  occurrences:[{id:'O',data:{finding:{requirementId:'R',severity:'optional',repair:'unknown',description:'Original optional concern',evidence:['Original proposal']}}}]};
 const output={...value,planAccepted:false,decisions:[{occurrenceId:'O',disposition:'upheld',reason:'Independent optional accounting',witnesses:[]}]};
 const f=await produce(launch=>{if(carrier==='formatter'){launch.format(JSON.stringify(output));launch.finish(output);}else completeText(launch,JSON.stringify(output));},{role:'adjudicator',inputBundle:{...body,context}});
 assert.equal(f.result.usable,false);assert.ok(f.result.issues.some(issue=>issue.startsWith('DECISION_EVIDENCE:')));
 assert.equal(f.result.rawFinal,JSON.stringify(output));assert.deepEqual(f.result.protocol.decisions,output.decisions);
 assert.ok(f.launches.every(launch=>launch.joined));assert.equal(f.result.nativeSource.kind,carrier==='formatter'?'claude-sdk-formatter/v1':'claude-sdk-assistant-json/v1');
});
check('current planning submission preserves captured plan-repair grammar and original feedback',async()=>{
 const {requirements,...planFields}=mixedPlan(),proposal={...planFields,requirements},proposalHash=sha(JSON.stringify(proposal));
 const context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8},planProposal:proposal,
  proposalApproval:{version:1,plannerOutputId:'original-planner-output',proposalHash,plannerOutputHash:'a'.repeat(64)},
  plannerInputScope:{version:1,role:'planner',stage:'planning',outputId:'original-planner-output',launchId:'original-planner',workId:'original-work'},
  decisionReferences:{version:3,occurrenceIds:['O'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]},
  planningRepair:{version:1,subjects:[{occurrenceId:'O',proposalHash,producerOutputId:'original-challenger-output'}]}};
 const amended=structuredClone(proposal);amended.approach+='; independently corrected plan scope';
 const output=writeFixtureVerificationDomain({...value,decisions:[{occurrenceId:'O',disposition:'upheld',resolution:'repaired',repair:{kind:'plan',proposalHash},reason:'Original proposal artifact has a corrected independently assessed scope',witnesses:['Original proposal and complete amendment']}],planAccepted:true,acceptedPlan:amended},context);
 const bad=structuredClone(output);bad.decisions[0].repair.proposalHash='b'.repeat(64);
 const {acceptedPlan:_amended, ...implicitUnchanged}=output;
 const explicitUnchanged=writeFixtureVerificationDomain({...implicitUnchanged,acceptedPlan:proposal}, context);
 const f=await produce(async launch=>{
  const tool=launch.tools.find(tool=>tool.name==='gitjig_submit_role_result'),validate=new Ajv2020({strict:false}).compile(tool.inputSchema);
  assert.equal(validate(output),true,JSON.stringify(validate.errors));assert.equal(validate(bad),false);
  assert.equal((await submitRole(launch,JSON.stringify(bad))).isError,true);
  const refused = await submitRole(launch,JSON.stringify({...output,planAccepted:false}));
  assert.equal(refused.isError,true);
  assert.match(refused.content[0].text,/PLAN_REPAIR:.*planAccepted:true for your corrected plan/);
  for (const [kind,unchanged] of [['unchanged approval',implicitUnchanged],['unchanged explicit plan',explicitUnchanged]]) {
   const rejected=await submitRole(launch,JSON.stringify(unchanged));
   assert.equal(rejected.isError,true,kind);
   assert.match(rejected.content[0].text,/PLAN_REPAIR:.*unchanged accepted proposal/);
   assert.doesNotMatch(rejected.content[0].text,/provisional/);
  }
  assert.notEqual((await submitRole(launch,JSON.stringify(output))).isError,true);
  launch.finish(undefined,{result:'Original plan-subject request submitted; host adoption remains separate'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:6});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.providerRequests,6);assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
 assert.equal(f.result.nativeSource.kind,'claude-sdk-tool-submission/v1');
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage:context.stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),JSON.stringify(output));
});
for (const mode of ['planner','adjudicator','pending','omitted','legacy']) check('current check amendment membership at Native submission: '+mode,async()=>{
 const role=mode==='planner'?'planner':'adjudicator';
 const stage=role==='planner'?'planning':'planning-adjudication';
 const context={stage,planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:mode==='legacy'?11:12},
  ...(mode==='omitted'?{}:{pendingObligations:mode==='pending'?[{id:'actual-check',kind:'check',failedReceipt:'latest-repeated-failure'}]:mode==='adjudicator'?[{id:'claim',kind:'finding'}]:[]})};
 const plan=mixedPlan(), correctedCheckId=plan.verification.checks[0].id;
 const payload=plan=>writeFixtureVerificationDomain({...value,...(role==='planner'?{plan}:{planAccepted:true,acceptedPlan:plan,decisions:[]})},context);
 const amended=structuredClone(plan);
 amended.verification.checkAmendments=[{obligationId:mode==='pending'?'actual-check':'claim',failedCheckRunId:'earlier-failed-receipt',
  basis:'fixture-defect',correctedCheckId,fixturePaths:[],caseIds:['invalid'],negativeAssertions:['actual-consumer'],reason:'Correct actual check expectation'}];
 const blocked=mode==='planner'||mode==='adjudicator';
 const final=payload(blocked?plan:amended);
 const f=await produce(async launch=>{
  if(blocked){
   const refused=await submitRole(launch,JSON.stringify(payload(amended)));
   assert.equal(refused.isError,true);
   assert.match(refused.content[0].text,/PLAN_VERIFICATION: verification\.checkAmendments\[0\].*correct the check directly/);
   assert.doesNotMatch(refused.content[0].text,/provisional/);
  }
  assert.notEqual((await submitRole(launch,JSON.stringify(final))).isError,true);
  launch.finish(undefined,{result:'Original corrected query settled'});
 },{role,inputBundle:{...body,context},maxProviderRequests:blocked?3:2});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
 assert.equal(f.launches.length,1);
 assert.equal(f.result.rawFinal,JSON.stringify(final));
});
check('planning submission corrects a terminal implementation action without changing independent decisions',async()=>{
 const context={stage:'planning-adjudication',planVersion:null,decisionCarry:{version:2},
  planningVerificationProfile:{...initialVerificationProfile,version:8},
  decisionReferences:{version:3,occurrenceIds:['optional','pending','terminal','equivalent'],
   diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0,1,2,3],blockingOrdinaryIndexes:[1],retentionChoices:[]},
  occurrences:['optional','pending','terminal','equivalent'].map(id=>({id,data:{finding:{
   requirementId:'behavior',severity:id==='pending'?'blocking':'optional',repair:id==='pending'?'substantive':'unknown',
   description:'Actual original supplied finding '+id,evidence:['Recorded original evidence']}}}))};
 const assign={kind:'assign-to-plan',baselineVersion:'B',requirementIds:['behavior']};
 const none={kind:'none'};
 const output=writeFixtureVerificationDomain({...value,planAccepted:true,acceptedPlan:mixedPlan(),
  decisions:[
   {occurrenceId:'optional',disposition:'upheld',reason:'Useful optional observation',witnesses:['Retained optional evidence'],implementation:none},
   {occurrenceId:'pending',disposition:'upheld',reason:'Actual BASE failure remains pending',witnesses:['Retained BASE evidence'],implementation:assign},
   {occurrenceId:'terminal',disposition:'rejected',reason:'Original target is disproved',witnesses:['Retained counterexample']},
   {occurrenceId:'equivalent',disposition:'equivalent',equivalentTo:'terminal',reason:'Same issue as separately judged target',
    witnesses:['Retained comparison'],implementation:none},
  ]},context);
 const incorrect=structuredClone(output);incorrect.decisions[0].implementation=assign;
 const repaired=structuredClone(output);repaired.decisions[0].resolution='repaired';
 const f=await produce(async launch=>{
  const first=await submitRole(launch,JSON.stringify(incorrect));
  assert.equal(first.isError,true);assert.match(first.content[0].text,/DECISION_ACCOUNTING:.*optional.*Use implementation with kind 'none'/);
  assert.doesNotMatch(first.content[0].text,/provisional/);
  const second=await submitRole(launch,JSON.stringify(repaired));
  assert.equal(second.isError,true);assert.match(second.content[0].text,/Omit implementation unless this decision is upheld or equivalent and has no resolution/);
  const last=await submitRole(launch,JSON.stringify(output));
  assert.notEqual(last.isError,true);assert.equal(JSON.parse(last.content[0].text).provisional,true);
  launch.finish(undefined,{result:'Original query settled after correcting only its implementation actions'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:4});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.launches.length,1);
 assert.deepEqual(f.result.protocol.decisions,output.decisions);
 assert.equal(f.result.rawFinal,JSON.stringify(output));
});
for(const carryVersion of [2,3])check('planning submission reports the exact invalid implementation before Pi generic schema feedback v'+carryVersion,async()=>{
 const baseSource='base:consumer.cjs';
 const carry=carryVersion===3?{decisionCarryInput:{version:3},decisionCarry:{version:3,baselineVersion:'B',baseSourceIds:[baseSource]}}:{decisionCarry:{version:2}};
 const context={stage:'planning-adjudication',planVersion:null,...carry,
  planningVerificationProfile:{...initialVerificationProfile,version:carryVersion===3?10:8},
  decisionReferences:{version:3,occurrenceIds:['O'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]}};
 const plan=mixedPlan(), output=writeFixtureVerificationDomain({...value,planAccepted:true,acceptedPlan:plan,
  decisions:[{occurrenceId:'O',disposition:'upheld',reason:'The original concern still needs a BASE assignment',witnesses:['Original proposal'],
   implementation:{kind:'assign-to-plan',baselineVersion:'B',requirementIds:[plan.requirements[0].id],...(carryVersion===3?{baseSourceIds:[baseSource]}:{})}}]},context);
 const invalid=structuredClone(output);
 const missing=carryVersion===2;
 if(missing)delete invalid.decisions[0].implementation;
 else invalid.decisions[0].implementation={kind:'none'};
 const raw=JSON.stringify(output), rejectedRaw=JSON.stringify(invalid);
 const f=await produce(async launch=>{
  const tool=launch.tools.find(tool=>tool.name==='gitjig_submit_role_result'),validate=new Ajv2020({strict:false}).compile(tool.inputSchema);
  assert.equal(validate(invalid),false);
  assert.equal(validate(output),true,JSON.stringify(validate.errors));
  const rejected=await submitRole(launch,rejectedRaw);
  assert.equal(rejected.isError,true);
  assert.match(rejected.content[0].text,missing?/decisions\[0\]\.implementation is required/:/decisions\[0\]\.implementation\.kind must be assign-to-plan.*baselineVersion.*requirementIds.*baseSourceIds/);
  assert.doesNotMatch(rejected.content[0].text,/Received arguments:|must match "then"/);
  assert.notEqual((await submitRole(launch,raw)).isError,true);
  launch.finish(undefined,{result:'The original query settled after the corrected assignment'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
 assert.equal(f.result.providerRequests,3);
 assert.equal(f.launches.length,1);
 assert.ok(f.launches[0].joined);
 const materials=nativeRoleMaterial(f.entries,f.result.nativeSource.intentEntryId).materials;
 assert.deepEqual(materials.filter(material=>material.selector==='submission-arguments').map(material=>material.raw),[rejectedRaw,raw]);
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage:context.stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),raw);
});
check('fresh planning submission corrects omitted pending diagnosis within the original query without clearing receiver material',async()=>{
 const context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:{...initialVerificationProfile,version:8},
  decisionReferences:{version:3,occurrenceIds:['pending-diagnosis','resolved-diagnosis'],diagnosisOccurrenceIds:['pending-diagnosis','resolved-diagnosis'],pendingOrdinaryIndexes:[],blockingOrdinaryIndexes:[],retentionChoices:[]},
  producerDiagnostics:{occurrences:[{occurrenceId:'pending-diagnosis',outputId:'original-output',launchId:'original-producer'}],outputs:[]}};
 const fresh={requirementId:'R1',severity:'optional',repair:'mechanical',description:'New receiver concern remains independently accountable',evidence:['original controlled source']};
 const output=writeFixtureVerificationDomain({...value,planAccepted:true,acceptedPlan:mixedPlan(),decisions:[]},context),rejected={...output,findings:[fresh]};
 const corrected={...output,decisions:[{occurrenceId:'pending-diagnosis',disposition:'deferred',reason:'Source remains pending; this explicit judgment claims no diagnosis or adoption',witnesses:['Original supplied diagnostic duty']}]};
 const f=await produce(async launch=>{
  const feedback=await submitRole(launch,JSON.stringify(rejected));assert.equal(feedback.isError,true);assert.match(JSON.stringify(feedback),/PLANNING_ACCOUNTING/);
  assert.notEqual((await submitRole(launch,JSON.stringify(corrected))).isError,true);
  launch.finish(undefined,{result:'Corrected explicit accounting; host standing remains separate'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.providerRequests,3);assert.ok(f.launches.every(launch=>launch.joined));
 assert.equal(f.result.protocol.decisions[0].disposition,'deferred');
 const g=await ledger(f,context);try{
  const retained=g.store.all('SELECT * FROM finding_occurrences WHERE work=?','W').filter(row=>JSON.parse(row.data).finding?.description===fresh.description);
  assert.equal(retained.length,1);assert.equal(JSON.parse(g.store.one('SELECT data FROM obligations WHERE id=?',retained[0].id).data).state,'pending');
  assert.equal(g.store.all('SELECT * FROM finding_dispositions').length,0);
 }finally{g.store.close();}
});
for(const assistantBeforeStop of [false,true])check('opt-in submission producer retains same-message typed siblings, early='+assistantBeforeStop,async()=>{
 const output={...value,alternatives:[]},note='Retained public note accompanying the submitted assessment';
 const f=await produce(async launch=>{
  const feedback=await submitRole(launch,JSON.stringify(output),{interim:[note],assistantBeforeStop});assert.notEqual(feedback.isError,true);
  launch.finish(undefined,{result:'Submission complete; narrative is not the role result'});
 },{role:'challenger',inputBundle:{...body,context:{stage:'planning-challenge',planProposal:mixedPlan()}},nativeCarrier:'tool-submission/v1',maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,JSON.stringify(output));assert.ok(f.launches.every(launch=>launch.joined));
 assert.ok(nativeRoleMaterial(f.entries,f.result.nativeSource.intentEntryId).materials.some(material=>material.raw===note));
 const owner=f.entries.find(entry=>entry.id===f.result.nativeSource.assistantEntryId);assert.ok(owner.data.message.message.content.some(block=>block.type==='tool_use'));
});

check('opt-in submission producer does not promote a receipt after owner cancellation',async()=>{
 const cancelled=new AbortController(),output={...value,alternatives:[]};
 const f=await produce(async launch=>{
  const submitted=await submitRole(launch,JSON.stringify(output));assert.notEqual(submitted.isError,true);cancelled.abort(Error('Controlled owner cancellation after provisional receipt'));launch.finish(undefined,{result:'No authority after cancellation'});
 },{role:'challenger',inputBundle:{...body,context:{stage:'planning-challenge',planProposal:mixedPlan()}},nativeCarrier:'tool-submission/v1',maxProviderRequests:2,signal:cancelled.signal});
 assert.equal(f.result.usable,false);assert.equal(f.result.protocol,null);assert.equal(f.result.nativeSource,undefined);assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
});
for(const extraTool of [false,true])check('Claude submission shares the host request cap with tool-result delivery, extra tool='+extraTool,async()=>{
 const output={...value,alternatives:[]},raw=JSON.stringify(output);
 const f=await produce(async launch=>{
  const system=JSON.stringify(launch.frames);
  assert.match(system,/Returning tool results to the same Claude query also uses a model request/);
  assert.match(system,/Leave at least one model request unused when you call the submission tool/);
  const receipt=await submitRole(launch,raw);
  assert.equal(JSON.parse(receipt.content[0].text).provisional,true);
  if(!extraTool){launch.finish(undefined,{result:'Original query settled.',numTurns:2});return;}
  const duplicate=JSON.stringify({...output,summary:'Extra submission cannot replace the original'});
  const {tid}=launch.format(duplicate,{toolName:'mcp__custom-tools__gitjig_submit_role_result',carrier:false});
  void launch.mcp('tools/call',{name:'gitjig_submit_role_result',arguments:JSON.parse(duplicate),_meta:{'claudecode/toolUseId':tid}});
  await launch.settled;
 },{role:'challenger',inputBundle:{...body,context:{stage:'planning-challenge',planProposal:mixedPlan()}},maxProviderRequests:2});
 assert.equal(f.checkpoints,2);assert.equal(f.result.providerRequests,2);
 assert.equal(f.launches.length,1);assert.equal(f.launches[0].joined,true);assert.equal(f.launches[0].error,undefined);
 assert.equal(f.result.usable,!extraTool,JSON.stringify(f.result.issues));
 const sdk=f.entries.filter(entry=>entry.customType===nativeRoleEntries.sdk).map(entry=>entry.data.message);
 assert.equal(sdk.filter(message=>message.type==='system'&&message.subtype==='init').length,1);
 assert.equal(sdk.some(message=>message.type==='result'),!extraTool);
 if(extraTool){
  assert.deepEqual(f.result.requestLimit,{version:1,kind:'role-request-limit',used:2,limit:2});
  assert.equal(f.result.nativeSource,undefined);assert.equal(f.result.protocol,null);
  assert.ok(sdk.some(message=>message.type==='user'&&JSON.stringify(message.message.content).includes('provisional')));
  assert.ok(nativeRoleMaterial(f.entries,f.entries.find(entry=>entry.customType===nativeRoleEntries.intent).id).materials.some(material=>material.raw===raw));
 }else{
  assert.equal(f.result.requestLimit,undefined);assert.equal(f.result.rawFinal,raw);assert.ok(f.result.nativeSource);
 }
});
for(const fault of ['duplicate-json','numeric-string','second-valid','unexposed-scope'])check('opt-in submission producer guards '+fault,async()=>{
 const output={...value,alternatives:[]},raw=JSON.stringify(output),context={stage:'planning-challenge',planProposal:mixedPlan()};
 let feedback;
 const f=await produce(async launch=>{
  if(fault==='second-valid'){
   assert.notEqual((await submitRole(launch,raw)).isError,true);
   feedback=await submitRole(launch,JSON.stringify({...output,summary:'Second valid result must not replace the original'}));assert.equal(feedback.isError,true);assert.match(feedback.content[0].text,/already submitted.*Finish this query with a plain final response and no further tool calls/);
  }else{
   const invalid=fault==='duplicate-json'?raw.replace('"version":1','"version":1,"version":1'):fault==='unexposed-scope'?JSON.stringify({...output,assessedScope:[{sourceId:'not-exposed',startLine:1,endLine:1}]}):JSON.stringify({...output,version:'1'});
   feedback=await submitRole(launch,invalid);
   assert.equal(feedback.isError,true);assert.match(JSON.stringify(feedback),fault==='duplicate-json'?/duplicate/i:fault==='unexposed-scope'?/SCOPE/:/Role result rejected: PROTOCOL: Error: Unexpected enum value/);
   assert.notEqual((await submitRole(launch,raw)).isError,true);
  }
  launch.finish(undefined,{result:'Original query finished normally.'});
 },{role:'challenger',inputBundle:{...body,context},nativeCarrier:'tool-submission/v1',maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.equal(f.launches.length,1);assert.equal(f.checkpoints,3);assert.ok(f.launches.every(launch=>launch.joined));
 const materials=nativeRoleMaterial(f.entries,f.entries.find(entry=>entry.customType===nativeRoleEntries.intent).id).materials;assert.equal(materials.filter(material=>material.selector==='submission-arguments').length,2);
 if(fault==='second-valid')assert.ok(materials.some(material=>material.raw.includes('Second valid result must not replace')));
});
for(const [role,stage]of [['planner','planning'],['challenger','planning-challenge'],['adjudicator','planning-adjudication']])for(const outcome of ['actual-finding','missing-findings','wrapped'])check('explicit historical planning '+role+' uses text source without formatter correction: '+outcome,async t=>{
 useTextFixture(t);
 const input={...body,context:{stage,planProposal:mixedPlan()}},output={...value,summary:'Actual independent contract concern',
  ...(role==='planner'?{plan:mixedPlan()}:role==='challenger'?{alternatives:[]}:{decisions:[],planAccepted:false}),
  findings:[finding('Actual task concern retained in the original final answer')]};
 if(outcome==='missing-findings')delete output.findings;
 const raw=JSON.stringify(outcome==='wrapped'?{answer:output}:output);
 const f=await produce(launch=>{
  assert.equal(launch.options.args.includes('--json-schema'),false);
  assert.equal(launch.tools.some(tool=>tool.name==='StructuredOutput'),false);
  completeText(launch,raw);
 },{role,inputBundle:input});
 assert.equal(f.result.usable,outcome==='actual-finding',JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);
 assert.equal(f.result.nativeSource.kind,'claude-sdk-assistant-json/v1');
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role,stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),raw);
 assert.equal(f.checkpoints,1);assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
 if(outcome==='actual-finding')assert.deepEqual(f.result.protocol.findings,output.findings);
 else assert.equal(f.result.protocol,null,'Neither missing fields nor a wrapped answer may be repaired into accepted protocol');
});

for(const selection of ['explicit-text','current-default'])for(const role of ['planner','adjudicator'])for(const empty of ['verificationRequirements','reviewRoles'])check((selection==='explicit-text'?'explicit grammar8 text':'current grammar8 submission')+' rejects empty supplied plan '+role+' '+empty,async t=>{
 if(selection==='explicit-text')useTextFixture(t);else assert.equal(globalThis.__nativeRoleCarrier,undefined);
 const profile={...initialVerificationProfile,version:8},context={stage:role==='planner'?'planning':'planning-adjudication',planVersion:null,planningVerificationProfile:profile};
 const output=writeFixtureVerificationDomain({...value,...(role==='planner'?{plan:mixedPlan()}:{decisions:[],planAccepted:false,acceptedPlan:mixedPlan()})},context);
 const plan=output[role==='planner'?'plan':'acceptedPlan'];
 if(empty==='verificationRequirements'){plan.verificationRequirements=[];plan.verification.strategies=[];}else plan.verification.reviewRoles=[];
 const raw=JSON.stringify(output),f=await produce(async launch=>{
  assert.equal(launch.options.args.includes('--json-schema'),false);assert.equal(launch.tools.some(tool=>tool.name==='StructuredOutput'),false);
  if(selection==='explicit-text')completeText(launch,raw);else{
   const feedback=await completeRoleFixture(launch,output);assert.equal(feedback.isError,true);assert.match(JSON.stringify(feedback),/Plan needs requirements and review roster/);
  }
 },{role,inputBundle:{...body,context},maxProviderRequests:selection==='explicit-text'?1:2});
 assert.equal(f.result.usable,false);assert.equal(f.result.protocol,null);if(selection==='explicit-text'){assert.equal(f.result.rawFinal,raw);assert.ok(f.result.issues.some(issue=>issue.includes('Plan needs requirements and review roster')),JSON.stringify(f.result.issues));}
 else {assert.equal(f.result.nativeSource,undefined);assert.ok(nativeRoleMaterial(f.entries,f.entries.find(entry=>entry.customType===nativeRoleEntries.intent).id).materials.some(material=>material.selector==='submission-arguments'&&material.raw===raw));}
 assert.equal(f.checkpoints,selection==='explicit-text'?1:2);assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
});

for(const carrier of ['formatter/v1','assistant-json/v1'])for(const outcome of ['real-finding','missing-findings','missing-scope'])check('required result guidance reaches SDK without weakening '+carrier+' '+outcome,async t=>{
 globalThis.__nativeRoleCarrier=carrier;t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const source={id:'candidate:consumer.cjs',version:'C',side:'candidate',path:'consumer.cjs',content:'module.exports=2;\n',sha256:sha('module.exports=2;\n'),exposeInPrompt:true};
 const input={...body,context:{stage:'planning-challenge',planProposal:mixedPlan(),sourceScopeInput:{version:2}},
  ...(outcome==='missing-scope'?{sources:[source],requiredScope:[{sourceId:source.id,startLine:1,endLine:1}]}:{})};
 const output={...value,alternatives:[],findings:[finding(outcome==='missing-scope'?'test':'Actual task concern retained during format correction')]};
 if(outcome==='missing-findings')delete output.findings;
 if(outcome==='missing-scope')output.summary='test';
 const raw=JSON.stringify(output),f=await produce(launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const system=strings(launch.frames).find(v=>v.includes('You are the assigned challenger'));
  assert.ok(system,'Observe the actual outbound SDK system instruction');
  assert.match(system,/Always include the required findings array/);
  assert.match(system,/include findings: \[\] explicitly; never omit this field/);
  assert.match(system,/preserve the actual task result rather than substituting a throwaway example/);
  assert.equal(launch.options.args.includes('--json-schema'),carrier==='formatter/v1');
  if(carrier==='formatter/v1'){launch.format(raw);launch.finish(output);}else completeText(launch,raw);
 },{role:'challenger',inputBundle:input});
 assert.equal(f.result.rawFinal,raw,'Keep the actual answer, including invalid answers');
 assert.equal(f.result.usable,outcome==='real-finding',JSON.stringify(f.result.issues));
 if(outcome==='real-finding')assert.deepEqual(f.result.protocol.findings,output.findings);
 if(outcome==='missing-findings'){
  assert.equal(f.result.protocol,null,'The host must not fill in an omitted findings array');
  assert.ok(f.result.issues.some(i=>i.includes('PROTOCOL:')&&i.includes('missing fields')),JSON.stringify(f.result.issues));
 }
 if(outcome==='missing-scope')assert.ok(f.result.issues.some(i=>i.includes('SCOPE')),JSON.stringify(f.result.issues));
 assert.equal(f.launches.length,1);assert.ok(f.launches.every(l=>l.joined));
});

for(const stage of ['planning-adjudication','review-adjudication'])check('prospective subject actions preserve original Native formatter source and canonical judgment at '+stage,async t=>{
 useFormatterFixture(t);
 const {prepareSubjectActionInput}=await load('workflow/subject-actions.js');
 const ids=Array.from({length:32},()=>randomUUID()),diagnostic=ids.at(-1),work=randomUUID(),old=randomUUID();
 const references={version:3,occurrenceIds:ids,diagnosisOccurrenceIds:[diagnostic],pendingOrdinaryIndexes:[0,1],blockingOrdinaryIndexes:[0,1],retentionChoices:[{occurrenceId:diagnostic,dispositionId:old,sha256:'a'.repeat(64)}]};
 const context=prepareSubjectActionInput('adjudicator',{stage,subjectActionsInput:{version:1},metadataIdentityInput:{version:3},baseVersion:'ORIGINAL-BASE',decisionReferences:references,
  occurrences:ids.map(id=>({id,work,output:work,data:{finding:{requirementId:'R1',description:'Original literal '+id,evidence:[work]}}}))});
 const output={...value,...(stage==='planning-adjudication'?{planAccepted:false}:{}),subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:{
  s0:{disposition:'rejected',reason:'Independent source assessment',witnesses:['Literal original evidence']},
  s1:{disposition:'equivalent',equivalentTo:'s0',reason:'Independent same-source assessment',witnesses:['Literal original evidence']},s31:'retain'}};
 const raw=JSON.stringify(output);
 const f=await produce(launch=>{
  const user=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof user==='string'?user:user.filter(part=>part.type==='text').map(part=>part.text).join('');
  const supplied=JSON.parse(text.split('\n')[1]).context,decoded=readFixtureMetadataContext(supplied);
  assert.equal(supplied.metadataIdentityEncoding.version,3);assert.deepEqual(decoded,context);
  assert.equal(supplied.subjectActionsView.subjects[0].occurrenceId,ids[0]);assert.equal(supplied.occurrences[0].subjectKey,'s0');
  const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
  assert.ok(schema.definitions);assert.equal(schema.properties.decisions,undefined);assert.equal(schema.properties.subjectActionsHash.const,output.subjectActionsHash);
  assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true);
  launch.format(raw);launch.finish(output);
 },{role:'adjudicator',inputBundle:{...body,context}});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);
 assert.equal(f.result.protocol.decisions[0].occurrenceId,ids[0]);assert.equal(f.result.protocol.decisions[1].equivalentTo,ids[0]);assert.deepEqual(f.result.protocol.retainedDispositions,[old]);
 assert.equal(f.result.protocol.subjectActionsHash,undefined);assert.equal(f.result.protocol.decisionActions,undefined);
 assert.equal(f.result.nativeSource.kind,'claude-sdk-formatter/v1');
 const original=readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource);
 assert.equal(original,raw);assert.ok(f.launches.every(launch=>launch.joined));
});

for(const stage of ['planning-adjudication','review-adjudication'])for(const carrier of ['formatter/v1','assistant-json/v1'])check('literal subject actions2 preserve original Native source and canonical judgment at '+stage+' '+carrier,async t=>{
 if(carrier==='formatter/v1')useFormatterFixture(t);else useTextFixture(t);
 const {prepareSubjectActionInput}=await load('workflow/subject-actions.js'),{roleFraming}=await load('workflow/role-framing.js');
 const ids=Array.from({length:32},()=>randomUUID()),diagnostic=ids.at(-1),work=randomUUID(),old=randomUUID();
 const references={version:3,occurrenceIds:ids,diagnosisOccurrenceIds:[diagnostic],pendingOrdinaryIndexes:[0,1],blockingOrdinaryIndexes:[0,1],retentionChoices:[{occurrenceId:diagnostic,dispositionId:old,sha256:'a'.repeat(64)}]};
 const context=prepareSubjectActionInput('adjudicator',{stage,subjectActionsInput:{version:2},baseVersion:'ORIGINAL-BASE',decisionReferences:references,
  occurrences:ids.map(id=>({id,work,output:work,data:{finding:{requirementId:'R1',description:'Original literal '+id,evidence:[work]}}}))});
 const output={...value,...(stage==='planning-adjudication'?{planAccepted:false}:{}),subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:{
  s0:{disposition:'rejected',reason:'Independent source assessment',witnesses:['Literal original evidence']},
  s1:{disposition:'equivalent',equivalentTo:'s0',reason:'Independent same-source assessment',witnesses:['Literal original evidence']},s31:'retain'}};
 const raw=JSON.stringify(output);
 const framing=roleFraming('adjudicator',{...body,context},true);
 const f=await produce(launch=>{
  const user=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof user==='string'?user:user.filter(part=>part.type==='text').map(part=>part.text).join('');
  const supplied=JSON.parse(text.split('\n')[1]).context,decoded=readFixtureMetadataContext(supplied);
  assert.equal(Object.hasOwn(supplied,'metadataIdentityEncoding'),false);assert.equal(Object.hasOwn(supplied,'metadataIdentityInput'),false);assert.deepEqual(decoded,context);assert.deepEqual(supplied.occurrences.map(row=>row.id),ids);assert.deepEqual(supplied.occurrences.map(row=>row.data.finding),context.occurrences.map(row=>row.data.finding));
  assert.equal(supplied.subjectActionsView.subjects[0].occurrenceId,ids[0]);assert.equal(supplied.occurrences[0].subjectKey,'s0');
  const schema=carrier==='formatter/v1'?JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]):framing.schema;
  assert.ok(schema.definitions);assert.equal(schema.properties.decisions,undefined);assert.equal(schema.properties.subjectActionsHash.const,output.subjectActionsHash);
  assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true);
  if(carrier==='formatter/v1'){launch.format(raw);launch.finish(output);}else completeText(launch,raw);
 },{role:'adjudicator',inputBundle:{...body,context}});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);
 assert.equal(f.result.protocol.decisions[0].occurrenceId,ids[0]);assert.equal(f.result.protocol.decisions[1].equivalentTo,ids[0]);assert.deepEqual(f.result.protocol.retainedDispositions,[old]);
 assert.equal(f.result.protocol.subjectActionsHash,undefined);assert.equal(f.result.protocol.decisionActions,undefined);
 assert.equal(f.result.nativeSource.kind,carrier==='formatter/v1'?'claude-sdk-formatter/v1':'claude-sdk-assistant-json/v1');
 const original=readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage,checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource);
 assert.equal(original,raw);assert.ok(f.launches.every(launch=>launch.joined));
});

for(const drift of ['body','profile','identity','encoding'])check('literal subject actions2 checkpoint drift refuses original Native birth: assistant-json/v1 '+drift,async t=>{
 useTextFixture(t);
 const {prepareSubjectActionInput}=await load('workflow/subject-actions.js'),id=randomUUID();
 const references={version:3,occurrenceIds:[id],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]};
 const context=prepareSubjectActionInput('adjudicator',{stage:'review-adjudication',subjectActionsInput:{version:2},decisionReferences:references,occurrences:[{id,data:{finding:{requirementId:'R1',description:'Exact original subject body',evidence:['consumer']}}}]});
 const inputBundle={...body,context};
 const f=await produce(()=>assert.fail('Changed original subject must not create Native query'),{role:'adjudicator',inputBundle,beforeModelRequest:async manager=>{
  // Mutate the original admitted SDK message, not the detached caller copy.
  const entry=manager.getBranch().find(item=>item.type==='message'&&item.message.role==='user');
  const text=typeof entry.message.content==='string'?entry.message.content:entry.message.content.map(item=>item.text).join('');
  const begin=text.indexOf('\n')+1,end=text.indexOf('\n',begin),supplied=JSON.parse(text.slice(begin,end<0?undefined:end));
  const current=supplied.context;
  if(drift==='body')current.occurrences[0].data.finding.description+=' changed';
  if(drift==='profile')current.subjectActionsProfile.version=1;
  if(drift==='identity')current.occurrences[0].id=randomUUID();
  if(drift==='encoding')current.metadataIdentityEncoding={version:3};
  entry.message.content=[{type:'text',text:text.slice(0,begin)+JSON.stringify(supplied)+(end<0?'':text.slice(end))}];
 }});
 assert.equal(f.result.usable,false);assert.equal(f.launches.length,0);assert.ok(f.result.issues.length);
});

check('literal subject actions2 formatter retains frozen outbound input despite caller journal mutation',async t=>{
 useFormatterFixture(t);const {prepareSubjectActionInput}=await load('workflow/subject-actions.js'),id=randomUUID();
 const references={version:3,occurrenceIds:[id],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]};
 const context=prepareSubjectActionInput('adjudicator',{stage:'review-adjudication',subjectActionsInput:{version:2},decisionReferences:references,occurrences:[{id,data:{finding:{requirementId:'R1',description:'Original input body',evidence:['consumer']}}}]});
 const original=structuredClone(context),output={...value,subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:{s0:{disposition:'rejected',reason:'Actual original source',witnesses:['consumer']}}},raw=JSON.stringify(output);let receipt;
 const f=await produce(launch=>{
  const content=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof content==='string'?content:content.map(item=>item.text).join('');
  assert.deepEqual(JSON.parse(text.split('\n')[1]).context,original,'The actual outgoing Native input is the detached original');
  launch.format(raw);launch.finish(output);
 },{role:'adjudicator',inputBundle:{...body,context},beforeModelRequest:async(manager,intent)=>{
  receipt=intent;const entry=manager.getBranch().find(item=>item.type==='message'&&item.message.role==='user');entry.message.content=[{type:'text',text:'Changed caller-side journal entry'}];
 }});
 assert.equal(f.launches.length,1);assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);
 const selected=readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage:'review-adjudication',checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:receipt},f.result.nativeSource);assert.equal(selected,raw);
});

check('prospective source-qualified carry binds actual Native schema, literal BASE sources and original encoded final',async t=>{
 useFormatterFixture(t);
 const {prepareSubjectActionInput}=await load('workflow/subject-actions.js'),id=randomUUID(),work=randomUUID();
 const source={id:'base:consumer.cjs',version:'BASE',side:'base',path:'consumer.cjs',sha256:sha('module.exports=2;\n'),exposeInPrompt:true,content:'module.exports=2;\n'};
 const references={version:3,occurrenceIds:[id],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]};
 const context=prepareSubjectActionInput('adjudicator',{stage:'planning-adjudication',subjectActionsInput:{version:1},metadataIdentityInput:{version:3},baseVersion:'BASE',decisionReferences:references,
  decisionCarryInput:{version:3},decisionCarry:{version:3,baselineVersion:'BASE',baseSourceIds:[source.id]},
  occurrences:[{id,work,output:work,data:{finding:{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Actual BASE consumer exports2',evidence:[source.id]}}}]});
 const output={...value,planAccepted:true,subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:{s0:{disposition:'upheld',reason:'Independently classify this exact original claim as BASE implementation duty under R1; candidate/proposal aspects remain separate',witnesses:[source.id],implementation:{kind:'assign-to-plan',baselineVersion:'BASE',requirementIds:['R1'],baseSourceIds:[source.id]}}}};
 const raw=JSON.stringify(output),f=await produce(launch=>{
  const user=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof user==='string'?user:user.filter(part=>part.type==='text').map(part=>part.text).join('');
  const supplied=JSON.parse(text.split('\n')[1]),decoded=readFixtureMetadataContext(supplied.context);assert.deepEqual(decoded.decisionCarry,context.decisionCarry);assert.ok(text.includes(source.content));
  const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]),valid=new Ajv2020({strict:false}).compile(schema);assert.equal(valid(output),true);
  const bad=structuredClone(output);bad.decisionActions.s0.implementation.baseSourceIds=['candidate:consumer.cjs'];assert.equal(valid(bad),false);
  delete bad.decisionActions.s0.implementation.baseSourceIds;assert.equal(valid(bad),false);
  launch.format(raw);launch.finish(output);
 },{role:'adjudicator',inputBundle:{...body,context,sources:[source]}});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.deepEqual(f.result.protocol.decisions[0].implementation.baseSourceIds,[source.id]);
 assert.equal(f.result.nativeSource.kind,'claude-sdk-formatter/v1');
 assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage:'planning-adjudication',checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),raw);
 assert.ok(f.launches.every(launch=>launch.joined));
});

for(const identityVersion of [1,2])check('owned Native sees shared metadata identities and returns full original IDs through the unchanged schema v'+identityVersion,async t=>{
 useFormatterFixture(t);
 const ids=Array.from({length:32},()=>randomUUID()),work=randomUUID(),sourceOutput=randomUUID(),sourceLaunch=randomUUID();
 const context={stage:identityVersion===1?'planning-adjudication':'review-adjudication',metadataIdentityInput:{version:identityVersion},decisionReferences:{version:1,occurrenceIds:ids,diagnosisOccurrenceIds:[]},
  occurrences:ids.map(id=>({id,work,output:sourceOutput,data:{launchId:sourceLaunch,finding:{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Exact literal '+id,evidence:[{ref:0}]}}})),
  pendingObligations:ids.map(id=>({id,occurrence:id,state:'pending'})),plannerInputScope:{workId:work,launchId:sourceLaunch,runId:sourceOutput,occurrenceIds:ids,findingBodySuppliedIds:ids},unknown:{id:work,ref:0}};
 if(identityVersion===2)context.checks=[{id:sourceOutput,work,run:sourceLaunch,data:{inputHash:'b'.repeat(64),actual:{stdout:'b'.repeat(64)}}},{id:sourceLaunch,work,run:sourceOutput,data:{inputHash:'b'.repeat(64),actual:{stdout:'b'.repeat(64)}}}];
 let supplied,output;
 const f=await produce(launch=>{
  const user=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof user==='string'?user:user.filter(part=>part.type==='text').map(part=>part.text).join('');
  supplied=JSON.parse(text.split('\n')[1]).context;
  assert.ok(supplied.metadataIdentityEncoding);assert.equal(supplied.metadataIdentityEncoding.version,identityVersion);if(identityVersion===2){assert.equal(typeof supplied.checks[0].data.inputHash,'object');assert.equal(supplied.checks[0].data.actual.stdout,'b'.repeat(64));}assert.deepEqual(supplied.decisionReferences,context.decisionReferences);
  const reference=supplied.occurrences[0].id;assert.deepEqual(Object.keys(reference),['ref']);
  const id=supplied.metadataIdentityEncoding.ids[reference.ref];assert.equal(id,ids[0]);
  assert.deepEqual(supplied.unknown,context.unknown);
  const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
  assert.deepEqual(schema.properties.decisions.items.properties.occurrenceId.enum,ids);
  output={...value,planAccepted:false,decisions:[{occurrenceId:id,disposition:'rejected',reason:'Controlled exact identity selection only',witnesses:['Original literal input']}]};
  assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true);
  launch.format(JSON.stringify(output));launch.finish(output);
 },{role:'adjudicator',inputBundle:{...body,context}});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.protocol.decisions[0].occurrenceId,ids[0]);
 assert.equal(f.result.rawFinal,JSON.stringify(output));assert.ok(f.launches.every(launch=>launch.joined));
});

check('native request supplies the complete schema without duplicating it in role instructions',async()=>{
    const {roleFraming}=await load('workflow/role-framing.js');
    const original=structuredClone(body),framing=roleFraming('reviewer',body,true);
    const f=await produce(launch=>{
        const args=launch.options.args,schemaIndex=args.indexOf('--json-schema');
        assert.equal(launch.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'32000');
        assert.ok(schemaIndex>=0);
        assert.deepEqual(JSON.parse(args[schemaIndex+1]),framing.schema);
        const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
        const system=strings(launch.frames).find(v=>v.includes('The supplied native StructuredOutput schema defines the final RoleOutput shape.'));
        assert.ok(system,'Original SDK outbound frames retain the role instructions');
        assert.match(system,/The model request limit for this role is 1/);
        assert.match(system,/The Native query turn limit is 3/);
        assert.equal(args[args.indexOf('--max-turns')+1],'3');
        assert.ok(system.includes('The supplied native StructuredOutput schema defines the final RoleOutput shape.'));
        assert.ok(system.includes('Place the RoleOutput fields directly at the StructuredOutput argument object root'));
        assert.ok(!system.includes(JSON.stringify(framing.schema)));
        assert.ok(system.includes('Strict host parsing additionally enforces unique JSON keys'));
        assert.ok(system.includes('maximum128KiB'));
        launch.format(JSON.stringify(value));launch.finish(value);
    });
    assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(read(f),JSON.stringify(value));
    const input=f.entries.find(e=>e.type==='message'&&e.message.role==='user').message.content;
    const text=typeof input==='string'?input:input.filter(p=>p.type==='text').map(p=>p.text).join('');
    assert.equal(text,framing.prompt);assert.deepEqual(body,original);
    const ordinary=roleFraming('reviewer',body);
    assert.ok(ordinary.systemPrompt.includes('Final RoleOutput JSON Schema: '+JSON.stringify(framing.schema)));
    assert.equal(ordinary.prompt,framing.prompt);assert.deepEqual(ordinary.schema,framing.schema);
    assert.deepEqual(ordinary.constraints,framing.constraints);
});

check('unsupported current native schemas refuse before allocation or session birth without rejecting historical schemas',async t=>{
 useFormatterFixture(t);
    const {openController}=await load('controller/index.js'),{createPiSession}=await load('pi/session.js'),{NativeRoleCollector}=await load('workflow/native-role-output.js');
    const {SessionManager}=await import('@earendil-works/pi-coding-agent');
    const source=path.join(root,'schema-preflight-'+randomUUID());fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.txt'),'Original protected source');
    const c=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>c.close());
    const projectId='schema-'+randomUUID();await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Preserve the original source and refuse invalid native metadata before allocation.',executionLimit:8});
    // Prerequisite operation rows confer no platform capability, judgment or send authority.
    const operationId='schema-operation-'+randomUUID(),targetId='schema-target-'+randomUUID(),grantId='schema-grant-'+randomUUID();
    c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',targetId,projectId,JSON.stringify({fixture:'NON_AUTHORITY'}));
    c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',grantId,workId,targetId,1,JSON.stringify({fixture:'NON_AUTHORITY'}));
    c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',operationId,workId,targetId,grantId,'PREPARED',JSON.stringify({kind:'publication',fixture:'NON_AUTHORITY'}));
    const snapshot=()=>Object.fromEntries(['budgets','runs','role_launches','role_outputs','capacity_leases'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
    const before=snapshot(),births=launches.length,scopeCount=scopes.length;
    for(const key of ['oneOf','anyOf','allOf']){
        globalThis.__nativeFormatRootDefect=key;
        try{
            const result=await c.planChange({workId,model});
            assert.deepEqual(snapshot(),before,'Unsupported native metadata cannot allocate or consume an original role');assert.equal(launches.length,births);assert.equal(scopes.length,scopeCount);
            assert.match(result.blocked.join(' '),new RegExp('NATIVE_FORMATTER_SCHEMA_UNSUPPORTED: root '+key));
            assert.match(result.nextAction,/Update gitjig or correct its native formatter schema/);assert.doesNotMatch(result.nextAction,/Extend shared/);
            await assert.rejects(c.changes.publicationJudgment({workId,model,operationId,sourceFingerprint:'b'.repeat(64),inputBundle:{requirements:[],contracts:'Metadata refusal only',sources:[],requiredScope:[],context:{stage:'publication-payload-fit',operationId,actionFamily:'bootstrap',payloadHash:'a'.repeat(64)}}}),new RegExp('NATIVE_FORMATTER_SCHEMA_UNSUPPORTED: root '+key));
            assert.deepEqual(snapshot(),before,'Publication schema refusal precedes both execution and resolution reservations');assert.equal(launches.length,births);assert.equal(scopes.length,scopeCount);
            // The same generated form is outside this native-only restriction on a non-bridge route.
            await c.changes.bundle(workId,{stage:'planning'},'planner',{provider:'unselected-non-bridge',modelId:'metadata-only'});
        }finally{delete globalThis.__nativeFormatRootDefect;}
        const schema={type:'object',properties:{},[key]:[{type:'object'}]},intent={version:1,requestId:'schema-'+key,binding:{role:'reviewer'},schema,maxNativeTurns:1};
        await assert.rejects(createPiSession({host,operations,model,maxReadBytes:1024,systemPrompt:'No dispatch.',roleContextBudget:{assertEntry(){},structuredOutput:{intent,observe(){}}},beforeModelRequest:async()=>assert.fail('No checkpoint before schema admission')}),new RegExp('NATIVE_FORMATTER_SCHEMA_UNSUPPORTED: root '+key));
        assert.equal(launches.length,births);assert.equal(scopes.length,scopeCount);
        // Old literal sources are not new Native requests. Keep their complete schema intact.
        const manager=SessionManager.inMemory(project),collector=new NativeRoleCollector(manager,intent);
        assert.deepEqual(collector.intent.schema,schema);assert.deepEqual(manager.getBranch().find(e=>e.customType===nativeRoleEntries.intent).data.request.schema,schema);
    }
    for(const schema of [null,[],{type:'array'}]){
        const intent={version:1,requestId:'invalid-object-root',binding:{role:'reviewer'},schema,maxNativeTurns:1};
        await assert.rejects(createPiSession({host,operations,model,maxReadBytes:1024,systemPrompt:'No dispatch.',roleContextBudget:{assertEntry(){},structuredOutput:{intent,observe(){}}},beforeModelRequest:async()=>assert.fail('No invalid-root checkpoint')}),/NATIVE_FORMATTER_SCHEMA_UNSUPPORTED: object root required/);
    }
    // Controlled retained exhaustion tests guidance only, never admission or a grant.
    c.store.run('UPDATE budgets SET consumed=lim WHERE lineage=(SELECT lineage FROM works WHERE id=?)',workId);
    const exhausted=snapshot(),recorded=c.store.one('SELECT * FROM change_state WHERE work=?',workId),originalData=JSON.parse(recorded.data);
    const inspect=()=>{const view=c.inspectChange(workId);assert.deepEqual(snapshot(),exhausted);return view;};
    assert.match(inspect().nextAction,/more execution or resolution allowance does not repair the schema/);assert.doesNotMatch(inspect().nextAction,/Extend shared/);
    const {changeResultText}=await load('ui/change-result.js'),{changeCommands}=await load('ui/change-commands.js'),{HostCommands}=await load('ui/host-commands.js');
    const conversation=c.createConversation({projectId}).conversationId;
    for(const locale of ['en','ko']){
        const text=changeResultText(c.inspectChangeResult(workId),locale);assert.match(text,/Update gitjig or correct its native formatter schema/);assert.match(text,/NATIVE_FORMATTER_SCHEMA_UNSUPPORTED/);
        const shown=[],commands=new HostCommands(changeCommands({controller:c,isCurrent:()=>true,locale:()=>locale,choose:async()=>assert.fail('Inspection must not ask to retry'),show:async(title,text)=>shown.push({title,text})}));
        await commands.execute('/change inspect '+workId,conversation);assert.equal(shown.length,1);assert.match(shown[0].text,/more execution or resolution allowance does not repair the schema/);assert.doesNotMatch(shown[0].text,/Extend shared/);
        assert.deepEqual(snapshot(),exhausted);
    }
    for(const cause of ['Owner quoted '+originalData.blocked[0],'ControllerError: PROVIDER:API Error: 400 tools.0.custom.input_schema: input_schema does not support allOf at the top level','Error: OTHER: NATIVE_FORMATTER_SCHEMA_UNSUPPORTED: root allOf']){
        c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...originalData,blocked:[cause]}),workId);
        assert.match(inspect().nextAction,/Extend shared/);assert.doesNotMatch(inspect().nextAction,/Update gitjig or correct/);
    }
    c.store.run('UPDATE change_state SET phase=?,data=? WHERE work=?','BASE_CAPTURED',recorded.data,workId);assert.doesNotMatch(inspect().nextAction,/Update gitjig or correct/);
    c.store.run('UPDATE change_state SET phase=?,data=? WHERE work=?',recorded.phase,recorded.data,workId);
    const criteria=c.changes.workflowCriteriaHold;c.changes.workflowCriteriaHold=()=> ({kind:'changed',reason:'Controlled stronger current criteria hold'});
    try{assert.match(inspect().nextAction,/Review updated gitjig workflow rules/);assert.doesNotMatch(inspect().nextAction,/Update gitjig or correct/);}finally{c.changes.workflowCriteriaHold=criteria;}
    c.store.run('UPDATE works SET state=? WHERE id=?','UNKNOWN',workId);
    try{assert.match(inspect().nextAction,/execution ownership and cleanup/);assert.doesNotMatch(inspect().nextAction,/Update gitjig or correct|Extend shared/);}finally{c.store.run('UPDATE works SET state=? WHERE id=?','ACTIVE',workId);}
    for(const state of ['CANCELLED','INTERRUPTED']){
        c.store.run('UPDATE works SET state=? WHERE id=?',state,workId);
        try{assert.doesNotMatch(inspect().nextAction,/Update gitjig or correct/);}finally{c.store.run('UPDATE works SET state=? WHERE id=?','ACTIVE',workId);}
    }
    assert.deepEqual(c.store.one('SELECT * FROM change_state WHERE work=?',workId),recorded);
    await c.close();const reopened=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});
    try{const beforeRead=reopened.store.all('SELECT * FROM budgets ORDER BY rowid');assert.match(reopened.inspectChange(workId).nextAction,/Update gitjig or correct/);assert.doesNotMatch(reopened.inspectChangeResult(workId).nextAction,/Extend shared/);assert.deepEqual(reopened.store.all('SELECT * FROM budgets ORDER BY rowid'),beforeRead);assert.deepEqual(reopened.store.one('SELECT * FROM change_state WHERE work=?',workId),recorded);}finally{await reopened.close();}
    const intent={version:1,requestId:'nested-conditions',binding:{role:'reviewer'},schema:{type:'object',if:{type:'object'},then:{allOf:[{type:'object'}]}},maxNativeTurns:1};
    const nested=await createPiSession({host,operations,model,maxReadBytes:1024,systemPrompt:'No dispatch.',roleContextBudget:{assertEntry(){},structuredOutput:{intent,observe(){}}},beforeModelRequest:async()=>assert.fail('No unrequested prompt')});await nested.closeOwned();
    assert.equal(launches.length,births);assert.equal(scopes.length,scopeCount);
});

check('planning adjudication crosses the original SDK with an object-root conditional schema',async t=>{
 useFormatterFixture(t);
    const refresh={sourceId:'owned-refresh',fromContractsVersion:'previous',toContractsVersion:'current'};
    const plan=mixedPlan(),baseInput={...body,requirements:plan.requirements,context:{stage:'planning-adjudication',
        planningVerificationProfile:initialVerificationProfile,requirementSourceIds:['owner-request'],criteriaRefresh:refresh}};
    for(const currentCarry of [false,true])for(const accepted of [true,false]){
        const inputBundle={...baseInput,context:{...baseInput.context,...(currentCarry?{decisionCarry:{version:2},decisionReferences:{version:3,occurrenceIds:['pending'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]}}:{})}};
        const decisions=currentCarry?[{occurrenceId:'pending',disposition:'upheld',reason:'Current owner behavior remains an implementation duty',witnesses:[],implementation:accepted?{kind:'assign-to-plan',baselineVersion:'B',requirementIds:['behavior']}:{kind:'none'}}]:[];
        const output={...value,decisions,planAccepted:accepted,...(accepted?{acceptedPlan:plan,
            criteriaDecision:{...refresh,verdict:'adopt',reason:'Independent actual criteria assessment'}}:{})};
        const f=await produce(launch=>{
            const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
            // Model the observed tool-input admission boundary, not model behavior.
            if(['oneOf','allOf','anyOf'].some(key=>Object.hasOwn(schema,key))){
                launch.send({type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,
                    duration_ms:1,duration_api_ms:1,num_turns:1,total_cost_usd:0,permission_denials:[],usage:{input_tokens:0,output_tokens:0},
                    errors:['API Error: 400 tools.0.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level']});return;
            }
            assert.equal(schema.type,'object');assert.ok(schema.properties.version);assert.ok(schema.properties.acceptedPlan);
            const validate=new Ajv2020({strict:false}).compile(schema);
            assert.equal(validate(output),true,JSON.stringify(validate.errors));
            if(accepted){const missing=structuredClone(output);delete missing.acceptedPlan;assert.equal(validate(missing),false);
                const noDecision=structuredClone(output);delete noDecision.criteriaDecision;assert.equal(validate(noDecision),false);
                const noStrategies=structuredClone(output);delete noStrategies.acceptedPlan.verification.strategies;assert.equal(validate(noStrategies),false);
                if(currentCarry){const omitted=structuredClone(output);omitted.decisions=[];assert.equal(validate(omitted),false);
                    const unassigned=structuredClone(output);unassigned.decisions[0].implementation={kind:'none'};assert.equal(validate(unassigned),false);
                    const implicit=structuredClone(output);delete implicit.decisions[0].implementation;assert.equal(validate(implicit),false);}}
            launch.format(JSON.stringify(output));launch.finish(output);
        },{role:'adjudicator',inputBundle});
        assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
        assert.equal(f.result.rawFinal,JSON.stringify(output));assert.equal(f.result.protocol.planAccepted,accepted);
        assert.equal(f.result.nativeSource.kind,'claude-sdk-formatter/v1');assert.equal(f.launches.length,1);assert.equal(f.launches[0].joined,true);
    }
});

check('stage subjects and separate assertion identities reach the original native request',async t=>{
    assert.equal(globalThis.__nativeRoleCarrier,undefined);const {nativeRoleFraming}=await load('workflow/role-framing.js');
    const plan=mixedPlan();
    for(const [role,stage,output,subject] of [
        ['planner','planning',{...value,plan},'Your subject is a proposed remedy plan'],
        ['challenger','planning-challenge',{...value,alternatives:[]},'Your subject is context.planProposal'],
        ['adjudicator','planning-adjudication',{...value,decisions:[],planAccepted:false},'Your subject is whether the proposed plan'],
        ['reviewer','fresh-review',value,'Your subject is the actual effective candidate'],
    ]) {
        const inputBundle={...body,context:{stage,planProposal:plan}};
        const f=await produce(async launch=>{
            const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
            const system=strings(launch.frames).find(v=>v.includes('You are the assigned '+role));
            const formatted=role==='reviewer';
            const terminal=formatted?'Return exactly one RoleOutput':'The receipt preserves all validation';
            assert.ok(system.includes(subject));assert.ok(system.indexOf(subject)<system.indexOf(terminal));
            assert.equal(system.includes('Return exactly one RoleOutput'),formatted);
            assert.ok(!system.includes('When assigned publication source-fit'));
            assert.equal(system.includes('resolution diagnosed'),role==='adjudicator');
            if(role==='adjudicator')assert.ok(system.includes('already committed supplied disposition records'));
            assert.equal(launch.options.args.includes('--json-schema'),formatted);
            const schema=formatted?JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]):nativeRoleFraming(role,inputBundle,'subject-schema',3).schema;
            if(!formatted)assert.deepEqual(launch.tools.find(tool=>tool.name==='gitjig_submit_role_result').inputSchema,schema);
            if(role==='planner')assert.match(schema.properties.plan.properties.verification.properties.checks.items.properties.assertions.description,/Case membership alone/);
            await completeRoleFixture(launch,output);
        },{role,inputBundle,maxProviderRequests:2});
        assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.ok(f.launches.every(l=>l.joined));
    }
});

check('fresh native schema and strict decoder share captured decision reference domains',async t=>{
 useFormatterFixture(t);
    const references={version:1,occurrenceIds:['material','resolved','host-diagnosis','model-integrity'],diagnosisOccurrenceIds:['host-diagnosis']};
    const inputBundle={...body,context:{stage:'planning-adjudication',decisionReferences:references}};
    for(const [id,target,usable]of [['material','resolved',true],['model-integrity','resolved',true],['host-diagnosis','resolved',false],['material','host-diagnosis',false],['material','owner-request finding upheld here',false]]){
        const output={...value,decisions:[{occurrenceId:id,disposition:'equivalent',equivalentTo:target,reason:'Independent exact observation assessment',witnesses:[]}]};
        const f=await produce(launch=>{
            const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
            assert.deepEqual(schema.properties.decisions.items.properties.occurrenceId.enum,references.occurrenceIds);
            assert.equal(new Ajv2020({strict:false}).compile(schema)(output),usable);
            // Deliberately deliver a complete source even for a schema violation:
            // final host decoding must independently refuse the wrong identity.
            launch.format(JSON.stringify(output));launch.finish(output);
        },{role:'adjudicator',inputBundle});
        assert.equal(f.result.usable,usable,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,JSON.stringify(output));
        if(!usable)assert.match(f.result.issues.join(),/equivalentTo|producer diagnosis/);
        assert.ok(f.launches.every(l=>l.joined));
    }
});

check('v2 synthetic repair exclusion reaches native schema, strict decoding and literal historical raw',async t=>{
 useFormatterFixture(t);
 for(const version of [1,2])for(const id of ['ordinary','host-diagnosis']){
  const refs={version,occurrenceIds:['ordinary','host-diagnosis'],diagnosisOccurrenceIds:['host-diagnosis']};
  const capturedRefs=structuredClone(refs),inputBundle={...body,context:{stage:'planning-adjudication',baseVersion:'B',candidateVersion:null,planVersion:null,verificationVersion:null,occurrences:[],decisionReferences:refs}};
  const output={...value,decisions:[{occurrenceId:id,disposition:'upheld',resolution:'repaired',reason:'Explicit requested closure',witnesses:['claimed-check']}]},expected=version===1||id==='ordinary';let originalIntent;
  const f=await produce(launch=>{
   const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
   assert.equal(new Ajv2020({strict:false}).compile(schema)(output),expected);
   launch.format(JSON.stringify(output));launch.finish(output);
  },{role:'adjudicator',inputBundle,beforeModelRequest:async(_manager,receipt)=>{originalIntent=receipt;inputBundle.context.decisionReferences.version=1;}});
  f.intentReceipt=originalIntent;
  assert.equal(f.result.usable,expected,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,JSON.stringify(output));
  const g=await ledger(f,{stage:'planning-adjudication',decisionReferences:capturedRefs});try{
   const before=fs.readFileSync(f.result.historyRef),origin=await g.core.historicalPlanningProducer('W',g.output);
   assert.equal(origin.context.decisionReferences.version,version);assert.equal(origin.output.raw,JSON.stringify(output));
   assert.deepEqual(fs.readFileSync(f.result.historyRef),before);
  }finally{g.store.close();}
 }
});

check('current diagnosis eligibility is captured before await and enforced at the original native formatter boundary',async t=>{
 useFormatterFixture(t);
    const operand={occurrenceId:'host-diagnosis',outputId:'original-output',rawSha256:'a'.repeat(64),materialOccurrenceIds:[]},receiptHash='b'.repeat(64);
    for(const eligible of [[],[operand]]){
        const inputBundle={...body,context:{stage:'planning-adjudication',decisionReferences:{version:1,occurrenceIds:['host-diagnosis'],diagnosisOccurrenceIds:['host-diagnosis']},diagnosisEligibility:{version:1},producerDiagnosticReceipt:{receiptHash,eligible:structuredClone(eligible)}}};
        const output={...value,decisions:[{occurrenceId:'host-diagnosis',disposition:'upheld',reason:'Independent exact current operand assessment',witnesses:[],resolution:'diagnosed',diagnosis:{outputId:operand.outputId,rawSha256:operand.rawSha256,inputReceiptHash:receiptHash,materialOccurrenceIds:[]}}]};
        const expected=eligible.length>0;
        const f=await produce(launch=>{
            const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
            assert.equal(new Ajv2020({strict:false}).compile(schema)(output),expected);
            launch.format(JSON.stringify(output));launch.finish(output);
        },{role:'adjudicator',inputBundle,beforeModelRequest:async()=>{
            inputBundle.context.producerDiagnosticReceipt.eligible=eligible.length?[]:[structuredClone(operand)];
            inputBundle.context.producerDiagnosticReceipt.receiptHash='c'.repeat(64);
        }});
        assert.equal(f.result.usable,expected,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,JSON.stringify(output));
        if(!expected)assert.match(f.result.issues.join(),/current eligible operand/);
        assert.ok(f.launches.every(l=>l.joined));
    }
});

check('caller mutation cannot grow or relabel the captured native decision domain',async t=>{
 useFormatterFixture(t);
    const references={version:1,occurrenceIds:['material','resolved','diagnostic'],diagnosisOccurrenceIds:['diagnostic']};
    const inputBundle={...body,context:{stage:'planning-adjudication',decisionReferences:structuredClone(references)}};
    const output={...value,decisions:[{occurrenceId:'material',disposition:'equivalent',equivalentTo:'resolved',reason:'Independent retained subject',witnesses:[]}]};
    const f=await produce(launch=>{
        const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
        assert.deepEqual(schema.properties.decisions.items.properties.occurrenceId.enum,references.occurrenceIds);
        assert.deepEqual(schema.properties.decisions.items.then.properties.occurrenceId.enum,references.occurrenceIds.filter(id=>!references.diagnosisOccurrenceIds.includes(id)));
        launch.format(JSON.stringify(output));launch.finish(output);
    },{role:'adjudicator',inputBundle,beforeModelRequest:async()=>{inputBundle.context.decisionReferences.occurrenceIds.push('late');inputBundle.context.decisionReferences.diagnosisOccurrenceIds.length=0;}});
    assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.ok(f.launches.every(l=>l.joined));
});

check('large decision identity schema is counted while its plain original input still fits',async()=>{
    const {roleFraming}=await load('workflow/role-framing.js'),{assertModelContextBudget}=await load('pi/context-budget.js');
    const occurrenceIds=Array.from({length:7000},(_,i)=>String(i).padStart(4,'0')+'r'.repeat(44));
    const inputBundle={...body,context:{stage:'planning-adjudication',decisionReferences:{version:1,occurrenceIds,diagnosisOccurrenceIds:[]}}};
    const framing=roleFraming('adjudicator',inputBundle,true),metadata=(await owner.models()).find(m=>m.id==='claude-sonnet-4-6');
    const plain=assertModelContextBudget(metadata,{systemPrompt:framing.systemPrompt,messages:[{role:'user',content:framing.prompt,timestamp:0}]});assert.ok(plain.estimatedInput<plain.availableInput);
    const f=await produce(()=>assert.fail('Oversized schema must refuse before Native birth'),{role:'adjudicator',inputBundle});
    assert.equal(f.launches.length,0);assert.equal(f.result.providerRequests,0);assert.equal(f.result.usable,false);assert.match(f.result.issues.join(),/MODEL_CONTEXT_LIMIT/);
});

check('provider quota failures preserve the reported reset date and timezone through the original SDK',async()=>{
    const previous=process.env.TZ;
    try{
        for(const [zone,date,hour,zoneName]of [['Asia/Seoul','07','12',/GMT\+09:00/],['UTC','07','03',/GMT(?:\+00:00)?(?=:|$)/],['America/Los_Angeles','06','19',/GMT-08:00/]]){
            process.env.TZ=zone;
            const f=await produce(launch=>{
                launch.send({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'seven_day',resetsAt:1794020400},uuid:randomUUID(),session_id:launch.sid});
                launch.send({type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,duration_ms:1,duration_api_ms:1,num_turns:1,errors:["You've hit your weekly limit"],total_cost_usd:0,permission_denials:[],usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
            });
            assert.equal(f.result.usable,false);assert.equal(f.result.terminal,'error');
            assert.equal(f.result.providerFailure?.kind,'usage-limit');assert.equal(f.result.providerFailure.resetsAt,1794020400);
            assert.equal(f.result.providerFailure.ownerSessionId,f.result.nativeSessionId);
            assert.ok(f.entries.some(e=>e.id===f.result.providerFailure.eventEntryId&&e.data.message.uuid===f.result.providerFailure.eventId));
            const issue=f.result.issues.find(i=>i.startsWith('PROVIDER:Claude rate limit (seven_day)'));
            assert.ok(issue,JSON.stringify(f.result.issues));assert.match(issue,new RegExp('2026-11-'+date+' '+hour+':00:00 '));assert.match(issue,zoneName);assert.match(issue,/You've hit your weekly limit/);
            assert.ok(f.launches.every(l=>l.joined));
        }
        for(const reset of [undefined,null,0,-1,'1794020400',1e20]){
            const f=await produce(launch=>{
                launch.send({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'seven_day',...(reset===undefined?{}:{resetsAt:reset})},uuid:randomUUID(),session_id:launch.sid});
                launch.send({type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,duration_ms:1,duration_api_ms:1,num_turns:1,errors:['Original quota refusal'],total_cost_usd:0,permission_denials:[],usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
            });
            assert.equal(f.result.providerFailure?.kind,'usage-limit');assert.equal(f.result.providerFailure.resetsAt,undefined);
            const issue=f.result.issues.find(i=>i.startsWith('PROVIDER:Claude rate limit (seven_day)'));
            assert.ok(issue,JSON.stringify(f.result.issues));assert.doesNotMatch(issue,/Invalid Date| — resets /);assert.match(issue,/Original quota refusal/);assert.equal(f.result.usable,false);assert.ok(f.launches.every(l=>l.joined));
        }
    }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

check('public SDK quota warning and failure share the complete provider-reported instant',async()=>{
    const previous=process.env.TZ;process.env.TZ='Asia/Seoul';
    const {createPiSession}=await load('pi/index.js'),notices=[],before=launches.length;
    const pi=await createPiSession({host,operations,model,systemPrompt:'Controlled quota presentation',maxReadBytes:1024});
    const ui={notify:(message,type)=>notices.push({message,type}),setStatus(){}};
    try{
        pi.session.extensionRunner.setUIContext(ui);
        await pi.session.extensionRunner.emit({type:'session_start',reason:'new'});
        await pi.session.extensionRunner.emitBeforeAgentStart({messageType:'user',prompt:'Controlled quota'}, {cwd:project,customPrompt:pi.session.systemPrompt,selectedTools:pi.session.getActiveToolNames(),skills:[],contextFiles:[]});
        await pi.session.extensionRunner.emit({type:'agent_start'});
        selectedScenario=launch=>{
            launch.send({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'seven_day',resetsAt:1794020400},uuid:randomUUID(),session_id:launch.sid});
            launch.send({type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,duration_ms:1,duration_api_ms:1,num_turns:1,errors:['Original quota refusal'],total_cost_usd:0,permission_denials:[],usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
        };
        const response=await pi.modelRuntime.streamSimple(pi.session.model,{systemPrompt:pi.session.systemPrompt,messages:[{role:'user',content:[{type:'text',text:'Controlled quota'}],timestamp:Date.now()}]},{sessionId:pi.sessionManager.getSessionId()}).result();
        assert.equal(response.stopReason,'error');assert.match(response.errorMessage,/2026-11-07 12:00:00 GMT\+09:00/);
        const warning=notices.find(n=>n.type==='warning'&&n.message.startsWith('Claude rate limited (seven_day)'));
        assert.ok(warning,JSON.stringify(notices));assert.match(warning.message,/2026-11-07 12:00:00 GMT\+09:00/);
        assert.equal(launches.length,before+1);assert.ok(launches.slice(before).every(l=>l.joined));assert.deepEqual(denied,[]);
    }finally{
        pi.session.extensionRunner.setUIContext();await pi.closeOwned();
        if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;
    }
});

check('reported model output default does not reject a valid bounded role response',async()=>{
    const f=await produce(launch=>{
        launch.format(JSON.stringify(value));
        launch.finish(value,{modelUsage:{'claude-sonnet-4-6':{maxOutputTokens:128000}}});
    });
    assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
    assert.equal(f.launches.length,1);assert.equal(f.launches[0].joined,true);
    assert.ok(!JSON.stringify(f.result.issues).includes('CLEANUP_UNKNOWN'));
    assert.ok(f.entries.some(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='result'&&e.data.message.modelUsage?.['claude-sonnet-4-6']?.maxOutputTokens===128000));
});

check('actual per-response output overflow retains original role failure and owned cleanup',async()=>{
    const f=await produce(launch=>{
        launch.format(JSON.stringify(value),{outputTokens:32001});launch.finish(value);
    });
    assert.equal(f.result.usable,false);assert.match(f.result.issues.join(),/BRIDGE_HOST_OUTPUT_LIMIT_MISMATCH/);
    assert.equal(f.launches.length,1);assert.equal(f.launches[0].joined,true);
    assert.ok(f.entries.some(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.event?.usage?.output_tokens===32001));
});

check('original role SDK/MCP tools receive captured backend facts without changing role filtering',async()=>{
    const context={projectRoot:'/work',shellCwd:'/work',projectAccess:'read-only',readOnlyPaths:['/work/check.cjs'],scratchRoots:['/tmp','/scratch'],inputMountRoot:null};
    const f=await produce(launch=>{
        const bash=launch.tools.find(t=>t.name==='bash');assert.ok(bash);
        assert.match(bash.description,/Executor shell cwd: "\/work"/);
        assert.match(bash.description,/Executor project access: read-only/);
        assert.match(bash.description,/No host input mount is supplied/);
        assert.ok(!launch.tools.some(t=>['write','edit'].includes(t.name)));
        assert.ok(!bash.description.includes(project));
        launch.format(JSON.stringify(value));launch.finish(value);
    },{operations:{...operations,executionContext:context}});
    assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
});

for(const [id,limit] of [['claude-sonnet-4-6',32000],['claude-haiku-4-5',16000]])for(const level of ['off','medium'])check('owned provider and isolated summary retain effective output limit: '+id+' '+level,async()=>{
    const {createPiSession}=await load('pi/session.js');
    const selected=await owner.selectModel(id,level),before=launches.length;
    const product=await createPiSession({host,operations,model:selected,systemPrompt:'Controlled hosted response policy.',maxReadBytes:1024,beforeModelRequest:async()=>{}});
    try{
        const registered=product.modelRuntime.getModel('claude-bridge',id);
        assert.equal(product.session.model.maxTokens,limit);assert.equal(registered.maxTokens,limit);
        assert.equal((await owner.models()).find(m=>m.id===id).maxTokens,limit);
        assert.throws(()=>product.modelRuntime.streamSimple({...registered,maxTokens:limit/2},{messages:[]},{sessionId:product.sessionManager.getSessionId()}),/cannot change declared model limits/);
        assert.equal(launches.length,before);
        selectedScenario=launch=>{
            assert.equal(launch.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,String(registered.maxTokens));
            launch.text('Controlled response and retained summary.');
            launch.finish(undefined,{result:'Controlled response and retained summary.',modelUsage:{'claude-sonnet-4-6':{maxOutputTokens:registered.maxTokens}}});
        };
        for(let turn=0;turn<3;turn++)await product.session.prompt('Retain this controlled conversation for a summary. '+String(turn)+' '+('x'.repeat(65000)));
        await product.compactOwned('Retain the controlled conversation.',AbortSignal.timeout(3000));
        const actual=launches.slice(before);
        assert.deepEqual(actual.map(launch=>launch.purpose),['provider','provider','provider','summary']);
        assert.deepEqual(actual.map(launch=>launch.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS),Array(4).fill(String(limit)));
    }finally{await product.closeOwned();}
});

check('parked native query retains its original cap and same-model declaration drift cannot dispatch again',async()=>{
    const {createPiSession}=await load('pi/session.js');
    const selected=await owner.selectModel('claude-haiku-4-5','off'),before=launches.length;
    const product=await createPiSession({host,operations,model:selected,systemPrompt:'Controlled retained output binding.',maxReadBytes:1024,beforeModelRequest:async()=>{}});
    let entered,release;
    const parked=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
    selectedScenario=async launch=>{
        assert.equal(launch.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'16000');entered();await held;
        completeText(launch,'Controlled response exceeds its original captured limit.',{outputTokens:16001});
    };
    let request;
    try{
        request=product.session.prompt('Original bounded input.');
        await Promise.race([parked,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Controlled native did not park')),2000);timer.unref();})]);
        const declaration=product.modelRuntime.getRegisteredProviderConfig('claude-bridge');
        product.modelRuntime.registerProvider('claude-bridge',{...declaration,models:declaration.models.map(m=>m.id==='claude-haiku-4-5'?{...m,maxTokens:32000}:m)});
        assert.equal(product.modelRuntime.getModel('claude-bridge','claude-haiku-4-5').maxTokens,32000);
        release();await request;
        assert.ok(product.session.messages.some(m=>m.role==='assistant'&&m.errorMessage?.includes('BRIDGE_HOST_OUTPUT_LIMIT_MISMATCH')));
        await product.session.prompt('A changed declaration must not admit a replacement query.');
        assert.equal(launches.length,before+1);
        assert.ok(product.session.messages.some(m=>m.role==='assistant'&&m.errorMessage?.includes('cannot change declared model limits')));
        assert.equal(launches.at(-1).joined,true);
    }finally{release();await request;await product.closeOwned();}
});

for(const duplicate of [false,true])check('original SDK receives verification reference guidance while strict host accounting stays independent: '+duplicate,async t=>{
 useFormatterFixture(t);
    const plan=mixedPlan();
    if(duplicate)plan.verification.strategies[1].requirementId=plan.requirements[0].id;
    // Like the original failed producer, retain a blocking finding. This allows
    // an incomplete proposal through capability accounting, never a duplicate ID.
    const output={...value,plan,...(duplicate?{findings:[{requirementId:'behavior',severity:'blocking',repair:'unknown',description:'Original controlled behavior remains unresolved',evidence:['Controlled original consumer']}]}:{})},inputBundle={...body,requirements:plan.requirements,context:{stage:'planning',planningVerificationProfile:initialVerificationProfile}};
    const f=await produce(launch=>{
        const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
        const verification=schema.properties.plan.properties.verification;
        assert.match(verification.properties.strategies.description,/At most one strategy/);
        assert.match(verification.properties.strategies.description,/capabilities, not a checklist/);
        const branches=verification.properties.strategies.items.anyOf;
        assert.ok(branches.every(s=>s.properties.requirementId.description.includes('even with a different kind')));
        assert.match(branches.find(s=>s.properties.kind.const==='base-execution-duty').properties.caseIds.description,/selected checkId/);
        assert.match(branches.find(s=>s.properties.kind.const==='manifest-scope-duty').properties.reviewKey.description,/verification.reviewRoles/);
        assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true,'Structural schema cannot certify cross-field requirement uniqueness');
        launch.format(JSON.stringify(output));launch.finish(output);
    },{role:'planner',inputBundle});
    assert.equal(f.result.usable,!duplicate,JSON.stringify(f.result.issues));
    assert.equal(f.result.rawFinal,JSON.stringify(output));
    assert.equal(f.result.nativeSource.kind,'claude-sdk-formatter/v1');
    if(duplicate)assert.match(f.result.issues.join(),/verification\.strategies\[1\]\.requirementId repeats/);
    else assert.deepEqual(f.result.protocol.plan,plan);
});

for(const assistantBeforeStop of [false,true])check('original raw formatter is selected without a final native assistant text; block ordering '+assistantBeforeStop,async()=>{
    const raw=JSON.stringify(value),f=await produce(launch=>{launch.format(raw,{assistantBeforeStop});launch.finish(value);});
    assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.deepEqual(f.result.protocol,value);
    assert.equal(f.result.nativeSource.kind,'claude-sdk-formatter/v1');assert.equal(read(f),raw);
    assert.equal(f.checkpoints,1);assert.equal(f.launches.length,1);assert.equal(f.result.providerRequests,1);
    assert.equal(f.launches[0].options.args[f.launches[0].options.args.indexOf('--max-turns')+1],'3');
    assert.notEqual(f.result.nativeSessionId,f.result.nativeSource.nativeSessionId);
});
for(const variant of ['missing-carrier','incomplete-arguments','foreign-stream-session','result-value-conflict','missing-structured-value','stream-ended-before-block'])check('original native source refuses '+variant+' without assistant fallback',async()=>{
    const raw=JSON.stringify(value),f=await produce(launch=>{
        launch.format(raw,{carrier:variant!=='missing-carrier',complete:variant!=='incomplete-arguments',foreignSession:variant==='foreign-stream-session',earlyMessageStop:variant==='stream-ended-before-block'});
        launch.finish(variant==='missing-structured-value'?undefined:variant==='result-value-conflict'?{...value,summary:'Conflicting original result'}:value,{result:raw});
    });
    assert.equal(f.result.usable,false);assert.equal(f.result.selectedFinalEntryId,null);assert.equal(f.result.rawFinal,null);
    assert.match(f.result.issues.join('\n'),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);assert.equal(f.launches.length,1);
});
check('reported native turns above the original bound cannot yield a usable role',async()=>{
    const f=await produce(launch=>{launch.format(JSON.stringify(value));launch.finish(value,{numTurns:4});});
    assert.equal(f.result.usable,false);assert.equal(f.result.selectedFinalEntryId,null);
    assert.match(f.result.issues.join('\n'),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);assert.equal(f.launches.length,1);
});
check('duplicate original findings remain exact unusable bytes rather than a decoded last-member replacement',async()=>{
    const finding=description=>({requirementId:'R1',severity:'blocking',repair:'substantive',description,evidence:['original controlled source']});
    const raw='{"version":1,"summary":"Duplicate claim members","findings":'+JSON.stringify([finding('FIRST ORIGINAL CLAIM')])+',"findings":'+JSON.stringify([finding('SECOND ORIGINAL CLAIM')])+',"assessedScope":[]}';
    const f=await produce(launch=>{launch.format(raw);launch.finish(JSON.parse(raw));});
    assert.equal(f.result.usable,false);assert.equal(f.result.terminal,'complete');assert.equal(f.result.rawFinal,raw);assert.ok(f.result.selectedFinalEntryId);
    assert.match(f.result.issues.join('\n'),/duplicate/i);assert.equal(read(f),raw);
    const {rawFindings}=await load('controller/raw-findings.js');assert.deepEqual(rawFindings(read(f)).findings.map(x=>x.description),['FIRST ORIGINAL CLAIM','SECOND ORIGINAL CLAIM']);
});
check('actual persisted checkpoint rejects source, role, frame and settlement drift',async()=>{
    const f=await produce(launch=>{launch.format(JSON.stringify(value));launch.finish(value);});assert.equal(f.result.usable,true);
    for(const mutate of [
        x=>{x.result.nativeSource.schemaDigest='b'.repeat(64);},
        x=>{x.intentReceipt.inputDigest='b'.repeat(64);},
        x=>{x.intentReceipt.schemaDigest='b'.repeat(64);},
        x=>{x.intentReceipt.requestDigest='b'.repeat(64);},
        x=>{delete x.intentReceipt;},
        x=>{x.entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.nativeCleanup='unknown';},
        x=>{x.entries.find(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='stream_event'&&e.data.message.event.type==='content_block_delta').data.message.event.delta.partial_json='{}';},
        x=>{x.entries.find(e=>e.customType===nativeRoleEntries.intent).data.request.binding.stage='planning';},
    ]){const changed=structuredClone({entries:f.entries,result:f.result,intentReceipt:f.intentReceipt});mutate(changed);assert.throws(()=>read(changed),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);}
});
async function ledger(f, capture = {}) {
    const {Store}=await load('controller/store.js'),{ChangeCore}=await load('controller/change-core.js');
    const store=new Store(':memory:'),run=randomUUID(),tuple={contracts:'K',requirements:null,base:'B',candidate:null,plan:null,verification:null};
    store.run('INSERT INTO sources VALUES(?,?,?,?)','S',null,'{}','Controlled source only');
    store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W',null,'S',null,'W','ACTIVE',1,1,null,'{}');
    for(const [kind,id]of [['contracts','K'],['base','B']])store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,'W',kind,null,null,createHash('sha256').update(id).digest('hex'),'{}');
    store.run('INSERT INTO change_state VALUES(?,?,?,?,?,?,?,?)','W','BASE_CAPTURED','B',null,null,null,1,JSON.stringify({contractsVersion:'K'}));
    // Controlled ledger premises, never a real engine-removal/standing claim.
    const native={cleanup:'removed',historyRef:f.result.historyRef,nativeSessionId:f.result.nativeSessionId,nativeCheckpoint:f.result.nativeCheckpoint};
    store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,'W',1,1,'SETTLED',project,'consumed',JSON.stringify(native));
    store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',f.result.launchId,'W',run,f.result.role,1,f.result.usable?'COMPLETE':'UNUSABLE','none',JSON.stringify({...native,stage:'fresh-review',inputVersions:tuple,nativeRoleIntent:f.intentReceipt,...capture}));
    const core=new ChangeCore({store,options:{installationHome:root},sourceImpacts:()=>[]});
    const complete=core.harvestEntries('W',f.result.launchId,f.result.role,f.entries,f.result,f.result.selectedFinalEntryId);
    const output=core.collect('W',f.result.launchId,{...f.result,nativeEntryId:f.result.selectedFinalEntryId},complete&&f.result.usable);
    return {store,core,output,run,tuple};
}
const finding=description=>({requirementId:'R1',severity:'blocking',repair:'substantive',description,evidence:['original controlled source']});
check('shared inline current finding bodies cross native SDK with original intent and historical body census intact',async t=>{
 useFormatterFixture(t);
 const {restoreFindingBodies}=await load('workflow/finding-body-presentation.js');
 const literal={...finding('Exact repeated original concern '+ '한글🙂'.repeat(200)),unknownOptional:{literal:['retain',null]}};
 const occurrences=Array.from({length:8},(_,i)=>({id:'F'+i,work:'W',output:'O'+i,ordinal:0,data:{finding:structuredClone(literal),launchId:'L'+i,role:'planner'}}));
 const inputBundle={...body,context:{stage:'planning-adjudication',baseVersion:'B',candidateVersion:null,planVersion:null,verificationVersion:null,occurrences}};
 const before=structuredClone(inputBundle),output={...value,planAccepted:false,decisions:[]};let wireText;
 const f=await produce(launch=>{
  const user=launch.frames.find(frame=>frame.type==='user').message.content;
  wireText=typeof user==='string'?user:user.filter(part=>part.type==='text').map(part=>part.text).join('');
  const wire=JSON.parse(wireText.split('\n')[1]);assert.equal(wire.context.findingBodyEncoding.bodies.length,1);
  assert.deepEqual(restoreFindingBodies(wire.context,'adjudicator'),inputBundle.context);
  launch.format(JSON.stringify(output));launch.finish(output);
 },{role:'adjudicator',inputBundle});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.deepEqual(inputBundle,before);
 const {hashText}=await load('workflow/exposure.js');assert.equal(f.intentReceipt.inputDigest,hashText(JSON.stringify(inputBundle)));
 const g=await ledger(f,{stage:'planning-adjudication'});try{
  const original=fs.readFileSync(f.result.historyRef),historical=await g.core.historicalPlanningProducer('W',g.output);
  assert.deepEqual(historical.context,inputBundle.context);
  assert.deepEqual(historical.witness.initialView.findingBodySuppliedIds,occurrences.map(row=>row.id));
  assert.equal(historical.witness.initialView.textSha256,hashText(wireText));assert.equal(historical.witness.checkpoint.sha256,f.result.nativeCheckpoint.sha256);
  assert.deepEqual(fs.readFileSync(f.result.historyRef),original);
 }finally{g.store.close();}
});
check('v3 typed finding values cross original SDK frames with exact independent decoding and historical census',async t=>{
 useFormatterFixture(t);
 const shared='Original evidence 한글🙂'.repeat(120),patch={path:'mode.cjs',oldText:shared,newText:shared+' fixed',literal:{valueRef:777}};
 const occurrences=[0,1,2].map(i=>({id:'F'+i,work:'W',output:'O'+i,ordinal:0,data:{finding:{...finding('Distinct concern '+i),evidence:[shared,shared],mechanicalPatch:patch,reproduction:{command:shared,assertions:[shared]},unknown:{valueRef:888}},launchId:'L'+i,role:'planner'}}));
 const inputBundle={...body,context:{stage:'planning-adjudication',findingBodyInput:{version:3},baseVersion:'B',candidateVersion:null,planVersion:null,verificationVersion:null,occurrences}};
 const {findingBodyFootprint}=await load('workflow/finding-body-presentation.js');
 const capture={stage:'planning-adjudication',findingBodyInput:{version:3},findingBodyHash:findingBodyFootprint(inputBundle.context,'adjudicator')};
 const before=JSON.stringify(inputBundle),output={...value,planAccepted:false,decisions:[]};let wireText;
 const f=await produce(launch=>{
  const user=launch.frames.find(frame=>frame.type==='user').message.content;wireText=typeof user==='string'?user:user.filter(p=>p.type==='text').map(p=>p.text).join('');
  const wire=JSON.parse(wireText.split('\n')[1]),{findingBodyEncoding:encoding,...decoded}=wire.context;
  assert.equal(encoding.version,3);assert.equal(encoding.bodies.length,3);assert.equal(encoding.values.length,2);
  // Independent controlled producer: expand only declared positions, never nested dictionary content.
  const expand=value=>value&&typeof value==='object'&&Object.keys(value).join(',')==='valueRef'?structuredClone(encoding.values[value.valueRef]):value;
  decoded.occurrences=decoded.occurrences.map(row=>{const {findingBodyIndex,...data}=row.data,b=structuredClone(encoding.bodies[findingBodyIndex]);b.mechanicalPatch=expand(b.mechanicalPatch);b.evidence=b.evidence.map(expand);b.reproduction.command=expand(b.reproduction.command);b.reproduction.assertions=b.reproduction.assertions.map(expand);return {...row,data:{finding:b,...data}};});
  assert.equal(JSON.stringify(decoded),JSON.stringify(inputBundle.context));launch.format(JSON.stringify(output));launch.finish(output);
 },{role:'adjudicator',inputBundle});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(JSON.stringify(inputBundle),before);
 const {hashText}=await load('workflow/exposure.js');assert.equal(f.intentReceipt.inputDigest,hashText(before));
 const missing=await ledger(f,{stage:'planning-adjudication'});try{await assert.rejects(()=>missing.core.historicalPlanningProducer('W',missing.output),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);}finally{missing.store.close();}
 const g=await ledger(f,capture);try{
  const original=fs.readFileSync(f.result.historyRef),historical=await g.core.historicalPlanningProducer('W',g.output);
  assert.equal(JSON.stringify(historical.context),JSON.stringify(inputBundle.context));assert.deepEqual(historical.witness.initialView.findingBodySuppliedIds,occurrences.map(r=>r.id));
  assert.equal(historical.witness.initialView.textSha256,hashText(wireText));assert.deepEqual(fs.readFileSync(f.result.historyRef),original);
 }finally{g.store.close();}
});
for(const stage of ['planning-adjudication','review-adjudication'])check('exact old requirements cross owned SDK and reconstruct original full historical hash: '+stage,async t=>{
 useFormatterFixture(t);
 const array=[{id:'R1',text:'Exact historical requirement 한글🙂 '.repeat(120),source:'original-owner',unknown:{requirementsRef:999}}],history={semantics:'Historical definitions remain separate',plans:[0,1,2].map(i=>({planHash:String(i+1).repeat(64),inlinePlan:{intent:'Distinct old plan '+i,requirements:structuredClone(array),unknown:{requirementsRef:777}}})),unavailable:[]};
 const context={stage,historicalRequirementsInput:{version:1},historicalPlanningOperands:history,planProposal:{requirements:[{id:'CURRENT',text:'Current proposal stays literal'}]},occurrences:[],baseVersion:'B',candidateVersion:null,planVersion:null,verificationVersion:null},inputBundle={...body,context},canonical=JSON.stringify(history),historicalInputHash=createHash('sha256').update(canonical).digest('hex'),output={...value,decisions:[],planAccepted:false};let initial;
 const f=await produce(launch=>{
  const content=launch.frames.find(frame=>frame.type==='user').message.content;initial=typeof content==='string'?content:content.filter(p=>p.type==='text').map(p=>p.text).join('');const wire=JSON.parse(initial.split('\n')[1]),h=wire.context.historicalPlanningOperands,{requirementsEncoding:encoding,...decoded}=structuredClone(h);
  assert.equal(encoding.version,1);assert.equal(encoding.values.length,1);assert.equal(wire.context.planProposal.requirements[0].text,'Current proposal stays literal');
  for(const plan of decoded.plans){const ref=plan.inlinePlan.requirements;assert.deepEqual(Object.keys(ref),['requirementsRef']);plan.inlinePlan.requirements=structuredClone(encoding.values[ref.requirementsRef]);}
  assert.equal(JSON.stringify(decoded),canonical);launch.format(JSON.stringify(output));launch.finish(output);
 },{role:'adjudicator',inputBundle});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.intentReceipt.inputDigest,createHash('sha256').update(JSON.stringify(inputBundle)).digest('hex'));
 const g=await ledger(f,{stage,historicalRequirementsInput:{version:1},historicalInputHash});try{
  const original=fs.readFileSync(f.result.historyRef),parsed=await g.core.historicalPlanningProducer('W',g.output);assert.equal(JSON.stringify(parsed.context.historicalPlanningOperands),canonical);assert.equal(parsed.witness.initialView.textSha256,createHash('sha256').update(initial).digest('hex'));assert.deepEqual(fs.readFileSync(f.result.historyRef),original);
  const row=g.store.one('SELECT * FROM role_launches WHERE id=?',f.result.launchId),data=JSON.parse(row.data);for(const field of ['historicalInputHash','historicalRequirementsInput']){const changed={...data};delete changed[field];g.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(changed),row.id);await assert.rejects(g.core.historicalPlanningProducer('W',g.output),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);g.store.run('UPDATE role_launches SET data=? WHERE id=?',row.data,row.id);}
 }finally{g.store.close();}
});
check('native schema input is counted before checkpoint and again after checkpoint growth',async()=>{
    const {createPiSession}=await load('pi/session.js'),{assertModelContextBudget}=await load('pi/context-budget.js');
    const {structuredOutputContext}=await load('pi/structured-output.js');
    for(const afterCheckpoint of [false,true]){
        let checkpoints=0,originalContext,selected;
        const before=launches.length,intent={version:1,requestId:randomUUID(),binding:{role:'reviewer'},maxNativeTurns:3,
            schema:{type:'object',properties:{summary:{type:'string',description:'Schema input '.repeat(2000)}}}};
        const product=await createPiSession({host,operations,model,systemPrompt:'Controlled context budget boundary.',maxReadBytes:1024,
            roleContextBudget:{assertEntry(){},structuredOutput:{intent,observe(){assert.fail('No native query admitted');}}},
            beforeModelRequest:async()=>{checkpoints++;originalContext.messages.push({role:'user',content:[{type:'text',text:'x'.repeat(2048)}],timestamp:Date.now()});
                assertModelContextBudget(selected,originalContext); // Plain input still fits; schema makes the difference.
            }});
        const guarded=product.session.agent.streamFunction;
        product.session.agent.streamFunction=(original,context,options)=>{
            originalContext=context;selected={...original};
            const plain=assertModelContextBudget({...original,contextWindow:1000000},context);
            const augmented=assertModelContextBudget({...original,contextWindow:1000000},structuredOutputContext(context,intent));
            assert.ok(augmented.estimatedInput>plain.estimatedInput+1024);
            selected.contextWindow=selected.maxTokens+plain.margin+(afterCheckpoint?augmented:plain).estimatedInput+128;
            assertModelContextBudget(selected,context);
            return guarded(selected,context,options);
        };
        try{
            await product.session.prompt('Original bounded owner input');
            assert.equal(checkpoints,afterCheckpoint?1:0);assert.equal(launches.length,before);
            const error=product.session.messages.filter(m=>m.role==='assistant').at(-1)?.errorMessage;
            assert.match(error,/HOST_CONTEXT_GUARD:.*MODEL_CONTEXT_LIMIT/);
        }finally{await product.closeOwned();}
    }
});
check('retained native formatter feeds selected review projection with source drift held',async()=>{
    const f=await produce(launch=>{launch.format(JSON.stringify(value));launch.finish(value);}),g=await ledger(f);
    try{
        const {projectSelectedReview}=await load('controller/selected-review-evidence.js');
        const launch=g.store.one('SELECT * FROM role_launches WHERE id=?',f.result.launchId);
        const data=JSON.parse(launch.data);Object.assign(data,{reviewKey:'behavior',purpose:'Independent behavior assessment',requiredPaths:[]});
        launch.data=JSON.stringify(data);
        const input={workId:'W',epoch:1,generation:1,versions:g.tuple,reviewKey:data.reviewKey,purpose:data.purpose,requiredPaths:[],launch,
            run:g.store.one('SELECT * FROM runs WHERE id=?',g.run),outputs:g.store.all('SELECT * FROM role_outputs WHERE launch=?',launch.id),entries:f.entries,bundle:body};
        const projected=projectSelectedReview(input);
        assert.equal(projected.raw,JSON.stringify(value));assert.equal(projected.native.selectedEntryId,f.result.selectedFinalEntryId);
        assert.ok(!JSON.stringify(projected).includes(f.result.historyRef));
        const changed=structuredClone(input),meta=JSON.parse(changed.outputs[0].data);meta.nativeSource.queryId='foreign-query';changed.outputs[0].data=JSON.stringify(meta);
        assert.throws(()=>projectSelectedReview(changed),/SELECTED_REVIEW_EVIDENCE_UNAVAILABLE/);
    }finally{g.store.close();}
});
check('historical producer reads the original native formatter and rejects replaced persisted source',async t=>{
 useFormatterFixture(t);
    const inputBundle={...body,context:{stage:'planning',occurrences:[],baseVersion:'B',candidateVersion:null,planVersion:null,verificationVersion:null}};
    const f=await produce(launch=>{launch.format(JSON.stringify(value));launch.finish(value);},{role:'planner',inputBundle}),g=await ledger(f);
    try{
        const launch=g.store.one('SELECT * FROM role_launches WHERE id=?',f.result.launchId),ld=JSON.parse(launch.data);
        ld.stage='planning';g.store.run('UPDATE role_launches SET role=?,data=? WHERE id=?','planner',JSON.stringify(ld),launch.id);
        const projected=await g.core.historicalPlanningProducer('W',g.output);
        assert.equal(projected.witness.outputId,g.output);assert.equal(projected.witness.role,'planner');
        const output=g.store.one('SELECT * FROM role_outputs WHERE id=?',g.output),meta=JSON.parse(output.data);
        meta.nativeSource.nativeSessionId='foreign-native';g.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(meta),g.output);
        await assert.rejects(()=>g.core.historicalPlanningProducer('W',g.output),/NATIVE_FORMAT_SOURCE_UNAVAILABLE|HISTORICAL_SELECTED_OUTPUT_UNAVAILABLE/);
    }finally{g.store.close();}
});
async function controllerRole(t,scenario,role='planner',context={stage:'fresh-review'},beforeRole,request='Preserve controlled consumer behavior.'){
    const {openController}=await load('controller/index.js');
    const home=appHome,source=path.join(root,'controller-project-'+randomUUID()),projectId='P-'+randomUUID();
    fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.txt'),'Controlled original captured source.');
    const c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});
    t.after(()=>c.close());
    await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request,executionLimit:8});
    await beforeRole?.(c,workId);
    const lineage=c.store.one('SELECT lineage FROM works WHERE id=?',workId).lineage,budgetBefore=c.store.one('SELECT consumed FROM budgets WHERE lineage=? AND kind=?',lineage,'execution').consumed;
    selectedScenario=scenario;const before=launches.length,scopeStart=scopes.length;
    let outcome;const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
    try{outcome=role==='planner'?await c.planChange({workId,model}):await c.changeCore.operation({workId,model},'plan',async()=>{await c.changeCore.role({workId,model},role,context);return c.changeCore.inspect(workId);});}finally{process.env.TMPDIR=previousTemp;}
    const launch=c.store.one('SELECT * FROM role_launches WHERE work=? ORDER BY rowid DESC LIMIT 1',workId),run=launch&&c.store.one('SELECT * FROM runs WHERE id=?',launch.run);
    assert.ok(launch,JSON.stringify(outcome));assert.equal(launches.length,before+1,JSON.stringify(outcome));
    assert.equal(scopes.length,scopeStart+1);assert.ok(scopes[scopeStart].closed);assert.ok(launches.at(-1).joined);
    assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(c.changeCore.h.busy(workId),false);
    const leases=c.store.all('SELECT * FROM capacity_leases WHERE run=?',run.id);assert.equal(leases.length,1);assert.equal(leases[0].state,'RELEASED');
    const budget=c.store.one('SELECT * FROM budgets WHERE lineage=? AND kind=?',lineage,'execution');assert.equal(budget.reserved,0);assert.equal(budget.consumed,budgetBefore+1);
    assert.equal(c.store.one('SELECT state FROM works WHERE id=?',workId).state,'ACTIVE');
    return {c,workId,launch,run,outcome};
}
// These forensic controls originally captured a text2 request while emitting
// synthetic formatter material. They do not grant an executable formatter tool.
for(const fault of ['none','before-database'])check('original Controller interrupted framed capture harvest '+fault,async t=>{
 globalThis.__nativeCapturePolicy='embedded-envelope/v2';t.after(()=>{delete globalThis.__nativeCapturePolicy;});useTextFixture(t);
 const f=await controllerRole(t,launch=>completeText(launch,JSON.stringify({...value,alternatives:[]})),'challenger',{stage:'planning-challenge',planProposal:mixedPlan()}),{c,workId,launch,run}=f,s=c.store,core=c.changeCore;
 const original=await core.nativeEntries(run.id),request=original.find(e=>e.customType===nativeRoleEntries.intent).data.request,directory=path.join(stateRoot,'interrupted-'+randomUUID());fs.mkdirSync(directory,{mode:0o700});
 const child=forkRecoveryFixture(new URL('./native-recovery-worker.mjs',import.meta.url),[stateRoot,artifactRoot,directory,'complete'],{env:{TMPDIR:artifactRoot,HOME:root},stdio:['ignore','ignore','ignore','ipc']});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
 const readyPromise=new Promise(resolve=>child.once('message',resolve));child.send(request);const ready=await Promise.race([readyPromise,exited.then(exit=>{throw Error('Controlled original recovery worker exited early '+JSON.stringify(exit));})]);child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');
 // Only original interrupted-role/run/capture state is seeded. The Controller
 // keeps its actual owner lease, original admission/costs and captured intent.
 assert.equal(s.all('SELECT * FROM finding_occurrences WHERE output IN (SELECT id FROM role_outputs WHERE launch=?)',launch.id).length,0);
 s.tx(()=>{s.run('DELETE FROM role_outputs WHERE launch=?',launch.id);s.run("DELETE FROM obligations WHERE work=? AND json_extract(data,'$.launchId')=?",workId,launch.id);
  s.run('UPDATE role_launches SET status=?,data=? WHERE id=?','INTERRUPTED',JSON.stringify({...JSON.parse(launch.data),nativeRoleIntent:ready.intent,nativeRoleDispatchCheckpoint:ready.dispatchCheckpoint,materialAccounting:undefined}),launch.id);
  s.run('UPDATE runs SET phase=?,data=? WHERE id=?','INTERRUPTED',JSON.stringify({...JSON.parse(run.data),controllerPid:child.pid,historyRef:ready.file,nativeSessionId:ready.sessionId,nativeCheckpoint:ready.dispatchCheckpoint,cleanup:'removed'}),run.id);
  s.run('INSERT INTO obligations VALUES(?,?,?)','interrupted-'+launch.id,workId,JSON.stringify({kind:'interrupted-producer',launchId:launch.id,runId:run.id,state:'pending'}));
 });
 const budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',s.one('SELECT lineage FROM works WHERE id=?',workId).lineage),births=launches.length,tx=s.tx;
 if(fault==='before-database'){
  let refused=false;s.tx=function(body){if(!refused&&!fs.existsSync(path.join(directory,ready.allocation.stagingName))){refused=true;throw Error('Controlled recovery database unavailable after stage unlink');}return tx.call(this,body);};
  try{await core.recoverRoleEvidence({workId});}finally{s.tx=tx;}
  assert.equal(refused,true);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?','interrupted-'+launch.id).data).state,'pending');assert.equal(s.all('SELECT * FROM finding_occurrences WHERE work=?',workId).length,0);
 }
 await core.recoverRoleEvidence({workId});assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?','interrupted-'+launch.id).data).state,'resolved');
 const claims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',workId);assert.ok(claims.some(row=>JSON.parse(row.data).finding.description==='Retain original crash claim'));
 assert.equal(s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",launch.id).length,0);assert.equal(s.one('SELECT status FROM role_launches WHERE id=?',launch.id).status,'INTERRUPTED');assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',s.one('SELECT lineage FROM works WHERE id=?',workId).lineage),budgets);
 const entries=await core.nativeEntries(run.id);assert.equal(entries.filter(e=>e.customType===nativeRoleEntries.capture).length,1);assert.equal(entries.filter(e=>e.customType===nativeRoleEntries.recovery).length,1);await core.recoverRoleEvidence({workId});assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',workId),claims);
 await c.close();const {openController}=await load('controller/index.js'),reopened=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
 assert.ok((await reopened.changeCore.nativeEntries(run.id)).some(e=>e.customType===nativeRoleEntries.capture));assert.deepEqual(reopened.store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',workId),claims);
},{timeout:15000});

async function historicalTextHostedRole(t,scenario){
 useTextFixture(t);
 const f=await controllerRole(t,scenario),entries=await f.c.changeCore.nativeEntries(f.run.id);
 const request=entries.find(entry=>entry.customType===nativeRoleEntries.intent).data.request;
 assert.equal(request.version,2);assert.equal(request.carrier,'assistant-json/v1');
 const {nativeRoleIntentReceipt}=await load('workflow/native-role-output.js');
 assert.deepEqual(JSON.parse(f.launch.data).nativeRoleIntent,nativeRoleIntentReceipt(request));
 return f;
}
for(const mode of ['corrected','failed-query','unattested-malformed-held','later-narrative'])check('submission Controller preserves original material '+mode,async t=>{
 assert.equal(globalThis.__nativeRoleCarrier,undefined);globalThis.__nativeRoleCarrier='tool-submission/v1';t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const prior=finding('Rejected original submission finding remains pending'),later=finding('Later original narrative finding remains pending'),good={...value,alternatives:[]};
 const bad={...good,findings:mode==='unattested-malformed-held'?'unavailable finding domain':[prior]};delete bad.alternatives;
 const f=await controllerRole(t,async launch=>{
  const rejected=await submitRole(launch,JSON.stringify(bad),{omitReceipt:mode==='unattested-malformed-held'});assert.equal(rejected.isError,true);
  const accepted=await submitRole(launch,JSON.stringify(good));assert.notEqual(accepted.isError,true);
  launch.finish(undefined,mode==='failed-query'?{subtype:'error_during_execution',is_error:true,result:'Original query failed after provisional receipt'}:{result:mode==='later-narrative'?JSON.stringify({...good,findings:[later]}):'Original query completed normally'});
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 const core=f.c.changeCore,s=f.c.store,ld=JSON.parse(f.launch.data),rd=JSON.parse(f.run.data),entries=parseSessionEntries(fs.readFileSync(rd.historyRef,'utf8'));
 const outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),selected=outputs.filter(output=>JSON.parse(output.data).nativeSource?.kind==='claude-sdk-tool-submission/v1');
 const beforeBudgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?)',f.workId),beforeOccurrences=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),beforeOutputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id);
 const holds=s.all('SELECT * FROM obligations WHERE work=?',f.workId).filter(row=>JSON.parse(row.data).kind==='raw-findings-incomplete');
 if(mode==='unattested-malformed-held'){
  assert.equal(f.launch.status,'UNUSABLE');assert.deepEqual(f.c.inspectChangeModelPrerequisites(f.workId),{stage:'held',roles:[]});assert.ok(holds.length);assert.ok(holds.every(row=>JSON.parse(row.data).state==='pending'));
  assert.ok(outputs.some(output=>output.raw===JSON.stringify(bad)),'Malformed original bytes stay retained despite a later valid submission');
 }else{
  assert.equal(holds.length,0);assert.equal(f.launch.status,mode==='failed-query'?'UNUSABLE':'COMPLETE');assert.equal(selected.length,mode==='failed-query'?0:1);
  if(mode==='later-narrative')assert.equal(beforeOccurrences.filter(row=>JSON.parse(row.data).finding.description===later.description).length,1);
  const occurrences=beforeOccurrences.filter(row=>JSON.parse(row.data).finding.description===prior.description);assert.equal(occurrences.length,1);
  const received=outputs.find(output=>output.id===occurrences[0].output);assert.equal(received.status,'accounted-intermediate');assert.equal(JSON.parse(received.data).materialSources[0].selector,'submission-arguments');
  const {readHistoricalSubmissionAttempt,readRejectedSubmissionAttempt}=await load('workflow/native-role-output.js');
  let direct;try {direct=readHistoricalSubmissionAttempt(entries,{sessionId:rd.nativeSessionId,launchId:f.launch.id,role:'challenger',intent:ld.nativeRoleIntent,checkpointLeafId:rd.nativeCheckpoint.leafId},JSON.parse(received.data).nativeEntryId);}catch(error){throw Error(String(error)+'; controlled producer issues='+JSON.stringify(outputs.filter(output=>output.status!=='accounted-intermediate').map(output=>JSON.parse(output.data).issues)));}assert.equal(direct.querySettlement,'verified');assert.ok(readRejectedSubmissionAttempt(entries,{sessionId:rd.nativeSessionId,launchId:f.launch.id,role:'challenger',intent:ld.nativeRoleIntent,checkpointLeafId:rd.nativeCheckpoint.leafId},JSON.parse(received.data).nativeEntryId).rejectionEntryId);
  const original=await core.historicalPlanningProducer(f.workId,received.id);assert.deepEqual(original.receivedFindings,[prior]);assert.equal(original.witness.materialSource.submissionAttempt.querySettlement,'verified');assert.equal(original.witness.materialSource.submissionAttempt.interpretation,'Exact complete received submission call only; no selected final, producer acceptance, diagnosis, semantic census or standing. Original query settlement proves custody, not a successful role.');assert.equal(Object.hasOwn(original.witness.materialSource,'formatterAttempt'),false);
  const source=JSON.parse(received.data).materialSources[0];assert.equal(original.witness.materialSource.source.rawSha256,source.rawSha256);
  const changed=JSON.parse(received.data);changed.materialSources[0].rawSha256='0'.repeat(64);s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(changed),received.id);await assert.rejects(core.historicalPlanningProducer(f.workId,received.id),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);s.run('UPDATE role_outputs SET data=? WHERE id=?',received.data,received.id);
  const nativeEntries=core.nativeEntries;try{
   core.nativeEntries=async function(...args){const data=await nativeEntries.apply(this,args);s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(received.data),driftDuringRead:true}),received.id);return data;};
   await assert.rejects(core.historicalPlanningProducer(f.workId,received.id),/HISTORICAL_/);
  }finally{core.nativeEntries=nativeEntries;s.run('UPDATE role_outputs SET data=? WHERE id=?',received.data,received.id);}
  const history=fs.readFileSync(rd.historyRef);try{assert.ok(history.toString('utf8').includes(prior.description));fs.writeFileSync(rd.historyRef,history.toString('utf8').replace(prior.description,prior.description+' drift'));await assert.rejects(core.historicalPlanningProducer(f.workId,received.id),/HISTORICAL_|NATIVE_/);}finally{fs.writeFileSync(rd.historyRef,history);}
 }
 const primary=outputs.find(output=>output.status!=='accounted-intermediate'),metadata=JSON.parse(primary.data);
 const execution={...metadata,role:'challenger',rawFinal:primary.raw,historyRef:rd.historyRef,nativeSessionId:rd.nativeSessionId,nativeCheckpoint:rd.nativeCheckpoint};
 core.harvestEntries(f.workId,f.launch.id,'challenger',entries,execution,metadata.nativeEntryId);
 assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?)',f.workId),beforeBudgets);
 assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),beforeOccurrences);
 assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),beforeOutputs);
 assert.equal(ld.nativeRoleIntent.role,'challenger');
});
check('submission Controller accounts closed empty findings without original query settlement',async t=>{
 globalThis.__nativeRoleCarrier='tool-submission/v1';t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const {version,...body}={...value,findings:[],assessedScope:[],decisions:[],acceptedPlan:mixedPlan()};
 assert.equal(version,1);
 const raw=JSON.stringify(body);
 const f=await controllerRole(t,async launch=>{
  const rejected=await submitRole(launch,raw,{omitReceipt:true});assert.equal(rejected.isError,true);
  launch.finish(undefined,{subtype:'error_during_execution',is_error:true,malformedError:true});
 },'adjudicator',{stage:'planning-adjudication',planProposal:mixedPlan()});
 const {c,launch,run,workId}=f,ld=JSON.parse(launch.data),rd=JSON.parse(run.data);
 const entries=await c.changeCore.nativeEntries(run.id);
 assert.equal(entries.filter(entry=>entry.customType===nativeRoleEntries.settlement).length,0);
 const rows=c.store.all('SELECT * FROM role_outputs WHERE launch=?',launch.id);
 const retained=rows.find(row=>row.raw===raw&&row.status==='accounted-intermediate');
 assert.ok(retained,'original arguments remain retained');
 assert.equal(launch.status,'UNUSABLE');
 assert.ok(rows.some(row=>row.status==='unusable'));
 assert.ok(rows.every(row=>row.status!=='usable'));
 assert.equal(c.store.all('SELECT * FROM finding_occurrences WHERE work=?',workId).length,0);
 const holds=c.store.all('SELECT data FROM obligations WHERE work=?',workId).map(row=>JSON.parse(row.data));
 assert.ok(holds.every(hold=>hold.kind!=='raw-findings-incomplete'));
 const {readReceivedSubmissionArguments,readHistoricalSubmissionAttempt}=await load('workflow/native-role-output.js');
 const expected={sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,intent:ld.nativeRoleIntent,checkpointLeafId:rd.nativeCheckpoint.leafId};
 const source=JSON.parse(retained.data).nativeEntryId;
 assert.equal(readReceivedSubmissionArguments(entries,expected,source).raw,raw);
 assert.throws(()=>readHistoricalSubmissionAttempt(entries,expected,source),/original settlement unavailable/);
 for(const changed of [{role:'planner'},{sessionId:'foreign'},{launchId:'foreign'},{checkpointLeafId:'foreign'}])
  assert.throws(()=>readReceivedSubmissionArguments(entries,{...expected,...changed},source),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
 const changed=structuredClone(entries);
 const owner=changed.find(entry=>entry.id===source);
 owner.data.message.parent_tool_use_id='foreign';
 assert.throws(()=>readReceivedSubmissionArguments(changed,expected,source),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
 const original=readReceivedSubmissionArguments(entries,expected,source);
 for(const identity of ['id','uuid']){
  const copy=structuredClone(entries),argument=copy.find(entry=>entry.id===original.frames[2]);
  const initial=copy.find(entry=>entry.customType===nativeRoleEntries.sdk&&entry.data.message.subtype==='init');
  if(identity==='id')initial.id=argument.id;
  else initial.data.message.uuid=argument.data.message.uuid;
  assert.throws(()=>readReceivedSubmissionArguments(copy,expected,source),identity==='id'?/frame identity mismatch/:/owning message identity unavailable/);
 }
 const owningPacket=(entry,type)=>entry.customType===nativeRoleEntries.sdk&&
  entry.data.message.type===type&&entry.data.message.message?.id===original.nativeMessageId;
 for(const alter of [
  copy=>{copy.find(entry=>owningPacket(entry,'assistant')).data.message.message.content.find(block=>block.id===original.toolUseId).input.summary='Conflicting typed input';},
  copy=>{copy.find(entry=>entry.id===original.frames.at(-1)).data.message.event={type:'message_delta'};},
  copy=>{const i=copy.findIndex(entry=>owningPacket(entry,'assistant'));const [packet]=copy.splice(i,1);copy.splice(copy.findIndex(entry=>entry.id===source),0,packet);
   copy.filter(entry=>entry.customType===nativeRoleEntries.sdk).forEach((entry,index)=>{entry.data.sequence=index+1;});},
 ]){
  const altered=structuredClone(entries);alter(altered);
  assert.throws(()=>readReceivedSubmissionArguments(altered,expected,source),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
 }

 // Reproduce the legacy hold and its historical failure record against the
 // same captured original response. Public recovery repairs current material
 // accounting while keeping both diagnostic and producer output unchanged.
 const s=c.store, holdId='raw-incomplete-'+launch.id+'-native-material';
 const diagnostic=s.one('SELECT * FROM obligations WHERE id=?','diagnostic-'+launch.id);
 const primary=rows.find(row=>row.status==='unusable'), primaryData=JSON.parse(primary.data);
 const extractionIssue='NATIVE_FINDING_HARVEST: original material extraction unavailable';
 const issues=[...primaryData.issues,extractionIssue], recordedReason='ControllerError: '+issues.join('; ');
 const changeData=JSON.parse(s.one('SELECT data FROM change_state WHERE work=?',workId).data);
 s.tx(()=>{
  s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({...primaryData,issues}),primary.id);
  s.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({...JSON.parse(diagnostic.data),issues}),diagnostic.id);
  s.run('UPDATE change_state SET phase=?,data=? WHERE work=?','BLOCKED',JSON.stringify({...changeData,blocked:[recordedReason,'Independent blocker remains'],resumeStage:'plan'}),workId);
  s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...ld,materialAccounting:undefined}),launch.id);
  s.run('INSERT INTO obligations VALUES(?,?,?)',holdId,workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:launch.id,historyRef:rd.historyRef,
   extractionIssueCount:1,extractionIssues:[{entryId:source,reason:'Original submission held by the previous collector'}]}));
 });
 const before=c.inspectChangeResult(workId);
 assert.ok(before.blocked.includes(recordedReason));
 assert.equal(before.restoredRoleMaterialLaunchId,undefined);
 await assert.rejects(c.planChange({workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
 const current=c.inspectChangeResult(workId);
 assert.equal(current.restoredRoleMaterialLaunchId,launch.id);
 assert.ok(current.blocked.includes('ControllerError: '+primaryData.issues.join('; ')));
 assert.ok(current.blocked.includes('Independent blocker remains'));
 assert.ok(current.blocked.every(reason=>!reason.includes(extractionIssue)));
 assert.equal(current.reviewReady,false);
 assert.deepEqual(JSON.parse(s.one('SELECT data FROM role_outputs WHERE id=?',primary.id).data).issues,issues);
 assert.ok(JSON.parse(s.one('SELECT data FROM change_state WHERE work=?',workId).data).blocked.includes(recordedReason));
 const restored=s.one('SELECT data FROM obligations WHERE id=?',holdId);
 s.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({...JSON.parse(restored.data),checkpoint:{...rd.nativeCheckpoint,sha256:'0'.repeat(64)}}),holdId);
 assert.equal(c.inspectChangeResult(workId).restoredRoleMaterialLaunchId,undefined);
 assert.ok(c.inspectChangeResult(workId).blocked.includes(recordedReason));
});
async function submissionAssessmentProducer(t,kind='eligible') {
 assert.equal(globalThis.__nativeRoleCarrier,undefined);globalThis.__nativeRoleCarrier='tool-submission/v1';t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const prior=finding('Original rejected submission claim must be independently accounted'),good={...value,alternatives:[]};
 const raw=JSON.stringify({...good,findings:[prior]}).replace('"findings":'+JSON.stringify([prior]),'"findings":'+JSON.stringify([prior])+',"findings":"Malformed public allegation requires independent assessment"');
 const f=await controllerRole(t,async launch=>{
  if(kind==='partial')launch.format(raw.slice(0,-1),{toolName:'mcp__custom-tools__gitjig_submit_role_result',carrier:false,complete:false});
  else assert.equal((await submitRole(launch,raw,{omitReceipt:kind==='missing-receipt'})).isError,true);
  assert.notEqual((await submitRole(launch,JSON.stringify(good))).isError,true);
  launch.finish(undefined,kind==='failed-query'?{subtype:'error_during_execution',is_error:true,result:'Failed query cannot admit submission assessment'}:{result:'Original query completed normally'});
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 delete globalThis.__nativeRoleCarrier;
 const s=f.c.store,core=f.c.changeCore,outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),source=outputs.find(row=>JSON.parse(row.data).materialAssessment?.version===3);
 return {...f,s,core,outputs,source,prior,raw};
}
for(const kind of ['eligible','missing-receipt','failed-query','partial'])check('submission independent assessment admission '+kind,async t=>{
 const f=await submissionAssessmentProducer(t,kind),{s,core,source}=f;
 if(kind!=='eligible'){
  assert.equal(source,undefined);assert.equal(f.launch.status,'UNUSABLE');assert.deepEqual(f.c.inspectChangeModelPrerequisites(f.workId),{stage:'held',roles:[]});assert.ok(core.pending(f.workId).some(d=>d.kind==='raw-findings-incomplete'));return;
 }
 assert.ok(source);assert.equal(f.launch.status,'COMPLETE');assert.equal(core.pending(f.workId).some(d=>d.kind==='raw-findings-incomplete'),false);
 const md=JSON.parse(source.data);assert.equal(md.materialAssessment.version,3);assert.equal(md.materialAssessment.source.selector,'submission-arguments');assert.equal(Object.hasOwn(md.materialAssessment,'selected'),true);
 const rows=s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',source.id);assert.equal(rows.length,2);assert.deepEqual(JSON.parse(rows[0].data).finding,f.prior);
 const diagnosis=rows[1].id;assert.ok(core.diagnosisSubjectIds(f.workId).has(diagnosis));assert.ok(core.pending(f.workId).some(d=>d.id===diagnosis));
 const origin=await core.diagnosisOrigin(f.workId,diagnosis);assert.equal(origin.metadata.materialAssessment.version,3);assert.deepEqual(origin.material.map(row=>row.id),[rows[0].id]);
 const budgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?)',f.workId),occurrences=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id);
 const primary=outputs.find(row=>['usable','unusable'].includes(row.status)),primaryData=JSON.parse(primary.data),run=s.one('SELECT * FROM runs WHERE id=?',f.launch.run),rd=JSON.parse(run.data),entries=parseSessionEntries(fs.readFileSync(rd.historyRef,'utf8'));
 core.harvestEntries(f.workId,f.launch.id,'challenger',entries,{...primaryData,role:'challenger',rawFinal:primary.raw,nativeSessionId:rd.nativeSessionId,nativeCheckpoint:rd.nativeCheckpoint},primaryData.nativeEntryId);
 assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?)',f.workId),budgets);assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),occurrences);assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);
 for(const drift of ['raw','source','missing','duplicate']){
  let extra;try{
   if(drift==='raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',primary.raw+' drift',primary.id);
   if(drift==='source')s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({...primaryData,nativeSource:{...primaryData.nativeSource,rawDigest:'0'.repeat(64)}}),primary.id);
   if(drift==='missing')s.run('DELETE FROM role_outputs WHERE id=?',primary.id);
   if(drift==='duplicate'){extra=randomUUID();s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',extra,primary.launch,primary.raw,primary.status,primary.data);}
   await assert.rejects(core.diagnosisOrigin(f.workId,diagnosis));
  }finally{if(extra)s.run('DELETE FROM role_outputs WHERE id=?',extra);if(drift==='missing')s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',primary.id,primary.launch,primary.raw,primary.status,primary.data);else s.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?',primary.raw,primary.data,primary.id);}
 }
 assert.ok(core.pending(f.workId).some(d=>d.id===diagnosis),'A later valid result never resolves the independent diagnosis');
});
check('submission independent assessment survives cold Controller reopen',async t=>{
 const f=await submissionAssessmentProducer(t),diagnosis=[...f.core.diagnosisSubjectIds(f.workId)][0],before=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),births=launches.length;
 await f.c.close();const {openController}=await load('controller/index.js');const reopened=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
 const origin=await reopened.changeCore.diagnosisOrigin(f.workId,diagnosis);assert.equal(origin.metadata.materialAssessment.version,3);assert.deepEqual(reopened.store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),before);assert.equal(launches.length,births);
});
for(const carrier of ['formatter/v1','tool-submission/v1','current-default'])for(const fault of ['none','forged-receipt','missing-sibling','selected-drift'])check('submission independent assessment actual J '+carrier+' '+fault,async t=>{
 const f=await submissionAssessmentProducer(t),{s,core,source}=f,before=f.c.inspectChange(f.workId),synthetic=[...core.diagnosisSubjectIds(f.workId)];assert.equal(synthetic.length,1);
 const sourceRow={...source},occurrences=s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',source.id),primary=s.all("SELECT * FROM role_outputs WHERE launch=? AND status IN ('usable','unusable')",f.launch.id)[0];
 assert.equal(occurrences.length,2);
 if(carrier==='current-default')assert.equal(globalThis.__nativeRoleCarrier,undefined);else globalThis.__nativeRoleCarrier=carrier;
 assert.equal(globalThis.__nativeFramingCalls,undefined);globalThis.__nativeFramingCalls=[];t.after(()=>delete globalThis.__nativeFramingCalls);
 const launchStart=s.all('SELECT id FROM role_launches WHERE work=?',f.workId).map(row=>row.id);
 selectedScenario=async launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned ')),role=prompt.match(/^Perform the assigned (\w+) task/)[1],supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]);supplied.context=readFixtureMetadataContext(supplied.context);
  const output={...value,assessedScope:supplied.requiredScope};
  if(role==='planner'){
   const requirement=supplied.requirements[0],plan=mixedPlan(),check=plan.verification.checks[0];plan.requirements=[requirement];plan.verification.checks=[check];check.guaranteeIds=[requirement.id];for(const item of check.cases){item.guaranteeIds=[requirement.id];item.consumerPaths=['consumer.txt'];}plan.verification.strategies=[{kind:'consumer-cases',requirementId:requirement.id,checkIds:[check.id]}];plan.verification.requiredPaths=['consumer.txt'];for(const reviewer of plan.verification.reviewRoles)reviewer.requiredPaths=['consumer.txt'];output.plan=plan;
  }else if(role==='challenger')output.alternatives=[];
  else{
   assert.equal(role,'adjudicator');assert.ok(strings([launch.frames,launch.options.args]).some(text=>text.includes('Recipe3 rejected submission material')));
   const receipt=supplied.context.producerDiagnosticReceipt,eligible=receipt.eligible.find(item=>item.occurrenceId===synthetic[0]);assert.ok(eligible);assert.deepEqual(eligible.materialOccurrenceIds,[occurrences[0].id]);
   assert.ok(supplied.context.producerDiagnostics.outputs.some(item=>item.outputId===source.id&&item.raw===f.raw&&item.materialSource.version===3));
   if(carrier!=='formatter/v1'){
    const schema=launch.tools.find(tool=>tool.name==='gitjig_submit_role_result').inputSchema;
    const constraint=schema.properties.decisions.items.allOf.find(rule=>rule.if?.properties?.resolution?.const==='diagnosed');
    const target=constraint.then.anyOf.find(rule=>rule.properties.occurrenceId.const===synthetic[0]).properties;
    assert.equal(target.disposition.const,'upheld');assert.equal(target.diagnosis.properties.outputId.const,source.id);
    assert.equal(target.diagnosis.properties.rawSha256.const,eligible.rawSha256);assert.equal(target.diagnosis.properties.inputReceiptHash.const,receipt.receiptHash);
    assert.deepEqual(target.diagnosis.properties.materialOccurrenceIds.items.enum,eligible.materialOccurrenceIds);
    assert.equal(target.diagnosis.properties.materialOccurrenceIds.minItems,eligible.materialOccurrenceIds.length);
    assert.equal(target.diagnosis.properties.materialOccurrenceIds.maxItems,eligible.materialOccurrenceIds.length);
   }
   output.planAccepted=true;output.decisions=before.occurrences.filter(item=>fault!=='missing-sibling'||item.id!==occurrences[0].id).map(item=>item.id===synthetic[0]?{occurrenceId:item.id,disposition:'upheld',resolution:'diagnosed',reason:'Independently examined the exact malformed original; its separate literal allegation is independently dispositioned',witnesses:[source.id],diagnosis:{outputId:source.id,rawSha256:eligible.rawSha256,inputReceiptHash:fault==='forged-receipt'?'0'.repeat(64):receipt.receiptHash,materialOccurrenceIds:eligible.materialOccurrenceIds}}:{occurrenceId:item.id,disposition:'rejected',reason:'The discarded draft allegation is not a defect in the current consumer intent',witnesses:[source.id]});
  }
  Object.assign(output,writeFixtureVerificationDomain(output,supplied.context));
  if(carrier!=='formatter/v1'){assert.notEqual((await submitRole(launch,JSON.stringify(output))).isError,true);launch.finish(undefined,{result:'Original independent planning role completed'});}
  else {launch.format(JSON.stringify(output));launch.finish(output);}
 };
 const originalPrevalidate=core.prevalidateDiagnoses;if(fault==='selected-drift')core.prevalidateDiagnoses=async function(...args){const proof=await originalPrevalidate.apply(this,args);s.run('UPDATE role_outputs SET raw=? WHERE id=?',primary.raw+' changed after prevalidation',primary.id);return proof;};
 const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
 const freshLaunches=s.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',f.workId).filter(row=>!launchStart.includes(row.id));
 assert.deepEqual(freshLaunches.map(row=>row.role),['planner','challenger','adjudicator']);
 for(const row of freshLaunches){
  const entries=await core.nativeEntries(row.run),intent=entries.find(entry=>entry.customType===nativeRoleEntries.intent).data.request;
  const {nativeRoleIntentReceipt}=await load('workflow/native-role-output.js');
  assert.deepEqual(JSON.parse(row.data).nativeRoleIntent,nativeRoleIntentReceipt(intent));
  assert.equal(intent.version,carrier!=='formatter/v1'?3:1);assert.equal(intent.binding.nativeEvidencePolicy,'raw-envelope/v1');
  if(carrier==='current-default'){
   assert.equal(globalThis.__nativeRoleCarrier,undefined);
   const frames=globalThis.__nativeFramingCalls.filter(frame=>frame.role===row.role);
   assert.ok(frames.some(frame=>frame.id==='preallocation-estimate'));assert.ok(frames.some(frame=>frame.id===row.id));
   for(const frame of frames){
    assert.equal(frame.version,3);
    const expected=structuredClone(intent.schema);
    if(row.role==='adjudicator'&&frame.id==='preallocation-estimate'){
     // Launch-bound diagnosis operands are captured after the lower-bound
     // preparation estimate. The final SDK schema adds their exact constraint.
     assert.equal(expected.properties.decisions.items.allOf[0].if.properties.resolution.const,'diagnosed');
     expected.properties.decisions.items.allOf.shift();
    }
    assert.deepEqual(JSON.parse(frame.schema),expected);
   }
  }
  if(carrier!=='formatter/v1'){
   assert.equal(intent.carrier,'tool-submission/v1');
   const selected=s.all('SELECT * FROM role_outputs WHERE launch=?',row.id).filter(output=>JSON.parse(output.data).nativeSource?.kind==='claude-sdk-tool-submission/v1');
   const rejectedJudgment=row.role==='adjudicator'&&['forged-receipt','missing-sibling'].includes(fault);
   assert.equal(selected.length,rejectedJudgment?0:1);
  }
 }
 let finalStore=s;
 if(fault==='none'){
  assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.equal(core.pending(f.workId).length,0);assert.ok(result.planVersion);
  if(carrier!=='formatter/v1'){
   const judge=freshLaunches.at(-1),output=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge.id)[0];
   assert.ok(core.strategies(f.workId));
   for(const defect of ['unknown-kind','raw-digest']){
    const metadata=JSON.parse(output.data);metadata.nativeSource={...metadata.nativeSource,...(defect==='unknown-kind'?{kind:'unrecognized-source/v1'}:{rawDigest:'0'.repeat(64)})};
    try{s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),output.id);assert.throws(()=>core.strategies(f.workId),/Original retained planning output does not match received judgment/);}
    finally{s.run('UPDATE role_outputs SET data=? WHERE id=?',output.data,output.id);}
   }
   const rows=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),budgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),births=launches.length;
   await f.c.close();const {openController}=await load('controller/index.js');
   const reopened=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
   finalStore=reopened.store;
   assert.equal(reopened.inspectChange(f.workId).planVersion,result.planVersion);assert.equal(reopened.changeCore.pending(f.workId).length,0);assert.ok(reopened.changeCore.strategies(f.workId));
   const original=await reopened.changeCore.historicalPlanningProducer(f.workId,output.id);assert.equal(JSON.parse(original.output.data).nativeSource.kind,'claude-sdk-tool-submission/v1');original.assertCurrent();
   assert.deepEqual(reopened.store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),rows);
   assert.deepEqual(reopened.store.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),budgets);assert.equal(launches.length,births);
  }
 }else{
  assert.notEqual(result.phase,'PLAN_READY');assert.equal(result.planVersion,null);assert.ok(core.pending(f.workId).some(item=>item.id===synthetic[0]));
 }
 assert.deepEqual({...finalStore.one('SELECT * FROM role_outputs WHERE id=?',source.id)},sourceRow);assert.deepEqual(finalStore.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',source.id),occurrences);
});
check('submission independent assessment restores old plain claim once and fences coverage drift',async t=>{
 const f=await submissionAssessmentProducer(t),{s,core,source}=f,{hash}=await load('controller/change-files.js'),md=JSON.parse(source.data),rows=s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',source.id),literal=rows[0],diagnosis=rows[1];
 // Reconstruct only the old partial accounting cache in this disposable world.
 // Original Native trace, raw body, selected result and literal occurrence stay exact.
 const plain={...md};delete plain.materialAssessment;plain.accountingKey=hash({source:md.materialAssessment.source,locations:md.materialSources.map(({findingPath,memberPath,index})=>({findingPath,memberPath,index}))});
 s.run('DELETE FROM obligations WHERE id=?',diagnosis.id);s.run('DELETE FROM finding_occurrences WHERE id=?',diagnosis.id);s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(plain),source.id);
 const launch=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),ld=JSON.parse(launch.data);ld.materialAccounting.version=10;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),launch.id);
 s.run('INSERT INTO obligations VALUES(?,?,?)','raw-incomplete-'+launch.id+'-native-material',f.workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:launch.id,historyRef:ld.historyRef,extractionIssueCount:1,extractionIssues:[{entryId:plain.nativeEntryId,reason:'Historical unsupported submission finding domain'}]}));
 s.run('UPDATE budgets SET lim=consumed WHERE lineage=(SELECT lineage FROM works WHERE id=?) AND kind=?',f.workId,'execution');
 const beforeBudgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),births=launches.length,originalPlain=s.one('SELECT * FROM role_outputs WHERE id=?',source.id);
 await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),beforeBudgets);
 const assessment=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',launch.id).find(row=>JSON.parse(row.data).materialAssessment?.version===3);assert.ok(assessment);const restored=JSON.parse(assessment.data);assert.equal(restored.materialAssessment.coveredOutputs.length,1);assert.equal(restored.materialAssessment.coveredOutputs[0].id,source.id);assert.equal(restored.harvestedFindings.length,0);
 assert.deepEqual(s.one('SELECT * FROM finding_occurrences WHERE id=?',literal.id),literal);assert.equal(s.all('SELECT * FROM finding_occurrences WHERE work=?',f.workId).filter(row=>JSON.parse(row.data).finding.description===f.prior.description).length,1);
 const suffix=s.one('SELECT * FROM finding_occurrences WHERE output=?',assessment.id),origin=await core.diagnosisOrigin(f.workId,suffix.id);assert.deepEqual(origin.material.map(row=>row.id),[literal.id]);assert.ok(core.pending(f.workId).some(row=>row.id===suffix.id));
 for(const drift of ['reference-hash','plain-raw','occurrence']){
  try{
   if(drift==='reference-hash'){const altered=JSON.parse(assessment.data);altered.materialAssessment.coveredOutputs[0].sha256='0'.repeat(64);s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(altered),assessment.id);}
   if(drift==='plain-raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',source.raw+' changed',source.id);
   if(drift==='occurrence')s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify({...JSON.parse(literal.data),finding:{...f.prior,description:'Altered original allegation'}}),literal.id);
   await assert.rejects(core.diagnosisOrigin(f.workId,suffix.id));
  }finally{s.run('UPDATE role_outputs SET data=? WHERE id=?',assessment.data,assessment.id);s.run('UPDATE role_outputs SET raw=? WHERE id=?',source.raw,source.id);s.run('UPDATE finding_occurrences SET data=? WHERE id=?',literal.data,literal.id);}
 }
 const outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',launch.id),claims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);
 await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',launch.id),outputs);assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',source.id),originalPlain);
});
check('fresh reviewer receives recorded classification without repair closure or prior verdict reasoning',async t=>{
    const c=await initializeController({installationHome:appHome});t.after(()=>c.close());
    const source=path.join(root,'review-accounting-'+randomUUID()),projectId=randomUUID();fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.txt'),'Controlled source');
    await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Preserve the controlled source'}),s=c.store;
    // Controlled prior ledger premises test delivery, not their semantic validity.
    const origin=randomUUID(),outputId=randomUUID(),runId=s.one('SELECT id FROM runs WHERE work=? ORDER BY rowid LIMIT 1',workId).id,ids=[randomUUID(),randomUUID(),randomUUID()];
    const claims=ids.map((_,i)=>({requirementId:'owner-request',severity:'blocking',repair:'unknown',description:'Retained claim '+i,evidence:['Original claim evidence']}));
    const old={...value,findings:claims};s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',origin,workId,runId,'reviewer',1,'COMPLETE','none',JSON.stringify({stage:'fresh-review',cleanup:'removed'}));
    s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',outputId,origin,JSON.stringify(old),'usable',JSON.stringify({protocol:old}));
    const obligations=[{kind:'finding',occurrence:ids[0],state:'pending',disposition:'upheld'},{kind:'finding',occurrence:ids[1],state:'pending',disposition:'equivalent',equivalentTo:ids[0]},{kind:'finding',occurrence:ids[2],state:'pending'}];
    ids.forEach((id,i)=>{s.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)',id,outputId,i,workId,JSON.stringify({finding:claims[i],launchId:origin,role:'reviewer'}));s.run('INSERT INTO obligations VALUES(?,?,?)',id,workId,JSON.stringify(obligations[i]));});
    const judge=randomUUID();s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',judge,workId,runId,'adjudicator',1,'COMPLETE','none',JSON.stringify({stage:'review-adjudication',cleanup:'removed'}));
    ids.slice(0,2).forEach((id,i)=>{const decision={occurrenceId:id,disposition:obligations[i].disposition,...(i===1?{equivalentTo:ids[0]}:{}),reason:'CONTROLLED_PRIOR_REASON',witnesses:[]};s.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',randomUUID(),id,judge,decision.disposition,JSON.stringify(decision));});
    const before=s.all('SELECT * FROM obligations WHERE work=? ORDER BY rowid',workId),oldDecisions=s.all('SELECT * FROM finding_dispositions ORDER BY rowid'),{bundle}=await c.changeCore.bundle(workId,{stage:'fresh-review'},'reviewer',model);
    const f=await produce(launch=>{
        const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
        const prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned reviewer task'));
        assert.ok(prompt);assert.equal(prompt.includes('CONTROLLED_PRIOR_REASON'),false);const supplied=JSON.parse(prompt.split('\n')[1]),pending=supplied.context.openObligations;
        assert.equal(pending.length,3);assert.ok(pending.every(x=>x.state==='pending'));
        assert.equal(pending[0].disposition,'upheld');assert.equal(pending[1].disposition,'equivalent');assert.equal(pending[1].equivalentTo,ids[0]);
        assert.equal(Object.hasOwn(pending[2],'disposition'),false);assert.equal(Object.hasOwn(pending[2],'equivalentTo'),false);
        assert.ok(pending.every(x=>!Object.hasOwn(x,'reason')&&!Object.hasOwn(x,'resolution')));assert.equal(Object.hasOwn(supplied.context,'dispositions'),false);
        const system=strings(launch.frames).find(v=>v.includes('You are the assigned reviewer'));assert.ok(system);
        assert.match(system,/pending does not mean undispositioned or repaired/);assert.match(system,/Final adjudication records repair closure after this review/);assert.match(system,/Do not suppress genuine unresolved procedural or source defects/);
        const response={...value,assessedScope:supplied.requiredScope};launch.format(JSON.stringify(response));launch.finish(response);
    },{role:'reviewer',inputBundle:bundle});
    assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.deepEqual(f.result.protocol.findings,[]);
    assert.deepEqual(s.all('SELECT * FROM obligations WHERE work=? ORDER BY rowid',workId),before,'Delivery never closes or rewrites retained obligations');
    assert.deepEqual(s.all('SELECT * FROM finding_dispositions ORDER BY rowid'),oldDecisions);
});
check('original Controller supplies host-proven decision subjects through the native schema and retained input',async t=>{
 useFormatterFixture(t);
    const finding={requirementId:'producer-integrity',severity:'blocking',repair:'unknown',description:'Ordinary model-authored observation, not a host diagnosis',evidence:['base:consumer.txt']};
    const raw='{"version":1,"summary":"Original duplicate-key material","findings":'+JSON.stringify([finding])+',"findings":'+JSON.stringify([finding])+',"assessedScope":[]}';
    const f=await controllerRole(t,launch=>{launch.format(raw);launch.finish(JSON.parse(raw));});
    const before=f.c.inspectChange(f.workId),ids=before.occurrences.map(o=>o.id),diagnoses=[...f.c.changeCore.diagnosisSubjectIds(f.workId)];
    assert.equal(diagnoses.length,1);assert.ok(ids.length>diagnoses.length);
    const ordinary=ids.flatMap((id,index)=>diagnoses.includes(id)?[]:[index]);
    const expected={version:3,occurrenceIds:ids,diagnosisOccurrenceIds:diagnoses,pendingOrdinaryIndexes:ordinary,blockingOrdinaryIndexes:ordinary,retentionChoices:[]};
    selectedScenario=launch=>{
        const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
        const strings=value=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
        const prompt=strings(launch.frames).find(s=>s.startsWith('Perform the assigned '));assert.ok(prompt);
        const supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]),role=prompt.match(/^Perform the assigned (\w+) task/)[1];
        supplied.context=readFixtureMetadataContext(supplied.context);
        let output={...value,assessedScope:supplied.requiredScope};
        if(role==='planner'){
            const requirement=supplied.requirements[0],plan=mixedPlan(),check=plan.verification.checks[0];
            plan.requirements=[requirement];plan.verification.checks=[check];check.guaranteeIds=[requirement.id];
            for(const item of check.cases){item.guaranteeIds=[requirement.id];item.consumerPaths=['consumer.txt'];}
            plan.verification.strategies=[{kind:'consumer-cases',requirementId:requirement.id,checkIds:[check.id]}];
            plan.verification.requiredPaths=['consumer.txt'];for(const position of plan.verification.reviewRoles)position.requiredPaths=['consumer.txt'];
            output.plan=plan;
        }else if(role==='challenger')output.alternatives=[];
        else{
            assert.equal(role,'adjudicator');assert.deepEqual(schema.properties.decisions.items.properties.occurrenceId.enum,ids);
            assert.deepEqual(schema.properties.decisions.items.then.properties.occurrenceId.enum,ids.filter(id=>!diagnoses.includes(id)));
            assert.deepEqual(supplied.context.decisionReferences,expected);
            assert.deepEqual(supplied.context.diagnosisEligibility,{version:2});
            assert.deepEqual(supplied.context.producerDiagnosticReceipt.eligible.map(e=>e.occurrenceId),diagnoses);
            output.planAccepted=false;output.decisions=ids.map(occurrenceId=>({occurrenceId,disposition:'unresolved',reason:'Independent assessment remains incomplete; no source or task acceptance',witnesses:['The retained original producer claims remain unassessed']}));
        }
        Object.assign(output,writeFixtureVerificationDomain(output,supplied.context));
        assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true);launch.format(JSON.stringify(output));launch.finish(output);
    };
    const after=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    const judges=f.c.store.all("SELECT * FROM role_launches WHERE work=? AND role='adjudicator'",f.workId);
    assert.equal(judges.length,1,JSON.stringify(after.blocked));assert.equal(judges[0].status,'COMPLETE',JSON.stringify(after.blocked));
    const result=JSON.parse(f.c.store.one("SELECT data FROM role_outputs WHERE launch=? AND status='usable'",judges[0].id).data);
    assert.equal(result.protocol.planAccepted,false);assert.deepEqual(after.occurrences.map(o=>o.id),ids);
    assert.deepEqual(JSON.parse(judges[0].data).decisionReferences,expected,'Original launch retains its detached producer domain');
    assert.equal(after.execution.consumed,before.execution.consumed+3);assert.equal(after.execution.reserved,0);
    assert.ok(launches.at(-1).joined);assert.ok(scopes.every(scope=>scope.closed));
    const originalEntries=f.c.changeCore.nativeEntries.bind(f.c.changeCore);let lateDrift;
    f.c.changeCore.nativeEntries=async run=>{
        const entries=await originalEntries(run),judge=f.c.store.one("SELECT * FROM role_launches WHERE run=? AND work=? AND role='adjudicator'",run,f.workId);
        if(judge&&judge.id!==judges[0].id&&!lateDrift){const capture=JSON.parse(judge.data);assert.equal(capture.decisionReferences.version,3);capture.decisionReferences.blockingOrdinaryIndexes=[];f.c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(capture),judge.id);lateDrift=judge;}
        return entries;
    };
    try{
        const held=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.ok(lateDrift);assert.match(held.blocked.join(' '),/decision references changed/);
        assert.equal(f.c.store.one('SELECT status FROM role_launches WHERE id=?',lateDrift.id).status,'UNUSABLE');
        const retained=f.c.store.one('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid DESC LIMIT 1',lateDrift.id);
        assert.equal(retained.status,'unusable');assert.equal(JSON.parse(retained.raw).planAccepted,false,'Complete original formatter bytes survive the late capture refusal');
    }finally{f.c.changeCore.nativeEntries=originalEntries;}
    const beforeBirths=launches.length,originalScope=globalThis.__nativeRoleFormatScope;let changed=false;
    globalThis.__nativeRoleFormatScope=async options=>{
        const scope=await originalScope(options),judge=f.c.store.one("SELECT * FROM role_launches WHERE work=? AND role='adjudicator' ORDER BY rowid DESC LIMIT 1",f.workId);
        if(judge&&judge.id!==judges[0].id){const capture=JSON.parse(judge.data);assert.equal(capture.decisionReferences.version,3);capture.decisionReferences.blockingOrdinaryIndexes=[];f.c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(capture),judge.id);changed=true;}
        return scope;
    };
    try{const held=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.ok(changed);assert.match(held.blocked.join(' '),/decision references changed/);assert.equal(launches.length,beforeBirths,'Capture drift cannot reach a new Native producer');}
    finally{globalThis.__nativeRoleFormatScope=originalScope;}
});

async function driveDecisionCarryProposal(t,{carrier='current-default',mode='full',afterDiagnosis,duringChallenge,retainResolved=false,sourceQualified=false,accountability=false,decisionFeedback,bodyProfile,identityProfile,newReceiverFinding=false,plannerFeedback=false}={}){
    // Historical formatter fixtures name their carrier explicitly; current-default never overrides production selection.
    if(carrier==='formatter/v1'){assert.equal(globalThis.__nativeRoleCarrier,undefined);globalThis.__nativeRoleCarrier=carrier;t.after(()=>{delete globalThis.__nativeRoleCarrier;});}
    else{assert.ok(['current-default','historical-profile7'].includes(carrier));assert.equal(globalThis.__nativeRoleCarrier,undefined);}
    const observedCarriers=[];
    const observed={requirementId:'owner-request',severity:'blocking',repair:'substantive',description:'Controlled initial BASE duty',evidence:['base:consumer.txt']};
    const f=await controllerRole(t,async launch=>{const output={...value,findings:[observed,observed]};await completeRoleFixture(launch,output);});
    assert.equal(f.launch.status,'UNUSABLE');const ids=f.c.inspectChange(f.workId).occurrences.map(o=>o.id);assert.ok(ids.length>=2);
    const freshPlanningFramesStart=globalThis.__nativeFramingCalls?.length;
    let correctedProposal;
    let retainedRow;
    if(retainResolved){
        const id=randomUUID(),occurrence=ids.shift();
        f.c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',id,occurrence,f.launch.id,'rejected',JSON.stringify({occurrenceId:occurrence,disposition:'rejected',reason:'Controlled old resolved verdict',witnesses:['base:consumer.txt']}));
        f.c.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',occurrence,state:'resolved',disposition:'rejected'}),occurrence);
        retainedRow=f.c.store.one('SELECT * FROM finding_dispositions WHERE id=?',id);
    }
    let plannerOutput,accountabilityClaim,accountabilityDisposition,judgeAttempts=0;
    selectedScenario=async launch=>{
        const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
        const prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned ')),role=prompt.match(/^Perform the assigned (\w+) task/)[1];
        const supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]);supplied.context=readFixtureMetadataContext(supplied.context);let output={...value,assessedScope:supplied.requiredScope};
        if(role==='planner'){
            const requirement=supplied.requirements[0],plan=mixedPlan(),check=plan.verification.checks[0];
            plan.requirements=[requirement];plan.verification.checks=[check];check.guaranteeIds=[requirement.id];
            for(const c of check.cases){c.guaranteeIds=[requirement.id];c.consumerPaths=['consumer.txt'];}
            plan.verification.strategies=[{kind:'consumer-cases',requirementId:requirement.id,checkIds:[check.id]}];
            plan.verification.requiredPaths=['consumer.txt'];plan.verification.reviewRoles[0].requiredPaths=['consumer.txt'];output.plan=plan;
        }else if(role==='challenger'){
            output.alternatives=[];duringChallenge?.({s:f.c.store,plannerOutput:supplied.context.plannerInputScope.outputId});
            if(decisionFeedback)output.findings=[{...observed,severity:'optional',repair:'unknown',description:'Optional proposal clarification requires explicit accounting'}];
            if(accountability)output.findings=[{...observed,severity:'optional',repair:'unknown',description:'No earlier committed disposition for the BASE duties; the current independent judge must assess them'}];
        }
        else{
            plannerOutput=supplied.context.plannerInputScope.outputId;
            if(mode==='omit')assert.ok(supplied.context.proposalApproval);
            if(sourceQualified){assert.equal(supplied.context.decisionCarry.version,3);assert.ok(supplied.context.decisionCarry.baseSourceIds.includes('base:consumer.txt'));}
            else assert.deepEqual(supplied.context.decisionCarry,{version:2});
            output={...output,planAccepted:true,
                decisions:ids.map((occurrenceId,i)=>({occurrenceId,disposition:i?'equivalent':'upheld',...(i?{equivalentTo:ids[0]}:{}),reason:'Each retained owner-request BASE duty maps independently to the unchanged owner requirement and current consumer remedy',witnesses:['base:consumer.txt'],implementation:{kind:'assign-to-plan',baselineVersion:supplied.context.baseVersion,requirementIds:supplied.context.planProposal.requirements.map(r=>r.id),...(sourceQualified?{baseSourceIds:['base:consumer.txt']}:{})}}))};
            if(retainedRow){
                assert.deepEqual(supplied.context.decisionReferences.retentionChoices,[{dispositionId:retainedRow.id,occurrenceId:retainedRow.occurrence,sha256:createHash('sha256').update(JSON.stringify(retainedRow)).digest('hex')}]);
                assert.deepEqual(JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]).properties.retainedDispositions.items.enum,[retainedRow.id]);
                output.retainedDispositions=[retainedRow.id];
            }
            if(accountability){
                accountabilityClaim=supplied.context.occurrences.find(o=>!ids.includes(o.id));assert.ok(accountabilityClaim);
                const prior=f.c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=?',accountabilityClaim.id);
                if(judgeAttempts===0)assert.deepEqual(prior,[],'No separate earlier disposition round exists');
                else{assert.deepEqual(prior,[accountabilityDisposition]);assert.ok(supplied.context.decisionReferences.retentionChoices.some(choice=>choice.dispositionId===accountabilityDisposition.id));}
                const procedural={occurrenceId:accountabilityClaim.id,disposition:'rejected',reason:'This current independent result supplies the required accounting; the absence of an earlier disposition is not a separate plan objection',witnesses:['base:consumer.txt']};
                if(judgeAttempts++===0){output.planAccepted=false;output.decisions=[procedural];}
                else output.retainedDispositions=[accountabilityDisposition.id];
            }
            if(mode==='full')output.acceptedPlan=supplied.context.planProposal;
            if(mode==='null')output.acceptedPlan=null;
            if(mode==='partial')output.acceptedPlan={intent:'Unusable partial correction'};
        }
        if(plannerFeedback&&role==='planner'){
            const system=strings([launch.frames,launch.options.args]).find(text=>text.includes('You are the assigned planner'));
            assert.ok(system);
            const direction='call gitjig_submit_role_result on its own';
            assert.ok(system.includes(direction));
            assert.ok(system.indexOf(direction)<system.indexOf('Your subject is a proposed remedy plan'));
            assert.match(system,/When supplying plan, pass a nested object with arrays/);
            assert.doesNotMatch(system,/Return exactly one RoleOutput JSON object|Otherwise use your own final assistant message/);
            const structured=writeFixtureVerificationDomain(output,supplied.context);
            const wrongShape=JSON.stringify({...structured,plan:JSON.stringify(structured.plan)});
            const refused=await submitRole(launch,wrongShape);
            assert.equal(refused.isError,true);
            assert.match(JSON.stringify(refused),/plan must be an object/);
            const rejected=writeFixtureVerificationDomain(structuredClone(output),supplied.context);
            rejected.plan.verification.checks[0].cases=rejected.plan.verification.checks[0].cases.filter(item=>item.kind==='healthy');
            const feedback=await submitRole(launch,JSON.stringify(rejected));
            assert.equal(feedback.isError,true);
            const diagnostic=JSON.stringify(feedback);
            assert.match(diagnostic,/consumer-case-adverse-missing/);
            assert.match(diagnostic,/canonical-plan/);
            correctedProposal=structuredClone(output.plan);
            assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM role_launches WHERE work=?',f.workId).n,2,
                'The planner receives feedback before an independent role is allocated');
            assert.equal(f.c.inspectChange(f.workId).planVersion,null);
        }else if(plannerFeedback){
            assert.deepEqual(supplied.context.planProposal,correctedProposal);
        }
        if(decisionFeedback&&role==='adjudicator'){
            const optional=supplied.context.occurrences.find(o=>!ids.includes(o.id));assert.ok(optional);
            output.decisions.push({occurrenceId:optional.id,disposition:'upheld',reason:'The optional clarification is accounted for without an implementation duty',witnesses:decisionFeedback==='evidence'?[]:['Original proposal and exact optional concern'],implementation:decisionFeedback==='evidence'?{kind:'none'}:{kind:'assign-to-plan',baselineVersion:supplied.context.baseVersion,requirementIds:supplied.context.planProposal.requirements.map(r=>r.id)}});
            const before=f.c.store.all('SELECT * FROM finding_dispositions');
            const rejected=await submitRole(launch,JSON.stringify(writeFixtureVerificationDomain(output,supplied.context)));
            assert.equal(rejected.isError,true);assert.match(JSON.stringify(rejected),decisionFeedback==='evidence'?/DECISION_EVIDENCE/:/DECISION_ACCOUNTING/);
            assert.deepEqual(f.c.store.all('SELECT * FROM finding_dispositions'),before,'Rejected provisional submission commits no dispositions');
            output.decisions.at(-1).witnesses=['The complete proposal already states the required verification paths'];
            output.decisions.at(-1).implementation={kind:'none'};
        }
        if(newReceiverFinding&&role==='adjudicator')output.findings=[{...observed,severity:'optional',repair:'mechanical',description:'New receiver claim outside the original subject domain needs independent judgment'}];
        const formatted=launch.options.args.includes('--json-schema'),submitted=launch.tools.some(tool=>tool.name==='gitjig_submit_role_result');observedCarriers.push({role,version:formatted?1:submitted?3:2});
        Object.assign(output,writeFixtureVerificationDomain(output,supplied.context));
        if(formatted){
            const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
            assert.equal(new Ajv2020({strict:false}).compile(schema)(output),role!=='adjudicator'||!['null','partial'].includes(mode));
            launch.format(JSON.stringify(output));launch.finish(output);
        }else{assert.ok(['current-default','historical-profile7'].includes(carrier));assert.ok(['planner','challenger','adjudicator'].includes(role));assert.equal(launch.tools.some(tool=>tool.name==='StructuredOutput'),false);await completeRoleFixture(launch,output);}
    };
    const core=f.c.changeCore,s=f.c.store;
    if(afterDiagnosis){const original=core.prevalidateDiagnoses.bind(core);core.prevalidateDiagnoses=async(...args)=>{const proofs=await original(...args);afterDiagnosis({core,s,plannerOutput});return proofs;};}
    const originalRole=core.role;
    const originalSupport=core.verificationSupport;
    if(carrier==='historical-profile7'){
        // Capture the old declared recipe before dispatch, never rewrite stored rows.
        core.verificationSupport=function(...args){const support=originalSupport.apply(this,args);return {...support,capability:{...support.capability,version:7}};};
        const dispatch=core.role;
        core.role=async function(options,role,context,...rest){
            assert.equal(globalThis.__nativeRoleCarrier,undefined);
            globalThis.__nativeRoleCarrier=role==='challenger'?'assistant-json/v1':'formatter/v1';
            try{return await dispatch.call(this,options,role,context,...rest);}finally{delete globalThis.__nativeRoleCarrier;}
        };
    }
    if(sourceQualified||bodyProfile!==undefined||identityProfile!==undefined)core.role=function(options,role,context,...rest){return originalRole.call(this,options,role,role==='adjudicator'&&context.stage==='planning-adjudication'?{...context,...(sourceQualified?{decisionCarryInput:{version:3}}:{}),...(bodyProfile!==undefined?{findingBodyInput:{version:bodyProfile}}:{}),...(identityProfile!==undefined?{metadataIdentityInput:{version:identityProfile}}:{})}:context,...rest)};
    try{
        const oldOutputs=plannerFeedback ? s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id) : null;
        const births=launches.length;
        let result=await f.c.driveChange({workId:f.workId,model,maximumSteps:1}),priorRefusal;
        if(plannerFeedback){
            assert.equal(launches.length-births,3);
            assert.equal(result.execution.consumed-f.outcome.execution.consumed,3);
            assert.equal(result.resolution.consumed-f.outcome.resolution.consumed,2);
            assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),oldOutputs);
        }
        if(accountability){
            assert.equal(result.phase,'BLOCKED');assert.equal(result.planVersion,null);assert.equal(judgeAttempts,1);
            const recorded=s.all('SELECT * FROM finding_dispositions WHERE occurrence=?',accountabilityClaim.id);assert.equal(recorded.length,1);accountabilityDisposition=recorded[0];assert.equal(accountabilityDisposition.status,'rejected');
            for(const id of ids){assert.equal(s.one('SELECT COUNT(*) AS n FROM finding_dispositions WHERE occurrence=?',id).n,0);assert.ok(core.pending(f.workId).some(item=>item.occurrence===id||item.id===id));}
            const declined=core.row(f.workId);assert.equal(declined.plan,null);assert.equal(declined.verification,null);assert.equal(declined.candidate,null);
            priorRefusal=s.one("SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role='adjudicator' AND o.status='usable' ORDER BY o.rowid DESC LIMIT 1",f.workId);
            assert.equal(JSON.parse(priorRefusal.data).protocol.planAccepted,false);assert.equal(accountabilityDisposition.launch,priorRefusal.launch);
            const existing=s.all('SELECT id,role FROM role_launches WHERE work=? ORDER BY rowid',f.workId);
            result=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
            const added=s.all('SELECT id,role FROM role_launches WHERE work=? ORDER BY rowid',f.workId).slice(existing.length);assert.deepEqual(added.map(l=>l.role),['adjudicator'],'Usable P/C prefix needs only a fresh current independent decision');
            assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',priorRefusal.id),priorRefusal);
            assert.equal(judgeAttempts,2);
        }
        return{...f,ids,core,s,result,retainedRow,accountabilityClaim,accountabilityDisposition,priorRefusal,observedCarriers,freshPlanningFramesStart};
    }finally{if(sourceQualified||bodyProfile!==undefined||identityProfile!==undefined||carrier==='historical-profile7')core.role=originalRole;if(carrier==='historical-profile7')core.verificationSupport=originalSupport;}
}
function assertDecisionCarryPlan(f){
    const {core,s,result,ids}=f;assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.equal(result.reviewReady,false);
    const state=core.row(f.workId),plan=core.version(state.plan),original=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",plan.data.decisionLaunch),protocol=JSON.parse(original.data).protocol;
    assert.deepEqual(plan.data.implementationCarries.map(c=>c.occurrenceId),ids);assert.equal(protocol.implementationCarries,undefined);assert.equal(protocol.implementationCarryGroups,undefined);assert.deepEqual(protocol.decisions.filter(d=>d.implementation?.kind==='assign-to-plan').map(d=>d.occurrenceId),ids);
    for(const id of ids){const occurrence=s.one('SELECT * FROM finding_occurrences WHERE id=?',id);assert.equal(core.carriedBaseline(f.workId,occurrence),state.base);assert.throws(()=>core.repairedProof(f.workId,occurrence,[]),/changed candidate/);}
    assert.equal(core.pending(f.workId).filter(o=>o.kind==='finding').length,ids.length);return{state,plan,protocol};
}
check('same-work Controller adopts the corrected original planner submission through independent P/C/J',async t=>{
    const f=await driveDecisionCarryProposal(t,{plannerFeedback:true});
    const {plan}=assertDecisionCarryPlan(f);
    assert.deepEqual(f.observedCarriers,[{role:'planner',version:3},{role:'challenger',version:3},{role:'adjudicator',version:3}]);
    const roster=f.s.all('SELECT id,role,status FROM role_launches WHERE work=? ORDER BY rowid',f.workId);
    assert.deepEqual(roster.map(row=>[row.role,row.status]),[['planner','UNUSABLE'],['planner','COMPLETE'],['challenger','COMPLETE'],['adjudicator','COMPLETE']]);
    assert.deepEqual(roster.slice(1).map(row=>row.id),[plan.data.authorLaunch,plan.data.challengeLaunch,plan.data.decisionLaunch]);
    assert.deepEqual(plan.data.plan.verification.checks[0].cases.map(item=>item.kind),['healthy','adverse']);
});
for(const decisionFeedback of ['evidence','accounting'])check('current Controller accepts corrected '+decisionFeedback+' in the original judge query before plan adoption',async t=>{
 const f=await driveDecisionCarryProposal(t,{decisionFeedback});
 const {plan,protocol}=assertDecisionCarryPlan(f);
 const optional=protocol.decisions.find(d=>d.implementation?.kind==='none');assert.ok(optional);
 assert.equal(f.s.one('SELECT COUNT(*) AS n FROM finding_dispositions WHERE occurrence=?',optional.occurrenceId).n,1);
 assert.equal(f.core.pending(f.workId).some(o=>o.id===optional.occurrenceId||o.occurrence===optional.occurrenceId),false);
 assert.equal(f.s.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role='adjudicator'",f.workId).n,1);
 assert.equal(plan.data.decisionLaunch,f.s.one('SELECT launch FROM finding_dispositions WHERE occurrence=?',optional.occurrenceId).launch);
});
check('fresh planning pending intake does not bypass Controller post-harvest receiver census',async t=>{
 const f=await driveDecisionCarryProposal(t,{newReceiverFinding:true}),{s,core}=f;
 assert.equal(f.result.phase,'BLOCKED');assert.equal(f.result.planVersion,null);assert.match(f.result.blocked.join(' '),/Raw occurrence unaccounted/);
 const row=s.one("SELECT f.* FROM finding_occurrences f JOIN role_launches l ON l.id=json_extract(f.data,'$.launchId') WHERE f.work=? AND l.role='adjudicator' AND json_extract(f.data,'$.finding.description')=?",f.workId,'New receiver claim outside the original subject domain needs independent judgment');
 assert.ok(row);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',row.id).data).state,'pending');assert.equal(s.all('SELECT * FROM finding_dispositions WHERE occurrence=?',row.id).length,0);
 for(const original of f.ids)assert.equal(s.all('SELECT * FROM finding_dispositions WHERE occurrence=?',original).length,1,'Validated original-domain judgments remain committed');
 assert.equal(core.row(f.workId).candidate,null);assert.equal(core.row(f.workId).verification,null);
});
for(const carrier of ['current-default','formatter/v1','historical-profile7'])check('planning source restore retains exact current or historical carriers after cold reopen: '+carrier,async t=>{
 assert.equal(globalThis.__nativeFramingCalls,undefined);globalThis.__nativeFramingCalls=[];t.after(()=>{delete globalThis.__nativeFramingCalls;});
 const f=await driveDecisionCarryProposal(t,{carrier});assertDecisionCarryPlan(f);
 assert.deepEqual(f.observedCarriers,['planner','challenger','adjudicator'].map(role=>({role,version:carrier==='current-default'?3:carrier==='historical-profile7'&&role==='challenger'?2:1})));
 const plan=f.core.version(f.result.planVersion),ids=[plan.data.authorLaunch,plan.data.challengeLaunch,plan.data.decisionLaunch];
 for(const [role,id]of [['planner',plan.data.authorLaunch],['challenger',plan.data.challengeLaunch],['adjudicator',plan.data.decisionLaunch]]){
  const frames=globalThis.__nativeFramingCalls.slice(f.freshPlanningFramesStart).filter(frame=>frame.role===role);
  assert.ok(frames.some(frame=>frame.id==='preallocation-estimate'));
  assert.ok(frames.some(frame=>frame.id===id));
  assert.ok(frames.every(frame=>frame.version===(carrier==='current-default'?3:carrier==='historical-profile7'&&role==='challenger'?2:1)),'Preallocation and dispatch must select the same original carrier');
  for(const frame of frames){
   assert.match(frame.systemPrompt,/The model request limit for this role is 16/);
   assert.match(frame.systemPrompt,/The Native query turn limit is 16/);
  }
 }
 const selected=ids.map(id=>{
  const launch=f.s.one('SELECT * FROM role_launches WHERE id=?',id),metadata=JSON.parse(launch.data),run=JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?',launch.run).data),output=f.s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",id),source=JSON.parse(output.data);
  const entries=parseSessionEntries(fs.readFileSync(run.historyRef,'utf8')),intent=entries.find(entry=>entry.customType===nativeRoleEntries.intent).data.request;
  assert.equal(intent.version,carrier==='current-default'?3:carrier==='historical-profile7'&&launch.role==='challenger'?2:1);
  assert.equal(metadata.planningVerificationProfile.version,carrier==='historical-profile7'?7:12);
  assert.equal(readSelectedRoleOutput(entries,{entryId:source.nativeEntryId,sessionId:run.nativeSessionId,launchId:id,role:launch.role,stage:metadata.stage,checkpointLeafId:run.nativeCheckpoint.leafId,nativeIntent:metadata.nativeRoleIntent},source.nativeSource),output.raw);
  return {launch,output};
 });
 const budgets=f.s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),launchCount=launches.length;
 await f.c.close();delete globalThis.__nativeRoleCarrier;
 const cold=await initializeController({installationHome:appHome});
 try{
  cold.changeCore.restoreAcceptedPlan(f.workId);
  assert.equal(cold.inspectChange(f.workId).phase,'PLAN_READY');
  assert.deepEqual(cold.store.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),budgets);
  for(const row of selected){assert.deepEqual(cold.store.one('SELECT * FROM role_launches WHERE id=?',row.launch.id),row.launch);assert.deepEqual(cold.store.one('SELECT * FROM role_outputs WHERE id=?',row.output.id),row.output);}
  assert.equal(launches.length,launchCount,'A cold source read must not replace an original query');
 }finally{await cold.close();}
});
check('original Controller adopts decision-local explicit members and later rederives each from the retained native judgment',async t=>{
    assertDecisionCarryPlan(await driveDecisionCarryProposal(t,{carrier:'formatter/v1'}));
});
check('original Controller authenticates source-qualified Native planning and rederives exact BASE receipts',async t=>{
 const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',sourceQualified:true}),{core,s,ids,result}=f;
 assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.equal(result.reviewReady,false);
 const state=core.row(f.workId),plan=core.version(state.plan),{proofs,assertCurrent}=await core.prevalidateRetainedBaseClassifications(f.workId);assertCurrent();assert.equal(proofs.size,ids.length);assert.equal(plan.data.implementationCarryProfile.version,3);
 const output=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",plan.data.decisionLaunch),metadata=JSON.parse(output.data);assert.equal(metadata.nativeSource.kind,'claude-sdk-formatter/v1');
 for(const id of ids){const occurrence=s.one('SELECT * FROM finding_occurrences WHERE id=?',id);assert.throws(()=>core.carriedBaseline(f.workId,occurrence),/freshly reauthenticated/);assert.equal(core.carriedBaseline(f.workId,occurrence,proofs.get(id)),state.base);assert.deepEqual(proofs.get(id).sources.map(source=>source.sourceId),['base:consumer.txt']);}
 assert.equal(core.pending(f.workId).filter(o=>o.kind==='finding').length,ids.length,'Classification preserves every original pending duty; this control does not execute checks/review');
});
check('retained Native planning bytes must still match their original formatter digest after decoded metadata drift',async t=>{
 const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',mode:'omit'}),{plan}=assertDecisionCarryPlan(f),{core,s}=f;
 const output=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",plan.data.decisionLaunch),metadata=JSON.parse(output.data),occurrence=s.one('SELECT * FROM finding_occurrences WHERE id=?',f.ids[0]);
 assert.equal(metadata.nativeSource.kind,'claude-sdk-formatter/v1');assert.equal(metadata.nativeSource.rawDigest,sha(output.raw));
 assert.ok(Object.hasOwn(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',plan.data.decisionLaunch).data),'nativeRoleIntent'));
 for(const source of [undefined,null,{}, {...metadata.nativeSource,rawDigest:'0'.repeat(64)}]){
  const changedMetadata={...metadata,nativeSource:source};
  s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(changedMetadata),output.id);
  assert.throws(()=>core.carriedBaseline(f.workId,occurrence),/Original retained planning output/);
  assert.throws(()=>core.restoreAcceptedPlan(f.workId),/Original retained planning output/);
  assert.throws(()=>core.strategies(f.workId),/Original retained planning output/);
 }
 s.run('UPDATE role_outputs SET data=? WHERE id=?',output.data,output.id);
 const changed=JSON.parse(output.raw);changed.summary+=' Changed retained interpretation.';
 s.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?',JSON.stringify(changed),JSON.stringify({...metadata,protocol:changed}),output.id);
 assert.throws(()=>core.carriedBaseline(f.workId,occurrence),/Original retained planning output/);
 assert.throws(()=>core.restoreAcceptedPlan(f.workId),/Original retained planning output/);
  assert.throws(()=>core.strategies(f.workId),/Original retained planning output/);
 s.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?',output.raw,output.data,output.id);
 assert.equal(core.carriedBaseline(f.workId,occurrence),core.row(f.workId).base);assert.doesNotThrow(()=>core.restoreAcceptedPlan(f.workId));assert.deepEqual(core.strategies(f.workId),plan.data.plan.verification.strategies);
});
check('owned SDK formatter preserves exact old-row references alongside current per-member assignments',async t=>{
    const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',retainResolved:true}),{protocol}=assertDecisionCarryPlan(f);
    assert.deepEqual(protocol.retainedDispositions,[f.retainedRow.id]);
    assert.deepEqual(f.s.one('SELECT * FROM finding_dispositions WHERE id=?',f.retainedRow.id),f.retainedRow);
    assert.equal(f.s.all('SELECT * FROM finding_dispositions WHERE occurrence=?',f.retainedRow.occurrence).length,1);
});
check('bound proposal omission survives actual Controller strategy, carry and accepted-checkpoint rereads',async t=>{
    const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',mode:'omit'}),{plan,protocol}=assertDecisionCarryPlan(f),{core,s}=f;
    assert.equal(Object.hasOwn(protocol,'acceptedPlan'),false);assert.deepEqual(core.strategies(f.workId),plan.data.plan.verification.strategies);assert.doesNotThrow(()=>core.restoreAcceptedPlan(f.workId));
    const judgment=s.one('SELECT * FROM role_launches WHERE id=?',plan.data.decisionLaunch),saved=judgment.data,metadata=JSON.parse(saved);
    metadata.proposalApproval.plannerOutputId='foreign-output';s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(metadata),judgment.id);
    assert.throws(()=>core.strategies(f.workId),/approval|planner/);assert.throws(()=>core.restoreAcceptedPlan(f.workId),/approval|planner/);
    const noDeclaration=JSON.parse(saved);delete noDeclaration.proposalApproval;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(noDeclaration),judgment.id);
    assert.throws(()=>core.strategies(f.workId),/planning producer|Plan repair adoption receipt differs/);assert.throws(()=>core.restoreAcceptedPlan(f.workId));
    s.run('UPDATE role_launches SET data=? WHERE id=?',saved,judgment.id);assert.deepEqual(core.strategies(f.workId),plan.data.plan.verification.strategies);
});
check('later carry, strategy and checkpoint readers preserve the original captured grammar',async t=>{
 const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',mode:'omit'}),{plan}=assertDecisionCarryPlan(f),{core,s}=f;
 const judgment=s.one('SELECT * FROM role_launches WHERE id=?',plan.data.decisionLaunch),saved=judgment.data;
 const output=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judgment.id),originalBytes=JSON.stringify(output),occurrence=s.one('SELECT * FROM finding_occurrences WHERE id=?',f.ids[0]);
 for(const mutate of [m=>{delete m.decisionCarry;},m=>{m.decisionCarry={version:1};},m=>{m.stage='review-adjudication';}]){
  const metadata=JSON.parse(saved);mutate(metadata);s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(metadata),judgment.id);
  assert.throws(()=>core.carriedBaseline(f.workId,occurrence));assert.throws(()=>core.strategies(f.workId));assert.throws(()=>core.restoreAcceptedPlan(f.workId));
  assert.equal(JSON.stringify(s.one('SELECT * FROM role_outputs WHERE id=?',output.id)),originalBytes);
 }
 s.run('UPDATE role_launches SET data=? WHERE id=?',saved,judgment.id);assert.equal(core.carriedBaseline(f.workId,occurrence),core.row(f.workId).base);assert.deepEqual(core.strategies(f.workId),plan.data.plan.verification.strategies);assert.doesNotThrow(()=>core.restoreAcceptedPlan(f.workId));
});

for(const mode of ['null','partial'])check('a present '+mode+' amendment cannot acquire Controller fallback standing',async t=>{
    const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',mode});assert.equal(f.result.phase,'BLOCKED');assert.equal(f.core.row(f.workId).plan,null);assert.equal(f.result.reviewReady,false);
    const judges=f.s.all("SELECT * FROM role_launches WHERE work=? AND role='adjudicator'",f.workId);assert.equal(judges.length,1);assert.equal(judges[0].status,'UNUSABLE');
});
for(const change of ['plan','summary','raw-and-protocol','run-epoch','run-launch','input-census','selected-entry'])check('selected planner '+change+' drift after diagnosis await refuses bound approval before disposition commit',async t=>{
    const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',mode:'omit',afterDiagnosis({s,plannerOutput}){
        const row=s.one('SELECT * FROM role_outputs WHERE id=?',plannerOutput),raw=JSON.parse(row.raw),metadata=JSON.parse(row.data);
        if(change==='plan')raw.plan.approach='Changed after adjudication input was captured';
        if(change==='summary'||change==='raw-and-protocol')raw.summary='Changed non-plan producer claim after capture';
        if(change==='raw-and-protocol')metadata.protocol.summary=raw.summary;
        if(change==='selected-entry')metadata.nativeEntryId='other-entry';
        if(['run-epoch','run-launch','input-census'].includes(change)){
            const launch=s.one('SELECT * FROM role_launches WHERE id=?',row.launch),origin=JSON.parse(launch.data);
            if(change==='input-census'){origin.inputScope.occurrenceIds=[];s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(origin),launch.id);}
            else if(change==='run-epoch')s.run('UPDATE runs SET epoch=epoch+1 WHERE id=?',launch.run);
            else {const run=s.one('SELECT data FROM runs WHERE id=?',launch.run),data=JSON.parse(run.data);data.launchId='other-launch';s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(data),launch.run);}
        }
        s.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?',JSON.stringify(raw),JSON.stringify(metadata),plannerOutput);
    }});
    assert.equal(f.result.phase,'BLOCKED');assert.equal(f.core.row(f.workId).plan,null);assert.equal(f.s.all('SELECT * FROM finding_dispositions').filter(d=>f.ids.includes(d.occurrence)).length,0);
    assert.ok(f.result.blocked.some(message=>message.includes('planner/input correspondence')||message.includes('planning handoff')||message.includes('input scope/output provenance')),JSON.stringify(f.result.blocked));
});

check('fresh planner drift during C cannot fund a J even when a full amendment would be supplied',async t=>{
    const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',mode:'full',duringChallenge({s,plannerOutput}){
        const row=s.one('SELECT raw FROM role_outputs WHERE id=?',plannerOutput),raw=JSON.parse(row.raw);raw.summary='Changed while independent challenge was running';s.run('UPDATE role_outputs SET raw=? WHERE id=?',JSON.stringify(raw),plannerOutput);
    }});
    assert.equal(f.result.phase,'BLOCKED');assert.equal(f.core.row(f.workId).plan,null);
    assert.equal(f.s.all("SELECT * FROM role_launches WHERE work=? AND role='adjudicator'",f.workId).length,0);
});

check('same selected Native terminal JSON representation creates one final finding and keeps both raw views',async t=>{
    const finding={requirementId:'owner-request',severity:'blocking',repair:'unknown',description:'One received final observation',evidence:['base:consumer.txt']};
    const output={...value,outcome:'findings',findings:[finding]},raw=JSON.stringify(output,null,2),compact=JSON.stringify(output);
    const f=await controllerRole(t,launch=>{launch.format(raw);launch.finish(output,{result:compact});},'reviewer');
    const all=f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===finding.description);
    assert.equal(all.length,1,'One proven final source must not create a terminal-text copy finding');
    const entries=await f.c.changeCore.nativeEntries(f.run.id),intent=entries.find(e=>e.customType===nativeRoleEntries.intent),materials=nativeRoleMaterial(entries,intent.id).materials;
    assert.ok(materials.some(m=>m.selector==='result-text'&&m.raw===compact));assert.ok(materials.some(m=>m.selector==='formatter-arguments'&&m.raw===raw));
    const selected=f.c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",f.launch.id);assert.equal(selected.raw,raw);assert.equal(all[0].output,selected.id);
});

check('a strict valid large selected role stays supported beyond malformed literal node limits',async t=>{
    const observed={requirementId:'a',severity:'blocking',repair:'unknown',description:'a',evidence:['a','b']},output={...value,outcome:'findings',findings:Array.from({length:1024},()=>({...observed}))},raw=JSON.stringify(output);
    const {parseRoleOutput}=await load('workflow/protocol.js'),{roleMaterialFindings}=await load('controller/role-material-findings.js');
    assert.ok(parseRoleOutput(raw,'reviewer').value);assert.equal(roleMaterialFindings(raw).complete,false);
    const f=await controllerRole(t,launch=>{launch.format(raw);launch.finish(output,{result:raw});},'reviewer');
    assert.equal(f.launch.status,'COMPLETE',JSON.stringify(f.outcome.blocked));
    assert.equal(f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.requirementId==='a').length,1024);
    assert.equal(f.c.store.one('SELECT data FROM obligations WHERE id=?',`raw-incomplete-${f.launch.id}-native-material`),undefined);
    const core=f.c.changeCore,s=f.c.store,entries=await core.nativeEntries(f.run.id),final=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",f.launch.id),meta=JSON.parse(final.data),rd=JSON.parse(f.run.data);
    const material=nativeRoleMaterial(entries,meta.nativeSource.intentEntryId).materials.find(m=>m.selector==='result-text'),{raw:materialRaw,...source}=material;
    // Reconstruct the older flat grouped result representation in this fixture.
    core.collect(f.workId,f.launch.id,{...meta,role:'reviewer',rawFinal:materialRaw,protocol:null,nativeEntryId:material.sourceEntryId,harvestedFindings:output.findings,
        materialSources:[{...source,rawSha256:createHash('sha256').update(materialRaw).digest('hex'),rawUtf8Bytes:Buffer.byteLength(materialRaw)}]},false,true);
    const before=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);
    assert.equal(core.harvestEntries(f.workId,f.launch.id,'reviewer',entries,{...meta,rawFinal:raw,nativeSessionId:rd.nativeSessionId,nativeCheckpoint:rd.nativeCheckpoint},meta.nativeEntryId),true);
    assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),before);assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
});

check('a distinct large terminal role root preserves every independent claim',async t=>{
    const observed={requirementId:'a',severity:'blocking',repair:'unknown',description:'a',evidence:['a','b']},output={...value,outcome:'findings',findings:Array.from({length:1024},()=>({...observed}))},terminal={...output,summary:'A separate terminal observation'};
    const f=await controllerRole(t,launch=>{launch.format(JSON.stringify(output));launch.finish(output,{result:JSON.stringify(terminal)});},'reviewer');
    assert.equal(f.launch.status,'COMPLETE',JSON.stringify(f.outcome.blocked));
    assert.equal(f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.requirementId==='a').length,2048);
});

async function partialLargeTerminal(t){
    const selected={...value,outcome:'findings',unexpected:'Strict rejection remains original'},observed={requirementId:'a',severity:'blocking',repair:'unknown',description:'a',evidence:['a','b']},terminal={...value,outcome:'findings',findings:Array.from({length:1024},()=>({...observed}))};
    const f=await controllerRole(t,launch=>{launch.format(JSON.stringify(selected));launch.finish(selected,{result:JSON.stringify(terminal)});},'reviewer'),s=f.c.store,core=f.c.changeCore;
    assert.equal(f.launch.status,'UNUSABLE');
    const row=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id),data=JSON.parse(row.data),digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
    assert.equal(data.harvestedFindings.length,1024);
    // Disposable fixture reconstructs the prior literal profile's 1023-row
    // extraction from these exact original SDK bytes, not actual-task backfill.
    const last=s.one('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal DESC LIMIT 1',row.id);
    s.run('DELETE FROM obligations WHERE id=?',last.id);s.run('DELETE FROM finding_occurrences WHERE id=?',last.id);
    data.harvestedFindings.pop();data.materialSources.pop();
    const {findingPath,memberPath,index,...source}=data.materialSources[0],locations=data.materialSources.map(({findingPath,memberPath,index})=>({findingPath,memberPath,index}));
    data.accountingKey=digest({source,locations});s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(data),row.id);
    s.run('UPDATE budgets SET lim=consumed WHERE lineage=? AND kind=?',f.workId,'execution');
    const launch=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),ld=JSON.parse(launch.data),rd=JSON.parse(f.run.data);
    s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...ld,materialAccounting:{version:1,originalCheckpoint:rd.nativeCheckpoint,nativeSessionId:rd.nativeSessionId,...core.materialAccountingSnapshot(launch)}}),launch.id);
    return{...f,s,core,row:s.one('SELECT * FROM role_outputs WHERE id=?',row.id),source,digest,births:launches.length,budgets:s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId)};
}
check('public exhausted recovery supplements only the missing large terminal location exactly once',async t=>{
    const f=await partialLargeTerminal(t),before=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),run=f.s.one('SELECT * FROM runs WHERE id=?',f.run.id),final=f.s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    const claims=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);
    assert.equal(claims.length,before.length+1);for(const old of before)assert.deepEqual(f.s.one('SELECT * FROM finding_occurrences WHERE id=?',old.id),old);
    assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.row.id),f.row);assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',final.id),final);
    const added=f.s.one("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' AND id<>?",f.launch.id,f.row.id),metadata=JSON.parse(added.data);
    assert.equal(metadata.harvestedFindings.length,1);assert.equal(metadata.materialSources[0].index,1023);
    const outputs=f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),launch=f.s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),ld=JSON.parse(launch.data);
    // Force the shared original-history reader again, beyond cached reentry.
    ld.materialAccounting.version=1;f.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),launch.id);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.deepEqual(f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);assert.deepEqual(f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
    assert.deepEqual(f.s.one('SELECT * FROM runs WHERE id=?',f.run.id),run);assert.deepEqual(f.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),f.budgets);assert.equal(launches.length,f.births);
});
for(const kind of ['source','key','location'])check('large terminal partial recovery refuses changed original '+kind,async t=>{
    const f=await partialLargeTerminal(t),data=JSON.parse(f.row.data);
    if(kind==='source')data.materialSources[0].sourceEntryId='foreign-original';
    if(kind==='key')data.accountingKey='0'.repeat(64);
    if(kind==='location'){data.materialSources[0].index=1024;data.accountingKey=f.digest({source:f.source,locations:data.materialSources.map(({findingPath,memberPath,index})=>({findingPath,memberPath,index}))});}
    f.s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(data),f.row.id);
    const outputs=f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),launch=f.s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id);
    const after=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.match(after.blocked.join(),/Original material accounting/);
    assert.deepEqual(f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);assert.deepEqual(f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);assert.deepEqual(f.s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),launch);
    assert.deepEqual(f.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),f.budgets);assert.equal(launches.length,f.births);
});

check('a complete but invalid selected wrapper still accounts for its original nested finding',async t=>{
 useFormatterFixture(t);
    const finding={requirementId:'owner-request',severity:'blocking',repair:'unknown',description:'Nested original selected observation must survive rejection',evidence:['base:consumer.txt']};
    const output={value:{...value,findings:[finding]}},raw=JSON.stringify(output);
    // Controlled bad transport completes a formatter that violates its schema.
    // The strict role must stay rejected; literal evidence must still survive.
    const f=await controllerRole(t,launch=>{launch.format(raw);launch.finish(output);});
    assert.equal(f.launch.status,'UNUSABLE');
    const claims=f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===finding.description);
    assert.equal(claims.length,1,'Selected-source bookkeeping must not skip nested raw material');
    const outputRow=f.c.store.one('SELECT * FROM role_outputs WHERE id=?',claims[0].output),metadata=JSON.parse(outputRow.data);
    assert.equal(outputRow.status,'accounted-intermediate');assert.equal(metadata.protocol,null);assert.ok(metadata.materialSources.some(s=>s.findingPath==='/value/findings'));
    assert.ok(f.c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id));
});

for(const kind of ['independent-message','earlier-attempt','different-result','pretty-result','missing-carrier','duplicate-key'])check('terminal representation exclusion preserves independent material: '+kind,async t=>{
    const observed=finding('Retained original observation '+kind),output={...value,outcome:'findings',findings:[observed]},compact=JSON.stringify(output);
    const raw=kind==='duplicate-key'?compact.replace('"findings":[','"findings":[],"findings":['):JSON.stringify(output,null,2);
    const f=await controllerRole(t,launch=>{
        if(kind==='independent-message')launch.text(compact,'independent-'+randomUUID());
        if(kind==='earlier-attempt')launch.format(compact,{carrierError:true});
        launch.format(raw,{carrier:kind!=='missing-carrier'});
        launch.finish(output,{result:kind==='different-result'?JSON.stringify({...output,summary:'A different result'}):kind==='pretty-result'?raw:compact});
    },'reviewer');
    const claims=f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===observed.description);
    assert.ok(claims.length>=2,'An independent or unproven representation must remain separately accounted');
    if(kind==='missing-carrier'||kind==='duplicate-key')assert.equal(f.launch.status,'UNUSABLE');
    else assert.equal(f.launch.status,'COMPLETE');
});

check('invalid selected envelope preserves nested claims and its extraction hold',async t=>{
 useFormatterFixture(t);
    const observed=finding('Selected sibling nested observation'),output={value:{...value,findings:[observed]},unsupported:'unknown'};
    const f=await controllerRole(t,launch=>{launch.format(JSON.stringify(output));launch.finish(output);});
    assert.equal(f.launch.status,'UNUSABLE');
    const after=f.c.inspectChange(f.workId);
    assert.equal(after.occurrences.filter(o=>o.data.finding.description===observed.description).length,1);
    const hold=f.c.store.one('SELECT data FROM obligations WHERE id=?',`raw-incomplete-${f.launch.id}-native-material`);
    assert.equal(JSON.parse(hold.data).state,'pending');
});

check('version1 cached selected-wrapper omission is restored once without a new producer or spend',async t=>{
 useFormatterFixture(t);
    const observed=finding('Historical selected nested observation'),output={value:{...value,findings:[observed]}};
    const f=await controllerRole(t,launch=>{launch.format(JSON.stringify(output));launch.finish(output);}),s=f.c.store,core=f.c.changeCore;
    // Reconstruct the previous profile's omission only in this disposable fixture.
    s.tx(()=>{
        for(const row of s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id)){
            for(const o of s.all('SELECT id FROM finding_occurrences WHERE output=?',row.id)){s.run('DELETE FROM obligations WHERE id=?',o.id);s.run('DELETE FROM finding_occurrences WHERE id=?',o.id);}
            s.run('DELETE FROM role_outputs WHERE id=?',row.id);
        }
        const launch=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),ld=JSON.parse(launch.data),rd=JSON.parse(f.run.data);
        s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...ld,materialAccounting:{version:1,originalCheckpoint:rd.nativeCheckpoint,nativeSessionId:rd.nativeSessionId,...core.materialAccountingSnapshot(launch)}}),launch.id);
        s.run('UPDATE budgets SET lim=consumed WHERE lineage=? AND kind=?',f.workId,'execution');
    });
    const final=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id),births=launches.length,budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),run=s.one('SELECT * FROM runs WHERE id=?',f.run.id);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.equal(f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===observed.description).length,1);
    assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',final.id),final);
    assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,10);
    const outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);
    assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
    assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budgets);
    assert.deepEqual(s.one('SELECT * FROM runs WHERE id=?',f.run.id),run);assert.equal(launches.length,births);
});

for(const conflict of ['overlapping-stream','duplicate-block','stopped-stream','after-block-stop','duplicate-block-stop'])check('historical text2-hosted formatter material received-prefix conflict '+conflict+' conflict',async t=>{
    const raw=JSON.stringify({...value,plan:mixedPlan()}).slice(0,-1);
    const f=await historicalTextHostedRole(t,launch=>{
        launch.format(raw,{complete:false});
        const event=event=>launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event});
        if(conflict==='overlapping-stream')launch.format(raw,{complete:false});
        if(conflict==='duplicate-block'){
            event({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'second-formatter',name:'StructuredOutput',input:{}}});
            event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});
        }
        if(conflict==='stopped-stream')event({type:'message_stop'});
        if(conflict==='after-block-stop'||conflict==='duplicate-block-stop'){
            event({type:'content_block_stop',index:0});
            if(conflict==='after-block-stop')event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:' '}});
            else event({type:'content_block_stop',index:0});
        }
        launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:''});
    });
    assert.equal(f.launch.status,'UNUSABLE');const hold=f.c.store.one('SELECT data FROM obligations WHERE id=?',`raw-incomplete-${f.launch.id}-native-material`);
    assert.ok(hold,'A conflicted source cannot qualify for received-prefix accounting');assert.equal(JSON.parse(hold.data).state,'pending');
});

for(const kind of ['orphan-public-delta','unknown-block-index','invalid-block-index','duplicate-untracked-start','started-untracked-thinking','started-untracked-block'])check('historical text2-hosted formatter material received-prefix ownership: '+kind,async t=>{
    const raw=JSON.stringify({...value,plan:mixedPlan()}).slice(0,-1);
    const f=await historicalTextHostedRole(t,launch=>{
        const event=event=>launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event});
        if(kind==='orphan-public-delta')event({type:'content_block_delta',index:7,delta:{type:'input_json_delta',partial_json:'{"findings":['}});
        launch.format(raw,{complete:false});
        if(kind==='invalid-block-index')event({type:'content_block_start',index:'7',content_block:{type:'tool_use',id:'invalid-index',name:'Other',input:{}}});
        if(kind==='started-untracked-block'||kind==='duplicate-untracked-start')event({type:'content_block_start',index:7,content_block:{type:'tool_use',id:'other-tool',name:'Other',input:{}}});
        if(kind==='duplicate-untracked-start')event({type:'content_block_start',index:7,content_block:{type:'tool_use',id:'duplicate-tool',name:'Other',input:{}}});
        if(kind==='started-untracked-thinking')event({type:'content_block_start',index:7,content_block:{type:'thinking'}});
        if(kind!=='orphan-public-delta')event({type:'content_block_delta',index:7,delta:{type:'input_json_delta',partial_json:'{}'}});
        launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:''});
    });
    assert.equal(f.launch.status,'UNUSABLE');
    const hold=f.c.store.one('SELECT data FROM obligations WHERE id=?',`raw-incomplete-${f.launch.id}-native-material`);
    if(kind==='started-untracked-block'||kind==='started-untracked-thinking')assert.equal(hold,undefined);
    else {assert.ok(hold);assert.equal(JSON.parse(hold.data).state,'pending');}
});

check('historical text2-hosted formatter material recovery clears only its extraction hold without accepting or rerunning the producer',async t=>{
    const raw=JSON.stringify({...value,plan:mixedPlan()}).slice(0,-1);
    const f=await historicalTextHostedRole(t,launch=>{launch.format(raw,{complete:false});launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:''});});
    const core=f.c.changeCore,s=f.c.store,holdId=`raw-incomplete-${f.launch.id}-native-material`;
    assert.equal(f.launch.status,'UNUSABLE');assert.equal(s.one('SELECT data FROM obligations WHERE id=?',holdId),undefined);
    const partial=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id);
    assert.equal(partial.raw,raw);assert.equal(JSON.parse(partial.data).materialSources[0].complete,false);
    const beforeOutputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),beforeClaims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);
    // Disposable fixture reconstructs the old whole-root completeness hold/cache.
    s.tx(()=>{
        s.run('INSERT INTO obligations VALUES(?,?,?)',holdId,f.workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:f.launch.id,historyRef:JSON.parse(f.run.data).historyRef}));
        const launch=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),ld=JSON.parse(launch.data),rd=JSON.parse(f.run.data);
        s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...ld,materialAccounting:{version:2,originalCheckpoint:rd.nativeCheckpoint,nativeSessionId:rd.nativeSessionId,...core.materialAccountingSnapshot(launch)}}),launch.id);
        s.run('UPDATE budgets SET lim=consumed WHERE lineage=?',f.workId);
    });
    const births=launches.length,budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',holdId).data).state,'resolved');
    assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,10);
    assert.equal(s.one('SELECT status FROM role_launches WHERE id=?',f.launch.id).status,'UNUSABLE');
    assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),beforeOutputs);
    assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),beforeClaims);
    const after=s.all('SELECT * FROM obligations WHERE work=? ORDER BY rowid',f.workId);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.deepEqual(s.all('SELECT * FROM obligations WHERE work=? ORDER BY rowid',f.workId),after);
    assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budgets);assert.equal(launches.length,births);
    assert.equal(f.c.inspectChange(f.workId).reviewReady,false);
});

check('original Controller settles and later reads the actual native selected checkpoint and original dispatch intent',async t=>{
 useFormatterFixture(t);
    const raw='{"version":1,"summary":"Controlled duplicate diagnostic","findings":[],"findings":[],"assessedScope":[]}',f=await controllerRole(t,launch=>{launch.format(raw);launch.finish(JSON.parse(raw));});
    const output=f.c.store.one('SELECT * FROM role_outputs WHERE launch=? AND status=?',f.launch.id,'unusable'),meta=JSON.parse(output.data),ld=JSON.parse(f.launch.data),rd=JSON.parse(f.run.data);
    // Duplicate JSON members intentionally require diagnosis; source provenance is complete.
    assert.ok(meta.nativeSource,JSON.stringify(f.outcome));assert.equal(rd.nativeCheckpoint.leafId,meta.nativeEntryId);
    assert.deepEqual(f.c.inspectChange(f.workId).planningFailure,{role:'planner',launchId:f.launch.id});
    assert.deepEqual(f.c.inspectChangeActivity(f.workId).recordedPlanningFailure,{role:'planner',launchId:f.launch.id});
    assert.notEqual(ld.nativeRoleDispatchCheckpoint.leafId,rd.nativeCheckpoint.leafId);
    assert.equal(ld.nativeRoleIntent.requestDigest,meta.nativeSource.requestDigest);
    const historical=await f.c.changeCore.historicalPlanningProducer(f.workId,output.id);
    assert.equal(historical.output.raw,raw);
    const occurrence=f.c.store.one('SELECT * FROM finding_occurrences WHERE output=?',output.id);
    const diagnosis=await f.c.changeCore.diagnosisOrigin(f.workId,occurrence.id);assert.equal(diagnosis.output.raw,raw);
    const replaced={...ld,nativeRoleIntent:{...ld.nativeRoleIntent,inputDigest:'b'.repeat(64)}};
    f.c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(replaced),f.launch.id);
    await assert.rejects(()=>f.c.changeCore.historicalPlanningProducer(f.workId,output.id),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
});
check('conflicting original SDK identities retain both claims and cannot roll back Controller settlement',async t=>{
    const uuid=randomUUID(),claim=description=>JSON.stringify({...value,findings:[finding(description)]});
    const f=await controllerRole(t,launch=>{
        const send=raw=>launch.send({type:'assistant',uuid,session_id:launch.sid,parent_tool_use_id:null,message:{id:'conflicting-api-message',role:'assistant',content:[{type:'text',text:raw}],stop_reason:null}});
        send(claim('FIRST conflicting UUID claim'));send(claim('SECOND conflicting UUID claim'));
        launch.format(JSON.stringify(value));launch.finish(value);
    });
    assert.equal(f.launch.status,'UNUSABLE');
    const occurrences=f.c.store.all('SELECT * FROM finding_occurrences WHERE work=?',f.workId).map(row=>JSON.parse(row.data).finding.description);
    assert.ok(occurrences.includes('FIRST conflicting UUID claim'));assert.ok(occurrences.includes('SECOND conflicting UUID claim'));
    const holds=f.c.store.all('SELECT data FROM obligations WHERE work=?',f.workId).map(row=>JSON.parse(row.data));
    assert.ok(holds.some(x=>x.kind==='raw-findings-incomplete'&&x.state==='pending'&&x.extractionIssueCount>0));
    assert.deepEqual(denied,[]);
});
for(const malformed of ['delta','text-start'])check('historical text2-hosted malformed formatter '+malformed+' preserves claims and completeness hold through Controller settlement',async t=>{
    const prior=JSON.stringify({...value,findings:[finding('Claim received before malformed delta')]});
    const f=await historicalTextHostedRole(t,launch=>{
        launch.text(prior,'prior-original-message');
        const mid='malformed-stream',event=event=>launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event});
        event({type:'message_start',message:{id:mid,role:'assistant',content:[]}});
        if(malformed==='text-start')event({type:'content_block_start',index:0,content_block:{type:'text',text:17}});
        else{
            event({type:'content_block_start',index:0,content_block:{type:'tool_use',name:'StructuredOutput',id:'malformed-formatter',input:{}}});
            event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:17}});
        }
        event({type:'content_block_stop',index:0});event({type:'message_stop'});
        launch.format(JSON.stringify(value));launch.finish(value);
    });
    assert.equal(f.launch.status,'UNUSABLE');
    const occurrences=f.c.store.all('SELECT data FROM finding_occurrences WHERE work=?',f.workId).map(row=>JSON.parse(row.data).finding.description);
    assert.ok(occurrences.includes('Claim received before malformed delta'));
    const holds=f.c.store.all('SELECT data FROM obligations WHERE work=?',f.workId).map(row=>JSON.parse(row.data));
    assert.ok(holds.some(x=>x.kind==='raw-findings-incomplete'&&x.state==='pending'&&x.extractionIssueCount>0));
});
check('malformed optional reproduction remains unverified and permits same-work recovery after controlled independent disposition',async t=>{
    const claim={...finding('Unsupported optional reproduction declaration'),severity:'optional',reproduction:{toolCallId:'T1',command:'node check.cjs',assertions:null}};
    const raw=JSON.stringify({...value,findings:[claim]}),f=await controllerRole(t,launch=>{launch.format(raw);launch.finish(JSON.parse(raw));},'reviewer');
    const occurrence=f.c.store.all('SELECT * FROM finding_occurrences WHERE work=?',f.workId).find(row=>JSON.parse(row.data).finding.description===claim.description);
    assert.ok(occurrence);assert.equal(JSON.parse(occurrence.data).reproductionEvidence.status,'unverified');
    assert.ok(!f.c.changeCore.pending(f.workId).some(x=>x.kind==='reproduction-unresolved'&&x.occurrence===occurrence.id));
    // Controlled independent judgment only, not live reviewer/standing evidence.
    f.c.changeCore.dispositions(f.workId,f.launch.id,{decisions:[{occurrenceId:occurrence.id,disposition:'rejected',reason:'Unsupported optional declaration establishes no reproduced defect',witnesses:['original invalid declaration and preserved source']} ]});
    let reentered=0;const births=launches.length;
    f.c.changeCore.h.acquireCapacity=async()=>{reentered++;throw Error('CONTROLLED_SAME_WORK_RECOVERY_ENTRY');};
    const outcome=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.equal(reentered,1,JSON.stringify(outcome));assert.equal(outcome.workId,f.workId);assert.equal(launches.length,births);
    assert.match(outcome.blocked.join(' '),/CONTROLLED_SAME_WORK_RECOVERY_ENTRY/);
    assert.deepEqual(JSON.parse(f.c.store.one('SELECT data FROM finding_occurrences WHERE id=?',occurrence.id).data).finding,claim);
});
for(const valid of [true,false])check('original SDK outputFormat carries owned path constraints and strict guard remains independent: '+valid,async()=>{
    const protocol={...value,findings:[{...finding('Controlled reproduction declaration'),reproduction:{toolCallId:'T1',command:'node /work/check.cjs',assertions:['A'],expectationPaths:[valid?'check.cjs':'/work/check.cjs']}}]};
    const f=await produce(launch=>{
        const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
        const validate=new Ajv2020({strict:false,allErrors:true}).compile(schema);
        assert.equal(validate(protocol),valid,JSON.stringify(validate.errors));
        if(!valid)assert.ok(validate.errors.some(e=>e.keyword==='pattern'&&e.instancePath.endsWith('/expectationPaths/0')));
        // Deliberately send the invalid controlled answer too: server-side
        // schema admission never replaces the original strict root parser.
        launch.format(JSON.stringify(protocol));launch.finish(protocol);
    });
    assert.equal(f.result.usable,valid,JSON.stringify(f.result.issues));assert.ok(f.result.nativeSource);
    if(!valid)assert.match(f.result.issues.join(' '),/finding\.reproduction\.expectationPaths\[0\]/);
});
check('original duplicate arrays reach both occurrences and exact native diagnosis operand',async()=>{
    const raw='{"version":1,"summary":"Preserve duplicate claims","findings":'+JSON.stringify([finding('FIRST')])+',"findings":'+JSON.stringify([finding('SECOND')])+',"assessedScope":[]}';
    const f=await produce(launch=>{launch.format(raw);launch.finish(JSON.parse(raw));}),g=await ledger(f);
    try{
        const rows=g.store.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',g.output);
        assert.equal(rows.length,3);assert.deepEqual(rows.slice(0,2).map(row=>JSON.parse(row.data).finding.description),['FIRST','SECOND']);
        const proof=await g.core.diagnosisOrigin('W',rows[2].id);
        assert.equal(proof.output.raw,raw);assert.equal(proof.operand.materialOccurrences.length,2);
        assert.equal(proof.operand.nativeEntryId,f.result.selectedFinalEntryId);
    }finally{g.store.close();}
});
check('distinct SDK UUID claims sharing API message ID and equal text are never silently collapsed',async()=>{
    const interim=JSON.stringify({...value,findings:[finding('Same content, distinct original messages')]});
    const f=await produce(launch=>{launch.format(JSON.stringify(value),{interim:[interim,interim]});launch.finish(value);}),g=await ledger(f);
    try{
        assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
        const rows=g.store.all('SELECT * FROM finding_occurrences ORDER BY rowid');assert.equal(rows.length,2);
        assert.notEqual(rows[0].output,rows[1].output);
        assert.deepEqual(rows.map(row=>JSON.parse(row.data).finding.description),['Same content, distinct original messages','Same content, distinct original messages']);
    }finally{g.store.close();}
});
check('earlier failed formatter claims survive a later clear result in the same original query',async()=>{
    const prior=JSON.stringify({...value,findings:[finding('Earlier failed formatter claim')],unsupportedField:true});
    const f=await produce(launch=>{launch.format(prior,{carrierError:true});launch.format(JSON.stringify(value));launch.finish(value,{numTurns:2});}),g=await ledger(f);
    try{
        assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.providerRequests,1);assert.equal(f.launches.length,1);
        const terminal=f.entries.find(e=>e.id===f.result.nativeSource.resultEntryId);assert.equal(terminal.data.message.num_turns,2);
        const rows=g.store.all('SELECT * FROM finding_occurrences');assert.equal(rows.length,1);assert.match(JSON.parse(rows[0].data).finding.description,/Earlier failed/);
    }finally{g.store.close();}
});
check('interrupted trace findings remain collectable before materialization or final selection',async()=>{
    const abort=new AbortController(),raw='{"findings":'+JSON.stringify([finding('Original interrupted formatter')]);let history;
    const f=await produce(async launch=>{
        launch.format(raw,{complete:false});
        for(let i=0;i<100&&!fs.readFileSync(history,'utf8').includes('Original interrupted formatter');i++)await new Promise(resolve=>setImmediate(resolve));
        assert.match(fs.readFileSync(history,'utf8'),/Original interrupted formatter/,'Abort only after original evidence was actually received');
        abort.abort();
    },{signal:abort.signal,onHistory:ref=>{history=ref;}});
    assert.equal(f.result.usable,false);assert.equal(f.result.terminal,'aborted');
    const beforeFinalization=f.entries.filter(e=>e.customType!==nativeRoleEntries.material&&e.customType!==nativeRoleEntries.final);
    const g=await ledger({...f,entries:beforeFinalization});
    try{assert.equal(g.store.all('SELECT * FROM finding_occurrences').length,1);}finally{g.store.close();}
});

after(async()=>{
    await owner.close();assert.deepEqual(denied,[]);assert.ok(launches.every(v=>v.joined));
    if(!retainedFailure && (previousCase?.passed ?? true))fs.rmSync(root,{recursive:true,force:true});else console.error('Retained original native-format evidence: '+root);
});

function preserveExportPlan(){return {intent:'Preserve export2',requirements:[{id:'R1',text:'Preserve export2',source:'owner-request'}],approach:'Retain existing export',simplerAlternative:'No source edit',factualSources:['base:consumer.cjs'],ambiguities:[],verification:{checks:[{id:'value',guaranteeIds:['R1'],command:'node consumer.cjs',assertions:['two'],timeoutMs:1000,fixturePaths:['consumer.cjs'],expectationPaths:[],cases:['healthy','adverse'].map(kind=>({id:kind,kind,guaranteeIds:['R1'],derivation:'Controlled fixture case declaration',consumerPaths:['consumer.cjs'],input:{literalUtf8:kind,fixturePaths:[]},expected:{kind:'return',value:'2'}}))}],strategies:[{requirementId:'R1',kind:'consumer-cases',checkIds:['value']}],requiredPaths:['consumer.cjs'],reviewRoles:[{key:'independent',kind:'reviewer',purpose:'Assess original export and actual evidence',requiredPaths:['consumer.cjs']}]}};}

for(const failedRole of ['challenger','adjudicator'])check('original Controller retains native formatter planning prefix after '+failedRole+' failure',async t=>{
    useFormatterFixture(t); // Seed the actual retained v1 request; resume below uses the current default.
    const c=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});
    t.after(()=>c.close());
    const source=path.join(root,'prefix-project-'+randomUUID()),projectId='prefix-'+randomUUID();fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.cjs'),'module.exports=2;\n');
    await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Preserve controlled export2 behavior.',executionLimit:10,resolutionLimit:6});
    let mode='fail';const calls=[];
    selectedScenario=async launch=>{
        const frame=launch.frames.find(f=>f.type==='user'),content=frame.message.content,text=typeof content==='string'?content:content.filter(b=>b.type==='text').map(b=>b.text).join('');
        const input=JSON.parse(text.split('\n').find(line=>line.startsWith('{"requirements":'))),role=input.context.stage==='planning'?'planner':input.context.stage==='planning-challenge'?'challenger':'adjudicator';
        calls.push({mode,role});const output={...value,assessedScope:input.requiredScope};
        if(role==='planner')output.plan=preserveExportPlan();
        if(role==='challenger')output.alternatives=['Retain existing export'];
        if(role==='adjudicator'){output.planAccepted=false;output.decisions=[];}
        if(mode==='fail'&&role===failedRole)output.unexpected='Controlled original formatter refusal';
  Object.assign(output,writeFixtureVerificationDomain(output,input.context));
        const formatted=mode==='fail';assert.equal(launch.options.args.includes('--json-schema'),formatted);
        await completeRoleFixture(launch,output);
    };
    const first=await c.planChange({workId,model});assert.equal(first.phase,'BLOCKED');
    const original=c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId),p=original.find(l=>l.role==='planner');assert.equal(p.status,'COMPLETE',JSON.stringify(first.blocked));
    const output=c.store.one('SELECT * FROM role_outputs WHERE launch=?',p.id);assert.ok(JSON.parse(output.data).nativeSource);const initial=JSON.parse(p.data).inputScope;
    delete globalThis.__nativeRoleCarrier;mode='resume';const next=await c.driveChange({workId,model,maximumSteps:1});
    assert.deepEqual(calls.filter(call=>call.mode==='resume').map(call=>call.role),failedRole==='challenger'?['challenger','adjudicator']:['adjudicator'],JSON.stringify(next.blocked));
    assert.equal(next.execution.consumed-first.execution.consumed,failedRole==='challenger'?2:1);assert.equal(next.planVersion,null);assert.equal(next.phase,'BLOCKED');
    assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM role_launches WHERE id=?',p.id).data).inputScope,initial);
    for(const l of c.store.all('SELECT * FROM role_launches WHERE work=?',workId)){const run=c.store.one('SELECT * FROM runs WHERE id=?',l.run);assert.equal(run.phase,'SETTLED');assert.equal(JSON.parse(run.data).cleanup,'removed');}
});

check('historical text2-hosted rejected formatter envelopes retain each original claim without accepting the role result',async t=>{
    const first={...value,plan:mixedPlan(),findings:[{...finding('FIRST REJECTED ENVELOPE CLAIM'),reproduction:{toolCallId:'unverified',command:'node consumer.txt',assertions:['declared'],expectationPaths:[]}}]},second={...value,plan:mixedPlan(),findings:[finding('SECOND REJECTED ENVELOPE CLAIM')]};
    const raw=[first,second].map(role=>JSON.stringify({value:role}));
    const f=await historicalTextHostedRole(t,launch=>{for(const text of raw)launch.format(text,{carrierError:true});launch.finish(undefined,{subtype:'error_max_structured_output_retries',is_error:true});});
    assert.equal(f.launch.status,'UNUSABLE');assert.equal(f.outcome.planVersion,null);assert.equal(f.outcome.candidateVersion,null);
    const outputs=f.c.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),material=outputs.filter(o=>o.status==='accounted-intermediate');
    assert.equal(material.length,2,'Both rejected original submissions must enter claim accounting');
    assert.deepEqual(material.map(o=>o.raw),raw);assert.ok(outputs.every(o=>o.status!=='usable'));
    const occurrences=f.c.store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims=occurrences.map(o=>JSON.parse(o.data).finding);
    assert.deepEqual(claims.map(c=>c.description),['FIRST REJECTED ENVELOPE CLAIM','SECOND REJECTED ENVELOPE CLAIM']);
    assert.equal(JSON.parse(occurrences[0].data).reproductionEvidence.status,'unverified');
    for(const o of material){const metadata=JSON.parse(o.data);assert.equal(metadata.protocol,null);assert.equal(metadata.nativeSource,null);assert.ok(metadata.materialSources.some(s=>s.findingPath==='/value/findings'));}
    const before={outputs,occurrences};await f.c.close();
    const reopened=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
    assert.deepEqual(reopened.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),before.outputs);assert.deepEqual(reopened.store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),before.occurrences);
});

async function legacyEnvelopeAccounting(t,{partial=false,attempts=1}={}){
    const flat={...value,plan:mixedPlan(),findings:[finding('ALREADY ACCOUNTED FLAT CLAIM')]},wrapped={value:{...value,plan:mixedPlan(),findings:[finding('MISSING HISTORICAL WRAPPED CLAIM')]}};
    const f=await historicalTextHostedRole(t,launch=>{
        if(partial)launch.send({type:'assistant',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,message:{id:'multi-'+randomUUID(),type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[flat,wrapped].map(input=>({type:'tool_use',id:'formatter-'+randomUUID(),name:'StructuredOutput',input})),stop_reason:null,usage:{input_tokens:1,output_tokens:1}}});
        else for(let i=0;i<attempts;i++)launch.format(JSON.stringify(wrapped),{carrierError:true});
        launch.finish(undefined,{subtype:'error_max_structured_output_retries',is_error:true});
    });
    const s=f.c.store,core=f.c.changeCore;
    // Reconstruct a prior installed version's ledger from original SDK bytes.
    // Only this controlled fixture is edited; this is not actual-task backfill.
    s.tx(()=>{
        const old=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id);
        for(const output of old){for(const o of s.all('SELECT id FROM finding_occurrences WHERE output=?',output.id)){s.run('DELETE FROM obligations WHERE id=?',o.id);s.run('DELETE FROM finding_occurrences WHERE id=?',o.id);}s.run('DELETE FROM role_outputs WHERE id=?',output.id);}
    });
    const entries=await core.nativeEntries(f.run.id),intent=entries.find(e=>e.type==='custom'&&e.customType===nativeRoleEntries.intent),materials=nativeRoleMaterial(entries,intent.id).materials,oldClaims=partial?[flat.findings[0]]:[];
    let legacy;
    if(partial){assert.equal(materials.length,2);assert.equal(materials[0].sourceEntryId,materials[1].sourceEntryId);
        legacy=core.collect(f.workId,f.launch.id,{role:'planner',rawFinal:JSON.stringify({format:'native-material/v1',materials}),issues:[],exposures:[],terminal:'incomplete',historyRef:JSON.parse(f.run.data).historyRef,rawFinalTruncated:false,protocol:null,events:[],providerRequests:null,nativeEntryId:materials[0].sourceEntryId,harvestedFindings:oldClaims,materialSources:materials.map(({raw,...source})=>({...source,rawSha256:createHash('sha256').update(raw).digest('hex'),rawUtf8Bytes:Buffer.byteLength(raw)}))},false,true);
    }
    s.run('UPDATE budgets SET lim=consumed WHERE lineage=? AND kind=?',f.workId,'execution');
    const state={outputs:s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims:s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),budgets:s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),run:s.one('SELECT * FROM runs WHERE id=?',f.run.id),births:launches.length};
    return{...f,core,s,state,legacy,entries,materials};
}
for(const partial of [false,true])check('public exhausted-work recovery restores original native claims exactly once; partial='+partial,async t=>{
    const f=await legacyEnvelopeAccounting(t,{partial});
    f.s.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.workId);
    f.s.run('INSERT INTO obligations VALUES(?,?,?)',`raw-incomplete-${f.launch.id}-native-material`,f.workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:f.launch.id,extractionIssueCount:1,extractionIssues:[{entryId:f.materials.at(-1).sourceEntryId,reason:'Historical unsupported envelope'}]}));
    const first=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(first.phase,'BLOCKED');assert.equal(first.planVersion,null);assert.equal(first.execution.consumed,f.state.budgets.find(b=>b.kind==='execution').consumed);assert.equal(launches.length,f.state.births);
    const claims=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);assert.deepEqual(claims.map(o=>JSON.parse(o.data).finding.description),partial?['ALREADY ACCOUNTED FLAT CLAIM','MISSING HISTORICAL WRAPPED CLAIM']:['MISSING HISTORICAL WRAPPED CLAIM']);
    for(const original of f.state.outputs)assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',original.id),original);
    for(const original of f.state.claims)assert.deepEqual(f.s.one('SELECT * FROM finding_occurrences WHERE id=?',original.id),original);
    assert.equal(JSON.parse(f.s.one('SELECT data FROM obligations WHERE id=?',`raw-incomplete-${f.launch.id}-native-material`).data).state,'resolved');
    const outputs=f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id);await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.deepEqual(f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);assert.deepEqual(f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);assert.deepEqual(f.s.one('SELECT * FROM runs WHERE id=?',f.run.id),f.state.run);assert.deepEqual(f.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),f.state.budgets);assert.equal(launches.length,f.state.births);
});
for(const failure of ['missing-history','row-drift','cancel','storage'])check('original native accounting recovery refuses before replacement: '+failure,async t=>{
    const f=await legacyEnvelopeAccounting(t),original=f.core.nativeEntries,tx=f.s.tx,abort=new AbortController();let injected=false;
    if(failure==='missing-history')fs.renameSync(JSON.parse(f.run.data).historyRef,JSON.parse(f.run.data).historyRef+'.retained');
    else f.core.nativeEntries=async function(run){const entries=await original.call(this,run);if(run===f.run.id){injected=true;if(failure==='row-drift')f.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(f.launch.data),changedDuringRead:true}),f.launch.id);if(failure==='cancel')abort.abort(Error('Controlled owner interruption'));if(failure==='storage')f.s.tx=()=>{throw Error('CONTROLLED_ACCOUNTING_STORAGE_FAILURE')};}return entries;};
    try{const after=await f.c.driveChange({workId:f.workId,model,maximumSteps:1,signal:abort.signal});assert.equal(after.planVersion,null);assert.equal(launches.length,f.state.births);assert.equal(after.execution.consumed,f.state.budgets.find(b=>b.kind==='execution').consumed);assert.equal(f.s.all('SELECT * FROM finding_occurrences WHERE work=?',f.workId).length,0);assert.ok(f.core.pending(f.workId).some(o=>o.kind==='diagnostic'));if(failure!=='missing-history')assert.equal(injected,true);}
    finally{f.core.nativeEntries=original;f.s.tx=tx;}
});

check('unusable selected native final stays the original claim source during explicit recovery',async t=>{
 useFormatterFixture(t);
    const protocol={...value,plan:mixedPlan(),findings:[finding('ORIGINAL SELECTED UNUSABLE CLAIM')],unexpected:'Host strict rejection after genuine native source selection'};
    const f=await controllerRole(t,launch=>{launch.format(JSON.stringify(protocol));launch.finish(protocol);}),s=f.c.store;
    const output=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id);assert.ok(JSON.parse(output.data).nativeSource);assert.equal(output.raw,JSON.stringify(protocol));
    s.run('UPDATE budgets SET lim=consumed WHERE lineage=? AND kind=?',f.workId,'execution');
    const before={outputs:s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims:s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),births:launches.length};assert.equal(before.claims.length,1);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(launches.length,before.births);assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),before.outputs);assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),before.claims);
});


for(const field of ['materialSources','rawFinalTruncated','omittedFindingCount','occurrence-launch','occurrence-role'])check('keyed original material recovery rejects changed coverage metadata: '+field,async t=>{
    const f=await legacyEnvelopeAccounting(t);await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    const row=f.s.one("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id),data=JSON.parse(row.data);
    if(field.startsWith('occurrence-')){
        const occurrence=f.s.one('SELECT * FROM finding_occurrences WHERE output=?',row.id),claim=JSON.parse(occurrence.data);claim[field==='occurrence-launch'?'launchId':'role']='foreign-producer';
        f.s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(claim),occurrence.id);
    }else{
        data[field]=field==='materialSources'?data.materialSources.map(s=>({...s,findingPath:'/changed-provenance'})):field==='rawFinalTruncated'?true:1;
        f.s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(data),row.id);
    }
    const outputs=f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),launch=f.s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id);
    const after=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.match(after.blocked.join(),/Original material accounting changed or is incomplete/);
    assert.deepEqual(f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);
    assert.deepEqual(f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
    assert.deepEqual(f.s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),launch);
    assert.deepEqual(f.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),f.state.budgets);assert.equal(launches.length,f.state.births);
});

check('an already accounted terminal representation is retained and validated on repeated harvest',async t=>{
    const output={...value,outcome:'findings',findings:[finding('Historical terminal observation')]},raw=JSON.stringify(output,null,2),compact=JSON.stringify(output);
    const f=await controllerRole(t,launch=>{launch.format(raw);launch.finish(output,{result:compact});},'reviewer'),s=f.c.store,core=f.c.changeCore;
    const final=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",f.launch.id),meta=JSON.parse(final.data),rd=JSON.parse(f.run.data),entries=await core.nativeEntries(f.run.id);
    const execution={...meta,rawFinal:raw,nativeSessionId:rd.nativeSessionId,nativeCheckpoint:rd.nativeCheckpoint};
    // Recreate an older extraction profile in this fixture only: it had no
    // terminal alias exclusion even though it retained the same original trace.
    core.harvestEntries(f.workId,f.launch.id,'reviewer',entries,{...execution,protocol:null},meta.nativeEntryId);
    const before=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);
    assert.equal(claims.filter(o=>JSON.parse(o.data).finding.description==='Historical terminal observation').length,2);
    for(let i=0;i<2;i++)assert.equal(core.harvestEntries(f.workId,f.launch.id,'reviewer',entries,{...execution},meta.nativeEntryId),true);
    assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),before);assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
    const historical=before.find(o=>o.status==='accounted-intermediate'),changed=JSON.parse(historical.data);changed.materialSources[0].sourceEntryId='foreign-source';s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(changed),historical.id);
    assert.throws(()=>core.harvestEntries(f.workId,f.launch.id,'reviewer',entries,{...execution},meta.nativeEntryId),/Original material accounting changed or is incomplete/);
});

check('partial storage failure rolls back recovery and equal original attempts remain distinct',async t=>{
    const f=await legacyEnvelopeAccounting(t,{attempts:2}),run=f.s.run;let inserts=0;
    f.s.run=function(sql,...args){if(sql==='INSERT INTO role_outputs VALUES(?,?,?,?,?)'&&++inserts===2)throw Error('CONTROLLED_SECOND_SOURCE_STORAGE_FAILURE');return run.call(this,sql,...args);};
    try{await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(inserts,2);assert.deepEqual(f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),f.state.outputs);assert.equal(f.s.all('SELECT * FROM finding_occurrences WHERE work=?',f.workId).length,0);assert.ok(f.core.pending(f.workId).some(o=>o.kind==='diagnostic'));}
    finally{f.s.run=run;}
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});const claims=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);assert.equal(claims.length,2);assert.equal(new Set(claims.map(o=>o.id)).size,2);assert.equal(new Set(claims.map(o=>JSON.parse(o.data).finding.description)).size,1);assert.equal(launches.length,f.state.births);
});

check('extraction receipt detects changed original producer instead of skipping current validation',async t=>{
    const f=await legacyEnvelopeAccounting(t);await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    const before=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),rd=JSON.parse(f.state.run.data);rd.nativeCheckpoint.sha256='a'.repeat(64);f.s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(rd),f.run.id);
    const original=f.core.nativeEntries;let reads=0;f.core.nativeEntries=async function(id){reads++;return original.call(this,id)};
    try{const after=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(reads,1);assert.match(after.blocked.join(),/checkpoint identity\/content lost/);assert.deepEqual(f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),before);assert.equal(launches.length,f.state.births);}
    finally{f.core.nativeEntries=original;}
});

check('historical text2-hosted unsupported formatter sibling retains raw claims and a reachable completeness hold',async t=>{
    const raw=JSON.stringify({metadata:'unsupported sibling',value:{...value,plan:mixedPlan(),findings:[finding('KNOWN CLAIM IN AMBIGUOUS ENVELOPE')]}}),f=await historicalTextHostedRole(t,launch=>{launch.format(raw,{carrierError:true});launch.finish(undefined,{subtype:'error_max_structured_output_retries',is_error:true});});
    const s=f.c.store,claims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),births=launches.length;
    assert.equal(claims.length,1);assert.ok(outputs.some(o=>o.status==='accounted-intermediate'&&o.raw===raw));assert.ok(f.c.changeCore.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'));
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);assert.ok(f.c.changeCore.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'));
});


for(const mutation of ['missing','corrupt','replaced'])check('extraction receipt revalidates file-only history drift: '+mutation,async t=>{
    const f=await legacyEnvelopeAccounting(t);await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    const file=JSON.parse(f.state.run.data).historyRef,bytes=fs.readFileSync(file),rows=f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims=f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),receipt=JSON.parse(f.s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting;
    if(mutation==='missing')fs.renameSync(file,file+'.original');else if(mutation==='corrupt')fs.writeFileSync(file,'corrupt original history');else{fs.renameSync(file,file+'.original');fs.writeFileSync(file,bytes,{mode:0o600});}
    const after=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(after.phase,'BLOCKED');assert.equal(launches.length,f.state.births);assert.deepEqual(f.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),rows);assert.deepEqual(f.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
    if(mutation==='replaced'){const restored=JSON.parse(f.s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting;assert.notEqual(restored.historyIdentity,receipt.historyIdentity);assert.equal(restored.claimsDigest,receipt.claimsDigest);}
    else assert.match(after.blocked.join(),/ENOENT|history|checkpoint/);
});

for(const variant of ['later-success','failed-primary','unattested-primary','row-drift-during-read','history-drift-after-proof'])check('historical complete formatter attempt public Controller: '+variant,async t=>{
 useFormatterFixture(t);
 const observed=finding('Preserve rejected formatter call as original evidence'),raw=JSON.stringify({value:{...value,findings:[observed]}});
 const f=await controllerRole(t,launch=>{
  launch.format(raw,{carrierError:true});
  if(variant==='failed-primary'||variant==='unattested-primary')launch.finish(undefined,{subtype:'error_max_structured_output_retries',is_error:true,malformedError:variant==='unattested-primary'});
  else{const clear={...value,alternatives:[]};launch.format(JSON.stringify(clear));launch.finish(clear);}
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 delete globalThis.__nativeRoleCarrier; // Read the original v1 operand under the real current default.
 if(variant==='failed-primary'||variant==='unattested-primary'){
  assert.equal(f.launch.status,'UNUSABLE');const primary=f.c.store.all("SELECT * FROM role_outputs WHERE launch=? AND status!='accounted-intermediate'",f.launch.id);assert.equal(primary.length,1);assert.equal(primary[0].status,'unusable');assert.equal(JSON.parse(primary[0].data).nativeSource,null);
 }
 const core=f.c.changeCore,s=f.c.store,source=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id).find(row=>row.raw===raw);
 assert.ok(source,'Rejected original formatter call must have retained accounting');
 const tables=['runs','role_launches','role_outputs','finding_occurrences','obligations','budgets'],snapshot=()=>Object.fromEntries(tables.map(name=>[name,s.all('SELECT * FROM '+name+' ORDER BY rowid')])),before=snapshot(),births=launches.length;
 const original=core.nativeEntries;
 if(variant==='row-drift-during-read')core.nativeEntries=async function(...args){const entries=await original.apply(this,args),row=s.one('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',source.id),data=JSON.parse(row.data);data.finding.description='Changed during await';s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),row.id);return entries;};
 try{
  if(variant==='row-drift-during-read'){await assert.rejects(core.historicalPlanningProducer(f.workId,source.id),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);return;}
  const proof=await core.historicalPlanningProducer(f.workId,source.id);proof.assertCurrent();
  assert.deepEqual(proof.receivedFindings,[observed]);assert.equal(proof.output.status,'accounted-intermediate');assert.equal(proof.witness.materialSource.formatterAttempt.querySettlement,variant==='unattested-primary'?'not-attested':'verified');
  if(variant==='history-drift-after-proof'){fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');assert.throws(()=>proof.assertCurrent(),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);}
  assert.deepEqual(snapshot(),before);
 }finally{core.nativeEntries=original;assert.equal(launches.length,births,'Historical proof must never start another query');}
});

async function unownedRole(t,kind,raw,request){
    const clear={...value,outcome:'clear'};
    const f=await controllerRole(t,launch=>{
        const event=kind==='text-start'?{type:'content_block_start',index:7,content_block:{type:'text',text:raw}}:
            {type:'content_block_delta',index:kind==='invalid-index'?'7':7,delta:kind==='text'?{type:'text_delta',text:raw}:{type:'input_json_delta',partial_json:raw}};
        if(kind==='rejected-formatter')launch.format(raw,{carrierError:true});else launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event});
        launch.format(JSON.stringify(clear));launch.finish(clear);
    },'reviewer',{stage:'fresh-review'},undefined,request);
    assert.equal(f.launch.status,'COMPLETE');
    return{...f,core:f.c.changeCore,s:f.c.store};
}
for(const drift of ['none','paired','unsupported-row','raw','selector','roster','dispatch','history-during-read','history-after-proof'])check('historical INITIAL view of exact unowned planning material: '+drift,async t=>{
 useFormatterFixture(t);
    const observed=finding('A separately received planning observation'),raw='{"version":1,"summary":"Interrupted planning material","findings":['+JSON.stringify(observed)+',';
    const context={stage:'planning-challenge',planProposal:mixedPlan()};let planner;
    const f=await controllerRole(t,launch=>{
        launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event:{type:'content_block_delta',index:7,delta:{type:'input_json_delta',partial_json:raw}}});
        const clear={...value,alternatives:[]};launch.format(JSON.stringify(clear));launch.finish(clear);
    },'challenger',context,drift==='paired'?async(c,workId)=>{
        selectedScenario=launch=>{const content=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof content==='string'?content:content.filter(part=>part.type==='text').map(part=>part.text).join(''),input=JSON.parse(text.split('\n').find(line=>line.startsWith('{"requirements":'))),output=writeFixtureVerificationDomain({...value,plan:context.planProposal},input.context);launch.format(JSON.stringify(output));launch.finish(output);};
        const state=await c.changeCore.operation({workId,model},'plan',async()=>{planner=await c.changeCore.role({workId,model},'planner',{stage:'planning'});return c.changeCore.inspect(workId);});
        assert.ok(planner,JSON.stringify(state.blocked));context.plannerOutput=planner.protocol;context.planProposal=planner.protocol.plan;
    }:undefined);
    const s=f.c.store,core=f.c.changeCore,source=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id).find(row=>JSON.parse(row.data).materialAssessment);
    assert.ok(source);assert.equal(source.raw,raw);
    const metadata=JSON.parse(source.data);
    if(drift==='unsupported-row'){delete metadata.materialAssessment;s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),source.id);}
    if(drift==='raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',raw+' ',source.id);
    if(drift==='selector'){metadata.materialAssessment.source.selector='unowned-text-delta';s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),source.id);}
    if(drift==='roster'){const row=s.one('SELECT * FROM finding_occurrences WHERE output=? AND ordinal=0',source.id),data=JSON.parse(row.data);data.finding.description='Foreign claim substituted for actual raw';s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),row.id);}
    if(drift==='dispatch'){const data=JSON.parse(f.run.data);data.role='planner';s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(data),f.run.id);}
    const originalEntries=core.nativeEntries;
    if(drift==='history-during-read')core.nativeEntries=async function(...args){const entries=await originalEntries.apply(this,args);fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');return entries;};
    const tables=['runs','role_launches','role_outputs','finding_occurrences','obligations','budgets'],snapshot=()=>Object.fromEntries(tables.map(name=>[name,s.all('SELECT * FROM '+name+' ORDER BY rowid')])),before=snapshot(),births=launches.length;
    if(drift==='history-after-proof'){
        const prepared=await core.historicalPlanningOperands(f.workId,{});
        fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');
        assert.throws(()=>prepared.assertCurrent(),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);
        assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);return;
    }
    if(drift!=='none'&&drift!=='paired'){
        try{await assert.rejects(core.historicalPlanningProducer(f.workId,source.id),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);}finally{core.nativeEntries=originalEntries;}
        assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);return;
    }
    const historical=await core.historicalPlanningProducer(f.workId,source.id);
    assert.equal(historical.witness.outputId,source.id);assert.equal(historical.witness.producerStatus,'accounted-intermediate');assert.ok(historical.witness.materialSource);
    assert.equal(historical.context.stage,'planning-challenge');assert.ok(historical.witness.initialView.userEntryId);
    const projection=(await core.historicalPlanningOperands(f.workId,{})).value,ids=new Set(s.all('SELECT id FROM finding_occurrences WHERE output=?',source.id).map(o=>o.id));
    if(drift==='paired'){
        assert.equal(projection.unavailable.length,0,JSON.stringify(projection.unavailable));assert.equal(projection.links.length,ids.size);assert.equal(projection.plans.length,1);
        for(const link of projection.links){assert.ok(ids.has(link.occurrenceId));assert.equal(link.producerOutputId,source.id);assert.equal(link.plannerOutputId,planner.output);}
        const producer=projection.producers.find(row=>row.outputId===source.id);assert.ok(producer);assert.deepEqual(producer.materialSource,historical.witness.materialSource);
        const originalScope=JSON.parse(f.launch.data).inputScope;assert.deepEqual(historical.witness.initialView.occurrenceIds,originalScope.occurrenceIds);assert.equal(originalScope.occurrenceIds.length,0);assert.ok(ids.size>0,'Current received claims must not be substituted for the historical INITIAL census');
        assert.equal(projection.producers.find(row=>row.outputId===planner.output).producerStatus,'usable');
    }else{
        assert.equal(projection.unavailable.filter(row=>ids.has(row.occurrenceId)).length,ids.size);
        assert.ok(projection.unavailable.filter(row=>ids.has(row.occurrenceId)).every(row=>row.code==='HISTORICAL_PLAN_PAIR_UNAVAILABLE'),'A proved material carrier must not invent the missing original planner pair');
    }
    assert.equal(JSON.parse(source.data).protocol,null);assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);
});
for(const [layout,drift] of [['keyed','none'],['legacy','none'],['keyed','subset'],['keyed','location'],['legacy','source'],['legacy','raw'],['keyed','roster'],['keyed','selected-missing'],['keyed','selected-duplicate'],['keyed','selected-raw'],['keyed','selected-during-read'],['legacy','selected-after-proof'],['keyed','selected-duplicate-after-proof'],['legacy','history-during-read']])check('historical result-text INITIAL view '+layout+': '+drift,async t=>{
 useFormatterFixture(t);
    const findings=[finding('First complete result-text observation'),finding('Second complete result-text observation')],raw=JSON.stringify({...value,alternatives:[],findings}),context={stage:'planning-challenge',planProposal:mixedPlan()};let planner;
    const f=await controllerRole(t,launch=>{const clear={...value,alternatives:[]};launch.format(JSON.stringify(clear));launch.finish(clear,{result:raw});},'challenger',context,async(c,workId)=>{
        selectedScenario=launch=>{const content=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof content==='string'?content:content.filter(part=>part.type==='text').map(part=>part.text).join(''),input=JSON.parse(text.split('\n').find(line=>line.startsWith('{"requirements":'))),output=writeFixtureVerificationDomain({...value,plan:context.planProposal},input.context);launch.format(JSON.stringify(output));launch.finish(output);};
        await c.changeCore.operation({workId,model},'plan',async()=>{planner=await c.changeCore.role({workId,model},'planner',{stage:'planning'});return c.changeCore.inspect(workId);});context.plannerOutput=planner.protocol;context.planProposal=planner.protocol.plan;
    });
    delete globalThis.__nativeRoleCarrier; // Historical source reads must not rely on the fixture override.
    const s=f.c.store,core=f.c.changeCore,source=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id).find(row=>row.raw===raw),metadata=JSON.parse(source.data);
    assert.equal(metadata.materialAssessment,undefined);assert.equal(metadata.materialSources[0].selector,'result-text');
    if(layout==='legacy'){
        // Reconstruct the original whole-root receipt layout in this private
        // fixture only; the Native result, raw claims and occurrence rows stay real.
        delete metadata.accountingKey;const {findingPath,memberPath,index,...originalSource}=metadata.materialSources[0];metadata.materialSources=[originalSource];s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),source.id);
    }
    const selected=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",f.launch.id);let otherOutput;
    if(drift==='subset'){
        // Preserve both actually received claims in distinct exact location
        // receipts. This is a controlled historical layout, not new collection.
        const subset=position=>{const material=metadata.materialSources[position],{findingPath,memberPath,index,...originalSource}=material,locations=[{findingPath,memberPath,index}];return {...metadata,harvestedFindings:[findings[position]],materialSources:[material],accountingKey:sha(JSON.stringify({source:originalSource,locations}))};};
        otherOutput=randomUUID();s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',otherOutput,source.launch,raw,'accounted-intermediate',JSON.stringify(subset(0)));
        s.run('UPDATE finding_occurrences SET output=? WHERE output=? AND ordinal=0',otherOutput,source.id);s.run('UPDATE finding_occurrences SET ordinal=0 WHERE output=? AND ordinal=1',source.id);
        s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(subset(1)),source.id);
    }
    if(drift==='location'){metadata.materialSources[0].index=999;s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),source.id);}
    if(drift==='source'){metadata.materialSources[0].nativeSessionId='foreign-native-session';s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),source.id);}
    if(drift==='raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',raw+' ',source.id);
    if(drift==='roster'){const row=s.one('SELECT * FROM finding_occurrences WHERE output=? AND ordinal=0',source.id),data=JSON.parse(row.data);data.finding.description='Unreceived replacement claim';s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),row.id);}
    if(drift==='selected-missing')s.run('UPDATE role_outputs SET status=? WHERE id=?','accounted-intermediate',selected.id);
    if(drift==='selected-duplicate')s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',randomUUID(),selected.launch,selected.raw,selected.status,selected.data);
    if(drift==='selected-raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',selected.raw+' ',selected.id);
    const tables=['runs','role_launches','role_outputs','finding_occurrences','obligations','budgets'],snapshot=()=>Object.fromEntries(tables.map(name=>[name,s.all('SELECT * FROM '+name+' ORDER BY rowid')])),before=snapshot(),births=launches.length;
    if(drift==='selected-after-proof'||drift==='selected-duplicate-after-proof'){
        const prepared=await core.historicalPlanningOperands(f.workId,{});
        if(drift==='selected-after-proof'){
            s.run('UPDATE role_outputs SET raw=? WHERE id=?',selected.raw+' ',selected.id);before.role_outputs.find(row=>row.id===selected.id).raw+=' ';
        }else{
            const extra=Object.assign(Object.create(Object.getPrototypeOf(selected)),selected,{id:randomUUID()});s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',extra.id,extra.launch,extra.raw,extra.status,extra.data);before.role_outputs.push(extra);
        }
        assert.throws(()=>prepared.assertCurrent(),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);return;
    }
    if(!['none','subset'].includes(drift)){
        const original=core.nativeEntries;let injected=false;
        if(drift==='selected-during-read'||drift==='history-during-read')core.nativeEntries=async function(...args){const entries=await original.apply(this,args);injected=true;if(drift==='selected-during-read')s.run('UPDATE role_outputs SET raw=? WHERE id=?',selected.raw+' ',selected.id);else fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');return entries;};
        try{await assert.rejects(core.historicalPlanningProducer(f.workId,source.id),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);}finally{core.nativeEntries=original;}
        if(drift==='selected-during-read'){assert.ok(injected);before.role_outputs.find(row=>row.id===selected.id).raw+=' ';}
        if(drift==='history-during-read')assert.ok(injected);
        assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);return;
    }
    const historical=await core.historicalPlanningProducer(f.workId,source.id),projection=(await core.historicalPlanningOperands(f.workId,{})).value;
    assert.deepEqual(historical.receivedFindings,drift==='subset'?[findings[1]]:findings);assert.equal(historical.witness.materialSource.corroboratingOutputId,selected.id);
    assert.equal(projection.unavailable.length,0,JSON.stringify(projection.unavailable));assert.equal(projection.links.length,2);assert.equal(projection.plans.length,1);assert.equal(projection.producers.length,drift==='subset'?3:2);
    for(const link of projection.links){assert.ok([source.id,otherOutput].includes(link.producerOutputId));assert.equal(link.plannerOutputId,planner.output);}
    if(drift==='subset')assert.equal(historical.witness.materialSource.claimLocations[0].index,1,'Local ordinal zero must retain the original raw index rather than expand the whole result');
    assert.deepEqual(historical.witness.initialView.occurrenceIds,JSON.parse(f.launch.data).inputScope.occurrenceIds);assert.equal(historical.witness.initialView.occurrenceIds.length,0);
    assert.equal(s.one('SELECT status FROM role_outputs WHERE id=?',source.id).status,'accounted-intermediate');assert.equal(JSON.parse(s.one('SELECT data FROM role_outputs WHERE id=?',source.id).data).protocol,null);
    assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);
});
for(const kind of ['json','text','text-start','invalid-index'])check('unowned original '+kind+' claims survive a selected clear formatter',async t=>{
    const observed=finding('Unowned original closed observation '+kind),raw=JSON.stringify({...value,findings:[observed]}),f=await unownedRole(t,kind,raw);
    const occurrences=f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===observed.description);assert.equal(occurrences.length,1);
    const source=f.s.one('SELECT * FROM role_outputs WHERE id=?',occurrences[0].output),metadata=JSON.parse(source.data);assert.equal(source.raw,raw);assert.equal(source.status,'accounted-intermediate');
    assert.ok(metadata.materialSources[0].selector.startsWith('unowned-'));assert.ok(f.core.pending(f.workId).some(o=>o.id===occurrences[0].id));assert.equal(f.core.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'),false);
    const selected=f.s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",f.launch.id);assert.equal(JSON.parse(selected.raw).outcome,'clear');
});
check('public exhausted reentry supplements a historical COMPLETE source once without rewriting selected output or charge',async t=>{
    const observed=finding('Historical unowned observation'),raw=JSON.stringify({...value,findings:[observed]}),f=await unownedRole(t,'json',raw),{s,core}=f;
    const selected=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",f.launch.id);
    // Only this disposable fixture reconstructs the old missing coverage.
    s.tx(()=>{
        for(const row of s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id)){
            for(const o of s.all('SELECT id FROM finding_occurrences WHERE output=?',row.id)){s.run('DELETE FROM obligations WHERE id=?',o.id);s.run('DELETE FROM finding_occurrences WHERE id=?',o.id);}s.run('DELETE FROM role_outputs WHERE id=?',row.id);
        }
        const launch=s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id),d=JSON.parse(launch.data);d.materialAccounting.version=3;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(d),f.launch.id);
        s.run('UPDATE budgets SET lim=consumed WHERE lineage=(SELECT lineage FROM works WHERE id=?)',f.workId);
    });
    const births=launches.length,budgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId);
    for(let attempt=0;attempt<2;attempt++){
        await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(launches.length,births);
        assert.equal(f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===observed.description).length,1);
        assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',selected.id),selected);assert.equal(s.one('SELECT status FROM role_launches WHERE id=?',f.launch.id).status,'COMPLETE');
        assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),budgets);
    }
    assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,10);
});
async function driveUnownedAssessment(t,afterDiagnosis,reject=false,{rejectedFormatter=false,forgedReceipt=false,referencedClaims=false,planRepair=false,currentCarrier=false,stoppedSubmission=false,stoppedLegacy=false,coldSource=false}={}){
    const observed=finding('An unused discarded draft observation'),raw='{"version":1,"summary":"Interrupted public operand","findings":['+JSON.stringify(observed)+',';
    const actualRaw=referencedClaims ? JSON.stringify({...value,findings:[observed]}).replace('"findings":'+JSON.stringify([observed]),'"findings":'+JSON.stringify([observed])+',"findings":"A public allegation requiring independent examination"') : rejectedFormatter?JSON.stringify({...value,findings:'A public allegation requiring independent examination'}):raw;
    const stopped=stoppedSubmission?await controllerRole(t,async launch=>{
        launch.format(actualRaw,{complete:false,toolName:'mcp__custom-tools__gitjig_submit_role_result'});launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event:{type:'message_stop'}});await launch.settled;
    },'planner',{stage:'planning'}):undefined;
    let f=stopped?{...stopped,core:stopped.c.changeCore,s:stopped.c.store}:await unownedRole(t,rejectedFormatter?'rejected-formatter':'json',actualRaw);
    if(stoppedLegacy){
        const {hash}=await load('controller/change-files.js'),s=f.s,row=s.all('SELECT * FROM role_outputs WHERE launch=?',f.launch.id).find(row=>JSON.parse(row.data).materialAssessment?.version===4),md=JSON.parse(row.data),source=md.materialAssessment.source;
        const suffix=s.one('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal DESC LIMIT 1',row.id);assert.equal(JSON.parse(suffix.data).finding.requirementId,'producer-integrity');
        s.run('DELETE FROM obligations WHERE id=?',suffix.id);s.run('DELETE FROM finding_occurrences WHERE id=?',suffix.id);
        delete md.materialAssessment;md.accountingKey=hash({source,locations:md.materialSources.map(({findingPath,memberPath,index})=>({findingPath,memberPath,index}))});s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(md),row.id);
        f.originalCovered=s.one('SELECT * FROM role_outputs WHERE id=?',row.id);f.originalCoveredOccurrences=s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',row.id);
        const ld=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data);delete ld.materialAccounting;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),f.launch.id);
        s.run('INSERT INTO obligations VALUES(?,?,?)','raw-incomplete-'+f.launch.id+'-native-material',f.workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:f.launch.id,historyRef:ld.historyRef,extractionIssueCount:1,extractionIssues:[{entryId:md.nativeEntryId,reason:'Original submission envelope or literal findings are incomplete or unsupported'}]}));
    }
    if(referencedClaims){
        const {hash}=await load('controller/change-files.js'),s=f.c.store;
        const row=s.all('SELECT * FROM role_outputs WHERE launch=?',f.launch.id).find(row=>JSON.parse(row.data).materialAssessment?.version===2),md=JSON.parse(row.data),source=md.materialAssessment.source;
        const diagnosis=s.one('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal DESC LIMIT 1',row.id);s.run('DELETE FROM obligations WHERE id=?',diagnosis.id);s.run('DELETE FROM finding_occurrences WHERE id=?',diagnosis.id);
        delete md.materialAssessment;md.accountingKey=hash({source,locations:md.materialSources.map(({findingPath,memberPath,index})=>({findingPath,memberPath,index}))});s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(md),row.id);
        f.originalCovered=s.one('SELECT * FROM role_outputs WHERE id=?',row.id);
        const ld=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data);ld.materialAccounting.version=9;s.run('UPDATE role_launches SET status=?,data=? WHERE id=?','UNUSABLE',JSON.stringify(ld),f.launch.id);
        const primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",f.launch.id),primaryData=JSON.parse(primary.data);primaryData.issues.push('NATIVE_FINDING_HARVEST: original material extraction unavailable');s.run('UPDATE role_outputs SET status=?,data=? WHERE id=?','unusable',JSON.stringify(primaryData),primary.id);
        s.run('INSERT INTO obligations VALUES(?,?,?)','raw-incomplete-'+f.launch.id+'-native-material',f.workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:f.launch.id,historyRef:ld.historyRef,extractionIssueCount:1,extractionIssues:[{entryId:md.nativeEntryId,reason:'Original formatter envelope or literal findings are incomplete or unsupported'}]}));
        s.run('INSERT INTO obligations VALUES(?,?,?)','diagnostic-'+f.launch.id,f.workId,JSON.stringify({kind:'diagnostic',state:'pending',launchId:f.launch.id}));
        const births=launches.length;await assert.rejects(f.c.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);assert.equal(launches.length,births);
    }
    if(coldSource){
        await f.c.close();const c=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>c.close());f={...f,c,s:c.store,core:c.changeCore};
    }
    const {core,s}=f;let before,synthetic,source;
    const captureAssessment=async()=>{
        if(source)return;before=f.c.inspectChange(f.workId);synthetic=[...core.diagnosisSubjectIds(f.workId)];assert.equal(synthetic.length,1);
        assert.equal(core.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'),false);
        source=s.one('SELECT * FROM role_outputs WHERE id=?',before.occurrences.find(o=>o.id===synthetic[0]).output);
        const origin=await core.diagnosisOrigin(f.workId,synthetic[0]);assert.ok(origin.operand.materialSource);assert.equal(source.raw,actualRaw);
    };
    if(!stoppedLegacy)await captureAssessment();
    const births=launches.length,originalHistory=JSON.parse(f.run.data).historyRef,originalHistorySha256=sha(fs.readFileSync(originalHistory));
    if(currentCarrier)delete globalThis.__nativeRoleCarrier;
    selectedScenario=async launch=>{
        await captureAssessment();
        const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
        const prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned ')),role=prompt.match(/^Perform the assigned (\w+) task/)[1],supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]);
        supplied.context=readFixtureMetadataContext(supplied.context);
        let output={...value,assessedScope:supplied.requiredScope};
        if(role==='planner'){
            const requirement=supplied.requirements[0],plan=mixedPlan(),check=plan.verification.checks[0];plan.requirements=[requirement];plan.verification.checks=[check];check.guaranteeIds=[requirement.id];
            for(const item of check.cases){item.guaranteeIds=[requirement.id];item.consumerPaths=['consumer.txt'];}
            plan.verification.strategies=[{kind:'consumer-cases',requirementId:requirement.id,checkIds:[check.id]}];plan.verification.requiredPaths=['consumer.txt'];for(const position of plan.verification.reviewRoles)position.requiredPaths=['consumer.txt'];output.plan=plan;
        }else if(role==='challenger'){
            output.alternatives=[];
            if(planRepair)output.findings=[{requirementId:supplied.context.planProposal.requirements[0].id,severity:'blocking',repair:'mechanical',description:'The planned approach needs an explicit original consumer clarification',evidence:['Original proposed approach']}];
        }
        else{
            if(rejectedFormatter)assert.ok(strings([launch.frames,launch.options.args]).some(text=>text.includes('Recipe2 rejected formatter material')));
            if(stoppedSubmission)assert.ok(strings([launch.frames,launch.options.args]).some(text=>text.includes('Recipe4 stopped submission prefix')));
            assert.equal(role,'adjudicator');const receipt=supplied.context.producerDiagnosticReceipt,eligible=receipt.eligible.find(o=>o.occurrenceId===synthetic[0]);assert.ok(eligible);
            assert.ok(supplied.context.producerDiagnostics.outputs.some(o=>o.outputId===source.id&&o.raw===actualRaw));
            output.planAccepted=true;output.decisions=before.occurrences.map(o=>o.id===synthetic[0]?reject?{occurrenceId:o.id,disposition:'rejected',reason:'Independent exact received raw assessment rejects this procedural concern',witnesses:[source.id]}:{occurrenceId:o.id,disposition:'upheld',resolution:'diagnosed',reason:'Independently assessed exact received incomplete raw; original draft claim separately dispositioned',witnesses:[source.id],diagnosis:{outputId:source.id,rawSha256:eligible.rawSha256,inputReceiptHash:forgedReceipt?'0'.repeat(64):receipt.receiptHash,materialOccurrenceIds:eligible.materialOccurrenceIds}}:{occurrenceId:o.id,disposition:'rejected',reason:'Historical unused draft observation is not a current consumer defect',witnesses:[source.id]});
        }
        if(planRepair&&role==='adjudicator'){
            const claim=supplied.context.occurrences.find(o=>!before.occurrences.some(old=>old.id===o.id));assert.ok(claim);
            const subject=supplied.context.planningRepair.subjects.find(s=>s.occurrenceId===claim.id);assert.ok(subject);
            output.acceptedPlan=structuredClone(supplied.context.planProposal);output.acceptedPlan.approach+='; explicitly clarify the original consumer validation';
            output.decisions.push({occurrenceId:claim.id,disposition:'upheld',resolution:'repaired',repair:{kind:'plan',proposalHash:subject.proposalHash},reason:'The independently accepted proposal includes the original scoped clarification',witnesses:['Original proposal and independent complete amendment']});
        }
        Object.assign(output,writeFixtureVerificationDomain(output,supplied.context));
        if(launch.options.args.includes('--json-schema')){const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true);}
        await completeRoleFixture(launch,output);
    };
    if(afterDiagnosis){const original=core.prevalidateDiagnoses.bind(core);core.prevalidateDiagnoses=async(...args)=>{const proof=await original(...args);afterDiagnosis({...f,source,synthetic,before,proofs:proof});return proof;};}
    const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});if(!afterDiagnosis)assert.equal(sha(fs.readFileSync(originalHistory)),originalHistorySha256);return{...f,result,source,synthetic,before,births};
}
for(const policy of ['raw-envelope/v1','embedded-envelope/v2'])for(const legacy of [false,true])for(const cold of [false,true])check('stopped owned prefix reaches independent diagnosis and same-work planning '+policy+' legacy='+legacy+' cold='+cold,async t=>{
 globalThis.__nativeCapturePolicy=policy;t.after(()=>{delete globalThis.__nativeCapturePolicy;});
 const f=await driveUnownedAssessment(t,undefined,false,{stoppedSubmission:true,stoppedLegacy:legacy,coldSource:cold,currentCarrier:true});
 assert.equal(f.result.phase,'PLAN_READY',JSON.stringify({blocked:f.result.blocked,fixtureError:launches.at(-1)?.error?.stack}));assert.equal(f.core.pending(f.workId).length,0);
 const original=f.s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id);assert.equal(original.status,'UNUSABLE');assert.ok(f.s.all('SELECT * FROM role_outputs WHERE launch=?',f.launch.id).every(row=>JSON.parse(row.data).nativeSource===null));
 const md=JSON.parse(f.source.data);assert.equal(md.materialAssessment.version,4);
 if(legacy){const oldWitness=await f.core.historicalPlanningProducer(f.workId,f.originalCovered.id);assert.equal(oldWitness.witness.materialSource.submissionAttempt.interpretation,'Exact complete received submission call only; no selected final, producer acceptance, diagnosis, semantic census or standing. Original query settlement proves custody, not a successful role.');assert.equal(md.materialAssessment.coveredOutputs.length,1);assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.originalCovered.id),f.originalCovered);assert.deepEqual(f.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',f.originalCovered.id),f.originalCoveredOccurrences);}
});
for(const drift of ['raw','covered-occurrence','covered-membership','history'])check('stopped owned prefix refuses drift after independent diagnosis '+drift,async t=>{
 const f=await driveUnownedAssessment(t,({s,source,originalCovered,originalCoveredOccurrences,run})=>{
  if(drift==='raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',source.raw+' ',source.id);
  if(drift==='covered-occurrence'){const row=originalCoveredOccurrences[0],data=JSON.parse(row.data);data.finding.description+=' changed after judgment';s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),row.id);}
  if(drift==='covered-membership'){const data=JSON.parse(source.data);data.materialAssessment.coveredOutputs=[];s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(data),source.id);}
  if(drift==='history')fs.appendFileSync(JSON.parse(run.data).historyRef,'\n');
 },false,{stoppedSubmission:true,stoppedLegacy:true,currentCarrier:true});
 assert.notEqual(f.result.phase,'PLAN_READY');assert.ok(f.core.pending(f.workId).some(o=>f.synthetic.includes(o.id)));
 assert.equal(f.s.all('SELECT * FROM finding_dispositions WHERE occurrence=?',f.synthetic[0]).length,0);
});
for(const forgedReceipt of [false,true])check('rejected formatter material reaches actual independent J '+(forgedReceipt?'without forged-receipt authority':'and same-work planning'),async t=>{
 useFormatterFixture(t);
 const f=await driveUnownedAssessment(t,undefined,false,{rejectedFormatter:true,forgedReceipt});
 if(forgedReceipt){assert.equal(f.result.planVersion,null);assert.notEqual(f.result.phase,'PLAN_READY');assert.ok(f.core.pending(f.workId).some(o=>o.id===f.synthetic[0]));}
 else{assert.equal(f.result.phase,'PLAN_READY',JSON.stringify(f.result.blocked));assert.equal(f.core.pending(f.workId).length,0);}
 assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.source.id),f.source);
});

for(const currentCarrier of [false,true])for(const irrelevantProof of [false,true])check('current diagnosis and plan repair commit their own proof scopes through actual Controller adoption'+(currentCarrier?' current submission':' formatter')+(irrelevantProof?' with unused proof':' without unused proof'),async t=>{
 useFormatterFixture(t);
 const f=await driveUnownedAssessment(t,irrelevantProof?({c,workId,before,proofs,synthetic})=>{
  const repair=c.inspectChange(workId).occurrences.find(o=>!before.occurrences.some(old=>old.id===o.id));assert.ok(repair);proofs.set(repair.id,proofs.get(synthetic[0]));
 }:undefined,false,{rejectedFormatter:true,planRepair:true,currentCarrier});
 assert.equal(f.result.phase,'PLAN_READY',JSON.stringify(f.result.blocked));assert.ok(f.result.planVersion);assert.equal(f.core.pending(f.workId).length,0);
 const state=f.core.row(f.workId),plan=f.core.version(state.plan);if(currentCarrier){const row=f.s.one("SELECT data FROM role_outputs WHERE launch=? AND status='usable'",plan.data.decisionLaunch);assert.equal(JSON.parse(row.data).nativeSource.kind,'claude-sdk-tool-submission/v1');}assert.ok(state.verification);assert.ok(state.data.requirementVersion);assert.equal(plan.data.planningRepairs.length,1);
 const diagnosis=f.s.all('SELECT * FROM finding_dispositions WHERE occurrence=?',f.synthetic[0]);assert.equal(diagnosis.length,1);assert.ok(JSON.parse(diagnosis[0].data).diagnosisWitness);
 const repair=plan.data.planningRepairs[0],rows=f.s.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid',repair.occurrenceId);assert.equal(rows.length,2);
 const early=JSON.parse(rows[0].data),adopted=JSON.parse(rows[1].data);assert.equal(early.repairPendingAdoption,true);assert.equal(adopted.repairWitness.planVersion,state.plan);
 for(const row of rows)assert.equal(Object.hasOwn(JSON.parse(row.data),'diagnosisWitness'),false,'Repair-only effects cannot attach unused diagnostic authority');
 assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.source.id),f.source);assert.ok(launches.slice(f.births).every(launch=>launch.joined));
});

for(const drift of ['pending-projection','missing-proof'])check('current diagnosis and plan repair refuse relevant '+drift+' drift before disposition commit',async t=>{
 useFormatterFixture(t);let ledger;
 const f=await driveUnownedAssessment(t,({s,synthetic,proofs})=>{
  ledger=s.all('SELECT * FROM finding_dispositions ORDER BY rowid');
  if(drift==='missing-proof')proofs.clear();
  else{const row=s.one('SELECT data FROM obligations WHERE id=?',synthetic[0]),data=JSON.parse(row.data);s.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({...data,state:'resolved'}),synthetic[0]);}
 },false,{rejectedFormatter:true,planRepair:true});
 assert.equal(f.result.phase,'BLOCKED');assert.equal(f.core.row(f.workId).plan,null);assert.equal(f.core.row(f.workId).verification,null);
 assert.deepEqual(f.s.all('SELECT * FROM finding_dispositions ORDER BY rowid'),ledger,'Genuine diagnosis still requires its unchanged current projection and own valid proof');
});

check('rejected formatter referenced original claims reach actual independent J once',async t=>{
 useFormatterFixture(t);
 const f=await driveUnownedAssessment(t,undefined,false,{rejectedFormatter:true,referencedClaims:true});
 assert.equal(f.result.phase,'PLAN_READY',JSON.stringify(f.result.blocked));assert.equal(f.core.pending(f.workId).length,0);
 assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.originalCovered.id),f.originalCovered);
 const occurrences=f.s.all('SELECT * FROM finding_occurrences WHERE output=?',f.originalCovered.id);assert.equal(occurrences.length,1);
 const md=JSON.parse(f.source.data);assert.equal(md.materialAssessment.coveredOutputs.length,1);assert.equal(md.harvestedFindings.length,0);
});

check('current explicit oracle inputs and BASE expected failures survive current Native submission carriers and bound J approval',async t=>{
 assert.equal(globalThis.__nativeRoleCarrier,undefined);globalThis.__nativeFramingCalls=[];t.after(()=>{delete globalThis.__nativeFramingCalls;});
 const f=await unownedRole(t,'text',JSON.stringify({...value,outcome:'clear'}),'Preserve controlled behavior and observe the original immutable BASE defect before any editing producer.');
 const schemas=new Map();
 selectedScenario=async launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned ')),role=prompt.match(/^Perform the assigned (\w+) task/)[1],supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]);supplied.context=readFixtureMetadataContext(supplied.context);assert.equal(supplied.context.planningVerificationProfile.version,12);assert.equal(schemas.has(role),false);const formatted=false;assert.equal(launch.options.args.includes('--json-schema'),formatted);const schema=formatted?JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]):JSON.parse(globalThis.__nativeFramingCalls.findLast(frame=>frame.role===role&&frame.id!=='preallocation-estimate').schema);schemas.set(role,schema);
  const output={...value,assessedScope:supplied.requiredScope};
  if(role==='planner'){
   const requirement=supplied.requirements[0],plan=mixedPlan();plan.requirements=[requirement];
   for(const check of plan.verification.checks){check.guaranteeIds=[requirement.id];for(const item of check.cases){item.guaranteeIds=[requirement.id];item.consumerPaths=['consumer.txt'];}}
   plan.verification.checks[1].baselineExpectedFailures=['concrete-subject-defect'];
   plan.verification.strategies=[{requirementId:requirement.id,kind:'all-of',parts:[{kind:'consumer-cases',checkIds:['behavior-check']},{kind:'base-execution-duty',checkId:'base-check',caseIds:['base-defect'],reviewKey:'review'}]}];plan.verification.requiredPaths=['consumer.txt'];plan.verification.reviewRoles[0].requiredPaths=['consumer.txt'];output.plan=plan;
  }else if(role==='challenger')output.alternatives=[];
  else{assert.equal(role,'adjudicator');assert.ok(supplied.context.proposalApproval);assert.deepEqual(supplied.context.planProposal.verification.checks[1].baselineExpectedFailures,['concrete-subject-defect']);output.decisions=[];output.planAccepted=true;}
  Object.assign(output,writeFixtureVerificationDomain(output,supplied.context));
  await completeRoleFixture(launch,output);
 };
 const result=await f.c.planChange({workId:f.workId,model});assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.equal(result.candidateVersion,null);assert.equal(result.checks.length,0);
 const plan=JSON.parse(f.s.one('SELECT data FROM change_versions WHERE id=?',result.planVersion).data).plan;assert.deepEqual(plan.verification.checks[1].baselineExpectedFailures,['concrete-subject-defect']);assert.equal(f.core.strategies(f.workId)[0].kind,'all-of');
 for(const role of ['planner','adjudicator']){
  const l=f.s.one('SELECT * FROM role_launches WHERE work=? AND role=? ORDER BY rowid DESC LIMIT 1',f.workId,role),o=f.s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",l.id),origin=await f.core.historicalPlanningProducer(f.workId,o.id),md=JSON.parse(o.data);assert.equal(origin.context.planningVerificationProfile.version,12);const schema=schemas.get(role);assert.ok(schema);assert.ok(JSON.stringify(schema).includes('baselineExpectedFailures'));assert.ok(schema.properties[role==='planner'?'plan':'acceptedPlan'].properties.verification.properties.checks.items.required.includes('expectationPaths'));assert.equal(createHash('sha256').update(JSON.stringify(schema)).digest('hex'),origin.ld.nativeRoleIntent.schemaDigest);
  const raw=readSelectedRoleOutput(await f.core.nativeEntries(l.run),{entryId:md.nativeEntryId,sessionId:origin.rd.nativeSessionId,launchId:l.id,role,stage:origin.ld.stage,checkpointLeafId:origin.rd.nativeCheckpoint.leafId,nativeIntent:origin.ld.nativeRoleIntent},md.nativeSource);assert.equal(raw,o.raw);
  if(role==='planner')assert.deepEqual(JSON.parse(raw).plan.verification.checks[1].baselineExpectedFailures,['concrete-subject-defect']);else{assert.equal(JSON.parse(raw).planAccepted,true);assert.equal(Object.hasOwn(JSON.parse(raw),'acceptedPlan'),false);}
 }
});

check('public owner feedback withdrawal retains exact source through independent same-work planning',async t=>{
 useFormatterFixture(t);
 const f=await unownedRole(t,'text',JSON.stringify({...value,outcome:'clear'}));
 const target=f.c.listConversations().find(view=>view.workId===f.workId);assert.ok(target);assert.equal(target.state,'IDLE');
 const before=f.c.inspectWorkAllowance(f.workId),births=launches.length;
 const text='Owner-forwarded independent review: compare expected values with the actual decoded observed strings. Correct verification without changing the requested behavior or dropping original before-edit duties.';
 const receipt=await f.c.queueConversationInput({conversationId:target.conversationId,expectedGeneration:target.generation,mode:'idle',text});
 const input=f.s.one('SELECT * FROM conversation_inputs WHERE id=?',receipt.inputId),source=f.s.one('SELECT * FROM sources WHERE id=?',receipt.sourceId),direction=f.s.one('SELECT * FROM conversation_directions WHERE conversation=? AND revision=?',target.conversationId,receipt.directionRevision),data=JSON.parse(direction.data);
 assert.equal(source.raw,text);assert.equal(input.work,f.workId);assert.equal(direction.source,receipt.sourceId);assert.equal(data.affectedWorkId,f.workId);assert.equal(data.effectHold,true);assert.equal(input.state,'QUEUED');
 assert.deepEqual(f.c.inspectWorkAllowance(f.workId).execution,before.execution);assert.deepEqual(f.c.inspectWorkAllowance(f.workId).resolution,before.resolution);assert.equal(launches.length,births);
 assert.equal(f.c.getNativeHandle(target.conversationId),null);
 const pending=f.c.inspectConversationInputs(target.conversationId).find(row=>row.inputId===receipt.inputId);
 assert.equal(pending.retryEligible,false);assert.equal(pending.withdrawEligible,true);assert.match(pending.explanation,/direction remain attached/);
 assert.throws(()=>f.c.recoverConversationInput({conversationId:target.conversationId,inputId:receipt.inputId,expectedContext:pending.fingerprint,action:'retry'}),/not safe/);
 const rejectChanged=(table,where,args,column,value)=>{
  const old=f.s.all(`SELECT * FROM ${table} WHERE ${where}`,...args);assert.ok(old.length);
  f.s.run(`UPDATE ${table} SET ${column}=? WHERE ${where}`,value,...args);
  try{const current=f.c.inspectConversationInputs(target.conversationId).find(row=>row.inputId===receipt.inputId);assert.equal(current.withdrawEligible,false);assert.throws(()=>f.c.recoverConversationInput({conversationId:target.conversationId,inputId:receipt.inputId,expectedContext:current.fingerprint,action:'withdraw'}),/not safe/);}
  finally{for(const row of old)f.s.run(`UPDATE ${table} SET ${column}=? WHERE ${table==='conversation_directions'?'conversation=? AND revision=?':'id=?'}`,row[column],...(table==='conversation_directions'?[row.conversation,row.revision]:[row.id]));}
 };
 rejectChanged('conversation_inputs','id=?',[receipt.inputId],'state','NATIVE_PENDING');
 rejectChanged('runs','id=?',[f.run.id],'phase','UNKNOWN');
 rejectChanged('runs','id=?',[f.run.id],'data',JSON.stringify({...JSON.parse(f.run.data),initialInputId:receipt.inputId}));
 rejectChanged('conversation_directions','conversation=? AND revision=?',[target.conversationId,receipt.directionRevision],'data',JSON.stringify({...data,affectedWorkId:'foreign'}));
 rejectChanged('sources','id=?',[receipt.sourceId],'raw','changed source');
 rejectChanged('capacity_leases','work=?',[f.workId],'state','ADMITTED');
 f.s.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?',JSON.stringify({...data,classification:'clarification'}),target.conversationId,receipt.directionRevision);
 try{assert.throws(()=>f.c.recoverConversationInput({conversationId:target.conversationId,inputId:receipt.inputId,expectedContext:pending.fingerprint,action:'withdraw'}),/changed/);}finally{f.s.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?',direction.data,target.conversationId,receipt.directionRevision);}
 // An operation preparing on the same task must hold recovery even though
 // this older role conversation itself is idle.
 f.core.operations.set(f.workId,{});
 try {assert.equal(f.c.inspectConversationInputs(target.conversationId).find(row=>row.inputId===receipt.inputId).withdrawEligible,false);assert.throws(()=>f.c.recoverConversationInput({conversationId:target.conversationId,inputId:receipt.inputId,expectedContext:pending.fingerprint,action:'withdraw'}),/not safe/);} finally {f.core.operations.delete(f.workId);}
 f.c.recoverConversationInput({conversationId:target.conversationId,inputId:receipt.inputId,expectedContext:pending.fingerprint,action:'withdraw'});
 assert.equal(f.c.inspectConversationInputs(target.conversationId).length,0);
 assert.equal(f.s.one('SELECT state FROM conversation_inputs WHERE id=?',receipt.inputId).state,'CONFLICTED');
 assert.deepEqual(f.s.one('SELECT * FROM sources WHERE id=?',receipt.sourceId),source);
 assert.deepEqual(f.s.one('SELECT * FROM conversation_directions WHERE conversation=? AND revision=?',target.conversationId,receipt.directionRevision),direction);
 assert.ok(f.c.interactions.impacts(f.workId).some(row=>row.input_id===receipt.inputId&&row.data.effectHold));
 const {lifecycleReasons}=await load('controller/completed-resources.js');assert.ok(!lifecycleReasons(f.s,target.conversationId).some(reason=>reason.startsWith('input:')));
 assert.deepEqual(f.c.inspectWorkAllowance(f.workId).execution,before.execution);assert.deepEqual(f.c.inspectWorkAllowance(f.workId).resolution,before.resolution);assert.equal(launches.length,births);
 await f.c.close();
 const {openController}=await load('controller/index.js');f.c=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>f.c.close());f.s=f.c.store;
 assert.equal(f.c.inspectConversationInputs(target.conversationId).length,0);assert.deepEqual(f.s.one('SELECT * FROM sources WHERE id=?',receipt.sourceId),source);assert.deepEqual(f.s.one('SELECT * FROM conversation_directions WHERE conversation=? AND revision=?',target.conversationId,receipt.directionRevision),direction);
 const retained=f.s.one('SELECT * FROM conversation_inputs WHERE id=?',receipt.inputId);assert.equal(retained.state,'CONFLICTED');assert.equal(JSON.parse(retained.data).ownerRecovery.action,'withdraw');assert.throws(()=>f.c.recoverConversationInput({conversationId:target.conversationId,inputId:receipt.inputId,expectedContext:pending.fingerprint,action:'withdraw'}),/not safe/);
 assert.deepEqual(f.c.inspectWorkAllowance(f.workId).execution,before.execution);assert.deepEqual(f.c.inspectWorkAllowance(f.workId).resolution,before.resolution);assert.equal(launches.length,births);
 // Real retained planning must still receive and independently account for
 // the withdrawn delivery's source; withdrawal is not source-fit approval.
 selectedScenario=launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned ')),role=prompt.match(/^Perform the assigned (\w+) task/)[1],supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]);
  assert.ok(supplied.context.sourceInputChain.some(row=>row.input_id===receipt.inputId&&row.text===text&&row.data.effectHold));
  supplied.context=readFixtureMetadataContext(supplied.context);
  const output={...value,assessedScope:supplied.requiredScope};
  if(role==='planner'){
   const requirement=supplied.requirements[0],plan=mixedPlan(),check=plan.verification.checks[0];plan.requirements=[requirement];plan.verification.checks=[check];check.guaranteeIds=[requirement.id];for(const item of check.cases){item.guaranteeIds=[requirement.id];item.consumerPaths=['consumer.txt'];}plan.verification.strategies=[{kind:'consumer-cases',requirementId:requirement.id,checkIds:[check.id]}];plan.verification.requiredPaths=['consumer.txt'];for(const position of plan.verification.reviewRoles)position.requiredPaths=['consumer.txt'];output.plan=plan;
  }else if(role==='challenger')output.alternatives=[];
  else{assert.equal(role,'adjudicator');output.decisions=[];output.planAccepted=true;output.inputDecisions=[{inputId:receipt.inputId,directionRevision:receipt.directionRevision,impact:'explanation',reason:'Controlled independent assessment: retained owner feedback clarifies existing verification without changing scope.',requirementIds:[supplied.requirements[0].id]}];}
  Object.assign(output,writeFixtureVerificationDomain(output,supplied.context));
  launch.format(JSON.stringify(output));launch.finish(output);
 };
 const planned=await f.c.planChange({workId:f.workId,model});assert.equal(planned.phase,'PLAN_READY',JSON.stringify(planned.blocked));
 const accounted=f.c.interactions.impacts(f.workId).find(row=>row.input_id===receipt.inputId);assert.equal(accounted.data.effectHold,false);assert.equal(accounted.data.decision.impact,'explanation');
 assert.equal(f.s.one('SELECT state FROM conversation_inputs WHERE id=?',receipt.inputId).state,'CONFLICTED');assert.deepEqual(f.s.one('SELECT * FROM sources WHERE id=?',receipt.sourceId),source);
});

check('exact ambiguous public raw reaches original independent J diagnosis and same-work planning',async t=>{
 useFormatterFixture(t);
    const f=await driveUnownedAssessment(t),{core,s,result,source,births}=f;assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.equal(launches.length,births+3);
    assert.equal(core.pending(f.workId).length,0);assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',source.id),source);assert.equal(s.one('SELECT status FROM role_launches WHERE id=?',f.launch.id).status,'COMPLETE');
    const judge=s.one("SELECT * FROM role_launches WHERE work=? AND role='adjudicator'",f.workId);assert.equal(JSON.parse(judge.data).producerDiagnosticInput.version,2);assert.equal(result.reviewReady,false);
});

for(const kind of ['json','text'])for(const foreign of [false,true])check('invalid-index '+kind+' transport alias '+(foreign?'retains unavailable source hold':'creates exactly one original duty'),async t=>{
    const observed=finding('One actual invalid-index public observation '+kind+foreign),output={...value,outcome:'findings',findings:[observed]},raw=JSON.stringify(output);
    const f=await controllerRole(t,launch=>{
        const event=event=>launch.send({type:'stream_event',uuid:randomUUID(),session_id:foreign?'foreign-original-session':launch.sid,parent_tool_use_id:null,event});
        event({type:'message_start',message:{id:'invalid-index-message'}});
        event({type:'content_block_start',index:-1,content_block:kind==='json'?{type:'tool_use',id:'invalid-index-formatter',name:'StructuredOutput',input:{}}:{type:'text',text:''}});
        event({type:'content_block_delta',index:-1,delta:kind==='json'?{type:'input_json_delta',partial_json:raw}:{type:'text_delta',text:raw}});
        event({type:'content_block_stop',index:-1});event({type:'message_stop'});
        const clear={...value,outcome:'clear'};launch.format(JSON.stringify(clear));launch.finish(clear);
    },'reviewer');
    const occurrences=f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===observed.description);
    assert.equal((await f.c.changeCore.nativeEntries(f.run.id)).filter(entry=>entry.customType===nativeRoleEntries.settlement).length,1,'Alias controls use an original settled query, not presumed proof');
    if(foreign){assert.ok(occurrences.length);assert.ok(f.c.changeCore.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'));}
    else {assert.equal(occurrences.length,1);const source=f.c.store.one('SELECT * FROM role_outputs WHERE id=?',occurrences[0].output);assert.equal(source.raw,raw);assert.equal(JSON.parse(source.data).materialSources[0].selector,kind==='json'?'formatter-arguments':'stream-text');}
});
check('retained ApplicationModels current evidence refuses stale coverage without unbound recovery or model resolution',async t=>{
    const raw=JSON.stringify({...value,findings:[finding('Read-only retained application observation')]}),f=await unownedRole(t,'json',raw),{core,s}=f;
    const models=new FixtureModels(f.c);models.install();const work=s.one('SELECT * FROM works WHERE id=?',f.workId),baseline=retainedApplicationBaseline;
    s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...JSON.parse(work.data),applicationModelBaseline:baseline}),f.workId);
    const launch=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),data=JSON.parse(launch.data);data.materialAccounting.version=3;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),launch.id);
    const rows=()=>Object.fromEntries(['works','runs','role_launches','role_outputs','finding_occurrences','obligations','budgets'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')])),before=rows(),births=launches.length;
    await assert.rejects(core.currentEvidence(f.workId),/material coverage requires same-work drive\/resume/);assert.deepEqual(rows(),before);assert.equal(launches.length,births);
});

for(const drift of ['raw','source-selector','native-history','origin-run'])check('unowned assessment '+drift+' drift after diagnosis await cannot commit dispositions',async t=>{
 useFormatterFixture(t);
    const f=await driveUnownedAssessment(t,({s,source,run})=>{
        if(drift==='raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',source.raw+' ',source.id);
        if(drift==='source-selector'){const metadata=JSON.parse(source.data);metadata.materialAssessment.source.selector='unowned-text-delta';s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),source.id);}
        if(drift==='native-history')fs.appendFileSync(JSON.parse(run.data).historyRef,'\n');
        if(drift==='origin-run'){const metadata=JSON.parse(run.data);metadata.nativeSessionId='other-session';s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(metadata),run.id);}
    });
    assert.equal(f.result.phase,'BLOCKED',JSON.stringify(f.result.blocked));assert.equal(f.core.row(f.workId).plan,null);
    assert.equal(f.s.all('SELECT * FROM finding_dispositions').filter(row=>f.before.occurrences.some(o=>o.id===row.occurrence)).length,0);
});

for(const unavailable of ['oversized','foreign-session','lossy','missing-query-attestation'])check('unavailable unowned '+unavailable+' bytes cannot gain raw assessment privilege',async t=>{
    const observed=finding('Retained unavailable public observation '+unavailable),raw=unavailable==='lossy'?'(unpaired '+String.fromCharCode(0xd800)+')':JSON.stringify({...value,findings:[observed],...(unavailable==='oversized'?{padding:'x'.repeat(129*1024)}:{})});
    const f=await controllerRole(t,launch=>{
        launch.send({type:'stream_event',uuid:randomUUID(),session_id:unavailable==='foreign-session'?'foreign-session':launch.sid,parent_tool_use_id:null,event:{type:'content_block_delta',index:7,delta:{type:'input_json_delta',partial_json:raw}}});
        if(unavailable==='missing-query-attestation')launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:'',malformedError:true});
        else {const clear={...value,outcome:'clear'};launch.format(JSON.stringify(clear));launch.finish(clear);}
    },'reviewer');
    if(unavailable==='missing-query-attestation'){
     const entries=parseSessionEntries(fs.readFileSync(JSON.parse(f.run.data).historyRef,'utf8'));
     assert.equal(entries.filter(entry=>entry.customType===nativeRoleEntries.settlement).length,0,'Explicit malformed SDK error packet cannot establish original query attestation');
    }
    assert.equal(f.launch.status,'UNUSABLE');assert.ok(f.c.changeCore.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'));
    const rows=f.c.store.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id);assert.ok(rows.length);assert.ok(rows.every(row=>!JSON.parse(row.data).materialAssessment));
    if(unavailable!=='lossy')assert.equal(f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===observed.description).length,1);
});
check('failed historical raw supplementation rolls back source duties and retries without new Native spend',async t=>{
    const observed=finding('Rollback original public observation'),raw='{"version":1,"summary":"Interrupted","findings":['+JSON.stringify(observed)+',',f=await unownedRole(t,'json',raw),{s}=f;
    s.tx(()=>{
        for(const row of s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id)){
            for(const o of s.all('SELECT id FROM finding_occurrences WHERE output=?',row.id)){s.run('DELETE FROM obligations WHERE id=?',o.id);s.run('DELETE FROM finding_occurrences WHERE id=?',o.id);}s.run('DELETE FROM role_outputs WHERE id=?',row.id);
        }
        const launch=s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id),d=JSON.parse(launch.data);d.materialAccounting.version=3;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(d),f.launch.id);
        s.run('UPDATE budgets SET lim=consumed WHERE lineage=(SELECT lineage FROM works WHERE id=?)',f.workId);
    });
    const snapshot=()=>Object.fromEntries(['role_launches','role_outputs','finding_occurrences','budgets'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')])),before=snapshot(),births=launches.length,run=s.run.bind(s);let injected=false;
    s.run=(sql,...params)=>{if(!injected&&sql.startsWith('INSERT INTO finding_occurrences')){injected=true;throw Error('injected public material storage failure');}return run(sql,...params);};
    try{const failed=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.ok(failed.blocked.some(message=>message.includes('injected public material storage failure')),JSON.stringify(failed.blocked));}finally{s.run=run;}
    assert.equal(injected,true);assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});const claims=f.c.inspectChange(f.workId).occurrences;assert.equal(claims.filter(o=>o.data.finding.description===observed.description).length,1);assert.equal(f.core.diagnosisSubjectIds(f.workId).size,1);assert.equal(launches.length,births);
    const after=snapshot();await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.deepEqual(snapshot(),after);assert.equal(launches.length,births);
});

async function deliveredPremise(t,{raw='{}',omitMaterial=false}={}){
    const f=await unownedRole(t,'json',raw),{s,core}=f,{hash}=await load('controller/change-files.js'),{caseDescriptor,compareCases}=await load('controller/check-cases.js'),r=core.row(f.workId),base=core.version(r.base),owner=s.one('SELECT * FROM works WHERE id=?',f.workId);
    // Explicit synthetic READY/check/selected-review premise, using the SAME
    // work's genuine Controller/SDK history. No engine or full readiness claim.
    const check=structuredClone(mixedPlan().verification.checks[0]);check.guaranteeIds=['R1'];check.fixturePaths=['consumer.txt'];for(const item of check.cases){item.guaranteeIds=['R1'];item.consumerPaths=['consumer.txt'];}
    const reviewId='metadata-review-'+randomUUID(),verification={checks:[check],requiredPaths:['consumer.txt'],reviewRoles:[{key:'metadata-review',kind:'reviewer',purpose:'Controlled retained READY premise',requiredPaths:['consumer.txt']}]},plan={intent:'Controlled retained source',requirements:[{id:'R1',text:'Retain controlled source',source:'owner-request'}],approach:'Retain source',simplerAlternative:'Keep the source',factualSources:['base:consumer.txt'],ambiguities:[],verification};
    const candidate=core.newVersion(f.workId,'candidate',base.artifact,{manifest:base.data.manifest,delta:{files:[],directories:{before:[],after:[]}},producer:'synthetic-not-executed'},base.hash,r.base),planId=core.newVersion(f.workId,'plan',null,{plan},hash(plan)),verificationId=core.newVersion(f.workId,'verification',null,{verification},hash(verification));
    const tuple={base:r.base,candidate,plan:planId,verification:verificationId,requirements:null,contracts:r.data.contractsVersion},historyRef=path.join(root,reviewId+'.jsonl'),protocol={...value,outcome:'clear',assessedScope:[{sourceId:'candidate:consumer.txt',startLine:1,endLine:1}]};
    s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',reviewId+'-run',f.workId,owner.epoch,owner.generation,'SETTLED','synthetic-not-executed','consumed',JSON.stringify({cleanup:'removed',historyRef,nativeSessionId:reviewId}));
    s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',reviewId,f.workId,reviewId+'-run','reviewer',owner.epoch,'COMPLETE','none',JSON.stringify({stage:'fresh-review',reviewKey:'metadata-review',purpose:verification.reviewRoles[0].purpose,requiredPaths:['consumer.txt'],inputVersions:tuple,cleanup:'removed',historyRef,nativeSessionId:reviewId}));
    s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',reviewId+'-output',reviewId,JSON.stringify(protocol),'usable',JSON.stringify({protocol,terminal:'complete',rawFinalTruncated:false,omittedFindingCount:0,issues:[],historyRef,nativeEntryId:reviewId+'-entry'}));
    const descriptor=caseDescriptor(check,core.version(candidate),tuple,reviewId+'-run'),parsed={value:{version:1,assertions:check.assertions.map(id=>({id,passed:true})),cases:descriptor.cases.map(c=>({id:c.id,inputDigest:c.inputDigest,observed:c.declaration.expected}))}};
    s.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)',randomUUID(),f.workId,reviewId+'-run',candidate,verificationId,check.id,'pass',JSON.stringify({check,caseDescriptor:descriptor,caseResults:compareCases(check,descriptor,parsed.value),parsed,cleanup:'removed',boundVersions:tuple,producer:'synthetic-not-executed'}));
    s.run('UPDATE change_state SET candidate=?,plan=?,verification=?,phase=?,data=? WHERE work=?',candidate,planId,verificationId,'REVIEW_READY',JSON.stringify({...r.data,selection:{'metadata-review':reviewId},blocked:[],nextAction:'Controlled retained READY premise'}),f.workId);
    s.run('UPDATE works SET state=? WHERE id=?','DELIVERED',f.workId);
    if(omitMaterial)s.tx(()=>{
        for(const row of s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id)){
            for(const o of s.all('SELECT id FROM finding_occurrences WHERE output=?',row.id)){s.run('DELETE FROM obligations WHERE id=?',o.id);s.run('DELETE FROM finding_occurrences WHERE id=?',o.id);}s.run('DELETE FROM role_outputs WHERE id=?',row.id);
        }
    });
    if(!omitMaterial){const view=f.c.inspectChange(f.workId);assert.equal(view.reviewReady,true,'Controlled READY premise: '+JSON.stringify({blocked:view.blocked,state:view.state,phase:view.phase,coverage:core.coverageHoldReason(f.workId),checks:core.checksCurrent(f.workId)}));}
    const ld=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data);ld.materialAccounting.version=3;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),f.launch.id);
    return{...f,tuple,originalOwner:s.one('SELECT * FROM works WHERE id=?',f.workId),originalState:s.one('SELECT * FROM change_state WHERE work=?',f.workId)};
}
check('public DELIVERED cache-only restoration preserves READY epoch judgments versions and charge',async t=>{
    const f=await deliveredPremise(t),{s}=f,births=launches.length,oldOutputs=s.all('SELECT * FROM role_outputs WHERE launch=?',f.launch.id),budgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId);
    const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(result.reviewReady,true,JSON.stringify(result.blocked));assert.equal(result.phase,'REVIEW_READY');assert.equal(launches.length,births);
    assert.deepEqual(s.one('SELECT * FROM works WHERE id=?',f.workId),f.originalOwner);assert.deepEqual(s.one('SELECT * FROM change_state WHERE work=?',f.workId),f.originalState);assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=?',f.launch.id),oldOutputs);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),budgets);
    assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,10);
});
check('restored DELIVERED claims withhold readiness before explicit same-epoch resolve admission',async t=>{
    const observed=finding('Recovered original delivered observation'),f=await deliveredPremise(t,{raw:JSON.stringify({...value,findings:[observed]}),omitMaterial:true}),{s,core}=f,births=launches.length;
    assert.equal(await core.restoreSettledRoleMaterial({workId:f.workId,model}),true);assert.equal(s.one('SELECT state FROM works WHERE id=?',f.workId).state,'DELIVERED');assert.equal(s.one('SELECT phase FROM change_state WHERE work=?',f.workId).phase,'REVIEW_READY');assert.equal(f.c.inspectChange(f.workId).reviewReady,false);assert.match(f.c.inspectChange(f.workId).blocked.join(),/Received findings/);assert.equal(core.inspectModelPrerequisites(f.workId).stage,'resolve');await assert.rejects(core.currentEvidence(f.workId),/findings incomplete/);
    let entered=0;const resolve=core.resolve.bind(core);core.resolve=async options=>{entered++;assert.equal(options.workId,f.workId);throw Error('controlled prebirth resolve admission');};
    try{await assert.rejects(f.c.driveChange({workId:f.workId,model,maximumSteps:1}),/controlled prebirth resolve admission/);}finally{core.resolve=resolve;}
    assert.equal(entered,1);assert.equal(launches.length,births);const owner=s.one('SELECT * FROM works WHERE id=?',f.workId);assert.equal(owner.state,'ACTIVE');assert.equal(owner.epoch,f.originalOwner.epoch);assert.equal(owner.generation,f.originalOwner.generation);const selected=core.row(f.workId);assert.equal(selected.data.resumeStage,'resolve');for(const key of ['base','candidate','plan','verification'])assert.equal(selected[key],f.tuple[key]);assert.equal(f.c.inspectChange(f.workId).occurrences.filter(o=>o.data.finding.description===observed.description).length,1);
});
for(const interruption of ['abort','history-drift','state-drift'])check('DELIVERED metadata '+interruption+' cannot commit late coverage or cancel original work',async t=>{
    const f=await deliveredPremise(t),{s,core}=f,abort=new AbortController(),births=launches.length,entries=core.nativeEntries.bind(core),cancel=core.h.cancel.bind(core.h);let cancellations=0;
    core.h.cancel=(...args)=>{cancellations++;return cancel(...args);};core.nativeEntries=async run=>{const result=await entries(run);if(interruption==='abort')abort.abort();if(interruption==='history-drift')fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');if(interruption==='state-drift')s.run('UPDATE works SET generation=generation+1 WHERE id=?',f.workId);return result;};
    const beforeOutputs=s.all('SELECT * FROM role_outputs WHERE launch=?',f.launch.id),budgets=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId);
    try{await assert.rejects(f.c.driveChange({workId:f.workId,model,maximumSteps:1,signal:abort.signal}),/interrupted|changed/);}finally{core.nativeEntries=entries;core.h.cancel=cancel;}
    assert.equal(cancellations,0);assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=?',f.launch.id),beforeOutputs);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',f.workId),budgets);assert.deepEqual(s.one('SELECT * FROM change_state WHERE work=?',f.workId),f.originalState);assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,3);const owner=s.one('SELECT * FROM works WHERE id=?',f.workId);assert.equal(owner.state,'DELIVERED');assert.equal(owner.epoch,f.originalOwner.epoch);assert.equal(owner.generation,f.originalOwner.generation+(interruption==='state-drift'?1:0));
});

for(const changed of ['criteria','application-binding'])check('DELIVERED '+changed+' change during coverage cannot reopen resolution',async t=>{
    const f=await deliveredPremise(t,{raw:JSON.stringify({...value,findings:[finding('Handoff source observation')]}),omitMaterial:true}),{core,s}=f,entries=core.nativeEntries.bind(core),criteria=core.workflowCriteriaHold.bind(core),births=launches.length;
    let held=false,options={workId:f.workId,model,maximumSteps:1};
    if(changed==='application-binding'){
        const models=new FixtureModels(f.c);models.install();const owner=s.one('SELECT data FROM works WHERE id=?',f.workId);s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...JSON.parse(owner.data),applicationModelBaseline:retainedApplicationBaseline}),f.workId);options={workId:f.workId,applicationModel:{version:1,baselineRevision:1},maximumSteps:1};
    }
    core.workflowCriteriaHold=work=>held?{kind:'changed',reason:'Current criteria changed during original coverage read'}:criteria(work);
    core.nativeEntries=async run=>{const result=await entries(run);if(changed==='criteria')held=true;else {const owner=s.one('SELECT data FROM works WHERE id=?',f.workId),data=JSON.parse(owner.data);data.applicationModelBaseline.revision=2;s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify(data),f.workId);}return result;};
    try{if(changed==='application-binding')await assert.rejects(f.c.driveChange(options),/work model revision changed/);else {const result=await f.c.driveChange(options);assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/Current criteria changed/);}}finally{core.nativeEntries=entries;core.workflowCriteriaHold=criteria;}
    const owner=s.one('SELECT * FROM works WHERE id=?',f.workId);assert.equal(owner.state,'DELIVERED');assert.equal(owner.epoch,f.originalOwner.epoch);assert.equal(owner.generation,f.originalOwner.generation);assert.deepEqual(s.one('SELECT * FROM change_state WHERE work=?',f.workId),f.originalState);assert.equal(launches.length,births);assert.equal(f.c.inspectChange(f.workId).reviewReady,false);
});


check('quota display never infers provider cause from plain errors or retracted events',async()=>{
 for(const kind of ['plain-error','allowed-warning','retracted','foreign-session','duplicate-event','superseded','retracted-uuid','success']){
  const f=await produce(launch=>{
   const id=randomUUID(),send=(status,session_id=launch.sid)=>launch.send({type:'rate_limit_event',rate_limit_info:{status,rateLimitType:'five_hour',resetsAt:1794020400},uuid:['duplicate-event','superseded','retracted-uuid'].includes(kind)?id:randomUUID(),session_id});
   if(kind!=='plain-error')send(kind==='allowed-warning'?'allowed_warning':'rejected',kind==='foreign-session'?'foreign-native':launch.sid);
   if(kind==='retracted')send('allowed');if(kind==='duplicate-event')send('rejected');
   if(kind==='superseded'||kind==='retracted-uuid')launch.send({type:'system',subtype:'model_refusal_fallback',uuid:randomUUID(),session_id:launch.sid,...(kind==='superseded'?{supersedes:[id]}:{retracted_message_uuids:[id]})});
   if(kind==='success'){launch.format(JSON.stringify(value));launch.finish(value);}
   else launch.send({type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,duration_ms:1,duration_api_ms:1,num_turns:1,errors:['Claude rate limit (seven_day) — resets tomorrow'],total_cost_usd:0,permission_denials:[],usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
  });
  assert.equal(f.result.providerFailure,undefined,kind);assert.ok(f.launches.every(l=>l.joined));
 }
 const f=await produce(launch=>{
  launch.send({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'five_hour'},uuid:randomUUID(),session_id:launch.sid});
  launch.send({type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,duration_ms:1,duration_api_ms:1,num_turns:1,errors:['Original short-window refusal'],total_cost_usd:0,permission_denials:[],usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
 });
 assert.equal(f.result.providerFailure?.window,'five_hour');assert.equal(f.result.providerFailure.resetsAt,undefined);
});


check('an allowed different quota window does not erase the original rejected window',async()=>{
 const f=await produce(launch=>{
  for(const [status,rateLimitType]of [['rejected','seven_day'],['allowed','five_hour']])launch.send({type:'rate_limit_event',rate_limit_info:{status,rateLimitType,resetsAt:1794020400},uuid:randomUUID(),session_id:launch.sid});
  launch.send({type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,duration_ms:1,duration_api_ms:1,num_turns:1,errors:['Original weekly refusal remains'],total_cost_usd:0,permission_denials:[],usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
 });
 assert.equal(f.result.providerFailure?.window,'seven_day');assert.match(f.result.issues.join(' '),/Original weekly refusal remains/);assert.ok(f.launches.every(l=>l.joined));
 const {NativeRoleCollector}=await load('workflow/native-role-output.js');
 // Replay this original controlled SDK trace with adverse branch order only.
 // This is a display fallback check, not a new original native settlement.
 const intentEntry=f.entries.find(e=>e.customType===nativeRoleEntries.intent),valid=f.entries.filter(e=>e.type==='custom');
 for(const move of ['late-init','late-result']){
  const entries=structuredClone(valid),init=entries.find(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='system'&&e.data.message.subtype==='init'),result=entries.find(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='result');
  const moved=move==='late-init'?init:result;entries.splice(entries.indexOf(moved),1);entries.push(moved);
  const manager={getSessionId:()=>f.result.nativeSessionId,getBranch:()=>entries,appendCustomEntry:()=>intentEntry.id};
  const collector=new NativeRoleCollector(manager,intentEntry.data.request);collector.materialize();assert.equal(collector.usageLimit(),undefined,move);
 }
});


check('normal nonplanning roles retain the same original SDK quota facet',async()=>{
 for(const [role,stage]of [['implementer','implementation'],['repairer','substantive-repair'],['reviewer','fresh-review'],['adjudicator','review-adjudication'],['confirmer','exact-nit-confirmation']]){
  const f=await produce(launch=>{
   launch.send({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'seven_day',resetsAt:1794020400},uuid:randomUUID(),session_id:launch.sid});
   launch.send({type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,duration_ms:1,duration_api_ms:1,num_turns:1,errors:['Original normal-stage quota refusal'],total_cost_usd:0,permission_denials:[],usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
  },{role,inputBundle:{...body,context:{...body.context,stage}}});
  assert.equal(f.result.usable,false);assert.equal(f.result.providerFailure?.kind,'usage-limit',role);assert.equal(f.result.providerFailure.resetsAt,1794020400);assert.ok(f.launches.every(l=>l.joined));
 }
});

for(const timeoutMs of [undefined,null])check('default role waits for completion beyond former walls: '+timeoutMs,async t=>{
    let ready;const started=new Promise(resolve=>{ready=resolve;});
    t.mock.timers.enable({apis:['setTimeout']});
    try{
        const pending=produce(launch=>ready(launch),{timeoutMs});
        const launch=await started;
        await new Promise(resolve=>setImmediate(resolve));
        t.mock.timers.tick(3600001);
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(launch.joined,false,'Elapsed time alone must not cancel a still-owned role');
        launch.format(JSON.stringify(value));launch.finish(value);
        const f=await pending;
        assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.ok(f.launches.every(l=>l.joined));
    }finally{t.mock.timers.reset();}
});

check('finite role deadlines retain explicit shorter bounds and joined partial output',async t=>{
    for(const [timeoutMs,advance] of [[300000,300001],[50,51],[600000,600001]]){
        let ready;const started=new Promise(resolve=>{ready=resolve;});
        t.mock.timers.enable({apis:['setTimeout']});
        try{
            const pending=produce(launch=>{launch.format('{"findings":[]',{complete:false});ready(launch);},{timeoutMs});
            await started;await new Promise(resolve=>setImmediate(resolve));
            t.mock.timers.tick(advance);
            const f=await pending;
            assert.equal(f.result.usable,false);assert.equal(f.result.terminal,'aborted');assert.match(f.result.issues.join(' '),/Role deadline exceeded/);
            assert.equal(f.result.providerRequests,1);assert.equal(f.checkpoints,1);assert.equal(f.result.rawFinal,null);assert.ok(f.result.nativeCheckpoint);assert.ok(f.launches.every(l=>l.joined));
            assert.ok(f.entries.some(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='stream_event'&&e.data.message.event?.delta?.partial_json==='{\"findings\":[]'));
        }finally{t.mock.timers.reset();}
    }
});

check('caller cancellation still joins a default role after long elapsed time and retains received material',async t=>{
 const controller=new AbortController();let ready;const started=new Promise(resolve=>{ready=resolve;});
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const pending=produce(launch=>{launch.format('{"findings":[]',{complete:false});ready(launch);},{timeoutMs:undefined,signal:controller.signal});
  const launch=await started;await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(3600001);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(launch.joined,false);controller.abort(new Error('Owner cancelled the continuing role'));
  const f=await pending;assert.equal(f.result.usable,false);assert.equal(f.result.terminal,'aborted');assert.equal(f.result.rawFinal,null);assert.equal(f.result.providerRequests,1);assert.equal(f.checkpoints,1);assert.ok(f.result.nativeCheckpoint);assert.ok(f.launches.every(l=>l.joined));
  assert.ok(!f.result.issues.some(issue=>issue.includes('Role deadline exceeded')));
  assert.ok(f.entries.some(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='stream_event'&&e.data.message.event?.delta?.partial_json==='{\"findings\":[]'));
 }finally{t.mock.timers.reset();}
});

check('unavailable carry capture retains original raw claims and completeness hold during normal collection',async()=>{
 for(const decisionCarry of [{version:2},{version:1},null]){
  const output={...value,outcome:'findings',findings:[finding('Original claim survives invalid carry capture')]},raw=JSON.stringify(output);
  const f=await produce(launch=>{launch.format(raw);launch.finish(output);});
  const {store,core,output:outputId}=await ledger(f,{decisionCarry});
  try{
   const row=store.one('SELECT * FROM role_outputs WHERE id=?',outputId),occurrences=store.all('SELECT * FROM finding_occurrences WHERE work=?','W');
   assert.equal(row.raw,raw);assert.equal(row.status,'unusable');assert.ok(occurrences.some(o=>JSON.parse(o.data).finding.description==='Original claim survives invalid carry capture'));
   const hold=store.one("SELECT * FROM obligations WHERE work=? AND json_extract(data,'$.kind')='raw-findings-incomplete'",'W');assert.ok(hold,'Invalid captured grammar retains a completeness hold');
   assert.match(hold.data,/carry format unavailable/);
  }finally{store.close();}
 }
});

check('owned Native MCP reads only registered role history and credits actual rendered chunk ranges',async t=>{
 useFormatterFixture(t);
 const {buildDispositionHistory}=await load('workflow/disposition-history.js'),id=randomUUID(),launchId=randomUUID();
 const snapshot=buildDispositionHistory({id,workId:'controlled-work',epoch:2,artifactRoot,records:[{id:'original-record',occurrence:'F',launch:'old-J',status:'upheld',data:{reason:'Exact old reason '+ '한글🙂'.repeat(8192)}}]});
 fs.writeFileSync(snapshot.manifest.path,snapshot.contents,{mode:0o600});const inputBundle={...body,context:{stage:'planning-adjudication',dispositionHistoryInput:{version:1,id},dispositionHistory:snapshot.manifest}},output={...value,decisions:[],planAccepted:false};let truncated;
 const f=await produce(async launch=>{
  assert.match(launch.tools.find(t=>t.name==='read').description,/content-bound input evidence/);
  const index=await launch.read({path:snapshot.manifest.path,offset:1,limit:2});assert.ok(JSON.stringify(index).includes('original-record'),JSON.stringify(index));
  const row=JSON.parse(snapshot.contents.split('\n')[1]);
  await launch.read({path:snapshot.manifest.path,offset:row.firstLine,limit:2});
  truncated=await launch.read({path:snapshot.manifest.path,offset:row.firstLine,limit:row.lastLine-row.firstLine+1});
  assert.ok(JSON.stringify(truncated).includes('truncat')||JSON.stringify(truncated).includes('Showing'));
  launch.format(JSON.stringify(output));launch.finish(output);
 },{launchId,role:'adjudicator',inputBundle,inputEvidence:{launchId,manifests:[snapshot.manifest]},maxProviderRequests:8,maxNativeTurns:8});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId,role:'adjudicator',stage:'planning-adjudication',checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource),f.result.rawFinal);assert.equal(f.result.evidenceReads.length,2);assert.deepEqual(f.result.evidenceReads.map(r=>[r.startLine,r.endLine]),[[1,2],[3,4]]);
 assert.ok(f.result.evidenceReads.every(r=>r.launchId===launchId&&r.manifestId===id&&r.sha256===snapshot.manifest.sha256));
 assert.equal(f.entries.filter(e=>e.type==='custom'&&e.customType==='gitjig.role-input-evidence-read').length,2);assert.ok(f.launches.every(l=>l.joined));
});
check('latest partial explanations use exact registered Native reads without restoring unread history',async t=>{
 useFormatterFixture(t);
 const {buildDispositionHistory,prepareLatestDispositions,latestDispositionFootprint}=await load('workflow/disposition-history.js'),id=randomUUID(),launchId=randomUUID();
 const reason='Exact original explanation 한글🙂 '.repeat(60),records=[{id:'z-older',occurrence:'F',launch:'old-J',status:'upheld',data:{reason:'Old rationale',witnesses:['old']}},{id:'a-latest',occurrence:'F',launch:'old-J',status:'upheld',data:{occurrenceId:'F',reason,witnesses:['Exact original source'],implementation:{kind:'none'},unknown:{literal:true}}}],snapshot=buildDispositionHistory({id,workId:'W',epoch:1,artifactRoot,records});
 fs.writeFileSync(snapshot.manifest.path,snapshot.contents,{mode:0o600});
 const context=prepareLatestDispositions({stage:'planning-adjudication',latestDispositionInput:{version:1},dispositionHistoryInput:{version:1,id},dispositionHistory:snapshot.manifest,dispositions:snapshot.latest,occurrences:[],baseVersion:'B',candidateVersion:null,planVersion:null,verificationVersion:null},'adjudicator',snapshot),inputBundle={...body,context},output={...value,decisions:[],planAccepted:false};
 assert.ok(context.latestDispositionView);const hash=latestDispositionFootprint(context,'adjudicator');let initial;
 const f=await produce(async launch=>{
  const content=launch.frames.find(frame=>frame.type==='user').message.content;initial=typeof content==='string'?content:content.filter(p=>p.type==='text').map(p=>p.text).join('');const wire=JSON.parse(initial.split('\n')[1]);assert.equal(Object.hasOwn(wire.context.dispositions[0].data,'reason'),false);
  const indexLine=wire.context.latestDispositionView.indexLines[0],receivedIndex=await launch.read({path:snapshot.manifest.path,offset:indexLine,limit:1});assert.ok(JSON.stringify(receivedIndex).includes('a-latest'));
  const rendered=result=>result.response.mcp_response.result.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
  assert.equal(receivedIndex.response.mcp_response.result.isError,false);const locator=JSON.parse(rendered(receivedIndex).split('\n')[0]);assert.equal(locator.id,wire.context.dispositions[0].id);
  const count=locator.lastLine-locator.firstLine+1,receivedRecord=await launch.read({path:snapshot.manifest.path,offset:locator.firstLine,limit:count});assert.equal(receivedRecord.response.mcp_response.result.isError,false);
  const exactRaw=rendered(receivedRecord).split('\n').slice(0,count).map(JSON.parse).map(chunk=>chunk.text).join('');assert.equal(createHash('sha256').update(exactRaw).digest('hex'),locator.sha256);assert.equal(Buffer.byteLength(exactRaw),locator.bytes);assert.deepEqual(JSON.parse(exactRaw),records[1]);
  launch.format(JSON.stringify(output));launch.finish(output);
 },{launchId,role:'adjudicator',inputBundle,inputEvidence:{launchId,manifests:[snapshot.manifest]},maxProviderRequests:8,maxNativeTurns:8});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.evidenceReads.length,2);assert.ok(f.result.evidenceReads.every(r=>r.launchId===launchId&&r.sha256===snapshot.manifest.sha256));
 const capture={stage:'planning-adjudication',latestDispositionInput:{version:1},latestDispositionView:context.latestDispositionView,latestDispositionHash:hash},g=await ledger(f,capture);try{
  const historical=await g.core.historicalPlanningProducer('W',g.output);assert.deepEqual(historical.context.dispositions,context.dispositions);assert.deepEqual(historical.witness.initialView.latestDispositionExplanations,{version:1,delivery:'read-bound'});assert.equal(historical.witness.initialView.textSha256,createHash('sha256').update(initial).digest('hex'));
  const launch=g.store.one('SELECT * FROM role_launches WHERE id=?',launchId),data=JSON.parse(launch.data);delete data.latestDispositionHash;g.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),launchId);await assert.rejects(g.core.historicalPlanningProducer('W',g.output),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);g.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,launchId);
 }finally{g.store.close();}
});
check('role evidence cannot be retargeted to another receiver or detached from its captured descriptor before Native birth',async()=>{
 const {buildDispositionHistory}=await load('workflow/disposition-history.js'),snapshot=buildDispositionHistory({id:randomUUID(),workId:'W',epoch:2,artifactRoot,records:[]});fs.writeFileSync(snapshot.manifest.path,snapshot.contents,{mode:0o600});
 for(const variant of ['launch','role','manifest','work']){
  const launchId=randomUUID(),inputBundle={...body,context:{stage:'planning-adjudication',dispositionHistoryInput:{version:1,id:snapshot.manifest.id},dispositionHistory:snapshot.manifest}},options={launchId,role:'adjudicator',inputBundle,inputEvidence:{launchId,manifests:[snapshot.manifest]}};
  if(variant==='launch')options.inputEvidence.launchId=randomUUID();if(variant==='role')options.role='reviewer';if(variant==='manifest')options.inputBundle={...inputBundle,context:{...inputBundle.context,dispositionHistory:{...snapshot.manifest,epoch:3}}};
  if(variant==='work'){options.nativeIdentity={conversationId:'C',workId:'other',runId:'R',initialInputId:'I',launchId,generation:1,directionRevision:0};options.nativeLifecycle={ready(){assert.fail('Foreign evidence must refuse before readiness');},settling(){},released(){}};}
  const f=await produce(()=>assert.fail('No Native birth for foreign evidence'),options);assert.equal(f.result.usable,false);assert.equal(f.launches.length,0);assert.match(f.result.issues.join(),/evidence|receiver/);
 }
});
check('session input evidence and observer are detached before async setup and cannot acquire a late role owner',async()=>{
 const {createPiSession}=await load('pi/session.js'),text='Original frozen role evidence',file=path.join(artifactRoot,'capture-'+randomUUID()),foreign=path.join(artifactRoot,'foreign-'+randomUUID());fs.writeFileSync(file,text,{mode:0o600});fs.writeFileSync(foreign,'Foreign evidence',{mode:0o600});
 let originalReads=0,replacedReads=0;const original={path:file,sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)},base={host,operations,model,systemPrompt:'Controlled evidence admission',maxReadBytes:1024,beforeModelRequest:async()=>{},roleContextBudget:{assertEntry(){}}},options={...base,inputEvidence:{artifacts:[{...original}],onRead(){originalReads++;}}};
 const pending=createPiSession(options);options.inputEvidence.artifacts[0].path=foreign;options.inputEvidence.onRead=()=>{replacedReads++;};const product=await pending;
 try{const read=product.session.agent.state.tools.find(t=>t.name==='read');const result=await read.execute('controlled-direct-read',{path:file});assert.ok(JSON.stringify(result).includes(text));await assert.rejects(read.execute('foreign-direct-read',{path:foreign}));assert.equal(originalReads,1);assert.equal(replacedReads,0);}finally{await product.closeOwned();}
 const noOwner={...base,roleContextBudget:undefined,inputEvidence:{artifacts:[original],onRead(){}}};const refused=createPiSession(noOwner);noOwner.roleContextBudget=base.roleContextBudget;await assert.rejects(refused,/captured governed role owner/);
 const late={...base,roleContextBudget:undefined};const unprivileged=createPiSession(late);late.inputEvidence={artifacts:[original],onRead(){}};late.roleContextBudget=base.roleContextBudget;const plain=await unprivileged;try{await assert.rejects(plain.session.agent.state.tools.find(t=>t.name==='read').execute('late-file',{path:file}));}finally{await plain.closeOwned();}
});

check('a post-render observer failure records no Native-delivery certificate',async()=>{
 const {buildDispositionHistory}=await load('workflow/disposition-history.js'),id=randomUUID(),launchId=randomUUID(),snapshot=buildDispositionHistory({id,workId:'W',epoch:2,artifactRoot,records:[]});fs.writeFileSync(snapshot.manifest.path,snapshot.contents,{mode:0o600});
 const inputBundle={...body,context:{stage:'planning-adjudication',dispositionHistoryInput:{version:1,id},dispositionHistory:snapshot.manifest}},output={...value,decisions:[],planAccepted:false};let failed;
 const f=await produce(async launch=>{failed=await launch.read({path:snapshot.manifest.path,offset:1,limit:1});assert.equal(failed.response.mcp_response.result.isError,true);assert.ok(JSON.stringify(failed).includes('CONTROLLED_AFTER_RENDER_FAILURE'));launch.format(JSON.stringify(output));launch.finish(output);},{launchId,role:'adjudicator',inputBundle,inputEvidence:{launchId,manifests:[snapshot.manifest]},maxProviderRequests:4,maxNativeTurns:4,onObservation(event){if(event.type==='role-input-evidence-read')throw Error('CONTROLLED_AFTER_RENDER_FAILURE');}});
 assert.equal(f.result.evidenceReads.length,1);assert.equal(f.result.evidenceReads[0].boundary,'host-rendered');
 const tool=f.entries.find(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolCallId===f.result.evidenceReads[0].toolCallId);assert.ok(tool);assert.equal(tool.message.isError,true);assert.ok(JSON.stringify(tool).includes('CONTROLLED_AFTER_RENDER_FAILURE'));
});

for(const deliveryVersion of [1,2,3,4])check('owned Native MCP selects an exact old definition and check through historical delivery v'+deliveryVersion,async t=>{
 useFormatterFixture(t);
 const {prepareHistoricalPlans}=await load('workflow/historical-plans.js');
 const {buildDispositionHistory}=await load('workflow/disposition-history.js');
 const oldPlan={intent:'Original requirement remains separate from current intent',requirements:[{id:'old-R',text:'Old guarantee',source:'old-owner'}],approach:'Original plan narrative '.repeat(100),factualSources:[{sourceId:'base:consumer.cjs',reason:'Original source'}],verification:{requiredPaths:['consumer.cjs'],strategies:[{kind:'consumer-cases',requirementId:'old-R',checkIds:['old-check']}],checks:[{id:'old-check',guaranteeIds:['old-R'],command:'node old-check.cjs',cases:[{id:'old-adverse',input:{literalUtf8:'OLD-INPUT'},expected:{kind:'rejection',value:'OLD-EXPECTED'}}]}]}};
 const planHash=sha(JSON.stringify(oldPlan)),canonical={semantics:'Original historical evidence, no current closure',links:[{occurrenceId:'current-claim',planHash}],plans:[{planHash,plan:oldPlan}],producers:[],unavailable:[]};
 const stage=deliveryVersion===3?'review-adjudication':'planning-adjudication';
 const prepared=prepareHistoricalPlans(canonical,{id:randomUUID(),workId:'controlled-work',epoch:2,artifactRoot,stage,...(deliveryVersion===4?{deliveryVersion:4}:{}),...(deliveryVersion===2?{neverAdoptedWork:{version:1,censusSha256:"a".repeat(64)}}:{})});assert.ok(prepared.evidence);
 const history=buildDispositionHistory({id:randomUUID(),workId:'controlled-work',epoch:2,artifactRoot,stage,records:[]});
 for(const snapshot of [prepared.evidence,history])fs.writeFileSync(snapshot.manifest.path,snapshot.contents,{mode:0o600});
 const launchId=randomUUID(),inputBundle={...body,context:{stage,historicalPlansInput:{version:deliveryVersion,id:prepared.evidence.manifest.id},historicalPlanningOperands:prepared.value,dispositionHistoryInput:{version:deliveryVersion===3?2:1,id:history.manifest.id},dispositionHistory:history.manifest}},output={...value,decisions:[],planAccepted:false};
 assert.equal(prepared.value.planBodyEncoding.version,deliveryVersion);
 if(deliveryVersion===2){assert.equal(prepared.value.plans[0].inlinePlan,undefined);assert.equal(prepared.value.plans[0].recordedIntent,oldPlan.intent);}
 let observed;
 const f=await produce(async launch=>{
  const text=result=>result.response.mcp_response.result.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const headerAndIndex=text(await launch.read({path:prepared.evidence.manifest.path,offset:1,limit:2})).split('\n').slice(0,2).map(JSON.parse);
  assert.equal(headerAndIndex[0].kind,'historical-plans');const locator=headerAndIndex[1];assert.equal(locator.id,planHash);
  const count=locator.lastLine-locator.firstLine+1;
  const raw=text(await launch.read({path:prepared.evidence.manifest.path,offset:locator.firstLine,limit:count})).split('\n').slice(0,count).map(JSON.parse).map(chunk=>chunk.text).join('');
  assert.equal(sha(raw),locator.sha256);assert.equal(Buffer.byteLength(raw),locator.bytes);observed=JSON.parse(raw);assert.deepEqual(observed,{planHash,plan:oldPlan});assert.equal(observed.plan.verification.checks[0].cases[0].expected.value,'OLD-EXPECTED');
  await launch.read({path:history.manifest.path,offset:1,limit:1});
  launch.format(JSON.stringify(output));launch.finish(output);
 },{launchId,role:'adjudicator',inputBundle,inputEvidence:{launchId,manifests:[history.manifest,prepared.evidence.manifest]},maxProviderRequests:8,maxNativeTurns:8});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.deepEqual(observed.plan.requirements,oldPlan.requirements);
 assert.equal(f.result.evidenceReads.length,3);assert.deepEqual(new Set(f.result.evidenceReads.map(r=>r.manifestId)),new Set([history.manifest.id,prepared.evidence.manifest.id]));
 assert.ok(f.result.evidenceReads.every(r=>r.launchId===launchId));assert.ok(f.launches.every(l=>l.joined));
});

for (const [role,stage,version=1] of [['planner','planning'],['planner','planning',3],['challenger','planning-challenge',3],['reviewer','fresh-review'],['reviewer','fresh-review',3],['implementer','implementation'],['adjudicator','planning-adjudication',2],['adjudicator','review-adjudication',2],['adjudicator','source-fit',3],['implementer','implementation',3],['repairer','substantive-repair',3]]) check('owned Native MCP reads an omitted unchanged normative exception with its exact receiver: '+role+':'+stage+(version===3?' v3':''),async t=>{
 useFormatterFixture(t);
 const {loadCriteria}=await load('controller/criteria.js'),{prepareCriteriaDelivery}=await load('workflow/criteria-delivery.js');
 const current={id:randomUUID(),...await loadCriteria()},prepared=prepareCriteriaDelivery(current,null,{id:randomUUID(),workId:'controlled-criteria-work',epoch:2,role,stage,artifactRoot,version});
 fs.writeFileSync(prepared.evidence.manifest.path,prepared.evidence.contents,{mode:0o600});
 const held=stage==='source-fit'?{inputId:'held-owner-input',directionRevision:1}:null;
 const output={...value},launchId=randomUUID();
 if(role==='planner')output.plan=mixedPlan();
 if(role==='challenger')output.alternatives=[];
 if(role==='adjudicator'){
  output.decisions=[];
  if(stage==='planning-adjudication')output.planAccepted=false;
  if(held)output.inputDecisions=[{...held,impact:'explanation',reason:'The owner asks for an explanation of the retained requirement.',requirementIds:['R1']}];
 }
 const inputBundle={...body,contracts:prepared.operating,context:{stage,workflowCriteriaInput:{version,id:prepared.view.manifest.id},workflowCriteria:prepared.view,...(role==='planner'?{planningVerificationProfile:initialVerificationProfile}:{}),
  ...(held?{sourceFitInput:{version:1},sourceFitReferences:{version:1,stage,inputs:[held],requirementIds:['R1']},sourceInputChain:[{input_id:held.inputId,revision:held.directionRevision,text:'Explain the retained requirement.',data:{effectHold:true}}]}:{})}};
 const section=held?'C3':version===1?'D7':prepared.view.profile==='planning-v3'?'C4':'C1',asset=version===1?'DESIGN.md':'CONTRACTS.md';const locator=prepared.view.catalogue.find(row=>row.side==='current'&&row.section===section);assert.equal(locator.delivery,'read');
 let record;
 const ranges=[];
 const f=await produce(async launch=>{
  assert.match(launch.tools.find(tool=>tool.name==='read').description,/consecutive offset and limit reads/);
  const chunks=[];
  for(let start=locator.firstLine;start<=locator.lastLine;start+=16){
   const count=Math.min(16,locator.lastLine-start+1);
   const response=await launch.read({path:prepared.evidence.manifest.path,offset:start,limit:count});
   const result=response.response.mcp_response.result;
   assert.equal(result.isError,false);
   const lines=result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n').split('\n').slice(0,count);
   assert.equal(lines.length,count);
   ranges.push({startLine:start,endLine:start+count-1,rangeSha256:sha(lines.join('\n'))});
   chunks.push(...lines.map(line=>JSON.parse(line)));
  }
  assert.deepEqual(chunks.map(chunk=>[chunk.ordinal,chunk.chunk,chunk.chunks]),chunks.map((_,index)=>[locator.ordinal,index+1,chunks.length]));
  const raw=chunks.map(chunk=>chunk.text).join('');
  assert.equal(Buffer.byteLength(raw),locator.bytes);
  assert.equal(sha(raw),locator.sha256);record=JSON.parse(raw);assert.equal(record.id,`current:${asset}:${section}`);
  assert.ok(current.assets[asset].selected.includes(record.text));
  assert.ok(!prepared.operating.includes(record.text),'The full omitted definition is not initially inline');
  launch.format(JSON.stringify(output));launch.finish(output);
 },{launchId,role,inputBundle,inputEvidence:{launchId,manifests:[prepared.evidence.manifest]},maxProviderRequests:8,maxNativeTurns:8});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.ok(record.text.includes(`## ${section}.`));
 const reads=f.result.evidenceReads;
 assert.deepEqual(reads.map(({startLine,endLine,rangeSha256})=>({startLine,endLine,rangeSha256})),ranges);
 if(section==='C4')assert.ok(reads.length>1,'Large C4 must be reconstructed from multiple rendered pages');
 for(const read of reads){
  assert.equal(read.launchId,launchId);
  assert.equal(read.manifestId,prepared.view.manifest.id);
  assert.equal(read.sha256,prepared.evidence.manifest.sha256);
  assert.ok(f.entries.some(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolCallId===read.toolCallId&&!e.message.isError));
 }
 assert.ok(f.launches.every(l=>l.joined));
});

check('workflow criteria artifact admission refuses foreign receivers and changed initial operating text before Native birth',async()=>{
 const {loadCriteria}=await load('controller/criteria.js'),{prepareCriteriaDelivery}=await load('workflow/criteria-delivery.js');
 for(const variant of ['role','launch','content','operating','declaration']){
  const prepared=prepareCriteriaDelivery({id:randomUUID(),...await loadCriteria()},null,{id:randomUUID(),workId:'W',epoch:1,role:'reviewer',stage:'fresh-review',artifactRoot});
  fs.writeFileSync(prepared.evidence.manifest.path,variant==='content'?'changed':prepared.evidence.contents,{mode:0o600});
  const launchId=randomUUID(),inputBundle={...body,contracts:prepared.operating+(variant==='operating'?'changed':''),context:{stage:'fresh-review',workflowCriteriaInput:{version:1,id:variant==='declaration'?randomUUID():prepared.view.manifest.id},workflowCriteria:prepared.view}};
  const f=await produce(()=>assert.fail('Foreign evidence must refuse before Native birth'),{launchId,role:variant==='role'?'implementer':'reviewer',inputBundle,inputEvidence:{launchId:variant==='launch'?randomUUID():launchId,manifests:[prepared.evidence.manifest]}});
  assert.equal(f.result.usable,false);assert.equal(f.launches.length,0);assert.match(f.result.issues.join(),/evidence binding unavailable|content changed|artifact identity changed|criteria operating input changed|criteria delivery unavailable/);
 }
});

check('historical plan manifests cannot cross role, epoch, receiver or original admitted content',async()=>{
 const {prepareHistoricalPlans}=await load('workflow/historical-plans.js'),{buildDispositionHistory}=await load('workflow/disposition-history.js');
 const plan={intent:'Original',approach:'old body '.repeat(1000)},canonical={plans:[{planHash:sha(JSON.stringify(plan)),plan}]};
 for(const variant of ['receiver','epoch','role','content']){
  const prepared=prepareHistoricalPlans(canonical,{id:randomUUID(),workId:'W',epoch:2,artifactRoot});
  const history=buildDispositionHistory({id:randomUUID(),workId:variant==='receiver'?'foreign':'W',epoch:variant==='epoch'?3:2,artifactRoot,records:[]});
  for(const snapshot of [prepared.evidence,history])fs.writeFileSync(snapshot.manifest.path,variant==='content'&&snapshot===prepared.evidence?'tampered':snapshot.contents,{mode:0o600});
  const launchId=randomUUID(),inputBundle={...body,context:{stage:'planning-adjudication',historicalPlansInput:{version:1,id:prepared.evidence.manifest.id},historicalPlanningOperands:prepared.value,dispositionHistoryInput:{version:1,id:history.manifest.id},dispositionHistory:history.manifest}};
  const f=await produce(()=>assert.fail('Invalid evidence must refuse before Native birth'),{launchId,role:variant==='role'?'reviewer':'adjudicator',inputBundle,inputEvidence:{launchId,manifests:[history.manifest,prepared.evidence.manifest]}});
  assert.equal(f.result.usable,false);assert.equal(f.launches.length,0);assert.match(f.result.issues.join(),/evidence scope changed|evidence binding unavailable|content changed|artifact identity changed/);
 }
});

function custodyProducers(){return Array.from({length:8},(_,i)=>({outputId:'O'+i,launchId:'L'+i,nativeEntryId:'entry-'+i,role:'challenger',stage:'planning-challenge',epoch:1,producerStatus:'unusable',launchStatus:'UNUSABLE',runId:randomUUID(),nativeSessionId:randomUUID(),outputRawSha256:'a'.repeat(64),checkpoint:{sessionId:randomUUID(),leafId:randomUUID(),bytes:1024,sha256:'b'.repeat(64)},materialSource:{version:1,source:{selector:'result-text',sourceEntryId:'original-'+i,rawSha256:'c'.repeat(64)}},initialView:{userEntryId:'user-'+i,textUtf8Bytes:5000,textSha256:'d'.repeat(64),occurrenceIds:[],findingBodySuppliedIds:[],findingBodyOmittedIds:[],metadataIdentities:{version:1,fieldFootprintSha256:'e'.repeat(64),meaning:'Original presentation'}}}));}
for(const [stage,version] of [['planning-adjudication',1],['review-adjudication',1],['planning-adjudication',2]])check('historical custody uses exact indexed Native reads and preserves partial exposure: '+stage+':v'+version,async t=>{
 useFormatterFixture(t);
 const {prepareHistoricalProvenance}=await load('workflow/historical-provenance.js'),id=randomUUID(),launchId=randomUUID();
 const producers=custodyProducers();if(version===2)for(const p of producers){p.initialView.occurrenceIndexes=[0,1];p.initialView.findingBodySuppliedIndexes=[0];p.initialView.workflowCriteria={eagerRecordIds:['current:MISSION.md:M1'],readBoundRecordIds:[]};}
 const source={semantics:'Original source records; no new closure',producers,plans:[],unavailable:[],...(version===2?{censusEncoding:{version:1,occurrenceIdDictionary:['F1','F2']}}:{})},prepared=prepareHistoricalProvenance(source,{id,workId:'W',epoch:1,stage,artifactRoot,version});assert.ok(prepared.evidence);fs.writeFileSync(prepared.evidence.manifest.path,prepared.evidence.contents,{mode:0o600});
 const context={stage,historicalProvenanceInput:{version,id},historicalPlanningOperands:prepared.value,occurrences:[],baseVersion:'B',candidateVersion:null,planVersion:null,verificationVersion:null},inputBundle={...body,context},output={...value,decisions:[],planAccepted:false};let initial;
 const f=await produce(async launch=>{
  const content=launch.frames.find(frame=>frame.type==='user').message.content;initial=typeof content==='string'?content:content.filter(p=>p.type==='text').map(p=>p.text).join('');const wire=JSON.parse(initial.split('\n')[1]),history=wire.context.historicalPlanningOperands;
  if(version===2){assert.equal(history.producers[0].initialView.occurrenceIndexes,undefined);assert.ok(history.producers[0].readBoundFields.length);assert.deepEqual(history.censusEncoding,source.censusEncoding);}
  assert.equal(history.producers[0].runId,undefined);assert.equal(history.producers[0].nativeEntryId,producers[0].nativeEntryId);assert.deepEqual(history.producers[0].materialSource,producers[0].materialSource);
  const rendered=response=>{assert.equal(response.response.mcp_response.result.isError,false);return response.response.mcp_response.result.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');};
  const locator=JSON.parse(rendered(await launch.read({path:prepared.evidence.manifest.path,offset:history.producerProvenance.indexLines[0],limit:1})).split('\n')[0]);assert.equal(locator.id,producers[0].outputId);
  const count=locator.lastLine-locator.firstLine+1,raw=rendered(await launch.read({path:prepared.evidence.manifest.path,offset:locator.firstLine,limit:count})).split('\n').slice(0,count).map(JSON.parse).map(chunk=>chunk.text).join('');
  assert.equal(createHash('sha256').update(raw).digest('hex'),locator.sha256);assert.equal(Buffer.byteLength(raw),locator.bytes);assert.deepEqual(JSON.parse(raw),producers[0]);
  launch.format(JSON.stringify(output));launch.finish(output);
 },{launchId,role:'adjudicator',inputBundle,inputEvidence:{launchId,manifests:[prepared.evidence.manifest]},maxProviderRequests:8,maxNativeTurns:8});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.evidenceReads.length,2);assert.ok(f.result.evidenceReads.every(read=>read.launchId===launchId&&read.sha256===prepared.evidence.manifest.sha256));
 const capture={stage,historicalProvenanceInput:context.historicalProvenanceInput,historicalInputHash:createHash('sha256').update(JSON.stringify(prepared.value)).digest('hex'),inputEvidenceManifests:[prepared.evidence.manifest]},g=await ledger(f,capture);g.core.h.options={...g.core.h.options,installationHome:appHome};
 try{
  const original=fs.readFileSync(f.result.historyRef),parsed=await g.core.historicalPlanningProducer('W',g.output);assert.deepEqual(parsed.context.historicalPlanningOperands,prepared.value);assert.deepEqual(parsed.witness.initialView.historicalCustody,{version,delivery:version===2?'read-bound-memberships':'read-bound'});assert.equal(parsed.witness.initialView.textSha256,createHash('sha256').update(initial).digest('hex'));
  fs.renameSync(prepared.evidence.manifest.path,prepared.evidence.manifest.path+'.held');try{const missing=await g.core.historicalPlanningProducer('W',g.output);assert.deepEqual(missing.context.historicalPlanningOperands,prepared.value);assert.deepEqual(missing.witness.initialView.historicalCustody,{version,delivery:version===2?'read-bound-memberships':'read-bound'});}finally{fs.renameSync(prepared.evidence.manifest.path+'.held',prepared.evidence.manifest.path);}
  const launch=g.store.one('SELECT * FROM role_launches WHERE id=?',launchId),data=JSON.parse(launch.data);
  for(const mutate of [d=>delete d.historicalProvenanceInput,d=>delete d.historicalInputHash,d=>d.historicalInputHash='0'.repeat(64),d=>d.inputEvidenceManifests=[],d=>d.inputEvidenceManifests[0].epoch++]){const changed=structuredClone(data);mutate(changed);g.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(changed),launchId);await assert.rejects(g.core.historicalPlanningProducer('W',g.output),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);g.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,launchId);}
  assert.deepEqual(fs.readFileSync(f.result.historyRef),original);
 }finally{g.store.close();}
});

check('historical custody refuses foreign scopes, receivers and changed artifacts before Native birth',async()=>{
 const {prepareHistoricalProvenance}=await load('workflow/historical-provenance.js'),{buildDispositionHistory}=await load('workflow/disposition-history.js');
 for(const variant of ['work','epoch','stage','role','launch','content','descriptor','census']){
  const prepared=prepareHistoricalProvenance({producers:custodyProducers(),censusEncoding:{occurrenceIds:['F1','F2'],sourceSets:[]}},{id:randomUUID(),workId:'W',epoch:2,stage:'planning-adjudication',artifactRoot});assert.ok(prepared.evidence);
  const history=buildDispositionHistory({id:randomUUID(),workId:variant==='work'?'foreign':'W',epoch:variant==='epoch'?3:2,artifactRoot,records:[]});
  for(const snapshot of [prepared.evidence,history])fs.writeFileSync(snapshot.manifest.path,variant==='content'&&snapshot===prepared.evidence?'tampered':snapshot.contents,{mode:0o600});
  const launchId=randomUUID(),context={stage:variant==='stage'?'review-adjudication':'planning-adjudication',historicalProvenanceInput:{version:1,id:prepared.evidence.manifest.id},historicalPlanningOperands:prepared.value,dispositionHistoryInput:{version:1,id:history.manifest.id},dispositionHistory:history.manifest};
  if(variant==='census')context.historicalPlanningOperands.censusEncoding.occurrenceIds.reverse();
  const manifests=[history.manifest,variant==='descriptor'?{...prepared.evidence.manifest,sha256:'0'.repeat(64)}:prepared.evidence.manifest];
  const f=await produce(()=>assert.fail('Invalid custody evidence must refuse before Native birth'),{launchId,role:variant==='role'?'reviewer':'adjudicator',inputBundle:{...body,context},inputEvidence:{launchId:variant==='launch'?randomUUID():launchId,manifests}});
  assert.equal(f.result.usable,false);assert.equal(f.launches.length,0);assert.match(f.result.issues.join(),/evidence scope changed|evidence binding unavailable|content changed|artifact identity changed|provenance|requires its original adjudicator/);
 }
});

check('owned SDK delivers distinct action domains and accepts a valid correction without adopting the failed diagnostic command',async t=>{
 useFormatterFixture(t);
 const ordinary=Array.from({length:64},(_,i)=>'F'+i),context={stage:'planning-adjudication',decisionCarry:{version:2},decisionReferences:{version:3,occurrenceIds:[...ordinary,'D'],diagnosisOccurrenceIds:['D'],pendingOrdinaryIndexes:ordinary.map((_,i)=>i),blockingOrdinaryIndexes:[],retentionChoices:[{occurrenceId:'D',dispositionId:'OLD-D',sha256:'a'.repeat(64)}]},diagnosisEligibility:{version:1},producerDiagnosticReceipt:{receiptHash:'b'.repeat(64),eligible:[]}};
 const output={...value,planAccepted:false,retainedDispositions:['OLD-D'],decisions:ordinary.map(occurrenceId=>({occurrenceId,disposition:'upheld',reason:'Independent ordinary assessment; implementation remains pending',witnesses:[],implementation:{kind:'none'}}))},failed=structuredClone(output);failed.decisions.push({occurrenceId:'D',disposition:'upheld',reason:'Retained diagnosis acknowledgement',witnesses:[],implementation:{kind:'none'}});
 let delivered=false;
 const f=await produce(launch=>{
  const transport=JSON.stringify({frames:launch.frames,args:launch.options.args});assert.ok(transport.includes('Current action domains'));assert.ok(transport.includes('ORDINARY occurrences only'));
  const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]),validate=new Ajv2020({strict:false}).compile(schema);assert.equal(validate(failed),false);assert.equal(validate(output),true,JSON.stringify(validate.errors));
  const content=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof content==='string'?content:content.filter(p=>p.type==='text').map(p=>p.text).join('');assert.deepEqual(JSON.parse(text.split('\n')[1]).context,context);delivered=true;
  launch.format(JSON.stringify(failed),{carrierError:true});launch.format(JSON.stringify(output));launch.finish(output);
 },{role:'adjudicator',inputBundle:{...body,context},maxNativeTurns:4});
 assert.equal(delivered,true);assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.deepEqual(f.result.protocol,output);assert.equal(f.result.protocol.decisions.some(d=>d.occurrenceId==='D'),false);assert.ok(f.launches.every(l=>l.joined));
});

check('a closed Native failure preserves correlated earlier formatter rejection and final provider error separately',async()=>{
 const f=await produce(launch=>{launch.format(JSON.stringify({...value,extra:true}),{carrierError:true,carrierErrorText:'Output does not match required schema: /extra'});launch.finish(undefined,{is_error:true,result:'Prompt is too long'});});
 assert.equal(f.result.usable,false);assert.equal(f.result.terminal,'error');assert.match(f.result.issues[0],/^EARLIER_NATIVE_FORMATTER: Output does not match required schema: \/extra/);assert.ok(f.result.issues.some(i=>i==='PROVIDER:Prompt is too long'));
 const carrier=f.entries.find(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='user'&&e.data.message.message.content.some(b=>b.is_error===true));assert.ok(f.result.issues[0].includes('original entry '+carrier.id));assert.ok(f.launches.every(l=>l.joined));
 const {NativeRoleCollector}=await load('workflow/native-role-output.js'),intent=f.entries.find(e=>e.customType===nativeRoleEntries.intent),original=f.entries.filter(e=>e.type==='custom');
 const get=(entries,type)=>entries.find(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type===type);
 for(const variant of ['read-tool','foreign-call','foreign-carrier','wrong-id','retracted-call','retracted-carrier','duplicate-carrier','late-carrier','unknown-cleanup','changed-intent','pointer-control','mixed-content','colliding-read-call','missing-all-sessions','missing-query','missing-init-uuid','missing-result-uuid','subagent-carrier','mutated-carrier','missing-digest','wrong-request-digest','wrong-schema-digest']){
  const entries=structuredClone(original),assistant=get(entries,'assistant'),user=get(entries,'user'),result=get(entries,'result'),call=assistant.data.message.message.content.find(b=>b.type==='tool_use'),block=user.data.message.message.content[0];
  if(variant==='read-tool')call.name='mcp__custom-tools__read';
  if(variant==='foreign-call')assistant.data.message.session_id='foreign';
  if(variant==='foreign-carrier')user.data.message.session_id='foreign';
  if(variant==='wrong-id')block.tool_use_id='another-tool';
  if(variant==='retracted-call')result.data.message.retracted_message_uuids=[assistant.data.message.uuid];
  if(variant==='retracted-carrier')result.data.message.retracted_message_uuids=[user.data.message.uuid];
  if(variant==='duplicate-carrier')entries.splice(entries.indexOf(user),0,structuredClone(user));
  if(variant==='late-carrier'){entries.splice(entries.indexOf(user),1);entries.push(user);}
  if(variant==='unknown-cleanup')entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.nativeCleanup='unknown';
  if(variant==='changed-intent')entries.find(e=>e.customType===nativeRoleEntries.intent).data.request.binding.role='foreign';
  if(variant==='pointer-control'){call.id='bad\u001bID';block.tool_use_id=call.id;}
  if(variant==='mixed-content')block.content=[{type:'image',data:'Not formatter text'}];
  if(variant==='colliding-read-call'){const other=structuredClone(assistant);other.id=randomUUID();other.data.message.uuid=randomUUID();other.data.message.message.content=[{type:'tool_use',id:call.id,name:'mcp__custom-tools__read',input:{path:'file'}}];entries.splice(entries.indexOf(user),0,other);}
  if(variant==='missing-all-sessions'){entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.nativeSessionId=undefined;for(const e of entries)if(e.customType===nativeRoleEntries.sdk)delete e.data.message.session_id;}
  if(variant==='missing-query')delete entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.queryId;
  if(variant==='missing-init-uuid')delete get(entries,'system').data.message.uuid;
  if(variant==='missing-result-uuid')delete result.data.message.uuid;
  if(variant==='subagent-carrier')user.data.message.parent_tool_use_id='parent';
  if(variant==='mutated-carrier')block.content='Forged post-settlement formatter error';
  if(variant==='missing-digest')delete entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.messageDigest;
  if(variant==='wrong-request-digest')entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.format.requestDigest='0'.repeat(64);
  if(variant==='wrong-schema-digest')entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.format.schemaDigest='0'.repeat(64);
  if(!['mutated-carrier','missing-digest'].includes(variant)){const sdk=entries.filter(e=>e.customType===nativeRoleEntries.sdk),a=entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation;a.messages=sdk.length;a.messageDigest=createHash('sha256').update(sdk.map(e=>JSON.stringify(e.data.message)+'\n').join('')).digest('hex');}
  const manager={getSessionId:()=>f.result.nativeSessionId,getSessionFile:()=>undefined,getBranch:()=>entries,appendCustomEntry:()=>intent.id},collector=new NativeRoleCollector(manager,intent.data.request);assert.equal(collector.formatterError(),undefined);try{collector.materialize();}catch{}assert.equal(collector.formatterError(),undefined,variant);
 }
});

check('formatter breadcrumb bounds UTF8 and suppresses errors resolved by a later successful carrier',async()=>{
 const text=('한글🙂 ').repeat(400),f=await produce(launch=>{launch.format(JSON.stringify({...value,extra:true}),{carrierError:true,carrierErrorText:text});launch.finish(undefined,{is_error:true,result:'Prompt is too long'});});
 const issue=f.result.issues[0];assert.match(issue,/^EARLIER_NATIVE_FORMATTER:/);const message=issue.slice('EARLIER_NATIVE_FORMATTER: '.length).split(' (tool ')[0];assert.ok(Buffer.byteLength(message)<=512);assert.match(message,/see original role history/);assert.equal(message.includes('\ufffd'),false);
 // Transport may discard control-containing protocol lines. Exercise sanitation
 // independently on a matching, closed query trace without claiming SDK forwarding.
 const {NativeRoleCollector}=await load('workflow/native-role-output.js'),entries=structuredClone(f.entries.filter(e=>e.type==='custom')),intent=entries.find(e=>e.customType===nativeRoleEntries.intent),sdk=entries.filter(e=>e.customType===nativeRoleEntries.sdk),carrier=sdk.find(e=>e.data.message.type==='user');
 carrier.data.message.message.content[0].content=('한글🙂\u001b\n\u009b\u202e\u2067\u2028').repeat(400);
 const attestation=entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation;attestation.messages=sdk.length;attestation.messageDigest=createHash('sha256').update(sdk.map(e=>JSON.stringify(e.data.message)+'\n').join('')).digest('hex');
 const manager={getSessionId:()=>f.result.nativeSessionId,getSessionFile:()=>undefined,getBranch:()=>entries,appendCustomEntry:()=>intent.id},collector=new NativeRoleCollector(manager,intent.data.request);collector.materialize();const safe=collector.formatterError();assert.ok(safe);assert.ok(Buffer.byteLength(safe.message)<=512);assert.equal(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/.test(safe.message),false);assert.equal(safe.message.includes('\ufffd'),false);
 const later=await produce(launch=>{launch.format(JSON.stringify({...value,extra:true}),{carrierError:true});launch.format(JSON.stringify(value));launch.finish(undefined,{is_error:true,result:'Later provider failure'});});assert.equal(later.result.usable,false);assert.equal(later.result.issues.some(i=>i.startsWith('EARLIER_NATIVE_FORMATTER:')),false);assert.ok(later.result.issues.some(i=>i.includes('Later provider failure')));
});

check('public Controller, retained diagnostics and compact CLI result preserve earlier formatter and final provider failures',async t=>{
 useFormatterFixture(t);
 const f=await controllerRole(t,launch=>{launch.exitCode=1;launch.format(JSON.stringify({...value,plan:mixedPlan(),extra:true}),{carrierError:true,carrierErrorText:'Output does not match required schema: /extra'});launch.finish(undefined,{is_error:true,result:'Prompt is too long'});});
 assert.equal(f.outcome.phase,'BLOCKED');assert.equal(f.launch.status,'UNUSABLE');assert.equal(f.outcome.planVersion,null);assert.equal(f.outcome.planningFailure.launchId,f.launch.id);
 const output=f.c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable' ORDER BY rowid DESC LIMIT 1",f.launch.id),data=JSON.parse(output.data),diagnostic=JSON.parse(f.c.store.one('SELECT data FROM obligations WHERE id=?','diagnostic-'+f.launch.id).data);
 assert.match(data.issues[0],/^EARLIER_NATIVE_FORMATTER:/);assert.ok(data.issues.some(i=>i==='PROVIDER:Prompt is too long'));assert.deepEqual(diagnostic.issues,data.issues);assert.equal(diagnostic.state,'pending');assert.ok(f.outcome.blocked.some(s=>s.includes(data.issues[0])&&s.includes('PROVIDER:Prompt is too long')));
 const {changeCommandResult}=await load('cli/change-result.js'),compact=changeCommandResult('change resume',f.outcome,false,appHome);assert.equal(compact.detailsOmitted,true);assert.deepEqual(compact.blocked,f.outcome.blocked);assert.equal(compact.planningFailure.launchId,f.launch.id);
});

check('a preceding formatter rejection does not disable independently attested provider quota recovery',async()=>{
 const f=await produce(launch=>{launch.exitCode=1;launch.format(JSON.stringify({...value,extra:true}),{carrierError:true});launch.send({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'seven_day',resetsAt:1794020400},uuid:randomUUID(),session_id:launch.sid});launch.finish(undefined,{is_error:true,result:'Claude rate limit (seven_day)'});});
 assert.equal(f.result.usable,false);assert.equal(f.result.providerFailure.kind,'usage-limit');assert.equal(f.result.providerFailure.window,'seven_day');assert.match(f.result.issues[0],/^EARLIER_NATIVE_FORMATTER:/);assert.ok(f.result.issues.some(i=>i.startsWith('PROVIDER:')));
});

check('SDK iterator failure after an observed failed result still retains query-specific formatter evidence',async()=>{
 const f=await produce(launch=>{launch.exitCode=1;launch.format(JSON.stringify({...value,extra:true}),{carrierError:true,carrierErrorText:'Output does not match required schema: /extra'});launch.finish(undefined,{is_error:true,result:'Prompt is too long'});});
 assert.equal(f.result.usable,false);assert.equal(f.result.terminal,'error');assert.ok(f.entries.some(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='result'&&e.data.message.is_error===true));
 assert.equal(f.entries.filter(e=>e.customType===nativeRoleEntries.settlement).length,1,'Actual SDK throws after observing the failed result; the catch path must attest confirmed query cleanup');assert.match(f.result.issues[0],/^EARLIER_NATIVE_FORMATTER:/);assert.ok(f.result.issues.some(i=>i.includes('Prompt is too long')));assert.ok(f.launches.every(l=>l.joined));
});

check('settlement observer rejection is attempted once and preserves provider cause without narrower attribution',async()=>{
 const {NativeRoleCollector}=await load('workflow/native-role-output.js'),observe=NativeRoleCollector.prototype.observe;let attempts=0;
 NativeRoleCollector.prototype.observe=function(data){const result=observe.call(this,data);if(data.type==='gitjig.native-query-settled/v1'){attempts++;throw Error('CONTROLLED_SETTLEMENT_OBSERVER_REJECTION');}return result;};
 try{
  const f=await produce(launch=>{launch.format(JSON.stringify({...value,extra:true}),{carrierError:true});launch.finish(undefined,{is_error:true,result:'Prompt is too long'});});
  assert.equal(attempts,1);assert.equal(f.result.usable,false);assert.equal(f.result.providerFailure,undefined);assert.equal(f.result.issues.some(i=>i.startsWith('EARLIER_NATIVE_FORMATTER:')),false);assert.ok(f.result.issues.some(i=>i.startsWith('NATIVE_COLLECTOR:')));assert.ok(f.result.issues.join(' ').includes('Prompt is too long'));assert.ok(f.result.issues.join(' ').includes('BRIDGE_STRUCTURED_SETTLEMENT_OBSERVATION_FAILED'));assert.ok(f.launches.every(l=>l.joined));
 }finally{NativeRoleCollector.prototype.observe=observe;}
});

check('an SDK iterator error before a terminal result cannot manufacture structured settlement evidence',async()=>{
 const f=await produce(()=>{throw Error('CONTROLLED_PRE_RESULT_ITERATOR_FAILURE');},{timeoutMs:2000});
 assert.equal(f.result.usable,false);assert.equal(f.result.terminal,'error');assert.equal(f.entries.some(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='result'),false);assert.equal(f.entries.some(e=>e.customType===nativeRoleEntries.settlement),false);assert.equal(f.result.issues.some(i=>i.startsWith('EARLIER_NATIVE_FORMATTER:')),false);assert.ok(f.launches.every(l=>l.joined));
});

check('a failed native-finish boundary cannot produce structured settlement or formatter attribution',async()=>{
 const {HostedQuery}=await import(new URL('./host.js',originalBridge)),finish=HostedQuery.prototype.finishNative,launchId=randomUUID();let faulted=false;
 HostedQuery.prototype.finishNative=async function(){await finish.call(this);if(this.format?.request.binding.launchId===launchId&&!faulted){faulted=true;throw Error('BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN');}};
 try{
  const f=await produce(launch=>{launch.exitCode=1;launch.format(JSON.stringify({...value,extra:true}),{carrierError:true});launch.finish(undefined,{is_error:true,result:'Prompt is too long'});},{launchId});
  assert.equal(faulted,true);assert.equal(f.result.usable,false);assert.equal(f.entries.some(e=>e.customType===nativeRoleEntries.settlement),false);assert.equal(f.result.issues.some(i=>i.startsWith('EARLIER_NATIVE_FORMATTER:')),false);assert.ok(f.launches.every(l=>l.joined));
 }finally{HostedQuery.prototype.finishNative=finish;}
});


/** Explicit prospective producer only; normal runRole still generates v1. */
async function capturedTextRole(scenario,options={}) {
 const {createPiSession}=await load('pi/session.js'),{NativeRoleCollector,nativeRoleIntentReceipt}=await load('workflow/native-role-output.js'),{roleFraming}=await load('workflow/role-framing.js');
 const framing=roleFraming('reviewer',body),launchId=randomUUID(),intent={version:2,carrier:'assistant-json/v1',requestId:launchId,binding:{launchId,role:'reviewer',stage:'fresh-review',inputDigest:sha(framing.prompt)},schema:framing.schema,maxNativeTurns:3};
 const expected=structuredClone(intent),before=launches.length;let collector;
 selectedScenario=scenario;scenario.extraNativeTools=options.extraNativeTools;
 const product=await createPiSession({host,operations:options.operations??operations,model,maxReadBytes:1024,readOnly:true,systemPrompt:framing.systemPrompt,roleContextBudget:{assertEntry(){},structuredOutput:{intent,observe(data,manager){assert.equal(collector.manager,manager);collector.observe(data);}}},beforeModelRequest:async manager=>{options.beforeRequest?.(intent,manager);}});
 try{
  collector=new NativeRoleCollector(product.sessionManager,options.collectorIntent??expected);
  await product.session.prompt(options.prompt??framing.prompt);collector.materialize();
  let selected,error;
  try{selected=collector.select();}catch(cause){error=String(cause);if(!options.expectUnavailable)throw cause;}
  if(options.repeat){await product.session.prompt('No new query or correction is authorized.');assert.match(product.session.messages.at(-1).errorMessage,/STRUCTURED_QUERY_REPLACEMENT_REFUSED|NATIVE_ROLE_INPUT_MISMATCH/);}
  const entries=structuredClone(product.sessionManager.getBranch()),own=launches.slice(before);
  if(selected){assert.equal(selected.source.kind,'claude-sdk-assistant-json/v1');assert.equal(readSelectedRoleOutput(entries,{entryId:selected.entryId,sessionId:product.sessionManager.getSessionId(),launchId,role:'reviewer',stage:'fresh-review',checkpointLeafId:selected.entryId,nativeIntent:nativeRoleIntentReceipt(expected)},selected.source),selected.raw);}
  assert.equal(collector.formatterError(),undefined,'Text queries cannot acquire formatter attribution');
  assert.equal(own.length,options.expectedLaunches??1,'No implicit correction query or unbound Native birth');assert.ok(own.every(l=>l.joined));assert.deepEqual(denied,[]);
  return {entries,selected,error,own,intent:expected,framing,providerError:product.session.messages.at(-1)?.errorMessage};
 }finally{await product.closeOwned();}
}
function completeText(launch,raw,{stop=true,failed=false,exitCode=0,outputTokens=20,fragment=11}={}){
 const mid='text-'+randomUUID(),event=event=>launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event});
 event({type:'message_start',message:{id:mid,type:'message',role:'assistant',content:[],model:'claude-sonnet-4-6',usage:{input_tokens:1,output_tokens:0}}});
 event({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
 for(let i=0;i<raw.length;i+=fragment)event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:raw.slice(i,i+fragment)}});
 launch.text(raw,mid);event({type:'content_block_stop',index:0});event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:outputTokens}});if(stop)event({type:'message_stop'});
 launch.exitCode=exitCode;launch.finish(undefined,{result:failed?'Controlled original Native failure':raw,is_error:failed});
}

for (const mode of ['original-text','corrected','failed-settlement']) check('current review witness feedback: '+mode,async t=>{
 const submission=mode!=='original-text';
 if(!submission)useTextFixture(t);
 const {prepareSubjectActionInput}=await load('workflow/subject-actions.js');
 const subject='actual-retained-review-finding';
 const context=prepareSubjectActionInput('adjudicator',{
  stage:'review-adjudication',reviewResolutionInput:{version:3},subjectActionsInput:{version:2},baseVersion:'ORIGINAL-BASE',
  decisionReferences:{version:3,occurrenceIds:[subject],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]},
  occurrences:[{id:subject,data:{finding:{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Rejected current allegation from controlled original review',evidence:['retained factual source']}}}]
 });
 const rejected={disposition:'rejected',reason:'Original read supports the adjudicated outcome',witnesses:[]};
 const output={...value,subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:{s0:rejected}};
 const bad=JSON.stringify(output),good=JSON.stringify({...output,decisionActions:{s0:{...rejected,witnesses:['retained factual source']}}});
 let acceptedProvisional=false;
 const f=await produce(async launch=>{
  if(!submission){completeText(launch,bad);return;}
  const strings=value=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
  const system=strings(launch.frames).find(text=>text.includes('You are the assigned adjudicator'));
  assert.match(system,/call gitjig_submit_role_result on its own/);
  assert.doesNotMatch(system,/whole-answer lowercase json fence/);
  const extraValue='Untrusted submission value must stay out of feedback';
  const malformed=JSON.stringify({...output,decisionActions:{s0:{...rejected,extra:extraValue}}});
  const shapeRefusal=await submitRole(launch,malformed);
  assert.equal(shapeRefusal.isError,true);
  const shapeFeedback=shapeRefusal.content[0].text;
  assert.match(shapeFeedback,/PROTOCOL:.*unexpected \["extra"\]/);
  assert.match(shapeFeedback,/decisionActions entry:/);
  assert.doesNotMatch(shapeFeedback,/decisions\[0\]/);
  assert.ok(!shapeFeedback.includes(extraValue));
  const first=await submitRole(launch,bad);
  assert.equal(first.isError,true);assert.match(JSON.stringify(first),/DECISION_EVIDENCE.*Disposition needs retained reason\/witness/);
  assert.notEqual((await submitRole(launch,good)).isError,true);
  acceptedProvisional=true;
  if(mode==='failed-settlement')launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:'Original review stopped after provisional receipt'});
  else launch.finish(undefined,{result:'Original review query settled normally.'});
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:4,maxNativeTurns:5});
 assert.equal(f.launches.length,1);assert.ok(f.launches.every(launch=>launch.joined));
 assert.equal(f.result.usable,mode==='corrected',JSON.stringify(f.result.issues));
 if(!submission){assert.equal(f.result.rawFinal,bad);assert.match(f.result.issues.join(),/DECISION_EVIDENCE/);return;}
 assert.equal(acceptedProvisional,true);
 if(mode==='failed-settlement'){assert.equal(f.result.nativeSource,undefined);return;}
 assert.equal(f.result.nativeSource.kind,'claude-sdk-tool-submission/v1');
 assert.equal(f.result.rawFinal,good);assert.equal(f.result.protocol.decisions[0].occurrenceId,subject);
 const intent=f.entries.find(entry=>entry.customType===nativeRoleEntries.intent);
 const materials=nativeRoleMaterial(f.entries,intent.id).materials.filter(material=>material.selector==='submission-arguments');
 assert.equal(materials.length,3);assert.deepEqual(materials.slice(-2).map(m=>m.raw),[bad,good]);
});
for(const newFinding of [false,true]) check('current review witness feedback at Controller resolution, new finding='+newFinding,async t=>{
 const inputFor=launch=>{
  const content=launch.frames.find(frame=>frame.type==='user').message.content;
  const text=typeof content==='string'?content:content.filter(part=>part.type==='text').map(part=>part.text).join('');
  return JSON.parse(text.split('\n')[1]);
 };
 const original={...finding('Original ordinary reviewer finding'),requirementId:'owner-request'};
 const newlyReceived={...finding('New distinct finding from rejected review decision'),requirementId:'owner-request'};
 const f=await driveDecisionCarryProposal(t);
 const {state,plan}=assertDecisionCarryPlan(f),{s,core,workId}=f,base=core.version(state.base);
 // Use controlled candidate bytes and engine reports; planned and reviewed evidence enters the real controller.
 const candidate=core.newVersion(workId,'candidate',base.artifact,{manifest:base.data.manifest,delta:{files:[],directories:{before:[],after:[]}},producer:'controlled boundaries'},base.hash,state.base);
 s.run('UPDATE change_state SET candidate=?,phase=? WHERE work=?',candidate,'CANDIDATE_CAPTURED',workId);
 const baseScope=globalThis.__nativeRoleFormatScope;
 globalThis.__nativeRoleFormatScope=async options=>{
  const scope=await baseScope(options);
  if(options.inputRoot)scope.execute=async()=>{
   const declaration=plan.data.plan.verification.checks[0];
   const descriptor=JSON.parse(fs.readFileSync(path.join(options.inputRoot,'verification-cases.json'),'utf8'));
   const output={version:1,assertions:declaration.assertions.map(id=>({id,passed:true})),cases:descriptor.cases.map(row=>({id:row.id,inputDigest:row.inputDigest,observed:declaration.cases.find(c=>c.id===row.id).expected}))};
   return {exitCode:0,stdout:JSON.stringify(output),stderr:''};
  };
  return scope;
 };
 const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(appHome,'artifacts');
 t.after(()=>{process.env.TMPDIR=previousTemp;globalThis.__nativeRoleFormatScope=baseScope;});
 const checked=await f.c.checkChange({workId,model});
 assert.equal(checked.phase,'CHECKED',JSON.stringify(checked.blocked));
 const verificationDecisions=input=>input.context.verificationReviewRequirements.map(row=>({requirementId:row.requirementId,strategyDigest:row.strategyDigest,verdict:'satisfied',reason:'Controlled captured verification receipt',witnessIds:row.witnessIds}));
 selectedScenario=async launch=>{
  const input=inputFor(launch);
  await completeRoleFixture(launch,{...value,outcome:'findings',findings:[original],assessedScope:input.requiredScope,verificationDecisions:verificationDecisions(input)});
 };
 const reviewed=await f.c.reviewChange({workId,model});
 assert.equal(reviewed.phase,'RESOLVING',JSON.stringify(reviewed.blocked));
 const reviewLaunch=s.one("SELECT id FROM role_launches WHERE work=? AND role='reviewer'",workId);
 const before=workAllowanceSnapshot(), priorDispositions=s.all('SELECT * FROM finding_dispositions').length;
 function workAllowanceSnapshot(){return s.all('SELECT kind,consumed,reserved FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',workId);}
 let bad,good;
 selectedScenario=async launch=>{
  const input=inputFor(launch);
  const ctx=input.context, subject=ctx.occurrences.find(row=>row.data.finding.description===original.description);
  assert.ok(subject);assert.equal(ctx.selectedReviewEvidence.reviews[0].launchId,reviewLaunch.id);
  const decision={disposition:'rejected',reason:'Actual selected outside-scope observation in fixture',witnesses:[]};
  const actions=Object.fromEntries(ctx.subjectActionsView.pendingOrdinaryKeys.map(key=>[key,{disposition:'upheld',resolution:'pending',reason:'Original BASE duties remain open',witnesses:[]}]));
  const output={...value,findings:newFinding?[newlyReceived]:[],assessedScope:input.requiredScope,verificationDecisions:verificationDecisions(input),subjectActionsHash:ctx.subjectActionsView.responseHash,decisionActions:{...actions,[subject.subjectKey]:decision}};
  bad=JSON.stringify(output);good=JSON.stringify({...output,findings:[],decisionActions:{...actions,[subject.subjectKey]:{...decision,witnesses:[reviewLaunch.id]}}});
  const refusal=await submitRole(launch,bad);
  assert.match(JSON.stringify(refusal),/DECISION_EVIDENCE.*Disposition needs retained reason\/witness/);
  assert.notEqual((await submitRole(launch,good)).isError,true);
  assert.equal(s.all('SELECT * FROM finding_dispositions').length,priorDispositions);
  launch.finish(undefined,{result:'Current independent review settled after one correction'});
 };
 const originalTmp=process.env.TMPDIR;process.env.TMPDIR=path.join(appHome,'artifacts');
 let result;
 try{result=await f.c.resolveChange({workId,model});}finally{process.env.TMPDIR=originalTmp;}
 assert.equal(result.phase,newFinding?'BLOCKED':'REPAIR_REQUIRED',JSON.stringify(result.blocked));
 const judge=s.one("SELECT * FROM role_launches WHERE work=? AND role='adjudicator' ORDER BY rowid DESC LIMIT 1",workId);
 assert.equal(judge.status,'COMPLETE');
 const outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',judge.id);
 const selected=outputs.find(row=>row.status==='usable'),earlier=outputs.find(row=>row.status==='accounted-intermediate');
 assert.equal(selected.raw,good);assert.equal(JSON.parse(selected.data).nativeSource.kind,'claude-sdk-tool-submission/v1');
 if(newFinding)assert.equal(earlier.raw,bad);
 assert.equal(result.occurrences.filter(row=>row.data.finding.description===newlyReceived.description).length,newFinding?1:0);
 assert.equal(result.dispositions.filter(row=>row.launch===judge.id&&row.status==='rejected').length,newFinding?0:1);
 assert.deepEqual(workAllowanceSnapshot().map(row=>row.consumed),before.map(row=>row.consumed+1));
 const run=s.one('SELECT * FROM runs WHERE id=?',judge.run), meta=JSON.parse(run.data), selection=JSON.parse(selected.data);
 const read=entries=>readSelectedRoleOutput(entries,{entryId:selection.nativeEntryId,sessionId:meta.nativeSessionId,launchId:judge.id,role:'adjudicator',stage:'review-adjudication',checkpointLeafId:meta.nativeCheckpoint.leafId,nativeIntent:JSON.parse(judge.data).nativeRoleIntent},selection.nativeSource);
 assert.equal(read(await core.nativeEntries(run.id)),good);
 await f.c.close();
 const {openController}=await load('controller/index.js');
 const reopened=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});
 try{assert.equal(read(await reopened.changeCore.nativeEntries(run.id)),good);}finally{await reopened.close();}

});

function declaredReviewBody(){
 return {...body,context:{stage:'review-adjudication',reviewResolutionInput:{version:1},decisionReferences:{version:3,occurrenceIds:['F'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]}}};
}
function readDeclaredReview(f){
 return readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'adjudicator',stage:'review-adjudication',checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource);
}
for(const variant of ['no-read','read','duplicate-findings'])check('review grammar2 retains whole fenced77-subject SDK source: '+variant,async()=>{
 const useRead=variant==='read',invalid=variant==='duplicate-findings';
 assert.equal(globalThis.__nativeRoleCarrier,undefined);
 const {prepareSubjectActionInput}=await load('workflow/subject-actions.js'),ids=Array.from({length:77},()=>randomUUID());
 const refs={version:3,occurrenceIds:ids,diagnosisOccurrenceIds:ids.slice(75),pendingOrdinaryIndexes:ids.slice(0,74).map((_,i)=>i),blockingOrdinaryIndexes:ids.slice(0,74).map((_,i)=>i),retentionChoices:ids.slice(74).map(occurrenceId=>({occurrenceId,dispositionId:randomUUID(),sha256:'a'.repeat(64)}))};
 const context=prepareSubjectActionInput('adjudicator',{stage:'review-adjudication',reviewResolutionInput:{version:2},subjectActionsInput:{version:1},metadataIdentityInput:{version:3},decisionReferences:refs,occurrences:ids.map(id=>({id}))});
 const observed={requirementId:'R1',severity:'blocking',repair:'substantive',description:'Original current observed claim',evidence:['captured-consumer']};
 const input={...body,context},output={...value,findings:[observed],subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:Object.fromEntries(ids.map((_,i)=>['s'+i,i>=74?'retain':i===0?{disposition:'upheld',resolution:'pending',reason:'Current exact duty',witnesses:['check']}:{disposition:'equivalent',equivalentTo:'s0',reason:'Same current duty',witnesses:['check']}]))};
 const second={...observed,description:'Second original received claim'};
 const json=JSON.stringify(output),wire=invalid?json.replace('"findings":'+JSON.stringify([observed]),'"findings":'+JSON.stringify([observed])+',"findings":'+JSON.stringify([second])):json;
 const raw='```json\n'+wire+'\n```';let reads=0;
 const ops={...operations,async access(){},async readFile(){reads++;return Buffer.from('Current consumer');}};
 const f=await produce(async launch=>{
  assert.equal(launch.options.args.includes('--json-schema'),false);
  const content=launch.frames.find(x=>x.type==='user').message.content,text=typeof content==='string'?content:content.filter(x=>x.type==='text').map(x=>x.text).join('');
  const supplied=JSON.parse(text.split('\n')[1]).context;assert.equal(supplied.metadataIdentityInput.version,3);if(supplied.metadataIdentityEncoding)assert.equal(supplied.metadataIdentityEncoding.version,3);assert.deepEqual(readFixtureMetadataContext(supplied),context);
  if(useRead)await launch.read({path:'consumer.txt'});
  completeText(launch,raw);
 },{role:'adjudicator',inputBundle:input,operations:ops,maxProviderRequests:useRead?2:1});
 assert.equal(f.result.usable,!invalid,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.equal(readDeclaredReview(f),raw);
 if(invalid)assert.match(f.result.issues.join(),/duplicate/);
 else{
 assert.equal(f.result.protocol.decisions.length,74);assert.deepEqual(f.result.protocol.retainedDispositions,refs.retentionChoices.map(x=>x.dispositionId));
 assert.equal(f.result.protocol.decisions[0].occurrenceId,ids[0]);assert.equal(f.result.protocol.decisions[0].resolution,undefined);assert.equal(f.result.protocol.decisions[1].equivalentTo,ids[0]);
 }
 assert.equal(reads,useRead?1:0);assert.equal(f.checkpoints,useRead?2:1);assert.equal(f.launches.length,1);assert.ok(f.launches.every(l=>l.joined));
 if(!useRead){
  // Collection-only integration over the original owned SDK trace. This seeded
  // launch does not establish normal Controller admission or review standing.
  const {subjectActionFootprint}=await load('workflow/subject-actions.js'),c=await initializeController({installationHome:appHome});
  try{
   const source=path.join(root,'fenced-collection-'+randomUUID());fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.txt'),'Controlled source');
   const projectId='fenced-'+randomUUID();await c.registerProject({id:projectId,sourceRoot:source});const w=await c.beginChange({projectId,request:'Retain exact observed claims'}),run=c.inspectWork(w.workId).runs[0];
   const metadata={...context,subjectActionCaptureHash:subjectActionFootprint('adjudicator',context),nativeRoleIntent:f.intentReceipt};
   c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',f.result.launchId,w.workId,run.id,'adjudicator',w.epoch,'COMPLETE','none',JSON.stringify(metadata));
   const execution={...f.result};assert.equal(c.changeCore.harvestEntries(w.workId,f.result.launchId,'adjudicator',f.entries,execution,f.result.selectedFinalEntryId),true);
   assert.equal(execution.usable,!invalid,JSON.stringify(execution.issues));
   const id=c.changeCore.collect(w.workId,f.result.launchId,{...execution,nativeEntryId:f.result.selectedFinalEntryId},!invalid);
   const outputs=c.store.all('SELECT * FROM role_outputs WHERE launch=?',f.result.launchId);assert.equal(outputs.length,1);assert.equal(outputs[0].id,id);assert.equal(outputs[0].raw,raw);
   const claims=c.store.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',id);assert.equal(claims.length,invalid?3:1);assert.deepEqual(JSON.parse(claims[0].data).finding,observed);
   if(invalid){assert.deepEqual(JSON.parse(claims[1].data).finding,second);assert.equal(JSON.parse(claims[2].data).finding.requirementId,'producer-integrity');assert.equal(outputs[0].status,'unusable');}
  }finally{await c.close();}
 }
});
check('default review allows multi-turn totals above its per-response cap and larger model defaults',async()=>{
 const input=declaredReviewBody(),output={...value,decisions:[{occurrenceId:'F',disposition:'upheld',resolution:'pending',reason:'Retain current duty',witnesses:['check']}]},raw=JSON.stringify(output);
 let reads=0;const ops={...operations,async access(){},async readFile(){reads++;return Buffer.from('Captured consumer');}};
 const f=await produce(async launch=>{
  for(let i=0;i<2;i++)await launch.read({path:'consumer.txt'},20000);
  const finish=launch.finish;launch.finish=(v,o)=>finish(v,{...o,modelUsage:{'claude-sonnet-5':{maxOutputTokens:64000,outputTokens:60000}}});
  completeText(launch,raw,{outputTokens:20000});
 },{role:'adjudicator',inputBundle:input,operations:ops,maxProviderRequests:3});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(readDeclaredReview(f),raw);
 assert.equal(reads,2);assert.equal(f.checkpoints,3);assert.equal(f.launches.length,1);assert.ok(f.launches.every(l=>l.joined));
});
for(const resolution of ['pending','repaired'])for(const useRead of [false,true])check('fresh declared review uses default SDK text with '+resolution+' and read='+useRead,async()=>{
 assert.equal(globalThis.__nativeRoleCarrier,undefined,'Exercise production selection without a carrier override');
 const input=declaredReviewBody(),output={...value,decisions:[{occurrenceId:'F',disposition:'upheld',resolution,reason:'Exact current checked consumer',witnesses:['current-check']}]},raw=JSON.stringify(output);
 const {nativeRoleFraming}=await load('workflow/role-framing.js');let reads=0;
 const ops={...operations,async access(p){assert.equal(p,path.join(project,'consumer.txt'));},async readFile(p){assert.equal(p,path.join(project,'consumer.txt'));reads++;return Buffer.from('Original current consumer\n');}};
 const f=await produce(async launch=>{
  assert.equal(launch.options.args.includes('--json-schema'),false);
  assert.equal(launch.tools.some(t=>t.name==='StructuredOutput'),false);
  if(useRead)assert.ok(JSON.stringify(await launch.read({path:'consumer.txt'})).includes('Original current consumer'));
  completeText(launch,raw);
 },{role:'adjudicator',inputBundle:input,operations:ops,maxProviderRequests:useRead?2:1});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);
 assert.equal(f.result.protocol.decisions[0].resolution,resolution==='pending'?undefined:'repaired');
 assert.equal(f.result.nativeSource.kind,'claude-sdk-assistant-json/v1');assert.equal(readDeclaredReview(f),raw);
 const settled=f.entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation;
 const expected=nativeRoleFraming('adjudicator',input,f.result.launchId,3).intent;
 assert.deepEqual(settled.format.request,expected);assert.equal(settled.format.request.binding.nativeEvidencePolicy,'raw-envelope/v1');assert.equal(settled.nativeCleanup,'confirmed');
 assert.equal(reads,useRead?1:0);assert.equal(f.checkpoints,useRead?2:1);assert.equal(f.launches.length,1);assert.ok(f.launches.every(l=>l.joined));
});
for(const defect of ['wrapper','incomplete','error-result'])check('fresh declared default text retains '+defect+' without replacement or acceptance',async()=>{
 assert.equal(globalThis.__nativeRoleCarrier,undefined);
 const raw=JSON.stringify(defect==='wrapper'?{arguments:value}:value);
 const f=await produce(launch=>completeText(launch,raw,{stop:defect!=='incomplete',failed:defect==='error-result'}),{role:'adjudicator',inputBundle:declaredReviewBody()});
 assert.equal(f.result.usable,false);assert.equal(f.launches.length,1);assert.ok(f.launches.every(l=>l.joined));
 if(defect==='wrapper'){assert.equal(f.result.rawFinal,raw);assert.equal(readDeclaredReview(f),raw);}
 assert.equal(f.entries.filter(e=>e.customType===nativeRoleEntries.settlement).length,1);
});
check('declared review historical formatter source keeps its recorded request after default changes',async t=>{
 globalThis.__nativeRoleCarrier='formatter/v1';t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const input=declaredReviewBody(),output={...value,decisions:[{occurrenceId:'F',disposition:'upheld',resolution:'pending',reason:'Retain original duty',witnesses:['check']}]},raw=JSON.stringify(output);
 const f=await produce(launch=>{assert.ok(launch.options.args.includes('--json-schema'));launch.format(raw);launch.finish(output);},{role:'adjudicator',inputBundle:input});
 delete globalThis.__nativeRoleCarrier;
 assert.equal((await load('workflow/role-framing.js')).nativeRoleFraming('adjudicator',input,f.result.launchId,3).intent.version,2);
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.nativeSource.kind,'claude-sdk-formatter/v1');
 assert.equal(readDeclaredReview(f),raw);
});
for(const useRead of [false,true])check('explicit text carrier uses owned SDK '+(useRead?'read and final text':'final text without tool use')+' without formatter capability',async()=>{
 const {parseRoleOutput}=await load('workflow/protocol.js'),{roleFraming}=await load('workflow/role-framing.js');const expectedFraming=roleFraming('reviewer',body);let reads=0;
 const ops={...operations,async access(p){assert.equal(p,path.join(project,'consumer.txt'));},async readFile(p){assert.equal(p,path.join(project,'consumer.txt'));reads++;return Buffer.from('Captured project consumer\n');}};
 const raw=' \n'+JSON.stringify(value)+'\n';
 const f=await capturedTextRole(async launch=>{
  assert.equal(launch.options.args.includes('--json-schema'),false);assert.equal(launch.options.args[launch.options.args.indexOf('--max-turns')+1],'3');
  assert.equal(launch.tools.some(t=>t.name==='StructuredOutput'),false);
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const nativeSystem=strings(launch.frames).find(v=>v.includes('Final RoleOutput JSON Schema: '));
  assert.ok(nativeSystem,'Original outbound SDK frames must deliver the full text-role schema');
  assert.equal(nativeSystem.split(JSON.stringify(expectedFraming.schema)).length,2,'Schema delivered once through original SDK');
  const user=launch.frames.find(frame=>frame.type==='user').message.content;
  const nativeInput=typeof user==='string'?user:user.filter(part=>part.type==='text').map(part=>part.text).join('');
  assert.equal(nativeInput,expectedFraming.prompt,'Actual SDK input matches the frozen wire-input commitment');
  const permission=await launch.permission('StructuredOutput',value);assert.equal(permission.response.behavior,'deny');
  if(useRead){const response=await launch.read({path:'consumer.txt'});assert.ok(JSON.stringify(response).includes('Captured project consumer'),JSON.stringify(response));}
  completeText(launch,raw);
 },{operations:ops,repeat:!useRead,beforeRequest(intent){intent.schema={type:'object',properties:{mutated:{type:'string'}}};intent.carrier='caller-mutated';}});
 assert.equal(f.selected.raw,raw);assert.equal(parseRoleOutput(raw,'reviewer').value.summary,value.summary);assert.equal(reads,useRead?1:0);
 const init=f.entries.find(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.subtype==='init');assert.ok(!init.data.message.tools.includes('StructuredOutput'));
 const settled=f.entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation;assert.deepEqual(settled.format.request,f.intent);assert.equal(settled.nativeCleanup,'confirmed');
 assert.equal(f.framing.systemPrompt.split(JSON.stringify(f.intent.schema)).length,2,'One full inline schema');
});
for(const raw of ['{"version":1,"version":1,"summary":"duplicate","findings":[],"assessedScope":[]}','{"version":1,"summary":"incomplete","findings":['])check('explicit text carrier retains unusable original JSON without an automatic repair: '+raw.slice(0,23),async()=>{
 const {parseRoleOutput}=await load('workflow/protocol.js');const f=await capturedTextRole(launch=>completeText(launch,raw));assert.equal(f.selected.raw,raw);assert.equal(parseRoleOutput(raw,'reviewer').value,null);
});
for(const kind of ['incomplete-stream','error-result','failed-iterator'])check('explicit text carrier refuses '+kind+' while retaining its original settlement',async()=>{
 const f=await capturedTextRole(launch=>completeText(launch,JSON.stringify(value),{stop:kind!=='incomplete-stream',failed:kind!=='incomplete-stream',exitCode:kind==='failed-iterator'?1:0}),{expectUnavailable:true});assert.equal(f.selected,undefined);assert.match(f.error,/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
 assert.equal(f.entries.filter(e=>e.customType===nativeRoleEntries.settlement).length,1);
});
check('explicit text carrier source mismatch refuses before fake Native birth',async()=>{
 const f=await capturedTextRole(launch=>completeText(launch,JSON.stringify(value)),{expectUnavailable:true,expectedLaunches:0,prompt:'Different text from original frozen framing'});assert.equal(f.selected,undefined);assert.match(f.providerError,/NATIVE_ROLE_INPUT_MISMATCH/);
});
check('explicit text carrier refuses an unrequested native formatter in the startup tool surface',async()=>{
 const f=await capturedTextRole(launch=>launch.finish(undefined,{is_error:true,result:'Unrequested native tool declaration'}),{expectUnavailable:true,extraNativeTools:['StructuredOutput']});assert.equal(f.selected,undefined);assert.match(f.error,/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);assert.match(f.providerError,/BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: tools/);
});
for(const variant of ['unknown-carrier','unknown-key','wrong-root','legacy-with-carrier'])check('explicit text carrier '+variant+' refuses before fake Native birth',async()=>{
 const {createPiSession}=await load('pi/session.js'),launchId=randomUUID(),before=launches.length,intent={version:2,carrier:'assistant-json/v1',requestId:launchId,binding:{launchId,role:'reviewer',stage:'fresh-review',inputDigest:sha('No birth')},schema:{type:'object'},maxNativeTurns:3};let product,error;
 if(variant==='unknown-carrier')intent.carrier='unknown';if(variant==='unknown-key')intent.unknown=true;if(variant==='wrong-root')intent.schema={type:'array'};if(variant==='legacy-with-carrier')intent.version=1;
 selectedScenario=()=>assert.fail('Malformed original request cannot launch');
 try{product=await createPiSession({host,operations,model,maxReadBytes:1024,systemPrompt:'No request.',roleContextBudget:{assertEntry(){},structuredOutput:{intent,observe(){assert.fail('No producer evidence before native birth');}}},beforeModelRequest:async()=>{}});await product.session.prompt('No birth');error=product.session.messages.at(-1).errorMessage;}catch(cause){error=String(cause);}finally{await product?.closeOwned();}
 assert.equal(launches.length,before);assert.match(error,/NATIVE_RESPONSE_CARRIER_UNSUPPORTED|NATIVE_ROLE_SCHEMA_UNSUPPORTED|BRIDGE_STRUCTURED_REQUEST_UNAVAILABLE/);
});

check('explicit text carrier checkpoint-time original input drift refuses before fake Native birth',async()=>{
 const f=await capturedTextRole(()=>assert.fail('Changed original input cannot launch'),{expectUnavailable:true,expectedLaunches:0,beforeRequest(_intent,manager){const input=manager.getBranch().find(e=>e.type==='message'&&e.message.role==='user');input.message.content=[{type:'text',text:'Checkpoint-time input replacement'}];}});
 assert.equal(f.selected,undefined);assert.match(f.providerError,/NATIVE_ROLE_INPUT_MISMATCH/);
});

for(const mutation of ['extra-user','nontext-attachment','sparse-text'])check('explicit text carrier '+mutation+' at checkpoint refuses before fake Native birth',async()=>{
 const f=await capturedTextRole(()=>assert.fail('Unbound original input cannot launch'),{expectUnavailable:true,expectedLaunches:0,beforeRequest(_intent,manager){
  if(mutation==='extra-user')manager.appendMessage({role:'user',content:'A second request is not this role input',timestamp:Date.now()});
  else{const input=manager.getBranch().find(e=>e.type==='message'&&e.message.role==='user');
   if(mutation==='sparse-text'){const original=typeof input.message.content==='string'?input.message.content:input.message.content.map(b=>b.text).join('');input.message.content=[{type:'text',text:original}];input.message.content.length=2;}
   else input.message.content=[{type:'text',text:'Text cannot hide an attachment'},{type:'image',mimeType:'image/png',data:'AA=='}];
  }
 }});
 assert.equal(f.selected,undefined);assert.match(f.providerError,/NATIVE_ROLE_INPUT_MISMATCH/);
});


function chooseTextFactory(t){
 globalThis.__nativeRoleCarrier='assistant-json/v1';globalThis.__nativeFramingCalls=[];
 t.after(()=>{delete globalThis.__nativeRoleCarrier;delete globalThis.__nativeFramingCalls;});
}
function planningTextInput(launch,version=2){
 const content=launch.frames.find(f=>f.type==='user').message.content,text=typeof content==='string'?content:content.filter(b=>b.type==='text').map(b=>b.text).join('');
 const wire=JSON.parse(text.split('\n').find(line=>line.startsWith('{"requirements":'))),input={...wire,context:readFixtureMetadataContext(wire.context)};
 const role=input.context.stage==='planning'?'planner':input.context.stage==='planning-challenge'?'challenger':'adjudicator';
 const original=globalThis.__nativeFramingCalls.findLast(call=>call.role===role&&call.id!=='preallocation-estimate');
 assert.equal(original.version,version);assert.equal(original.prompt,text);if(version===2){assert.equal(original.inputDigest,sha(text));assert.ok(original.systemPrompt.includes(original.schema));const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];const served=strings(launch.frames).find(v=>v.includes('Final RoleOutput JSON Schema: '));assert.ok(served);assert.equal(served.split(original.schema).length,2,'One complete schema reaches the actual Controller SDK query');}assert.equal(launch.options.args.includes('--json-schema'),version===1);
 return {input,role};
}
function planningTextOutput(input,role,accept=false){
 const output={...value,assessedScope:input.requiredScope};
 if(role==='planner'){output.plan=preserveExportPlan();if(input.context.candidateVersion){output.plan.intent='Retain captured candidate export3';output.plan.requirements[0].text='Consumer exports3';output.plan.factualSources=['candidate:consumer.cjs'];for(const c of output.plan.verification.checks[0].cases)c.expected.value='3';}}
 if(role==='challenger')output.alternatives=['Retain existing export'];
 if(role==='adjudicator'){output.planAccepted=accept;output.decisions=[];if(accept)output.acceptedPlan=input.context.planProposal;}
 return writeFixtureVerificationDomain(output,input.context);
}
async function textPlanningProject(t,retainedCandidate=false){
 chooseTextFactory(t);const c=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>c.close());
 const source=path.join(root,'text-planning-'+randomUUID()),projectId='text-'+randomUUID();fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.cjs'),'module.exports=2;\n');
 await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:retainedCandidate?'Consumer exports3':'Preserve controlled export2 behavior.',executionLimit:10,resolutionLimit:6});
 if(retainedCandidate){const candidateSource=path.join(root,'candidate-'+randomUUID()),target=path.join(appHome,'inputs',randomUUID());fs.cpSync(source,candidateSource,{recursive:true});fs.writeFileSync(path.join(candidateSource,'consumer.cjs'),'module.exports=3;\n');const {freeze}=await load('controller/change-files.js'),receipt=await freeze(candidateSource,target,JSON.parse(c.store.one('SELECT profile FROM projects WHERE id=?',projectId).profile)),base=c.store.one('SELECT base FROM change_state WHERE work=?',workId).base;const candidate=c.changeCore.newVersion(workId,'candidate',target,{manifest:receipt.manifest,producer:'controlled-retained-candidate'},receipt.digest,base);c.store.run('UPDATE change_state SET candidate=? WHERE work=?',candidate,workId);}
 return {c,workId};
}
check('text factory public Controller adopts independent P/C/J and rereads exact retained producers after reopen',async t=>{
 const {c,workId}=await textPlanningProject(t),before=launches.length;
 selectedScenario=launch=>{const {input,role}=planningTextInput(launch);completeText(launch,JSON.stringify(planningTextOutput(input,role,true)));};
 const result=await c.planChange({workId,model});assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.ok(result.planVersion);assert.equal(result.execution.consumed,4,'Original BASE capture plus three independent roles');assert.equal(launches.length,before+3);
 const records=c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId);assert.deepEqual(records.map(r=>r.role),['planner','challenger','adjudicator']);
 const outputs=records.map(l=>c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",l.id));
 for(let i=0;i<records.length;i++){const l=records[i],d=JSON.parse(l.data),o=JSON.parse(outputs[i].data);assert.equal(l.status,'COMPLETE');assert.equal(o.nativeSource.kind,'claude-sdk-assistant-json/v1');assert.ok(d.nativeRoleDispatchCheckpoint);assert.equal(d.nativeRoleIntent.requestDigest,o.nativeSource.requestDigest);assert.equal((await c.changeCore.historicalPlanningProducer(workId,outputs[i].id)).output.raw,outputs[i].raw);}
 assert.ok(globalThis.__nativeFramingCalls.filter(call=>call.id==='preallocation-estimate').length>=3);assert.ok(globalThis.__nativeFramingCalls.every(call=>call.version===2&&call.inputDigest===sha(call.prompt)));
 const budget=c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',workId);await c.close();delete globalThis.__nativeRoleCarrier;
 const reopened=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
 for(const o of outputs)assert.equal((await reopened.changeCore.historicalPlanningProducer(workId,o.id)).output.raw,o.raw);
 reopened.changeCore.restoreAcceptedPlan(workId);
 assert.deepEqual(reopened.changeCore.strategies(workId),JSON.parse(reopened.store.one('SELECT data FROM change_versions WHERE id=?',result.planVersion).data).plan.verification.strategies);
 const judgment=outputs.at(-1),saved=judgment.data,changed=JSON.parse(saved);changed.nativeSource.rawDigest='0'.repeat(64);reopened.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(changed),judgment.id);
 try{assert.throws(()=>reopened.changeCore.restoreAcceptedPlan(workId),/Original retained planning output/);assert.throws(()=>reopened.changeCore.strategies(workId),/Original retained planning output/);}finally{reopened.store.run('UPDATE role_outputs SET data=? WHERE id=?',saved,judgment.id);}
 assert.equal(reopened.inspectChange(workId).planVersion,result.planVersion);assert.deepEqual(reopened.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',workId),budget);assert.equal(launches.length,before+3);
});
for(const retainedCandidate of [false,true])for(const failedRole of ['challenger','adjudicator'])check('text factory public Controller reuses the exact planning prefix after '+failedRole+' failure; captured candidate='+retainedCandidate,async t=>{
 const {c,workId}=await textPlanningProject(t,retainedCandidate);const candidate=c.store.one('SELECT candidate FROM change_state WHERE work=?',workId).candidate,candidateRow=candidate&&c.store.one('SELECT * FROM change_versions WHERE id=?',candidate);let mode='fail';const calls=[];
 selectedScenario=launch=>{const {input,role}=planningTextInput(launch);calls.push({mode,role});const output=planningTextOutput(input,role);if(mode==='fail'&&role===failedRole)output.unexpected='Controlled original text refusal';completeText(launch,JSON.stringify(output));};
 const first=await c.planChange({workId,model});assert.equal(first.phase,'BLOCKED');const p=c.store.one("SELECT * FROM role_launches WHERE work=? AND role='planner'",workId),output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",p.id);assert.equal(JSON.parse(output.data).nativeSource.kind,'claude-sdk-assistant-json/v1');
 mode='resume';const next=await c.driveChange({workId,model,maximumSteps:1});assert.deepEqual(calls.filter(call=>call.mode==='resume').map(call=>call.role),failedRole==='challenger'?['challenger','adjudicator']:['adjudicator'],JSON.stringify(next.blocked));
 assert.equal(next.execution.consumed-first.execution.consumed,failedRole==='challenger'?2:1);assert.equal(next.phase,'BLOCKED');assert.equal(next.planVersion,null);assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);assert.equal(next.candidateVersion,candidate);if(candidate)assert.deepEqual(c.store.one('SELECT * FROM change_versions WHERE id=?',candidate),candidateRow);
});
check('text factory public exhausted-work recovery retains wrapped claims without retry or duplicate charge',async t=>{
 chooseTextFactory(t);const raw=JSON.stringify({answer:{...value,plan:mixedPlan(),findings:[finding('ORIGINAL WRAPPED TEXT CLAIM')]}});
 const f=await controllerRole(t,launch=>completeText(launch,raw));assert.equal(f.launch.status,'UNUSABLE');assert.equal(f.outcome.planVersion,null);
 const s=f.c.store,claims=()=>s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),known=()=>claims().filter(o=>JSON.parse(o.data).finding.description==='ORIGINAL WRAPPED TEXT CLAIM');assert.ok(known().length>=1);
 s.run('UPDATE budgets SET lim=consumed WHERE lineage=? AND kind=?',f.workId,'execution');const budget=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),before=launches.length,original=known();
 await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(launches.length,before);assert.deepEqual(known(),original);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budget);
 const missing=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' ORDER BY rowid LIMIT 1",f.launch.id);assert.ok(missing);
 // Simulate missing old accounting only in this controlled fixture. Source,
 // original histories, remaining occurrence IDs and consumed allowance persist.
 s.tx(()=>{for(const o of s.all('SELECT id FROM finding_occurrences WHERE output=?',missing.id)){s.run('DELETE FROM obligations WHERE id=?',o.id);s.run('DELETE FROM finding_occurrences WHERE id=?',o.id);}s.run('DELETE FROM role_outputs WHERE id=?',missing.id);});
 const retained=known();await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.equal(known().length,original.length);for(const row of retained)assert.deepEqual(s.one('SELECT * FROM finding_occurrences WHERE id=?',row.id),row);
 const repaired=known();await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.deepEqual(known(),repaired);assert.equal(launches.length,before);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budget);
 for(const claim of known()){const original=await f.c.changeCore.historicalPlanningProducer(f.workId,claim.output);assert.ok(original.receivedFindings.some(value=>value.description==='ORIGINAL WRAPPED TEXT CLAIM'));assert.ok(original.witness.initialView.userEntryId);original.assertCurrent();}
});

check('text factory public Controller reuses original v1 P/C with a fresh v2 judgment',async t=>{
 const {c,workId}=await textPlanningProject(t);globalThis.__nativeRoleCarrier='formatter/v1';let mode='old';const calls=[];
 selectedScenario=launch=>{const {input,role}=planningTextInput(launch,mode==='old'?1:2);calls.push({mode,role});const output=planningTextOutput(input,role);if(mode==='old'&&role==='adjudicator')output.unexpected='Original v1 judgment is unusable';if(mode==='old'){launch.format(JSON.stringify(output));launch.finish(output);}else completeText(launch,JSON.stringify(output));};
 const first=await c.planChange({workId,model});assert.equal(first.phase,'BLOCKED');const old=c.store.all("SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND o.status='usable' ORDER BY l.rowid",workId);assert.equal(old.length,2);assert.ok(old.every(o=>JSON.parse(o.data).nativeSource.kind==='claude-sdk-formatter/v1'));
 mode='new';globalThis.__nativeRoleCarrier='assistant-json/v1';const next=await c.driveChange({workId,model,maximumSteps:1});assert.deepEqual(calls.filter(call=>call.mode==='new').map(call=>call.role),['adjudicator'],JSON.stringify(next.blocked));assert.equal(next.execution.consumed-first.execution.consumed,1);
 for(const o of old)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',o.id),o);
 const judgment=c.store.one("SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role='adjudicator' ORDER BY l.rowid DESC LIMIT 1",workId);assert.equal(JSON.parse(judgment.data).nativeSource.kind,'claude-sdk-assistant-json/v1');
});

for(const drift of ['none','selector','source-entry','roster','legacy-layout','dispatch','primary-missing','primary-duplicate','primary-raw','primary-during-read','primary-after-proof','history-during-read','history-after-proof'])check('text factory corroborated wrapped INITIAL refuses drift: '+drift,async t=>{
 chooseTextFactory(t);const raw=JSON.stringify({answer:{...value,plan:mixedPlan(),findings:[finding('EXACT WRAPPED INITIAL CLAIM')]}}),f=await controllerRole(t,launch=>completeText(launch,raw)),s=f.c.store,core=f.c.changeCore;
 const source=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' ORDER BY rowid",f.launch.id).find(o=>JSON.parse(o.data).materialSources[0].selector.startsWith('assistant-text:')),primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id),metadata=JSON.parse(source.data);
 if(drift==='selector'||drift==='source-entry'){
  const locations=metadata.materialSources.map(({findingPath,memberPath,index})=>({findingPath,memberPath,index})),{findingPath,memberPath,index,...original}=metadata.materialSources[0];
  if(drift==='selector')original.selector='formatter-arguments';else{original.sourceEntryId='foreign-entry';metadata.nativeEntryId='foreign-entry';}
  metadata.materialSources=locations.map(location=>({...original,...location}));metadata.accountingKey=sha(JSON.stringify({source:original,locations}));s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),source.id);
 }
 if(drift==='legacy-layout'){delete metadata.accountingKey;s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),source.id);}
 if(drift==='roster'){const row=s.one('SELECT * FROM finding_occurrences WHERE output=? AND ordinal=0',source.id),data=JSON.parse(row.data);data.finding.description='Not in the original received bytes';s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),row.id);}
 if(drift==='dispatch'){const data=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data);data.nativeRoleIntent.requestDigest='0'.repeat(64);s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),f.launch.id);}
 if(drift==='primary-missing')s.run('UPDATE role_outputs SET status=? WHERE id=?','accounted-intermediate',primary.id);
 if(drift==='primary-duplicate')s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',randomUUID(),primary.launch,primary.raw,primary.status,primary.data);
 if(drift==='primary-raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?',primary.raw+' ',primary.id);
 const budget=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),births=launches.length;
 if(drift.endsWith('after-proof')){
  const original=await core.historicalPlanningProducer(f.workId,source.id);
  if(drift==='primary-after-proof')s.run('UPDATE role_outputs SET raw=? WHERE id=?',primary.raw+' ',primary.id);else fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');
  assert.throws(()=>original.assertCurrent(),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);
 }else if(drift!=='none'){
  const original=core.nativeEntries;let injected=false;
  if(drift.endsWith('during-read'))core.nativeEntries=async function(...args){const entries=await original.apply(this,args);injected=true;if(drift==='primary-during-read')s.run('UPDATE role_outputs SET raw=? WHERE id=?',primary.raw+' ',primary.id);else fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');return entries;};
  try{await assert.rejects(core.historicalPlanningProducer(f.workId,source.id),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);}finally{core.nativeEntries=original;}
  if(drift.endsWith('during-read'))assert.ok(injected);
 }else{
  const original=await core.historicalPlanningProducer(f.workId,source.id);assert.equal(original.witness.materialSource.corroboratingOutputId,primary.id);assert.equal(original.receivedFindings[0].description,'EXACT WRAPPED INITIAL CLAIM');assert.ok(original.witness.initialView.userEntryId);original.assertCurrent();
 }
 assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budget);assert.equal(JSON.parse(s.one('SELECT data FROM role_outputs WHERE id=?',source.id).data).protocol,null);
});


for(const drift of ['none','region','receipt-source','location','missing-recipe','history-after-proof'])check('text factory partial fenced claim remains an observation: '+drift,async t=>{
 chooseTextFactory(t);
 const raw='Unassessed narration before the proposed reply.\n```json\n'+JSON.stringify({...value,plan:mixedPlan(),findings:[finding('ORIGINAL FENCED CLAIM')]})+'\n```';
 const f=await controllerRole(t,launch=>completeText(launch,raw)),s=f.c.store,core=f.c.changeCore;
 assert.equal(f.launch.status,'UNUSABLE');assert.equal(f.outcome.planVersion,null);
 const primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id),primaryMetadata=JSON.parse(primary.data);
 assert.equal(primary.raw,raw);assert.equal(primaryMetadata.protocol,null);assert.equal(primaryMetadata.nativeSource.kind,'claude-sdk-assistant-json/v1');
 const outputs=()=>s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' ORDER BY rowid",f.launch.id),known=()=>s.all('SELECT o.* FROM finding_occurrences o JOIN role_outputs r ON r.id=o.output WHERE r.launch=? ORDER BY o.rowid',f.launch.id).filter(o=>JSON.parse(o.data).finding.description==='ORIGINAL FENCED CLAIM');
 assert.equal(known().length,1,'Proven SDK result copy does not duplicate the selected assistant claim');
 const output=outputs().find(row=>JSON.parse(row.data).nativeTextProjection);assert.ok(output);const metadata=JSON.parse(output.data);assert.equal(metadata.nativeTextProjection.region.innerLiteralComplete,true);
 assert.ok(s.one('SELECT * FROM obligations WHERE id=?','raw-incomplete-'+f.launch.id+'-native-material'));
 assert.ok(s.one('SELECT * FROM obligations WHERE id=?','diagnostic-'+f.launch.id));
 assert.ok(core.materialAccountingCandidates(f.workId).some(row=>row.id===f.launch.id));
 const budget=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),births=launches.length,original=known();
 if(drift==='none'){
  for(let i=0;i<2;i++){
   const reply=f.c.inspectChange(f.workId);assert.equal(reply.phase,'BLOCKED');assert.deepEqual(known(),original);assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',primary.id),primary);
  }
  const observation=await core.historicalPlanningProducer(f.workId,output.id);assert.equal(observation.receivedFindings[0].description,'ORIGINAL FENCED CLAIM');assert.ok(observation.witness.materialSource.partialTextProjection);assert.match(observation.witness.materialSource.interpretation,/Individual literal observations only/);observation.assertCurrent();
 }else if(drift==='history-after-proof'){
  const observation=await core.historicalPlanningProducer(f.workId,output.id);fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');assert.throws(()=>observation.assertCurrent(),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);
 }else{
  if(drift==='region')metadata.nativeTextProjection.region.bodyStartByte++;
  if(drift==='receipt-source')metadata.nativeTextProjection.source.rawDigest='0'.repeat(64);
  if(drift==='missing-recipe')delete metadata.nativeTextProjection;
  if(drift==='location')metadata.materialSources[0].index++;
  s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),output.id);
  await assert.rejects(core.historicalPlanningProducer(f.workId,output.id),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);
 }
 assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budget);
});

for(const [owner,wrapped] of [['ACTIVE',false],['DELIVERED',false],['ACTIVE',true],['CANCELLED',false],['INTERRUPTED',false],['UNKNOWN',false],['BUSY',false]])check('text factory stale criteria conserves observations without executing: '+owner+':'+wrapped,async t=>{
 chooseTextFactory(t);const body=JSON.stringify({answer:{...value,plan:mixedPlan(),findings:[finding('STALE RULES ORIGINAL CLAIM')]}}),raw=wrapped?body:'Unassessed prefix\n```json\n'+body+'\n```';
 const f=await controllerRole(t,launch=>completeText(launch,raw)),s=f.c.store,core=f.c.changeCore;
 const primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id);
 const original=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' ORDER BY rowid LIMIT 1",f.launch.id);assert.ok(original);
 // An older full-asset identity is selected separately. The producer retains
 // its exact originally captured criteria/source/checkpoint and native bytes.
 const state=s.one('SELECT * FROM change_state WHERE work=?',f.workId),data=JSON.parse(state.data),prior=core.version(data.contractsVersion),priorData=structuredClone(prior.data);
 priorData.assets['DESIGN.md'].sha256=sha('Controlled prior full DESIGN identity');
 const stale=core.newVersion(f.workId,'contracts',null,priorData,sha(JSON.stringify(priorData.assets)),prior.id);
 s.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...data,contractsVersion:stale}),f.workId);
 // Missing accounting is a controlled premise, never a mutation of Native
 // evidence or an allowance reset. Keep all other original claim rows.
 s.tx(()=>{for(const row of s.all('SELECT id FROM finding_occurrences WHERE output=?',original.id)){s.run('DELETE FROM obligations WHERE id=?',row.id);s.run('DELETE FROM finding_occurrences WHERE id=?',row.id);}s.run('DELETE FROM role_outputs WHERE id=?',original.id);});
 if(owner!=='BUSY')s.run('UPDATE works SET state=? WHERE id=?',owner,f.workId);
 const beforeOwner=s.one('SELECT * FROM works WHERE id=?',f.workId),beforeState=s.one('SELECT * FROM change_state WHERE work=?',f.workId),budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),runs=s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',f.workId),births=launches.length;
 const known=()=>s.all('SELECT o.* FROM finding_occurrences o JOIN role_outputs r ON r.id=o.output WHERE r.launch=? ORDER BY o.rowid',f.launch.id).filter(o=>JSON.parse(o.data).finding.description==='STALE RULES ORIGINAL CLAIM'),remaining=known(),busy=core.h.busy;
 if(owner==='BUSY')core.h.busy=()=>true;
 try{
  const reply=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.ok(reply.blocked.some(reason=>/criteria/i.test(reason)),JSON.stringify(reply.blocked));
  assert.equal(known().length,remaining.length+(['ACTIVE','DELIVERED'].includes(owner)?1:0));
  const restored=known();await f.c.driveChange({workId:f.workId,model,maximumSteps:1});assert.deepEqual(known(),restored);
 }finally{core.h.busy=busy;}
 for(const row of remaining)assert.deepEqual(s.one('SELECT * FROM finding_occurrences WHERE id=?',row.id),row);
 assert.deepEqual(s.one('SELECT * FROM works WHERE id=?',f.workId),beforeOwner);assert.deepEqual(s.one('SELECT * FROM change_state WHERE work=?',f.workId),beforeState);
 assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',primary.id),primary);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budgets);assert.deepEqual(s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',f.workId),runs);assert.equal(launches.length,births);
});

for(const drift of [false,true])check('owned SDK synthetic rejection requires current raw assessment'+(drift?' through commit':''),async t=>{
 useFormatterFixture(t);
 let before;const f=await driveUnownedAssessment(t,drift?({source,s})=>{before=s.all('SELECT * FROM finding_dispositions ORDER BY rowid');fs.appendFileSync(JSON.parse(source.data).historyRef,'\n');}:undefined,true);
 if(drift){assert.equal(f.result.phase,'BLOCKED');assert.ok(f.core.pending(f.workId).some(o=>o.id===f.synthetic[0]));assert.deepEqual(f.s.all('SELECT * FROM finding_dispositions ORDER BY rowid'),before);}
 else{assert.equal(f.result.phase,'PLAN_READY',JSON.stringify(f.result.blocked));assert.equal(f.core.pending(f.workId).length,0);const row=f.s.one('SELECT * FROM finding_dispositions WHERE occurrence=?',f.synthetic[0]),data=JSON.parse(row.data);assert.equal(row.status,'rejected');assert.equal(data.resolution,undefined);assert.equal(data.diagnosisWitness.assessment,'rejected-raw-assessment/v1');assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.source.id),f.source);}
});

for(const drift of ['none','primary','projection','roster','subset','during-read','history-during-read','after-proof','history-after-proof','wrong-hold'])check('bounded raw assessment source: '+drift,async t=>{
 chooseTextFactory(t);const raw='Unassessed narration.\n```json\n'+JSON.stringify({...value,plan:mixedPlan(),findings:[finding('BOUND RAW ASSESSMENT CLAIM'),...(drift==='subset'?[finding('MISSING LITERAL CLAIM')]:[])]})+'\n```',f=await controllerRole(t,launch=>completeText(launch,raw)),s=f.c.store,core=f.c.changeCore;
 const hold='raw-incomplete-'+f.launch.id+'-native-material',primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id),projection=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id),md=JSON.parse(projection.data);
 if(drift==='primary')s.run('UPDATE role_outputs SET raw=raw || ? WHERE id=?',' ',primary.id);
 if(drift==='projection'){md.nativeTextProjection.region.bodyStartByte++;s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(md),projection.id);}
 if(drift==='roster'){const row=s.one('SELECT * FROM finding_occurrences WHERE output=?',projection.id),data=JSON.parse(row.data);data.finding.description='Not in the original raw';s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),row.id);}
 if(drift==='subset'){const row=s.one('SELECT * FROM finding_occurrences WHERE output=? AND ordinal=1',projection.id);s.run('DELETE FROM obligations WHERE id=?',row.id);s.run('DELETE FROM finding_occurrences WHERE id=?',row.id);md.harvestedFindings=md.harvestedFindings.slice(0,1);md.materialSources=md.materialSources.slice(0,1);const {findingPath,memberPath,index,...source}=md.materialSources[0];md.accountingKey=sha(JSON.stringify({source,locations:[{findingPath,memberPath,index}],nativeTextProjection:md.nativeTextProjection}));s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(md),projection.id);}
 if(drift==='during-read'||drift==='history-during-read'){const read=core.nativeEntries.bind(core);core.nativeEntries=async(...args)=>{const entries=await read(...args);if(drift==='during-read')s.run('UPDATE role_outputs SET raw=raw || ? WHERE id=?',' ',primary.id);else fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');return entries;};}
 const tables=s.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r=>r.name),snapshot=()=>tables.map(name=>s.all('SELECT * FROM "'+name+'" ORDER BY rowid')),before=snapshot(),births=launches.length;
 if(drift==='none'||drift.endsWith('after-proof')){
  const target=await core.rawAssessmentMaterial(f.workId,hold);assert.equal(target.raw,raw);assert.equal(target.primaryOutputId,primary.id);assert.equal(target.projectedOccurrenceIds.length,1);assert.equal(target.originOccurrenceIds.length,2);assert.deepEqual(target.originalMaterialOccurrenceIds,[]);assert.equal(target.source.kind,'claude-sdk-assistant-json/v1');assert.equal(target.partialTextProjection.region.innerLiteralComplete,true);assert.deepEqual(snapshot(),before);
  if(drift==='after-proof')s.run('UPDATE role_outputs SET raw=raw || ? WHERE id=?',' ',primary.id);else if(drift==='history-after-proof')fs.appendFileSync(JSON.parse(f.run.data).historyRef,'\n');
  if(drift==='none')target.assertCurrent();else assert.throws(target.assertCurrent,/RAW_ASSESSMENT_SOURCE_UNAVAILABLE/);
 }else{
  await assert.rejects(core.rawAssessmentMaterial(f.workId,drift==='wrong-hold'?'foreign-hold':hold));
  if(!drift.includes('during-read'))assert.deepEqual(snapshot(),before);
 }
 assert.equal(launches.length,births);assert.equal(s.one('SELECT * FROM obligations WHERE id=?',hold).data,JSON.stringify(JSON.parse(before[tables.indexOf('obligations')].find(o=>o.id===hold).data)));
 assert.ok(core.pending(f.workId).some(o=>o.id===hold));
});

async function prepareRawAssessment(t,{outside=false,empty=false}={}){
 chooseTextFactory(t);const raw='Original narration is part of the assessment.\n```json\n'+JSON.stringify({...value,plan:mixedPlan(),findings:empty?[]:[finding('ORIGINAL RAW ASSESSMENT SUBJECT')]})+'\n```';
 const f=await controllerRole(t,launch=>completeText(launch,raw),'planner',{stage:'fresh-review'},outside?async(c,workId)=>{
  selectedScenario=launch=>completeText(launch,JSON.stringify({...value,alternatives:[],findings:[finding('OUTSIDE ASSESSMENT COHORT')]}));
  await c.changeCore.operation({workId,model},'plan',async()=>{await c.changeCore.role({workId,model},'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});return c.changeCore.inspect(workId);});
 }:undefined);globalThis.__nativeRoleCarrier='formatter/v1';return {...f,raw,holdId:'raw-incomplete-'+f.launch.id+'-native-material'};
}
check('retained raw response recovery agrees across work and result with exhausted allowance',async t=>{
 const f=await prepareRawAssessment(t),c=f.c,s=c.store;
 const source=await c.changeCore.rawAssessmentMaterial(f.workId,f.holdId);
 assert.equal(source.raw,f.raw);
 const inspect=()=>{
  const work=c.inspectWorkRecovery(f.workId),change=c.inspectChange(f.workId),result=c.inspectChangeResult(f.workId);
  assert.equal(work.nextAction,change.nextAction);
  assert.equal(result.nextAction,change.nextAction);
  return change.nextAction;
 };
 const funded=inspect();
 assert.match(funded,/validate the original evidence/i);
 assert.doesNotMatch(funded,/extend shared resolution allowance/i);
 s.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='resolution'",f.workId);
 const budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),births=launches.length;
 const exhausted=inspect();
 assert.match(exhausted,/validate the original evidence/i);
 assert.match(exhausted,/extend shared resolution allowance/i);
 assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budgets);
 s.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",f.workId);
 assert.match(inspect(),/extend shared execution allowance and extend shared resolution allowance/i);
 assert.equal(launches.length,births);
 assert.deepEqual(c.inspectChangeModelPrerequisites(f.workId),{stage:'raw-assessment',roles:['adjudicator']});
});
function answerRawAssessment(launch,{newClaim=false,omit=false,rejectPrimary=false,foreign=false}={}){
 const {input,role}=planningTextInput(launch,1);assert.equal(role,'adjudicator');assert.equal(input.context.stage,'raw-assessment');
 const target=input.context.rawAssessment,receipt=input.context.producerDiagnosticReceipt,operand=receipt.eligible.find(o=>o.occurrenceId===target.diagnosisOccurrenceId);assert.ok(operand);
 assert.deepEqual(input.context.decisionReferences.occurrenceIds,target.knownOccurrenceIds);assert.deepEqual(input.context.producerDiagnostics.occurrences.map(o=>o.occurrenceId),[target.diagnosisOccurrenceId]);
 const output={...value,assessedScope:input.requiredScope,findings:newClaim?[finding('NEW ASSESSOR CLAIM NEEDS ITS ACTUAL ID')]:[],decisions:target.knownOccurrenceIds.map(id=>id===target.diagnosisOccurrenceId?{occurrenceId:id,disposition:'upheld',resolution:'diagnosed',reason:'Independently assessed the whole exact raw including narration; every known claim separately addressed',witnesses:[],diagnosis:{outputId:operand.outputId,rawSha256:operand.rawSha256,inputReceiptHash:receipt.receiptHash,materialOccurrenceIds:operand.materialOccurrenceIds}}:{occurrenceId:id,disposition:'upheld',reason:'This raw claim stays pending for substantive current task adjudication',witnesses:[target.targetOutputId]})};
 if(omit)output.decisions=output.decisions.slice(0,1);
 if(rejectPrimary)output.decisions=output.decisions.map(d=>d.occurrenceId===target.diagnosisOccurrenceId?{occurrenceId:d.occurrenceId,disposition:'rejected',reason:'Attempt to reject the required raw assessment',witnesses:[target.targetOutputId]}:d);
 if(foreign)output.planAccepted=true;
 const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]),validate=new Ajv2020({strict:false}).compile(schema);assert.equal(validate(output),!foreign,JSON.stringify(validate.errors));launch.format(JSON.stringify(output));launch.finish(output);return {input,output};
}
check('explicit raw assessment runs only one independent stage and authenticates later coverage',async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,core=f.c.changeCore,primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id),before=f.c.inspectChange(f.workId),births=launches.length;let supplied;
 assert.deepEqual(f.c.inspectChangeModelPrerequisites(f.workId),{stage:'raw-assessment',roles:['adjudicator']});
 selectedScenario=launch=>{supplied=answerRawAssessment(launch);};
 const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births+1,JSON.stringify(result.blocked));assert.equal(result.phase,'BLOCKED');assert.equal(result.reviewReady,false);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved',JSON.stringify(result.blocked));
 assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',primary.id),primary);assert.equal(result.planVersion,before.planVersion);assert.equal(result.execution.consumed,before.execution.consumed+1);assert.equal(result.execution.reserved,0);
 const origin=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),data=JSON.parse(origin.data);assert.ok(data.rawAssessmentReceipt);assert.equal(data.materialAccounting.version,6);assert.equal(core.rawAssessmentReceiptCurrent(origin),true);assert.ok(core.pending(f.workId).some(o=>o.id===supplied.input.context.rawAssessment.projectedOccurrenceIds[0]));
 await core.restoreSettledRoleMaterial({workId:f.workId,model});assert.equal(launches.length,births+1);assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id)),true);assert.deepEqual(core.materialAccountingCandidates(f.workId),[]);
});
check('raw assessment retains new claims before a second explicit independent attempt',async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,births=launches.length;selectedScenario=launch=>answerRawAssessment(launch,{newClaim:true});
 const first=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births+1);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending');assert.equal(first.phase,'BLOCKED');
 const claim=f.c.inspectChange(f.workId).occurrences.find(o=>o.data.finding.description==='NEW ASSESSOR CLAIM NEEDS ITS ACTUAL ID');assert.ok(claim);let current;
 selectedScenario=launch=>{current=answerRawAssessment(launch);};const second=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births+2,JSON.stringify(second.blocked));assert.ok(current.input.context.rawAssessment.knownOccurrenceIds.includes(claim.id));assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved',JSON.stringify(second.blocked));assert.ok(f.c.changeCore.pending(f.workId).some(o=>o.id===claim.id));
});

check('raw assessment fences a newly retained receiver claim after awaited source proof before scoped writes',async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,core=f.c.changeCore,births=launches.length;
 const original=core.prevalidateDiagnoses.bind(core);let judgeId,claimId;
 core.prevalidateDiagnoses=async(work,judgment)=>{
  const proofs=await original(work,judgment);judgeId=judgment.launchId;claimId=randomUUID();
  s.run('INSERT INTO finding_occurrences(id,work,output,ordinal,data) VALUES(?,?,?,?,?)',claimId,work,judgment.output,0,JSON.stringify({launchId:judgeId,role:'adjudicator',finding:finding('Claim retained after awaited source proof')}));
  return proofs;
 };
 selectedScenario=launch=>answerRawAssessment(launch);
 const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});
 assert.ok(judgeId);assert.equal(result.phase,'BLOCKED');assert.equal(launches.length,births+1);assert.match(JSON.stringify(result.blocked),/New raw assessor findings/);
 assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending');
 assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).rawAssessmentReceipt,undefined);
 assert.ok(s.one('SELECT * FROM finding_occurrences WHERE id=?',claimId));
 assert.equal(s.all('SELECT * FROM finding_dispositions WHERE launch=?',judgeId).length,0);
});

for(const kind of ['unrelated-hold','cancelled','unknown','criteria','future-epoch','future-generation'])check('raw assessment refuses admission: '+kind,async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,births=launches.length;
 if(kind==='unrelated-hold')s.run('INSERT INTO obligations VALUES(?,?,?)','unrelated-'+f.workId,f.workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:'unrelated'}));
 if(kind==='cancelled'||kind==='unknown')s.run('UPDATE works SET state=? WHERE id=?',kind==='cancelled'?'CANCELLED':'UNKNOWN',f.workId);
 if(kind==='criteria'){const row=s.one('SELECT data FROM change_state WHERE work=?',f.workId);s.run('UPDATE change_versions SET hash=? WHERE id=?','changed-rules',JSON.parse(row.data).contractsVersion);}
 if(kind==='future-epoch'){s.run('UPDATE role_launches SET epoch=epoch+1 WHERE id=?',f.launch.id);s.run('UPDATE runs SET epoch=epoch+1 WHERE id=?',f.run.id);}
 if(kind==='future-generation')s.run('UPDATE runs SET generation=generation+1 WHERE id=?',f.run.id);
 selectedScenario=()=>assert.fail('Ineligible work dispatched an assessor');await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending');
});
for(const drift of ['judge-raw','judge-history','original','roster','criteria','cancel'])check('raw assessment refuses late evidence drift: '+drift,async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,core=f.c.changeCore,births=launches.length;selectedScenario=launch=>answerRawAssessment(launch);
 const validate=core.prevalidateDiagnoses.bind(core);core.prevalidateDiagnoses=async(...args)=>{const proofs=await validate(...args),judgment=args[1],j=s.one('SELECT * FROM role_outputs WHERE id=?',judgment.output);
  if(drift==='judge-raw'){const md=JSON.parse(j.data),protocol={...md.protocol,summary:'Changed after source validation'};s.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?',JSON.stringify(protocol),JSON.stringify({...md,protocol}),j.id);}
  if(drift==='judge-history')fs.appendFileSync(JSON.parse(j.data).historyRef,'\n');
  if(drift==='original')s.run("UPDATE role_outputs SET raw=raw || ' ' WHERE launch=? AND status='unusable'",f.launch.id);
  if(drift==='roster'){const row=s.one('SELECT * FROM finding_occurrences WHERE output=(SELECT id FROM role_outputs WHERE launch=? AND status=?)',f.launch.id,'accounted-intermediate'),data=JSON.parse(row.data);data.finding.description='Changed after source validation';s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),row.id);}
  if(drift==='criteria'){const id=JSON.parse(s.one('SELECT data FROM change_state WHERE work=?',f.workId).data).contractsVersion;s.run('UPDATE change_versions SET hash=? WHERE id=?','changed-current-rules',id);}
  if(drift==='cancel')await f.c.cancel(f.workId);
  return proofs;
 };
 const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births+1);assert.equal(result.reviewReady,false);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending',JSON.stringify(result.blocked));assert.equal(s.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT f.id FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE o.launch=?)',f.launch.id).length,0);
});
for(const drift of ['deleted','null','snapshot','target','judge','judge-history','original','capture','judge-source'])check('raw assessment cache restores a pending duty on lost proof: '+drift,async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,core=f.c.changeCore;selectedScenario=launch=>answerRawAssessment(launch);await f.c.driveChange({workId:f.workId,model,maximumSteps:8});
 const origin=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),data=JSON.parse(origin.data),receipt=data.rawAssessmentReceipt,births=launches.length,budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId);assert.ok(receipt);
 if(drift==='deleted')delete data.rawAssessmentReceipt;
 if(drift==='null')data.rawAssessmentReceipt=null;
 if(drift==='snapshot')receipt.snapshot.source.rows='unproved';
 if(drift==='target')receipt.target.knownOccurrenceIds=[];
 if(['deleted','null','snapshot','target'].includes(drift))s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),origin.id);
 if(drift==='judge')s.run("UPDATE role_outputs SET raw=raw || ' ' WHERE id=?",receipt.judgeOutputId);
 if(drift==='judge-source'){const output=s.one('SELECT data FROM role_outputs WHERE id=?',receipt.judgeOutputId),metadata=JSON.parse(output.data);metadata.nativeSource=null;s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),receipt.judgeOutputId);}
 if(drift==='judge-history'){const row=s.one('SELECT data FROM role_launches WHERE id=?',receipt.judgeLaunchId);fs.appendFileSync(JSON.parse(row.data).historyRef,'\n');}
 if(drift==='original')s.run("UPDATE role_outputs SET raw=raw || ' ' WHERE launch=? AND status='unusable'",f.launch.id);
 if(drift==='capture'){delete data.nativeRoleIntent;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),origin.id);}
 assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',origin.id)),false);
 await core.restoreSettledRoleMaterial({workId:f.workId,model});assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending');assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budgets);
});

for(const kind of ['claim-deleted','claim-origin','prior-history','prior-target'])check('raw assessment keeps prior assessor evidence accountable: '+kind,async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store;selectedScenario=launch=>answerRawAssessment(launch,{newClaim:true});await f.c.driveChange({workId:f.workId,model,maximumSteps:8});const known=f.c.inspectChange(f.workId).occurrences.find(o=>o.data.finding.description==='NEW ASSESSOR CLAIM NEEDS ITS ACTUAL ID');assert.ok(known);const prior=s.one('SELECT * FROM role_launches WHERE id=(SELECT launch FROM role_outputs WHERE id=?)',known.output),data=JSON.parse(prior.data);
 if(kind==='claim-deleted'){s.run('DELETE FROM obligations WHERE id=?',known.id);s.run('DELETE FROM finding_occurrences WHERE id=?',known.id);}
 if(kind==='claim-origin'){const current=JSON.parse(s.one('SELECT data FROM finding_occurrences WHERE id=?',known.id).data);current.launchId=f.launch.id;s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(current),known.id);}
 if(kind==='prior-history')fs.renameSync(data.historyRef,data.historyRef+'.missing');
 if(kind==='prior-target'){delete data.rawAssessment;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),prior.id);}
 const births=launches.length;selectedScenario=()=>assert.fail('Missing prior claim/source admitted a replacement');await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending');
});
check('raw assessment wire retains full rules with bounded subject input and output reserve',async t=>{
 const f=await prepareRawAssessment(t),contexts=[];globalThis.__nativeBudgetObserver=(model,context,options)=>{if(options?.metadata?.['gitjig.structured-output/v1']?.binding.stage==='raw-assessment')contexts.push(JSON.parse(JSON.stringify({model,context,intent:options.metadata['gitjig.structured-output/v1']})));};t.after(()=>delete globalThis.__nativeBudgetObserver);
 let answered;selectedScenario=launch=>{answered=answerRawAssessment(launch);};const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(JSON.parse(f.c.store.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved',JSON.stringify(result.blocked));assert.equal(contexts.length,1);
 const [{model:selected,context,intent}]=contexts,{structuredOutputContext}=await load('pi/structured-output.js'),{assertModelContextBudget}=await load('pi/context-budget.js');const complete=structuredOutputContext(context,intent),budget=assertModelContextBudget(selected,complete);assert.equal(budget.outputReserve,32000);assert.equal(context.messages.filter(m=>m.role==='user').length,1);assert.deepEqual(answered.input.context.rawAssessment.knownOccurrenceIds,answered.input.context.occurrences.map(o=>o.id));assert.equal(answered.input.contracts,f.c.changeCore.version(f.c.changeCore.row(f.workId).data.contractsVersion).data.text);
 const wire=JSON.stringify(context),needle=JSON.stringify(f.raw).slice(1,-1),user=context.messages.find(m=>m.role==='user'),text=typeof user.content==='string'?user.content:user.content.map(b=>b.text??'').join('');assert.equal(text.split(needle).length-1,1,'Whole raw is delivered once');
 const projected={...complete,messages:[...complete.messages,{role:'assistant',content:[{type:'toolCall',id:'projected-correction',name:'StructuredOutput',arguments:answered.output}],api:selected.api,provider:selected.provider,model:selected.id,stopReason:'toolUse',timestamp:0,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}},{role:'toolResult',toolCallId:'projected-correction',toolName:'StructuredOutput',content:[{type:'text',text:'Projected schema rejection; not an actual Native correction'}],isError:true,timestamp:0}]};
 const correctionBudget=assertModelContextBudget(selected,projected);
 const report={scope:'Actual controlled public Controller normalized SDK context and formatter schema; local estimates and one correction projection, not Native hidden prompt, service acceptance or provider usage',systemTextBytes:Buffer.byteLength(JSON.stringify(context.messages.filter(m=>m.role==='system').map(m=>[m.content,m.sections]))),transcriptBytes:Buffer.byteLength(wire),toolsBytes:Buffer.byteLength(JSON.stringify(context.messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded??[]))),schemaBytes:Buffer.byteLength(JSON.stringify(intent.schema)),outputBytes:Buffer.byteLength(JSON.stringify(answered.output)),subjectCount:answered.input.context.occurrences.length,budget,correctionBudget};console.log('RAW_ASSESSMENT_WIRE_METRICS '+JSON.stringify(report));
});

check('raw assessment exact cohort leaves unrelated producer and duty unchanged',async t=>{
 const f=await prepareRawAssessment(t,{outside:true}),s=f.c.store;const outside=f.c.inspectChange(f.workId).occurrences.find(o=>o.data.finding.description==='OUTSIDE ASSESSMENT COHORT');assert.ok(outside);const duty=s.one('SELECT * FROM obligations WHERE id=?',outside.id),row=s.one('SELECT * FROM finding_occurrences WHERE id=?',outside.id);let supplied;
 selectedScenario=launch=>{supplied=answerRawAssessment(launch);};const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved',JSON.stringify(result.blocked));assert.ok(!supplied.input.context.rawAssessment.knownOccurrenceIds.includes(outside.id));assert.equal(supplied.input.context.occurrences.some(o=>o.id===outside.id),false);assert.deepEqual(s.one('SELECT * FROM obligations WHERE id=?',outside.id),duty);assert.deepEqual(s.one('SELECT * FROM finding_occurrences WHERE id=?',outside.id),row);assert.equal(s.all('SELECT * FROM finding_dispositions WHERE occurrence=?',outside.id).length,0);
});
check('raw assessment missing known decision keeps raw and material duties pending',async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,births=launches.length;selectedScenario=launch=>answerRawAssessment(launch,{omit:true});const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births+1);assert.equal(result.phase,'BLOCKED');assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending');assert.equal(s.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT f.id FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE o.launch=?)',f.launch.id).length,0);
});
check('raw assessment does not claim replacement of an unrelated recovered adjudicator',async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,oldLaunch=randomUUID(),dutyId='diagnostic-'+oldLaunch;
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',oldLaunch,f.workId,f.run.id,'adjudicator',f.launch.epoch,'COMPLETE','consumed',JSON.stringify({stage:'planning-adjudication',cleanup:'removed'}));
 s.run('INSERT INTO obligations VALUES(?,?,?)',dutyId,f.workId,JSON.stringify({kind:'diagnostic',state:'resolved',launchId:oldLaunch,recoverySource:randomUUID(),method:'retain-output-and-raw-obligations-before-charged-reentry'}));
 const before=s.one('SELECT * FROM obligations WHERE id=?',dutyId);selectedScenario=launch=>answerRawAssessment(launch);
 const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});
 assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved',JSON.stringify(result.blocked));
 assert.deepEqual(s.one('SELECT * FROM obligations WHERE id=?',dutyId),before);
});
check('raw assessment cached coverage survives actual Controller close and reopen',async t=>{
 const f=await prepareRawAssessment(t);selectedScenario=launch=>answerRawAssessment(launch);const before=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(JSON.parse(f.c.store.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved',JSON.stringify(before.blocked));await f.c.close();
 const {openController}=await load('controller/index.js'),c=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>c.close());const births=launches.length,origin=c.store.one('SELECT * FROM role_launches WHERE id=?',f.launch.id);assert.equal(c.changeCore.rawAssessmentReceiptCurrent(origin),true);assert.equal(await c.changeCore.restoreSettledRoleMaterial({workId:f.workId,model}),true);assert.equal(launches.length,births);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved');assert.deepEqual(c.changeCore.materialAccountingCandidates(f.workId),[]);
});

for(const kind of ['rejected-primary','foreign-command','captured-target','storage'])check('raw assessment enforces purpose and atomicity: '+kind,async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,core=f.c.changeCore,births=launches.length;
 const before=s.all('SELECT * FROM obligations WHERE work=? ORDER BY id',f.workId).filter(o=>o.id===f.holdId||o.id===core.diagnosisSubjectIds(f.workId).values().next().value);
 const run=s.run;s.run=function(sql,...args){if(kind==='storage'&&sql==='UPDATE role_launches SET data=? WHERE id=?'&&args[1]===f.launch.id&&JSON.parse(args[0]).rawAssessmentReceipt)throw Error('CONTROLLED_SEMANTIC_RECEIPT_WRITE_FAILURE');return run.call(this,sql,...args);};
 selectedScenario=launch=>{if(kind==='captured-target'){const row=s.one("SELECT * FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='raw-assessment' ORDER BY rowid DESC LIMIT 1",f.workId),data=JSON.parse(row.data);data.rawAssessment.targetOutputId='foreign';s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),row.id);}answerRawAssessment(launch,{rejectPrimary:kind==='rejected-primary',foreign:kind==='foreign-command'});};
 try{const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births+1);assert.equal(result.reviewReady,false);assert.equal(s.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT f.id FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE o.launch=?)',f.launch.id).length,0);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending');for(const row of before)assert.deepEqual(s.one('SELECT * FROM obligations WHERE id=?',row.id),row);assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).rawAssessmentReceipt,undefined);}finally{s.run=run;}
});

check('raw assessment uses an ordinary Pi assessor without inventing Native carrier proof',async t=>{
 const f=await prepareRawAssessment(t),s=f.c.store,{createAssistantMessageEventStream}=await import('@earendil-works/pi-ai/compat');let calls=0;
 const direct={provider:'raw-direct-fixture',modelId:'judge',definition:{api:'raw-direct-api',apiKey:'FIXTURE_ONLY_NO_REQUEST',baseUrl:'http://unused.invalid',models:[{id:'judge',name:'Controlled direct assessor',reasoning:false,input:['text'],contextWindow:200000,maxTokens:32000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(selected,context){calls++;const u=context.messages.find(m=>m.role==='user'),text=typeof u.content==='string'?u.content:u.content.map(b=>b.text??'').join(''),input=JSON.parse(text.split('\n').find(line=>line.startsWith('{"requirements":'))),target=input.context.rawAssessment,receipt=input.context.producerDiagnosticReceipt,operand=receipt.eligible.find(o=>o.occurrenceId===target.diagnosisOccurrenceId);
  const output={...value,assessedScope:input.requiredScope,decisions:target.knownOccurrenceIds.map(id=>id===target.diagnosisOccurrenceId?{occurrenceId:id,disposition:'upheld',resolution:'diagnosed',reason:'Direct independent assessment of the complete original raw',witnesses:[target.targetOutputId],diagnosis:{outputId:operand.outputId,rawSha256:operand.rawSha256,inputReceiptHash:receipt.receiptHash,materialOccurrenceIds:operand.materialOccurrenceIds}}:{occurrenceId:id,disposition:'upheld',reason:'Keep actual substantive raw claim pending',witnesses:[target.targetOutputId]})};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const message={role:'assistant',content:[{type:'text',text:JSON.stringify(output)}],api:selected.api,provider:selected.provider,model:selected.id,stopReason:'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};stream.push({type:'done',reason:'stop',message});stream.end(message);});return stream;
 }}},births=launches.length;
 const result=await f.c.driveChange({workId:f.workId,model:direct,maximumSteps:8});assert.equal(calls,1,JSON.stringify(result.blocked));assert.equal(launches.length,births);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved',JSON.stringify(result.blocked));const origin=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),receipt=JSON.parse(origin.data).rawAssessmentReceipt,j=s.one('SELECT * FROM role_outputs WHERE id=?',receipt.judgeOutputId);assert.equal(JSON.parse(j.data).nativeSource,null);assert.equal(f.c.changeCore.rawAssessmentReceiptCurrent(origin),true);assert.equal(await f.c.changeCore.restoreSettledRoleMaterial({workId:f.workId,model:direct}),true);assert.equal(calls,1);
 await f.c.close();const {openController}=await load('controller/index.js'),reopened=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());assert.equal(reopened.changeCore.rawAssessmentReceiptCurrent(reopened.store.one('SELECT * FROM role_launches WHERE id=?',f.launch.id)),true);assert.equal(await reopened.changeCore.restoreSettledRoleMaterial({workId:f.workId,model:direct}),true);assert.equal(calls,1);
});

check('raw assessment checks original source after receipt capture before model dispatch',async t=>{
 const f=await prepareRawAssessment(t),core=f.c.changeCore,s=f.c.store,capture=core.captureDiagnosticInput.bind(core),births=launches.length;
 core.captureDiagnosticInput=async(...args)=>{await capture(...args);s.run("UPDATE role_outputs SET raw=raw || ' ' WHERE launch=? AND status='unusable'",f.launch.id);};selectedScenario=()=>assert.fail('Changed original source reached provider');const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births);assert.equal(result.reviewReady,false);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'pending');
});

check('raw assessment supports an exact empty literal census without inventing claims',async t=>{
 const f=await prepareRawAssessment(t,{empty:true}),s=f.c.store,core=f.c.changeCore,births=launches.length;let supplied;selectedScenario=launch=>{supplied=answerRawAssessment(launch);};const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:8});assert.equal(launches.length,births+1);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',f.holdId).data).state,'resolved',JSON.stringify(result.blocked));assert.deepEqual(supplied.input.context.rawAssessment.projectedOccurrenceIds,[]);assert.equal(supplied.input.context.occurrences.length,1);assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id)),true);assert.equal(s.all('SELECT * FROM finding_occurrences WHERE output=(SELECT id FROM role_outputs WHERE launch=? AND status=?)',f.launch.id,'accounted-intermediate').length,0);
});

for(const [role,stage]of [['planner','planning'],['challenger','planning-challenge']])check('explicit planning body4 public Controller and reopened original Native source: '+role,async t=>{
 useFormatterFixture(t); // This source fixture intentionally captures the original formatter request.
 const declaration={version:4};
 const claims=Array.from({length:4},(_,i)=>({...finding('Distinct original planning claim '+i),evidence:['Exact repeated original evidence '+ 'source '.repeat(800)]}));let observed;
 const f=await controllerRole(t,launch=>{
  const text=launch.frames.find(frame=>frame.type==='user').message.content;const raw=typeof text==='string'?text:text.filter(part=>part.type==='text').map(part=>part.text).join('');const wire=JSON.parse(raw.split('\n').find(line=>line.startsWith('{"requirements":'))).context;
  assert.equal(wire.findingBodyInput.version,4);assert.equal(wire.findingBodyEncoding.version,4);assert.ok(wire.findingBodyEncoding.values.length>0);
  // Metadata and body codecs are independent, both retain literal claim IDs.
  observed={wire,raw};const output=writeFixtureVerificationDomain(role==='planner'?{...value,plan:mixedPlan()}:{...value,alternatives:[]},wire);launch.format(JSON.stringify(output));launch.finish(output);
 },role,{stage,...(role==='challenger'?{planProposal:mixedPlan()}:{}),findingBodyInput:declaration},async(c,workId)=>{
  selectedScenario=launch=>{const output={...value,alternatives:[],findings:claims};launch.format(JSON.stringify(output));launch.finish(output);};
  await c.changeCore.operation({workId,model},'plan',async()=>{await c.changeCore.role({workId,model},'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});return c.changeCore.inspect(workId);});
  const select=c.changeCore.selectRoleModel;c.changeCore.selectRoleModel=async function(...args){declaration.version=3;return select.apply(this,args);};
  if(role==='planner'){const original=c.changeCore.role;c.changeCore.role=function(options,receiver,context,...rest){if(receiver!=='planner')throw Error('PLANNING_BODY_PROBE_STOP_AFTER_PLANNER');return original.call(this,options,receiver,{...context,findingBodyInput:declaration},...rest);};}
 });
 assert.ok(observed);assert.equal(declaration.version,3,'Caller mutation after entry cannot rebind the captured version4');const s=f.c.store,output=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",f.launch.id);assert.ok(output);const launchData=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data);assert.equal(launchData.findingBodyInput.version,4);assert.match(launchData.findingBodyHash,/^[a-f0-9]{64}$/);
 const {restoreFindingBodies}=await load('workflow/finding-body-presentation.js'),decoded=restoreFindingBodies(readFixtureMetadataContext(observed.wire),role);assert.deepEqual(decoded.occurrences.map(o=>o.data.finding),claims);
 delete globalThis.__nativeRoleCarrier;
 await f.c.close();const reopened=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
 const core=reopened.changeCore,proof=await core.historicalPlanningProducer(f.workId,output.id);proof.assertCurrent();assert.deepEqual(proof.context.occurrences.map(o=>o.data.finding),claims);assert.equal(proof.context.findingBodyInput.version,4);
 const original=reopened.store.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data;
 for(const mutate of [d=>delete d.findingBodyInput,d=>{delete d.findingBodyInput;delete d.findingBodyHash;},d=>d.findingBodyInput.version=3,d=>d.findingBodyHash='0'.repeat(64)]){const changed=JSON.parse(original);mutate(changed);reopened.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(changed),f.launch.id);try{await assert.rejects(core.historicalPlanningProducer(f.workId,output.id),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);}finally{reopened.store.run('UPDATE role_launches SET data=? WHERE id=?',original,f.launch.id);}}
 const tables=['runs','role_launches','role_outputs','finding_occurrences','budgets','capacity_leases'],snapshot=()=>Object.fromEntries(tables.map(name=>[name,reopened.store.all('SELECT * FROM '+name+' ORDER BY rowid')])),originalBundle=core.bundle;
 for(const mutation of ['remove','version','coherent-removal']){
  const before=snapshot(),births=launches.length;core.bundle=async function(...args){const prepared=await originalBundle.apply(this,args);if(mutation==='version')prepared.bundle.context.findingBodyInput.version=3;else{delete prepared.bundle.context.findingBodyInput;if(mutation==='coherent-removal')delete prepared.bundle.context.findingBodyHash;}return prepared;};
  try{const result=await core.operation({workId:f.workId,model},'plan',async()=>{await core.role({workId:f.workId,model},role,{stage,...(role==='challenger'?{planProposal:mixedPlan()}:{}),findingBodyInput:{version:4}});return core.inspect(f.workId);});assert.match(result.blocked.join(' '),/Original finding body declaration changed/);assert.deepEqual(snapshot(),before);assert.equal(launches.length,births);}finally{core.bundle=originalBundle;}
 }

 const beforeAsync=snapshot(),birthsBeforeAsync=launches.length,mutableOccurrences=core.inspect(f.workId).occurrences;let preparationReads=0;
 globalThis.__nativeRoleBudgetPreparation=()=>{preparationReads++;mutableOccurrences[0].data.finding.description='Changed during model capacity preparation';};
 try{const result=await core.operation({workId:f.workId,model},'plan',async()=>{await core.role({workId:f.workId,model},role,{stage,...(role==='challenger'?{planProposal:mixedPlan()}:{}),findingBodyInput:{version:4},occurrences:mutableOccurrences});return core.inspect(f.workId);});assert.match(result.blocked.join(' '),/Original finding bodies changed during preparation/);assert.equal(preparationReads,1);assert.equal(launches.length,birthsBeforeAsync);assert.deepEqual(snapshot(),beforeAsync);}finally{delete globalThis.__nativeRoleBudgetPreparation;}

});

check('ordinary planning body4 public Controller captures P/C without caller declaration',async t=>{
 const {c,workId}=await textPlanningProject(t);globalThis.__nativeRoleCarrier='formatter/v1';
 const claims=Array.from({length:4},(_,i)=>({...finding('Retained independent planning observation '+i),evidence:['Exact shared original evidence '+ 'source '.repeat(800)]}));
 selectedScenario=launch=>{const output={...value,alternatives:[],findings:claims};launch.format(JSON.stringify(output));launch.finish(output);};
 await c.changeCore.operation({workId,model},'plan',async()=>{await c.changeCore.role({workId,model},'challenger',{stage:'planning-challenge',planProposal:preserveExportPlan()});return c.changeCore.inspect(workId);});
 const core=c.changeCore,originalRole=core.role,originalBundle=core.bundle,canonical=new Map(),frames=new Map(),before=launches.length,priorLaunches=new Set(c.store.all('SELECT id FROM role_launches WHERE work=?',workId).map(row=>row.id));
 core.role=function(options,role,context,...rest){if(role==='adjudicator')throw Error('NORMAL_BODY4_PROBE_STOP_AFTER_P_C');assert.ok(!Object.hasOwn(context,'findingBodyInput'),'Public planning callers do not select a body recipe');return originalRole.call(this,options,role,context,...rest);};
 core.bundle=async function(work,context,role,...rest){const prepared=await originalBundle.call(this,work,context,role,...rest);if(work===workId&&['planner','challenger'].includes(role))canonical.set(role,structuredClone(prepared.bundle));return prepared;};
 selectedScenario=launch=>{const {input,role}=planningTextInput(launch,1),content=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof content==='string'?content:content.filter(part=>part.type==='text').map(part=>part.text).join(''),wire=JSON.parse(text.split('\n').find(line=>line.startsWith('{"requirements":'))).context;assert.equal(wire.findingBodyInput.version,4);assert.equal(wire.findingBodyEncoding.version,4);assert.deepEqual(input.context.occurrences.map(o=>o.data.finding),claims);frames.set(role,wire);const output=planningTextOutput(input,role);launch.format(JSON.stringify(output));launch.finish(output);};
 let result;try{result=await c.planChange({workId,model});}finally{core.role=originalRole;core.bundle=originalBundle;}
 assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(' '),/NORMAL_BODY4_PROBE_STOP_AFTER_P_C/);assert.equal(launches.length,before+2);assert.deepEqual([...frames.keys()],['planner','challenger']);
 const records=c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId).filter(row=>!priorLaunches.has(row.id)),outputs=[];assert.deepEqual(records.map(row=>row.role),['planner','challenger']);
 const {findingBodyFootprint}=await load('workflow/finding-body-presentation.js');
 for(const launch of records){const data=JSON.parse(launch.data),output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",launch.id);assert.ok(output);outputs.push(output);const metadata=JSON.parse(output.data),bundle=canonical.get(launch.role);assert.equal(data.findingBodyInput.version,4);assert.equal(data.findingBodyHash,findingBodyFootprint(bundle.context,launch.role));assert.deepEqual(bundle.context.occurrences.map(o=>o.data.finding),claims);assert.equal(data.nativeRoleIntent.inputDigest,sha(JSON.stringify(bundle)));assert.equal(metadata.nativeSource.kind,'claude-sdk-formatter/v1');const scope=core.inputScopeReceipt(workId,launch.id,output.id,launch.role,data.stage,metadata.nativeEntryId);assert.equal(scope.findingBodySuppliedIds.length,4);assert.deepEqual(scope.findingBodySuppliedIds,scope.occurrenceIds);}
 const tables=['runs','role_launches','role_outputs','finding_occurrences','budgets','capacity_leases'],snapshot=()=>Object.fromEntries(tables.map(name=>[name,c.store.all('SELECT * FROM '+name+' ORDER BY rowid')]));
 for(const role of ['planner','challenger'])for(const declaration of [null,undefined,{version:3}]){const old=snapshot(),births=launches.length;const refused=await core.operation({workId,model},'plan',async()=>{await core.role({workId,model},role,{stage:role==='planner'?'planning':'planning-challenge',...(role==='challenger'?{planProposal:preserveExportPlan()}:{}),findingBodyInput:declaration});return core.inspect(workId);});assert.match(refused.blocked.join(' '),/Finding body presentation unavailable/);assert.equal(launches.length,births);assert.deepEqual(snapshot(),old);}
 await c.close();const reopened=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
 for(const output of outputs){const proof=await reopened.changeCore.historicalPlanningProducer(workId,output.id);proof.assertCurrent();assert.equal(proof.context.findingBodyInput.version,4);assert.deepEqual(proof.context.occurrences.map(o=>o.data.finding),claims);assert.deepEqual(proof.witness.initialView.findingBodySuppliedIds,proof.witness.initialView.occurrenceIds);}
});

for(const headers of ['complete','subset','rejected-scalars'])check('complete rejected formatter omissions retain raw without a false material hold and restore old cache through public entry '+headers,async t=>{
 globalThis.__nativeFramingCalls=[];globalThis.__nativeRoleCarrier='formatter/v1';
 t.after(()=>{delete globalThis.__nativeFramingCalls;delete globalThis.__nativeRoleCarrier;});
 const rejected=[],finalFinding=finding('RETAIN FINAL ACTUAL CLAIM');
 const f=await controllerRole(t,launch=>{
  const {input}=planningTextInput(launch,1);
  for(let i=0;i<4;i++){
   const raw=JSON.stringify(headers==='rejected-scalars'?{input:['placeholder',42,false,null][i]}:headers==='complete'?{version:1,summary:'Rejected complete challenge '+i,assessedScope:input.requiredScope,alternatives:['Use existing behavior']}:{version:1,summary:'Rejected formatter attempt '+i+' <invoke><parameter>{\"findings\":[]}</parameter></invoke>'});
   rejected.push(raw);launch.format(raw,{carrierError:true});
  }
  const final={...value,findings:[finalFinding],alternatives:[],assessedScope:[{sourceId:input.sources[0].id,startLine:1,endLine:999}]};
  launch.format(JSON.stringify(final));launch.finish(final);
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 const s=f.c.store,core=f.c.changeCore,holdId='raw-incomplete-'+f.launch.id+'-native-material';
 const outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id);
 const intermediate=outputs.filter(o=>o.status==='accounted-intermediate');
 assert.deepEqual(intermediate.map(o=>o.raw).sort(),rejected.slice().sort());
 assert.ok(intermediate.every(o=>JSON.parse(o.data).protocol===null));
 assert.equal(s.one('SELECT * FROM obligations WHERE id=?',holdId),undefined);
 const primary=outputs.find(o=>o.status==='unusable');assert.ok(primary);assert.match(JSON.parse(primary.data).issues.join(),/UNEXPOSED_SCOPE/);
 assert.equal(core.pending(f.workId).filter(o=>o.kind==='finding').length,1);
 const diagnostic=s.one('SELECT * FROM obligations WHERE id=?','diagnostic-'+f.launch.id);assert.ok(diagnostic);
 // Reconstruct the actual old cache/false completeness duty in this disposable
 // fixture. Source bytes, final result, received claims and custody stay real.
 const ld=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data);ld.materialAccounting.version=headers==='rejected-scalars'?8:4;
 s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),f.launch.id);
 s.run('INSERT INTO obligations VALUES(?,?,?)',holdId,f.workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:f.launch.id,historyRef:ld.historyRef,extractionIssueCount:4,extractionIssues:intermediate.map(o=>({entryId:JSON.parse(o.data).nativeEntryId,reason:'Original formatter envelope or literal findings are incomplete or unsupported'}))}));
 const lineage=s.one('SELECT lineage FROM works WHERE id=?',f.workId).lineage;
 s.run('UPDATE budgets SET lim=consumed WHERE lineage=?',lineage);
 const budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',lineage),claims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),runs=s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',f.workId),births=launches.length;
 await assert.rejects(f.c.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
 const restored=JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',holdId).data);
 assert.equal(restored.state,'resolved');assert.equal(restored.method,'original-native-material-accounting-restored');
 assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,10);
 assert.deepEqual(s.one('SELECT * FROM obligations WHERE id=?',diagnostic.id),diagnostic);
 assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);
 assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
 assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',lineage),budgets);
 assert.deepEqual(s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',f.workId),runs);assert.equal(launches.length,births);
 await assert.rejects(f.c.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
 assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);assert.equal(launches.length,births);
 assert.equal(core.materialAccountingCandidates(f.workId).length,0);
 const {openController}=await load('controller/index.js');await f.c.close();
 const reopened=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
 await assert.rejects(reopened.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
 assert.equal(reopened.changeCore.materialAccountingCandidates(f.workId).length,0);
 assert.deepEqual(reopened.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);
 assert.deepEqual(reopened.store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
 assert.deepEqual(reopened.store.one('SELECT * FROM obligations WHERE id=?',diagnostic.id),diagnostic);assert.equal(launches.length,births);
});

for(const variant of ['unfinished-stream','text-carrier'])check('empty formatter proof does not cover '+variant,async t=>{
 if(variant==='text-carrier')chooseTextFactory(t);
 else{globalThis.__nativeFramingCalls=[];globalThis.__nativeRoleCarrier='formatter/v1';t.after(()=>{delete globalThis.__nativeFramingCalls;delete globalThis.__nativeRoleCarrier;});}
 const f=await controllerRole(t,launch=>{
  const {input}=planningTextInput(launch,variant==='text-carrier'?2:1);
  const missing=JSON.stringify({version:1,summary:'No received findings field',assessedScope:input.requiredScope,alternatives:[]});
  launch.format(missing,{carrierError:true,complete:variant!=='unfinished-stream'});
  if(variant==='text-carrier')completeText(launch,JSON.stringify({...value,assessedScope:input.requiredScope,alternatives:[]}));
  else launch.finish(undefined,{subtype:'error_during_execution',is_error:true});
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 const s=f.c.store,hold=s.one('SELECT data FROM obligations WHERE id=?','raw-incomplete-'+f.launch.id+'-native-material');
 assert.ok(hold);assert.equal(JSON.parse(hold.data).state,'pending');
 if(variant==='text-carrier')assert.equal((await f.c.changeCore.nativeEntries(f.run.id)).find(e=>e.customType===nativeRoleEntries.intent).data.request.version,2);
});

for(const conflict of [false,true])check('complete decoded-only formatter omission '+(conflict?'retains conflicting-prefix hold':'does not require a stream close flag'),async t=>{
 globalThis.__nativeFramingCalls=[];globalThis.__nativeRoleCarrier='formatter/v1';t.after(()=>{delete globalThis.__nativeFramingCalls;delete globalThis.__nativeRoleCarrier;});
 let raw;
 const f=await controllerRole(t,launch=>{
  const {input}=planningTextInput(launch,1),missing={version:1,summary:'Decoded complete rejected challenge',assessedScope:input.requiredScope,alternatives:[]};raw=JSON.stringify(missing);
  const mid='decoded-message-'+randomUUID(),tid='decoded-tool-'+randomUUID();
  const event=value=>launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event:value});
  if(conflict){
   event({type:'message_start',message:{id:mid,type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[],usage:{input_tokens:1,output_tokens:0}}});
   event({type:'content_block_start',index:0,content_block:{type:'tool_use',id:tid,name:'StructuredOutput',input:{}}});
   // A repeated original block start marks a real native prefix conflict.
   event({type:'content_block_start',index:0,content_block:{type:'tool_use',id:tid,name:'StructuredOutput',input:{}}});
   event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});
   event({type:'content_block_stop',index:0});
  }
  launch.send({type:'assistant',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,message:{id:mid,type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[{type:'tool_use',id:tid,name:'StructuredOutput',input:missing}],stop_reason:null,usage:{input_tokens:1,output_tokens:1}}});
  if(conflict){event({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:1}});event({type:'message_stop'});}
  launch.send({type:'user',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:tid,is_error:true,content:'Required findings member missing'}]}});
  const final={...value,findings:[finding('Keep final received finding')],alternatives:[],assessedScope:[{sourceId:input.sources[0].id,startLine:1,endLine:999}]};launch.format(JSON.stringify(final));launch.finish(final);
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 const s=f.c.store,hold=s.one('SELECT data FROM obligations WHERE id=?','raw-incomplete-'+f.launch.id+'-native-material');
 if(conflict){assert.ok(hold);assert.equal(JSON.parse(hold.data).state,'pending');}
 else{
  assert.equal(hold,undefined);
  const row=s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate'",f.launch.id).find(o=>o.raw===raw);assert.ok(row);
  assert.ok(JSON.parse(row.data).materialSources[0].selector.startsWith('decoded-formatter-input:'));
 }
 assert.equal(s.all('SELECT * FROM finding_occurrences WHERE work=?',f.workId).filter(o=>JSON.parse(o.data).finding.description==='Keep final received finding').length,1);
});

check('direct declared text omission remains invalid without introducing formatter accounting or a false extraction hold',async t=>{
 chooseTextFactory(t);let raw;
 const f=await controllerRole(t,launch=>{
  const {input}=planningTextInput(launch,2);raw=JSON.stringify({version:1,summary:'Complete text reply omitted findings',assessedScope:input.requiredScope,alternatives:[]});completeText(launch,raw);
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 const s=f.c.store,primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id);
 assert.ok(primary);assert.equal(primary.raw,raw);assert.equal(JSON.parse(primary.data).protocol,null);
 assert.equal(JSON.parse(primary.data).nativeSource.kind,'claude-sdk-assistant-json/v1');
 assert.equal(s.one('SELECT * FROM obligations WHERE id=?','raw-incomplete-'+f.launch.id+'-native-material'),undefined);
 assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,6);
});

async function assessedCacheFixture(t,{prior=false,legacy=false,mixed=false,legacyVersion=4}={}){
 const f=await prepareRawAssessment(t),s=f.c.store,core=f.c.changeCore;
 if(prior){selectedScenario=launch=>answerRawAssessment(launch,{newClaim:true});await f.c.driveChange({workId:f.workId,model,maximumSteps:8});}
 selectedScenario=launch=>answerRawAssessment(launch);await f.c.driveChange({workId:f.workId,model,maximumSteps:8});
 let origin=s.one('SELECT * FROM role_launches WHERE id=?',f.launch.id),data=JSON.parse(origin.data),receipt=data.rawAssessmentReceipt;
 assert.ok(receipt);assert.equal(receipt.version,2);assert.equal(core.rawAssessmentReceiptCurrent(origin),true);
 const judge=s.one('SELECT * FROM role_launches WHERE id=?',receipt.judgeLaunchId),previous=s.all("SELECT * FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='raw-assessment' AND id<>? ORDER BY rowid",f.workId,judge.id);
 assert.equal(previous.length,prior?1:0);
 const cacheVersion=(row,version)=>{const d=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',row.id).data);d.materialAccounting.version=version;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(d),row.id);};
 if(legacy){
  cacheVersion(judge,legacyVersion);if(!mixed)for(const row of previous)cacheVersion(row,legacyVersion);
  receipt={...receipt,version:1,judgeSourceFence:core.diagnosisJudgeFence(f.workId,judge.id,receipt.judgeOutputId)};
  receipt.snapshot=core.rawAssessmentCacheSnapshot(origin,receipt);
  data.rawAssessmentReceipt=receipt;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),origin.id);
  const updated=s.one('SELECT * FROM role_launches WHERE id=?',origin.id);
  core.recordMaterialAccounting(updated,core.materialHistoryIdentity(JSON.parse(updated.data).historyRef));
  assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',origin.id)),true);
 }
 const lineage=s.one('SELECT lineage FROM works WHERE id=?',f.workId).lineage;s.run('UPDATE budgets SET lim=consumed WHERE lineage=?',lineage);
 return {...f,s,core,originId:origin.id,receipt,judge,previous,cacheVersion,lineage};
}
for(const legacy of [false,true])for(const changed of ['judge','prior','both'])check('semantic receipt '+(legacy?'legacy1':'version2')+' survives only '+changed+' accounting migration without a new producer',async t=>{
 const f=await assessedCacheFixture(t,{prior:changed!=='judge',legacy}),{s,core}=f;
 const tables=['role_outputs','finding_occurrences','finding_dispositions','obligations','budgets','runs'];
 const exact=()=>Object.fromEntries(tables.map(name=>[name,s.all('SELECT * FROM '+name+' ORDER BY rowid')]));
 const before=exact(),births=launches.length,receiptBefore=JSON.stringify(f.receipt);
 if(changed!=='prior')f.cacheVersion(f.judge,legacy?5:4);
 if(changed!=='judge')for(const row of f.previous)f.cacheVersion(row,legacy?5:4);
 assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',f.originId)),true);
 selectedScenario=()=>assert.fail('Cache migration must never dispatch a replacement assessor');
 for(let i=0;i<2;i++){
  try{await f.c.planChange({workId:f.workId,model});}catch(e){assert.match(String(e),/Unusable producer diagnosis requires explicit drive\/resume recovery/);}
  assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',f.originId)),true);assert.equal(launches.length,births);
  assert.deepEqual(exact(),before);assert.equal(JSON.stringify(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.originId).data).rawAssessmentReceipt),receiptBefore);
 }
 await f.c.close();const {openController}=await load('controller/index.js'),reopened=await openController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>reopened.close());
 assert.equal(reopened.changeCore.rawAssessmentReceiptCurrent(reopened.store.one('SELECT * FROM role_launches WHERE id=?',f.originId)),true);
 try{await reopened.planChange({workId:f.workId,model});}catch(e){assert.match(String(e),/Unusable producer diagnosis requires explicit drive\/resume recovery/);}
 for(const name of tables)assert.deepEqual(reopened.store.all('SELECT * FROM '+name+' ORDER BY rowid'),before[name]);
 assert.equal(reopened.changeCore.rawAssessmentReceiptCurrent(reopened.store.one('SELECT * FROM role_launches WHERE id=?',f.originId)),true);assert.equal(launches.length,births);
});
check('legacy semantic receipt holds an unmatched mixed historical cache view without rewriting evidence',async t=>{
 const f=await assessedCacheFixture(t,{prior:true,legacy:true,mixed:true}),before=f.s.all('SELECT * FROM role_outputs ORDER BY rowid'),stored=f.s.one('SELECT data FROM role_launches WHERE id=?',f.originId).data;
 f.cacheVersion(f.judge,5);
 assert.equal(f.core.rawAssessmentReceiptCurrent(f.s.one('SELECT * FROM role_launches WHERE id=?',f.originId)),false);
 assert.deepEqual(f.s.all('SELECT * FROM role_outputs ORDER BY rowid'),before);assert.equal(f.s.one('SELECT data FROM role_launches WHERE id=?',f.originId).data,stored);
});
for(const legacy of [false,true])for(const drift of ['unknown-field','duplicate-field','verdict','checkpoint','cache-shape','cache-value'])check('semantic receipt '+(legacy?'legacy1':'version2')+' refuses actual '+drift+' drift',async t=>{
 const f=await assessedCacheFixture(t,{legacy}),{s,core}=f;
 if(legacy)f.cacheVersion(f.judge,5);
 const row=s.one('SELECT * FROM role_launches WHERE id=?',f.judge.id),d=JSON.parse(row.data);
 if(drift==='unknown-field')d.unknownOriginalEvidence='changed';
 if(drift==='duplicate-field')s.run('UPDATE role_launches SET data=? WHERE id=?','{"extra":1,"extra":2,'+row.data.slice(1),row.id);
 if(drift==='checkpoint'){const run=s.one('SELECT * FROM runs WHERE id=?',row.run),rd=JSON.parse(run.data);rd.nativeCheckpoint.sha256='f'.repeat(64);s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(rd),run.id);}
 if(drift==='verdict'){const o=s.one('SELECT * FROM role_outputs WHERE id=?',f.receipt.judgeOutputId),md=JSON.parse(o.data),v=JSON.parse(o.raw);v.summary+=' changed';md.protocol=v;s.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?',JSON.stringify(v),JSON.stringify(md),o.id);}
 if(drift==='cache-shape')d.materialAccounting.unknownField='not a supported cache view';
 if(drift==='cache-value')d.materialAccounting.claimsDigest='changed';
 if(['unknown-field','cache-shape','cache-value'].includes(drift))s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(d),row.id);
 const before=s.all('SELECT * FROM obligations ORDER BY rowid');
 assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',f.originId)),!legacy&&drift.startsWith('cache-'));
 assert.deepEqual(s.all('SELECT * FROM obligations ORDER BY rowid'),before,'Validation cannot rewrite a stored duty or verdict');
});

check('actual governed role failure before Native birth releases capacity before retiring its reserved input',async t=>{
 const source=path.join(root,'pre-native-role-'+randomUUID());fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.txt'),'Preserve original source.');
 const c=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});t.after(()=>c.close());
 const projectId='pre-native-'+randomUUID();await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Preserve original source.',executionLimit:8});
 const originalFactory=globalThis.__nativeRoleFormatScope,before=launches.length,scopeBefore=scopes.length,cleanup=c.changeCore.h.nativeCleanup;let observedRelease=false;
 c.changeCore.h.nativeCleanup=(identity,receipt)=>{const leases=c.store.all('SELECT state FROM capacity_leases WHERE run=?',identity.runId);assert.equal(leases.length,1);assert.equal(leases[0].state,'RELEASED');observedRelease=true;return cleanup(identity,receipt);};
 globalThis.__nativeRoleFormatScope=async options=>{const scope=await originalFactory(options);Object.defineProperty(scope,'containerId',{get(){throw Error('CONTROLLED_SCOPE_RETURN_BEFORE_NATIVE');}});return scope;};
 selectedScenario=()=>assert.fail('No Native owner may be born after this scope failure');
 let result;try{result=await c.planChange({workId,model});}finally{globalThis.__nativeRoleFormatScope=originalFactory;c.changeCore.h.nativeCleanup=cleanup;}
 assert.match(result.blocked.join(' '),/CONTROLLED_SCOPE_RETURN_BEFORE_NATIVE/);assert.equal(launches.length,before);assert.equal(scopes.length,scopeBefore+1);assert.ok(scopes.at(-1).closed);assert.ok(observedRelease);
 const run=c.store.one("SELECT * FROM runs WHERE work=? AND json_extract(data,'$.kind')='governed-role'",workId);assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(JSON.parse(run.data).cleanup,'removed');
 const owner=c.store.one('SELECT * FROM conversation_state WHERE work=?',workId);assert.equal(c.inspectConversation(owner.conversation).state,'IDLE');
 const input=c.store.one('SELECT * FROM conversation_inputs WHERE conversation=?',owner.conversation);assert.equal(input.state,'CONFLICTED');assert.equal(JSON.parse(input.data).terminalRoleInput.runId,run.id);
 const output=c.store.one('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.run=?',run.id);assert.equal(output.status,'unusable');assert.equal(output.raw,null);assert.equal(JSON.parse(output.data).providerRequests,0);
});

check('current planning J accounts for new undispositioned claim and prior BASE duties without an extra earlier round',async t=>{
 const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',sourceQualified:true,accountability:true}),{s,core}=f;
 assert.equal(f.result.phase,'PLAN_READY',JSON.stringify(f.result.blocked));assert.equal(f.result.reviewReady,false);
 const state=core.row(f.workId),{proofs,assertCurrent}=await core.prevalidateRetainedBaseClassifications(f.workId);assertCurrent();assert.equal(proofs.size,f.ids.length);
 for(const id of f.ids){const occurrence=s.one('SELECT * FROM finding_occurrences WHERE id=?',id);assert.throws(()=>core.carriedBaseline(f.workId,occurrence),/freshly reauthenticated/);assert.equal(core.carriedBaseline(f.workId,occurrence,proofs.get(id)),state.base);}
 assert.equal(core.pending(f.workId).filter(o=>o.kind==='finding').length,f.ids.length,'Accepted classification leaves BASE remediation duties pending');
 const before=JSON.parse(f.priorRefusal.data).protocol;assert.equal(before.planAccepted,false);assert.equal(before.decisions.length,1);
 const final=core.version(core.row(f.workId).plan);assert.equal(final.data.implementationCarries.length,f.ids.length);
 const judge=s.one('SELECT * FROM role_launches WHERE id=?',final.data.decisionLaunch),originalData=judge.data;
 assert.equal(JSON.parse(judge.data).findingBodyInput.version,5,'Fresh planning J captures the explicit literal policy');
 assert.equal(JSON.parse(judge.data).metadataIdentityInput.version,4,'Ordinary fresh planning J captures canonical literal metadata');
 const selected=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge.id),origin=await core.historicalPlanningProducer(f.workId,selected.id);
 assert.equal(origin.context.findingBodyInput.version,5);assert.ok(origin.context.occurrences.every(o=>Object.hasOwn(o.data,'finding')));
 assert.equal(origin.context.metadataIdentityInput.version,4);assert.equal(Object.hasOwn(origin.context,'metadataIdentityEncoding'),false);
 const budgetBefore=s.all('SELECT * FROM budgets');
 try{const changed=JSON.parse(originalData);changed.findingBodyInput={version:3};s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(changed),judge.id);await assert.rejects(core.historicalPlanningProducer(f.workId,selected.id));}
 finally{s.run('UPDATE role_launches SET data=? WHERE id=?',originalData,judge.id);}
 assert.deepEqual(s.all('SELECT * FROM budgets'),budgetBefore);
 assert.equal(s.one('SELECT COUNT(*) AS n FROM finding_dispositions WHERE occurrence=?',f.accountabilityClaim.id).n,1);
 const disposition=s.one('SELECT * FROM finding_dispositions WHERE occurrence=?',f.accountabilityClaim.id);assert.deepEqual(disposition,f.accountabilityDisposition);assert.equal(disposition.launch,f.priorRefusal.launch);assert.equal(disposition.status,'rejected');assert.deepEqual(JSON.parse(selected.data).protocol.retainedDispositions,[disposition.id]);
 const old=s.one('SELECT * FROM finding_occurrences WHERE id=?',f.accountabilityClaim.id);assert.ok(old,'Retiring a procedural objection preserves its original received claim');
});
for(const carrier of ['formatter/v1','assistant-json/v1'])check('planning J receives current-decision guidance through actual SDK '+carrier,async t=>{
 globalThis.__nativeRoleCarrier=carrier;t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const input={...body,context:{stage:'planning-adjudication',planProposal:mixedPlan()}},output={...value,planAccepted:false,decisions:[]};
 const f=await produce(launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const system=strings(launch.frames).find(v=>v.includes('You are the assigned adjudicator'));
  assert.ok(system);assert.match(system,/Make the independent decisions in THIS result/);assert.match(system,/missing prior disposition does not require a separate earlier round/);assert.match(system,/current decision for every pending ordinary member/);assert.match(system,/proposals until the host records them/);
  if(carrier==='formatter/v1'){launch.format(JSON.stringify(output));launch.finish(output);}else completeText(launch,JSON.stringify(output));
 },{role:'adjudicator',inputBundle:input});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.protocol.planAccepted,false,'Guidance never forces acceptance');assert.deepEqual(f.result.protocol.decisions,[]);
});

for(const carrier of ['formatter/v1','assistant-json/v1'])check('literal current J bodies cross actual SDK '+carrier+' with historical scope kept separate',async t=>{
 globalThis.__nativeRoleCarrier=carrier;t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const claims=[finding('Current exact claim with old literal ref95'),{...finding('test'),severity:'optional',evidence:['test']}];
 const occurrences=claims.map((claim,i)=>({id:'current-'+i,work:'W',output:'O'+i,ordinal:0,data:{finding:claim,role:'challenger',launchId:'L'+i}}));
 const input={...body,context:{stage:'planning-adjudication',findingBodyInput:{version:5},occurrences,plannerInputScope:{findingBodyOmittedIds:['current-1']}}},output={...value,planAccepted:false,decisions:[]};
 const f=await produce(launch=>{
  const user=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof user==='string'?user:user.filter(v=>v.type==='text').map(v=>v.text).join('');const wire=JSON.parse(text.split('\n')[1]).context;
  assert.deepEqual(wire.occurrences,occurrences);assert.equal(wire.findingBodyInput.version,5);assert.equal(Object.hasOwn(wire,'findingBodyEncoding'),false);assert.deepEqual(wire.plannerInputScope.findingBodyOmittedIds,['current-1']);
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];const system=strings(launch.frames).find(v=>v.includes('You are the assigned adjudicator'));assert.match(system,/bodies are attached directly/);assert.match(system,/historical exposure, not the availability/);
  if(carrier==='formatter/v1'){launch.format(JSON.stringify(output));launch.finish(output);}else completeText(launch,JSON.stringify(output));
 },{role:'adjudicator',inputBundle:input});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.protocol.planAccepted,false);assert.equal(f.launches.length,1);assert.ok(f.launches.every(l=>l.joined));
});

check('explicit historical planning-J body version3 remains selectable and reauthenticates after literal default',async t=>{
 const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',sourceQualified:true,bodyProfile:3}),{core,s,result}=f;assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
 const state=core.row(f.workId),plan=core.version(state.plan),judge=s.one('SELECT * FROM role_launches WHERE id=?',plan.data.decisionLaunch);assert.equal(JSON.parse(judge.data).findingBodyInput.version,3);
 const output=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge.id),origin=await core.historicalPlanningProducer(f.workId,output.id);assert.equal(origin.context.findingBodyInput.version,3);const retained=await core.prevalidateRetainedBaseClassifications(f.workId);retained.assertCurrent();assert.equal(retained.proofs.size,f.ids.length);
});

async function settledPrefixController(t,prefix){
 const abort=new AbortController();globalThis.__nativeRoleExecutionAbort=abort.signal;t.after(()=>{delete globalThis.__nativeRoleExecutionAbort;});let current;
 const marker='Closed received correction prefix';
 const f=await controllerRole(t,async launch=>{
  launch.format(JSON.stringify({...value,unexpected:'Invalid first role object',findings:[finding('Earlier rejected attempt claim stays pending')]}),{carrierError:true});
  launch.format(prefix??JSON.stringify({assessedScope:[],summary:marker}).slice(0,-1),{complete:false});
  const running=current.c.store.one("SELECT data FROM runs WHERE work=? AND phase='RUNNING' ORDER BY rowid DESC LIMIT 1",current.workId),history=JSON.parse(running.data).historyRef;
  for(let i=0;i<100&&!fs.readFileSync(history,'utf8').includes(marker);i++)await new Promise(resolve=>setImmediate(resolve));
  assert.match(fs.readFileSync(history,'utf8'),new RegExp(marker));abort.abort();
 },'reviewer',{stage:'fresh-review'},(c,workId)=>{current={c,workId};});
 delete globalThis.__nativeRoleExecutionAbort;
 return f;
}
check('public recovery accounts a settled null-final formatter prefix without accepting or spending',async t=>{
 const f=await settledPrefixController(t);
 const s=f.c.store,holdId='raw-incomplete-'+f.launch.id+'-native-material',diagnosticId='diagnostic-'+f.launch.id;
 assert.equal(f.launch.status,'UNUSABLE');assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',holdId).data).state,'pending');
 const primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id);assert.equal(primary.raw,null);assert.equal(JSON.parse(primary.data).terminal,'aborted');
 const lineage=s.one('SELECT lineage FROM works WHERE id=?',f.workId).lineage;s.run('UPDATE budgets SET lim=consumed WHERE lineage=?',lineage);
 const capture=()=>({outputs:s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),findings:s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),diagnostic:s.one('SELECT * FROM obligations WHERE id=?',diagnosticId),budgets:s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',lineage),run:s.one('SELECT * FROM runs WHERE id=?',f.run.id)});
 const before=capture(),births=launches.length;assert.ok(before.findings.some(row=>JSON.parse(row.data).finding.description==='Earlier rejected attempt claim stays pending'));
 selectedScenario=()=>assert.fail('No replacement owner during source accounting');
 await assert.rejects(f.c.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
 assert.deepEqual(capture(),before);assert.equal(launches.length,births);
 assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',holdId).data).state,'resolved');
 assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,10);
 await assert.rejects(f.c.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
 assert.deepEqual(capture(),before);assert.equal(launches.length,births);
});

for(const drift of ['open-value','primary-terminal','primary-raw','source-checkpoint','source-cleanup','finding-during-read','hold-during-read','claim-before-commit'])check('settled formatter prefix public recovery holds '+drift,async t=>{
 const f=await settledPrefixController(t,drift==='open-value'?'{"assessedScope":[],"summary":"Closed received correction prefix':undefined);
 const s=f.c.store,core=f.c.changeCore,holdId='raw-incomplete-'+f.launch.id+'-native-material',primary=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",f.launch.id),findingRow=s.one('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),hold=s.one('SELECT * FROM obligations WHERE id=?',holdId),lineage=s.one('SELECT lineage FROM works WHERE id=?',f.workId).lineage;
 s.run('UPDATE budgets SET lim=consumed WHERE lineage=?',lineage);
 if(drift==='primary-terminal'){const d=JSON.parse(primary.data);d.terminal='error';s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(d),primary.id);}
 if(drift==='primary-raw')s.run('UPDATE role_outputs SET raw=? WHERE id=?','',primary.id);
 if(drift==='source-checkpoint'||drift==='source-cleanup'){const d=JSON.parse(f.run.data);if(drift==='source-checkpoint')d.nativeCheckpoint.sha256='0'.repeat(64);else d.cleanup='unknown';s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(d),f.run.id);}
 const outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',lineage),births=launches.length,entries=core.nativeEntries,tx=s.tx;let armed=false,injected=false;
 const changeFinding=()=>s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify({...JSON.parse(findingRow.data),lateMutation:true}),findingRow.id);
 if(['finding-during-read','hold-during-read','claim-before-commit'].includes(drift))core.nativeEntries=async function(...args){const result=await entries.apply(this,args);if(args[0]===f.run.id&&!injected){if(drift==='claim-before-commit')armed=true;else{injected=true;if(drift==='finding-during-read')changeFinding();else s.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({...JSON.parse(hold.data),lateMutation:true}),holdId);}}return result;};
 if(drift==='claim-before-commit')s.tx=function(fn){return tx.call(this,()=>{if(armed&&!injected){injected=true;changeFinding();}return fn();});};
 selectedScenario=()=>assert.fail('Held prefix must never dispatch');
 try{await f.c.planChange({workId:f.workId,model});}catch(error){assert.match(String(error),/Original|changed|history|checkpoint|unavailable/i);}
 finally{core.nativeEntries=entries;s.tx=tx;}
 assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',holdId).data).state,'pending');assert.equal(launches.length,births);assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',lineage),budgets);
 if(drift==='claim-before-commit'){assert.equal(injected,true);assert.deepEqual(s.one('SELECT * FROM finding_occurrences WHERE id=?',findingRow.id),findingRow,'The failed restoration transaction rolls back the injected mutation');}
 if(drift==='finding-during-read')s.run('UPDATE finding_occurrences SET data=? WHERE id=?',findingRow.data,findingRow.id);
 if(drift==='hold-during-read')s.run('UPDATE obligations SET data=? WHERE id=?',hold.data,holdId);
 if(drift==='source-checkpoint'||drift==='source-cleanup')s.run('UPDATE runs SET data=? WHERE id=?',f.run.data,f.run.id);
});

for(const legacyVersion of [5,7,8,9])for(const target of [7,8,9,10].filter(v=>v>=legacyVersion))for(const changed of ['judge','prior','both'])check('legacy formatter'+legacyVersion+' semantic witness survives known '+changed+' migration to formatter'+target,async t=>{
 const f=await assessedCacheFixture(t,{prior:changed!=='judge',legacy:true,legacyVersion}),{s,core}=f;
 const tables=['role_outputs','finding_occurrences','finding_dispositions','obligations','budgets','runs'],capture=()=>Object.fromEntries(tables.map(name=>[name,s.all('SELECT * FROM '+name+' ORDER BY rowid')])),before=capture(),births=launches.length,receipt=JSON.stringify(f.receipt);
 if(changed!=='prior')f.cacheVersion(f.judge,target);
 if(changed!=='judge')for(const row of f.previous)f.cacheVersion(row,target);
 assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',f.originId)),true);
 selectedScenario=()=>assert.fail('Known cache rewrite must not allocate a replacement');
 for(let i=0;i<2;i++){
  await assert.rejects(f.c.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
  assert.equal(core.rawAssessmentReceiptCurrent(s.one('SELECT * FROM role_launches WHERE id=?',f.originId)),true);assert.deepEqual(capture(),before);assert.equal(launches.length,births);assert.equal(JSON.stringify(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.originId).data).rawAssessmentReceipt),receipt);
 }
});

for(const carrier of ['formatter/v1','assistant-json/v1'])check('canonical current identities and bodies cross actual SDK '+carrier,async t=>{
 globalThis.__nativeRoleCarrier=carrier;t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const work=randomUUID(),ids=Array.from({length:4},()=>randomUUID()),occurrences=ids.map(id=>({id,work,output:work,data:{launchId:work,finding:{description:'Original received allegation quoting historical {ref:183}',evidence:[{ref:0},id]}}}));
 const references={version:3,occurrenceIds:ids,diagnosisOccurrenceIds:[ids[0]],pendingOrdinaryIndexes:[1,2],blockingOrdinaryIndexes:[1],retentionChoices:[{occurrenceId:ids[3],dispositionId:randomUUID(),sha256:'a'.repeat(64)}]};
 const input={...body,context:{stage:'planning-adjudication',metadataIdentityInput:{version:4},findingBodyInput:{version:5},occurrences,decisionReferences:references,plannerInputScope:{findingBodyOmittedIds:[ids[0]]}}},output={...value,planAccepted:false,decisions:[]};
 const f=await produce(launch=>{
  const content=launch.frames.find(x=>x.type==='user').message.content,text=typeof content==='string'?content:content.find(x=>x.type==='text').text,wire=JSON.parse(text.split('\n')[1]).context;
  assert.deepEqual(wire.occurrences,occurrences);assert.equal(wire.metadataIdentityInput.version,4);assert.equal(wire.findingBodyInput.version,5);assert.equal(Object.hasOwn(wire,'metadataIdentityEncoding'),false);assert.equal(Object.hasOwn(wire,'findingBodyEncoding'),false);assert.deepEqual(wire.plannerInputScope,input.context.plannerInputScope);
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[],system=strings(launch.frames).find(x=>x.includes('You are the assigned adjudicator'));
  assert.match(system,/Current metadata identities are literal original strings/);assert.ok(!system.includes('Declared metadataIdentityEncoding is lossless identity sharing'));
  const domain=JSON.parse(system.split('Current action domains (literal original occurrence IDs; output uses these full IDs): ')[1].split('. These membership lists')[0]);
  assert.deepEqual(domain.pendingOrdinary,{count:2,occurrenceIds:ids.slice(1,3)});assert.deepEqual(domain.retention.choices,[{occurrenceId:ids[3],dispositionId:references.retentionChoices[0].dispositionId}]);assert.deepEqual(wire.decisionReferences,references);
  if(carrier==='formatter/v1'){launch.format(JSON.stringify(output));launch.finish(output);}else completeText(launch,JSON.stringify(output));
 },{role:'adjudicator',inputBundle:input});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.protocol.planAccepted,false,'Literal presentation never changes the received judgment');
});
check('explicit older planning metadata1 remains selectable and source-authenticated',async t=>{
 const f=await driveDecisionCarryProposal(t,{carrier:'formatter/v1',sourceQualified:true,identityProfile:1}),{core,s,result}=f;assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
 const plan=core.version(core.row(f.workId).plan),judge=s.one('SELECT * FROM role_launches WHERE id=?',plan.data.decisionLaunch),output=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge.id),origin=await core.historicalPlanningProducer(f.workId,output.id);origin.assertCurrent();
 assert.equal(JSON.parse(judge.data).metadataIdentityInput.version,1);assert.equal(origin.context.metadataIdentityInput.version,1);assert.ok(JSON.parse(judge.data).metadataIdentityHash);
 const wire=JSON.parse(fs.readFileSync(JSON.parse(judge.data).historyRef,'utf8').trim().split('\n').map(JSON.parse).find(x=>x.type==='message'&&x.message.role==='user').message.content.find(x=>x.type==='text').text.split('\n')[1]);
 assert.equal(wire.context.metadataIdentityInput.version,1);assert.ok(wire.context.metadataIdentityEncoding,'Explicit historical sharing stays available');
});

for(const carrier of ['formatter/v1','assistant-json/v1'])for(const kind of ['healthy','empty','duplicate'])check('check resolution witnesses agree across SDK '+carrier+' '+kind,async t=>{
 const prior=globalThis.__nativeRoleCarrier;globalThis.__nativeRoleCarrier=carrier;t.after(()=>{globalThis.__nativeRoleCarrier=prior;});
 const witnesses=kind==='healthy'?['actual-current-check']:kind==='empty'?[]:['same-check','same-check'];
 const output={...value,decisions:[],checkResolutions:[{amendmentId:'A',disposition:'corrected-fixture',reason:'Controlled current receipt assessment',witnesses}]},raw=JSON.stringify(output);
 const f=await produce(launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  if(carrier==='formatter/v1'){
   const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]),valid=new Ajv2020({strict:false}).compile(schema);
   assert.equal(valid(output),kind==='healthy');launch.format(raw);launch.finish(output);
  }else{
   assert.equal(launch.options.args.includes('--json-schema'),false);
   const system=strings(launch.frames).find(v=>v.includes('You are the assigned adjudicator'));
   assert.ok(system.includes('Distinct actual evidence for this check resolution'));
   completeText(launch,raw);
  }
 },{role:'adjudicator',inputBundle:{...body,context:{stage:'review-adjudication'}}});
 const captured=f.entries.find(e=>e.type==='custom'&&e.customType===nativeRoleEntries.intent).data.request;
 const field=captured.schema.properties.checkResolutions.items.properties.witnesses;
 assert.equal(field.minItems,1);assert.equal(field.uniqueItems,true);
 assert.equal(f.result.rawFinal,raw,'Retain even an invalid answer without filling evidence');
 assert.equal(f.result.usable,kind==='healthy',JSON.stringify(f.result.issues));
 assert.equal(f.launches.length,1);assert.equal(f.launches[0].joined,true);
});

for(const carrier of ['formatter/v1','assistant-json/v1'])check('literal review bodies and current repair check schema cross actual SDK '+carrier,async t=>{
 globalThis.__nativeRoleCarrier=carrier;globalThis.__nativeFramingCalls=[];
 t.after(()=>{delete globalThis.__nativeRoleCarrier;delete globalThis.__nativeFramingCalls;});
 const {prepareSubjectActionInput}=await import('../../dist/workflow/subject-actions.js');
 const references={version:3,occurrenceIds:['code','procedure'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0,1],blockingOrdinaryIndexes:[0,1],retentionChoices:[]};
 const context=prepareSubjectActionInput('adjudicator',{stage:'review-adjudication',findingBodyInput:{version:6},metadataIdentityInput:{version:3},subjectActionsInput:{version:1},reviewResolutionInput:{version:2},baseVersion:'BASE',candidateVersion:'C',verificationVersion:'V',decisionReferences:references,
  occurrences:[{id:'code',data:{finding:finding('Actual current code defect')}},{id:'procedure',data:{finding:finding('Different original role-accounting allegation')}}],
  checks:[{id:'old-check',status:'pass',candidate:'C',verification:'OLD'},{id:'current-check',status:'pass',candidate:'C',verification:'V'}]});
 const output={...value,subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:{s0:{disposition:'upheld',resolution:'repaired',reason:'Actual current check supports this remedy',witnesses:['current-check']},s1:{disposition:'upheld',resolution:'pending',reason:'This separate allegation remains unresolved',witnesses:[]}}};
 const f=await produce(launch=>{
  const content=launch.frames.find(x=>x.type==='user').message.content,text=typeof content==='string'?content:content.find(x=>x.type==='text').text,wire=JSON.parse(text.split('\n')[1]).context;
  assert.equal(wire.findingBodyInput.version,6);assert.equal(wire.findingBodyEncoding,undefined);assert.deepEqual(wire.occurrences.map(x=>x.data.finding.description),context.occurrences.map(x=>x.data.finding.description));
  const captured=globalThis.__nativeFramingCalls.at(-1),schema=JSON.parse(captured.schema),validate=new Ajv2020({strict:false}).compile(schema);
  assert.equal(validate(output),true,JSON.stringify(validate.errors));assert.equal(validate({...output,decisionActions:{...output.decisionActions,s0:{...output.decisionActions.s0,witnesses:['old-check']}}}),false);
  if(carrier==='formatter/v1'){
   assert.deepEqual(JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]),schema);launch.format(JSON.stringify(output));launch.finish(output);
  }else{
   const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
   assert.ok(strings(launch.frames).some(x=>x.includes(captured.schema)),'Exact contextual schema is supplied in the actual SDK system instruction');completeText(launch,JSON.stringify(output));
  }
 },{role:'adjudicator',inputBundle:{...body,context}});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.protocol.decisions.length,2);assert.equal(f.result.protocol.decisions[0].witnesses[0],'current-check');assert.equal(f.result.protocol.decisions[1].resolution,undefined);assert.ok(f.launches.every(x=>x.joined));
});

for(const role of ['planner','challenger'])check('current planning semantic guidance reaches original SDK '+role,async t=>{
 const capability={...initialVerificationProfile,version:2,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']};
 const input={...body,context:{stage:role==='planner'?'planning':'planning-challenge',planningVerificationProfile:capability}};
 const output={...value,...(role==='planner'?{plan:mixedPlan()}:{alternatives:['Retain behavior cases and the complete allowed-delta scope proof']})},raw=JSON.stringify(output);
 const f=await produce(async launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const system=strings(launch.frames).find(v=>v.includes('You are the assigned '+role));
  assert.match(system,/Preserve the actual file restrictions with manifest-scope-duty/);
  assert.match(system,/Plan the whole healthy BASE-to-candidate delta against every allowedChangePaths and unchangedPaths list/);
  assert.match(system,/requiredPaths and fixturePaths identify inputs and confer no permission to change them/);
  assert.match(system,/Planning declares required parts and reviewer positions for future execution, not already completed candidate observations or reviews/);
  assert.ok(system.includes('Availability of a supported strategy kind does not itself impose a baseline execution requirement'));
  assert.ok(system.includes('that assignment alone does not require before-first-edit execution'));
  assert.ok(system.includes('owner intent or an originally accepted verification plan still gate editing'));
  assert.ok(system.includes('A genuinely required missing baseline execution remains blocking'));
  assert.equal(system.includes('Never invent a BASE assignment merely to satisfy the grammar'),false,'Only the planning judge selects finding implementation actions');
  assert.equal(launch.options.args.includes('--json-schema'),false);
  await completeRoleFixture(launch,output);
 },{role,inputBundle:input,maxProviderRequests:2});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.ok(f.launches.every(x=>x.joined));
});

for(const carrier of ['formatter/v1','assistant-json/v1'])check('current planning semantic guidance preserves procedural rejection and pending code through SDK '+carrier,async t=>{
 globalThis.__nativeRoleCarrier=carrier;t.after(()=>{delete globalThis.__nativeRoleCarrier;});
 const capability={...initialVerificationProfile,version:2,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']};
 const references={version:3,occurrenceIds:['code','procedure'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0,1],blockingOrdinaryIndexes:[0,1],retentionChoices:[]};
 const input={...body,context:{stage:'planning-adjudication',planningVerificationProfile:capability,decisionReferences:references,decisionCarryInput:{version:3},decisionCarry:{version:3,baselineVersion:'BASE',baseSourceIds:['base:consumer.cjs']},findingBodyInput:{version:5},metadataIdentityInput:{version:4},occurrences:[{id:'code',data:{finding:finding('Actual BASE return defect still needs its remedy')}},{id:'procedure',data:{finding:finding('An earlier independent accounting step was missing')}}]}};
 const output={...value,summary:'Decline while the genuine code duty stays pending; the earlier accounting condition is already addressed',planAccepted:false,decisions:[
  {occurrenceId:'code',disposition:'upheld',reason:'The genuine BASE code duty remains pending; no completed repair is claimed',witnesses:[],implementation:{kind:'none'}},
  {occurrenceId:'procedure',disposition:'rejected',reason:'Preserve the historical observation, but the already committed accounting record means it no longer blocks the current task',witnesses:['committed-accounting-record']},
 ]},raw=JSON.stringify(output);
 const f=await produce(launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const system=strings(launch.frames).find(v=>v.includes('You are the assigned adjudicator'));
  for(const instruction of ['BASE source availability does not turn an accounting or procedure allegation into a code defect.','This branch does not require an earlier round for ordinary current findings','Never invent a BASE assignment merely to satisfy the grammar','If an existing ordinary non-code blocker','none closes nothing','Do not use procedural rejection to waive a genuine BASE implementation or runner failure.','do not summarize plan acceptance as absence of unresolved blocking duties'])assert.ok(system.includes(instruction),instruction);
  assert.ok(system.includes('that assignment alone does not require before-first-edit execution'));
  assert.ok(system.includes('owner intent or an originally accepted verification plan still gate editing'));
  assert.ok(system.includes('A genuinely required missing baseline execution remains blocking'));
  assert.equal(launch.options.args.includes('--json-schema'),carrier==='formatter/v1');
  if(carrier==='formatter/v1'){launch.format(raw);launch.finish(output);}else completeText(launch,raw);
 },{role:'adjudicator',inputBundle:input});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.deepEqual(f.result.protocol.decisions,output.decisions);assert.ok(f.launches.every(x=>x.joined));
});

check('current planning semantic guidance retains a new procedural claim without a worker-chosen occurrence ID',async t=>{
 const capability={...initialVerificationProfile,version:2,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']};
 const input={...body,context:{stage:'planning-adjudication',planningVerificationProfile:capability}};
 const observed=finding('A genuinely new procedural condition needs independent accounting, not a guessed BASE assignment');
 const output={...value,summary:'Decline and retain this new condition for independent accounting',findings:[observed],decisions:[],planAccepted:false},raw=JSON.stringify(output);
 const f=await produce(async launch=>{
  const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const system=strings(launch.frames).find(v=>v.includes('You are the assigned adjudicator'));
  assert.ok(system.includes('Report a genuinely new claim in findings instead of inventing its future occurrence ID.'));
  assert.equal(launch.options.args.includes('--json-schema'),false);await completeRoleFixture(launch,output);
 },{role:'adjudicator',inputBundle:input,maxProviderRequests:2});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.deepEqual(f.result.protocol.findings,[observed]);assert.deepEqual(f.result.protocol.decisions,[]);assert.ok(f.launches.every(x=>x.joined));
});

async function providerActivityScenario(c, workId, launch, {ordinary=false}={}) {
 const {ConversationActivity}=await load('ui/conversation-activity.js');
 const {taskPresentation}=await load('ui/task-presentation.js');
 const {stripTerminalSequences}=await import('@earendil-works/pi-tui');
 const widgets=['en','ko'].map(locale=>({locale,activity:new ConversationActivity(()=>{})}));
 const registration=()=>c.listConversations().map(v=>c.getNativeHandle(v.conversationId)).find(v=>v?.identity.workId===workId);
 const current=registration();assert.ok(current,'Original admitted handle exists before Native receives its user turn');
 const render=()=>widgets.map(({locale,activity})=>{activity.update(c.inspectConversation(current.identity.conversationId).state,{runId:current.identity.runId,locale,providerActivity:registration()?.providerActivity});return activity.render(200).map(stripTerminalSequences).join('\n')});
 const ownerProgress=()=>widgets.map(({locale})=>{
  const role=c.inspectConversation(current.identity.conversationId);
  const owner={...role,conversationId:'controlled-owner',state:'IDLE',role:undefined};
  return taskPresentation({view:owner,roster:[role],locale,roleNative:id=>c.getNativeHandle(id)}).navigatorSummary;
 });
 const changes=[];const unsubscribe=c.subscribeInteraction(event=>{if(event.conversationId===current.identity.conversationId&&event.type==='native-provider-activity')changes.push(render())});
 const until=async test=>{for(let i=0;i<1000;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,2))}assert.fail('Expected original headless Native notice did not reach the live handle')};
 try{
  if(!ordinary){
   const read=await launch.read({path:path.join(appHome,'missing-wait-observability-fixture.txt'),offset:1,limit:1});
   assert.ok(read.response?.mcp_response?.result,'Actual Native/Pi tool roundtrip completes before the wait notice');
  }
  launch.send({type:'system',subtype:'api_retry',uuid:randomUUID(),session_id:launch.sid,attempt:2,max_retries:5,retry_delay_ms:1000,error_status:503});
  await until(()=>registration()?.providerActivity?.kind==='retry');
  const text=render();assert.match(text[0],/Provider retry \(2\/5\)/);assert.match(text[1],/서버 요청 재시도 중 \(2\/5\)/);assert.ok(changes.length);
  if(!ordinary){const [en,ko]=ownerProgress();assert.match(en,/Working on this change: Reviewing.*Provider retry \(2\/5\)/);assert.match(ko,/검토.*서버 요청 재시도 중 \(2\/5\)/);}
  const notice=registration().providerActivity;notice.attempt=99;assert.equal(registration().providerActivity.attempt,2,'Inspection cannot mutate the owned notice');
  for(const key of ['conversationId','workId','runId','launchId','generation','directionRevision','initialInputId']){c.changeCore.h.nativeLifecycle.activity({...current.identity,[key]:typeof current.identity[key]==='number'?current.identity[key]+1:'stale-'+key},null);assert.equal(registration().providerActivity.kind,'retry',key);}
  launch.send({type:'rate_limit_event',uuid:randomUUID(),session_id:launch.sid,rate_limit_info:{status:'rejected',resetsAt:2000000000,rateLimitType:'five_hour'}});
  await until(()=>registration()?.providerActivity?.kind==='rate-limit');
  const limited=render();assert.match(limited[0],/Model usage limit.*reported reset/);assert.match(limited[1],/모델 사용량 제한.*보고된 해제 시각/);
  if(!ordinary)assert.match(ownerProgress()[0],/Reviewing.*Model usage limit.*reported reset/);
  launch.send({type:'rate_limit_event',uuid:randomUUID(),session_id:launch.sid,rate_limit_info:{status:'allowed',rateLimitType:'five_hour'}});await until(()=>registration()?.providerActivity===undefined);
  assert.doesNotMatch(render()[0],/Provider retry|Model usage limit/);
  if(!ordinary)assert.doesNotMatch(ownerProgress()[0],/Provider retry|Model usage limit/);
  if(ordinary){launch.text('Controlled ordinary reply','ordinary-notice-'+randomUUID());launch.finish(undefined,{result:'Controlled ordinary reply'})}
  else{launch.format(JSON.stringify(value));launch.finish(value)}
 }finally{unsubscribe();for(const {activity}of widgets)activity.dispose()}
}
for(const variant of ['not-rejected','unfinished','foreign-session'])check('rejected formatter diagnosis requires original complete same-session rejection '+variant,async t=>{
 globalThis.__nativeFramingCalls=[];globalThis.__nativeRoleCarrier='formatter/v1';t.after(()=>{delete globalThis.__nativeFramingCalls;delete globalThis.__nativeRoleCarrier;});
 const raw=JSON.stringify({...value,findings:'Uninterpreted allegation',alternatives:[]});
 const f=await controllerRole(t,launch=>{const {input}=planningTextInput(launch,1);
  launch.format(raw,{carrierError:variant!=='not-rejected',complete:variant!=='unfinished',foreignSession:variant==='foreign-session'});
  const final={...value,findings:[],alternatives:[],assessedScope:input.requiredScope};launch.format(JSON.stringify(final));launch.finish(final);
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 const rows=f.c.store.all('SELECT * FROM role_outputs WHERE launch=?',f.launch.id);
 assert.ok(rows.every(row=>JSON.parse(row.data).materialAssessment?.version!==2));
 assert.ok(f.c.changeCore.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'));
 assert.equal(f.launch.status,'UNUSABLE');
});

for(const variant of ['prospective','historical-empty','historical-claims'])check('complete rejected formatter allegations remain independently diagnosable through the original public material '+variant,async t=>{
 const historicalCache=variant!=='prospective',historicalClaims=variant==='historical-claims';
 globalThis.__nativeFramingCalls=[];globalThis.__nativeRoleCarrier='formatter/v1';
 t.after(()=>{delete globalThis.__nativeFramingCalls;delete globalThis.__nativeRoleCarrier;});
 const allegation='The proposed empty JSON inputs do not exercise the actual consumer. Review this allegation independently.';
 const observed=finding('A separate final literal claim'),priorFinding=finding('Earlier literal allegation remains at its original location');
 const raw=historicalClaims ? JSON.stringify({...value,findings:[priorFinding],alternatives:[]}).replace('\"findings\":'+JSON.stringify([priorFinding]),'\"findings\":'+JSON.stringify([priorFinding])+',\"findings\":'+JSON.stringify(allegation)) : JSON.stringify({...value,findings:allegation,alternatives:[]});
 const f=await controllerRole(t,launch=>{
  const {input}=planningTextInput(launch,1);launch.format(raw,{carrierError:true});
  const final={...value,findings:[observed],alternatives:[],assessedScope:historicalCache?[{sourceId:input.sources[0].id,startLine:1,endLine:999}]:input.requiredScope};
  launch.format(JSON.stringify(final));launch.finish(final);
 },'challenger',{stage:'planning-challenge',planProposal:mixedPlan()});
 assert.equal(f.launch.status,historicalCache?'UNUSABLE':'COMPLETE');
 const s=f.c.store,core=f.c.changeCore,outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id);
 let source=outputs.find(o=>JSON.parse(o.data).materialAssessment?.version===2);assert.ok(source);assert.equal(source.raw,raw);
 if(historicalCache){
  const {hash}=await load('controller/change-files.js');
  // Reconstruct the prior collector's actual zero-literal receipt in this
  // disposable fixture only. Received Native bytes and selected output stay exact.
  const diagnosis=s.one('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal DESC LIMIT 1',source.id);
  s.run('DELETE FROM obligations WHERE id=?',diagnosis.id);s.run('DELETE FROM finding_occurrences WHERE id=?',diagnosis.id);
  const md=JSON.parse(source.data),locationSource=md.materialAssessment.source;delete md.materialAssessment;md.accountingKey=hash({source:locationSource,locations:md.harvestedFindings.length?md.materialSources.map(({findingPath,memberPath,index})=>({findingPath,memberPath,index})):[]});
  s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(md),source.id);
  const oldSource=s.one('SELECT * FROM role_outputs WHERE id=?',source.id),oldPrimary=outputs.find(o=>o.status==='unusable');
  const ld=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data);ld.materialAccounting.version=9;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),f.launch.id);
  const holdId='raw-incomplete-'+f.launch.id+'-native-material';s.run('INSERT INTO obligations VALUES(?,?,?)',holdId,f.workId,JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId:f.launch.id,historyRef:ld.historyRef,extractionIssueCount:1,extractionIssues:[{entryId:md.nativeEntryId,reason:'Original formatter envelope or literal findings are incomplete or unsupported'}]}));
  const lineage=s.one('SELECT lineage FROM works WHERE id=?',f.workId).lineage;s.run('UPDATE budgets SET lim=consumed WHERE lineage=?',lineage);
  const budget=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',lineage),births=launches.length;
  await assert.rejects(f.c.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
  assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',oldSource.id),oldSource);assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',oldPrimary.id),oldPrimary);
  assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',lineage),budget);assert.equal(launches.length,births);
  assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',holdId).data).state,'resolved');
  source=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id).find(o=>JSON.parse(o.data).materialAssessment?.version===2);assert.ok(source);assert.notEqual(source.id,oldSource.id);
  const restored=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id);
  await assert.rejects(f.c.planChange({workId:f.workId,model}),/Unusable producer diagnosis requires explicit drive\/resume recovery/);
  assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),restored);assert.equal(launches.length,births);
 }
 assert.notEqual(JSON.parse(s.one('SELECT * FROM obligations WHERE id=?','raw-incomplete-'+f.launch.id+'-native-material')?.data??'{}').state,'pending');
 const claims=s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',source.id);assert.equal(claims.length,1);
 assert.equal(JSON.parse(claims[0].data).finding.requirementId,'producer-integrity');assert.ok(core.pending(f.workId).some(o=>o.id===claims[0].id));
 const evidence=core.producerDiagnostics(f.workId);assert.ok(evidence.outputs.some(o=>o.outputId===source.id&&o.raw===raw));
 const origin=await core.diagnosisOrigin(f.workId,claims[0].id);assert.equal(origin.output.raw,raw);assert.equal(origin.material.length,historicalClaims?1:0);
 const historical=await core.historicalPlanningProducer(f.workId,source.id);historical.assertCurrent();
 const primary=outputs.find(o=>o.status===(historicalCache?'unusable':'usable'));assert.ok(primary);assert.notEqual(primary.id,source.id);
 const snapshot=()=>s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),before=snapshot();
 if(historicalClaims){
  const reference=JSON.parse(source.data).materialAssessment.coveredOutputs[0],row=s.one('SELECT * FROM role_outputs WHERE id=?',reference.id);s.run('UPDATE role_outputs SET raw=? WHERE id=?',row.raw+' ',row.id);
  assert.throws(()=>historical.assertCurrent(),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);await assert.rejects(core.diagnosisOrigin(f.workId,claims[0].id),/correspondence|changed/);
 }else{
  const history=JSON.parse(f.run.data).historyRef;fs.appendFileSync(history,'\n');
  assert.throws(()=>historical.assertCurrent(),/HISTORICAL_MATERIAL_PROOF_UNAVAILABLE/);assert.deepEqual(snapshot(),before,'Source revalidation never promotes or rewrites an output');
 }
});

check('headless governed Native retry and rate facts reach owned EN/KO status without changing source collection',async t=>{
 let controller,work;const f=await controllerRole(t,launch=>providerActivityScenario(controller,work,launch),'reviewer',{stage:'fresh-review'},(c,w)=>{controller=c;work=w});
 assert.equal(f.run.phase,'SETTLED');assert.ok(launches.at(-1).joined);assert.equal(f.c.getNativeHandle(f.c.listConversations().find(v=>v.workId===work&&v.role)?.conversationId),null);
});
check('optional Native display observer failure preserves original structured source and result',async()=>{
 const id=randomUUID();let notices=0;
 const f=await produce(launch=>{launch.send({type:'system',subtype:'api_retry',uuid:randomUUID(),session_id:launch.sid,attempt:1,max_retries:2,retry_delay_ms:1,error_status:503});launch.format(JSON.stringify(value));launch.finish(value)},
 {launchId:id,nativeIdentity:{conversationId:'display-C',workId:'display-W',runId:'display-R',launchId:id,generation:1,directionRevision:0,initialInputId:'display-I'},nativeLifecycle:{ready(){},settling(){},released(){},activity(){notices++;throw Error('Optional view unavailable')}}});
 assert.ok(notices>0);assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.deepEqual(JSON.parse(read(f)),value);
});

check('required Native source observer failure cannot publish an unretained retry notice',async()=>{
 const id=randomUUID(),notices=[];
 const f=await produce(launch=>{launch.send({type:'system',subtype:'api_retry',uuid:randomUUID(),session_id:launch.sid,attempt:1,max_retries:2,retry_delay_ms:1,error_status:503,error:'x'.repeat(2*1024*1024+1)})},
 {launchId:id,nativeIdentity:{conversationId:'source-C',workId:'source-W',runId:'source-R',launchId:id,generation:1,directionRevision:0,initialInputId:'source-I'},nativeLifecycle:{ready(){},settling(){},released(){},activity(_identity,activity){notices.push(activity)}}});
 assert.equal(f.result.usable,false);assert.match(f.result.issues.join(' '),/original provider evidence exceeds declared bounds/);assert.ok(notices.every(notice=>notice===null),'A rejected source callback cannot publish its display fact');
});
check('finite counter quota preserves26000 SDK packets, full settlement and readable checkpoint',async()=>{
  const sent=[],raw=JSON.stringify(value);
  const f=await produce(launch=>{
   for(let i=0;i<13000;i++){
    const counter={type:'system',subtype:'thinking_tokens',estimated_tokens:i+1,estimated_tokens_delta:1,uuid:randomUUID(),session_id:launch.sid};
    const opaque={type:'system',subtype:'budget_fixture',uuid:randomUUID(),session_id:launch.sid,data:'x'.repeat(400)};
    for(const message of [counter,opaque]){sent.push(message);launch.send(message)}
   }
   launch.format(raw);launch.finish(value);
  },{timeoutMs:45000});
  assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(read(f),raw);
  const sdk=f.entries.filter(e=>e.customType===nativeRoleEntries.sdk),retained=sdk.filter(e=>e.data.message.subtype==='thinking_tokens'||e.data.message.subtype==='budget_fixture');
  assert.deepEqual(retained.map(e=>e.data.message),sent,'Every original envelope remains literal and in order');
  assert.deepEqual(sdk.map(e=>e.data.sequence),sdk.map((_,i)=>i+1));
  const settlement=f.entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation;
  assert.equal(settlement.messages,sdk.length);assert.equal(settlement.messageDigest,createHash('sha256').update(sdk.map(e=>JSON.stringify(e.data.message)+'\n').join('')).digest('hex'));
  const counterBytes=sent.filter(m=>m.subtype==='thinking_tokens').reduce((n,m)=>n+Buffer.byteLength(JSON.stringify(m)),0),normalBytes=sdk.filter(e=>e.data.message.subtype!=='thinking_tokens').reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.message)),0);
  assert.ok(counterBytes<4*1024*1024);assert.ok(normalBytes<8*1024*1024);assert.ok(normalBytes+counterBytes>8*1024*1024,'Fixture crosses the former shared quota');
  const historyBytes=fs.statSync(f.result.historyRef).size;assert.ok(historyBytes<32*1024*1024,'Complete serialized Pi history fits unchanged reader bound');
  const {nativeCheckpoint}=await load('controller/history.js');const checkpoint=await nativeCheckpoint(f.result.historyRef);assert.deepEqual(checkpoint,f.result.nativeCheckpoint);
  console.log(JSON.stringify({kind:'native-counter-quota-measurement',sdkMessages:sdk.length,counterBytes,normalBytes,historyBytes}));
},{timeout:60000});
for(const {kind,failedResult} of [{kind:'normal',failedResult:false},{kind:'normal',failedResult:true},{kind:'counter',failedResult:false}])check('aggregate capture stop retains crossing packet and owns Native tail; '+kind+' failed result='+failedResult,async()=>{
 const {NativeRoleCollector}=await load('workflow/native-role-output.js');
 const original=NativeRoleCollector.prototype.observe,observed=[];let manager,crossing;
 NativeRoleCollector.prototype.observe=function(data){observed.push(structuredClone(data));return original.call(this,data)};
 try{
  const f=await produce(async launch=>{
   const until=async condition=>{for(let i=0;i<2000;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,1))}assert.fail('Capture fixture source did not arrive')};
   const sdk=()=>manager.getBranch().filter(e=>e.customType===nativeRoleEntries.sdk);
   await until(()=>sdk().some(e=>e.data.message.subtype==='init'));
   if(!failedResult){launch.format('',{complete:false});await until(()=>sdk().some(e=>e.data.message.type==='stream_event'&&e.data.message.event.type==='content_block_delta'));}
   const final={type:'result',subtype:'error_during_execution',is_error:true,uuid:randomUUID(),session_id:launch.sid,duration_ms:1,duration_api_ms:1,num_turns:1,result:'Controlled failed result',errors:['Controlled failed result'],total_cost_usd:0,permission_denials:[],usage:{input_tokens:1,output_tokens:1}};
   const counter=length=>({type:'system',subtype:'thinking_tokens',uuid:randomUUID()+'x'.repeat(length-36),session_id:launch.sid,estimated_tokens:1,estimated_tokens_delta:1});
   if(kind==='counter'){
    const min=Buffer.byteLength(JSON.stringify(counter(36))),max=Buffer.byteLength(JSON.stringify(counter(200)));let remaining=4*1024*1024;
    while(remaining>3*max){launch.send(counter(200));remaining-=max;}
    for(let i=0;i<3;i++){const extra=Math.min(164,remaining-(3-i)*min);assert.ok(extra>=0);launch.send(counter(36+extra));remaining-=min+extra;}assert.equal(remaining,0);crossing=counter(36);
   }else{
    let remaining=8*1024*1024-sdk().reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.message)),0)-(failedResult?Buffer.byteLength(JSON.stringify(final)):0);
    while(remaining){const amount=Math.min(1024*1024,remaining),message={type:'system',subtype:'capture-fill',uuid:randomUUID(),session_id:launch.sid,data:''};message.data='x'.repeat(amount-Buffer.byteLength(JSON.stringify(message)));launch.send(message);remaining-=amount;}
    if(failedResult){launch.send(final);crossing={type:'system',subtype:'capture-crossing',uuid:randomUUID(),session_id:launch.sid,data:'Last received bounded event'};}
    else crossing={type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event:{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({...value,findings:[finding('Original crossing-packet claim stays retained')]})}}};
   }
   launch.send(crossing);launch.send({type:'system',subtype:'must-not-reach-source-observer',uuid:randomUUID(),session_id:launch.sid});
  },{timeoutMs:30000,beforeModelRequest:async m=>{manager=m}});
  assert.equal(f.result.usable,false);assert.match(f.result.issues.join(' '),/NATIVE_CAPTURE_LIMIT_RETAINED/);assert.equal(f.result.selectedFinalEntryId,null);assert.ok(f.launches.every(l=>l.joined));
  const sdk=f.entries.filter(e=>e.customType===nativeRoleEntries.sdk),served=observed.filter(m=>m.type!=='gitjig.native-query-settled/v1');
  assert.deepEqual(sdk.map(e=>e.data.message),served,'Every SDK event delivered to the original observer was retained');
  assert.equal(sdk.filter(e=>e.data.message.uuid===crossing.uuid).length,1);assert.deepEqual(sdk.at(-1).data.message,crossing);
  assert.equal(served.some(m=>m.subtype==='must-not-reach-source-observer'),false,'Awaited observer failure stops SDK intake before the next queued message');
  assert.deepEqual(sdk.map(e=>e.data.sequence),sdk.map((_,i)=>i+1));
  const controls=f.entries.filter(e=>e.customType===nativeRoleEntries.settlement);
  assert.equal(controls.length,1,'Joined cleanup retains its original seen-message census even without a terminal SDK result');assert.equal(controls[0].data.attestation.messages,sdk.length);assert.equal(controls[0].data.attestation.messageDigest,createHash('sha256').update(served.map(m=>JSON.stringify(m)+'\n').join('')).digest('hex'));
  if(!failedResult){assert.equal(f.result.providerFailure,undefined);if(kind==='normal')assert.ok(f.entries.some(e=>e.customType===nativeRoleEntries.material&&e.data.raw.includes('Original crossing-packet claim stays retained')));}
  const {nativeCheckpoint}=await load('controller/history.js');assert.deepEqual(await nativeCheckpoint(f.result.historyRef),f.result.nativeCheckpoint);assert.ok(fs.statSync(f.result.historyRef).size<32*1024*1024);
 }finally{NativeRoleCollector.prototype.observe=original;}
});
for(const mode of ['reject','retire','abort','close','source-failure','foreign'])check('original structured source observation ordering '+mode,async()=>{
 const {createPiSession}=await load('pi/session.js'),{NativeRoleCollector}=await load('workflow/native-role-output.js'),{nativeRoleFraming}=await load('workflow/role-framing.js'),{SessionManager}=await import('@earendil-works/pi-coding-agent');
 const framing=nativeRoleFraming('reviewer',body,randomUUID(),3),raw=JSON.stringify(value),target='owned-observer-material-'+randomUUID();let collector,closing,called=0,priorOptions;
 const p=await createPiSession({host,operations,model,maxReadBytes:1024,systemPrompt:framing.systemPrompt,roleContextBudget:{assertEntry(){},structuredOutput:{intent:framing.intent,observe(data,manager){if(collector.manager!==manager)throw Error('CONTROLLED_FOREIGN_SOURCE_WRITER');if(mode==='source-failure'&&data.type==='assistant'&&data.message?.id===target)throw Error('CONTROLLED_SOURCE_RETENTION_FAILURE');collector.observe(data)}}},beforeModelRequest:async manager=>{collector??=new NativeRoleCollector(mode==='foreign'?SessionManager.inMemory(project):manager,framing.intent)}});
 const stream=p.session.agent.streamFunction;
 p.session.agent.streamFunction=(selected,context,options)=>{
  priorOptions={...options,onProviderStreamEvent:async function(data){if(data.type!=='assistant'||data.message?.id!==target)return;called++;assert.equal(this,priorOptions);data.message.content[0].text='Observer mutation cannot replace original source';
   if(mode==='reject')throw Error('CONTROLLED_OBSERVER_REJECTION');if(mode==='retire')p.sealOwned();if(mode==='abort')void p.session.agent.abort();if(mode==='close')closing=p.closeOwned();
  }};return stream.call(p.session.agent,selected,context,priorOptions);
 };
 selectedScenario=launch=>{launch.text(raw,target);launch.finish(value)};
 try{await p.session.prompt(framing.prompt);}
 finally{await p.closeOwned();await closing;}
 const sourceFailure=mode==='source-failure'||mode==='foreign';assert.equal(called,sourceFailure?0:1);assert.ok(launches.at(-1).joined);
 const entries=parseSessionEntries(fs.readFileSync(p.sessionManager.getSessionFile(),'utf8')),received=entries.filter(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='assistant'&&e.data.message.message.id===target);
 assert.equal(received.length,sourceFailure?0:1);if(!sourceFailure)assert.equal(received[0].data.message.message.content[0].text,raw);
 if(mode==='foreign')assert.equal(collector.manager.getBranch().some(e=>e.customType===nativeRoleEntries.sdk),false,'A foreign writer acquires no original source');
 const last=p.session.messages.filter(m=>m.role==='assistant').at(-1);assert.notEqual(last?.stopReason,'stop');
 if(mode==='reject')assert.match(last?.errorMessage??'',/CONTROLLED_OBSERVER_REJECTION/);
 if(mode==='retire')assert.match(last?.errorMessage??'',/execution is sealed/);
 if(mode==='source-failure')assert.match(last?.errorMessage??'',/CONTROLLED_SOURCE_RETENTION_FAILURE/);
 if(mode==='foreign')assert.match(last?.errorMessage??'',/CONTROLLED_FOREIGN_SOURCE_WRITER/);
 assert.equal(entries.some(e=>e.customType===nativeRoleEntries.final),false,'Retaining received bytes confers no selected role result');
});
check('headless ordinary Native retry and rate facts reach the same owned EN/KO status',async t=>{
 const {openController}=await load('controller/index.js'),{ApplicationModels}=await load('app/models.js');
 const c=await openController({installationHome:appHome});t.after(()=>c.close());
 await c.adoptModelResource(owner);const models=new ApplicationModels(c);models.install();const choice=await models.choice('claude-bridge','claude-sonnet-4-6','off'),view=await models.newConversation({choice});
 const input=await c.queueConversationInput({conversationId:view.conversationId,expectedGeneration:0,text:'Controlled native wait status',mode:'idle'});
 selectedScenario=launch=>{const registration=c.getNativeHandle(view.conversationId);return providerActivityScenario(c,registration.identity.workId,launch,{ordinary:true})};
 const result=await c.runConversation({conversationId:view.conversationId,...models.conversationOperation(view.conversationId)});assert.equal(result.status,'delivered',JSON.stringify(result));assert.ok(input.inputId);assert.equal(c.getNativeHandle(view.conversationId),null);
});

for(const role of ['planner','adjudicator'])check('planning grammar6 explicit verification domain reaches original Native schema and preserves literal selected output: '+role,async t=>{
 useFormatterFixture(t);
 const profile={...initialVerificationProfile,version:6,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']},plan=mixedPlan(),context={stage:role==='planner'?'planning':'planning-adjudication',planningVerificationProfile:profile};
 const output=writeFixtureVerificationDomain({...value,...(role==='planner'?{plan}:{planAccepted:true,decisions:[],acceptedPlan:plan})},context),raw=JSON.stringify(output);
 const f=await produce(launch=>{
  const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
  const shape=schema.properties[role==='planner'?'plan':'acceptedPlan'];assert.ok(shape.required.includes('verificationRequirements'));assert.equal(shape.properties.requirements,undefined);assert.equal(JSON.stringify(schema).includes('this plan.requirements'),false);
  assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true);launch.format(raw);launch.finish(output);
 },{role,inputBundle:{...body,context}});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.deepEqual(f.result.protocol[role==='planner'?'plan':'acceptedPlan'],plan);assert.equal(f.result.nativeSource.kind,'claude-sdk-formatter/v1');assert.ok(f.launches.every(launch=>launch.joined));
});

for(const role of ['planner','challenger','adjudicator'])check('planning7 current domain view reaches owned SDK and canonical output: '+role,async t=>{
 assert.equal(globalThis.__nativeFramingCalls,undefined);globalThis.__nativeFramingCalls=[];t.after(()=>{delete globalThis.__nativeFramingCalls;});
 const profile={...initialVerificationProfile,version:7,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']},plan=mixedPlan(),context={stage:role==='planner'?'planning':role==='challenger'?'planning-challenge':'planning-adjudication',planVersion:null,planningVerificationProfile:profile,...(role==='challenger'?{planProposal:plan,plannerOutput:{...value,plan}}:role==='adjudicator'?{planProposal:plan}:{})};
 const finding={requirementId:'original-operating-obligation',severity:'optional',repair:'unknown',description:'Original or historical task obligation outside the current verification subset.',evidence:['original-owner']};
 const output=writeFixtureVerificationDomain({...value,findings:[finding],...(role==='planner'?{plan}:role==='challenger'?{alternatives:[]}:{planAccepted:true,decisions:[],acceptedPlan:plan})},context),raw=JSON.stringify(output);
 const f=await produce(async launch=>{
  const content=launch.frames.find(frame=>frame.type==='user').message.content,text=typeof content==='string'?content:content.filter(part=>part.type==='text').map(part=>part.text).join(''),wire=JSON.parse(text.split('\n')[1]);
  const strings=value=>typeof value==='string'? [value] : value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
  const system=strings(launch.frames).find(value=>value.includes('You are the assigned '+role));
  assert.match(system,/Plan the whole healthy BASE-to-candidate delta.*including nested duties and scope added during adjudication/);
  assert.match(system,/Include checker and fixture files you intend to add or change when owner scope permits them/);
  assert.match(system,/Exercise a deliberately faulty variant separately through consumer-control/);
  assert.equal(wire.context.planningVerificationProfile.baseline.newObservationAllowed,true);assert.equal(wire.context.planningVerificationProfile.baseline.newObservation,undefined);assert.equal(wire.context.requirementsView.kind,'task-request-and-constraints');
  if(role!=='planner'){assert.ok(wire.context.planProposal.verificationRequirements);assert.equal(wire.context.planProposal.requirements,undefined);}
  if(role==='challenger')assert.ok(wire.context.plannerOutput.plan.verificationRequirements);
  assert.deepEqual(readFixtureMetadataContext(wire.context),context);
  const formatted=launch.options.args.includes('--json-schema'),frame=globalThis.__nativeFramingCalls.find(frame=>frame.role===role);assert.ok(frame);assert.equal(frame.version,3);assert.equal(formatted,false);
  const schema=JSON.parse(frame.schema);assert.match(schema.properties.findings.items.properties.requirementId.description,/not an enum/);assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true);
  if(formatted){assert.deepEqual(JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]),schema);launch.format(raw);launch.finish(output);}else{const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];assert.deepEqual(launch.tools.find(tool=>tool.name==='gitjig_submit_role_result').inputSchema,schema);await completeRoleFixture(launch,output);}
 },{role,inputBundle:{...body,context},maxProviderRequests:2});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.equal(f.result.rawFinal,raw);assert.equal(f.result.protocol.findings[0].requirementId,finding.requirementId);if(role!=='challenger')assert.deepEqual(f.result.protocol[role==='planner'?'plan':'acceptedPlan'],plan);
 assert.ok(f.launches.every(launch=>launch.joined));
});

check('scope amendment binds all failed source IDs through original Native adjudication',async()=>{
 const {parseRoleOutput}=await load('workflow/protocol.js');
 const {roleOutputSchema}=await load('workflow/role-output-shape.js');
 const {captureScopeAmendment,scopeStrategyDigest}=await load('workflow/scope-amendment.js');
 const verification={...initialVerificationProfile,version:7,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']};
 const plan=mixedPlan(), oldScope=plan.verification.strategies.find(strategy=>strategy.kind==='manifest-scope-duty');
 const scopeAmendment={version:1,checkpoint:'a'.repeat(64),subjects:[
  {evidenceId:'failed-scope-one',requirementId:'scope',strategyDigest:scopeStrategyDigest(oldScope)},
  {evidenceId:'failed-scope-two',requirementId:'behavior',strategyDigest:scopeStrategyDigest({...oldScope,requirementId:'behavior'})},
 ]};
 const context={stage:'planning-adjudication',planVersion:null,planningVerificationProfile:verification,scopeAmendment};
 const scopeAmendments=[
  {evidenceId:'failed-scope-one',action:'retain',reason:'Keep the independently verified path restriction in its original requirement.'},
  {evidenceId:'failed-scope-two',action:'remove',reason:'The original request requires isolation of the defective execution. The consumer check covers that requirement.'},
 ];
 const output=writeFixtureVerificationDomain({...value,planAccepted:true,decisions:[],acceptedPlan:plan,scopeAmendments},context);
 const raw=JSON.stringify(output);
 const f=await produce(async launch=>{
  const {inputSchema}=launch.tools.find(tool=>tool.name==='gitjig_submit_role_result');
  const schema=inputSchema.properties.scopeAmendments;
  assert.equal(schema.minItems,2);
  assert.equal(schema.maxItems,2);
  assert.deepEqual(schema.items.properties.evidenceId.enum,scopeAmendment.subjects.map(subject=>subject.evidenceId));
  assert.equal(new Ajv2020({strict:false}).compile(inputSchema)(output),true);
  await completeRoleFixture(launch,output);
 },{role:'adjudicator',inputBundle:{...body,context},maxProviderRequests:2});
 assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));
 assert.equal(f.result.rawFinal,raw);
 assert.deepEqual(f.result.protocol.scopeAmendments,scopeAmendments);
 assert.ok(f.launches.every(launch=>launch.joined));

 const constraints={planningProfile:verification,scopeAmendment};
 const {scopeAmendments:_decisions,...missing}=output;
 for(const changed of [missing,{...output,scopeAmendments:[scopeAmendments[0],scopeAmendments[0]]},
  {...output,scopeAmendments:[scopeAmendments[0],{...scopeAmendments[1],evidenceId:'foreign'}]},
  {...output,scopeAmendments:[scopeAmendments[0],{...scopeAmendments[1],reason:'한'.repeat(1024)}]},
  {...output,scopeAmendments:[{...scopeAmendments[0],action:'replace'},scopeAmendments[1]]},
  {...output,scopeAmendments:[scopeAmendments[0],{...scopeAmendments[1],action:'retain'}]},
  {...output,planAccepted:false}])
  assert.equal(parseRoleOutput(JSON.stringify(changed),'adjudicator',[],constraints).value,null);
 assert.equal(parseRoleOutput(raw,'adjudicator',[],{planningProfile:verification}).value,null);
 assert.equal(parseRoleOutput(raw,'reviewer',[],constraints).value,null);
 assert.throws(()=>roleOutputSchema('adjudicator','review-adjudication',[],constraints),/requires planning adjudication/);
 assert.ok(parseRoleOutput(JSON.stringify({...missing,planAccepted:false}),'adjudicator',[],constraints).value);
 const copy=captureScopeAmendment(scopeAmendment);
 scopeAmendment.subjects.pop();
 assert.equal(copy.subjects.length,2);
 assert.throws(()=>captureScopeAmendment({...scopeAmendment,subjects:Array(1)}),/subject unavailable/);
});

}
