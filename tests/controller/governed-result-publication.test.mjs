import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { structuredAssignmentWorld } from './structured-assignment-fixture.mjs';
import { prepareGovernedResult, readGovernedDetail } from '../../dist/controller/governed-result.js';
import { inspectConversationResultDetail } from '../../dist/controller/conversation-results.js';

const hash = value => createHash('sha256').update(value).digest('hex');
async function archiveEntered(ready,pending){let timer;try{await Promise.race([ready,pending.then(()=>{throw Error('Dispatch settled before archive gate');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Archive gate was not reached within10seconds')),10000);})]);}finally{clearTimeout(timer);}}
function rich(result) {return {...result, launches:Array.from({length:12},(_,i)=>({id:'retained-'+i,data:{planProposal:'History '+i+' '+'x'.repeat(20000)}})),versions:[],checks:[],occurrences:[],dispositions:[],blocked:['Inspect the original retained procedure'],nextAction:'Explicit original-task continuation'};}

test('original governed dispatch publishes compact inline outcome and exact immutable rich detail', async t => {
    const f=await structuredAssignmentWorld(t);let original;
    f.onGoverned((child,result)=>{Object.assign(result,rich(result));original=JSON.parse(JSON.stringify({...result,state:'ACTIVE',selectedEvidence:{selectionIdsDigest:hash(JSON.stringify({})),sourceImpactsDigest:hash(JSON.stringify(f.c.interactions.impacts(child.workId))),checkIds:[],reviewLaunchIds:[]}}));});
    await f.assign();
    const assignment=f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId),data=JSON.parse(assignment.data),pub=f.c.inspectConversationResult(data.resultId);
    assert.notEqual(f.c.inspectConversation(f.child.conversationId).generation,f.c.store.one('SELECT generation FROM works WHERE id=?',f.child.workId).generation,'Conversation/work counters are distinct authority domains');
    assert.equal(assignment.state,'COMPLETE');assert.ok(Buffer.byteLength(JSON.stringify(original))>128*1024);
    assert.equal(data.result.kind,'governed-work-observation/v1');assert.ok(Buffer.byteLength(assignment.data)<64*1024);
    assert.equal(data.result.detailRef.sha256,hash(JSON.stringify(original)));assert.deepEqual(pub.result,data.result);
    assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',assignment.id).state,'RESOLVED');
    const bytes=await readGovernedDetail(f.home,data.result.detailRef);assert.deepEqual(JSON.parse(bytes),original);
    // A later ledger/body change cannot replace the historical snapshot.
    original.launches[0].data.planProposal='Newer unrelated observation';
    assert.notDeepEqual(JSON.parse(await readGovernedDetail(f.home,data.result.detailRef)),original);
    let cursor=0,text='';do{const page=await inspectConversationResultDetail(f.c.store,f.home,{resultId:data.resultId,cursor,fingerprint:data.result.detailRef.sha256});assert.ok(Buffer.byteLength(JSON.stringify(page))<=8192);text+=page.text;cursor=page.nextCursor;}while(cursor!==null);
    assert.equal(hash(text),data.result.detailRef.sha256);f.pass();
});

test('original dispatch refuses stale epoch before archive/publication and preserves pending edge',async t=>{
    const f=await structuredAssignmentWorld(t);f.onGoverned((_child,result)=>{result.epoch++;});await f.assign();
    const a=f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId);assert.equal(a.state,'UNAVAILABLE');
    assert.equal(f.c.store.one('SELECT id FROM conversation_results WHERE work=?',f.child.workId),undefined);
    assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',a.id).state,'PENDING');f.pass();
});

test('actual owner steering during the owned archive await invalidates old readiness without publishing or resolving',async t=>{
    const f=await structuredAssignmentWorld(t),open=fs.open;let release,entered;
    const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
    fs.open=async(...args)=>{const handle=await open(...args);if(String(args[0]).startsWith(path.join(f.home,'artifacts','.governed-detail-'))){entered();await held;}return handle;};
    try{
        const pending=f.assign();await archiveEntered(ready,pending);
        const before=f.c.inspectConversation(f.child.conversationId);
        await f.c.queueConversationInput({conversationId:f.child.conversationId,expectedGeneration:before.generation,text:'New original owner condition requiring independent source fit',mode:'steer'});
        assert.ok(f.c.inspectConversation(f.child.conversationId).directionRevision>before.directionRevision);
        release();await pending;
        const a=f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId);assert.equal(a.state,'UNAVAILABLE');
        assert.equal(f.c.store.one('SELECT id FROM conversation_results WHERE work=?',f.child.workId),undefined);
        assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',a.id).state,'PENDING');
        assert.ok(!(await fs.readdir(path.join(f.home,'artifacts'))).some(name=>name.startsWith('.governed-detail-')),'Owner steering joins and removes the original private temporary file');f.pass();
    }finally{release();fs.open=open;}
});

test('reply-language and notice presentation updates during archive do not invalidate governed evidence',async t=>{
    const f=await structuredAssignmentWorld(t),open=fs.open;let release,entered;
    const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
    fs.open=async(...args)=>{const handle=await open(...args);if(String(args[0]).startsWith(path.join(f.home,'artifacts','.governed-detail-'))){entered();await held;}return handle;};
    try{
        const pending=f.assign();await archiveEntered(ready,pending);const view=f.c.inspectConversation(f.child.conversationId),language=f.c.getConversationLanguage(view.conversationId);
        f.c.setConversationLanguage({conversationId:view.conversationId,expectedGeneration:view.generation,expectedRevision:language.revision,replyLanguage:'ko'});
        // Controlled original presentation metadata, not producer/source identity.
        f.c.store.run("UPDATE conversation_state SET data=json_set(data,'$.noticeDeliveryCursor',7,'$.noticeDeliveryStatus',json(?)) WHERE conversation=?",JSON.stringify({state:'inspected'}),view.conversationId);
        release();await pending;const a=f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId);assert.equal(a.state,'COMPLETE');assert.ok(JSON.parse(a.data).resultId);assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',a.id).state,'RESOLVED');f.pass();
    }finally{release();fs.open=open;}
});

test('detail snapshot freezes before await, refuses corruption/symlink and does not create a missing artifact root',async t=>{
    const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-detail-storage-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
    const root=path.join(home,'artifacts');await fs.mkdir(root,{mode:0o700});
    const value=rich({workId:'original',epoch:1,phase:'BLOCKED',reviewReady:false});const frozen=JSON.stringify(value),pending=prepareGovernedResult(home,value,()=>{});value.launches=[];
    const compact=await pending;assert.equal((await readGovernedDetail(home,compact.detailRef)).toString(),frozen);
    const file=path.join(root,'governed-detail-'+compact.detailRef.sha256+'.json');await fs.writeFile(file,'x'.repeat(compact.detailRef.bytes));await assert.rejects(readGovernedDetail(home,compact.detailRef),/content changed/);
    await fs.unlink(file);const other=path.join(home,'other');await fs.writeFile(other,frozen,{mode:0o600});await fs.symlink(other,file);await assert.rejects(readGovernedDetail(home,compact.detailRef));
    await fs.unlink(file);await promisify(execFile)('/usr/bin/mkfifo',[file],{timeout:2000});
    // A regression to blocking FIFO open must fail finitely and join its exact owned process.
    const worker=`import {readGovernedDetail} from ${JSON.stringify(new URL('../../dist/controller/governed-result.js',import.meta.url).href)}; await readGovernedDetail(${JSON.stringify(home)},${JSON.stringify(compact.detailRef)});`;
    await assert.rejects(promisify(execFile)(process.execPath,['--input-type=module','-e',worker],{timeout:2000}),error=>{assert.equal(error.killed,false);assert.match(error.stderr,/identity unavailable/);return true;});
    await fs.unlink(file);await fs.rmdir(root);await assert.rejects(prepareGovernedResult(home,value,()=>{}));await assert.rejects(fs.stat(root));
});

test('detail failures and timeout guard never return a usable compact observation',async t=>{
    const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-detail-guard-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.mkdir(path.join(home,'artifacts'),{mode:0o700});
    await assert.rejects(prepareGovernedResult(home,{workId:'W',epoch:1,phase:'BLOCKED',reviewReady:false,history:'x'.repeat(16*1024*1024)},()=>{}),/16MiB/);
    let checks=0;await assert.rejects(prepareGovernedResult(home,rich({workId:'W',epoch:1,phase:'BLOCKED',reviewReady:false}),()=>{if(++checks===4)throw Error('Original source changed');}),/Original source changed/);
    const open=fs.open;let elapsed=0,closed=false;const clock=t.mock.method(performance,'now',()=>elapsed);
    fs.open=async(...args)=>{const handle=await open(...args),close=handle.close.bind(handle);handle.close=async()=>{await close();closed=true;};elapsed=6000;return handle;};
    try{await assert.rejects(prepareGovernedResult(home,rich({workId:'W',epoch:1,phase:'BLOCKED',reviewReady:false}),()=>{}),/IO budget exceeded/);assert.equal(closed,true,'The actual allocated file handle is joined before reporting elapsed-budget failure');}
    finally{fs.open=open;clock.mock.restore();}
    assert.ok(!(await fs.readdir(path.join(home,'artifacts'))).some(name=>name.startsWith('.governed-detail-')),'Source/budget failures leave no private temporary files');
});
