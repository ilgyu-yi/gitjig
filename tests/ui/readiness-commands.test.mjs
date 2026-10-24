import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationStartup,prepareApplicationStartup} from '../../dist/app/startup.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {readinessCommands} from '../../dist/ui/readiness-commands.js';
import {restartCommand} from '../../dist/ui/startup-guidance.js';
import {writeConversationModelChoice} from '../../dist/controller/model-choice.js';
async function world(t){const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ready-command-'))),home=path.join(root,'home'),c=await openController({installationHome:home}),models=new ApplicationModels(c),accounts=ApplicationAccounts.open(c),a=await models.newConversation();t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});return{root,home,c,models,accounts,a};}
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
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ready-invocation-'))),home=path.join(root,'home'),project=path.join(root,'project');await fs.mkdir(project);let c=await openController({installationHome:home});
 t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});await c.registerProject({id:'P',sourceRoot:project});const view=c.createConversation({projectId:'P'}),runtime={dockerBinary:'/usr/bin/false',dockerContext:'EXPLICIT_NO_ENGINE',image:'sha256:'+'0'.repeat(64)};await c.close();
 for(const broken of [false,true]){
  const prepared=await prepareApplicationStartup(home,[project],{runtime});c=await openController({installationHome:home,runtimeProfile:prepared.configuration.runtime});const startup=ApplicationStartup.open(c,prepared),models=new ApplicationModels(c),accounts=ApplicationAccounts.open(c);
  if(broken)await fs.writeFile(path.join(home,'config/models.json'),'{BROKEN_UNRELATED_APP_MODEL',{mode:0o600});
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
 const next=async()=>{let first;await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(_title,rows)=>{first=rows[0];return undefined;},execute:async()=>assert.fail('Inspection dispatched')})).execute('/ready',cid);return first;};
 assert.match(await next(),/Choose your project folder/);
 const project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});f.c.setConversationProject({conversationId:cid,projectId:'P',expectedGeneration:0});
 assert.match(await next(),/Connect your model account/);
 await f.accounts.configure({providers:{'onboard-fixture':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'first'}]}}});
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

test('retained managed runtime setup is actionable while unknown original cleanup keeps recovery priority',async t=>{
 const f=await world(t);await f.c.close();const runtime={dockerBinary:'/usr/bin/false',dockerContext:'fixture',image:'sha256:'+'0'.repeat(64)};
 let c=await openController({installationHome:f.home,runtimeProfile:runtime});t.after(()=>c.close());
 const source=path.join(f.root,'managed-runtime');await fs.mkdir(source);await fs.writeFile(path.join(source,'a.txt'),'owned');await c.registerProject({id:'P',sourceRoot:source});
 const conversation=c.createConversation({projectId:'P'});c.changes.drive=async input=>c.changes.inspect(input.workId);
 const model={provider:'runtime-owner',modelId:'fixture',definition:{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}]}};
 const work=await c.startConversationChange({conversationId:conversation.conversationId,expectedGeneration:0,expectedModelRevision:0,projectId:'P',request:'Retain runtime ownership',model});
 await c.close();c=await openController({installationHome:f.home});const models=new ApplicationModels(c);let first;
 const inspect=async()=>new HostCommands(readinessCommands({controller:c,models,externalModel:model,isCurrent:()=>true,choose:async(_title,rows)=>{first=rows[0];return undefined;},execute:async()=>assert.fail('Inspection dispatched work')})).execute('/ready',conversation.conversationId);
 await inspect();assert.match(first,/Prepare the project execution environment/);
 await ApplicationStartup.open(c).save({version:1,runtime});await inspect();assert.match(first,/Review and apply the saved execution environment/);
 // Controlled retained-state premise: changing runtime metadata cannot settle unknown original cleanup.
 c.store.run('UPDATE works SET state=? WHERE id=?','UNKNOWN',work.workId);c.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?','UNKNOWN',conversation.conversationId);
 await inspect();assert.match(first,/Inspect the original work/);
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM works').n,1);
});

for(const action of ['Restore Claude Code bridge','Choose another current model'])test('ordinary missing bridge offers explicit alternative '+action,async t=>{
 const f=await world(t),project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});f.c.setConversationProject({conversationId:f.a.conversationId,projectId:'P',expectedGeneration:0});const prior=f.c.getConversationModelChoice(f.a.conversationId);
 f.c.store.tx(()=>writeConversationModelChoice(f.c.store,f.a.conversationId,{kind:'managed',provider:'claude-bridge',modelId:'retained',thinkingLevel:'off'},prior.revision));let sent;
 await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(title,rows)=>sent?rows.at(-1):title==='Choose a recovery action'?action:rows[0],execute:async(command)=>{sent=command;return'cancelled';}})).execute('/ready',f.a.conversationId);
 assert.equal(sent,action==='Restore Claude Code bridge'?'/bridge':'/model');assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);assert.equal(f.c.getConversationModelChoice(f.a.conversationId).provider,'claude-bridge');
});

