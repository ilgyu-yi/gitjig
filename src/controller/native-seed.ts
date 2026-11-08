import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeCheckpoint } from './history.js';
import { inside, privateDirectory, privateFile } from './ownership.js';
type Checkpoint = Awaited<ReturnType<typeof nativeCheckpoint>>;
export interface NativeSeed {
    format: 'gitjig-native-seed-1';
    operationId: string;
    createdAt: number;
    kind: 'clone' | 'fork';
    source: {
        conversationId: string;
        generation: number;
        projectId: string | null;
        modelRevision: number;
        sessionId: string;
        historyRef: string;
        checkpoint: Checkpoint;
        selectedLeaf: string;
    };
    destination: {
        conversationId: string;
        sessionId: string;
        historyRef: string;
        checkpoint: Checkpoint;
    };
}
interface Destination {
    conversationId: string;
    nativeSessionId: string | null;
    historyRef: string | null;
}
function record(value: unknown, keys: string[]): asserts value is Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw new Error('Invalid native seed record');
}
function text(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\x00-\x1f\x7f-\x9f]/u.test(value);
}
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
function checkpoint(value: unknown): asserts value is Checkpoint {
    record(value, ['sessionId', 'leafId', 'bytes', 'sha256']);
    if (!text(value.sessionId) || !text(value.leafId) || !integer(value.bytes) || value.bytes < 1 || value.bytes > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/u.test(value.sha256))
        throw new Error('Invalid native seed checkpoint');
}
function nativePath(root: string, file: string) {
    if (!path.isAbsolute(file) || path.resolve(file) !== file || !inside(root, file) || file === root)
        throw new Error('Native seed history outside owned state');
}
export function validateNativeSeed(value: unknown, expected: Destination, stateRoot: string): NativeSeed {
    record(value, ['format', 'operationId', 'createdAt', 'kind', 'source', 'destination']);
    record(value.source, ['conversationId', 'generation', 'projectId', 'modelRevision', 'sessionId', 'historyRef', 'checkpoint', 'selectedLeaf']);
    record(value.destination, ['conversationId', 'sessionId', 'historyRef', 'checkpoint']);
    const source = value.source, destination = value.destination;
    if (value.format !== 'gitjig-native-seed-1' || !text(value.operationId) || !integer(value.createdAt) || !['clone', 'fork'].includes(value.kind) ||
        !text(source.conversationId) || !integer(source.generation) || !(source.projectId === null || text(source.projectId)) || !integer(source.modelRevision) ||
        !text(source.sessionId) || !text(source.historyRef) || !text(source.selectedLeaf) || !text(destination.conversationId) || !text(destination.sessionId) || !text(destination.historyRef))
        throw new Error('Invalid native seed provenance');
    checkpoint(source.checkpoint);
    checkpoint(destination.checkpoint);
    if (source.checkpoint.sessionId !== source.sessionId || destination.checkpoint.sessionId !== destination.sessionId ||
        source.conversationId === destination.conversationId || source.sessionId === destination.sessionId || source.historyRef === destination.historyRef ||
        destination.conversationId !== expected.conversationId || destination.sessionId !== expected.nativeSessionId || destination.historyRef !== expected.historyRef)
        throw new Error('Native seed destination identity mismatch');
    nativePath(stateRoot, source.historyRef);
    nativePath(stateRoot, destination.historyRef);
    return structuredClone(value) as NativeSeed;
}
async function ownedHistory(root: string, file: string) {
    nativePath(root, file);
    for (const directory of new Set([root, path.dirname(file)])) {
        const info = await fs.lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || await fs.realpath(directory) !== directory)
            throw new Error('Native seed history parent is not canonical owner-only state');
    }
    await privateFile(file);
}
/** Opening old SDK files can migrate/rewrite them; refuse before that side effect. */
export async function currentNativeHeader(file: string, expectedSession: string) {
    const { CURRENT_SESSION_VERSION } = await import('@earendil-works/pi-coding-agent');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const bytes = Buffer.alloc(8192), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const line = bytes.subarray(0, bytesRead).toString('utf8').split('\n')[0];
        if (!line || !bytes.subarray(0, bytesRead).includes(10))
            throw new Error('Native seed header exceeds bound');
        const header = JSON.parse(line);
        if (header.type !== 'session' || header.id !== expectedSession || header.version !== CURRENT_SESSION_VERSION)
            throw new Error('Native seed requires current-format history; migrate the source explicitly');
        return header;
    }
    finally {
        await handle.close();
    }
}
function exact(actual: Checkpoint, expected: Checkpoint) {
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256 || actual.sessionId !== expected.sessionId || actual.leafId !== expected.leafId)
        throw new Error('Native seed source changed during preparation');
}
/** Internal history dependency only. This grants no work, review or execution standing. */
export async function openNativeSeedHistory(value: unknown, expected: Destination, stateRoot: string) {
    const seed = validateNativeSeed(value, expected, stateRoot), file = seed.destination.historyRef;
    await ownedHistory(stateRoot, file);
    const before = await nativeCheckpoint(file, seed.destination.checkpoint);
    const header = await currentNativeHeader(file, seed.destination.sessionId);
    if (header.parentSession !== seed.source.historyRef)
        throw new Error('Native seed parent session mismatch');
    const { SessionManager } = await import('@earendil-works/pi-coding-agent');
    const manager = SessionManager.open(file, path.dirname(file));
    const after = await nativeCheckpoint(file, seed.destination.checkpoint);
    exact(after, before);
    if (manager.getSessionId() !== seed.destination.sessionId || manager.getHeader()?.parentSession !== seed.source.historyRef)
        throw new Error('Native seed opened identity mismatch');
    return { sessionManager: manager, cwd: manager.getCwd() };
}
/** Caller must later provide source lifecycle exclusion and atomic origin registration.
 * This helper writes only unregistered private preparation files, never controller rows. */
