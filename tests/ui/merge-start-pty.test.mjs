import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {execute,receiverSnapshot} from './integration-read-fixture.mjs';
import {translator} from '../../dist/ui/i18n.js';

for(const drift of [false,true])test(drift ? 'actual terminal refuses a stale publication selection and keeps the original draft' : 'actual terminal reviews first owner merge preparation/default Back under declared standing fixture and keeps draft without sending',{timeout:20000},async t=>{
 const f=await subject(t);f.grant();
 const distractor='Document remote reviewer checklist';
 const other=await f.c.beginChange({projectId:'P',request:distractor});
 assert.notEqual(other.workId,f.workId);
 const request=f.c.store.one('SELECT raw FROM sources WHERE id=(SELECT source FROM works WHERE id=?)',f.workId).raw;
 const conversation=f.c.createConversation().conversationId,file=path.join(f.native.root,'merge-start-terminal.json'),output=file+'.terminal';
 const credential=path.join(f.native.root,'credential.json'),standing=path.join(f.native.root,'controlled-standing.json');
 const receiver=await receiverSnapshot(f.native.bare),tables=['works','sources','effect_delegations'];
 const before=JSON.stringify(tables.map(table=>f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
 await fs.writeFile(credential,JSON.stringify({token:'owned-native-merge-only'}),{mode:0o600});
 await fs.writeFile(standing,JSON.stringify({workId:f.workId,targetId:f.targetId,branchOperationId:f.branchOperationId,evidence:await f.c.changes.currentEvidence(f.workId)}),{mode:0o600});
 await f.c.close();
 const tr=translator('en'),draft='KEEP 한국어',workList='First PR merge preparation · original owner governed work';
 const publicationList='Original source branch publication · standing NOT RECHECKED';
 const noMerge={sql:'SELECT COUNT(*) FROM effect_operations WHERE target=?',params:[f.targetId],rows:[[0]]};
 const chooseWork={wait:request,assertDraft:draft,queries:[noMerge],send:request+'\r'};
 const choosePublication={wait:f.branchOperationId,assertDraft:draft,queries:[noMerge],send:f.branchOperationId+'\r'};
 const stalePublication={...choosePublication,mutations:[{sql:"UPDATE effect_operations SET data=json_set(data,'$.integrationCommit',?) WHERE id=?",params:['f'.repeat(40),f.branchOperationId]}]};
 const reviewBack={wait:'Continue to confirmation',queries:[noMerge],send:'\x1b'};
 const review={...reviewBack,send:'\r'};
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:tr('ready.detailsTitle'),send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'PR merge targets\r'},
  {wait:'PR merge targets · retained identities',send:'P · owner/repo\r'},
  {wait:'Retained PR target · identity only',send:'\x1b'},
  {wait:'Original PR target · separate owner authority',send:'Prepare first PR merge\r'},
  ...(drift ? [
   chooseWork,stalePublication,
   {wait:tr('merge.publication.changed'),queries:[noMerge],assertDraft:draft,send:'\x15/quit\x1b\r'},
  ] : [
  chooseWork,choosePublication,reviewBack,
  chooseWork,choosePublication,review,{wait:'Confirm first PR merge preparation',queries:[noMerge],send:'Back without preparation\r'},
  chooseWork,choosePublication,review,{wait:'Confirm first PR merge preparation',queries:[noMerge],send:'Prepare this original PR merge\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Original PR merge preparation retained',queries:[{sql:'SELECT phase,work FROM effect_operations WHERE target=?',params:[f.targetId],rows:[['RESERVED',f.workId]]}],send:'\x1b'},
  {wait:workList,send:'Back\r'},
  {wait:'PR merge targets · retained identities',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:tr('ready.detailsTitle'),send:tr('ready.returnRequest')+'\r'},
  {wait:draft,assertDraft:draft,expectedSelected:conversation,send:'\x15/quit\x1b\r'},
  ]),
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
 const env={PATH:path.dirname(process.execPath),HOME:f.native.root,GITJIG_HOME:f.home,TMPDIR:f.native.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',TEST_OWNED_MERGE_ORIGIN:f.native.origin,TEST_MERGE_OWNER_STANDING_FILE:standing,...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/merge-start-preload.mjs',entry??'dist/cli/entry.js','conversation','ui','--conversation',conversation],env,steps,timeoutSeconds:14,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:18000,maxBuffer:1024*1024})).stdout);
  assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
  const bytes=await fs.readFile(output),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
  const screenBefore=step=>bytes.subarray(offsets[step-1],offsets[step]).toString('utf8');
  const workPicker=screenBefore(steps.indexOf(chooseWork));
  assert.ok(workPicker.includes(workList)&&workPicker.includes(distractor));
  for(const [index,step] of steps.entries())if(step===choosePublication||step===stalePublication){
   const picker=screenBefore(index);
   assert.ok(picker.includes(publicationList));
   assert.ok(picker.includes(tr('integration.field.work')+' · '+f.workId));
   assert.ok(picker.includes(tr('merge.publication.recorded'))&&picker.includes(f.branchOperationId));
   assert.ok(picker.includes(f.native.subject.expectedHead));
  }
  if(drift) assert.ok(!bytes.toString('utf8').includes('Review first PR merge preparation'));
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});
  try{
   assert.equal(JSON.stringify(tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())),before);
   assert.deepEqual(db.prepare('SELECT work,phase FROM effect_operations WHERE target=?').all(f.targetId).map(Object.values),drift?[]:[[f.workId,'RESERVED']]);
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE reservation='reserved'").get().n,0);
  }finally{db.close();}
  assert.equal(f.native.puts(),0);assert.deepEqual(await receiverSnapshot(f.native.bare),receiver);f.native.pass();
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-4500));throw error;}
});
