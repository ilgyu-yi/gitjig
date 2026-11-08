import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationStartup,prepareApplicationStartup} from '../../dist/app/startup.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {readinessCommands} from '../../dist/ui/readiness-commands.js';
import {restartCommand} from '../../dist/ui/startup-guidance.js';
import {writeConversationModelChoice} from '../../dist/controller/model-choice.js';
import {managedWorld} from './managed-change-fixture.mjs';
import {workCommands} from '../../dist/ui/work-commands.js';
async function world(t){const root=await temporaryDirectory('ready-command'),home=path.join(root,'home'),c=await openController({installationHome:home}),models=new ApplicationModels(c),accounts=ApplicationAccounts.open(c),a=await models.newConversation();ApplicationStartup.open(c,{configuration:{version:1},sources:{runtime:'none',bridge:'none'}});t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});return{root,home,c,models,accounts,a};}
test('readiness refreshes through local owner replacement, stopping and retained input', async t => {
    const f = await world(t), cid = f.a.conversationId;
    await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original accepted request',mode:'idle'});
    const captured = {owner:{},label:'Request received · waiting to start'};
    let current = captured, menus = 0;
    const command = new HostCommands(readinessCommands({
        controller:f.c, hostLanguage:'en', isCurrent:()=>true, localRequest:()=>current,
        choose:async()=>assert.fail('Expected typed readiness rows'),
        chooseItems:async(_title, rows)=>{
            menus++;
            if(menus <= 2){
                assert.match(rows[0].label,/waiting to start.*return to the conversation/);
                current = menus === 1 ? {...captured,owner:{}} : {...current,label:'Stopping request'};
            } else if(menus === 3){
                assert.match(rows[0].label,/Stopping request.*return to the conversation/);
                current = undefined;
            } else {
                assert.match(rows[0].label,/Review pending requests/);
            }
            return 'next';
        },
        execute:async(command)=>{
            assert.equal(menus,4);
            assert.equal(command,'/inputs');
            return 'started';
        },
    }));
    assert.equal(await command.execute('/ready',cid),'started');
    assert.equal(f.c.inspectConversationInputs(cid).length,1);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

test('readiness refreshes request method selection if a local send appears', async t => {
    const f=await world(t), cid=f.a.conversationId;
    let current, menus=0;
    const ready=new HostCommands(readinessCommands({
        controller:f.c, hostLanguage:'en', externalModel:{provider:'owned',modelId:'fixture'},
        isCurrent:()=>true, localRequest:()=>current,
        choose:async()=>assert.fail('Expected typed readiness rows'),
        chooseItems:async(_title,rows)=>{
            if(++menus===1){
                assert.match(rows[0].label,/write|chat/i);
                current={owner:{},label:'Checking selected model'};
                return 'next';
            }
            assert.match(rows[0].label,/Checking selected model.*return to the conversation/);
            return 'next';
        },
        execute:async()=>assert.fail('Readiness started a request or setup'),
    }));
    assert.equal(await ready.execute('/ready',cid),'cancelled');
    assert.equal(menus,2);
});
for (const change of ['diagnostic', 'another request', 'startup file']) test(`readiness follows the exact failed request after a changed ${change}`, async t => {
    const f = await world(t), cid = f.a.conversationId, draft = 'A separate unsent draft';
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    const queue = text => f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text,mode:'idle'});
    const original = await queue('Previously received request');
    const setDiagnostic = diagnostic => f.c.store.run("UPDATE conversation_inputs SET data=json_set(data,'$.routeError',?) WHERE id=?", diagnostic, original.inputId);
    setDiagnostic('Original diagnostic');
    let menus = 0, reviews = 0;
    const command = new HostCommands(readinessCommands({
        controller:f.c, hostLanguage:'en', isCurrent:()=>true,
        choose:async()=>assert.fail('Expected typed readiness rows'),
        chooseItems:async(title,rows)=>{
            if (++menus === 1) {
                assert.match(rows[0].label,/Review the original request and its failure/);
                if (change === 'diagnostic') setDiagnostic('Updated diagnostic');
                else if (change === 'another request') await queue('Another retained request');
                else await ApplicationStartup.open(f.c).save({version:1});
                return 'next';
            }
            if (change === 'startup file') return 'return-request';
            if (menus === 2) {
                assert.match(title,/Readiness updated · choose again/);
                if (change === 'another request') {
                    assert.match(rows[0].label,/Review pending requests/);
                    return 'return-request';
                }
                assert.match(rows[0].label,/Review the original request and its failure/);
                return 'next';
            }
            return 'return-request';
        },
        reviewInput:async(target,input)=>{
            assert.equal(menus,change === 'startup file' ? 1 : 2);
            assert.equal(target,cid);
            assert.equal(input.inputId,original.inputId);
            assert.equal(input.failure,change === 'diagnostic' ? 'Updated diagnostic' : 'Original diagnostic');
            reviews++;
            return 'cancelled';
        },
        execute:async()=>assert.fail('Readiness dispatched a command'),
    }));
    assert.equal(await command.execute('/ready',cid),'cancelled');
    assert.equal(reviews,change==='another request'?0:1);
    assert.equal(f.c.inspectConversation(cid).draft.text,draft);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});
for (const drift of ['at selection', 'during folder recheck']) test(`readiness discards a stale top-level setup choice ${drift}`, async t => {
    const f = await world(t), cid = f.a.conversationId, project = path.join(f.root, 'current');
    await fs.mkdir(project);
    await f.c.registerProject({id:'P',sourceRoot:project});
    f.c.setConversationProject({conversationId:cid,projectId:'P',expectedGeneration:0});
    const original = f.c.inspectConversation(cid);
    let menus = 0, rechecking = false;
    const advance = () => f.c.store.run('UPDATE conversations SET generation=? WHERE id=?', original.generation + 1, cid);
    const listProjects = f.c.listProjects.bind(f.c);
    t.mock.method(f.c,'listProjects',()=>{
        if(rechecking) {rechecking=false;advance();}
        return listProjects();
    });
    const ready = new HostCommands(readinessCommands({
        controller:f.c,models:f.models,accounts:f.accounts,hostLanguage:'en',isCurrent:()=>true,
        choose:async()=>assert.fail('Expected typed readiness rows'),
        chooseItems:async(title,rows)=>{
            assert.match(rows[0].label,/Connect your model account/);
            if(++menus===1){
                if(drift==='at selection') advance();
                else rechecking=true;
                return 'next';
            }
            assert.match(title,/Readiness updated · choose again/);
            return 'return-request';
        },
        execute:async()=>assert.fail('Readiness dispatched the stale setup choice'),
    }));
    assert.equal(await ready.execute('/ready',cid),'cancelled');
    assert.equal(menus,2);
    assert.equal(f.c.inspectConversation(cid).generation,original.generation+1);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});
test('readiness refreshes an unstarted task review after its original evidence changes', async t => {
    const f = await world(t), cid = f.a.conversationId, child = f.c.createConversation().conversationId;
    let fingerprint = 'first', choices = 0;
    t.mock.method(f.c, 'inspectConversationProjectDependencies', () => ({
        more: false, items: [{assignmentId: 'assignment', workId: null, assignmentState: 'QUEUED'}],
    }));
    t.mock.method(f.c, 'inspectQueuedAssignmentCancellation', () => ({
        assignmentId: 'assignment', targetConversationId: child, fingerprint,
    }));
    const ready = new HostCommands(readinessCommands({
        ...f, controller: f.c, hostLanguage: 'en', isCurrent: () => true,
        choose: async () => assert.fail('Expected a typed readiness choice'),
        chooseItems: async (_title, items) => {
            assert.match(items[0].label, /Review the unstarted delegated task/);
            if (++choices === 1) {
                fingerprint = 'changed since the choice was displayed';
                return 'next';
            }
            return undefined;
        },
        show: async () => assert.fail('Stale evidence opened the original task review'),
        notice: () => assert.fail('Readiness made a state change'),
        execute: async () => assert.fail('Readiness dispatched an unrelated command'),
    }));
    assert.equal(await ready.execute('/ready', cid), 'cancelled');
    assert.equal(choices, 2);
});

test('readiness takes a live standalone continuation to its exact original work', async t => {
    const f=await managedWorld(t), view=f.c.inspectConversation(f.cid);
    const choice=f.c.getConversationModelChoice(f.cid);
    const original=await f.c.beginChange({projectId:'P',request:'Standalone original',applicationModelBaseline:await f.models.baseline('P',choice)});
    const gate=Promise.withResolvers();
    f.c.changes.drive=async ()=>{await gate.promise;return f.c.inspectChange(original.workId);};
    const live=f.c.resumeConversationChange({conversationId:f.cid,expectedGeneration:view.generation,expectedModelRevision:choice.revision,
        workId:original.workId,expectedEpoch:original.epoch});
    try {
        assert.equal(f.c.inspectConversation(f.cid).workId,null);
        const calls=[];
        const ready=new HostCommands(readinessCommands({
            controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,
            choose:async (_title,rows)=>{assert.match(rows[0],/inspect the running work/i);return rows[0];},
            execute:async command=>{calls.push(command);return 'started';},
        }));
        assert.equal(await ready.execute('/ready',f.cid),'started');
        assert.deepEqual(calls,['/work '+original.workId]);
        const work=new HostCommands(workCommands({
            controller:f.c,isCurrent:()=>true,locale:()=> 'en',
            choose:async (title,rows)=>{
                assert.match(title,/still running or settling/);
                assert.ok(rows.some(row=>row.startsWith('Review cancellation')));
                assert.ok(!rows.some(row=>row.startsWith('Review resume')));
                return rows[0];
            },
            execute:async()=>assert.fail('Back cannot dispatch work or cancellation'),
        }));
        assert.equal(await work.execute('/work '+original.workId,f.cid),'cancelled');
    } finally {gate.resolve();await live;f.pass();}
});

