import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSourceProposal, prepareSourceSave, inspectSourceSave, sourceFileDisplayParts} from '../../dist/ui/source-save.js';
import {uiText} from '../../dist/ui/i18n.js';
import {isSourceSaveBranchName} from '../../dist/controller/source-save-basis.js';
import {HostPicker} from '../../dist/ui/host-picker.js';
import {initTheme} from '@earendil-works/pi-coding-agent';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
initTheme('dark',false);

function world(locale='en') {
 const calls=[],shown=[],choices=[],signal=new AbortController();let closed=0;
 const review={sourceRoot:'/source',projectId:'P',nativeProfile:{gitBinary:'/trusted/git'},artifact:{hash:'original'},destinationRef:'refs/heads/new',projectedCommit:'a'.repeat(40),productCount:1,wholeFileAdditionCount:1,omissionCount:1};
 const publication={review,readPage({section}){return{entries:section==='whole-file'?[{path:'existing-untracked.txt'}]:[],nextCursor:null};},async readFile({path,offset=0}){return{path,offset,totalBytes:4,sha256:'a'.repeat(64),text:'all\n',nextOffset:null};},async close(){closed++;}};
 const original={state:'RETAINED',workId:'W',operationId:'original-operation',recordedPhase:'PREPARED',recordedOutcome:null,nativeAttempt:null,binding:{projectRoot:'/source',proposalId:'P',destinationRef:'refs/heads/new',projectedCommit:review.projectedCommit}};
 const c={inspectSourceSnapshotProposalOperation(){return null;},async inspectSourceSnapshotProposal(){return review;},async openSourceSnapshotPublication(){return publication;},async reviewSourceSnapshotSave(){return{kind:'review',binding:{projectRoot:'/source'},fingerprint:'review',canAdopt:true,holds:[],execution:{lim:9,consumed:8,reserved:0}};},async adoptSourceSnapshotSave(input,controls){controls.validate();calls.push('adopt');controls.onAllocated?.(original.operationId);return original;},async sendSourceSnapshotSave(id,controls){controls.validate();calls.push('send');return{...original,recordedPhase:'CONFIRMED'};},inspectSourceSnapshotOperation(){return original;}};
 const host={locale,signal:signal.signal,guard(){},notice(message){calls.push(message);},input:async()=>assert.fail('No extra input'),show:async(title,text,primary)=>{shown.push({title,text,action:primary?.label});await primary?.run();},choose:async()=>assert.fail('Stable values required'),async chooseItems(title,items){choices.push({title,items});return items[0].value;}};
 return{host,c,publication,original,review,calls,shown,choices,signal,get closed(){return closed;}};
}

