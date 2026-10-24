import type {SetupJournal, QualificationSetup, CreationReceipt} from '../dist/platform/qualification-types.js';
import {acceptanceContextResources, type CreatedAcceptanceContext, type AcceptanceResources, type AcceptanceGitClient} from '../dist/platform/hosted-context.js';
/** Internal external-acceptance SETUP only. This is not a product permission,
 * work/grant/evidence writer, or a production activation switch. */
import { randomUUID } from 'node:crypto';
import fs, { constants } from 'node:fs';
import path from 'node:path';
import { acquireOwner } from '../dist/controller/ownership.js';
import { nativeConfigurationTransport, type NativeConfigurationTransport, type NativeJsonStart, type ReadLimits, type ReadResponse } from '../dist/platform/github-transport.js';
import { createContextPublicationClient, type PublicationTarget } from '../dist/platform/github-publication.js';
import { createContextConfigurationClient } from '../dist/platform/github-configuration.js';
import { createNativeCapabilityObserver, type CapabilityRequest } from '../dist/platform/github-capability.js';
import { createNativePolicyObserver, type PolicyRequest } from '../dist/platform/github-policy.js';
import { fixedClassicQueryKind } from '../dist/platform/github-classic.js';
import { NativeGitCleanupError, NativeGitNotAllocatedError, createOwnedHttpsGitFixture, captureAcceptanceCredential, openCreatedAcceptanceGit, reconcileOwnedGitProcesses, type NativeGitClient, type HttpsGitTarget, type PreparedHttpsSend } from '../dist/effects/native-git.js';
import { assertAcceptanceSynthetic } from './acceptance-synthetic.js';
import type { NativeGitProfile } from '../dist/effects/types.js';
import type { OwnedNativeHttpsProfile } from '../dist/platform/github-publication-session.js';
export const acceptanceFixture = Object.freeze({ owner: 'ilgyu-yi', ownerId: 39043516,
    repository: 'gitjig-effects-fixture-20261017-074f7a29', excludedId: 1349289221,
    manifestHash: '7c8e0d881367267b45a91ca8be843888d4e7b5e5edde39cc3706a730a8f05d46' });
const base = `/repos/${acceptanceFixture.owner}/${acceptanceFixture.repository}`;
const origin = 'https://api.github.com';
const limits: ReadLimits = Object.freeze({ requestTimeoutMs: 10000, responseBytes: 1024 * 1024, pages: 100,
    collectionBytes: 8 * 1024 * 1024, collectionItems: 10000 });
const cap = Object.freeze({ reads: 400, writes: 48, repositoryCreates: 1, issueCreates: 1, draftCreates: 1,
    comments: 3, ruleCreates: 2, ruleWrites: 24, mergePatches: 6, nativeOperations: 64, nativePushes: 12 });
