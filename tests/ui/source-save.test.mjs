import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSourceProposal, prepareSourceSave, inspectSourceSave, sourceFileDisplayParts} from '../../dist/ui/source-save.js';
import {uiText} from '../../dist/ui/i18n.js';

function world(locale='en') {
 const calls=[],shown=[],choices=[],signal=new AbortController();let closed=0;
 const review={sourceRoot:'/source',projectId:'P',nativeProfile:{gitBinary:'/trusted/git'},artifact:{hash:'original'},destinationRef:'refs/heads/new',projectedCommit:'a'.repeat(40),productCount:1,wholeFileAdditionCount:1,omissionCount:1};
 const publication={review,readPage({section}){return{entries:section==='whole-file'?[{path:'existing-untracked.txt'}]:[],nextCursor:null};},async readFile({path,offset=0}){return{path,offset,totalBytes:4,sha256:'a'.repeat(64),text:'all\n',nextOffset:null};},async close(){closed++;}};
 const original={state:'RETAINED',workId:'W',operationId:'original-operation',recordedPhase:'PREPARED',nativeAttempt:null,binding:{projectRoot:'/source',proposalId:'P',destinationRef:'refs/heads/new'}};
 const c={async inspectSourceSnapshotProposal(){return review;},async openSourceSnapshotPublication(){return publication;},async reviewSourceSnapshotSave(){return{kind:'review',binding:{projectRoot:'/source'},fingerprint:'review',canAdopt:true,holds:[],execution:{lim:9,consumed:8,reserved:0}};},async adoptSourceSnapshotSave(input,controls){controls.validate();calls.push('adopt');controls.onAllocated?.(original.operationId);return original;},async sendSourceSnapshotSave(id,controls){controls.validate();calls.push('send');return{...original,recordedPhase:'CONFIRMED'};},inspectSourceSnapshotOperation(){return original;}};
 const host={locale,signal:signal.signal,guard(){},notice(message){calls.push(message);},input:async()=>assert.fail('No extra input'),show:async(title,text)=>shown.push({title,text}),choose:async()=>assert.fail('Stable values required'),async chooseItems(title,items){choices.push({title,items});return items[0].value;}};
 return{host,c,publication,original,review,calls,shown,choices,signal,get closed(){return closed;}};
}

test('source file windows split after escaping and preserve Unicode without raw control injection',()=>{
 const input=('\x1b\x00\r\u009b🙂\t\n').repeat(8192),parts=sourceFileDisplayParts(input);
 assert.ok(parts.length>2);assert.ok(parts.every(part=>part.length<=32000&&!/[\uD800-\uDBFF]$/.test(part)));
 assert.equal(parts.join(''),input.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
 assert.ok(!parts.some(part=>part.includes('\x1b')));assert.deepEqual(sourceFileDisplayParts(''),['']);
});

for(const locale of ['en','ko']) {
 test(locale+' default Back closes publication and grants/sends nothing',async()=>{const f=world(locale);await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(f.closed,1);assert.ok(!f.calls.includes('adopt'));assert.equal(f.choices[0].items[0].value,'back');assert.ok(!f.choices[0].items.some(item=>item.value==='save'));assert.ok(f.shown[0].text.includes('refs/heads/new'));});
 test(locale+' complete whole-file disclosure precedes the single exact consent/save choice',async()=>{const f=world(locale);let part=false;
  f.host.chooseItems=async(_title,items)=>{assert.equal(items[0].value,'back');if(items.some(i=>i.value==='whole')){assert.ok(!items.some(i=>i.value==='save'));return'whole';}if(items.some(i=>i.value==='next')){part=true;return'next';}assert.ok(part);assert.ok(f.shown.some(s=>s.text.endsWith('\n\nall\n')));return'save';};
  const result=await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(result.recordedPhase,'CONFIRMED');assert.deepEqual(f.calls.filter(c=>['adopt','send'].includes(c)),['adopt','send']);assert.equal(f.closed,1);
 });
 test(locale+' Back during a file does not enable consent',async()=>{const f=world(locale);let reviewed=false;
  f.host.chooseItems=async(_title,items)=>{if(items.some(i=>i.value==='next')){reviewed=true;return'back';}assert.ok(!items.some(i=>i.value==='save'));return reviewed?'back':'whole';};
  await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(f.closed,1);assert.ok(!f.calls.includes('adopt'));
 });
}

test('all final display parts, original byte windows and whole-file roster pages must reach EOF before consent',async()=>{const f=world();let windows=0,pages=0,parts=0;
 f.publication.readPage=({cursor=0})=>{pages++;return{entries:[{path:'file-'+cursor}],nextCursor:cursor===0?1:null};};
 f.publication.readFile=async({path,offset=0})=>{windows++;return{path,offset,totalBytes:100000,sha256:'a'.repeat(64),text:'\x1b'.repeat(65536),nextOffset:offset===0?65536:null};};
 f.host.chooseItems=async(_title,items)=>{if(items.some(i=>i.value==='whole'))return'whole';if(items.some(i=>i.value==='next')){parts++;return'next';}assert.equal(windows,4);assert.equal(pages,2);assert.equal(parts,52);return'save';};
 await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.ok(f.shown.every(s=>s.text.length<65536));assert.equal(f.calls.filter(c=>c==='send').length,1);
});

test('source drift after complete disclosure refuses before adoption and joins the reader',async()=>{const f=world();let stale=false;f.host.guard=()=>{if(stale)throw Error('source changed');};
 f.host.chooseItems=async(_title,items)=>{if(items.some(i=>i.value==='next'))return'next';if(items.some(i=>i.value==='whole'))return'whole';stale=true;return'save';};
 await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/source changed/);assert.ok(!f.calls.includes('adopt'));assert.equal(f.closed,1);
});

