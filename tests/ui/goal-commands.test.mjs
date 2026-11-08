import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
// Real controller definitions and read-only menus; synthetic lifecycle states do not qualify a producer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {goalCommands} from '../../dist/ui/goal-commands.js';
import {uiText} from '../../dist/ui/i18n.js';

async function world(t, state = 'READY', used = 0, projectId) {
    const root = await temporaryDirectory('goal-command');
    const c = await openController({installationHome:path.join(root,'home')});
    t.after(async () => {await c.close(); await fs.rm(root,{recursive:true,force:true});});
    if (projectId) {
        const project = path.join(root,'project');await fs.mkdir(project);
        await c.registerProject({id:projectId,sourceRoot:project});
    }
    const cid = c.createConversation({projectId}).conversationId;
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

for (const [locale, state, action] of [['en','READY',''],['ko','PAUSED','resume']]) {
    test('goal runtime application returns to the same goal before an explicit '+state.toLowerCase()+' action',async t=>{
        const f=await world(t,state,state==='READY'?0:1,'P'),before=ledger(f.c),draft=f.c.inspectConversation(f.cid).draft;
        const setup=locale==='en'?'Configure execution runtime':'실행 환경 설정';
        const start=locale==='en'?'Start this goal':'이 목표 명시적으로 재개';
        let menus=0,applied=0;
        const result=await command(f,{locale:()=>locale,choose:async(title,rows)=>{
            if(++menus===1){
                assert.match(title,locale==='en'?/Execution runtime required/:/실행 환경 필요/);
                assert.ok(rows.includes(setup));assert.ok(!rows.includes(start));
                if(action)assert.notEqual(rows[0],setup);
                return setup;
            }
            assert.ok(rows.includes(start),rows.join(', '));assert.ok(!rows.includes(setup));
            return undefined;
        },configureRuntime:async target=>{
            assert.equal(target,f.cid);applied++;
            await f.c.applyRuntimeProfile({dockerBinary:'/usr/bin/false',dockerContext:'REPAIRED',image:'sha256:'+'0'.repeat(64)});
            return true;
        }}).run(action,f.cid);
        assert.equal(result,'cancelled');assert.equal(menus,2);assert.equal(applied,1);
        assert.deepEqual(ledger(f.c),before);assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
    });
}
for(const state of ['ACTIVE','BUDGET_EXHAUSTED','CANCELLED','UNKNOWN'])test('blocked goal start does not offer runtime setup · '+state,async t=>{
    const f=await world(t,state==='UNKNOWN'?'READY':state,state==='BUDGET_EXHAUSTED'?4:0,'P');
    if(state==='UNKNOWN')f.c.store.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?",f.cid);
    const before=ledger(f.c),options={configureRuntime:async()=>assert.fail('Ineligible goal opened setup'),choose:async(title,rows)=>{
        assert.doesNotMatch(title,/Execution runtime required/);assert.ok(!rows.includes('Configure execution runtime'));return undefined;
    }};
    await command(f,options).run('',f.cid);
    await assert.rejects(command(f,{...options,choose:async()=>assert.fail('Typed start opened setup')}).run('start',f.cid),/cannot start or resume/);
    assert.deepEqual(ledger(f.c),before);
});

test('runtime setup does not reuse a changed goal after returning',async t=>{
    const f=await world(t,'READY',0,'P');let configured=0;
    const h=command(f,{choose:async()=> 'Configure execution runtime',configureRuntime:async()=>{
        configured++;
        f.c.reviseGoal({goalId:f.goal.goalId,expectedRevision:f.goal.revision,objective:'Changed owner goal',
            criteria:['Observe new result'],reason:'Changed during setup'});
        return false;
    }});
    await assert.rejects(h.run('',f.cid),/Goal changed; reopen/);
    assert.equal(configured,1);assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts,0);
});
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

for (const locale of ['en', 'ko']) test(`blocked goal with no turns shows available recovery in ${locale}`, async t => {
    const f = await world(t, 'BLOCKED', 4);
    const nextAction = 'Inspect the original producer and explicitly resume';
    const row = f.c.store.one('SELECT data FROM goals WHERE id=?', f.goal.goalId);
    f.c.store.run('UPDATE goals SET data=? WHERE id=?', JSON.stringify({...JSON.parse(row.data), nextAction}), f.goal.goalId);
    const before = ledger(f.c);
    const text = (id, values) => uiText(locale, id, values);
    let readDetails = false;
    await command(f, {
        locale: () => locale,
        choose: async (title, rows) => {
            assert.ok(title.includes(text('goal.turns', {used: 4, limit: 4})));
            assert.ok(title.includes(text('goal.exhaustedExtend')));
            assert.ok(!title.includes(nextAction));
            assert.ok(rows.includes(text('goal.extend')));
            assert.ok(!rows.includes(text('goal.resume')));
            return readDetails ? undefined : text('goal.details');
        },
        show: async (_title, details) => {
            assert.ok(details.includes(text('goal.recordedNext', {value: nextAction})));
            readDetails = true;
        },
    }).run('', f.cid);
    assert.equal(readDetails, true);
    assert.deepEqual(ledger(f.c), before);
});