test('source file windows split after escaping and preserve Unicode without raw control injection',()=>{
 const input=('\x1b\x00\r\u009b🙂\t\n').repeat(8192),parts=sourceFileDisplayParts(input);
 assert.ok(parts.length>2);assert.ok(parts.every(part=>part.length<=32000&&!/[\uD800-\uDBFF]$/.test(part)));
 assert.equal(parts.join(''),input.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
 assert.ok(!parts.some(part=>part.includes('\x1b')));assert.deepEqual(sourceFileDisplayParts(''),['']);
});

for(const action of ['send','read'])test('scoped original '+action+' refuses replacement during final progress handoff',async()=>{
 const f=world();
 if(action==='read'){
  f.original.recordedPhase='UNKNOWN';f.original.nativeAttempt={intent:{}};
  f.c.reviewSourceSnapshotResult=async()=>({canRead:true,fingerprint:'review',holds:[]});
 }
 f.host.chooseItems=async(_title,items)=>items.find(item=>item.value===action).value;
 f.c.sendSourceSnapshotSave=async()=>assert.fail('A different work cannot send');
 f.c.checkSourceSnapshotResult=async()=>assert.fail('A different work cannot reconcile');
 const finalTitle=uiText('en',action==='send'?'save.saving':'save.checking');
 let handedOff=false;
 f.host.progress=async(title,task)=>{
  if(title===finalTitle){handedOff=true;f.original.workId='foreign-work';}
  return task(f.signal.signal);
 };
 await assert.rejects(inspectSourceSave(f.host,f.c,f.original.operationId,false,{workId:'W'}),/Original save changed/);
 assert.equal(handedOff,true);
});

test('the retained continuation closes an unavailable preview to the original save', async () => {
 const f = world();
 const choices = ['send','back'];
 f.host.chooseItems = async () => choices.shift();
 f.c.inspectSourceSnapshotProposal = async () => { throw Error('Original preview file missing'); };
 f.c.sendSourceSnapshotSave = async () => assert.fail('Missing preview cannot send');
 assert.equal(await inspectSourceSave(f.host,f.c,f.original.operationId),f.original);
 assert.deepEqual(choices,[]);
 assert.equal(f.shown.length,1);
 assert.ok(f.shown[0].text.includes('Original preview file missing'));
 assert.equal(f.calls.length,0);
});

test('an opened retained preview refuses a changed adoption binding before presenting actions', async () => {
 const f = world();
 const expectedOriginal = structuredClone(f.original);
 f.original.binding.destinationRef = 'refs/heads/other';
 f.host.chooseItems = async () => assert.fail('Changed binding cannot offer actions');
 await assert.rejects(inspectSourceSave(f.host,f.c,f.original.operationId,false,{workId:'W',expectedOriginal}),/Original save changed/);
});

for(const locale of ['en','ko']) {
 test(locale+' Escape from the save summary returns without opening any options',async()=>{
  const f=world(locale);
  f.host.show=async(title,_body,primary)=>{
   assert.equal(title,uiText(locale,'save.title'));
   assert.equal(primary?.label,uiText(locale,'save.openOptions'));
  };
  f.host.chooseItems=async()=>assert.fail('Dismissed review must not open save options');
  assert.equal(await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),undefined);
  assert.equal(f.closed,1);assert.deepEqual(f.calls,[]);
 });
 test(locale+' first review opens the original once and Back grants/sends nothing',async()=>{const f=world(locale),request={workId:'W',proposalId:'P'};let opened=0;
  f.c.inspectSourceSnapshotProposal=()=>assert.fail('Opening should supply the original scoped review');
  f.c.openSourceSnapshotPublication=async(input)=>{assert.deepEqual(input,request);opened++;return f.publication;};
  await saveSourceProposal(f.host,f.c,request);assert.equal(opened,1);assert.equal(f.closed,1);assert.ok(!f.calls.includes('adopt'));
  assert.equal(f.choices[0].items[0].value,'back');assert.ok(!f.choices[0].items.some(item=>item.value==='save'));assert.ok(f.shown[0].text.includes('refs/heads/new'));
 });
 test(locale+' complete whole-file disclosure uses one eligibility observation before exact consent',async()=>{const f=world(locale);let reviews=0;
  const review=f.c.reviewSourceSnapshotSave;
  f.c.reviewSourceSnapshotSave=async()=>{reviews++;return review();};
  const adopt=f.c.adoptSourceSnapshotSave;
  f.c.adoptSourceSnapshotSave=async(input,controls)=>{assert.equal(input.expectedReviewFingerprint,'review');return adopt(input,controls);};
  f.host.chooseItems=async(title,items)=>{
   assert.equal(title,uiText(locale,'save.title'));assert.equal(items[0].value,'back');
   if(items.some(item=>item.value==='whole')){assert.ok(!items.some(item=>item.value==='save'));return'whole';}
   assert.ok(f.shown.some(row=>row.action===uiText(locale,'save.fileComplete')&&row.text.endsWith('\n\nall\n')));
   return'save';
  };
  const result=await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(result.original.recordedPhase,'CONFIRMED');assert.deepEqual(f.calls.filter(c=>['adopt','send'].includes(c)),['adopt','send']);assert.equal(f.closed,1);assert.equal(reviews,1);
 });
 test(locale+' Escape on file content leaves disclosure incomplete',async()=>{const f=world(locale);let reviewed=false;
  const show=f.host.show;
  f.host.show=async(title,body,primary)=>{
   if(primary?.label===uiText(locale,'save.fileComplete')){reviewed=true;return;}
   return show(title,body,primary);
  };
  f.host.chooseItems=async(title,items)=>{
   assert.equal(title,uiText(locale,'save.title'));assert.ok(!items.some(item=>item.value==='save'));
   return reviewed?'back':'whole';
  };
  await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(f.closed,1);assert.ok(!f.calls.includes('adopt'));
 });
}

test('prepared review carries its exact artifact hash and closes a reader when progress fails afterward',async()=>{
 const f=world(),artifactHash='a'.repeat(64);
 f.host.input=async(_title,value)=>value||'new';
 f.host.chooseItems=async()=> 'prepare';
 f.host.progress=async(title,task)=>{
  const outcome=await task(f.signal.signal);
  if(title===uiText('en','save.opening'))throw Error('Progress view closed after open');
  return outcome;
 };
 f.c.sourceSnapshotProfileSuggestion=()=>({gitBinary:'/trusted/git'});
 f.c.prepareSourceSnapshot=async()=>({kind:'prepared',proposalId:'P',review:{artifact:{hash:artifactHash}}});
 f.c.openSourceSnapshotPublication=async input=>{
  assert.deepEqual(input,{workId:'W',proposalId:'P',expectedArtifactHash:artifactHash});return f.publication;
 };
 await assert.rejects(prepareSourceSave(f.host,f.c,'W'),/Progress view closed after open/);
 assert.equal(f.closed,1);assert.ok(!f.calls.includes('adopt'));
});

test('all final display parts, original byte windows and whole-file roster pages must reach EOF before consent',async()=>{const f=world();let windows=0,pages=0;
 f.publication.readPage=({cursor=0})=>{pages++;return{entries:[{path:'file-'+cursor}],nextCursor:cursor===0?1:null};};
 f.publication.readFile=async({path,offset=0})=>{windows++;return{path,offset,totalBytes:100000,sha256:'a'.repeat(64),text:'\x1b'.repeat(65536),nextOffset:offset===0?65536:null};};
 f.host.chooseItems=async(_title,items)=>{if(items.some(i=>i.value==='whole'))return'whole';assert.equal(windows,4);assert.equal(pages,2);
  assert.equal(f.shown.filter(row=>[uiText('en','save.nextPart'),uiText('en','save.fileComplete')].includes(row.action)).length,52);return'save';};
 await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.ok(f.shown.every(s=>s.text.length<65536));assert.equal(f.calls.filter(c=>c==='send').length,1);
});

