import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {execute,receiverSnapshot} from './integration-read-fixture.mjs';

for(const interruptAt of [0,1,2])test('actual terminal restores the original merge and older catalogue ' + [
 'after reading','after interrupting the original PR GET','after interrupting readback with an original observation already recorded',
][interruptAt],{timeout:20000},async t=>{
 let admissionMarker,entered,stopped,prReads=0;
 const earlyRequests=[];
 const f=await subject(t,{dropAcceptance:true,async intercept({req,res}){
  if(admissionMarker){
   const admitted=await fs.readFile(admissionMarker,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return '';});
   if(admitted!=='release') earlyRequests.push({method:req.method,path:req.url});
   else if (interruptAt && req.method==='GET' && req.url==='/repos/owner/repo/pulls/12' && ++prReads===interruptAt) {
    res.once('close',()=>{if(!res.writableFinished)writeFileSync(stopped,'stopped');});
    writeFileSync(entered,'entered');
    return true;
   }
  }
  return false;
 }});
 f.grant();
 const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);
 await f.c.dispatchMerge(prepared.operationId);
 // Place an unavailable row before the original on the older page.
 const catalogueTarget=randomUUID(),catalogueGrant=randomUUID(),catalogueData=JSON.stringify({kind:'github-merge'});
 f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',catalogueTarget,'P',catalogueData);
 f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',catalogueGrant,f.workId,catalogueTarget,1,catalogueData);
 const catalogueEntries=Array.from({length:26},()=>randomUUID());
 for(const id of catalogueEntries)
  f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',id,f.workId,catalogueTarget,catalogueGrant,'REFUSED',catalogueData);
 const firstPage=f.c.listMerges();
 assert.ok(firstPage.nextCursor);
 assert.deepEqual(f.c.listMerges({before:firstPage.nextCursor}).operations.map(row=>row.operationId),[catalogueEntries[0],prepared.operationId]);
 const conversation=f.c.createConversation().conversationId,file=path.join(f.native.root,'merge-read-terminal.json'),output=file+'.terminal';
 const credential=path.join(f.native.root,'credential.json'),receiver=await receiverSnapshot(f.native.bare);
 const tables=['works','sources','effect_delegations'],sameRows=read=>tables.map(table=>read('SELECT * FROM '+table+' ORDER BY rowid'));
 const before=JSON.stringify(sameRows(sql=>f.c.store.all(sql)));
 const checks=[...tables,'effect_operations','effect_receipts','runs','budgets'].map(table=>{
  const sql='SELECT * FROM '+table+' ORDER BY rowid';
  return {sql,rows:f.c.store.all(sql).map(Object.values)};
 });
 const consumed=f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed;
 const sendSql="SELECT * FROM effect_receipts WHERE operation=? AND kind='merge-send'";
 const originalSend={sql:sendSql,params:[prepared.operationId],rows:f.c.store.all(sendSql,prepared.operationId).map(Object.values)};
 await fs.writeFile(credential,JSON.stringify({token:'owned-native-merge-only'}),{mode:0o600});
 await f.c.close();
 const requestStart=f.native.requests.length;
 admissionMarker=path.join(f.native.root,'explicit-read-admitted');
 entered=path.join(f.native.root,'read-entered');
 stopped=path.join(f.native.root,'read-stopped');
 const draft='KEEP 한국어',list='Retained PR merges · opening does not resume or send';
 const uncertainSend='Original send · Handoff may have occurred; result is uncertain';
 const unobserved='Recorded receiver observation · No PR observation recorded';
 const observed='Recorded receiver observation · Reviewed candidate observed on the PR';
 const readAction='Review original merge reconciliation';
 const row={wait:'Newer PR merges',queries:checks,assertDraft:draft,send:'owner/repo\r'};
 const chooseRead={wait:readAction,queries:checks,assertDraft:draft,expectedSelected:conversation,send:readAction+'\r'};
 const review={wait:'Continue to confirmation',queries:checks,send:'\r'};
 const stillUnknown={sql:'SELECT phase FROM effect_operations WHERE id=?',params:[prepared.operationId],rows:[['UNKNOWN']]};
 const spentAfterStop={sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[f.workId],rows:[[consumed+1,0]]};
 const stoppedRead={sql:"SELECT phase,reservation FROM runs WHERE json_extract(data,'$.phase')='reconcile'",rows:[['SETTLED','consumed']]};
 const partialReceipt={sql:"SELECT kind FROM effect_receipts WHERE operation=? AND kind IN ('merge-candidate-observation','merge-correspondence') ORDER BY rowid",
  params:[prepared.operationId],rows:interruptAt===2?[['merge-candidate-observation']]:[]};
 const interrupted={wait:'PR merge read interrupted · original record kept',waitFiles:[{path:stopped,value:'stopped'}],
  queries:[...checks.slice(0,4),originalSend,spentAfterStop,stoppedRead,partialReceipt],assertDraft:draft,send:'\x1b'};
 const outcome={wait:observed,queries:[stillUnknown],send:'\x1b'};
 const refreshed={wait:readAction,queries:[stillUnknown],assertDraft:draft,expectedSelected:conversation,send:'Back\r'};
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details · current and saved configuration',send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Retained PR merges\r'},
  {wait:list,queries:checks,assertDraft:draft,send:'Older PR merges\r'},
  row,chooseRead,{...review,send:'\x1b'},
  {...chooseRead,send:'Back\r'},
  {...row,send:'\r'},chooseRead,review,{wait:'Confirm original PR merge read',queries:checks,send:'\r'},
  chooseRead,review,{wait:'Confirm original PR merge read',queries:checks,send:'Read this original PR merge\r'},
  {wait:'Private repository credential JSON file',queries:checks,send:'\x1b'},
  chooseRead,review,{wait:'Confirm original PR merge read',queries:checks,send:'Read this original PR merge\r'},
  {wait:'Private repository credential JSON file',queries:checks,releaseFile:admissionMarker,send:credential+'\r'},
  ...interruptAt?[
   {wait:'Esc stops this read',waitFiles:[{path:entered,value:'entered'}],send:'\x1b'},
   interrupted,
   {...chooseRead,queries:[stillUnknown,originalSend,spentAfterStop,partialReceipt]},
   {...review,queries:[stillUnknown,spentAfterStop]},
   {wait:'Confirm original PR merge read',queries:[stillUnknown,spentAfterStop],send:'Read this original PR merge\r'},
   {wait:'Private repository credential JSON file',queries:[stillUnknown,spentAfterStop],send:credential+'\r'},
  ]:[],
  outcome,refreshed,
  {wait:'Newer PR merges',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'More settings and details · current and saved configuration',send:'Return to request\r'},
  {wait:draft,assertDraft:draft,send:'\x15/quit\x1b\r'},
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
 const env={PATH:path.dirname(process.execPath),HOME:f.native.root,GITJIG_HOME:f.home,TMPDIR:f.native.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',TEST_OWNED_MERGE_ORIGIN:f.native.origin,...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/merge-target-preload.mjs',entry??'dist/cli/entry.js','conversation','ui','--conversation',conversation],env,steps,timeoutSeconds:14,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:18000,maxBuffer:1024*1024})).stdout);
  assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
  const bytes=await fs.readFile(output),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
  const screenBefore=step=>bytes.subarray(offsets[step-1],offsets[step]).toString('utf8');
  for(const [index,step] of steps.entries())if(step===chooseRead){
   const picker=screenBefore(index);
   for(const line of ['PR merge record',prepared.operationId,uncertainSend,unobserved]) assert.ok(picker.includes(line),'Merge action picker must show '+line+' before opening read review');
  }
  const receipt=screenBefore(steps.indexOf(outcome));
  for(const line of ['Original PR merge read retained · no resend',uncertainSend,observed]) assert.ok(receipt.includes(line),'Read outcome must show '+line);
  const refreshedPicker=screenBefore(steps.indexOf(refreshed));
  for(const line of ['PR merge record',prepared.operationId,uncertainSend,observed]) assert.ok(refreshedPicker.includes(line),'Refreshed original must show '+line);
  assert.ok(!refreshedPicker.includes(unobserved));
  assert.ok(!refreshedPicker.includes('Review original merge send'));
  if(interruptAt){
   const stoppedScreen=screenBefore(steps.indexOf(interrupted));
   for(const line of [uncertainSend,unobserved,prepared.operationId]) assert.ok(stoppedScreen.includes(line),'Interrupted outcome must show '+line);
  }
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});
  try{
   assert.equal(JSON.stringify(sameRows(sql=>db.prepare(sql).all())),before);
   assert.equal(db.prepare("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'").get(f.workId).consumed,consumed+(interruptAt?2:1));
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE reservation='reserved'").get().n,0);
  }finally{db.close();}
  assert.deepEqual(earlyRequests,[]);
  const reads=f.native.requests.slice(requestStart);
  assert.ok(reads.length>0&&reads.every(request=>request.method==='GET'));
  assert.equal(f.native.puts(),1);
  assert.deepEqual(await receiverSnapshot(f.native.bare),receiver);
  f.native.pass();
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-4500));throw error;}
});
