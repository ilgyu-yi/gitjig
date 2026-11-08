import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {projectCommands} from '../../dist/ui/project-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {ConversationLifecycleHeld} from '../../dist/controller/types.js';

async function fixture(t) {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-project-ui-'))), home=path.join(root,'home'), source=path.join(root,'작업 폴더');
    await fs.mkdir(source);const c=await openController({installationHome:home});
    t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});
    const a=c.createConversation(), b=c.createConversation(); c.setDraft({conversationId:a.conversationId,expectedRevision:0,text:'한글 원문 draft'});
    return {root,home,source,c,a,b};
}
test('UI registry registers and attaches a project without a model/engine; source draft and sibling scope survive',async t=>{
    const f=await fixture(t), notices=[];let inputs=0, refreshed;
    const registry=new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,notice:s=>notices.push(s),refresh:async id=>{refreshed=id;},
        choose:async(_title,labels)=>labels.at(-1),input:async()=>++inputs===1?f.source:'my-project'}));
    await registry.execute('/project',f.a.conversationId);
    assert.equal(f.c.listProjects()[0].sourceRoot,f.source);assert.equal(f.c.inspectConversation(f.a.conversationId).projectId,'my-project');
    assert.equal(f.c.inspectConversation(f.a.conversationId).generation,1);assert.equal(f.c.inspectConversation(f.a.conversationId).draft.text,'한글 원문 draft');
    assert.equal(f.c.inspectConversation(f.b.conversationId).projectId,null);assert.equal(refreshed,f.a.conversationId);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
    await registry.execute('/project my-project',f.a.conversationId);assert.equal(f.c.inspectConversation(f.a.conversationId).generation,1);
});
test('cancel, invalid root, changed target and active goal cannot silently move project scope',async t=>{
    const f=await fixture(t);await f.c.registerProject({id:'first',sourceRoot:f.source});
    const base={controller:f.c,isCurrent:()=>true,notice(){},refresh:async()=>{},input:async()=>undefined,choose:async()=>undefined};
    assert.equal(await new HostCommands(projectCommands(base)).execute('/project',f.a.conversationId),'cancelled');
    let badInputs=0,badChoices=0;
    assert.equal(await new HostCommands(projectCommands({...base,choose:async(_t,labels)=>++badChoices<=2?labels.at(-1):undefined,
        input:async()=>++badInputs===1?f.home:'blocked'})).execute('/project',f.a.conversationId),'cancelled');
    assert.equal(badChoices,3);
    assert.deepEqual(f.c.listProjects().map(project=>project.id),['first']);
    let current=true;
    await assert.rejects(new HostCommands(projectCommands({...base,isCurrent:()=>current,choose:async(_t,labels)=>{current=false;return labels[0];}})).execute('/project',f.a.conversationId),/target changed/);
    assert.equal(f.c.inspectConversation(f.a.conversationId).projectId,null);assert.equal(f.c.inspectConversation(f.a.conversationId).draft.text,'한글 원문 draft');
    f.c.createGoal({conversationId:f.a.conversationId,objective:'Retain project scope',criteria:['Current goal stays intact']});
    await assert.rejects(new HostCommands(projectCommands(base)).execute('/project first',f.a.conversationId),/goal/);
    assert.equal(f.c.inspectConversation(f.a.conversationId).projectId,null);
});

test('registration remains visible when an active goal refuses attachment; original scope and draft survive',async t=>{
    const f=await fixture(t), notices=[];let inputs=0;
    f.c.createGoal({conversationId:f.a.conversationId,objective:'Keep original scope',criteria:['Do not attach another project']});
    const before=f.c.inspectConversation(f.a.conversationId);
    const registry=new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,notice:s=>notices.push(s),refresh:async()=>assert.fail('Refused scope must not refresh'),
        choose:async(_title,labels)=>labels.at(-1),input:async()=>++inputs===1?f.source:'retained-project'}));
    await assert.rejects(registry.execute('/project',f.a.conversationId), error => {
        assert.equal(error.code,'PROJECT_GOAL_PENDING');
        assert.deepEqual(error.projectTarget,{id:'retained-project',sourceRoot:f.source});
        return true;
    });
    assert.equal(f.c.listProjects()[0].id,'retained-project');
    assert.ok(notices.some(s=>s.startsWith('Registered project retained-project')));
    const after=f.c.inspectConversation(f.a.conversationId);
    assert.deepEqual(after,before);
    assert.equal(f.c.inspectConversation(f.b.conversationId).projectId,null);
});

