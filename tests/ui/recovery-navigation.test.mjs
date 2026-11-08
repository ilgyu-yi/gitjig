import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {uiText} from '../../dist/ui/i18n.js';
import {captureProjectDependencies,ProjectChangeHeld,projectCommands} from '../../dist/ui/project-commands.js';
import {reviewConversationInputs} from '../../dist/ui/input-commands.js';

async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-recovery-navigation-')));
 const c=await openController({installationHome:path.join(root,'app')});
 let passed=false;
 t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained recovery navigation '+root);});
 return {root,c,pass(){passed=true;}};
}

import {chooseRecoveryEntry,chooseHeldWorkRecovery} from '../../dist/ui/recovery-navigation.js';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import {localCommands} from '../../dist/ui/local-commands.js';
import {goalCommands} from '../../dist/ui/goal-commands.js';
import {readinessCommands} from '../../dist/ui/readiness-commands.js';

for(const action of ['Cancel goal coordination','Start this goal'])test('goal inspection refuses '+action+' after the reviewed definition changes',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;
 const goal=f.c.createGoal({conversationId:cid,objective:'Original reviewed goal',criteria:['Original criterion'],turnLimit:2});
 const command=goalCommands({controller:f.c,isCurrent:()=>true,input:async()=>assert.fail('Stale action opened a form'),notice(){},resolve:async()=>assert.fail('Stale action resolved a model'),choose:async()=>{
  f.c.reviseGoal({goalId:goal.goalId,expectedRevision:goal.revision,objective:'Changed owner goal',criteria:['Changed criterion'],reason:'Independent owner revision'});
  return action;
 }})[0];
 await assert.rejects(command.run('inspect',cid),/Goal changed; reopen/);
 const current=f.c.inspectGoal(goal.goalId);assert.equal(current.objective,'Changed owner goal');assert.notEqual(current.state,'CANCELLED');assert.equal(current.revision,goal.revision+1);assert.equal(current.startedAttempts,0);f.pass();
});
test('unchanged goal inspection can cancel the original goal',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,goal=f.c.createGoal({conversationId:cid,objective:'Original goal',criteria:['Explicit owner cancellation'],turnLimit:2});
 let choices=0;const result=await goalCommands({controller:f.c,isCurrent:()=>true,input:async()=>assert.fail('Cancellation opened a form'),notice(){},resolve:async()=>assert.fail('Cancellation resolved a model'),choose:async()=> ++choices===1?'Cancel goal coordination':'End this goal coordination permanently'})[0].run('inspect',cid);
 assert.equal(result,'completed');assert.equal(f.c.inspectGoal(goal.goalId).state,'CANCELLED');assert.equal(f.c.inspectGoal(goal.goalId).startedAttempts,0);f.pass();
});
for(const saved of [false,true])test('readiness nested cancellation returns to overview and preserves prior completion: '+saved,async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Preserve owner draft'});const draft=f.c.inspectConversation(cid).draft;let overviews=0;const commands=[];
 const result=await readinessCommands({controller:f.c,hostLanguage:'en',isCurrent:()=>true,choose:async(_title,rows)=>{
  overviews++;
  if(saved&&overviews===1)return rows.find(row=>row.startsWith('Project ·'));
  if(overviews===(saved?2:1))return rows.find(row=>row.startsWith('More settings'));
  if(overviews===(saved?3:2))return rows.find(row=>row.startsWith('Local development'));
  return rows.at(-1);
 },execute:async(command,target)=>{
  commands.push(command);assert.equal(target,cid);
  if(command==='/project'){f.c.setConversationProject({conversationId:cid,expectedGeneration:0,projectId:'P'});return 'completed';}
  assert.equal(command,'/local');return 'cancelled';
 }})[0].run('',cid);
 assert.equal(overviews,saved?4:3);assert.deepEqual(commands,saved?['/project','/local']:['/local']);assert.equal(result,saved?'completed':'cancelled');assert.equal(f.c.inspectConversation(cid).projectId,saved?'P':null);assert.deepEqual(f.c.inspectConversation(cid).draft,draft);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);f.pass();
});
test('recovery entry is explicit, exact, source-guarded and forwards the original destination outcome',async()=>{
 let current=true,calls=0;const fresh=()=>{if(!current)throw Error('Source changed');};
 const entry=[{command:'/work original-id',label:'Open original recovery'}];
 const host={choose:async(_title,rows)=>{assert.equal(rows[0],'Back without action');return rows[1];},navigate:async command=>{assert.equal(command,'/work original-id');calls++;return 'started';}};
 assert.equal(await chooseRecoveryEntry(host,fresh,entry),'started');assert.equal(calls,1);
 assert.equal(await chooseRecoveryEntry({...host,choose:async()=>undefined},fresh,entry),undefined);assert.equal(calls,1);
 await assert.rejects(chooseRecoveryEntry({...host,choose:async()=>'/invented'},fresh,entry),/Unknown/);
 await assert.rejects(chooseRecoveryEntry({...host,choose:async(_title,rows)=>{current=false;return rows[1];}},fresh,entry),/Source changed/);assert.equal(calls,1);
});
for(const kind of ['repository','source-branch'])test('nested empty '+kind+' prerequisite reaches the existing exact registration entry without losing started outcome',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,context={submission:{conversationId:cid,text:'/repo',revision:0}},seen=[];
 const choices=kind==='repository'?['Integration targets','Register GitHub branch receiver','Repository ·','Register repository identity']:['PR merge targets','Register existing PR merge target','Source branch target ·','Open source branch targets and registration'];
 const counts=()=>['works','runs','effect_targets','merge_targets','repository_configuration_targets'].filter(table=>f.c.store.one("SELECT name FROM sqlite_master WHERE name=?",table)).map(table=>[table,f.c.store.one('SELECT COUNT(*) n FROM '+table).n]);const before=counts();
 const ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{seen.push(title);const prefix=choices.shift();assert.ok(prefix,'Unexpected extra menu '+title);return rows.find(row=>row.startsWith(prefix));},show:async()=>{},input:async()=>assert.fail('Navigation entered a native credential prompt'),notice(){},execute:async(command,target,ctx)=>{assert.equal(command,kind==='repository'?'/repo register':'/repo integration-targets');assert.equal(target,cid);assert.equal(ctx,context);return 'started';}});
 assert.equal(await ui.commands[0].run('',cid,context),'started');await ui.close();assert.equal(choices.length,0);assert.deepEqual(counts(),before);assert.ok(seen.some(title=>title.includes(kind==='repository'?'recovery entry':'source branches')));f.pass();
});
test('local missing-project prerequisite offers original selection entry without admitting a check',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,routes=[];const ui=localCommands({controller:f.c,isCurrent:()=>true,choose:async(_title,rows)=>rows.find(row=>row.includes('/project')),input:async()=>assert.fail('No command input'),show:async()=>{},notice(){},execute:async(command)=>{routes.push(command);return 'completed';}});
 assert.equal(await ui.commands[0].run('',cid),'completed');assert.deepEqual(routes,['/project']);await ui.close();assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);f.pass();
});
test('empty goal inspection offers the original definition form; Back creates nothing and never starts',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;let inputs=0;
 const make=choose=>goalCommands({controller:f.c,isCurrent:()=>true,choose,input:async()=>{inputs++;return undefined;},notice(){},resolve:async()=>assert.fail('Opening goal definition invoked a model')})[0];
 assert.equal(await make(async(_title,rows)=>{assert.equal(rows[0],'Back without action');return rows[0];}).run('',cid),'cancelled');assert.equal(inputs,0);
 let menus=0;
 assert.equal(await make(async(_title,rows)=>++menus===1?rows[1]:rows[0]).run('',cid),'cancelled');assert.equal(menus,2);
 assert.equal(inputs,1);assert.equal(f.c.conversationGoal(cid),null);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});

for(const backend of ['local','hosted'])test('empty project prerequisite in '+backend+' receiver registration forwards original /project entry',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,choices=['Integration targets',backend==='local'?'Register local bare receiver':'Register GitHub branch receiver','Project ·','Select or register project'];
 const ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(_title,rows)=>{const prefix=choices.shift();assert.ok(prefix);const selected=rows.find(row=>row.startsWith(prefix));assert.ok(selected,JSON.stringify(rows));return selected;},show:async()=>{},input:async()=>assert.fail('No native inputs'),notice(){},execute:async(command,target)=>{assert.equal(command,'/project');assert.equal(target,cid);return 'completed';}});
 assert.equal(await ui.commands[0].run('',cid),'completed');assert.equal(choices.length,0);assert.equal(f.c.listProjects().length,0);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);await ui.close();f.pass();
});
test('goal creation refuses switched view and changed language while opening its empty-goal entry',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;let selected=true;
 const h={controller:f.c,isCurrent:()=>selected,choose:async(_title,rows)=>{selected=false;return rows[1];},input:async()=>assert.fail('Stale goal definition opened'),notice(){},resolve:async()=>assert.fail('Unexpected model')};
 await assert.rejects(goalCommands(h)[0].run('',cid),/Goal source changed/);selected=true;
 await assert.rejects(goalCommands({...h,choose:async(_title,rows)=>{const old=f.c.getConversationLanguage(cid);f.c.setConversationLanguage({conversationId:cid,expectedGeneration:f.c.inspectConversation(cid).generation,expectedRevision:old.revision,replyLanguage:'ko'});return rows[1];}})[0].run('',cid),/Goal source changed/);
 assert.equal(f.c.conversationGoal(cid),null);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);f.pass();
});