async function savedBridgeFixture(root){
    const [host,agent,account,docker]=['bridge-host','bridge-agent','bridge-account','docker'].map(name=>path.join(root,name));
    for(const dir of [host,agent,account,docker,path.join(agent,'home')])await fs.mkdir(dir,{mode:0o700});
    await fs.writeFile(path.join(agent,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
    const file=await fs.realpath(process.execPath),sha256=createHash('sha256').update(await fs.readFile(file)).digest('hex');
    return{docker,bridge:{profile:{kind:'installed-claude-bridge',cwd:host,agentDir:agent,executable:{file,sha256}},nativeAccountDirectory:account}};
}
test('readiness facts and action refresh distinguish current/default and saved/active without dispatching work',async t=>{
    const f=await world(t);await f.accounts.configure({providers:{'ready-fixture':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'current'},{id:'future'}]}}});
    await f.accounts.setDefault('ready-fixture','future');await f.models.select({conversationId:f.a.conversationId,expectedGeneration:0,expectedRevision:f.c.getConversationModelChoice(f.a.conversationId).revision,provider:'ready-fixture',modelId:'current'});
    await ApplicationStartup.open(f.c).save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',image:'sha256:'+'0'.repeat(64)}});
    const snapshots=[],calls=[];let step=0;
    const registry=new HostCommands(readinessCommands({...f,controller:f.c,isCurrent:()=>true,choose:async(_title,rows)=>{snapshots.push(rows);step++;return step===1?rows.find(row=>row==='More settings and details'):step===2?rows.find(row=>row.startsWith('Current model')):rows.at(-1);},execute:async(command,target)=>{calls.push([command,target]);const choice=f.c.getConversationModelChoice(target);await f.models.select({conversationId:target,expectedGeneration:0,expectedRevision:choice.revision,provider:'ready-fixture',modelId:'future'});return'completed';}}));
    assert.equal(await registry.execute('/ready',f.a.conversationId),'completed');assert.deepEqual(calls,[['/model',f.a.conversationId]]);
    assert.ok(snapshots[0].some(row=>row.includes('Current model · ready-fixture/current')));
    assert.ok(!snapshots[0].some(row=>row.includes('Future application default')));
    assert.ok(snapshots[1].some(row=>row.includes('Current model · ready-fixture/current')));
    assert.ok(snapshots[1].some(row=>row.includes('Future application default · ready-fixture/future')));
    assert.ok(snapshots[1].some(row=>row.includes('Active runtime · not configured')));assert.ok(snapshots[1].some(row=>row.includes('Saved runtime · NO_ENGINE')));
    assert.ok(snapshots[2].some(row=>row.includes('Current model · ready-fixture/future')));assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});
test('More and Back use stable choices, preserve the request and do not complete or dispatch it', async t => {
    const f = await world(t), cid = f.a.conversationId;
    f.c.setDraft({conversationId:cid, expectedRevision:0, text:'Keep this 한국어 request'});
    const before = f.c.inspectConversation(cid).draft, snapshots = [];
    const selections = ['more-settings', 'back-current', 'more-settings', undefined, 'return-request'];
    let acknowledgements = 0;
    const result = await new HostCommands(readinessCommands({
        controller:f.c, models:f.models, accounts:f.accounts, isCurrent:()=>true,
        choose:async()=>assert.fail('Typed navigation fell back to labels'),
        chooseItems:async(title, items)=>{
            snapshots.push({title, items});
            const selected = selections.shift();
            if (selected !== undefined) assert.ok(items.some(item=>item.value === selected));
            return selected;
        },
        execute:async()=>assert.fail('Readiness navigation dispatched a command'),
    })).execute('/ready', cid, {acknowledgeSubmission:()=>acknowledgements++});
    assert.equal(result, 'cancelled');
    assert.equal(selections.length, 0);
    assert.equal(acknowledgements, 0);
    assert.deepEqual(f.c.inspectConversation(cid).draft, before);
    assert.ok(!snapshots[0].items.some(item=>item.label.startsWith('Future application default')));
    assert.ok(snapshots[1].items.some(item=>item.value === 'model-default'));
    assert.ok(snapshots[1].items.some(item=>item.value === 'runtime-active'));
    assert.ok(snapshots[1].items.some(item=>item.value === 'runtime-saved'));
    assert.ok(snapshots[1].items.some(item=>item.value === 'local'));
    assert.ok(snapshots[1].items.some(item=>item.value === 'repository'));
    assert.deepEqual(snapshots[2].items, snapshots[0].items);
    assert.deepEqual(snapshots[4].items, snapshots[0].items);
    for (const table of ['works','runs','conversation_inputs'])
        assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM ' + table).n, 0);
});

test('active runtime selection distinguishes preparation, saved activation and inspection', async t => {
    const f = await world(t), cid = f.a.conversationId;
    const runtime = {dockerBinary:'/usr/bin/false', dockerContext:'prepared', image:'sha256:'+'2'.repeat(64)};
    const startup = ApplicationStartup.open(f.c);
    const selectRuntime = async ({label, command, editor = true}) => {
        const choices = ['more-settings', 'runtime-active', 'return-request'];
        const invoked = [];
        await new HostCommands(readinessCommands({
            controller:f.c, models:editor ? f.models : undefined, isCurrent:()=>true,
            choose:async()=>assert.fail('Expected a typed readiness choice'),
            chooseItems:async(_title, items)=>{
                const selected = choices.shift(), row = items.find(item=>item.value === selected);
                assert.ok(row);
                if (selected === 'runtime-active') assert.match(row.label, label);
                return row.value;
            },
            execute:async value=>{invoked.push(value);return 'cancelled';},
        })).execute('/ready', cid);
        assert.deepEqual(invoked, command ? [command] : []);
        assert.deepEqual(choices, []);
    };
    await selectRuntime({label:/not configured · prepare runtime$/, command:'/setup runtime'});
    await selectRuntime({label:/not configured · CLI setup inspect$/, editor:false});

    await startup.save({version:1,runtime});
    await selectRuntime({label:/not configured · review and apply saved runtime$/, command:'/setup runtime'});
    const startupFile = path.join(f.home,'config/startup.json'), saved = await fs.readFile(startupFile);
    await fs.writeFile(startupFile,'{malformed startup',{mode:0o600});
    await selectRuntime({label:/not configured · inspect$/, command:'/setup inspect'});
    await fs.writeFile(startupFile,saved,{mode:0o600});

    await (await startup.prepareRuntimeEdit()).save(runtime);
    await startup.save({version:1,runtime:{...runtime,dockerContext:'replacement'}});
    await selectRuntime({label:/^Active runtime · review and edit · prepared · sha256:[a-f0-9]+ · configured, engine not checked$/, command:'/setup runtime current'});
    for (const table of ['works','runs','conversation_inputs'])
        assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM '+table).n,0);
});

