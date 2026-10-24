import test from 'node:test';
import assert from 'node:assert/strict';
import {world,ledger} from '../controller/local-check-fixture.mjs';
import {localCommands} from '../../dist/ui/local-commands.js';
async function setup(t,options){const f=await world(t,options);return {...f,source:f.c.createConversation({projectId:'p'}).conversationId};}
function command(f,choices,inputs=[],extra={}){const shown=[],notices=[],ui=localCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next===undefined)return;const found=rows.find(r=>r.startsWith(next));assert.ok(found,'Missing '+next+' in '+JSON.stringify(rows));return found;},input:async(title,value)=>{const next=inputs.shift();return typeof next==='function'?next(title,value):next;},show:async(title,text)=>shown.push({title,text}),notice:text=>notices.push(text),...extra});return {ui,shown,notices,run:()=>ui.commands[0].run('',f.source)};}
const first=(_t,rows)=>rows[0];
const details=text=>JSON.parse(text.split('\n\nOriginal observation · details\n')[1]);
test('new owner check previews exact project/command/cwd/active runtime/finite allowance and preserves original admitted failure',async t=>{
 const f=await setup(t),h=command(f,['Run new isolated check','/scratch','Run new independent check','Return to local tools','Close'],['node check.cjs']);await h.run();const checks=f.c.listLocalChecks('p').checks;assert.equal(checks.length,1);const view=f.c.inspectLocalCheck(checks[0].workId),review=details(h.shown.find(s=>s.title.startsWith('Review new')).text);assert.equal(review.projectId,'p');assert.equal(review.command,'node check.cjs');assert.equal(review.cwd,'/scratch');assert.equal(review.executionAllowance,8);assert.equal(review.nextAttemptRuntime.dockerContext,'NO_ENGINE');assert.equal(view.allowance.execution.consumed,1);assert.equal(view.result.status,'unavailable');assert.equal(view.cwd,'scratch');assert.ok(h.notices.some(n=>n.includes(view.workId)));assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM role_launches').n,0);await h.ui.close();
});
test('missing active runtime, cancelled command/cwd and Back review create no work or allowance',async t=>{
 const noRuntime=await setup(t,{runtime:false}),h=command(noRuntime,['Run new isolated check','Close']);await h.run();assert.match(h.shown[0].text,/No active execution runtime/);assert.equal(noRuntime.c.listLocalChecks('p').checks.length,0);await h.ui.close();
 const f=await setup(t),before=ledger(f.c);for(const [choices,inputs] of [[['Run new isolated check','Close'],[undefined]],[['Run new isolated check','Cancel','Close'],['exact command']],[['Run new isolated check','/work','Back without starting','Close'],['exact command']]]){const cancelled=command(f,choices,inputs);await cancelled.run();await cancelled.ui.close();assert.equal(ledger(f.c),before);}
});
test('retained list and original detail remain reads with drafts, original result/runtime and budgets unchanged',async t=>{
 const f=await setup(t),r=await f.c.runLocalCheck({projectId:'p',command:'original'});f.c.setDraft({conversationId:f.source,expectedRevision:0,text:'한국어 retained draft'});const before=ledger(f.c),h=command(f,['Retained local checks',first,'Inspect original','Back','Back','Close']);await h.run();assert.equal(ledger(f.c),before);assert.equal(f.c.inspectConversation(f.source).draft.text,'한국어 retained draft');const detail=details(h.shown[0].text);assert.equal(detail.workId,r.workId);assert.equal(detail.command,'original');assert.equal(detail.allowance.execution.consumed,1);assert.equal(detail.latestRun.runtime.dockerContext,'NO_ENGINE');await h.ui.close();
});
test('explicit original resume retains work and finite spend while disclosing previous versus next active runtime',async t=>{
 const f=await setup(t),r=await f.c.runLocalCheck({projectId:'p',command:'original',cwd:'scratch'});f.c.options.runtimeProfile={...f.c.options.runtimeProfile,image:'sha256:'+'1'.repeat(64)};const h=command(f,['Retained local checks',first,'Resume original check','Resume original command','Return to local tools','Close']);await h.run();const review=details(h.shown.find(s=>s.title.startsWith('Review original')).text),current=f.c.inspectLocalCheck(r.workId);assert.equal(review.workId,r.workId);assert.equal(review.cwd,'/scratch');assert.notEqual(review.previousRuntime.image,review.nextAttemptRuntime.image);assert.equal(current.allowance.execution.consumed,2);assert.equal(current.allowance.execution.limit,8);assert.equal(f.c.listLocalChecks('p').checks.length,1);await h.ui.close();
});
test('source/runtime changes before new admission and unsettled original work cannot dispatch or be replaced',async t=>{
 const f=await setup(t),before=ledger(f.c);let current=true;const stale=command(f,['Run new isolated check','/work',()=>{current=false;return 'Run new independent check';}],['original'],{isCurrent:()=>current});await assert.rejects(stale.run(),/source changed/);assert.equal(ledger(f.c),before);await stale.ui.close();
 const changed=command(f,['Run new isolated check','/work',()=>{f.c.options.runtimeProfile={...f.c.options.runtimeProfile,image:'sha256:'+'1'.repeat(64)};return 'Run new independent check';}],['original']);await assert.rejects(changed.run(),/runtime changed/);assert.equal(ledger(f.c),before);await changed.ui.close();
 const r=await f.c.runLocalCheck({projectId:'p',command:'original'});f.c.store.run("UPDATE works SET state='UNKNOWN' WHERE id=?",r.workId);const held=ledger(f.c),recovery=command(f,['Retained local checks',first,'Resume original check','Back','Back','Close']);await recovery.run();assert.match(recovery.shown[0].text,/UNKNOWN/);assert.equal(ledger(f.c),held);await recovery.ui.close();
});
test('accepted admission stays discoverable and source-bound when navigation occurs during the controlled capacity boundary',async t=>{
 const f=await setup(t);let current=true,release,entered;const gate=new Promise(r=>release=r),began=new Promise(r=>entered=r);f.c.capacity.acquire=async()=>{entered();await gate;throw Error('CONTROLLED_NO_PRODUCER');};const h=command(f,['Run new isolated check','/work','Run new independent check'],['original'],{isCurrent:()=>current}),pending=h.run();await began;const original=f.c.listLocalChecks('p').checks[0].workId;current=false;release();await assert.rejects(pending,error=>error.workId===original&&error.message.includes(original));assert.equal(f.c.inspectLocalCheck(original).allowance.execution.consumed,1);assert.equal(h.shown.filter(s=>s.title === 'Local check result').length,0);assert.equal(h.notices.some(n=>n.startsWith('Local check retained')),false);await h.ui.close();
});
test('close aborts and joins admission-to-settlement and leaves the same cancelled work with consumed allowance',async t=>{
 const f=await setup(t);let entered;const began=new Promise(r=>entered=r);f.c.capacity.acquire=async({signal})=>{entered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('CONTROLLED_CANCELLED_CAPACITY')),{once:true}));};const h=command(f,['Run new isolated check','/work','Run new independent check'],['original']),pending=h.run();void pending.catch(()=>{});await began;const original=f.c.listLocalChecks('p').checks[0].workId;await h.ui.close();await assert.rejects(pending,error=>error.workId===original);const view=f.c.inspectLocalCheck(original);assert.equal(view.state,'CANCELLED');assert.equal(view.allowance.execution.consumed,1);assert.equal(view.allowance.execution.reserved,0);assert.equal(view.latestRun.phase,'SETTLED');assert.equal(f.c.active.size,0);assert.equal(f.c.listLocalChecks('p').checks.length,1);
});

