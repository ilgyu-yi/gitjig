import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {getCurrentTools,getCurrentSystemPrompt,validateToolArguments} from '@earendil-works/pi-ai';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {planningSourceFitRequirements,planningCriteriaRefreshRequirement} from '../../dist/workflow/role-input.js';
import {initializePiHost} from '../../dist/pi/index.js';
import {runRole,hashText,parseRoleOutput,parseCheckOutput} from '../../dist/workflow/index.js';
const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'workflow-adapter-')));
const stateRoot=path.join(root,'state'),artifactRoot=path.join(root,'artifacts'),workRoot=path.join(root,'work');
for(const p of [stateRoot,artifactRoot,workRoot])await fs.mkdir(p,{mode:0o700});
process.env.TMPDIR=artifactRoot;const host=await initializePiHost({stateRoot,artifactRoot});
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
let serial=0;
const scope=(source,startLine=1,endLine=source.content.split('\n').length)=>({sourceId:source.id,startLine,endLine});
const source=(content='export const count = 1;\n',exposeInPrompt=true)=>({id:'candidate:consumer.ts',version:'C1',side:'candidate',path:'consumer.ts',content,sha256:hashText(content),exposeInPrompt});
const result=(assessedScope=[],extra={})=>JSON.stringify({version:1,summary:'Assessed existing requirements against actual supplied source.',findings:[],assessedScope,...extra});
function operations(files=new Map()){
 const calls=[];return {workspaceRoot:workRoot,calls,files,
 validatePath(p){const full=path.resolve(workRoot,p),rel=path.relative(workRoot,full);if(path.isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('outside scope');return full;},
 async readFile(p,{maxBytes,signal}){signal?.throwIfAborted();calls.push({type:'read',p});if(!files.has(p))throw Error('missing file');const b=Buffer.from(files.get(p));if(b.length>maxBytes)throw Error('read bound');return b;},
 async access(p){if(!files.has(p))throw Error('missing file');},async writeFile(){throw Error('Read-only file system');},async mkdir(){throw Error('Read-only file system');},
 async exec(command,cwd,{onData,signal}){signal?.throwIfAborted();calls.push({type:'exec',command,cwd});onData(Buffer.from('ordinary shell evidence'));return {exitCode:0};}};
}
function model(final,steps=[],onProvider=()=>{},stopReason='stop',finalContent){
 let turn=0;return {provider:'adapter-fixture-'+(++serial),modelId:'fixture',definition:{baseUrl:'http://unused.invalid',apiKey:'fixture-only',api:'fixture-api',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(selected,context,options){
 onProvider(context,options);const stream=createAssistantMessageEventStream();const step=steps[turn++];queueMicrotask(()=>{const msg={role:'assistant',content:step?[{type:'toolCall',id:'call-'+turn,name:step.name,arguments:step.args}]:(finalContent?structuredClone(finalContent):[{type:'text',text:final}]),api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:step?'toolUse':stopReason,...(stopReason==='error'?{errorMessage:'actual-scripted-provider-error'}:{}),timestamp:Date.now()};stream.push({type:'done',reason:msg.stopReason,message:msg});stream.end(msg);});return stream;
 }}};
}
function options(sources=[],requiredScope=[],override={}){
 const files=new Map(sources.map(s=>[path.join(workRoot,s.path),s.content]));
 return {launchId:'host-launch-'+(++serial),role:'reviewer',inputBundle:{requirements:[{id:'R1',text:'Duplicate request has one effect',source:'owner event E1'}],contracts:'C4 requires effective independent review.',context:{candidate:'C1',base:'B1'},sources,requiredScope},operations:operations(files),host,model:model(result(requiredScope)),assertEntry(){},beforeModelRequest:async manager=>{assert.ok(manager.getLeafId());assert.match(await fs.readFile(manager.getSessionFile(),'utf8'),/Duplicate request/);},...override};
}

test('actual native role records prompt-source exposure, fresh histories and raw findings without supplying approval',async()=>{
 const s=source();const finding={requirementId:'R1',severity:'blocking',repair:'substantive',description:'Duplicate requests cause two effects.',evidence:['Observed same-ID effect count2 in bound check']};
 const o=options([s],[scope(s)],{model:model(result([scope(s)],{outcome:'clear',findings:[finding,finding]}))});
 const a=await runRole(o);assert.equal(a.usable,true,a.issues.join('\n'));assert.equal(a.protocol.findings.length,2);assert.equal(a.protocol.outcome,'clear');assert.equal(a.exposures[0].producer,'prompt');assert.equal(a.exposures[0].launchId,o.launchId);assert.ok(a.nativeCheckpoint.leafId);assert.ok(a.events.some(e=>e.type==='agent_settled'));assert.equal(a.role,'reviewer');
 const b=await runRole(options([s],[scope(s)]));assert.equal(b.usable,true,b.issues.join('\n'));assert.notEqual(a.nativeSessionId,b.nativeSessionId);assert.notEqual(a.historyRef,b.historyRef);
});
test('actual role provider receives English internal-result policy while original Korean requirements and exact JSON result survive',async()=>{
 const raw=result([]),o=options([],[],{model:model(raw,[],context=>{
  const system=getCurrentSystemPrompt(context.messages);assert.match(system,/English is mandatory/);assert.match(system,/Internal audience/);assert.match(system,/do not add a human-facing translation/);assert.ok(!system.includes('Conversation language:'));assert.match(system,/exactly one RoleOutput JSON object/);assert.ok(JSON.stringify(context.messages).includes('한국어 원본 요구사항'));
 })});o.inputBundle.requirements=[{id:'R1',text:'한국어 원본 요구사항',source:'original-owner-input'}];o.beforeModelRequest=async()=>{};
 const observed=await runRole(o);assert.equal(observed.usable,true,observed.issues.join('\n'));assert.equal(observed.rawFinal,raw);assert.equal(observed.protocol.summary,JSON.parse(raw).summary);
});
test('caller mutation after actual provider entry cannot relabel supplied source receipts',async()=>{
 const s=source('ORIGINAL_BAD_SOURCE',true),need=scope(s);let sawOriginal=false,sawLater=false;const o=options([s],[need]);o.model=model(result([need]),[],context=>{sawOriginal=JSON.stringify(context).includes('ORIGINAL_BAD_SOURCE');sawLater=JSON.stringify(context).includes('NEW_GOOD_SOURCE');s.content='NEW_GOOD_SOURCE';s.sha256=hashText(s.content);s.version='C2';o.launchId='caller-relabelled';o.role='implementer';});const r=await runRole(o);assert.equal(r.usable,true,r.issues.join());assert.equal(sawOriginal,true);assert.equal(sawLater,false);assert.equal(r.exposures[0].version,'C1');assert.equal(r.exposures[0].sourceSha256,hashText('ORIGINAL_BAD_SOURCE'));assert.equal(r.role,'reviewer');assert.notEqual(r.launchId,'caller-relabelled');assert.equal(s.version,'C2');
});
test('claimed path or shell scan is not source exposure; actual controlled native read after formatting is',async()=>{
 const s=source('alpha\nbeta\ngamma',false),need=scope(s,2,2);
 const missing=await runRole(options([s],[need]));assert.equal(missing.usable,false);assert.match(missing.issues.join(),/UNEXPOSED_SCOPE/);
 const empty=await runRole(options([s],[need],{model:model(result([]))}));assert.equal(empty.usable,false);assert.match(empty.issues.join(),/MISSING_REQUIRED_SCOPE/);
 const shell=await runRole(options([s],[need],{model:model(result([need]),[{name:'bash',args:{command:'cat consumer.ts'}}])}));assert.equal(shell.usable,false);assert.equal(shell.exposures.length,0);assert.ok(shell.events.some(e=>e.type==='tool_execution_end'&&e.toolName==='bash'));
 const read=await runRole(options([s],[need],{model:model(result([need]),[{name:'read',args:{path:'consumer.ts',offset:2,limit:1}}])}));assert.equal(read.usable,true,read.issues.join('\n'));assert.equal(read.exposures[0].producer,'read');assert.equal(read.exposures[0].startLine,2);assert.equal(read.exposures[0].endLine,2);assert.equal(read.exposures[0].rangeSha256,hashText('beta'));assert.match(read.events.find(e=>e.type==='tool_execution_end').result.content[0].text,/1 more lines/);
});
test('wrong content, failed read and native truncation cannot certify omitted source',async()=>{
 const s=source('expected',false),need=scope(s);
 const wrong=operations(new Map([[path.join(workRoot,s.path),'different actual bytes']]));
 const a=await runRole(options([s],[need],{operations:wrong,model:model(result([need]),[{name:'read',args:{path:s.path}}])}));assert.equal(a.usable,false);assert.equal(a.exposures.length,0);
 const b=await runRole(options([s],[need],{operations:operations(),model:model(result([need]),[{name:'read',args:{path:s.path}}])}));assert.equal(b.usable,false);assert.ok(b.events.some(e=>e.type==='tool_execution_end'&&e.isError));
 const large=source('x'.repeat(60000),false),range=scope(large);
 const c=await runRole(options([large],[range],{model:model(result([range]),[{name:'read',args:{path:large.path}}])}));assert.equal(c.usable,false);assert.equal(c.exposures.length,0);assert.equal(c.events.find(e=>e.type==='tool_execution_end').result.details.truncation.firstLineExceedsLimit,true);
});
test('native provider failure, length stop, invalid claims and oversized final are unusable',async()=>{
 for(const [final,reason,pattern] of [['not JSON','stop',/PROTOCOL/],[result([]),'error',/PROVIDER/],[result([]),'length',/INCOMPLETE/],[JSON.stringify({version:1,summary:'x'.repeat(140000),findings:[],assessedScope:[]}), 'stop',/PROTOCOL/]]){
  const r=await runRole(options([],[],{model:model(final,[],()=>{},reason)}));assert.equal(r.usable,false);assert.match(r.issues.join(),pattern);if(final.length>128*1024){assert.equal(r.rawFinalTruncated,true);assert.equal(Buffer.byteLength(r.rawFinal),128*1024);}
 }
 const unicode=await runRole(options([],[],{model:model(JSON.stringify({version:1,summary:'🙂'.repeat(40000),findings:[],assessedScope:[]}))}));assert.equal(unicode.usable,false);assert.equal(unicode.rawFinalTruncated,true);assert.ok(Buffer.byteLength(unicode.rawFinal)<=128*1024);assert.equal(unicode.rawFinal.includes('\ufffd'),false);
 const duplicateRaw='{"version":1,"summary":"read source","findings":[{"requirementId":"R1","severity":"blocking","repair":"unknown","description":"actual failure","evidence":["E1"]}],"findings":[],"assessedScope":[]}';const duplicateResult=await runRole(options([],[],{model:model(duplicateRaw)}));assert.equal(duplicateResult.usable,false);assert.equal(duplicateResult.rawFinal,duplicateRaw);assert.match(duplicateResult.issues.join(),/duplicate key/);
 const spoof=await runRole(options([],[],{model:model(JSON.stringify({version:1,summary:'clear',findings:[],assessedScope:[],launchId:'forged-role'}))}));assert.equal(spoof.usable,false);assert.match(spoof.issues.join(),/Unexpected or missing fields/);
});
test('durable checkpoint and operation entry are mandatory; collector failure cannot produce a usable pass',async()=>{
 let providerCalls=0;const failed=await runRole(options([],[],{model:model(result([]),[],()=>providerCalls++),beforeModelRequest:async()=>{throw Error('actual-checkpoint-write-failure');}}));assert.equal(providerCalls,0);assert.equal(failed.usable,false);assert.match(failed.issues.join(),/actual-checkpoint-write-failure/);
 let entries=0;const ops=operations(new Map([[path.join(workRoot,'consumer.ts'),'x']]));
 const denied=await runRole(options([],[],{operations:ops,model:model(result([]),[{name:'read',args:{path:'consumer.ts'}}]),assertEntry(){if(++entries>1)throw Error('epoch revoked');}}));assert.equal(denied.usable,false);assert.equal(ops.calls.length,0);
 const badCollector=await runRole(options([],[],{onObservation(){throw Error('SQLite unavailable');}}));assert.equal(badCollector.usable,false);assert.match(badCollector.issues.join(),/COLLECTOR/);
 const abort=new AbortController();abort.abort();const cancelled=await runRole(options([],[],{signal:abort.signal}));assert.equal(cancelled.usable,false);assert.equal(cancelled.terminal,'aborted');assert.equal(cancelled.historyRef,null);
});
test('finite per-role provider cap stops actual repeating tool-use without a free extra request',async()=>{
 let calls=0;const steps=Array.from({length:8},()=>({name:'bash',args:{command:'printf finite'}}));
 const r=await runRole(options([],[],{maxProviderRequests:2,model:model(result([]),steps,()=>calls++)}));assert.equal(calls,2);assert.equal(r.providerRequests,2);assert.equal(r.usable,false);assert.match(r.issues.join(),/Provider request cap exceeded:2/);assert.equal(r.events.filter(e=>e.type==='tool_execution_end').length,2);
 const healthy=await runRole(options([],[],{maxProviderRequests:2}));assert.equal(healthy.usable,true,healthy.issues.join());assert.equal(healthy.providerRequests,1);
});
test('whole-role deadline aborts an actual active native provider stream',{timeout:3000},async()=>{
 let calls=0,abortObserved=false;const pending=model(result([]));pending.definition.streamSimple=(selected,context,options)=>{calls++;const stream=createAssistantMessageEventStream();const stop=()=>{abortObserved=true;const message={role:'assistant',content:[],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:'aborted',timestamp:Date.now()};stream.push({type:'done',reason:'aborted',message});stream.end(message);};if(options.signal.aborted)stop();else options.signal.addEventListener('abort',stop,{once:true});return stream;};
 const r=await runRole(options([],[],{model:pending,timeoutMs:100}));assert.equal(calls,1);assert.equal(abortObserved,true);assert.equal(r.usable,false);assert.equal(r.terminal,'aborted');
});
test('reproduction claim preserves actual native start/end operands and known/unknown expectation input scope',async()=>{
 const command='node /input/repro.cjs /work/consumer.ts';
 for(const role of ['reviewer','implementer'])for(const passed of [false,true]){
  const body=JSON.stringify({version:1,assertions:[{id:'once',passed,actual:passed?'one effect':'two effects'}]});const ops=operations();ops.exec=async(actual,cwd,{onData})=>{assert.equal(actual,command);onData(Buffer.from(body));return {exitCode:0};};
  const finding={requirementId:'R1',severity:'blocking',repair:'substantive',description:'Observed duplicate-request assertion result.',evidence:['native call-1'],reproduction:{toolCallId:'call-1',command,assertions:['once'],expectationPaths:['repro.cjs']}};
  const r=await runRole(options([],[],{role,operations:ops,model:model(result([],{findings:[finding]}),[{name:'bash',args:{command}}],context=>{const actual=JSON.stringify(context);assert.match(actual,/frozen.candidate reproduction.{0,80}only.{0,40}reviewer/);assert.match(actual,/mutable.work observations.{0,100}unverified.{0,100}immutable.{0,40}checks/);})}));assert.equal(r.usable,true,r.issues.join());assert.deepEqual(r.protocol.findings[0].reproduction,finding.reproduction);
  const start=r.events.find(e=>e.type==='tool_execution_start'),end=r.events.find(e=>e.type==='tool_execution_end');assert.equal(start.toolCallId,'call-1');assert.equal(end.toolCallId,start.toolCallId);assert.equal(start.args.command,command);assert.equal(end.result.structuredContent.exit_code,0);assert.equal(parseCheckOutput(end.result.structuredContent.output).value.assertions[0].passed,passed);
 }
 const claim={requirementId:'R1',severity:'blocking',repair:'unknown',description:'Missing expectation declaration remains unknown.',evidence:[],reproduction:{toolCallId:'call-1',command,assertions:['once']}};
 const old=parseRoleOutput(result([],{findings:[claim]}),'reviewer');assert.ok(old.value);assert.equal(Object.hasOwn(old.value.findings[0].reproduction,'expectationPaths'),false);
 claim.reproduction.expectationPaths=[];const inline=parseRoleOutput(result([],{findings:[claim]}),'reviewer');assert.deepEqual(inline.value.findings[0].reproduction.expectationPaths,[]);
 claim.reproduction.assertions=['once','once'];assert.equal(parseRoleOutput(result([],{findings:[claim]}),'reviewer').value,null);claim.reproduction.assertions=[];assert.equal(parseRoleOutput(result([],{findings:[claim]}),'reviewer').value,null);claim.reproduction.assertions=['once'];claim.reproduction.expectationPaths=['../outside'];assert.equal(parseRoleOutput(result([],{findings:[claim]}),'reviewer').value,null);
});
test('shared protocol rejects incomplete roster positions and unsafe mechanical proposals without replacing semantic adjudication',()=>{
 const plan={intent:'Retain one effect per ID',requirements:[{id:'R1',text:'one effect per ID',source:'owner'}],approach:'Use bounded request ledger',simplerAlternative:'Reuse existing deduplication',factualSources:['actual source'],verification:{checks:[{id:'C1',guaranteeIds:['R1'],command:'node /input/check.mjs',assertions:['once'],timeoutMs:1000,fixturePaths:['check.mjs']}],requiredPaths:['consumer.ts'],reviewRoles:[{key:'behavior',kind:'reviewer',purpose:'Find duplicate-effect counterexamples',requiredPaths:['consumer.ts']}]},ambiguities:[]};
 assert.ok(parseRoleOutput(result([],{plan}),'planner').value);
 for(const field of ['requirements','checks','assertions']){const duplicate=structuredClone(plan);if(field==='requirements')duplicate.requirements.push({...duplicate.requirements[0]});else if(field==='checks')duplicate.verification.checks.push({...duplicate.verification.checks[0]});else duplicate.verification.checks[0].assertions.push('once');assert.equal(parseRoleOutput(result([],{plan:duplicate}),'planner').value,null);}
 const duplicate=structuredClone(plan);duplicate.verification.reviewRoles.push({...duplicate.verification.reviewRoles[0]});assert.equal(parseRoleOutput(result([],{plan:duplicate}),'planner').value,null);
 const finding={requirementId:'R1',severity:'blocking',repair:'mechanical',description:'Exact typo',evidence:['parser fixture'],mechanicalPatch:{path:'consumer.ts',oldText:'olde',newText:''}};assert.ok(parseRoleOutput(result([],{findings:[finding]}),'reviewer').value);finding.mechanicalPatch.path='../controller.sqlite';assert.equal(parseRoleOutput(result([],{findings:[finding]}),'reviewer').value,null);
 assert.equal(parseRoleOutput('{"version":1,"summary":"x","findings":[],"\\u0066indings":[],"assessedScope":[]}', 'reviewer').value,null);
 assert.equal(parseCheckOutput('{"version":1,"assertions":[{"id":"once","passed":false,"passed":true}]}').value,null);
 assert.ok(parseRoleOutput(result([],{summary:'Escaped string value: \"findings\": [] and \\n is ordinary text'}),'reviewer').value);
 const repaired={occurrenceId:'host-O1',disposition:'upheld',resolution:'repaired',reason:'Same failure input passes on independent repair',witnesses:['check-run1','review-run2']};assert.ok(parseRoleOutput(result([],{decisions:[repaired]}),'adjudicator').value);assert.equal(parseRoleOutput(result([],{decisions:[{...repaired,disposition:'rejected'}]}),'adjudicator').value,null);
 assert.ok(parseCheckOutput(JSON.stringify({version:1,assertions:[{id:'once',passed:false,actual:'two effects'}]})).value);assert.equal(parseCheckOutput(JSON.stringify({version:1,assertions:[{id:'once',passed:true},{id:'once',passed:true}]})).value,null);
});
test('actual role lifecycle exposes the existing reviewer and closes exact admission before result selection', {timeout:3000}, async()=>{
 let releaseFirst, reachedProvider;const providerEntered=new Promise(resolve=>reachedProvider=resolve);let calls=0,registration;const sequence=[],users=[];
 const fixture=model(result([]));fixture.definition.streamSimple=(selected,context)=>{
  calls++;const stream=createAssistantMessageEventStream();const finish=()=>{const msg={role:'assistant',content:[{type:'text',text:result([])}],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:'stop',timestamp:Date.now()};stream.push({type:'done',reason:'stop',message:msg});stream.end(msg);};
  if(calls===1){assert.ok(registration);assert.ok(JSON.stringify(context).includes('Perform the assigned reviewer'));releaseFirst=finish;reachedProvider();}else{assert.ok(JSON.stringify(context).includes('Explain the reviewer uncertainty'));queueMicrotask(finish);}return stream;
 };
 const identity={conversationId:'actual-reviewer-C',workId:'W-role',runId:'run-role',launchId:'launch-role',generation:1,directionRevision:0,initialInputId:'host-initial-role'};
 let detach;const pending=runRole(options([],[],{launchId:'launch-role',model:fixture,nativeIdentity:identity,nativeLifecycle:{
  ready(value){registration=value;sequence.push('ready');assert.equal(value.session.messages.length,0);detach=value.session.subscribe(event=>{if(event.type==='message_start'&&event.message.role==='user')users.push(event.message.content);});},
  settling(value){assert.equal(value.conversationId,'actual-reviewer-C');sequence.push('settling');},
  released(value){assert.equal(value.conversationId,'actual-reviewer-C');sequence.push('released');detach();}
 }}));
 await providerEntered;await registration.session.steer('Explain the reviewer uncertainty');identity.conversationId='caller-changed-C';releaseFirst();const r=await pending;
 assert.equal(r.usable,true,r.issues.join());assert.equal(calls,2);assert.equal(users.length,2);assert.match(JSON.stringify(users[0]),/Perform the assigned reviewer/);assert.match(JSON.stringify(users[1]),/Explain the reviewer uncertainty/);assert.deepEqual(sequence,['ready','settling','released']);assert.equal(r.nativeSessionId,registration.sessionManager.getSessionId());
});
test('failed interactive registration refuses the initial provider and still settles exact native handle',async()=>{
 let calls=0;const sequence=[];const identity={conversationId:'C-ready-failure',workId:'W',runId:'run',launchId:'launch',generation:1,directionRevision:0,initialInputId:'initial'};
 const r=await runRole(options([],[],{launchId:'launch',model:model(result([]),[],()=>calls++),nativeIdentity:identity,nativeLifecycle:{ready(){sequence.push('ready');throw Error('registration persistence failed');},settling(){sequence.push('settling');},released(){sequence.push('released');}}}));
 assert.equal(calls,0);assert.equal(r.usable,false);assert.match(r.issues.join(),/registration persistence failed/);assert.deepEqual(sequence,['ready','settling','released']);
 const unpaired=await runRole(options([],[],{nativeIdentity:identity}));assert.equal(unpaired.historyRef,null);assert.match(unpaired.issues.join(),/supplied together/);
});
test('strict role native controls record fallible acknowledgement while coordinator WAIT is unavailable',async()=>{
 let acknowledgements=0;const coordination={status:()=>({registered:true}),address:()=>({queued:true}),assign:()=>({assigned:true}),acknowledgeInput:args=>{acknowledgements++;assert.equal(args.inputId,'actual-input-ref');return {classification:'explanation',hold:true};}};
 const r=await runRole(options([],[],{coordination,model:model(result([]),[{name:'conversation_acknowledge_input',args:{inputId:'actual-input-ref',classification:'explanation',requirementIds:['R1'],summary:'Proposed explanation; non-author decision still required.'}}])}));
 assert.equal(acknowledgements,1);assert.equal(r.usable,true,r.issues.join());const end=r.events.find(e=>e.type==='tool_execution_end');assert.equal(end.toolName,'conversation_acknowledge_input');assert.match(end.result.content[0].text,/'hold'|"hold":true/);
 let providers=0;const denied=await runRole(options([],[],{coordination:{...coordination,wait:async()=>({waiting:true})},model:model(result([]),[],()=>providers++)}));assert.equal(providers,0);assert.equal(denied.usable,false);assert.match(denied.issues.join(),/Strict workflow roles cannot install coordinator WAIT/);
});
test('existing adjudicator carries exact input decisions without treating structure as source-fit proof',async()=>{
 const decision={inputId:'input-owner-1',directionRevision:1,impact:'explanation',reason:'Actual raw question asks current status without changing accepted criterion R1.',requirementIds:['R1']};
 const r=await runRole(options([],[],{role:'adjudicator',beforeModelRequest:async manager=>{assert.ok(manager.getLeafId());assert.match(await fs.readFile(manager.getSessionFile(),'utf8'),/What is the status/);},inputBundle:{requirements:[{id:'R1',text:'one effect',source:'owner'}],contracts:'New raw inputs require non-author source-fit before effects.',context:{heldInputs:[{inputId:'input-owner-1',directionRevision:1,raw:'What is the status?',claim:'explanation'}]},sources:[],requiredScope:[]},model:model(result([],{decisions:[],inputDecisions:[decision]}))}));assert.equal(r.usable,true,r.issues.join());assert.deepEqual(r.protocol.inputDecisions,[decision]);
 for(const bad of [[decision,decision],[{...decision,directionRevision:0}],[{...decision,impact:'approved'}],[{...decision,requirementIds:['R1','R1']}]] )assert.equal(parseRoleOutput(result([],{decisions:[],inputDecisions:bad}),'adjudicator').value,null);
 assert.equal(parseRoleOutput(result([],{inputDecisions:[decision]}),'implementer').value,null);
});
test('selected final binds actual native entry while all intermediate raw finding entries survive steer and abort',{timeout:5000},async()=>{
 const {rawFindings}=await import('../../dist/controller/raw-findings.js');
 const finding={requirementId:'R1',severity:'blocking',repair:'unknown',description:'First native response observed duplicate effects.',evidence:['Witness preserved before owner steer']};
 const f1=result([],{findings:[finding]}),clear=result([]);
 async function sequenceRun(responses,abortLast=false){
  let native,turn=0;const entered=responses.map(()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}),release=[];const ownerAbort=new AbortController();const fixture=model('unused');
  fixture.definition.streamSimple=(selected,context,streamOptions)=>{const at=turn++,stream=createAssistantMessageEventStream();const finish=(aborted=false)=>{const message={role:'assistant',content:aborted?[]:[{type:'text',text:responses[at]}],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:aborted?'aborted':'stop',timestamp:Date.now()};stream.push({type:'done',reason:message.stopReason,message});stream.end(message);};release[at]=()=>finish();entered[at].resolve();if(at===responses.length-1){if(abortLast)streamOptions.signal.addEventListener('abort',()=>finish(true),{once:true});else queueMicrotask(()=>finish());}return stream;};
  const launch='raw-entry-launch-'+(++serial),pending=runRole(options([],[],{launchId:launch,model:fixture,signal:ownerAbort.signal,timeoutMs:1000,nativeIdentity:{conversationId:'raw-C-'+serial,workId:'W-raw',runId:'run-raw-'+serial,launchId:launch,generation:1,directionRevision:0,initialInputId:'initial-'+serial},nativeLifecycle:{ready:value=>{native=value;},settling(){},released(){}}}));
  for(let i=0;i<responses.length-1;i++){await entered[i].promise;await native.session.steer('Direct owner input '+i);release[i]();}
  if(abortLast){await entered.at(-1).promise;ownerAbort.abort();}
  const execution=await pending;const actual=native.sessionManager.getEntries().filter(entry=>entry.type==='message'&&entry.message.role==='assistant');
  const records=actual.map(entry=>({id:entry.id,raw:entry.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')}));
  assert.ok((await fs.readFile(execution.historyRef,'utf8')).includes(finding.description));return {execution,records};
 }
 const repeated=await sequenceRun([f1,f1,clear]);assert.equal(repeated.execution.usable,true,repeated.execution.issues.join());assert.equal(repeated.execution.rawFinal,clear);assert.equal(repeated.execution.selectedFinalEntryId,repeated.records.at(-1).id);const witnesses=repeated.records.filter(record=>rawFindings(record.raw).findings.length);assert.equal(witnesses.length,2);assert.equal(witnesses[0].raw,witnesses[1].raw);assert.notEqual(witnesses[0].id,witnesses[1].id);
 const unusable=await sequenceRun([f1,'not a final role record']);assert.equal(unusable.execution.usable,false);assert.equal(unusable.execution.selectedFinalEntryId,unusable.records.at(-1).id);assert.equal(rawFindings(unusable.records[0].raw).findings.length,1);
 const prose=await sequenceRun(['Ordinary inspection/tool narration',f1,clear]);assert.equal(prose.execution.usable,true,prose.execution.issues.join());assert.equal(prose.records.filter(record=>rawFindings(record.raw).findings.length).length,1);assert.equal(rawFindings(prose.records[0].raw).findings.length,0);
 const aborted=await sequenceRun([f1,'unused final'],true);assert.equal(aborted.execution.usable,false);assert.equal(aborted.execution.terminal,'aborted');assert.equal(aborted.execution.selectedFinalEntryId,null);assert.equal(aborted.execution.rawFinal,null);assert.equal(rawFindings(aborted.records[0].raw).findings.length,1);
});
test('strict native role refuses all delegated effect controls before provider entry',async()=>{
 for(const key of ['integrate','effectInspect','effectReconcile']){let calls=0;const coordination={status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),[key]:async()=>({})};const role=await runRole(options([],[],{coordination,model:model(result([]),[],()=>calls++)}));assert.equal(calls,0);assert.equal(role.usable,false);assert.match(role.issues.join(),/cannot install delegated effect controls/);}
});
test.after(async()=>fs.rm(root,{recursive:true,force:true}));

test('actual fresh adjudicator consumes exact publication/source identities; fit retains raw findings and cannot be emitted by another role',async()=>{
 const payloadHash=hashText('final sealed payload'),sourceFingerprint=hashText('owner raw source revision');let observed=false;
 const finding={requirementId:'R1',severity:'blocking',repair:'unknown',description:'Payload claim requires an unavailable native source operand.',evidence:['Actual current source omitted operand E2']};
 const decision={payloadHash,sourceFingerprint,verdict:'fit',reason:'Assessed final title/body against actual retained owner intent; native permission remains separate.'};
 const o=options([],[],{role:'adjudicator',model:model(result([],{decisions:[],payloadDecision:decision,findings:[finding]}),[],context=>{const actual=JSON.stringify(context);observed=actual.includes(payloadHash)&&actual.includes(sourceFingerprint)&&actual.includes('원래 요청')&&actual.includes('exact final payload');})});o.inputBundle.context={publication:{payloadHash,sourceFingerprint,finalPayload:'exact final payload',rawOwnerSource:'원래 요청'}};
 const r=await runRole(o);assert.equal(r.usable,true,r.issues.join());assert.equal(observed,true);assert.deepEqual(r.protocol.payloadDecision,decision);assert.equal(r.protocol.findings.length,1);assert.ok(r.nativeCheckpoint);assert.ok((await fs.readFile(r.historyRef,'utf8')).includes(payloadHash));
 const wrong=await runRole(options([],[],{model:model(result([],{payloadDecision:decision}))}));assert.equal(wrong.usable,false);assert.match(wrong.issues.join(),/Unexpected or missing fields/);
 assert.equal(parseRoleOutput(result([],{decisions:[],payloadDecision:{...decision,payloadHash:'unbound'}}),'adjudicator').value,null);
 let calls=0;const forbidden=await runRole(options([],[],{coordination:{status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),publish:()=>({state:'QUEUED'})},model:model(result([]),[],()=>calls++)}));assert.equal(forbidden.usable,false);assert.equal(calls,0);assert.equal(forbidden.historyRef,null);
});

// Native provider contexts, not registry inventories, establish what each role actually sees.
test('strict inspection roles omit author filesystem affordances while preserving coordination and phase-fit contracts',async()=>{
 const p={intent:'Assess requirement',requirements:[{id:'R1',text:'Existing request',source:'owner'}],approach:'Inspect',simplerAlternative:'Existing behavior',factualSources:[],ambiguities:[],verification:{checks:[],requiredPaths:[],reviewRoles:[{key:'review',kind:'reviewer',purpose:'Independent evidence',requiredPaths:[]}]}};
 const extras={planner:{plan:p},challenger:{alternatives:[]},adjudicator:{decisions:[]},reviewer:{},confirmer:{confirmed:false,witnesses:[]},implementer:{},repairer:{}};
 const coordination={status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({hold:true}),parent:()=>({})};
 for(const [role,extra]of Object.entries(extras)){
  let observed=0;const r=await runRole(options([],[],{role,coordination,model:model(result([],extra),[],context=>{
   observed++;const names=getCurrentTools(context.messages).map(t=>t.name).sort();
   assert.deepEqual(names,['read','bash','conversation_status','conversation_address','conversation_assign','conversation_acknowledge_input','conversation_parent',...(['implementer','repairer'].includes(role)?['write','edit']:[])].sort());
   const prompt=getCurrentSystemPrompt(context.messages),schema=JSON.stringify(roleOutputSchema(role));
   assert.ok(prompt.includes(schema));assert.ok(prompt.indexOf(schema)<prompt.indexOf('/input/verification-cases.json'));
   // Full command-stdout syntax belongs to command authors/reproducers; declarative planners still see its required observations.
   assert.equal(prompt.includes('{version:1,assertions:[{id,passed,actual?}]'),['implementer','repairer','reviewer'].includes(role));
   if(['implementer','repairer','reviewer'].includes(role)){assert.ok(prompt.includes('kind:"return"|"rejection"'),JSON.stringify(prompt.slice(prompt.indexOf('Only that executable'),prompt.indexOf('Only that executable')+260)));assert.equal(prompt.includes('kind:'+String.fromCharCode(92)+'"return"'),false);}
   assert.ok(prompt.includes('inputDigest'));assert.ok(prompt.includes('healthy/adverse'));assert.ok(prompt.includes('future check descriptor'));
  })}));assert.equal(r.usable,true,r.issues.join());assert.equal(observed,1);
 }
});
test('guessed inactive write/edit calls never reach inspection operations; read evidence and permitted shell inspection still work',async()=>{
 const s=source('actual readonly source',false),o=options([s],[scope(s)]);let writes=0;
 o.operations.writeFile=async()=>{writes++;throw Error('must not reach inactive author tool');};
 o.model=model(result([scope(s)]),[{name:'write',args:{path:'consumer.ts',content:'changed'}},{name:'edit',args:{path:'consumer.ts',oldText:s.content,newText:'changed'}},{name:'read',args:{path:'consumer.ts'}},{name:'bash',args:{command:'inspect existing source'}}]);
 const r=await runRole(o);assert.equal(r.usable,true,r.issues.join());assert.equal(writes,0);assert.equal(o.operations.files.get(path.join(workRoot,'consumer.ts')),s.content);assert.ok(r.exposures.some(e=>e.producer==='read'));
 const denied=r.events.filter(e=>e.type==='tool_execution_end'&&['write','edit'].includes(e.toolName));assert.equal(denied.length,2);assert.ok(denied.every(e=>e.isError));assert.ok(r.events.some(e=>e.type==='tool_execution_end'&&e.toolName==='bash'&&!e.isError));
});
test('author roles retain actual native filesystem writing through existing operations',async()=>{
 for(const role of ['implementer','repairer']){
  const o=options([],[],{role});let writes=0;o.operations.mkdir=async()=>{};o.operations.writeFile=async(p,c)=>{writes++;o.operations.files.set(p,c);};
  o.model=model(result([]),[{name:'write',args:{path:'authored.ts',content:'actual authored change'}}]);
  const r=await runRole(o);assert.equal(r.usable,true,r.issues.join());assert.equal(writes,1);assert.equal(o.operations.files.get(path.join(workRoot,'authored.ts')),'actual authored change');assert.ok(r.events.some(e=>e.type==='tool_execution_end'&&e.toolName==='write'&&!e.isError));
 }
});

test('planning J alone sees implementation carries; other native J phases preserve fields and refuse a misplaced carry',async()=>{
 const proposal={occurrenceId:'actual-F',baselineVersion:'actual-B',requirementIds:['R1'],reason:'Map the actual initial source defect to the accepted implementation plan'};
 for(const stage of ['planning-adjudication','review-adjudication','source-fit','publication-payload-fit']){
  let seen=0;const o=options([],[],{role:'adjudicator',model:model(result([],{decisions:[]}),[],context=>{seen++;const prompt=getCurrentSystemPrompt(context.messages),schema=roleOutputSchema('adjudicator',stage);assert.ok(prompt.includes(JSON.stringify(schema)));assert.equal('implementationCarries'in schema.properties,stage==='planning-adjudication');assert.deepEqual(Object.keys(schema.properties).filter(k=>k!=='implementationCarries'),Object.keys(roleOutputSchema('adjudicator').properties).filter(k=>k!=='implementationCarries'));})});o.inputBundle.context.stage=stage;const r=await runRole(o);assert.equal(r.usable,true,r.issues.join());assert.equal(seen,1);
 }
 const bad=options([],[],{role:'adjudicator',model:model(result([],{decisions:[],implementationCarries:[proposal]}))});bad.inputBundle.context.stage='review-adjudication';const refused=await runRole(bad);assert.equal(refused.usable,false);assert.match(refused.issues.join(),/only valid in planning-adjudication/);assert.ok(refused.rawFinal.includes('implementationCarries'));
});

test('unique exact role JSON permits native thinking metadata while preserving whole original entry and strict text boundaries',async()=>{
 const raw=result([]),thought={type:'thinking',thinking:'Inspect the supplied evidence in English.',thinkingSignature:'opaque native signature'},text={type:'text',text:raw};
 for(const content of[[thought,text],[text,thought],[thought,{type:'thinking',thinking:'',redacted:true,thinkingSignature:'redacted native signature'},text]]){const r=await runRole(options([],[],{model:model(raw,[],()=>{},'stop',content)}));assert.equal(r.usable,true,r.issues.join());assert.equal(r.rawFinal,raw);const entries=(await fs.readFile(r.historyRef,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),entry=entries.find(e=>e.id===r.selectedFinalEntryId);assert.deepEqual(entry.message.content,content);}
 for(const content of[[],[thought],[{type:'text',text:17}],[{type:'text',text:raw,textSignature:JSON.stringify({v:1,id:'DUMMY-FINAL',phase:'final_answer'})},{type:'text',text:'commentary',textSignature:JSON.stringify({v:1,id:'DUMMY-COMMENTARY',phase:'commentary'})}],[text,{type:'text',text:''}],[{type:'text',text:'commentary'},text],[text,{type:'image',data:'DUMMY',mimeType:'image/png'}],[text,{type:'unknown',value:'DUMMY'}],[text,{type:'thinking',thinking:17}],[text,{type:'thinking',thinking:'English',thinkingSignature:17}],[text,{type:'thinking',thinking:'English',redacted:'yes'}],[thought,{type:'text',text:''}],[thought,{type:'text',text:'not JSON'}],[thought,{type:'text',text:'{"version":1,"version":1}'}]]){const r=await runRole(options([],[],{model:model(raw,[],()=>{},'stop',content)}));assert.equal(r.usable,false,JSON.stringify(content));assert.match(r.issues.join(),/PROTOCOL/);}
});

test('actual official Codex reasoning plus text flows through native AgentSession and preserves reasoning signatures',async()=>{
 const{streamSimple:native}=await import('@earendil-works/pi-ai/api/openai-codex-responses');const raw=result([]),reasoning={type:'reasoning',id:'DUMMY_REASONING',summary:[{type:'summary_text',text:'I inspect the supplied source in English.'}],encrypted_content:'DUMMY_NON_AUTH_SIGNATURE'},message={type:'message',id:'DUMMY_TEXT',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:raw,annotations:[]}]},events=[{type:'response.output_item.added',output_index:0,item:{type:'reasoning',id:reasoning.id,summary:[]}},{type:'response.reasoning_summary_text.delta',output_index:0,delta:reasoning.summary[0].text},{type:'response.output_item.done',output_index:0,item:reasoning},{type:'response.output_item.added',output_index:1,item:{...message,content:[]}},{type:'response.output_text.delta',output_index:1,content_index:0,delta:raw},{type:'response.output_item.done',output_index:1,item:message},{type:'response.completed',response:{status:'completed',output:[reasoning,message],usage:{input_tokens:4,output_tokens:5,total_tokens:9}}}],jwt='DUMMY.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'DUMMY_ACCOUNT'}})).toString('base64')+'.DUMMY';let fetches=0;
 const fixture=model('unused');fixture.definition.api='openai-codex-responses';fixture.definition.apiKey=jwt;fixture.definition.baseUrl='https://chatgpt.com/backend-api';fixture.definition.models[0].reasoning=true;fixture.definition.streamSimple=(m,c,o)=>native(m,c,{...o,apiKey:jwt,transport:'sse',maxRetries:0,fetch:async(url)=>{fetches++;assert.equal(String(url),'https://chatgpt.com/backend-api/codex/responses');return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});}});
 const r=await runRole(options([],[],{model:fixture}));assert.equal(fetches,1);assert.equal(r.usable,true,r.issues.join());assert.equal(r.rawFinal,raw);const entries=(await fs.readFile(r.historyRef,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),entry=entries.find(e=>e.id===r.selectedFinalEntryId);assert.deepEqual(entry.message.content.map(c=>c.type),['thinking','text']);assert.equal(entry.message.content[0].thinking,reasoning.summary[0].text);assert.equal(entry.message.content[0].thinkingSignature,JSON.stringify(reasoning));assert.equal(entry.message.content[1].text,raw);assert.ok(r.nativeCheckpoint.leafId);
});