test('adoption notification failure retains original identity and never blindly sends',async()=>{const f=world();f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.c.adoptSourceSnapshotSave=async(_input,controls)=>{controls.onAllocated('original-operation');throw Error('notification failed');};
 await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/original-operation.*notification failed/);assert.ok(!f.calls.includes('send'));assert.equal(f.closed,1);
});

test('post-adoption navigation retains PREPARED original and blocks first send',async()=>{const f=world();let stale=false;f.review.wholeFileAdditionCount=0;f.host.guard=()=>{if(stale)throw Error('navigation changed');};f.host.chooseItems=async()=> 'save';f.c.adoptSourceSnapshotSave=async(_input,controls)=>{controls.onAllocated('original-operation');stale=true;return f.original;};
 await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/original-operation.*navigation changed/);assert.ok(!f.calls.includes('send'));assert.equal(f.closed,1);
});

test('UNKNOWN original offers a separately reviewed check and never a resend',async()=>{const f=world();f.original.recordedPhase='UNKNOWN';f.original.nativeAttempt={intent:{}};let checked=0;
 f.c.reviewSourceSnapshotResult=async()=>({canRead:true,fingerprint:'read',holds:[],execution:{lim:10,consumed:9,reserved:0}});f.c.checkSourceSnapshotResult=async(input,controls)=>{assert.equal(input.expectedReviewFingerprint,'read');controls.validate();checked++;f.original.recordedPhase='CONFIRMED';};
 f.host.chooseItems=async(_title,items)=>{assert.ok(!items.some(i=>i.value==='send'));return items.some(i=>i.value==='details')?checked?'back':'read':'read';};
 await inspectSourceSave(f.host,f.c,f.original.operationId);assert.equal(checked,1);assert.ok(!f.calls.includes('send'));assert.ok(f.shown.some(s=>s.title.includes(uiText('en','save.checkScope'))));
});

test('preparation default Back never enters the private preview',async()=>{const f=world();f.host.input=async(_title,value)=>value||'new';f.c.sourceSnapshotProfileSuggestion=()=>({gitBinary:'/trusted/git'});f.c.prepareSourceSnapshot=async()=>assert.fail('Back does not prepare');await prepareSourceSave(f.host,f.c,'W');});

test('mandatory file review exposes complete long same-prefix identities in body with short titles',async()=>{
 const f=world(),names=['a'.repeat(40000)+'-one.txt','a'.repeat(40000)+'-two.txt'];let whole=false,next=0;
 f.review.wholeFileAdditionCount=2;f.publication.readPage=()=>({entries:names.map(path=>({path})),nextCursor:null});
 f.publication.readFile=async({path,offset=0})=>({path,offset,totalBytes:4,sha256:'a'.repeat(64),text:'all\n',nextOffset:null});
 f.host.chooseItems=async(title,items)=>{if(items.some(i=>i.value==='next')){assert.ok(title.length<=200);next++;return'next';}if(!whole){whole=true;return'whole';}assert.equal(next,4);const bodies=f.shown.filter(s=>s.title.startsWith('File content')).map(s=>s.text).join('');for(const name of names)assert.ok(bodies.includes(JSON.stringify(name)+'\nSHA-256 '+ 'a'.repeat(64)+'\nBytes 0/4\n\nall\n'));return'save';};
 await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(f.calls.filter(c=>c==='send').length,1);
});

