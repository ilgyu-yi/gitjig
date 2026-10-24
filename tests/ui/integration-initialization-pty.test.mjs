import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {firstWorld} from './integration-start-fixture.mjs';
import {heldInitializer,assertGone} from './integration-initialization-fixture.mjs';
import {execute,receiverSnapshot} from './integration-read-fixture.mjs';
test('actual terminal SIGTERM aborts first native init and restores terminal without a projection',{timeout:18000},async t=>{
 const f=await firstWorld(t),held=await heldInitializer(f,'init'),file=path.join(f.root,'first-init-terminal.json'),checkpoint=file+'.checkpoint',bytes=await receiverSnapshot(f.receiver);
 f.c.store.run("UPDATE works SET data=json_set(data,'$.applicationModelBaseline',json(?)) WHERE id=?",JSON.stringify({version:1,revision:7,choice:{kind:'managed',provider:'openai',modelId:'captured-init-terminal',thinkingLevel:'off'},source:{kind:'explicit-app-entry'}}),f.workId);
 await fs.writeFile(checkpoint,JSON.stringify({workId:f.workId,evidence:f.evidence}));await f.c.close();
 const steps=[{wait:'Model: not selected',send:'KEEP 한국어\x07t'},{wait:'Setup and next actions',send:'More settings\r'}, {wait:'More settings and details',send:'Repository management\r'},{wait:'Repository management · owner actions',send:'Integration targets\r'},{wait:'Integration targets · retained observations',send:f.target+'\r'},{wait:'Original integration target · actions',send:'Prepare first integration for owner work\r'},{wait:'First integration · select original owner work',send:f.workId+'\r'},{wait:'Review first integration preparation',send:'\x1b'},{wait:'Confirm first integration preparation',send:'Prepare first integration for this work\r'},{wait:'Trusted Git executable for this first preparation',send:held.binary+'\r'},{wait:'',waitFiles:[{path:held.marker,value:'entered'}],terminate:true,send:''}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/integration-prepare-checkpoint.mjs','dist/cli/entry.js','conversation','ui','--conversation',f.conversation],env:{PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_TEST_PREPARATION_CHECKPOINT:checkpoint},steps,timeoutSeconds:12,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:16500,maxBuffer:2**20})).stdout);
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);await assertGone(held.pids);
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{
   assert.equal(db.prepare('SELECT COUNT(*) n FROM effect_operations').get().n,1);assert.equal(db.prepare('SELECT phase FROM effect_operations').get().phase,'REFUSED');
   const run=db.prepare("SELECT phase,reservation,data FROM runs WHERE json_extract(data,'$.kind')='native-effect'").get();assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(JSON.parse(run.data).cleanup,'removed');
   assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE kind IN ('send','projection')").get().n,0);
  }finally{db.close();}
  assert.deepEqual(await receiverSnapshot(f.receiver),bytes);f.pass();
 }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-7000));throw error;}
});
