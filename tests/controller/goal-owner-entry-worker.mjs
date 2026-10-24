import nodeTest from 'node:test';
export const caseNames=[];
function test(name,body){caseNames.push(name);if(process.env.GITJIG_GOAL_OWNER_CASE===name)nodeTest(name,body);}
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {world} from './integration-lineage-renewal-worker.mjs';

// Uses the real SDK and original admission transaction. The fixture's older
// ordinary work belongs to a different conversation and supplies no goal authority.
const definition = {objective:'Preserve the accepted original goal',criteria:['Explicit owner entry retains its finite target authority']};
function fresh(f, acceptedDefinition=definition) {
    const cid=f.c.createConversation().conversationId;
    f.setModelConversation(cid);
    let calls=0;
    f.setAction(()=>++calls===1?{tool:{name:'goal_progress',arguments:{disposition:'need-owner',plan:'Retain original entry',nextAction:'Await the owner',reason:'Bounded fixture stopping point',resultIds:[]}}}:{text:'Original owner input retained'});
    return f.c.createGoal({conversationId:cid,...acceptedDefinition,turnLimit:4});
}
const pending=(f,g)=>f.c.pendingGoalInput(g.goalId);
const row=(f,g)=>f.s.one('SELECT * FROM goals WHERE id=?',g.goalId);
const input=(f,id)=>f.s.one('SELECT * FROM conversation_inputs WHERE id=?',id);

test('fresh goal creation is pure and actual owner admission captures the original finite profile',async t=>{
    const f=await world(t),g=fresh(f),before=f.calls();
    assert.equal(pending(f,g).length,0);assert.equal(g.startedAttempts,0);
    f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model});
    const queued=pending(f,g);assert.equal(queued.length,1);
    const original=input(f,queued[0].inputId),source=f.s.one('SELECT * FROM sources WHERE id=?',original.source);
    assert.equal(JSON.parse(source.origin).kind,'owner-conversation-input');
    assert.deepEqual(JSON.parse(source.raw),{goalId:g.goalId,goalRevision:g.revision,uid:process.getuid?.(),...definition});
    assert.equal(f.calls(),before,'queue/start does not synchronously dispatch a model');
    const done=await f.c.waitGoal(g.goalId);assert.equal(done.state,'WAITING_INPUT',done.reason);assert.equal(done.startedAttempts,1);
    const view=f.c.inspectConversation(g.conversationId),work=f.s.one('SELECT * FROM works WHERE id=?',view.workId),activation=JSON.parse(work.data).ownerRootActivation;
    assert.equal(activation.state,'COMPLETE');assert.equal(activation.fingerprint,JSON.parse(original.data).ownerGoalStart.activation.fingerprint);
    const grants=f.s.all('SELECT * FROM effect_delegations WHERE root=?',view.workId);assert.equal(grants.length,1);assert.equal(grants[0].target,f.target);assert.equal(JSON.parse(grants[0].data).operationLimit,3);
    assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_operations').n,0);f.pass();
});

test('failure inside first owner start rolls back input/source/direction and goal state atomically',async t=>{
    const f=await world(t),g=fresh(f),originalRun=f.s.run.bind(f.s),before=row(f,g),view=f.c.inspectConversation(g.conversationId),sources=f.s.one('SELECT COUNT(*) n FROM sources').n,calls=f.calls();
    const notifications=[],offGoal=f.c.goalCore.subscribe(()=>notifications.push({kind:'goal',inTransaction:f.s.db.isTransaction})),offInteraction=f.c.subscribeInteraction(event=>{if(event.conversationId===g.conversationId)notifications.push({kind:event.type,inTransaction:f.s.db.isTransaction});});
    f.s.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO goal_events')&&args[2]==='owner-resume')throw Error('Injected goal start commit fault');return originalRun(sql,...args);};
    try{assert.throws(()=>f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model}),/Injected goal start/);}finally{f.s.run=originalRun;}
    assert.deepEqual(notifications,[],'Failed owner start cannot publish rolled-back state');
    assert.deepEqual(row(f,g),before);assert.equal(pending(f,g).length,0);assert.equal(f.s.one('SELECT COUNT(*) n FROM sources').n,sources);assert.equal(f.c.inspectConversation(g.conversationId).directionRevision,view.directionRevision);assert.equal(f.calls(),calls);
    f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model});assert.ok(notifications.length);assert.ok(notifications.every(event=>event.inTransaction===false),'Committed start notifications occur outside the transaction');offGoal();offInteraction();const done=await f.c.waitGoal(g.goalId);assert.equal(done.state,'WAITING_INPUT',done.reason);assert.equal(done.startedAttempts,1);f.pass();
});

