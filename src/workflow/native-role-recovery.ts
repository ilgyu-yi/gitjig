import fs,{type FileHandle} from 'node:fs/promises';
import {constants,type Stats} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {deflateRawSync,inflateRawSync,constants as z} from 'node:zlib';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {assertPiHistoryPath,type PiHostEnvironment} from '../pi/host.js';
import {absent} from '../pi/native-owner-records.js';
import {readNativeHistorySnapshot,readNativeHistoryWitness,nativeHistoryIdentity,type NativeHistoryCheckpoint} from '../controller/history.js';
import {embeddedEvidencePolicy as limits,nativeEvidencePolicyId} from './native-evidence-budget.js';
import {nativeHistoryByteLimit,nativeRoleEntries as kinds} from './native-role-records.js';
import {nativeRoleIntentReceipt,type NativeRoleIntentReceipt} from './native-role-output.js';
import {decodeNativeStage,decodeNativeTuples,expandNativeTransport,nativeStageHeader,nativeStageByteLimit,projectNativePackets,type NativeCapture,type NativeStageAllocation} from './native-transport.js';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const stamp=(s:Stats)=>JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode,s.uid,s.nlink]);
function fail(reason:string):never{throw Error('NATIVE_CAPTURE_RECOVERY_HELD: '+reason);}
type Snapshot=Awaited<ReturnType<typeof readNativeHistorySnapshot>>;
type Witness=Awaited<ReturnType<typeof readNativeHistoryWitness>>;
interface Expected {sessionId:string;launchId:string;role:string;writerPid:number;intent:NativeRoleIntentReceipt;dispatchCheckpoint:NativeHistoryCheckpoint}
function privateLeaf(info:Stats){if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid?.()||(info.mode&0o022)!==0)fail('original file ownership unavailable');}
async function boundedBytes(handle:FileHandle,limit:number):Promise<Buffer>{
    const chunks:Buffer[]=[];let size=0;
    for(;;){const bytes=Buffer.alloc(65536),read=await handle.read(bytes,0,bytes.length,null);if(!read.bytesRead)break;size+=read.bytesRead;if(size>limit)fail('original file exceeds bound');chunks.push(bytes.subarray(0,read.bytesRead));}
    return Buffer.concat(chunks);
}
async function writeAll(handle:FileHandle,bytes:Buffer){let at=0;while(at<bytes.length){const written=await handle.write(bytes,at,bytes.length-at,null);if(!written.bytesWritten)fail('recovery write made no progress');at+=written.bytesWritten;}}

/** Original bytes are copied unchanged. A stopped writer and held owner are caller prerequisites. */
async function replaceWithSuffix(file:string,snapshot:Witness,suffix:Buffer,assertCurrent:()=>void):Promise<Witness>{
    if(snapshot.checkpoint.bytes+suffix.length>nativeHistoryByteLimit)fail('recovery suffix exceeds physical history capacity');
    const temporary=path.join(path.dirname(file),`native-recovery-${randomUUID()}.tmp`);
    let source:FileHandle|undefined,target:FileHandle|undefined,targetIdentity:Stats|undefined;
    try{
        assertCurrent();source=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);assertCurrent();
        const original=await source.stat();privateLeaf(original);if(original.size!==snapshot.checkpoint.bytes)fail('original history size changed');
        target=await fs.open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);targetIdentity=await target.stat();assertCurrent();
        const hash=createHash('sha256');let size=0;
        for(;;){const bytes=Buffer.alloc(65536),read=await source.read(bytes,0,bytes.length,null);assertCurrent();if(!read.bytesRead)break;size+=read.bytesRead;if(size>snapshot.checkpoint.bytes)fail('original history grew during recovery');hash.update(bytes.subarray(0,read.bytesRead));await writeAll(target,bytes.subarray(0,read.bytesRead));assertCurrent();}
        if(size!==snapshot.checkpoint.bytes||hash.copy().digest('hex')!==snapshot.checkpoint.sha256)fail('original history bytes changed');
        await writeAll(target,suffix);assertCurrent();
        const written=await target.stat(),expectedHash=hash.update(suffix).digest('hex');assertCurrent();
        const prepared=await readNativeHistoryWitness(temporary,snapshot.checkpoint);assertCurrent();if(prepared.checkpoint.sha256!==expectedHash||prepared.checkpoint.bytes!==size+suffix.length)fail('prepared recovery bytes changed');expandNativeTransport(prepared.entries);
        const after=await source.stat(),current=await fs.lstat(file),preparedIdentity=await fs.lstat(temporary),targetAfter=await target.stat();assertCurrent();
        if(stamp(after)!==stamp(original)||stamp(current)!==stamp(original)||preparedIdentity.dev!==targetIdentity.dev||preparedIdentity.ino!==targetIdentity.ino||stamp(preparedIdentity)!==stamp(written)||stamp(targetAfter)!==stamp(written))fail('history or recovery file identity changed');
        if(nativeHistoryIdentity(file)!==snapshot.historyIdentity||nativeHistoryIdentity(temporary)!==prepared.historyIdentity)fail('history or prepared snapshot changed before replacement');
        await fs.rename(temporary,file);assertCurrent();
        const persisted=await readNativeHistoryWitness(file,prepared.checkpoint);assertCurrent();
        if(!isDeepStrictEqual(persisted.checkpoint,prepared.checkpoint))fail('recovery suffix changed after persistence');
        return persisted;
    }finally{
        const errors:unknown[]=[];
        for(const handle of [source,target])if(handle)try{await handle.close();}catch(error){errors.push(error);}
        if(targetIdentity)try{const info=await fs.lstat(temporary);if(info.dev!==targetIdentity.dev||info.ino!==targetIdentity.ino)fail('temporary recovery ownership changed');await fs.unlink(temporary);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Native recovery file cleanup unavailable; original staging retained');
    }
}