test('held-work recovery retains exact legacy refusal and leaves navigation failures attributable',async()=>{
 const refusal='Original execution allowance exhausted; retain spent usage';let guards=0;
 assert.throws(()=>chooseHeldWorkRecovery({choose:async()=>assert.fail('Legacy refusal opened a picker')},'original-id',()=>guards++,refusal),error=>error instanceof Error&&error.message===refusal);
 assert.equal(guards,0);
 const host={choose:async(_title,rows)=>rows[0],navigate:async()=>assert.fail('Back navigated')};
 assert.equal(await chooseHeldWorkRecovery(host,'original-id',()=>guards++,refusal),undefined);assert.equal(guards,2);
 const failure=Error('Original navigation unavailable');
 await assert.rejects(chooseHeldWorkRecovery({...host,choose:async(_title,rows)=>rows[1],navigate:async command=>{assert.equal(command,'/work original-id');throw failure;}},'original-id',()=>{},refusal),error=>error===failure);
});

import {errorCommands} from '../../dist/ui/error-commands.js';
import {bridgeProfileFailure,conversationStartupFailure,failurePresentation} from '../../dist/ui/failure-details.js';

test('Claude profile refusal routes only the original owned diagnostic and refuses stale navigation',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,marker='BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: plugins';
 const action='Review Claude Code connection';
 const projected=bridgeProfileFailure({bridgeProfileMismatch:'plugins',failure:marker,workId:'W',runId:'R'},'en');
 assert.match(projected.detail,/BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: plugins/);
 let failure=failurePresentation(Error(marker)),route,changeDuringMenu=false;
 const notices=[];
 const command=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,
  choose:async(_title,rows)=>{
   assert.equal(rows.includes(action),failure===projected);
   assert.equal(rows.includes('Choose another model for this conversation'),failure===projected);
   if(changeDuringMenu)failure=failurePresentation(Error(marker));
   return rows.includes(action)?action:'Back to conversation';
  },showReview:async()=>assert.fail('Unexpected details'),notice:text=>notices.push(text),
  execute:async(command,target)=>{route=command;assert.equal(target,cid);return 'completed';}})[0];
 assert.equal(await command.run('',cid),'cancelled');assert.equal(route,undefined);
 failure=projected;assert.equal(await command.run('',cid),'completed');assert.equal(route,'/bridge');
 route=undefined;changeDuringMenu=true;
 assert.equal(await command.run('',cid),'cancelled');assert.equal(route,undefined);
 assert.deepEqual(notices,[uiText('en','error.sourceChanged')]);
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});

test('error command rejects an identical newer project hold before opening an independent conversation',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,hold={code:'PROJECT_DEPENDENCY_PENDING',message:'Same retained error'};
 let failure=failurePresentation(hold),calls=0;const notices=[];
 const h={controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,choose:async()=>{failure=failurePresentation(hold);return 'Open an independent conversation for another project';},showReview:async()=>assert.fail('Stale details opened'),notice:text=>notices.push(text),execute:async()=>{calls++;return 'started';}};
 assert.equal(await errorCommands(h)[0].run('',cid),'cancelled');assert.equal(calls,0);
 assert.deepEqual(notices,[uiText('en','error.sourceChanged')]);f.pass();
});

for (const change of ['settlement', 'model']) test(`a stale project recovery choice checks source scope before rebuilding · ${change}`, async t => {
    const f = await fixture(t), cid = f.c.createConversation().conversationId;
    errorLanguage(f.c,cid,'en');
    const sourceRoot = path.join(f.root,'destination');
    await fs.mkdir(sourceRoot);
    await f.c.registerProject({id:'P',sourceRoot});
    const failure = failurePresentation(new ProjectChangeHeld('Original response was active',{id:'P',sourceRoot},
        'PROJECT_RESPONSE_ACTIVE','Original recovery'));
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Same unsent draft'});
    const draft = f.c.inspectConversation(cid).draft;
    let status = {active:true,revision:1}, menus = 0;
    const steps = [], notices = [], calls = [];
    const command = errorCommands({
        controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,failureStatus:()=>status,
        choose:async (title,rows) => {
            if (++menus === 1) {
                assert.match(title,/Original response was active/);
                status = {active:false,revision:2};
                if (change === 'model')
                    await f.c.setConversationModelChoice({conversationId:cid,expectedGeneration:0,expectedRevision:0,
                        choice:{kind:'legacy-external',provider:'fixture',modelId:'another-model'}});
                return rows.find(row=>row==='Open P in an independent conversation');
            }
            steps.push(title);
            return rows.find(row=>row==='Retry switching this conversation to P');
        },
        openProject:async()=>assert.fail('The stale choice opened its destination'),
        execute:async (route,target) => {
            assert.equal(target,cid);
            calls.push(route);
            return 'completed';
        },
        showReview:async()=>assert.fail('Unexpected details'),
        notice:text=>notices.push(text),
    })[0];
    const outcome = await command.run('',cid);
    assert.deepEqual(f.c.inspectConversation(cid).draft,draft);
    if (change === 'settlement') {
        assert.equal(outcome,'completed');
        assert.equal(menus,2);
        assert.match(steps[0],/Previous error[\s\S]*Recovery options updated · choose again/);
        assert.deepEqual(calls,['/project P']);
        assert.deepEqual(notices,[]);
    } else {
        assert.equal(outcome,'cancelled');
        assert.equal(menus,1);
        assert.deepEqual(calls,[]);
        assert.deepEqual(notices,[uiText('en','error.sourceChanged')]);
    }
    f.pass();
});

for (const action of ['back', 'open project']) test(`error review with a changed diagnostic handles ${action} without replacing it`,async t=>{
    const f=await fixture(t), cid=f.c.createConversation().conversationId;
    let failure=failurePresentation(new ProjectChangeHeld('Original hold',{id:'P',sourceRoot:f.root},
        'PROJECT_RESPONSE_ACTIVE','Original recovery'));
    const replacement=failurePresentation(Error('New actual diagnostic')), notices=[];
    const command=errorCommands({
        controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,
        choose:async(_title,rows)=>{
            if(action==='back') {
                failure=replacement;
                return 'Back to conversation';
            }
            return rows.find(row=>row==='Open P in an independent conversation');
        },
        showReview:async()=>assert.fail('Unexpected inspection'),notice:text=>notices.push(text),
        execute:async()=>assert.fail('Stale review dispatched'),
        openProject:async(_target,_destination,current)=>{
            await new Promise(resolve=>setImmediate(resolve));
            failure=replacement;
            current();
            assert.fail('Stale project review could allocate');
        },
    })[0];
    assert.equal(await command.run('',cid),'cancelled');
    assert.equal(failure,replacement);
    assert.deepEqual(notices,action==='back'?[]:[uiText('en','error.sourceChanged')]);
    assert.equal(f.c.listConversations().length,1);
    f.pass();
});

for (const scenario of ['held again','newer error','replaced destination','unrelated failure','switched']) test('project retry handles '+scenario+' with one explicit attempt',async t=>{
    const f=await fixture(t),cid=f.c.createConversation().conversationId,sourceRoot=path.join(f.root,'destination');
    errorLanguage(f.c,cid,'en');
    const project={id:'P',sourceRoot};let registered=project,revision=0,attempts=0,reports=0,menus=0;
    f.c.listProjects=()=>[registered];
    const original=failurePresentation(new ProjectChangeHeld('Original dependency hold',project,'PROJECT_DEPENDENCY_PENDING','Original evidence'));
    const next=new ProjectChangeHeld('Updated request hold',project,'PROJECT_INPUT_PENDING','Updated delivery evidence');
    const unrelated=new Error('Independent failure'),newer=failurePresentation(unrelated),notices=[];
    let failure=original;
    const command=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,
        failureStatus:()=>({active:true,revision}),reportProjectHold:(target,error)=>{
            assert.equal(target,cid);assert.equal(error,next);reports++;failure=failurePresentation(error);revision++;
        },choose:async(title,rows)=>{
            if(++menus===1) {
                assert.match(title,/Original dependency hold/);
                return rows.find(row=>row==='Retry switching this conversation to P');
            }
            assert.equal(scenario,'held again');assert.match(title,/Updated request hold/);assert.match(title,/Requested project · "P"/);
            assert.doesNotMatch(title,/Original dependency hold/);
            return menus===2?'Error details · inspect':'Back to conversation';
        },showReview:async(_title,detail)=>assert.match(detail,/Updated delivery evidence/),notice:text=>notices.push(text),
        execute:async(command,target,context)=>{
            assert.equal(command,'/project P');assert.equal(target,cid);assert.equal(context,undefined);attempts++;
            if(scenario==='switched')return 'completed';
            if(scenario==='unrelated failure')throw unrelated;
            if(scenario==='newer error'){failure=newer;revision++;}
            if(scenario==='replaced destination')registered={id:'P',sourceRoot:path.join(f.root,'replacement')};
            throw next;
        },openProject:async()=>assert.fail('Unexpected independent conversation')})[0];
    const run=command.run('',cid,{submission:{conversationId:cid,text:'/error',revision:0}});
    if(scenario==='unrelated failure')await assert.rejects(run,error=>error===unrelated);
    else if(scenario==='replaced destination')await assert.rejects(run,/project.*changed/iu);
    else assert.equal(await run,scenario==='switched'?'completed':'cancelled');
    assert.equal(attempts,1);assert.equal(reports,scenario==='held again'?1:0);assert.equal(menus,scenario==='held again'?3:1);
    if(scenario==='newer error')assert.equal(failure,newer);
    assert.deepEqual(notices,scenario==='newer error'?[uiText('en','error.sourceChanged')]:[]);
    assert.equal(f.c.inspectConversation(cid).projectId,null);
    f.pass();
});