test('an adversarial finished native tool-bearing entry is not a final role JSON authorization',async()=>{
 const raw=result([]),content=[{type:'text',text:raw},{type:'toolCall',id:'DUMMY_CALL',name:'not_installed',arguments:{}}],o=options([],[],{model:model(raw,[],()=>{},'stop',content)}),launch=o.launchId;let native;
 o.nativeIdentity={conversationId:'DUMMY-C-'+launch,workId:'DUMMY-W',runId:'DUMMY-R-'+launch,launchId:launch,generation:1,directionRevision:0,initialInputId:'DUMMY-I-'+launch};o.nativeLifecycle={ready:value=>{native=value;value.session.agent.finishTurn=async()=>({action:'end'});},settling(){},released(){}};
 const r=await runRole(o);assert.ok(native);assert.equal(r.usable,false);assert.match(r.issues.join(),/PROTOCOL: final must contain one text JSON record/);assert.equal(o.operations.calls.length,0);assert.equal(r.protocol,null);
});

test('actual native P and accepted-plan J receive local consequential-ambiguity contract without changing other text lists',async()=>{
 const plan={intent:'Preserve existing behavior',requirements:[{id:'R1',text:'Existing owner requirement',source:'owner'}],approach:'Use the existing reversible convention; this is a selected solution choice.',simplerAlternative:'Retain current code when sufficient.',factualSources:['Observed source; future execution is not yet evidence.'],ambiguities:[],verification:{checks:[{id:'check',guaranteeIds:['R1'],command:'node check.cjs',assertions:['actual behavior'],timeoutMs:1000,fixturePaths:[]}],requiredPaths:[],reviewRoles:[{key:'review',kind:'reviewer',purpose:'Independent current verification remains required',requiredPaths:[]}]}};
 for(const role of ['planner','adjudicator']){
  const stage=role==='planner'?'planning':'planning-adjudication';let seen=0;
  const schema=roleOutputSchema(role,stage),ps=schema.properties[role==='planner'?'plan':'acceptedPlan'],amb=ps.properties.ambiguities;
  assert.equal(amb.type,'array');assert.equal(amb.items.type,'string');assert.ok(ps.required.includes('ambiguities'));
  assert.match(amb.description,/unresolved.*owner intent/);assert.match(amb.description,/nonempty.*blocks implementation/);assert.match(amb.description,/do not hide.*unknowns/);
  assert.equal(ps.properties.factualSources.description,undefined);assert.equal(roleOutputSchema('adjudicator').properties.ownerDecisionRequired.description,undefined);
  const extra=role==='planner'?{plan}:{decisions:[],planAccepted:true,acceptedPlan:plan};
  const o=options([],[],{role,model:model(result([],extra),[],context=>{seen++;const actual=getCurrentSystemPrompt(context.messages);assert.ok(actual.includes(JSON.stringify(schema)));assert.ok(actual.includes(amb.description));})});o.inputBundle.context.stage=stage;
  const actual=await runRole(o);assert.equal(actual.usable,true,actual.issues.join());assert.equal(seen,1);assert.deepEqual((actual.protocol.plan??actual.protocol.acceptedPlan).ambiguities,[]);
 }
});

