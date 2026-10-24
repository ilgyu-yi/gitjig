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