test('unknown callback selections refuse before project registration or scope mutation', async t => {
    const f = await fixture(t);
    const host = {
        controller: f.c, isCurrent: () => true, notice() {},
        refresh: async () => assert.fail('Unknown selection refreshed the project'),
        input: async () => assert.fail('Unknown selection entered project registration'),
        choose: async () => 'NOT_A_DISPLAYED_LABEL',
    };
    await assert.rejects(new HostCommands(projectCommands(host)).execute('/project', f.a.conversationId), /Unknown UI choice label/);
    await assert.rejects(new HostCommands(projectCommands({...host, chooseItems: async () => 'NOT_A_VALUE'})).execute('/project', f.a.conversationId), /Unknown UI choice value/);
    assert.equal(f.c.listProjects().length, 0);
    assert.equal(f.c.inspectConversation(f.a.conversationId).projectId, null);
    assert.equal(f.c.inspectConversation(f.a.conversationId).draft.text, '한글 원문 draft');
});

for (const [state, locale] of [['DELIVERED', 'en'], ['UNKNOWN', 'en'], ['QUARANTINED', 'en'], ['QUARANTINED', 'ko']])
    test(`project switch uses recorded settlement for review-ready ${state} work in ${locale}`, async t => {
        const f = await fixture(t), conversationId = f.a.conversationId;
        await f.c.registerProject({id: 'first', sourceRoot: f.source});
        const workId = 'retained-work';
        f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)', 'original-source', conversationId, '{}', 'Original request');
        f.c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', workId, null, 'original-source', null, workId, state, 1, 1, null,
            JSON.stringify({kind: 'governed-change', conversation: conversationId}));
        f.c.store.run('INSERT INTO change_state(work,phase,epoch,data) VALUES(?,?,?,?)', workId, 'REVIEW_READY', 1, '{}');
        f.c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?', workId, conversationId);
        const before = f.c.inspectConversation(conversationId);
        assert.equal(before.state, 'IDLE');
        const tables = ['sources', 'works', 'change_state', 'runs', 'budgets', 'conversation_inputs'];
        const recorded = () => tables.map(table => f.c.store.all(`SELECT * FROM ${table} ORDER BY rowid`));
        const ledger = recorded();
        let refreshed = false;
        const registry = new HostCommands(projectCommands({controller: f.c, hostLanguage: locale, isCurrent: () => true,
            notice() {}, refresh: async () => { refreshed = true; }, input: async () => undefined, choose: async () => undefined}));
        if (state === 'DELIVERED') {
            await registry.execute('/project first', conversationId);
            assert.equal(f.c.inspectConversation(conversationId).projectId, 'first');
            assert.equal(refreshed, true);
            return;
        }
        await assert.rejects(registry.execute('/project first', conversationId), error => {
            assert.equal(error.code, 'PROJECT_WORK_PENDING');
            assert.equal(error.workId, workId);
            assert.deepEqual(error.projectTarget, {id: 'first', sourceRoot: f.source});
            assert.match(error.message, locale === 'ko' ? /실행·정리 상태 확인이 필요합니다/ : /original work needs reconciliation/);
            assert.ok(error.recovery.includes('/work ' + workId));
            return true;
        });
        assert.equal(refreshed, false);
        assert.throws(() => f.c.setConversationProject({conversationId, projectId: 'first', expectedGeneration: before.generation}),
            error => error.reasons?.includes(`governed:${workId}:REVIEW_READY`));
        assert.deepEqual(f.c.inspectConversation(conversationId), before);
        assert.deepEqual(recorded(), ledger);
    });

