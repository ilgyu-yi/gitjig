import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {readNativeHistorySnapshot,nativeCheckpoint,readNativeCheckpointEntries} from '../../dist/controller/history.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const root=await temporaryDirectory('native-history-snapshot');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const manager=SessionManager.inMemory('/controlled-original-history');manager.appendMessage({role:'user',content:'One original owner input',timestamp:1});
 const file=path.join(root,'original.jsonl'),save=()=>fs.writeFile(file,[manager.getHeader(),...manager.getBranch()].map(e=>JSON.stringify(e)+'\n').join(''),{mode:0o600});await save();return{root,manager,file,save};
}
test('one bounded history snapshot binds parsed entries and checkpoint to the same original bytes',async t=>{
 const f=await fixture(t),bytes=await fs.readFile(f.file),snapshot=await readNativeHistorySnapshot(f.file);
 assert.equal(snapshot.checkpoint.sha256,sha(bytes));assert.equal(snapshot.checkpoint.bytes,bytes.length);
 assert.equal(snapshot.checkpoint.leafId,f.manager.getLeafId());assert.equal(snapshot.checkpoint.sessionId,f.manager.getSessionId());
 assert.deepEqual(snapshot.entries,JSON.parse('['+bytes.toString('utf8').trim().split('\n').join(',')+']'));
 assert.deepEqual(await nativeCheckpoint(f.file),snapshot.checkpoint);
 const captured=structuredClone(snapshot.entries);await fs.writeFile(f.file,'Replaced after original snapshot');assert.deepEqual(snapshot.entries,captured);
 await assert.rejects(readNativeHistorySnapshot(f.file,snapshot.checkpoint));
});
test('prefix extension preserves the exact old checkpoint while returning the captured newer leaf',async t=>{
 const f=await fixture(t),original=await nativeCheckpoint(f.file);f.manager.appendCustomEntry('controlled.tail',{original:true});await f.save();
 const current=await readNativeHistorySnapshot(f.file,original,{sessionId:f.manager.getSessionId(),ownerInput:'One original owner input'});
 assert.equal(current.checkpoint.leafId,f.manager.getLeafId());assert.ok(current.checkpoint.bytes>original.bytes);assert.notEqual(current.checkpoint.sha256,original.sha256);
 for(const changed of [{...original,sessionId:'foreign'},{...original,leafId:'foreign'},{...original,sha256:'0'.repeat(64)}])await assert.rejects(readNativeHistorySnapshot(f.file,changed),/checkpoint identity\/content lost/);
 await assert.rejects(readNativeHistorySnapshot(f.file,original,{sessionId:f.manager.getSessionId(),ownerInput:'Different owner input'}),/source\/session mismatch/);
 const text=await fs.readFile(f.file,'utf8');await fs.writeFile(f.file,text.replace('One original owner input','Changed original input'));await assert.rejects(readNativeHistorySnapshot(f.file,original),/checkpoint identity\/content lost/);
});
test('incomplete and oversized histories refuse without a selected-source fallback',async t=>{
 const f=await fixture(t);await fs.appendFile(f.file,'{"type":"message","id":');await assert.rejects(readNativeHistorySnapshot(f.file),/incomplete\/corrupt/);
 const handle=await fs.open(f.file,'w');await handle.truncate(32*1024*1024+1);await handle.close();await assert.rejects(readNativeHistorySnapshot(f.file),/unsupported\/empty/);
});
test('sealed checkpoint decoding skips blank lines and refuses any malformed line within the sealed prefix',async t=>{
 const f=await fixture(t),[header,message]= (await fs.readFile(f.file,'utf8')).trimEnd().split('\n');
 const prefix=Buffer.from('\ufeff'+header+'\r\n  \r\n'+message+'\r\n');
 await fs.writeFile(f.file,prefix);
 const {checkpoint,entries}=await readNativeHistorySnapshot(f.file);
 await fs.appendFile(f.file,'unfinished tail');
 assert.deepEqual(readNativeCheckpointEntries(f.file,checkpoint),entries);
 assert.equal(checkpoint.sha256,sha(prefix));
 const invalid=Buffer.from(header+'\n{secret malformed line\n'+message+'\n');
 await fs.writeFile(f.file,invalid);
 const invalidCheckpoint={...checkpoint,bytes:invalid.length,sha256:sha(invalid)};
 assert.throws(()=>readNativeCheckpointEntries(f.file,invalidCheckpoint),{message:'incomplete/corrupt native history'});
});
test('growth after the initial stat remains bounded and joins the original file handle',async t=>{
 const f=await fixture(t),originalOpen=fs.open;let captured,grown=false;
 fs.open=async(...args)=>{const handle=await originalOpen(...args);if(args[0]===f.file){captured=handle;const read=handle.read.bind(handle);handle.read=async(...values)=>{if(!grown){grown=true;const writer=await originalOpen(f.file,'r+');try{await writer.truncate(32*1024*1024+1);}finally{await writer.close();}}return read(...values);};}return handle;};
 try{await assert.rejects(readNativeHistorySnapshot(f.file),/exceeds bound/);assert.equal(grown,true);assert.equal(captured.fd,-1);}finally{fs.open=originalOpen;}
});
test('read failure closes the same owned handle before returning failure',async t=>{
 const f=await fixture(t),originalOpen=fs.open;let captured;
 fs.open=async(...args)=>{const handle=await originalOpen(...args);if(args[0]===f.file){captured=handle;handle.read=async()=>{throw Error('Controlled original history read failure');};}return handle;};
 try{await assert.rejects(readNativeHistorySnapshot(f.file),/Controlled original history read failure/);assert.equal(captured.fd,-1);}finally{fs.open=originalOpen;}
});
test('symlink and multiply linked histories cannot become original snapshots',async t=>{
 const f=await fixture(t),alias=path.join(f.root,'alias.jsonl');await fs.symlink(f.file,alias);await assert.rejects(readNativeHistorySnapshot(alias));
 await fs.unlink(alias);await fs.link(f.file,alias);await assert.rejects(readNativeHistorySnapshot(f.file),/unsupported\/empty/);
});
