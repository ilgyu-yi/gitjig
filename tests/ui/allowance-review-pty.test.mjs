/** Actual 80-column owner review; fixtures contain no provider/engine execution. */
import os from 'node:os';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';import {openController} from '../../dist/controller/index.js';import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);
for(const locale of ['en','ko'])test(locale+' 80-column allowance review keeps Cancel as default then confirms the exact shared change',{timeout:40000},async t=>{
 const f=await registryWorld(t,'allowance-review'),id=f.works[0].workId,cid=f.c.createConversation().conversationId,s=f.c.store,row=s.one('SELECT * FROM works WHERE id=?',id),keys=Object.keys(row);
 // Controlled dormant rows expose the bounded family preview, not real task standing.
 for(let i=0;i<31;i++){const copy={...row,id:'controlled-preview-member-'+i,lineage:id};s.run('INSERT INTO works('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')',...keys.map(k=>copy[k]));}
 s.run("UPDATE budgets SET lim=1024,consumed=1020,reserved=0 WHERE lineage=? AND kind='execution'",id);
 const expected=f.c.inspectWorkAllowance(id),goal=f.c.createGoal({conversationId:cid,objective:'Preserve independent goal turns',criteria:['No goal allowance change'],turnLimit:3}),draft='KEEP 한국어 draft';
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});f.c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});await f.c.close();
 const config=path.join(f.root,'allowance.json'),observation=path.join(f.root,'current'),output=path.join(f.root,'terminal'),text=(key,args)=>args?uiText(locale,key,args):uiText(locale,key),kind=text('workRecovery.executionKind');
 const step=(editorFocused,contains,send,extra={})=>({editorFocused,draft,contains,send,...extra});
 const openReady=[step(true,[],'\x07t',{unchanged:true}),step(false,[text('ready.title')],text('ready.more')+'\r',{unchanged:true}),step(false,[text('ready.detailsTitle')],text('ready.work')+'\r',{unchanged:true})];
 const selectWork=step(false,[text('workRecovery.registryTitle')],id+'\r',{unchanged:true});
 const form=[
  step(false,[text('workRecovery.title',{id,state:''})],text('workRecovery.execution')+'\r',{unchanged:true}),
  step(false,[text('workRecovery.additional',{kind,available:4}),locale==='ko'?'비워 두면 4':'Leave empty to use 4'],'100\r',{unchanged:true}),
  step(false,[text('workRecovery.allowanceReason')],'Exact owner decision 한국어\r',{unchanged:true}),
  step(false,['"scope"',locale==='ko'?'goal':'Goal'],'\r',{scrollUntil:true,scrollTitle:text('workRecovery.reviewAllowance'),unchanged:true}),
 ];
 const confirmation=[text('workRecovery.extendTitle',{kind,id,lineage:expected.lineageRoot}).split(' · ')[0],text('workRecovery.cancel'),text('workRecovery.confirmAllowance',{kind,additional:100})];
 // Cancellation and completion both return to the original work before Back.
 const steps=[step(true,[],'',{baseline:true}),...openReady,selectWork,
  form[0],{...form[1],send:'\x1b'},form[0],form[1],{...form[2],send:'\x1b'},...form.slice(0,-1),
  step(false,[text('review.openConfirmation')],'\x1b',{unchanged:true}),...form,
  step(false,confirmation,'\r',{unchanged:true}),...form,
  step(false,confirmation,text('workRecovery.confirmAllowance',{kind,additional:100})+'\r',{unchanged:true}),
  step(false,[text('workRecovery.title',{id,state:''}),text('workRecovery.extended',{kind})],'\x1b'),
  step(false,[text('workRecovery.registryTitle')],'\x1b'),
  step(false,[text('ready.detailsTitle')],'\x1b'),step(false,[text('ready.title')],'\x1b'),step(true,[],'\x07q'),
 ];
 await fs.writeFile(config,JSON.stringify({cid,observation,output,steps,rows:36,columns:80,timeoutSeconds:20,command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',cid],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,GITJIG_RESULT_OBSERVATION:observation,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}}));
 const result=JSON.parse((await execute('/usr/bin/python3',[path.resolve('tests/ui/inspection-pty.py'),config],{timeout:35000,maxBuffer:2**20}).catch(async error=>{const retained=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-allowance-review-failed-'));await fs.cp(f.root,path.join(retained,'fixture'),{recursive:true});t.diagnostic('Retained allowance terminal failure '+retained);throw error;})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const c=await openController({installationHome:f.home});try{const current=c.inspectWorkAllowance(id);assert.deepEqual(current.execution,{...expected.execution,limit:1124});assert.deepEqual(current.resolution,expected.resolution);assert.equal(c.inspectConversation(cid).draft.text,draft);assert.equal(c.inspectGoal(goal.goalId).turnLimit,3);assert.equal(c.inspectGoal(goal.goalId).startedAttempts,0);}finally{await c.close();}
});

for(const locale of ['en','ko'])test(locale+' shared allowance hold opens before its amount form',{timeout:15000},async t=>{
 const f=await registryWorld(t,'allowance-held'),id=f.works[0].workId,cid=f.c.createConversation().conversationId,draft='KEEP 한국어 draft';
 f.c.store.run("UPDATE works SET lineage=?,state='UNKNOWN' WHERE id=?",id,f.works[1].workId);
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 f.c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
 const before=workLedger(f.c);await f.c.close();
 const config=path.join(f.root,'allowance-held.json'),observation=path.join(f.root,'current'),output=path.join(f.root,'terminal');
 const text=(key,args)=>uiText(locale,key,args),kind=text('workRecovery.resolutionKind');
 const step=(editorFocused,contains,send,extra={})=>({editorFocused,draft,contains,send,unchanged:true,...extra});
 const steps=[step(true,[],'',{baseline:true,unchanged:false}),step(true,[],'\x07t'),
  step(false,[text('ready.title')],text('ready.more')+'\r'),
  step(false,[text('ready.detailsTitle')],text('ready.work')+'\r'),step(false,[text('workRecovery.registryTitle')],id+'\r'),
  step(false,[text('workRecovery.title',{id,state:''})],text('workRecovery.resolution')+'\r'),
  step(false,[text('workRecovery.allowanceHeld'),locale==='ko'?'정리 상태가 확인되지 않았습니다':'its cleanup is unconfirmed'],'\x1b',
   {absent:[text('workRecovery.additional',{kind,available:8}),text('workRecovery.allowanceReason')]}),
  step(false,[text('workRecovery.title',{id,state:''})],'\x1b'),step(false,[text('workRecovery.registryTitle')],'\x1b'),step(false,[text('ready.detailsTitle')],'\x1b'),
  step(false,[text('ready.title')],'\x1b'),step(true,[],'\x07q')];
 const command=[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
  process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',cid];
 await fs.writeFile(config,JSON.stringify({cid,observation,output,steps,rows:28,columns:100,timeoutSeconds:10,command,env:{...process.env,HOME:f.root,
  GITJIG_HOME:f.home,GITJIG_RESULT_OBSERVATION:observation,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}}));
 const receipt=JSON.parse((await execute('/usr/bin/python3',[path.resolve('tests/ui/inspection-pty.py'),config],{timeout:14000,maxBuffer:2**20}).catch(async error=>{
  t.diagnostic((await fs.readFile(output+'.frames.json','utf8').catch(()=>'' )).slice(-4000));throw error;
 })).stdout);
 assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
 const c=await openController({installationHome:f.home});
 try{assert.deepEqual(workLedger(c),before);assert.equal(c.inspectConversation(cid).draft.text,draft);}finally{await c.close();}
});