test('source drift after complete disclosure refuses before adoption and joins the reader',async()=>{const f=world();let stale=false;f.host.guard=()=>{if(stale)throw Error('source changed');};
 f.host.chooseItems=async(_title,items)=>{if(items.some(i=>i.value==='whole'))return'whole';stale=true;return'save';};
 await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/source changed/);assert.ok(!f.calls.includes('adopt'));assert.equal(f.closed,1);
});

test('adoption notification failure retains original identity and never blindly sends',async()=>{const f=world();f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.c.adoptSourceSnapshotSave=async(_input,controls)=>{controls.onAllocated('original-operation');throw Error('notification failed');};
 await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/original-operation.*notification failed/);assert.ok(!f.calls.includes('send'));assert.equal(f.closed,1);
});

test('post-adoption navigation retains PREPARED original and blocks first send',async()=>{const f=world();let stale=false;f.review.wholeFileAdditionCount=0;f.host.guard=()=>{if(stale)throw Error('navigation changed');};f.host.chooseItems=async()=> 'save';f.c.adoptSourceSnapshotSave=async(_input,controls)=>{controls.onAllocated('original-operation');stale=true;return f.original;};
 await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/original-operation.*navigation changed/);assert.ok(!f.calls.includes('send'));assert.equal(f.closed,1);
});

for(const action of ['send','read'])test('closing retained source '+action+' review returns without confirmation or Native action',async()=>{
 const f=world();let selections=0;
 if(action==='read'){f.original.recordedPhase='UNKNOWN';f.original.nativeAttempt={intent:{}};}
 f.c.reviewSourceSnapshotResult=async()=>({canRead:true,fingerprint:'read',holds:[],execution:{lim:10,consumed:9,reserved:0}});
 f.c.checkSourceSnapshotResult=async()=>assert.fail('Closing review cannot check Native');
 f.host.show=async(_title,_text,primary)=>{assert.equal(primary.label,uiText('en','review.confirm'));};
 f.host.chooseItems=async(title,items)=>{
   assert.ok(items.some(item=>item.value==='details'));
   assert.notEqual(title,uiText('en',action==='read'?'save.checkScope':'save.sendScope'));
   return ++selections===1?action:'back';
 };
 await inspectSourceSave(f.host,f.c,f.original.operationId);assert.equal(selections,2);assert.ok(!f.calls.includes('send'));
});

test('retained send refuses an original that changed while its review was open',async()=>{
 const f=world();f.host.chooseItems=async()=> 'send';
 f.host.show=async(_title,_text,primary)=>{f.original.binding.destinationRef='refs/heads/changed';await primary.run();};
 await assert.rejects(inspectSourceSave(f.host,f.c,f.original.operationId),/Original save changed/);assert.ok(!f.calls.includes('send'));
});

for (const scenario of ['confirmed', 'unknown', 'unsettled', 'replaced binding', 'closed', 'before invocation']) test('retained first send handles a failed return with '+scenario, async () => {
 const f=world(), failure=Error('Controlled lost send response'), phase=scenario==='confirmed'?'CONFIRMED':'UNKNOWN';
 let sent=0, shownOutcome=false;
 f.host.chooseItems=async(title,items)=>{
  if (!sent) return 'send';
  shownOutcome=true;
  assert.ok(title.startsWith(uiText('en',phase==='CONFIRMED'?'save.confirmed':'save.uncertain')));
  assert.ok(title.includes(failure.message));
  assert.ok(title.includes(f.original.operationId));
  assert.ok(!items.some(item=>item.value==='send'));
  return 'back';
 };
 f.c.sendSourceSnapshotSave=async(_id,controls)=>{
  assert.notEqual(scenario,'before invocation');
  controls.validate();sent++;
  f.original.recordedPhase=phase;
  f.original.recordedOutcome=scenario==='confirmed'?'confirmed':'unknown';
  f.original.nativeAttempt=scenario==='unsettled'?{settlement:null}:{intent:{},settlement:{classification:f.original.recordedOutcome}};
  if (scenario==='replaced binding') f.original.binding.destinationRef='refs/heads/replacement';
  if (scenario==='closed') f.signal.abort(Error('Owner closed'));
  throw failure;
 };
 if (scenario==='before invocation') f.host.progress=async(title,task)=>{
  if (title===uiText('en','save.saving')) Object.assign(f.original,{
   recordedPhase:'CONFIRMED',recordedOutcome:'confirmed',nativeAttempt:{settlement:{classification:'confirmed'}},
  });
  return task(new AbortController().signal);
 };
 const action=inspectSourceSave(f.host,f.c,f.original.operationId);
 if (scenario==='confirmed'||scenario==='unknown') {
  assert.equal(await action,f.original);
  assert.equal(shownOutcome,true);
 } else if (scenario==='before invocation') {
  await assert.rejects(action,/Original save changed/);
  assert.equal(shownOutcome,false);
 } else {
  await assert.rejects(action,error=>error===failure || (error instanceof AggregateError && error.errors.includes(failure)));
  assert.equal(shownOutcome,false);
 }
 assert.equal(sent,scenario==='before invocation'?0:1);
});

