/** Original owned role/Pi/AgentSDK/MCP boundary; controlled native transport.
 * These tests do not qualify a live model, account, engine or native executable. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import cp from 'node:child_process';
import net from 'node:net';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {PassThrough,Writable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';

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
const originalProducer=new URL('../../dist/pi/native-process.js',import.meta.url).href,shim=path.join(root,'producer-shim.mjs');
fs.writeFileSync(shim,`export * from ${JSON.stringify(originalProducer)};export async function createOwnedNativeProducer(){return {launch(options,binding){return globalThis.__nativeRoleFormatSpawn({...binding,options});},async close(){return {cleanup:'confirmed'};}};}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(s==='./native-process.js'&&c.parentURL?.endsWith('/dist/pi/claude-host.js'))return {url:pathToFileURL(shim).href,shortCircuit:true};return n(s,c);}});
// A synthetic lower-capacity catalogue entry exercises the forward-compatible
// policy boundary; it makes no claim about that real model's served capacity.
const originalBridge=import.meta.resolve('@gitjig/pi-claude-bridge-host'),catalogueShim=path.join(root,'catalogue-shim.mjs');
fs.writeFileSync(catalogueShim,`import * as bridge from ${JSON.stringify(originalBridge)};export * from ${JSON.stringify(originalBridge)};export function createClaudeBridgeHost(options){const host=bridge.createClaudeBridgeHost(options),original=host.registration.bind(host);return {...host,registration:(...args)=>{const r=original(...args);return {...r,provider:{...r.provider,config:{...r.provider.config,models:r.provider.config.models.map(m=>m.id==='claude-haiku-4-5'?{...m,maxTokens:16000}:m)}}};}};}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(s==='@gitjig/pi-claude-bridge-host'&&c.parentURL?.endsWith('/dist/pi/claude-host.js'))return {url:pathToFileURL(catalogueShim).href,shortCircuit:true};return n(s,c);}});
// Replace only the physical engine boundary. Controller reservation, capture,
// dispatch checkpoints, settlement, collection and retained readers stay original.
const scopeShim=path.join(root,'scope-shim.mjs');
fs.writeFileSync(scopeShim,`export async function createScope(options){return globalThis.__nativeRoleFormatScope(options);}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(c.parentURL?.endsWith('/controller/change-core.js')&&s.endsWith('/execution/container-scope.js'))return {url:pathToFileURL(scopeShim).href,shortCircuit:true};return n(s,c);}});
// Inject a malformed generated schema only at the Controller framing boundary.
// Current session admission and historical collection remain original consumers.
const originalFraming=new URL('../../dist/workflow/role-framing.js',import.meta.url).href,framingShim=path.join(root,'framing-shim.mjs');
fs.writeFileSync(framingShim,`import {roleFraming as original} from ${JSON.stringify(originalFraming)};export function roleFraming(...args){const value=original(...args),key=globalThis.__nativeFormatRootDefect;return key?{...value,schema:{...value.schema,[key]:[{type:'object'}]}}:value;}`,{mode:0o600});
registerHooks({resolve(s,c,n){if(s==='../workflow/role-framing.js'&&c.parentURL?.endsWith('/dist/controller/change-core.js'))return {url:pathToFileURL(framingShim).href,shortCircuit:true};return n(s,c);}});
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
    const launch={ownerSessionId,purpose,options,sid,frames:[],joined:false};
    const send=frame=>{if(!stdout.destroyed&&!stdout.writableEnded)stdout.write(JSON.stringify(frame)+'\n');};
    const request=(subtype,fields)=>new Promise(resolve=>{const id='control-'+(++sequence);replies.set(id,resolve);send({type:'control_request',request_id:id,request:{subtype,...fields}});});
    const mcp=(method,params)=>request('mcp_message',{server_name:'custom-tools',message:{jsonrpc:'2.0',id:++sequence,method,params:method==='tools/call'?{...params,_meta:{'claudecode/toolUseId':randomUUID(),...params._meta}}:params}});
    launch.send=send;launch.mcp=mcp;
    launch.finish=(value,{result='',subtype='success',is_error=false,numTurns=1,modelUsage}={})=>send({type:'result',subtype,is_error,uuid:randomUUID(),session_id:sid,duration_ms:1,duration_api_ms:1,num_turns:numTurns,result,
        ...(value===undefined?{}:{structured_output:value}),...(modelUsage?{modelUsage}:{}),total_cost_usd:0,permission_denials:[],usage:{input_tokens:1,output_tokens:1}});
    launch.text=(raw,mid)=>send({type:'assistant',uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,message:{id:mid,type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[{type:'text',text:raw}],stop_reason:null,usage:{input_tokens:1,output_tokens:1}}});
    launch.format=(raw,{carrier=true,carrierError=false,complete=true,assistantBeforeStop=false,foreignSession=false,earlyMessageStop=false,interim=[],toolName='StructuredOutput'}={})=>{
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
        event({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:1}});event({type:'message_stop'});
        if(carrier)send({type:'user',uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:tid,is_error:carrierError,content:carrierError?'Controlled invalid formatter attempt':'Structured output provided successfully'}]}});
        return {mid,tid};
    };
    launch.read=async input=>{
        const {tid}=launch.format(JSON.stringify(input),{toolName:'mcp__custom-tools__read',carrier:false});
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
                send({type:'system',subtype:'init',uuid:randomUUID(),session_id:sid,model:'claude-sonnet-4-6',cwd,tools:[...launch.tools.map(t=>'mcp__custom-tools__'+t.name),...(options.args.includes('--json-schema')?['StructuredOutput']:[])],mcp_servers:launch.tools.length?[{name:'custom-tools',status:'connected'}]:[],plugins:[]});
                await scenario(launch);
            })().catch(error=>{launch.error=error;stdout.destroy(error);});}
        }
        done();
    }});
    Object.assign(child,{stdin,stdout,killed:false,exitCode:null,kill(){this.killed=true;return true;}});
    stdin.on('finish',()=>{child.exitCode=0;stdout.end();child.emit('exit',0,null);launch.joined=true;resolveJoin({cleanup:'confirmed',exited:true,pipesClosed:true,scopeJoined:true});});
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
let allPassed=true;
const check=(name,body)=>test(name,{timeout:15000},async t=>{try{await body(t);}catch(error){allPassed=false;throw error;}});
async function produce(scenario,options={}) {
    selectedScenario=scenario;const before=launches.length,launchId=randomUUID();let checkpoints=0,intentReceipt;
    const result=await runRole({launchId,role:'reviewer',inputBundle:body,operations,host,model,timeoutMs:8000,maxProviderRequests:1,maxNativeTurns:3,assertEntry(){},beforeModelRequest:async(_manager,receipt)=>{checkpoints++;intentReceipt=receipt;},...options});
    assert.deepEqual(denied,[]);const entries=result.historyRef&&fs.existsSync(result.historyRef)?parseSessionEntries(fs.readFileSync(result.historyRef,'utf8')):[];
    return {result,entries,launches:launches.slice(before),checkpoints,intentReceipt};
}
const read=f=>readSelectedRoleOutput(f.entries,{entryId:f.result.selectedFinalEntryId,sessionId:f.result.nativeSessionId,launchId:f.result.launchId,role:'reviewer',stage:'fresh-review',checkpointLeafId:f.result.nativeCheckpoint.leafId,nativeIntent:f.intentReceipt},f.result.nativeSource);

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
    const criteria=c.changes.criteriaHoldReason;c.changes.criteriaHoldReason=()=> 'Controlled stronger current criteria hold';
    try{assert.match(inspect().nextAction,/Review updated gitjig workflow rules/);assert.doesNotMatch(inspect().nextAction,/Update gitjig or correct/);}finally{c.changes.criteriaHoldReason=criteria;}
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

check('planning adjudication crosses the original SDK with an object-root conditional schema',async()=>{
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

check('stage subjects and separate assertion identities reach the original native request',async()=>{
    const plan=mixedPlan();
    for(const [role,stage,output,subject] of [
        ['planner','planning',{...value,plan},'Your subject is a proposed remedy plan'],
        ['challenger','planning-challenge',{...value,alternatives:[]},'Your subject is context.planProposal'],
        ['adjudicator','planning-adjudication',{...value,decisions:[],planAccepted:false},'Your subject is whether the proposed plan'],
        ['reviewer','fresh-review',value,'Your subject is the actual effective candidate'],
    ]) {
        const inputBundle={...body,context:{stage,planProposal:plan}};
        const f=await produce(launch=>{
            const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
            const system=strings(launch.frames).find(v=>v.includes('The supplied native StructuredOutput schema defines'));
            assert.ok(system.includes(subject));assert.ok(system.indexOf(subject)<system.indexOf('Return exactly one RoleOutput'));
            assert.ok(!system.includes('When assigned publication source-fit'));
            assert.equal(system.includes('resolution diagnosed'),role==='adjudicator');
            if(role==='adjudicator')assert.ok(system.includes('already committed supplied disposition records'));
            const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
            if(role==='planner')assert.match(schema.properties.plan.properties.verification.properties.checks.items.properties.assertions.description,/Case membership alone/);
            launch.format(JSON.stringify(output));launch.finish(output);
        },{role,inputBundle});
        assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.ok(f.launches.every(l=>l.joined));
    }
});

check('fresh native schema and strict decoder share captured decision reference domains',async()=>{
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

check('v2 synthetic repair exclusion reaches native schema, strict decoding and literal historical raw',async()=>{
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

check('current diagnosis eligibility is captured before await and enforced at the original native formatter boundary',async()=>{
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

check('caller mutation cannot grow or relabel the captured native decision domain',async()=>{
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

check('reported output capacity contradiction preserves original role failure and native settlement',async()=>{
    const f=await produce(launch=>{
        launch.format(JSON.stringify(value));
        launch.finish(value,{modelUsage:{'claude-sonnet-4-6':{maxOutputTokens:128000}}});
    });
    assert.equal(f.result.usable,false);
    assert.ok(JSON.stringify(f.result.issues).includes('BRIDGE_HOST_OUTPUT_LIMIT_MISMATCH'));
    assert.equal(f.launches.length,1);assert.equal(f.launches[0].joined,true);
    assert.ok(!JSON.stringify(f.result.issues).includes('CLEANUP_UNKNOWN'));
    assert.ok(f.entries.some(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.type==='result'&&e.data.message.modelUsage?.['claude-sonnet-4-6']?.maxOutputTokens===128000));
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
        launch.text('Controlled result whose reported allowance contradicts its original launch.');
        launch.finish(undefined,{modelUsage:{'claude-haiku-4-5':{maxOutputTokens:32000}}});
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

for(const duplicate of [false,true])check('original SDK receives verification reference guidance while strict host accounting stays independent: '+duplicate,async()=>{
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
check('shared inline current finding bodies cross native SDK with original intent and historical body census intact',async()=>{
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
check('historical producer reads the original native formatter and rejects replaced persisted source',async()=>{
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
async function controllerRole(t,scenario,role='planner'){
    const {openController}=await load('controller/index.js');
    const home=appHome,source=path.join(root,'controller-project-'+randomUUID()),projectId='P-'+randomUUID();
    fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.txt'),'Controlled original captured source.');
    const c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});
    t.after(()=>c.close());
    await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Preserve controlled consumer behavior.',executionLimit:8});
    const lineage=c.store.one('SELECT lineage FROM works WHERE id=?',workId).lineage,budgetBefore=c.store.one('SELECT consumed FROM budgets WHERE lineage=? AND kind=?',lineage,'execution').consumed;
    selectedScenario=scenario;const before=launches.length,scopeStart=scopes.length;
    let outcome;const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
    try{outcome=role==='planner'?await c.planChange({workId,model}):await c.changeCore.operation({workId,model},'plan',async()=>{await c.changeCore.role({workId,model},role,{stage:'fresh-review'});return c.changeCore.inspect(workId);});}finally{process.env.TMPDIR=previousTemp;}
    const launch=c.store.one('SELECT * FROM role_launches WHERE work=?',workId),run=launch&&c.store.one('SELECT * FROM runs WHERE id=?',launch.run);
    assert.ok(launch,JSON.stringify(outcome));assert.equal(launches.length,before+1,JSON.stringify(outcome));
    assert.equal(scopes.length,scopeStart+1);assert.ok(scopes[scopeStart].closed);assert.ok(launches.at(-1).joined);
    assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(c.changeCore.h.busy(workId),false);
    const leases=c.store.all('SELECT * FROM capacity_leases WHERE run=?',run.id);assert.equal(leases.length,1);assert.equal(leases[0].state,'RELEASED');
    const budget=c.store.one('SELECT * FROM budgets WHERE lineage=? AND kind=?',lineage,'execution');assert.equal(budget.reserved,0);assert.equal(budget.consumed,budgetBefore+1);
    assert.equal(c.store.one('SELECT state FROM works WHERE id=?',workId).state,'ACTIVE');
    return {c,workId,launch,run,outcome};
}
check('original Controller supplies host-proven decision subjects through the native schema and retained input',async t=>{
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
            assert.deepEqual(supplied.context.diagnosisEligibility,{version:1});
            assert.deepEqual(supplied.context.producerDiagnosticReceipt.eligible.map(e=>e.occurrenceId),diagnoses);
            output.planAccepted=false;output.decisions=ids.map(occurrenceId=>({occurrenceId,disposition:'unresolved',reason:'Independent assessment remains incomplete; no source or task acceptance',witnesses:[]}));
        }
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

async function driveDecisionCarryProposal(t,{mode='full',afterDiagnosis,duringChallenge,retainResolved=false}={}){
    const observed={requirementId:'owner-request',severity:'blocking',repair:'substantive',description:'Controlled initial BASE duty',evidence:['base:consumer.txt']};
    const f=await controllerRole(t,launch=>{const output={...value,findings:[observed,observed]};launch.format(JSON.stringify(output));launch.finish(output);});
    assert.equal(f.launch.status,'UNUSABLE');const ids=f.c.inspectChange(f.workId).occurrences.map(o=>o.id);assert.ok(ids.length>=2);
    let retainedRow;
    if(retainResolved){
        const id=randomUUID(),occurrence=ids.shift();
        f.c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',id,occurrence,f.launch.id,'rejected',JSON.stringify({occurrenceId:occurrence,disposition:'rejected',reason:'Controlled old resolved verdict',witnesses:['base:consumer.txt']}));
        f.c.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',occurrence,state:'resolved',disposition:'rejected'}),occurrence);
        retainedRow=f.c.store.one('SELECT * FROM finding_dispositions WHERE id=?',id);
    }
    let plannerOutput;
    selectedScenario=launch=>{
        const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
        const prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned ')),role=prompt.match(/^Perform the assigned (\w+) task/)[1];
        const supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]);let output={...value,assessedScope:supplied.requiredScope};
        if(role==='planner'){
            const requirement=supplied.requirements[0],plan=mixedPlan(),check=plan.verification.checks[0];
            plan.requirements=[requirement];plan.verification.checks=[check];check.guaranteeIds=[requirement.id];
            for(const c of check.cases){c.guaranteeIds=[requirement.id];c.consumerPaths=['consumer.txt'];}
            plan.verification.strategies=[{kind:'consumer-cases',requirementId:requirement.id,checkIds:[check.id]}];
            plan.verification.requiredPaths=['consumer.txt'];plan.verification.reviewRoles[0].requiredPaths=['consumer.txt'];output.plan=plan;
        }else if(role==='challenger'){output.alternatives=[];duringChallenge?.({s:f.c.store,plannerOutput:supplied.context.plannerInputScope.outputId});}
        else{
            plannerOutput=supplied.context.plannerInputScope.outputId;
            if(mode==='omit')assert.ok(supplied.context.proposalApproval);
            assert.deepEqual(supplied.context.decisionCarry,{version:2});
            output={...output,planAccepted:true,
                decisions:ids.map((occurrenceId,i)=>({occurrenceId,disposition:i?'equivalent':'upheld',...(i?{equivalentTo:ids[0]}:{}),reason:'Each retained owner-request BASE duty maps independently to the unchanged owner requirement and current consumer remedy',witnesses:['base:consumer.txt'],implementation:{kind:'assign-to-plan',baselineVersion:supplied.context.baseVersion,requirementIds:supplied.context.planProposal.requirements.map(r=>r.id)}}))};
            if(retainedRow){
                assert.deepEqual(supplied.context.decisionReferences.retentionChoices,[{dispositionId:retainedRow.id,occurrenceId:retainedRow.occurrence,sha256:createHash('sha256').update(JSON.stringify(retainedRow)).digest('hex')}]);
                assert.deepEqual(JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]).properties.retainedDispositions.items.enum,[retainedRow.id]);
                output.retainedDispositions=[retainedRow.id];
            }
            if(mode==='full')output.acceptedPlan=supplied.context.planProposal;
            if(mode==='null')output.acceptedPlan=null;
            if(mode==='partial')output.acceptedPlan={intent:'Unusable partial correction'};
        }
        const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);
        assert.equal(new Ajv2020({strict:false}).compile(schema)(output),role!=='adjudicator'||!['null','partial'].includes(mode));
        launch.format(JSON.stringify(output));launch.finish(output);
    };
    const core=f.c.changeCore,s=f.c.store;
    if(afterDiagnosis){const original=core.prevalidateDiagnoses.bind(core);core.prevalidateDiagnoses=async(...args)=>{const proofs=await original(...args);afterDiagnosis({core,s,plannerOutput});return proofs;};}
    const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});return{...f,ids,core,s,result,retainedRow};
}
function assertDecisionCarryPlan(f){
    const {core,s,result,ids}=f;assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.equal(result.reviewReady,false);
    const state=core.row(f.workId),plan=core.version(state.plan),original=s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",plan.data.decisionLaunch),protocol=JSON.parse(original.data).protocol;
    assert.deepEqual(plan.data.implementationCarries.map(c=>c.occurrenceId),ids);assert.equal(protocol.implementationCarries,undefined);assert.equal(protocol.implementationCarryGroups,undefined);assert.deepEqual(protocol.decisions.filter(d=>d.implementation?.kind==='assign-to-plan').map(d=>d.occurrenceId),ids);
    for(const id of ids){const occurrence=s.one('SELECT * FROM finding_occurrences WHERE id=?',id);assert.equal(core.carriedBaseline(f.workId,occurrence),state.base);assert.throws(()=>core.repairedProof(f.workId,occurrence,[]),/changed candidate/);}
    assert.equal(core.pending(f.workId).filter(o=>o.kind==='finding').length,ids.length);return{state,plan,protocol};
}
check('original Controller adopts decision-local explicit members and later rederives each from the retained native judgment',async t=>{
    assertDecisionCarryPlan(await driveDecisionCarryProposal(t));
});
check('owned SDK formatter preserves exact old-row references alongside current per-member assignments',async t=>{
    const f=await driveDecisionCarryProposal(t,{retainResolved:true}),{protocol}=assertDecisionCarryPlan(f);
    assert.deepEqual(protocol.retainedDispositions,[f.retainedRow.id]);
    assert.deepEqual(f.s.one('SELECT * FROM finding_dispositions WHERE id=?',f.retainedRow.id),f.retainedRow);
    assert.equal(f.s.all('SELECT * FROM finding_dispositions WHERE occurrence=?',f.retainedRow.occurrence).length,1);
});
check('bound proposal omission survives actual Controller strategy, carry and accepted-checkpoint rereads',async t=>{
    const f=await driveDecisionCarryProposal(t,{mode:'omit'}),{plan,protocol}=assertDecisionCarryPlan(f),{core,s}=f;
    assert.equal(Object.hasOwn(protocol,'acceptedPlan'),false);assert.deepEqual(core.strategies(f.workId),plan.data.plan.verification.strategies);assert.doesNotThrow(()=>core.restoreAcceptedPlan(f.workId));
    const judgment=s.one('SELECT * FROM role_launches WHERE id=?',plan.data.decisionLaunch),saved=judgment.data,metadata=JSON.parse(saved);
    metadata.proposalApproval.plannerOutputId='foreign-output';s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(metadata),judgment.id);
    assert.throws(()=>core.strategies(f.workId),/approval|planner/);assert.throws(()=>core.restoreAcceptedPlan(f.workId),/approval|planner/);
    const noDeclaration=JSON.parse(saved);delete noDeclaration.proposalApproval;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(noDeclaration),judgment.id);
    assert.throws(()=>core.strategies(f.workId),/planning producer/);assert.throws(()=>core.restoreAcceptedPlan(f.workId));
    s.run('UPDATE role_launches SET data=? WHERE id=?',saved,judgment.id);assert.deepEqual(core.strategies(f.workId),plan.data.plan.verification.strategies);
});
check('later carry, strategy and checkpoint readers preserve the original captured grammar',async t=>{
 const f=await driveDecisionCarryProposal(t,{mode:'omit'}),{plan}=assertDecisionCarryPlan(f),{core,s}=f;
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
    const f=await driveDecisionCarryProposal(t,{mode});assert.equal(f.result.phase,'BLOCKED');assert.equal(f.core.row(f.workId).plan,null);assert.equal(f.result.reviewReady,false);
    const judges=f.s.all("SELECT * FROM role_launches WHERE work=? AND role='adjudicator'",f.workId);assert.equal(judges.length,1);assert.equal(judges[0].status,'UNUSABLE');
});
for(const change of ['plan','summary','raw-and-protocol','run-epoch','run-launch','input-census','selected-entry'])check('selected planner '+change+' drift after diagnosis await refuses bound approval before disposition commit',async t=>{
    const f=await driveDecisionCarryProposal(t,{mode:'omit',afterDiagnosis({s,plannerOutput}){
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
    const f=await driveDecisionCarryProposal(t,{mode:'full',duringChallenge({s,plannerOutput}){
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
    const entries=await f.c.changeCore.nativeEntries(f.run.id),intent=entries.find(e=>e.customType===nativeRoleEntries.intent),materials=nativeRoleMaterial(entries,intent.id);
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
    const material=nativeRoleMaterial(entries,meta.nativeSource.intentEntryId).find(m=>m.selector==='result-text'),{raw:materialRaw,...source}=material;
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
    const observed=finding('Selected sibling nested observation'),output={value:{...value,findings:[observed]},unsupported:'unknown'};
    const f=await controllerRole(t,launch=>{launch.format(JSON.stringify(output));launch.finish(output);});
    assert.equal(f.launch.status,'UNUSABLE');
    const after=f.c.inspectChange(f.workId);
    assert.equal(after.occurrences.filter(o=>o.data.finding.description===observed.description).length,1);
    const hold=f.c.store.one('SELECT data FROM obligations WHERE id=?',`raw-incomplete-${f.launch.id}-native-material`);
    assert.equal(JSON.parse(hold.data).state,'pending');
});

check('version1 cached selected-wrapper omission is restored once without a new producer or spend',async t=>{
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
    assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,4);
    const outputs=s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),claims=s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId);
    await f.c.driveChange({workId:f.workId,model,maximumSteps:1});
    assert.deepEqual(s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',f.launch.id),outputs);
    assert.deepEqual(s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',f.workId),claims);
    assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.workId),budgets);
    assert.deepEqual(s.one('SELECT * FROM runs WHERE id=?',f.run.id),run);assert.equal(launches.length,births);
});

for(const conflict of ['overlapping-stream','duplicate-block','stopped-stream','after-block-stop','duplicate-block-stop'])check('received-prefix proof refuses original Native '+conflict+' conflict',async t=>{
    const raw=JSON.stringify({...value,plan:mixedPlan()}).slice(0,-1);
    const f=await controllerRole(t,launch=>{
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

for(const kind of ['orphan-public-delta','unknown-block-index','invalid-block-index','duplicate-untracked-start','started-untracked-thinking','started-untracked-block'])check('received-prefix ownership: '+kind,async t=>{
    const raw=JSON.stringify({...value,plan:mixedPlan()}).slice(0,-1);
    const f=await controllerRole(t,launch=>{
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

check('received prefix recovery clears only the original extraction hold without accepting or rerunning its producer',async t=>{
    const raw=JSON.stringify({...value,plan:mixedPlan()}).slice(0,-1);
    const f=await controllerRole(t,launch=>{launch.format(raw,{complete:false});launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:''});});
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
    assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,4);
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
for(const malformed of ['delta','text-start'])check('malformed native '+malformed+' preserves received claims and a completeness hold through original Controller settlement',async t=>{
    const prior=JSON.stringify({...value,findings:[finding('Claim received before malformed delta')]});
    const f=await controllerRole(t,launch=>{
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
    if(allPassed)fs.rmSync(root,{recursive:true,force:true});else console.error('Retained original native-format evidence: '+root);
});

for(const failedRole of ['challenger','adjudicator'])check('original Controller retains native formatter planning prefix after '+failedRole+' failure',async t=>{
    const c=await initializeController({installationHome:appHome,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_DISPATCH',image:'sha256:'+'0'.repeat(64)}});
    t.after(()=>c.close());
    const source=path.join(root,'prefix-project-'+randomUUID()),projectId='prefix-'+randomUUID();fs.mkdirSync(source,{mode:0o700});fs.writeFileSync(path.join(source,'consumer.cjs'),'module.exports=2;\n');
    await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Preserve controlled export2 behavior.',executionLimit:10,resolutionLimit:6});
    let mode='fail';const calls=[];
    selectedScenario=launch=>{
        const frame=launch.frames.find(f=>f.type==='user'),content=frame.message.content,text=typeof content==='string'?content:content.filter(b=>b.type==='text').map(b=>b.text).join('');
        const input=JSON.parse(text.split('\n').find(line=>line.startsWith('{"requirements":'))),role=input.context.stage==='planning'?'planner':input.context.stage==='planning-challenge'?'challenger':'adjudicator';
        calls.push({mode,role});const output={...value,assessedScope:input.requiredScope};
        if(role==='planner')output.plan={intent:'Preserve export2',requirements:[{id:'R1',text:'Preserve export2',source:'owner-request'}],approach:'Retain existing export',simplerAlternative:'No source edit',factualSources:['base:consumer.cjs'],ambiguities:[],verification:{checks:[{id:'value',guaranteeIds:['R1'],command:'node consumer.cjs',assertions:['two'],timeoutMs:1000,fixturePaths:['consumer.cjs'],cases:['healthy','adverse'].map(kind=>({id:kind,kind,guaranteeIds:['R1'],derivation:'Controlled fixture case declaration',consumerPaths:['consumer.cjs'],input:{literalUtf8:kind,fixturePaths:[]},expected:{kind:'return',value:'2'}}))}],strategies:[{requirementId:'R1',kind:'consumer-cases',checkIds:['value']}],requiredPaths:['consumer.cjs'],reviewRoles:[{key:'independent',kind:'reviewer',purpose:'Assess original export and actual evidence',requiredPaths:['consumer.cjs']}]}};
        if(role==='challenger')output.alternatives=['Retain existing export'];
        if(role==='adjudicator'){output.planAccepted=false;output.decisions=[];}
        if(mode==='fail'&&role===failedRole)output.unexpected='Controlled original formatter refusal';
        launch.format(JSON.stringify(output));launch.finish(output);
    };
    const first=await c.planChange({workId,model});assert.equal(first.phase,'BLOCKED');
    const original=c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId),p=original.find(l=>l.role==='planner');assert.equal(p.status,'COMPLETE',JSON.stringify(first.blocked));
    const output=c.store.one('SELECT * FROM role_outputs WHERE launch=?',p.id);assert.ok(JSON.parse(output.data).nativeSource);const initial=JSON.parse(p.data).inputScope;
    mode='resume';const next=await c.driveChange({workId,model,maximumSteps:1});
    assert.deepEqual(calls.filter(call=>call.mode==='resume').map(call=>call.role),failedRole==='challenger'?['challenger','adjudicator']:['adjudicator'],JSON.stringify(next.blocked));
    assert.equal(next.execution.consumed-first.execution.consumed,failedRole==='challenger'?2:1);assert.equal(next.planVersion,null);assert.equal(next.phase,'BLOCKED');
    assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM role_launches WHERE id=?',p.id).data).inputScope,initial);
    for(const l of c.store.all('SELECT * FROM role_launches WHERE work=?',workId)){const run=c.store.one('SELECT * FROM runs WHERE id=?',l.run);assert.equal(run.phase,'SETTLED');assert.equal(JSON.parse(run.data).cleanup,'removed');}
});

check('rejected formatter envelopes retain each original claim without accepting the role result',async t=>{
    const first={...value,plan:mixedPlan(),findings:[{...finding('FIRST REJECTED ENVELOPE CLAIM'),reproduction:{toolCallId:'unverified',command:'node consumer.txt',assertions:['declared'],expectationPaths:[]}}]},second={...value,plan:mixedPlan(),findings:[finding('SECOND REJECTED ENVELOPE CLAIM')]};
    const raw=[first,second].map(role=>JSON.stringify({value:role}));
    const f=await controllerRole(t,launch=>{for(const text of raw)launch.format(text,{carrierError:true});launch.finish(undefined,{subtype:'error_max_structured_output_retries',is_error:true});});
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
    const f=await controllerRole(t,launch=>{
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
    const entries=await core.nativeEntries(f.run.id),intent=entries.find(e=>e.type==='custom'&&e.customType===nativeRoleEntries.intent),materials=nativeRoleMaterial(entries,intent.id),oldClaims=partial?[flat.findings[0]]:[];
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

check('unsupported formatter sibling retains raw claims and a reachable completeness hold',async t=>{
    const raw=JSON.stringify({metadata:'unsupported sibling',value:{...value,plan:mixedPlan(),findings:[finding('KNOWN CLAIM IN AMBIGUOUS ENVELOPE')]}}),f=await controllerRole(t,launch=>{launch.format(raw,{carrierError:true});launch.finish(undefined,{subtype:'error_max_structured_output_retries',is_error:true});});
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

async function unownedRole(t,kind,raw){
    const clear={...value,outcome:'clear'};
    const f=await controllerRole(t,launch=>{
        const event=kind==='text-start'?{type:'content_block_start',index:7,content_block:{type:'text',text:raw}}:
            {type:'content_block_delta',index:kind==='invalid-index'?'7':7,delta:kind==='text'?{type:'text_delta',text:raw}:{type:'input_json_delta',partial_json:raw}};
        launch.send({type:'stream_event',uuid:randomUUID(),session_id:launch.sid,parent_tool_use_id:null,event});
        launch.format(JSON.stringify(clear));launch.finish(clear);
    },'reviewer');
    assert.equal(f.launch.status,'COMPLETE');
    return{...f,core:f.c.changeCore,s:f.c.store};
}
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
    assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,4);
});
async function driveUnownedAssessment(t,afterDiagnosis){
    const observed=finding('An unused discarded draft observation'),raw='{"version":1,"summary":"Interrupted public operand","findings":['+JSON.stringify(observed)+',';
    const f=await unownedRole(t,'json',raw),{core,s}=f,before=f.c.inspectChange(f.workId),synthetic=[...core.diagnosisSubjectIds(f.workId)];assert.equal(synthetic.length,1);
    assert.equal(core.pending(f.workId).some(o=>o.kind==='raw-findings-incomplete'),false);
    const source=s.one('SELECT * FROM role_outputs WHERE id=?',before.occurrences.find(o=>o.id===synthetic[0]).output),origin=await core.diagnosisOrigin(f.workId,synthetic[0]);assert.ok(origin.operand.materialSource);assert.equal(source.raw,raw);
    const births=launches.length;
    selectedScenario=launch=>{
        const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
        const prompt=strings(launch.frames).find(v=>v.startsWith('Perform the assigned ')),role=prompt.match(/^Perform the assigned (\w+) task/)[1],supplied=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).split('\n')[0]);
        let output={...value,assessedScope:supplied.requiredScope};
        if(role==='planner'){
            const requirement=supplied.requirements[0],plan=mixedPlan(),check=plan.verification.checks[0];plan.requirements=[requirement];plan.verification.checks=[check];check.guaranteeIds=[requirement.id];
            for(const item of check.cases){item.guaranteeIds=[requirement.id];item.consumerPaths=['consumer.txt'];}
            plan.verification.strategies=[{kind:'consumer-cases',requirementId:requirement.id,checkIds:[check.id]}];plan.verification.requiredPaths=['consumer.txt'];for(const position of plan.verification.reviewRoles)position.requiredPaths=['consumer.txt'];output.plan=plan;
        }else if(role==='challenger')output.alternatives=[];
        else{
            assert.equal(role,'adjudicator');const receipt=supplied.context.producerDiagnosticReceipt,eligible=receipt.eligible.find(o=>o.occurrenceId===synthetic[0]);assert.ok(eligible);
            assert.ok(supplied.context.producerDiagnostics.outputs.some(o=>o.outputId===source.id&&o.raw===raw));
            output.planAccepted=true;output.decisions=before.occurrences.map(o=>o.id===synthetic[0]?{occurrenceId:o.id,disposition:'upheld',resolution:'diagnosed',reason:'Independently assessed exact received incomplete raw; original draft claim separately dispositioned',witnesses:[source.id],diagnosis:{outputId:source.id,rawSha256:eligible.rawSha256,inputReceiptHash:receipt.receiptHash,materialOccurrenceIds:eligible.materialOccurrenceIds}}:{occurrenceId:o.id,disposition:'rejected',reason:'Historical unused draft observation is not a current consumer defect',witnesses:[source.id]});
        }
        const schema=JSON.parse(launch.options.args[launch.options.args.indexOf('--json-schema')+1]);assert.equal(new Ajv2020({strict:false}).compile(schema)(output),true);launch.format(JSON.stringify(output));launch.finish(output);
    };
    if(afterDiagnosis){const original=core.prevalidateDiagnoses.bind(core);core.prevalidateDiagnoses=async(...args)=>{const proof=await original(...args);afterDiagnosis({...f,source,synthetic,before});return proof;};}
    const result=await f.c.driveChange({workId:f.workId,model,maximumSteps:1});return{...f,result,source,synthetic,before,births};
}
check('exact ambiguous public raw reaches original independent J diagnosis and same-work planning',async t=>{
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
        if(unavailable==='missing-query-attestation')launch.finish(undefined,{subtype:'error_during_execution',is_error:true,result:''});
        else {const clear={...value,outcome:'clear'};launch.format(JSON.stringify(clear));launch.finish(clear);}
    },'reviewer');
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
    assert.equal(JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?',f.launch.id).data).materialAccounting.version,4);
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
    const f=await deliveredPremise(t,{raw:JSON.stringify({...value,findings:[finding('Handoff source observation')]}),omitMaterial:true}),{core,s}=f,entries=core.nativeEntries.bind(core),criteria=core.criteriaHoldReason.bind(core),births=launches.length;
    let held=false,options={workId:f.workId,model,maximumSteps:1};
    if(changed==='application-binding'){
        const models=new FixtureModels(f.c);models.install();const owner=s.one('SELECT data FROM works WHERE id=?',f.workId);s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...JSON.parse(owner.data),applicationModelBaseline:retainedApplicationBaseline}),f.workId);options={workId:f.workId,applicationModel:{version:1,baselineRevision:1},maximumSteps:1};
    }
    core.criteriaHoldReason=work=>held?'Current criteria changed during original coverage read':criteria(work);
    core.nativeEntries=async run=>{const result=await entries(run);if(changed==='criteria')held=true;else {const owner=s.one('SELECT data FROM works WHERE id=?',f.workId),data=JSON.parse(owner.data);data.applicationModelBaseline.revision=2;s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify(data),f.workId);}return result;};
    try{if(changed==='application-binding')await assert.rejects(f.c.driveChange(options),/work model revision changed/);else {const result=await f.c.driveChange(options);assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/Current criteria changed/);}}finally{core.nativeEntries=entries;core.criteriaHoldReason=criteria;}
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

check('default role deadline permits output beyond the former three-minute wall',async t=>{
    let ready;const started=new Promise(resolve=>{ready=resolve;});
    t.mock.timers.enable({apis:['setTimeout']});
    try{
        const pending=produce(launch=>ready(launch),{timeoutMs:undefined});
        const launch=await started;
        await new Promise(resolve=>setImmediate(resolve));
        t.mock.timers.tick(180001);
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(launch.joined,false,'Default must not cancel a still-owned role at the former wall');
        launch.format(JSON.stringify(value));launch.finish(value);
        const f=await pending;
        assert.equal(f.result.usable,true,JSON.stringify(f.result.issues));assert.ok(f.launches.every(l=>l.joined));
    }finally{t.mock.timers.reset();}
});

check('finite role deadlines retain explicit shorter bounds and joined partial output',async t=>{
    for(const [timeoutMs,advance] of [[undefined,300001],[50,51]]){
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

check('owned Native MCP reads only registered role history and credits actual rendered chunk ranges',async()=>{
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

check('owned Native MCP selects an exact old check through its original plan index alongside disposition evidence',async()=>{
 const {prepareHistoricalPlans}=await load('workflow/historical-plans.js');
 const {buildDispositionHistory}=await load('workflow/disposition-history.js');
 const oldPlan={intent:'Original requirement remains separate from current intent',requirements:[{id:'old-R',text:'Old guarantee',source:'old-owner'}],approach:'Original plan narrative '.repeat(100),factualSources:[{sourceId:'base:consumer.cjs',reason:'Original source'}],verification:{requiredPaths:['consumer.cjs'],strategies:[{kind:'consumer-cases',requirementId:'old-R',checkIds:['old-check']}],checks:[{id:'old-check',guaranteeIds:['old-R'],command:'node old-check.cjs',cases:[{id:'old-adverse',input:{literalUtf8:'OLD-INPUT'},expected:{kind:'rejection',value:'OLD-EXPECTED'}}]}]}};
 const planHash=sha(JSON.stringify(oldPlan)),canonical={semantics:'Original historical evidence, no current closure',links:[{occurrenceId:'current-claim',planHash}],plans:[{planHash,plan:oldPlan}],producers:[],unavailable:[]};
 const prepared=prepareHistoricalPlans(canonical,{id:randomUUID(),workId:'controlled-work',epoch:2,artifactRoot});assert.ok(prepared.evidence);
 const history=buildDispositionHistory({id:randomUUID(),workId:'controlled-work',epoch:2,artifactRoot,records:[]});
 for(const snapshot of [prepared.evidence,history])fs.writeFileSync(snapshot.manifest.path,snapshot.contents,{mode:0o600});
 const launchId=randomUUID(),inputBundle={...body,context:{stage:'planning-adjudication',historicalPlansInput:{version:1,id:prepared.evidence.manifest.id},historicalPlanningOperands:prepared.value,dispositionHistoryInput:{version:1,id:history.manifest.id},dispositionHistory:history.manifest}},output={...value,decisions:[],planAccepted:false};
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
