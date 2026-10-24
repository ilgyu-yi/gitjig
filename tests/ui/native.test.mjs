import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'native-ui-')));
const stateRoot=path.join(root,'state'),artifactRoot=path.join(root,'artifacts'),workRoot=path.join(root,'work');
for(const p of [stateRoot,artifactRoot,workRoot])await fs.mkdir(p,{mode:0o700});process.env.TMPDIR=artifactRoot;
const sdk=await import('@earendil-works/pi-coding-agent');sdk.initTheme('dark',false);
const tui=await import('@earendil-works/pi-tui');
const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai/compat');
const {initializePiHost,createPiSession}=await import('../../dist/pi/index.js');
const {createNativeEditorFactory}=await import('../../dist/ui/native-editor.js');
const {NativePane}=await import('../../dist/ui/native-pane.js');
const {nativeMessageGroups}=await import('../../dist/ui/native-messages.js');
const {NativeDialogs}=await import('../../dist/ui/native-dialogs.js');
const terminal={columns:100,rows:24,kittyProtocolActive:false,start(){},stop(){},async drainInput(){},write(){},moveBy(){},hideCursor(){},showCursor(){},clearLine(){},clearFromCursor(){},clearScreen(){},setTitle(){},setProgress(){},setProgramStatus(){}};
const screen=new tui.TuiAltScreen(terminal,true),editors=createNativeEditorFactory();
const host=await initializePiHost({stateRoot,artifactRoot});
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
let serial=0;
const ops={workspaceRoot:workRoot,validatePath:p=>path.resolve(workRoot,p),async exec(){throw Error('unused');},async readFile(){throw Error('unused');},async access(){throw Error('unused');},async writeFile(){throw Error('unused');},async mkdir(){throw Error('unused');}};
function model(steps,onProvider=()=>{}){let i=0;return {provider:'native-ui-fixture-'+(++serial),modelId:'fixture',definition:{api:'fixture-api',baseUrl:'http://unused.invalid',apiKey:'fixture-only',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(selected,context){onProvider(context);const stream=createAssistantMessageEventStream();const step=steps[i++];queueMicrotask(()=>{const msg={role:'assistant',content:step?[{type:'toolCall',id:'call-'+i,name:step.name,arguments:step.args}]:[{type:'text',text:'Actual native response'}],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:step?'toolUse':'stop',timestamp:Date.now()};stream.push({type:'done',reason:msg.stopReason,message:msg});stream.end(msg);});return stream;}}};}
async function native(extra={}){return createPiSession({host,operations:ops,model:model([]),systemPrompt:'Native UI fixture, no live calls.',maxReadBytes:1024,...extra});}

