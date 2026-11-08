import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {acquireOwner} from '../../dist/controller/ownership.js';
const exec=promisify(execFile);
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-owner-lease-'))),state=path.join(root,'state');await fs.mkdir(state,{mode:0o700});t.after(()=>fs.rm(root,{recursive:true,force:true}));return{root,state,file:path.join(state,'owner.json')};}
const refused=error=>error?.code==='OWNER_BUSY';

test('actual callable owner lease returns a frozen canonical file/namespace witness',async t=>{
 const f=await fixture(t),lease=await acquireOwner(f.state);try{const witness=lease.assertCurrent(),state=await fs.stat(f.state),file=await fs.stat(f.file),raw=JSON.parse(await fs.readFile(f.file,'utf8'));assert.deepEqual(Object.keys(witness).sort(),['nonce','ownerDevice','ownerInode','ownerUid','pid','stateDevice','stateDirectory','stateInode'].sort());assert.equal(Object.isFrozen(witness),true);assert.equal(Object.isFrozen(lease),true);assert.throws(()=>{lease.assertCurrent=()=>witness;},TypeError);assert.equal(witness.stateDirectory,f.state);assert.equal(witness.stateDevice,String(state.dev));assert.equal(witness.stateInode,String(state.ino));assert.equal(witness.ownerDevice,String(file.dev));assert.equal(witness.ownerInode,String(file.ino));assert.equal(witness.ownerUid,process.getuid());assert.equal(witness.pid,process.pid);assert.equal(witness.nonce,raw.nonce);assert.equal(lease.assertCurrent(),witness);}finally{await lease();}assert.throws(()=>lease.assertCurrent(),refused);
});

test('runtime claim is memory-only, single and idempotently released without stale-token reuse',async t=>{
 const f=await fixture(t),lease=await acquireOwner(f.state);try{const originalOpen=fsSync.openSync,originalStat=fsSync.lstatSync;fsSync.openSync=()=>{throw Error('claim must not open files');};fsSync.lstatSync=()=>{throw Error('claim must not inspect files');};try{const first=lease.claimSourcePreviewRuntime();assert.throws(()=>lease.claimSourcePreviewRuntime(),refused);first();const second=lease.claimSourcePreviewRuntime();first();assert.throws(()=>lease.claimSourcePreviewRuntime(),refused);second();second();lease.claimSourcePreviewRuntime()();}finally{fsSync.openSync=originalOpen;fsSync.lstatSync=originalStat;}assert.ok(lease.assertCurrent());}finally{await lease();}
});

test('callable release seals guards and active claim synchronously before physical owner unlink',async t=>{
 const f=await fixture(t),lease=await acquireOwner(f.state),nonce=lease.assertCurrent().nonce,drop=lease.claimSourcePreviewRuntime(),original=fs.lstat;let ready,release;const entered=new Promise(r=>ready=r),gate=new Promise(r=>release=r);t.mock.method(fs,'lstat',async(...args)=>{if(args[0]===f.file){ready();await gate;}return original(...args);});
 const pending=lease();assert.throws(()=>lease.assertCurrent(),refused);assert.throws(()=>lease.claimSourcePreviewRuntime(),refused);drop();await entered;assert.equal(fsSync.existsSync(f.file),true);release();await pending;t.mock.restoreAll();await lease();
 const next=await acquireOwner(f.state);try{assert.notEqual(next.assertCurrent().nonce,nonce);await lease();assert.ok(next.assertCurrent());}finally{await next();}
});

test('owner inode replacement with identical bytes refuses assertion and is preserved by old release',async t=>{
 const f=await fixture(t),lease=await acquireOwner(f.state),bytes=await fs.readFile(f.file);await fs.rename(f.file,f.file+'.original');await fs.writeFile(f.file,bytes,{flag:'wx',mode:0o600});assert.throws(()=>lease.assertCurrent(),refused);await lease();assert.deepEqual(await fs.readFile(f.file),bytes);
});