test('project work recovery matches original hold reasons before limiting and ignores unrelated or released work', async t => {
    const f = await fixture(t), conversationId = f.a.conversationId;
    await f.c.registerProject({id: 'first', sourceRoot: f.source});
    const seed = (id, state, phase, owner) => {
        f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)', id + '-source', owner, '{}', 'Retained ' + id);
        f.c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', id, null, id + '-source', null, id, state, 1, 1, null,
            JSON.stringify({kind: 'governed-change', conversation: owner}));
        f.c.store.run('INSERT INTO change_state(work,phase,epoch,data) VALUES(?,?,?,?)', id, phase, 1, '{}');
    };
    for (let index = 0; index < 10; index++) seed('new-' + index, 'ACTIVE', 'BLOCKED', conversationId);
    seed('unfinished', 'ACTIVE', 'BLOCKED', conversationId);
    seed('released', 'DELIVERED', 'REVIEW_READY', conversationId);
    seed('foreign', 'UNKNOWN', 'REVIEW_READY', f.b.conversationId);
    seed('retained-assignment', 'QUARANTINED', 'REVIEW_READY', f.b.conversationId);
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', 'retained-assignment', f.b.conversationId,
        conversationId, 'retained-assignment', 'COMPLETE', '{}');
    const before = f.c.inspectConversation(conversationId);
    const failure = new ConversationLifecycleHeld(['governed:unfinished:BLOCKED', 'governed:released:REVIEW_READY',
        'governed:foreign:REVIEW_READY', 'governed:retained-assignment:REVIEW_READY']);
    t.mock.method(f.c, 'changeConversationProject', async () => { throw failure; });
    const options = {conversationId, expectedGeneration: before.generation, refusal: failure};
    const command = new HostCommands(projectCommands({controller: f.c, hostLanguage: 'en', isCurrent: () => true, notice() {},
        refresh: async () => assert.fail('Refused project change refreshed'), input: async () => undefined, choose: async () => undefined}));
    await assert.rejects(command.execute('/project first', conversationId), error => {
        assert.equal(error.code, 'PROJECT_WORK_PENDING');
        assert.equal(error.workId, 'retained-assignment');
        assert.deepEqual(error.relatedWorkIds, ['unfinished']);
        return true;
    });
    f.c.store.run("UPDATE change_state SET phase='PLANNING' WHERE work='retained-assignment'");
    assert.deepEqual(f.c.inspectConversationProjectWorkHolds(options).map(hold => hold.workId), ['unfinished']);
    assert.throws(() => f.c.inspectConversationProjectWorkHolds({...options, expectedGeneration: before.generation + 1}), /source changed/);
    assert.deepEqual(f.c.inspectConversation(conversationId), before);
});

for (const locale of ['en','ko']) for (const resultDependency of [true,false]) test(`project ${resultDependency?'dependency':'assignment'} refusal names the delegated child and routes original recovery in ${locale}`,async t=>{
    const f=await fixture(t);
    await f.c.registerProject({id:'first',sourceRoot:f.source});
    if (resultDependency)
        await f.c.queueConversationInput({conversationId:f.a.conversationId,expectedGeneration:0,text:'Retained alongside the original dependency',mode:'idle'});
    f.c.setConversationName({conversationId:f.b.conversationId,expectedGeneration:0,name:'Blocked child task'});
    f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)','child-source',f.b.conversationId,'{}','original child request');
    f.c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','child-work',null,'child-source',null,'child-work','ACTIVE',1,1,null,JSON.stringify({kind:'governed-change',conversation:f.b.conversationId}));
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','child-assignment',f.a.conversationId,f.b.conversationId,'child-work',resultDependency?'UNAVAILABLE':'RUNNING','{}');
    if(resultDependency)f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','pending-dependency',f.a.conversationId,f.b.conversationId,'child-assignment','PENDING','{}');
    const before=f.c.inspectConversation(f.a.conversationId),dependencies=f.c.store.all('SELECT * FROM conversation_dependencies');
    const registry=new HostCommands(projectCommands({controller:f.c,hostLanguage:locale,isCurrent:()=>true,notice(){},refresh:async()=>assert.fail('Blocked project must not refresh'),input:async()=>undefined,choose:async()=>undefined}));
    await assert.rejects(registry.execute('/project first',f.a.conversationId),error=>{
        assert.equal(error.code,'PROJECT_DEPENDENCY_PENDING');assert.equal(error.workId,'child-work');
        assert.deepEqual(error.dependency,{
            relationships:[{dependencyId:resultDependency?'pending-dependency':null,assignmentId:'child-assignment',
                conversationId:f.b.conversationId,taskConversationId:f.b.conversationId,waitingFor:true,
                workId:'child-work',assignmentState:resultDependency?'UNAVAILABLE':'RUNNING'}],
            sourceConversationId:f.a.conversationId,sourceGeneration:before.generation,sourceProjectId:before.projectId,
        });
        assert.ok(error.message.includes(locale==='ko'?'프로젝트 변경 보류':'Project unchanged'));assert.ok(error.message.includes('Blocked child task'));
        assert.ok(error.recovery.includes('/error'));assert.ok(error.recovery.includes(resultDependency?'pending-dependency':'child-assignment'));assert.ok(error.recovery.includes(resultDependency?'UNAVAILABLE':'RUNNING'));
        assert.ok(error.recovery.includes('/new root'));assert.ok(error.recovery.includes('/project'));
        return true;
    });
    assert.deepEqual(f.c.inspectConversation(f.a.conversationId),before);assert.deepEqual(f.c.store.all('SELECT * FROM conversation_dependencies'),dependencies);
    assert.throws(()=>f.c.inspectConversationProjectDependencies({conversationId:f.a.conversationId,expectedGeneration:before.generation+1}),/source changed/);
});

