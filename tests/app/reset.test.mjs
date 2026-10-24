import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {prepareApplicationReset,applyApplicationReset,recoverApplicationReset} from '../../dist/app/reset.js';
import {listResetBackups,deleteResetBackup,recoverResetBackupDeletion} from '../../dist/app/reset-backups.js';
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-'))),home=path.join(root,'app'),project=path.join(root,'project');
 await fs.mkdir(project);await fs.writeFile(path.join(project,'source.txt'),'retain source');
 const c=await openController({installationHome:home});await c.registerProject({id:'P',sourceRoot:project});const cid=c.createConversation().conversationId;await c.close();
 await fs.mkdir(path.join(home,'config'),{mode:0o700});await fs.writeFile(path.join(home,'config','settings.json'),'{"sample":true}',{mode:0o600});
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset fixture '+root);});return {root,home,project,cid,pass(){passed=true;}};
}
for(const scope of ['settings','all'])test('reset '+scope+' preserves source and exact original backup then reopens',async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.home,'config/settings.json')),preview=await prepareApplicationReset(f.home,scope);
 const result=await applyApplicationReset(f.home,scope,preview.fingerprint);
 assert.deepEqual(await fs.readFile(path.join(result.backup,'config/settings.json')),before);
 assert.equal(await fs.readFile(path.join(f.project,'source.txt'),'utf8'),'retain source');
 await assert.rejects(fs.stat(path.join(f.home,'config/settings.json')),{code:'ENOENT'});
 const reopened=await openController({installationHome:f.home});try{assert.equal(reopened.listProjects().length,scope==='all'?0:1);if(scope==='settings')assert.equal(reopened.inspectConversation(f.cid).conversationId,f.cid);}finally{await reopened.close();}f.pass();
});
test('namespace consent includes current nested contents without comparing their bytes',async t=>{
 const f=await fixture(t),p=await prepareApplicationReset(f.home,'settings');
 assert.equal(Object.hasOwn(p,'entries'),false);assert.equal(Object.hasOwn(p,'bytes'),false);assert.match(p.backupScope,/contents/i);assert.deepEqual(p.paths,['config']);
 await fs.writeFile(path.join(f.home,'config/settings.json'),'new owner value');
 const result=await applyApplicationReset(f.home,'settings',p.fingerprint);assert.equal(await fs.readFile(path.join(result.backup,'config/settings.json'),'utf8'),'new owner value');f.pass();
});
test('replaced selected root refuses stale namespace consent',async t=>{
 const f=await fixture(t),p=await prepareApplicationReset(f.home,'settings');await fs.rename(path.join(f.home,'config'),path.join(f.root,'original-config'));await fs.mkdir(path.join(f.home,'config'),{mode:0o700});await fs.writeFile(path.join(f.home,'config/new-settings'),'retain replacement');
 await assert.rejects(applyApplicationReset(f.home,'settings',p.fingerprint),/preview changed/);assert.equal(await fs.readFile(path.join(f.home,'config/new-settings'),'utf8'),'retain replacement');f.pass();
});
test('changed selected path set refuses stale all-data consent',async t=>{
 const f=await fixture(t),p=await prepareApplicationReset(f.home,'all');await fs.writeFile(path.join(f.home,'state/new-retained-record'),'new state',{mode:0o600});
 await assert.rejects(applyApplicationReset(f.home,'all',p.fingerprint),/preview changed/);assert.equal(await fs.readFile(path.join(f.home,'state/new-retained-record'),'utf8'),'new state');f.pass();
});
test('selected root symlink refuses without following or changing its target',async t=>{
 const f=await fixture(t);await fs.rename(path.join(f.home,'config'),path.join(f.root,'saved-config'));await fs.symlink(f.project,path.join(f.home,'config'));
 await assert.rejects(prepareApplicationReset(f.home,'settings'),/owned regular file or directory root/);assert.equal(await fs.readlink(path.join(f.home,'config')),f.project);assert.equal(await fs.readFile(path.join(f.project,'source.txt'),'utf8'),'retain source');f.pass();
});
test('live owner refuses reset and preserves active data',async t=>{
 const f=await fixture(t),c=await openController({installationHome:f.home});try{await assert.rejects(prepareApplicationReset(f.home,'all'),/live or unresolved/);assert.equal(c.inspectConversation(f.cid).conversationId,f.cid);}finally{await c.close();}f.pass();
});
test('foreign and linked homes refuse without touching contents',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-foreign-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'state'));await fs.writeFile(path.join(root,'sentinel'),'foreign');await assert.rejects(prepareApplicationReset(root,'all'));assert.equal(await fs.readFile(path.join(root,'sentinel'),'utf8'),'foreign');
 const f=await fixture(t),link=path.join(root,'link');await fs.symlink(f.home,link);await assert.rejects(prepareApplicationReset(link,'all'),/canonical private/);assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'{"sample":true}');f.pass();
});

