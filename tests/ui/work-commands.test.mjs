import path from 'node:path';
import test from 'node:test';import assert from 'node:assert/strict';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';
import {uiText,uiCatalogues} from '../../dist/ui/i18n.js';
import {HostCommands} from '../../dist/ui/host-commands.js';import {workCommands} from '../../dist/ui/work-commands.js';
import {workAllowanceText} from '../../dist/ui/work-allowance-presentation.js';
import {scripted} from '../controller/effect-fixture.mjs';
function command(f,choices,inputs=[],hooks={}){const notices=[],shown=[];const cid=f.c.createConversation().conversationId;let step=0;const registry=new HostCommands(workCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const v=choices[step++];return typeof v==='function'?v(title,rows):rows.find(r=>r.startsWith(v??'IMPOSSIBLE'));},input:async()=>inputs.shift(),show:async(title,text,primary)=>{shown.push({title,text});await primary?.run();},notice:text=>notices.push(text),activate:async()=>assert.fail('Unexpected navigation'),...hooks}));return{run:argument=>registry.execute('/work '+argument,cid),cid,notices,shown};}
test('pending owner activation preserves the active-runtime resume and yields to uncertain cleanup', async t => {
    const f = await registryWorld(t), id = f.works[0].workId;
    f.c.store.run("UPDATE works SET data=json_set(data,'$.ownerRootActivation.state','PENDING') WHERE id=?", id);
    await f.c.close();
    const {openController} = await import('../../dist/controller/index.js');
    const c = await openController({installationHome:f.home,runtimeProfile:{
        dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64),
    }});
    t.after(()=>c.close());
    const activation = uiText('en','workRecovery.activation');
    const resume = uiText('en','workRecovery.resumeRoute',{id});
    for (const uncertain of [false,true]) {
        if (uncertain) c.store.run("UPDATE works SET state='UNKNOWN' WHERE id=?",id);
        const h = command({c}, [(title, rows) => {
            assert.equal(rows.includes(activation), !uncertain);
            assert.equal(rows.includes(resume), !uncertain);
            if (uncertain) assert.ok(title.includes(uiText('en','workRecovery.settlementUnconfirmed')));
            return undefined;
        }], [], {execute:async()=>assert.fail('Closing the menu dispatched work')});
        assert.equal(await h.run(id),'cancelled');
    }
    await c.close();
});