export async function prepareNativeSeed(input: {
    stateRoot: string;
    cwd: string;
    kind: NativeSeed['kind'];
    destinationId: string;
    source: NativeSeed['source'];
}): Promise<NativeSeed> {
    input = structuredClone(input);
    const operationId = randomUUID(), parent = path.join(input.stateRoot, 'native-forks'), operation = path.join(parent, operationId);
    await privateDirectory(input.stateRoot);
    await privateDirectory(parent);
    await fs.mkdir(operation, { mode: 0o700 });
    try {
        await ownedHistory(input.stateRoot, input.source.historyRef);
        checkpoint(input.source.checkpoint);
        exact(await nativeCheckpoint(input.source.historyRef, input.source.checkpoint), input.source.checkpoint);
        await currentNativeHeader(input.source.historyRef, input.source.sessionId);
        const { SessionManager } = await import('@earendil-works/pi-coding-agent');
        const manager = SessionManager.open(input.source.historyRef, operation, input.cwd);
        if (!manager.getEntry(input.source.selectedLeaf))
            throw new Error('Selected native seed leaf unavailable');
        const output = manager.createBranchedSession(input.source.selectedLeaf);
        if (!output)
            throw new Error('Native seed output unavailable');
        try {
            await fs.access(output);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                throw new Error('Native seed file deferred: selected path has no conversation');
            throw error;
        }
        await ownedHistory(input.stateRoot, output);
        const receipt: NativeSeed = { format: 'gitjig-native-seed-1', operationId, createdAt: Date.now(), kind: input.kind, source: input.source,
            destination: { conversationId: input.destinationId, sessionId: manager.getSessionId(), historyRef: output, checkpoint: await nativeCheckpoint(output) } };
        await openNativeSeedHistory(receipt, { conversationId: input.destinationId, nativeSessionId: receipt.destination.sessionId, historyRef: output }, input.stateRoot);
        exact(await nativeCheckpoint(input.source.historyRef, input.source.checkpoint), input.source.checkpoint);
        return receipt;
    }
    catch (error) {
        throw new Error(`Native seed preparation unavailable; retained operation ${operation}: ${error instanceof Error ? error.message : 'unknown failure'}`, { cause: error });
    }
}