for(const scope of ['settings','all'])test('unresolved cleanup blocks '+scope+' preview and previously confirmed apply',async t=>{
 const f=await fixture(t),preview=await prepareApplicationReset(f.home,scope),journal=path.join(f.home,'state/runtime/unknown.json');
 const config=await fs.readFile(path.join(f.home,'config/settings.json'));
 await fs.writeFile(journal,JSON.stringify({state:'quarantined',nativeCleanupUnknown:{reason:'retained native process'},nonce:'original',workId:'work',runId:'run'}),{mode:0o600});
 await assert.rejects(prepareApplicationReset(f.home,scope),/runtime journal/);
 await assert.rejects(applyApplicationReset(f.home,scope,preview.fingerprint),/runtime journal/);
 assert.deepEqual(await fs.readFile(path.join(f.home,'config/settings.json')),config);
 assert.equal(JSON.parse(await fs.readFile(journal)).state,'quarantined');
 await assert.rejects(fs.stat(path.join(f.home,'reset-backups')),{code:'ENOENT'});f.pass();
});
test('interrupted confirmed reset blocks startup then recovers original backup',async t=>{
 const f=await fixture(t),preview=await prepareApplicationReset(f.home,'all'),rename=fs.rename;let calls=0;
 fs.rename=async(...args)=>{if(String(args[1]).includes('reset-backups')&&!String(args[1]).endsWith('.json')&&++calls===2)throw Error('Fixture interrupted rename');return rename(...args);};
 try{await assert.rejects(applyApplicationReset(f.home,'all',preview.fingerprint),/Fixture interrupted/);}finally{fs.rename=rename;}
 await assert.rejects(openController({installationHome:f.home}),/reset is interrupted/);
 const result=await recoverApplicationReset(f.home);assert.equal(result.reset,true);assert.equal(await fs.readFile(path.join(result.backup,'config/settings.json'),'utf8'),'{"sample":true}');
 const c=await openController({installationHome:f.home});try{assert.equal(c.listProjects().length,0);}finally{await c.close();}f.pass();
});

test('standalone reset and explicit preview retain their distinct CLI entries',async()=>{
 const {parseInvocation}=await import('../../dist/cli/arguments.js');
 for(const args of [['reset'],['reset','--scope','all'],['reset','preview','--scope','settings']]){
  const parsed=parseInvocation(args);assert.equal(parsed.command,args[1]==='preview'?'reset preview':'reset');
  if(args.includes('--scope'))assert.equal(parsed.options.get('scope'),args.at(-1));
 }
});

