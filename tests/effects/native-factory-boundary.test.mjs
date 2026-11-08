import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {openNativeGit,reconcileOwnedGitProcesses} from '../../dist/effects/index.js';
const exec=promisify(execFile),git='/opt/homebrew/bin/git';
async function world(){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-native-factory-')));return{root,clientRoot:path.join(root,'client')};}
function lifecycle(w,options={}){return{exclusiveRoot:true,assertCurrent:options.assertCurrent??(()=>{}),beforeFirstCommand(proof){w.proof=structuredClone(proof);assert.equal(Object.isFrozen(proof),true);assert.deepEqual(fsSync.readdirSync(proof.runsDirectory),[]);assert.equal(fsSync.existsSync(path.join(w.clientRoot,'client.git')),false);assert.equal(proof.clientRoot,w.clientRoot);assert.equal(proof.runsDirectory,path.join(w.clientRoot,'runs'));return options.beforeFirstCommand?.(proof);}};}
async function descriptors(w){const rows=[];for(const id of await fs.readdir(path.join(w.clientRoot,'runs'))){try{rows.push({id,data:JSON.parse(await fs.readFile(path.join(w.clientRoot,'runs',id,'descriptor.json'),'utf8')),lifecycle:fsSync.existsSync(path.join(w.clientRoot,'runs',id,'lifecycle.json'))});}catch(e){if(e.code!=='ENOENT')throw e;}}return rows;}
async function pausedPreparation(w,action){let ready,release;const entered=new Promise(r=>ready=r),gate=new Promise(r=>release=r),original=fs.open;let paused=false;
 fs.open=async(...args)=>{const handle=await original(...args);if(w.proof&&!paused&&args[0]===w.proof.runsDirectory){paused=true;return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{await target.sync();ready();await gate;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}return handle;};
 try{const pending=action();await Promise.race([entered,pending.then(()=>{throw Error('original admission completed before gate');},e=>{throw e;}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('finite native preparation gate timeout')),5000);timer.unref();})]);return{pending,release,restore(){fs.open=original;}};}catch(e){release();fs.open=original;throw e;}
}

test('factory commits actual root/runs proof before original first native command and rejects gated resume',async t=>{
 const w=await world(),client=await openNativeGit({gitBinary:git,ownedClientRoot:w.clientRoot},undefined,lifecycle(w,{beforeFirstCommand(proof){fsSync.writeFileSync(path.join(w.root,'committed-root-proof.json'),JSON.stringify(proof),{flag:'wx',mode:0o600});}}));
 try{assert.ok((await descriptors(w)).length>=2);assert.deepEqual(JSON.parse(await fs.readFile(path.join(w.root,'committed-root-proof.json'),'utf8')),w.proof);}finally{await client.close();}
 assert.equal((await reconcileOwnedGitProcesses(w.clientRoot,0,w.proof)).cleanup,'confirmed');
 await assert.rejects(openNativeGit({gitBinary:git,ownedClientRoot:w.clientRoot,resumeOwned:true},undefined,lifecycle(w)),/Fresh trusted/);
 t.diagnostic(JSON.stringify({fixture:w.root,namespace:w.proof}));
});

test('synchronous pre-first-command refusal and invalid async guards create no native command admissions',async()=>{
 for(const mode of ['throw','async','async-current']){const w=await world();await assert.rejects(openNativeGit({gitBinary:git,ownedClientRoot:w.clientRoot},undefined,lifecycle(w,{...(mode==='async-current'?{assertCurrent:async()=>{throw Error('async current refusal');}}:{}),beforeFirstCommand:mode==='throw'?()=>{throw Error('review changed');}:async()=>{throw Error('async refusal');}})),mode==='throw'?/review changed/:/synchronously/);assert.deepEqual(await descriptors(w),[]);if(w.proof)assert.equal((await reconcileOwnedGitProcesses(w.clientRoot,0,w.proof)).cleanup,'confirmed');}
});

test('fresh gated factory never adopts an existing private root',async()=>{
 const w=await world();await fs.mkdir(w.clientRoot,{mode:0o700});await fs.writeFile(path.join(w.clientRoot,'foreign.txt'),'original');
 await assert.rejects(openNativeGit({gitBinary:git,ownedClientRoot:w.clientRoot},undefined,lifecycle(w)));assert.equal(w.proof,undefined);assert.equal(await fs.readFile(path.join(w.clientRoot,'foreign.txt'),'utf8'),'original');
});

