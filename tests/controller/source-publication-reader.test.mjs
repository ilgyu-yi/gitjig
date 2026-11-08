import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {freeze} from '../../dist/controller/change-files.js';
import {inspectSourceCapture} from '../../dist/effects/source-snapshot-projection.js';
import {sourcePublicationReader,sourcePublicationWindowBytes as windowBytes} from '../../dist/controller/source-publication-reader.js';

// Controlled metadata premise only. Real proposal custody is checked separately
// by the normal Controller/runtime journey; this fixture cannot grant standing.
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-publication-read-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source');await fs.mkdir(source,{mode:0o700});await fs.mkdir(path.join(source,'dir'),{mode:0o700});
 const bytes=Buffer.concat([Buffer.from('\ufeff'),Buffer.alloc(windowBytes-4,97),Buffer.from('한글🙂\n'.repeat(20000))]);
 for(const [name,value] of [['dir/text',bytes],['empty',''],['private.env','DO NOT DISCLOSE'],['opaque',Buffer.from([0,255])]])await fs.writeFile(path.join(source,name),value,{mode:0o600});
 const frozen=await freeze(source,path.join(root,'capture'),{}),signal=new AbortController();
 const candidate=await inspectSourceCapture({versionId:'mechanical',root:path.join(root,'capture'),...frozen},100,8*1024*1024,signal.signal);
 const names=['dir/text','empty','opaque'],objectId='1'.repeat(40);
 const projection={product:[...names.map(name=>({path:name,tracked:false,implementationDelta:true})),{path:'deleted',tracked:true,implementationDelta:true}],
  projectedEntries:names.map(name=>({path:name,mode:'100644',size:candidate.files.get(name).size,objectId})),
  blobs:names.map(name=>({side:'candidate',...candidate.files.get(name),objectId})),
  wholeFileAdditions:names.slice(0,2).map(name=>({path:name,capturedBasePresent:true,candidateSha256:candidate.files.get(name).sha256})),
  effectiveDifferences:[{path:'private.env',reason:'Captured context excluded from Git product'}]};
 let active=true;
 const reader=sourcePublicationReader({candidate,projection,signal:signal.signal,assertCurrent(){if(!active)throw Error('HOST_CLOSED');},track:task=>Promise.resolve().then(task)});
 t.after(()=>reader.close());
 return{root,candidate,projection,reader,bytes,signal,closeHost(){active=false;}};
}

test('complete UTF-8/BOM windows disclose only original product with bounded cumulative reads',async t=>{
 const f=await fixture(t),original=fs.open;let readBytes=0,opens=0;
 fs.open=async(...args)=>{const h=await original(...args);opens++;const read=h.read.bind(h);h.read=async(...a)=>{const result=await read(...a);readBytes+=result.bytesRead;return result;};return h;};
 try{
  const pieces=[];let offset=0,calls=0;
  do{const result=await f.reader.readFile({path:'dir/text',offset});assert.ok(result.bytes<=windowBytes);assert.equal(result.totalBytes,f.bytes.length);assert.equal(result.sha256,createHash('sha256').update(f.bytes).digest('hex'));assert.equal(result.windowSha256,createHash('sha256').update(result.text).digest('hex'));pieces.push(result.text);offset=result.nextOffset;calls++;}while(offset!==null);
  assert.deepEqual(Buffer.from(pieces.join('')),f.bytes);assert.equal(opens,calls);assert.ok(readBytes<=f.bytes.length+4*calls,'one bounded seek read per window, no full-file rehash');
  assert.equal((await f.reader.readFile({path:'empty'})).text,'');assert.equal((await f.reader.readFile({path:'dir/text',offset:f.bytes.length})).nextOffset,null);
  await assert.rejects(f.reader.readFile({path:'dir/text',offset:1}),/UTF-8 boundary/);
  for(const name of ['private.env','.git/config','../source/private.env','dir/../dir/text','/dir/text','deleted','dir','missing'])await assert.rejects(f.reader.readFile({path:name}),/published candidate file/);
  await assert.rejects(f.reader.readFile({path:'opaque'}),/text unavailable/);
  for(const offset of [-1,0.5,NaN,Infinity,f.bytes.length+1])await assert.rejects(f.reader.readFile({path:'dir/text',offset}),/byte offset/);
 }finally{fs.open=original;}
});