test('assigned native J receives field-local decision witness contract with unchanged strict shape',async()=>{
 const schema=roleOutputSchema('adjudicator','review-adjudication'),field=schema.properties.decisions.items.properties.witnesses;assert.equal(typeof field.description,'string');assert.ok(field.description.length);const structural=structuredClone(field);delete structural.description;assert.deepEqual(structural,roleOutputSchema('confirmer').properties.witnesses);assert.equal(schema.properties.checkResolutions.items.properties.witnesses.description,undefined);assert.equal(schema.properties.ownerDecisionRequired.description,undefined);for(const stage of [undefined,'planning-adjudication','source-fit','publication-payload-fit'])assert.equal(roleOutputSchema('adjudicator',stage).properties.decisions.items.properties.witnesses.description,undefined);
 let calls=0;const o=options([],[],{role:'adjudicator',model:model(result([],{decisions:[]}),[],context=>{calls++;const actual=getCurrentSystemPrompt(context.messages);assert.ok(actual.includes(JSON.stringify(schema)));assert.ok(actual.includes(field.description));})});o.inputBundle.context.stage='review-adjudication';o.inputBundle.context.checks=[{id:'DUMMY_ACTUAL_CHECK_RECORD',check_id:'DUMMY_LOGICAL_CHECK',status:'pass',candidate:'C1',verification:'V1'}];const actual=await runRole(o);assert.equal(actual.usable,true,actual.issues.join());assert.equal(calls,1);assert.deepEqual(actual.protocol.decisions,[]);
});

