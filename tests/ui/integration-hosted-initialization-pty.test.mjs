import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {hostedReadWorld} from './integration-hosted-read-fixture.mjs';
import {heldInitializer,assertGone} from './integration-initialization-fixture.mjs';
import {execute,receiverSnapshot} from './integration-read-fixture.mjs';
test('actual hosted terminal SIGTERM aborts initializer before identity read and restores terminal',{timeout:18000},async t=>{
 const f=await hostedReadWorld(t),held=await heldInitializer(f,'init'),file=path.join(f.root,'hosted-init-terminal.json'),conversation=f.c.createConversation().conversationId,bytes=await receiverSnapshot(f.native.receiver),rest=f.rest.requests.length,native=f.native.requests.length;
 await f.c.close();
 const steps=[{wait:'Model: not selected',send:'KEEP 한국어\x07t'},{wait:'Setup and next actions',send:'More settings\r'}, {wait:'More settings and details',send:'Repository management\r'},{wait:'Repository management · owner actions',send:'Retained integrations\r'},{wait:'Retained integrations · recorded facts',send:f.op.operationId+'\r'},{wait:'Original integration · ',send:'Reconcile original integration\r'},{wait:'Review original integration reconciliation',send:'\x1b'},{wait:'Explicit original integration read',send:'Reconcile original receiver\r'},{wait:'Trusted Git executable',send:held.binary+'\r'},{wait:'Private repository credential JSON file',send:f.credential+'\r'},{wait:'',waitFiles:[{path:held.marker,value:'entered'}],terminate:true,send:''}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/integration-read-native-only.mjs','--import','./tests/cli/normal-hosted-adapter.mjs','dist/cli/entry.js','conversation','ui','--conversation',conversation],env:{PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',TEST_NORMAL_REST_ORIGIN:f.rest.origin,TEST_NORMAL_HTTPS_PROFILE:JSON.stringify({origin:f.native.origin,caFile:f.native.ca,execPath:f.native.execPath})},steps,timeoutSeconds:12,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:16500,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);await assertGone(held.pids);
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{
   const run=db.prepare("SELECT * FROM runs WHERE work=? AND json_extract(data,'$.kind')='native-effect' ORDER BY rowid DESC LIMIT 1").get(f.op.workId);assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(JSON.parse(run.data).cleanup,'removed');assert.equal(JSON.parse(run.data).retainedIntegrationRead,true);
   assert.equal(db.prepare('SELECT phase FROM effect_operations WHERE id=?').get(f.op.operationId).phase,'UNKNOWN');
  }finally{db.close();}
  assert.equal(f.rest.requests.length,rest);assert.equal(f.native.requests.length,native);assert.deepEqual(await receiverSnapshot(f.native.receiver),bytes);f.pass();
 }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-7000));throw error;}
});
