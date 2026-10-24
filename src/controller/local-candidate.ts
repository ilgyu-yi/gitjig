import { statSync, lstatSync, readdirSync, constants, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import type { Controller } from './controller.js';
import { ControllerError } from './types.js';
import { ApplicationLocalConventions, validateLocalConventions, type LocalConventions } from '../app/local-conventions.js';
import { directory, readObject, encodeObject } from '../app/storage.js';
import { parseUniqueJson } from '../workflow/json.js';
import { messageSnapshot, prepareLocalChange } from './local-preparation.js';
import { inspectLocalEvidence, localEvidenceBinding, originalLocalEvidence, type LocalEvidenceSource } from './local-evidence.js';
import { inspectLocalGit, localRoster } from './local-git.js';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable = (message: string) => new ControllerError('LOCAL_CANDIDATE_UNAVAILABLE', message, 'Inspect the exact retained candidate and original local check. Reprepare and rerun applicable checks for changed input. Native commits are retained; audit never amends, resets, commits or grants authority.');
type Identity = {
    device: string;
    inode: string;
};
export interface Candidate {
    version: 1;
    id: string;
    projectId: string;
    createdAt: string;
    home: {
        path: string;
        identity: Identity;
    };
    source: {
        path: string;
        identity: Identity;
    };
    index: {
        objectFormat: 'sha1' | 'sha256';
        roster: ReturnType<typeof localRoster>;
        parent: string | null;
        intendedBranch: string;
    };
    messageSha256: string;
    policy: {
        revision: number;
        hash: string;
        rules: LocalConventions;
    };
    check: {
        workId: string;
        runId: string;
        resultId: string;
        observationId: string;
        capture: string;
        binding: string;
    };
}
const identity = (file: string, privateMode = false) => { directory(file, privateMode); const st = statSync(file, { bigint: true }); return { device: st.dev.toString(), inode: st.ino.toString() }; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
function keys(v: unknown, list: string[]): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === list.length && list.every(k => Object.hasOwn(v, k)); }
function validIdentity(v: unknown) { return keys(v, ['device', 'inode']) && [v.device, v.inode].every(x => typeof x === 'string' && /^\d+$/u.test(x)); }
function validate(value: unknown): Candidate {
    if (!keys(value, ['version', 'id', 'projectId', 'createdAt', 'home', 'source', 'index', 'messageSha256', 'policy', 'check']) || value.version !== 1 || !uuid(value.id) || typeof value.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(value.projectId) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !sha(value.messageSha256))
        throw unavailable('Malformed retained candidate identity');
    for (const name of ['home', 'source']) {
        const root = value[name];
        if (!keys(root, ['path', 'identity']) || typeof root.path !== 'string' || !validIdentity(root.identity))
            throw unavailable('Malformed retained candidate root');
    }
    const index = value.index;
    if (!keys(index, ['objectFormat', 'roster', 'parent', 'intendedBranch']) || !['sha1', 'sha256'].includes(String(index.objectFormat)) || typeof index.intendedBranch !== 'string' || !index.intendedBranch || index.intendedBranch === '(detached)' || !(index.parent === null || typeof index.parent === 'string' && new RegExp('^[a-f0-9]{' + (index.objectFormat === 'sha1' ? 40 : 64) + '}$', 'u').test(index.parent)) || !keys(index.roster, ['sha256', 'entries', 'directories']) || !sha(index.roster.sha256) || ![index.roster.entries, index.roster.directories].every(n => Number.isSafeInteger(n) && Number(n) >= 0))
        throw unavailable('Malformed retained full-tree roster');
    const policy = value.policy, check = value.check;
    if (!keys(policy, ['revision', 'hash', 'rules']) || !Number.isSafeInteger(policy.revision) || Number(policy.revision) < 1 || !sha(policy.hash) || !same(validateLocalConventions(policy.rules), policy.rules) || hash(policy.rules) !== policy.hash)
        throw unavailable('Malformed retained convention snapshot');
    if (!keys(check, ['workId', 'runId', 'resultId', 'observationId', 'capture', 'binding']) || !['workId', 'runId', 'resultId', 'observationId'].every(k => typeof check[k] === 'string' && check[k] && String(check[k]).length <= 200) || !sha(check.capture) || !sha(check.binding))
        throw unavailable('Malformed retained original check binding');
    return value as unknown as Candidate;
}
function storage(controller: Controller, create = false) {
    const home = controller.applicationHome(), folder = join(home, 'local-candidates');
    directory(folder, true, create);
    return { home, folder, owner: () => {
            if (controller.applicationHome() !== home)
                throw unavailable('Application home changed');
            directory(folder, true);
        } };
}
function load(controller: Controller, id: string, projectId: string) {
    if (!uuid(id))
        throw unavailable('Select an exact retained candidate UUID');
    const store = storage(controller), file = join(store.folder, id + '.json');
    let raw = Buffer.alloc(0), record: Candidate;
    try {
        record = validate(readObject(file, true, bytes => {
            if (!isUtf8(bytes))
                throw Error('Invalid UTF-8');
            if (bytes.length)
                parseUniqueJson(bytes.toString('utf8'));
            raw = Buffer.from(bytes);
        }));
    }
    catch (error) {
        if (error instanceof ControllerError)
            throw error;
        throw unavailable('Retained candidate is missing, unsafe, malformed or oversized');
    }
    const assertCurrent = () => {
        store.owner();
        const project = controller.listProjects().find(p => p.id === projectId);
        if (record.id !== id || record.projectId !== projectId || record.home.path !== store.home || !same(record.home.identity, identity(store.home, true)) || !project || project.sourceRoot !== record.source.path || !same(record.source.identity, identity(project.sourceRoot)))
            throw unavailable('Candidate belongs to another home, project or source directory identity');
        let later = Buffer.alloc(0);
        readObject(file, true, bytes => { later = Buffer.from(bytes); });
        if (!raw.equals(later))
            throw unavailable('Retained candidate changed during audit');
    };
    assertCurrent();
    return { record, assertCurrent, fingerprint: createHash('sha256').update(raw).digest('hex') };
}
/** Native human Git makes the commit; this entry only retains precommit correspondence. */
export async function createLocalCandidate(input: {
    assertCurrent?: () => void;
    controller: Controller;
    projectId: string;
    workId: string;
    gitBinary: string;
    messageFile: string;
    signal: AbortSignal;
    read: () => LocalEvidenceSource;
}) {
    input.assertCurrent?.();
    const store = storage(input.controller, true), homeIdentity = identity(store.home, true), conventions = new ApplicationLocalConventions(input.controller), policy = conventions.prepare(input.projectId), sourceIdentity = identity(policy.project.sourceRoot), message = messageSnapshot(input.messageFile);
    if (!message.text.endsWith('\n') || message.text.includes('\r'))
        throw unavailable('Exact commit message requires LF line endings and a final LF; use native git commit --cleanup=verbatim -F with this same file');
    const common = { projectId: input.projectId, gitBinary: input.gitBinary, installationHome: store.home, projectRoots: input.controller.listProjects().map(p => p.sourceRoot), signal: input.signal };
    const prepared = await prepareLocalChange({ ...common, conventions, messageFile: input.messageFile });
    if (prepared.status !== 'PASS')
        throw unavailable('Local preparation has failed or unavailable rules; run local prepare and resolve its diagnostics');
    const evidence = await inspectLocalEvidence({ ...common, read: input.read });
    if (evidence.status !== 'CURRENT')
        throw unavailable('Original local check is stale for the current source or full index');
    const git = await inspectLocalGit({ ...common, project: policy.project, includeIndex: true });
    input.signal.throwIfAborted();
    store.owner();
    policy.assertCurrent();
    originalLocalEvidence(input.read());
    if (!same(homeIdentity, identity(store.home, true)) || !same(sourceIdentity, identity(policy.project.sourceRoot)) || !message.bytes.equals(messageSnapshot(input.messageFile).bytes) || localEvidenceBinding(input.read()) !== evidence.provenanceHash || prepared.observation?.head !== git.head || prepared.observation?.branch !== git.branch || git.head !== evidence.index.head || git.branch !== evidence.index.branch || git.index!.fingerprint !== evidence.index.fingerprint)
        throw unavailable('Message, rules, source, index, HEAD or original evidence changed during candidate preparation');
    const record: Candidate = { version: 1, id: randomUUID(), projectId: input.projectId, createdAt: new Date().toISOString(), home: { path: store.home, identity: homeIdentity }, source: { path: policy.project.sourceRoot, identity: sourceIdentity },
        index: { objectFormat: git.index!.objectFormat, roster: evidence.index.roster, parent: git.head === '(initial)' ? null : git.head, intendedBranch: git.branch }, messageSha256: message.digest,
        policy: { revision: policy.view.revision, hash: policy.view.hash!, rules: policy.view.rules! },
        check: { workId: evidence.workId, runId: evidence.runId, resultId: evidence.resultId, observationId: evidence.observationId, capture: evidence.originalCapture, binding: evidence.provenanceHash } };
    validate(record);
    input.signal.throwIfAborted();
    store.owner();
    input.assertCurrent?.();
    // Product-immutable exclusive creation. A crash may leave an unavailable partial record, never a valid overwritten receipt.
    const fd = openSync(join(store.folder, record.id + '.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        writeFileSync(fd, encodeObject(record as unknown as Record<string, unknown>));
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    return { status: 'RECORDED', candidate: record, scope: 'Historical preparation receipt, not a locked reservation, review, test-adequacy judgment, commit approval or repository authority.', nextAction: 'Review the intended staged diff and commit separately with trusted Git: git commit --cleanup=verbatim -F MESSAGE_FILE. Then run local audit with this candidate ID and an explicit commit reference. Hooks, signing and their effects belong to native Git.' };
}
/** Audit immutable commit content against one retained receipt; later work is not current acceptance. */
export async function auditLocalCommit(input: {
    controller: Controller;
    projectId: string;
    candidateId: string;
    commitRef: string;
    gitBinary: string;
    signal: AbortSignal;
    read: (workId: string, resultId: string) => LocalEvidenceSource;
}) {
    const retained = load(input.controller, input.candidateId, input.projectId), record = retained.record;
    const before = input.read(record.check.workId, record.check.resultId), original = originalLocalEvidence(before, true);
    if (localEvidenceBinding(before) !== record.check.binding || original.run.id !== record.check.runId || original.observation.id !== record.check.observationId || original.manifest.digest !== record.check.capture)
        throw unavailable('Retained original command evidence no longer matches this candidate');
    const git = await inspectLocalGit({ project: before.project, gitBinary: input.gitBinary, projectRoots: input.controller.listProjects().map(p => p.sourceRoot), installationHome: input.controller.applicationHome(), signal: input.signal, commitRef: input.commitRef }), commit = git.commit!;
    retained.assertCurrent();
    input.signal.throwIfAborted();
    const now = input.read(record.check.workId, record.check.resultId);
    originalLocalEvidence(now, true);
    if (localEvidenceBinding(now) !== record.check.binding)
        throw unavailable('Original command evidence changed during historical audit');
    const expectedParents = record.index.parent ? [record.index.parent] : [];
    const checks = { objectFormat: commit.objectFormat === record.index.objectFormat, wholeTree: same(commit.roster, record.index.roster), message: commit.messageSha256 === record.messageSha256, parents: same(commit.parents, expectedParents) };
    let currentPolicy: unknown;
    try {
        const view = new ApplicationLocalConventions(input.controller).inspect(input.projectId);
        currentPolicy = { state: view.state, revision: view.revision, hash: view.hash, matchesOriginal: view.revision === record.policy.revision && view.hash === record.policy.hash };
    }
    catch {
        currentPolicy = { state: 'UNAVAILABLE', matchesOriginal: null };
    }
    return { status: Object.values(checks).every(Boolean) ? 'MATCH' : 'MISMATCH', candidateId: record.id, createdAt: record.createdAt, checks, expected: { index: record.index, messageSha256: record.messageSha256, policy: record.policy, check: record.check }, actual: commit,
        originalCheck: { command: original.command, cwd: original.result.actualCwd, runtime: original.runtime, scratchInput: original.result.scratchInput, limitations: original.result.limitations },
        current: { branch: git.branch, head: git.head, policy: currentPolicy, work: { state: now.work.state, epoch: now.work.epoch, currentResultRunId: now.work.currentResult?.runId ?? null, pending: now.pending } },
        scope: 'Historical commit tree, message, parent and original evidence correspondence only. Native author/committer fields are unverified Git metadata. Intended branch is preparation context; a commit object cannot prove its original branch. No current eligibility, test adequacy, independent review, account standing or repository approval is established.',
        limitations: [...git.limitations, 'Original full capture includes ignored/untracked files and Git metadata as execution context; matching does not claim the committed tree alone reproduces the check.', 'Native Git performs hooks, signing and commit updates outside this observation. No native commit is rolled back or amended by a mismatch.'],
        nextAction: Object.values(checks).every(Boolean) ? 'Keep this correspondence with concise human review/check history; assess test adequacy and actual repository rules separately.' : 'Inspect the mismatched tree, message or parent. Review native hook/cleanup effects and run applicable checks for the actual intended candidate; retain this commit and original historical evidence.' };
}
export interface LocalCandidateSummary {
    candidateId: string;
    fingerprint: string;
    createdAt: string;
    check: Candidate['check'];
    index: Candidate['index'];
    messageSha256: string;
    policy: Pick<Candidate['policy'], 'revision' | 'hash'>;
}
/** Discover retained IDs without guessing private storage paths; malformed entries stay visible. */
export function listLocalCandidates(controller: Controller, projectId: string) {
    if (!controller.listProjects().some(p => p.id === projectId))
        throw unavailable('Select a registered project before listing candidates');
    const folder = join(controller.applicationHome(), 'local-candidates');
    try {
        lstatSync(folder);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return { projectId, candidates: [], unavailableRecords: [], scope: 'No retained candidates; inspection created no storage or work.', nextAction: 'Record an exact candidate only after applicable current check evidence.' };
        throw error;
    }
    const store = storage(controller), names = readdirSync(store.folder).filter(name => name.endsWith('.json') && uuid(name.slice(0, -5))).sort();
    if (names.length > 1000)
        throw unavailable('Retained candidate listing exceeds 1000 records; inspect known IDs and archive owned old receipts before retrying');
    const candidates: LocalCandidateSummary[] = [], unavailableRecords: {
        candidateId: string;
        status: 'UNAVAILABLE';
    }[] = [];
    for (const name of names) {
        store.owner();
        const id = name.slice(0, -5);
        try {
            const attributed = validate(readObject(join(store.folder, name), true, bytes => {
                if (!isUtf8(bytes))
                    throw Error('Invalid UTF-8');
                parseUniqueJson(bytes.toString('utf8'));
            }));
            if (attributed.projectId !== projectId)
                continue;
            const { record, fingerprint } = load(controller, id, projectId);
            candidates.push({ candidateId: id, fingerprint, createdAt: record.createdAt, check: record.check, index: record.index, messageSha256: record.messageSha256, policy: { revision: record.policy.revision, hash: record.policy.hash } });
        }
        catch {
            unavailableRecords.push({ candidateId: id, status: 'UNAVAILABLE' });
        }
    }
    return { projectId, candidates, unavailableRecords, scope: 'Retained historical preparation records only; listing does not establish current eligibility or commit acceptance.', nextAction: 'Use the exact candidate ID with local audit and an explicit commit reference. Unavailable records require inspection of their original owned storage; do not infer acceptance from a missing or unreadable receipt.' };
}
/** Pure exact receipt selection; retain its byte/root guard across UI forms and async dispatch. */
export function prepareLocalCandidate(controller: Controller, projectId: string, candidateId: string) {
    const retained = load(controller, candidateId, projectId);
    return { record: structuredClone(retained.record), fingerprint: retained.fingerprint, assertCurrent: retained.assertCurrent };
}