test('goal at the hard limit shows evidence without offering additional turns', async t => {
    const f = await world(t, 'BLOCKED', 1000);
    f.c.extendGoal({goalId: f.goal.goalId, expectedRevision: f.goal.revision, units: 996, reason: 'Fixture total'});
    await command(f, {choose: async (title, rows) => {
        assert.match(title, /reached the maximum turn allowance/);
        assert.ok(!rows.some(row => /^(Add goal turns|Resume)/.test(row)));
    }}).run('', f.cid);
});

test('goal details show only the last unavailable attempt’s matching recorded diagnostic', async t => {
    const f = await world(t, 'BLOCKED', 4), before = ledger(f.c);
    const inspect = f.c.inspectGoal.bind(f.c);
    const failure = '\x1b[31mPending request\x1b[0m';
    const last = {attemptId: 'attempt', ordinal: 4, kind: 'reviewer', state: 'UNAVAILABLE', runId: 'review-run', conversationId: 'review-conversation'};
    for (const [runId, conversationId] of [[last.runId, last.conversationId], ['foreign-run', last.conversationId], [last.runId, 'foreign-conversation']]) {
        f.c.inspectGoal = id => ({...inspect(id), attempts: [{...last, data: {result: {runId, conversationId, failure}}}]});
        let opened = false;
        await command(f, {
            choose: async title => {
                assert.doesNotMatch(title, /Pending request/);
                return opened ? undefined : 'Inspect goal and completion evidence';
            },
            show: async (_title, details) => {
                opened = true;
                if (runId === last.runId && conversationId === last.conversationId) {
                    assert.match(details, /Last attempt diagnostic · run review-run\nPending request/);
                    assert.doesNotMatch(details, /\x1b/);
                } else {
                    assert.doesNotMatch(details, /Pending request/);
                }
            },
        }).run('',f.cid);
        assert.ok(opened);
    }
    assert.deepEqual(ledger(f.c), before);
});

for (const mode of ['open', 'close', 'changed', 'ambiguous', 'refreshed', 'revised', 'other owner']) test(`blocked goal work navigation · ${mode}`, async t => {
    const f = await world(t, 'BLOCKED', 4);
    const before = ledger(f.c), draft = f.c.inspectConversation(f.cid).draft;
    let inspections = 0, opened = false, current = true;
    let workId = mode === 'ambiguous' ? undefined : 'linked-work';
    f.c.goalPendingSourceWork = goalId => {
        assert.equal(goalId, f.goal.goalId);
        return workId;
    };
    const run = command(f, {
        isCurrent: () => current,
        choose: async (_title, rows) => {
            assert.ok(rows.includes('Inspect linked work and its separate budgets'));
            return inspections ? undefined : 'Inspect goal and completion evidence';
        },
        show: async (_title, details, primary, position) => {
            inspections++;
            if (inspections === 2) {
                if (mode === 'refreshed') {
                    assert.match(details, /A new current reason/);
                    assert.equal(primary, undefined);
                    assert.equal(position.scrollTop, 0);
                } else {
                    assert.equal(mode, 'open');
                    assert.equal(primary?.label, 'Open work with a pending request');
                    assert.equal(position.scrollTop, 8);
                }
                return;
            }
            if (mode === 'ambiguous') {
                assert.equal(primary, undefined);
                return;
            }
            assert.equal(primary.label, 'Open work with a pending request');
            position.scrollTop = 8;
            if (mode === 'changed') workId = 'another-linked-work';
            if (mode !== 'close') await primary.run();
        },
        work: async (target, _context, selectedWork) => {
            assert.equal(target, f.cid);
            assert.equal(selectedWork, 'linked-work');
            opened = true;
            if (mode === 'refreshed') {
                workId = undefined;
                f.c.store.run("UPDATE goals SET state='WAITING_INPUT',data=json_set(data,'$.reason','A new current reason') WHERE id=?",f.goal.goalId);
            }
            if (mode === 'revised') f.c.reviseGoal({goalId:f.goal.goalId,expectedRevision:f.goal.revision,objective:'New approved definition',criteria:['Keep the new owner direction'],reason:'An independent owner change'});
            if (mode === 'other owner') current = false;
            return 'cancelled';
        },
    }).run('', f.cid);
    if (mode === 'changed') await assert.rejects(run, /work with a pending request changed/);
    else if (mode === 'revised') await assert.rejects(run, /Goal changed; reopen \/goal/);
    else assert.equal(await run, 'cancelled');
    assert.equal(inspections, ['open','refreshed'].includes(mode) ? 2 : 1);
    assert.equal(opened, ['open','refreshed','revised','other owner'].includes(mode));
    const after = ledger(f.c);
    if (mode === 'refreshed' || mode === 'revised') {
        assert.notDeepEqual(after.goals, before.goals);
        for (const table of ['goal_attempts','conversation_inputs','works','runs']) assert.deepEqual(after[table], before[table]);
    } else assert.deepEqual(after, before);
    assert.deepEqual(f.c.inspectConversation(f.cid).draft, draft);
});