test('same inode wrong/malformed/duplicate/oversized owner contents cannot inherit the captured lease',async t=>{
 const f=await fixture(t),lease=await acquireOwner(f.state),bytes=await fs.readFile(f.file),witness=lease.assertCurrent();try{for(const wrong of ['{incomplete',JSON.stringify({pid:process.pid,nonce:'foreign'}),JSON.stringify({pid:process.pid+1,nonce:witness.nonce}),`{"pid":1,"pid":${process.pid},"nonce":${JSON.stringify(witness.nonce)}}`,'x'.repeat(4097),Buffer.from([0xff,0xfe])]){await fs.writeFile(f.file,wrong);assert.throws(()=>lease.assertCurrent(),refused);}await fs.writeFile(f.file,bytes);assert.equal(lease.assertCurrent().nonce,witness.nonce);}finally{await fs.writeFile(f.file,bytes);await lease();}
});

test('state identity, private modes and owner link count remain actual lease premises',async t=>{
 const f=await fixture(t),lease=await acquireOwner(f.state);try{await fs.chmod(f.state,0o755);assert.throws(()=>lease.assertCurrent(),refused);await fs.chmod(f.state,0o700);await fs.chmod(f.file,0o644);assert.throws(()=>lease.assertCurrent(),refused);await fs.chmod(f.file,0o600);await fs.link(f.file,path.join(f.root,'owner-hardlink'));assert.throws(()=>lease.assertCurrent(),refused);await fs.unlink(path.join(f.root,'owner-hardlink'));assert.ok(lease.assertCurrent());const original=f.state+'-original';await fs.rename(f.state,original);await fs.mkdir(f.state,{mode:0o700});assert.throws(()=>lease.assertCurrent(),refused);await fs.rmdir(f.state);await fs.rename(original,f.state);assert.ok(lease.assertCurrent());}finally{await fs.chmod(f.state,0o700);await lease();}
});

test('owner symlink refuses without following its contents',async t=>{
 const f=await fixture(t),lease=await acquireOwner(f.state),original=f.file+'.original';await fs.rename(f.file,original);await fs.symlink(original,f.file);try{assert.throws(()=>lease.assertCurrent(),refused);}finally{await fs.unlink(f.file);await fs.rename(original,f.file);await lease();}
});

test('actual owner FIFO assertion refuses without blocking the original bounded lease reader',{timeout:5000},async t=>{
 const f=await fixture(t),module=pathToFileURL(path.resolve('dist/controller/ownership.js')).href,script=`import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {acquireOwner} from ${JSON.stringify(module)};const lease=await acquireOwner(process.argv[1]),file=process.argv[1]+'/owner.json';await fs.rename(file,file+'.original');execFileSync('/usr/bin/mkfifo',[file]);await fs.chmod(file,0o600);let code;try{lease.assertCurrent();}catch(error){code=error.code;}finally{await fs.unlink(file);await fs.rename(file+'.original',file);await lease();}console.log(JSON.stringify({code}));`;
 const result=await exec(process.execPath,['--input-type=module','-e',script,f.state],{timeout:2500,maxBuffer:65536});assert.equal(JSON.parse(result.stdout).code,'OWNER_BUSY');
});

test('release retains original I/O error, seals old guards, and permits a later identity-checked retry',async t=>{
 const f=await fixture(t),lease=await acquireOwner(f.state),original=fs.readFile,failure=Error('owned release read failure');lease.claimSourcePreviewRuntime();t.mock.method(fs,'readFile',async(...args)=>{if(args[0]===f.file)throw failure;return original(...args);});await assert.rejects(lease(),e=>e===failure);assert.throws(()=>lease.assertCurrent(),refused);assert.throws(()=>lease.claimSourcePreviewRuntime(),refused);t.mock.restoreAll();await lease();const next=await acquireOwner(f.state);await next();
});