test('UNKNOWN original offers a separately reviewed check and never a resend',async()=>{const f=world();f.original.recordedPhase='UNKNOWN';f.original.nativeAttempt={intent:{}};let checked=0;
 f.c.reviewSourceSnapshotResult=async()=>({canRead:true,fingerprint:'read',holds:[],execution:{lim:10,consumed:9,reserved:0}});f.c.checkSourceSnapshotResult=async(input,controls)=>{assert.equal(input.expectedReviewFingerprint,'read');controls.validate();checked++;f.original.recordedPhase='CONFIRMED';f.original.recordedOutcome='confirmed';return f.original;};
 f.host.chooseItems=async(_title,items)=>{assert.ok(!items.some(i=>i.value==='send'));return items.some(i=>i.value==='details')?checked?'back':'read':'read';};
 await inspectSourceSave(f.host,f.c,f.original.operationId);assert.equal(checked,1);assert.ok(!f.calls.includes('send'));assert.ok(f.shown.some(s=>s.title.includes(uiText('en','save.checkScope'))));
 assert.deepEqual(f.calls,[uiText('en','save.editorOutcome',{status:uiText('en','save.confirmed'),branch:'"refs/heads/new"'})+
  '\n'+uiText('en','save.reopenRoute',{id:f.original.operationId})]);
});

for(const stage of ['opening','reviewing'])test('Escape during retained result '+stage+' returns to the original menu without checking',async()=>{
 const f=world(),phase=new AbortController(),menus=[];
 Object.assign(f.original,{recordedPhase:'UNKNOWN',nativeAttempt:{intent:{}}});
 f.host.chooseItems=async title=>{menus.push(title);return menus.length===1?'read':'back';};
 f.host.progress=async(title,task)=>{
  if(title===uiText('en','save.'+stage))phase.abort();
  return task(phase.signal);
 };
 f.c.reviewSourceSnapshotResult=async()=>assert.fail('Cancelled preparation cannot reach the original eligibility read');
 f.c.checkSourceSnapshotResult=async()=>assert.fail('Cancelled preparation cannot check Native');
 const result=await inspectSourceSave(f.host,f.c,f.original.operationId,false,{workId:'W'});
 assert.deepEqual(menus,[menus[0],menus[0]]);
 assert.equal(result.recordedPhase,'UNKNOWN');
 assert.deepEqual(f.calls,[]);
});

for(const scenario of ['before admission','after admission','late success','cleanup failure','host close'])
test('Escape during result check handles '+scenario,async()=>{
 const f=world(),phase=new AbortController(),menus=[];
 const failure=new Error('Independent original cleanup failure');
 Object.assign(f.original,{recordedPhase:'UNKNOWN',nativeAttempt:{intent:{}},nativeReads:[]});
 f.c.reviewSourceSnapshotResult=async()=>({canRead:true,fingerprint:'read',holds:[],execution:{lim:10,consumed:9,reserved:0}});
 f.host.chooseItems=async(title)=>{
  if(title===uiText('en','save.checkScope'))return'read';
  menus.push(title);return menus.length===1?'read':'back';
 };
 f.host.progress=async(title,task)=>{
  if(title===uiText('en','save.checking')&&scenario==='before admission')phase.abort();
  return task(phase.signal);
 };
 let dispatched=0;
 f.c.checkSourceSnapshotResult=async(_input,{signal})=>{
  dispatched++;
  f.original.nativeReads.push({settled:true});
  if(scenario==='late success')Object.assign(f.original,{recordedPhase:'CONFIRMED',recordedOutcome:'confirmed'});
  if(scenario==='host close')f.signal.abort(failure);
  phase.abort();
  if(scenario==='cleanup failure')throw failure;
  if(scenario==='late success')return f.original;
  signal.throwIfAborted();
 };
 const result=inspectSourceSave(f.host,f.c,f.original.operationId,false,{workId:'W'});
 if(scenario==='cleanup failure'||scenario==='host close'){
  await assert.rejects(result,error=>error===failure);
  assert.equal(menus.length,1);
 }else{
  const original=await result,confirmed=scenario==='late success';
  assert.equal(menus.length,2);
  assert.ok(menus[1].startsWith(uiText('en',confirmed?'save.confirmed':'save.uncertain')));
  assert.equal(original.nativeReads.length,scenario==='before admission'?0:1);
  assert.deepEqual(f.calls,[]);
 }
 assert.equal(dispatched,scenario==='before admission'?0:1);
});

for(const locale of ['en','ko'])test(locale+' save exit announces only the current original at focus',async()=>{
 const f=world(locale);let stale=false;
 f.original.recordedPhase='UNKNOWN';
 f.c.inspectSourceSnapshotOperation=({operationId})=>{assert.equal(operationId,f.original.operationId);return{...f.original};};
 f.host.guard=()=>{if(stale)throw Error('source changed');};
 f.host.chooseItems=async title=>{assert.ok(title.startsWith(uiText(locale,'save.uncertain')));f.original.recordedPhase='CONFIRMED';f.original.recordedOutcome='confirmed';return'back';};
 const settled=await inspectSourceSave(f.host,f.c,f.original.operationId,true);
 assert.equal(settled.recordedPhase,'CONFIRMED');
 assert.deepEqual(f.calls,[uiText(locale,'save.editorOutcome',{status:uiText(locale,'save.confirmed'),branch:'"refs/heads/new"'})+
  '\n'+uiText(locale,'save.reopenRoute',{id:f.original.operationId})]);
 f.host.chooseItems=async()=>{stale=true;return'back';};
 await assert.rejects(inspectSourceSave(f.host,f.c,f.original.operationId,true),/source changed/);
 assert.equal(f.calls.length,1);
});