for (const unreadable of [false, true]) test(`an untyped project refusal keeps its original identity when input evidence is ${unreadable ? 'unreadable' : 'unmatched'}`, async t => {
    const f = await fixture(t);
    await f.c.registerProject({id:'first', sourceRoot:f.source});
    const input = await f.c.queueConversationInput({conversationId:f.a.conversationId, expectedGeneration:0, text:'Pending input', mode:'idle'});
    if (unreadable)
        f.c.store.run("UPDATE conversation_inputs SET data='{' WHERE id=?", input.inputId);
    const failure = Error(`LIFECYCLE_HELD: input:${input.inputId}:INITIAL_RESERVED`);
    f.c.changeConversationProject = async () => { throw failure; };
    const command = new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,notice(){},
        refresh:async()=>assert.fail('Stale project switch refreshed'),input:async()=>undefined,choose:async()=>undefined}));
    await assert.rejects(command.execute('/project first', f.a.conversationId), error => error === failure);
    assert.equal(f.c.inspectConversation(f.a.conversationId).projectId, null);
});

test('a reconciliation marker without a request preserves the project destination without inventing work', async t => {
    const f = await fixture(t);
    await f.c.registerProject({id:'first', sourceRoot:f.source});
    const cid = f.a.conversationId;
    const marker = {format:'gitjig-native-input-recovery-1', runId:'missing-original', generation:0, reason:'queue-disposition-uncertain'};
    f.c.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'UNKNOWN', JSON.stringify({nativeInputRecovery:marker}), cid);
    const before = f.c.inspectConversation(cid);
    const command = new HostCommands(projectCommands({controller:f.c, isCurrent:()=>true, notice(){},
        refresh:async()=>assert.fail('Uncertain delivery permitted a project change'),input:async()=>undefined,choose:async()=>undefined}));
    await assert.rejects(command.execute('/project first', cid), error => {
        assert.equal(error.code,'PROJECT_INPUT_UNCERTAIN');
        assert.deepEqual(error.projectTarget,{id:'first',sourceRoot:f.source});
        assert.equal(error.workId,undefined);
        assert.equal(error.runId,undefined);
        return true;
    });
    assert.deepEqual(f.c.inspectConversation(cid),before);
    assert.deepEqual(f.c.inspectConversationInputs(cid),[]);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});

