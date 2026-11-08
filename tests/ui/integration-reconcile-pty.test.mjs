import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {integrationReadWorld,execute,receiverSnapshot} from './integration-read-fixture.mjs';
import {translator} from '../../dist/ui/i18n.js';
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
for(const mode of ['normal','close','interrupt'])test('actual terminal original local integration read with explicit Git path · '+mode,{timeout:16000},async t=>{
 const close=mode==='close',interrupt=mode==='interrupt';
 const f=await integrationReadWorld(t),conversation=f.c.createConversation().conversationId,file=path.join(f.root,'integration-read-ui.json'),native=await receiverSnapshot(f.receiver),budget=f.c.inspectIntegrationReconciliation(f.op.operationId).execution,marker=path.join(f.root,'native-read-entered');let binary=f.git;
 if(close||interrupt){binary=path.join(f.root,'owned-held-git');await fs.writeFile(binary,'#!/bin/sh\nfor arg do\n if [ "$arg" = ls-remote ]; then\n  printf entered > '+quote(marker)+'\n  '+quote(process.execPath)+' -e '+quote('setInterval(()=>{},1000)')+' &\n  wait\n  exit $?\n fi\ndone\nexec '+quote(f.git)+' "$@"\n',{mode:0o700});}
 const protectedTables=['effect_operations','effect_receipts','effect_delegations','works','runs','budgets','sources'];
 const checks=protectedTables.map(table=>{
  const sql='SELECT * FROM '+table+' ORDER BY rowid';
  return {sql,rows:f.c.store.all(sql).map(Object.values)};
 });
 const original=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.op.operationId);
 await f.c.close();
 const list='Retained integrations · recorded facts',menu='Original integration · '+f.op.operationId;
 const selectRead={wait:menu,queries:checks,send:'Reconcile original integration\r'},review={wait:'Open read confirmation',queries:checks,send:'\r'};
 const tr=translator('en'),draft='KEEP 한국어',ref='refs/heads/main';
 const confirmTitle=tr('integration.readConfirmTitle');
 const confirmContext=[tr('integration.field.work')+' · '+f.op.workId,tr('integration.field.ref')+' · '+ref,tr('integration.readConfirmEffect')];
 const confirm=choice=>({wait:tr('integration.choice.read'),queries:checks,assertDraft:draft,expectedSelected:conversation,send:tr(choice)+'\r'});
 const cancelConfirm=confirm('integration.choice.readBack'),approveConfirm=confirm('integration.choice.read');
 const editorNotice=['Branch delivery',tr('integration.editorUncertainSend'),ref].join(' · ');
 const spend=count=>({sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[f.op.workId],rows:[[budget.consumed+count,0]]});
 const recorded=[
  {sql:'SELECT phase FROM effect_operations WHERE id=?',params:[f.op.operationId],rows:[['CONFIRMED']]},
  spend(interrupt?2:1),
 ];
 const stopped=[...checks.filter(check=>!['runs','budgets'].some(table=>check.sql.includes('FROM '+table))),spend(1),
  {sql:"SELECT phase,reservation,json_extract(data,'$.cleanup') FROM runs WHERE json_extract(data,'$.retainedIntegrationRead')=1",rows:[['SETTLED','consumed','removed']]}];
 const refreshed={wait:menu,queries:recorded,assertDraft:draft,expectedSelected:conversation,send:'Back without action\r'};
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:tr('ready.detailsTitle'),send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Retained integrations\r'},
  {wait:list,send:'local-git\r'},
  selectRead,{...review,send:'\x1b'},
  selectRead,review,cancelConfirm,
  selectRead,review,approveConfirm,
  {wait:'Trusted Git executable for this read',send:binary+'\r'},
  ...close?[
   {wait:'Working · Checking the original branch integration result',waitFiles:[{path:marker,value:'entered'}],assertDraft:draft,expectedSelected:conversation,terminate:true,send:''},
  ]:[
   ...interrupt?[
    {wait:'Esc stops this read',waitFiles:[{path:marker,value:'entered'}],assertDraft:draft,send:'\x1b'},
    {wait:tr('integration.readInterrupted'),queries:stopped,assertDraft:draft,expectedSelected:conversation,send:'\x1b'},
    {...selectRead,queries:stopped},{...review,queries:stopped},{...approveConfirm,queries:stopped},
    {wait:'Trusted Git executable for this read',queries:stopped,send:f.git+'\r'},
   ]:[],
   {wait:'Original integration reconciliation retained',queries:recorded,send:'\x1b'},
   refreshed,
   {wait:list,send:'Back\r'},
   {wait:'Repository management · owner actions',send:'Close\r'},
   {wait:tr('ready.detailsTitle'),send:tr('ready.returnRequest')+'\r'},
   {wait:editorNotice,queries:recorded,assertDraft:draft,expectedSelected:conversation,send:'\x15/quit\x1b\r'},
  ],
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[],output=file+'.terminal';
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/integration-read-native-only.mjs',entry??'dist/cli/entry.js','conversation','ui','--conversation',conversation],env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14500,maxBuffer:2**20})).stdout);
  assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
  const bytes=await fs.readFile(output),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
  const screenBefore=step=>bytes.subarray(offsets[step-1],offsets[step]).toString('utf8');
  for(const step of [cancelConfirm,approveConfirm]){
   const confirmation=screenBefore(steps.indexOf(step));
   for(const line of [confirmTitle,...confirmContext]) assert.ok(confirmation.includes(line),'Original read confirmation must show '+line);
  }
  if(!close){
   const returned=screenBefore(steps.indexOf(refreshed));
   for(const line of [menu,tr('integration.phase.confirmed'),ref]) assert.ok(returned.includes(line),'Refreshed integration must show '+line);
   assert.ok(!returned.includes(tr('integration.choice.sendReview')));
   assert.ok(screenBefore(steps.length-1).includes(editorNotice),'Editor must show the read outcome and original send uncertainty');
  }
  assert.deepEqual(await receiverSnapshot(f.receiver),native);
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});
  try{
   const op=db.prepare('SELECT * FROM effect_operations WHERE id=?').get(f.op.operationId);
   const run=db.prepare('SELECT * FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1').get(f.op.workId),data=JSON.parse(run.data);
   assert.equal(op.phase,close?'UNKNOWN':'CONFIRMED');
   for(const key of ['id','work','target','grant_id']) assert.equal(op[key],original[key]);
   const retained=JSON.parse(op.data),prior=JSON.parse(original.data);
   for(const key of ['expectedBase','headCommit','integrationCommit','evidence','dispatchRun']) assert.deepEqual(retained[key],prior[key]);
   assert.equal(data.retainedIntegrationRead,true);
   assert.equal(data.cleanup,'removed');
   assert.equal(run.phase,'SETTLED');
   assert.equal(run.reservation,'consumed');
   assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE kind='send'").get().n,0);
   assert.equal(db.prepare("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'").get(f.op.workId).consumed,budget.consumed+(interrupt?2:1));
   assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE reservation='reserved'").get().n,0);
  }finally{db.close();}
  f.pass();
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-9000));throw error;}
});