for(const locale of ['en','ko'])for(const [phase,recordedOutcome] of [
    ['CONFIRMED','confirmed'],['UNKNOWN','unknown'],['REFUSED','definitely-unsent'],['CONFIRMED','unknown'],
])test(`${locale} historical save shows the complete recorded or intended commit · ${phase}/${recordedOutcome}`,async()=>{
    const f=world(locale),token='a'.repeat(64),branch='refs/heads/topic/한국어';
    Object.assign(f.original,{recordedPhase:phase,recordedOutcome,binding:{...f.original.binding,destinationRef:branch,projectedCommit:token}});
    const confirmed=recordedOutcome==='confirmed';
    f.c.inspectSourceSnapshotProposal=async()=>assert.fail('Reading retained outcome cannot open a Native profile');
    await inspectSourceSave(f.host,f.c,f.original.operationId);
    const {title,items}=f.choices[0];
    assert.ok(title.includes(token),'The outcome menu must show the full retained commit identity');
    const target=uiText(locale,confirmed?'save.confirmedTarget':'save.intendedTarget',{branch:JSON.stringify(branch),commit:token});
    assert.ok(title.includes(target));
    assert.equal(title.startsWith(uiText(locale,'save.confirmed')),confirmed);
    assert.equal(items[0].value,'back');
    const picker=new HostPicker(title,items,()=>{},()=>{},()=>16,locale);
    try {
        const frame=picker.render(80).map(stripTerminalSequences).join('\n');
        for(const line of target.split('\n')) assert.ok(frame.includes(line),frame);
        assert.ok(frame.includes(uiText(locale,'save.back')));
        assert.ok(frame.includes(uiText(locale,'save.details')));
    } finally {picker.dispose();}
    assert.deepEqual(f.calls,[]);
});

test('preparation default Back never enters the private preview',async()=>{const f=world();f.host.input=async(_title,value)=>value||'new';f.c.sourceSnapshotProfileSuggestion=()=>({gitBinary:'/trusted/git'});f.c.prepareSourceSnapshot=async()=>assert.fail('Back does not prepare');await prepareSourceSave(f.host,f.c,'W');});

test('mandatory file review exposes complete long same-prefix identities in body with short titles',async()=>{
 const f=world(),names=['a'.repeat(40000)+'-one.txt','a'.repeat(40000)+'-two.txt'];let whole=false;
 f.review.wholeFileAdditionCount=2;f.publication.readPage=()=>({entries:names.map(path=>({path})),nextCursor:null});
 f.publication.readFile=async({path,offset=0})=>({path,offset,totalBytes:4,sha256:'a'.repeat(64),text:'all\n',nextOffset:null});
 f.host.chooseItems=async()=>{
  if(!whole){whole=true;return'whole';}
  const parts=f.shown.filter(row=>row.title.startsWith('File content'));
  assert.equal(parts.length,4);assert.ok(parts.every(row=>row.title.length<=200));
  const bodies=parts.map(row=>row.text).join('');
  for(const name of names)assert.ok(bodies.includes(JSON.stringify(name)+'\nSHA-256 '+ 'a'.repeat(64)+'\nBytes 0/4\n\nall\n'));
  return'save';
 };
 await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(f.calls.filter(c=>c==='send').length,1);
});

for(const locale of ['en','ko'])test(locale+' prepared-original Back is profile-free recorded inspection with a separate first-send review',async()=>{
 const f=world(locale);f.c.inspectSourceSnapshotProposal=async()=>assert.fail('Back cannot inspect a profile or current candidate');await inspectSourceSave(f.host,f.c,f.original.operationId);assert.equal(f.choices[0].items[0].value,'back');assert.ok(f.choices[0].items.some(i=>i.value==='send'));assert.ok(f.choices[0].title.startsWith(uiText(locale,'save.ready')));assert.equal(f.calls.length,0);
});

test('elapsed phase adapter never contains a human picker or file viewer',async()=>{const f=world();f.review.wholeFileAdditionCount=0;let active=false;const phases=[];f.host.progress=async(title,task)=>{assert.equal(active,false);active=true;phases.push(title);try{return await task(new AbortController().signal);}finally{active=false;}};f.host.chooseItems=async()=>{assert.equal(active,false);return'save';};f.host.show=async(_title,_body,primary)=>{assert.equal(active,false);await primary?.run();};await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(phases.length,3);assert.equal(f.calls.filter(c=>c==='send').length,1);});

