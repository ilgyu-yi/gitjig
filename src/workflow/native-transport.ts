import fs, {type FileHandle} from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createDeflateRaw,deflateRawSync,inflateRawSync,crc32,constants as z} from 'node:zlib';
import {embeddedEvidencePolicy as limits,nativeEvidencePolicyId} from './native-evidence-budget.js';
import {nativeRoleEntries as kinds,type NativeRecord} from './native-role-records.js';
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const serialized=(value:unknown)=>JSON.stringify(value);
const object=(value:any)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fail(reason:string):never{throw Error('NATIVE_CAPTURE_UNAVAILABLE: '+reason);}
export interface TransportRecord {sequence:number;anchor:string;message:Record<string,any>}
export interface NativeCapture {
    version:2;intentEntryId:string;sessionId:string;requestDigest:string;sealed:boolean;stopped:boolean;
    packets:number;logicalBytes:number;messageDigest:string;encodedBytes:number;encodedSha256:string;body:string;
}
export const transportPacketId=(intent:string,sequence:number)=>`transport_${intent}_${sequence}`;

/** Synchronous bounded view for original submission/material consumers. No I/O. */
export function projectNativePackets(physical:NativeRecord[],intent:string,records:readonly TransportRecord[]):NativeRecord[]{
    const byId=new Map(physical.map(e=>[e.id,e]));
    if(byId.size!==physical.length)fail('ambiguous physical record identity');
    const groups=new Map<string,TransportRecord[]>();let previous=-1;
    const positions=new Map(physical.map((e,i)=>[e.id,i]));
    for(const [index,record]of records.entries()){
        const position=positions.get(record.anchor);
        if(record.sequence!==index+1||position===undefined||position<previous||byId.has(transportPacketId(intent,record.sequence)))fail('packet identity/anchor order');
        previous=position;const group=groups.get(record.anchor)??[];group.push(record);groups.set(record.anchor,group);
    }
    const out:NativeRecord[]=[],tails=new Map<string,string>();
    for(const original of physical){
        const parentId= tails.get(original.parentId??'')??original.parentId;const entry={...original,...(parentId!==undefined?{parentId}:{})};out.push(entry);let parent=entry.id;
        for(const record of groups.get(entry.id)??[]){const id=transportPacketId(intent,record.sequence);const entry={type:'custom',customType:kinds.sdk,id,parentId:parent,data:{intentEntryId:intent,sequence:record.sequence,message:record.message}};out.push(entry);parent=id;}
        tails.set(entry.id,parent);
    }
    return out;
}
export function decodeNativeTuples(bytes:Buffer):TransportRecord[]{
    if(bytes.length>limits.logicalBytes+limits.reserveBytes)fail('capsule logical bound');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),records:TransportRecord[]=[];let start=0;
    for(let at=0;at<text.length;at++)if(text.charCodeAt(at)===10){
        const line=text.slice(start,at);if(!line||Buffer.byteLength(line)>limits.eventBytes+1024)fail('capsule record bound');
        const tuple=JSON.parse(line);if(!Array.isArray(tuple)||tuple.length!==3||serialized(tuple)!==line)fail('capsule tuple shape');
        const record:TransportRecord={sequence:tuple[0],anchor:tuple[1],message:tuple[2]};
        if(typeof record.anchor!=='string'||record.anchor.length>200||
            !object(record.message)||typeof record.message.type!=='string'||Buffer.byteLength(serialized(record.message))>limits.eventBytes||record.sequence!==records.length+1)fail('capsule record shape');
        records.push(record);if(records.length>limits.packets+1)fail('capsule cardinality');start=at+1;
    }
    if(start!==text.length)fail('capsule tuple tail incomplete');
    return records;
}
function decodeCapture(entry:NativeRecord,intent:NativeRecord):TransportRecord[]{
    const c=entry.data as NativeCapture;
    if(!object(c)||Object.keys(c).sort().join(',')!=='body,encodedBytes,encodedSha256,intentEntryId,logicalBytes,messageDigest,packets,requestDigest,sealed,sessionId,stopped,version'||c.version!==2||c.intentEntryId!==intent.id||c.sessionId!==intent.data.sessionId||
        c.requestDigest!==sha(serialized(intent.data.request))||typeof c.sealed!=='boolean'||typeof c.stopped!=='boolean'||
        !Number.isSafeInteger(c.packets)||c.packets<0||c.packets>limits.packets+1||!Number.isSafeInteger(c.logicalBytes)||c.logicalBytes<0||c.logicalBytes>limits.logicalBytes+limits.reserveBytes||
        !Number.isSafeInteger(c.encodedBytes)||c.encodedBytes<1||c.encodedBytes>limits.encodedBytes+limits.reserveBytes||typeof c.body!=='string'||
        c.body.length>Math.ceil((limits.encodedBytes+limits.reserveBytes)/3)*4)fail('capsule descriptor bounds/binding');
    const encoded=Buffer.from(c.body,'base64');
    if(encoded.toString('base64')!==c.body||encoded.length!==c.encodedBytes||sha(encoded)!==c.encodedSha256)fail('capsule encoded correspondence');
    // Node's public info result is missing from the pinned declaration overload.
    const decoded=inflateRawSync(encoded,{info:true,maxOutputLength:limits.logicalBytes+limits.reserveBytes}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
    if(decoded.engine.bytesWritten!==encoded.length||decoded.buffer.length!==c.logicalBytes)fail('capsule logical correspondence');
    const records=decodeNativeTuples(decoded.buffer),hash=createHash('sha256');
    for(const record of records)hash.update(serialized(record.message)+'\n');
    if(records.length!==c.packets||hash.digest('hex')!==c.messageDigest)fail('capsule packet census/digest');
    return records;
}
/** Physical completed history is self-contained. Missing declared captures never look empty. */
export function expandNativeTransport(physical:NativeRecord[]):NativeRecord[]{
    for(const capture of physical.filter(e=>e.type==='custom'&&e.customType===kinds.capture)){
        const intent=physical.find(e=>e.id===capture.data?.intentEntryId&&e.customType===kinds.intent);
        if(!intent||!object(intent.data?.request?.binding)||nativeEvidencePolicyId(intent.data.request.binding)!==limits.id)fail('capsule has no supported original intent');
    }
    const intents=physical.filter(e=>e.type==='custom'&&e.customType===kinds.intent&&object(e.data?.request?.binding)&&nativeEvidencePolicyId(e.data.request.binding)===limits.id);
    if(!intents.length)return physical;
    const intentIds=new Set(intents.map(e=>e.id)),virtual=physical.filter(e=>e.customType===kinds.sdk&&intentIds.has(e.data?.intentEntryId));
    const virtualById=new Map(virtual.map(e=>[e.id,e]));
    if(virtualById.size!==virtual.length)fail('ambiguous virtual packet identities');
    for(const entry of virtual)if(entry.id!==transportPacketId(entry.data.intentEntryId,entry.data.sequence))fail('physical SDK records cannot replace a capsule');
    const base=physical.filter(e=>!virtualById.has(e.id)).map(entry=>{
        let parent=entry.parentId;const visited=new Set<string>();
        while(parent&&virtualById.has(parent)){if(visited.has(parent))fail('virtual parent cycle');visited.add(parent);parent=virtualById.get(parent)!.parentId;}
        return {...entry,...(parent!==undefined?{parentId:parent}:{})};
    });
    let view=base;
    for(const intent of intents){
        const captures=physical.filter(e=>e.type==='custom'&&e.customType===kinds.capture&&e.data?.intentEntryId===intent.id);
        if(captures.length!==1)fail('declared capsule missing/ambiguous');
        const capture=captures[0]!,records=decodeCapture(capture,intent);
        const positions=new Map(base.map((e,i)=>[e.id,i])),capturePosition=positions.get(capture.id)!;
        if(capturePosition<=positions.get(intent.id)!)fail('capsule precedes original intent');
        if(records.some(r=>!positions.has(r.anchor)||positions.get(r.anchor)!>=capturePosition))fail('packet anchor outside original capture');
        view=projectNativePackets(view,intent.id,records);
    }
    if(virtual.length&&!isDeepStrictEqual(view,physical))fail('virtual view differs from its original capsule');
    return view;
}
export function nativeCaptureBinding(entries:NativeRecord[],intent:NativeRecord,control:unknown):{kind:'embedded-envelope/v2';entryId:string;sha256:string}{
    const captures=entries.filter(e=>e.customType===kinds.capture&&e.data?.intentEntryId===intent.id);
    if(captures.length!==1)fail('successful source requires one capsule');const entry=captures[0]!,c=entry.data as NativeCapture;
    if(!c.sealed||c.stopped||!nativeCaptureFits(c,control))fail('capture did not admit a complete trace');
    return{kind:limits.id,entryId:entry.id,sha256:c.encodedSha256};
}

export function nativeCaptureFits(c:NativeCapture,control:unknown):boolean {
    const bytes=Buffer.byteLength(serialized(control));return bytes<=limits.eventBytes&&c.encodedBytes+bytes<=limits.encodedBytes&&c.logicalBytes+bytes<=limits.logicalBytes&&c.packets<=limits.packets;
}

export interface NativeStageAllocation {
    version:1;stagingName:string;intentEntryId:string;sessionId:string;requestDigest:string;writerPid:number;device:string;inode:string;
}
export const nativeStageByteLimit=limits.encodedBytes+limits.reserveBytes+8*(limits.packets+2)+4108;
const stageMagic=Buffer.from('GJSTAGE1');
const stageFrameByteLimit=limits.eventBytes+65536;
export function nativeStageHeader(allocation:NativeStageAllocation):Buffer{
    if(!object(allocation)||Object.keys(allocation).sort().join(',')!=='device,inode,intentEntryId,requestDigest,sessionId,stagingName,version,writerPid'||allocation.version!==1||
        typeof allocation.stagingName!=='string'||allocation.stagingName.length>200||path.basename(allocation.stagingName)!==allocation.stagingName||['.','..',''].includes(allocation.stagingName)||
        typeof allocation.intentEntryId!=='string'||!allocation.intentEntryId||allocation.intentEntryId.length>200||typeof allocation.sessionId!=='string'||!allocation.sessionId||allocation.sessionId.length>200||
        !/^[a-f0-9]{64}$/.test(allocation.requestDigest)||!Number.isSafeInteger(allocation.writerPid)||allocation.writerPid<1||typeof allocation.device!=='string'||!/^\d+$/.test(allocation.device)||typeof allocation.inode!=='string'||!/^\d+$/.test(allocation.inode))fail('staging allocation binding');
    const body=Buffer.from(serialized({version:allocation.version,stagingName:allocation.stagingName,intentEntryId:allocation.intentEntryId,sessionId:allocation.sessionId,requestDigest:allocation.requestDigest,writerPid:allocation.writerPid,device:allocation.device,inode:allocation.inode}));if(body.length>4096)fail('staging header bound');const length=Buffer.alloc(4);length.writeUInt32BE(body.length);
    return Buffer.concat([stageMagic,length,body]);
}
/** Physical prefix custody only. An incomplete tail is explicit, never discarded. */
export function decodeNativeStage(bytes:Buffer,allocation:NativeStageAllocation):{encoded:Buffer;frames:number;tailBytes:number}{
    const header=nativeStageHeader(allocation);
    if(bytes.length>nativeStageByteLimit||bytes.length<header.length||!bytes.subarray(0,header.length).equals(header))fail('staging header/bound correspondence');
    const chunks:Buffer[]=[];let at=header.length,encodedBytes=0,frames=0;
    while(at<bytes.length){
        if(bytes.length-at<8)break;
        const length=bytes.readUInt32BE(at),checksum=bytes.readUInt32BE(at+4);
        if(length<1||length>stageFrameByteLimit||++frames>limits.packets+2)fail('staging frame bound');
        if(bytes.length-at-8<length){frames--;break;}
        const chunk=bytes.subarray(at+8,at+8+length);
        if(crc32(chunk)!==checksum)fail('staging frame checksum');
        encodedBytes+=length;if(encodedBytes>limits.encodedBytes+limits.reserveBytes)fail('staging encoded bound');
        chunks.push(chunk);at+=8+length;
    }
    return{encoded:Buffer.concat(chunks),frames,tailBytes:bytes.length-at};
}
async function writeStageBytes(handle:FileHandle,bytes:Buffer,onWrite:(bytes:number)=>void=()=>{}):Promise<void>{
    let at=0;while(at<bytes.length){const {bytesWritten}=await handle.write(bytes,at,bytes.length-at,null);if(bytesWritten<1)fail('staging made no write progress');at+=bytesWritten;onWrite(bytesWritten);}
}

/** One finite staging owner; every original append joins one checksummed flush frame. */
export class NativeTransportWriter {
    readonly records:TransportRecord[]=[];
    private stream=createDeflateRaw();private chunks:Buffer[]=[];private offset:number;private encodedBytes=0;private frames=0;private logical=0;
    private fault:unknown;private closed=false;private stopped=false;private digest=createHash('sha256');
    private constructor(readonly path:string,private handle:FileHandle,readonly allocation:Readonly<NativeStageAllocation>,headerBytes:number){
        this.offset=headerBytes;
        this.stream.on('error',error=>{this.fault??=error;});
        this.stream.on('data',(chunk:Buffer)=>{this.chunks.push(chunk);});
    }
    static async open(file:string,binding:Pick<NativeStageAllocation,'intentEntryId'|'sessionId'|'requestDigest'>):Promise<NativeTransportWriter>{
        const handle=await fs.open(file,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
        try{
            const info=await handle.stat(),allocation=Object.freeze({version:1 as const,stagingName:path.basename(file),intentEntryId:binding.intentEntryId,sessionId:binding.sessionId,requestDigest:binding.requestDigest,writerPid:process.pid,device:String(info.dev),inode:String(info.ino)});
            const header=nativeStageHeader(allocation);await writeStageBytes(handle,header);
            return new NativeTransportWriter(file,handle,allocation,header.length);
        }catch(error){await handle.close();throw error;}
    }
    async removeStaging():Promise<void>{const info=await fs.lstat(this.path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||String(info.ino)!==this.allocation.inode||String(info.dev)!==this.allocation.device)fail('staging ownership changed');await fs.unlink(this.path);}
    private operation(action:(done:(error?:Error|null)=>void)=>void):Promise<void>{return new Promise((resolve,reject)=>{
        const failed=(error:Error)=>reject(error);this.stream.once('error',failed);
        action(error=>{this.stream.removeListener('error',failed);error?reject(error):resolve();});
    });}
    private async writeFrame():Promise<void>{
        const body=Buffer.concat(this.chunks);this.chunks=[];
        if(!body.length)return;
        if(body.length>stageFrameByteLimit||this.encodedBytes+body.length>limits.encodedBytes+limits.reserveBytes||++this.frames>limits.packets+2||this.offset+body.length+8>nativeStageByteLimit)fail('staging frame/encoded reserve exceeded');
        const header=Buffer.alloc(8);header.writeUInt32BE(body.length);header.writeUInt32BE(crc32(body),4);
        await writeStageBytes(this.handle,Buffer.concat([header,body]),written=>{this.offset+=written;});this.encodedBytes+=body.length;
    }
    async append(anchor:string,message:Record<string,any>):Promise<void>{
        if(this.closed||this.stopped)fail('staging intake is closed');
        const canonical=serialized(message),captured=JSON.parse(canonical);
        if(!object(captured)||typeof captured.type!=='string')fail('unsupported SDK envelope');
        if(Buffer.byteLength(canonical)>limits.eventBytes){this.stopped=true;throw Error('NATIVE_CAPTURE_EVENT_LIMIT: unsupported single event');}
        const record={sequence:this.records.length+1,anchor,message:captured},raw=serialized([record.sequence,record.anchor,record.message])+'\n';
        const crossing=this.logical+Buffer.byteLength(raw)>limits.logicalBytes||record.sequence>limits.packets;
        this.records.push(record);this.logical+=Buffer.byteLength(raw);this.digest.update(canonical+'\n');
        try{
            await this.operation(done=>this.stream.write(raw,done));await this.operation(done=>this.stream.flush(z.Z_SYNC_FLUSH,done));await this.writeFrame();
            if(this.fault)throw this.fault;
            if(crossing||this.encodedBytes>limits.encodedBytes){this.stopped=true;throw Error('NATIVE_CAPTURE_LIMIT_RETAINED: original packet retained; staging capture stopped');}
        }catch(error){this.stopped=true;this.fault??=error;throw error;}
    }
    async finish(intentEntryId:string,sessionId:string,request:unknown):Promise<NativeCapture>{
        if(this.closed)fail('staging already joined');this.closed=true;
        if(intentEntryId!==this.allocation.intentEntryId||sessionId!==this.allocation.sessionId||sha(serialized(request))!==this.allocation.requestDigest){
            this.stream.destroy();if(!this.stream.closed)await new Promise<void>(resolve=>this.stream.once('close',resolve));await this.handle.close();fail('staging original owner/request changed before finish');
        }
        let sealed=false;
        try{
            if(this.fault)throw this.fault;
            await new Promise<void>((resolve,reject)=>{this.stream.once('error',reject);this.stream.once('end',resolve);this.stream.end();});await this.writeFrame();
            if(this.fault)throw this.fault;sealed=true;
        }catch{this.stopped=true;this.stream.destroy();}
        finally{if(!this.stream.closed)await new Promise<void>(resolve=>this.stream.once('close',resolve));}
        let encoded:Buffer;
        try{
            if(sealed){
                const info=await this.handle.stat();if(!info.isFile()||info.nlink!==1||String(info.ino)!==this.allocation.inode||String(info.dev)!==this.allocation.device||info.size!==this.offset||info.size>nativeStageByteLimit)fail('staging file identity/size changed');
                const bytes=Buffer.alloc(this.offset);let at=0;while(at<bytes.length){const read=await this.handle.read(bytes,at,bytes.length-at,at);if(!read.bytesRead)fail('staging shortened');at+=read.bytesRead;}
                const stage=decodeNativeStage(bytes,this.allocation);if(stage.tailBytes)fail('sealed staging has an incomplete frame');encoded=stage.encoded;
            }else{
                // The already-received in-memory packet is also conserved after a failed stage write.
                encoded=deflateRawSync(this.records.map(r=>serialized([r.sequence,r.anchor,r.message])+'\n').join(''));
            }
        }finally{await this.handle.close();}
        if(encoded.length>limits.encodedBytes+limits.reserveBytes)fail('retained capsule exceeds declared reserve; original staging retained');
        return{version:2,intentEntryId,sessionId,requestDigest:sha(serialized(request)),sealed,stopped:this.stopped,
            packets:this.records.length,logicalBytes:this.logical,messageDigest:this.digest.digest('hex'),encodedBytes:encoded.length,encodedSha256:sha(encoded),body:encoded.toString('base64')};
    }
}
