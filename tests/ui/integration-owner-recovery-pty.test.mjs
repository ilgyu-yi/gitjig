import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {ownerRecoveryWorld} from './integration-owner-recovery-fixture.mjs';import {execute,receiverSnapshot} from './integration-read-fixture.mjs';
test('actual terminal separately renews and reauthorizes the retained original, preserves draft and spends no native/model allowance',{timeout:18000},async t=>{
 const f=await ownerRecoveryWorld(t),file=path.join(f.root,'owner-recovery-ui.json'),checkpoint=file+'.checkpoint',grant=f.c.store.one('SELECT * FROM effect_delegations WHERE root=? AND target=?',f.op.workId,f.target),original=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.op.operationId),work=f.c.store.one('SELECT * FROM works WHERE id=?',f.op.workId),budgets=f.c.store.all('SELECT * FROM budgets ORDER BY rowid'),runs=f.c.store.all('SELECT * FROM runs ORDER BY rowid'),receiver=await receiverSnapshot(f.receiver);await fs.writeFile(checkpoint,JSON.stringify({workId:f.op.workId,evidence:f.evidence}));await f.c.close();
 const draft='KEEP 한국어',list='Retained integrations · recorded facts',menu='Original integration · '+original.id;
 const unchanged=[
  {sql:'SELECT * FROM effect_operations WHERE id=?',params:[original.id],rows:[Object.values(original)]},
  {sql:'SELECT * FROM budgets ORDER BY rowid',rows:budgets.map(Object.values)},
  {sql:'SELECT * FROM runs ORDER BY rowid',rows:runs.map(Object.values)},
 ];
 const recorded=[
  {sql:'SELECT phase,grant_id FROM effect_operations WHERE id=?',params:[original.id],rows:[['PREPARED',grant.id]]},
  {sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='owner-reauthorization'",rows:[[1]]},
  {sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='send'",rows:[[0]]},
  ...unchanged.slice(1),
 ];
 const reauthorize=[
  {wait:menu,queries:unchanged,send:'Review original authority reauthorization\r'},
  {wait:'Owner reason to reauthorize this unsent original',send:'Keep same original; preparation remains separate\r'},
  {wait:'Review exact original authority reauthorization',send:'\r'},
 ];
 const refreshed={wait:menu,queries:recorded,assertDraft:draft,expectedSelected:f.conversation,send:'Back without action\r'};
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details · current and saved configuration',send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Integration targets\r'},
  {wait:'Integration targets · retained observations',send:f.target+'\r'},
  {wait:'Original integration target · actions',send:'Delegate ordinary integration to owner work\r'},
  {wait:'Integration delegation · select original owner work',send:f.op.workId+'\r'},
  {wait:'Original integration delegation held',send:'\x1b'},
  {wait:'Original grant is stale',send:'Review renewal of this original grant\r'},
  {wait:'Owner reason to renew the same integration grant',send:'Explicit same-grant owner renewal\r'},
  {wait:'Review exact original grant renewal',send:'\r'},
  {wait:'Confirm exact original grant renewal',send:'Renew this original grant\r'},
  {wait:'Original integration grant renewed',queries:[{sql:'SELECT epoch FROM effect_delegations WHERE id=?',params:[grant.id],rows:[[grant.epoch+1]]},...unchanged],send:'\x1b'},
  {wait:'Integration delegation · select original owner work',send:'Back\r'},
  {wait:'Integration targets · retained observations',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Retained integrations\r'},
  {wait:list,send:'local-git\r'},
  ...reauthorize,
  {wait:'Confirm exact original authority reauthorization',send:'Back without reauthorization\r'},
  ...reauthorize,
  {wait:'Confirm exact original authority reauthorization',send:'Reauthorize this unsent original\r'},
  {wait:'Original integration reauthorized',queries:recorded,send:'\x1b'},
  refreshed,
  {wait:list,send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'More settings and details · current and saved configuration',send:'Return to request\r'},
  {wait:draft,assertDraft:draft,send:'\x15/quit\x1b\r'},
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[],output=file+'.terminal';
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_TEST_PREPARATION_CHECKPOINT:checkpoint,...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/integration-owner-recovery-checkpoint.mjs',entry??'dist/cli/entry.js','conversation','ui','--conversation',f.conversation],env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:16000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  const bytes=await fs.readFile(output),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
  const index=steps.indexOf(refreshed),returned=bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');
  for(const line of [menu,'Preparation review required','Review original integration preparation']) assert.ok(returned.includes(line),'Refreshed integration must show '+line);
  assert.ok(!returned.includes('Review and send original prepared integration'));
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{assert.deepEqual(db.prepare('SELECT * FROM works WHERE id=?').get(f.op.workId),work);assert.deepEqual(db.prepare('SELECT * FROM budgets ORDER BY rowid').all(),budgets);assert.deepEqual(db.prepare('SELECT * FROM runs ORDER BY rowid').all(),runs);assert.equal(db.prepare('SELECT COUNT(*) n FROM effect_operations').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM effect_delegations').get().n,1);}finally{db.close();}assert.deepEqual(await receiverSnapshot(f.receiver),receiver);f.pass();}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-9000));throw error;}
});