test('same-conversation project retry refuses a replaced registered destination', async t => {
    const f = await fixture(t), cid = f.c.createConversation().conversationId;
    const sourceRoot = path.join(f.root,'destination');
    let currentRoot = sourceRoot, invoked = 0;
    f.c.listProjects = () => [{id:'P',sourceRoot:currentRoot}];
    const failure = failurePresentation(new ProjectChangeHeld('Project is held', {id:'P',sourceRoot},
        'PROJECT_DEPENDENCY_PENDING', 'Original recovery'));
    const command = errorCommands({
        controller:f.c, isCurrent:()=>true, assertAvailable(){}, failure:()=>failure,
        choose:async(_title,rows)=>{
            const retry = 'Retry switching this conversation to P';
            assert.ok(rows.includes(retry));
            currentRoot = path.join(f.root,'replacement');
            return retry;
        },
        showReview:async()=>assert.fail('Unexpected inspection'), notice(){},
        execute:async()=>{invoked++;return 'completed';},
        openProject:async()=>assert.fail('Unexpected independent conversation'),
    })[0];
    await assert.rejects(command.run('',cid), /project.*changed/iu);
    assert.equal(invoked,0);
    assert.equal(f.c.inspectConversation(cid).projectId,null);
    f.pass();
});
for(const scenario of ['queued child','unnamed child','waiting parent','settled before choice','settled during choice','changed related generation','hidden related','observation unavailable','captured sibling holds'])test('project hold opens only its current related conversation: '+scenario,async t=>{
 const f=await fixture(t),parent=f.c.createConversation().conversationId,child=f.c.createConversation().conversationId;
 const incoming=scenario==='waiting parent',source=incoming?child:parent,related=incoming?parent:child;
 const unnamed=scenario==='unnamed child';
 if(unnamed)f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({role:'builder',purpose:'Private derived title'}),related);
 else f.c.setConversationName({conversationId:related,expectedGeneration:0,name:'Related original'});
 f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','related-assignment',parent,child,null,'QUEUED','{}');
 if(incoming)f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','related-wait',parent,child,'related-assignment','PENDING','{}');
 const relationship={dependencyId:incoming?'related-wait':null,assignmentId:'related-assignment',conversationId:related,taskConversationId:child,waitingFor:!incoming,
    workId:null,assignmentState:'QUEUED'};
 const dependency={relationships:[relationship],sourceConversationId:source,sourceGeneration:0,sourceProjectId:null};
 const siblingHolds=scenario==='captured sibling holds';
 let sibling;
 if(siblingHolds) {
    sibling=f.c.createConversation().conversationId;
    const uncaptured=f.c.createConversation().conversationId;
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?),(?,?,?,?,?,?)',
      'sibling',parent,sibling,null,'QUEUED','{}','uncaptured',parent,uncaptured,null,'QUEUED','{}');
    dependency.relationships.push({dependencyId:null,assignmentId:'sibling',conversationId:sibling,taskConversationId:sibling,waitingFor:true,
      workId:null,assignmentState:'QUEUED'});
 }
 const failure=failurePresentation(new ProjectChangeHeld('Project held',{id:'P',sourceRoot:f.root},'PROJECT_DEPENDENCY_PENDING','Original hold',undefined,{dependency}));
 const action='Open related conversation · '+(unnamed?'':'Related original · ')+related,opened=[];
 const settle=()=>f.c.store.run("UPDATE conversation_assignments SET state='CANCELLED' WHERE id=?",relationship.assignmentId);
 const stale=scenario==='settled during choice'||scenario==='changed related generation';
 const unavailable=scenario==='hidden related'||scenario==='observation unavailable';
 let menus=0;
 const settledBefore=scenario==='settled before choice'||siblingHolds;
 if(settledBefore)settle();
 if(scenario==='hidden related') {
    const inspect=f.c.inspectConversation.bind(f.c);
    f.c.inspectConversation=id=>id===related?{...inspect(id),archived:true}:inspect(id);
 }
 if(scenario==='observation unavailable') {
    const inspect=f.c.inspectConversationProjectDependencies.bind(f.c);
    f.c.inspectConversationProjectDependencies=input=>{
      if(input.lifecycleHolds)throw Error('Captured observation unavailable');
      return inspect(input);
    };
 }
 const [command]=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,notice(){},
  choose:async(title,rows)=>{
   if(++menus===2){
    assert.ok(stale);
    assert.match(title,/Recovery options updated · choose again/);
    assert.doesNotMatch(title,/Project held/);
    assert.equal(title.includes('The recorded dependency changed'),scenario==='settled during choice');
    assert.ok(rows.includes('Retry switching this conversation to P'));
    assert.equal(rows.includes(action),scenario==='changed related generation');
    return undefined;
   }
   assert.equal(rows.includes(action),!unavailable&&!settledBefore);
   assert.equal(title.includes('The recorded dependency changed'),settledBefore);
   assert.equal(title.includes('Could not check current dependencies'),scenario==='observation unavailable');
   assert.equal(rows.includes('Refresh recovery choices'),scenario==='observation unavailable');
   if(siblingHolds)assert.deepEqual(rows.filter(row=>row.startsWith('Open related conversation')),['Open related conversation · '+sibling]);
   assert.ok(rows.every(row=>!row.includes('Private derived title')));
   if(unavailable||settledBefore)return undefined;
   if(scenario==='settled during choice')settle();
   if(scenario==='changed related generation')f.c.store.run('UPDATE conversations SET generation=generation+1 WHERE id=?',related);
   return action;
  },showReview:async()=>assert.fail('Unexpected details'),execute:async()=>assert.fail('Navigation dispatched a command'),
  openConversation:async id=>opened.push(id),openProject:async()=>assert.fail('Navigation opened independent root')});
 assert.equal(await command.run('',source),stale||unavailable||settledBefore?'cancelled':'completed');
 assert.equal(menus,stale?2:1);
 assert.deepEqual(opened,['queued child','unnamed child','waiting parent'].includes(scenario)?[related]:[]);
 for(const table of ['runs','works','conversation_inputs'])assert.equal(f.c.store.one('SELECT COUNT(*) n FROM '+table).n,0);
 f.pass();
});
test('a held switch can open every captured queued child within the original display bound',async t=>{
 const f=await fixture(t),source=f.c.createConversation().conversationId,project=path.join(f.root,'project');
 await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});
 const queue=(id,wait=false)=>{
  const child=f.c.createConversation().conversationId;
  f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',id,source,child,null,'QUEUED','{}');
  if(wait)f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','wait-'+id,source,child,id,'PENDING','{}');
  return child;
 };
 const captured=Array.from({length:10},(_,index)=>queue('queued-'+index));
 const [projectCommand]=projectCommands({controller:f.c,hostLanguage:'en',isCurrent:()=>true,notice(){},refresh:async()=>assert.fail('Held switch changed project'),input:async()=>undefined,choose:async()=>undefined});
 let failure;
 await assert.rejects(projectCommand.run('P',source),error=>{
  assert.equal(error.code,'PROJECT_DEPENDENCY_PENDING');
  failure=failurePresentation(error);return true;
 });
 // A later unfiltered query would fill its entire cap with newer waits before reaching the queued originals.
 for(let index=0;index<9;index++)queue('new-'+index,true);
 f.c.store.run("UPDATE conversation_assignments SET state='RUNNING' WHERE id='queued-1'");
 const opened=[],label=id=>'Open related conversation · '+id,before=f.c.inspectConversation(source);
 const [errorCommand]=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,notice(){},
  choose:async(_title,rows)=>{
   assert.deepEqual(rows.filter(row=>row.startsWith('Open related conversation')),captured.slice(0,8).map(label));
   return label(captured[1]);
  },showReview:async()=>assert.fail('Unexpected details'),execute:async()=>assert.fail('Navigation dispatched a command'),
  openConversation:async id=>opened.push(id),openProject:async()=>assert.fail('Navigation opened independent root')});
 assert.equal(await errorCommand.run('',source),'completed');
 assert.deepEqual(opened,[captured[1]]);
 assert.deepEqual(f.c.inspectConversation(source),before);
 for(const table of ['runs','works','conversation_inputs'])assert.equal(f.c.store.one('SELECT COUNT(*) n FROM '+table).n,0);
 f.pass();
});
for(const retireBoth of [false,true])test('duplicate captured waits offer one route and recheck remaining original evidence · '+retireBoth,async t=>{
 const f=await fixture(t),parent=f.c.createConversation().conversationId,child=f.c.createConversation().conversationId;
 const relationships=['wait-1','wait-2'].map(dependencyId=>{
  f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)',dependencyId,parent,child,null,'PENDING','{}');
  return {dependencyId,assignmentId:null,conversationId:child,taskConversationId:child,waitingFor:true};
 });
 const failure=failurePresentation(new ProjectChangeHeld('Project held',{id:'P',sourceRoot:f.root},'PROJECT_DEPENDENCY_PENDING','Original hold',undefined,
  {dependency:{relationships,sourceConversationId:parent,sourceGeneration:0,sourceProjectId:null}}));
 const opened=[],action='Open related conversation · '+child;
 let menus=0;
 const [command]=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,notice(){},
  choose:async(title,rows)=>{
   if(++menus===2){
    assert.match(title,/Recovery options updated · choose again/);
    assert.match(title,/The recorded dependency changed/);
    assert.deepEqual(rows.filter(row=>row.startsWith('Open related conversation')),retireBoth?[]:[action]);
    return retireBoth?undefined:action;
   }
   assert.deepEqual(rows.filter(row=>row.startsWith('Open related conversation')),[action]);
   f.c.store.run("UPDATE conversation_dependencies SET state='RESOLVED' WHERE id='wait-1'");
   if(retireBoth)f.c.store.run("UPDATE conversation_dependencies SET state='RESOLVED' WHERE id='wait-2'");
   return action;
  },showReview:async()=>assert.fail('Unexpected details'),execute:async()=>assert.fail('Navigation dispatched a command'),
  openConversation:async id=>opened.push(id),openProject:async()=>assert.fail('Navigation opened independent root')});
 assert.equal(await command.run('',parent),retireBoth?'cancelled':'completed');
 assert.equal(menus,2);
 assert.deepEqual(opened,retireBoth?[]:[child]);
 f.pass();
});
test('an unavailable read preserves the previously observed historical dependency message',async t=>{
 const f=await fixture(t),parent=f.c.createConversation().conversationId,child=f.c.createConversation().conversationId;
 const relationships=[{dependencyId:'original',assignmentId:null,conversationId:child,taskConversationId:child,waitingFor:true}];
 const failure=failurePresentation(new ProjectChangeHeld('Original hold',{id:'P',sourceRoot:f.root},'PROJECT_DEPENDENCY_PENDING','Original evidence',undefined,
  {dependency:{relationships,sourceConversationId:parent,sourceGeneration:0,sourceProjectId:null}}));
 const inspect=f.c.inspectConversationProjectDependencies.bind(f.c);
 let reads=0,menus=0,shown=0;
 f.c.inspectConversationProjectDependencies=input=>{
  if(input.lifecycleHolds&&++reads>1)throw Error('Read unavailable after confirmed absence');
  return inspect(input);
 };
 const [command]=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,notice(){},
  choose:async title=>{
   assert.match(title,/The recorded dependency changed/);
   assert.equal(title.includes('Could not check current dependencies'),menus===1);
   return ++menus===1?'Error details · inspect':undefined;
  },
  showReview:async(title,text)=>{assert.match(title,/Previous error details/);assert.match(text,/Original evidence/);shown++;},
  execute:async()=>assert.fail('Historical inspection dispatched'),openProject:async()=>assert.fail('Unexpected navigation')});
 assert.equal(await command.run('',parent),'cancelled');
 assert.deepEqual([menus,shown],[2,1]);
 f.pass();
});

