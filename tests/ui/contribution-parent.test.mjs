import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,resource,repository} from '../contributions/fixture.mjs';
import {configureOwnedContributionFixture} from '../../.qualification/controller-testing.js';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
const snapshot=(c,omit=[])=>JSON.stringify(c.store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").filter(({name})=>!omit.includes(name)).map(({name})=>[name,c.store.all('SELECT * FROM "'+name+'" ORDER BY rowid')]));
async function world(t){const f=await fixture();let passed=false;t.after(()=>f.close({preserve:!passed}));f.pass=()=>{passed=true;};f.source=f.c.createConversation().conversationId;f.merged.add(1);f.child=await f.c.trackRepositoryResource(resource(1));f.parent=await f.c.trackRepositoryResource({repository,kind:'issue',number:8});f.file=path.join(f.root,'credential');await fs.writeFile(f.file,'{"token":"fixture-only"}',{mode:0o600});f.c.configureContributionReader=options=>configureOwnedContributionFixture(f.c,{...options,origin:f.origin});return f;}
function command(f,choices,inputs=[f.file],extra={}){const shown=[],ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const pick=choices.shift();if(typeof pick==='function')return pick(title,rows);if(pick===undefined)return;const actual=rows.find(row=>row.startsWith(pick));assert.ok(actual,'Missing '+pick+' in '+JSON.stringify(rows));return actual;},input:async()=>{const next=inputs.shift();return typeof next==='function'?next():next;},show:async(title,text)=>shown.push({title,text}),notice(){},...extra});return {ui,shown,run:()=>ui.commands[0].run('',f.source)};}
const route=(child='github · owner/repo · pull-request #1',parent='issue #8')=>['Tracked issues',child,'Edit summary parent',parent,'Save summary routing','Back','Close'];

test('UI link, parent summary and unlink preserve exact immutable old members and monotonic null-parent revision',async t=>{
    const f=await world(t),stable=snapshot(f.c,['sources','resource_links','summary_revisions','summary_members']);
    const h=command(f,route());assert.equal(await h.run(),'completed');await h.ui.close();let link=f.c.inspectContributions({resourceId:f.child.resourceId}).parent;assert.equal(link.parent,f.parent.resourceId);assert.equal(link.revision,1);
    assert.ok(h.shown[0].text.includes('not a hosting relationship'));assert.equal(f.c.store.one('SELECT COUNT(*) n FROM summary_revisions').n,0);
    const prepare=command(f,['Tracked issues','github · owner/repo · issue #8','Prepare local summary','Back','Back','Close'],[]);await prepare.run();await prepare.ui.close();const old=JSON.parse(prepare.shown[0].text);assert.equal(old.complete,true);assert.equal(old.contributionCount,1);
    const revision=f.c.store.one('SELECT * FROM summary_revisions WHERE id=?',old.revisionId),members=f.c.store.all('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid',old.revisionId);assert.ok(members.length>0);for(const member of members)assert.ok(f.c.store.one('SELECT id FROM contribution_observations WHERE id=?',member.observation));
    const remove=command(f,route(undefined,'Remove current summary parent'));await remove.run();await remove.ui.close();link=f.c.inspectContributions({resourceId:f.child.resourceId}).parent;assert.equal(link.parent,null);assert.equal(link.revision,2);
    const next=f.c.prepareContributionSummary({resourceId:f.parent.resourceId});assert.notEqual(next.revisionId,old.revisionId);assert.equal(next.contributionCount,0);assert.equal(next.complete,false);assert.deepEqual(f.c.store.one('SELECT * FROM summary_revisions WHERE id=?',old.revisionId),revision);assert.deepEqual(f.c.store.all('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid',old.revisionId),members);
    const relink=command(f,route());await relink.run();await relink.ui.close();assert.equal(f.c.inspectContributions({resourceId:f.child.resourceId}).parent.revision,3);assert.equal(snapshot(f.c,['sources','resource_links','summary_revisions','summary_members']),stable);assert.ok(f.requests.every(r=>r.method==='GET'));f.pass();
});

test('candidate list excludes self, unavailable and different native repository identity; cancel sends no request or mutation',async t=>{
    const f=await world(t),list=f.c.listTrackedResources.bind(f.c),before=snapshot(f.c),calls=f.calls;
    f.c.listTrackedResources=()=>{const page=list(),child=page.resources.find(row=>row.resourceId===f.child.resourceId);return {...page,resources:[...page.resources,{...child,resourceId:'foreign',input:{...child.input,repository:{...child.input.repository,repositoryNodeId:'OTHER_NODE'}}},{state:'UNAVAILABLE',resourceId:'unavailable'}]};};
    const h=command(f,['Tracked issues','github · owner/repo · pull-request #1','Edit summary parent',(_title,rows)=>{assert.equal(rows.length,2);assert.ok(rows[0].startsWith('issue #8'));assert.equal(rows[1],'Back');return 'Back';},'Back','Back','Close'],[]);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.calls,calls);
    for(const choices of [['Tracked issues','github · owner/repo · pull-request #1','Edit summary parent','issue #8','Back without changing','Back','Back','Close'],[...route().slice(0,-1),'Back','Close']]){const cancelled=command(f,choices,[]);await cancelled.run();await cancelled.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.calls,calls);}f.pass();
});