// Actual202 rejected a guessed README range beyond the captured source. Exact
// host bounds assist the producer without admitting or silently clamping claims.
test('native producer receives exact source line counts while over-range claims still refuse',async()=>{
 const s=source('α\r\nbeta\n');s.lineCount=999;let observations=0;
 const inspect=context=>{const user=context.messages.find(m=>m.role==='user');const prompt=typeof user.content==='string'?user.content:user.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
  const body=JSON.parse(prompt.split('\n')[1]),header=JSON.parse(prompt.match(/^SOURCE (.+)$/m)[1]);
  assert.equal(body.sources[0].lineCount,3);assert.equal(header.lineCount,3);assert.equal(header.sha256,hashText(s.content));
  assert.ok(prompt.includes('\n'+s.content+'\nEND SOURCE\n'));assert.equal(body.requiredScope.length,0);observations++;};
 const valid=await runRole(options([s],[],{model:model(result([scope(s,1,3)]),[],inspect)}));assert.equal(valid.usable,true,valid.issues.join());assert.equal(valid.exposures[0].endLine,3);
 const invalid=await runRole(options([s],[],{model:model(result([scope(s,1,4)]),[],inspect)}));assert.equal(invalid.usable,false);assert.ok(invalid.issues.includes('UNEXPOSED_SCOPE:'+s.id+':1-4'));assert.equal(observations,2);
});

