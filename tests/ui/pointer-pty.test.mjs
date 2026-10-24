import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);

for(const profile of [{commandKey:'ctrl+g'},{commandKey:'ctrl+q'},{commandKey:'ctrl+p'},{commandKey:'ctrl+g',persistenceRefusal:true}])test('native split pointer selection/retention '+JSON.stringify(profile),{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ui-pointer-'))),home=path.join(root,'home');
 const setup=await openController({installationHome:home});await setup.close();
 const cfg={...profile,home,control:path.join(root,'control.json'),finish:path.join(root,'finish'),receipt:path.join(root,'receipt.json')};
 const child=path.join(root,'child.json'),driver=path.join(root,'driver.json');
 await fs.writeFile(child,JSON.stringify(cfg));
 await fs.writeFile(driver,JSON.stringify({...cfg,artifacts:path.join(home,'artifacts'),output:path.join(root,'terminal.bin'),command:[process.execPath,path.resolve('tests/ui/pointer-pty-child.mjs'),child]}));
 try{
  const actual=JSON.parse((await execute('python3',[path.resolve('tests/ui/pointer-pty.py'),driver],{timeout:16000,maxBuffer:1024*1024})).stdout);
  const receipt=JSON.parse(await fs.readFile(cfg.receipt,'utf8'));
  await fs.writeFile(path.join(root,'actual.json'),JSON.stringify({actual,receipt},null,2));
  t.diagnostic(JSON.stringify({actual,receipt,fixture:root}));
  assert.equal(actual.exitCode,0);assert.equal(actual.terminalRestored,true);assert.equal(actual.keyboardControl,true);assert.equal(receipt.providerCalls,0);
  if(profile.persistenceRefusal){
   assert.equal(actual.sample.selected,receipt.left);assert.equal(receipt.rightDraft,'RIGHT_DRAFT');assert.ok(actual.sample.failedSaves>0);
   assert.equal(actual.sample.lastAttempt.conversationId,receipt.left);assert.ok(actual.sample.lastAttempt.text.includes('UNSAVED'));assert.ok(actual.sample.lastAttempt.text.includes('POINTER_TARGET'));
   assert.equal(receipt.leftDraft,actual.sample.lastAttempt.text,'Explicit recovery preserves the entire previously unsaved editor text');
  }else{
   assert.equal(actual.pointerDeliveredToRightDraft,true);assert.equal(receipt.leftDraft,'LEFT_DRAFT');
   assert.equal(actual.selectedMatchesPointerTarget,true,'Native pointer focus must select the same conversation used by the command menu and submit');
  }
 }catch(error){t.diagnostic('Retained pointer control '+root);throw error;}
});
