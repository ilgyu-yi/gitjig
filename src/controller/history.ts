import {nativeHistoryByteLimit} from '../workflow/native-role-records.js';
import { readNativeRoleOutput,nativeRoleEntries } from '../workflow/native-role-output.js';
import fs from 'node:fs/promises';
import { closeSync,constants,fstatSync,lstatSync,openSync,readSync } from 'node:fs';
import type { FileEntry } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
export interface NativeHistoryCheckpoint {
    sessionId: string;
    leafId: string;
    bytes: number;
    sha256: string;
}
export interface NativeHistoryRecovery { sessionId: string; ownerInput: string }
/** Entries and checkpoint describe the same bounded bytes, without reopening the path. */
export async function readNativeHistorySnapshot(file: string, expected?: NativeHistoryCheckpoint, recovery?: NativeHistoryRecovery) {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > nativeHistoryByteLimit)
            throw new Error('native history unsupported/empty');
        while (true) {
            const buffer = Buffer.alloc(64 * 1024), read = await handle.read(buffer, 0, buffer.length, null);
            if (!read.bytesRead)
                break;
            bytes += read.bytesRead;
            if (bytes > nativeHistoryByteLimit)
                throw new Error('native history exceeds bound');
            chunks.push(buffer.subarray(0, read.bytesRead));
        }
    }
    finally {
        await handle.close();
    }
    return parseNativeHistory(Buffer.concat(chunks), expected, recovery);
}
function parseNativeHistory(buffer: Buffer, expected?: NativeHistoryCheckpoint, recovery?: NativeHistoryRecovery) {
    const bytes = buffer.length, text = buffer.toString('utf8'), lines = text.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2)
        throw new Error('incomplete/corrupt native history');
    let entries: FileEntry[];
    try {
        entries = lines.map(line => JSON.parse(line));
    } catch {
        throw new Error('incomplete/corrupt native history');
    }
    const header = entries[0];
    if (header?.type !== 'session')
        throw new Error('native session header absent');
    if (expected) {
        if (header.id !== expected.sessionId || buffer.length < expected.bytes || createHash('sha256').update(buffer.subarray(0, expected.bytes)).digest('hex') !== expected.sha256 || !entries.some(entry => entry.type !== 'session' && entry.id === expected.leafId))
            throw new Error('native checkpoint identity/content lost');
    }
    if (recovery && (header.id !== recovery.sessionId || !entries.some(entry => entry.type === 'message' && entry.message.role === 'user' && (typeof entry.message.content === 'string' ? entry.message.content : entry.message.content.filter(c => c.type === 'text').map(c => c.text).join('')) === recovery.ownerInput)))
        throw new Error('partial native history source/session mismatch');
    const leafId = entries.filter(entry => entry.type !== 'session').at(-1)?.id;
    if (!leafId)
        throw new Error('native history leaf absent');
    return { entries, checkpoint: { leafId, sessionId: header.id, bytes, sha256: createHash('sha256').update(buffer).digest('hex') } };
}
/** A synchronous eligibility read only needs the original sealed checkpoint prefix. */
export function readNativeCheckpointEntries(file: string, expected: NativeHistoryCheckpoint) {
    if (!Number.isSafeInteger(expected?.bytes) || expected.bytes < 1 || expected.bytes > nativeHistoryByteLimit)
        throw new Error('Invalid original native checkpoint size');
    const identity = nativeHistoryIdentity(file);
    if (!identity) throw new Error('Original native checkpoint file is unavailable');
    const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const bytes = Buffer.alloc(expected.bytes);
    try {
        const stat = fstatSync(descriptor);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size < bytes.length)
            throw new Error('Original native checkpoint bytes are unavailable');
        let read = 0;
        while (read < bytes.length) {
            const count = readSync(descriptor, bytes, read, bytes.length - read, read);
            if (!count) throw new Error('Short original native checkpoint');
            read += count;
        }
    } finally {
        closeSync(descriptor);
    }
    if (identity !== nativeHistoryIdentity(file)) throw new Error('Native history changed during checkpoint read');
    return parseNativeHistory(bytes, expected).entries;
}
export async function nativeCheckpoint(file: string, expected?: NativeHistoryCheckpoint, recovery?: NativeHistoryRecovery) {
    return (await readNativeHistorySnapshot(file, expected, recovery)).checkpoint;
}

