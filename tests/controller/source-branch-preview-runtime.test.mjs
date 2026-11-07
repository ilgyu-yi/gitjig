import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Store} from '../../dist/controller/store.js';
import {SourceBranchPreviews} from '../../dist/controller/source-branch-previews.js';
import {SourceBranchPreviewRuntime} from '../../dist/controller/source-branch-preview-runtime.js';
import {acquireOwner} from '../../dist/controller/ownership.js';
import {reconcileOwnedGitProcesses} from '../../dist/effects/native-git.js';
const exec=promisify(execFile),git='/opt/homebrew/bin/git';
const input=()=>({workId:'W',sourceId:'owner-source',epoch:1,generation:1,inputDigest:'b'.repeat(64),profile:{gitBinary:git},validate(){}});
const snapshot=s=>['works','runs','budgets','effect_targets','effect_delegations','effect_operations','goal_attempts'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]);
async function world(t){
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-preview-runtime-')));await fs.mkdir(path.join(home,'state'),{mode:0o700});
 const nonce=randomUUID();await fs.writeFile(path.join(home,'fixture-owner.json'),JSON.stringify({nonce}),{mode:0o600});
 const lease=await acquireOwner(path.join(home,'state')),s=new Store(path.join(home,'state/controller.sqlite'));
 s.run('INSERT INTO sources VALUES(?,?,?,?)','owner-source',null,'{"kind":"owned-runtime-test-only"}','Retained original owner source');
 s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W',null,'owner-source',null,'W','ACTIVE',1,1,null,'{"kind":"governed-change","original":"unchanged"}');
 for(const kind of ['execution','resolution'])s.run('INSERT INTO budgets VALUES(?,?,?,?,?)','W',kind,0,0,0);
 const r=new SourceBranchPreviews(s,home),runtime=new SourceBranchPreviewRuntime(s,home,lease),f={home,nonce,s,r,runtime,lease,allowUnknown:false,storeClosed:false};
 t.after(async()=>{if(f.storeClosed)return;try{await runtime.close();}catch(error){if(!f.allowUnknown)throw error;}finally{s.close();await lease();}});
 t.diagnostic('Retained actual native ownership fixture: '+home);return f;
}
function nativeProof(row){const {admissionSourceId,...proof}=row.root;return proof;}
async function assertOwnedNativeGone(row){
 for(const commandId of await fs.readdir(row.root.runsDirectory)){
  const directory=path.join(row.root.runsDirectory,commandId),terminal=JSON.parse(await fs.readFile(path.join(directory,'terminal.json'),'utf8'));
  assert.equal(terminal.commandId,commandId);assert.equal(terminal.cleanup,'confirmed');
  if(terminal.producer==='controller-no-launch')continue;
  const result=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8')),lifecycle=JSON.parse(await fs.readFile(path.join(directory,'lifecycle.json'),'utf8'));
  assert.equal(result.identity.pid,lifecycle.pid);assert.equal(result.cleanup,'confirmed');
  const pids=[lifecycle.pid,...(result.gitPid?[result.gitPid,-result.gitPid]:[])];
  for(const pid of pids)assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
 }
}


test('inert construction and actual native gate commit exact registry namespace before first birth at zero allowance',{timeout:15000},async t=>{
 const f=await world(t),before=snapshot(f.s);assert.equal(fsSync.existsSync(path.join(f.home,'effects')),false);await f.runtime.recover();
 const attach=SourceBranchPreviews.prototype.attachRoot;let actualGate=false;
 SourceBranchPreviews.prototype.attachRoot=function(id,proof){const row=attach.call(this,id,proof);assert.deepEqual(fsSync.readdirSync(proof.runsDirectory),[]);assert.equal(f.s.one('SELECT root_source FROM source_branch_previews WHERE id=?',id).root_source,row.root_source);actualGate=true;return row;};
 let outcome;try{outcome=await f.runtime.run(input(),async tools=>{assert.equal(Object.isFrozen(tools),true);assert.deepEqual(Object.keys(tools).sort(),['buildIntegration','fetchSourceBasis','initializedProof','inspectSourceBasis','observeSourceBranchTarget','project','projectSourceSnapshot']);const proof=tools.initializedProof();assert.equal(proof.protocol,'owned-native-git-initialized/v1');const date=proof.owner.metadataDate;try{proof.owner.metadataDate='2000-01-01T00:00:00.000Z';}catch(error){assert.ok(error instanceof TypeError);}assert.equal(tools.initializedProof().owner.metadataDate,date);return{privateProposal:true};});}finally{SourceBranchPreviews.prototype.attachRoot=attach;}
 assert.equal(actualGate,true);assert.deepEqual(outcome.value,{privateProposal:true});const row=f.r.inspect(outcome.previewId);assert.equal(row.state,'SETTLED');assert.equal(row.admission.factoryProtocol,'owned-native-git-prebirth/v1');
 assert.equal((await reconcileOwnedGitProcesses(row.admission.clientRoot,0,nativeProof(row))).cleanup,'confirmed');await assertOwnedNativeGone(row);assert.deepEqual(snapshot(f.s),before);assert.equal(f.s.one('SELECT raw FROM sources WHERE id=?','owner-source').raw,'Retained original owner source');
});