for(const locale of ['en','ko'])test(locale+' prepared-original Back is profile-free recorded inspection with a separate first-send review',async()=>{
 const f=world(locale);f.c.inspectSourceSnapshotProposal=async()=>assert.fail('Back cannot inspect a profile or current candidate');await inspectSourceSave(f.host,f.c,f.original.operationId);assert.equal(f.choices[0].items[0].value,'back');assert.ok(f.choices[0].items.some(i=>i.value==='send'));assert.ok(f.choices[0].title.startsWith(uiText(locale,'save.ready')));assert.equal(f.calls.length,0);
});

test('elapsed phase adapter never contains a human picker or file viewer',async()=>{const f=world();f.review.wholeFileAdditionCount=0;let active=false;const phases=[];f.host.progress=async(title,task)=>{assert.equal(active,false);active=true;phases.push(title);try{return await task(new AbortController().signal);}finally{active=false;}};f.host.chooseItems=async()=>{assert.equal(active,false);return'save';};f.host.show=async()=>assert.equal(active,false);await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(phases.length,3);assert.equal(f.calls.filter(c=>c==='send').length,1);});

test('phase-local cancellation before the consent transaction allocates nothing and closes the reader',async()=>{const f=world();f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.host.progress=async(title,task)=>{const abort=new AbortController();if(title===uiText('en','save.saving'))abort.abort(Error('OWNER_PHASE_CANCEL'));return task(abort.signal);};await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/OWNER_PHASE_CANCEL/);assert.ok(!f.calls.includes('adopt'));assert.ok(!f.calls.includes('send'));assert.equal(f.closed,1);});

test('held current standing leaves historical proposal files inspectable and Save unavailable',async()=>{const f=world();let visited=false;f.c.reviewSourceSnapshotSave=async()=>{throw Error('Original work cancelled; current adoption unavailable');};f.host.chooseItems=async(_title,items)=>{assert.ok(!items.some(i=>i.value==='save'));if(items.some(i=>i.value==='next')){visited=true;return'next';}return visited?'back':'whole';};await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(visited,true);assert.ok(f.shown.some(s=>s.text.endsWith('\n\nall\n')));assert.ok(f.shown.some(s=>s.text.includes('Original work cancelled')));assert.ok(!f.calls.includes('adopt'));assert.equal(f.closed,1);});

test('eligibility-phase cancellation exits instead of becoming a historical hold',async()=>{const f=world();f.host.progress=async(title,task)=>{const abort=new AbortController();if(title===uiText('en','save.reviewing'))abort.abort();return task(abort.signal);};await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/abort/i);assert.equal(f.choices.length,0);assert.equal(f.closed,1);});

for(const phase of ['UNKNOWN','REFUSED','CONFIRMED'])test('a settled '+phase+' original after a Native error is handed back without another action',async()=>{const f=world();f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.c.sendSourceSnapshotSave=async()=>{f.calls.push('send');f.original.recordedPhase=phase;f.original.nativeAttempt={settlement:{reason:'Original Native failure retained',cleanup:'removed'}};throw Error('Original Native failure retained');};const result=await saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'});assert.equal(result,f.original);assert.equal(result.recordedPhase,phase);assert.equal(result.nativeAttempt.settlement.reason,'Original Native failure retained');assert.deepEqual(f.calls.filter(c=>['adopt','send'].includes(c)),['adopt','send']);assert.equal(f.closed,1);});

for(const state of ['unsettled','unavailable'])test(state+' original never becomes a factual-outcome handoff',async()=>{const f=world();f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.c.sendSourceSnapshotSave=async()=>{f.original.recordedPhase='UNKNOWN';f.original.nativeAttempt={settlement:null};if(state==='unavailable')f.original.state='UNAVAILABLE';throw Error('Original settlement unavailable');};await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/original-operation.*Original settlement unavailable/);assert.equal(f.closed,1);});

test('reentrant navigation from the outcome notice preserves identity and refuses stale handoff',async()=>{const f=world();let stale=false;f.review.wholeFileAdditionCount=0;f.host.chooseItems=async()=> 'save';f.host.guard=()=>{if(stale)throw Error('source changed at notice');};f.host.notice=message=>{if(message===uiText('en','save.outcomeRetained',{id:'original-operation'}))stale=true;};f.c.sendSourceSnapshotSave=async()=>{f.original.recordedPhase='UNKNOWN';f.original.nativeAttempt={settlement:{reason:'Lost original reply'}};throw Error('Lost original reply');};await assert.rejects(saveSourceProposal(f.host,f.c,{workId:'W',proposalId:'P'}),/original-operation.*source changed at notice/);assert.equal(f.closed,1);});