const heldSourceContext = () => ({stage:'planning-adjudication',sourceInputChain:[
 {input_id:'actual-owner-input',revision:4,text:'Preserve the original task; clarify its recovery only.',data:{effectHold:true}},
 {input_id:'actual-reentry-input',revision:7,text:'Reenter the same governed task under the retained requirements.',data:{effectHold:true}},
 {input_id:'already-classified-input',revision:2,text:'Earlier classified source.',data:{effectHold:false}}
]});
const authoredInputDecisions = () => [
 {inputId:'actual-owner-input',directionRevision:4,impact:'explanation',reason:'The supplied owner source explicitly retains the original task.',requirementIds:['R1']},
 {inputId:'actual-reentry-input',directionRevision:7,impact:'ambiguous',reason:'This fixture deliberately retains a consequential interpretation for owner clarification.',requirementIds:['R1']}
];

test('actual planning adjudicator receives one captured source-fit contract and retains independent classifications',async()=>{
 const context=heldSourceContext(),required=planningSourceFitRequirements('adjudicator',context),schema=roleOutputSchema('adjudicator',context.stage,required);
 assert.deepEqual(required,[{inputId:'actual-owner-input',directionRevision:4},{inputId:'actual-reentry-input',directionRevision:7}]);
 assert.ok(Object.isFrozen(required));assert.ok(required.every(Object.isFrozen));
 assert.ok(schema.required.includes('inputDecisions'));assert.equal(schema.properties.inputDecisions.minItems,2);
 assert.ok(schema.properties.inputDecisions.description.includes(JSON.stringify(required)));
 const raw=result([],{decisions:[],inputDecisions:authoredInputDecisions()});let calls=0;
 const o=options([],[],{role:'adjudicator',model:model(raw,[],providerContext=>{
  calls++;const prompt=getCurrentSystemPrompt(providerContext.messages);assert.ok(prompt.includes(JSON.stringify(schema)));
  assert.match(prompt,/Classify impact honestly/);assert.match(prompt,/host separately checks current source and accepted requirements/);
  // The caller cannot change the producer's captured requirements after admission.
  o.inputBundle.context.sourceInputChain[0].input_id='late-caller-replacement';
  o.inputBundle.context.sourceInputChain.push({input_id:'newer-owner-input',revision:8,data:{effectHold:true}});
 })});o.inputBundle.context=context;
 const actual=await runRole(o);assert.equal(actual.usable,true,actual.issues.join());assert.equal(calls,1);assert.equal(actual.rawFinal,raw);
 assert.deepEqual(actual.protocol.inputDecisions,authoredInputDecisions());assert.equal(actual.protocol.inputDecisions[1].impact,'ambiguous');
 assert.equal(actual.protocol.inputDecisions.some(d=>d.inputId==='newer-owner-input'),false,'A captured producer contract cannot classify a newer source');
 assert.equal(roleOutputSchema('adjudicator','planning-adjudication').required.includes('inputDecisions'),false);
});

