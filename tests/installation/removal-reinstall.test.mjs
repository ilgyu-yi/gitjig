import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile, fork} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);
test('public removal honors actual owner lock, revokes preloaded old admission, preserves state/foreign entries and reinstalls the same owned payload',{timeout:120000},async t=>{
 if(!process.env.GITJIG_INSTALL_RECEIPT)throw Error('Actual accepted installation receipt required');
 const {home,bundleRoot,payloadId}=JSON.parse(await fs.readFile(process.env.GITJIG_INSTALL_RECEIPT,'utf8'));
 const node=path.join(home,'bootstrap/node'),payload=path.join(home,'versions',payloadId),installer=path.join(bundleRoot,'install');
 const cli=async(...args)=>JSON.parse((await execute(path.join(home,'gitjig'),args,{timeout:30000,maxBuffer:2**20})).stdout);
 const stateScript=`import {openController} from ${JSON.stringify(pathToFileURL(path.join(payload,'dist/controller/index.js')).href)};const c=await openController({installationHome:${JSON.stringify(home)}});try{const v=c.createConversation();c.setDraft({conversationId:v.conversationId,expectedRevision:0,text:'업데이트와 제거 이후에도 남겨야 하는 초안'});console.log(JSON.stringify(c.inspectConversation(v.conversationId)));}finally{await c.close();}`;
 const before=JSON.parse((await execute(node,['--input-type=module','-e',stateScript],{timeout:30000})).stdout);
 const db=path.join(home,'state/controller.sqlite'),databaseBefore=await fs.readFile(db),custom=await fs.readFile(path.join(home,'config/owner-customization.txt'));
 // A real live owner prevents removal, before the admission marker or any asset changes.
 const {acquireOwner}=await import(pathToFileURL(path.join(bundleRoot,'payload/dist/controller/ownership.js')).href);
 const release=await acquireOwner(path.join(home,'state'));try{
  await assert.rejects(execute(installer,['remove','--home',home],{timeout:30000}),e=>e.code===2&&e.stderr.includes('owner alive'));
  assert.equal(JSON.parse(await fs.readFile(path.join(home,'controller.json'),'utf8')).installation.state,'active');
  assert.deepEqual(await fs.readFile(db),databaseBefore);await fs.access(node);
 }finally{await release();}
 const foreign=path.join(home,'versions','owner-keeps-this');await fs.mkdir(foreign,{mode:0o700});await fs.writeFile(path.join(foreign,'notes'),'owner data',{mode:0o600});
 // Import the old product before removal, then attempt its real inside-lock entry afterwards.
 const waiter=path.join(home,'config/old-entry-probe.mjs');await fs.writeFile(waiter,`import {openController} from ${JSON.stringify(pathToFileURL(path.join(payload,'dist/controller/index.js')).href)};process.send('ready');process.once('message',async()=>{try{const c=await openController({installationHome:${JSON.stringify(home)}});await c.close();process.send({unexpected:'admitted'});}catch(e){process.send({code:e.code,message:e.message});}finally{process.disconnect();}});`,{mode:0o600});
 const old=fork(waiter,[],{execPath:node,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',PI_PACKAGE_DIR:''}});
 const message=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Old entry probe timed out')),15000);old.once('message',m=>{clearTimeout(timer);resolve(m);});old.once('error',reject);});
 const oldExit=new Promise((resolve,reject)=>{old.once('exit',(code,signal)=>code===0?resolve():reject(Error('Old entry exit '+code+'/'+signal)));});
 t.after(()=>{if(old.connected)old.kill('SIGKILL');});assert.equal(await message(),'ready');
 const removal=JSON.parse((await execute(installer,['remove','--home',home],{timeout:60000,maxBuffer:2**20})).stdout);
 assert.equal(removal.managedState,'removed');assert.ok(removal.removed.includes(payload));assert.ok(removal.removed.includes(path.join(home,'bootstrap')));assert.ok(removal.preserved.some(x=>x.path===foreign));
 const rejected=message();old.send('attempt');assert.equal((await rejected).code,'INSTALLATION_REMOVED');await oldExit;
 assert.deepEqual(await fs.readFile(db),databaseBefore);assert.deepEqual(await fs.readFile(path.join(home,'config/owner-customization.txt')),custom);assert.equal(await fs.readFile(path.join(foreign,'notes'),'utf8'),'owner data');await assert.rejects(fs.access(path.join(home,'gitjig')),{code:'ENOENT'});
 const reinstalled=JSON.parse((await execute(installer,['activate','--bundle',bundleRoot,'--home',home],{timeout:100000,maxBuffer:2**20})).stdout);
 assert.equal(reinstalled.active,true);assert.equal(reinstalled.payloadId,payloadId);assert.equal(reinstalled.unchanged,undefined);assert.equal(reinstalled.installedHandshake,'passed');
 const after=await cli('conversation','inspect','--conversation',before.conversationId);assert.equal(after.draft.text,before.draft.text);assert.equal(after.draft.revision,before.draft.revision);assert.equal(await fs.readFile(path.join(foreign,'notes'),'utf8'),'owner data');assert.deepEqual(await fs.readFile(path.join(home,'config/owner-customization.txt')),custom);assert.equal(JSON.parse(await fs.readFile(path.join(home,'controller.json'),'utf8')).installation.state,'active');await assert.rejects(fs.access(path.join(home,'activation.json')),{code:'ENOENT'});
 const receipt={home,payloadId,conversationId:before.conversationId,draft:after.draft,removal,restoredBy:'public bundled installer',oldPreloadedEntry:'INSTALLATION_REMOVED',ownerBusy:'refused before mutation'};
 if(process.env.GITJIG_LIFECYCLE_RECEIPT)await fs.writeFile(process.env.GITJIG_LIFECYCLE_RECEIPT,JSON.stringify(receipt,null,2));t.diagnostic('Retained installation '+home);
});
