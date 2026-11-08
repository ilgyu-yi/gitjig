import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync,constants as z} from 'node:zlib';
import {NativeTransportWriter,expandNativeTransport,projectNativePackets,nativeCaptureBinding,decodeNativeStage,nativeStageByteLimit} from '../../dist/workflow/native-transport.js';
import {nativeRoleEntries as kinds} from '../../dist/workflow/native-role-records.js';
import {embeddedEvidencePolicy as limits} from '../../dist/workflow/native-evidence-budget.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,{failWrite=false,prefix=false,undefinedField=false}={}){
 const root=await temporaryDirectory('native-transport');t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'owned.deflate');
 const request={binding:{nativeEvidencePolicy:limits.id}},intent={type:'custom',customType:kinds.intent,id:'intent00',parentId:null,data:{sessionId:'owner',request}};
 const note={type:'custom',customType:'host.note',id:'note0000',parentId:intent.id,data:{sourceEntryId:intent.id,frames:['literal source value']}},writer=await NativeTransportWriter.open(file,{intentEntryId:intent.id,sessionId:'owner',requestDigest:sha(JSON.stringify(request))});
 const messages=[{type:'system',subtype:'init',uuid:'init',session_id:'native'},{type:'assistant',uuid:'answer',session_id:'native',message:{id:'message',content:[{type:'text',text:'Exact original 한글 source'}]}}];
 if(undefinedField)messages[0].optional=undefined;
 let finished=false;
 try{
  await writer.append(intent.id,messages[0]);
  if(prefix){const bytes=decodeNativeStage(await fs.readFile(file),writer.allocation).encoded;assert.throws(()=>inflateRawSync(bytes));assert.deepEqual(JSON.parse(inflateRawSync(bytes,{finishFlush:z.Z_SYNC_FLUSH}).toString('utf8').trim()),[1,intent.id,messages[0]]);}
  if(failWrite){const handle=writer.handle,write=handle.write.bind(handle);handle.write=async()=>{throw Error('Controlled original staging write failure');};try{await assert.rejects(writer.append(note.id,messages[1]),/Controlled original staging/);}finally{handle.write=write;}}
  else await writer.append(note.id,messages[1]);
  const capture=await writer.finish(intent.id,'owner',request);finished=true;
  const entry={type:'custom',customType:kinds.capture,id:'capsule0',parentId:note.id,data:capture};return{root,file,writer,intent,note,entry,physical:[intent,note,entry],messages,capture};
 }finally{if(!finished)await writer.finish(intent.id,'owner',request).catch(()=>{});}
}
const control={type:'gitjig.native-query-settled/v1'};
test('owned transport seals exact records and public decode preserves typed anchors and literal payloads',async t=>{
 const f=await fixture(t,{prefix:true}),view=expandNativeTransport(f.physical),sdk=view.filter(e=>e.customType===kinds.sdk);
 assert.deepEqual(sdk.map(e=>e.data.message),f.messages);assert.equal(view.find(e=>e.id===f.note.id).parentId,sdk[0].id);assert.equal(sdk[1].parentId,f.note.id);
 assert.deepEqual(view.find(e=>e.id===f.note.id).data,f.note.data);assert.deepEqual(expandNativeTransport(view),view);
 assert.equal(nativeCaptureBinding(view,f.intent,control).entryId,f.entry.id);await f.writer.removeStaging();await assert.rejects(fs.stat(f.file),{code:'ENOENT'});
});
test('caller-created or mutated logical views cannot bypass capsule correspondence',async t=>{
 const f=await fixture(t),view=expandNativeTransport(f.physical);view.find(e=>e.customType===kinds.sdk).data.message.changed=true;
 assert.throws(()=>expandNativeTransport(view),/virtual view differs/);
 const forged=projectNativePackets(f.physical,f.intent.id,[{sequence:1,anchor:f.intent.id,message:{type:'assistant',message:{content:[{type:'text',text:'invented'}]}}}]);
 assert.throws(()=>expandNativeTransport(forged),/virtual view differs/);
});
for(const mutation of ['foreign-owner','wrong-request','trailing','unknown-anchor','reordered','bad-base64','invalid-intent'])test('capsule refuses '+mutation,async t=>{
 const f=await fixture(t),entries=structuredClone(f.physical),c=entries.at(-1).data;
 if(mutation==='invalid-intent')entries[0].data.request.binding=null;
 if(mutation==='foreign-owner')c.sessionId='foreign';if(mutation==='wrong-request')c.requestDigest='0'.repeat(64);if(mutation==='bad-base64')c.body+='!';
 if(mutation==='trailing'){const bytes=Buffer.concat([Buffer.from(c.body,'base64'),Buffer.from('TRAILING')]);c.body=bytes.toString('base64');c.encodedBytes=bytes.length;c.encodedSha256=sha(bytes);}
 if(mutation==='unknown-anchor'||mutation==='reordered'){
  const records=[{sequence:1,anchor:f.intent.id,message:f.messages[0]},{sequence:2,anchor:f.note.id,message:f.messages[1]}];
  if(mutation==='unknown-anchor')records[0].anchor='missing';else records.reverse();
  const raw=records.map(r=>JSON.stringify([r.sequence,r.anchor,r.message])+'\n').join(''),bytes=deflateRawSync(raw);c.body=bytes.toString('base64');c.encodedBytes=bytes.length;c.encodedSha256=sha(bytes);c.logicalBytes=Buffer.byteLength(raw);c.messageDigest=sha(records.map(r=>JSON.stringify(r.message)+'\n').join(''));
 }
 assert.throws(()=>expandNativeTransport(entries));
});
test('failed stage writes retain all actually received packets but grant no successful source',async t=>{
 const f=await fixture(t,{failWrite:true});assert.equal(f.capture.sealed,false);assert.equal(f.capture.stopped,true);assert.equal(f.writer.handle.fd,-1);
 const sdk=expandNativeTransport(f.physical).filter(e=>e.customType===kinds.sdk);assert.deepEqual(sdk.map(e=>e.data.message),f.messages);
 assert.throws(()=>nativeCaptureBinding(f.physical,f.intent,control),/did not admit a complete trace/);assert.ok((await fs.stat(f.file)).isFile());
});
test('declared absent capture refuses rather than returning an empty material view',async t=>{
 const f=await fixture(t);assert.throws(()=>expandNativeTransport([f.intent,f.note]),/missing\/ambiguous/);
});
test('compressed expansion obeys its independent logical bound',async t=>{
 const f=await fixture(t),entries=structuredClone(f.physical),c=entries.at(-1).data,encoded=deflateRawSync(Buffer.alloc(limits.logicalBytes+limits.reserveBytes+1,120));
 c.body=encoded.toString('base64');c.encodedBytes=encoded.length;c.encodedSha256=sha(encoded);assert.throws(()=>expandNativeTransport(entries));
});

