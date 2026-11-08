import fsSync, { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { administration, sourceStat, type SourceCapture } from '../effects/source-snapshot-projection.js';
import type { SourceSnapshotProjectionReceipt } from '../effects/types.js';

export const sourcePublicationWindowBytes = 64 * 1024;
export type SourcePublicationSection = 'product' | 'whole-file' | 'omissions';

/** An ephemeral read scope over already verified original captures, never an action permission. */
export function sourcePublicationReader(input: {
    candidate: SourceCapture; projection: SourceSnapshotProjectionReceipt;
    signal: AbortSignal; assertCurrent(): void;
    track<T>(task: () => Promise<T>): Promise<T>;
}) {
    // No mutable caller-owned inventory or filesystem proof survives this boundary.
    const candidate = structuredClone(input.candidate), projection = structuredClone(input.projection);
    const projected = new Map(projection.projectedEntries.map(e => [e.path, e]));
    const blobs = new Map(projection.blobs.filter(e => e.side === 'candidate').map(e => [e.path, e]));
    const products = new Set(projection.product.map(e => e.path));
    const sections = {
        product: projection.product.map(e => {
            const entry = projected.get(e.path), file = candidate.files.get(e.path);
            return { ...e, disposition: entry ? 'published' : 'deleted',
                ...(entry ? { objectId: entry.objectId, mode: entry.mode, size: entry.size } : {}),
                ...(file ? { sha256: file.sha256 } : {}),
                content: !entry ? 'deleted' : file && !file.opaque ? 'text' : 'opaque' };
        }),
        'whole-file': projection.wholeFileAdditions,
        // This is the original complete execution/publication difference roster,
        // including administrative metadata and directory/link representation.
        omissions: projection.effectiveDifferences,
    };
    let closed = false;
    const pending = new Set<Promise<unknown>>();
    const check = () => {
        if (closed) throw Error('Source publication reader closed; reopen the original proposal');
        input.signal.throwIfAborted(); input.assertCurrent();
    };
    const track = <T>(task: () => Promise<T>): Promise<T> => {
        check(); const result = input.track(async () => { check(); return task(); });
        pending.add(result); void result.then(() => pending.delete(result), () => pending.delete(result));
        return result;
    };
    const fileMetadata = (name: string) => {
        if (fsSync.realpathSync(candidate.input.root) !== candidate.input.root) throw Error('Original publication capture ancestry changed');
        const parents = name.split('/'); parents.pop();
        for (const rel of ['', ...parents.map((_, i) => parents.slice(0, i + 1).join('/')), name]) {
            if (sourceStat(fsSync.lstatSync(path.join(candidate.input.root, rel))) !== candidate.identities.get(rel))
                throw Error('Original publication file or ancestry changed');
        }
    };
    return Object.freeze({
        readPage(request: { section: SourcePublicationSection; cursor?: number; limit?: number }) {
            check();
            if (!request || Object.keys(request).some(k => !['section', 'cursor', 'limit'].includes(k)) ||
                !Object.hasOwn(sections, request.section)) throw Error('Exact publication section required');
            const rows = sections[request.section], cursor = request.cursor ?? 0, limit = request.limit ?? 25;
            if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > rows.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
                throw Error('Bounded publication page required');
            const entries = []; let bytes = 0, index = cursor;
            while (index < rows.length && entries.length < limit) {
                const row = rows[index]!, size = Buffer.byteLength(JSON.stringify(row));
                if (size > sourcePublicationWindowBytes - 1024) throw Error('Publication row exceeds readable page bound');
                if (bytes + size > sourcePublicationWindowBytes - 1024) break;
                entries.push(structuredClone(row)); bytes += size; index++;
            }
            check();
            return { section: request.section, cursor, total: rows.length, entries, nextCursor: index < rows.length ? index : null,
                meaning: request.section === 'omissions' ? 'execution-to-published differences' : request.section === 'whole-file' ? 'entire candidate files, including preexisting untracked contents' : 'published product and deletions' };
        },
        readFile(request: { path: string; offset?: number }) {
            const captured = structuredClone(request);
            return track(async () => {
                if (!captured || Object.keys(captured).some(k => !['path', 'offset'].includes(k)) || typeof captured.path !== 'string' ||
                    administration(captured.path) || !products.has(captured.path) || !projected.has(captured.path)) throw Error('Exact published candidate file required');
                const file = candidate.files.get(captured.path), entry = projected.get(captured.path)!;
                if (!file || file.opaque) throw Error('Original published text unavailable; inspect retained metadata');
                const blob = blobs.get(file.path);
                if (!blob || blob.sha256 !== file.sha256 || blob.objectId !== entry.objectId || blob.size !== file.size || blob.effectiveMode !== file.effectiveMode ||
                    entry.size !== file.size || (entry.mode === '100755') !== !!(file.effectiveMode & 0o111)) throw Error('Published candidate representation differs');
                const offset = captured.offset ?? 0;
                if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) throw Error('Exact bounded UTF-8 byte offset required');
                fileMetadata(file.path); check();
                const name = path.join(candidate.input.root, file.path);
                const handle = await fs.open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                let result;
                try {
                    check(); fileMetadata(file.path);
                    if (sourceStat(await handle.stat()) !== file.identity) throw Error('Original publication file FD changed');
                    check();
                    const buffer = Buffer.alloc(Math.min(sourcePublicationWindowBytes + 1, file.size - offset));
                    let size = 0;
                    while (size < buffer.length) {
                        check(); const read = await handle.read(buffer, size, buffer.length - size, offset + size);
                        if (!read.bytesRead) throw Error('Original publication file truncated');
                        size += read.bytesRead;
                    }
                    if (size && (buffer[0]! & 0xc0) === 0x80) throw Error('Publication offset must start at a UTF-8 boundary');
                    let end = Math.min(size, sourcePublicationWindowBytes);
                    if (end < size) while (end && (buffer[end]! & 0xc0) === 0x80) end--;
                    const bytes = buffer.subarray(0, end);
                    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
                    if (sourceStat(await handle.stat()) !== file.identity) throw Error('Original publication file changed during read');
                    result = { path: file.path, offset, bytes: end, totalBytes: file.size, sha256: file.sha256,
                        windowSha256: createHash('sha256').update(bytes).digest('hex'), text, nextOffset: offset + end < file.size ? offset + end : null };
                } finally { await handle.close(); }
                // Close itself awaited; no result survives a stale scope or path swap.
                fileMetadata(file.path); check(); return result;
            });
        },
        async close() { closed = true; await Promise.allSettled([...pending]); },
    });
}
