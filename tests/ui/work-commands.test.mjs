import path from 'node:path';
import test from 'node:test';import assert from 'node:assert/strict';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';
import {HostCommands} from '../../dist/ui/host-commands.js';import {workCommands} from '../../dist/ui/work-commands.js';
import {scripted} from '../controller/effect-fixture.mjs';
function command(f,choices,inputs=[],hooks={}){const notices=[],shown=[];const cid=f.c.createConversation().conversationId;let step=0;const registry=new HostCommands(workCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const v=choices[step++];return typeof v==='function'?v(title,rows):rows.find(r=>r.startsWith(v??'IMPOSSIBLE'));},input:async()=>inputs.shift(),show:async(title,text)=>shown.push({title,text}),notice:text=>notices.push(text),activate:async()=>assert.fail('Unexpected navigation'),...hooks}));return{run:argument=>registry.execute('/work '+argument,cid),cid,notices,shown};}
test('all-work registry includes actual ordinary work; paging and inspection do not consume or reset records',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId;await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original ordinary request',mode:'idle'});const oldTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(f.home,'artifacts');let result;try{result=await f.c.runConversation({conversationId:cid,model:scripted(()=>({text:'Observed only'}))});}finally{if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;}assert.equal(result.status,'delivered',JSON.stringify(result));const page=f.c.listWorks({limit:1});assert.equal(page.works[0].workId,result.workId);assert.equal(page.works[0].recordedPhase,null);assert.ok(page.nextCursor);assert.equal(f.c.listWorks({limit:1,before:page.nextCursor}).works.length,1);assert.throws(()=>f.c.listWorks({limit:0}),/bounded/);
 const h=command(f,['Inspect retained work and limits','Back to all works']),before=workLedger(f.c);assert.equal(await h.run(result.workId),'cancelled');assert.deepEqual(workLedger(f.c),before);assert.ok(h.shown[0].text.includes('Original ordinary request'));assert.ok(h.shown[0].text.includes('Goal turn allowance is separate'));await f.c.close();
});
test('owner work extension changes only its shared limit and records its exact reason; goal turns stay separate',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,goal=f.c.createGoal({conversationId:f.c.createConversation().conversationId,objective:'Keep goal budget',criteria:['Separate counters'],turnLimit:3}),before=f.c.inspectWorkAllowance(id),g=f.c.inspectGoal(goal.goalId);
 const h=command(f,['Extend shared execution allowance','Add 3 execution'],['3','Explicit owner recovery']);assert.equal(await h.run(id),'completed');const after=f.c.inspectWorkAllowance(id);assert.equal(after.execution.limit,before.execution.limit+3);assert.equal(after.execution.consumed,before.execution.consumed);assert.equal(after.execution.reserved,before.execution.reserved);assert.deepEqual(after.resolution,before.resolution);assert.deepEqual(f.c.inspectGoal(goal.goalId),g);assert.equal(f.c.store.one("SELECT raw FROM sources WHERE json_extract(origin,'$.kind')='owner-budget-extension' ORDER BY rowid DESC LIMIT 1").raw,'Explicit owner recovery');
 const resolution=command(f,['Extend shared resolution allowance','Add 2 resolution'],['2','Bounded independent resolution']);await resolution.run(id);assert.equal(f.c.inspectWorkAllowance(id).resolution.limit,after.resolution.limit+2);assert.equal(f.c.inspectWorkAllowance(id).execution.limit,after.execution.limit);
});
test('cancelled and stale forms leave the selected shared allowance intact; unknown cleanup and busy siblings refuse',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,sibling=f.works[1].workId;f.c.store.run('UPDATE works SET lineage=? WHERE id=?',id,sibling);
 const before=workLedger(f.c);assert.equal(await command(f,['Extend shared execution allowance'],[undefined]).run(id),'cancelled');assert.deepEqual(workLedger(f.c),before);
 const snapshot=f.c.inspectWorkAllowance(id);f.c.extendExecutionAllowance({workId:sibling,additional:1,reason:'Concurrent actual owner extension'});const stale=workLedger(f.c);assert.throws(()=>f.c.extendWorkAllowance({expected:snapshot,kind:'execution',additional:1,reason:'Old confirmation'}),/changed/);assert.deepEqual(workLedger(f.c),stale);
 const form=command(f,['Extend shared execution allowance',(_title,rows)=>rows[0]],[],{input:async(title)=>{if(title.startsWith('Additional')){f.c.extendExecutionAllowance({workId:sibling,additional:1,reason:'Concurrent extension while form open'});return '2';}return 'Owner confirmation from stale form';}});
 await assert.rejects(form.run(id),/changed/);
 const snap=f.c.inspectWorkAllowance(id);f.c.active.set(sibling,{done:Promise.resolve(),abort:new AbortController()});assert.throws(()=>f.c.extendWorkAllowance({expected:snap,kind:'execution',additional:1,reason:'Cannot extend busy sibling'}),/active/);f.c.active.delete(sibling);
 const run=f.c.store.one('SELECT id FROM runs WHERE work=?',sibling);f.c.store.run('UPDATE runs SET phase=? WHERE id=?','UNKNOWN',run.id);assert.throws(()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(id),kind:'resolution',additional:1,reason:'Cannot reconcile by extending'}),/unsettled/);f.c.store.run('UPDATE runs SET phase=? WHERE id=?','SETTLED',run.id);
 for(const state of ['QUEUED','SETTLING','QUARANTINED']){
  f.c.store.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)','fixture-lease',sibling,run.id,1,999,state,'{"fixture":"non-executing owner recovery hold"}');
  assert.throws(()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(id),kind:'execution',additional:1,reason:'No bypass through settled sibling'}),/unsettled/);f.c.store.run('DELETE FROM capacity_leases WHERE id=?','fixture-lease');
 }
 f.c.store.run('UPDATE budgets SET lim=? WHERE lineage=? AND kind=?',Number.MAX_SAFE_INTEGER,id,'execution');assert.throws(()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(id),kind:'execution',additional:1,reason:'No unsafe arithmetic'}),/safe finite/);
});
test('paged findings preserve duplicate occurrences, original role/candidate and diagnostic obligations',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,run=f.c.store.one('SELECT id FROM runs WHERE work=?',id).id;
 // Controlled ledger records test recovery rendering, not a successful independent review.
 f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','L',id,run,'reviewer',1,'UNUSABLE','none',JSON.stringify({inputVersions:{candidate:'UNSELECTED_FIXTURE_CANDIDATE'}}));f.c.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)','O','L','Retained raw fixture','UNUSABLE','{}');
 for(let n=0;n<27;n++)f.c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)','F'+n,'O',n,id,JSON.stringify({finding:{description:'Repeated exact observation',severity:'blocking'}}));
 f.c.store.run('INSERT INTO obligations VALUES(?,?,?)','D',id,JSON.stringify({kind:'diagnostic',state:'pending',issues:['Malformed original reviewer result']}));
 const page=f.c.listWorkEvidence(id,'findings');assert.equal(page.items.length,25);assert.equal(f.c.listWorkEvidence(id,'findings',page.nextCursor).items.length,2);assert.equal(page.items[0].producer.role,'reviewer');assert.equal(page.items[0].producer.candidate,'UNSELECTED_FIXTURE_CANDIDATE');assert.equal(page.items[0].disposition,null);
 const h=command(f,['Finding occurrences',(_title,rows)=>rows[0],'Older evidence',(_title,rows)=>rows[0],'Close evidence','Obligations',(_title,rows)=>rows[0],'Close evidence','Back to all works']);const before=workLedger(f.c);await h.run(id);assert.equal(h.shown.length,3);assert.ok(h.shown[0].text.includes('Repeated exact observation'));assert.ok(h.shown[2].text.includes('Malformed original reviewer result'));assert.deepEqual(workLedger(f.c),before);
});
test('authoritative family UNKNOWN and settled-phase reservations refuse with no extension write',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,sibling=f.works[1].workId;f.c.store.run('UPDATE works SET lineage=? WHERE id=?',id,sibling);const attempt=()=>f.c.extendWorkAllowance({expected:f.c.inspectWorkAllowance(id),kind:'execution',additional:1,reason:'Cannot turn an unsettled family into authority'});
 for(const state of ['UNKNOWN','QUARANTINED']){f.c.store.run('UPDATE works SET state=? WHERE id=?',state,sibling);const before=workLedger(f.c);assert.throws(attempt,/unsettled/);assert.deepEqual(workLedger(f.c),before);}f.c.store.run('UPDATE works SET state=? WHERE id=?','ACTIVE',sibling);
 const run=f.c.store.one('SELECT id FROM runs WHERE work=?',sibling);f.c.store.run('UPDATE runs SET phase=?,reservation=? WHERE id=?','SETTLED','reserved',run.id);const before=workLedger(f.c);assert.throws(attempt,/unsettled/);assert.deepEqual(workLedger(f.c),before);
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

test('direct work Back opens the registry while Escape closes the review',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;let registry=0;
 const h=command(f,[],[],{choose:async(title,rows)=>{if(title.startsWith('Work recovery'))return 'Back to all works';registry++;assert.match(title,/Original work and allowances/);return 'Close work registry';}});
 assert.equal(await h.run(id),'cancelled');assert.equal(registry,1);
 const escape=command(f,[],[],{choose:async()=>undefined});assert.equal(await escape.run(id),'cancelled');
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