test('stale source, child link, selected parent and credential-time changes refuse before dispatch',async t=>{
    const f=await world(t),calls=f.calls;let current=true;
    const stale=command(f,route().slice(0,4).concat([()=>{current=false;return 'Save summary routing';}]),[],{isCurrent:()=>current});await assert.rejects(stale.run(),/source changed/);await stale.ui.close();assert.equal(f.calls,calls);
    const parent=command(f,route(),[()=>{f.c.store.run("UPDATE tracked_resources SET data=json_set(data,'$.missing',json(?)) WHERE id=?",'["changed during credentials"]',f.parent.resourceId);return f.file;}]);await assert.rejects(parent.run(),/parent changed/);await parent.ui.close();assert.equal(f.calls,calls);assert.equal(f.c.inspectContributions({resourceId:f.child.resourceId}).parent,null);
    const race=command(f,route().slice(0,4).concat([async()=>{await f.c.setResourceSummaryParent({childId:f.child.resourceId,parentId:null,expectedRevision:0});return 'Save summary routing';}]));await assert.rejects(race.run(),/observations changed/);await race.ui.close();assert.equal(f.c.inspectContributions({resourceId:f.child.resourceId}).parent.revision,1);f.pass();
});

test('native replacement of child or selected parent, and cycles, refuse without a new owner link',async t=>{
    for(const replaceParent of [false,true]){
        const f=await world(t),before=snapshot(f.c);f.replace();const h=command(f,replaceParent?route('github · owner/repo · issue #8','pull-request #1'):route());await assert.rejects(h.run(),/identity changed/);await h.ui.close();assert.equal(snapshot(f.c),before);f.pass();
    }
    const f=await world(t);await f.c.setResourceSummaryParent({childId:f.child.resourceId,parentId:f.parent.resourceId,expectedRevision:0});const before=snapshot(f.c),h=command(f,route('github · owner/repo · issue #8','pull-request #1'));await assert.rejects(h.run(),/cycle/);await h.ui.close();assert.equal(snapshot(f.c),before);f.pass();
});

test('parent requests share credential ownership with refresh; close aborts and joins without linking',async t=>{
    const f=await world(t);let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.onReview(entered);f.setWait(gate);
    const h=command(f,route()),task=h.run();void task.catch(()=>{});await ready;const calls=f.calls;
    const competing=command(f,['Tracked issues','github · owner/repo · pull-request #1','Refresh selected']);await assert.rejects(competing.run(),/owns the credential session/);await competing.ui.close();assert.equal(f.calls,calls);
    await h.ui.close();await assert.rejects(task);release();f.setWait(null);f.onReview(null);assert.equal(f.c.inspectContributions({resourceId:f.child.resourceId}).parent,null);f.pass();
});

test('late navigation retains the original accepted link and child ID without presenting its result elsewhere',async t=>{
    const f=await world(t);let current=true;f.onReview(()=>{current=false;});const h=command(f,route(),[f.file],{isCurrent:()=>current});await assert.rejects(h.run(),error=>error.message.includes(f.child.resourceId));await h.ui.close();assert.equal(f.c.inspectContributions({resourceId:f.child.resourceId}).parent.parent,f.parent.resourceId);assert.equal(h.shown.length,1);f.pass();
});

test('unavailable current parent remains removable and invalid link revisions refuse without requests',async t=>{
    const f=await world(t);await f.c.setResourceSummaryParent({childId:f.child.resourceId,parentId:f.parent.resourceId,expectedRevision:0});
    f.c.store.run("UPDATE tracked_resources SET data='{' WHERE id=?",f.parent.resourceId);let title;
    const h=command(f,['Tracked issues','github · owner/repo · pull-request #1','Edit summary parent',(value,rows)=>{title=value;assert.deepEqual(rows,['Remove current summary parent','Back']);return 'Back';},'Back','Back','Close'],[]);await h.run();await h.ui.close();assert.match(title,/current unavailable/);
    const remove=command(f,route(undefined,'Remove current summary parent'));await remove.run();await remove.ui.close();const link=f.c.inspectContributions({resourceId:f.child.resourceId}).parent;assert.equal(link.parent,null);assert.equal(link.revision,2);
    f.c.store.run('UPDATE resource_links SET revision=0 WHERE child=?',f.child.resourceId);const calls=f.calls,bad=command(f,['Tracked issues','github · owner/repo · pull-request #1','Edit summary parent']);await assert.rejects(bad.run(),/summary link is unavailable/);await bad.ui.close();assert.equal(f.calls,calls);f.pass();
});
