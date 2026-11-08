import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {execute} from './integration-read-fixture.mjs';

test('actual terminal prepares then separately sends from the refreshed original merge record without losing draft',{timeout:25000},async t=>{
 let admission;
 const prematureRequests=[];
 const released=async file=>await fs.readFile(file,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return '';})==='release';
 const f=await subject(t,{async intercept({req}){
  if(admission&&(!await released(admission.prepare)||await released(admission.prepared)&&!await released(admission.send)))
   prematureRequests.push(req.method+' '+req.url);
  if(req.method==='GET'&&req.url==='/repos/owner/repo/pulls/12')await delay(150);
  return false;
 }});const grant=f.grant(),original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),conversation=f.c.createConversation().conversationId,file=path.join(f.native.root,'merge-send-terminal.json'),credential=path.join(f.native.root,'credential.json'),standing=path.join(f.native.root,'controlled-standing.json'),tables=['works','sources','effect_delegations'],before=JSON.stringify(tables.map(table=>f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid'))),spent=f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed;await fs.writeFile(credential,JSON.stringify({token:'owned-native-merge-only'}),{mode:0o600});await fs.writeFile(standing,JSON.stringify({operationId:original.operationId,workId:f.workId,evidence:await f.c.changes.currentEvidence(f.workId)}),{mode:0o600});await f.c.close();
 const draft='KEEP 한국어',list='Retained PR merges · opening does not resume or send';
 const spend=amount=>({sql:"SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",params:[f.workId],rows:[[spent+amount]]});
 const phase=state=>({sql:'SELECT phase FROM effect_operations WHERE id=?',params:[original.operationId],rows:[[state]]});
 const prepareAction='Review original merge preparation',sendAction='Review original merge send';
 admission={prepare:path.join(f.native.root,'explicit-preparation-admitted'),
  prepared:path.join(f.native.root,'preparation-receipt'),
  send:path.join(f.native.root,'explicit-send-admitted')};
 const preparePicker={wait:prepareAction,queries:[spend(0)],assertDraft:draft,send:prepareAction+'\r'};
 const sendPicker={wait:sendAction,queries:[spend(1),phase('RESERVED')],send:sendAction+'\r'};
 const prepareReview={wait:'Continue to confirmation',send:'\r'};
 const sendReview={wait:'Continue to confirmation',queries:[spend(1)],send:'\r'};
 const confirmedPicker={wait:'Before another hosted change',queries:[spend(2),phase('CONFIRMED')],assertDraft:draft,send:'Back\r'};
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details · current and saved configuration',send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Retained PR merges\r'},
  {wait:list,send:'owner/repo\r'},
  preparePicker,{...prepareReview,send:'\x1b'},
  preparePicker,prepareReview,{wait:'Confirm original PR merge preparation',queries:[spend(0)],send:'\r'},
  preparePicker,prepareReview,{wait:'Confirm original PR merge preparation',queries:[spend(0)],send:'Prepare this same original PR merge\r'},
  {wait:'Private repository credential JSON file',queries:[spend(0)],send:'\x1b'},
  preparePicker,prepareReview,{wait:'Confirm original PR merge preparation',queries:[spend(0)],send:'Prepare this same original PR merge\r'},
  {wait:'Private repository credential JSON file',queries:[spend(0)],releaseFile:admission.prepare,send:credential+'\r'},
  {wait:'Original PR merge preparation retained · sending remains separate',queries:[spend(1)],releaseFile:admission.prepared,send:'\x1b'},
  sendPicker,{...sendReview,send:'\x1b'},
  sendPicker,sendReview,{wait:'Confirm original PR merge send',queries:[spend(1)],send:'\r'},
  sendPicker,sendReview,{wait:'Confirm original PR merge send',queries:[spend(1)],releaseFile:admission.send,send:'Send this prepared original PR merge\r'},
  {wait:'Original PR merge send retained · inspect actual outcome',queries:[phase('CONFIRMED')],send:'\x1b'},
  confirmedPicker,
  {wait:list,send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'More settings and details · current and saved configuration',send:'Return to request\r'},
  {wait:draft,assertDraft:draft,send:'\x15/quit\x1b\r'},
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
 const env={PATH:path.dirname(process.execPath),HOME:f.native.root,GITJIG_HOME:f.home,TMPDIR:f.native.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',TEST_OWNED_MERGE_ORIGIN:f.native.origin,TEST_MERGE_SEND_STANDING_FILE:standing,...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/merge-send-preload.mjs',entry??'dist/cli/entry.js','conversation','ui','--conversation',conversation],env,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:22000,maxBuffer:1024*1024})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  const bytes=await fs.readFile(file+'.terminal'),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(file+'.terminal.progress.json','utf8'));
  const screen=bytes.toString('utf8');assert.match(screen,/Working · Preparing the PR merge/);assert.match(screen,/Working · Submitting the original PR merge/);
  const screenBefore=stage=>{const index=steps.indexOf(stage);return bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');};
  assert.deepEqual(prematureRequests,[]);
  for(const stage of [preparePicker,sendPicker,confirmedPicker]){
   const picker=screenBefore(stage);
   for(const line of ['PR merge record',original.operationId])assert.ok(picker.includes(line),'Refreshed original must show '+line);
  }
  const confirmed=screenBefore(confirmedPicker);
  assert.match(confirmed,/Merge recorded as confirmed · [a-f0-9]{40}/);
  assert.ok(!confirmed.includes(sendAction));
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(JSON.stringify(tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())),before);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM effect_operations WHERE target=? AND grant_id=?').get(f.targetId,grant.delegationId).n,1);assert.equal(db.prepare("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'").get(f.workId).consumed,spent+2);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE reservation='reserved'").get().n,0);}finally{db.close();}assert.equal(f.native.puts(),1);f.native.pass();}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-4500));throw error;}
});
