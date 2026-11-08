import test from 'node:test';
import assert from 'node:assert/strict';
import {shared,target} from '../contributions/publication-fixture.mjs';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {projectCommands} from '../../dist/ui/project-commands.js';
import {errorCommands} from '../../dist/ui/error-commands.js';
import {failurePresentation} from '../../dist/ui/failure-details.js';
import {translator} from '../../dist/ui/i18n.js';
const snapshot=c=>JSON.stringify(c.store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,c.store.all('SELECT * FROM "'+name+'" ORDER BY rowid')]));
async function world(t){const f=await shared();t.after(()=>f.close());f.source=f.c.createConversation().conversationId;const targetId=f.c.registerPublicationTarget({target,visibility:'public'}).targetId;f.op=await f.c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body:'Retain exact original publication'}});return f;}
function command(f,choices,extra={}){const shown=[],ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next===undefined)return;const pick=rows.find(row=>row.startsWith(next));assert.ok(pick,'Missing '+next+' in '+JSON.stringify(rows));return pick;},input:async()=>assert.fail('No credential for retained reads'),show:async(title,text)=>shown.push({title,text}),notice(){},...extra});return {ui,shown,run:()=>ui.commands[0].run('',f.source)};}
test('repository publication discovery/inspection is pure and preserves recorded outcome distinctions',async t=>{
    const f=await world(t),before=snapshot(f.c),calls=f.requests.length,h=command(f,['Retained publications','owner/repo','Inspect original publication facts',title=>{assert.ok(title.includes(f.op.operationId));return 'Back without action';},'Back','Close']);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);const shown=JSON.parse(h.shown[0].text);assert.equal(shown.publication.operationId,f.op.operationId);assert.equal(shown.entry.recordedPhase,'RESERVED');assert.equal(shown.publication.transportOutcome,null);assert.match(shown.scope,/causal transport/);
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

test('the exact repository operation opens its publication directly and Back stays read-only',async t=>{
 const f=await world(t),before=snapshot(f.c),calls=f.requests.length,id=f.op.operationId,work=f.c.inspectRetainedPublication(id).view.workId,titles=[];
 const h=command(f,[],{choose:async(title,rows)=>{titles.push(title);return rows[0];}});
 assert.equal(await h.ui.commands[0].run('operation '+id+' '+work,f.source),'cancelled');
 assert.equal(titles.length,1);assert.equal(titles[0].split('\n')[0],'Original publication · '+id);
 assert.match(titles[0],/Recorded phase · RESERVED/);assert.match(titles[0],/Original send · No dispatch outcome recorded/);assert.match(titles[0],/Recorded remote resource · No observation recorded/);
 assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);await h.ui.close();
});

for (const drift of ['phase','owner','additional hold','unreadable record']) for (const during of ['selection','inspection'])
test(`project recovery refuses a stale exact publication after ${drift} changes during ${during}`, async t => {
    const f = await world(t), store = f.c.store;
    const sourceRoot = path.join(f.root,'destination');
    await fs.mkdir(sourceRoot);
    await f.c.registerProject({id:'Q',sourceRoot});
    const {operationId, workId} = f.op;
    store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?",f.source,workId);
    const [project] = projectCommands({controller:f.c,hostLanguage:'en',isCurrent:()=>true,
        refresh:async()=>assert.fail('Hold changed project'),notice(){}});
    let failure;
    await assert.rejects(project.run('Q',f.source),error=>{
        failure = failurePresentation(error);
        assert.equal(failure.code,'PROJECT_EFFECT_PENDING');
        assert.equal(failure.projectEffect.operationId,operationId);
        return true;
    });
    const tr = translator('en'), exact = tr('error.originalRepositoryOperation'), notices = [];
    let showingStaleMenu = true, inspections = 0;
    const calls = f.requests.length;
    const change = () => {
        if (drift === 'phase')
            store.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",operationId);
        if (drift === 'owner')
            store.run("UPDATE works SET data=json_remove(data,'$.conversation') WHERE id=?",workId);
        if (drift === 'additional hold')
            store.run("INSERT INTO effect_operations SELECT 'second-original',work,target,grant_id,phase,data FROM effect_operations WHERE id=?",operationId);
        if (drift === 'unreadable record')
            store.run("UPDATE effect_operations SET data=json_set(data,'$.payloadHash','invalid') WHERE id=?",operationId);
    };
    const [command] = errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,
        notice:text=>notices.push(text),execute:async command=>{
            assert.equal(during,'inspection');assert.equal(command,'/repo operation '+operationId+' '+workId);
            inspections++;change();return 'cancelled';
        },
        choose:async(_title,rows)=>{
            assert.ok(rows.includes(tr('error.repositoryOperations')));
            assert.ok(rows.includes(tr('error.independentSelectedProject',{project:'Q'})));
            assert.equal(rows.includes(exact),showingStaleMenu);
            if (!showingStaleMenu) return undefined;
            showingStaleMenu = false;
            if (during === 'selection') change();
            return exact;
        }});
    assert.equal(await command.run('',f.source),'cancelled');
    assert.deepEqual(notices,[tr('error.originalRepositoryOperationChanged')]);
    assert.equal(inspections,Number(during==='inspection'));
    assert.equal(await command.run('',f.source),'cancelled');
    assert.equal(f.requests.length,calls);
});

test('explicit Back after inspection restores the older publication page',async t=>{
 const f=await world(t),{operationId,targetId}=f.op;
 const newer=await f.c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body:'Newer publication'}});
 const list=f.c.listPublications.bind(f.c);
 f.c.listPublications=options=>list({...options,limit:1});
 const before=snapshot(f.c),calls=f.requests.length;
 const onOlder=(title,rows)=>{
  assert.match(title,/^Retained publications/);
  assert.ok(rows.includes('Newer publications'));
  assert.ok(rows.some(row=>row.includes(operationId)));
  assert.ok(rows.every(row=>!row.includes(newer.operationId)));
  return 'Back';
 };
 const h=command(f,['Retained publications','Older publications','owner/repo','Inspect original publication facts',title=>{
  assert.ok(title.includes(operationId));
  return 'Back without action';
 },onOlder,'Close']);
 try { await h.run(); } finally { await h.ui.close(); }
 assert.deepEqual(snapshot(f.c),before);
 assert.equal(f.requests.length,calls);
});