for(const dismiss of ['Back','Escape'])test(dismiss+' from scoped cancellation returns to the original goal without writing',async t=>{
    const f=await world(t,'ACTIVE',1), before=ledger(f.c), draft=f.c.inspectConversation(f.cid).draft;
    let calls=0;
    const outcome=await command(f,{choose:async(title,rows)=>{
        if(++calls===1)return 'Cancel goal coordination';
        if(calls===3){assert.match(title,/Goal · Running/);return 'Return without action';}
        assert.match(title,/Delegated work remains separately managed/);
        assert.equal(rows[0],'Back without cancellation');
        return dismiss==='Back'?rows[0]:undefined;
    }}).run('',f.cid);
    assert.equal(outcome,'cancelled'); assert.equal(calls,3); assert.deepEqual(ledger(f.c),before);
    assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
});

for(const mode of ['typed','new goal'])test('cancelled creation respects its caller · '+mode,async t=>{
    const f=await world(t),cid=f.c.createConversation().conversationId,before=ledger(f.c);
    let menus=0,inputs=0;
    const run=command(f,{choose:async(_title,rows)=>{
        menus++;
        return menus===1?rows[1]:rows[0];
    },input:async()=>{
        inputs++;
        if(mode==='new goal') f.c.createGoal({conversationId:cid,objective:'A separately created goal',criteria:['Keep its own definition']});
        return undefined;
    }}).run(mode==='typed'?'create':'',cid);
    if(mode==='new goal') {
        await assert.rejects(run,/Goal source changed/);
        assert.equal(f.c.conversationGoal(cid).objective,'A separately created goal');
    } else {
        assert.equal(await run,'cancelled');
        assert.deepEqual(ledger(f.c),before);
    }
    assert.equal(inputs,1);assert.equal(menus,mode==='typed'?0:1);
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

test('runtime loss while choosing Start refreshes the existing goal menu',async t=>{
    const f=await world(t,'READY',0,'P'),before=ledger(f.c);
    await f.c.applyRuntimeProfile({dockerBinary:'/usr/bin/false',dockerContext:'fixture',image:'sha256:'+'0'.repeat(64)});
    let menus=0;
    const outcome=await command(f,{configureRuntime:async()=>assert.fail('Setup requires a fresh choice'),choose:async(title,rows)=>{
        if(++menus===1){
            assert.ok(rows.includes('Start this goal'));
            f.c.options.runtimeProfile=undefined;
            return 'Start this goal';
        }
        assert.match(title,/Goal · Not started/);
        assert.ok(rows.includes('Configure execution runtime'));
        assert.ok(!rows.includes('Start this goal'));
        return 'Return without action';
    }}).run('',f.cid);
    assert.equal(outcome,'cancelled');assert.equal(menus,2);assert.deepEqual(ledger(f.c),before);
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

for(const action of ['escape','back','continue','request changed while resolving']) {
    test('retained goal request requires its own consent · '+action,async t=>{
        const f=await world(t,'PAUSED',1),locale=action==='back'?'ko':'en',text=' Exact · original\n'+'한'.repeat(33000)+' \tEND ';
        const receipt=await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:0,text,mode:'idle'});
        const pending=f.c.pendingGoalInput(f.goal.goalId),before=ledger(f.c),draft=f.c.inspectConversation(f.cid).draft;
        const pages=[];let confirmations=0,resolved=0,started=0;
        f.c.startGoal=options=>{started++;assert.equal(options.reconcileInputId,receipt.inputId);assert.equal(options.goalId,f.goal.goalId);};
        const h=command(f,{locale:()=>locale,show:async(title,body,primary)=>{
            assert.ok(title.includes(uiText(locale,'goal.inputReview')));pages.push(body);
            assert.equal(primary?.label,uiText(locale,pages.length===1?'review.nextPage':'review.openConfirmation'));
            if(action!=='escape')await primary.run();
        },choose:async(title,rows)=>{
            confirmations++;
            assert.equal(title,uiText(locale,'goal.inputConfirmTitle'));
            assert.equal(rows[0],uiText(locale,'input.recoveryBackUnchanged'));
            return action==='back'?rows[0]:uiText(locale,'goal.inputConfirm');
        },resolve:async()=>{
            resolved++;
            if(action.startsWith('request changed'))f.c.store.run('UPDATE conversation_inputs SET text=? WHERE id=?','Changed row under the same input ID',receipt.inputId);
            return {applicationConversation:{version:1,choiceRevision:0}};
        }});
        if(action.startsWith('request changed'))await assert.rejects(h.run('resume',f.cid),/Pending input changed/);
        else {
            assert.equal(await h.run('resume',f.cid),action==='continue'?'completed':'cancelled');
            assert.deepEqual(ledger(f.c),before);assert.deepEqual(f.c.pendingGoalInput(f.goal.goalId),pending);
        }
        assert.equal(confirmations,action==='escape'?0:1);
        assert.equal(resolved,action==='escape'||action==='back'?0:1);assert.equal(started,action==='continue'?1:0);
        assert.equal(pages.length,action==='escape'?1:2);
        if(pages.length===2)assert.ok(pages.join('').includes(JSON.stringify(text)));
        assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
    });
}
test('unsettled retained input routes to original inspection before resolving a model',async t=>{
    const f=await world(t,'PAUSED',1,'P');
    const {inputId}=await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:0,text:'Delivery still needs reconciliation',mode:'idle'});
    f.c.store.run("UPDATE conversation_inputs SET state='NATIVE_PENDING' WHERE id=?",inputId);
    const before=ledger(f.c);
    await assert.rejects(command(f,{show:async()=>assert.fail('Unsettled input offered a continue review')}).run('resume',f.cid),/Open \/inputs/);
    let inspections=0;
    assert.equal(await command(f,{
        configureRuntime:async()=>assert.fail('Unsettled input opened setup'),
        inputs:async target=>{assert.equal(target,f.cid);inspections++;return 'cancelled';},
    }).run('resume',f.cid),'cancelled');
    assert.equal(inspections,1);
    assert.deepEqual(ledger(f.c),before);
});

