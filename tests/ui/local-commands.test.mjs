import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationLocalConventions,recommendedLocalConventions} from '../../dist/app/local-conventions.js';
import {settleHostCommands} from '../../dist/ui/host-commands.js';
import {localCommands} from '../../dist/ui/local-commands.js';
import {editLocalConventions} from '../../dist/ui/local-conventions-editor.js';
import {localGitSummary,localPreparationSummary,localConventionsSummary} from '../../dist/ui/local-presentation.js';
const execute=promisify(execFile),git=(await execute('/usr/bin/which',['git'])).stdout.trim();
async function world(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-local-ui-'))),sourceRoot=path.join(root,'project'),home=path.join(root,'home'),message=path.join(root,'message.txt');await fs.mkdir(sourceRoot);
 const native=async(...args)=>execute(git,args,{cwd:sourceRoot,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},timeout:5000});
 await native('init','-b','feat/local');await fs.writeFile(path.join(sourceRoot,'한글.txt'),'fixture content\n');await native('add','.');await fs.writeFile(message,'feat(local): Preserve intent\n\nPRIVATE_MESSAGE_BODY_NOT_FOR_UI\n',{mode:0o600});
 const c=await openController({installationHome:home});t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});await c.registerProject({id:'p',sourceRoot});const source=c.createConversation({projectId:'p'}).conversationId,app=new ApplicationLocalConventions(c);return {root,sourceRoot,home,message,c,source,app,native};
}
function command(f,choices,inputs=[],extra={}){
 const shown=[],notices=[],ui=localCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next===undefined)return;const found=rows.find(r=>r.startsWith(next));assert.ok(found,'Missing '+next+' in '+JSON.stringify(rows));return found;},input:async(title,value)=>{const next=inputs.shift();return typeof next==='function'?next(title,value):next;},show:async(title,text)=>shown.push({title,text}),notice:text=>notices.push(text),...extra});return {ui,shown,notices,run:()=>ui.commands[0].run('',f.source)};
}
const records=c=>JSON.stringify(['works','runs','sources','budgets','effect_operations','role_launches'].map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
test('staged conventions use plain literal/number/boolean forms; invalid values retain staging and cancel never saves',async()=>{
 const choices=['Allowed branch prefixes','Add literal','Add literal','Use staged list','Maximum subject','Maximum subject','Require message body','true','Save staged'],values=['feat/*','feat/','0','40'],notices=[];
 const result=await editLocalConventions({guard(){},notice:v=>notices.push(v),choose:async(_t,rows)=>{const pick=choices.shift();return rows.find(r=>r.startsWith(pick));},input:async()=>values.shift()},recommendedLocalConventions(),0);assert.deepEqual(result.branchPrefixes,['feat/']);assert.equal(result.subjectMaxLength,40);assert.equal(result.requireBody,true);assert.equal(notices.length,2);
 assert.equal(await editLocalConventions({guard(){},notice(){},choose:async()=>undefined,input:async()=>assert.fail()},recommendedLocalConventions(),0),undefined);
});
test('local inspection and cancelled staged editing allocate no work or applied convention; projectless entry explains recovery',async t=>{
 const f=await world(t),before=records(f.c),h=command(f,['Inspect local conventions','Edit local conventions','Cancel editing','Close']);await h.run();assert.equal(f.app.inspect('p').state,'NOT_CONFIGURED');assert.equal(records(f.c),before);assert.match(h.shown[0].text,/NOT_CONFIGURED/);await h.ui.close();
 const empty=f.c.createConversation().conversationId,unbound=command({...f,source:empty},[]);await assert.rejects(unbound.run(),/\/project/);assert.equal(records(f.c),before);await unbound.ui.close();
});
test('explicit staged save and real native preparation preserve index/config and private message; missing rules cannot pass',async t=>{
 const f=await world(t),before=records(f.c),files=['index','HEAD','config'],bytes=await Promise.all(files.map(name=>fs.readFile(path.join(f.sourceRoot,'.git',name)))),h=command(f,['Prepare staged change','Edit local conventions','Maximum subject','Save staged','Inspect Git changes','Prepare staged change','Close'],['40',git,git,f.message]);await h.run();assert.equal(f.app.inspect('p').revision,1);assert.equal(f.app.inspect('p').rules.subjectMaxLength,40);assert.ok(h.shown.some(v=>v.title.startsWith('Preparation unavailable')));const preparation=h.shown.find(v=>v.title.startsWith('Staged preparation')).text;assert.match(preparation,/^Preparation passed \(PASS\) · configured rules only\./);assert.match(preparation,/Staged added: "한글.txt"/);assert.match(preparation,/Next: Review the actual staged diff and run applicable local checks/);const prepared=JSON.parse(preparation.split('\n\nOriginal observation · details\n')[1]);assert.equal(prepared.status,'PASS');assert.ok(prepared.checks.every(c=>c.status==='PASS'));assert.equal(prepared.policy.revision,1);assert.match(h.shown.find(v=>v.title.startsWith('Local Git observation')).text,/^Local Git changes/);assert.doesNotMatch(JSON.stringify(h.shown),/PRIVATE_MESSAGE_BODY_NOT_FOR_UI/);assert.equal(records(f.c),before);for(let i=0;i<files.length;i++)assert.deepEqual(await fs.readFile(path.join(f.sourceRoot,'.git',files[i])),bytes[i]);await h.ui.close();
});
test('cancelled Git/message input performs no observation or configuration',async t=>{
 const f=await world(t);f.app.set('p',0,recommendedLocalConventions());const before=records(f.c),policy=f.app.inspect('p'),h=command(f,['Inspect Git changes','Prepare staged change','Close'],[undefined,git,undefined]);await h.run();assert.equal(h.shown.length,0);assert.deepEqual(f.app.inspect('p'),policy);assert.equal(records(f.c),before);await h.ui.close();
});
test('source navigation, directory replacement and same-revision policy edits refuse staged save',async t=>{
 const f=await world(t);let current=true;const h=command(f,['Edit local conventions','Maximum subject','Save staged'],[()=>{current=false;return '40';}],{isCurrent:()=>current});await assert.rejects(h.run(),/source changed/);assert.equal(f.app.inspect('p').state,'NOT_CONFIGURED');await h.ui.close();
 f.app.set('p',0,recommendedLocalConventions());const policy=f.app.inspect('p'),conflict=command(f,['Edit local conventions',async(_t,rows)=>{const value=JSON.parse(await fs.readFile(policy.path,'utf8'));value.rules.subjectMaxLength=30;await fs.writeFile(policy.path,JSON.stringify(value),{mode:0o600});return rows.find(r=>r==='Save staged conventions');}]);await assert.rejects(conflict.run(),/changed during preparation/);assert.equal(f.app.inspect('p').rules.subjectMaxLength,30);await conflict.ui.close();
 const replaced=command(f,['Inspect Git changes'],[async()=>{await fs.rename(f.sourceRoot,f.sourceRoot+'-old');await fs.mkdir(f.sourceRoot);return git;}]);await assert.rejects(replaced.run(),/replaced/);assert.equal(replaced.shown.length,0);await replaced.ui.close();
});
test('saved conventions remain attributed when navigation occurs before result display',async t=>{
 const f=await world(t);let current=true;const h=command(f,['Edit local conventions','Save staged'],[],{isCurrent:()=>current,notice:()=>{current=false;}});await assert.rejects(h.run(),/Saved conventions remain at revision 1/);assert.equal(f.app.inspect('p').revision,1);assert.equal(h.shown.length,0);await h.ui.close();
});
test('close aborts and joins an owned native observation rather than showing a false complete result',{timeout:8000},async t=>{
 const f=await world(t),wrapper=path.join(f.root,'held-git'),marker=path.join(f.root,'held-pid');await fs.writeFile(wrapper,'#!/bin/sh\ntrap \"\" TERM\necho $$ > '+"'"+marker.replaceAll("'","'\\''")+"'"+'\nexec /bin/sleep 30\n',{mode:0o700});const h=command(f,['Inspect Git changes'],[wrapper]),task=h.run();void task.catch(()=>{});const until=Date.now()+3000;while(Date.now()<until){if(await fs.access(marker).then(()=>true,()=>false))break;await new Promise(r=>setTimeout(r,10));}const pid=Number(await fs.readFile(marker,'utf8'));await h.ui.close();await assert.rejects(task);assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');assert.equal(h.shown.length,0);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,0);
});

test('failed command close drains its sibling and interaction host before reporting cleanup uncertainty',async()=>{
 const events=[],failure=Error('cleanup unknown');let release,entered;const gate=new Promise(r=>release=r),began=new Promise(r=>entered=r);
 const task=settleHostCommands([async()=>{events.push('failed');throw failure;},async()=>{entered();await gate;events.push('drained');}],async()=>events.push('host settled'));void task.catch(()=>{});await began;assert.deepEqual(events,['failed']);release();await assert.rejects(task,e=>e===failure);assert.deepEqual(events,['failed','drained','host settled']);
 await assert.rejects(settleHostCommands([async()=>{throw failure;}],async()=>{throw Error('host failure');}),e=>e instanceof AggregateError&&e.errors.length===2);
});

test('Git summary distinguishes staged and unstaged changes, conflicts and rename origins without terminal control injection',()=>{
 const view={projectId:'p',branch:'feat/local',head:'a'.repeat(40),upstream:null,sourceRoot:'/project',observedAt:'2026-01-01',commits:[],changes:[
  {kind:'tracked',index:'M',worktree:'M',path:'both.txt'},
  {kind:'renamed-or-copied',index:'R',worktree:'.',path:'new\nname',originalPath:'old\u009b31m'},
  {kind:'unmerged',index:'U',worktree:'U',path:'conflict.txt'},
  {kind:'untracked',index:'?',worktree:'?',path:'untracked.txt'},
 ]};
 const summary=localGitSummary(view).split('\n\nOriginal observation')[0];
 assert.match(summary,/Staged modified · Unstaged modified: "both.txt"/);
 assert.ok(summary.includes('Staged renamed: "new\\nname" ← "old\\u009b31m"'));
 assert.match(summary,/Conflict: "conflict.txt"/);assert.match(summary,/Untracked: "untracked.txt"/);
 assert.doesNotMatch(summary,/[\x1b\x9b]/);assert.match(summary,/Ignored files and submodule contents are outside/);
 const oversized=localGitSummary({...view,changes:[{kind:'tracked',index:'M',worktree:'.',path:'x'.repeat(30000)},...Array.from({length:105},(_,i)=>({kind:'tracked',index:'M',worktree:'.',path:'file'+i}))]});
 assert.match(oversized,/Value too long for summary/);assert.match(oversized,/more entries/);assert.match(oversized,/Details exceed the display limit/);assert.ok(oversized.length<65536);assert.doesNotMatch(oversized,/No staged/);
});

test('failed or unavailable preparation gives its remedy without calling it verified',()=>{
 const failed=localPreparationSummary({status:'FAIL',policy:{projectId:'p',revision:2},checks:[{rule:'protected-branch',status:'FAIL',reason:'Choose a permitted working branch.'}],nextAction:'Address failed preparation rules and rerun.'}).split('\n\nOriginal observation')[0];
 assert.match(failed,/^Preparation needs changes/);assert.match(failed,/Failed · Protected branch: Choose a permitted working branch/);assert.match(failed,/No check, hook or commit ran/);assert.doesNotMatch(failed,/Preparation passed/);
 const unavailable=localPreparationSummary({status:'UNAVAILABLE',policy:{projectId:'p',revision:0},checks:[],nextAction:'Configure explicit local conventions.'});
 assert.match(unavailable,/^Preparation is unavailable/);assert.match(unavailable,/Next: Configure explicit local conventions/);
});

test('maximum legal convention lists leave next steps and omission limits visible',()=>{
 const literals=Array.from({length:32},(_,i)=>String(i)+'\u009b'.repeat(120));
 const text=localConventionsSummary({projectId:'p',revision:1,state:'CONFIGURED',rules:{protectedBranches:literals,branchPrefixes:literals,commitTypes:[],subjectMaxLength:72,requireBody:false}});
 assert.ok(text.length<16000);assert.match(text,/more entries/);assert.match(text,/Next: stage the intended change/);assert.match(text,/Details exceed the display limit/);assert.doesNotMatch(text,/\u009b/);
});
