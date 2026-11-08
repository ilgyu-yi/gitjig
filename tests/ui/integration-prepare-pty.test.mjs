import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {candidateWorld,capturedSubject} from './integration-prepare-fixture.mjs';
import {execute} from './integration-read-fixture.mjs';
import {DatabaseSync} from 'node:sqlite';
test('actual terminal reviews original captured subject and prepares real native candidate without sending',{timeout:16000},async t=>{
 const f=await candidateWorld(t),baseline=capturedSubject(f),before=f.c.inspectIntegrationPreparation(f.op.operationId),file=path.join(f.root,'prepare-ui.json'),checkpoint=file+'.checkpoint';await fs.writeFile(checkpoint,JSON.stringify({workId:f.op.workId,evidence:f.evidence}));await f.c.close();
 const list='Retained integrations · recorded facts',menu='Original integration · '+f.op.operationId,draft='KEEP 한국어';
 const spend=amount=>({sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[f.op.workId],rows:[[before.context.execution.consumed+amount,0]]});
 const noSend={sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='send'",rows:[[0]]};
 const prepared=[{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[f.op.operationId],rows:[['RESERVED']]},spend(1),noSend];
 const prepareAction='Review original integration preparation',sendAction='Review and send original prepared integration';
 const prepare={wait:menu,queries:[spend(0),noSend],send:prepareAction+'\r'};
 const review={wait:'Continue to confirmation',send:'\r'};
 const refreshed={wait:menu,queries:prepared,assertDraft:draft,expectedSelected:f.conversation,send:sendAction+'\r'};
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details · current and saved configuration',send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Retained integrations\r'},
  {wait:list,send:'local-git\r'},
  prepare,review,{wait:'Confirm original integration preparation',send:'Back without preparation\r'},
  prepare,review,{wait:'Confirm original integration preparation',send:'Prepare this original integration\r'},
  {wait:'Trusted Git executable for this preparation',send:f.git+'\r'},
  {wait:'Original integration preparation retained',queries:prepared,send:'\x1b'},
  refreshed,
  {wait:'Open send confirmation',queries:prepared,send:'\x1b'},
  {wait:menu,queries:prepared,send:'Back without action\r'},
  {wait:list,send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'More settings and details · current and saved configuration',send:'Return to request\r'},
  {wait:draft,assertDraft:draft,send:'\x15/quit\x1b\r'},
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[],output=file+'.terminal';
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_TEST_PREPARATION_CHECKPOINT:checkpoint,...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/integration-prepare-checkpoint.mjs',entry??'dist/cli/entry.js','conversation','ui','--conversation',f.conversation],env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14500,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const bytes=await fs.readFile(output),terminal=bytes.toString('utf8'),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
  const index=steps.indexOf(refreshed),returned=bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');
  for(const line of [menu,'Prepared · sending is a separate decision',sendAction]) assert.ok(returned.includes(line),'Refreshed integration must show '+line);
  const outcome=terminal.indexOf('Original integration preparation retained');assert.ok(outcome>=0);assert.equal(terminal.slice(outcome).includes('Working · Preparing branch integration'),false);assert.ok(terminal.slice(0,outcome).includes('Working · Preparing branch integration'));assert.ok(terminal.includes(baseline.choice.modelId));const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM works WHERE id=?').get(f.op.workId).data).applicationModelBaseline,baseline);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE reservation='reserved'").get().n,0);}finally{db.close();}f.pass();}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-8000));throw error;}
});