for(const mutation of ['omitted','partial','wrong-revision','duplicate'])test(`actual planning adjudicator retains and refuses ${mutation} source-fit protocol`,async()=>{
 const decisions=authoredInputDecisions();
 if(mutation==='partial')decisions.pop();
 if(mutation==='wrong-revision')decisions[0].directionRevision++;
 if(mutation==='duplicate')decisions.push({...decisions[0]});
 const raw=result([],{decisions:[],...(mutation==='omitted'?{}:{inputDecisions:decisions})});
 const o=options([],[],{role:'adjudicator',model:model(raw)});o.inputBundle.context=heldSourceContext();
 const actual=await runRole(o);assert.equal(actual.usable,false);assert.equal(actual.protocol,null);assert.equal(actual.rawFinal,raw);
 assert.match(actual.issues.join(),mutation==='duplicate'?/Duplicate input decision ID/:/Missing source-fit decision for held input/);
 assert.ok(actual.historyRef);assert.ok(actual.nativeCheckpoint);assert.equal(actual.terminal,'complete');
});

test('generic roles, other adjudication stages and contexts without held inputs keep the existing producer contract',async()=>{
 for(const [role,context]of [['reviewer',heldSourceContext()],['adjudicator',{...heldSourceContext(),stage:'review-adjudication'}],['adjudicator',{stage:'planning-adjudication'}],['adjudicator',{stage:'planning-adjudication',sourceInputChain:[{input_id:'ignored-unheld',revision:0,data:{effectHold:false}}]}]]){
  assert.deepEqual(planningSourceFitRequirements(role,context),[]);
  const o=options([],[],{role,model:model(result([],role==='adjudicator'?{decisions:[]}:{}))});o.inputBundle.context=context;
  const actual=await runRole(o);assert.equal(actual.usable,true,actual.issues.join());assert.equal(actual.protocol.inputDecisions,undefined);
 }
});