test('only an original controller lifecycle hold receives general destination recovery', async t => {
    const f = await fixture(t);
    await f.c.registerProject({id:'first',sourceRoot:f.source});
    const cid = f.a.conversationId;
    f.c.store.run("UPDATE conversation_state SET resource='SETTLING' WHERE conversation=?",cid);
    t.mock.method(f.c,'inspectConversationProjectDependencies',()=>assert.fail('Nondependency refusal inspected related conversations'));
    const command = new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,notice(){},
        refresh:async()=>assert.fail('Held project switch changed its view'),input:async()=>undefined,choose:async()=>undefined}));
    await assert.rejects(command.execute('/project first',cid),error=>{
        assert.equal(error.code,'PROJECT_LIFECYCLE_HELD');
        assert.deepEqual(error.projectTarget,{id:'first',sourceRoot:f.source});
        assert.match(error.recovery,/resource:SETTLING/);
        return true;
    });
    const foreign = Error('LIFECYCLE_HELD: effect:unverified:UNKNOWN');
    t.mock.method(f.c,'changeConversationProject',async()=>{throw foreign;});
    await assert.rejects(command.execute('/project first',cid),error=>error===foreign);
    assert.equal(f.c.inspectConversation(cid).projectId,null);
});

test('project hold projection includes no-result assignments, preserves incoming direction and deduplicates only related waits',async t=>{
    const f=await fixture(t),other=f.c.createConversation();
    f.c.setConversationName({conversationId:f.a.conversationId,expectedGeneration:0,name:'Original coordinator'});
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','queued-no-work',f.a.conversationId,f.b.conversationId,null,'QUEUED','{}');
    f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','other-wait',other.conversationId,f.b.conversationId,'queued-no-work','PENDING','{}');
    const outgoing=f.c.inspectConversationProjectDependencies({conversationId:f.a.conversationId,expectedGeneration:0});
    assert.equal(outgoing.items.length,1);assert.equal(outgoing.items[0].assignmentId,'queued-no-work');assert.equal(outgoing.items[0].dependencyId,null);assert.equal(outgoing.items[0].workId,null);assert.equal(outgoing.items[0].waitingFor,true);
    const incoming=f.c.inspectConversationProjectDependencies({conversationId:f.b.conversationId,expectedGeneration:0});
    assert.equal(incoming.items.length,1);assert.equal(incoming.items[0].dependencyId,'other-wait');assert.equal(incoming.items[0].waitingFor,false);
    f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({userLabel:{text:'Invalid name'}}),f.b.conversationId);
    assert.deepEqual(f.c.inspectConversationProjectDependencies({conversationId:f.a.conversationId,expectedGeneration:0}),outgoing);
    f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?','{',f.b.conversationId);
    assert.deepEqual(f.c.inspectConversationProjectDependencies({conversationId:f.a.conversationId,expectedGeneration:0}),outgoing);
});

for(const locale of ['en','ko'])for(const scenario of ['QUEUED','RUNNING','incoming'])test(`project hold names the recorded relationship without copying an unnamed title · ${locale} · ${scenario}`,async t=>{
    const f=await fixture(t),parent=f.a.conversationId,child=f.b.conversationId,incoming=scenario==='incoming';
    await f.c.registerProject({id:'first',sourceRoot:f.source});
    const source=incoming?child:parent,related=incoming?parent:child,state=incoming?'QUEUED':scenario;
    const derived='Private automatic prompt title';
    await f.c.queueConversationInput({conversationId:related,expectedGeneration:0,text:derived,mode:'idle'});
    assert.equal(f.c.inspectConversation(related).label,derived);
    assert.equal(f.c.inspectConversation(related).userLabel,undefined);
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','original-assignment',parent,child,null,state,'{}');
    if(incoming)f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','original-wait',parent,child,'original-assignment','PENDING','{}');
    const before=f.c.inspectConversation(source);
    const registry=new HostCommands(projectCommands({controller:f.c,hostLanguage:locale,isCurrent:()=>true,
        notice:()=>assert.fail('Held switch reported success'),refresh:async()=>assert.fail('Held switch changed view'),input:async()=>undefined,choose:async()=>undefined}));
    await assert.rejects(registry.execute('/project first',source),error=>{
        assert.equal(error.code,'PROJECT_DEPENDENCY_PENDING');
        assert.ok(error.message.endsWith(related));
        assert.ok(!error.message.includes(derived)&&!error.recovery.includes(derived));
        assert.ok(error.recovery.includes((locale==='ko'?'연결된 대화 ':'Related conversation ')+related));
        assert.ok(error.recovery.includes('original-assignment')&&error.recovery.includes(state));
        assert.equal(error.message.includes(locale==='ko'?'위임 작업 시작 대기':'delegated task waiting to start'),scenario==='QUEUED');
        assert.equal(error.message.includes(locale==='ko'?'이 작업의 결과를 기다리는 대화':'this task still owes a result'),incoming);
        assert.equal(error.recovery.includes(locale==='ko'?'작업 기록을 확인할 수 없습니다':'A work record is unavailable'),scenario==='RUNNING');
        return true;
    });
    assert.deepEqual(f.c.inspectConversation(source),before);
});

