import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import {summaryPublicationFixture} from './summary-publication-fixture.mjs';
const snapshot=c=>JSON.stringify(c.store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,c.store.all('SELECT * FROM "'+name+'" ORDER BY rowid')]));
function command(f,choices,inputs=[f.credential],extra={}){const shown=[],ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next===undefined)return;const selected=rows.find(row=>row.startsWith(next));assert.ok(selected,'Missing '+next+' in '+JSON.stringify(rows));return selected;},input:async()=>{const next=inputs.shift();return typeof next==='function'?next():next;},show:async(title,text)=>shown.push({title,text}),notice(){},...extra});return {ui,shown,run:()=>ui.commands[0].run('',f.source)};}
const route=['Tracked issues','github · owner/repo · issue #8','Prepare publication from current local summary','owner/repo','Prepare this exact summary publication','Back','Close'];
test('current host summary prepares through original GET-only producer, duplicate reuses identity, separate reviewed send publishes once',async t=>{
 const f=await summaryPublicationFixture(t),proof=f.c.inspectCurrentContributionSummary(f.parent.resourceId),summary=f.c.store.one('SELECT * FROM summary_revisions WHERE id=?',f.summary.revisionId),h=command(f,[...route]);assert.equal(await h.run(),'completed');await h.ui.close();assert.equal(f.posts.length,0);assert.ok(f.requests.length>0&&f.requests.every(r=>r.method==='GET'));
 const view=JSON.parse(h.shown.at(-1).text),review=JSON.parse(h.shown.filter(r=>r.title.startsWith('Review host summary')).map(r=>r.text).join(''));assert.equal(view.phase,'RESERVED');assert.deepEqual(review.summary,proof);assert.equal(review.target.targetId,f.targetId);const data=JSON.parse(f.c.store.one('SELECT data FROM effect_operations WHERE id=?',view.operationId).data);assert.equal(data.action.body,proof.body);assert.equal(data.contributionSnapshot.revisionId,f.summary.revisionId);assert.deepEqual(f.c.store.one('SELECT * FROM summary_revisions WHERE id=?',f.summary.revisionId),summary);
 const stable=snapshot(f.c),calls=f.requests.length,again=command(f,[...route]);await again.run();await again.ui.close();assert.equal(snapshot(f.c),stable);assert.equal(f.requests.length,calls);assert.equal(JSON.parse(again.shown.at(-1).text).operationId,view.operationId);
 const sending=command(f,['Retained publications','owner/repo','Review and send original','Send this original','Back','Close']);await sending.run();await sending.ui.close();assert.equal(f.posts.length,1);assert.ok(f.posts[0].body.startsWith(proof.body));assert.equal(f.c.inspectPublication(view.operationId).phase,'CONFIRMED');assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,1);f.pass();
});
test('explicit default-policy registration comes from same retained GitHub identity and allocates only after credential acceptance',async t=>{
 const f=await summaryPublicationFixture(t,{withTarget:false}),path=route.slice(0,3).concat(['Register default-policy','owner/repo','Prepare this exact', 'Back','Close']),before=snapshot(f.c),calls=f.requests.length;
 const cancelled=command(f,path.slice(0,-2).concat(['Back','Back','Close']),[]);await cancelled.run();await cancelled.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);
 const h=command(f,[...path]);await h.run();await h.ui.close();const result=JSON.parse(h.shown.at(-1).text),targets=f.c.listPublicationTargets().targets;assert.equal(targets.length,1);assert.equal(targets[0].targetId,result.targetId);assert.equal(targets[0].target.actorUserId,7);assert.deepEqual(targets[0].carrierPolicy.allowedMentions,[]);assert.equal(f.posts.length,0);assert.equal(f.c.inspectPublication(result.operationId).phase,'RESERVED');f.pass();
});
for(const drift of ['membership','revision','target','source'])test('summary preparation refuses '+drift+' drift after review without new original allocation',async t=>{
 const f=await summaryPublicationFixture(t),calls=f.requests.length;let current=true;const h=command(f,[...route],[()=>{
  if(drift==='membership')f.c.store.run('DELETE FROM summary_members WHERE revision=?',f.summary.revisionId);
  if(drift==='revision')f.c.store.run("UPDATE summary_revisions SET data=json_set(data,'$.body','author changed host bytes') WHERE id=?",f.summary.revisionId);
  if(drift==='target')f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.carrierPolicy.knownPrivateLiterals',json(?)) WHERE id=?",'["Human change1"]',f.targetId);
  if(drift==='source')current=false;return f.credential;
 }],{isCurrent:()=>current});await assert.rejects(h.run(),/changed|incomplete|stale|unavailable/);await h.ui.close();assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);assert.equal(f.requests.length,calls);assert.equal(f.posts.length,0);f.pass();
});
test('missing/incomplete local summary refuses with no work, native requests or supplied-body fallback',async t=>{
 for(const missing of [true,false]){const f=await summaryPublicationFixture(t);if(missing){f.c.store.run('DELETE FROM summary_members WHERE revision=?',f.summary.revisionId);f.c.store.run('DELETE FROM summary_revisions WHERE id=?',f.summary.revisionId);}else f.c.store.run("UPDATE summary_revisions SET data=json_set(data,'$.complete',json('false')) WHERE id=?",f.summary.revisionId);
 const before=snapshot(f.c),calls=f.requests.length,h=command(f,route.slice(0,3),[]);await assert.rejects(h.run(),missing?/prepare a local summary/:/incomplete/);await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);f.pass();}
});
test('target discovery is bounded, preserves malformed identities and performs no work or request',async t=>{
 const f=await summaryPublicationFixture(t);f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','malformed-target',null,'{');f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','oversized-target',null,JSON.stringify({kind:'github-publication',padding:'x'.repeat(140000)}));let before=snapshot(f.c),calls=f.requests.length;
 const page=f.c.listPublicationTargets();assert.equal(page.targets.find(row=>row.targetId==='malformed-target').state,'UNAVAILABLE');assert.equal(page.targets.find(row=>row.targetId==='oversized-target').state,'UNAVAILABLE');assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);
 f.c.store.tx(()=>{for(let i=0;i<254;i++)f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',randomUUID(),null,'{"kind":"github-publication"}');});before=snapshot(f.c);assert.throws(()=>f.c.listPublicationTargets(),/bounded/);assert.equal(snapshot(f.c),before);f.pass();
});
test('preflight close joins original attempt, retains refusal and consumed allowance with no POST',async t=>{
 const f=await summaryPublicationFixture(t),held=f.holdPreflight(),h=command(f,[...route]),task=h.run();void task.catch(()=>{});await held.entered;const op=f.c.store.one('SELECT id,work FROM effect_operations');await h.ui.close();await Promise.allSettled([task]);held.release();assert.equal(f.posts.length,0);assert.equal(f.c.inspectPublication(op.id).phase,'REFUSED');const budget=f.c.inspectWork(op.work).allowance;assert.equal(budget.consumed,1);assert.equal(budget.reserved,0);f.pass();
});
test('uncertain original lineage blocks preparation of a new current revision with no replacement or reset',async t=>{
 const f=await summaryPublicationFixture(t),h=command(f,[...route]);await h.run();await h.ui.close();const op=f.c.store.one('SELECT id,work FROM effect_operations'),held=f.holdDrop(),task=f.c.dispatchPublication({operationId:op.id});await held.entered;held.release();await task;
 f.merged.add(2);await f.c.refreshContributions({resourceIds:[f.other.resourceId]});f.c.prepareContributionSummary({resourceId:f.parent.resourceId});const stable=snapshot(f.c),calls=f.requests.length,again=command(f,[...route]);await assert.rejects(again.run(),/uncertain/);await again.ui.close();assert.equal(snapshot(f.c),stable);assert.equal(f.requests.length,calls);assert.equal(f.posts.length,1);f.pass();
});
test('late accepted preparation identifies its original operation without presenting it in another conversation',async t=>{
 const f=await summaryPublicationFixture(t),held=f.holdPreflight();let current=true;const h=command(f,[...route],[f.credential],{isCurrent:()=>current}),task=h.run();void task.catch(()=>{});await held.entered;current=false;held.release();await assert.rejects(task,error=>error.message.includes('Original publication'));await h.ui.close();assert.equal(f.c.store.one('SELECT phase FROM effect_operations').phase,'RESERVED');assert.equal(h.shown.length,1);assert.equal(f.posts.length,0);f.pass();
});