test('error recovery offers independent project navigation for attributed holds',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,action='Open an independent conversation for another project';
 const context={submission:{conversationId:cid,text:'/error',revision:0}};
 for(const code of ['PROJECT_DEPENDENCY_PENDING','PROJECT_CONTINUATION_PENDING','PROJECT_WORK_PENDING']){
  const snapshot=failurePresentation({code,message:'Original project held'});
  const command=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>snapshot,
   choose:async(_title,rows)=>{assert.ok(rows.includes(action));return action;},showReview:async()=>assert.fail('Unexpected details'),
   notice(){},execute:async(route,target,original)=>{assert.equal(route,'/new root');assert.equal(target,cid);assert.equal(original,context);return 'completed';}})[0];
  assert.equal(await command.run('',cid,context),'completed');
 }
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});
for(const drift of ['goal','occurrence','other pane']) test('closing a nested goal detects '+drift+' before restoring error recovery',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;
 errorLanguage(f.c,cid,'en');
 const goal=f.c.createGoal({conversationId:cid,objective:'Original goal',criteria:['Retain the original recovery choice'],turnLimit:2});
 let snapshot=failurePresentation({message:'Original diagnostic'}),current=true;
 const notices=[];let picks=0;
 const outcome=await errorCommands({controller:f.c,isCurrent:()=>current,assertAvailable(){},failure:()=>snapshot,
  choose:async(_title,rows)=>{assert.equal(++picks,1);return rows.find(row=>row===errorCopy.en.goal);},showReview:async()=>assert.fail('Unexpected details'),notice:text=>notices.push(text),
  execute:async command=>{
   assert.equal(command,'/goal');
   if(drift==='goal')f.c.reviseGoal({goalId:goal.goalId,expectedRevision:goal.revision,objective:'Updated goal',criteria:['Retained original'],reason:'Independent owner change'});
   if(drift==='occurrence')snapshot=failurePresentation({message:'New diagnostic'});
   if(drift==='other pane')current=false;
   return 'cancelled';
  }})[0].run('',cid);
 assert.equal(outcome,'cancelled');assert.equal(picks,1);
 assert.deepEqual(notices,drift==='other pane'?[]:[uiText('en',drift==='goal'?'error.goalChanged':'error.sourceChanged')]);
 f.pass();
});

test('closing error details returns to choices and preserves the original diagnostic without dispatch',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,snapshot=failurePresentation(Error('Retained details'));let picks=0,shown=0;
 const result=await errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>snapshot,choose:async()=>++picks===1?'Error details · inspect':undefined,showReview:async(_title,detail)=>{assert.equal(detail,snapshot.detail);shown++;},notice(){},execute:async()=>assert.fail('Inspection dispatched recovery')})[0].run('',cid);
 assert.equal(result,'cancelled');assert.equal(picks,2);assert.equal(shown,1);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});
for(const timing of ['selection','return'])for(const drift of ['unreadable','epoch'])test(`project work refresh keeps its destination after ${drift} drift on ${timing}`,async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,id='exact-project-work';
 const failure=failurePresentation(new ProjectChangeHeld('Original project hold',{id:'Q',sourceRoot:f.root},'PROJECT_WORK_PENDING','Original evidence',id));
 const tText=(key,values)=>uiText('en',key,values);
 const action=tText('error.work',{id}),refresh=tText('error.refreshProjectRecovery');
 let changed=false,menus=0,calls=0;
 f.c.inspectWork=work=>{
    assert.equal(work,id);
    if(changed&&drift==='unreadable')throw Error('Original record unavailable');
    return {epoch:changed?2:1};
 };
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Original draft'});
 const [command]=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,notice(){},
    choose:async(title,rows)=>{
        assert.ok(title.includes(tText('error.requestedProject',{project:'"Q"'})));
        assert.ok(title.includes('Original project hold'));
        assert.ok(rows.includes(tText('error.retryProjectSwitch',{project:'Q'})));
        if(++menus===1){
            assert.ok(rows.includes(action));
            if(timing==='selection')changed=true;
            return action;
        }
        assert.ok(title.includes(tText('error.recoveryUpdated')));
        assert.equal(rows.includes(action),drift==='epoch'||!changed);
        if(drift==='unreadable'&&changed){
            assert.ok(title.includes(tText('error.projectWorkUnavailable')));
            assert.ok(rows.includes(refresh));
            changed=false;
            return refresh;
        }
        return undefined;
    },
    showReview:async()=>assert.fail('Unexpected detail view'),
    openProject:async()=>assert.fail('Work inspection opened a project'),
    execute:async route=>{assert.equal(route,'/work '+id);calls++;changed=true;return 'cancelled';},
 });
 assert.equal(await command.run('',cid),'cancelled');
 assert.equal(calls,timing==='return'?1:0);
 assert.equal(menus,drift==='unreadable'?3:2);
 assert.equal(f.c.inspectConversation(cid).draft.text,'Original draft');
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
 f.pass();
});

for(const transition of ['current','new diagnostic','new work epoch','other conversation','started'])test('return from exact error work · '+transition,async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,id='exact-recovery-work';
 let epoch=4;
 f.c.inspectWork=work=>{assert.equal(work,id);return {epoch};};
 let failure=failurePresentation({message:'Original error',workId:id}),selected=true,picks=0,calls=0;const notices=[];
 const action=uiText('en','error.work',{id}),context={submission:{conversationId:cid,text:'/error',revision:0}};
 const [command]=errorCommands({controller:f.c,isCurrent:()=>selected,assertAvailable(){},failure:()=>failure,notice:text=>notices.push(text),
  choose:async(_title,rows)=>{assert.ok(rows.includes(action));return ++picks===1?action:undefined;},
  showReview:async()=>assert.fail('Exact work did not request details'),
  execute:async(route,target,source)=>{
   assert.equal(route,'/work '+id);assert.equal(target,cid);assert.equal(source,context);calls++;
   if(transition==='new diagnostic')failure=failurePresentation(Error('New current diagnostic'));
   if(transition==='new work epoch')epoch++;
   if(transition==='other conversation')selected=false;
   return transition==='started'?'started':'cancelled';
  },
 });
 assert.equal(await command.run('',cid,context),transition==='started'?'started':'cancelled');
 assert.equal(picks,transition==='current'?2:1);assert.equal(calls,1);
 assert.deepEqual(notices,transition==='new diagnostic'?[uiText('en','error.sourceChanged')]:transition==='new work epoch'?[uiText('en','error.workChanged')]:[]);
 f.pass();
});