for (const details of [false, true]) test('readiness refreshes its active runtime in the same view · details='+details, async t => {
    const f = await world(t);
    const runtime = {dockerBinary:'/usr/bin/false',dockerContext:'original',image:'sha256:'+'0'.repeat(64)};
    await (await ApplicationStartup.open(f.c).prepareRuntimeEdit()).save(runtime);
    const invoked = [];
    let presented = 0;
    const ready = new HostCommands(readinessCommands({
        controller:f.c,models:f.models,hostLanguage:'en',isCurrent:()=>true,
        choose:async()=>assert.fail('Expected a typed readiness choice'),
        chooseItems:async(title,rows)=>{
            if (details && presented === 0 && rows.some(row=>row.value==='more-settings'))
                return 'more-settings';
            assert.equal(title.startsWith('More settings and details'),details);
            const active = rows.find(row=>row.value==='runtime-active');
            assert.match(active.label,/Active runtime · review and edit/);
            if (++presented === 1) {
                assert.match(active.label,/original/);
                await f.c.applyRuntimeProfile({...runtime,dockerContext:'replacement'});
                return active.value;
            }
            assert.match(active.label,/replacement/);
            if (presented === 2) {
                assert.match(title,/Readiness updated · choose again/);
                assert.deepEqual(invoked,[]);
                return active.value;
            }
            return 'return-request';
        },
        execute:async command=>{invoked.push(command);return 'cancelled';},
    }));
    assert.equal(await ready.execute('/ready',f.a.conversationId),'cancelled');
    assert.equal(presented,3);
    assert.deepEqual(invoked,['/setup runtime current']);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

for (const change of ['replace', 'clear']) test(`readiness refreshes a saved runtime action after ${change}`, async t => {
    const f = await world(t), cid = f.a.conversationId;
    const runtime = {dockerBinary:'/usr/bin/false',dockerContext:'reviewed',image:'sha256:'+'3'.repeat(64)};
    const startup = ApplicationStartup.open(f.c);
    await startup.save({version:1,runtime});
    let menus = 0;
    const ready = new HostCommands(readinessCommands({
        controller:f.c, models:f.models, hostLanguage:'en', isCurrent:()=>true,
        choose:async()=>assert.fail('Expected typed readiness rows'),
        chooseItems:async(title,rows)=>{
            if (++menus === 1) {
                assert.ok(rows.some(row=>row.value==='runtime-activation'));
                if (change === 'clear') await startup.clear();
                else await startup.save({version:1,runtime:{...runtime,dockerContext:'replacement'}});
                return 'runtime-activation';
            }
            assert.match(title,/Readiness updated · choose again/);
            assert.equal(rows.some(row=>row.value==='runtime-activation'),change==='replace');
            return 'return-request';
        },
        execute:async(command)=>assert.fail('Opened stale runtime action '+command),
    }));
    assert.equal(await ready.execute('/ready',cid),'cancelled');
    assert.equal(menus,2);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

test('readiness presents one startup snapshot when the runtime is applied during catalogue reading', async t => {
    const f = await world(t), cid = f.a.conversationId;
    const runtime = {dockerBinary:'/usr/bin/false',dockerContext:'applied-during-read',image:'sha256:'+'4'.repeat(64)};
    const startup = ApplicationStartup.open(f.c);
    await startup.save({version:1,runtime});
    const list = f.models.list.bind(f.models);
    let didApply = false;
    t.mock.method(f.models,'list',async()=>{
        if (!didApply) {
            didApply = true;
            await (await startup.prepareRuntimeEdit()).save(runtime);
        }
        return list();
    });
    let menus = 0;
    const ready = new HostCommands(readinessCommands({
        controller:f.c, models:f.models, hostLanguage:'en', isCurrent:()=>true,
        choose:async()=>assert.fail('Expected typed readiness rows'),
        chooseItems:async(title,rows)=>{
            menus++;
            assert.doesNotMatch(title,/Readiness updated/);
            assert.match(rows.find(row=>row.value==='runtime-active')?.label??'',/Active runtime.*applied-during-read/);
            assert.ok(!rows.some(row=>row.value==='runtime-activation'));
            return 'return-request';
        },
        execute:async()=>assert.fail('Readiness cannot execute while observing application'),
    }));
    assert.equal(await ready.execute('/ready',cid),'cancelled');
    assert.equal(menus,1);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

test('a model change during the details choice refuses its original action', async t => {
    const f = await world(t), cid = f.a.conversationId;
    let choices = 0;
    await assert.rejects(new HostCommands(readinessCommands({
        controller:f.c, models:f.models, accounts:f.accounts, isCurrent:()=>true,
        choose:async()=>assert.fail('Typed detail selection fell back to labels'),
        chooseItems:async(_title, items)=>{
            if (choices++ === 0) return 'more-settings';
            assert.ok(items.some(item=>item.value === 'model-default'));
            await f.c.setConversationModelChoice({conversationId:cid, expectedGeneration:0,
                expectedRevision:f.c.getConversationModelChoice(cid).revision,
                choice:{kind:'unbound', reason:'Changed while inspecting details'}});
            return 'model-default';
        },
        execute:async()=>assert.fail('Stale details dispatched an action'),
    })).execute('/ready', cid), /target changed/);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n, 0);
});

test('stale selection cannot dispatch; invalid startup remains inspectable and cancelled inspection keeps draft',async t=>{
    const f=await world(t);f.c.setDraft({conversationId:f.a.conversationId,expectedRevision:0,text:'Retain 원문'});
    await fs.mkdir(path.join(f.home,'config'),{recursive:true,mode:0o700});const file=path.join(f.home,'config/startup.json'),raw='{"bridge":"PRIVATE_MALFORMED';await fs.writeFile(file,raw,{mode:0o600});
    let current=true;const host={controller:f.c,accounts:f.accounts,models:f.models,isCurrent:()=>current,execute:async()=>assert.fail('Stale or cancelled action dispatched')};
    await assert.rejects(new HostCommands(readinessCommands({...host,choose:async(_title,rows)=>{
        const repair = rows.find(row=>row.startsWith('Startup ·'));
        assert.match(repair, /Saved startup setup requires repair/);
        assert.match(repair, /inspect/);
        assert.ok(!rows.join('').includes('PRIVATE_MALFORMED'));
        current=false;return repair;
    }})).execute('/ready',f.a.conversationId),/target changed/);
    current=true;assert.equal(await new HostCommands(readinessCommands({...host,choose:async()=>undefined})).execute('/ready',f.a.conversationId),'cancelled');
    const repairs = [];
    await new HostCommands(readinessCommands({...host,choose:async(_title,rows)=>
        repairs.length ? rows.at(-1) : rows.find(row=>row.startsWith('Startup ·')),
        execute:async(command)=>{repairs.push(command);return 'cancelled';},
    })).execute('/ready',f.a.conversationId);
    assert.deepEqual(repairs, ['/setup inspect'], 'The current diagnostic retains its original repair action');
    let page = 0;
    await new HostCommands(readinessCommands({...host,choose:async()=>assert.fail('Typed details used labels'),chooseItems:async(_title,items)=>{
        assert.ok(!items.map(item=>item.label).join('').includes('PRIVATE_MALFORMED'));
        if (page++ === 0) return 'more-settings';
        assert.match(items.find(item=>item.value === 'runtime-active').label, /not configured/);
        assert.match(items.find(item=>item.value === 'runtime-saved').label, /saved setup requires repair/);
        assert.match(items.find(item=>item.value === 'bridge-saved').label, /saved setup requires repair/);
        return 'return-request';
    }})).execute('/ready',f.a.conversationId);
    assert.equal(await fs.readFile(file,'utf8'),raw);assert.equal(f.c.inspectConversation(f.a.conversationId).draft.text,'Retain 원문');assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});
test('a changed model revision while the overview is open refuses its captured action',async t=>{
    const f=await world(t);
    const registry=new HostCommands(readinessCommands({controller:f.c,accounts:f.accounts,models:f.models,isCurrent:()=>true,execute:async()=>assert.fail('Stale model action dispatched'),choose:async(_title,rows)=>{
        const choice=f.c.getConversationModelChoice(f.a.conversationId);
        f.c.setConversationModelChoice({conversationId:f.a.conversationId,expectedGeneration:0,expectedRevision:choice.revision,choice:{kind:'unbound',reason:'Changed while choosing'}});
        return rows[0];
    }}));
    await assert.rejects(registry.execute('/ready',f.a.conversationId),/target changed/);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});
test('explicit external model stays visible without offering unavailable application mutations',async t=>{
    const f=await world(t);let rows;
    const registry=new HostCommands(readinessCommands({controller:f.c,externalModel:{provider:'explicit-route',modelId:'selected'},isCurrent:()=>true,execute:async()=>assert.fail('Inspection dispatched an action'),choose:async(_title,labels)=>{rows=labels;return labels.at(-1);}}));
    assert.equal(await registry.execute('/ready',f.a.conversationId),'cancelled');
    assert.ok(rows.some(row=>row.includes('explicit-route/selected · explicit external invocation')));
    assert.ok(rows.some(row=>row.includes('use its declared account route')));
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});
test('explicit runtime and external model preserve invocation sources across relaunch and unrelated broken application configuration',async t=>{
 const root=await temporaryDirectory('ready-invocation'),home=path.join(root,'home'),project=path.join(root,'project');await fs.mkdir(project);let c=await openController({installationHome:home});
 t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});await c.registerProject({id:'P',sourceRoot:project});const view=c.createConversation({projectId:'P'}),runtime={dockerBinary:'/usr/bin/false',dockerContext:'EXPLICIT_NO_ENGINE',image:'sha256:'+'0'.repeat(64)};await c.close();
 for(const broken of [false,true]){
  const prepared=await prepareApplicationStartup(home,[project],{runtime});c=await openController({installationHome:home,runtimeProfile:prepared.configuration.runtime});const startup=ApplicationStartup.open(c,prepared),models=new ApplicationModels(c),accounts=ApplicationAccounts.open(c);
  if(broken){
   await fs.mkdir(path.join(home,'config'),{recursive:true,mode:0o700});
   await fs.writeFile(path.join(home,'config/models.json'),'{BROKEN_UNRELATED_APP_MODEL',{mode:0o600});
  }
  assert.equal((await startup.inspect()).sources.runtime,'invocation');assert.equal((await startup.inspect()).restartRequired,false);let rows;
  await new HostCommands(readinessCommands({controller:c,models,accounts,externalModel:{provider:'external',modelId:'selected'},isCurrent:()=>true,choose:async(_title,labels)=>{rows=labels;return labels.at(-1);},execute:async()=>assert.fail('Readiness cannot dispatch')})).execute('/ready',view.conversationId);
  assert.match(rows[0],/Choose how to give your request/);assert.ok(rows.find(row=>row.startsWith('Current model')).includes('external/selected'));assert.ok(!rows.find(row=>row.startsWith('Current model')).includes('repair'));assert.ok(rows.find(row=>row.startsWith('Accounts')).includes('declared account route'));
  if(broken){
   await c.setConversationModelChoice({conversationId:view.conversationId,expectedGeneration:0,expectedRevision:c.getConversationModelChoice(view.conversationId).revision,choice:{kind:'legacy-external',provider:'external',modelId:'selected'}});const before=c.getConversationModelChoice(view.conversationId);let step=0,detail;
   await new HostCommands(readinessCommands({controller:c,models,accounts,isCurrent:()=>true,choose:async(_title,labels)=>{rows=labels;return step++===0?labels[0]:labels.at(-1);},show:async(_title,text)=>{detail=text;},execute:async()=>assert.fail('Missing external profile cannot dispatch or repair unrelated configuration')})).execute('/ready',view.conversationId);
   assert.match(rows[0],/matching external model profile/);assert.match(detail,/--model-profile/);assert.ok(!rows.find(row=>row.startsWith('Current model')).includes('repair'));assert.deepEqual(c.getConversationModelChoice(view.conversationId),before);
  }
  assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);await c.close();
 }
});
test('a completed global default save survives a later selected-view change',async t=>{
    const f=await world(t);await f.accounts.configure({providers:{'ready-global':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'future'}]}}});
    let current=true;
    const registry=new HostCommands(readinessCommands({controller:f.c,accounts:f.accounts,models:f.models,isCurrent:()=>current,choose:async(_title,rows)=>rows.find(row=>row.startsWith('Future application default'))??rows.find(row=>row==='More settings and details'),execute:async(command,target)=>{
        assert.equal(command,'/model-default');assert.equal(target,f.a.conversationId);await f.accounts.setDefault('ready-global','future');current=false;return'completed';
    }}));
    assert.equal(await registry.execute('/ready',f.a.conversationId),'completed');assert.equal((await f.models.list()).default.model,'future');assert.equal(f.c.getConversationModelChoice(f.a.conversationId).kind,'unbound');
});