test('post-admission terminal failure preserves original work, run, code and recovery',async t=>{
 const f=await setup(t);f.c.perform=()=>{throw Error('CONTROLLED_AFTER_ADMISSION');};const h=command(f,['Run new isolated check','/work','Run new independent check'],['original']);await assert.rejects(h.run(),error=>{assert.equal(error.code,'LOCAL_CHECK_UNAVAILABLE');assert.equal(error.workId,f.c.listLocalChecks('p').checks[0].workId);assert.equal(f.c.store.one('SELECT work FROM runs WHERE id=?',error.runId).work,error.workId);assert.match(error.recovery,/retained work/);return true;});await h.ui.close();
});

test('local runtime blocker opens original setup control with no command admission and preserves started result',async t=>{
 const f=await setup(t,{runtime:false}),before=ledger(f.c),context={submission:{conversationId:f.source,text:'/local',revision:1}};
 const h=command(f,['Run new isolated check','Configure execution runtime'],[],{execute:async(command,target,ctx)=>{assert.equal(command,'/setup runtime');assert.equal(target,f.source);assert.equal(ctx,context);return 'started';}});
 assert.equal(await h.ui.commands[0].run('',f.source,context),'started');assert.equal(ledger(f.c),before);await h.ui.close();
});
test('retained local check recovery forwards its exact original work without admitting a continuation',async t=>{
 const f=await setup(t),first=command(f,['Run new isolated check','/work','Run new independent check','Return to local tools','Close'],['node check.cjs']);await first.run();await first.ui.close();const id=f.c.listLocalChecks('p').checks[0].workId,before=ledger(f.c);
 const h=command(f,['Retained local checks',(_title,rows)=>rows.find(row=>row.includes(id)),'Open original work recovery'],[],{execute:async command=>{assert.equal(command,'/work '+id);return 'started';}});
 assert.equal(await h.run(),'started');await h.ui.close();assert.equal(ledger(f.c),before);
});

test('retained result output uses its original run command and remains readable without execution',async t=>{
 const f=await setup(t),result=await f.c.runLocalCheck({projectId:'p',command:'original exact command'});
 const row=f.c.store.one('SELECT data FROM works WHERE id=?',result.workId);
 f.c.store.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),latestRaw:'different later intent'}),result.workId);
 const before=ledger(f.c),h=command(f,['Retained local checks',first,'Inspect original result and output','Back','Back','Close']);
 await h.run();assert.equal(ledger(f.c),before);
 const text=h.shown[0].text;assert.match(h.shown[0].title,/Original local check result and output/);
 assert.ok(text.includes('Requested command for this attempt: "original exact command"'));assert.ok(!text.includes('different later intent'));
 assert.deepEqual(details(text),result);await h.ui.close();
});