test('source/abort drift after actual descriptor and runs-parent sync prevents first native launcher',async()=>{
 for(const mode of ['source','abort','replace-guard']){const w=await world(),abort=new AbortController();let current=true;const hooks=lifecycle(w,{assertCurrent(){if(!current)throw Error('source changed');}}),pause=await pausedPreparation(w,()=>openNativeGit({gitBinary:git,ownedClientRoot:w.clientRoot},abort.signal,hooks));try{if(mode==='abort')abort.abort();else{current=false;if(mode==='replace-guard')hooks.assertCurrent=()=>{};}pause.release();await assert.rejects(pause.pending);const records=await descriptors(w);assert.equal(records.length,1);assert.equal(records[0].lifecycle,false);assert.equal((await reconcileOwnedGitProcesses(w.clientRoot,0,w.proof)).cleanup,'confirmed');}finally{pause.release();pause.restore();}}
});

test('rooted recovery refuses replacement or missing command namespace instead of accepting an empty directory',async()=>{
 const w=await world(),client=await openNativeGit({gitBinary:git,ownedClientRoot:w.clientRoot},undefined,lifecycle(w));await client.close();
 const original=path.join(w.clientRoot,'runs-original');await fs.rename(w.proof.runsDirectory,original);await fs.mkdir(w.proof.runsDirectory,{mode:0o700});assert.equal((await reconcileOwnedGitProcesses(w.clientRoot,0,w.proof)).cleanup,'unknown');
 await fs.rmdir(w.proof.runsDirectory);assert.equal((await reconcileOwnedGitProcesses(w.clientRoot,0,w.proof)).cleanup,'unknown');await fs.rename(original,w.proof.runsDirectory);assert.equal((await reconcileOwnedGitProcesses(w.clientRoot,0,w.proof)).cleanup,'confirmed');
});

test('bounded reconciliation rejects a FIFO result without blocking and hashes the same captured result bytes',async()=>{
 const w=await world(),client=await openNativeGit({gitBinary:git,ownedClientRoot:w.clientRoot},undefined,lifecycle(w));await client.close();const [row]=await descriptors(w),result=path.join(w.proof.runsDirectory,row.id,'result.json'),saved=result+'.saved';
 const originalRead=fsSync.readFileSync;fsSync.readFileSync=function(file,...args){if(String(file).endsWith('/result.json'))throw Error('second unbounded result read forbidden');return originalRead.call(this,file,...args);};try{assert.equal((await reconcileOwnedGitProcesses(w.clientRoot,0,w.proof)).cleanup,'confirmed');}finally{fsSync.readFileSync=originalRead;}
 await fs.rename(result,saved);await exec('/usr/bin/mkfifo',[result],{timeout:2000});
 try{const script=`import {reconcileOwnedGitProcesses} from ${JSON.stringify(pathToFileURL(path.resolve('dist/effects/index.js')).href)};console.log(JSON.stringify(await reconcileOwnedGitProcesses(process.argv[1],0,JSON.parse(process.argv[2]))));`;const actual=await exec(process.execPath,['--input-type=module','-e',script,w.clientRoot,JSON.stringify(w.proof)],{timeout:3000,maxBuffer:65536});assert.equal(JSON.parse(actual.stdout).cleanup,'unknown');}finally{await fs.unlink(result);await fs.rename(saved,result);}
});

// Exercise the original public reopen, before any fresh native command is admitted.
test('owned-client reopen refuses a private FIFO marker without blocking or adding a native command',async()=>{
 const w=await world(),profile={gitBinary:git,ownedClientRoot:w.clientRoot};
 const client=await openNativeGit(profile,undefined,lifecycle(w));await client.close();
 const before=await descriptors(w),marker=path.join(w.clientRoot,'native-owner.json'),saved=path.join(w.root,'retained-native-owner.json');
 await fs.rename(marker,saved);await exec('/usr/bin/mkfifo',['-m','600',marker],{timeout:2000});
 try{
  const script=`import {openNativeGit} from ${JSON.stringify(pathToFileURL(path.resolve('dist/effects/index.js')).href)};try{await openNativeGit(JSON.parse(process.argv[1]));throw Error('FIFO marker was accepted');}catch(error){if(!String(error).includes('Unsafe or oversized immutable regular input'))throw error;console.log(JSON.stringify({refused:true}));}`;
  const actual=await exec(process.execPath,['--input-type=module','-e',script,JSON.stringify({...profile,resumeOwned:true})],{timeout:3000,maxBuffer:65536});
  assert.equal(JSON.parse(actual.stdout).refused,true);assert.deepEqual(await descriptors(w),before);
 }finally{await fs.unlink(marker);await fs.rename(saved,marker);}
 assert.equal((await reconcileOwnedGitProcesses(w.clientRoot,0,w.proof)).cleanup,'confirmed');
});