test('a displayed runtime setup action refreshes when the retained inputs become ambiguous',async t=>{
    const f=await world(t,'PAUSED',1,'P');
    const draft=f.c.inspectConversation(f.cid).draft;
    let menus=0,inspections=0;
    await command(f,{
        show:async()=>assert.fail('Ambiguous input offered continuation'),
        configureRuntime:async()=>assert.fail('Blocked continuation opened setup'),
        inputs:async target=>{assert.equal(target,f.cid);inspections++;return 'cancelled';},
        choose:async(title,rows)=>{
            if(++menus===1){
                assert.ok(rows.includes('Configure execution runtime'));
                for(const text of ['First retained request','Second retained request'])
                    await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:0,text,mode:'idle'});
                return 'Configure execution runtime';
            }
            assert.match(title,/Open \/inputs/);
            assert.ok(rows.includes('Inspect retained requests'));
            assert.ok(!rows.includes('Configure execution runtime'));
            assert.ok(!rows.includes('Resume this goal explicitly'));
            return menus===2 ? 'Inspect retained requests' : undefined;
        },
    }).run('',f.cid);
    assert.equal(menus,3);
    assert.equal(inspections,1);
    assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts,1);
    assert.deepEqual(f.c.inspectConversation(f.cid).draft,draft);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});
test('a new pending request cannot become an unreviewed continuation during resolution',async t=>{
    const f=await world(t,'PAUSED',1);
    f.c.startGoal=()=>assert.fail('A newly queued input must be reviewed');
    const h=command(f,{resolve:async()=>{
        await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:0,text:'A new pending request',mode:'idle'});
        return {applicationConversation:{version:1,choiceRevision:0}};
    }});
    await assert.rejects(h.run('resume',f.cid),/Pending input changed/);
    assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts,1);
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