for(const provider of ['owned api_key','owned\u2003api_key'])test('ordinary opaque provider repair enters account picker without changing identity '+JSON.stringify(provider),async t=>{
 const f=await world(t),project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});f.c.setConversationProject({conversationId:f.a.conversationId,projectId:'P',expectedGeneration:0});await f.accounts.configure({providers:{[provider]:{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});await f.models.select({conversationId:f.a.conversationId,expectedGeneration:1,expectedRevision:f.c.getConversationModelChoice(f.a.conversationId).revision,provider,modelId:'fixture'});const before=f.c.getConversationModelChoice(f.a.conversationId);let dispatched;
 await new HostCommands(readinessCommands({controller:f.c,models:f.models,accounts:f.accounts,isCurrent:()=>true,choose:async(_title,rows)=>{assert.match(rows[0],/Choose account login for/);return dispatched?rows.at(-1):rows[0];},execute:async(command)=>{dispatched=command;return'cancelled';}})).execute('/ready',f.a.conversationId);
 assert.equal(dispatched,'/login');assert.deepEqual(f.c.getConversationModelChoice(f.a.conversationId),before);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

async function requestEntryWorld(t) {
 const f=await world(t),project=path.join(f.root,'ready-project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});
 const cid=f.a.conversationId;f.c.setConversationProject({conversationId:cid,projectId:'P',expectedGeneration:0});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Keep my 자연어 request'});await f.c.close();
 const runtime={dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',image:'sha256:'+'0'.repeat(64)};
 const c=await openController({installationHome:f.home,runtimeProfile:runtime});t.after(()=>c.close());
 return {c,cid,host:{controller:c,externalModel:{provider:'external',modelId:'selected'},isCurrent:()=>true}};
}
for(const method of ['prompt','managed','help','back','escape'])test('ready request guidance explicitly chooses '+method+' without sending the draft',async t=>{
 const {c,cid,host}=await requestEntryWorld(t),before=c.inspectConversation(cid).draft,calls=[],shown=[];let overview=0,choices=0;
 const result=await new HostCommands(readinessCommands({...host,show:async(title,text)=>shown.push({title,text}),choose:async(title,rows)=>{
  if(title.startsWith('Setup and next actions')){assert.match(rows[0],/Choose how to give your request/);return ++overview===1?rows[0]:rows.at(-1);}
  assert.match(title,/Give your request/);assert.match(rows[0],/Return to conversation · write a prompt/);choices++;
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
for(const change of ['selection','queued-input','resource','goal','original-work'])test('request method refuses stale '+change+' before entering a task form',async t=>{
 const {c,cid,host}=await requestEntryWorld(t);let current=true;
 const registry=new HostCommands(readinessCommands({...host,isCurrent:()=>current,execute:async()=>assert.fail('Stale readiness entered task form'),choose:async(title,rows)=>{
  if(title.startsWith('Setup and next actions'))return rows[0];
  if(change==='selection')current=false;
  if(change==='queued-input')await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,text:'Newer request',mode:'idle'});
  if(change==='resource')c.store.run("UPDATE conversation_state SET resource='RUNNING' WHERE conversation=?",cid);
  if(change==='goal')c.createGoal({conversationId:cid,objective:'New goal',criteria:['Retain original'],turnLimit:3});
  if(change==='original-work'){
   const w=await c.beginChange({projectId:'P',request:'New managed request'});
   // Controlled arrival of a real captured work in this source conversation.
   c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?",cid,w.workId);
  }
  return rows[1];
 }}));
 await assert.rejects(registry.execute('/ready',cid),/Readiness.*changed|original.*work|admission/i);
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

for (const source of ['native', 'direct']) test('first account connection exposes stable ' + source + ' route without rebinding or work', async t => {
    const f = await world(t), project = path.join(f.root, 'account-choice-project');
    await fs.mkdir(project);
    await f.c.registerProject({id: 'P', sourceRoot: project});
    f.c.setConversationProject({conversationId: f.a.conversationId, projectId: 'P', expectedGeneration: 0});
    const original = f.c.getConversationModelChoice(f.a.conversationId);
    let current = true, dispatched;
    const registry = new HostCommands(readinessCommands({
        controller: f.c, models: f.models, accounts: f.accounts, isCurrent: () => current,
        choose: async () => assert.fail('Stable picker required'),
        chooseItems: async (_title, items) => {
            if (items.some(item => item.value === 'native')) {
                assert.ok(items.some(item => item.value === 'direct'));
                return source;
            }
            return items[0].value;
        },
        execute: async command => { dispatched = command; current = false; return 'cancelled'; },
    }));
    await registry.execute('/ready', f.a.conversationId);
    assert.equal(dispatched, source === 'native' ? '/bridge' : '/login');
    assert.deepEqual(f.c.getConversationModelChoice(f.a.conversationId), original);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n, 0);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n, 0);
});