test('malformed supplied held identities refuse before provider admission rather than inventing a source-fit obligation',async()=>{
 for(const mutate of [c=>{c.sourceInputChain[0].input_id='';},c=>{c.sourceInputChain[0].revision=0;},c=>{c.sourceInputChain[0].revision=1.5;},c=>{c.sourceInputChain.push({...c.sourceInputChain[0]});}]){
  let calls=0;const context=heldSourceContext();mutate(context);
  const o=options([],[],{role:'adjudicator',model:model(result([],{decisions:[]}),[],()=>calls++)});o.inputBundle.context=context;
  const actual=await runRole(o);assert.equal(actual.usable,false);assert.match(actual.issues.join(),/held input identity\/revision unavailable/);assert.equal(calls,0);assert.equal(actual.rawFinal,null);
 }
});

import {mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
import {verificationCommandContract} from '../../dist/workflow/verification-contract.js';
test('actual planning producers receive the owned descriptor/output/source and closed mixed-strategy grammar',async()=>{
 for(const [role,stage] of [['planner','planning'],['challenger','planning-challenge'],['adjudicator','planning-adjudication']]){
  let prompt='';const extra=role==='planner'?{plan:mixedPlan()}:role==='challenger'?{alternatives:[]}:{decisions:[],planAccepted:true,acceptedPlan:mixedPlan()};
  const o=options([],[],{role,model:model(result([],extra),[],context=>{prompt=getCurrentSystemPrompt(context.messages)})});o.inputBundle.context={stage,requirementSourceIds:['owner-request']};
  const actual=await runRole(o);assert.equal(actual.usable,true,actual.issues.join());assert.ok(prompt.includes(JSON.stringify(verificationCommandContract)));assert.match(prompt,/case\.declaration\.input\.literalUtf8/);assert.match(prompt,/No extra fields/);assert.match(prompt,/no generic qualitative waiver/i);
  if(role!=='challenger'){const schema=roleOutputSchema(role,stage,[],{sourceIds:['owner-request']});assert.ok(prompt.includes(JSON.stringify(schema)));const field=role==='planner'?'plan':'acceptedPlan';assert.equal(schema.properties[field].properties.verification.properties.strategies.items.anyOf.length,3);}
 }
});
test('actual independent reviewer schema makes supplied strategy/witness decisions mandatory without mandating satisfied',async()=>{
 const fit=[{requirementId:'R1',strategyDigest:'c'.repeat(64),witnessIds:['actual-scope-version']}];let prompt='';
 const make=extra=>{const o=options([],[],{model:model(result([],extra),[],context=>{prompt=getCurrentSystemPrompt(context.messages)})});o.inputBundle.context={stage:'fresh-review',verificationReviewRequirements:fit};return o};
 const absent=await runRole(make({outcome:'clear'}));assert.equal(absent.usable,false);assert.match(absent.issues.join(),/verification decisions incomplete/);assert.ok(prompt.includes(JSON.stringify(roleOutputSchema('reviewer','fresh-review',[],{verificationFit:fit}))));
 const unavailable=await runRole(make({verificationDecisions:[{requirementId:'R1',strategyDigest:fit[0].strategyDigest,witnessIds:[],verdict:'unavailable',reason:'Required original source evidence cannot be established'}]}));assert.equal(unavailable.usable,true,unavailable.issues.join());assert.equal(unavailable.protocol.verificationDecisions[0].verdict,'unavailable');
});

test('actual eligible planning producers receive mandatory accounting and can decline an unavailable oracle without invented requirements',async()=>{
 const profile=initialVerificationProfile;let prompt='';const plan=mixedPlan();plan.verification.strategies=[];const unavailable={requirementId:'baseline',severity:'blocking',repair:'unknown',description:'Necessary owner oracle cannot be represented in the finite profile',evidence:['Actual owner source']};
 const make=(role,extra)=>{const o=options([],[],{role,model:model(result([],extra),[],context=>{prompt=getCurrentSystemPrompt(context.messages)})});o.inputBundle.context={stage:role==='planner'?'planning':'planning-adjudication',planningVerificationProfile:profile};return o};
 const proposal=await runRole(make('planner',{plan,findings:[unavailable]}));assert.equal(proposal.usable,true,proposal.issues.join());assert.ok(prompt.includes(JSON.stringify(roleOutputSchema('planner','planning',[],{planningProfile:profile}))));
 const declined=await runRole(make('adjudicator',{decisions:[],planAccepted:false,findings:[unavailable]}));assert.equal(declined.usable,true,declined.issues.join());assert.equal(declined.protocol.acceptedPlan,undefined);assert.equal(declined.protocol.planAccepted,false);
 const bad=await runRole(make('adjudicator',{decisions:[],planAccepted:true}));assert.equal(bad.usable,false);assert.match(bad.issues.join(),/strategy accounting/);
});

const refreshTuple={sourceId:'actual-owned-refresh',fromContractsVersion:'actual-old-contracts',toContractsVersion:'actual-new-contracts'};
const refreshContext=()=>({...heldSourceContext(),criteriaRefresh:{...refreshTuple,previous:{text:'Previous selected workflow rules'},current:{textSource:'inputBundle.contracts'}}});
const authoredCriteriaDecision=verdict=>({...refreshTuple,verdict,reason:'Independent assessment of the actual previous and current selected workflow rules'});
const schemaArguments=(schema,value)=>validateToolArguments({name:'role-output-schema-probe',parameters:schema},
 {type:'toolCall',id:'schema-only-probe',name:'role-output-schema-probe',arguments:structuredClone(value)});

test('actual planning refresh uses one captured tuple for schema and final decoding while retaining independent verdicts',async()=>{
 for(const verdict of ['adopt','needs-owner']){
  const context=refreshContext(),refresh=planningCriteriaRefreshRequirement('adjudicator',context),sourceFit=planningSourceFitRequirements('adjudicator',context);
  assert.ok(Object.isFrozen(refresh));assert.deepEqual(refresh,refreshTuple);
  const schema=roleOutputSchema('adjudicator',context.stage,sourceFit,{criteriaRefresh:refresh});
  const raw=result([],{decisions:[],planAccepted:true,inputDecisions:authoredInputDecisions(),criteriaDecision:authoredCriteriaDecision(verdict)});
  const o=options([],[],{role:'adjudicator',model:model(raw,[],provider=>{
   const prompt=getCurrentSystemPrompt(provider.messages);assert.ok(prompt.includes(JSON.stringify(schema)));assert.match(prompt,/choose adopt or needs-owner honestly/);
   o.inputBundle.context.criteriaRefresh.sourceId='late-caller-replacement';o.inputBundle.context.criteriaRefresh.toContractsVersion='later-caller-version';
  })});o.inputBundle.context=context;
  const actual=await runRole(o);assert.equal(actual.usable,true,actual.issues.join());assert.equal(actual.rawFinal,raw);
  assert.deepEqual(actual.protocol.criteriaDecision,authoredCriteriaDecision(verdict));
 }
});

test('actual refresh omission is required only on the host-reachable accepting path',async()=>{
 for(const planAccepted of [undefined,false,true])for(const ownerDecisionRequired of [undefined,[],['Actual owner clarification is needed']]){
  const extra={decisions:[],...(planAccepted===undefined?{}:{planAccepted}),...(ownerDecisionRequired===undefined?{}:{ownerDecisionRequired})};
  const context={stage:'planning-adjudication',criteriaRefresh:{...refreshTuple}};
  const raw=result([],extra),o=options([],[],{role:'adjudicator',model:model(raw)});o.inputBundle.context=context;
  const actual=await runRole(o),required=planAccepted===true&&!ownerDecisionRequired?.length;
  assert.equal(actual.usable,!required,JSON.stringify(extra)+' '+actual.issues.join());assert.equal(actual.rawFinal,raw);
  if(required){assert.equal(actual.protocol,null);assert.match(actual.issues.join(),/omitted the captured criteria refresh decision/);assert.ok(actual.historyRef);assert.ok(actual.nativeCheckpoint);}
  const schema=roleOutputSchema('adjudicator',context.stage,[],{criteriaRefresh:refreshTuple});
  if(required)assert.throws(()=>schemaArguments(schema,JSON.parse(raw)));else assert.doesNotThrow(()=>schemaArguments(schema,JSON.parse(raw)));
 }
});

test('actual planning producer retains unusable raw output for partial or mismatched refresh decisions even on refusal',async()=>{
 for(const mutation of ['partial','sourceId','fromContractsVersion','toContractsVersion'])for(const planAccepted of [false,true]){
  const decision=authoredCriteriaDecision('adopt');if(mutation==='partial')delete decision.toContractsVersion;else decision[mutation]='foreign-refresh-identity';
  const raw=result([],{decisions:[],planAccepted,criteriaDecision:decision}),o=options([],[],{role:'adjudicator',model:model(raw)});
  o.inputBundle.context={stage:'planning-adjudication',criteriaRefresh:{...refreshTuple}};
  const actual=await runRole(o);assert.equal(actual.usable,false);assert.equal(actual.protocol,null);assert.equal(actual.rawFinal,raw);
  assert.ok(actual.historyRef);assert.ok(actual.nativeCheckpoint);assert.equal(actual.terminal,'complete');
 }
});

test('conditional refresh grammar survives both mixed planning branches and the held-input contract',()=>{
 const sourceFit=planningSourceFitRequirements('adjudicator',refreshContext()),schema=roleOutputSchema('adjudicator','planning-adjudication',sourceFit,
  {criteriaRefresh:refreshTuple,planningProfile:initialVerificationProfile});
 assert.equal(schema.anyOf.length,2);
 for(const branch of schema.anyOf){
  assert.deepEqual(branch.if.properties.planAccepted.const,true);assert.equal(branch.if.properties.ownerDecisionRequired.maxItems,0);
  assert.deepEqual(branch.then.required,['criteriaDecision']);assert.ok(branch.required.includes('inputDecisions'));
  for(const key of Object.keys(refreshTuple))assert.equal(branch.properties.criteriaDecision.properties[key].const,refreshTuple[key]);
 }
 const base={version:1,summary:'Assess actual captured planning inputs',findings:[],assessedScope:[],decisions:[],inputDecisions:authoredInputDecisions()};
 const accepted={...base,planAccepted:true,acceptedPlan:mixedPlan(),criteriaDecision:authoredCriteriaDecision('adopt')};
 assert.doesNotThrow(()=>schemaArguments(schema,accepted));
 const missing=structuredClone(accepted);delete missing.criteriaDecision;assert.throws(()=>schemaArguments(schema,missing));
 assert.doesNotThrow(()=>schemaArguments(schema,{...base,planAccepted:false}));
 const ownerQuestion={...accepted,ownerDecisionRequired:['Actual owner ambiguity']};delete ownerQuestion.criteriaDecision;
 assert.doesNotThrow(()=>schemaArguments(schema,ownerQuestion));
 const foreign={...base,planAccepted:false,criteriaDecision:{...authoredCriteriaDecision('needs-owner'),sourceId:'foreign'}};
 assert.throws(()=>schemaArguments(schema,foreign));
});

test('malformed actual planning refresh refuses before any provider admission',async()=>{
 for(const value of ['not-an-owned-tuple',{}, {...refreshTuple,sourceId:''},{...refreshTuple,fromContractsVersion:1},{...refreshTuple,toContractsVersion:'x'.repeat(32769)}]){
  let calls=0;const o=options([],[],{role:'adjudicator',model:model(result([],{decisions:[],planAccepted:true}),[],()=>calls++)});
  o.inputBundle.context={stage:'planning-adjudication',criteriaRefresh:value};
  const actual=await runRole(o);assert.equal(actual.usable,false);assert.match(actual.issues.join(),/criteria refresh identity unavailable/);
  assert.equal(calls,0);assert.equal(actual.providerRequests,0);assert.equal(actual.rawFinal,null);
 }
});

test('generic roles and no-refresh planning retain the original output contract',async()=>{
 for(const [role,context]of [['reviewer',refreshContext()],['adjudicator',{...refreshContext(),stage:'review-adjudication'}],
  ['adjudicator',{stage:'planning-adjudication'}],['adjudicator',{stage:'planning-adjudication',criteriaRefresh:null}]]){
  assert.equal(planningCriteriaRefreshRequirement(role,context),undefined);
  const raw=result([],role==='adjudicator'?{decisions:[],planAccepted:true}:{}),o=options([],[],{role,model:model(raw)});o.inputBundle.context=context;
  const actual=await runRole(o);assert.equal(actual.usable,true,actual.issues.join());assert.equal(actual.protocol.criteriaDecision,undefined);
 }
});