test('next steps match first-run project/account/model state and reuse saved selections without hidden work',async t=>{
 const f=await world(t),cid=f.a.conversationId;
 const next=async(target=cid)=>{let first;await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(_title,rows)=>{first=rows[0];return undefined;},execute:async()=>assert.fail('Inspection dispatched')})).execute('/ready',target);return first;};
 assert.match(await next(),/Connect your model account/);
 const project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});f.c.setConversationProject({conversationId:cid,projectId:'P',expectedGeneration:0});
 assert.match(await next(),/Connect your model account/);
 await f.accounts.configure({providers:{'onboard-fixture':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'first'}]}}});
 const chat=f.c.createConversation().conversationId;
 await f.models.select({conversationId:chat,expectedGeneration:0,expectedRevision:0,provider:'onboard-fixture',modelId:'first'});
 assert.match(await next(chat),/Write a prompt/);
 const openChat=new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,
    choose:async(_title,rows)=>rows[0],execute:async()=>assert.fail('Returning to the editor must not dispatch')}));
 assert.equal(await openChat.execute('/ready',chat),'completed');
 assert.equal(f.c.inspectConversationInputs(chat).length,0);
 assert.match(await next(),/Choose a model/);await f.accounts.setDefault('onboard-fixture','first');assert.match(await next(),/Use saved default model onboard-fixture\/first/);
 let command;await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(_title,rows)=>command?rows.at(-1):rows[0],execute:async value=>{command=value;return'cancelled';}})).execute('/ready',cid);assert.equal(command,'/model onboard-fixture/first');
 let choice=f.c.getConversationModelChoice(cid);await f.models.select({conversationId:cid,expectedGeneration:1,expectedRevision:choice.revision,provider:'onboard-fixture',modelId:'first'});assert.match(await next(),/Prepare the project execution environment/);
 await ApplicationStartup.open(f.c).save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'owned',image:'sha256:'+'0'.repeat(64)}});assert.match(await next(),/Review and apply the saved execution environment/);
 const builtin=(await f.models.list()).models.find(model=>model.provider==='openai');assert.ok(builtin);
 choice=f.c.getConversationModelChoice(cid);await f.c.setConversationModelChoice({conversationId:cid,expectedGeneration:1,expectedRevision:choice.revision,choice:{kind:'managed',provider:'openai',modelId:builtin.id,thinkingLevel:'off'}});
 assert.match(await next(),/Connect the account for openai/);
 // Historical bridge choice after its startup selection was removed; no successful bridge execution is seeded.
 choice=f.c.getConversationModelChoice(cid);f.c.store.tx(()=>writeConversationModelChoice(f.c.store,cid,{kind:'managed',provider:'claude-bridge',modelId:'retained',thinkingLevel:'off'},choice.revision));
 assert.match(await next(),/Restore Claude Code bridge/);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,0);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});
test('a removed selected model recommends explicit reselection instead of task start',async t=>{
 const f=await world(t),source=path.join(f.root,'project');await fs.mkdir(source);await f.c.registerProject({id:'P',sourceRoot:source});
 const config=ids=>({providers:{'removed-fixture':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:ids.map(id=>({id}))}}});await f.accounts.configure(config(['first','second']));
 const view=await f.models.newConversation({projectId:'P',choice:await f.models.choice('removed-fixture','first')});await f.accounts.configure(config(['second']));let called;
 await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(_title,rows)=>{assert.match(rows[0],/Replace unavailable current model removed-fixture\/first/);return called?rows.at(-1):rows[0];},execute:async command=>{called=command;return'cancelled';}})).execute('/ready',view.conversationId);
 assert.equal(called,'/model');assert.equal(f.c.getConversationModelChoice(view.conversationId).modelId,'first');assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,0);
});

test('restart guidance uses the actual source/npm entry or bound bundle launcher with quoted home and conversation',()=>{
 assert.equal(restartCommand("/home/alice's app",'conversation','/runtime/node','/source with spaces/dist/cli/entry.js'),"'/runtime/node' '/source with spaces/dist/cli/entry.js' conversation ui --home '/home/alice'\\''s app' --conversation 'conversation'");
 const home='/private/bound app',payload=home+'/versions/'+'a'.repeat(64);assert.equal(restartCommand(home,'c',home+'/bootstrap/node',payload+'/dist/cli/entry.js'),"'/private/bound app/gitjig' conversation ui --home '/private/bound app' --conversation 'c'");
 assert.match(restartCommand('/home/line\nbreak','c'),/copyable command is unavailable/);
});

test('pending goal and strict role inputs route to their original owners instead of ordinary recovery',async t=>{
 const f=await world(t),cid=f.a.conversationId;
 const goal=f.c.createGoal({conversationId:cid,objective:'Retain goal ownership',criteria:['Use its original continuation'],turnLimit:2});
 let freshRoute;await new HostCommands(readinessCommands({controller:f.c,externalModel:{provider:'fixture',modelId:'explicit'},isCurrent:()=>true,choose:async(_title,rows)=>freshRoute?rows.at(-1):rows[0],execute:async command=>{freshRoute=command;return'cancelled';}})).execute('/ready',cid);assert.equal(freshRoute,'/goal','A project-unbound READY goal needs no project binding or Docker runtime');
 await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Owner input for the goal',mode:'idle'});
 assert.ok(f.c.inspectConversationInputs(cid).every(row=>!row.eligible));
 const routes=[];
 const inspect=async target=>new HostCommands(readinessCommands({controller:f.c,isCurrent:()=>true,choose:async(_title,rows)=>routes.length?rows.at(-1):rows[0],execute:async command=>{routes.push(command);return'cancelled';}})).execute('/ready',target);
 await inspect(cid);assert.equal(routes.pop(),'/goal');assert.equal(f.c.inspectGoal(goal.goalId).startedAttempts,0);
 const source=path.join(f.root,'role-project');await fs.mkdir(source);await fs.writeFile(path.join(source,'input.txt'),'owned role source');await f.c.registerProject({id:'role-project',sourceRoot:source});
 const work=await f.c.beginChange({projectId:'role-project',request:'Retain the governed role route'}),run=f.c.store.one('SELECT id FROM runs WHERE work=?',work.workId);
 const role=f.c.interactions.allocateRole({workId:work.workId,runId:run.id,launchId:'fixture-role-launch',role:'planner'});
 await inspect(role.conversationId);assert.equal(routes.pop(),'/work '+work.workId);
 assert.equal(f.c.inspectChange(work.workId).phase,'BASE_CAPTURED');
});

