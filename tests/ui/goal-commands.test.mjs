// Real controller definitions and read-only menus; synthetic lifecycle states do not qualify a producer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {goalCommands} from '../../dist/ui/goal-commands.js';

async function world(t, state = 'READY', used = 0) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/goal-command-')));
    const c = await openController({installationHome:path.join(root,'home')});
    t.after(async () => {await c.close(); await fs.rm(root,{recursive:true,force:true});});
    const cid = c.createConversation().conversationId;
    const goal = c.createGoal({conversationId:cid, objective:'Preserve the owner objective 한국어', criteria:['Output is recoverable','Completion is independently checked'], turnLimit:4});
    const row = c.store.one('SELECT data FROM goals WHERE id=?',goal.goalId);
    c.store.run('UPDATE goals SET state=?,data=? WHERE id=?',state,JSON.stringify({...JSON.parse(row.data),startedAttempts:used}),goal.goalId);
    c.setDraft({conversationId:cid,expectedRevision:0,text:'Keep this unsent draft 한국어'});
    return {c,cid,goal};
}
function command(f, overrides = {}) {
    return goalCommands({controller:f.c,isCurrent:()=>true,choose:async()=>undefined,input:async()=>assert.fail('Inspection opened a form'),resolve:async()=>assert.fail('Inspection resolved a model'),notice(){},...overrides})[0];
}
const ledger = c => Object.fromEntries(['goals','goal_attempts','goal_events','conversation_inputs','works','runs'].map(table=>[table,c.store.all('SELECT * FROM '+table)]));

test('goal facts are readable inspection rather than selectable menu rows; returning preserves draft and execution', async t => {
    const f = await world(t), before = ledger(f.c), draft = f.c.inspectConversation(f.cid).draft;
    let calls = 0, body;
    const outcome = await command(f,{choose:async(title,rows)=>{
        assert.match(title,/Preserve the owner objective/);
        assert.ok(rows.includes('Start this goal'));
        assert.ok(!rows.some(row=>/^(Goal ·|State ·|Objective ·|Criterion |Turns ·|Plan ·|Next ·)/.test(row)));
        return ++calls === 1 ? 'Inspect goal and completion evidence' : 'Return without action';
    },show:async(_title,text)=>{body=text;}}).run('',f.cid);
    assert.equal(outcome,'cancelled');
    assert.match(body,/1\. Output is recoverable/);
    assert.match(body,/0\/4 admitted/);
    assert.match(body,/independent completion review/);
    assert.match(body,/Extending one does not extend the others/);
    assert.match(body,/Delegated work must be stopped separately using its own controls/);
    assert.deepEqual(ledger(f.c),before);
    assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
});

for (const state of ['ACTIVE','REVIEWING','WAITING_DEPENDENCY']) test(state+' offers pause/cancel and keeps runner-sensitive edits out of the menu', async t => {
    const f = await world(t,state,1);
    await command(f,{choose:async(_title,rows)=>{
        assert.ok(rows.includes('Pause continuation and the current goal turn'));
        assert.ok(rows.includes('Cancel goal coordination'));
        assert.ok(!rows.some(row=>/^(Start |Resume |Revise |Add goal)/.test(row)));
        return undefined;
    }}).run('',f.cid);
});
for (const state of ['COMPLETED','CANCELLED']) test(state+' retains inspection and a new-goal entry without ineligible owner controls',async t=>{
    const f=await world(t,state,2), before=ledger(f.c);
    await command(f,{work:async()=>assert.fail('Terminal menu opened work'),choose:async(_title,rows)=>{
        assert.deepEqual(rows,['Inspect goal and completion evidence','Create a new goal','Return without action']);
        return undefined;
    }}).run('',f.cid);
    assert.deepEqual(ledger(f.c),before);
});

