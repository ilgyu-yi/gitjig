import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { capture, validateManifest } from './capture.js';
import { privateDirectory } from './ownership.js';
import { inspectLocalGit, localRoster } from './local-git.js';
import { ControllerError, type Project, type WorkView, type ObservationResult } from './types.js';
export interface LocalEvidenceSource {
    project: Project;
    work: WorkView;
    workGeneration: number;
    pending: boolean;
    capacityReleased: boolean;
    resultRow: {
        id: string;
        work: string;
        run: string;
        data: ObservationResult;
    } | null;
    run: {
        id: string;
        work: string;
        epoch: number;
        generation: number;
        phase: string;
        reservation: string;
        data: Record<string, unknown>;
    } | null;
    observations: {
        id: string;
        data: Record<string, unknown>;
    }[];
}
const unavailable = (message: string) => new ControllerError('LOCAL_EVIDENCE_UNAVAILABLE', message, 'Inspect the original local work/run and resolve pending or uncertain cleanup. Run an explicit applicable local check for the current source if evidence is missing or stale. This inspection neither executes a check nor grants commit authority.');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function localEvidenceBinding(before: LocalEvidenceSource) { return hash({ project: before.project, resultRow: before.resultRow, run: before.run, observations: before.observations, capacityReleased: before.capacityReleased }); }
/** Historical validation retains original identities without requiring later work to remain current. */
export function originalLocalEvidence(before: LocalEvidenceSource, historical = false) {
    const { work, run, resultRow } = before, result = resultRow?.data;
    if ((!historical && (work.state !== 'DELIVERED' || before.pending || work.obligations.length || work.allowance.reserved !== 0)) || !before.capacityReleased || !run || !resultRow || !result ||
        resultRow.work !== work.workId || resultRow.run !== run.id || result.workId !== work.workId || result.runId !== run.id || run.work !== work.workId || (!historical && (run.epoch !== work.epoch || run.generation !== before.workGeneration)) ||
        run.phase !== 'SETTLED' || run.reservation !== 'consumed' || run.data.resultId !== resultRow.id || run.data.kind !== 'command-observation' || result.kind !== 'command-observation' ||
        result.status !== 'succeeded' || result.exitCode !== 0 || result.cleanup !== 'removed' || run.data.cleanup !== 'removed')
        throw unavailable(historical ? 'Retained run has no fully settled successful original local-command evidence' : 'Current work has no fully settled successful original local-command evidence');
    if (result.actualCwd !== '/work' || run.data.cwd !== 'work')
        throw unavailable('Scratch-dependent command success does not establish staged-source applicability');
    const runtime = run.data.profile as Record<string, unknown> | null;
    if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) || typeof runtime.dockerBinary !== 'string' || !path.isAbsolute(runtime.dockerBinary) || typeof runtime.dockerContext !== 'string' || !runtime.dockerContext || typeof runtime.image !== 'string' || !runtime.image)
        throw unavailable('Original execution runtime identity is missing or malformed');
    const observations = before.observations.filter(o => o.data.kind === 'owner-command');
    if (observations.length !== 1)
        throw unavailable('Original owner command observation is missing or ambiguous');
    const observation = observations[0]!, manifest = validateManifest(run.data.manifest), command = run.data.raw;
    if (typeof command !== 'string' || !command || observation.data.command !== command || observation.data.cwd !== '/work' || observation.data.input !== manifest.digest || result.captureRef !== manifest.digest ||
        observation.data.exitCode !== 0 || Object.hasOwn(observation.data, 'termination'))
        throw unavailable('Original command, result and captured-source bindings disagree');
    return { work, run, resultRow, result, observation, manifest, command, runtime };
}
/** Read-only correspondence; lifecycle is owned and joined by the calling controller. */
export async function inspectLocalEvidence(input: {
    read: () => LocalEvidenceSource;
    installationHome: string;
    projectRoots: readonly string[];
    gitBinary: string;
    signal: AbortSignal;
}) {
    input.signal.throwIfAborted();
    const before = input.read(), { work, run, resultRow, result, observation, manifest, command, runtime } = originalLocalEvidence(before);
    const token = hash(before), assertCurrent = () => {
        input.signal.throwIfAborted();
        if (hash(input.read()) !== token)
            throw unavailable('Original project, work, run or command evidence changed during inspection');
    };
    const source = before.project.sourceRoot, root = await fs.stat(source, { bigint: true });
    const assertRoot = async () => {
        const now = await fs.stat(source, { bigint: true });
        if (!now.isDirectory() || now.dev !== root.dev || now.ino !== root.ino || await fs.realpath(source) !== source)
            throw unavailable('Registered source directory changed during evidence inspection');
    };
    await assertRoot();
    assertCurrent();
    const gitInput = { project: before.project, gitBinary: input.gitBinary, projectRoots: input.projectRoots, installationHome: input.installationHome, signal: input.signal, includeIndex: true };
    const git = await inspectLocalGit(gitInput), index = git.index!;
    if (index.intentToAdd || index.entries.some(e => e.stage !== 0 || !['100644', '100755'].includes(e.mode) || /^0+$/u.test(e.oid)))
        throw unavailable('Index contains intent-to-add, conflict, symlink, gitlink or unsupported entries; exact regular-file correspondence is unavailable');
    const inputs = path.join(input.installationHome, 'inputs');
    await privateDirectory(inputs);
    const temporary = await fs.mkdtemp(path.join(inputs, 'local-evidence-'));
    let quarantine = false;
    try {
        let current;
        try {
            current = validateManifest(await capture(source, temporary, before.project.captureProfile, input.signal).result);
        }
        catch (error) {
            if (String(error).includes('UNKNOWN_CAPTURE')) {
                quarantine = true;
                throw new ControllerError('LOCAL_EVIDENCE_CLEANUP_UNKNOWN', 'Evidence capture termination is unconfirmed', 'Retain and reconcile the exact private capture tree before maintenance: ' + temporary);
            }
            throw unavailable('Current source capture failed or was interrupted; no correspondence result is available');
        }
        assertCurrent();
        await assertRoot();
        const files = new Map(current.files.map(file => [file.path, file]));
        const mismatches: string[] = [];
        for (const entry of index.entries) {
            input.signal.throwIfAborted();
            const file = files.get(entry.path);
            if (!file) {
                mismatches.push(entry.path);
                continue;
            }
            const actualMode = file.mode & 0o100 ? '100755' : '100644';
            const blob = createHash(index.objectFormat).update(`blob ${file.size}\0`), content = createHash('sha256');
            let bytes = 0;
            for await (const chunk of (await fs.open(path.join(temporary, entry.path), 'r')).createReadStream()) {
                input.signal.throwIfAborted();
                bytes += chunk.length;
                content.update(chunk);
                blob.update(chunk);
            }
            if (bytes !== file.size || content.digest('hex') !== file.sha256)
                throw unavailable('Private captured file no longer matches its original worker manifest');
            if (blob.digest('hex') !== entry.oid || actualMode !== entry.mode)
                mismatches.push(entry.path);
        }
        const later = await inspectLocalGit(gitInput);
        assertCurrent();
        await assertRoot();
        if (git.head !== later.head || git.branch !== later.branch || index.fingerprint !== later.index!.fingerprint)
            throw unavailable('Git HEAD, branch or full index changed during evidence inspection');
        const currentSource = current.digest === manifest.digest, status = currentSource && !mismatches.length ? 'CURRENT' : 'STALE';
        return { status, workId: work.workId, runId: run.id, resultId: resultRow.id, observationId: observation.id, command, cwd: result.actualCwd, scratchInput: result.scratchInput, runtime,
            provenanceHash: localEvidenceBinding(before), originalCapture: manifest.digest, currentCapture: current.digest, sourceMatches: currentSource, index: { roster: localRoster(index.entries, true), fingerprint: index.fingerprint, objectFormat: index.objectFormat, entries: index.entries.length, head: git.head, branch: git.branch, mismatchedPaths: mismatches.slice(0, 100), remainingMismatches: Math.max(0, mismatches.length - 100) },
            scope: 'Exact successful owner command against captured /work source, with current raw-file/index correspondence. Not test adequacy, review, commit approval or an immutable commit reservation.',
            limitations: [...result.limitations, ...git.limitations, 'Scratch remains mutable-or-unknown. Correspondence identifies captured source, not all command dependencies or test adequacy.', 'Capture includes all original source entries, including Git metadata, ignored and untracked files; any captured change conservatively makes source evidence stale.', 'Extra captured non-index files remain execution context and are not claimed as committed product.', 'Inspection is non-atomic; a future commit action must revalidate original evidence and its actual candidate.'],
            nextAction: status === 'CURRENT' ? 'Assess command adequacy and review the actual staged diff. Commit separately with trusted Git; this result is not a commit authorization.' : 'Inspect changed source or index mappings and run the applicable command again for the intended candidate; preserve the old result as historical evidence.' };
    }
    finally {
        if (!quarantine)
            try {
                await fs.rm(temporary, { recursive: true, force: true });
            }
            catch {
                throw new ControllerError('LOCAL_EVIDENCE_CLEANUP_UNKNOWN', 'Temporary evidence capture cleanup failed', 'Inspect and reconcile this private capture tree: ' + temporary);
            }
    }
}
