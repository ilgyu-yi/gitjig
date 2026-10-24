import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export const governedDetailBytes = 16 * 1024 * 1024;
export interface GovernedDetailReference {
    kind: 'governed-work-detail/v1';
    sha256: string;
    bytes: number;
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Governed observation unavailable');
    return value as Record<string, any>;
};
const rootPath = (home: string) => path.join(home, 'artifacts');
async function rootIdentity(home: string) {
    const root = rootPath(home);
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || await fs.realpath(root) !== root)
        throw Error('Governed detail requires the original private artifact root');
    return `${stat.dev}:${stat.ino}`;
}
function reference(value: unknown): GovernedDetailReference {
    const ref = object(value);
    if (ref.kind !== 'governed-work-detail/v1' || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > governedDetailBytes)
        throw Error('Governed detail reference unavailable');
    return ref as GovernedDetailReference;
}
/** Every operation is joined before the observed deadline is reported. */
export async function readGovernedDetail(home: string, value: unknown, validate: () => void = () => {}) {
    const ref = reference(value), deadline = performance.now() + 5000;
    const check = () => { validate(); if (performance.now() > deadline) throw Error('Governed detail IO budget exceeded'); };
    check();
    const root = await rootIdentity(home); check();
    const file = path.join(rootPath(home), 'governed-detail-' + ref.sha256 + '.json');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        check();
        const stat = await handle.stat(); check();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size !== ref.bytes) throw Error('Governed detail file identity unavailable');
        const buffer = Buffer.alloc(ref.bytes + 1);
        let length = 0;
        while (length < buffer.length) {
            const read = await handle.read(buffer, length, buffer.length - length, length); check();
            if (!read.bytesRead) break;
            length += read.bytesRead;
        }
        const bytes = buffer.subarray(0, length);
        const after = await handle.stat(); check();
        if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || bytes.length !== ref.bytes || digest(bytes) !== ref.sha256 || await rootIdentity(home) !== root)
            throw Error('Governed detail content changed');
        const current = await fs.lstat(file); check();
        if (current.dev !== stat.dev || current.ino !== stat.ino || current.isSymbolicLink()) throw Error('Governed detail path changed');
        // Strict decoding also prevents replacement characters from changing page boundaries.
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return bytes;
    } finally { await handle.close(); check(); }
}

/** Serialize before the first await: later caller/ledger mutation cannot alter this snapshot. */
export async function prepareGovernedResult(home: string, value: unknown, validate: () => void) {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') throw Error('Governed detail unavailable');
    const bytes = Buffer.from(encoded);
    if (!bytes.length || bytes.length > governedDetailBytes) throw Error('Governed detail exceeds16MiB');
    const full = object(JSON.parse(encoded));
    if (typeof full.workId !== 'string' || !Number.isSafeInteger(full.epoch) || full.epoch < 1 || typeof full.phase !== 'string' || typeof full.reviewReady !== 'boolean')
        throw Error('Governed observation identity unavailable');
    const detailRef: GovernedDetailReference = {kind: 'governed-work-detail/v1', sha256: digest(bytes), bytes: bytes.length};
    const compact = {
        kind: 'governed-work-observation/v1', workId: full.workId, epoch: full.epoch, phase: full.phase, reviewReady: full.reviewReady,
        ownerActivation: full.ownerActivation ?? null, state: full.state ?? null,
        baseVersion: full.baseVersion ?? null, candidateVersion: full.candidateVersion ?? null,
        planVersion: full.planVersion ?? null, verificationVersion: full.verificationVersion ?? null,
        selectedVersions: Object.fromEntries(['baseVersion', 'candidateVersion', 'planVersion', 'verificationVersion'].map(key => {
            const version = Array.isArray(full.versions) ? full.versions.find((entry: any) => entry.id === full[key]) : null;
            return [key, version ? {id: version.id, hash: version.hash} : null];
        })),
        execution: full.execution ?? null, resolution: full.resolution ?? null,
        blocked: Array.isArray(full.blocked) ? [...full.blocked] : [], nextAction: full.nextAction ?? '',
        omitted: {blocked: 0, nextAction: 0, checkIds: 0, reviewLaunchIds: 0},
        selectedEvidence: {selectionIdsDigest: full.selectedEvidence?.selectionIdsDigest ?? null,
            sourceImpactsDigest: full.selectedEvidence?.sourceImpactsDigest ?? null,
            ...(full.selectedEvidence?.verificationStrategyDigest ? {verificationStrategyDigest: full.selectedEvidence.verificationStrategyDigest} : {}),
            checkIds: [...(full.selectedEvidence?.checkIds ?? [])], reviewLaunchIds: [...(full.selectedEvidence?.reviewLaunchIds ?? [])]},
        ...(full.assignmentHold ? {assignmentHold: full.assignmentHold} : {}),
        counts: Object.fromEntries(['versions', 'launches', 'checks', 'occurrences', 'dispositions'].map(key => [key, Array.isArray(full[key]) ? full[key].length : 0])),
        detailRef,
        detailRead: {detail: 'governed-work-detail/v1', fingerprint: detailRef.sha256, cursor: 0},
        detailInstruction: 'Use conversation_result with this same resultId and the detailRead operands for the exact original details; omissions are not successful evidence.',
    };
    const oversized = () => Buffer.byteLength(JSON.stringify(compact)) > 8 * 1024;
    if (oversized() && Buffer.byteLength(JSON.stringify(compact.nextAction)) > 1024) {compact.nextAction = null; compact.omitted.nextAction = 1;}
    while (oversized() && compact.blocked.length) {compact.blocked.pop(); compact.omitted.blocked++;}
    while (oversized() && compact.selectedEvidence.checkIds.length) {compact.selectedEvidence.checkIds.pop(); compact.omitted.checkIds++;}
    while (oversized() && compact.selectedEvidence.reviewLaunchIds.length) {compact.selectedEvidence.reviewLaunchIds.pop(); compact.omitted.reviewLaunchIds++;}
    if (oversized()) {compact.nextAction = null; compact.omitted.nextAction = 1;}
    if (oversized()) throw Error('Compact governed identity envelope unavailable');
    const deadline = performance.now() + 5000;
    const check = () => { validate(); if (performance.now() > deadline) throw Error('Governed detail IO budget exceeded'); };
    check();
    const root = await rootIdentity(home); check();
    const file = path.join(rootPath(home), 'governed-detail-' + detailRef.sha256 + '.json');
    const temporary = path.join(rootPath(home), '.governed-detail-' + randomUUID());
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let identity: Awaited<ReturnType<typeof handle.stat>> | undefined, failure: unknown, failed = false;
    try {
        try { identity = await handle.stat(); check(); await handle.writeFile(bytes); check(); await handle.sync(); check(); }
        catch (error) { failure = error; failed = true; }
        try { await handle.close(); }
        catch (error) { failure = failed ? new AggregateError([failure, error], 'Governed detail write and close failed') : error; failed = true; }
        if (failed) throw failure;
        check();
        try { await fs.link(temporary, file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        check();
    } catch (error) { failure = error; failed = true; }
    finally {
        try {
            const current = await fs.lstat(temporary);
            if (!identity || current.dev !== identity.dev || current.ino !== identity.ino || await rootIdentity(home) !== root)
                throw Error('Governed temporary detail identity changed; original retained');
            await fs.unlink(temporary);
        } catch (error) {
            failure = failed ? new AggregateError([failure, error], 'Governed detail preparation and temporary cleanup failed') : error;
            failed = true;
        }
    }
    if (failed) throw failure;
    check();
    await readGovernedDetail(home, detailRef, check);
    check();
    return compact;
}