test('failed stage metadata acquisition closes the allocated descriptor before creating a compressor',async t=>{
 const root=await temporaryDirectory('native-stage-open-failure');t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'owned.deflate'),original=fs.open;let handle;
 fs.open=async(...args)=>{const opened=await original(...args);if(args[0]===file){handle=opened;opened.stat=async()=>{throw Error('Controlled stage metadata failure');};}return opened;};
 try{await assert.rejects(NativeTransportWriter.open(file,{intentEntryId:'intent00',sessionId:'owner',requestDigest:sha('control')}),/Controlled stage metadata failure/);assert.equal(handle.fd,-1);}finally{fs.open=original;}
});

test('SDK values use their exact serialized JSON domain rather than transient undefined properties',async t=>{
 const f=await fixture(t,{undefinedField:true}),view=expandNativeTransport(f.physical);assert.deepEqual(view.filter(e=>e.customType===kinds.sdk).map(e=>e.data.message),JSON.parse(JSON.stringify(f.messages)));
});

for(const mode of ['complete','partial'])test('original stage writer SIGKILL retains a bounded exact physical prefix: '+mode,{timeout:5000},async t=>{
 const {fork}=await import('node:child_process'),root=await temporaryDirectory('native-stage-abrupt');t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'owned.deflate');
 const child=fork(new URL('./native-stage-abrupt-worker.mjs',import.meta.url),[file,mode],{stdio:['ignore','ignore','ignore','ipc']});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
 const ready=await Promise.race([new Promise(resolve=>child.once('message',resolve)),exited.then(exit=>{throw Error('Writer exited before controlled interruption: '+JSON.stringify(exit));})]);
 assert.equal(ready.acknowledged,2);assert.equal(ready.allocation.writerPid,child.pid);assert.equal(ready.allocation.requestDigest,sha('controlled request'));
 child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');
 const bytes=await fs.readFile(file),stage=decodeNativeStage(bytes,ready.allocation);assert.equal(stage.frames,2);assert.equal(stage.tailBytes>0,mode==='partial');
 const tuples=inflateRawSync(stage.encoded,{finishFlush:z.Z_SYNC_FLUSH}).toString('utf8').trimEnd().split('\n').map(JSON.parse);
 assert.deepEqual(tuples.map(tuple=>tuple[0]),[1,2]);assert.ok(tuples.every(tuple=>tuple[1]==='intent00'));assert.deepEqual(tuples.map(tuple=>tuple[2].message.content[0].text),['Original controlled source 0 한글','Original controlled source 1 한글']);
 const shortened=decodeNativeStage(bytes.subarray(0,-1),ready.allocation);assert.ok(shortened.tailBytes>0);assert.equal(shortened.frames,mode==='complete'?1:2);
 const corrupt=Buffer.from(bytes),at=12+corrupt.readUInt32BE(8);corrupt[at+8]^=1;assert.throws(()=>decodeNativeStage(corrupt,ready.allocation),/checksum/);
 assert.throws(()=>decodeNativeStage(bytes,{...ready.allocation,requestDigest:'0'.repeat(64)}),/header/);
 assert.throws(()=>decodeNativeStage(bytes,{...ready.allocation,inode:String(Number(ready.allocation.inode)+1)}),/header/);
 assert.ok((await fs.stat(file)).isFile(),'Prefix decoding must retain the original stage; no recovery or unlink authority');
});