type Counter = keyof typeof cap;
function obj(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Native acceptance object unavailable');
    return value as Record<string, unknown>;
}
function user(value: unknown): void {
    const u = obj(value);
    if (u.id !== acceptanceFixture.ownerId || u.login !== acceptanceFixture.owner || u.type !== 'User')
        throw Error('Actual fixture owning User differs');
}
function repository(value: unknown, expected?: PublicationTarget): PublicationTarget {
    const r = obj(value);
    user(r.owner);
    if (!Number.isSafeInteger(r.id) || (r.id as number) < 1 || r.id === acceptanceFixture.excludedId ||
        typeof r.node_id !== 'string' || !r.node_id || r.full_name !== acceptanceFixture.owner + '/' + acceptanceFixture.repository ||
        r.name !== acceptanceFixture.repository || r.private !== true || r.visibility !== 'private' || r.fork !== false || r.url !== origin + base)
        throw Error('Exact new private repository identity unavailable');
    const target: PublicationTarget = { host: 'github.com', owner: acceptanceFixture.owner, repository: acceptanceFixture.repository,
        repositoryId: r.id as number, repositoryNodeId: r.node_id, actorUserId: acceptanceFixture.ownerId };
    if (expected && JSON.stringify(target) !== JSON.stringify(expected))
        throw Error('Created repository was replaced');
    return target;
}
function creationReceipt(response: ReadResponse): CreationReceipt {
    const r = obj(response.data), owner = obj(r.owner);
    return { status: response.status, bodyHash: response.bodyHash, bodyBytes: response.bodyBytes, requestId: response.requestId,
        data: { id: r.id, node_id: r.node_id, full_name: r.full_name, name: r.name, url: r.url, private: r.private, visibility: r.visibility, fork: r.fork,
            owner: { id: owner.id, login: owner.login, type: owner.type }, ...(typeof r.default_branch === 'string' ? { default_branch: r.default_branch } : {}) } };
}
const branches = new Set(['main', 'fixture/ordinary', 'fixture/override', 'fixture/head', 'fixture/race', 'fixture/overlap']);
function ownedDirectory(directory: string): void {
    if (!path.isAbsolute(directory) || path.resolve(directory) !== directory)
        throw Error('Canonical owned setup directory required');
    const realParent = fs.realpathSync(path.dirname(directory));
    if (realParent !== path.dirname(directory))
        throw Error('Setup parent alias unsupported');
    try {
        fs.mkdirSync(directory, { mode: 0o700 });
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
            throw e;
    }
    const st = fs.lstatSync(directory);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || st.mode & 0o077 || fs.realpathSync(directory) !== directory)
        throw Error('Private owned setup directory required');
}
/** Fixed canonical acceptance entry only; ordinary production factories stay disabled. */
export async function openHostedAcceptanceSetup(options: {
    token: string;
    journalRoot: string;
    git: {
        gitBinary: string;
        execPath: string;
    };
}, registerContext: RegisterContext) {
    const captured = structuredClone(options);
    assertAcceptanceSynthetic();
    const credential = captureAcceptanceCredential(captured.token), native = nativeConfigurationTransport(captured.token, limits);
    ownedDirectory(captured.journalRoot);
    const release = await acquireOwner(captured.journalRoot);
    try {
        return new LocalSetup(setupConstruction, registerContext, captured.journalRoot, origin, native, 3600000, release, (profile, context, signal) => {
            if (profile.gitBinary !== captured.git.gitBinary)
                throw Error('Fixed trusted Git binary differs');
            return openCreatedAcceptanceGit(context, credential, profile, captured.git.execPath, undefined, signal);
        }, credential, true);
    }
    catch (error) {
        await release();
        throw error;
    }
}
/** Separately named local mirror of the immutable 96-op acceptance profile. */
export async function createOwnedFixedAcceptanceSetup(options: {
    origin: string;
    token: string;
    journalRoot: string;
    ownedHttps: OwnedNativeHttpsProfile;
}, registerContext: RegisterContext) {
    const c = structuredClone(options), u = new URL(c.origin), h = new URL(c.ownedHttps.origin);
    assertAcceptanceSynthetic();
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.pathname !== '/' || u.search || u.hash || u.username || u.password || h.protocol !== 'https:' || h.hostname !== '127.0.0.1' || !h.port || h.pathname !== '/' || h.search || h.hash || h.username || h.password)
        throw Error('Literal owned fixed-profile origins required');
    const credential = captureAcceptanceCredential(c.token), native = nativeConfigurationTransport(c.token, limits);
    ownedDirectory(c.journalRoot);
    const release = await acquireOwner(c.journalRoot);
    try {
        return new LocalSetup(setupConstruction, registerContext, c.journalRoot, u.origin, native, 3600000, release, (profile, context, signal) => openCreatedAcceptanceGit(context, credential, profile, c.ownedHttps.execPath, c.ownedHttps, signal), credential, true);
    }
    catch (error) {
        await release();
        throw error;
    }
}
/** Internal owned HTTP producer, never CLI/model origin or credential input. */
export async function createOwnedAcceptanceSetup(options: {
    origin: string;
    token: string;
    journalRoot: string;
    /** Local consumer can lower time only, never expand the original hour. */
    lifetimeMs?: number;
    ownedHttps?: OwnedNativeHttpsProfile;
}, registerContext: RegisterContext) {
    const captured = structuredClone(options), url = new URL(captured.origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
        throw Error('Literal owned acceptance HTTP fixture required');
    if (captured.ownedHttps) {
        const https = new URL(captured.ownedHttps.origin);
        if (https.protocol !== 'https:' || https.hostname !== '127.0.0.1' || !https.port || https.pathname !== '/' || https.search || https.hash || https.username || https.password)
            throw Error('Literal owned acceptance HTTPS fixture required');
    }
    const native = nativeConfigurationTransport(captured.token, limits);
    ownedDirectory(captured.journalRoot);
    const release = await acquireOwner(captured.journalRoot);
    try {
        return new LocalSetup(setupConstruction, registerContext, captured.journalRoot, url.origin, native, captured.lifetimeMs ?? 60 * 60 * 1000, release, captured.ownedHttps ? (profile, context, signal) => createOwnedHttpsGitFixture(profile, { ...captured.ownedHttps!, token: captured.token, credentialSessionId: context.credentialSessionId }, signal) : undefined);
    }
    catch (error) {
        await release();
        throw error;
    }
}
const setupConstruction = Object.freeze({});
type RegisterContext = (context: CreatedAcceptanceContext, resources: AcceptanceResources) => void;
class LocalSetup implements QualificationSetup {
    readonly #registerContext: RegisterContext;
    readonly #root: string;
    readonly #fixtureOrigin: string;
    readonly #native: NativeConfigurationTransport;
    readonly #classicIds = new Set<string>();
    readonly #gitFactory: ((profile: NativeGitProfile, context: CreatedAcceptanceContext, signal?:AbortSignal) => Promise<NativeGitClient>) | undefined;
    readonly #gitClients = new Set<AcceptanceGitClient>();
    readonly #gitCleanupUnknown = new Set<string>();
    readonly #nativeCapture: object | undefined;
    readonly #setupPreparing = new Set<string>();
    #branchJob: Promise<unknown> | undefined;
    readonly #setupClients = new Set<NativeGitClient>();
    readonly #setupHandles = new WeakMap<object, {
        client: NativeGitClient;
        handle: PreparedHttpsSend;
        step: 'bootstrap-main' | 'race-peer';
        used: boolean;
    }>();
    readonly #sessionId = randomUUID();
    readonly #abort = new AbortController();
    readonly #jobs = new Set<Promise<unknown>>();
    readonly #release: () => Promise<void>;
    readonly #file: string;
    readonly #initialMono = performance.now();
    readonly #initialWall = Date.now();
    #journal: SetupJournal;
    #closed = false;
    #close: Promise<void> | undefined;
    #creationJob: Promise<CreatedAcceptanceContext> | undefined;
    constructor(construction: object, registerContext: RegisterContext, root: string, fixtureOrigin: string, native: NativeConfigurationTransport, lifetimeMs: number, release: () => Promise<void>, gitFactory?: (profile: NativeGitProfile, context: CreatedAcceptanceContext, signal?:AbortSignal) => Promise<NativeGitClient>, nativeCapture?: object, fixedProfile = false) {
        if (construction !== setupConstruction)
            throw Error('Actual finite setup factory construction required');
        this.#registerContext = registerContext;
        this.#root = root;
        this.#fixtureOrigin = fixtureOrigin;
        this.#native = native;
        this.#release = release;
        this.#gitFactory = gitFactory;
        this.#nativeCapture = nativeCapture;
        if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 3600000)
            throw Error('Finite original acceptance deadline required');
        ownedDirectory(root);
        this.#file = path.join(root, 'setup.json');
        {
            if (fs.existsSync(this.#file)) {
                const fd = fs.openSync(this.#file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try {
                    const st = fs.fstatSync(fd);
                    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || st.mode & 0o077 || st.size > 1024 * 1024)
                        throw Error('Owned setup journal unavailable');
                    this.#journal = JSON.parse(fs.readFileSync(fd, 'utf8'));
                }
                finally {
                    fs.closeSync(fd);
                }
                const j = this.#journal;
                // Version1 had no native opener at all; no native allowance could have been spent.
                if (j.version === 1) {
                    if (Object.hasOwn(j.counters ?? {}, 'nativeOperations') || Object.hasOwn(j.counters ?? {}, 'nativePushes'))
                        throw Error('Malformed legacy setup native counters');
                    j.counters.nativeOperations = 0;
                    j.counters.nativePushes = 0;
                    j.version = 2;
                }
                if (j.version === 2) {
                    j.nativeOperationLimit = 64;
                    j.setupSteps = {};
                    j.version = 3;
                }
                if (j.version !== 3 || ![64, 96].includes(j.nativeOperationLimit!) || !j.setupSteps || j.kind !== 'external-acceptance-setup-only' || j.manifestHash !== acceptanceFixture.manifestHash ||
                    !['fresh', 'creating', 'created', 'unknown'].includes(j.phase) || !Number.isSafeInteger(j.startedAt) || !Number.isSafeInteger(j.lastAt) ||
                    j.startedAt > j.lastAt || j.lastAt > Date.now() || j.lifetimeMs !== lifetimeMs || !Array.isArray(j.records) || j.records.length > 1100 ||
                    !Number.isSafeInteger(j.sequence) || j.sequence < 0 || Object.keys(cap).some(k => !Number.isSafeInteger(j.counters?.[k as Counter]) || j.counters[k as Counter] < 0 || j.counters[k as Counter] > (k === 'nativeOperations' ? j.nativeOperationLimit! : cap[k as Counter])))
                    throw Error('Retained setup journal malformed; no new empty setup');
                if (j.phase === 'creating') {
                    j.phase = 'unknown';
                }
                this.#save();
            }
            else {
                this.#journal = { version: 3, nativeOperationLimit: fixedProfile ? 96 : 64, setupSteps: {}, kind: 'external-acceptance-setup-only', manifestHash: acceptanceFixture.manifestHash,
                    startedAt: this.#initialWall, lastAt: this.#initialWall, lifetimeMs, phase: 'fresh', counters: Object.fromEntries(Object.keys(cap).map(k => [k, 0])) as Record<Counter, number>,
                    sequence: 0, identity: null, creation: null, readback: null, records: [] };
                this.#save();
            }
        }
    }
    #save(): void {
        const tmp = path.join(this.#root, 'setup-' + randomUUID() + '.tmp');
        const fd = fs.openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try {
            fs.writeFileSync(fd, JSON.stringify(this.#journal));
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, this.#file);
        const dir = fs.openSync(this.#root, constants.O_RDONLY);
        try {
            fs.fsyncSync(dir);
        }
        finally {
            fs.closeSync(dir);
        }
    }
    #live(): void {
        const now = Date.now(), j = this.#journal;
        if (this.#closed || this.#abort.signal.aborted)
            throw Error('Acceptance setup closed');
        if (now < j.lastAt || now - j.startedAt >= j.lifetimeMs || performance.now() - this.#initialMono >= j.lifetimeMs - (this.#initialWall - j.startedAt))
            throw Error('Acceptance setup expired or clock uncertain; no further invocation');
    }
    #remainingMs(): number {
        this.#live();
        return Math.max(1, Math.floor(Math.min(this.#journal.lifetimeMs - (Date.now() - this.#journal.startedAt), this.#journal.lifetimeMs - (this.#initialWall - this.#journal.startedAt) - (performance.now() - this.#initialMono))));
    }
    #own<T>(job: Promise<T>): Promise<T> {
        this.#jobs.add(job);
        void job.finally(() => this.#jobs.delete(job)).catch(() => { });
        return job;
    }
    inspect() { return structuredClone({ ...this.#journal, credentialSessionId: this.#sessionId, scope: 'setup-counters-not-product-standing' }); }
    #nativeIntent(operation: string, push = false): void {
        this.#live();
        if (this.#journal.counters.nativeOperations >= this.#journal.nativeOperationLimit! || (push && this.#journal.counters.nativePushes >= cap.nativePushes))
            throw Error('Acceptance native operation allowance exhausted');
        this.#journal.counters.nativeOperations++;
        if (push)
            this.#journal.counters.nativePushes++;
        this.#journal.lastAt = Date.now();
        this.#journal.records.push({ sequence: ++this.#journal.sequence, method: 'NATIVE', route: operation, outcome: 'invocation-intent' });
        this.#save();
    }
    openNativeGit(context: CreatedAcceptanceContext, profile: NativeGitProfile, callerSignal?:AbortSignal): Promise<AcceptanceGitClient> {
        if (context.credentialSessionId !== this.#sessionId)return Promise.reject(new NativeGitNotAllocatedError(profile.ownedClientRoot,Error('Different captured credential session')));
        let resources:AcceptanceResources, captured:NativeGitProfile, initializationSignal:AbortSignal;
        try {
            resources=acceptanceContextResources(context);captured=structuredClone(profile);
            if (!this.#gitFactory)return Promise.reject(new NativeGitNotAllocatedError(captured.ownedClientRoot,Error('Owned HTTPS fixture profile is not configured; no native fallback')));
            callerSignal?.throwIfAborted();
            initializationSignal=AbortSignal.any([...(callerSignal?[callerSignal]:[]),this.#abort.signal,AbortSignal.timeout(this.#remainingMs())]);
            this.#nativeIntent('open');
        } catch(error) { throw new NativeGitNotAllocatedError(profile.ownedClientRoot,error); }
        return this.#own((async () => {
            let client: NativeGitClient;
            try {
                client = await this.#gitFactory!(captured, context, initializationSignal);
            }
            catch (error) {
                let unallocated=false;
                if(error instanceof NativeGitNotAllocatedError && error.clientRoot===captured.ownedClientRoot && !captured.resumeOwned && !this.#gitCleanupUnknown.has(captured.ownedClientRoot)) {
                    try { fs.lstatSync(captured.ownedClientRoot); } catch(missing) { if((missing as NodeJS.ErrnoException).code==='ENOENT')unallocated=true; }
                }
                const recovery = unallocated ? {cleanup:'not-allocated' as const} : await reconcileOwnedGitProcesses(captured.ownedClientRoot);
                if (recovery.cleanup === 'unknown')
                    this.#gitCleanupUnknown.add(captured.ownedClientRoot);
                this.#journal.records.push({ sequence: ++this.#journal.sequence, method: 'NATIVE', route: 'client:' + captured.ownedClientRoot, outcome: 'open-failed/cleanup-' + recovery.cleanup });
                this.#save();
                if(unallocated)throw error;
                if(recovery.cleanup==='unknown')throw new NativeGitCleanupError('Inspect original client '+captured.ownedClientRoot+'; acceptance native open unavailable; cleanup unknown',error);
                throw Error('Acceptance native open unavailable; cleanup ' + recovery.cleanup + '; exact root ' + captured.ownedClientRoot + '; ' + String(error),{cause:error});
            }
            const cleanup = async () => {
                try {
                    await client.close();
                    this.#gitCleanupUnknown.delete(client.root);
                }
                catch (error) {
                    this.#gitCleanupUnknown.add(client.root);
                    throw error;
                }
            };
            try {
                this.#live();
                callerSignal?.throwIfAborted();
            }
            catch (error) {
                await cleanup();
                throw error;
            }
            const target = (t: HttpsGitTarget) => {
                resources.assertTarget(t);
                if (!t.ref.startsWith('refs/heads/'))
                    throw Error('Finite existing fixture ref required');
                resources.assertBranch(t.ref.slice('refs/heads/'.length));
            };
            const signal = (s?: AbortSignal) => AbortSignal.any([...(s ? [s] : []), this.#abort.signal, AbortSignal.timeout(this.#remainingMs())]);
            const call = <T>(name: string, s: AbortSignal | undefined, action: (combined: AbortSignal) => Promise<T>): Promise<T> => {
                this.#nativeIntent(name);
                return this.#own(action(signal(s)));
            };
            const prepared = new WeakMap<PreparedHttpsSend, {
                used: boolean;
            }>();
            let closing: Promise<void> | undefined;
            const wrapper: AcceptanceGitClient = Object.freeze({ root: client.root, objectFormat: client.objectFormat, gitBinary: client.gitBinary,
                project: (input, s) => call('project', s, combined => client.project(structuredClone(input), combined)),
                buildIntegration: (input, s) => call('buildIntegration', s, combined => client.buildIntegration(structuredClone(input), combined)),
                materializeVerifiedTree: (tree, root, s) => call('materializeVerifiedTree', s, combined => client.materializeVerifiedTree(tree, root, combined)),
                observeHttpsRef: (input, s) => { target(input); return call('observe:' + input.ref, s, combined => client.observeHttpsRef(structuredClone(input), combined)); },
                fetchHttpsBasis: (input, basis, s) => { target(input); return call('fetch:' + input.ref, s, combined => client.fetchHttpsBasis(structuredClone(input), basis, combined)); },
                fetchHttpsPinnedBasis: (input, basis, s) => { target(input); return call('fetchPinned:' + input.ref, s, combined => client.fetchHttpsPinnedBasis(structuredClone(input), basis, combined)); },
                prepareHttpsForwardSend: (input, s) => {
                    target(input.target);
                    const owned = structuredClone(input);
                    return call('prepare:' + owned.target.ref, s, async (combined) => {
                        const h = await client.prepareHttpsForwardSend(owned, combined);
                        this.#live();
                        prepared.set(h, { used: false });
                        return h;
                    });
                },
                spawnPreparedHttpsForwardSend: handle => {
                    const saved = prepared.get(handle);
                    if (!saved || saved.used)
                        throw Error('Foreign or consumed acceptance native handle');
                    saved.used = true;
                    this.#nativeIntent('push:' + handle.operationId, true);
                    this.#live(); // fsync may have consumed the remaining lifetime; no await before launcher.
                    return this.#own(client.spawnPreparedHttpsForwardSend(handle));
                },
                reconcileHttpsForward: (input, s) => { target(input.target); return call('reconcile:' + input.target.ref, s, combined => client.reconcileHttpsForward(structuredClone(input), combined)); },
                close: () => closing ??= cleanup().then(() => { this.#gitClients.delete(wrapper); }),
            });
            this.#gitClients.add(wrapper);
            return wrapper;
        })());
    }
    prepareBootstrapMain(context: CreatedAcceptanceContext, input: {
        clientProfile: NativeGitProfile;
    }) {
        return this.#prepareSetup(context, 'bootstrap-main', input.clientProfile);
    }
    prepareRacePeer(context: CreatedAcceptanceContext, input: {
        clientProfile: NativeGitProfile;
        expectedBase: string;
    }) {
        return this.#prepareSetup(context, 'race-peer', input.clientProfile, input.expectedBase);
    }
    #prepareSetup(context: CreatedAcceptanceContext, step: 'bootstrap-main' | 'race-peer', profile: NativeGitProfile, expectedBase?: string) {
        const resources = acceptanceContextResources(context), captured = structuredClone(profile);
        if (context.credentialSessionId !== this.#sessionId || !this.#nativeCapture || !this.#gitFactory)
            return Promise.reject(Error('Fixed setup context required'));
        const prior = this.#journal.setupSteps![step];
        if (prior && prior.state !== 'prepared')
            return Promise.reject(Error('Setup already handed off; readonly reconciliation only'));
        if (prior && (prior.root !== captured.ownedClientRoot || prior.expectedBase !== expectedBase))
            return Promise.reject(Error('Retained setup binding differs'));
        if (this.#setupPreparing.has(step))
            return Promise.reject(Error('Fixed setup preparation already in progress'));
        this.#nativeIntent('setup-open:' + step);
        this.#setupPreparing.add(step);
        const job = this.#own((async () => {
            const current = await this.#start(new URL(base, origin), { method: 'GET' }).response;
            if (current.status !== 200)
                throw Error('Current created repository unavailable');
            repository(current.data, context.target);
            let client: NativeGitClient;
            try {
                client = await this.#gitFactory!({ ...captured, ...(prior ? { resumeOwned: true } : {}) }, context);
            }
            catch (error) {
                const cleanup = await reconcileOwnedGitProcesses(captured.ownedClientRoot);
                if (cleanup.cleanup !== 'confirmed')
                    this.#gitCleanupUnknown.add(captured.ownedClientRoot);
                throw Error('Fixed setup client open failed; cleanup ' + cleanup.cleanup + '; exact root ' + captured.ownedClientRoot + '; ' + String(error));
            }
            this.#setupClients.add(client);
            try {
                resources.live();
            }
            catch (error) {
                await client.close();
                this.#setupClients.delete(client);
                throw error;
            }
            this.#nativeIntent('setup-prepare:' + step);
            const target: HttpsGitTarget = { ...context.target, ref: step === 'bootstrap-main' ? 'refs/heads/main' : 'refs/heads/fixture/race' };
            const signal = AbortSignal.any([this.#abort.signal, AbortSignal.timeout(this.#remainingMs())]);
            const handle = await client.prepareAcceptanceSetup({ target, step, ...(expectedBase ? { expectedBase } : {}), ...(prior?.commit ? { retainedCommit: prior.commit } : {}) }, signal);
            this.#live();
            this.#journal.setupSteps![step] = { state: 'prepared', commit: handle.integrationCommit, tree: handle.tree, root: client.root, profile: captured, ...(expectedBase ? { expectedBase } : {}) };
            this.#save();
            this.#setupHandles.set(handle, { client, handle, step, used: false });
            return handle;
        })());
        void job.finally(() => this.#setupPreparing.delete(step)).catch(() => { });
        return job;
    }
    invokePreparedSetup(handle: PreparedHttpsSend) {
        const saved = this.#setupHandles.get(handle);
        if (!saved || saved.used)
            throw Error('Foreign or consumed fixed setup handle');
        const step = this.#journal.setupSteps![saved.step]!;
        if (step.state !== 'prepared' || step.commit !== handle.integrationCommit)
            throw Error('Setup no longer prepared');
        saved.used = true;
        step.state = 'invoking';
        this.#nativeIntent('setup-push:' + saved.step, true);
        this.#live(); // Intent/counters are fsynced; no await before the native launcher.
        return this.#own(saved.client.spawnPreparedHttpsForwardSend(handle).then(async (receipt) => {
            step.transport = receipt.transport;
            step.state = 'unknown';
            this.#save();
            try {
                await saved.client.close();
                this.#setupClients.delete(saved.client);
            }
            catch (error) {
                this.#gitCleanupUnknown.add(saved.client.root);
                throw error;
            }
            return receipt;
        }));
    }
    reconcileSetupStep(context: CreatedAcceptanceContext, stepId: 'bootstrap-main' | 'race-peer') {
        const resources = acceptanceContextResources(context);
        resources.live();
        if (context.credentialSessionId !== this.#sessionId || !this.#gitFactory || !this.#nativeCapture)
            return Promise.reject(Error('Fixed setup context required'));
        const step = this.#journal.setupSteps![stepId];
        if (!step?.commit || !step.profile)
            return Promise.reject(Error('Retained exact setup operation required'));
        this.#nativeIntent('setup-reconcile:' + stepId);
        return this.#own((async () => {
            let client: NativeGitClient;
            try {
                client = await this.#gitFactory!({ ...step.profile!, resumeOwned: true }, context);
            }
            catch (error) {
                const cleanup = await reconcileOwnedGitProcesses(step.profile!.ownedClientRoot);
                if (cleanup.cleanup !== 'confirmed')
                    this.#gitCleanupUnknown.add(step.profile!.ownedClientRoot);
                throw error;
            }
            this.#setupClients.add(client);
            const target: HttpsGitTarget = { ...context.target, ref: stepId === 'bootstrap-main' ? 'refs/heads/main' : 'refs/heads/fixture/race' };
            const result = await client.reconcileHttpsForward({ operationId: 'acceptance-074f7a29-' + stepId, target, expectedBase: step.expectedBase ?? step.commit, integrationCommit: step.commit }, AbortSignal.any([this.#abort.signal, AbortSignal.timeout(this.#remainingMs())]));
            await client.close();
            this.#setupClients.delete(client);
            if (result.kind === 'contains-integration')
                step.state = 'observed';
            this.#save();
            return { ...result, transport: step.transport ?? 'uncertain', cleanup: 'confirmed' as const };
        })());
    }
    createFixtureBranches(context: CreatedAcceptanceContext): Promise<unknown> {
        acceptanceContextResources(context);
        if (context.credentialSessionId !== this.#sessionId)
            return Promise.reject(Error('Different captured credential session'));
        if (this.#branchJob)
            return this.#branchJob;
        const job = this.#createFixtureBranchesOnce(context);
        this.#branchJob = job;
        void job.finally(() => {
            if (this.#branchJob === job)
                this.#branchJob = undefined;
        }).catch(() => { });
        return job;
    }
    #createFixtureBranchesOnce(context: CreatedAcceptanceContext) {
        const resources = acceptanceContextResources(context);
        resources.live();
        if (context.credentialSessionId !== this.#sessionId || !this.#nativeCapture)
            return Promise.reject(Error('Fixed setup context required'));
        return this.#own((async () => {
            const main = this.#journal.setupSteps!['bootstrap-main'];
            if (main?.state !== 'observed')
                throw Error('Actual main desired state/read-only settlement required');
            const current = await this.#start(new URL(base, origin), { method: 'GET' }).response;
            if (current.status !== 200)
                throw Error('Current created repository unavailable');
            repository(current.data, context.target);
            this.#nativeIntent('setup-branch-inventory');
            let inspector: NativeGitClient;
            try {
                inspector = await this.#gitFactory!({ ...main.profile!, resumeOwned: true }, context);
            }
            catch (error) {
                const cleanup = await reconcileOwnedGitProcesses(main.profile!.ownedClientRoot);
                if (cleanup.cleanup !== 'confirmed')
                    this.#gitCleanupUnknown.add(main.profile!.ownedClientRoot);
                throw error;
            }
            this.#setupClients.add(inspector);
            const inventory = await inspector.observeAcceptanceInventory({ ...context.target, ref: 'refs/heads/main' }, AbortSignal.any([this.#abort.signal, AbortSignal.timeout(this.#remainingMs())]));
            await inspector.close();
            this.#setupClients.delete(inspector);
            if (inventory.refs.some(r => !r.ref.startsWith('refs/heads/') || !branches.has(r.ref.slice('refs/heads/'.length))) || inventory.refs.find(r => r.ref === 'refs/heads/main')?.commit !== main.commit)
                throw Error('Unexpected fixture inventory; stop dependent setup');
            const results = [];
            for (const branch of [...branches].filter(b => b !== 'main')) {
                const key = 'ref:' + branch, prior = this.#journal.setupSteps![key];
                if (prior) {
                    const observed = await this.#start(new URL(base + '/git/ref/heads/' + branch, origin), { method: 'GET' }).response;
                    const data = obj(observed.data), object = obj(data.object);
                    if (observed.status !== 200 || data.ref !== 'refs/heads/' + branch || typeof data.node_id !== 'string' || !data.node_id || object.type !== 'commit' || object.sha !== prior.commit || (prior.nodeId && prior.nodeId !== data.node_id))
                        throw Error('Retained ref creation remains unknown; readonly recovery only');
                    prior.nodeId = data.node_id;
                    prior.state = 'observed';
                    this.#save();
                    results.push({ branch, ...prior });
                    continue;
                }
                const route = base + '/git/ref/heads/' + branch;
                const before = await this.#start(new URL(route, origin), { method: 'GET' }).response;
                if (before.status !== 404)
                    throw Error('Setup ref exists or absence unknown; do not adopt');
                const entry = { state: 'invoking' as 'invoking' | 'observed' | 'unknown', commit: main.commit, transport: 'uncertain', nodeId: '' };
                this.#journal.setupSteps![key] = entry;
                this.#save();
                const response = await this.#start(new URL(base + '/git/refs', origin), { method: 'POST', body: Buffer.from(JSON.stringify({ ref: 'refs/heads/' + branch, sha: main.commit })) }).response;
                const valid = (r: ReadResponse) => {
                    const d = obj(r.data), o = obj(d.object);
                    if (d.ref !== 'refs/heads/' + branch || typeof d.node_id !== 'string' || !d.node_id || d.url !== origin + base + '/git/refs/heads/' + branch || o.type !== 'commit' || o.sha !== main.commit)
                        throw Error('Exact bootstrap ref identity unavailable');
                    return d.node_id;
                };
                entry.state = 'unknown';
                this.#save();
                if (response.status !== 201)
                    throw Error('Ref creation uncertain; no resend');
                entry.nodeId = valid(response);
                entry.transport = 'native-success';
                this.#save();
                const after = await this.#start(new URL(route, origin), { method: 'GET' }).response;
                if (after.status !== 200 || valid(after) !== entry.nodeId)
                    throw Error('Known ref readback unavailable; no resend');
                entry.state = 'observed';
                this.#save();
                results.push({ branch, ...entry });
            }
            return results;
        })());
    }
    #start: NativeConfigurationTransport = (u, r, s) => this.#request(this.#native, u, r, s);
    #request(native: NativeConfigurationTransport, inputUrl: URL, input: Parameters<NativeConfigurationTransport>[1], callerSignal?: AbortSignal, readOnly = false): NativeJsonStart {
        this.#live();
        const u = new URL(inputUrl.href);
        if (readOnly && (input.method !== 'GET' || (u.pathname !== '/user' && u.pathname !== base)))
            throw Error('Negative credential is identity/scope-read only');
        if (u.origin !== origin || u.hash || u.username || u.password || !(u.pathname === '/user' || u.pathname === '/user/repos' || u.pathname === '/graphql' || u.pathname === base || u.pathname.startsWith(base + '/')))
            throw Error('Acceptance endpoint outside exact repository scope');
        if (u.pathname === '/user/repos' && (input.method !== 'POST' || this.#journal.phase !== 'creating'))
            throw Error('Creation is setup-only and single-attempt');
        if (u.pathname === '/graphql') {
            if (input.method !== 'POST' || !input.body)
                throw Error('Only existing fixed native GraphQL reads supported');
            const payload = obj(JSON.parse(Buffer.from(input.body).toString())), kind = fixedClassicQueryKind(payload.query), v = obj(payload.variables);
            if (!branches.has(String(v.qualifiedName).replace(/^refs\/heads\//, '')) || typeof v.qualifiedName !== 'string' || !v.qualifiedName.startsWith('refs/heads/') ||
                (v.after !== null && typeof v.after !== 'string') || (kind === 'inventory' ? v.owner !== acceptanceFixture.owner || v.name !== acceptanceFixture.repository : typeof v.id !== 'string' || !this.#classicIds.has(v.id)))
                throw Error('Native classic query outside actual fixture scope');
        }
        const read = input.method === 'GET' || u.pathname === '/graphql';
        const selected: Counter[] = [read ? 'reads' : 'writes'];
        if (!read) {
            if (u.pathname === '/user/repos')
                selected.push('repositoryCreates');
            else if (input.method === 'POST' && u.pathname === base + '/git/refs' && this.#nativeCapture) {
                const body = obj(JSON.parse(Buffer.from(input.body ?? []).toString()));
                const branch = typeof body.ref === 'string' ? body.ref.replace(/^refs\/heads\//, '') : '';
                const step = this.#journal.setupSteps!['ref:' + branch];
                if (!branches.has(branch) || branch === 'main' || body.ref !== 'refs/heads/' + branch || Object.keys(body).sort().join(',') !== 'ref,sha' || step?.state !== 'invoking' || step.commit !== body.sha || this.#journal.records.some(r => r.method === 'POST' && r.route === u.pathname && r.outcome === 'ref-intent:' + branch))
                    throw Error('Exact once-only fixed ref creation required');
                this.#journal.records.push({ sequence: ++this.#journal.sequence, method: 'POST', route: u.pathname, outcome: 'ref-intent:' + branch });
            }
            else if (input.method === 'POST' && u.pathname === base + '/issues')
                selected.push('issueCreates');
            else if (input.method === 'POST' && u.pathname === base + '/pulls')
                selected.push('draftCreates');
            else if (input.method === 'POST' && new RegExp('^' + base + '/issues/[1-9][0-9]*/comments$').test(u.pathname))
                selected.push('comments');
            else if (input.method === 'POST' && u.pathname === base + '/rulesets')
                selected.push('ruleCreates', 'ruleWrites');
            else if (input.method === 'PUT' && new RegExp('^' + base + '/rulesets/[1-9][0-9]*$').test(u.pathname))
                selected.push('ruleWrites');
            else if (input.method === 'PATCH' && u.pathname === base)
                selected.push('mergePatches');
            else
                throw Error('Unsupported acceptance mutation family');
        }
        if (selected.some(k => this.#journal.counters[k] >= cap[k]))
            throw Error('Original acceptance attempt allowance exhausted');
        const deadline = AbortSignal.timeout(this.#remainingMs());
        const signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), this.#abort.signal, deadline]);
        signal.throwIfAborted();
        for (const k of selected)
            this.#journal.counters[k]++;
        const sequence = ++this.#journal.sequence;
        this.#journal.lastAt = Date.now();
        this.#journal.records.push({ sequence, method: input.method, route: u.pathname + u.search, outcome: 'invocation-intent' });
        this.#save(); // Setup intent is durable BEFORE the synchronous native request.
        const actual = native(new URL(u.pathname + u.search, this.#fixtureOrigin), input, signal);
        const response = this.#own(actual.response.then(r => {
            this.#journal.records.push({ sequence, method: input.method, route: u.pathname + u.search, outcome: 'native-response', status: r.status, bodyHash: r.bodyHash, bodyBytes: r.bodyBytes });
            if (u.pathname === '/graphql' && r.status === 200) {
                const repo = (r.data as any)?.data?.repository;
                if (repo?.id === this.#journal.identity?.repositoryNodeId && Array.isArray(repo.branchProtectionRules?.nodes))
                    for (const rule of repo.branchProtectionRules.nodes)
                        if (rule?.__typename === 'BranchProtectionRule' && typeof rule.id === 'string' && rule.repository?.id === repo.id)
                            this.#classicIds.add(rule.id);
            }
            this.#save();
            if (u.pathname === base && r.status === 200 && this.#journal.identity)
                repository(r.data, this.#journal.identity);
            return r;
        }, () => {
            this.#journal.records.push({ sequence, method: input.method, route: u.pathname + u.search, outcome: 'unknown' });
            this.#save();
            throw Error('Acceptance native request unavailable; retained attempt, no retry');
        }));
        return { handoff: actual.handoff, response };
    }
    create(): Promise<CreatedAcceptanceContext> {
        this.#live();
        if (this.#creationJob)
            return this.#creationJob;
        if (this.#journal.phase !== 'fresh')
            return Promise.reject(Error('Creation already attempted; exact retained recovery only, no retry/adoption'));
        return this.#creationJob = this.#own(this.#createOnce());
    }
    async #createOnce(): Promise<CreatedAcceptanceContext> {
        try {
            const me = await this.#start(new URL('/user', origin), { method: 'GET' }).response;
            if (me.status !== 200)
                throw Error('Actual User unavailable');
            user(me.data);
            const absent = await this.#start(new URL(base, origin), { method: 'GET' }).response;
            if (absent.status !== 404)
                throw Error('Fixture name exists or absence unavailable; do not adopt');
            this.#journal.phase = 'creating';
            this.#save();
            const created = await this.#start(new URL('/user/repos', origin), { method: 'POST', body: Buffer.from(JSON.stringify({ name: acceptanceFixture.repository, private: true,
                    description: 'Disposable synthetic gitjig acceptance fixture 074f7a29', has_issues: true, has_projects: false, has_wiki: false, auto_init: false })) }).response;
            if (created.status !== 201)
                throw Error('Definitive actual created201 unavailable');
            const target = repository(created.data);
            this.#journal.creation = creationReceipt(created);
            this.#journal.identity = target;
            this.#save();
            const readback = await this.#start(new URL(base, origin), { method: 'GET' }).response;
            if (readback.status !== 200)
                throw Error('Created private repository readback unavailable');
            repository(readback.data, target);
            this.#journal.readback = creationReceipt(readback);
            this.#journal.phase = 'created';
            this.#save();
            return this.#context();
        }
        catch {
            this.#journal.phase = 'unknown';
            this.#save();
            throw Error('Acceptance creation unavailable; inspect retained setup; no context or automatic retry');
        }
    }
    reopen(): Promise<CreatedAcceptanceContext> { return this.#own(this.#reopenKnown()); }
    async #reopenKnown(): Promise<CreatedAcceptanceContext> {
        this.#live();
        const j = this.#journal;
        if (!['created', 'unknown'].includes(j.phase) || !j.creation || j.creation.status !== 201 || !j.identity || j.counters.repositoryCreates !== 1)
            throw Error('Retained actual known creation required; unknown creation cannot reopen');
        repository(j.creation.data, j.identity);
        if (j.readback)
            repository(j.readback.data, j.identity);
        const me = await this.#start(new URL('/user', origin), { method: 'GET' }).response;
        if (me.status !== 200)
            throw Error('Reopened User unavailable');
        user(me.data);
        const current = await this.#start(new URL(base, origin), { method: 'GET' }).response;
        if (current.status !== 200)
            throw Error('Reopened repository unavailable');
        repository(current.data, j.identity);
        j.readback = creationReceipt(current);
        j.phase = 'created';
        this.#save();
        return this.#context();
    }
    #context(): CreatedAcceptanceContext {
        this.#live();
        const j = this.#journal;
        if (j.phase !== 'created' || j.counters.repositoryCreates !== 1 || j.creation?.status !== 201 || j.readback?.status !== 200 || !j.identity)
            throw Error('Actual created201 and exact readback required before context admission');
        repository(j.creation.data, j.identity);
        repository(j.readback.data, j.identity);
        const target = Object.freeze(structuredClone(this.#journal.identity!));
        const context = Object.freeze({ kind: 'local-exact-created-acceptance/v1' as const, credentialSessionId: this.#sessionId, target });
        this.#registerContext(context, Object.freeze({ assertNativeCapture: (capture: object) => {
                this.#live();
                if (!this.#nativeCapture || capture !== this.#nativeCapture)
                    throw Error('Different native credential capture');
            }, start: this.#start, limits, live: () => this.#live(),
            joined: () => {
                const clients = this.clients(context);
                return Object.freeze({ ...clients.publication, observePublicationCapability: clients.observePublicationCapability,
                    credentialSessionId: context.credentialSessionId, target: context.target, activation: 'created-private-local-acceptance' as const,
                    configuration: clients.configuration, observeTargetPolicy: clients.observeTargetPolicy,
                    openNativeGit: (profile: NativeGitProfile, signal?:AbortSignal) => this.openNativeGit(context, profile, signal) });
            },
            assertBranch: (branch: string) => {
                this.#live();
                if (!branches.has(branch))
                    throw Error('Finite fixture branch required');
            },
            assertTarget: (input: Parameters<AcceptanceResources['assertTarget']>[0]) => {
                this.#live();
                if (input.repositoryId !== target.repositoryId || input.repositoryNodeId !== target.repositoryNodeId || input.owner !== target.owner || input.repository !== target.repository ||
                    ('actorUserId' in input && input.actorUserId !== target.actorUserId) || ('visibility' in input && input.visibility !== 'private') ||
                    ('host' in input && input.host !== 'github.com'))
                    throw Error('Acceptance context target differs');
            } }));
        return context;
    }
    clients(context: CreatedAcceptanceContext) {
        if (context.credentialSessionId !== this.#sessionId)
            throw Error('Different captured credential session');
        const resources = acceptanceContextResources(context);
        const capability = createNativeCapabilityObserver((u, s) => resources.start(u, { method: 'GET' }, s).response, limits.requestTimeoutMs);
        const policy = createNativePolicyObserver((u, r, s) => resources.start(u, r, s), limits);
        return Object.freeze({ publication: createContextPublicationClient(context), configuration: createContextConfigurationClient(context),
            observePublicationCapability(input: CapabilityRequest, signal?: AbortSignal) {
                resources.assertTarget(input.target);
                if (input.expectedUserId !== acceptanceFixture.ownerId)
                    throw Error('Exact captured User required');
                return capability.observePublicationCapability(input, signal);
            },
            observeTargetPolicy(input: PolicyRequest, signal?: AbortSignal) {
                resources.assertTarget(input.target);
                if (input.expectedUserId !== acceptanceFixture.ownerId || !branches.has(input.branch))
                    throw Error('Exact User/finite branch required');
                return policy.observeTargetPolicy(input, signal);
            },
        });
    }
    /** Explicit owned-fixture negative credential: no write method or fallback. */
    negativeCapability(context: CreatedAcceptanceContext, options: {
        token: string;
    }) {
        if (context.credentialSessionId !== this.#sessionId)
            throw Error('Different captured credential session');
        const resources = acceptanceContextResources(context), credentialSessionId = randomUUID();
        const native = nativeConfigurationTransport(options.token, limits);
        const reader = createNativeCapabilityObserver((u, s) => this.#request(native, u, { method: 'GET' }, s, true).response, limits.requestTimeoutMs);
        return Object.freeze({ credentialSessionId, scope: 'read-only-negative-never-sending-fallback' as const,
            observePublicationCapability: (input: CapabilityRequest, signal?: AbortSignal) => {
                resources.assertTarget(input.target);
                if (input.expectedUserId !== acceptanceFixture.ownerId)
                    throw Error('Exact captured User required');
                return reader.observePublicationCapability(input, signal);
            } });
    }
    close(): Promise<void> {
        if (this.#close)
            return this.#close;
        this.#closed = true;
        this.#abort.abort();
        return this.#close = (async () => {
            const closeOwned = async (client: {
                root: string;
                close(): Promise<void>;
            }) => {
                try {
                    await client.close();
                }
                catch (error) {
                    this.#gitCleanupUnknown.add(client.root);
                    throw error;
                }
            };
            const clients = await Promise.allSettled([...this.#gitClients, ...this.#setupClients].map(closeOwned));
            while (this.#jobs.size)
                await Promise.allSettled([...this.#jobs]);
            const late = await Promise.allSettled([...this.#setupClients].map(closeOwned));
            await this.#release();
            if (clients.some(r => r.status === 'rejected') || late.some(r => r.status === 'rejected') || this.#gitCleanupUnknown.size)
                throw Error('Acceptance owned Git cleanup UNKNOWN; retain/quarantine exact roots: ' + [...this.#gitCleanupUnknown].join(', '));
        })();
    }
}
