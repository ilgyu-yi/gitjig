import fs from 'node:fs/promises';
import fsSync, { constants } from 'node:fs';
import path from 'node:path';
import type { Store } from './store.js';
import { hash } from './change-files.js';
import { privateFile } from './ownership.js';
import { classifyLegacyCreateRejection, type CreateRejectionEvidence } from '../execution/create-rejection.js';
const maxRecordBytes = 65536;
// A startup run retains the complete captured manifest, unlike its small
// controller, source and journal records.
const maxRunRecordBytes = 8 * 1024 * 1024;
const maxRunHistoryBytes = 16 * 1024 * 1024;
const clean = new Set(['removed', 'not-allocated', 'unbound']);
const bounded = (column: string, max = maxRecordBytes) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
type Row = Record<string, any>;
export interface StartupCleanupSnapshot {
    work: Row;
    source: Row;
    conversation: Row;
    view: Row;
    input: Row;
    inputSource: Row;
    run: Row;
    runs: Row[];
    observations: Row[];
    observation: Row;
    leases: Row[];
    budgets: Row[];
    journal: Awaited<ReturnType<typeof readJournal>>;
    runtimeCensus: {
        file: string;
        digest: string;
    }[];
    evidence: CreateRejectionEvidence;
}
function object(raw: unknown): Record<string, any> {
    if (typeof raw !== 'string')
        throw Error('Original recovery record is missing or exceeds its bounded profile');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original recovery record is not an object');
    return value;
}
function noNativeExecution(data: Record<string, any>): boolean {
    return !data.attainedNative && !data.allocatedNative && !data.containerId &&
        !data.nativeSessionId && !data.historyRef && !data.nativeCheckpoint &&
        !data.nativePromptAttempted && !data.nativeInputObserved && !data.modelDispatchAttempted &&
        !data.nativeManualAttempted && !data.nativeUserBashAttempted;
}
function assertRunHistoryBound(store: Store, workId: string): void {
    const size = store.one(`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes,
        COALESCE(MAX(length(CAST(data AS BLOB))),0) AS largest FROM runs WHERE work=?`, workId);
    if (size.count < 1 || size.count > 128 || size.bytes > maxRunHistoryBytes || size.largest > maxRunRecordBytes)
        throw Error('Original startup history exceeds the bounded recovery profile');
}
async function readJournal(file: string, directory: string) {
    if (path.dirname(file) !== directory || !/^[a-f0-9-]{36}\.json$/u.test(path.basename(file)))
        throw Error('Original create rejection does not identify an owned runtime journal');
    const parent = await fs.lstat(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() ||
        (parent.mode & 0o077) !== 0 || await fs.realpath(directory) !== directory)
        throw Error('Original runtime journal directory is not canonical owner-private storage');
    await privateFile(file);
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() ||
            (before.mode & 0o077) !== 0 || before.size > maxRecordBytes)
            throw Error('Original runtime journal is unsafe or exceeds its bounded profile');
        const buffer = Buffer.alloc(maxRecordBytes + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const after = await handle.stat();
        if (bytesRead > maxRecordBytes || before.size !== bytesRead || before.size !== after.size ||
            before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
            throw Error('Original runtime journal changed during inspection');
        const raw = buffer.subarray(0, bytesRead).toString('utf8');
        return { file, raw, value: object(raw), digest: hash(raw) };
    }
    finally {
        await handle.close();
    }
}
function runtimeJournalCensus(directory: string, workId: string, runId: string, selected: string) {
    const parent = fsSync.lstatSync(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() ||
        (parent.mode & 0o077) !== 0 || fsSync.realpathSync(directory) !== directory)
        throw Error('Runtime journal census is not canonical owner-private storage');
    const names = fsSync.readdirSync(directory).filter(name => name.endsWith('.json')).sort();
    if (names.length > 512)
        throw Error('Runtime journal population exceeds the bounded recovery profile');
    let bytes = 0, matching = 0;
    const census = names.map(name => {
        const file = path.join(directory, name);
        const descriptor = fsSync.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const info = fsSync.fstatSync(descriptor);
            bytes += info.size;
            if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 ||
                info.size > maxRecordBytes || bytes > 4194304)
                throw Error('Runtime journal census is unsafe or exceeds the bounded recovery profile');
            const buffer = Buffer.alloc(maxRecordBytes + 1);
            const count = fsSync.readSync(descriptor, buffer, 0, buffer.length, 0);
            const after = fsSync.fstatSync(descriptor);
            if (count !== info.size || count > maxRecordBytes || after.size !== info.size ||
                after.ctimeMs !== info.ctimeMs || after.mtimeMs !== info.mtimeMs)
                throw Error('Runtime journal changed during recovery census');
            const raw = buffer.subarray(0, count).toString('utf8'), value = object(raw);
            if (value.workId === workId && value.runId === runId) {
                matching++;
                if (file !== selected || matching !== 1)
                    throw Error('Original startup has contradictory or duplicate runtime journals');
            }
            return { file, digest: hash(raw) };
        }
        finally {
            fsSync.closeSync(descriptor);
        }
    });
    if (matching !== 1)
        throw Error('Original startup runtime journal correspondence changed');
    return census;
}
/** Reopening cannot select a removed journal while hiding another same-run scope. */
export function assertUniqueStartupJournal(directory: string, workId: string, runId: string, file: string): void {
    runtimeJournalCensus(directory, workId, runId, file);
}
/** Final synchronous correspondence check; the controller owns lifecycle exclusion. */
export function assertStartupCleanupSnapshot(store: Store, captured: StartupCleanupSnapshot, expectedJournalDigest = captured.journal.digest): void {
    const workId = captured.work.id, conversationId = captured.conversation.id, runId = captured.run.id;
    assertRunHistoryBound(store, workId);
    const current = {
        work: store.one(`SELECT id,project,source,predecessor,lineage,state,epoch,generation,current_result,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, workId),
        source: store.one(`SELECT id,conversation,${bounded('origin')} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, captured.source.id),
        conversation: store.one('SELECT * FROM conversations WHERE id=?', conversationId),
        view: store.one(`SELECT conversation,native_id,work,direction,resource,human_used,archived,${bounded('data')} AS data FROM conversation_state WHERE conversation=?`, conversationId),
        input: store.one(`SELECT id,conversation,generation,work,source,state,mode,${bounded('data')} AS data FROM conversation_inputs WHERE id=?`, captured.input.id),
        inputSource: store.one(`SELECT id,conversation,${bounded('origin')} AS origin FROM sources WHERE id=?`, captured.inputSource.id),
        runs: store.all(`SELECT id,work,epoch,generation,phase,staging,reservation,${bounded('data', maxRunRecordBytes)} AS data FROM runs WHERE work=? ORDER BY rowid LIMIT 129`, workId),
        observations: store.all(`SELECT id,run,${bounded('data')} AS data FROM observations WHERE run=? ORDER BY rowid LIMIT 2`, runId),
        leases: store.all(`SELECT id,work,run,epoch,sequence,state,${bounded('data')} AS data FROM capacity_leases WHERE run=? LIMIT 2`, runId),
        budgets: store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', captured.work.lineage),
    };
    const expected = {
        work: captured.work, source: captured.source, conversation: captured.conversation, view: captured.view,
        input: captured.input, inputSource: captured.inputSource, runs: captured.runs, observations: captured.observations,
        leases: captured.leases, budgets: captured.budgets,
    };
    if (hash(current) !== hash(expected) ||
        store.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED')", conversationId) ||
        store.one('SELECT id FROM effect_operations WHERE work=?', workId) ||
        store.one("SELECT id FROM conversation_assignments WHERE work=? OR json_extract(data,'$.source.workId')=?", workId, workId) ||
        store.one('SELECT id FROM works WHERE lineage=? AND id<>?', captured.work.lineage, workId) ||
        store.one("SELECT id FROM capacity_leases WHERE work=? AND run<>? AND state NOT IN ('RELEASED','CANCELLED')", workId, runId) ||
        store.one('SELECT work FROM change_state WHERE work=?', workId))
        throw Error('Original startup recovery changed; reopen /work');
    const census = runtimeJournalCensus(path.dirname(captured.journal.file), workId, runId, captured.journal.file);
    // Settlement supplies the exact bytes it durably wrote. All other journal
    // bytes and the complete population remain bound to the reviewed snapshot.
    const expectedCensus = captured.runtimeCensus.map(item => item.file === captured.journal.file
        ? { ...item, digest: expectedJournalDigest } : item);
    if (!/^[a-f0-9]{64}$/u.test(expectedJournalDigest) || hash(census) !== hash(expectedCensus))
        throw Error('Runtime journal population changed; reopen /work');
}
/** Original create-refusal evidence only; current daemon absence cannot supply this proof. */
export async function inspectStartupCleanupRecovery(store: Store, home: string, workId: string, busy: (id: string) => boolean) {
    const holds: string[] = [];
    let conversationId: string | null = null;
    let captured: StartupCleanupSnapshot | undefined;
    const review: {
        runId?: string;
        journalFile?: string;
        reason: string;
        scope: string;
    } = {
        reason: 'An original complete Docker create rejection can establish that no container was allocated.',
        scope: 'Recover this same failed ordinary startup only. Preserve request, history, model, work identity and spent allowance. No request is retried or withdrawn automatically.',
    };
    try {
        const work = store.one(`SELECT id,project,source,predecessor,lineage,state,epoch,generation,current_result,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, workId);
        if (!work || work.state !== 'UNKNOWN' || work.lineage !== work.id || work.predecessor || work.current_result ||
            !Number.isSafeInteger(work.epoch) || work.epoch < 1 || !Number.isSafeInteger(work.generation) || work.generation < 1 || busy(workId))
            throw Error('Select an idle independent original ordinary work with unresolved startup cleanup');
        const data = object(work.data);
        if (data.kind !== 'ordinary-conversation' || data.assignmentId || Object.hasOwn(data, 'invocation') ||
            Object.hasOwn(data, 'contextOrigin') || Object.hasOwn(data, 'contextContinuation') || typeof data.conversation !== 'string')
            throw Error('Delegated, governed and context-derived work keep their original recovery');
        conversationId = data.conversation;
        const source = store.one(`SELECT id,conversation,${bounded('origin')} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, work.source);
        const origin = object(source?.origin);
        if (origin.kind !== 'owner-conversation-input' || origin.uid !== process.getuid?.() || source.conversation !== conversationId || !source.raw?.trim())
            throw Error('Original owner input provenance is unavailable');
        const conversation = store.one('SELECT * FROM conversations WHERE id=?', conversationId);
        const view = store.one(`SELECT conversation,native_id,work,direction,resource,human_used,archived,${bounded('data')} AS data FROM conversation_state WHERE conversation=?`, conversationId);
        const viewData = object(view?.data);
        if (!conversation || conversation.history || conversation.project !== work.project || view.work !== workId ||
            view.archived || view.native_id || !['IDLE', 'UNKNOWN'].includes(view.resource) || viewData.lifecycle?.deleted ||
            Object.hasOwn(viewData, 'role') || Object.hasOwn(viewData, 'nativeInputRecovery') ||
            viewData.dialogs?.length || viewData.waitHandles?.length || viewData.continuationAuthorized)
            throw Error('Original conversation has native history, changed ownership or another recovery obligation');
        if (store.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED')", conversationId) ||
            store.one('SELECT id FROM effect_operations WHERE work=?', workId) ||
            store.one("SELECT id FROM conversation_assignments WHERE work=? OR json_extract(data,'$.source.workId')=?", workId, workId) ||
            store.one('SELECT id FROM works WHERE lineage=? AND id<>?', work.lineage, workId) ||
            store.one('SELECT work FROM change_state WHERE work=?', workId))
            throw Error('Original work has dependent work, a goal or external-operation obligations');
        assertRunHistoryBound(store, workId);
        const runs = store.all(`SELECT id,work,epoch,generation,phase,staging,reservation,${bounded('data', maxRunRecordBytes)} AS data FROM runs WHERE work=? ORDER BY rowid LIMIT 129`, workId);
        const run = runs.at(-1)!;
        const runData = object(run.data);
        review.runId = run.id;
        if (run.phase !== 'UNKNOWN' || run.reservation !== 'consumed' || run.epoch !== work.epoch ||
            run.generation !== work.generation || run.generation !== conversation.generation ||
            viewData.runId !== run.id || run.staging !== path.join(home, 'inputs', run.id) ||
            runData.kind !== 'ordinary-conversation' || runData.conversation !== conversationId ||
            runData.outcome !== 'unavailable' || !String(runData.cleanup).startsWith('quarantined') ||
            !runData.attainedCapture || !runData.manifest || !noNativeExecution(runData))
            throw Error('Original run is not a capture-complete failed startup before native execution');
        for (const prior of runs.slice(0, -1)) {
            const priorData = object(prior.data);
            if (prior.phase !== 'SETTLED' || !['consumed', 'released'].includes(prior.reservation) ||
                priorData.kind !== 'ordinary-conversation' || priorData.conversation !== conversationId ||
                priorData.outcome !== 'unavailable' || !clean.has(priorData.cleanup) || !noNativeExecution(priorData))
                throw Error('An earlier original run has execution or cleanup obligations');
        }
        const input = store.one(`SELECT id,conversation,generation,work,source,state,mode,${bounded('data')} AS data FROM conversation_inputs WHERE id=?`, runData.initialInputId);
        const inputData = object(input?.data);
        const inputSource = store.one(`SELECT id,conversation,${bounded('origin')} AS origin FROM sources WHERE id=?`, input.source);
        const inputOrigin = object(inputSource?.origin);
        if (input.conversation !== conversationId || input.work !== workId || input.generation !== run.generation ||
            input.state !== 'INITIAL_RESERVED' || input.mode !== 'idle' || inputData.assignment || inputData.goalId ||
            inputSource.conversation !== conversationId || inputOrigin.kind !== 'owner-conversation-input' || inputOrigin.uid !== process.getuid?.())
            throw Error('Original failed input correspondence is unavailable');
        const observations = store.all(`SELECT id,run,${bounded('data')} AS data FROM observations WHERE run=? ORDER BY rowid LIMIT 2`, run.id);
        if (observations.length !== 1)
            throw Error('Original startup needs exactly its retained controller failure observation');
        const observation = observations[0]!;
        const diagnostic = object(observation.data);
        const prefix = 'Error: scope create uncertain/failed; retained ';
        const marker = ': Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ';
        if (diagnostic.kind !== 'ordinary-response-unavailable' || typeof diagnostic.error !== 'string' ||
            !diagnostic.error.startsWith(prefix) || diagnostic.error.indexOf(marker, prefix.length) < 0)
            throw Error('Original native create rejection is unavailable; current absence is not historical proof');
        const journalFile = diagnostic.error.slice(prefix.length, diagnostic.error.indexOf(marker, prefix.length));
        const journal = await readJournal(journalFile, path.join(home, 'state', 'runtime'));
        const runtimeCensus = runtimeJournalCensus(path.dirname(journalFile), workId, run.id, journalFile);
        if (runtimeCensus.find(item => item.file === journalFile)?.digest !== journal.digest)
            throw Error('Original runtime journal changed during recovery inspection');
        review.journalFile = journalFile;
        const saved = journal.value;
        const runtime = runData.runtimeProfile;
        if (saved.version !== 1 || saved.workId !== workId || saved.runId !== run.id ||
            !/^[a-f0-9-]{36}$/u.test(saved.nonce) || saved.name !== `gitjig-${saved.nonce}` ||
            path.basename(journalFile) !== `${saved.nonce}.json` || saved.id !== undefined || saved.nativeCleanupUnknown ||
            !['creating', 'quarantined'].includes(saved.state) || saved.absenceEvidence ||
            saved.creationBinding !== undefined && (saved.creationBinding?.version !== 1 || saved.creationBinding.state !== 'UNAVAILABLE' ||
                typeof saved.creationBinding.reason !== 'string' || !saved.creationBinding.reason.length || saved.creationBinding.reason.length > 1024) ||
            !/^[a-zA-Z0-9_.-]{1,100}$/u.test(saved.context) || !runtime || runtime.dockerContext !== saved.context ||
            runtime.dockerConfigDirectory !== saved.dockerConfigDirectory)
            throw Error('Original runtime journal does not match this failed create and selected route');
        const evidence = classifyLegacyCreateRejection(diagnostic.error, journalFile, run.staging);
        if (!evidence)
            throw Error('Original create result does not establish preallocation rejection');
        const leases = store.all(`SELECT id,work,run,epoch,sequence,state,${bounded('data')} AS data FROM capacity_leases WHERE run=? LIMIT 2`, run.id);
        if (leases.length !== 1 || leases[0]!.id !== runData.capacityId || leases[0]!.state !== 'QUARANTINED' ||
            leases[0]!.work !== workId || leases[0]!.epoch !== run.epoch ||
            store.one("SELECT id FROM capacity_leases WHERE work=? AND run<>? AND state NOT IN ('RELEASED','CANCELLED')", workId, run.id))
            throw Error('Original quarantined capacity reservation is unavailable');
        const budgets = store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', work.lineage);
        if (budgets.length !== 2 || budgets.some(budget => !['execution', 'resolution'].includes(budget.kind) ||
            !Number.isSafeInteger(budget.lim) || !Number.isSafeInteger(budget.consumed) || budget.consumed < 0 ||
            budget.consumed > budget.lim || budget.reserved !== 0))
            throw Error('Original spent allowance or shared reservations are unsettled');
        captured = { work, source, conversation, view, input, inputSource, run, runs, observations, observation, journal, leases, budgets, runtimeCensus, evidence };
    }
    catch (error) {
        holds.push(error instanceof Error ? error.message : 'Original startup cleanup evidence unavailable');
    }
    return { workId, conversationId, eligible: holds.length === 0, holds, review, fingerprint: hash({ workId, conversationId, captured, holds }), captured };
}