/** Select an explicit role source. A native carrier record never falls back to
 * the last conversational assistant; historical assistant semantics stay local. */
export function readSelectedRoleOutput(entries: any[], expected: {
    entryId: string; sessionId: string; launchId: string; role: string; checkpointLeafId: string;
    stage?: string; nativeIntent?: import('../workflow/native-role-output.js').NativeRoleIntentReceipt; allowLegacyString?: boolean; strictLegacyBlocks?: boolean;
}, source?: import('../workflow/native-role-output.js').NativeRoleSource | null): string {
    const declaredNative=entries.some(entry=>entry.type==='custom'&&entry.customType===nativeRoleEntries.intent&&entry.data?.request?.binding?.launchId===expected.launchId&&Object.hasOwn(entry.data.request.binding,'nativeEvidencePolicy'));
    if ((expected.nativeIntent !== undefined||declaredNative) && !source)
        throw Error('NATIVE_FORMAT_SOURCE_UNAVAILABLE: captured native intent requires its original carrier source');
    if (source) {
        const receipt = expected.nativeIntent;
        if (!receipt || receipt.version !== 1 || receipt.launchId !== expected.launchId || receipt.role !== expected.role ||
            typeof receipt.stage !== 'string' || !receipt.stage || expected.stage !== undefined && receipt.stage !== expected.stage ||
            !Number.isSafeInteger(receipt.maxNativeTurns) || receipt.maxNativeTurns < 1 || receipt.maxNativeTurns > 100 ||
            [receipt.inputDigest,receipt.schemaDigest,receipt.requestDigest].some(value=>typeof value!=='string' || !/^[a-f0-9]{64}$/.test(value)))
            throw Error('NATIVE_FORMAT_SOURCE_UNAVAILABLE: original controller dispatch intent missing or changed');
        return readNativeRoleOutput(entries, expected.entryId, {...expected,stage:receipt.stage,inputDigest:receipt.inputDigest,
            schemaDigest:receipt.schemaDigest,requestDigest:receipt.requestDigest}, source);
    }
    const selected = entries.filter(entry => entry.id === expected.entryId);
    const entry = selected.length === 1 ? selected[0] : null;
    if (entry?.type !== 'message' || entry.message?.role !== 'assistant' || entry.message.stopReason !== 'stop')
        throw Error('Selected role assistant source unavailable');
    const content = entry.message.content;
    if (typeof content === 'string' && expected.allowLegacyString) return content;
    if (!Array.isArray(content) || expected.strictLegacyBlocks && !content.every((b: any) =>
        b?.type === 'text' && typeof b.text === 'string' || b?.type === 'thinking' && typeof b.thinking === 'string'))
        throw Error('Selected role assistant content unavailable');
    const texts = content.filter((b: any) => b?.type === 'text');
    if (texts.length !== 1 || typeof texts[0].text !== 'string') throw Error('Selected role assistant text unavailable');
    return texts[0].text;
}

/** Same fingerprint used by source accounting; a later change invalidates the witness. */
export function nativeHistoryIdentity(history:unknown):string|null{
    try{
        if(typeof history!=='string')return null;
        const stat=lstatSync(history,{bigint:true});
        if(stat.isFile()&&stat.nlink===1n)return createHash('sha256').update(JSON.stringify([stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String))).digest('hex');
    }catch{ /* Missing/replaced evidence is not current. */ }
    return null;
}
/** Entries, checkpoint and fingerprint must be consumed as one original observation. */
export async function readNativeHistoryWitness(file:string,expected?:NativeHistoryCheckpoint){
    const historyIdentity=nativeHistoryIdentity(file);
    if(!historyIdentity)throw Error('Native history identity unavailable');
    const snapshot=await readNativeHistorySnapshot(file,expected);
    if(nativeHistoryIdentity(file)!==historyIdentity)throw Error('Native history changed during witnessed read');
    return{...snapshot,historyIdentity};
}
