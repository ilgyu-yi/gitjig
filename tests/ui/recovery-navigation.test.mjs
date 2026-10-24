import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';

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
 assert.equal(await make(async(_title,rows)=>rows[1]).run('',cid),'cancelled');assert.equal(inputs,1);assert.equal(f.c.conversationGoal(cid),null);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
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
import {failurePresentation} from '../../dist/ui/failure-details.js';

test('error command retains one occurrence snapshot and rejects an identical newer failure before routing',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId;let failure=failurePresentation(Error('Same retained error')),calls=0;
 const h={controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>failure,choose:async()=>{failure=failurePresentation(Error('Same retained error'));return 'Open setup and readiness';},showDetails:async()=>assert.fail('Stale details opened'),notice(){},execute:async()=>{calls++;return 'started';}};
 await assert.rejects(errorCommands(h)[0].run('',cid),/Error source changed/);assert.equal(calls,0);f.pass();
});
test('error details close directly to conversation and retain their original snapshot without dispatch',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,snapshot=failurePresentation(Error('Retained details'));let picks=0,shown=0;
 const result=await errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>snapshot,choose:async()=>{picks++;return 'Error details · inspect';},showDetails:async detail=>{assert.equal(detail,snapshot.detail);shown++;},notice(){},execute:async()=>assert.fail('Inspection dispatched recovery')})[0].run('',cid);
 assert.equal(result,'completed');assert.equal(picks,1);assert.equal(shown,1);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});
test('error command without exception text opens original goal controls with unchanged target and submission',async t=>{
 const f=await fixture(t),cid=f.c.createConversation().conversationId,goal=f.c.createGoal({conversationId:cid,objective:'Retain goal recovery',criteria:['No implicit start'],turnLimit:2}),context={submission:{conversationId:cid,text:'/error',revision:0}};
 const result=await errorCommands({controller:f.c,isCurrent:()=>true,assertAvailable(){},failure:()=>null,choose:async(_title,rows)=>rows.find(row=>row==='Open goal recovery · /goal'),showDetails:async()=>assert.fail('No error detail'),notice(){},execute:async(command,target,ctx)=>{assert.equal(command,'/goal');assert.equal(target,cid);assert.equal(ctx,context);return 'started';}})[0].run('',cid,context);
 assert.equal(result,'started');assert.equal(f.c.inspectGoal(goal.goalId).startedAttempts,0);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});
