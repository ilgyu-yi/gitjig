import { readNativeRoleOutput } from '../workflow/native-role-output.js';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
export async function nativeCheckpoint(file: string, expected?: {
    sessionId: string;
    leafId: string;
    bytes: number;
    sha256: string;
}, recovery?: {
    sessionId: string;
    ownerInput: string;
}) {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 32 * 1024 * 1024)
            throw new Error('native history unsupported/empty');
        while (true) {
            const buffer = Buffer.alloc(64 * 1024), read = await handle.read(buffer, 0, buffer.length, null);
            if (!read.bytesRead)
                break;
            bytes += read.bytesRead;
            if (bytes > 32 * 1024 * 1024)
                throw new Error('native history exceeds bound');
            chunks.push(buffer.subarray(0, read.bytesRead));
        }
    }
    finally {
        await handle.close();
    }
    const buffer = Buffer.concat(chunks), text = buffer.toString('utf8'), lines = text.trim().split('\n').filter(line => line.trim());
    const { parseSessionEntries } = await import('@earendil-works/pi-coding-agent');
    const entries = parseSessionEntries(text);
    if (entries.length !== lines.length || entries.length < 2)
        throw new Error('incomplete/corrupt native history');
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
    return { leafId, sessionId: header.id, bytes, sha256: createHash('sha256').update(buffer).digest('hex') };
}

/** Select an explicit role source. A native formatter record never falls back to
 * the last conversational assistant; historical assistant semantics stay local. */
export function readSelectedRoleOutput(entries: any[], expected: {
    entryId: string; sessionId: string; launchId: string; role: string; checkpointLeafId: string;
    stage?: string; nativeIntent?: import('../workflow/native-role-output.js').NativeRoleIntentReceipt; allowLegacyString?: boolean; strictLegacyBlocks?: boolean;
}, source?: import('../workflow/native-role-output.js').NativeRoleSource | null): string {
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