test('retained managed runtime setup is actionable unless the original is held',async t=>{
 const f=await world(t);await f.c.close();const runtime={dockerBinary:'/usr/bin/false',dockerContext:'fixture',image:'sha256:'+'0'.repeat(64)};
 let c=await openController({installationHome:f.home,runtimeProfile:runtime});t.after(()=>c.close());
 const source=path.join(f.root,'managed-runtime');await fs.mkdir(source);await fs.writeFile(path.join(source,'a.txt'),'owned');await c.registerProject({id:'P',sourceRoot:source});
 const conversation=c.createConversation({projectId:'P'});c.changes.drive=async input=>c.changes.inspect(input.workId);
 const model={provider:'runtime-owner',modelId:'fixture',definition:{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}]}};
 const work=await c.startConversationChange({conversationId:conversation.conversationId,expectedGeneration:0,expectedModelRevision:0,projectId:'P',request:'Retain runtime ownership',model});
 await c.close();c=await openController({installationHome:f.home});ApplicationStartup.open(c,{configuration:{version:1},sources:{runtime:'none',bridge:'none'}});const models=new ApplicationModels(c);let first;
 const inspect=async()=>new HostCommands(readinessCommands({controller:c,models,externalModel:model,isCurrent:()=>true,choose:async(_title,rows)=>{first=rows[0];return undefined;},execute:async()=>assert.fail('Inspection dispatched work')})).execute('/ready',conversation.conversationId);
 await inspect();assert.match(first,/Prepare the project execution environment/);
 const {bridge,docker}=await savedBridgeFixture(f.root);
 await ApplicationStartup.open(c).save({version:1,runtime:{...runtime,dockerConfigDirectory:docker},bridge});
 assert.deepEqual((await ApplicationStartup.open(c).inspect()).activation,{runtime:'apply',bridge:'relaunch'});
 await inspect();assert.match(first,/Review and apply the saved execution environment/);
 // A retained incomplete admission needs original-work recovery even with a saved runtime.
 const workData=c.store.one('SELECT data FROM works WHERE id=?',work.workId).data;
 assert.equal(JSON.parse(workData).ownerRootActivation.state,'COMPLETE');
 c.store.run("UPDATE works SET data=json_set(data,'$.ownerRootActivation.state','PENDING') WHERE id=?",work.workId);
 assert.equal(c.inspectChangeModelPrerequisites(work.workId).stage,'held');
 await inspect();assert.match(first,/Inspect the original work/);
 c.store.run('UPDATE works SET data=? WHERE id=?',workData,work.workId);
 // Controlled retained-state premise: changing runtime metadata cannot settle unknown original cleanup.
 c.store.run('UPDATE works SET state=? WHERE id=?','UNKNOWN',work.workId);c.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?','UNKNOWN',conversation.conversationId);
 await inspect();assert.match(first,/Inspect the original work/);
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM works').n,1);
});

for (const route of ['newly linked work', 'existing work held']) test(`readiness refreshes runtime guidance for ${route}`, async t => {
    const f = await managedWorld(t, null);
    const choice = f.c.getConversationModelChoice(f.cid);
    const {workId} = await f.c.beginChange({
        projectId: 'P', request: 'Keep the original project task',
        applicationModelBaseline: await f.models.baseline('P', choice),
    });
    const link = () => f.c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?", f.cid, workId);
    if (route === 'existing work held') link();
    const before = f.c.inspectConversation(f.cid);
    const requests = [];
    let choices = 0;
    const ready = new HostCommands(readinessCommands({
        controller: f.c, models: f.models, accounts: f.accounts, hostLanguage: 'en', isCurrent: () => true,
        choose: async (_title, rows) => {
            choices++;
            if (choices === 1) {
                assert.match(rows[0], /Prepare the project execution environment/);
                if (route === 'newly linked work') link();
                f.c.store.run("UPDATE works SET data=json_set(data,'$.ownerRootActivation.state','PENDING') WHERE id=?", workId);
                assert.deepEqual(f.c.inspectConversation(f.cid), before);
                assert.equal(f.c.conversationChange(f.cid).workId, workId);
                assert.equal(f.c.inspectChangeContinuationPrerequisites(workId).stage, 'held');
                return rows[0];
            }
            assert.match(rows[0], /Inspect the original work/);
            return choices === 2 ? rows[0] : undefined;
        },
        execute: async command => {
            requests.push(command);
            assert.equal(command, '/work ' + workId, 'The stale runtime setup action cannot run');
            return 'cancelled';
        },
    }));
    assert.equal(await ready.execute('/ready', f.cid), 'cancelled');
    assert.equal(choices, 3);
    assert.deepEqual(requests, ['/work ' + workId]);
    assert.deepEqual(f.c.inspectConversation(f.cid), before);
    f.pass();
});

for (const [state,route] of [['work','/work original-work'],['work and queued input','/work original-work'],
    ['work and unreconciled input','/inputs'],['input','/inputs'],['unattributed','/error']])
test('ordinary unknown recommends inspection of '+state+' before missing setup', async t => {
    const f = await world(t), cid = f.a.conversationId, draft = 'Unsent original draft';
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    if (state.includes('input')) {
        const {inputId} = await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Previously received',mode:'idle'});
        if (state === 'work and unreconciled input')
            f.c.store.run("UPDATE conversation_inputs SET state='RECONCILIATION_REQUIRED' WHERE id=?",inputId);
    }
    if (state.startsWith('work')) {
        f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)','original-source',cid,'{}','Retained request');
        f.c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','original-work',null,'original-source',null,'original-work',
            'UNKNOWN',1,1,null,JSON.stringify({kind:'ordinary-conversation',conversation:cid}));
        f.c.store.run("UPDATE conversation_state SET work='original-work' WHERE conversation=?",cid);
    }
    f.c.store.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?",cid);
    const calls = [];
    await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,hostLanguage:'en',isCurrent:()=>true,
        choose:async(_title,rows)=>calls.length ? rows.at(-1) : rows[0],
        execute:async command=>{calls.push(command);return 'cancelled';}})).execute('/ready',cid);
    assert.deepEqual(calls,[route]);
    assert.equal(f.c.inspectConversation(cid).draft.text,draft);
    assert.equal(f.c.inspectConversation(cid).state,'UNKNOWN');
});

for (const state of ['RUNNING','SETTLING','UNKNOWN','stale request choice'])
test('current ordinary request takes precedence over retained managed guidance · '+state,async t=>{
    const f=await managedWorld(t),c=f.c,cid=f.cid,choice=c.getConversationModelChoice(cid);
    const baseline={...await f.models.baseline('P',choice),source:{kind:'conversation',conversationId:cid,choiceRevision:choice.revision}};
    const original=await c.startConversationChange({conversationId:cid,expectedGeneration:0,expectedModelRevision:choice.revision,
        projectId:'P',request:'Retained managed original',applicationModelBaseline:baseline});
    const pending=await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,
        text:'Separate current request',mode:'idle'});
    if(state!=='stale request choice')c.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?',state,cid);
    if(state==='UNKNOWN')c.store.run("UPDATE conversation_inputs SET state='RECONCILIATION_REQUIRED' WHERE id=?",pending.inputId);
    const originalRuns=c.inspectWork(original.workId).runs;
    const routes=[],draft='Unsent draft stays here';
    c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    let menus=0;
    await new HostCommands(readinessCommands({controller:c,models:f.models,accounts:f.accounts,hostLanguage:'en',isCurrent:()=>true,
        choose:async(_title,rows)=>{
            if(++menus===1){
                assert.match(rows[0],state==='RUNNING'?/Follow the current response/:state==='SETTLING'?/cleanup|settle/i:/Inspect held input/);
                if(state==='stale request choice')c.store.run("UPDATE conversation_inputs SET state='CONFLICTED' WHERE id=?",pending.inputId);
                return rows[0];
            }
            if(state==='stale request choice')assert.match(rows[0],/Inspect the original work/);
            return rows.at(-1);
        },
        execute:async command=>{routes.push(command);return 'cancelled';},
    })).execute('/ready',cid);
    assert.deepEqual(routes,state==='UNKNOWN'?['/inputs']:[]);
    assert.equal(menus,state==='UNKNOWN'||state==='stale request choice'?2:1);
    assert.equal(c.inspectConversation(cid).draft.text,draft);
    assert.deepEqual(c.inspectWork(original.workId).runs,originalRuns);
    f.pass();
});

for (const drift of ['resource','pending input','work','active producer'])
test('unbound readiness discards a stale request choice after '+drift+' drift', async t => {
    const f = await world(t), cid = f.a.conversationId;
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Unsent original draft'});
    let active = false, choices = 0;
    t.mock.method(f.c,'hasActiveConversationProducer',()=>active);
    const ready = new HostCommands(readinessCommands({controller:f.c,hostLanguage:'en',isCurrent:()=>true,
        externalModel:{provider:'fixture',modelId:'explicit'},
        choose:async(title,rows)=>{
            if (++choices === 2) {
                assert.equal(drift,'work');
                assert.match(title,/Readiness updated · choose again/);
                return undefined;
            }
            assert.match(rows[0],/Return to your draft/);
            if (drift === 'resource') f.c.store.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?",cid);
            if (drift === 'pending input') await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'A newer request',mode:'idle'});
            if (drift === 'work') {
                f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)','other-source',cid,'{}','Other request');
                f.c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','other-work',null,'other-source',null,'other-work',
                    'ACTIVE',1,1,null,JSON.stringify({kind:'ordinary-conversation',conversation:cid}));
                f.c.store.run("UPDATE conversation_state SET work='other-work' WHERE conversation=?",cid);
            }
            if (drift === 'active producer') active = true;
            return rows[0];
        },execute:async()=>assert.fail('Request guidance started an action')})).execute('/ready',cid);
    if (drift === 'work') assert.equal(await ready,'cancelled');
    else await assert.rejects(ready,/Readiness.*changed/);
    assert.equal(choices,drift === 'work' ? 2 : 1);
    assert.equal(f.c.inspectConversation(cid).draft.text,'Unsent original draft');
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});