test('native panes retain editor/cursor and render actual SDK history without another transcript',async()=>{
 const pi=await native(),a=new NativePane('C-a',screen,editors),b=new NativePane('C-b',screen,editors);
 try{a.attach(pi.session,pi.sessionManager);a.editor.handleInput('draft-A');a.editor.handleInput('\x1b[D');const cursor=a.editor.getCursor();b.editor.handleInput('draft-B');screen.setLayoutRoot(b.layout);screen.setFocus(b.editor);screen.render(100);screen.setLayoutRoot(a.layout);screen.setFocus(a.editor);assert.equal(a.editor.getText(),'draft-A');assert.deepEqual(a.editor.getCursor(),cursor);
 await pi.session.prompt('Actual owner history source');a.refresh();const lines=a.body.render(100).join('\n');assert.match(lines,/Actual owner history source/);assert.match(lines,/Actual native response/);assert.ok(pi.sessionManager.getBranch().some(entry=>entry.type==='message'));assert.equal(a.editor.getText(),'draft-A');
 }finally{a.dispose();b.dispose();await pi.session.abort();pi.session.dispose();}
});
test('actual native tool events reach only their pane activity without replacing editable drafts',async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();
 const pi=await native({operations:{...ops,async access(){},async readFile(){entered.resolve();await release.promise;return Buffer.from('Owned tool output');}},model:model([{name:'read',args:{path:'owned.txt'}}])});
 const pane=new NativePane('C-tool',screen,editors),other=new NativePane('C-other',screen,editors);
 let prompt;
 try{
  pane.attach(pi.session,pi.sessionManager);pane.activity.update('RUNNING');other.activity.update('QUEUED');pane.editor.setText('Editable during actual tool');
  prompt=pi.session.prompt('Read the owned file');await entered.promise;
  assert.match(tui.stripTerminalSequences(pane.activity.render(100).join('\n')),/Running tool: read/);
  assert.match(tui.stripTerminalSequences(other.activity.render(100).join('\n')),/queued/);
  pane.status.setText('TOOL_STATUS_VISIBLE');screen.setLayoutRoot(pane.layout);
  for(const width of [40,100]){const frame=screen.render(width).join('\n');assert.match(frame,/Running tool: read/);assert.match(frame,/Editable during actual tool/);}
  release.resolve();await prompt;
  assert.match(pane.body.render(100).join('\n'),/Owned tool output/);assert.equal(pane.editor.getText(),'Editable during actual tool');
 }finally{release.resolve();await prompt?.catch(()=>{});pane.dispose();other.dispose();await pi.closeOwned();}
});
test('native runtime language sections remain in model context without unsupported-message noise in the pane', async () => {
 const policy='Working records use English; human replies use Korean.';
 let received=false;
 const pi=await native({requestLanguagePolicy:()=>policy,model:model([],context=>{
  assert.ok(context.messages.some(message=>message.role==='system'&&message.sections?.['gitjig-language']===policy));received=true;
 })});
 const pane=new NativePane('C-system-context',screen,editors);
 try{
  pane.attach(pi.session,pi.sessionManager);
  await pi.session.prompt('처음 입력한 요청');
  assert.equal(received,true);
  assert.ok(pi.session.messages.some(message=>message.role==='system'));
  const retained=JSON.stringify(pi.session.messages);
  const groups=nativeMessageGroups(pi.session.messages,screen,workRoot).groups;
  assert.equal(groups.length,pi.session.messages.length);
  for(let i=0;i<groups.length;i++)if(pi.session.messages[i].role==='system')assert.deepEqual(groups[i].render(100),[]);
  pane.refresh();
  const rendered=pane.body.render(100).join('\n');
  assert.match(rendered,/처음 입력한 요청/);assert.match(rendered,/Actual native response/);
  assert.doesNotMatch(rendered,/Native message type unavailable|Working records use English/);
  assert.equal(JSON.stringify(pi.session.messages),retained);
 }finally{pane.dispose();await pi.closeOwned();}
});
test('long native history keeps status, editable draft and footer visible after attach-sized resizes', {timeout:5000}, async()=>{
 const pi=await native(), viewport={...terminal,columns:120,rows:32};
 const localScreen=new tui.TuiAltScreen(viewport,true),pane=new NativePane('C-viewport',localScreen,createNativeEditorFactory());
 try{
  await pi.session.prompt('Owned retained history '+('scroll and compaction context '.repeat(1000)));
  pane.attach(pi.session,pi.sessionManager);pane.status.setText('STATUS_VISIBLE');pane.editor.setText('DRAFT_VISIBLE');
  const footer=new tui.Text('FOOTER_VISIBLE F2 switch F4 split',0,0);
  localScreen.setLayoutRoot(new tui.VStack([{component:pane.layout,grow:1,minSize:1},{component:footer,basis:'auto'}]));
  localScreen.setFocus(pane.editor);localScreen.start();
  for(const [columns,rows] of [[120,32],[207,46],[40,24],[100,32]]){
   viewport.columns=columns;viewport.rows=rows;localScreen.requestRender(true);
   const deadline=Date.now()+1000;
   while(localScreen.getScreenLines().length!==rows && Date.now()<deadline)await new Promise(resolve=>setImmediate(resolve));
   const frame=localScreen.getScreenLines(),text=frame.join('\n');
   assert.equal(frame.length,rows,'Actual fullscreen frame remains bounded');
   for(const marker of ['STATUS_VISIBLE','DRAFT_VISIBLE','FOOTER_VISIBLE'])assert.ok(text.includes(marker),marker+' missing at '+columns+'x'+rows);
   assert.equal(pane.editor.getText(),'DRAFT_VISIBLE');assert.ok(pane.scroll.viewportHeight>0);
  }
 }finally{localScreen.stop();pane.dispose();await pi.session.abort();pi.session.dispose();}
});
test('native long-history entry anchors survive width change and per-conversation restoration',async()=>{
 const pi=await native(),a=new NativePane('C-long',screen,editors),b=new NativePane('C-other',screen,editors);
 try{
  for(let i=0;i<6;i++)await pi.session.prompt('Actual history turn '+i+' '+('long native text '.repeat(100)));
  a.attach(pi.session,pi.sessionManager);screen.setLayoutRoot(a.layout);screen.render(100);
  a.scroll.scrollTo(30,{disableFollow:true});const anchor=a.scrollAnchor(100);assert.ok(anchor.entryId);assert.equal(anchor.followEnd,false);
  screen.setLayoutRoot(b.layout);screen.render(40);a.resolveScroll(anchor.entryId,anchor.offset,anchor.followEnd,40);screen.setLayoutRoot(a.layout);screen.render(40);
  const restored=a.scrollAnchor(40);assert.equal(restored.entryId,anchor.entryId);assert.equal(restored.offset,anchor.offset);assert.equal(restored.followEnd,false);
  a.editor.handleInput('Protected draft');const cursor=a.editor.getCursor();screen.render(100);assert.equal(a.editor.getText(),'Protected draft');assert.deepEqual(a.editor.getCursor(),cursor);
 }finally{a.dispose();b.dispose();await pi.session.abort();pi.session.dispose();}
});
test('native dialogs queue without answering, resolve from actual native component and cancel boundedly',async()=>{
 const pi=await native(),editor=editors(screen);let changes=0;const dialogs=new NativeDialogs(screen,editors.bindings,()=>changes++);
 try{const context=dialogs.context(pi.session.extensionRunner.getUIContext(),editor,()=>{},()=>()=>{});const prepare=pi.session.agent.prepareRequest,finish=pi.session.agent.finishTurn;pi.session.extensionRunner.setUIContext(context,'tui');assert.equal(pi.session.extensionRunner.createContext().mode,'tui');assert.equal(pi.session.agent.prepareRequest,prepare);assert.equal(pi.session.agent.finishTurn,finish);let answered=false;const selected=context.select('Hidden child question',['One','Two']).then(value=>{answered=true;return value;});await Promise.resolve();await Promise.resolve();assert.equal(answered,false);assert.equal(dialogs.requestIds.length,1);assert.equal(dialogs.component.constructor.name,'ExtensionSelectorComponent');dialogs.component.handleInput('\r');assert.equal(await selected,'One');assert.equal(dialogs.requestIds.length,0);
 const cancelled=context.confirm('Do operation','Actual question');await Promise.resolve();await Promise.resolve();dialogs.component.handleInput('\x1b');assert.equal(await cancelled,false);
 const abort=new AbortController();const pending=context.input('Exact child','value',{signal:abort.signal});abort.abort();assert.equal(await pending,undefined);assert.equal(dialogs.requestIds.length,0);assert.ok(changes>=6);
 }finally{dialogs.dispose();await pi.session.abort();pi.session.dispose();}
});
test('finite installed coordination tools use actual native dispatch and compose WAIT after queue reconciliation',async()=>{
 let pi,calls=0;const retained=[];const callbacks={status:()=>({registered:true}),address:()=>({queued:true}),assign:()=>({assigned:true}),acknowledgeInput:()=>({hold:true}),async wait({resultHandles}){assert.deepEqual(resultHandles,['R-child']);await pi.session.followUp('exact queued continuation');const cleared=pi.session.clearQueue();retained.push(...cleared.followUp,...cleared.steering);return {waiting:true};}};
 pi=await native({coordination:callbacks,model:model([{name:'conversation_wait',args:{resultHandles:['R-child']}}],()=>calls++)});
 try{const nativeFinish=pi.session.agent.finishTurn;assert.equal(typeof nativeFinish,'function');await pi.session.prompt('Wait for the actual child handle');assert.equal(calls,1);assert.equal(pi.session.pendingMessageCount,0);assert.ok(pi.session.messages.some(m=>m.role==='toolResult'&&m.toolName==='conversation_wait'));assert.deepEqual(retained,['exact queued continuation']);
 }finally{await pi.session.abort();pi.session.dispose();}
 let statusCalls=0;const strict=await native({coordination:{...callbacks,wait:undefined,status:()=>{statusCalls++;return {registered:true};}},model:model([{name:'conversation_status',args:{}}])});
 try{assert.equal(strict.session.getAllTools().some(t=>t.name==='conversation_wait'),false);await strict.session.prompt('Inspect actual registered status');assert.equal(statusCalls,1);}finally{await strict.session.abort();strict.session.dispose();}
});
test('native assignment schema reaches finite governed operation and refuses unsupported operation',async()=>{
 let assigned=[],addressed=[];const coordination={status:()=>({registered:true}),address:args=>{addressed.push(args);return {queued:true};},assign:args=>{assigned.push(args);return {assignmentId:'A-native',workId:null,state:'QUEUED'};},acknowledgeInput:()=>({hold:true})};
 const pi=await native({coordination,model:model([{name:'conversation_assign',args:{projectId:'P-owned',instructions:'Implement the authorized one-effect criterion.',operation:'change'}}])});
 try{await pi.session.prompt('Assign the authorized change');assert.equal(assigned.length,1);assert.equal(assigned[0].operation,'change');assert.equal(assigned[0].conversationId,undefined);assert.ok(pi.session.messages.some(m=>m.role==='toolResult'&&m.toolName==='conversation_assign'&&!m.isError));}finally{await pi.session.abort();pi.session.dispose();}
 const fresh=await native({coordination,model:model([{name:'conversation_address',args:{conversationId:'registered-unstarted-C',expectedGeneration:0,text:'First authorized message',mode:'follow-up',observedDirectionRevision:0}}])});
 try{await fresh.session.prompt('Address an unstarted registered conversation');assert.equal(addressed.length,1);assert.equal(addressed[0].expectedGeneration,0);}finally{await fresh.session.abort();fresh.session.dispose();}
 assigned=[];const bad=await native({coordination,model:model([{name:'conversation_assign',args:{projectId:'P-owned',instructions:'Unauthorized enum',operation:'bypass-review'}}])});
 try{await bad.session.prompt('Try unsupported operation');assert.equal(assigned.length,0);assert.ok(bad.session.messages.some(m=>m.role==='toolResult'&&m.isError));}finally{await bad.session.abort();bad.session.dispose();}
});
test('optional native cancellation uses only captured assignment closure and rejects source injection',async()=>{
 const cancelled=[];const callbacks={status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),cancel:args=>{cancelled.push(args);return {state:'CANCELLED',assignmentId:args.assignmentId};}};
 const pi=await native({coordination:callbacks,model:model([{name:'conversation_cancel',args:{assignmentId:'A-owned-child',reason:'Owner stops this delegation'}}])});
 try{await pi.session.prompt('Cancel my known assignment');assert.deepEqual(cancelled,[{assignmentId:'A-owned-child',reason:'Owner stops this delegation'}]);assert.ok(pi.session.messages.some(m=>m.role==='toolResult'&&m.toolName==='conversation_cancel'&&!m.isError));}finally{await pi.session.abort();pi.session.dispose();}
 const bad=await native({coordination:callbacks,model:model([{name:'conversation_cancel',args:{assignmentId:'A-other',reason:'Invalid forged provenance',sourceActor:'owner',pid:123}}])});
 try{await bad.session.prompt('Try unsupported identity fields');assert.equal(cancelled.length,1);assert.ok(bad.session.messages.some(m=>m.role==='toolResult'&&m.isError));}finally{await bad.session.abort();bad.session.dispose();}
 const absent=await native();try{assert.equal(absent.session.getAllTools().some(t=>t.name==='conversation_cancel'),false);}finally{await absent.session.abort();absent.session.dispose();}
});
test('ordinary native effect tools use only exact reviewed assignment/target and owned operation handles',async()=>{
 const calls=[];const callbacks={status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),integrate:args=>{calls.push(['integrate',args]);return {operationId:'O-native-effect',assignmentId:args.reviewedAssignmentId,conversationId:'C-result',state:'QUEUED'};},effectInspect:args=>{calls.push(['inspect',args]);return {state:'UNKNOWN'};},effectReconcile:async args=>{calls.push(['reconcile',args]);return {desiredOutcome:'contains-integration',transport:'UNKNOWN'};}};
 const pi=await native({coordination:callbacks,model:model([{name:'conversation_integrate',args:{reviewedAssignmentId:'A-reviewed',targetId:'T-owned'}},{name:'effect_inspect',args:{operationId:'O-native-effect'}},{name:'effect_reconcile',args:{operationId:'O-native-effect'}}])});
 try{await pi.session.prompt('Integrate my reviewed assignment');assert.deepEqual(calls,[['integrate',{reviewedAssignmentId:'A-reviewed',targetId:'T-owned'}],['inspect',{operationId:'O-native-effect'}],['reconcile',{operationId:'O-native-effect'}]]);assert.equal(pi.session.messages.filter(m=>m.role==='toolResult'&&!m.isError).length,3);}finally{await pi.session.abort();pi.session.dispose();}
 const bad=await native({coordination:callbacks,model:model([{name:'conversation_integrate',args:{reviewedAssignmentId:'A-reviewed',targetId:'T-owned',workId:'W-forged',actor:'owner'}}])});try{await bad.session.prompt('Try unrecognized authority fields');assert.equal(calls.length,3);assert.ok(bad.session.messages.some(m=>m.role==='toolResult'&&m.isError));}finally{await bad.session.abort();bad.session.dispose();}
});
test.after(()=>{console.log(JSON.stringify({nativeUiFixture:root,syntheticTerminal:true,realHumanIME:false,externalCalls:0}));});

