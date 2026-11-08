import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {integrationSendWorld} from './integration-send-fixture.mjs';
import {execute} from './integration-read-fixture.mjs';
import {translator} from '../../dist/ui/i18n.js';
for(const checkpoint of [false,true])test('actual terminal exact original send; synthetic procedure checkpoint='+checkpoint,{timeout:16000},async t=>{
 const f=await integrationSendWorld(t,{gate:false}),file=path.join(f.root,'original-send-ui.json'),check=path.join(f.root,'synthetic-checkpoint.json'),context=f.c.inspectIntegrationDispatch(f.op.operationId),checks=['effect_operations','effect_delegations','works','runs','budgets','sources'].map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(Object.values)}));await fs.writeFile(check,JSON.stringify({operationId:f.op.operationId,evidence:f.evidence}));await f.c.close();
 const list='Retained integrations · recorded facts',menu='Original integration · '+f.op.operationId;
 const sendAction='Review and send original prepared integration';
 const selectSend={wait:menu,queries:checks,send:sendAction+'\r'},review={wait:'Open send confirmation',queries:checks,send:'\r'};
 const tr=translator('en'),phase=checkpoint?'CONFIRMED':'REFUSED',draft='KEEP 한국어';
 const editorNotice=['Branch delivery',tr(checkpoint?'integration.phase.confirmed':'integration.phase.refused'),'refs/heads/main'].join(' · ');
 const recorded=[
  {sql:'SELECT phase FROM effect_operations WHERE id=?',params:[f.op.operationId],rows:[[phase]]},
  {sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[f.op.workId],rows:[[context.context.execution.consumed+(checkpoint?1:0),0]]},
 ];
 const refreshed={wait:menu,queries:recorded,assertDraft:draft,expectedSelected:f.conversation,send:'Back without action\r'};
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:tr('ready.detailsTitle'),send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Retained integrations\r'},
  {wait:list,send:'local-git\r'},
  selectSend,{...review,send:'\x1b'},
  selectSend,review,{wait:'Confirm exact original integration write',send:'Back without sending\r'},
  selectSend,review,{wait:'Confirm exact original integration write',send:'Send this original prepared integration\r'},
  {wait:'Trusted Git executable for this send',send:f.git+'\r'},
  {wait:'Original integration send outcome retained',queries:recorded,send:'\x1b'},
  refreshed,
  {wait:list,send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:tr('ready.detailsTitle'),send:tr('ready.returnRequest')+'\r'},
  {wait:editorNotice,assertDraft:draft,expectedSelected:f.conversation,queries:recorded,send:'\x15/quit\x1b\r'},
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[],output=file+'.terminal';
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_TEST_SEND_CHECKPOINT:check,...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import',checkpoint?'./tests/ui/integration-send-checkpoint.mjs':'./tests/ui/integration-read-native-only.mjs',entry??'dist/cli/entry.js','conversation','ui','--conversation',f.conversation],env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14500,maxBuffer:2**20})).stdout);
  assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
  const bytes=await fs.readFile(output),terminal=bytes.toString('utf8');
  const {actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
  const index=steps.indexOf(refreshed),returned=bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');
  for(const line of [menu,tr(checkpoint?'integration.phase.confirmed':'integration.phase.refused'),'refs/heads/main']) assert.ok(returned.includes(line),'Refreshed integration must show '+line);
  assert.ok(!returned.includes(sendAction));
  const editor=bytes.subarray(offsets.at(-2),offsets.at(-1)).toString('utf8');
  assert.ok(editor.includes(editorNotice),'Editor must show the original delivery status and branch after returning');
  const outcome=terminal.indexOf('Original integration send outcome retained');assert.ok(outcome>=0);assert.equal(terminal.slice(outcome).includes('Working · Submitting the original branch integration'),false);if(checkpoint)assert.ok(terminal.slice(0,outcome).includes('Working · Submitting the original branch integration'));assert.equal(await f.head(),checkpoint?f.integration:f.basis);const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE kind='send'").get().n,checkpoint?1:0);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE reservation='reserved'").get().n,0);if(checkpoint){const run=db.prepare('SELECT * FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1').get(f.op.workId);assert.equal(JSON.parse(run.data).retainedIntegrationRead,undefined);assert.equal(JSON.parse(run.data).cleanup,'removed');}}finally{db.close();}f.pass();
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-9000));throw error;}
});