test('failed activation pins the original input/profile and explicit retry cannot substitute changed startup authority',async t=>{
    const f=await world(t),g=fresh(f),activate=f.c.effects.activateOwnerRoot.bind(f.c.effects),profile=f.c.effects.ownerRootProfile.bind(f.c.effects),calls=f.calls();
    f.c.effects.activateOwnerRoot=()=>{throw Error('Injected first activation fault');};
    f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model});let done=await f.c.waitGoal(g.goalId);assert.equal(done.startedAttempts,0);
    const original=input(f,pending(f,g)[0].inputId),saved=JSON.parse(original.data).ownerGoalStart;
    assert.equal(f.c.inspectConversation(g.conversationId).workId,null);assert.equal(f.calls(),calls);
    f.c.effects.activateOwnerRoot=activate;f.c.effects.ownerRootProfile=()=>({...profile(),integrations:[]});
    assert.throws(()=>f.c.startGoal({goalId:g.goalId,expectedRevision:done.revision,model:f.model}),/Explicit --input/);
    f.c.startGoal({goalId:g.goalId,expectedRevision:done.revision,reconcileInputId:original.id,model:f.model});done=await f.c.waitGoal(g.goalId);
    assert.equal(done.startedAttempts,0);assert.match(done.reason,/differs from the original captured profile/);assert.equal(f.c.inspectConversation(g.conversationId).workId,null);assert.equal(f.calls(),calls);assert.deepEqual(input(f,original.id),original);
    f.c.effects.ownerRootProfile=profile;f.c.startGoal({goalId:g.goalId,expectedRevision:done.revision,reconcileInputId:original.id,model:f.model});done=await f.c.waitGoal(g.goalId);
    assert.equal(done.state,'WAITING_INPUT',done.reason);assert.equal(done.startedAttempts,1);assert.equal(f.s.one('SELECT COUNT(*) n FROM conversation_inputs WHERE conversation=?',g.conversationId).n,1);
    assert.equal(JSON.parse(input(f,original.id).data).ownerGoalStart.activation.fingerprint,saved.activation.fingerprint);f.pass();
});

for(const action of ['pause','revise','cancel'])test(`explicit ${action} before first admission preserves or withdraws only the original owner goal input`,async t=>{
    const f=await world(t),g=fresh(f),before=f.calls();
    f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model});const active=f.c.inspectGoal(g.goalId),original=input(f,pending(f,g)[0].inputId),source=f.s.one('SELECT * FROM sources WHERE id=?',original.source);
    if(action==='revise')f.c.reviseGoal({goalId:g.goalId,expectedRevision:active.revision,objective:'Revised accepted goal',criteria:['New explicit criterion'],reason:'Owner changes the accepted definition'});
    else await f.c.pauseGoal({goalId:g.goalId,expectedRevision:active.revision,reason:'Owner decides before first admission',cancel:action==='cancel'});
    await f.c.waitGoal(g.goalId);const stopped=f.c.inspectGoal(g.goalId);
    assert.equal(stopped.startedAttempts,0);assert.equal(f.calls(),before);assert.equal(f.c.inspectConversation(g.conversationId).workId,null);assert.deepEqual(f.s.one('SELECT * FROM sources WHERE id=?',original.source),source);
    if(action==='pause'){
        assert.deepEqual(input(f,original.id),original);f.c.startGoal({goalId:g.goalId,expectedRevision:stopped.revision,reconcileInputId:original.id,model:f.model});assert.equal((await f.c.waitGoal(g.goalId)).startedAttempts,1);
    }else{
        const withdrawn=input(f,original.id);assert.equal(withdrawn.state,'CONFLICTED');assert.deepEqual(JSON.parse(withdrawn.data).ownerGoalStart,JSON.parse(original.data).ownerGoalStart);assert.equal(pending(f,g).length,0);
        if(action==='revise'){f.c.startGoal({goalId:g.goalId,expectedRevision:stopped.revision,model:f.model});const next=input(f,pending(f,g)[0].inputId);assert.notEqual(next.id,original.id);assert.equal(JSON.parse(f.s.one('SELECT raw FROM sources WHERE id=?',next.source).raw).objective,'Revised accepted goal');assert.equal((await f.c.waitGoal(g.goalId)).startedAttempts,1);}
    }
    f.pass();
});

