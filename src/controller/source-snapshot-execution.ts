import path from 'node:path';
import { createHash } from 'node:crypto';
import { hash } from './change-files.js';
import { samePreviewDatabaseScope, validPreviewWriterWitness, type PreviewWriterWitness } from './source-preview-writer.js';
import type { SourceSnapshotAnchor } from './source-snapshot-records.js';
import type { NativeGitNamespaceProof, SourceBranchCreationReceipt, SourceBranchPreparedReference, SourceBranchReconciliation } from '../effects/types.js';
import { createdSourceBranch, sourceGitArguments, sourcePushArguments, type NativeGitClient } from '../effects/native-git.js';

export type SourceSnapshotNativeClient = Pick<NativeGitClient,'prepareSourceBranchCreate'|'preparedSourceReference'|'spawnPreparedSourceBranchCreate'|'reconcileSourceBranchCreate'>;
export interface SourceSnapshotAttempt {
    revision: 1; runId: string; admissionId: string; intentId: string | null; settlementId: string | null;
}
interface Event {
    protocol: 'source-native-attempt/v1'; operationId: string; adoptionId: string; bindingDigest: string;
    revision: 1; runId: string; writer: PreviewWriterWitness;
}
export interface SourceNativeAdmission extends Event {
    kind: 'source-native-admission'; initializedDigest: string; namespace: NativeGitNamespaceProof;
    originalWorkState: 'ACTIVE' | 'DELIVERED'; sourceId: string; epoch: number; generation: number;
}
export interface SourceNativeIntent extends Event {
    kind: 'source-native-send-intent'; admissionId: string; prepared: SourceBranchPreparedReference;
}
export interface SourceNativeSettlement extends Event {
    kind: 'source-native-settlement'; admissionId: string; intentId: string | null;
    prepared: SourceBranchPreparedReference | null; send: SourceBranchCreationReceipt | null;
    readback: SourceBranchReconciliation | null; cleanup: 'removed' | 'not-allocated' | 'quarantined';
    classification: 'confirmed' | 'definitely-unsent' | 'unknown'; reason: string;
}
export interface SourceNativeHold extends Event {
    kind: 'source-native-resource-hold'; admissionId: string; priorState: 'ACTIVE' | 'DELIVERED';
}
export interface SourceNativeRestoration extends Event {
    kind: 'source-native-resource-restored'; admissionId: string; holdId: string;
}
export type SourceNativeEvent = SourceNativeAdmission | SourceNativeIntent | SourceNativeSettlement | SourceNativeHold | SourceNativeRestoration;
const fields = (v: any, names: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join();
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= max && !/[\x00-\x1f\x7f]/u.test(v);
const pid = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
const rawHash = (v: string) => createHash('sha256').update(v).digest('hex');
const common = ['protocol','kind','operationId','adoptionId','bindingDigest','revision','runId','writer'];
/** Preserve complete Unicode code points within the actual receipt byte limit. */
export function sourceAttemptReason(value:unknown,maxBytes=2048){
    const text=String(value instanceof Error?value.message:value);let result='',bytes=0;
    for(const character of text){const size=Buffer.byteLength(character);if(bytes+size>maxBytes)break;result+=character;bytes+=size;}
    return result;
}
function validNamespace(v: any, home: string, a: SourceSnapshotAnchor): v is NativeGitNamespaceProof {
    const root = path.join(home,'effects',a.operationId,'client');
    return fields(v,['protocol','clientRoot','device','inode','ownerUid','runsDirectory','runsDevice','runsInode','runsOwnerUid','gitBinary']) &&
        v.protocol === 'owned-native-git-prebirth/v1' && v.clientRoot === root && v.runsDirectory === path.join(root,'runs') &&
        ['device','inode','runsDevice','runsInode'].every(k => text(v[k],128) && /^\d+$/u.test(v[k])) && Number.isSafeInteger(v.ownerUid) && v.ownerUid >= 0 && v.runsOwnerUid === v.ownerUid &&
        text(v.gitBinary,4096) && path.isAbsolute(v.gitBinary) && path.normalize(v.gitBinary) === v.gitBinary;
}
export function validCommand(v: any, root: string): boolean {
    const required = ['argv','exitCode','stdout','stderr','truncated','timedOut','aborted','settled','stdoutBytes','stdoutSha256','stdoutExcerpted','commandId','journalPath','launcherPid','gitPid','gitStarted','cleanup'];
    if (!v || typeof v !== 'object' || Array.isArray(v) || required.some(k => !Object.hasOwn(v,k)) || Object.keys(v).some(k => ![...required,'sanitizedAuthDiagnostics','sanitizedPolicyDiagnostics'].includes(k))) return false;
    return ['sanitizedAuthDiagnostics','sanitizedPolicyDiagnostics'].every(k => !Object.hasOwn(v,k) || v[k] === true) &&
        Array.isArray(v.argv) && v.argv.length > 0 && v.argv.length <= 128 && v.argv.every((s: unknown) => text(s,16384)) &&
        (v.exitCode === null || Number.isSafeInteger(v.exitCode) && v.exitCode >= 0) && typeof v.stdout === 'string' && typeof v.stderr === 'string' &&
        ['truncated','timedOut','aborted','settled','stdoutExcerpted','gitStarted'].every(k => typeof v[k] === 'boolean') &&
        Number.isSafeInteger(v.stdoutBytes) && v.stdoutBytes >= 0 && sha(v.stdoutSha256) && uuid(v.commandId) && v.journalPath === path.join(root,'runs',v.commandId) &&
        (v.launcherPid === null || pid(v.launcherPid)) && (v.gitPid === null || pid(v.gitPid)) && ['confirmed','unknown'].includes(v.cleanup) &&
        (v.stdoutExcerpted || v.stdoutBytes === Buffer.byteLength(v.stdout) && v.stdoutSha256 === rawHash(v.stdout));
}
function validSend(v: any, a: SourceSnapshotAnchor, root: string, prepared: SourceBranchPreparedReference | null): v is SourceBranchCreationReceipt {
    const required = ['operationId','handoff','outcome','integrationCommit','destinationRef'];
    if (!v || typeof v !== 'object' || Array.isArray(v) || required.some(k => !Object.hasOwn(v,k)) || Object.keys(v).some(k => ![...required,'command','notStarted','reason'].includes(k))) return false;
    if (v.operationId !== a.operationId || v.integrationCommit !== a.projectedCommit || v.destinationRef !== a.destinationRef || !['started','not-started'].includes(v.handoff) || !['created','refused','unknown'].includes(v.outcome) || Object.hasOwn(v,'reason') && (typeof v.reason !== 'string' || Buffer.byteLength(v.reason) > 2048)) return false;
    if (v.handoff === 'started') return !Object.hasOwn(v,'notStarted') && validCommand(v.command,root) && !!prepared && v.command.commandId === prepared.commandId;
    return v.outcome === 'refused' && !Object.hasOwn(v,'command') && (!Object.hasOwn(v,'notStarted') || fields(v.notStarted,['commandId','descriptorSha256','terminalSha256']) && uuid(v.notStarted.commandId) && sha(v.notStarted.descriptorSha256) && sha(v.notStarted.terminalSha256) && (!prepared || v.notStarted.commandId === prepared.commandId && v.notStarted.descriptorSha256 === prepared.descriptorSha256));
}
export function validReadback(v: any, a: SourceSnapshotAnchor, root: string): v is SourceBranchReconciliation {
    return v && typeof v === 'object' && !Array.isArray(v) && ['kind','currentCommit','commands'].every(k => Object.hasOwn(v,k)) &&
        Object.keys(v).every(k => ['kind','currentCommit','commands','reason'].includes(k)) && ['confirmed-creation','observed-desired-state','unknown'].includes(v.kind) &&
        (v.currentCommit === null || typeof v.currentCommit === 'string' && new RegExp('^[a-f0-9]{'+(a.objectFormat === 'sha1' ? 40 : 64)+'}$','u').test(v.currentCommit) && !/^0+$/u.test(v.currentCommit)) &&
        (!Object.hasOwn(v,'reason') || typeof v.reason === 'string' && Buffer.byteLength(v.reason) <= 2048) && Array.isArray(v.commands) && v.commands.length <= 64 && v.commands.every((c: unknown) => validCommand(c,root));
}
export function validSourceNativeAttempt(v: any): v is SourceSnapshotAttempt {
    return fields(v,['revision','runId','admissionId','intentId','settlementId']) && v.revision === 1 && uuid(v.runId) && uuid(v.admissionId) && (v.intentId === null || uuid(v.intentId)) && (v.settlementId === null || uuid(v.settlementId));
}
export function validSourcePreparedReference(v: any, a: SourceSnapshotAnchor, root: string): v is SourceBranchPreparedReference {
    return fields(v,['protocol','clientRoot','commandId','descriptorSha256','descriptorIdentity','commandDirectoryIdentity','operationId','integrationCommit','destinationRef','tree','basisCommit']) &&
        v.protocol === 'source-branch-prepared/v1' && v.clientRoot === root && uuid(v.commandId) && sha(v.descriptorSha256) &&
        text(v.descriptorIdentity,1024) && text(v.commandDirectoryIdentity,512) &&
        v.operationId === a.operationId && v.integrationCommit === a.projectedCommit && v.destinationRef === a.destinationRef && v.tree === a.projectedTree && v.basisCommit === a.basisCommit;
}
/** Recorded attempt correspondence only. Actual Native proof and authority are separate. */
export function inspectSourceNativeAttempt(input: {
    home: string; anchor: SourceSnapshotAnchor; adoptionId: string; attempt: SourceSnapshotAttempt; namespace: unknown;
    phase: string; receipts: { id: string; kind: string; data: string }[]; run: any; capacity: any[];
}) {
    const { home, anchor: a, attempt, run } = input, events = new Map<string,SourceNativeEvent>();
    if (!validNamespace(input.namespace,home,a) || !validSourceNativeAttempt(attempt) || !run || run.id !== attempt.runId || run.work !== a.workId || run.epoch !== a.epoch || run.generation !== a.generation || run.staging !== input.namespace.clientRoot ||
        !['CREATED','WAITING_CAPACITY','RUNNING','SETTLED','INTERRUPTED','UNKNOWN'].includes(run.phase) || !['reserved','consumed','released'].includes(run.reservation)) throw Error('Original source attempt/run unavailable');
    const data = JSON.parse(run.data);
    if (!data || data.kind !== 'native-effect' || data.nativeFamily !== 'source-snapshot' || data.familyVersion !== 1 || data.operationId !== a.operationId || data.clientRoot !== input.namespace.clientRoot || data.bindingDigest !== hash(a) || data.attemptRevision !== 1 || data.nativeAdmissionId !== attempt.admissionId || !['unopened','enabled'].includes(data.nativeGate) ||
        Object.hasOwn(data,'retainedIntegrationRead') || Object.hasOwn(data,'readOnlyObservation')) throw Error('Original source native run binding unavailable');
    const cleanRun = ['SETTLED','INTERRUPTED'].includes(run.phase) && ['removed','not-allocated'].includes(data.cleanup) && ['consumed','released'].includes(run.reservation);
    if (['SETTLED','INTERRUPTED'].includes(run.phase) && !cleanRun || data.nativeGate === 'enabled' && run.reservation === 'released' ||
        run.reservation === 'released' && (data.nativeGate !== 'unopened' || data.admission !== 'never-admitted' || attempt.intentId !== null)) throw Error('Source gate/reservation settlement differs');
    if (input.receipts.length < 1 || input.receipts.length > 5) throw Error('Source attempt event count unavailable');
    for (const row of input.receipts) {
        const value = JSON.parse(row.data);
        const extra = row.kind === 'source-native-admission' ? ['initializedDigest','namespace','originalWorkState','sourceId','epoch','generation'] : row.kind === 'source-native-send-intent' ? ['admissionId','prepared'] : row.kind === 'source-native-settlement' ? ['admissionId','intentId','prepared','send','readback','cleanup','classification','reason'] : row.kind === 'source-native-resource-hold' ? ['admissionId','priorState'] : row.kind === 'source-native-resource-restored' ? ['admissionId','holdId'] : null;
        if (!extra || !uuid(row.id) || !fields(value,[...common,...extra]) || value.protocol !== 'source-native-attempt/v1' || value.kind !== row.kind || value.operationId !== a.operationId || value.adoptionId !== input.adoptionId || value.bindingDigest !== hash(a) || value.revision !== 1 || value.runId !== attempt.runId || !validPreviewWriterWitness(value.writer,home)) throw Error('Original source attempt event unavailable');
        if (events.has(row.id)) throw Error('Duplicate original source attempt event');
        events.set(row.id,value);
    }
    const admission = events.get(attempt.admissionId), intent = attempt.intentId ? events.get(attempt.intentId) : null, settlement = attempt.settlementId ? events.get(attempt.settlementId) : null;
    if (admission?.kind !== 'source-native-admission' || admission.initializedDigest !== a.initializedDigest || hash(admission.namespace) !== hash(input.namespace) || !['ACTIVE','DELIVERED'].includes(admission.originalWorkState) || admission.sourceId !== a.sourceId || admission.epoch !== a.epoch || admission.generation !== a.generation || data.controllerPid !== admission.writer.owner.pid || input.namespace.ownerUid !== admission.writer.owner.ownerUid) throw Error('Original source Native admission unavailable');
    if (input.capacity.length > 1) throw Error('Duplicate source attempt capacity');
    const lease = input.capacity[0], leaseData = lease ? JSON.parse(lease.data) : null;
    if (lease) {
        if (!uuid(lease.id) || lease.id !== data.capacityId || lease.work !== a.workId || lease.run !== run.id || lease.epoch !== a.epoch ||
            !['QUEUED','ADMITTED','SETTLING','QUARANTINED','RELEASED','CANCELLED'].includes(lease.state) || !leaseData || typeof leaseData.admitted !== 'boolean' || leaseData.kind !== 'check' || leaseData.ownerPid !== admission.writer.owner.pid ||
            (leaseData.admitted ? data.admission !== 'admitted' || ['QUEUED','CANCELLED'].includes(lease.state) || run.reservation === 'released' : data.admission !== 'never-admitted' || !['QUEUED','CANCELLED'].includes(lease.state)) ||
            lease.state === 'RELEASED' && (leaseData.receipt?.settled !== true || !['removed','not-allocated'].includes(leaseData.receipt?.cleanup) || leaseData.receipt.cleanup !== data.cleanup) ||
            data.nativeGate === 'enabled' && !leaseData.admitted) throw Error('Original source capacity/admission correspondence unavailable');
    } else if (Object.hasOwn(data,'capacityId') || data.nativeGate === 'enabled' || run.phase === 'WAITING_CAPACITY' || data.admission === 'admitted') throw Error('Original source capacity record unavailable');
    const intended = intent?.kind === 'source-native-send-intent' ? intent : null;
    if (attempt.intentId && (!intended || intended.admissionId !== attempt.admissionId || !validSourcePreparedReference(intended.prepared,a,input.namespace.clientRoot) || data.nativeGate !== 'enabled')) throw Error('Original source send intent unavailable');
    if (attempt.settlementId && (settlement?.kind !== 'source-native-settlement' || settlement.admissionId !== attempt.admissionId || settlement.intentId !== attempt.intentId || !['removed','not-allocated','quarantined'].includes(settlement.cleanup) || !['confirmed','definitely-unsent','unknown'].includes(settlement.classification) || typeof settlement.reason !== 'string' || Buffer.byteLength(settlement.reason) > 2048 || settlement.prepared !== null && !validSourcePreparedReference(settlement.prepared,a,input.namespace.clientRoot) || intent?.kind === 'source-native-send-intent' && hash(settlement.prepared) !== hash(intent.prepared))) throw Error('Original source attempt settlement unavailable');
    const classified = settlement?.kind === 'source-native-settlement' ? settlement : null;
    if (classified && classified.cleanup !== 'quarantined' && lease && !['RELEASED','CANCELLED'].includes(lease.state)) throw Error('Source settlement precedes capacity release');
    for (const e of events.values()) if (!samePreviewDatabaseScope(admission.writer,e.writer)) throw Error('Source attempt writer database scope differs');
    if (classified && (classified.send !== null && !validSend(classified.send,a,input.namespace.clientRoot,classified.prepared) || classified.readback !== null && !validReadback(classified.readback,a,input.namespace.clientRoot) ||
        !intended && (classified.send?.handoff === 'started' || classified.readback !== null) || data.nativeGate === 'unopened' && (classified.prepared !== null || classified.send !== null || classified.readback !== null) ||
        (classified.cleanup === 'quarantined' ? classified.classification !== 'unknown' || !(run.phase === 'UNKNOWN' && data.cleanup === 'quarantined' || cleanRun) : !cleanRun || data.cleanup !== classified.cleanup))) throw Error('Source settlement contradicts its native gate or physical run');
    const holds = [...events.entries()].filter(([,e])=>e.kind === 'source-native-resource-hold'), restorations = [...events.entries()].filter(([,e])=>e.kind === 'source-native-resource-restored');
    if (holds.length > 1 || restorations.length > 1 || holds.some(([,e])=>e.kind !== 'source-native-resource-hold' || e.admissionId !== attempt.admissionId || e.priorState !== admission.originalWorkState) || restorations.some(([,e])=>e.kind !== 'source-native-resource-restored' || e.admissionId !== attempt.admissionId || e.holdId !== holds[0]?.[0])) throw Error('Original source resource cause unavailable');
    if (restorations.length && (!holds.length || !cleanRun || lease && !['RELEASED','CANCELLED'].includes(lease.state))) throw Error('Source physical restoration precedes original joined settlement');
    if (events.size !== 1 + Number(!!intent) + Number(!!settlement) + holds.length + restorations.length) throw Error('Unreferenced source attempt event retained');
    if (classified?.classification === 'confirmed') {
        const sent = classified.send, observed = classified.readback;
        const read = observed?.commands.at(-1);
        const sendArguments = sourceGitArguments(path.join(input.namespace.clientRoot,'client.git'),sourcePushArguments(input.namespace.gitBinary,{integrationCommit:a.projectedCommit,target:{canonicalPath:a.projectRoot,destinationRef:a.destinationRef}}));
        const readArguments = sourceGitArguments(a.commonDirectory,['show-ref','--verify','--hash',a.destinationRef]);
        if (!intended || classified.cleanup !== 'removed' || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || !sent || sent.handoff !== 'started' || sent.outcome !== 'created' || !sent.command || !createdSourceBranch(sent.command,a.projectedCommit,a.destinationRef) || hash(sent.command.argv) !== hash(sendArguments) || !pid(sent.command.launcherPid) || !pid(sent.command.gitPid) || !sent.command.gitStarted || observed?.kind !== 'confirmed-creation' || observed.currentCommit !== a.projectedCommit || !read || read.exitCode !== 0 || !read.settled || read.cleanup !== 'confirmed' || read.aborted || read.timedOut || read.truncated || read.stdoutExcerpted || read.stdout.trim() !== a.projectedCommit || hash(read.argv) !== hash(readArguments)) throw Error('Recorded source confirmation lacks complete joined creation');
    }
    if (classified?.classification === 'definitely-unsent' && (classified.cleanup === 'quarantined' || classified.readback !== null || classified.send?.handoff === 'started' || (attempt.intentId !== null || classified.prepared !== null || classified.send !== null) && (!classified.prepared || classified.send?.handoff !== 'not-started' || !classified.send.notStarted))) throw Error('Recorded source refusal lacks affirmative no-launch');
    const expectedPhase = classified ? classified.classification === 'confirmed' ? 'CONFIRMED' : classified.classification === 'definitely-unsent' ? 'REFUSED' : 'UNKNOWN' : intent ? 'INVOKING' : 'RESERVED';
    if (input.phase !== expectedPhase && !(input.phase === 'UNKNOWN' && !classified)) throw Error('Source operation phase contradicts its original attempt');
    if (data.clientRoot !== path.join(home,'effects',a.operationId,'client')) throw Error('Original initialized source client differs');
    return structuredClone({ attempt, admission: admission as SourceNativeAdmission, intent: intended, settlement: classified, hold: holds[0] ? { id: holds[0][0], event: holds[0][1] as SourceNativeHold } : null, restored: restorations.length === 1 });
}