for(const locale of ['en','ko'])test(`authorized parent wait remains intact and has explicit next-action guidance in ${locale}`,async t=>{
    const f=await fixture(t);await f.c.registerProject({id:'first',sourceRoot:f.source});
    f.c.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?','WAITING',JSON.stringify({continuationAuthorized:true,waitHandles:['original-wait']}),f.a.conversationId);
    const before=f.c.inspectConversation(f.a.conversationId);
    const registry=new HostCommands(projectCommands({controller:f.c,hostLanguage:locale,isCurrent:()=>true,notice(){},refresh:async()=>assert.fail('Active wait must not refresh'),choose:async()=>undefined,input:async()=>undefined}));
    await assert.rejects(registry.execute('/project first',f.a.conversationId),error=>{
        assert.equal(error.code,'PROJECT_CONTINUATION_PENDING');assert.ok(error.message.includes(locale==='ko'?'계속 실행 대기':'a continuation or dialog is pending'));
        assert.ok(error.recovery.includes('/new root'));return true;
    });
    assert.deepEqual(f.c.inspectConversation(f.a.conversationId),before);
    assert.equal(JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?',f.a.conversationId).data).continuationAuthorized,true);
});

test('project refusal projection matches reasons and assignment state before its display limit',async t=>{
    const f=await fixture(t),conversationId=f.a.conversationId,target=f.b.conversationId;
    for(let i=0;i<11;i++){
        f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','assignment-'+i,conversationId,target,null,'RUNNING','{}');
        f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','dependency-'+i,conversationId,target,'assignment-'+i,'PENDING','{}');
    }
    const read=lifecycleHolds=>f.c.inspectConversationProjectDependencies({conversationId,expectedGeneration:0,lifecycleHolds});
    assert.equal(read(undefined).more,true);
    const selected=read(['dependency:dependency-10','assignment:assignment-9:RUNNING','assignment:assignment-8:WAITING']);
    assert.deepEqual(selected.items.map(row=>row.dependencyId),['dependency-9','dependency-10']);
    assert.equal(selected.more,false);
    assert.deepEqual(f.c.inspectConversationProjectDependencies({conversationId,expectedGeneration:0,
        lifecycleHolds:['dependency:dependency-10','assignment:assignment-9:RUNNING'],exactRelationshipReasons:true})
        .items.map(row=>row.dependencyId),['dependency-10']);
    assert.deepEqual(read(['input:original:QUEUED']),{items:[],more:false});
});

test('project recovery does not replace an unrelated storage failure with child guidance',async t=>{
    const f=await fixture(t);await f.c.registerProject({id:'first',sourceRoot:f.source});
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','queued-task',f.a.conversationId,f.b.conversationId,null,'QUEUED','{}');
    const registry=new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,notice(){},refresh:async()=>{},choose:async()=>undefined,input:async()=>undefined}));
    for(const message of ['OWNED_STORAGE_FAILURE','LIFECYCLE_HELD: assignment:queued-task:QUEUED']){
        const error=Error(message);
        f.c.changeConversationProject=async()=>{throw error;};
        await assert.rejects(registry.execute('/project first',f.a.conversationId),actual=>actual===error);
    }
});

for (const explicit of [false, true]) test('project registration default uses only explicit launch-directory capture · ' + explicit, async t => {
    const f = await fixture(t), defaults = [];
    let menus=0;
    const host = {controller: f.c, isCurrent: () => true, notice() {}, refresh: async () => {},
        ...(explicit ? {initialDirectory: f.source} : {}),
        chooseItems: async () => ++menus===1?'register':undefined, choose: async () => assert.fail('Stable choices required'),
        input: async (_title, value) => { defaults.push(value); return undefined; }};
    assert.equal(await new HostCommands(projectCommands(host)).execute('/project', f.a.conversationId), 'cancelled');
    assert.deepEqual(defaults, [explicit ? f.source : '']);
    assert.equal(menus,2);
    assert.equal(f.c.listProjects().length, 0);
});