for (const stage of ['before adoption starts', 'before allocation', 'after allocation', 'after settlement']) test('local save cancellation '+stage+' follows the original outcome', async () => {
 const f=world(), phase=new AbortController(), stopped=Error('OWNER_PHASE_CANCEL');
 f.review.wholeFileAdditionCount=0;
 f.host.chooseItems=async()=> 'save';
 f.host.progress=async(title,task)=>{
  if(title!==uiText('en','save.saving'))return task(new AbortController().signal);
  if(stage==='before adoption starts')phase.abort(stopped);
  return task(phase.signal);
 };
 f.c.adoptSourceSnapshotSave=async(_input,controls)=>{
  controls.validate();
  if(stage==='before allocation')phase.abort(stopped);
  controls.signal.throwIfAborted();
  f.calls.push('adopt');
  controls.onAllocated(f.original.operationId);
  if(stage==='after allocation')phase.abort(stopped);
  return f.original;
 };
 f.c.sendSourceSnapshotSave=async(_id,controls)=>{
  controls.validate();f.calls.push('send');
  Object.assign(f.original,{recordedPhase:'CONFIRMED',recordedOutcome:'confirmed',nativeAttempt:{settlement:{classification:'confirmed'}}});
  phase.abort(stopped);
  return f.original;
 };
 const committed=stage.startsWith('after');
 const outcome=await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});
 assert.equal(outcome?.original,committed?f.original:undefined);
 assert.deepEqual(f.calls,stage==='after settlement'?['adopt','send']:committed?['adopt']:[]);
 assert.equal(f.closed,1);
});

test('held current standing leaves historical proposal files inspectable and Save unavailable',async()=>{const f=world();f.c.reviewSourceSnapshotSave=async()=>{throw Error('Original work cancelled; current adoption unavailable');};f.host.chooseItems=async(_title,items)=>{assert.ok(!items.some(i=>i.value==='save'));return f.shown.some(row=>row.action===uiText('en','save.fileComplete'))?'back':'whole';};await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.ok(f.shown.some(s=>s.text.endsWith('\n\nall\n')));assert.ok(f.shown.some(s=>s.text.includes('Original work cancelled')));assert.ok(!f.calls.includes('adopt'));assert.equal(f.closed,1);});

test('eligibility cancellation exits and closes the original reader',async()=>{const f=world();f.host.progress=async(title,task)=>{const abort=new AbortController();if(title===uiText('en','save.reviewing'))abort.abort();return task(abort.signal);};
 assert.equal(await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),undefined);assert.equal(f.choices.length,0);assert.equal(f.closed,1);
});

test('opening cancelled after acquiring the reader closes it before returning',async()=>{const f=world(),abort=new AbortController();f.host.progress=async(_title,task)=>task(abort.signal);
 f.c.openSourceSnapshotPublication=async()=>{abort.abort(Error('OWNER_BACK'));return f.publication;};
 f.c.reviewSourceSnapshotSave=async()=>assert.fail('Cancelled opening cannot start eligibility review');
 assert.equal(await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),undefined);assert.equal(f.choices.length,0);assert.equal(f.closed,1);
});

test('independent read, close and stale scope failures survive a cancellation',async()=>{
 for(const failure of ['read','close','scope']){const f=world(),abort=new AbortController();f.host.progress=async(_title,task)=>task(abort.signal);
  f.c.openSourceSnapshotPublication=async()=>{abort.abort(Error('OWNER_BACK'));if(failure==='read')throw Error('original read failed');return f.publication;};
  if(failure==='close')f.publication.close=async()=>{throw Error('original close failed');};
  if(failure==='scope')f.host.guard=()=>{if(abort.signal.aborted)throw Error('original scope failed');};
  await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),new RegExp('original '+failure+' failed'));assert.equal(f.choices.length,0);
 }
});

test('reader cleanup failure preserves the original operation and the send diagnostic', async () => {
 const f=world(), sendFailure=Error('Original send failed'), closeFailure=Error('Original reader did not close');
 f.review.wholeFileAdditionCount=0;
 f.host.chooseItems=async()=> 'save';
 f.c.sendSourceSnapshotSave=async()=>{throw sendFailure;};
 f.publication.close=async()=>{throw closeFailure;};
 await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}), error=>{
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors,[sendFailure,closeFailure]);
  assert.match(error.message,/original-operation.*Original send failed.*Original reader did not close/);
  return true;
 });
});

for(const phase of ['UNKNOWN','REFUSED','CONFIRMED'])test('a settled '+phase+' original after a Native error is handed back without another action',async()=>{const f=world();f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.c.sendSourceSnapshotSave=async()=>{f.calls.push('send');f.original.recordedPhase=phase;f.original.nativeAttempt={settlement:{reason:'Original Native failure retained',cleanup:'removed'}};throw Error('Original Native failure retained');};const result=await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(result.original,f.original);assert.equal(result.original.recordedPhase,phase);assert.equal(result.original.nativeAttempt.settlement.reason,'Original Native failure retained');assert.deepEqual(f.calls.filter(c=>['adopt','send'].includes(c)),['adopt','send']);assert.equal(f.closed,1);});

for(const state of ['unsettled','unavailable'])test(state+' original never becomes a factual-outcome handoff',async()=>{const f=world();f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.c.sendSourceSnapshotSave=async()=>{f.original.recordedPhase='UNKNOWN';f.original.nativeAttempt={settlement:null};if(state==='unavailable')f.original.state='UNAVAILABLE';throw Error('Original settlement unavailable');};await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/original-operation.*Original settlement unavailable/);assert.equal(f.closed,1);});

test('reentrant navigation from the outcome notice preserves identity and refuses stale handoff',async()=>{const f=world();let stale=false;f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.host.guard=()=>{if(stale)throw Error('source changed at notice');};f.host.notice=message=>{if(message.startsWith(uiText('en','save.outcomeRetained',{id:'original-operation'})))stale=true;};f.c.sendSourceSnapshotSave=async()=>{f.original.recordedPhase='UNKNOWN';f.original.nativeAttempt={settlement:{reason:'Lost original reply'}};throw Error('Lost original reply');};await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/original-operation.*source changed at notice/);assert.equal(f.closed,1);});