/** Only explicit original interrupted-role recovery calls this I/O boundary. Never a source-reader fallback. */
export async function recoverNativeRoleCapture(file:string,original:Snapshot,expected:Expected,host:PiHostEnvironment,assertCurrent:()=>void):Promise<Witness>{
    const matching=(original.entries as any[]).filter(e=>e.type==='custom'&&e.customType===kinds.intent&&e.data?.request?.binding?.launchId===expected.launchId&&e.data?.request?.binding?.role===expected.role);
    if(!matching.some(e=>nativeEvidencePolicyId(e.data.request.binding)===limits.id)){assertCurrent();const witness=await readNativeHistoryWitness(file,original.checkpoint);assertCurrent();if(!isDeepStrictEqual(witness.checkpoint,original.checkpoint))fail('original snapshot changed');return witness;}
    if(matching.length!==1)fail('original intent is ambiguous');const intent=matching[0],request=intent.data.request;
    if(!expected.dispatchCheckpoint||expected.dispatchCheckpoint.sessionId!==expected.sessionId||!Number.isSafeInteger(expected.dispatchCheckpoint.bytes)||expected.dispatchCheckpoint.bytes<1||typeof expected.dispatchCheckpoint.sha256!=='string'||!/^[a-f0-9]{64}$/.test(expected.dispatchCheckpoint.sha256)||typeof expected.dispatchCheckpoint.leafId!=='string'||!expected.dispatchCheckpoint.leafId)fail('original dispatch checkpoint unavailable');
    if(!isDeepStrictEqual(nativeRoleIntentReceipt(request),expected.intent)||intent.data.sessionId!==expected.sessionId||original.checkpoint.sessionId!==expected.sessionId)fail('original request/session changed');
    const allocations=(original.entries as any[]).filter(e=>e.type==='custom'&&e.customType===kinds.staging&&e.data?.intentEntryId===intent.id);
    if(allocations.length!==1)fail('original allocation missing/ambiguous');const allocationEntry=allocations[0],allocation=allocationEntry.data as NativeStageAllocation;
    nativeStageHeader(allocation);
    if(allocation.sessionId!==expected.sessionId||allocation.requestDigest!==expected.intent.requestDigest||allocation.stagingName!==intent.data.capture?.stagingName||intent.data.capture?.kind!==limits.id||allocation.writerPid!==expected.writerPid)fail('original stage/run allocation changed');
    const current=()=>{assertCurrent();if(!Number.isSafeInteger(expected.writerPid)||expected.writerPid<1||!absent(expected.writerPid))fail('original stage writer is live or unverified');};
    current();await assertPiHistoryPath(host,file);current();
    const snapshot=await readNativeHistoryWitness(file,expected.dispatchCheckpoint);current();
    if(!isDeepStrictEqual(snapshot.checkpoint,original.checkpoint))fail('original history changed before recovery');
    const prefixLeaf=snapshot.entries.findIndex(e=>e.id===expected.dispatchCheckpoint.leafId),allocationPosition=snapshot.entries.findIndex(e=>e.id===allocationEntry.id);
    if(prefixLeaf<allocationPosition||allocationPosition<0)fail('allocation was not captured by original dispatch');
    const captures=(snapshot.entries as any[]).filter(e=>e.type==='custom'&&e.customType===kinds.capture&&e.data?.intentEntryId===intent.id),receipts=(snapshot.entries as any[]).filter(e=>e.type==='custom'&&e.customType===kinds.recovery&&e.data?.intentEntryId===intent.id);
    if(captures.length>1||receipts.length>1)fail('recovery receipt is ambiguous');
    if(captures.length&&!receipts.length){expandNativeTransport(snapshot.entries);return snapshot;}
    let receipt=receipts[0]?.data;
    if(receipt&&(!captures.length||Object.keys(receipt).sort().join(',')!=='allocationEntryId,captureEntryId,intentEntryId,stageBytes,stageSha256,version'||receipt.version!==1||receipt.captureEntryId!==captures[0].id||receipt.allocationEntryId!==allocationEntry.id||!Number.isSafeInteger(receipt.stageBytes)||receipt.stageBytes<1||receipt.stageBytes>nativeStageByteLimit||typeof receipt.stageSha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.stageSha256)||captures[0].data.sealed!==false||captures[0].data.stopped!==true))fail('original recovery correspondence changed');
    const stagePath=path.join(path.dirname(file),allocation.stagingName);let handle:FileHandle;
    try{handle=await fs.open(stagePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&receipt){current();expandNativeTransport(snapshot.entries);if(nativeHistoryIdentity(file)!==snapshot.historyIdentity)fail('recovered history changed after read');return snapshot;}throw error;}
    try{
        current();const info=await handle.stat();privateLeaf(info);
        if((info.mode&0o077)!==0||String(info.dev)!==allocation.device||String(info.ino)!==allocation.inode||info.size>nativeStageByteLimit)fail('original stage identity/bound changed');
        const bytes=await boundedBytes(handle,nativeStageByteLimit);current();
        if(stamp(await handle.stat())!==stamp(info)||stamp(await fs.lstat(stagePath))!==stamp(info))fail('original stage changed while reading');current();
        let stage:ReturnType<typeof decodeNativeStage>;try{stage=decodeNativeStage(bytes,allocation);}catch{fail('original stage framing corrupt or unsupported; original file retained');}if(stage.tailBytes)fail('incomplete original stage frame; original file and interrupted obligation retained');
        const decoded=inflateRawSync(stage.encoded,{finishFlush:z.Z_SYNC_FLUSH,info:true,maxOutputLength:limits.logicalBytes+limits.reserveBytes}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
        if(decoded.engine.bytesWritten!==stage.encoded.length)fail('stage compressed consumption changed');
        const records=decodeNativeTuples(decoded.buffer);
        if(stage.frames!==records.length&&stage.frames!==records.length+1)fail('stage frame/packet census changed');
        if(stage.frames===records.length+1){const strict=inflateRawSync(stage.encoded,{info:true,maxOutputLength:limits.logicalBytes+limits.reserveBytes}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};if(strict.engine.bytesWritten!==stage.encoded.length||!strict.buffer.equals(decoded.buffer))fail('stage final frame unavailable');}
        let persisted=snapshot;
        if(receipt){if(receipt.stageBytes!==bytes.length||receipt.stageSha256!==sha(bytes))fail('retained stage differs from recovery receipt');}
        else{
            const encoded=deflateRawSync(decoded.buffer),digest=createHash('sha256');for(const record of records)digest.update(JSON.stringify(record.message)+'\n');
            const capsule:NativeCapture={version:2,intentEntryId:intent.id,sessionId:expected.sessionId,requestDigest:expected.intent.requestDigest,sealed:false,stopped:true,packets:records.length,logicalBytes:decoded.buffer.length,messageDigest:digest.digest('hex'),encodedBytes:encoded.length,encodedSha256:sha(encoded),body:encoded.toString('base64')};
            const manager=SessionManager.inMemory(path.dirname(file),undefined,structuredClone(snapshot.entries));
            if(manager.getSessionId()!==expected.sessionId||manager.getLeafId()!==snapshot.checkpoint.leafId)fail('native suffix builder changed original branch');
            const captureId=manager.appendCustomEntry(kinds.capture,capsule);
            receipt={version:1,intentEntryId:intent.id,captureEntryId:captureId,allocationEntryId:allocationEntry.id,stageBytes:bytes.length,stageSha256:sha(bytes)};
            const receiptId=manager.appendCustomEntry(kinds.recovery,receipt),suffix=Buffer.from('\n'+JSON.stringify(manager.getEntry(captureId))+'\n'+JSON.stringify(manager.getEntry(receiptId))+'\n');
            current();persisted=await replaceWithSuffix(file,snapshot,suffix,current);current();
        }
        if(!isDeepStrictEqual(expandNativeTransport(persisted.entries),projectNativePackets(persisted.entries,intent.id,records)))fail('persisted recovery differs from original packets/anchors');
        const verified=await readNativeHistoryWitness(file,persisted.checkpoint);current();
        if(!isDeepStrictEqual(verified.checkpoint,persisted.checkpoint)||stamp(await handle.stat())!==stamp(info)||stamp(await fs.lstat(stagePath))!==stamp(info))fail('recovery changed before stage removal');current();
        if(nativeHistoryIdentity(file)!==verified.historyIdentity)fail('recovered history changed before stage removal');
        await fs.unlink(stagePath);current();if(nativeHistoryIdentity(file)!==verified.historyIdentity)fail('recovered history changed during stage removal');return verified;
    }finally{await handle.close();}
}