for(const route of ['original','blocker'])for(const change of ['none','receipt','navigation','started'])
test(`retained ${route} work return preserves the original request only when current · ${change}`,async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;
 const original={inputId:'exact',workId:'original-work',state:'RECONCILIATION_REQUIRED',text:'Original request',eligible:false,
    explanation:'Held original',fingerprint:'receipt',blockingWorkIds:route==='blocker'?['blocking-work']:[]};
 let pending=original,selected=true,shows=0,choices=0,opened=0;
 f.c.inspectConversationInputs=()=>[pending];
 const context={submission:{conversationId:cid,text:'/inputs',revision:0}};
 const run=()=>reviewConversationInputs({controller:f.c,isCurrent:()=>selected,
    choose:async(title,rows)=>{assert.equal(title,uiText('en','input.recoveryHeldMenu'));return ++choices===1?rows[1]:rows[0];},
    show:async(_title,text,action)=>{assert.ok(text.includes(original.text));if(++shows===1)await action.run();},
    inspectWork:async(target,id,source)=>{
      assert.equal(target,cid);assert.equal(id,route==='blocker'?'blocking-work':'original-work');assert.equal(source,context);opened++;
      if(change==='receipt')pending={...original,fingerprint:'newer-receipt'};
      if(change==='navigation')selected=false;
      return change==='started'?'started':'cancelled';
    },notice:()=>assert.fail('Request recovery unexpectedly issued a notice'),retry:async()=>assert.fail('Inspection retried the request'),
 },cid,{context,originalInput:original});
 if(change==='receipt')await assert.rejects(run(),/Retained request changed/);
 else assert.equal(await run(),change==='started'?'started':'cancelled');
 assert.equal(opened,1);assert.equal(shows,change==='none'?2:1);
 assert.equal(choices,route==='original'?0:change==='none'?2:1);
 f.pass();
});

for (const stale of [false, true]) test('Back from exact retained-input actions ' + (stale ? 'refuses stale evidence' : 'returns to the same review'), async t => {
 const f = await fixture(t), cid = f.c.createConversation().conversationId;
 const text = 'Original retained request';
 const {inputId} = await f.c.queueConversationInput({conversationId: cid, expectedGeneration: 0, text, mode: 'idle'});
 const [original] = f.c.inspectConversationInputs(cid);
 assert.equal(original.eligible, true);
 let reviews = 0;
 const operation = reviewConversationInputs({
  controller: f.c, isCurrent: () => true,
  choose: async (title, rows) => {
   assert.equal(title, uiText('en', 'input.recoveryChoose'));
   if (stale) f.c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?', JSON.stringify({routeError: 'New delivery evidence'}), inputId);
   return rows[0];
  },
  show: async (_title, content, primary) => {
   assert.ok(content.includes(text));
   if (++reviews === 1) await primary.run();
  },
  retry: async () => assert.fail('Back retried the input'),
  inspectWork: async () => assert.fail('Back opened work'),
  notice: () => assert.fail('Back issued a notice'),
 }, cid, {originalInput: original});
 if (stale) await assert.rejects(operation, /Retained request changed/);
 else assert.equal(await operation, 'cancelled');
 assert.equal(reviews, stale ? 1 : 2);
 assert.equal(f.c.store.one('SELECT state FROM conversation_inputs WHERE id=?', inputId).state, 'QUEUED');
 assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n, 0);
 f.pass();
});

for (const scenario of ['fresh retry', 'changed receipt', 'unavailable read']) test(`first model selection retains its outcome and refreshes original review · ${scenario}`, async t => {
 const f = await fixture(t), cid = f.c.createConversation().conversationId, draft = 'Keep another draft';
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original queued request',mode:'idle'});
 const inspect = f.c.inspectConversationInputs.bind(f.c);
 const [original] = inspect(cid);
 let reviews=0,retries=0;
 const result=await reviewConversationInputs({
  controller:f.c,isCurrent:()=>true,notice(){},
  show:async(_title,text,action)=>{
   assert.match(text,/Original queued request/);
   reviews++;
   await action.run();
  },
  choose:async(_title,rows)=> {
   const expected=uiText('en',reviews===1?'input.recoveryChooseModel':'input.recoveryRetry');
   assert.ok(rows.includes(expected));
   return expected;
  },
  configureModel:async(target,guard)=>{
   await f.c.setConversationModelChoice({conversationId:target,expectedGeneration:0,expectedRevision:0,
    choice:{kind:'managed',provider:'fixture',modelId:'example',thinkingLevel:'off'}},guard);
   if(scenario==='changed receipt')
    f.c.store.run("UPDATE conversation_inputs SET data=json_set(data,'$.routeError','Changed diagnostic') WHERE id=?",original.inputId);
   if(scenario==='unavailable read')
    f.c.inspectConversationInputs=()=>{throw Error('Controlled unavailable post-save input read');};
   return true;
  },
  retry:async(target,input)=>{
   retries++;
   assert.equal(target,cid);
   assert.equal(input.inputId,original.inputId);
   assert.notEqual(input.fingerprint,original.fingerprint);
   assert.equal(input.fingerprint,inspect(cid)[0].fingerprint);
   return true;
  },
  inspectWork:async()=>assert.fail('Model setup opened work'),
 },cid,{originalInput:original});
 assert.equal(result,scenario==='fresh retry'?'started':'completed');
 assert.equal(reviews,scenario==='fresh retry'?2:1);
 assert.equal(retries,scenario==='fresh retry'?1:0);
 assert.equal(f.c.getConversationModelChoice(cid).revision,1);
 assert.equal(f.c.inspectConversation(cid).draft.text,draft);
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
 f.pass();
});

for (const scenario of ['cancel', 'apply then cancel', 'stale proof', 'stale receipt after cancel', 'stale receipt after apply', 'unavailable receipt after apply', 'unavailable language after apply']) test(`Korean retained image repair preserves exact proof and outcome · ${scenario}`, async t => {
 const f = await fixture(t), cid = f.c.createConversation().conversationId;
 const locale = 'ko', repair = uiText(locale, 'error.runtimeImageSettings');
 const original = {inputId:'I',workId:'W',runId:'R',text:'Original request',state:'INITIAL_RESERVED',eligible:true,
  fingerprint:'exact-proof',failure:'Original image cause',explanation:'Original receipt',blockingWorkIds:[]};
 let startup = {kind:'runtime-helper',workId:original.workId,runId:original.runId,failure:original.failure};
 f.c.options.runtimeProfile = {dockerContext:'existing'};
 let pending = original, languageAvailable = true;
 f.c.inspectConversationInputs = () => [pending];
 f.c.inspectConversationStartupFailure = () => startup;
 let reviews=0, opened=0;
 const notices=[];
 const run = reviewConversationInputs({
  controller:f.c, isCurrent:()=>true, locale:()=>{if(!languageAvailable)throw Error('Unavailable conversation language');return locale;}, notice:(...args)=>notices.push(args),
  show:async(_title,text,action)=>{
   assert.ok(text.includes(original.text));
   assert.ok(text.includes(uiText(locale,'input.recoveryRuntimeRepairNext',{action:repair})));
   if (++reviews <= (scenario==='apply then cancel' ? 2 : 1)) await action.run();
  },
  choose:async(_title,rows)=>{
   assert.ok(rows.includes(repair));
   assert.ok(rows.includes(uiText(locale,'input.recoveryRetry')));
   if (scenario==='stale proof') startup=null;
   return repair;
  },
  configureRuntime:async(target,focus)=>{
   assert.equal(target,cid);assert.equal(focus,'image');opened++;
   if (scenario.startsWith('stale receipt')) {
    pending = {...original,fingerprint:'newer-proof'};
    return scenario.endsWith('apply');
   }
   if (scenario==='unavailable receipt after apply') {
    f.c.inspectConversationInputs=()=>{throw Error('Controlled request read unavailable');};
    return true;
   }
   if (scenario==='unavailable language after apply') { languageAvailable=false; return true; }
   return scenario==='apply then cancel' && opened===1;
  },
  retry:async()=>assert.fail('Opening or closing settings retried the original request'),
  inspectWork:async()=>assert.fail('Image repair diverted the original request'),
 },cid,{originalInput:original,context:{acknowledgeSubmission:()=>assert.fail('Settings consumed a draft')}});
 if (scenario==='stale proof'||scenario==='stale receipt after cancel')
    await assert.rejects(run,error=>error.message===uiText(locale,'input.recoveryChanged'));
 else assert.equal(await run,scenario.startsWith('apply')||scenario.endsWith('after apply')?'completed':'cancelled');
 assert.equal(opened,scenario==='stale proof'?0:scenario==='apply then cancel'?2:1);
 assert.equal(reviews,scenario.includes('receipt after')||!languageAvailable?1:opened+1);
 assert.deepEqual(notices,languageAvailable&&scenario.endsWith('after apply')?[[uiText(locale,'input.recoverySettingsReturn'),true]]:[]);
 f.pass();
});