test('ordinary native finite publication queues exact action; authority/operation injection is rejected before callback',async()=>{
 const calls=[];const callbacks={status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),publish:args=>{calls.push(args);return {assignmentId:'A-publication',operationId:'O-host',state:'QUEUED'};}};
 const action={kind:'create-issue',title:' 원래 제목 ',body:' literal {"path":"a b"} '};
 const pi=await native({coordination:callbacks,model:model([{name:'conversation_publish',args:{targetId:'T-owned',action}}])});try{await pi.session.prompt('Queue the authorized initial issue');assert.deepEqual(calls,[{targetId:'T-owned',action}]);assert.ok(pi.session.messages.some(m=>m.role==='toolResult'&&m.toolName==='conversation_publish'&&!m.isError));}finally{await pi.session.abort();pi.session.dispose();}
 const bad=await native({coordination:callbacks,model:model([{name:'conversation_publish',args:{targetId:'T-owned',action,sourceActor:'owner',workId:'W-forged',operationId:'O-forged'}}])});try{await bad.session.prompt('Try unsupported authority fields');assert.equal(calls.length,1);assert.ok(bad.session.messages.some(m=>m.role==='toolResult'&&m.isError));}finally{await bad.session.abort();bad.session.dispose();}
});
import { summaryOutcome } from '../../dist/ui/index.js';
test('summary cause does not conceal abnormal cleanup or turn unavailable into success', () => {
    assert.equal(summaryOutcome({status:'delivered',cleanup:'unbound'}),'Summary complete.');
    const failure = 'Nothing to compact (session too small)';
    const ordinary = summaryOutcome({status:'unavailable',cleanup:'unbound',failure});
    assert.match(ordinary,/unavailable.*Nothing to compact/);
    assert.doesNotMatch(ordinary,/complete|cleanup: unbound/);
    for (const cleanup of ['quarantined','quarantined-owned-client']) {
        const text = summaryOutcome({status:'unavailable',cleanup,failure});
        assert.ok(text.includes(failure) && text.includes('cleanup: '+cleanup));
        assert.doesNotMatch(text,/Summary complete/);
    }
    assert.match(summaryOutcome({status:'delivered',cleanup:'quarantined'}),/cleanup: quarantined/);
    assert.match(summaryOutcome({status:'interrupted',cleanup:'quarantined',failure:'Aborted'}),/interrupted.*Aborted.*cleanup: quarantined/);
});