// Version 1 is a persisted recovery protocol; construct its exact original field order.
async function legacyInventory(home,roots){
 const {createHash}=await import('node:crypto'),rows=[];
 async function visit(relative){const file=path.join(home,relative),s=await fs.lstat(file),kind=s.isDirectory()?'directory':s.isSymbolicLink()?'symlink':'file';
  rows.push({path:relative,dev:s.dev,ino:s.ino,size:kind==='directory'?0:s.size,mtime:kind==='directory'?0:s.mtimeMs,kind,...kind==='symlink'?{target:await fs.readlink(file)}:{},...kind==='file'?{sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')}:{}});
  if(kind==='directory')for(const leaf of (await fs.readdir(file)).sort())await visit(path.join(relative,leaf));
 }
 for(const root of roots)await visit(root);return rows;
}
test('legacy version 1 interrupted reset remains recoverable',async t=>{
 const {createHash,randomUUID}=await import('node:crypto'),f=await fixture(t),scope='settings',paths=['config'],inventory=await legacyInventory(f.home,paths),backup=randomUUID();
 const fingerprint=createHash('sha256').update(JSON.stringify({home:f.home,scope,paths,rows:inventory})).digest('hex');
 await fs.mkdir(path.join(f.home,'reset-backups',backup),{recursive:true,mode:0o700});
 await fs.writeFile(path.join(f.home,'reset-pending.json'),JSON.stringify({format:1,home:f.home,scope,paths,inventory,fingerprint,backup}),{mode:0o600});
 await fs.rename(path.join(f.home,'config'),path.join(f.home,'reset-backups',backup,'config'));
 const result=await recoverApplicationReset(f.home);assert.equal(result.backup,path.join(f.home,'reset-backups',backup));
 assert.equal(await fs.readFile(path.join(result.backup,'config/settings.json'),'utf8'),'{"sample":true}');f.pass();
});
// Version 2 retained per-root complete-tree commitments; only old transactions use them.
async function compactLegacyPlan(f){
 const {createHash,randomUUID}=await import('node:crypto'),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const scope='settings',paths=['config'],inventory=await legacyInventory(f.home,paths),fingerprint=hash({home:f.home,scope,paths,rows:inventory}),backup=randomUUID();
 const body={format:2,home:f.home,scope,paths,roots:paths.map(relative=>({path:relative,sha256:hash(inventory.filter(row=>row.path===relative||row.path.startsWith(relative+path.sep)))})),fingerprint,backup};
 const pending={...body,manifestDigest:hash(body)};await fs.mkdir(path.join(f.home,'reset-backups',backup),{recursive:true,mode:0o700});await fs.writeFile(path.join(f.home,'reset-pending.json'),JSON.stringify(pending),{mode:0o600});await fs.rename(path.join(f.home,'config'),path.join(f.home,'reset-backups',backup,'config'));return pending;
}
test('legacy version 2 interrupted reset remains recoverable',async t=>{
 const f=await fixture(t),pending=await compactLegacyPlan(f),result=await recoverApplicationReset(f.home);assert.equal(result.backup,path.join(f.home,'reset-backups',pending.backup));assert.equal(await fs.readFile(path.join(result.backup,'config/settings.json'),'utf8'),'{"sample":true}');f.pass();
});
test('legacy version 2 recovery still rejects changed backed-up bytes',async t=>{
 const f=await fixture(t),pending=await compactLegacyPlan(f);await fs.writeFile(path.join(f.home,'reset-backups',pending.backup,'config/settings.json'),'changed backup bytes');
 await assert.rejects(recoverApplicationReset(f.home),/backup differs/);await fs.access(path.join(f.home,'reset-pending.json'));f.pass();
});
test('new namespace preview, apply and interrupted recovery never traverse opaque payload trees',async t=>{
 const f=await fixture(t),opaque=path.join(f.home,'artifacts/opaque/deep');await fs.mkdir(opaque,{recursive:true,mode:0o700});await fs.mkdir(path.join(f.home,'state/opaque/deep'),{recursive:true,mode:0o700});await fs.writeFile(path.join(f.home,'state/opaque/deep/payload'),'retained state subtree');await fs.writeFile(path.join(opaque,'payload'),'retained current contents');await fs.symlink(f.project,path.join(opaque,'project-link'));
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');await promisify(execFile)('/usr/bin/mkfifo',[path.join(opaque,'retained-pipe')]);
 const originals=Object.fromEntries(['readdir','readFile','open','lstat'].map(name=>[name,fs[name]])),rename=fs.rename,attempts=[];
 const payloadPath=value=>{const relative=path.relative(f.home,String(value));return /^(?:reset-backups\/[^/]+\/)?(?:config|artifacts|inputs|state\/opaque)(?:\/|$)/.test(relative);};
 for(const name of Object.keys(originals))fs[name]=async function(file,...args){
  if(payloadPath(file)&&(name!=='lstat'||!['config','artifacts','inputs','state/opaque'].includes(path.relative(f.home,String(file)).replace(/^reset-backups\/[^/]+\//,'')))){attempts.push([name,String(file)]);throw Error('Payload traversal forbidden: '+name+' '+file);}
  return originals[name](file,...args);
 };
 let result;
 try{
  const preview=await prepareApplicationReset(f.home,'all');assert.equal(Object.hasOwn(preview,'entries'),false);assert.equal(Object.hasOwn(preview,'bytes'),false);
  fs.rename=async(...args)=>{if(args[0]===path.join(f.home,'inputs'))throw Error('Fixture interrupted before inputs root');return rename(...args);};
  await assert.rejects(applyApplicationReset(f.home,'all',preview.fingerprint),/Fixture interrupted/);fs.rename=rename;
  const pending=JSON.parse(await fs.readFile(path.join(f.home,'reset-pending.json')));assert.equal(pending.format,4);assert.equal(Object.hasOwn(pending,'inventory'),false);assert.equal(Object.hasOwn(pending,'manifestDigest'),true);assert.ok(pending.roots.every(root=>root.identity&&['file','directory'].includes(root.identity.kind)));assert.ok(Buffer.byteLength(JSON.stringify(pending))<16384);
  result=await recoverApplicationReset(f.home);assert.deepEqual(attempts,[]);
 }finally{fs.rename=rename;for(const [name,original]of Object.entries(originals))fs[name]=original;}
 assert.equal(await fs.readFile(path.join(result.backup,'state/opaque/deep/payload'),'utf8'),'retained state subtree');assert.equal(await fs.readFile(path.join(result.backup,'artifacts/opaque/deep/payload'),'utf8'),'retained current contents');assert.equal(await fs.readlink(path.join(result.backup,'artifacts/opaque/deep/project-link')),f.project);assert.equal((await fs.lstat(path.join(result.backup,'artifacts/opaque/deep/retained-pipe'))).isFIFO(),true);assert.equal(await fs.readFile(path.join(f.project,'source.txt'),'utf8'),'retain source');f.pass();
});
async function interruptBeforeInputs(f){
 const preview=await prepareApplicationReset(f.home,'all'),rename=fs.rename;
 fs.rename=async(...args)=>{if(args[0]===path.join(f.home,'inputs'))throw Error('Fixture interrupted before inputs root');return rename(...args);};
 try{await assert.rejects(applyApplicationReset(f.home,'all',preview.fingerprint),/Fixture interrupted/);}finally{fs.rename=rename;}
 return JSON.parse(await fs.readFile(path.join(f.home,'reset-pending.json')));
}
test('namespace recovery refuses new selected state paths after interruption',async t=>{
 const f=await fixture(t);await interruptBeforeInputs(f);await fs.writeFile(path.join(f.home,'state/new-state-record'),'retain unexpected state',{mode:0o600});
 await assert.rejects(recoverApplicationReset(f.home),/root selection changed/);await fs.access(path.join(f.home,'reset-pending.json'));await fs.access(path.join(f.home,'inputs'));assert.equal(await fs.readFile(path.join(f.home,'state/new-state-record'),'utf8'),'retain unexpected state');f.pass();
});
test('namespace recovery refuses source and backup roots both present',async t=>{
 const f=await fixture(t),pending=await interruptBeforeInputs(f);await fs.mkdir(path.join(f.home,'config'),{mode:0o700});await fs.writeFile(path.join(f.home,'config/new-settings'),'retain new active data');
 await assert.rejects(recoverApplicationReset(f.home),/source and backup both exist/);await fs.access(path.join(f.home,'reset-pending.json'));await fs.access(path.join(f.home,'inputs'));assert.equal(await fs.readFile(path.join(f.home,'config/new-settings'),'utf8'),'retain new active data');assert.equal(await fs.readFile(path.join(f.home,'reset-backups',pending.backup,'config/settings.json'),'utf8'),'{"sample":true}');f.pass();
});
test('namespace recovery refuses a replaced stable state anchor',async t=>{
 const f=await fixture(t);await interruptBeforeInputs(f);await fs.rename(path.join(f.home,'state'),path.join(f.root,'original-state'));await fs.mkdir(path.join(f.home,'state'),{mode:0o700});
 await assert.rejects(recoverApplicationReset(f.home),/home or state directory changed/);await fs.access(path.join(f.home,'reset-pending.json'));await fs.access(path.join(f.home,'inputs'));f.pass();
});
test('namespace recovery refuses a replaced backup root before continuing moves',async t=>{
 const f=await fixture(t),pending=await interruptBeforeInputs(f),backupConfig=path.join(f.home,'reset-backups',pending.backup,'config');await fs.rename(backupConfig,path.join(f.root,'original-backed-up-config'));await fs.mkdir(backupConfig,{mode:0o700});
 await assert.rejects(recoverApplicationReset(f.home),/backup root differs/);await fs.access(path.join(f.home,'inputs'));await fs.access(path.join(f.home,'reset-pending.json'));assert.equal(await fs.readFile(path.join(f.root,'original-backed-up-config/settings.json'),'utf8'),'{"sample":true}');f.pass();
});
test('namespace recovery refuses changed manifest commitment',async t=>{
 const f=await fixture(t),preview=await prepareApplicationReset(f.home,'all'),rename=fs.rename;let calls=0;
 fs.rename=async(...args)=>{if(String(args[1]).includes('reset-backups')&&!String(args[1]).endsWith('.json')&&++calls===2)throw Error('Fixture interrupted rename');return rename(...args);};
 try{await assert.rejects(applyApplicationReset(f.home,'all',preview.fingerprint),/Fixture interrupted/);}finally{fs.rename=rename;}
 const file=path.join(f.home,'reset-pending.json'),pending=JSON.parse(await fs.readFile(file));assert.equal(pending.format,4);pending.fingerprint='0'.repeat(64);await fs.writeFile(file,JSON.stringify(pending));
 await assert.rejects(recoverApplicationReset(f.home),/Invalid reset recovery manifest/);await fs.access(file);f.pass();
});

test('a backup confirmation cannot authorize permanent deletion',async t=>{
 const f=await fixture(t),preview=await prepareApplicationReset(f.home,'all');
 const permanent=await prepareApplicationReset(f.home,'all','delete');assert.notEqual(permanent.fingerprint,preview.fingerprint);assert.equal(permanent.backupDirectory,null);
 await assert.rejects(applyApplicationReset(f.home,'all',preview.fingerprint,'delete'),/preview changed/);
 assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'{"sample":true}');f.pass();
});
for(const scope of ['settings','all'])test('explicit permanent reset '+scope+' deletes selected data without a retained backup',async t=>{
 const f=await fixture(t);await fs.symlink(f.project,path.join(f.home,'artifacts','external-project-link'));const preview=await prepareApplicationReset(f.home,scope,'delete');
 const result=await applyApplicationReset(f.home,scope,preview.fingerprint,'delete');assert.equal(result.backup,null);assert.equal(result.disposition,'delete');
 await assert.rejects(fs.stat(path.join(f.home,'config')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(f.home,'reset-backups')),{code:'ENOENT'});
 assert.deepEqual(await fs.readdir(path.join(f.home,'reset-deletions')),[]);assert.equal(await fs.readFile(path.join(f.project,'source.txt'),'utf8'),'retain source');
 const c=await openController({installationHome:f.home});try{assert.equal(c.listProjects().length,scope==='all'?0:1);}finally{await c.close();}f.pass();
});
for(const failure of ['partial','already-removed'])test('permanent reset recovers '+failure+' removal from durable delete intent',async t=>{
 const f=await fixture(t),preview=await prepareApplicationReset(f.home,'settings','delete'),remove=fs.rm;
 fs.rm=async(file,...args)=>{if(String(file).startsWith(path.join(f.home,'reset-deletions')+path.sep)){
  await remove(failure==='partial'?path.join(String(file),'config'):file,{recursive:true});throw Error('Controlled deletion interruption');
 }return remove(file,...args);};
 try{await assert.rejects(applyApplicationReset(f.home,'settings',preview.fingerprint,'delete'),/Controlled deletion/);}finally{fs.rm=remove;}
 const pending=JSON.parse(await fs.readFile(path.join(f.home,'reset-pending.json')));assert.equal(pending.phase,'deleting');assert.equal(pending.disposition,'delete');
 await assert.rejects(openController({installationHome:f.home}),/reset is interrupted/);const result=await recoverApplicationReset(f.home);assert.equal(result.backup,null);assert.equal(result.reset,true);f.pass();
});
test('legacy root-only format 3 recovery always retains a backup',async t=>{
 const f=await fixture(t),preview=await prepareApplicationReset(f.home,'all'),rename=fs.rename;
 fs.rename=async(...args)=>{if(args[0]===path.join(f.home,'inputs'))throw Error('Controlled pre-input interruption');return rename(...args);};
 try{await assert.rejects(applyApplicationReset(f.home,'all',preview.fingerprint),/Controlled pre-input/);}finally{fs.rename=rename;}
 const {createHash}=await import('node:crypto'),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const file=path.join(f.home,'reset-pending.json'),p=JSON.parse(await fs.readFile(file));p.format=3;delete p.disposition;delete p.phase;delete p.stagingIdentity;delete p.manifestDigest;
 p.fingerprint=hash({home:p.home,scope:p.scope,paths:p.paths,roots:p.roots,anchors:p.anchors});p.manifestDigest=hash(p);await fs.writeFile(file,JSON.stringify(p));
 const result=await recoverApplicationReset(f.home);assert.equal(result.backup,path.join(f.home,'reset-backups',p.backup));assert.equal(await fs.readFile(path.join(result.backup,'config/settings.json'),'utf8'),'{"sample":true}');f.pass();
});

async function savedBackup(f){const p=await prepareApplicationReset(f.home,'settings');await applyApplicationReset(f.home,'settings',p.fingerprint);const listed=await listResetBackups(f.home);assert.equal(listed.backups.length,1);return listed.backups[0];}
test('saved backup deletion binds its exact reviewed identity and preserves current data',async t=>{
 const f=await fixture(t),backup=await savedBackup(f);await fs.mkdir(path.join(f.home,'config'),{mode:0o700});await fs.writeFile(path.join(f.home,'config/new'),'new active settings');
 await assert.rejects(deleteResetBackup(f.home,backup.backupId,'0'.repeat(64)),/changed/);await assert.rejects(deleteResetBackup(f.home,'../config',backup.fingerprint),/exact retained/);
 const result=await deleteResetBackup(f.home,backup.backupId,backup.fingerprint);assert.equal(result.deleted,true);assert.deepEqual((await listResetBackups(f.home)).backups,[]);
 assert.equal(await fs.readFile(path.join(f.home,'config/new'),'utf8'),'new active settings');assert.equal(await fs.readFile(path.join(f.project,'source.txt'),'utf8'),'retain source');f.pass();
});
test('interrupted saved backup deletion recovers without requiring its partially removed receipt',async t=>{
 const f=await fixture(t),backup=await savedBackup(f),remove=fs.rm;
 fs.rm=async(file,...args)=>{if(String(file).startsWith(path.join(f.home,'reset-deletions')+path.sep)){
  await fs.unlink(path.join(String(file),'reset-receipt.json'));throw Error('Controlled partial backup removal');
 }return remove(file,...args);};
 try{await assert.rejects(deleteResetBackup(f.home,backup.backupId,backup.fingerprint),/Controlled partial/);}finally{fs.rm=remove;}
 const c=await openController({installationHome:f.home});await c.close();
 await assert.rejects(prepareApplicationReset(f.home,'all'),/Backup deletion interrupted/);
 assert.equal((await recoverResetBackupDeletion(f.home)).deleted,true);assert.deepEqual((await listResetBackups(f.home)).backups,[]);f.pass();
});
test('saved backup recreation during removal retains intent and never deletes the new backup',async t=>{
 const f=await fixture(t),backup=await savedBackup(f),remove=fs.rm,source=path.join(f.home,'reset-backups',backup.backupId);
 fs.rm=async(file,...args)=>{const result=await remove(file,...args);if(String(file).startsWith(path.join(f.home,'reset-deletions')+path.sep)){await fs.mkdir(source,{mode:0o700});await fs.writeFile(path.join(source,'new-owner-data'),'preserve');}return result;};
 try{await assert.rejects(deleteResetBackup(f.home,backup.backupId,backup.fingerprint),/original name appeared/);}finally{fs.rm=remove;}
 await fs.access(path.join(f.home,'reset-backup-delete-pending.json'));assert.equal(await fs.readFile(path.join(source,'new-owner-data'),'utf8'),'preserve');f.pass();
});
test('saved backup moving-phase recovery refuses a changed reviewed receipt',async t=>{
 const f=await fixture(t),backup=await savedBackup(f),rename=fs.rename;
 fs.rename=async(...args)=>{const result=await rename(...args);if(String(args[1]).startsWith(path.join(f.home,'reset-deletions')+path.sep))throw Error('Controlled after backup rename');return result;};
 try{await assert.rejects(deleteResetBackup(f.home,backup.backupId,backup.fingerprint),/Controlled after/);}finally{fs.rename=rename;}
 const pending=JSON.parse(await fs.readFile(path.join(f.home,'reset-backup-delete-pending.json')));assert.equal(pending.phase,'moving');const receipt=path.join(f.home,'reset-deletions',pending.transactionId,'reset-receipt.json');await fs.appendFile(receipt,'\n');
 await assert.rejects(recoverResetBackupDeletion(f.home),/receipt changed/);await fs.access(receipt);await fs.access(path.join(f.home,'reset-backup-delete-pending.json'));f.pass();
});
for(const subject of ['active-reset','saved-backup'])test(subject+' delete recovery refuses a replacement staging directory',async t=>{
 const f=await fixture(t),backup=subject==='saved-backup'?await savedBackup(f):null;
 const preview=backup?null:await prepareApplicationReset(f.home,'settings','delete'),remove=fs.rm;
 fs.rm=async(file,...args)=>{if(String(file).startsWith(path.join(f.home,'reset-deletions')+path.sep))throw Error('Controlled before removal');return remove(file,...args);};
 try{await assert.rejects(backup?deleteResetBackup(f.home,backup.backupId,backup.fingerprint):applyApplicationReset(f.home,'settings',preview.fingerprint,'delete'),/Controlled before/);}finally{fs.rm=remove;}
 const journal=path.join(f.home,backup?'reset-backup-delete-pending.json':'reset-pending.json'),pending=JSON.parse(await fs.readFile(journal));
 const stage=path.join(f.home,'reset-deletions',backup?pending.transactionId:pending.backup);await fs.rename(stage,path.join(f.root,'original-deletion-stage'));await fs.mkdir(stage,{mode:0o700});await fs.writeFile(path.join(stage,'new-owner-data'),'preserve');
 await assert.rejects(backup?recoverResetBackupDeletion(f.home):recoverApplicationReset(f.home),/staging changed/);assert.equal(await fs.readFile(path.join(stage,'new-owner-data'),'utf8'),'preserve');await fs.access(journal);f.pass();
});
