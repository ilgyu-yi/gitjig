import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {projectCommands} from '../../dist/ui/project-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';

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
    let badInputs=0;
    assert.equal(await new HostCommands(projectCommands({...base,choose:async(_t,labels)=>labels.at(-1),input:async()=>++badInputs===1?f.home:'blocked'})).execute('/project',f.a.conversationId),'cancelled');
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
    await assert.rejects(registry.execute('/project',f.a.conversationId),/goal/);
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

for (const locale of ['en','ko']) for (const resultDependency of [true,false]) test(`project ${resultDependency?'dependency':'assignment'} refusal names the delegated child and routes original recovery in ${locale}`,async t=>{
    const f=await fixture(t);
    await f.c.registerProject({id:'first',sourceRoot:f.source});
    f.c.setConversationName({conversationId:f.b.conversationId,expectedGeneration:0,name:'Blocked child task'});
    f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)','child-source',f.b.conversationId,'{}','original child request');
    f.c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','child-work',null,'child-source',null,'child-work','ACTIVE',1,1,null,JSON.stringify({kind:'governed-change',conversation:f.b.conversationId}));
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','child-assignment',f.a.conversationId,f.b.conversationId,'child-work',resultDependency?'UNAVAILABLE':'RUNNING','{}');
    if(resultDependency)f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','pending-dependency',f.a.conversationId,f.b.conversationId,'child-assignment','PENDING','{}');
    const before=f.c.inspectConversation(f.a.conversationId),dependencies=f.c.store.all('SELECT * FROM conversation_dependencies');
    const registry=new HostCommands(projectCommands({controller:f.c,hostLanguage:locale,isCurrent:()=>true,notice(){},refresh:async()=>assert.fail('Blocked project must not refresh'),input:async()=>undefined,choose:async()=>undefined}));
    await assert.rejects(registry.execute('/project first',f.a.conversationId),error=>{
        assert.equal(error.code,'PROJECT_DEPENDENCY_PENDING');assert.equal(error.workId,'child-work');
        assert.ok(error.message.includes(locale==='ko'?'프로젝트 변경 보류':'Project unchanged'));assert.ok(error.message.includes('Blocked child task'));
        assert.ok(error.recovery.includes('/error'));assert.ok(error.recovery.includes(resultDependency?'pending-dependency':'child-assignment'));assert.ok(error.recovery.includes(resultDependency?'UNAVAILABLE':'RUNNING'));
        return true;
    });
    assert.deepEqual(f.c.inspectConversation(f.a.conversationId),before);assert.deepEqual(f.c.store.all('SELECT * FROM conversation_dependencies'),dependencies);
    assert.throws(()=>f.c.inspectConversationProjectDependencies({conversationId:f.a.conversationId,expectedGeneration:before.generation+1}),/source changed/);
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
});

for(const locale of ['en','ko'])test(`authorized parent wait remains intact and has explicit next-action guidance in ${locale}`,async t=>{
    const f=await fixture(t);await f.c.registerProject({id:'first',sourceRoot:f.source});
    f.c.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?','WAITING',JSON.stringify({continuationAuthorized:true,waitHandles:['original-wait']}),f.a.conversationId);
    const before=f.c.inspectConversation(f.a.conversationId);
    const registry=new HostCommands(projectCommands({controller:f.c,hostLanguage:locale,isCurrent:()=>true,notice(){},refresh:async()=>assert.fail('Active wait must not refresh'),choose:async()=>undefined,input:async()=>undefined}));
    await assert.rejects(registry.execute('/project first',f.a.conversationId),error=>{
        assert.equal(error.code,'PROJECT_CONTINUATION_PENDING');assert.ok(error.message.includes(locale==='ko'?'계속 실행 대기':'authorized continuation'));
        assert.ok(error.recovery.includes('/new root'));return true;
    });
    assert.deepEqual(f.c.inspectConversation(f.a.conversationId),before);
    assert.equal(JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?',f.a.conversationId).data).continuationAuthorized,true);
});

test('project recovery does not replace an unrelated storage failure with child guidance',async t=>{
    const f=await fixture(t);await f.c.registerProject({id:'first',sourceRoot:f.source});
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','queued-task',f.a.conversationId,f.b.conversationId,null,'QUEUED','{}');
    const error=Error('OWNED_STORAGE_FAILURE');f.c.reclaimConversationResource=async()=>{throw error;};
    const registry=new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,notice(){},refresh:async()=>{},choose:async()=>undefined,input:async()=>undefined}));
    await assert.rejects(registry.execute('/project first',f.a.conversationId),actual=>actual===error);
});

for (const explicit of [false, true]) test('project registration default uses only explicit launch-directory capture · ' + explicit, async t => {
    const f = await fixture(t), defaults = [];
    const host = {controller: f.c, isCurrent: () => true, notice() {}, refresh: async () => {},
        ...(explicit ? {initialDirectory: f.source} : {}),
        chooseItems: async () => 'register', choose: async () => assert.fail('Stable choices required'),
        input: async (_title, value) => { defaults.push(value); return undefined; }};
    assert.equal(await new HostCommands(projectCommands(host)).execute('/project', f.a.conversationId), 'cancelled');
    assert.deepEqual(defaults, [explicit ? f.source : '']);
    assert.equal(f.c.listProjects().length, 0);
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
    f.c.registerProject = async options => { attempts++; return register(options); };
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
