/** Finite owned crash-cut process. Never imported as a test or pointed at user storage. */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../../dist/controller/store.js';
import {SourceBranchPreviews} from '../../dist/controller/source-branch-previews.js';
import {SourceBranchPreviewRuntime} from '../../dist/controller/source-branch-preview-runtime.js';
import {acquireOwner} from '../../dist/controller/ownership.js';
const [home,cut,nonce]=process.argv.slice(2);assert.equal(JSON.parse(await fs.readFile(path.join(home,'fixture-owner.json'),'utf8')).nonce,nonce);
const release=await acquireOwner(path.join(home,'state')),store=new Store(path.join(home,'state/controller.sqlite')),runtime=new SourceBranchPreviewRuntime(store,home,release);
await runtime.recover();
const crash=(code,details={})=>{fsSync.writeFileSync(path.join(home,'crash-cut.json'),JSON.stringify({pid:process.pid,nonce,cut,code,...details}),{flag:'wx',mode:0o600});process.exit(code);};
if(cut.startsWith('admission')){const original=SourceBranchPreviews.prototype.admitDurable;SourceBranchPreviews.prototype.admitDurable=function(...args){const row=original.apply(this,args);if(cut==='admission-unknown')this.markUnknown(row.id,'Deliberately retained prior uncertainty');crash(71);};}
if(cut==='legacy-v1'){new SourceBranchPreviews(store,home).admit({workId:'W',sourceId:'owner-source',epoch:1,generation:1,inputDigest:'b'.repeat(64),profileDigest:'a'.repeat(64),factoryProtocol:'owned-native-git-prebirth/v1'});crash(78);}
if(cut==='root-created'){const original=fs.mkdir;fs.mkdir=async function(...args){const result=await original.apply(this,args);if(String(args[0]).endsWith('/client'))crash(72);return result;};}
if(cut==='root-before-tx')SourceBranchPreviews.prototype.attachRoot=function(){crash(76);};
if(cut==='root-during-tx'){const original=store.run.bind(store);store.run=function(sql,...args){const result=original(sql,...args);if(sql==='INSERT INTO sources VALUES(?,?,?,?)'&&JSON.parse(args[2]).purpose==='root')crash(77);return result;};}
if(cut.startsWith('root-proof')){const original=SourceBranchPreviews.prototype.attachRoot;SourceBranchPreviews.prototype.attachRoot=function(...args){original.apply(this,args);crash(73);};}
if(cut==='native-terminal'){SourceBranchPreviews.prototype.settle=function(){crash(75);};}
let git='/opt/homebrew/bin/git';
if(cut==='native-birth'){
 git=path.join(home,'owned-git');const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 await fs.writeFile(path.join(home,'gate-reader.mjs'),`import {DatabaseSync} from 'node:sqlite';import assert from 'node:assert/strict';const db=new DatabaseSync(process.argv[2],{readOnly:true});const row=db.prepare("SELECT admission_source,root_source FROM source_branch_previews WHERE work='W'").get();assert.ok(row.root_source);const raw=JSON.parse(db.prepare('SELECT raw FROM sources WHERE id=?').get(row.admission_source).raw);assert.equal(raw.durableGate.rootReceiptId,row.root_source);assert.equal(raw.durableGate.writer.synchronous,2);assert.ok(db.prepare('SELECT id FROM sources WHERE id=?').get(row.root_source));console.log(JSON.stringify(row));db.close();`,{mode:0o600});
 await fs.writeFile(git,'#!/bin/sh\nset -e\nfor arg in "$@"; do\n if [ "$arg" = "--version" ]; then\n  '+quote(process.execPath)+' '+quote(path.join(home,'gate-reader.mjs'))+' '+quote(path.join(home,'state/controller.sqlite'))+' > '+quote(path.join(home,'gate-reader.json'))+'\n  printf %s "$$" > '+quote(path.join(home,'native-born'))+'\n  sleep 1\n fi\ndone\nexec /opt/homebrew/bin/git "$@"\n',{mode:0o700});
 // This cut proves the controlled SELECTED producer shell was physically started,
 // not that the subsequently delegated real Git executable ran.
 const timer=setInterval(()=>{
  if(!fsSync.existsSync(path.join(home,'native-born')))return;
  const selectedPid=Number(fsSync.readFileSync(path.join(home,'native-born'),'utf8'));
  if(!Number.isSafeInteger(selectedPid)||selectedPid<1)return;
  const row=new SourceBranchPreviews(store,home).active().previews[0];
  for(const commandId of fsSync.readdirSync(row.root.runsDirectory)){
   const directory=path.join(row.root.runsDirectory,commandId);if(!fsSync.existsSync(path.join(directory,'git-start.json')))continue;
   const descriptor=JSON.parse(fsSync.readFileSync(path.join(directory,'descriptor.json'),'utf8')),start=JSON.parse(fsSync.readFileSync(path.join(directory,'git-start.json'),'utf8')),lifecycle=JSON.parse(fsSync.readFileSync(path.join(directory,'lifecycle.json'),'utf8'));
   if(descriptor.argv.at(-1)!=='--version')continue;
   assert.equal(descriptor.binary,git);assert.equal(start.gitStarted,true);assert.equal(start.gitPid,selectedPid);assert.equal(start.commandId,commandId);assert.equal(lifecycle.commandId,commandId);assert.equal(start.pid,lifecycle.pid);
   process.kill(selectedPid,0);process.kill(lifecycle.pid,0);
   crash(74,{native:{commandId,selectedPid,supervisorPid:lifecycle.pid,startIdentity:lifecycle.startIdentity,controlledSelectedProducer:true}});
  }
 },5);timer.unref();
}
try{
 await runtime.run({workId:'W',sourceId:'owner-source',epoch:1,generation:1,inputDigest:'b'.repeat(64),profile:{gitBinary:git},validate(){}},async()=>({privateProposal:true}));
 throw Error('Declared original crash cut did not execute');
}finally{await runtime.close();store.close();await release();}