for(const action of ['Restore Claude Code bridge','Choose another current model'])test('ordinary missing bridge offers explicit alternative '+action,async t=>{
 const f=await world(t),project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});f.c.setConversationProject({conversationId:f.a.conversationId,projectId:'P',expectedGeneration:0});const prior=f.c.getConversationModelChoice(f.a.conversationId);
 f.c.store.tx(()=>writeConversationModelChoice(f.c.store,f.a.conversationId,{kind:'managed',provider:'claude-bridge',modelId:'retained',thinkingLevel:'off'},prior.revision));let sent;
 await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(title,rows)=>sent?rows.at(-1):title==='Choose a recovery action'?action:rows[0],execute:async(command)=>{sent=command;return'cancelled';}})).execute('/ready',f.a.conversationId);
 assert.equal(sent,action==='Restore Claude Code bridge'?'/bridge':'/model');assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);assert.equal(f.c.getConversationModelChoice(f.a.conversationId).provider,'claude-bridge');
});

test('Korean bridge recovery uses the selected action identity and keeps the original model',async t=>{
    const {c,a,models,accounts}=await world(t),conversationId=a.conversationId;
    const prior=c.getConversationModelChoice(conversationId);
    c.store.tx(()=>writeConversationModelChoice(c.store,conversationId,{
        kind:'managed',provider:'claude-bridge',modelId:'original',thinkingLevel:'off',
    },prior.revision));
    const original=c.getConversationModelChoice(conversationId),calls=[];
    const registry=new HostCommands(readinessCommands({
        controller:c,models,accounts,hostLanguage:'ko-KR',isCurrent:()=>true,
        choose:async()=>assert.fail('Production readiness uses stable choices'),
        chooseItems:async(title,items)=>{
            if(title==='복구 동작 선택') {
                assert.deepEqual(items.map(item=>item.value),['back','/bridge','/model']);
                assert.equal(items[1].label,'Claude Code 브리지 복구');
                return '/bridge';
            }
            assert.match(items[0].label,/Claude Code 브리지를 복구/);
            return calls.length?'return-request':'next';
        },
        execute:async(command,target)=>{calls.push([command,target]);return 'cancelled';},
    }));
    assert.equal(await registry.execute('/ready',conversationId),'cancelled');
    assert.deepEqual(calls,[['/bridge',conversationId]]);
    assert.deepEqual(c.getConversationModelChoice(conversationId),original);
    assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

for(const provider of ['owned api_key','owned\u2003api_key'])test('ordinary opaque provider repair enters account picker without changing identity '+JSON.stringify(provider),async t=>{
 const f=await world(t),project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});f.c.setConversationProject({conversationId:f.a.conversationId,projectId:'P',expectedGeneration:0});await f.accounts.configure({providers:{[provider]:{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});await f.models.select({conversationId:f.a.conversationId,expectedGeneration:1,expectedRevision:f.c.getConversationModelChoice(f.a.conversationId).revision,provider,modelId:'fixture'});const before=f.c.getConversationModelChoice(f.a.conversationId);let dispatched;
 await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(_title,rows)=>{assert.match(rows[0],/Choose account login for/);return dispatched?rows.at(-1):rows[0];},execute:async(command)=>{dispatched=command;return'cancelled';}})).execute('/ready',f.a.conversationId);
 assert.equal(dispatched,'/login');assert.deepEqual(f.c.getConversationModelChoice(f.a.conversationId),before);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

async function requestEntryWorld(t, draft='Keep my 자연어 request') {
 const f=await world(t),project=path.join(f.root,'ready-project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});
 const cid=f.a.conversationId;f.c.setConversationProject({conversationId:cid,projectId:'P',expectedGeneration:0});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});await f.c.close();
 const runtime={dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',image:'sha256:'+'0'.repeat(64)};
 const c=await openController({installationHome:f.home,runtimeProfile:runtime});t.after(()=>c.close());
 return {c,cid,host:{controller:c,externalModel:{provider:'external',modelId:'selected'},isCurrent:()=>true}};
}

test('readiness refreshes after the original folder is restored while the project recommendation is open', async t => {
    const {c,cid,host} = await requestEntryWorld(t);
    const {sourceRoot} = c.listProjects()[0], moved = sourceRoot + '-moved';
    const before = c.inspectConversation(cid);
    await fs.rename(sourceRoot, moved);
    let restored = false;
    await new HostCommands(readinessCommands({...host,hostLanguage:'en',chooseItems:async (_title, items) => {
        if (!restored) {
            assert.match(items[0].label, /Project folder unavailable/);
            await fs.rename(moved, sourceRoot);
            restored = true;
            return 'next';
        }
        assert.match(items[0].label, /Choose how to give your request/);
        return 'return-request';
    },execute:async () => assert.fail('The stale project recommendation dispatched')})).execute('/ready',cid);
    assert.equal(restored,true);
    assert.deepEqual(c.inspectConversation(cid),before);
});

test('losing the selected folder inside request methods refreshes readiness before starting a managed request', async t => {
    const {c,cid,host} = await requestEntryWorld(t);
    const {sourceRoot} = c.listProjects()[0];
    const draft = c.inspectConversation(cid).draft;
    let moved = false;
    await new HostCommands(readinessCommands({...host,hostLanguage:'en',chooseItems:async (_title, items) => {
        if (items.some(item => item.value === 'managed')) {
            await fs.rename(sourceRoot, sourceRoot + '-moved');
            moved = true;
            return 'managed';
        }
        if (moved) {
            assert.match(items[0].label, /Project folder unavailable/);
            return 'return-request';
        }
        assert.match(items[0].label, /Choose how to give your request/);
        return 'next';
    },execute:async () => assert.fail('A project with an unavailable source entered managed start')})).execute('/ready',cid);
    assert.equal(moved,true);
    assert.deepEqual(c.inspectConversation(cid).draft,draft);
    assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

for(const method of ['prompt','managed','help','back','escape'])test('ready request guidance explicitly chooses '+method+' without sending the draft',async t=>{
 const {c,cid,host}=await requestEntryWorld(t),before=c.inspectConversation(cid).draft,calls=[],shown=[];let overview=0,choices=0;
 const result=await new HostCommands(readinessCommands({...host,show:async(title,text)=>shown.push({title,text}),choose:async(title,rows)=>{
  if(title.startsWith('Setup and next actions')){assert.match(rows[0],/Choose how to give your request/);return ++overview===1?rows[0]:rows.at(-1);}
  assert.match(title,/Give your request/);assert.match(rows[0],/Return to draft · send separately with/);choices++;
  if(method==='managed')return rows[1];
  if(method==='help'&&choices===1)return'How prompts and managed tasks work';
  if(method==='back')return'Back to setup overview';
  if(method==='escape')return undefined;
  return rows[0];
 },execute:async(command,target)=>{calls.push([command,target]);return'cancelled';}})).execute('/ready',cid);
 assert.equal(result,['prompt','help'].includes(method)?'completed':'cancelled');
 assert.deepEqual(calls,method==='managed'?[['/change start',cid]]:[]);
 assert.deepEqual(c.inspectConversation(cid).draft,before);
 for(const table of ['works','runs','conversation_inputs'])assert.equal(c.store.one('SELECT COUNT(*) AS n FROM '+table).n,0);
 if(method==='help'){assert.equal(shown.length,1);assert.match(shown[0].text,/write your request naturally/);assert.match(shown[0].text,/review/);}
});
for(const draft of ['', '/help', '!status', '//literal'])test('ready request guidance follows composer draft kind '+JSON.stringify(draft),async t=>{
 const {c,cid,host}=await requestEntryWorld(t,draft);let choices=0;
 const outcome=await new HostCommands(readinessCommands({...host,hostLanguage:'en',choose:async(_title,rows)=>{
  if(++choices===1)return rows[0];
  assert.match(rows[0],draft==='//literal'?/Return to draft · send separately with/:/Return to conversation · write a prompt/);
  return rows[0];
 },execute:async()=>assert.fail('Prompt choice admitted work')})).execute('/ready',cid);
 assert.equal(outcome,'completed');assert.equal(c.inspectConversation(cid).draft.text,draft);
});
for(const change of ['selection','queued-input','resource','goal','original-work','draft-kind'])test('request method refuses stale '+change+' before entering a task form',async t=>{
 const {c,cid,host}=await requestEntryWorld(t);let current=true;
 const registry=new HostCommands(readinessCommands({...host,isCurrent:()=>current,execute:async()=>assert.fail('Stale readiness entered task form'),choose:async(title,rows)=>{
  if(title.startsWith('Setup and next actions'))return rows[0];
  if(change==='selection')current=false;
  if(change==='queued-input')await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,text:'Newer request',mode:'idle'});
  if(change==='resource')c.store.run("UPDATE conversation_state SET resource='RUNNING' WHERE conversation=?",cid);
  if(change==='goal')c.createGoal({conversationId:cid,objective:'New goal',criteria:['Retain original'],turnLimit:3});
  if(change==='draft-kind')c.setDraft({conversationId:cid,expectedRevision:c.inspectConversation(cid).draft.revision,text:'/help'});
  if(change==='original-work'){
   const w=await c.beginChange({projectId:'P',request:'New managed request'});
   // Controlled arrival of a real captured work in this source conversation.
   c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?",cid,w.workId);
  }
  return rows[1];
 }}));
 await assert.rejects(registry.execute('/ready',cid),/Readiness.*changed|original.*work|admission|draft changed/i);
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n,change==='original-work'?1:0);
});

