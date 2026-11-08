import test from 'node:test';
import assert from 'node:assert/strict';
import {shared,target} from '../contributions/publication-fixture.mjs';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
const snapshot=c=>JSON.stringify(c.store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,c.store.all('SELECT * FROM "'+name+'" ORDER BY rowid')]));
async function world(t){const f=await shared();t.after(()=>f.close());f.source=f.c.createConversation().conversationId;const targetId=f.c.registerPublicationTarget({target,visibility:'public'}).targetId;f.op=await f.c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body:'Retain exact original publication'}});return f;}
function command(f,choices,extra={}){const shown=[],ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next===undefined)return;const pick=rows.find(row=>row.startsWith(next));assert.ok(pick,'Missing '+next+' in '+JSON.stringify(rows));return pick;},input:async()=>assert.fail('No credential for retained reads'),show:async(title,text)=>shown.push({title,text}),notice(){},...extra});return {ui,shown,run:()=>ui.commands[0].run('',f.source)};}
test('repository publication discovery/inspection is pure and preserves recorded outcome distinctions',async t=>{
    const f=await world(t),before=snapshot(f.c),calls=f.requests.length,h=command(f,['Retained publications','owner/repo','Inspect original publication facts','Back','Close']);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);const shown=JSON.parse(h.shown[0].text);assert.equal(shown.publication.operationId,f.op.operationId);assert.equal(shown.entry.recordedPhase,'RESERVED');assert.equal(shown.publication.transportOutcome,null);assert.match(shown.scope,/causal transport/);
});
test('stale source or original facts refuse selection before showing another view',async t=>{
    const f=await world(t);let current=true;
    const moved=command(f,['Retained publications',(_title,rows)=>{current=false;return rows[0];}],{isCurrent:()=>current});await assert.rejects(moved.run(),/source changed/);await moved.ui.close();assert.deepEqual(moved.shown,[]);
    const stale=command(f,['Retained publications','owner/repo',()=>{f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.blocked',json(?)) WHERE id=?",'["new retained blocker"]',f.op.operationId);return 'Inspect original publication facts';}]);await assert.rejects(stale.run(),/facts changed/);await stale.ui.close();assert.deepEqual(stale.shown,[]);
});
test('unavailable original remains discoverable without throwing away its ID or performing repair',async t=>{
    const f=await world(t);f.c.store.run("UPDATE effect_operations SET data='{' WHERE id=?",f.op.operationId);const before=snapshot(f.c),h=command(f,['Retained publications','Unavailable retained','Back','Close']);await h.run();await h.ui.close();assert.match(h.shown[0].title,/no repair performed/);assert.ok(h.shown[0].text.includes(f.op.operationId));assert.equal(snapshot(f.c),before);
});

for(const outcome of ['started','cancelled'])test('publication original-work recovery forwards '+outcome+' without publication requests or reset',async t=>{
 const f=await world(t),before=snapshot(f.c),requests=f.requests.length,id=f.c.inspectRetainedPublication(f.op.operationId).view.workId,context={submission:{conversationId:f.source,text:'/repo',revision:3}};
 const h=command(f,['Retained publications','owner/repo','Open original work recovery','Open original work recovery'],{execute:async(command,target,ctx)=>{assert.equal(command,'/work '+id);assert.equal(target,f.source);assert.equal(ctx,context);return outcome;}});
 assert.equal(await h.ui.commands[0].run('',f.source,context),outcome);await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,requests);
});