test('source-save branch syntax preserves literal nested names and the UTF-8 bound',()=>{
 for(const name of ['plain','topic/한국어','refs/heads/literal','é'.repeat(500)]) assert.ok(isSourceSaveBranchName(name));
 for(const name of [null,'',' bad','topic//a','.hidden','topic/a.lock','some..part','topic/@{one','é'.repeat(501)]) assert.equal(isSourceSaveBranchName(name),false);
});

test('invalid source-save fields reopen with exact values before any proposal preparation',async()=>{
 const f=world('ko'),expected=[
  ['save.branch','',undefined,'bad branch'],
  ['save.branch','bad branch','save.branchInvalid','topic/\u2028bad'],
  ['save.branch','bad branch','save.fieldSingleLine','topic/한국어'],
  ['save.git','/trusted/git',undefined,'git'],
  ['save.git','git','save.gitInvalid','/trusted/\u0085git'],
  ['save.git','git','save.fieldSingleLine',undefined],
 ];
 f.c.sourceSnapshotProfileSuggestion=()=>({gitBinary:'/trusted/git'});
 f.c.prepareSourceSnapshot=()=>assert.fail('Invalid or cancelled field cannot prepare');
 const choices=['edit-git','back'];
 f.host.chooseItems=async(title,items)=>{
  assert.ok(title.includes('"topic/한국어"'));
  assert.ok(title.includes('"/trusted/git"'));
  assert.equal(items[0].value,'back');
  return choices.shift();
 };
 f.host.input=async(title,value,reason)=>{
  const [key,initial,error,answer]=expected.shift();
  assert.equal(title,uiText('ko',key));assert.equal(value,initial);
  assert.equal(reason,error?uiText('ko',error):undefined);
  return answer;
 };
 await prepareSourceSave(f.host,f.c,'W');
 assert.deepEqual(expected,[]);assert.deepEqual(choices,[]);
});

test('a configured Git path that cannot be displayed opens an editable replacement without changing the recipe', async () => {
 const f=world(),configured={gitBinary:'/trusted/\u2028git',maxOutputBytes:65536};
 f.c.sourceSnapshotProfileSuggestion=()=>configured;
 const values=['topic/review',undefined];
 f.host.input=async(title,value,description)=>{
  assert.equal(value,'');
  if(title===uiText('en','save.git'))
   assert.ok(description?.startsWith('Enter one line'));
  return values.shift();
 };
 f.host.chooseItems=async()=>assert.fail('Uneditable configured Git path cannot enter preparation');
 f.c.prepareSourceSnapshot=async()=>assert.fail('Backing out cannot prepare');
 assert.equal(await prepareSourceSave(f.host,f.c,'W'),undefined);
 assert.deepEqual(values,[]);
 assert.equal(configured.gitBinary,'/trusted/\u2028git');
});

for(const configured of [null,{gitBinary:'/trusted/git',commandTimeoutMs:9400,maxOutputBytes:65536}])test(
 configured?'configured Git proceeds to review without an executable input':'missing configured Git requires an absolute route before review',async()=>{
  const f=world(),binary=configured?.gitBinary??'/entered/git',inputs=[];
  f.c.sourceSnapshotProfileSuggestion=()=>configured;
  f.host.input=async(title,initial)=>{
   inputs.push([title,initial]);
   assert.equal(initial,'');
   return title===uiText('en','save.branch')?'topic/ready':binary;
  };
  f.host.chooseItems=async(title,items)=>{
   assert.ok(title.includes('"topic/ready"'));
   assert.ok(title.includes(uiText('en','save.preparedGit',{path:JSON.stringify(binary)})));
   assert.equal(items[0].value,'back');
   return title.includes(uiText('en','save.prepareCancelled')) ? 'back' : 'prepare';
  };
  f.c.prepareSourceSnapshot=async(input,{profile,validate})=>{
   validate();
   assert.deepEqual(input,{workId:'W',destinationBranch:'topic/ready'});
   assert.deepEqual(profile,{...configured,gitBinary:binary});
   return {kind:'cancelled'};
  };
  await prepareSourceSave(f.host,f.c,'W');
  const expected=[[uiText('en','save.branch'),'']];
  if(!configured)expected.push([uiText('en','save.git'),'']);
  assert.deepEqual(inputs,expected);
 });

test('cancelled preparation retains staged branch, Git override and limits for an explicit retry',async()=>{
 const f=world(),configured={gitBinary:'/trusted/git',commandTimeoutMs:15000,maxOutputBytes:32000};
 f.c.sourceSnapshotProfileSuggestion=()=>configured;
 const staged=['/trusted/git','/trusted/git','/one-save/git','/one-save/git','/one-save/git'];
 const choices=['edit-git','edit-git','prepare','prepare','back'],answers=['topic/review',undefined,'/one-save/git'];
 f.host.input=async(title,initial)=>{
  if(title===uiText('en','save.git'))assert.equal(initial,'/trusted/git');
  return answers.shift();
 };
 let preparations=0;
 f.host.chooseItems=async(title,items)=>{
  assert.ok(title.includes(uiText('en','save.preparedGit',{path:JSON.stringify(staged.shift())})));
  assert.ok(title.includes('"topic/review"'));
  assert.equal(items[0].value,'back');
  assert.equal(title.includes('Preparation cancelled.'),preparations>0);
  return choices.shift();
 };
 f.c.prepareSourceSnapshot=async(input,{profile,validate})=>{
  validate();
  preparations++;
  assert.deepEqual(input,{workId:'W',destinationBranch:'topic/review'});
  assert.deepEqual(profile,{...configured,gitBinary:'/one-save/git'});
  return {kind:'cancelled'};
 };
 await prepareSourceSave(f.host,f.c,'W');
 assert.deepEqual(staged,[]);
 assert.deepEqual(choices,[]);
 assert.deepEqual(answers,[]);
 assert.equal(preparations,2);
 assert.equal(configured.gitBinary,'/trusted/git');
});