test('exhausted goal adds its own turns without resetting consumed turns or starting execution',async t=>{
    const f=await world(t,'BUDGET_EXHAUSTED',4), draft=f.c.inspectConversation(f.cid).draft;
    const inputs=['2','Owner grants bounded further goal review'];
    const outcome=await command(f,{choose:async(_title,rows)=>{
        assert.ok(!rows.some(row=>/^(Start |Resume )/.test(row)));
        return rows.find(row=>row.startsWith('Add goal turns'));
    },input:async(title)=>{
        if(inputs.length===2) assert.match(title,/does not extend original work\/child budgets/);
        return inputs.shift();
    }}).run('',f.cid);
    const after=f.c.inspectGoal(f.goal.goalId);
    assert.equal(outcome,'completed');
    assert.equal(after.turnLimit,6); assert.equal(after.startedAttempts,4);
    assert.equal(after.state,'BUDGET_EXHAUSTED');
    assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM conversation_inputs').n,0);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

test('Back from scoped cancellation changes neither goal, execution nor draft',async t=>{
    const f=await world(t,'ACTIVE',1), before=ledger(f.c), draft=f.c.inspectConversation(f.cid).draft;
    let calls=0;
    const outcome=await command(f,{choose:async(title,rows)=>{
        if(++calls===1)return 'Cancel goal coordination';
        assert.match(title,/Delegated work remains separately managed/);
        assert.equal(rows[0],'Back without cancellation');
        return rows[0];
    }}).run('',f.cid);
    assert.equal(outcome,'cancelled'); assert.deepEqual(ledger(f.c),before);
    assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
});

test('explicit cancellation ends coordination without admitting any turn or changing the draft',async t=>{
    const f=await world(t,'ACTIVE',1), draft=f.c.inspectConversation(f.cid).draft;
    let calls=0;
    assert.equal(await command(f,{choose:async()=>++calls===1?'Cancel goal coordination':'End this goal coordination permanently'}).run('',f.cid),'completed');
    assert.equal(f.c.inspectGoal(f.goal.goalId).state,'CANCELLED');
    assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts,1);
    assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM conversation_inputs').n,0);
});

test('source and goal revisions are rechecked after readable inspection',async t=>{
    const f=await world(t);
    const before=f.c.inspectGoal(f.goal.goalId);
    await assert.rejects(command(f,{choose:async()=> 'Inspect goal and completion evidence',show:async()=>{
        f.c.reviseGoal({goalId:f.goal.goalId,expectedRevision:before.revision,objective:'New owner definition',criteria:['New criterion'],reason:'Independent revision while viewing'});
    }}).run('',f.cid),/Goal changed; reopen/);
    assert.equal(f.c.inspectGoal(f.goal.goalId).objective,'New owner definition');
    assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts,0);
});

test('changing state without a definition revision invalidates a previously displayed start action',async t=>{
    const f=await world(t);
    await assert.rejects(command(f,{choose:async()=>{
        f.c.store.run("UPDATE goals SET state='ACTIVE' WHERE id=?",f.goal.goalId);
        return 'Start this goal';
    }}).run('',f.cid),/Goal state changed/);
    assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts,0);
});

test('Korean goal actions and details use conversation locale without translating retained owner intent',async t=>{
    const f=await world(t), text=[];let calls=0;
    assert.equal(await command(f,{locale:()=> 'ko',choose:async(title,rows)=>{
        assert.match(title,/목표/);
        assert.ok(rows.includes('이 목표 시작'));
        return ++calls===1?'목표와 완료 근거 보기':'아무 작업 없이 돌아가기';
    },show:async(_title,body)=>text.push(body)}).run('',f.cid),'cancelled');
    assert.match(text[0],/Preserve the owner objective 한국어/);
    assert.match(text[0],/독립적인 완료 검토/);
});

test('cancelling explicit retained input reconciliation admits no goal turn and preserves pending input and draft',async t=>{
    const f=await world(t,'PAUSED',1);
    const receipt=await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:0,text:'Retained explicit owner input',mode:'idle'});
    const pending=f.c.pendingGoalInput(f.goal.goalId), before=ledger(f.c), draft=f.c.inspectConversation(f.cid).draft;
    assert.equal(pending.length,1); assert.equal(pending[0].inputId,receipt.inputId);
    let resolved=0;
    const outcome=await command(f,{resolve:async()=>{resolved++; return {applicationConversation:{version:1,choiceRevision:0}};},choose:async(title,rows)=>{
        if(title.startsWith('Goal ·'))return 'Resume this goal explicitly';
        assert.equal(title,'Explicitly reconcile retained goal input');
        assert.ok(rows[0].startsWith(receipt.inputId+' · '));
        return undefined;
    }}).run('',f.cid);
    assert.equal(outcome,'cancelled'); assert.equal(resolved,1);
    assert.deepEqual(ledger(f.c),before); assert.deepEqual(f.c.pendingGoalInput(f.goal.goalId),pending);
    assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
});