for(const reply of ['ko-KR','en-GB','ja'])test('localized readiness uses typed choices and preserves reply choice '+reply,async t=>{
 const {c,cid,host}=await requestEntryWorld(t);
 c.setConversationLanguage({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,expectedRevision:0,replyLanguage:reply});
 let count=0;const labels=[];
 const result=await new HostCommands(readinessCommands({...host,hostLanguage:'ko-KR',choose:async()=>assert.fail('Localized production path used legacy labels'),chooseItems:async(title,items)=>{
  labels.push(title,...items.map(item=>item.label));count++;
  return count===1?items[0].value:'prompt';
 },execute:async()=>assert.fail('Prompt choice dispatched')})).execute('/ready',cid);
 assert.equal(result,'completed');assert.equal(c.getConversationLanguage(cid).replyLanguage,reply);
 assert.match(labels.join('\n'),reply.startsWith('ko')?/요청을 전달할 방법 선택/:/Choose how to give your request/);
 assert.equal(c.inspectConversation(cid).draft.text,'Keep my 자연어 request');
});
test('reply language change during a localized choice refuses stale command dispatch',async t=>{
 const {c,cid,host}=await requestEntryWorld(t);let step=0;
 c.setConversationLanguage({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,expectedRevision:0,replyLanguage:'ko'});
 await assert.rejects(new HostCommands(readinessCommands({...host,chooseItems:async(_title,items)=>{
  if(step++===0)return items[0].value;
  c.setConversationLanguage({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,expectedRevision:1,replyLanguage:'en'});
  return 'managed';
 },execute:async()=>assert.fail('Stale locale dispatched')})).execute('/ready',cid),/Readiness target changed/);
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM works').n,0);
});

for (const entry of ['next', 'accounts']) for (const source of ['native', 'direct']) test(entry + ' exposes stable ' + source + ' route without rebinding or work', async t => {
    const f = await world(t), project = path.join(f.root, 'account-choice-project');
    await fs.mkdir(project);
    await f.c.registerProject({id: 'P', sourceRoot: project});
    f.c.setConversationProject({conversationId: f.a.conversationId, projectId: 'P', expectedGeneration: 0});
    const original = f.c.getConversationModelChoice(f.a.conversationId);
    let current = true, dispatched, choseSource = false;
    const registry = new HostCommands(readinessCommands({
        controller: f.c, models: f.models, accounts: f.accounts, isCurrent: () => current,
        choose: async () => assert.fail('Stable picker required'),
        chooseItems: async (_title, items) => {
            if (items.some(item => item.value === 'native')) {
                assert.ok(items.some(item => item.value === 'direct'));
                choseSource = true;
                return source;
            }
            assert.ok(items.some(item => item.value === entry));
            return entry;
        },
        execute: async command => { dispatched = command; current = false; return 'cancelled'; },
    }));
    await registry.execute('/ready', f.a.conversationId);
    assert.equal(choseSource, true);
    assert.equal(dispatched, source === 'native' ? '/bridge' : '/login');
    assert.deepEqual(f.c.getConversationModelChoice(f.a.conversationId), original);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n, 0);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n, 0);
});

test('Accounts exposes both sources with stored direct accounts and an unbound model', async t => {
    const f = await world(t), cid = f.a.conversationId;
    await f.accounts.configure({providers:{'ready-stored':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'first'}]}}});
    const choices = ['more-settings', 'accounts', 'back', 'return-request'], pages = [];
    const outcome = await new HostCommands(readinessCommands({
        controller: f.c, models: f.models, accounts: f.accounts, isCurrent: () => true,
        choose: async () => assert.fail('Stable picker required'),
        chooseItems: async (_title, items) => {
            pages.push(items);
            const choice = choices.shift();
            assert.ok(items.some(item => item.value === choice), choice);
            return choice;
        },
        execute: async () => assert.fail('Back from account source cannot dispatch login'),
    })).execute('/ready', cid);
    assert.equal(outcome, 'cancelled');
    assert.deepEqual(pages[2].map(item => item.value), ['native', 'direct', 'back']);
    assert.deepEqual(pages[3], pages[1]);
});

test('a request arriving in the recommended account chooser refreshes readiness before login', async t => {
    const {c, a, models, accounts} = await world(t), cid = a.conversationId;
    const draft = 'Keep the text I was editing';
    c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    let queued = false;
    const registry = new HostCommands(readinessCommands({
        controller:c, models, accounts, hostLanguage:'en', isCurrent:() => true,
        choose:async () => assert.fail('Stable picker required'),
        chooseItems:async (_title, items) => {
            if (items.some(item => item.value === 'direct')) {
                await c.queueConversationInput({conversationId:cid,expectedGeneration:a.generation,text:'A request arrived',mode:'idle'});
                queued = true;
                return 'direct';
            }
            if (queued) {
                assert.match(items[0].label, /Review pending requests/);
                return 'return-request';
            }
            return 'next';
        },
        execute:async () => assert.fail('The outdated recommendation dispatched'),
    }));
    assert.equal(await registry.execute('/ready', cid), 'cancelled');
    assert.equal(c.inspectConversation(cid).draft.text, draft);
    assert.equal(c.inspectConversationInputs(cid).length, 1);
    assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n, 0);
});

test('an original work linked in the recommended account chooser refreshes readiness before login', async t => {
    const f = await world(t), cid = f.a.conversationId, project = path.join(f.root, 'linked-original');
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'file.txt'), 'Owned source');
    await f.c.registerProject({id: 'P', sourceRoot: project});
    f.c.setConversationProject({conversationId: cid, projectId: 'P', expectedGeneration: 0});
    const {workId} = await f.c.beginChange({projectId: 'P', request: 'Earlier project task'});
    let choices = 0;
    const outcome = await new HostCommands(readinessCommands({
        controller: f.c, models: f.models, accounts: f.accounts, hostLanguage: 'en', isCurrent: () => true,
        choose: async () => assert.fail('Stable picker required'),
        chooseItems: async (_title, items) => {
            if (++choices === 1) {
                assert.match(items[0].label, /Connect your model account/);
                return 'next';
            }
            if (choices === 2) {
                assert.ok(items.some(item => item.value === 'direct'));
                f.c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?,'$.ownerRootActivation.state','PENDING') WHERE id=?", cid, workId);
                assert.equal(f.c.conversationChange(cid).workId, workId);
                return 'direct';
            }
            assert.match(items[0].label, /Inspect the original work/);
            return undefined;
        },
        execute: async () => assert.fail('Old account choice dispatched after original work appeared'),
    })).execute('/ready', cid);
    assert.equal(outcome, 'cancelled');
    assert.equal(choices, 3);
});

test('Accounts offers guided bridge recovery for the selected model with usable saved settings', async t => {
    const f = await world(t), cid = f.a.conversationId;
    const {bridge} = await savedBridgeFixture(f.root);
    await ApplicationStartup.open(f.c).save({version:1, bridge});
    f.c.store.tx(() => writeConversationModelChoice(f.c.store, cid, {kind:'managed', provider:'claude-bridge', modelId:'retained', thinkingLevel:'off'}, f.c.getConversationModelChoice(cid).revision));
    async function selectAccount(expected) {
        const choices = ['accounts', 'return-request'], calls = [];
        assert.equal(await new HostCommands(readinessCommands({
            controller: f.c, models: f.models, accounts: f.accounts, isCurrent: () => true,
            choose: async () => assert.fail('Stable picker required'),
            chooseItems: async (_title, items) => {
                const choice = choices.shift();
                assert.ok(items.some(item => item.value === choice));
                return choice;
            },
            execute: async command => { calls.push(command); return 'cancelled'; },
        })).execute('/ready', cid), 'cancelled');
        assert.deepEqual(calls, [expected]);
    }
    await selectAccount('/bridge');
    await fs.writeFile(path.join(f.home, 'config/startup.json'), '{malformed startup', {mode:0o600});
    await selectAccount('/setup inspect');
});