test('whole metadata rows, explicit continuation, detached results and closed section selection',async t=>{
 const f=await fixture(t);let cursor=0,seen=[];
 do{const page=f.reader.readPage({section:'product',cursor,limit:1});assert.ok(Buffer.byteLength(JSON.stringify(page))<=windowBytes);assert.equal(page.total,4);seen.push(...page.entries);cursor=page.nextCursor;}while(cursor!==null);
 assert.equal(seen.at(-1).disposition,'deleted');assert.equal(seen.find(e=>e.path==='opaque').content,'opaque');
 const first=f.reader.readPage({section:'whole-file',limit:1});first.entries[0].path='private.env';
 assert.equal(f.reader.readPage({section:'whole-file',limit:1}).entries[0].path,'dir/text');
 assert.equal(f.reader.readPage({section:'omissions'}).meaning,'execution-to-published differences');
 assert.deepEqual(f.reader.readPage({section:'omissions'}).entries,f.projection.effectiveDifferences);
 for(const section of ['__proto__','constructor','files','',null])assert.throws(()=>f.reader.readPage({section}),/section/);
 for(const cursor of [-1,0.2,5])assert.throws(()=>f.reader.readPage({section:'product',cursor}),/page/);
 for(const limit of [0,101,1.2])assert.throws(()=>f.reader.readPage({section:'product',limit}),/page/);
});

test('same-sized changed bytes, replacement file and changed ancestors never return content',async t=>{
 for(const fault of ['bytes','leaf','parent']){
  const f=await fixture(t),file=path.join(f.candidate.input.root,'dir/text');
  if(fault==='bytes')await fs.writeFile(file,Buffer.alloc(f.bytes.length,120));
  else if(fault==='leaf'){await fs.rename(file,file+'-original');await fs.writeFile(file,f.bytes,{mode:0o600});}
  else{await fs.rename(path.dirname(file),path.dirname(file)+'-original');await fs.mkdir(path.dirname(file),{mode:0o700});await fs.writeFile(file,f.bytes,{mode:0o600});}
  await assert.rejects(f.reader.readFile({path:'dir/text'}),/changed/);
 }
});

test('replacement with FIFO or symlink after ancestry check cannot hang or disclose foreign bytes',async t=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),execute=promisify(execFile);
 for(const fault of ['fifo','symlink']){
  const f=await fixture(t),file=path.join(f.candidate.input.root,'dir/text'),foreign=path.join(f.root,'foreign');await fs.writeFile(foreign,'FOREIGN SECRET');
  const original=fs.open;let replaced=false;
  fs.open=async(...args)=>{if(String(args[0])===file&&!replaced){replaced=true;await fs.rename(file,file+'-original');if(fault==='fifo')await execute('/usr/bin/mkfifo',['-m','600',file]);else await fs.symlink(foreign,file);}return original(...args);};
  try{await assert.rejects(f.reader.readFile({path:'dir/text'}));assert.equal(replaced,true);}finally{fs.open=original;}
  assert.equal(await fs.readFile(foreign,'utf8'),'FOREIGN SECRET');
 }
});

test('mutation during same-FD read or awaited close refuses result and joins FD cleanup',async t=>{
 for(const fault of ['read','close','scope']){
  const f=await fixture(t),original=fs.open;let closed=false;
  fs.open=async(...args)=>{const h=await original(...args),read=h.read.bind(h),close=h.close.bind(h);h.close=async()=>{await close();closed=true;if(fault==='close')await fs.appendFile(String(args[0]),'changed');};h.read=async(...a)=>{const result=await read(...a);if(fault==='read')await fs.appendFile(String(args[0]),'changed');if(fault==='scope')f.closeHost();return result;};return h;};
  try{await assert.rejects(f.reader.readFile({path:'dir/text'}),/changed|HOST_CLOSED/);assert.equal(closed,true);}finally{fs.open=original;}
 }
});

test('reader close and host shutdown invalidate idle pages and join a suspended read',async t=>{
 const f=await fixture(t),original=fs.open;let entered,release,fdClosed=false;
 const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 fs.open=async(...args)=>{const h=await original(...args),read=h.read.bind(h),close=h.close.bind(h);h.close=async()=>{await close();fdClosed=true;};h.read=async(...a)=>{entered();await gate;return read(...a);};return h;};
 try{
  const pending=f.reader.readFile({path:'dir/text'});const rejected=assert.rejects(pending,/closed/);await started;
  let joined=false;const closing=f.reader.close().then(()=>{joined=true;});await Promise.resolve();assert.equal(joined,false);release();await rejected;await closing;assert.equal(fdClosed,true);
  assert.throws(()=>f.reader.readPage({section:'product'}),/closed/);
 }finally{release();fs.open=original;}
 const idle=await fixture(t);idle.signal.abort(Error('HOST_SHUTDOWN'));assert.throws(()=>idle.reader.readPage({section:'product'}),/HOST_SHUTDOWN/);
});