for(const change of ['selection','language'])test('readable inspection refuses stale '+change+' before opening another action',async t=>{
    const f=await world(t);let selected=true;
    await assert.rejects(command(f,{isCurrent:()=>selected,choose:async()=> 'Inspect goal and completion evidence',show:async()=>{
        if(change==='selection')selected=false;
        else f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:0,expectedRevision:f.c.getConversationLanguage(f.cid).revision,replyLanguage:'ko'});
    }}).run('',f.cid),/Goal source changed/);
    assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts,0);
});


for(const cancel of [false,true])test('invalid goal allowance preserves the staged definition through '+(cancel?'cancellation':'correction'),async t=>{
 const f=await world(t);f.cid=f.c.createConversation().conversationId;
 const before=ledger(f.c),values=['Keep the exact owner objective','Observe the unchanged acceptance outcome','1.5',cancel?undefined:'6'];
 const defaults=[],notices=[];
 const outcome=await command(f,{input:async(title,value)=>{defaults.push([title,value]);return values.shift();},choose:async()=> 'Use these criteria',notice:text=>notices.push(text)}).run('create',f.cid);
 assert.equal(outcome,cancel?'cancelled':'completed');
 assert.equal(defaults.at(-1)[1],'1.5');
 assert.ok(notices.some(text=>text.includes('whole number')));
 if(cancel){assert.deepEqual(ledger(f.c),before);assert.equal(f.c.conversationGoal(f.cid),null);}
 else{const goal=f.c.conversationGoal(f.cid);assert.equal(goal.objective,'Keep the exact owner objective');assert.deepEqual(goal.criteria,['Observe the unchanged acceptance outcome']);assert.equal(goal.turnLimit,6);assert.equal(goal.startedAttempts,0);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);}
});

test('goal extension corrects total overflow before asking for its reason',async t=>{
 const f=await world(t);f.c.extendGoal({goalId:f.goal.goalId,expectedRevision:f.goal.revision,units:995,reason:'Bounded owner allowance'});
 const values=['2','1','One final completion review'],defaults=[];
 const outcome=await command(f,{input:async(title,value)=>{defaults.push([title,value]);return values.shift();}}).run('extend',f.cid);
 assert.equal(outcome,'completed');assert.equal(defaults[1][1],'2');
 assert.equal(f.c.inspectGoal(f.goal.goalId).turnLimit,1000);
 assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts,0);
 await command(f,{choose:async(_title,rows)=>{assert.ok(!rows.some(row=>row.startsWith('Add goal turns')));return undefined;}}).run('',f.cid);
 await assert.rejects(command(f,{input:async()=>assert.fail('Maximum allowance must not open an input')}).run('extend',f.cid),/maximum turn allowance/);
});

test('goal change during invalid allowance correction refuses before another form or write',async t=>{
 const f=await world(t);let calls=0;
 await assert.rejects(command(f,{input:async()=>{
  if(++calls===1)return '1.5';
  f.c.extendGoal({goalId:f.goal.goalId,expectedRevision:f.goal.revision,units:1,reason:'Concurrent explicit allowance'});return '2';
 }}).run('extend',f.cid),/Goal changed/);
 assert.equal(calls,2);assert.equal(f.c.inspectGoal(f.goal.goalId).turnLimit,5);
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});


for(const value of ['12',''])test('numeric goal input starts empty and interprets '+JSON.stringify(value)+' independently of its default',async t=>{
 const f=await world(t);f.cid=f.c.createConversation().conversationId;
 const values=['Keep numeric owner intent','Keep the original completion criterion',value];let numeric=false;
 const result=await command(f,{choose:async()=> 'Use these criteria',input:async(title,initial,description)=>{
  if(title.startsWith('Goal turn allowance')){numeric=true;assert.equal(initial,'');assert.match(description,/empty to use 8/);}
  return values.shift();
 }}).run('create',f.cid);
 assert.equal(result,'completed');assert.equal(numeric,true);
 assert.equal(f.c.conversationGoal(f.cid).turnLimit,value?12:8);
});

for(const invalid of ['1e2','0x10','+12','12.0'])test('goal numeric field preserves unsupported numeric notation '+invalid,async t=>{
 const f=await world(t);f.cid=f.c.createConversation().conversationId;
 const before=ledger(f.c),values=['Owner','Observable criterion',invalid,undefined];let numericCalls=0;
 assert.equal(await command(f,{choose:async()=> 'Use these criteria',input:async(title,value)=>{
  if(title.startsWith('Goal turn allowance')&&++numericCalls===2)assert.equal(value,invalid);
  return values.shift();
 }}).run('create',f.cid),'cancelled');assert.deepEqual(ledger(f.c),before);
});