test('staging frames join actual short writes and separate physical framing from encoded capsule bounds',async t=>{
 const f=await fixture(t);const bytes=await fs.readFile(f.file),stage=decodeNativeStage(bytes,f.writer.allocation);
 assert.equal(stage.tailBytes,0);assert.equal(stage.frames,f.messages.length+1);assert.deepEqual(stage.encoded,Buffer.from(f.capture.body,'base64'));assert.ok(bytes.length>stage.encoded.length);assert.ok(bytes.length<nativeStageByteLimit);
 const large=Buffer.alloc(nativeStageByteLimit+1);assert.throws(()=>decodeNativeStage(large,f.writer.allocation),/bound/);
 const root=await temporaryDirectory('native-stage-short-write');t.after(()=>fs.rm(root,{recursive:true,force:true}));const writer=await NativeTransportWriter.open(path.join(root,'short.deflate'),{intentEntryId:'intent00',sessionId:'owner',requestDigest:sha(JSON.stringify('request'))}),write=writer.handle.write.bind(writer.handle);let writes=0;
 writer.handle.write=(buffer,offset,length,position)=>{writes++;return write(buffer,offset,Math.min(3,length),position);};
 await writer.append('intent00',f.messages[0]);const capsule=await writer.finish('intent00','owner','request');assert.ok(writes>2);assert.equal(capsule.sealed,true);
 assert.equal(decodeNativeStage(await fs.readFile(writer.path),writer.allocation).tailBytes,0);await writer.removeStaging();
});


test('changed final owner/request refuses and joins the staging handles while retaining original file',async t=>{
 const root=await temporaryDirectory('native-stage-owner-drift');t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'owned.deflate');
 const writer=await NativeTransportWriter.open(file,{intentEntryId:'intent00',sessionId:'owner',requestDigest:sha(JSON.stringify('request'))});
 await writer.append('intent00',{type:'system',session_id:'native'});await assert.rejects(writer.finish('changed-intent','owner','request'),/original owner\/request changed/);
 assert.equal(writer.handle.fd,-1);assert.ok((await fs.stat(file)).isFile());
});


test('owned stage writer responds after readiness until original parent stops it',{timeout:5000},async t=>{
 const {fork}=await import('node:child_process'),root=await temporaryDirectory('native-stage-live-owner');let child,exited;
 t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');if(exited)await exited;await fs.rm(root,{recursive:true,force:true});});
 child=fork(new URL('./native-stage-abrupt-worker.mjs',import.meta.url),[path.join(root,'owned.deflate'),'complete'],{stdio:['ignore','ignore','ignore','ipc']});
 exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 const unexpectedExit=exited.then(exit=>{throw Error('Original writer exited before parent stop: '+JSON.stringify(exit));});
 const ready=await Promise.race([new Promise(resolve=>child.once('message',resolve)),unexpectedExit]);assert.equal(ready.acknowledged,2);
 const reply=new Promise(resolve=>child.once('message',resolve));child.send({kind:'fixture-liveness-probe',nonce:'original-parent'});
 assert.deepEqual(await Promise.race([reply,unexpectedExit]),{kind:'fixture-liveness-reply',nonce:'original-parent'});
 child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');
});