for (const outcome of ['catalogue refreshed','language changed','view closed']) test('cancelled project registration · '+outcome,async t=>{
    const f=await fixture(t),target=f.a.conversationId;
    let current=true,menus=0;
    const host={controller:f.c,hostLanguage:'en',isCurrent:()=>current,notice(){},refresh:async()=>{},
        choose:async()=>assert.fail('Stable choices required'),chooseItems:async(_title,items)=>{
            if(++menus===1)return 'register';
            assert.equal(outcome,'catalogue refreshed');assert.ok(items.some(item=>item.value==='project:added'));
            return 'project:added';
        },input:async()=>{
            if(outcome==='catalogue refreshed')await f.c.registerProject({id:'added',sourceRoot:f.source});
            if(outcome==='language changed')f.c.setConversationLanguage({conversationId:target,expectedGeneration:0,expectedRevision:0,replyLanguage:'ko'});
            if(outcome==='view closed')current=false;
            return undefined;
        }};
    const run=new HostCommands(projectCommands(host)).execute('/project',target);
    if(outcome==='language changed')await assert.rejects(run,/target changed/u);
    else assert.equal(await run,outcome==='catalogue refreshed'?'completed':'cancelled');
    assert.equal(menus,outcome==='catalogue refreshed'?2:1);
    assert.equal(f.c.inspectConversation(target).projectId,outcome==='catalogue refreshed'?'added':null);
    assert.equal(f.c.inspectConversation(target).draft.text,'한글 원문 draft');
});

for (const locale of ['en', 'ko']) test('invalid project directory retains both fields through explicit correction and retry · ' + locale, async t => {
    const f = await fixture(t), values = ['relative/invalid', 'preserved-id', f.source], defaults = [], choices = ['register', 'directory', 'retry'];
    const shown = [];
    const host = {controller: f.c, hostLanguage: locale, isCurrent: () => true, notice() {}, refresh: async () => {},
        choose: async () => assert.fail('Stable choices required'),
        chooseItems: async (_title, items) => {
            const value = choices.shift(); assert.ok(items.some(item => item.value === value)); return value;
        },
        show: async (title, text) => shown.push({title, text}),
        input: async (title, value) => { defaults.push({title, value}); return values.shift(); }};
    await new HostCommands(projectCommands(host)).execute('/project', f.a.conversationId);
    assert.equal(defaults[2].value, 'relative/invalid');
    assert.equal(defaults.length, 3, 'correcting the directory does not ask for the retained ID again');
    assert.equal(shown.length, 1);
    assert.equal(f.c.listProjects()[0].id, 'preserved-id');
    assert.equal(f.c.listProjects()[0].sourceRoot, f.source);
    assert.equal(f.c.inspectConversation(f.a.conversationId).draft.text, '한글 원문 draft');
    assert.equal(f.c.inspectConversation(f.b.conversationId).projectId, null);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n, 0);
});

test('an existing project ID can be corrected without losing its staged directory', async t => {
    const f = await fixture(t), original = path.join(f.root, 'original'); await fs.mkdir(original);
    await f.c.registerProject({id: 'taken', sourceRoot: original});
    const values = [f.source, 'taken', 'corrected'], defaults = [], choices = ['register', 'id', 'retry'];
    await new HostCommands(projectCommands({controller: f.c, isCurrent: () => true, notice() {}, refresh: async () => {},
        choose: async () => undefined, chooseItems: async () => choices.shift(),
        input: async (_title, value) => { defaults.push(value); return values.shift(); }, show: async () => {},
    })).execute('/project', f.a.conversationId);
    assert.equal(defaults[2], 'taken');
    assert.equal(f.c.listProjects().find(project => project.id === 'corrected').sourceRoot, f.source);
    assert.equal(f.c.listProjects().find(project => project.id === 'taken').sourceRoot, original);
});