test('quiesce synchronously owns and joins a tail admitted immediately before its first await',{timeout:10000},async t=>{
 const f=await world(t);await f.runtime.recover();const before=snapshot(f.s),pending=f.runtime.run(input(),async()=>{throw Error('No callback after close');});
 f.runtime.quiesce();await assert.rejects(pending,/closing/);await f.runtime.close();
 const rows=f.s.all('SELECT * FROM source_branch_previews');assert.equal(rows.length,1);assert.equal(rows[0].root_source,null);assert.equal(rows[0].state,'SETTLED');assert.equal(f.r.inspect(rows[0].id).terminal.kind,'durable-gate-never-enabled');assert.deepEqual(snapshot(f.s),before);assert.equal(fsSync.existsSync(path.join(f.home,'effects')),false);
});

test('synchronous and asynchronous guard refusals cannot admit a native preview',{timeout:10000},async t=>{
 const f=await world(t);await f.runtime.recover();const before=snapshot(f.s);
 assert.throws(()=>f.runtime.run({...input(),validate(){f.runtime.quiesce();}},async()=>{}),/closing/);
 assert.equal(f.r.active().previews.length,0);assert.deepEqual(snapshot(f.s),before);
 await f.runtime.close();const fresh=new SourceBranchPreviewRuntime(f.s,f.home,f.lease);await fresh.recover();
 assert.throws(()=>fresh.run({...input(),validate:async()=>{throw Error('Observed async refusal');}},async()=>{}),/synchronously/);await fresh.close();assert.equal(f.s.one('SELECT COUNT(*) AS n FROM source_branch_previews').n,0);
});

test('source drift after real initialization prevents late proposal but original rooted cleanup still settles',{timeout:15000},async t=>{
 const f=await world(t);await f.runtime.recover();
 await assert.rejects(f.runtime.run(input(),async()=>{f.s.run('UPDATE works SET epoch=epoch+1 WHERE id=?','W');return{mustNotEscape:true};}),/work identity changed/);
 const row=f.s.one('SELECT id,state FROM source_branch_previews');assert.equal(row.state,'SETTLED');assert.equal(f.s.one('SELECT COUNT(*) AS n FROM runs').n,0);assert.equal(f.r.active().previews.length,0);
});