test('error command without exception text opens original goal controls with unchanged target and submission',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,goal=f.c.createGoal({conversationId:cid,objective:'Retain goal recovery',criteria:['No implicit start'],turnLimit:2}),context={submission:{conversationId:cid,text:'/error',revision:0}};
 const result=await errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>null,choose:async(_title,rows)=>rows.find(row=>row==='Open goal recovery · /goal'),showReview:async()=>assert.fail('No error detail'),notice(){},execute:async(command,target,ctx)=>{assert.equal(command,'/goal');assert.equal(target,cid);assert.equal(ctx,context);return 'started';}})[0].run('',cid,context);
 assert.equal(result,'started');assert.equal(f.c.inspectGoal(goal.goalId).startedAttempts,0);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});

test('goal recovery refuses a replacement goal even when its revision matches', async t => {
 const f = await fixture(t), cid = f.c.createConversation().conversationId;
 const original = f.c.createGoal({conversationId:cid,objective:'Inspect this goal only',criteria:['No implicit start'],turnLimit:2});
 let current = original;
 f.c.conversationGoal = () => current;
 const [command] = errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>null,
  choose:async(_title,rows)=>{
   current = {...original,goalId:'another-goal'};
   return rows.find(row=>row==='Open goal recovery · /goal');
  },
  showReview:async()=>assert.fail('Unexpected reader'),notice(){},
  execute:async()=>assert.fail('Stale choice opened a different goal')});
 await assert.rejects(command.run('',cid),/Original goal changed/);
 f.pass();
});

test('an active error becoming previous invalidates its open recovery view even with the same details', async t=>{
 const f=await fixture(t), cid=f.c.createConversation().conversationId;
 const failure=failurePresentation(Error('Retained details'));
 let status={active:true,revision:1}, picks=0;const notices=[];
 const command=errorCommands({
  controller:f.c, isCurrent:()=>true, assertAvailable(){}, failure:()=>failure, failureStatus:()=>status,
  choose:async title=>{
   assert.equal(title,'Error recovery · choose a next step\n'+failure.summary);
   picks++;
   return 'Error details · inspect';
  },
  showReview:async(_title,detail,primary)=>{
   assert.equal(detail,failure.detail);
   status={active:false,revision:2};
   await primary.run();
  },
  notice:text=>notices.push(text),execute:async()=>assert.fail('Changed error dispatched recovery'),
 })[0];
 assert.equal(await command.run('',cid),'cancelled');
 assert.deepEqual(notices,[uiText('en','error.sourceChanged')]);
 assert.equal(picks,1);
 f.pass();
});

for (const scenario of ['cancelled','cancelled with drift','unchanged runtime','changed receipt','ambiguous receipt','unavailable receipt','new diagnostic after save','dismissed review','started retry']) test('runtime error recovery preserves the original settings outcome · '+scenario,async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;
 const original={inputId:'I',workId:'W',runId:'R',eligible:true,retryEligible:true,fingerprint:'original-proof',failure:'Original cause',blockingWorkIds:[]};
 let inputs=[original], failure=conversationStartupFailure({kind:'runtime-helper',failure:'Original cause',workId:'W',runId:'R'},'en');
 f.c.inspectConversationInputs=()=>inputs;
 f.c.options.runtimeProfile={dockerContext:'old'};
 let choices, picks=0, reviewed=0, opened=0;const notices=[];
 const context={acknowledgeSubmission:()=>assert.fail('Settings acknowledged the draft')};
 const [command]=errorCommands({
  controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,
  choose:async(_title,rows)=>{
   if (picks++ === 0) {
    choices=rows;
    return 'Choose or prepare an execution image';
   }
   assert.deepEqual(rows,choices);
   return 'Back to conversation';
  },
  showReview:async()=>assert.fail('Unexpected inspection'),
  notice:text=>notices.push(text),
  execute:async(route,target,source)=>{
   assert.equal(route,'/setup runtime');assert.equal(target,cid);
   assert.notEqual(source,context);
   assert.deepEqual(source,{...context,runtimeSetupFocus:'image'});opened++;
   if (scenario==='cancelled with drift') failure={...failure};
   if (scenario.startsWith('cancelled')) return 'cancelled';
   if (scenario!=='unchanged runtime') f.c.options.runtimeProfile={dockerContext:'corrected'};
   if (scenario==='changed receipt') inputs=[{...original,fingerprint:'changed-proof'}];
   if (scenario==='ambiguous receipt') inputs=[original,{...original,inputId:'another'}];
   if (scenario==='unavailable receipt')f.c.inspectConversationInputs=()=>{throw Error('Unavailable original input after settings save');};
   if (scenario==='new diagnostic after save')failure=failurePresentation(Error('Newer diagnostic owns this view'));
   return 'completed';
  },
  reviewInput:async(target,receipt,source)=>{
   assert.equal(target,cid);assert.equal(receipt,original);assert.equal(source,context);reviewed++;
   return scenario==='started retry'?'started':'cancelled';
  },
 });
 const result=command.run('',cid,context);
 assert.equal(await result,scenario==='started retry'?'started':scenario.startsWith('cancelled')?'cancelled':'completed');
 assert.deepEqual(notices,scenario==='cancelled with drift'?[uiText('en','error.sourceChanged')]:[]);
 assert.equal(opened,1);
 assert.equal(picks,scenario==='cancelled'?2:1);
 assert.equal(reviewed, ['dismissed review','started retry'].includes(scenario)?1:0);
 f.pass();
});

test('an exact retry invalidates a displayed typed setup action without changing the diagnostic revision', async t => {
 const f = await fixture(t), cid = f.c.createConversation().conversationId;
 const failure = conversationStartupFailure({kind:'runtime-helper',failure:'Original cause',workId:'W',runId:'R'},'en');
 let retrying = false;
 const notices = [];
 const [command] = errorCommands({
  controller:f.c, isCurrent:()=>true, assertAvailable(){}, failure:()=>failure,
  failureStatus:()=>({active:true,revision:4,retrying}),
  choose:async(_title, rows)=>{
   assert.ok(rows.includes('Choose or prepare an execution image'));
   retrying = true;
   return 'Choose or prepare an execution image';
  },
  showReview:async()=>assert.fail('Unexpected reader'),
  notice:text=>notices.push(text),
  execute:async()=>assert.fail('A superseded setup action must not open'),
 });
 assert.equal(await command.run('',cid),'cancelled');
 assert.deepEqual(notices,[uiText('en','error.sourceChanged')]);
 f.pass();
});

const errorCopy = {
 en: {title:'Error recovery · choose a next step', details:'Error details · inspect', ready:'Open setup and readiness', inputs:'Review retained requests', work:id=>'Open original work recovery · /work '+id, all:'Find original work and allowances · /work', goal:'Open goal recovery · /goal', back:'Back to conversation', empty:'No retained error details for this conversation · /ready for setup and next actions', stale:/Error source changed/, workStale:/Original error work changed/, goalStale:/Original goal changed/},
 ko: {title:'오류 복구 · 다음 동작 선택', details:'오류 상세 확인', ready:'설정과 준비 상태 확인', inputs:'보관된 요청 확인', work:id=>'원래 작업 복구 · /work '+id, all:'원래 작업과 사용 한도 찾기 · /work', goal:'목표 복구 · /goal', back:'대화로 돌아가기', empty:'이 대화에 보관된 오류 상세가 없습니다 · /ready에서 설정과 다음 동작을 확인하세요', stale:/오류의 원래 상태가 변경되었습니다/, workStale:/오류와 연결된 원래 작업이 변경되었습니다/, goalStale:/원래 목표가 변경되었습니다/},
};
function errorLanguage(c,cid,replyLanguage){const old=c.getConversationLanguage(cid);c.setConversationLanguage({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,expectedRevision:old.revision,replyLanguage});}

