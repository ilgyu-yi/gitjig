import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {world} from './integration-lineage-renewal-worker.mjs';
export const caseNames=[];
function test(name,body){caseNames.push(name);if(process.env.GITJIG_CONTEXT_ASSIGNMENT_CASE===name)nodeTest(name,body);}
const plain=value=>JSON.parse(JSON.stringify(value));
const ledger=s=>JSON.stringify(Object.fromEntries(['works','sources','runs','budgets','conversation_state','conversation_inputs','conversation_assignments','conversation_dependencies','effect_operations'].map(table=>[table,s.all('SELECT * FROM '+table)])));

async function fixture(t){
    const f=await world(t),c=f.c,s=f.s,root=c.inspectConversation(f.cid);
    const clone=await c.forkConversation({conversationId:f.cid,expectedGeneration:root.generation,expectedModelRevision:c.getConversationModelChoice(f.cid).revision,kind:'clone'});
    f.setModelConversation(clone.conversationId);
    const turn=async text=>{const v=c.inspectConversation(clone.conversationId);await c.queueConversationInput({conversationId:clone.conversationId,expectedGeneration:v.generation,text,mode:'idle'});return c.runConversation({conversationId:clone.conversationId,model:f.model});};
    const seeded=await turn('Original clone coordinator dialogue');assert.equal(seeded.status,'delivered');
    const core=c.changeCore,drive=core.drive;let drives=0,assigned,phase=0;
    core.drive=async input=>{drives++;return core.inspect(input.workId);};t.after(()=>{core.drive=drive;});
    // Actual SDK assign/wait, source capture and task admission. Stop before any
    // governed model/engine; there is no fabricated COMPLETE or review-ready result.
    f.setAction(context=>{if(phase++===0)return{tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Original inherited governed request',operation:'change',resultDependency:true}}};assigned=receipt(context,'conversation_assign');return{tool:{name:'conversation_wait',arguments:{resultHandles:[assigned.assignmentId]}}};});
    const waiting=await turn('Delegate and wait for the original inherited task');assert.equal(waiting.status,'waiting');await c.ordinaryCore.drain();
    const original={assignment:plain(s.one('SELECT * FROM conversation_assignments WHERE id=?',assigned.assignmentId)),work:plain(s.one('SELECT * FROM works WHERE id=?',seeded.workId)),view:plain(s.one('SELECT * FROM conversation_state WHERE conversation=?',clone.conversationId)),budgets:plain(s.all('SELECT * FROM budgets'))};
    original.child=plain(s.one('SELECT * FROM works WHERE id=?',original.assignment.work));
    assert.ok(original.assignment.work);assert.equal(drives,1);
    await c.cancelWork({workId:seeded.workId});await f.recover();
    const request=()=>({workId:seeded.workId,expectedContext:c.inspectContextWorkRecovery(seeded.workId).fingerprint,reason:'Recover exactly this original cancelled coordinator wait'});
    const recover=()=>c.recoverContextWorkAdmission(request(),()=>{});
    return {...f,cid:clone.conversationId,wid:seeded.workId,rootCid:f.cid,rootWid:f.wid,original,assigned,turn,request,recover,drives:()=>drives};
}
const receipt=(context,name)=>{const result=context.messages.filter(m=>m.role==='toolResult'&&m.toolName===name).at(-1);assert.ok(result,'Actual SDK result '+name);const text=result.content.filter(p=>p.type==='text').map(p=>p.text).join('');try{return JSON.parse(text);}catch{return{error:text,isError:result.isError};}};

test('same-original cancelled context wait recovery only restores coordinator admission and preserves its original child',async t=>{
    const f=await fixture(t),s=f.s,context=f.c.inspectContextWorkRecovery(f.wid);assert.equal(context.eligible,true,JSON.stringify(context.holds));
    const before={assignment:plain(s.one('SELECT * FROM conversation_assignments WHERE id=?',f.assigned.assignmentId)),child:plain(s.one('SELECT * FROM works WHERE id=?',f.original.assignment.work)),dependencies:plain(s.all('SELECT * FROM conversation_dependencies')),budgets:plain(s.all('SELECT * FROM budgets')),runs:plain(s.all('SELECT * FROM runs'))};
    const result=await f.recover();assert.equal(result.withdrawCancelledWait,true);assert.equal(f.drives(),1);
    assert.deepEqual(plain(s.one('SELECT * FROM conversation_assignments WHERE id=?',f.assigned.assignmentId)),before.assignment);assert.deepEqual(plain(s.one('SELECT * FROM works WHERE id=?',f.original.assignment.work)),before.child);assert.deepEqual(plain(s.all('SELECT * FROM conversation_dependencies')),before.dependencies);assert.deepEqual(plain(s.all('SELECT * FROM budgets')),before.budgets);assert.deepEqual(plain(s.all('SELECT * FROM runs')),before.runs);
    const view=f.c.inspectConversation(f.cid),state=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data);assert.equal(view.state,'IDLE');assert.equal(Object.hasOwn(state,'waitHandles'),false);assert.equal(Object.hasOwn(state,'continuationAuthorized'),false);assert.equal(Object.hasOwn(state,'sourceIdentity'),false);
    const event=JSON.parse(s.one('SELECT raw FROM sources WHERE id=?',result.sourceId).raw);assert.equal(event.cancelledWait.assignmentId,f.assigned.assignmentId);assert.equal(event.cancelledWait.workId,f.original.assignment.work);assert.deepEqual(JSON.parse(event.cancelledWait.previousScheduler.data),JSON.parse(f.original.view.data));assert.equal(event.cancelledWait.previousScheduler.resource,'WAITING');assert.equal(s.one('SELECT COUNT(*) n FROM effect_operations').n,0);f.pass();
});

test('unscoped internal cancellation cannot stand in for explicit owner cancellation; reaffirmation keeps the original epoch and budget',async t=>{
    const f=await fixture(t),s=f.s,before=s.one('SELECT epoch FROM works WHERE id=?',f.wid).epoch,budgets=plain(s.all('SELECT * FROM budgets'));
    await f.c.cancelHandle({workId:f.wid});
    assert.equal(f.c.inspectContextWorkRecovery(f.wid).eligible,false);const denied=ledger(s);await assert.rejects(f.recover(),/changed or is held/);assert.equal(ledger(s),denied);
    await f.c.cancelWork({workId:f.wid});const row=s.one('SELECT origin FROM sources WHERE id=json_extract((SELECT data FROM conversation_assignments WHERE id=?),\'$.cancellationSource\')',f.assigned.assignmentId),origin=JSON.parse(row.origin);
    assert.deepEqual(origin.requestedWork,{version:1,id:f.wid,sourceId:s.one('SELECT source FROM works WHERE id=?',f.wid).source,fromEpoch:before,toEpoch:before,fromState:'CANCELLED',toState:'CANCELLED'});assert.deepEqual(plain(s.all('SELECT * FROM budgets')),budgets);assert.equal(f.c.inspectContextWorkRecovery(f.wid).eligible,true);await f.recover();f.pass();
});

async function restoreTask(f){
    await f.recover();let phase=0,observed,recovered;
    f.setAction(context=>{if(phase++===0)return{tool:{name:'conversation_status',arguments:{conversationId:f.original.assignment.target}}};if(phase===2){observed=receipt(context,'conversation_status');return{tool:{name:'conversation_recover_assignment',arguments:{assignmentId:f.assigned.assignmentId,expectedWorkEpoch:observed.workEpoch,observedDirectionRevision:observed.directionRevision,reason:'Restore this same inherited task, no replacement'}}};}recovered=receipt(context,'conversation_recover_assignment');return{text:'Original coordinator received recovery result'};});
    const result=await f.turn('Explicit owner request to recover the same original assigned task');assert.equal(result.status,'delivered');assert.equal(recovered.state,'RECOVERY_READY',recovered.error);assert.equal(recovered.assignmentId,f.assigned.assignmentId);assert.equal(f.drives(),1);
    return recovered;
}

test('an actual current clone coordinator recovers and explicitly reenters the same original inherited task',async t=>{
    const f=await fixture(t),recovered=await restoreTask(f);
    const task=f.s.one('SELECT * FROM works WHERE id=?',f.original.assignment.work);assert.equal(task.state,'ACTIVE');assert.equal(task.source,f.original.child.source);assert.deepEqual(JSON.parse(task.data).invocation,JSON.parse(f.original.child.data).invocation);assert.deepEqual(JSON.parse(task.data).contextOrigin,JSON.parse(f.original.child.data).contextOrigin);
    let phase=0,reentry;f.setAction(context=>{if(phase++===0)return{tool:{name:'conversation_status',arguments:{conversationId:f.original.assignment.target}}};if(phase===2)return{tool:{name:'conversation_assign',arguments:{conversationId:f.original.assignment.target,observedDirectionRevision:receipt(context,'conversation_status').directionRevision,projectId:'P',instructions:'Original inherited governed request',operation:'change'}}};reentry=receipt(context,'conversation_assign');return{text:'Original reentry queued'};});
    assert.equal((await f.turn('Explicit separate reentry of the same original inherited task')).status,'delivered');assert.equal(reentry.accepted,true,JSON.stringify(reentry));await f.c.ordinaryCore.drain();assert.equal(f.drives(),2);assert.equal(f.s.one('SELECT COUNT(*) n FROM conversation_assignments').n,1);assert.equal(f.s.one('SELECT work FROM conversation_assignments WHERE id=?',f.assigned.assignmentId).work,task.id);f.pass();
});

test('inherited authority ignores large progress but rejects changed original native, cancellation and archived wait operands',async t=>{
    const f=await fixture(t);await restoreTask(f);const s=f.s,id=f.assigned.assignmentId;
    const {effectiveAssignmentAuthority}=await import('../../dist/controller/assignment-authority.js');
    const {validatedContextOrigin}=await import('../../dist/controller/context-origin.js');
    const assignment=s.one('SELECT data,state FROM conversation_assignments WHERE id=?',id),data=JSON.parse(assignment.data),source=data.source;
    s.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?','COMPLETE',JSON.stringify({...data,result:{fixture:'CONTROLLED_LARGE_RESULT',text:'x'.repeat(131072)}}),id);
    const large=ledger(s);assert.equal(effectiveAssignmentAuthority(s,id,true).workId,f.wid);assert.deepEqual(validatedContextOrigin(s,f.original.assignment.target),JSON.parse(f.original.child.data).contextOrigin);assert.equal(ledger(s),large);
    s.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?',assignment.state,assignment.data,id);
    const contextEvent=s.one("SELECT json_extract(data,'$.contextAdmissionRecoverySource') AS id FROM works WHERE id=?",f.wid).id;
    const edits=[
        ['runs','generation',source.generation+1,source.runId],
        ['runs','epoch',999,source.runId],
        ['runs','data',null,source.runId,'attainedNative',false],
        ['conversation_inputs','state','QUEUED',source.initialInputId],
        ['sources','origin',null,data.cancellationSource,'requestedWork.id','FOREIGN_COORDINATOR'],
        ['sources','origin',null,data.cancellationSource,'requestedWork.toEpoch',999],
        ['sources','origin',null,data.cancellationSource,'uid',-1],
        ['sources','raw',null,contextEvent,'cancelledWait.childEpoch',999],
        ['sources','raw',null,contextEvent,'cancelledWait.proof','FOREIGN_PROOF'],
        ['sources','raw',null,contextEvent,'cancelledWait.previousScheduler.resource','IDLE'],
        ['conversation_assignments','data',null,id,'authorityRecovery.sourceId','MISSING_EVENT'],
    ];
    for(const [table,column,value,key,path,replacement]of edits){
        const old=s.one(`SELECT ${column} AS value FROM ${table} WHERE id=?`,key).value;
        let changed=value;if(path){const object=JSON.parse(old),parts=path.split('.');let parent=object;for(const part of parts.slice(0,-1))parent=parent[part];parent[parts.at(-1)]=replacement;changed=JSON.stringify(object);}
        s.run(`UPDATE ${table} SET ${column}=? WHERE id=?`,changed,key);const before=ledger(s);
        try{assert.throws(()=>effectiveAssignmentAuthority(s,id,true),undefined,table+'.'+(path??column));assert.throws(()=>validatedContextOrigin(s,f.original.assignment.target));assert.equal(ledger(s),before);}finally{s.run(`UPDATE ${table} SET ${column}=? WHERE id=?`,old,key);}
    }
    assert.equal(effectiveAssignmentAuthority(s,id,true).workId,f.wid);assert.equal(s.one('SELECT COUNT(*) n FROM effect_operations').n,0);f.pass();
});

for(const ancestor of ['coordinator','root'])test('later '+ancestor+' cancellation invalidates restored inherited authority without launching its child',async t=>{
    const f=await fixture(t);await restoreTask(f);const {effectiveAssignmentAuthority}=await import('../../dist/controller/assignment-authority.js'),{validatedContextOrigin,contextAuthoritySnapshot}=await import('../../dist/controller/context-origin.js');
    assert.ok(contextAuthoritySnapshot(f.s,[f.original.child.id]));await f.c.cancelWork({workId:ancestor==='coordinator'?f.wid:f.rootWid});const before=ledger(f.s);
    assert.throws(()=>effectiveAssignmentAuthority(f.s,f.assigned.assignmentId,true));assert.throws(()=>validatedContextOrigin(f.s,f.original.assignment.target));assert.throws(()=>contextAuthoritySnapshot(f.s,[f.original.child.id]));assert.equal(ledger(f.s),before);assert.equal(f.drives(),1);assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_operations').n,0);f.pass();
});

test('an actual different clone under the same owner root cannot recover the original inherited task',async t=>{
    const f=await fixture(t);await f.recover();const v=f.c.inspectConversation(f.rootCid),foreign=await f.c.forkConversation({conversationId:f.rootCid,expectedGeneration:v.generation,expectedModelRevision:f.c.getConversationModelChoice(f.rootCid).revision,kind:'clone'});
    const originals=()=>plain({assignment:f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.assigned.assignmentId),child:f.s.one('SELECT * FROM works WHERE id=?',f.original.child.id),dependencies:f.s.all('SELECT * FROM conversation_dependencies'),budgets:f.s.all('SELECT * FROM budgets WHERE lineage=?',f.original.child.lineage)}),before=originals();let phase=0,denied;
    f.setModelConversation(foreign.conversationId);f.setAction(context=>{if(phase++===0)return{tool:{name:'conversation_recover_assignment',arguments:{assignmentId:f.assigned.assignmentId,expectedWorkEpoch:before.child.epoch,observedDirectionRevision:f.c.inspectConversation(f.original.assignment.target).directionRevision,reason:'Foreign clone must be refused'}}};denied=receipt(context,'conversation_recover_assignment');return{text:'Foreign recovery refused'};});
    await f.c.queueConversationInput({conversationId:foreign.conversationId,expectedGeneration:foreign.generation,text:'Try recovering another coordinator original task',mode:'idle'});assert.equal((await f.c.runConversation({conversationId:foreign.conversationId,model:f.model})).status,'delivered');assert.equal(denied.isError,true);assert.match(denied.error,/same original owner coordinator/);assert.deepEqual(originals(),before);assert.equal(f.drives(),1);assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_operations').n,0);f.pass();
});