for(const changed of ['missing receipt','foreign input receipt','raw definition'])test(`captured first goal holds ${changed} without falling back to a new grant profile`,async t=>{
    const f=await world(t),g=fresh(f),activate=f.c.effects.activateOwnerRoot.bind(f.c.effects),profile=f.c.effects.ownerRootProfile.bind(f.c.effects),calls=f.calls();
    f.c.effects.activateOwnerRoot=()=>{throw Error('Original admission fault');};
    f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model});const done=await f.c.waitGoal(g.goalId),original=input(f,pending(f,g)[0].inputId),data=JSON.parse(original.data);
    f.c.effects.activateOwnerRoot=activate;f.c.effects.ownerRootProfile=()=>({...profile(),integrations:[]});
    if(changed==='missing receipt')f.s.run("UPDATE conversation_inputs SET data='{}' WHERE id=?",original.id);
    else if(changed==='foreign input receipt'){data.ownerGoalStart.inputId=f.cid;f.s.run('UPDATE conversation_inputs SET data=? WHERE id=?',JSON.stringify(data),original.id);}
    else f.s.run("UPDATE sources SET raw=raw||' changed' WHERE id=?",original.source);
    const before=JSON.stringify(f.s.all('SELECT * FROM effect_delegations ORDER BY rowid'));
    assert.throws(()=>f.c.startGoal({goalId:g.goalId,expectedRevision:done.revision,reconcileInputId:original.id,model:f.model}),/receipt is missing|correspondence changed|definition or captured start decision changed/);
    assert.equal(f.c.inspectGoal(g.goalId).startedAttempts,0);assert.equal(f.calls(),calls);assert.equal(f.c.inspectConversation(g.conversationId).workId,null);assert.equal(JSON.stringify(f.s.all('SELECT * FROM effect_delegations ORDER BY rowid')),before);f.pass();
});

for(const action of ['revise','cancel'])test(`failed ${action} withdrawal publishes no uncommitted state`,async t=>{
    const f=await world(t),g=fresh(f),activate=f.c.effects.activateOwnerRoot.bind(f.c.effects);
    f.c.effects.activateOwnerRoot=()=>{throw Error('Original admission fault');};f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model});let done=await f.c.waitGoal(g.goalId);f.c.effects.activateOwnerRoot=activate;
    const before=row(f,g),original=input(f,pending(f,g)[0].inputId),run=f.s.run.bind(f.s);let notifications=0;const unsubscribe=f.c.goalCore.subscribe(()=>notifications++);
    f.s.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO goal_events')&&args[2]===(action==='revise'?'owner-definition':'owner-stop'))throw Error('Injected final owner event fault');return run(sql,...args);};
    try{if(action==='revise')assert.throws(()=>f.c.reviseGoal({goalId:g.goalId,expectedRevision:done.revision,objective:'New definition',criteria:['New criteria'],reason:'Owner revises'}),/Injected final/);else await assert.rejects(f.c.pauseGoal({goalId:g.goalId,expectedRevision:done.revision,reason:'Owner cancels',cancel:true}),/Injected final/);}finally{f.s.run=run;unsubscribe();}
    assert.equal(notifications,0);assert.deepEqual(row(f,g),before);assert.deepEqual(input(f,original.id),original);f.pass();
});

test('throwing goal presentation observer cannot suppress a committed first start',async t=>{
    const f=await world(t),g=fresh(f),unsubscribe=f.c.goalCore.subscribe(()=>{throw Error('Presentation only');});
    try{f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model});const done=await f.c.waitGoal(g.goalId);assert.equal(done.state,'WAITING_INPUT',done.reason);assert.equal(done.startedAttempts,1);}finally{unsubscribe();}f.pass();
});

test('ordinary captured context larger than the goal receipt bound retains its original reader admission',async t=>{
    const f=await world(t);fresh(f);const source=f.c.listProjects().find(project=>project.projectId==='P'||project.id==='P').sourceRoot;
    const name='context-'+ 'x'.repeat(160)+'.txt';await fs.writeFile(path.join(source,name),'Captured file');const cid=f.c.createConversation({projectId:'P'}).conversationId,text=Array(512).fill('@'+name).join(' ');
    const receipt=await f.c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:0,text,mode:'idle'}),original=input(f,receipt.inputId);
    assert.ok(Buffer.byteLength(original.data)>65536);assert.equal(f.c.goalCore.ownerRootProfileForInput(receipt.inputId),undefined);assert.deepEqual(input(f,receipt.inputId),original);f.pass();
});

test('largest accepted escaped owner definition remains usable without widening the goal receipt bound',async t=>{
 const f=await world(t),accepted={objective:'"'.repeat(8192),criteria:Array(16).fill('"'.repeat(2048))},g=fresh(f,accepted);
 f.c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model:f.model});const original=input(f,pending(f,g)[0].inputId),source=f.s.one('SELECT raw FROM sources WHERE id=?',original.source);
 assert.ok(Buffer.byteLength(source.raw)>65536);assert.ok(Buffer.byteLength(original.data)<=65536);assert.deepEqual(JSON.parse(source.raw).criteria,accepted.criteria);
 const done=await f.c.waitGoal(g.goalId);assert.equal(done.state,'WAITING_INPUT',done.reason);assert.equal(done.startedAttempts,1);f.pass();
});