for (const { locale, mode } of [
    { locale: 'en', mode: 'exact' }, { locale: 'ko', mode: 'exact' },
    { locale: 'en', mode: 'changed' }, { locale: 'en', mode: 'ambiguous' },
    { locale: 'en', mode: 'became ambiguous' }, { locale: 'en', mode: 'became unavailable' }, { locale: 'en', mode: 'held inspection' },
]) test(`error review selects only the original request · ${locale} · ${mode}`, async t => {
    const f = await fixture(t);
    const cid = f.c.createConversation().conversationId;
    const original = {inputId:'I', workId:'W', runId:'R', eligible:mode!=='held inspection', fingerprint:'original', failure:'first', blockingWorkIds:[]};
    const other = {...original, inputId:'another', runId:'older'};
    const duplicate = {...original, inputId:'duplicate', eligible:false};
    let pending = [other, original, ...(mode === 'ambiguous' ? [duplicate] : [])];
    const snapshot = failurePresentation({message:'first', workId:'W', runId:'R'});
    const label = locale === 'ko' ? '원래 요청 확인' : 'Review original request';
    const context = {acknowledgeSubmission:()=>assert.fail('Review consumed a draft')};
    const notices = [];
    let reviewed = 0, generic = 0;
    errorLanguage(f.c,cid,locale);
    f.c.inspectConversationInputs = () => pending;
    const [command] = errorCommands({
        controller:f.c, isCurrent:()=>true, assertAvailable(){}, failure:()=>snapshot,
        choose:async (_title, rows) => {
            assert.equal(rows.includes(label), mode !== 'ambiguous');
            assert.ok(rows.includes(errorCopy[locale].inputs));
            if (mode === 'ambiguous') return errorCopy[locale].inputs;
            if (mode === 'changed') pending = [other, {...original, fingerprint:'changed'}];
            if (mode === 'became ambiguous') pending = [...pending, duplicate];
            if (mode === 'became unavailable') f.c.inspectConversationInputs = () => { throw Error('Original input cannot be read'); };
            return label;
        },
        reviewInput:async (target, input, source) => {
            assert.equal(target,cid);assert.equal(input,original);assert.equal(source,context);
            reviewed++;
            return mode === 'held inspection' ? 'completed' : 'started';
        },
        execute:async (route, target, source) => {
            assert.equal(route,'/inputs');assert.equal(target,cid);assert.equal(source,context);
            generic++;
            return 'completed';
        },
        notice:text=>notices.push(text),
    });
    const changed = ['changed', 'became ambiguous', 'became unavailable'].includes(mode);
    assert.equal(await command.run('',cid,context), changed ? 'cancelled' : mode === 'exact' ? 'started' : 'completed');
    assert.deepEqual(notices, changed ? [uiText(locale,'error.originalInputChanged')] : []);
    assert.equal(reviewed, Number(mode === 'exact' || mode === 'held inspection'));
    assert.equal(generic, Number(mode === 'ambiguous'));
    f.pass();
});

test('later waits cannot keep a stale work shortcut or crowd out the other original assignment',async t=>{
 const f=await fixture(t),parent=f.c.createConversation().conversationId;
 const sourceRoot=path.join(f.root,'receiver-project');
 await fs.mkdir(sourceRoot);
 await f.c.registerProject({id:'P',sourceRoot});
 const assignment=async id=>{
    const child=f.c.createConversation().conversationId;
    const {workId}=await f.c.beginChange({projectId:'P',request:'Owned work '+id});
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',id,parent,child,workId,'RUNNING','{}');
    return {child,workId};
 };
 const first=await assignment('original'), sibling=await assignment('sibling');
 const original=captureProjectDependencies(f.c.inspectConversationProjectDependencies({conversationId:parent,expectedGeneration:0}).items);
 const failure=failurePresentation(new ProjectChangeHeld('Original hold',{id:'P',sourceRoot},'PROJECT_DEPENDENCY_PENDING','Recorded reason',first.workId,
    {relatedWorkIds:[sibling.workId],dependency:{sourceConversationId:parent,sourceGeneration:0,sourceProjectId:null,relationships:original}}));
 const late=await assignment('later');
 const work=id=>uiText('en','error.work',{id});
 const routed=[];
 let menus=0;
 const [command]=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,notice(){},
    choose:async(title,rows)=>{
        assert.ok(rows.includes(work(first.workId)));
        assert.ok(!rows.includes(work(late.workId)));
        if(++menus===1){
            assert.ok(rows.includes(work(sibling.workId)));
            for(let i=0;i<9;i++)
                f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','later-wait-'+i,parent,sibling.child,'sibling','PENDING','{}');
            return work(sibling.workId);
        }
        assert.match(title,/Recovery options updated/);
        assert.match(title,/Original hold/);
        assert.ok(!rows.includes(work(sibling.workId)));
        return menus===2?work(first.workId):undefined;
    },
    showReview:async()=>assert.fail('A stale work choice opened an inspection'),
    execute:async route=>{routed.push(route);return 'cancelled';},
    openProject:async()=>assert.fail('Read-only review switched project'),
 });
 assert.equal(await command.run('',parent),'cancelled');
 assert.deepEqual(routed,['/work '+first.workId]);
 assert.equal(f.c.inspectConversation(parent).projectId,null);
 f.pass();
});

for(const empty of [false,true])test('first readable dependency projection pins the original set · empty='+empty,async t=>{
    const f=await fixture(t),parent=f.c.createConversation().conversationId;
    const assignment=(id,state)=>{
        const child=f.c.createConversation().conversationId;
        f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',id,parent,child,null,state,'{}');
        return child;
    };
    const original=assignment('original',empty?'CANCELLED':'RUNNING');
    const later=assignment('later','QUEUED');
    const aliased=assignment('aliased','RUNNING');
    f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','new-wait',parent,aliased,'aliased','PENDING','{}');
    const failure=failurePresentation(new ProjectChangeHeld('Project held',{id:'P',sourceRoot:f.root},'PROJECT_DEPENDENCY_PENDING','Original refusal',undefined,
        {dependency:{sourceConversationId:parent,sourceGeneration:0,sourceProjectId:null,
            originalReasons:['assignment:original:QUEUED','assignment:original:RUNNING','assignment:aliased:RUNNING']}}));
    const inspect=f.c.inspectConversationProjectDependencies.bind(f.c);
    let readable=false,menus=0;
    f.c.inspectConversationProjectDependencies=input=>{
        if(!readable)throw Error('Unavailable original projection');
        return inspect(input);
    };
    const [command]=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,notice(){},
        choose:async(title,rows)=>{
            const menu=++menus;
            if(menu===1){
                assert.match(title,/Could not check current dependencies/);
                assert.ok(rows.includes('Refresh recovery choices'));
                readable=true;
                return 'Refresh recovery choices';
            }
            const links=rows.filter(row=>row.startsWith('Open related conversation'));
            assert.deepEqual(links,empty?[]:['Open related conversation · '+original]);
            assert.ok(!rows.some(row=>row.includes(later)||row.includes(aliased)));
            assert.equal(title.includes('The recorded dependency changed'),empty);
            return menu===2?'Error details · inspect':undefined;
        },
        showReview:async()=>{
            if(empty)f.c.store.run("UPDATE conversation_assignments SET state='RUNNING' WHERE id='original'");
        },
        execute:async()=>assert.fail('Read-only recovery dispatched a command'),
        openProject:async()=>assert.fail('Unexpected project action'),openConversation:async()=>assert.fail('Unexpected navigation')});
    assert.equal(await command.run('',parent),'cancelled');
    assert.equal(menus,3);
    assert.equal(f.c.inspectConversation(parent).projectId,null);
    f.pass();
});