test('cancelling a correction field cannot retry registration or change stored projects', async t => {
    const f = await fixture(t), values = [f.home, 'held-id', undefined], defaults = [], choices = ['register', 'directory', 'cancel'];
    let attempts = 0; const register = f.c.registerProject.bind(f.c);
    f.c.registerProject = async (...args) => { attempts++; return register(...args); };
    assert.equal(await new HostCommands(projectCommands({controller: f.c, isCurrent: () => true, notice() {}, refresh: async () => {},
        choose: async () => undefined, chooseItems: async () => choices.shift(),
        input: async (_title, value) => { defaults.push(value); return values.shift(); }, show: async () => {},
    })).execute('/project', f.a.conversationId), 'cancelled');
    assert.equal(attempts, 1);
    assert.equal(defaults[2], f.home);
    assert.equal(f.c.listProjects().length, 0);
    assert.equal(f.c.inspectConversation(f.a.conversationId).projectId, null);
});

test('source navigation during correction refuses before registration retry', async t => {
    const f = await fixture(t), values = ['relative/invalid', 'retained-id']; let current = true;
    await assert.rejects(new HostCommands(projectCommands({controller: f.c, isCurrent: () => current, notice() {}, refresh: async () => {},
        choose: async () => undefined, chooseItems: async (_title, items) => {
            if (items.some(item => item.value === 'register')) return 'register';
            current = false; return 'retry';
        }, input: async () => values.shift(), show: async () => {},
    })).execute('/project', f.a.conversationId), /target changed/u);
    assert.equal(f.c.listProjects().length, 0);
    assert.equal(f.c.inspectConversation(f.a.conversationId).draft.text, '한글 원문 draft');
});

function holdProjectValidation(t, source) {
    const realpath = fs.realpath;
    let reached, release;
    const held = new Promise(resolve => { reached = resolve; });
    const proceed = new Promise(resolve => { release = resolve; });
    t.mock.method(fs, 'realpath', async (file, ...options) => {
        const result = await realpath(file, ...options);
        if (file === source) {
            reached();
            await proceed;
        }
        return result;
    });
    return {held,release};
}

test('project registration refuses a changed conversation source during directory validation', {timeout:5000}, async t=>{
    const f=await fixture(t), {held,release}=holdProjectValidation(t,f.source), values=[f.source,'pending-project'];
    const registry=new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,
        choose:async()=>assert.fail('Stable choices required'),chooseItems:async()=> 'register',
        input:async()=>values.shift(),notice:()=>assert.fail('Stale project registration was reported'),refresh:async()=>assert.fail('Stale project was selected')}));
    const pending=registry.execute('/project',f.a.conversationId);
    await held;
    f.c.setConversationLanguage({conversationId:f.a.conversationId,expectedGeneration:0,expectedRevision:0,replyLanguage:'ko'});
    release();
    await assert.rejects(pending,/Project selection target changed/);
    assert.deepEqual(f.c.listProjects(),[]);
    assert.equal(f.c.inspectConversation(f.a.conversationId).projectId,null);
    assert.equal(f.c.inspectConversation(f.a.conversationId).draft.text,'한글 원문 draft');
});

test('project registration preserves the original validated operands across directory validation', {timeout:5000}, async t=>{
    const f=await fixture(t), {held,release}=holdProjectValidation(t,f.source);
    const input={id:'original',sourceRoot:f.source,captureProfile:{maxEntries:21}};
    const pending=f.c.registerProject(input);
    await held;
    input.id='other';input.sourceRoot=f.home;input.captureProfile.maxEntries=42;
    release();
    const project=await pending;
    assert.equal(project.id,'original');
    assert.equal(project.sourceRoot,f.source);
    assert.equal(project.captureProfile.maxEntries,21);
    assert.deepEqual(f.c.listProjects(),[project]);
});

test('project registration refuses an asynchronous source check or host quiescence at commit', async t=>{
    const f=await fixture(t),input={id:'pending',sourceRoot:f.source};
    await assert.rejects(f.c.registerProject(input,async()=>{}),/Synchronous project registration/);
    await assert.rejects(f.c.registerProject(input,()=>{f.c.quiesceInteractionHost();}),/registration cancelled/);
    assert.deepEqual(f.c.listProjects(),[]);
});