test('close aborts a live prepared callback immediately and joins original real native cleanup',{timeout:15000},async t=>{
 const f=await world(t);await f.runtime.recover();let entered,observed;const ready=new Promise(resolve=>entered=resolve);
 const pending=f.runtime.run(input(),async(_tools,signal)=>{observed=signal;entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
 await ready;f.runtime.quiesce();assert.equal(observed.aborted,true);const closed=f.runtime.close();await assert.rejects(pending,/closing/);await closed;assert.equal(f.r.active().previews.length,0);
});

test('rootless/generic discovery retains original uncertainty without creating a namespace',{timeout:10000},async t=>{
 const f=await world(t),p=f.r.admit({...input(),profileDigest:'a'.repeat(64)});f.allowUnknown=true;
 await f.runtime.recover();assert.equal(f.r.inspect(p.id).state,'UNKNOWN');assert.equal(fsSync.existsSync(p.admission.clientRoot),false);await assert.rejects(f.runtime.close(),/cleanup UNKNOWN/);
});

for(const [cut,code,expected] of [['admission',71,'SETTLED'],['root-created',72,'SETTLED'],['root-before-tx',76,'SETTLED'],['root-during-tx',77,'SETTLED'],['root-proof',73,'SETTLED'],['native-birth',74,'SETTLED'],['native-terminal',75,'SETTLED'],['root-proof-missing-runs',73,'UNKNOWN'],['root-proof-linked-runs',73,'UNKNOWN'],['root-proof-replaced-root',73,'UNKNOWN'],['root-proof-writable-runs',73,'UNKNOWN'],['admission-orphan',71,'UNKNOWN'],['admission-client-git',71,'UNKNOWN'],['admission-descriptor',71,'UNKNOWN'],['admission-linked-root',71,'UNKNOWN'],['admission-unknown',71,'UNKNOWN'],['legacy-v1',78,'UNKNOWN'],['admission-state-replaced',71,'UNKNOWN']])test('actual owned process crash after '+cut+' is recovered without factory replay',{timeout:20000},async t=>{
 const f=await world(t),before=snapshot(f.s);await f.runtime.close();f.s.close();await f.lease();f.storeClosed=true;
 const worker=fileURLToPath(new URL('./source-branch-preview-runtime-worker.mjs',import.meta.url));
 let result;try{await exec(process.execPath,[worker,f.home,cut,f.nonce],{timeout:12000,maxBuffer:1024*1024});assert.fail('Owned worker did not crash');}catch(error){result=error;}
 assert.equal(result.code,code,result.stderr);const crash=JSON.parse(await fs.readFile(path.join(f.home,'crash-cut.json'),'utf8'));assert.equal(crash.nonce,f.nonce);assert.equal(crash.cut,cut);assert.throws(()=>process.kill(crash.pid,0),e=>e.code==='ESRCH');
 if(cut==='admission-state-replaced'){
  const old=path.join(f.home,'state-retained'),state=path.join(f.home,'state');await fs.rename(state,old);await fs.mkdir(state,{mode:0o700});
  for(const name of ['controller.sqlite','controller.sqlite-wal','controller.sqlite-shm'])try{await fs.rename(path.join(old,name),path.join(state,name));}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const release=await acquireOwner(path.join(f.home,'state')),s=new Store(path.join(f.home,'state/controller.sqlite')),r=new SourceBranchPreviews(s,f.home),runtime=new SourceBranchPreviewRuntime(s,f.home,release);
 try{const original=s.one('SELECT * FROM source_branch_previews');assert.equal(original.state,cut==='admission-unknown'?'UNKNOWN':'UNRESOLVED');const raw=snapshot(s);assert.deepEqual(raw,before);
  const saved=r.inspect(original.id);
  if(cut==='admission-state-replaced'){assert.equal(String((await fs.stat(path.join(f.home,'state/controller.sqlite'))).ino),saved.admission.durableGate.writer.database.inode);assert.notEqual(String((await fs.stat(path.join(f.home,'state'))).ino),saved.admission.durableGate.writer.owner.stateInode);}
  if(cut==='admission-orphan')s.run('INSERT INTO sources VALUES(?,?,?,?)',saved.admission.durableGate.rootReceiptId,null,'{}','{}');
  if(cut==='admission-client-git'||cut==='admission-descriptor'){
   await fs.mkdir(saved.admission.clientRoot,{recursive:true,mode:0o700});
   if(cut==='admission-client-git')await fs.mkdir(path.join(saved.admission.clientRoot,'client.git'),{mode:0o700});
   else {const command=path.join(saved.admission.clientRoot,'runs',randomUUID());await fs.mkdir(command,{recursive:true,mode:0o700});await fs.writeFile(path.join(command,'descriptor.json'),'{}',{mode:0o600});}
  }
  if(cut==='admission-linked-root'){await fs.mkdir(path.dirname(saved.admission.clientRoot),{recursive:true,mode:0o700});const foreign=path.join(f.home,'foreign-root');await fs.mkdir(foreign,{mode:0o700});await fs.symlink(foreign,saved.admission.clientRoot);}

  if(cut==='root-proof-missing-runs')await fs.rmdir(saved.root.runsDirectory);
  if(cut==='root-proof-linked-runs'){await fs.rmdir(saved.root.runsDirectory);const foreign=path.join(f.home,'foreign-runs');await fs.mkdir(foreign,{mode:0o700});await fs.symlink(foreign,saved.root.runsDirectory);}
  if(cut==='root-proof-replaced-root'){await fs.rename(saved.root.clientRoot,saved.root.clientRoot+'-retained');await fs.mkdir(saved.root.clientRoot,{mode:0o700});await fs.mkdir(saved.root.runsDirectory,{mode:0o700});}
  if(cut==='root-proof-writable-runs')await fs.chmod(saved.root.runsDirectory,0o777);
  await runtime.recover();const row=r.inspect(original.id);assert.equal(row.state,expected);assert.deepEqual(snapshot(s),before);
  if(expected==='SETTLED'){if(row.root)assert.equal((await reconcileOwnedGitProcesses(row.admission.clientRoot,0,nativeProof(row))).cleanup,'confirmed');else {assert.equal(row.terminal.kind,'durable-gate-never-enabled');assert.equal(row.terminal.boundary,'former-owner-inactive');assert.equal(row.terminal.evidence.owner.result,'ESRCH');assert.equal(row.terminal.evidence.owner.formerPid,crash.pid);assert.equal(row.terminal.evidence.currentWriter.owner.pid,process.pid);assert.deepEqual(row.terminal.evidence.currentWriter.database,row.admission.durableGate.writer.database);assert.equal(s.one('SELECT id FROM sources WHERE id=?',row.admission.durableGate.rootReceiptId),undefined);}
   if(cut==='native-birth'){
    assert.equal(crash.native.controlledSelectedProducer,true);const gateReader=JSON.parse(await fs.readFile(path.join(f.home,'gate-reader.json'),'utf8'));assert.equal(gateReader.root_source,row.root_source);assert.equal(gateReader.admission_source,row.admission_source);const directory=path.join(row.root.runsDirectory,crash.native.commandId),result=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8')),terminal=JSON.parse(await fs.readFile(path.join(directory,'terminal.json'),'utf8'));
    assert.equal(result.identity.pid,crash.native.supervisorPid);assert.equal(result.gitStarted,true);assert.equal(result.gitPid,crash.native.selectedPid);assert.equal(result.aborted,true);assert.equal(result.cleanup,'confirmed');assert.equal(terminal.commandId,crash.native.commandId);assert.equal(terminal.cleanup,'confirmed');
    for(const pid of [crash.native.supervisorPid,crash.native.selectedPid,-crash.native.selectedPid])assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
   }
   if(row.root)await assertOwnedNativeGone(row);await runtime.close();}
  else{await assert.rejects(runtime.close(),/cleanup UNKNOWN/);assert.equal(row.terminal_source,null);
   const codes={'admission-orphan':'orphan-root-receipt','admission-client-git':'observed-native-entry','admission-descriptor':'observed-native-entry','admission-linked-root':'unsafe-namespace','admission-state-replaced':'owner-or-database-changed'};
   if(codes[cut]){const cause=s.one("SELECT raw FROM sources WHERE json_extract(origin,'$.previewId')=? AND json_extract(origin,'$.purpose')='unknown' ORDER BY rowid DESC LIMIT 1",row.id);assert.ok(JSON.parse(cause.raw).reason.startsWith('durable-gate/'+codes[cut]+':'));}
  }
  assert.equal(s.one('SELECT COUNT(*) AS n FROM source_branch_previews').n,1);
 }finally{s.close();await release();}
});


test('actual pre-root trust failure settles only through the qualified durable unopened gate',{timeout:10000},async t=>{
 const f=await world(t);await f.runtime.recover();const before=snapshot(f.s);
 await assert.rejects(f.runtime.run({...input(),profile:{gitBinary:path.join(f.home,'missing-git')}},async()=>assert.fail('No proposal before initialization')),error=>!String(error).includes('cleanup UNKNOWN'));
 const row=f.r.inspect(f.s.one('SELECT id FROM source_branch_previews').id);assert.equal(row.state,'SETTLED');assert.equal(row.terminal.kind,'durable-gate-never-enabled');assert.equal(row.root_source,null);assert.equal(fsSync.existsSync(row.admission.clientRoot),false);assert.deepEqual(snapshot(f.s),before);await f.runtime.close();
});

test('projection state change after root COMMIT prevents first descriptor while original cleanup still settles',{timeout:15000},async t=>{
 const f=await world(t);await f.runtime.recover();const attach=SourceBranchPreviews.prototype.attachRoot;
 SourceBranchPreviews.prototype.attachRoot=function(...args){const row=attach.apply(this,args);this.markUnknown(row.id,'Controlled concurrent ownership-state fault');return row;};
 try{await assert.rejects(f.runtime.run(input(),async()=>assert.fail('No callback after ownership drift')),/ownership changed/);}finally{SourceBranchPreviews.prototype.attachRoot=attach;}
 const row=f.r.inspect(f.s.one('SELECT id FROM source_branch_previews').id);assert.equal(row.state,'SETTLED');assert.deepEqual(await fs.readdir(row.root.runsDirectory),[]);assert.equal(row.terminal.kind,'joined-owned-native');
});

test('reentrant owner release from final source guard cannot launch or write stale cleanup metadata',{timeout:15000},async t=>{
 const f=await world(t);await f.runtime.recover();f.allowUnknown=true;let released,revoked=false;
 const request={...input(),validate(){const row=f.s.one('SELECT root_source FROM source_branch_previews');if(row?.root_source&&!revoked){revoked=true;released=f.lease();}}};
 await assert.rejects(f.runtime.run(request,async()=>assert.fail('Revoked owner cannot prepare')),error=>error.code==='OWNER_BUSY');await released;
 const row=f.r.inspect(f.s.one('SELECT id FROM source_branch_previews').id);assert.equal(revoked,true);assert.equal(row.state,'UNRESOLVED');assert.equal(row.terminal_source,null);assert.deepEqual(await fs.readdir(row.root.runsDirectory),[]);assert.equal(f.s.one("SELECT COUNT(*) AS n FROM sources WHERE json_extract(origin,'$.purpose') IN ('unknown','terminal')").n,0);await assert.rejects(f.runtime.close(),/cleanup UNKNOWN/);
});

// Trusted admission observation reports this exact original without changing failure semantics.
test('onAdmitted observes the durable original only after tail registration and callback failure retains exact error',{timeout:15000},async t=>{
 const f=await world(t);await f.runtime.recover();const failure=Error('EXACT_ADMISSION_OBSERVER_FAILURE');let id;
 await assert.rejects(f.runtime.run(input(),async()=>assert.fail('No preparation after observer throw'),value=>{
  id=value;assert.equal(f.runtime.active.has(id),true);const row=f.r.inspect(id);assert.equal(row.state,'UNRESOLVED');assert.equal(row.root_source,null);throw failure;
 }),error=>error===failure);
 const row=f.r.inspect(id);assert.equal(row.state,'SETTLED');assert.equal(row.terminal.kind,'durable-gate-never-enabled');assert.equal(fsSync.existsSync(row.admission.clientRoot),false);
});
test('onAdmitted asynchronous return refuses before first native birth with observed rejection',{timeout:15000},async t=>{
 const f=await world(t);await f.runtime.recover();let id;
 await assert.rejects(f.runtime.run(input(),async()=>assert.fail('No async observer admission'),value=>{id=value;return Promise.reject(Error('OBSERVED_ASYNC_ADMISSION'));}),/synchronous/);
 const row=f.r.inspect(id);assert.equal(row.terminal.kind,'durable-gate-never-enabled');assert.equal(fsSync.existsSync(row.admission.clientRoot),false);
});
test('onAdmitted may synchronously quiesce/close without a self-await or late native birth',{timeout:15000},async t=>{
 const f=await world(t);await f.runtime.recover();let id,closing;
 await assert.rejects(f.runtime.run(input(),async()=>assert.fail('No native after close'),value=>{id=value;closing=f.runtime.close();void closing.catch(()=>{});}),/closing/);
 await closing;const row=f.r.inspect(id);assert.equal(row.terminal.kind,'durable-gate-never-enabled');assert.equal(fsSync.existsSync(row.admission.clientRoot),false);
});
test('onAdmitted exact original survives native initialization refusal and a settled unsupported preparation',{timeout:15000},async t=>{
 const f=await world(t);await f.runtime.recover();let failed;
 await assert.rejects(f.runtime.run({...input(),profile:{gitBinary:path.join(f.home,'missing')}},async()=>assert.fail('No initializer'),id=>{failed=id;}));
 assert.equal(f.r.inspect(failed).terminal.kind,'durable-gate-never-enabled');let observed;
 const result=await f.runtime.run(input(),async()=>({kind:'unsupported-scope',reason:'Controlled private computation hold'}),id=>{observed=id;});
 assert.equal(result.previewId,observed);assert.equal(result.value.kind,'unsupported-scope');const row=f.r.inspect(observed);assert.equal(row.terminal.kind,'joined-owned-native');await assertOwnedNativeGone(row);
});