for(const locale of ['en','ko'])test('healthy active runtime keeps request entry while saved replacement is visible in '+locale,async t=>{
 const f=await world(t),cid=f.a.conversationId,project=path.join(f.root,'activation-project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});f.c.setConversationProject({conversationId:cid,projectId:'P',expectedGeneration:0});
 f.c.setConversationLanguage({conversationId:cid,expectedGeneration:f.c.inspectConversation(cid).generation,expectedRevision:0,replyLanguage:locale});
 const startup=ApplicationStartup.open(f.c),runtime={dockerBinary:'/usr/bin/false',dockerContext:'active',image:'sha256:'+'0'.repeat(64)};
 await (await startup.prepareRuntimeEdit()).save(runtime);await startup.save({version:1,runtime:{...runtime,dockerContext:'pending'}});
 let rows;await new HostCommands(readinessCommands({controller:f.c,models:f.models,externalModel:{provider:'external',modelId:'current'},isCurrent:()=>true,choose:async(_title,labels)=>{rows=labels;return undefined;},execute:async()=>assert.fail('Inspection cannot apply or dispatch')})).execute('/ready',cid);
 assert.match(rows[0],locale==='en'?/Choose how to give your request/:/요청/);
 assert.ok(rows.some(row=>row.includes(locale==='en'?'saved execution environment available to review and apply':'저장된 실행 환경 검토 및 적용 가능')));
 assert.ok(!rows.some(row=>row.includes(locale==='en'?'restart required':'재시작 필요')));assert.equal(f.c.options.runtimeProfile.dockerContext,'active');assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

test('a saved-only bridge cannot displace runtime setup or request entry for the selected direct model',async t=>{
 const f=await world(t),cid=f.a.conversationId;
 const project=path.join(f.root,'project'),{bridge,docker}=await savedBridgeFixture(f.root);
 await fs.mkdir(project,{mode:0o700});
 const runtime={dockerBinary:'/usr/bin/false',dockerConfigDirectory:docker,dockerContext:'prepared',image:'sha256:'+'2'.repeat(64)};
 await f.c.registerProject({id:'P',sourceRoot:project});f.c.setConversationProject({conversationId:cid,projectId:'P',expectedGeneration:0});
 await f.accounts.configure({providers:{'ready-direct':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'current'}]}}});
 await f.models.select({conversationId:cid,expectedGeneration:f.c.inspectConversation(cid).generation,expectedRevision:f.c.getConversationModelChoice(cid).revision,provider:'ready-direct',modelId:'current'});
 const startup=ApplicationStartup.open(f.c);
 const inspectNext=async()=>{
  let rows;
  await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(_title,labels)=>{rows=labels;return undefined;},execute:async()=>assert.fail('Inspection does not dispatch')})).execute('/ready',cid);
  assert.ok(rows.some(row=>row.includes('restart required to apply saved changes')));
  return rows[0];
 };
 await startup.save({version:1,runtime,bridge});
 assert.deepEqual((await startup.inspect()).activation,{runtime:'apply',bridge:'relaunch'});
 assert.match(await inspectNext(),/Review and apply the saved execution environment/);
 await (await startup.prepareRuntimeEdit()).save(runtime);
 assert.deepEqual((await startup.inspect()).activation,{runtime:'current',bridge:'relaunch'});
 assert.match(await inspectNext(),/Choose how to give your request/);
 await startup.save({version:1,runtime:{...runtime,dockerContext:'replacement'},bridge});
 const actions=[];
 await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,
  choose:async(_title,rows)=>{
   assert.match(rows[0],/Choose how to give your request/);
   assert.ok(rows.some(row=>row.includes('restart required to apply saved changes')));
   const apply=rows.find(row=>row.includes('saved execution environment available to review and apply'));
   assert.ok(apply,'The pending bridge must not hide the pending runtime while the current runtime works');
   return actions.length ? undefined : apply;
  },
  execute:async(command)=>{actions.push(command);return 'cancelled';},
 })).execute('/ready',cid);
 assert.deepEqual(actions,['/setup runtime']);
 assert.equal(f.c.options.runtimeProfile.dockerContext,'prepared');
 const selectRetained=(choice)=>f.c.store.tx(()=>writeConversationModelChoice(f.c.store,cid,choice,f.c.getConversationModelChoice(cid).revision));
 selectRetained({kind:'managed',provider:'claude-bridge',modelId:'retained',thinkingLevel:'off'});
 assert.match(await inspectNext(),/Restart to apply the saved model bridge/);
 selectRetained({kind:'unbound',reason:'First account connection'});
 assert.match(await inspectNext(),/Restart to apply the saved model bridge/);
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

for(const evidence of ['inputs','queued','queued proof','queued ambiguous','owner provenance','owner identity'])for(const boundary of ['initial','next','method','help'])test('readiness keeps setup with unavailable '+evidence+' evidence at '+boundary,async t=>{
 const {c,cid,host}=await requestEntryWorld(t), draft=c.inspectConversation(cid).draft;
 const corrupt=async()=>{
  if(evidence==='queued'){
   c.inspectConversationProjectDependencies=()=>{throw Error('Owned queue evidence unavailable');};
  } else if(evidence==='owner provenance'){
   c.conversationChange=()=>{throw Error('Owned original route unreadable');};
  } else if(evidence==='owner identity'){
   c.conversationChange=()=>({workId:''});
  } else if(evidence.startsWith('queued ')) {
   const ids=evidence==='queued ambiguous'?['first','second']:['first'];
   c.inspectConversationProjectDependencies=()=>({items:ids.map(assignmentId=>({assignmentId,workId:null,assignmentState:'QUEUED'}))});
   if(ids.length===2)c.inspectQueuedAssignmentCancellation=()=>({targetConversationId:cid});
  } else {
   const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,mode:'idle',text:'Original retained input'});
   c.store.run("UPDATE conversation_inputs SET data='{' WHERE id=?",inputId);
  }
 };
 if(boundary==='initial')await corrupt();
 let menus=0, unavailable=false, setup=false, methods=0;
 const command=new HostCommands(readinessCommands({...host,models:new ApplicationModels(c),hostLanguage:'en',
  choose:async()=>assert.fail('Expected typed readiness choices'),
  chooseItems:async(title,items)=>{
   menus++;
   if(title.startsWith('Give your request · choose a method')){
    assert.ok(boundary==='method'||boundary==='help');
    assert.equal(++methods,1,'Incomplete evidence must close the request-method picker');
    if(boundary==='help')return 'help';
    await corrupt();
    return 'managed';
   }
   if(boundary!=='initial'&&menus===1){
    if(boundary==='next')await corrupt();
    return 'next';
   }
   if(title.startsWith('More settings')){
    if(setup)return 'return-request';
    return 'runtime-active';
   }
   assert.match(items[0].label,evidence==='inputs'?/Retained requests are unavailable/:
    evidence.startsWith('owner ')?/no single original work could be identified/:
     evidence==='queued ambiguous'?/Delegated tasks need review/:/Delegated tasks are unavailable/);
   if(boundary!=='initial')assert.match(title,/Readiness updated/);
   unavailable=true;
   return 'more-settings';
  },
  show:async()=>{assert.equal(boundary,'help');await corrupt();},
  notice(){},
  execute:async route=>{assert.equal(route,'/setup runtime current');assert.ok(unavailable&&!setup);setup=true;return 'completed';}
 }));
 assert.equal(await command.execute('/ready',cid),'completed');
 assert.equal(methods,Number(boundary==='method'||boundary==='help'));
 assert.ok(unavailable&&setup);
 assert.deepEqual(c.inspectConversation(cid).draft,draft);
 assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

test('readiness keeps a verified original request available when delegated lookup fails',async t=>{
 const {c,cid,host}=await requestEntryWorld(t);
 const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,mode:'idle',text:'Exact retained request'});
 c.store.run("UPDATE conversation_inputs SET data=json_set(data,'$.routeError','Original retained failure') WHERE id=?",inputId);
 c.inspectConversationProjectDependencies=()=>{throw Error('Owned delegated lookup unavailable');};
 let reviews=0;
 const command=new HostCommands(readinessCommands({...host,hostLanguage:'en',
  chooseItems:async(title,items)=>{
   assert.match(title,/Delegated tasks are unavailable/);
   assert.match(items[0].label,/Review the original request and its failure/);
   return 'next';
  },
  choose:async()=>assert.fail('Expected typed readiness choices'),
  reviewInput:async(target,input)=>{assert.equal(target,cid);assert.equal(input.inputId,inputId);reviews++;return 'completed';},
  execute:async()=>assert.fail('Opening an exact input must not start work'),
 }));
 assert.equal(await command.execute('/ready',cid),'completed');
 assert.equal(reviews,1);
 assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

test('readiness keeps positively owned request progress visible when retained input cannot be read',async t=>{
 const {c,cid,host}=await requestEntryWorld(t);
 const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,mode:'idle',text:'Original retained input'});
 c.store.run("UPDATE conversation_inputs SET data='{' WHERE id=?",inputId);
 const progress={owner:{},label:'Checking selected model'};
 const command=new HostCommands(readinessCommands({...host,hostLanguage:'en',localRequest:()=>progress,
  choose:async()=>assert.fail('Expected typed readiness choices'),
  chooseItems:async(title,items)=>{
   assert.match(title,/Retained requests are unavailable/);
   assert.match(items[0].label,/Checking selected model.*return to the conversation/);
   return 'next';
  },
  execute:async()=>assert.fail('Returning to the active request dispatched another action'),
 }));
 assert.equal(await command.execute('/ready',cid),'cancelled');
 assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});