test('all-work registry includes actual ordinary work; paging and inspection do not consume or reset records',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId;await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original ordinary request',mode:'idle'});const oldTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(f.home,'artifacts');let result;try{result=await f.c.runConversation({conversationId:cid,model:scripted(()=>({text:'Observed only'}))});}finally{if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;}assert.equal(result.status,'delivered',JSON.stringify(result));const page=f.c.listWorks({limit:1});assert.equal(page.works[0].workId,result.workId);assert.equal(page.works[0].recordedPhase,null);assert.ok(page.nextCursor);assert.equal(f.c.listWorks({limit:1,before:page.nextCursor}).works.length,1);assert.throws(()=>f.c.listWorks({limit:0}),/bounded/);
 const h=command(f,['Inspect retained work and limits','Back']),before=workLedger(f.c);assert.equal(await h.run(result.workId),'cancelled');assert.deepEqual(workLedger(f.c),before);assert.ok(h.shown[0].text.includes('Original ordinary request'));assert.ok(h.shown[0].text.includes('Goal turn allowance is separate'));await f.c.close();
});
test('work registry scopes pagination and keeps exact cross-project links reachable',async t=>{
 const f=await registryWorld(t),[first,foreign]=f.works,cid=f.c.createConversation({projectId:'A'}).conversationId;
 const scoped=f.c.listWorks({projectId:'A',limit:1});
 assert.ok(scoped.nextCursor);assert.equal(scoped.works[0].projectId,'A');
 assert.equal(f.c.listWorks({projectId:'A',before:scoped.nextCursor,limit:1}).works[0].workId,first.workId);
 assert.throws(()=>f.c.listWorks({projectId:'A',before:foreign.workId}),/cursor for this scope/);
 assert.throws(()=>f.c.listWorks({projectId:'unregistered'}),/not registered/);
 // Populate later pages with existing read fixtures. No producer is launched for these rows.
 f.c.store.run(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<51)
   INSERT INTO works SELECT 'page-'||x,project,source,predecessor,lineage,state,epoch,generation,current_result,data FROM works,n WHERE id=?`,first.workId);
 const linked=await f.c.beginChange({projectId:'B',request:'Earlier linked project work'});
 const newestForeign=await f.c.beginChange({projectId:'B',request:'Recent unrelated project work'});
 f.c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?',linked.workId,cid);
 const before=workLedger(f.c),menus=[];
 const [work]=workCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{
    menus.push({title,rows});
    if(menus.length===2||menus.length===4)return rows.find(row=>row.includes('#'+first.workId));
    if(menus.length===3||menus.length===5){
      assert.equal(rows[0],uiText('en','workRecovery.back'));
      assert.ok(!rows.includes(uiText('en','workRecovery.browseRegistry')));
      return menus.length===3?rows[0]:undefined;
    }
    return {1:'Older works',6:'All projects · first page',7:'Current project only · A',8:'Close work registry'}[menus.length];
 },input:async()=>assert.fail('Registry opened an edit'),show:async()=>assert.fail('Registry opened an inspection'),
 notice(){},activate:async()=>assert.fail('Registry navigated away')});
 assert.equal(await work.run('',cid),'cancelled');
 const current='Original work and allowances · project A';
 assert.deepEqual(menus.filter((_,index)=>![2,4].includes(index)).map(menu=>menu.title),[current,current,current,current,'Original work and allowances · all projects',current]);
 assert.ok(menus[1].rows.includes('Newer works'));
 assert.deepEqual(menus[3],menus[1]);assert.deepEqual(menus[5],menus[1]);
 assert.ok(!menus[6].rows.includes('Newer works'));
 assert.ok(!menus[7].rows.includes('Newer works'));
 assert.ok(menus[6].rows.some(row=>row.includes('#'+linked.workId)&&row.includes('Earlier linked project work')));
 for(const [index,menu] of menus.entries()){
    if([2,4].includes(index))continue;
    assert.equal(menu.rows.filter(row=>row.includes('#'+linked.workId)).length,1);
    assert.equal(menu.rows.some(row=>row.includes('#'+newestForeign.workId)),index===6);
 }
 assert.deepEqual(workLedger(f.c),before);
 const fs=await import('node:fs/promises'),root=path.join(f.root,'C');await fs.mkdir(root);
 await f.c.registerProject({id:'C',sourceRoot:root});
 const empty=f.c.createConversation({projectId:'C'}).conversationId,shown=[];
 const [emptyWork]=workCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{shown.push({title,rows});return 'Close work registry';},
 input:async()=>assert.fail('Empty registry opened an edit'),show:async()=>assert.fail('Empty registry opened an inspection'),notice(){},activate:async()=>assert.fail('Unexpected navigation')});
 assert.equal(await emptyWork.run('',empty),'cancelled');
 assert.match(shown[0].title,/project C\nNo registry entries in this scope/);
 assert.ok(shown[0].rows.includes('All projects · first page'));
});
test('owner work extension changes only its shared limit and records its exact reason; goal turns stay separate',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,goal=f.c.createGoal({conversationId:f.c.createConversation().conversationId,objective:'Keep goal budget',criteria:['Separate counters'],turnLimit:3}),before=f.c.inspectWorkAllowance(id),g=f.c.inspectGoal(goal.goalId);
 const h=command(f,['Extend shared execution allowance','Add 3 execution'],['3','Explicit owner recovery']);assert.equal(await h.run(id),'completed');const after=f.c.inspectWorkAllowance(id);assert.equal(after.execution.limit,before.execution.limit+3);assert.equal(after.execution.consumed,before.execution.consumed);assert.equal(after.execution.reserved,before.execution.reserved);assert.deepEqual(after.resolution,before.resolution);assert.deepEqual(f.c.inspectGoal(goal.goalId),g);assert.equal(f.c.store.one("SELECT raw FROM sources WHERE json_extract(origin,'$.kind')='owner-budget-extension' ORDER BY rowid DESC LIMIT 1").raw,'Explicit owner recovery');
 const resolution=command(f,['Extend shared resolution allowance','Add 2 resolution'],['2','Bounded independent resolution']);await resolution.run(id);assert.equal(f.c.inspectWorkAllowance(id).resolution.limit,after.resolution.limit+2);assert.equal(f.c.inspectWorkAllowance(id).execution.limit,after.execution.limit);
});
test('cancelled and stale forms leave the selected shared allowance intact; unknown cleanup and busy siblings refuse',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,sibling=f.works[1].workId;f.c.store.run('UPDATE works SET lineage=? WHERE id=?',id,sibling);
 const initial=f.c.inspectWorkAllowance(id).execution;
 f.c.store.run('UPDATE budgets SET lim=?, reserved=1 WHERE lineage=? AND kind=?',initial.consumed+1,id,'execution');
 const reserved=workLedger(f.c);
 const noAmount=command(f,['Extend shared execution allowance'],[],{input:async()=>assert.fail('A known shared reservation must stop before asking for an amount')});
 assert.equal(await noAmount.run(id),'cancelled');assert.deepEqual(workLedger(f.c),reserved);
 assert.equal(noAmount.shown.length,1);assert.equal(noAmount.shown[0].title,uiText('en','workRecovery.allowanceHeld'));
 f.c.store.run('UPDATE budgets SET lim=?, reserved=? WHERE lineage=? AND kind=?',initial.limit,initial.reserved,id,'execution');
 const snapshot=f.c.inspectWorkAllowance(id);f.c.extendExecutionAllowance({workId:sibling,additional:1,reason:'Concurrent actual owner extension'});const stale=workLedger(f.c);assert.throws(()=>f.c.extendWorkAllowance({expected:snapshot,kind:'execution',additional:1,reason:'Old confirmation'}),/changed/);assert.deepEqual(workLedger(f.c),stale);
 const form=command(f,['Extend shared execution allowance',(_title,rows)=>rows[0]],[],{input:async(title)=>{if(title.startsWith('Additional')){f.c.extendExecutionAllowance({workId:sibling,additional:1,reason:'Concurrent extension while form open'});return '2';}return 'Owner confirmation from stale form';}});
 await assert.rejects(form.run(id),/changed/);
 const snap=f.c.inspectWorkAllowance(id);f.c.active.set(sibling,{done:Promise.resolve(),abort:new AbortController()});assert.equal(f.c.inspectWorkAllowanceExtension(id).unsettled,true);assert.throws(()=>f.c.extendWorkAllowance({expected:snap,kind:'execution',additional:1,reason:'Cannot extend busy sibling'}),/active/);f.c.active.delete(sibling);
 assert.equal(f.c.inspectWorkAllowanceExtension(id).unsettled,false);
 const run=f.c.store.one('SELECT id FROM runs WHERE work=?',sibling);f.c.store.run('UPDATE runs SET phase=? WHERE id=?','UNKNOWN',run.id);assert.throws(()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(id),kind:'resolution',additional:1,reason:'Cannot reconcile by extending'}),/unsettled/);f.c.store.run('UPDATE runs SET phase=? WHERE id=?','SETTLED',run.id);
 for(const state of ['QUEUED','SETTLING','QUARANTINED']){
  f.c.store.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)','fixture-lease',sibling,run.id,1,999,state,'{"fixture":"non-executing owner recovery hold"}');
  assert.throws(()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(id),kind:'execution',additional:1,reason:'No bypass through settled sibling'}),/unsettled/);f.c.store.run('DELETE FROM capacity_leases WHERE id=?','fixture-lease');
 }
 f.c.store.run('UPDATE budgets SET lim=? WHERE lineage=? AND kind=?',Number.MAX_SAFE_INTEGER,id,'execution');assert.throws(()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(id),kind:'execution',additional:1,reason:'No unsafe arithmetic'}),/safe finite/);
});
test('closing a direct resolution allowance confirmation returns to the same work without writing',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,before=workLedger(f.c);
 let returned=false;
 const h=command(f,['Extend shared resolution allowance','Cancel',(title,rows)=>{
  assert.ok(title.startsWith('Work recovery · #'+id));
  assert.equal(rows[0],uiText('en','workRecovery.backToSource'));
  returned=true;
  return rows[0];
 }],['2','Review this bounded resolution extension']);
 assert.equal(await h.run(id),'cancelled');
 assert.equal(returned,true);
 assert.deepEqual(h.notices,[]);
 assert.deepEqual(workLedger(f.c),before);
});
for(const locale of ['en','ko'])test(locale+' paged findings preserve duplicate occurrences, original role/candidate and diagnostic obligations',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,run=f.c.store.one('SELECT id FROM runs WHERE work=?',id).id;
 // Controlled ledger records test recovery rendering, not a successful independent review.
 f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','L',id,run,'reviewer',1,'UNUSABLE','none',JSON.stringify({inputVersions:{candidate:'UNSELECTED_FIXTURE_CANDIDATE'}}));f.c.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)','O','L','Retained raw fixture','UNUSABLE','{}');
 for(let n=0;n<27;n++)f.c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)','F'+n,'O',n,id,JSON.stringify({finding:{description:'Repeated exact observation',severity:'blocking'}}));
 f.c.store.run('INSERT INTO obligations VALUES(?,?,?)','D',id,JSON.stringify({kind:'diagnostic',state:'pending',issues:['Malformed original reviewer result']}));
 const page=f.c.listWorkEvidence(id,'findings');assert.equal(page.items.length,25);assert.equal(f.c.listWorkEvidence(id,'findings',page.nextCursor).items.length,2);assert.equal(page.items[0].producer.role,'reviewer');assert.equal(page.items[0].producer.candidate,'UNSELECTED_FIXTURE_CANDIDATE');assert.equal(page.items[0].disposition,null);
 const h=command(f,[uiText(locale,'workRecovery.findings'),(_title,rows)=>rows[0],uiText(locale,'workRecovery.olderEvidence'),(_title,rows)=>rows[0],uiText(locale,'workRecovery.closeEvidence'),uiText(locale,'workRecovery.obligations'),(_title,rows)=>rows[0],uiText(locale,'workRecovery.closeEvidence'),uiText(locale,'workRecovery.backToSource')],[],{locale:()=>locale});const before=workLedger(f.c);await h.run(id);assert.equal(h.shown.length,3);assert.ok(h.shown[0].text.includes('Repeated exact observation'));assert.ok(h.shown[2].text.includes('Malformed original reviewer result'));assert.deepEqual(workLedger(f.c),before);
});
test('authoritative family UNKNOWN and settled-phase reservations refuse with no extension write',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,sibling=f.works[1].workId;f.c.store.run('UPDATE works SET lineage=? WHERE id=?',id,sibling);const attempt=()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(id),kind:'execution',additional:1,reason:'Cannot turn an unsettled family into authority'});
 for(const state of ['UNKNOWN','QUARANTINED']){f.c.store.run('UPDATE works SET state=? WHERE id=?',state,sibling);const before=workLedger(f.c);assert.throws(attempt,/unsettled/);assert.deepEqual(workLedger(f.c),before);}f.c.store.run('UPDATE works SET state=? WHERE id=?','ACTIVE',sibling);
 const run=f.c.store.one('SELECT id FROM runs WHERE work=?',sibling);f.c.store.run('UPDATE runs SET phase=?,reservation=? WHERE id=?','SETTLED','reserved',run.id);const before=workLedger(f.c);assert.throws(attempt,/unsettled/);assert.deepEqual(workLedger(f.c),before);
});
test('an unsettled sibling appearing after the allowance form opens still refuses confirmation',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,sibling=f.works[1].workId;
 f.c.store.run('UPDATE works SET lineage=? WHERE id=?',id,sibling);
 let held;
 const h=command(f,['Extend shared execution allowance',(_title,rows)=>{
  f.c.store.run("UPDATE works SET state='UNKNOWN' WHERE id=?",sibling);
  held=workLedger(f.c);
  return rows.find(row=>row.startsWith('Add 2 execution'));
 }],['2','Reason reviewed before the cleanup state changed']);
 await assert.rejects(h.run(id),/cleanup is unsettled/);assert.ok(held);assert.deepEqual(workLedger(f.c),held);
});
test('ordinary selection snapshots both shared budgets and rejects sibling resolution drift/reservation',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,ordinary=f.works[1].workId;
 // Controlled ordinary-row classification of a shared ledger member; no execution claim.
 f.c.store.run('DELETE FROM change_state WHERE work=?',ordinary);f.c.store.run('UPDATE works SET lineage=? WHERE id=?',id,ordinary);
 const snapshot=f.c.inspectWorkAllowance(ordinary);assert.equal(snapshot.governed,false);assert.ok(snapshot.resolution);f.c.extendResolutionAllowance({workId:id,additional:1,reason:'Actual sibling resolution extension'});const before=workLedger(f.c);assert.throws(()=>f.c.extendWorkAllowance({expected:snapshot,kind:'execution',additional:1,reason:'Stale ordinary form'}),/changed/);assert.deepEqual(workLedger(f.c),before);
 f.c.store.run('UPDATE budgets SET reserved=1 WHERE lineage=? AND kind=?',id,'resolution');const held=workLedger(f.c);assert.throws(()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(ordinary),kind:'execution',additional:1,reason:'Cannot skip hidden shared reservation'}),/unsettled/);assert.deepEqual(workLedger(f.c),held);
});
test('unavailable goal-link metadata remains visible without blocking original all-work discovery',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,h=command(f,['Goal links unavailable',(_title,rows)=>rows.find(r=>r.includes('#'+id)),'Inspect retained','Back to all','Close work registry']);f.c.createGoal({conversationId:h.cid,objective:'Discover retained original work',criteria:['No lost access during linkage diagnosis'],turnLimit:3});f.c.goalRecoveryWorkIds=()=>{throw Error('Controlled unavailable goal provenance');};
 const before=workLedger(f.c);await h.run('');assert.ok(h.shown[0].text.includes('Controlled unavailable goal provenance'));assert.ok(h.shown[1].text.includes('Owner request 0'));assert.deepEqual(workLedger(f.c),before);
});
test('result-read failure rolls back extension and reason together and reports original recovery identity',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;
 for(const kind of ['execution','resolution']){
  const expected=f.c.inspectWorkAllowance(id),before=workLedger(f.c),owner=kind==='execution'?f.c:f.c.changes,key=kind==='execution'?'inspectWork':'inspect',original=owner[key];owner[key]=()=>{throw Error('Controlled postwrite result-read failure');};
  try{assert.throws(()=>f.c.extendWorkAllowance({expected,kind,additional:1,reason:'Do not record a failed extension'}),e=>e.code==='WORK_ALLOWANCE_REFUSED'&&e.workId===id&&e.message.includes('postwrite'));}finally{owner[key]=original;}
  assert.deepEqual(workLedger(f.c),before);
 }
});

test('direct work Back and Escape close the exact review; browsing requires its named choice',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;
 for(const choice of [undefined,'workRecovery.backToSource','workRecovery.browseRegistry']){
  let registry=0;
  const h=command(f,[],[],{choose:async(title,rows)=>{
   if(title.startsWith('Work recovery')){
    assert.equal(rows[0],uiText('en','workRecovery.backToSource'));
    return choice&&uiText('en',choice);
   }
   registry++;assert.match(title,/Original work and allowances/);return 'Close work registry';
  }});
  assert.equal(await h.run(id),'cancelled');assert.equal(registry,Number(choice==='workRecovery.browseRegistry'));
 }
});

test('work menu discards an allowance selection when the displayed epoch changes', async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;
 let afterDrift;
 const h=command(f,[
  (_title,rows)=>{
   f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',id);
   afterDrift=workLedger(f.c);
   return rows.find(row=>row.startsWith('Extend shared execution'));
  },
  (title,rows)=>{
   assert.match(title,/Work changed while this menu was open/);
   assert.ok(rows.some(row=>row.startsWith('Extend shared execution')));
   return undefined;
  },
 ],[],{input:async()=>assert.fail('Stale choice must not open an allowance form')});
 assert.equal(await h.run(id),'cancelled');
 assert.deepEqual(workLedger(f.c),afterDrift);
});

test('work details follow current counters when the action routes stay stable', async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;
 const h=command(f,[(_title,rows)=>{
  f.c.extendExecutionAllowance({workId:id,additional:2,reason:'Actual extension before details'});
  return rows.find(row=>row.startsWith('Inspect retained work'));
 }]);
 assert.equal(await h.run(id),'cancelled');
 const budget=f.c.inspectWorkAllowance(id).execution;
 assert.equal(h.shown.length,1);
 assert.ok(h.shown[0].text.includes(workAllowanceText('en','execution',budget)));
});

test('work registry shows state and intent at 80 columns and keeps exact selection identity',async t=>{
 const {HostPicker}=await import('../../dist/ui/host-picker.js'),{initTheme}=await import('@earendil-works/pi-coding-agent'),{stripTerminalSequences}=await import('@earendil-works/pi-tui');initTheme('dark',false);
 const f=await registryWorld(t);let selectedId;
 const h=command(f,[],[],{choose:async(title,rows)=>{
  if(title.startsWith('Original work and allowances')){if(selectedId)return 'Close work registry';const row=rows.find(row=>row.includes('#'+f.works[1].workId));assert.ok(row);const picker=new HostPicker(title,[row],()=>{},()=>{},()=>8);const rendered=picker.render(80).map(stripTerminalSequences).join('\n');picker.dispose();assert.ok(rendered.includes(row.split(' · ')[0]));assert.ok(rendered.includes(row.split(' · ')[1].slice(0,12)));return row;}
  selectedId=title;return undefined;
 }});
 assert.equal(await h.run(''),'cancelled');assert.ok(selectedId.includes(f.works[1].workId));
});

for(const drift of ['menu','confirmation'])test('work recovery refuses a changed conversation language at '+drift+' before extension',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;let h,inputs=0;
 h=command(f,[],[],{choose:async(title,rows)=>{
  if(title.startsWith('Work recovery')){
   if(drift==='menu'){const l=f.c.getConversationLanguage(h.cid);f.c.setConversationLanguage({conversationId:h.cid,expectedGeneration:0,expectedRevision:l.revision,replyLanguage:'ko'});}
   return rows.find(row=>row.startsWith('Extend shared execution'));
  }
  if(drift==='confirmation'){const l=f.c.getConversationLanguage(h.cid);f.c.setConversationLanguage({conversationId:h.cid,expectedGeneration:0,expectedRevision:l.revision,replyLanguage:'ko'});}
  return rows[0];
 },input:async()=>++inputs===1?'2':'Explicit original reason'});
 const before=workLedger(f.c);await assert.rejects(h.run(id),/source changed/i);assert.deepEqual(workLedger(f.c),before);
});
test('Korean work recovery keeps localized navigation and original command operands',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;let executed;
 const h=command(f,[],[],{locale:()=> 'ko',choose:async(title,rows)=>{
  assert.match(title,/작업 복구/);assert.ok(rows.includes('보존된 작업과 한도 보기'));
  assert.ok(rows.some(row=>row.includes('계속하기 검토')&&row.endsWith('/change resume '+id)));
  assert.ok(rows.some(row=>row.includes('변경 내역 확인')&&row.endsWith('/change inspect '+id)));
  return rows.find(row=>row.includes('계속하기 검토')&&row.endsWith('/change resume '+id));
 },execute:async(...args)=>{executed=args;return 'completed';}});
 const before=workLedger(f.c);assert.equal(await h.run(id),'completed');assert.equal(executed[0],'/change resume '+id);assert.equal(executed[1],h.cid);assert.deepEqual(workLedger(f.c),before);
});

test('cancelling a managed resume from an explicit work ID returns to that work menu',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,before=workLedger(f.c),menus=[];
 const h=command(f,[],[],{choose:async(title,rows)=>{
  menus.push(title);
  return menus.length===1?rows.find(row=>row.startsWith('Review resume')):undefined;
 },execute:async command=>{assert.equal(command,'/change resume '+id);return 'cancelled';}});
 assert.equal(await h.run(id),'cancelled');
 assert.equal(menus.length,2);
 assert.ok(menus[0].includes(id));
 assert.equal(menus[0],menus[1]);
 assert.deepEqual(workLedger(f.c),before);
});

test('Korean shared allowance confirmation retains counters and changes only the selected limit',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,before=f.c.inspectWorkAllowance(id);let choices=0;
 const h=command(f,[],['3','Owner 한국어 exact reason'],{locale:()=> 'ko',choose:async(title,rows)=>{
  if(choices++===0)return uiText('ko','workRecovery.resolution');
  if(choices===3){assert.ok(title.includes(id));assert.ok(title.includes(uiText('ko','workRecovery.extended',{kind:uiText('ko','workRecovery.resolutionKind')})));return rows[0];}
  assert.match(title,/해결 한도 늘리기/);const review=JSON.parse(h.shown.map(page=>page.text).join(''));assert.deepEqual(review.change.before,before.resolution);assert.equal(review.change.after.limit,before.resolution.limit+3);return rows.find(row=>row.includes('3회 추가'));
 }});
 assert.equal(await h.run(id),'completed');const after=f.c.inspectWorkAllowance(id);assert.deepEqual(after.execution,before.execution);assert.equal(after.resolution.limit,before.resolution.limit+3);assert.equal(after.resolution.consumed,before.resolution.consumed);assert.equal(after.resolution.reserved,before.resolution.reserved);assert.match(h.notices[0],/공유 해결 한도 증가 완료/);
});
test('ambiguous translated work actions refuse before choice or dispatch',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,key='workRecovery.details',old=uiCatalogues.ko[key],before=workLedger(f.c);
 uiCatalogues.ko[key]=uiCatalogues.ko['workRecovery.execution'];
 try{const h=command(f,[],[],{locale:()=> 'ko',choose:async()=>assert.fail('Ambiguous choice must not open'),execute:async()=>assert.fail('Ambiguous choice must not dispatch')});await assert.rejects(h.run(id),/구분할 수 없습니다/);assert.deepEqual(workLedger(f.c),before);}finally{uiCatalogues.ko[key]=old;}
});

for(const locale of ['en','ko'])test(locale+' allowance confirmation follows complete exact review and defaults to no change at 80 columns',async t=>{
 const {HostPicker}=await import('../../dist/ui/host-picker.js'),{initTheme}=await import('@earendil-works/pi-coding-agent'),{stripTerminalSequences}=await import('@earendil-works/pi-tui');initTheme('dark',false);
 const f=await registryWorld(t),id=f.works[0].workId,expected=f.c.inspectWorkAllowance(id),pages=[];let choices=0;
 const h=command(f,[],['100','Exact owner reason 한국어'],{locale:()=>locale,show:async(title,text,primary)=>{pages.push({title,text});await primary?.run();},choose:async(title,rows)=>{
  choices++;
  if(choices===1)return uiText(locale,'workRecovery.execution');
  if(choices===3){
   assert.ok(title.startsWith(uiText(locale,'workRecovery.title',{id,state:''})));
   assert.equal(rows[0],uiText(locale,'workRecovery.backToSource'));
   return rows[0];
  }
  assert.ok(pages.length,'Complete proposed operands must be offered before confirmation');
  const review=JSON.parse(pages.map(p=>p.text).join(''));assert.deepEqual(review.original,expected);assert.equal(review.reason,'Exact owner reason 한국어');assert.deepEqual(review.change.before,expected.execution);assert.deepEqual(review.change.after,{...expected.execution,limit:expected.execution.limit+100});assert.equal(review.change.additional,100);assert.equal(review.change.kind,'execution');assert.equal(review.familyPreview.total,expected.family.count);assert.equal(review.familyPreview.shown,expected.family.workIds.length);assert.equal(review.familyPreview.omitted,expected.family.count-expected.family.workIds.length);
  assert.equal(rows[0],uiText(locale,'workRecovery.cancel'));assert.equal(rows.length,2);
  let selected;const picker=new HostPicker(title,rows,value=>{selected=value;},()=>{},()=>8);const rendered=picker.render(80).map(stripTerminalSequences).join('\n');assert.ok(rendered.includes(rows[1]),'Every acceptance label is fully visible at80columns');picker.handleInput('\r');picker.dispose();assert.equal(selected,rows[0]);return selected;
 }});
 const before=workLedger(f.c);assert.equal(await h.run(id),'cancelled');assert.deepEqual(workLedger(f.c),before);assert.equal(choices,3);
});
test('held managed work refreshes changed guidance before routing a selection',async t=>{
 const {HostPicker}=await import('../../dist/ui/host-picker.js'),{initTheme}=await import('@earendil-works/pi-coding-agent');initTheme('dark',false);
 const f=await registryWorld(t),id=f.works[0].workId,s=f.c.store;
 const blocker=reason=>s.run("UPDATE change_state SET phase='BLOCKED',data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify([reason]),id);
 blocker('\x1b[31mCannot verify the original check\n'+'가'.repeat(1500));
 const original=f.c.inspectWorkRecovery(id),locale='ko';let menus=0;
 const h=command(f,[],[],{locale:()=>locale,
  choose:async(title,rows)=>{
   menus++;
   assert.equal(rows[0],uiText(locale,'workRecovery.backToSource'));
   if(menus===1){
    assert.match(title,/Cannot verify the original check/);
    assert.equal(title.split('\n').length,3);
    assert.ok(!title.includes('\x1b[31m'));
    assert.ok(title.length<320);
    const picker=new HostPicker(title,rows,()=>{},()=>{},()=>8,locale);
    const lines=picker.render(55);picker.dispose();
    assert.ok(lines.some(line=>line.includes(rows[0])));
    assert.ok(lines.some(line=>line.includes(uiText(locale,'result.view'))));
    blocker('Original check record has changed');
    const latest=f.c.inspectWorkRecovery(id);
    assert.equal(latest.epoch,original.epoch);assert.equal(latest.recordedPhase,original.recordedPhase);
    return uiText(locale,'workRecovery.inspectRoute',{id});
   }
   assert.ok(title.includes(uiText(locale,'workRecovery.workChanged')));
   assert.match(title,/Original check record has changed/);
  },execute:async()=>assert.fail('A choice based on stale guidance cannot dispatch')});
 assert.equal(await h.run(id),'cancelled');assert.equal(menus,2);
 s.run("UPDATE works SET state='UNKNOWN' WHERE id=?",id);
 const uncertain=command(f,[(title,rows)=>{
  assert.ok(title.includes('Cleanup or settlement is unconfirmed.'));
  assert.ok(!title.includes('Original check record has changed'));
  assert.equal(rows[0],uiText('en','workRecovery.backToSource'));
 }]);
 assert.equal(await uncertain.run(id),'cancelled');
});
test('archived work origin offers a review with Back before restoring its exact conversation', async t => {
 const f=await registryWorld(t), id=f.works[0].workId;
 const origin=f.c.createConversation({projectId:'A'}), cid=origin.conversationId;
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Keep original draft'});
 f.c.store.run("UPDATE sources SET origin=json_set(origin,'$.conversationId',?) WHERE id=(SELECT source FROM works WHERE id=?)",cid,id);
 await f.c.archiveConversation({conversationId:cid,expectedGeneration:origin.generation});
 const before=workLedger(f.c), displayed=key=>uiText('en',key);
 const h=command(f,[
  (_title,rows)=>{
   assert.ok(!rows.includes(displayed('workRecovery.open')));
   assert.ok(rows.includes(displayed('workRecovery.reviewArchivedOrigin')));
   return displayed('workRecovery.reviewArchivedOrigin');
  },
  (title,rows)=>{
   assert.ok(title.includes(cid));
   assert.equal(rows[0],displayed('workRecovery.backToSource'));
   return rows[0];
  },
  (_title,rows)=>rows[0],
 ]);
 assert.equal(await h.run(id),'cancelled');
 assert.equal(f.c.inspectConversation(cid).archived,true);
 assert.deepEqual(workLedger(f.c),before);
});
for(const change of ['lifecycle-before-choice','source-during-reclaim','navigation-after-commit','deleted'])test('original archived work recovery '+change,async t=>{
 const f=await registryWorld(t), id=f.works[0].workId, c=f.c;
 const origin=c.createConversation({projectId:'A'}), cid=origin.conversationId, generation=origin.generation;
 const lifecycle={conversationId:cid,expectedGeneration:generation};
 const draft='Original archive draft 한국어';
 c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 c.store.run("UPDATE sources SET origin=json_set(origin,'$.conversationId',?) WHERE id=(SELECT source FROM works WHERE id=?)",cid,id);
 await c.archiveConversation(lifecycle);
 if(change==='deleted')await c.deleteConversation(lifecycle);
 const before=workLedger(c), label=(key,args)=>uiText('en',key,args);
 const first=(_title,rows)=>{
  assert.ok(!rows.includes(label('workRecovery.open')));
  if(change==='deleted'){
   assert.ok(_title.includes(label('workRecovery.originDeleted',{conversation:cid})));
   assert.ok(!rows.includes(label('workRecovery.reviewArchivedOrigin')));
   return rows[0];
  }
  return label('workRecovery.reviewArchivedOrigin');
 };
 const confirm=async()=>{
  if(change==='lifecycle-before-choice'){
   await c.restoreConversation(lifecycle);
   await c.archiveConversation(lifecycle);
  }
  return label('workRecovery.confirmRestoreOrigin');
 };
 if(change==='source-during-reclaim'){
  const reclaim=c.completed.reclaim.bind(c.completed);
  c.completed.reclaim=async(...args)=>{
   const result=await reclaim(...args);
   c.store.run("UPDATE sources SET origin=json_remove(origin,'$.conversationId') WHERE id=(SELECT source FROM works WHERE id=?)",id);
   return result;
  };
 }
 let navigation=0;
 const h=command(f,[first,confirm],[],{activate:async target=>{
  navigation++;
  assert.equal(change,'navigation-after-commit');
  assert.equal(target,cid);
  throw Error('Controlled navigation failure');
 }});
 if(change==='deleted')assert.equal(await h.run(id),'cancelled');
 else if(change==='navigation-after-commit')await assert.rejects(h.run(id),{message:label('workRecovery.restoredOriginOpenFailed',{conversation:cid})});
 else await assert.rejects(h.run(id),{message:label('workRecovery.conversationChanged')});
 const current=c.inspectConversation(cid);
 assert.equal(navigation,Number(change==='navigation-after-commit'));
 assert.equal(current.archived,change!=='navigation-after-commit');
 assert.equal(current.generation,generation);
 assert.equal(current.draft.text,draft);
 if(change==='source-during-reclaim'){
  const source=before.sources.find(row=>row.id===before.works.find(row=>row.id===id).source);
  c.store.run('UPDATE sources SET origin=? WHERE id=?',source.origin,source.id);
 }
 assert.deepEqual(workLedger(c),before);
});
test('work recovery refreshes an allowance hold and promotes only the required extension', async t => {
 const f=await registryWorld(t),id=f.works[0].workId,store=f.c.store;
 const display=(key,args)=>uiText('en',key,args);
 const resume=display('workRecovery.resumeRoute',{id});
 const extend=display('workRecovery.resolution');
 const exhaust=()=>store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='resolution'",id);
 const h=command(f,[
  (_title,rows)=>{
   assert.equal(f.c.inspectChangeContinuationPrerequisites(id).allowanceHold,undefined);
   assert.ok(rows.includes(resume));
   exhaust();
   return resume;
  },
  (title,rows)=>{
   assert.equal(f.c.inspectChangeContinuationPrerequisites(id).allowanceHold,'resolution');
   assert.ok(title.includes(display('workRecovery.workChanged')));
   assert.ok(title.includes('Before resuming, choose '+extend));
   assert.deepEqual(rows.slice(0,2),[display('workRecovery.backToSource'),extend]);
   assert.equal(rows.filter(row=>row===extend).length,1);
   assert.ok(rows.includes(display('workRecovery.execution')));
   assert.ok(!rows.includes(resume));
   return rows[0];
  },
 ],[],{execute:async()=>assert.fail('Stale Resume cannot dispatch')});
 assert.equal(await h.run(id),'cancelled');
});

test('work recovery refreshes choices when the original procedure assessment becomes unreadable and is restored',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,c=f.c;
 const original=c.store.one('SELECT phase,plan FROM change_state WHERE work=?',id),before=workLedger(c);
 const read=c.inspectWorkRecovery(id),label=(key,args)=>uiText('en',key,args);
 const route=label('workRecovery.inspectRoute',{id});
 const h=command(f,[
  (_title,rows)=>{
   assert.ok(rows.includes(route));
   c.store.run("UPDATE change_state SET phase='PLAN_READY',plan='missing-original-plan' WHERE work=?",id);
   return route;
  },
  (title,rows)=>{
   assert.ok(title.includes(label('workRecovery.workChanged'))&&title.includes(label('workRecovery.guidanceUnavailable')));
   assert.ok(!rows.includes(route));
   assert.ok(!rows.includes(label('workRecovery.resumeRoute',{id})));
   assert.ok(rows.includes(label('workRecovery.cancelRoute',{id})));
   c.store.run('UPDATE change_state SET phase=?,plan=? WHERE work=?',original.phase,original.plan,id);
   return label('result.view');
  },
  (title,rows)=>{
   assert.ok(title.includes(label('workRecovery.workChanged')));
   assert.ok(rows.includes(route));
   return rows[0];
  },
 ],[],{execute:async()=>assert.fail('Stale work action was selected'),show:async()=>assert.fail('Stale result opened')});
 assert.equal(await h.run(id),'cancelled');
 assert.deepEqual(c.inspectWorkRecovery(id),read);
 assert.deepEqual(workLedger(c),before);
});

for(const closeOn of [1,2])test('Escape on allowance review page '+closeOn+' returns to the same work without confirmation',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,before=workLedger(f.c);
 let pages=0,returned=false;
 const h=command(f,['Extend shared execution',(title,rows)=>{
  assert.ok(title.startsWith('Work recovery · #'+id));
  returned=true;
  return undefined;
 }],['1','x'.repeat(33000)],{show:async(_title,_text,primary)=>{
  pages++;
  assert.equal(primary?.label,pages===1?'Review next page':'Open confirmation');
  if(pages<closeOn)await primary.run();
 }});
 assert.equal(await h.run(id),'cancelled');
 assert.equal(pages,closeOn);assert.equal(returned,true);assert.deepEqual(workLedger(f.c),before);
});
for(const drift of ['other-budget','hidden-family'])for(const during of ['page','confirmation'])test('allowance exact review refuses '+drift+' drift during '+during+' before write',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,s=f.c.store;
 // Controlled dormant family rows isolate the bounded preview; this is not task standing.
 const row=s.one('SELECT * FROM works WHERE id=?',id),keys=Object.keys(row);
 for(let i=0;i<21;i++){const copy={...row,id:'preview-member-'+i,lineage:id};s.run('INSERT INTO works('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')',...keys.map(k=>copy[k]));}
 const expected=f.c.inspectWorkAllowance(id);assert.equal(expected.family.count,22);assert.equal(expected.family.workIds.length,20);assert.ok(!expected.family.workIds.includes('preview-member-0'));
 let choices=0,shown=0,afterExternal;
 const mutate=()=>{
  if(drift==='other-budget')s.run("UPDATE budgets SET lim=lim+1 WHERE lineage=? AND kind='resolution'",id);
  else s.run('UPDATE works SET lineage=? WHERE id=?','controlled-other-lineage','preview-member-0');
  const current=f.c.inspectWorkAllowance(id);assert.equal(current.epoch,expected.epoch);assert.deepEqual(current.family.workIds,expected.family.workIds);assert.equal(current.family.latestPosition,expected.family.latestPosition);afterExternal=workLedger(f.c);
 };
 const h=command(f,[],['1','x'.repeat(33000)],{choose:async(_title,rows)=>{choices++;if(choices===1)return uiText('en','workRecovery.execution');assert.equal(during,'confirmation','Changed page cannot reach confirmation');mutate();return rows[1];},show:async(_title,_text,primary)=>{shown++;if(during==='page')mutate();await primary?.run();}});
 await assert.rejects(h.run(id),/changed/);assert.equal(choices,during==='page'?1:2);if(during==='page')assert.equal(shown,1,'Changed source stops before a later exact page');else assert.ok(shown>1);assert.deepEqual(workLedger(f.c),afterExternal);
});
test('unsafe proposed allowance refuses before requesting a reason or displaying a rounded limit',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;f.c.store.run("UPDATE budgets SET lim=? WHERE lineage=? AND kind='execution'",Number.MAX_SAFE_INTEGER,id);let inputs=0;
 const h=command(f,['Extend shared execution'],[],{input:async()=>{inputs++;assert.equal(inputs,1);return '1';},show:async()=>assert.fail('Unsafe proposed values cannot reach review')});const before=workLedger(f.c);await assert.rejects(h.run(id),/safe whole-number limit/);assert.equal(inputs,1);assert.deepEqual(workLedger(f.c),before);
});

test('unreadable work can be left without losing its older registry page',async t=>{
 const f=await registryWorld(t),{c}=f, healthy=f.works[0].workId, broken=f.works[2].workId;
 await c.beginChange({projectId:'A',request:'Newest registered work'});
 const {conversationId:cid}=c.createConversation({projectId:'A'});
 c.setDraft({conversationId:cid,expectedRevision:0,text:'Independent draft 한국어'});
 const originalList=c.listWorks.bind(c);
 c.listWorks=options=>originalList({...options,limit:1});
 c.store.run("DELETE FROM budgets WHERE lineage=? AND kind='resolution'",broken);
 const before=workLedger(c), selected=[], shown=[];
 const [command]=workCommands({controller:c,isCurrent:()=>true,locale:()=> 'en',
  choose:async(title,rows)=>{
   selected.push({title,rows});
   const step=selected.length;
   if(step===1 || step===3){
    if(step===3)assert.deepEqual(selected[2],selected[1]);
    return 'Older works';
   }
   if(step===2)return rows.find(row=>row.includes('#'+broken));
   if(step===4)return rows.find(row=>row.includes('#'+healthy));
   if(step===5)return 'Inspect retained work and limits';
   if(step===6)return 'Back to work registry';
   assert.equal(step,7);
   return 'Close work registry';
  },
  show:async(title,text)=>shown.push({title,text}),
  input:async()=>assert.fail('Inspection opened an edit'),
  execute:async()=>assert.fail('Inspection dispatched work'),
  activate:async()=>assert.fail('Inspection changed conversation'),
  notice:()=>assert.fail('Inspection emitted an unrelated notice'),
 });
 assert.equal(await command.run('',cid),'cancelled');
 assert.equal(shown.length,2);
 assert.match(shown[0].title,new RegExp('^Original work unavailable · #'+broken+'$'));
 assert.match(shown[1].text,new RegExp(healthy));
 assert.deepEqual(workLedger(c),before);
 assert.equal(c.inspectConversation(cid).draft.text,'Independent draft 한국어');
});

for(const timing of ['direct','after choice'])test('work retains identity when its optional read fails '+timing,async t=>{
 const f=await registryWorld(t),{c}=f,id=f.works[0].workId;
 let expected, picks=0;
 const breakEvidence=()=>{
  c.store.run("UPDATE change_state SET data='{' WHERE work=?",id);
  expected=workLedger(c);
 };
 if(timing==='direct')breakEvidence();
 const h=command(f,[(_title,rows)=>{
  assert.equal(timing,'after choice');picks++;
  breakEvidence();
  return rows.find(row=>row.startsWith('Extend shared execution'));
 }],[],{
  input:async()=>assert.fail('Unreadable work opened an allowance form'),
  execute:async()=>assert.fail('Unreadable work dispatched an action'),
 });
 assert.equal(await h.run(id),'cancelled');
 assert.equal(picks,Number(timing==='after choice'));
 assert.equal(h.shown.length,1);
 assert.equal(h.shown[0].title,'Original work unavailable · #'+id);
 assert.deepEqual(workLedger(c),expected);
});

test('a damaged request preview does not erase the original work or other registry rows',async t=>{
 const f=await registryWorld(t),{c}=f,broken=f.works[2].workId,healthy=f.works[0].workId;
 c.store.run("UPDATE sources SET raw=CAST('not a readable text field' AS BLOB) WHERE id=(SELECT source FROM works WHERE id=?)",broken);
 const before=workLedger(c);
 const h=command(f,[
  (_title,rows)=>{
   assert.ok(rows.some(row=>row.includes('#'+healthy)));
   const row=rows.find(row=>row.includes('#'+broken));
   assert.match(row,/request unavailable/);
   return row;
  },
  'Close work registry',
 ],[],{execute:async()=>assert.fail('Reading a damaged preview dispatched an action')});
 assert.equal(await h.run(''),'cancelled');
 assert.equal(h.shown.length,1);
 assert.equal(h.shown[0].title,'Original work unavailable · #'+broken);
 assert.deepEqual(workLedger(c),before);
});

test('an unknown direct work ID refuses before opening a retained inspection',async t=>{
 const f=await registryWorld(t),h=command(f,[()=>assert.fail('Unknown direct ID opened a picker')]);
 await assert.rejects(h.run('unknown-original-work'),error=>error.code==='MISSING_WORK'&&error.workId==='unknown-original-work');
 assert.deepEqual(h.shown,[]);
});