for(const locale of ['en','ko']) {
 for(const confirm of [false,true])for(const drift of [null,'occurrence','language','selection'])test('error details '+locale+' returns through the original recovery choices; Enter='+confirm+' drift='+drift,async t=>{
  const f=await fixture(t),cid=f.c.createConversation().conversationId,copy=errorCopy[locale];
  errorLanguage(f.c,cid,locale);
  const context={submission:{conversationId:cid,text:'/error',revision:0}};
  let failure=failurePresentation(Error('Original error')),firstRows,picks=0,executed=0,selected=true;const notices=[];
  const command=errorCommands({
   controller:f.c,isCurrent:()=>selected,assertAvailable(){},failure:()=>failure,
   choose:async(title,rows)=>{
    assert.equal(title,copy.title+'\n'+failure.summary);
    if(++picks===1){firstRows=rows;return copy.details;}
    assert.deepEqual(rows,firstRows);
    return copy.ready;
   },
   showReview:async(title,detail,primary)=>{
    assert.equal(title,uiText(locale,'error.detailsTitle'));
    assert.equal(detail,failure.detail);
    assert.equal(primary.label,uiText(locale,'error.returnToChoices'));
    if(drift==='occurrence')failure=failurePresentation(Error('Original error'));
    if(drift==='language')errorLanguage(f.c,cid,locale==='en'?'ko':'en');
    if(drift==='selection')selected=false;
    if(confirm)await primary.run();
   },
   execute:async(value,target,source)=>{
    assert.equal(value,'/ready');assert.equal(target,cid);assert.equal(source,context);executed++;return 'completed';
   },
   notice:text=>notices.push(text),
  })[0];
  assert.equal(await command.run('',cid,context),drift?'cancelled':'completed');
  assert.deepEqual(notices,drift&&drift!=='selection'?[uiText(locale,'error.sourceChanged')]:[]);
  assert.equal(picks,drift?1:2);assert.equal(executed,drift?0:1);
  f.pass();
 });
 test('error recovery '+locale+' routes original retained work, input and goal without implicit execution',async t=>{
  const f=await fixture(t),cid=f.c.createConversation().conversationId,copy=errorCopy[locale];errorLanguage(f.c,cid,locale);
  const project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});
  const work=await f.c.beginChange({projectId:'P',request:'Original retained change'}),goal=f.c.createGoal({conversationId:cid,objective:'Original retained goal',criteria:['No implicit dispatch'],turnLimit:2});
  await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Retained request',mode:'idle'});
  const snapshot=failurePresentation({message:'Original failure /work {id} 한국어',workId:work.workId}),context={submission:{conversationId:cid,text:'/error',revision:0}},shown=[],routes=[];
  const before=Object.fromEntries(['works','runs','budgets','conversation_inputs','goals'].map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
  for(const [label,route] of [[copy.ready,'/ready'],[copy.inputs,'/inputs'],[copy.work(work.workId),'/work '+work.workId],[copy.all,'/work'],[copy.goal,'/goal'],[copy.details,null],[copy.back,null]]) for(const result of route?['started','completed','cancelled']:['cancelled']) {
   let picks=0;
   const outcome=await errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>snapshot,choose:async(title,rows)=>{assert.equal(title,copy.title+'\n'+snapshot.summary);assert.deepEqual(rows,[copy.details,copy.ready,copy.inputs,copy.work(work.workId),copy.all,copy.goal,copy.back]);return ++picks===1?label:copy.back;},showReview:async(title,detail,primary)=>{assert.equal(detail,snapshot.detail);assert.equal(title,uiText(locale,'error.detailsTitle'));assert.equal(primary.label,uiText(locale,'error.returnToChoices'));shown.push(detail);},notice:()=>assert.fail('Unexpected empty notice'),execute:async(command,target,ctx)=>{assert.equal(command,route);assert.equal(target,cid);assert.equal(ctx,context);routes.push(command);return result;}})[0].run('',cid,context);
   assert.equal(outcome,result);assert.equal(picks,result==='cancelled'&&label!==copy.back?2:1);
  }
  assert.equal(shown.length,1);assert.equal(routes.length,15);assert.equal(f.c.inspectGoal(goal.goalId).startedAttempts,0);
  assert.deepEqual(Object.fromEntries(Object.keys(before).map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')])),before);f.pass();
 });
 test('empty error recovery '+locale+' checks selected source before notice',async t=>{
  const f=await fixture(t),cid=f.c.createConversation().conversationId,copy=errorCopy[locale];errorLanguage(f.c,cid,locale);let selected=true;const notices=[];
  const h={controller:f.c,isCurrent:()=>selected,assertAvailable(){},failure:()=>null,choose:async()=>assert.fail('Empty error opened a menu'),showReview:async()=>assert.fail('Empty error opened details'),notice:text=>notices.push(text),execute:async()=>assert.fail('Empty error dispatched')};
  await errorCommands(h)[0].run('',cid);assert.deepEqual(notices,[copy.empty]);selected=false;
  assert.equal(await errorCommands(h)[0].run('',cid),'cancelled');assert.equal(notices.length,1);f.pass();
 });
 for(const drift of ['occurrence','language','selection','work','goal'])test('error recovery '+locale+' refuses '+drift+' drift without dispatch',async t=>{
  const f=await fixture(t),cid=f.c.createConversation().conversationId,copy=errorCopy[locale];errorLanguage(f.c,cid,locale);
  const project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});
  const work=await f.c.beginChange({projectId:'P',request:'Retain work epoch'}),goal=f.c.createGoal({conversationId:cid,objective:'Retain goal revision',criteria:['No implicit start'],turnLimit:2});
  const originalRuns=f.c.store.all('SELECT * FROM runs ORDER BY rowid');
  let snapshot=failurePresentation({message:'Identical retained failure',workId:work.workId}),selected=true;const notices=[];
  const h={controller:f.c,isCurrent:()=>selected,assertAvailable(){},failure:()=>snapshot,choose:async()=>{
   if(drift==='occurrence')snapshot=failurePresentation({message:'Identical retained failure',workId:work.workId});
   if(drift==='language')errorLanguage(f.c,cid,locale==='en'?'ko':'en');
   if(drift==='selection')selected=false;
   if(drift==='work')await f.c.cancelWork({workId:work.workId,expectedEpoch:f.c.inspectWork(work.workId).epoch});
   if(drift==='goal')f.c.reviseGoal({goalId:goal.goalId,expectedRevision:goal.revision,objective:'Revised goal',criteria:['Updated owner criteria'],reason:'Independent owner change'});
   return drift==='work'?copy.work(work.workId):drift==='goal'?copy.goal:copy.ready;
  },showReview:async()=>assert.fail('Stale details opened'),notice:text=>notices.push(text),execute:async()=>assert.fail('Stale recovery dispatched')};
  const result=errorCommands(h)[0].run('',cid);
  if(drift==='work'||drift==='goal')await assert.rejects(result,drift==='work'?copy.workStale:copy.goalStale);
  else assert.equal(await result,'cancelled');
  assert.deepEqual(notices,drift==='occurrence'||drift==='language'?[uiText(locale,'error.sourceChanged')]:[]);
  assert.deepEqual(f.c.store.all('SELECT * FROM runs ORDER BY rowid'),originalRuns);f.pass();
 });
}

for(const unavailable of ['input','delegated'])test('error recovery preserves original details when '+unavailable+' discovery is unavailable',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;
 errorLanguage(f.c,cid,'en');
 const {inputId}=await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original queued text',mode:'idle'});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Separate unsent draft'});
 const before=f.c.store.one('SELECT data FROM conversation_inputs WHERE id=?',inputId).data;
 const proof={...failurePresentation({message:'Primary controlled failure'}),inputId};
 const inspectDependencies=f.c.inspectConversationProjectDependencies.bind(f.c);
 let unreadable=true, picks=0,shown=0,reviewed=0;
 if(unavailable==='input')f.c.store.run("UPDATE conversation_inputs SET data='{' WHERE id=?",inputId);
 else f.c.inspectConversationProjectDependencies=(...args)=>{
  if(unreadable)throw Error('Delegated-task evidence cannot be read');
  return inspectDependencies(...args);
 };
 const h=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>proof,
  choose:async(title,rows)=>{
   assert.ok(title.includes('Primary controlled failure'));
   assert.ok(rows.includes(errorCopy.en.ready));
   picks++;
   if(picks<=2){
    assert.ok(rows.includes(uiText('en','error.refreshProjectRecovery')));
    assert.match(title,unavailable==='input'?/Retained requests are unavailable/:/Delegated tasks are unavailable/);
    assert.equal(rows.includes(errorCopy.en.inputs),unavailable==='delegated');
    if(picks===1)return errorCopy.en.details;
    unreadable=false;
    if(unavailable==='input')f.c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?',before,inputId);
    return uiText('en','error.refreshProjectRecovery');
   }
   assert.ok(rows.includes(errorCopy.en.inputs));
   assert.ok(!rows.includes(uiText('en','error.refreshProjectRecovery')));
   return uiText('en','error.originalInput');
  },
  showReview:async(_title,detail)=>{assert.equal(detail,proof.detail);shown++;},
  reviewInput:async(id,receipt)=>{assert.equal(id,cid);assert.equal(receipt.inputId,inputId);reviewed++;return 'completed';},
  execute:async()=>assert.fail('Inspection or refresh dispatched a command'),
  notice:()=>assert.fail('Recovery unexpectedly closed'),
 })[0];
 assert.equal(await h.run('',cid),'completed');
 assert.deepEqual([picks,shown,reviewed],[3,1,1]);
 assert.equal(f.c.inspectConversation(cid).draft.text,'Separate unsent draft');
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});

test('refresh of unreadable retained requests still belongs to the original conversation',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;
 const {inputId}=await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original queued text',mode:'idle'});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Separate unsent draft'});
 f.c.store.run("UPDATE conversation_inputs SET data='{' WHERE id=?",inputId);
 const read=f.c.inspectConversationInputs.bind(f.c);
 let current=true,reads=0,choices=0;
 f.c.inspectConversationInputs=id=>{reads++;return read(id);};
 const refresh=uiText('en','input.recoveryRefresh');
 await assert.rejects(reviewConversationInputs({
  controller:f.c,isCurrent:id=>current&&id===cid,
  choose:async(_title,rows)=>{
   assert.deepEqual(rows,[uiText('en','input.recoveryBack'),refresh]);
   if(++choices===2)current=false;
   return refresh;
  },
  show:async()=>assert.fail('Unreadable input opened an exact review'),
  inspectWork:async()=>assert.fail('Unreadable input opened a work action'),
  retry:async()=>assert.fail('Unreadable input started a retry'),
  notice:()=>assert.fail('Unreadable list was reported as empty'),
 },cid,{blockedDraft:true}),{message:uiText('en','input.recoveryTargetChanged')});
 assert.equal(reads,2);
 assert.equal(f.c.inspectConversation(cid).draft.text,'Separate unsent draft');
 assert.equal(f.c.store.one('SELECT data FROM conversation_inputs WHERE id=?',inputId).data,'{');
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
 f.pass();
});

test('closing exact request recovery refuses a changed original receipt',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;
 errorLanguage(f.c,cid,'en');
 const {inputId}=await f.c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original queued text',mode:'idle'});
 const diagnostic={...failurePresentation({message:'Original exact diagnostic'}),inputId};
 const notices=[];let picks=0,inspections=0;
 const [command]=errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>diagnostic,
  choose:async()=>++picks===1?uiText('en','error.originalInput'):undefined,
  reviewInput:async(_target,receipt)=>{
   assert.equal(receipt.inputId,inputId);inspections++;
   f.c.store.run("UPDATE conversation_inputs SET data=json_set(data,'$.routeError','New delivery evidence') WHERE id=?",inputId);
   return 'cancelled';
  },
  notice:text=>notices.push(text),execute:async()=>assert.fail('Inspection dispatched a command'),
 });
 assert.equal(await command.run('',cid),'cancelled');
 assert.deepEqual([picks,inspections],[1,1]);
 assert.match(notices[0],/Original retained request changed/);
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});
