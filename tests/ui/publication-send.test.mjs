import test from 'node:test';
import assert from 'node:assert/strict';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import {resource} from '../contributions/fixture.mjs';
import {preparedPublicationFixture} from './publication-send-fixture.mjs';
const snapshot=c=>JSON.stringify(c.store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,c.store.all('SELECT * FROM "'+name+'" ORDER BY rowid')]));
function command(f,choices,inputs=[f.credential],extra={}){const shown=[],ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next===undefined)return;const pick=rows.find(row=>row.startsWith(next));assert.ok(pick,'Missing '+next+' in '+JSON.stringify(rows));return pick;},input:async()=>{const next=inputs.shift();return typeof next==='function'?next():next;},show:async(title,text)=>shown.push({title,text}),notice(){},...extra});return {ui,shown,run:()=>ui.commands[0].run('',f.source)};}
const choices=['Retained publications','owner/repo','Review and send original prepared publication','Send this original prepared publication','Back','Close'];
test('complete sealed carrier review reaches original once-only send without replacing work, payload or grants',async t=>{
 const f=await preparedPublicationFixture(t,'Start '+('본문 literal\\n '.repeat(4200))+' FINAL_OWNER_SUFFIX\u0085\u009b'),before=f.c.inspectPublicationDispatch(f.op.operationId),grants=f.c.store.all('SELECT * FROM effect_delegations'),h=command(f,[...choices]);
 assert.equal(await h.run(),'completed');await h.ui.close();const reviewPages=h.shown.filter(row=>row.title.startsWith('Review exact original publication'));assert.ok(reviewPages.every(row=>row.text.length<=32000&&!/[\u0080-\u009f]/u.test(row.text)));assert.match(reviewPages.map(row=>row.text).join(''),/\\u0085/);const review=JSON.parse(reviewPages.map(row=>row.text).join(''));assert.equal(review.payloadUtf8,before.payloadUtf8);assert.equal(review.payloadBytes,Buffer.byteLength(before.payloadUtf8));assert.ok(reviewPages.length>1);assert.ok(review.payloadUtf8.includes('FINAL_OWNER_SUFFIX'));assert.ok(review.payloadUtf8.includes(f.op.operationId));assert.equal(f.posts.length,1);assert.equal(f.posts[0].body,JSON.parse(before.payloadUtf8).body);
 const view=f.c.inspectPublication(f.op.operationId),after=f.c.inspectPublicationReconciliation(f.op.operationId);assert.equal(view.phase,'CONFIRMED');assert.equal(view.payloadHash,before.payloadHash);assert.equal(after.execution.consumed,before.context.execution.consumed+1);assert.equal(after.execution.reserved,0);assert.equal(after.execution.limit,before.context.execution.limit);assert.deepEqual(f.c.store.all('SELECT * FROM effect_delegations'),grants);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM effect_operations').n,1);f.pass();
});
test('default Back and credential cancellation preserve every original row with no native request',async t=>{
 const f=await preparedPublicationFixture(t),before=snapshot(f.c),calls=f.requests.length;
 for(const [selected,inputs] of [[choices.slice(0,3).concat([(_title,rows)=>{assert.equal(rows[0],'Back without sending');return rows[0];},'Back','Close']),[]],[choices,[]]]){const h=command(f,[...selected],inputs);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);}f.pass();
});
for(const drift of ['payload','phase','budget','source'])test('send review refuses '+drift+' drift before configuring or dispatching',async t=>{
 const f=await preparedPublicationFixture(t),calls=f.requests.length;let current=true;
 const h=command(f,[...choices],[()=>{if(drift==='payload')f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.action.body','changed payload') WHERE id=?",f.op.operationId);if(drift==='phase')f.c.store.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",f.op.operationId);if(drift==='budget')f.c.store.run("UPDATE budgets SET consumed=consumed+1 WHERE lineage=? AND kind='execution'",f.op.workId);if(drift==='source')current=false;return f.credential;}],{isCurrent:()=>current});
 await assert.rejects(h.run(),/changed|unavailable|uncertain/);await h.ui.close();assert.equal(f.requests.length,calls);assert.equal(f.posts.length,0);f.pass();
});
test('unsettled original producer and exhausted allowance refuse before any native send attempt',async t=>{
 for(const blocked of ['producer','exhausted']){const f=await preparedPublicationFixture(t);if(blocked==='producer')f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','controlled-hold',f.op.workId,1,1,'INTERRUPTED',f.root,'consumed','{"kind":"publication-http","cleanup":"quarantined-cleanup"}');else f.c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='execution'",f.op.workId);
 const before=snapshot(f.c),calls=f.requests.length,h=command(f,choices.slice(0,3));await assert.rejects(h.run(),blocked==='producer'?/unsettled/:/exhausted/);await h.ui.close();if(blocked==='producer')await assert.rejects(f.c.dispatchPublication({operationId:f.op.operationId}),/unsettled/);assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);if(blocked==='producer')f.c.store.run('DELETE FROM runs WHERE id=?','controlled-hold');f.pass();}
});
test('changed native account refuses before POST and reports actual REFUSED phase',async t=>{
 const f=await preparedPublicationFixture(t);
 // Replace only owned native identity response, retaining original public controller path.
 const listener=f.server.listeners('request')[0];f.server.removeListener('request',listener);f.server.on('request',(req,res)=>{if(req.url==='/user'){res.writeHead(200,{'content-type':'application/json'});res.end('{"id":99,"type":"User","login":"other"}');}else return listener(req,res);});
 const h=command(f,[...choices]);await h.run();await h.ui.close();assert.equal(f.posts.length,0);assert.equal(f.c.inspectPublication(f.op.operationId).phase,'REFUSED');assert.ok(h.shown.some(row=>row.text.includes('REFUSED')));f.pass();
});
test('lost POST response retains UNKNOWN original and offers reconciliation without any send option',async t=>{
 const f=await preparedPublicationFixture(t),held=f.holdDrop();let checked=false;
 const h=command(f,choices.slice(0,4).concat(['owner/repo',(_title,rows)=>{checked=true;assert.ok(rows.some(row=>row.startsWith('Reconcile original')));assert.ok(rows.every(row=>!row.includes('send original')));return 'Back without action';},'Back','Close'])),task=h.run();await held.entered;held.release();await task;await h.ui.close();assert.ok(checked);assert.equal(f.posts.length,1);assert.equal(f.c.inspectPublication(f.op.operationId).phase,'UNKNOWN');await assert.rejects(async()=>f.c.inspectPublicationDispatch(f.op.operationId),/uncertain/);f.pass();
});
for(const handoff of [false,true])test('joined UI close '+(handoff?'after POST preserves uncertain original':'during preflight sends no POST'),async t=>{
 const f=await preparedPublicationFixture(t);await f.c.trackRepositoryResource(resource(1));const held=handoff?f.holdDrop():f.holdPreflight(),before=f.c.inspectPublicationDispatch(f.op.operationId),h=command(f,[...choices]),task=h.run();void task.catch(()=>{});await held.entered;
 const competing=command(f,['Tracked issues','github','Refresh selected']);await assert.rejects(competing.run(),/owns the credential session/);await competing.ui.close();
 await h.ui.close();await Promise.allSettled([task]);held.release();const after=f.c.inspectPublicationReconciliation(f.op.operationId);assert.equal(after.execution.consumed,before.context.execution.consumed+1);assert.equal(after.execution.reserved,0);assert.equal(f.posts.length,handoff?1:0);assert.equal(f.c.inspectPublication(f.op.operationId).phase,handoff?'UNKNOWN':'REFUSED');f.pass();
});
test('late navigation preserves the original accepted send and identifies it without presenting elsewhere',async t=>{
 const f=await preparedPublicationFixture(t);let current=true;f.onPost(()=>{current=false;});const h=command(f,[...choices],[f.credential],{isCurrent:()=>current});await assert.rejects(h.run(),error=>error.message.includes(f.op.operationId));await h.ui.close();assert.equal(f.c.inspectPublication(f.op.operationId).phase,'CONFIRMED');assert.equal(h.shown.length,1);assert.equal(f.posts.length,1);f.pass();
});


test('confirmed original remains a pure idempotent result read even with an unrelated active producer',async t=>{
 const f=await preparedPublicationFixture(t);const sent=await f.c.dispatchPublication({operationId:f.op.operationId});assert.equal(sent.phase,'CONFIRMED');
 f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','controlled-active',f.op.workId,1,1,'RUNNING',f.root,'reserved','{"kind":"ordinary-conversation"}');const before=snapshot(f.c),calls=f.requests.length;
 assert.deepEqual(await f.c.dispatchPublication({operationId:f.op.operationId}),sent);assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);assert.equal(f.posts.length,1);f.c.store.run('DELETE FROM runs WHERE id=?','controlled-active');f.pass();
});

test('source drift during an early carrier page refuses before later pages or confirmation',async t=>{
 const f=await preparedPublicationFixture(t,'long '.repeat(16000)),calls=f.requests.length;let current=true,pages=0;
 const h=command(f,choices.slice(0,3),[],{isCurrent:()=>current,show:async()=>{pages++;current=false;}});await assert.rejects(h.run(),/source changed/);await h.ui.close();assert.equal(pages,1);assert.equal(f.requests.length,calls);assert.equal(f.posts.length,0);f.pass();
});
test('retained dispatch intent never exposes a send action even if recorded phase is RESERVED',async t=>{
 const f=await preparedPublicationFixture(t);f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.dispatchIntent',1) WHERE id=?",f.op.operationId);const before=snapshot(f.c),calls=f.requests.length;
 const h=command(f,['Retained publications','owner/repo',(_title,rows)=>{assert.ok(rows.every(row=>!row.includes('send original')));return 'Back without action';},'Back','Close'],[]);await h.run();await h.ui.close();assert.throws(()=>f.c.inspectPublicationDispatch(f.op.operationId),/uncertain/);assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);f.pass();
});