test('a stale source refuses before starting preparation from the Git review',async()=>{
 const f=world();let stale=false;
 f.c.sourceSnapshotProfileSuggestion=()=>({gitBinary:'/trusted/git'});
 f.host.input=async()=> 'ready';
 f.host.guard=()=>{if(stale)throw Error('Original source changed');};
 f.host.chooseItems=async()=>{stale=true;return 'prepare';};
 f.c.prepareSourceSnapshot=async()=>assert.fail('Stale scope cannot prepare');
 await assert.rejects(prepareSourceSave(f.host,f.c,'W'),/Original source changed/);
});

for(const locale of ['en','ko']) test('editing a staged branch preserves the manual Git route · '+locale,async()=>{
 const f=world();f.host.locale=locale;
 const inputs=[['save.branch','','topic/wrong'],['save.git','','/manual/git'],
  ['save.branch','topic/wrong',undefined],['save.branch','topic/wrong','topic/correct']];
 const reviews=[['topic/wrong','edit-branch'],['topic/wrong','edit-branch'],['topic/correct','back']];
 f.c.sourceSnapshotProfileSuggestion=()=>null;
 f.c.prepareSourceSnapshot=async()=>assert.fail('Editing a field cannot prepare a branch');
 f.host.input=async(name,value)=>{
  const [key,prefill,answer]=inputs.shift();
  assert.equal(name,uiText(locale,key));assert.equal(value,prefill);return answer;
 };
 f.host.chooseItems=async(title,items)=>{
  const [branch,action]=reviews.shift();
  assert.ok(title.includes(JSON.stringify(branch)));
  assert.ok(title.includes('"/manual/git"'));
  assert.equal(items[0].value,'back');
  assert.ok(items.some(item=>item.value===action));
  return action;
 };
 await prepareSourceSave(f.host,f.c,'W');
 assert.deepEqual(inputs,[]);
 assert.deepEqual(reviews,[]);
});

test('cancelling correction at an existing branch retains the staged branch and Git route',async()=>{
 const existing='topic/'+'a'.repeat(120);
 const f=world(),inputs=[existing,'/selected/git',undefined,existing,'corrected'],
  choices=['edit-git','prepare','edit-branch','edit-branch','edit-branch','back'];
 const fields=[];
 f.c.sourceSnapshotProfileSuggestion=()=>({gitBinary:'/trusted/git'});
 f.host.input=async(title,value)=>{fields.push([title,value]);return inputs.shift();};
 f.host.chooseItems=async(title,items)=>{
  assert.equal(items[0].value,'back');
  const selected=choices.shift();
  if(selected==='edit-branch'){
   assert.ok(title.startsWith(uiText('en','save.branchExists')+'\n'+JSON.stringify(existing)));
   assert.deepEqual(items.map(item=>item.label),[uiText('en','save.back'),uiText('en','save.editBranch')]);
   return items[1].value;
  }
  assert.ok(items.some(item=>item.value===selected));
  if(selected==='back')assert.ok(title.includes('"/selected/git"'));
  return selected;
 };
 let preparations=0;
 f.c.prepareSourceSnapshot=async(input,{profile})=>{
  preparations++;
  assert.deepEqual(input,{workId:'W',destinationBranch:existing});
  assert.equal(profile.gitBinary,'/selected/git');
  return {kind:'held',branchExists:true};
 };
 await prepareSourceSave(f.host,f.c,'W');
 const branchLabel=uiText('en','save.branch');
 assert.deepEqual(fields,[[branchLabel,''],[uiText('en','save.git'),'/trusted/git'],[branchLabel,existing],[branchLabel,existing],[branchLabel,existing]]);
 assert.equal(preparations,1);
 assert.deepEqual(choices,[]);
 assert.deepEqual(f.calls,[]);
});

test('unclassified preparation holds still show details even with a branch collision message',async()=>{
 const f=world(),reason='Destination branch already exists';
 f.c.sourceSnapshotProfileSuggestion=()=>({gitBinary:'/trusted/git'});
 f.host.input=async(_title,value)=>value||'existing';
 f.host.chooseItems=async title=>{
  assert.equal(title,uiText('en','save.prepareScope')+'\n"existing"\n'+uiText('en','save.preparedGit',{path:'"/trusted/git"'}));
  return 'prepare';
 };
 f.c.prepareSourceSnapshot=async()=>({kind:'held',reason});
 await prepareSourceSave(f.host,f.c,'W');
 assert.ok(f.shown.some(page=>page.title.startsWith(uiText('en','save.held'))&&page.text.includes(reason)));
});
