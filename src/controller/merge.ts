import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openOrdinaryGitHubMergeSession, createOwnedOrdinaryMergeSession, type NativeMergeSubject, type NativeMergeIdentity } from '../platform/github-merge-session.js';
import { mergeCommitId, mergeBranchName } from '../platform/github-merge-protocol.js';
import { hash } from './change-files.js';
import { historicalGrantRoot } from './historical-grant.js';
import { mergeDelegation } from './merge-delegation.js';
import { mergeGrantHistory } from './merge-grant-history.js';
import { ownerMergeCandidateSnapshot, ownerMergePublicationHistory } from './merge-owner-history.js';
import { contextWorkContinuation } from './context-origin.js';
import { assertOrdinaryEffectSource } from './application-model.js';
import { assertOwnerRootActivated } from './owner-activation.js';
import type { EffectHost } from './effects.js';
import type { MergeCredential, RegisterMergeTarget, DelegateMerge, MergeView, MergeDelegationConfig, MergeRegistrationContext } from './merge-types.js';
import type { NativeIdentity } from './interaction-types.js';
import { integrationCatalogueSql } from './integration-registry.js';
import { receiverTransmissionHolds } from './integration-transmission.js';
const parse = JSON.parse;
const family = 'github-merge';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
interface MergeAuthority {
    ancestry(work: string): string[];
    source(identity: NativeIdentity): unknown;
    owner(work: string): unknown;
    validateOrigin(op: any): void;
    subject(work: string): {
        contextFingerprint?: string;
    };
}
/** Same Store, authority lineage, budgets and capacity owner. No separate scheduler. */
export class Merges {
    private session: ReturnType<typeof openOrdinaryGitHubMergeSession> | undefined;
    private tasks = new Set<Promise<unknown>>();
    private aborts = new Map<string, AbortController>();
    private closing = new AbortController();
    constructor(private h: EffectHost, private authority: MergeAuthority) { }
    private get s() {
        return this.h.store;
    }
    private own<T>(task: Promise<T>): Promise<T> {
        this.tasks.add(task);
        void task.finally(() => this.tasks.delete(task)).catch(() => { });
        return task;
    }
    configure(input: MergeCredential) {
        this.h.assertOpen();
        if (this.tasks.size)
            throw Error('Settle original merge activity before changing credentials');
        this.session = openOrdinaryGitHubMergeSession(structuredClone(input));
    }
    /** Internal owned fixture only, never a CLI/model origin parameter. */
    configureOwned(input: MergeCredential & {
        origin: string;
    }) {
        this.h.assertOpen();
        if (this.tasks.size)
            throw Error('Settle original merge activity before changing credentials');
        this.session = createOwnedOrdinaryMergeSession(structuredClone(input));
    }
    private work(id: string) {
        const row = this.s.one(`SELECT *,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, id);
        if (!row || typeof row.data !== 'string')
            throw Error('Original bounded merge work unavailable');
        return row;
    }
    private target(id: string) {
        const row = this.s.one(`SELECT id,project,${bounded('data', 131072)} AS data FROM effect_targets WHERE id=?`, id);
        if (!row || typeof row.data !== 'string')
            throw Error('Original bounded merge target unavailable');
        const data = parse(row.data);
        if (data.kind !== family || data.identity?.target?.repositoryId !== data.repository?.repositoryId || data.identity.target.repositoryNodeId !== data.repository.repositoryNodeId || data.identity.target.owner !== data.repository.owner || data.identity.target.repository !== data.repository.repository || data.target?.host !== 'github.com' || data.target.repositoryId !== data.repository.repositoryId || data.target.repositoryNodeId !== data.repository.repositoryNodeId || data.target.owner !== data.repository.owner || data.target.repository !== data.repository.repository || data.target.ref !== 'refs/heads/' + data.identity.baseRef)
            throw Error('Original merge target/native receiver correspondence unavailable');
        return { ...row, data };
    }
    private op(id: string) {
        const row = this.s.one(`SELECT *,${bounded('data', 1048576)} AS data FROM effect_operations WHERE id=?`, id);
        if (!row || typeof row.data !== 'string')
            throw Error('Original bounded merge operation unavailable');
        const data = parse(row.data);
        if (data.kind !== family)
            throw Error('Distinct merge operation required');
        this.target(row.target);
        return { ...row, data };
    }
    private receipt(id: string, kind: string, data: unknown) {
        const bytes = JSON.stringify(data), size = this.s.one('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM effect_receipts WHERE operation=?', id);
        if (Buffer.byteLength(bytes) > 1048576 || size.n >= 256 || size.bytes + Buffer.byteLength(bytes) > 2097152)
            throw Error('Original merge receipt bound reached; preserve original recovery');
        const key = randomUUID();
        this.s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)', key, id, kind, bytes);
        return key;
    }
    /** The durable mutation only; callers inside a transaction must not depend on the open-controller view. */
    private write(id: string, phase: MergeView['phase'], patch: Record<string, unknown>) {
        const op = this.op(id);
        const data = JSON.stringify({ ...op.data, ...patch });
        if (Buffer.byteLength(data) > 1048576)
            throw Error('Original merge mutation exceeds bounded inspection size');
        this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', phase, data, id);
    }
    private patch(id: string, phase: MergeView['phase'], patch: Record<string, unknown>) {
        this.write(id, phase, patch);
        return this.inspect(id);
    }
    inspect(id: string): MergeView {
        this.h.assertOpen();
        const op = this.op(id);
        return { operationId: id, workId: op.work, targetId: op.target, phase: op.phase, headCommit: op.data.headCommit, mergedCommit: op.data.mergedCommit ?? null, receiptIds: this.s.all('SELECT id FROM effect_receipts WHERE operation=? ORDER BY rowid', id).map(row => row.id), transportOutcome: op.data.transportOutcome ?? (op.data.dispatchRun ? 'uncertain' : null), observedOutcome: op.data.correspondence ? 'merged-candidate-matches' : 'not-observed', blocked: op.data.blocked ?? [], nextAction: op.data.nextAction ?? '' };
    }
    private retained(id: string) {
        try {
            const op = this.op(id), target = this.target(op.target), work = this.work(op.work), grant = this.s.one(`SELECT *,${bounded('data', 65536)} AS data FROM effect_delegations WHERE id=?`, op.grant_id);
            if (!grant || typeof grant.data !== 'string' || grant.target !== target.id)
                throw Error('Original merge grant unavailable');
            const data = parse(grant.data);
            if (data.kind !== family || data.mode !== 'ordinary' || data.projectId !== target.project || work.project !== target.project || !['PREPARED', 'RESERVED', 'INVOKING', 'CONFIRMED', 'REFUSED', 'UNKNOWN'].includes(op.phase) || op.data.evidence?.workId !== work.id)
                throw Error('Original merge family, evidence or project differs');
            historicalGrantRoot(this.s, work.id, grant.root, data.scope);
            mergeCommitId(op.data.headCommit);
            if (op.data.subject) {
                const { expectedHead, expectedBase, expectedTree, ...identity } = op.data.subject;
                mergeCommitId(expectedBase);
                mergeCommitId(expectedTree);
                if (expectedHead !== op.data.headCommit || hash(identity) !== hash(target.data.identity))
                    throw Error('Original native subject differs');
            }
            const size = this.s.one('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes,COALESCE(MAX(length(CAST(data AS BLOB))),0) AS largest FROM effect_receipts WHERE operation=?', id);
            if (size.n > 256 || size.bytes > 2097152 || size.largest > 1048576)
                throw Error('Original receipt bound unavailable');
            return { state: 'RETAINED' as const, operationId: id, workId: work.id as string, targetId: target.id as string, projectId: work.project as string, pullNumber: target.data.identity.pullNumber as number, repository: target.data.repository, baseRef: target.data.identity.baseRef as string, headRef: target.data.identity.headRef as string, view: this.inspect(id) };
        }
        catch {
            return { state: 'UNAVAILABLE' as const, operationId: id, reason: 'Original bounded merge identity, lineage or receipts unavailable; records retained without repair' };
        }
    }
    list(options: {
        limit?: number;
        before?: string;
    } = {}) {
        this.h.assertOpen();
        const limit = options.limit ?? 25;
        if (Object.keys(options).some(key => !['limit', 'before'].includes(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw Error('Merge discovery requires limit1..100 and an original cursor');
        const sql = integrationCatalogueSql + `,merges AS (SELECT position,id FROM catalogue WHERE family='github-merge' OR targetFamily='github-merge' OR grantFamily='github-merge')`;
        let position = Number.MAX_SAFE_INTEGER;
        if (options.before !== undefined) {
            const cursor = this.s.one(sql + ' SELECT position FROM merges WHERE id=?', options.before);
            if (!cursor)
                throw Error('Original merge cursor unavailable; reopen first page');
            position = cursor.position;
        }
        const rows = this.s.all(sql + ' SELECT id FROM merges WHERE position<? ORDER BY position DESC LIMIT ?', position, limit + 1);
        return { scope: 'Retained PR merges, not current procedure/authority or permission to send', operations: rows.slice(0, limit).map(row => this.retained(row.id)), nextCursor: rows.length > limit ? rows[limit - 1].id as string : null };
    }
    inspectRetained(id: string) {
        this.h.assertOpen();
        return this.retained(id);
    }
    inspectTarget(id: string) {
        this.h.assertOpen();
        try {
            const target = this.target(id);
            return { state: 'RETAINED' as const, targetId: id, projectId: target.project as string, configuration: target.data };
        }
        catch {
            return { state: 'UNAVAILABLE' as const, targetId: id, reason: 'Original bounded merge target unavailable' };
        }
    }
    listTargets(options: {
        limit?: number;
        before?: string;
    } = {}) {
        this.h.assertOpen();
        const limit = options.limit ?? 25;
        if (Object.keys(options).some(key => !['limit', 'before'].includes(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw Error('Merge target discovery requires limit1..100');
        const sql = `WITH bounded_targets AS (SELECT rowid AS position,id,CASE WHEN length(CAST(data AS BLOB))<=131072 AND json_valid(data) THEN json_extract(data,'$.kind') ELSE NULL END AS family FROM effect_targets),targets AS (SELECT position,id FROM bounded_targets WHERE family='github-merge')`;
        let position = Number.MAX_SAFE_INTEGER;
        if (options.before !== undefined) {
            const row = this.s.one(sql + ' SELECT position FROM targets WHERE id=?', options.before);
            if (!row)
                throw Error('Original merge target cursor unavailable');
            position = row.position;
        }
        const rows = this.s.all(sql + ' SELECT id FROM targets WHERE position<? ORDER BY position DESC LIMIT ?', position, limit + 1);
        return { scope: 'Registered existing PR identities only; no current authority or eligibility', targets: rows.slice(0, limit).map(row => {
                try {
                    const target = this.target(row.id);
                    return { state: 'RETAINED' as const, targetId: target.id as string, projectId: target.project as string, configuration: target.data };
                }
                catch {
                    return { state: 'UNAVAILABLE' as const, targetId: row.id as string, reason: 'Original bounded merge target unavailable' };
                }
            }), nextCursor: rows.length > limit ? rows[limit - 1].id as string : null };
    }
    private publication(id: string) {
        const row = this.s.one(`SELECT *,${bounded('data', 1048576)} AS data FROM effect_operations WHERE id=?`, id);
        if (!row || row.phase !== 'CONFIRMED' || typeof row.data !== 'string')
            throw Error('Confirmed original hosted branch publication required');
        const data = parse(row.data), target = this.s.one(`SELECT id,project,${bounded('data', 131072)} AS data FROM effect_targets WHERE id=?`, row.target);
        if (!target || typeof target.data !== 'string' || data.kind !== 'github-existing-ref')
            throw Error('Actual hosted branch publication family required');
        const configuration = parse(target.data);
        if (configuration.kind !== 'github-existing-ref' || configuration.repository?.visibility !== 'public')
            throw Error('Public hosted branch publication required');
        mergeCommitId(data.integrationCommit);
        mergeCommitId(data.tree);
        this.h.changes.assertCurrentEvidence(data.evidence);
        const grant = this.s.one(`SELECT *,${bounded('data', 65536)} AS data FROM effect_delegations WHERE id=?`, row.grant_id);
        if (!grant || typeof grant.data !== 'string' || parse(grant.data).kind !== 'github-existing-ref' || grant.target !== row.target || target.project !== this.work(row.work).project)
            throw Error('Original branch grant correspondence unavailable');
        historicalGrantRoot(this.s, row.work, grant.root, parse(grant.data).scope);
        return { row: { ...row, data }, target: { ...target, data: configuration } };
    }
    /** Only a validated original owner receipt chain can bridge publication epochs. */
    private originalPublication(op: ReturnType<Merges['op']>) {
        if (!Object.hasOwn(op.data, 'reauthorization'))
            return this.publication(op.data.branchOperationId);
        const historical = ownerMergePublicationHistory(this.s, op, this.target(op.target), this.h.options.installationHome);
        if (!historical.reauthorizations)
            throw Error('Original owner merge reauthorization proof required');
        this.h.changes.assertCurrentEvidence(op.data.evidence);
        return historical.publication;
    }
    private registration(input: RegisterMergeTarget) {
        mergeBranchName(input.baseRef);
        if (Object.keys(input).some(key => !['resourceId', 'sourceBranchTargetId', 'baseRef'].includes(key)))
            throw Error('Unknown merge target input');
        const target = this.s.one(`SELECT id,project,${bounded('data', 131072)} AS data FROM effect_targets WHERE id=?`, input.sourceBranchTargetId);
        if (!target || typeof target.data !== 'string')
            throw Error('Existing registered source branch target required');
        const configuration = parse(target.data), repository = configuration.repository;
        if (configuration.kind !== 'github-existing-ref' || repository?.visibility !== 'public' || configuration.target?.host !== 'github.com' || configuration.target.repositoryId !== repository.repositoryId || configuration.target.repositoryNodeId !== repository.repositoryNodeId || configuration.target.owner !== repository.owner || configuration.target.repository !== repository.repository)
            throw Error('Registered public source branch identity required');
        const project = this.s.one(`SELECT id,${bounded('root', 4096)} AS root,${bounded('profile', 131072)} AS profile FROM projects WHERE id=?`, target.project);
        if (!project || typeof project.root !== 'string' || typeof project.profile !== 'string')
            throw Error('Original bounded registered project unavailable');
        const resource = this.s.one(`SELECT *,${bounded('data', 1048576)} AS data FROM tracked_resources WHERE id=?`, input.resourceId);
        if (!resource || typeof resource.data !== 'string' || resource.kind !== 'pull-request')
            throw Error('Actual retained tracked PR required');
        const tracked = parse(resource.data);
        if (tracked.merged !== false || resource.repository_id !== repository.repositoryId || resource.repository_node !== repository.repositoryNodeId || tracked.input?.repository?.owner !== repository.owner || tracked.input.repository.repository !== repository.repository || tracked.input.repository.repositoryId !== repository.repositoryId || tracked.input.repository.repositoryNodeId !== repository.repositoryNodeId)
            throw Error('Tracked PR/source branch repository identity differs');
        const source = this.s.one(`SELECT ${bounded('origin', 4096)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, tracked.registrationSource);
        if (!source || typeof source.origin !== 'string' || typeof source.raw !== 'string')
            throw Error('Actual bounded original tracked PR registration unavailable');
        const registration = parse(source.raw);
        if (parse(source.origin).kind !== 'owner-resource-track' || hash(registration.request) !== hash(tracked.input) || registration.repositoryId !== resource.repository_id || registration.repositoryNodeId !== resource.repository_node || registration.validatedIdentity?.id !== resource.resource_id || registration.validatedIdentity.nodeId !== resource.resource_node)
            throw Error('Actual original tracked PR registration unavailable');
        const identity: NativeMergeIdentity = { expectedUserId: configuration.expectedUserId, target: structuredClone(repository), pullNumber: resource.number, pullId: resource.resource_id, pullNodeId: resource.resource_node, baseRef: input.baseRef, headRef: configuration.target.ref.slice('refs/heads/'.length) };
        return { target, resource, identity, project, projectId: target.project, fingerprint: hash({ target, resource, identity, project, source }) };
    }
    inspectRegistration(request: RegisterMergeTarget): MergeRegistrationContext {
        this.h.assertOpen();
        const input = structuredClone(request), captured = this.registration(input);
        return Object.freeze({ version: 1 as const, fingerprint: captured.fingerprint,
            project: Object.freeze({ id: captured.project.id as string, sourceRoot: captured.project.root as string }),
            sourceBranchTargetId: input.sourceBranchTargetId, resourceId: input.resourceId,
            identity: Object.freeze({ ...captured.identity, target: Object.freeze({ ...captured.identity.target }) }) });
    }
    register(request: RegisterMergeTarget, signal?: AbortSignal, validate?: () => void) {
        return this.own((async () => {
            this.h.assertOpen();
            this.h.assertOwnerConfigurationAdmission();
            const input = structuredClone(request), captured = this.registration(input), session = this.session;
            if (!session)
                throw Error('Explicit native merge credential required');
            const abort = AbortSignal.any([this.closing.signal, ...signal ? [signal] : []]);
            const guard = () => {
                this.h.assertOpen();
                this.h.assertOwnerConfigurationAdmission();
                abort.throwIfAborted();
                validate?.();
                if (session !== this.session || this.registration(input).fingerprint !== captured.fingerprint)
                    throw Error('Original merge registration operands changed');
            };
            guard();
            const observed = await session.observeIdentity(captured.identity, guard, abort);
            return this.s.tx(() => {
                guard();
                const data = { kind: family, identity: observed.identity, repository: observed.identity.target, target: { host: 'github.com', ...observed.identity.target, ref: 'refs/heads/' + observed.identity.baseRef }, resourceId: input.resourceId, sourceBranchTargetId: input.sourceBranchTargetId };
                const matches = this.s.all(`SELECT id,${bounded('data', 131072)} AS data FROM effect_targets WHERE json_extract(data,'$.kind')=? AND json_extract(data,'$.resourceId')=? LIMIT 2`, family, input.resourceId);
                if (matches.length && (matches.length !== 1 || typeof matches[0].data !== 'string' || hash(parse(matches[0].data)) !== hash(data)))
                    throw Error('Retained merge target differs; inspect its original instead of replacing it');
                const id = matches[0]?.id ?? randomUUID();
                if (!matches.length)
                    this.s.run('INSERT INTO effect_targets VALUES(?,?,?)', id, captured.projectId, JSON.stringify(data));
                this.s.run('INSERT INTO authority_observations VALUES(?,?,?)', randomUUID(), id, JSON.stringify({ kind: 'merge-target-identity-only', observed }));
                return { targetId: id as string };
            });
        })());
    }
    inspectDelegation(workId: string, targetId: string, busy = this.h.busy(workId), purpose: 'declaration' | 'renewal' = 'declaration') {
        this.h.assertOpen();
        return mergeDelegation(this.s, workId, targetId, this.inspectTarget(targetId), busy, purpose);
    }
    renew(workId: string, targetId: string, expectedContext: string, reason: string, validate: () => void, busy: () => boolean) {
        this.h.assertOpen();
        this.h.assertOwnerConfigurationAdmission();
        if (typeof reason !== 'string' || !reason.trim() || Buffer.byteLength(reason) > 4096)
            throw Error('A bounded owner renewal reason of1..4096 bytes is required');
        const check = () => {
            this.h.assertOpen();
            if (validate() !== undefined)
                throw Error('Synchronous original merge renewal validation required');
            this.h.assertOpen();
            this.h.assertOwnerConfigurationAdmission();
            const context = this.inspectDelegation(workId, targetId, busy(), 'renewal');
            if (!context.eligible || !context.existing || context.fingerprint !== expectedContext)
                throw Error('Original merge renewal context changed or is held; review again');
            return context;
        };
        check();
        return this.s.tx(() => {
            const context = check(), previous = this.s.one('SELECT id,root,target,epoch,data FROM effect_delegations WHERE id=?', context.existing!.delegationId), data = parse(previous.data), sourceId = randomUUID();
            const origin = { kind: 'owner-merge-grant-renewal', uid: process.getuid?.(), root: previous.root, grantId: previous.id, targetId: previous.target }, event = { version: 1, grantId: previous.id, workId: previous.root, targetId: previous.target, reason, used: context.existing!.used, fromRootEpoch: data.rootEpoch, toRootEpoch: context.workEpoch, previous }, raw = JSON.stringify(event), next = JSON.stringify({ ...data, rootEpoch: context.workEpoch, renewal: { version: 1, sourceId } });
            if (Buffer.byteLength(raw) > 131072 || Buffer.byteLength(next) > 65536)
                throw Error('Original bounded merge renewal record cannot be retained');
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, null, JSON.stringify(origin), raw);
            this.s.run('UPDATE effect_delegations SET epoch=epoch+1,data=? WHERE id=?', next, previous.id);
            mergeGrantHistory(this.s, { ...previous, epoch: previous.epoch + 1, data: next });
            return { delegationId: previous.id, sourceId, previousEpoch: previous.epoch, epoch: previous.epoch + 1, workEpoch: context.workEpoch, used: context.existing!.used, operationLimit: context.existing!.operationLimit };
        });
    }
    listDelegationWorks(targetId: string, options: {
        limit?: number;
        before?: string;
    } = {}, busy: (id: string) => boolean = id => this.h.busy(id)) {
        this.h.assertOpen();
        const target = this.target(targetId), limit = options.limit ?? 25;
        if (Object.keys(options).some(key => !['limit', 'before'].includes(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw Error('Merge work discovery requires limit1..100');
        const membership = 'w.project=? AND c.work IS NOT NULL';
        let position: number | undefined;
        if (options.before !== undefined) {
            const cursor = this.s.one('SELECT w.rowid AS position FROM works w JOIN change_state c ON c.work=w.id WHERE w.id=? AND ' + membership, options.before, target.project);
            if (!cursor)
                throw Error('Original merge work cursor unavailable');
            position = cursor.position;
        }
        const rows = this.s.all('SELECT w.id FROM works w JOIN change_state c ON c.work=w.id WHERE ' + membership + (position === undefined ? '' : ' AND w.rowid<?') + ' ORDER BY w.rowid DESC LIMIT ?', target.project, ...position === undefined ? [] : [position], limit + 1);
        return { works: rows.slice(0, limit).map(row => this.inspectDelegation(row.id, targetId, busy(row.id))), nextCursor: rows.length > limit ? rows[limit - 1].id as string : null };
    }
    delegate(input: DelegateMerge, insideActivation = false, validate?: () => void) {
        this.h.assertOpen();
        const request = structuredClone(input), captured = insideActivation ? undefined : this.inspectDelegation(input.workId, input.targetId), work = this.work(request.workId), target = this.target(request.targetId), origin = parse(this.s.one('SELECT origin FROM sources WHERE id=?', work.source)?.origin ?? 'null');
        if (!origin || !String(origin.kind).startsWith('owner-') || origin.uid !== process.getuid?.() || contextWorkContinuation(this.s, work.id) || work.lineage !== work.id || work.predecessor || ['UNKNOWN', 'INTERRUPTED', 'CANCELLED'].includes(work.state))
            throw Error('Independent original active owner root required for a merge grant');
        if (!insideActivation) {
            assertOwnerRootActivated(this.s, work.id);
            if (parse(work.data).kind !== 'governed-change')
                throw Error('Ordinary-root merge grants require captured startup activation; late new authority is unavailable');
        }
        if (!Number.isSafeInteger(request.operationLimit) || request.operationLimit < 1 || request.operationLimit > 100 || !['work', 'delegation-lineage'].includes(request.scope ?? 'work') || request.notifications !== 'allow-merge-notifications' || request.scope !== 'delegation-lineage' && work.project !== target.project)
            throw Error('Finite separate ordinary merge grant and explicit notification permission required');
        const data = { kind: family, mode: 'ordinary', scope: request.scope ?? 'work', operationLimit: request.operationLimit, notifications: request.notifications, rootEpoch: work.epoch, projectId: target.project, ownerUid: process.getuid?.() };
        const insert = () => {
            if (validate?.() !== undefined)
                throw Error('Synchronous owner merge delegation validation required');
            if (!insideActivation) {
                const current = this.inspectDelegation(request.workId, request.targetId);
                if (!current.eligible || current.fingerprint !== captured?.fingerprint || hash(this.work(request.workId)) !== hash(work) || hash(this.target(request.targetId)) !== hash(target))
                    throw Error('Original merge delegation context changed or is held: ' + current.holds.join('; '));
            }
            const old = this.s.one('SELECT * FROM effect_delegations WHERE root=? AND target=?', work.id, target.id);
            if (old) {
                mergeGrantHistory(this.s, old);
                if (hash((({ source, renewal, ...rest }) => rest)(parse(old.data))) !== hash(data))
                    throw Error('Original merge grant cannot be reset or implicitly renewed');
                return { delegationId: old.id as string };
            }
            const id = randomUUID(), source = randomUUID();
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', source, null, JSON.stringify({ kind: 'owner-merge-grant', uid: process.getuid?.(), root: work.id }), JSON.stringify(request));
            this.s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', id, work.id, target.id, 1, JSON.stringify({ ...data, source }));
            return { delegationId: id };
        };
        return insideActivation ? insert() : this.s.tx(insert);
    }
    activateOwnerRoot(workId: string, config: MergeDelegationConfig) {
        if (this.target(config.targetId).project !== config.projectId)
            throw Error('Captured merge grant project/target differs');
        return this.delegate({ workId, targetId: config.targetId, operationLimit: config.operationLimit, scope: 'delegation-lineage', notifications: config.notifications }, true);
    }
    private grant(workId: string, targetId: string) {
        const work = this.work(workId), target = this.target(targetId), ancestors = this.authority.ancestry(workId);
        const rows = this.s.all(`SELECT *,${bounded('data', 65536)} AS data FROM effect_delegations WHERE target=? LIMIT 129`, targetId);
        if (rows.length > 128)
            throw Error('Original bounded merge grant history unavailable');
        for (const row of rows) {
            if (typeof row.data !== 'string')
                throw Error('Original merge grant unavailable');
            const data = parse(row.data), root = this.work(row.root);
            if (data.kind !== family || !(row.root === workId || data.scope === 'delegation-lineage' && ancestors.includes(row.root)))
                continue;
            const source = this.s.one(`SELECT ${bounded('origin', 65536)} AS origin,${bounded('raw', 65536)} AS raw FROM sources WHERE id=?`, data.source), origin = source ? parse(source.origin) : null, request = source?.raw ? parse(source.raw) : null;
            const count = this.s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', row.id).n;
            if (data.mode !== 'ordinary' || data.notifications !== 'allow-merge-notifications' || !['work', 'delegation-lineage'].includes(data.scope) || !Number.isSafeInteger(data.operationLimit) || data.operationLimit < 1 || data.operationLimit > 100 || count > data.operationLimit || data.ownerUid !== process.getuid?.() ||
                !origin || origin.kind !== 'owner-merge-grant' || origin.uid !== process.getuid?.() || origin.root !== row.root || !request || request.workId !== row.root || request.targetId !== row.target || request.operationLimit !== data.operationLimit || request.notifications !== data.notifications || (request.scope ?? 'work') !== data.scope)
                throw Error('Original finite owner merge grant/source correspondence unavailable');
            mergeGrantHistory(this.s, row);
            if (data.rootEpoch === root.epoch && data.projectId === target.project && work.project === target.project && !['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(root.state))
                return { ...row, data };
        }
        throw Error('Separate current original ordinary merge grant required');
    }
    private holds(targetId: string, except: string | null = null) {
        const t = this.target(targetId);
        const holds = receiverTransmissionHolds(this.s, { family: 'github-merge', target: t.data.target }, except);
        if (holds.length)
            throw Error('Original receiver transmission holds: ' + holds.map(row => row.id).join(', '));
    }
    private validate(id: string) {
        this.h.assertOpen();
        const op = this.op(id), grant = this.grant(op.work, op.target), target = this.target(op.target);
        if (!['ACTIVE', 'DELIVERED'].includes(this.work(op.work).state))
            throw Error('Original merge work admission unavailable');
        if (grant.id !== op.grant_id || grant.epoch !== op.data.grantEpoch || this.work(op.work).epoch !== op.data.epoch || this.work(op.work).generation !== op.data.generation)
            throw Error('Original merge authority epoch changed; no implicit recovery');
        this.h.changes.assertCurrentEvidence(op.data.evidence);
        this.authority.validateOrigin(op);
        if (op.data.ownerSnapshot && hash(this.authority.owner(grant.root)) !== hash(op.data.ownerSnapshot))
            throw Error('Original merge owner source or direction changed');
        const branch = this.originalPublication(op);
        if (branch.row.work !== op.work || !Object.hasOwn(op.data, 'reauthorization') && branch.row.data.evidence.fingerprint !== op.data.evidence.fingerprint || branch.row.target !== target.data.sourceBranchTargetId || op.data.subject && (branch.row.data.integrationCommit !== op.data.subject.expectedHead || branch.row.data.tree !== op.data.subject.expectedTree))
            throw Error('Current reviewed publication/merge candidate correspondence changed');
        return { op, grant, target };
    }
    async queue(input: {
        reviewedAssignmentId: string;
        targetId: string;
        branchOperationId: string;
    }, identity: NativeIdentity, entry: () => void) {
        const request = structuredClone(input), actor = structuredClone(identity);
        const context = () => {
            this.h.assertOpen();
            entry();
            assertOrdinaryEffectSource(this.s, actor.workId, actor);
            const live = this.h.interactions.getHandle(actor.conversationId);
            if (!live || hash(live.identity) !== hash(actor))
                throw Error('Exact current native merge coordinator required');
            const assignment = this.s.one(`SELECT *,${bounded('data', 65536)} AS data FROM conversation_assignments WHERE id=?`, request.reviewedAssignmentId);
            if (!assignment || assignment.state !== 'COMPLETE' || typeof assignment.data !== 'string')
                throw Error('Actual completed reviewed governed assignment required');
            const data = parse(assignment.data), work = this.work(assignment.work), invocation = parse(work.data).invocation;
            if (data.operation !== 'change' || invocation?.assignmentId !== assignment.id || invocation.conversationId !== assignment.target || hash(invocation.actor) !== hash(data.source) || assignment.source_conversation !== data.source?.conversationId)
                throw Error('Original reviewed merge assignment/invocation correspondence differs');
            if (contextWorkContinuation(this.s, work.id))
                throw Error('Context-origin merge requires its separate original authority route');
            const target = this.target(request.targetId), grant = this.grant(work.id, target.id), branch = this.publication(request.branchOperationId);
            if (!this.authority.ancestry(actor.workId).includes(grant.root) || !this.authority.ancestry(work.id).includes(grant.root) || branch.row.work !== work.id || branch.row.target !== target.data.sourceBranchTargetId || branch.row.data.reviewedAssignmentId !== assignment.id)
                throw Error('Exact original grant, reviewed assignment and confirmed publication required');
            return { assignment, work, target, grant, branch, origin: this.authority.source(actor), ownerRoot: this.authority.owner(grant.root) };
        };
        const before = context(), fingerprint = hash(before), evidence = await this.h.changes.currentEvidence(before.work.id);
        const current = () => {
            if (hash(context()) !== fingerprint)
                throw Error('Original native merge context changed during admission');
            this.h.changes.assertCurrentEvidence(evidence);
        };
        current();
        return this.s.tx(() => {
            current();
            this.holds(before.target.id);
            if (this.s.one('SELECT id FROM effect_operations WHERE work=? AND target=?', before.work.id, before.target.id))
                throw Error('Original merge already exists; inspect/reconcile without replacement');
            if (this.s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', before.grant.id).n >= before.grant.data.operationLimit)
                throw Error('Original cumulative merge allowance exhausted');
            const id = randomUUID(), assignmentId = randomUUID(), conversationId = randomUUID();
            this.s.run('INSERT INTO conversations VALUES(?,?,NULL,0,?)', conversationId, before.work.project, 'QUEUED');
            this.s.run('INSERT INTO conversation_state(conversation,work,resource,data) VALUES(?,?,?,?)', conversationId, before.work.id, 'QUEUED', JSON.stringify({ role: 'Merge', purpose: 'Exact existing PR merge under separate ordinary delegation' }));
            this.s.run('INSERT INTO conversation_relations(child,parent) VALUES(?,?)', conversationId, actor.conversationId);
            this.s.run('INSERT INTO conversation_views(conversation) VALUES(?)', conversationId);
            this.s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', assignmentId, actor.conversationId, conversationId, before.work.id, 'QUEUED', JSON.stringify({ operation: 'effect-merge', effectOperationId: id, reviewedWorkId: before.work.id, reviewedAssignmentId: before.assignment.id, source: actor, delegationRoot: before.grant.root }));
            this.s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', randomUUID(), actor.conversationId, conversationId, assignmentId, 'PENDING', JSON.stringify({ source: actor }));
            const data = JSON.stringify({ kind: family, branchOperationId: before.branch.row.id, headCommit: before.branch.row.data.integrationCommit, evidence, grantEpoch: before.grant.epoch, epoch: before.work.epoch, generation: before.work.generation, reviewedAssignmentId: before.assignment.id, origin: before.origin, ownerRoot: before.ownerRoot, subjectContextFingerprint: this.authority.subject(before.work.id).contextFingerprint, assignmentId, conversationId, blocked: [], nextAction: 'Current original PR native preparation and conditional merge' });
            if (Buffer.byteLength(data) > 1048576)
                throw Error('Original agent merge exceeds bounded inspection size');
            this.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', id, before.work.id, before.target.id, before.grant.id, 'PREPARED', data);
            return { operationId: id, assignmentId, conversationId, state: 'QUEUED' as const };
        });
    }
    operationWork(assignmentId: string) {
        const assignment = this.s.one(`SELECT *,${bounded('data', 65536)} AS data FROM conversation_assignments WHERE id=?`, assignmentId);
        if (!assignment || assignment.state === 'CANCELLED' || typeof assignment.data !== 'string')
            throw Error('Original merge assignment unavailable');
        const data = parse(assignment.data), op = this.op(data.effectOperationId);
        if (data.operation !== 'effect-merge' || op.work !== assignment.work || op.data.assignmentId !== assignment.id || op.data.conversationId !== assignment.target || data.reviewedAssignmentId !== op.data.reviewedAssignmentId)
            throw Error('Original merge alias correspondence differs');
        return op.work as string;
    }
    async runQueued(assignmentId: string) {
        const work = this.operationWork(assignmentId), assignment = this.s.one('SELECT data FROM conversation_assignments WHERE id=?', assignmentId), op = this.op(parse(assignment.data).effectOperationId);
        if (op.work !== work || op.phase !== 'PREPARED')
            throw Error('Original unstarted merge alias required');
        const prepared = await this.prepareOriginal(op.id);
        return prepared.phase === 'RESERVED' ? this.dispatch(op.id) : prepared;
    }
    holdInheritedSource(id: string) {
        const op = this.op(id);
        this.aborts.get(id)?.abort(new Error('Original parent owner input changed'));
        return this.patch(id, ['INVOKING', 'UNKNOWN'].includes(op.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: ['Exact inherited owner source requires same-work source-fit'], nextAction: 'Preserve original merge and work; no implicit reauthorization or resend' });
    }
    scopedInspect(id: string, actor: NativeIdentity, entry: () => void) {
        entry();
        const op = this.op(id), grant = this.s.one('SELECT * FROM effect_delegations WHERE id=?', op.grant_id);
        if (!grant || parse(grant.data).kind !== family || grant.target !== op.target || !this.authority.ancestry(actor.workId).includes(grant.root))
            throw Error('Merge original outside captured owner lineage');
        return this.inspect(id);
    }
    scopedReconcile(id: string, actor: NativeIdentity, entry: () => void, signal?: AbortSignal) {
        this.scopedInspect(id, actor, entry);
        if (this.op(id).work === actor.workId)
            throw Error('Original active subject must settle before separate merge reconciliation');
        return this.reconcile(id, undefined, signal, () => {
            entry();
            this.scopedInspect(id, actor, entry);
        });
    }
    grantContext(workId: string) {
        const ancestors = this.authority.ancestry(workId);
        return this.s.all("SELECT * FROM effect_delegations WHERE json_extract(data,'$.kind')=?", family).filter(row => row.root === workId || parse(row.data).scope === 'delegation-lineage' && ancestors.includes(row.root)).map(row => ({ grantId: row.id, targetId: row.target, action: 'mergeExistingPullRequest', notifications: parse(row.data).notifications, remainingOperations: Math.max(0, parse(row.data).operationLimit - this.s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', row.id).n) }));
    }
    listOwnerOriginals(workId: string, targetId: string) {
        this.h.assertOpen();
        this.work(workId);
        this.target(targetId);
        return { originals: this.s.all('SELECT id FROM effect_operations WHERE work=? AND target=? ORDER BY rowid LIMIT 2', workId, targetId).map(row => this.inspectRetained(row.id)) };
    }
    listOwnerPublications(workId: string, targetId: string, options: {
        limit?: number;
        before?: string;
    } = {}) {
        this.h.assertOpen();
        this.work(workId);
        const target = this.target(targetId), limit = options.limit ?? 25;
        if (Object.keys(options).some(key => !['limit', 'before'].includes(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw Error('Published branch discovery requires limit1..100');
        let position: number | undefined;
        if (options.before !== undefined) {
            const cursor = this.s.one('SELECT rowid AS position FROM effect_operations WHERE id=? AND work=? AND target=?', options.before, workId, target.data.sourceBranchTargetId);
            if (!cursor)
                throw Error('Original branch publication cursor unavailable');
            position = cursor.position;
        }
        const rows = this.s.all(`SELECT id,${bounded('phase', 128)} AS phase,CASE WHEN length(CAST(data AS BLOB))<=1048576 AND json_valid(data) THEN substr(json_extract(data,'$.kind'),1,128) ELSE NULL END AS kind FROM effect_operations WHERE work=? AND target=? ${position === undefined ? '' : 'AND rowid<?'} ORDER BY rowid DESC LIMIT ?`, workId, target.data.sourceBranchTargetId, ...position === undefined ? [] : [position], limit + 1);
        return { scope: 'Recorded branch publication only; procedure and native standing NOT RECHECKED', publications: rows.slice(0, limit).map(row => ({ operationId: row.id as string, recordedPhase: row.phase as string | null, state: row.phase === 'CONFIRMED' && row.kind === 'github-existing-ref' ? 'RECORDED' as const : 'HELD' as const })), nextCursor: rows.length > limit ? rows[limit - 1].id as string : null };
    }
    inspectOwnerPreparation(workId: string, targetId: string, branchOperationId: string, busy = this.h.busy(workId)) {
        this.h.assertOpen();
        const delegation = this.inspectDelegation(workId, targetId, busy), target = this.target(targetId), work = this.work(workId);
        const project = this.s.one(`SELECT id,${bounded('root', 4096)} AS root,${bounded('profile', 131072)} AS profile FROM projects WHERE id=?`, work.project), branch = this.s.one(`SELECT id,work,target,grant_id,${bounded('phase', 128)} AS phase,${bounded('data', 1048576)} AS data FROM effect_operations WHERE id=?`, branchOperationId), branchGrant = branch ? this.s.one(`SELECT id,root,target,epoch,${bounded('data', 65536)} AS data FROM effect_delegations WHERE id=?`, branch.grant_id) : null, sourceTarget = this.s.one(`SELECT id,project,${bounded('data', 131072)} AS data FROM effect_targets WHERE id=?`, target.data.sourceBranchTargetId), originals = this.s.all(`SELECT id,${bounded('phase', 128)} AS phase FROM effect_operations WHERE work=? AND target=? ORDER BY rowid LIMIT 2`, workId, targetId);
        const allowances = this.s.all("SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage=? AND kind IN ('execution','resolution') ORDER BY kind", work.lineage).map(row => ({ kind: row.kind as string, limit: row.lim as number, consumed: row.consumed as number, reserved: row.reserved as number, remaining: row.lim - row.consumed - row.reserved }));
        const holds = [...delegation.holds];
        if (!allowances.some(row => row.kind === 'execution' && Number.isSafeInteger(row.remaining) && row.remaining > 0))
            holds.push('Original merge execution allowance exhausted; extend the same work separately');
        let published: {
            operationId: string;
            headCommit: string;
            tree: string;
        } | null = null;
        try {
            if (!project || typeof project.root !== 'string' || typeof project.profile !== 'string')
                throw Error('Original bounded registered project unavailable');
            if (!branch || branch.work !== workId || branch.target !== target.data.sourceBranchTargetId || branch.phase !== 'CONFIRMED' || typeof branch.data !== 'string')
                throw Error('Select the same work’s confirmed original source branch publication');
            const data = parse(branch.data), configuration = sourceTarget?.data ? parse(sourceTarget.data) : null, g = branchGrant?.data ? parse(branchGrant.data) : null;
            if (data.kind !== 'github-existing-ref' || data.evidence?.workId !== workId || !configuration || configuration.kind !== 'github-existing-ref' || sourceTarget.project !== work.project || hash(configuration.repository) !== hash(target.data.repository) || configuration.target?.host !== 'github.com' || configuration.target.repositoryId !== configuration.repository.repositoryId || configuration.target.repositoryNodeId !== configuration.repository.repositoryNodeId || configuration.target.owner !== configuration.repository.owner || configuration.target.repository !== configuration.repository.repository || configuration.target.ref !== 'refs/heads/' + target.data.identity.headRef || configuration.expectedUserId !== target.data.identity.expectedUserId || !g || g.kind !== 'github-existing-ref' || branchGrant.target !== branch.target)
                throw Error('Original published branch/target/grant identity unavailable');
            historicalGrantRoot(this.s, workId, branchGrant.root, g.scope);
            mergeCommitId(data.integrationCommit);
            mergeCommitId(data.tree);
            published = { operationId: branch.id, headCommit: data.integrationCommit, tree: data.tree };
            if (!delegation.existing)
                throw Error('Separate current original ordinary merge grant required');
            if (!originals.length && delegation.existing.remaining < 1)
                throw Error('Original cumulative merge operation allowance exhausted');
            if (originals.length > 1)
                throw Error('Multiple retained originals require inspection; no replacement allocation');
        }
        catch (error) {
            holds.push(error instanceof Error ? error.message : 'Original bounded preparation context unavailable');
        }
        return { workId, targetId, branchOperationId, delegation, allowances, project: project ? { id: project.id as string, sourceRoot: project.root as string | null } : null, published, originals: originals.map(row => ({ operationId: row.id as string, recordedPhase: row.phase as string | null })), procedureStanding: 'NOT RECHECKED', nativeEligibility: 'NOT RECHECKED', holds, eligible: holds.length === 0, fingerprint: hash({ delegation, project, branch, branchGrant, sourceTarget, originals }) };
    }
    prepareOwner(workId: string, targetId: string, branchOperationId: string, signal?: AbortSignal, validate?: () => void, admission?: () => void) {
        return this.own((async () => {
            const abort = AbortSignal.any([this.closing.signal, ...signal ? [signal] : []]), session = this.session;
            this.h.assertOpen();
            this.h.assertInteractionAdmission();
            abort.throwIfAborted();
            if (!session)
                throw Error('Explicit native merge credential required');
            const work = this.work(workId), grant = this.grant(workId, targetId), target = this.target(targetId), owner = this.authority.owner(grant.root);
            const captured = this.inspectDelegation(workId, targetId);
            if (!captured.eligible)
                throw Error('Original owner merge preparation is held: ' + captured.holds.join('; '));
            const candidateSnapshot = () => ownerMergeCandidateSnapshot(this.s, workId, this.publication(branchOperationId).row.data.evidence?.versions?.candidate, this.h.options.installationHome);
            const issuedCandidate = candidateSnapshot();
            const operands = () => {
                const source = this.s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 32768)} AS raw FROM sources WHERE id=?`, this.work(workId).source);
                if (!source || typeof source.origin !== 'string' || typeof source.raw !== 'string')
                    throw Error('Original bounded owner preparation source unavailable');
                const project = this.s.one(`SELECT id,${bounded('root', 4096)} AS root,${bounded('profile', 131072)} AS profile FROM projects WHERE id=?`, work.project);
                if (!project || typeof project.root !== 'string' || typeof project.profile !== 'string')
                    throw Error('Original bounded registered project unavailable');
                return hash({ candidateSnapshot: candidateSnapshot(), project, work: this.work(workId), source, grant: this.grant(workId, targetId), target: this.target(targetId), branch: this.publication(branchOperationId), owner: this.authority.owner(grant.root) });
            };
            const original = operands();
            const guard = (beforeAllocation = false) => {
                this.h.assertOpen();
                this.h.assertInteractionAdmission();
                abort.throwIfAborted();
                if (validate?.() !== undefined)
                    throw Error('Synchronous owner merge preparation validation required');
                this.h.assertOpen();
                abort.throwIfAborted();
                if (session !== this.session || operands() !== original)
                    throw Error('Original owner merge preparation operands changed');
                if (beforeAllocation) {
                    admission?.();
                    const budget = this.s.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'", work.lineage);
                    if (!budget || budget.lim - budget.consumed - budget.reserved < 1)
                        throw Error('Original merge execution allowance exhausted before allocation');
                    const current = this.inspectDelegation(workId, targetId);
                    if (!current.eligible || current.fingerprint !== captured.fingerprint)
                        throw Error('Original owner merge preparation context changed or is held');
                }
            };
            guard(true);
            const evidence = await this.h.changes.currentEvidence(workId);
            guard(true);
            const branch = this.publication(branchOperationId);
            if (branch.row.work !== workId || branch.row.target !== target.data.sourceBranchTargetId || branch.row.data.evidence.fingerprint !== evidence.fingerprint)
                throw Error('Merge requires the same exact published reviewed work');
            const id = this.s.tx(() => {
                guard(true);
                this.h.changes.assertCurrentEvidence(evidence);
                this.holds(targetId);
                if (this.s.one('SELECT id FROM effect_operations WHERE work=? AND target=?', workId, targetId))
                    throw Error('Original merge exists; inspect/reconcile without replacement');
                if (this.s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', grant.id).n >= grant.data.operationLimit)
                    throw Error('Original cumulative merge allowance exhausted');
                const id = randomUUID();
                const data = JSON.stringify({ kind: family, branchOperationId, headCommit: branch.row.data.integrationCommit, ...issuedCandidate ? { candidateSnapshot: issuedCandidate } : {}, evidence, grantEpoch: grant.epoch, epoch: work.epoch, generation: work.generation, blocked: [], nextAction: 'Explicit current merge preparation', ownerSnapshot: owner });
                if (Buffer.byteLength(data) > 1048576)
                    throw Error('Original owner merge preparation exceeds bounded inspection size');
                this.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', id, workId, targetId, grant.id, 'PREPARED', data);
                return id;
            });
            try {
                return await this.prepareOriginal(id, abort, () => guard());
            }
            catch (error) {
                throw Error('Original PR merge ' + id + ' retained for work ' + workId + ' and target ' + targetId + '; preparation unavailable: ' + (error instanceof Error ? error.message : 'Native request unavailable'), { cause: error });
            }
        })());
    }
    private prepareOriginal(id: string, signal?: AbortSignal, validate?: () => void, admission?: () => void) {
        return this.run(id, 'prepare', signal, async (session, abort) => {
            const before = this.validate(id), fingerprint = hash(before), guard = () => {
                validate?.();
                abort.throwIfAborted();
                if (session !== this.session || hash(this.validate(id)) !== fingerprint)
                    throw Error('Original merge preparation operands changed');
                this.holds(before.op.target, id);
            };
            const observed = await session.observeIdentity(before.target.data.identity, guard, abort);
            const branch = this.originalPublication(before.op);
            if (observed.head !== branch.row.data.integrationCommit)
                throw Error('Actual native PR head differs from the exact reviewed publication');
            const subject: NativeMergeSubject = { ...before.target.data.identity, expectedBase: observed.base, expectedHead: branch.row.data.integrationCommit, expectedTree: branch.row.data.tree };
            const prepared = await session.prepare(subject, guard, abort);
            return this.s.tx(() => {
                guard();
                this.receipt(id, 'merge-native-preparation', { fingerprint: prepared.fingerprint, subject: prepared.subject, receipts: prepared.receipts });
                const baseChange = { previous: before.op.data.subject?.expectedBase ?? null, current: prepared.subject.expectedBase };
                return { ...this.patch(id, 'RESERVED', { subject: prepared.subject, baseChange, baseReuse: { basis: 'strict-native-base-ancestor-of-exact-reviewed-published-head', reviewedTree: prepared.subject.expectedTree }, nativeFingerprint: prepared.fingerprint, credentialSessionId: session.credentialSessionId, blocked: [], nextAction: 'Explicit same-original merge dispatch' }), baseChange };
            });
        }, admission);
    }
    prepareRetained(id: string, signal?: AbortSignal, validate?: () => void, admission?: () => void) {
        return this.own((async () => {
            this.h.assertOpen();
            this.h.assertInteractionAdmission();
            const session = this.session, original = this.writeFingerprint(id), abort = AbortSignal.any([this.closing.signal, ...signal ? [signal] : []]);
            if (!session)
                throw Error('Explicit native merge credential required');
            const stable = () => {
                this.h.assertOpen();
                this.h.assertInteractionAdmission();
                abort.throwIfAborted();
                if (validate?.() !== undefined)
                    throw Error('Synchronous original merge preparation validation required');
                this.h.assertOpen();
                abort.throwIfAborted();
                if (session !== this.session || this.writeFingerprint(id) !== original)
                    throw Error('Original retained merge preparation operands changed');
            };
            const admit = () => { stable(); admission?.(); stable(); this.assertUnsent(id); };
            admit();
            const evidence = await this.h.changes.currentEvidence(this.op(id).work);
            admit();
            if (evidence.fingerprint !== this.op(id).data.evidence.fingerprint)
                throw Error('Original current procedure candidate differs; no implicit reauthorization');
            return this.prepareOriginal(id, abort, stable, admit);
        })());
    }
    private assertUnsent(id: string) {
        const op = this.op(id);
        if (!['PREPARED', 'RESERVED', 'REFUSED'].includes(op.phase) || op.data.dispatchRun !== undefined && op.data.dispatchRun !== null || op.data.transportOutcome !== undefined && op.data.transportOutcome !== null || op.data.mergedCommit !== undefined && op.data.mergedCommit !== null || op.data.correspondence !== undefined && op.data.correspondence !== null || this.s.one("SELECT id FROM effect_receipts WHERE operation=? AND kind IN ('merge-send','merge-correspondence','merge-candidate-observation') LIMIT 1", id))
            throw Error('Original send intent or outcome already retained; inspect/reconcile without replay');
    }
    private writeFingerprint(id: string, afterIntent = false) {
        const op = this.op(id), work = this.work(op.work), grant = this.grant(op.work, op.target), project = this.s.one(`SELECT id,${bounded('root', 4096)} AS root,${bounded('profile', 131072)} AS profile FROM projects WHERE id=?`, work.project);
        if (!project || typeof project.root !== 'string' || typeof project.profile !== 'string')
            throw Error('Original bounded registered project unavailable');
        const branch = this.s.one(`SELECT id,work,target,grant_id,phase,${bounded('data', 1048576)} AS data FROM effect_operations WHERE id=?`, op.data.branchOperationId), branchGrant = branch ? this.s.one(`SELECT id,root,target,epoch,${bounded('data', 65536)} AS data FROM effect_delegations WHERE id=?`, branch.grant_id) : null, branchTarget = branch ? this.s.one(`SELECT id,project,${bounded('data', 131072)} AS data FROM effect_targets WHERE id=?`, branch.target) : null;
        if (!branch || typeof branch.data !== 'string' || !branchGrant || typeof branchGrant.data !== 'string' || !branchTarget || typeof branchTarget.data !== 'string')
            throw Error('Original bounded branch publication operands unavailable');
        const { blocked, nextAction, dispatchRun, transportOutcome, mergedCommit, correspondence, ...data } = op.data;
        const source = this.s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 32768)} AS raw FROM sources WHERE id=?`, work.source);
        const recovery = Object.hasOwn(op.data, 'reauthorization') ? ownerMergePublicationHistory(this.s, afterIntent ? { ...op, phase: null, data } : op, this.target(op.target), this.h.options.installationHome) : null;
        return hash({ identity: afterIntent ? { op: { ...op, phase: null, data }, work, source, grant, target: this.target(op.target) } : this.readFingerprint(id), recovery, project, branch, branchGrant, branchTarget, owner: this.authority.owner(grant.root), root: this.work(grant.root) });
    }
    dispatch(id: string, signal?: AbortSignal, validate?: () => void, admitted?: () => void) {
        const session = this.session;
        const admission = () => {
            this.h.assertOpen();
            signal?.throwIfAborted();
            if (validate?.() !== undefined)
                throw Error('Synchronous original merge dispatch validation required');
            this.h.assertOpen();
            signal?.throwIfAborted();
            admitted?.();
            const op = this.op(id);
            if (op.phase !== 'RESERVED')
                throw Error('Current reserved merge original required');
            if (!session || session !== this.session || op.data.credentialSessionId !== session.credentialSessionId)
                throw Error('Captured native merge credential changed; explicit same-original preparation required');
            this.assertUnsent(id);
        };
        return this.own(this.run(id, 'dispatch', signal, async (session, abort) => {
            const before = this.validate(id);
            if (before.op.phase !== 'RESERVED')
                throw Error('Current reserved merge original required');
            if (before.op.data.credentialSessionId !== session.credentialSessionId)
                throw Error('Captured native merge credential changed; explicit same-original preparation required');
            const operands = this.writeFingerprint(id, true), stable = () => {
                if (validate?.() !== undefined)
                    throw Error('Synchronous original merge dispatch validation required');
                this.h.assertOpen();
                abort.throwIfAborted();
                if (this.writeFingerprint(id, true) !== operands)
                    throw Error('Original merge dispatch source or publication changed');
            };
            const fingerprint = hash(before), guard = () => {
                stable();
                if (validate?.() !== undefined)
                    throw Error('Synchronous original merge dispatch validation required');
                abort.throwIfAborted();
                if (session !== this.session || hash(this.validate(id)) !== fingerprint)
                    throw Error('Original merge dispatch operands changed');
                this.holds(before.op.target, id);
            };
            const prepared = await session.prepare(before.op.data.subject, guard, abort);
            if (prepared.fingerprint !== before.op.data.nativeFingerprint)
                throw Error('Native merge context changed; current original requires explicit preparation');
            const attempt = await session.send(prepared, guard, () => this.s.tx(() => {
                guard();
                this.patch(id, 'INVOKING', { dispatchRun: Date.now(), transportOutcome: 'uncertain', nextAction: 'Reconcile original; never replay a possible handoff' });
            }), abort);
            // The response receipt and the phase it establishes commit together.
            const refused = attempt.handoff === 'not-started' || attempt.result?.kind === 'rejected';
            this.s.tx(() => {
                this.receipt(id, 'merge-send', attempt);
                // A closing controller must not roll back an outcome that already happened natively.
                if (refused)
                    this.write(id, 'REFUSED', { transportOutcome: attempt.handoff === 'not-started' ? 'not-started' : 'native-rejection', blocked: [attempt.unavailable ?? 'Native merge refused'], nextAction: 'Inspect original refusal; no automatic retry or grant reset' });
                else
                    this.write(id, 'UNKNOWN', { transportOutcome: attempt.result?.kind === 'merged' ? 'native-success' : 'uncertain', mergedCommit: attempt.result?.kind === 'merged' ? attempt.result.commit : null, blocked: ['Native handoff requires exact merged PR/tree/parents readback'], nextAction: 'Read-only original reconciliation; no resend' });
            });
            if (refused)
                return this.inspect(id);
            if (attempt.result?.kind === 'merged') {
                stable();
                return this.correspond(id, attempt.result.commit, session, abort, true, stable);
            }
            return this.inspect(id);
        }, admission));
    }
    private async correspond(id: string, commit: string, session: NonNullable<Merges['session']>, signal: AbortSignal, nativeSuccess: boolean, guard?: () => void) {
        const op = this.op(id), causality = this.readCausality(id), bound = (value: any) => hash({ transportOutcome: value.data.transportOutcome, mergedCommit: value.data.mergedCommit, causal: this.readCausality(id).fingerprint, work: value.work, target: value.target, grant: value.grant_id, subject: value.data.subject, branchOperationId: value.data.branchOperationId, dispatchRun: value.data.dispatchRun });
        if (nativeSuccess && (!causality.nativeSuccess || causality.commit !== commit))
            throw Error('Original native-success causality unavailable');
        const expected = bound(op), correspondence = await session.inspectMergedCandidate(op.data.subject, commit, signal);
        return this.s.tx(() => {
            signal.throwIfAborted();
            guard?.();
            if (bound(this.op(id)) !== expected)
                throw Error('Original merge correspondence changed during final observation');
            this.receipt(id, 'merge-correspondence', correspondence);
            return this.patch(id, nativeSuccess ? 'CONFIRMED' : 'UNKNOWN', { ...nativeSuccess ? { transportOutcome: 'native-success' } : {}, mergedCommit: commit, correspondence, blocked: nativeSuccess ? [] : ['Merged candidate corresponds; original send outcome remains uncertain'], nextAction: nativeSuccess ? 'Confirmed original PR merged with reviewed tree and parents' : 'Resource correspondence alone does not establish original send; preserve uncertainty and do not resend' });
        });
    }
    private readCausality(id: string) {
        const op = this.op(id), rows = this.s.all(`SELECT id,${bounded('data', 1048576)} AS data FROM effect_receipts WHERE operation=? AND kind='merge-send' ORDER BY rowid LIMIT 2`, id);
        if (rows.length > 1 || rows.some(row => typeof row.data !== 'string'))
            throw Error('Original single bounded merge-send receipt unavailable');
        const data = rows[0] ? parse(rows[0].data) : null;
        if (data?.result?.kind === 'merged') {
            const route = '/repos/' + encodeURIComponent(op.data.subject?.target.owner ?? '') + '/' + encodeURIComponent(op.data.subject?.target.repository ?? '') + '/pulls/' + op.data.subject?.pullNumber + '/merge', puts = Array.isArray(data.receipts) ? data.receipts.filter((row: any) => row.method === 'PUT') : [];
            const commit = mergeCommitId(data.result.commit);
            if (data.handoff !== 'request-created' || data.responseStatus !== 200 || data.result.causality !== 'native-success-response' || puts.length !== 1 || puts[0].route !== route || puts[0].status !== 200 || !Number.isSafeInteger(op.data.dispatchRun) || op.data.dispatchRun < 1 || !['uncertain', 'native-success'].includes(op.data.transportOutcome) || op.data.mergedCommit && op.data.mergedCommit !== commit)
                throw Error('Original native-success response/route/marker/commit correspondence unavailable');
            return { nativeSuccess: true, commit, fingerprint: hash(rows) };
        }
        if (op.data.transportOutcome === 'native-success' || op.phase === 'CONFIRMED')
            throw Error('Original native-success marker lacks its exact successful send receipt');
        return { nativeSuccess: false, commit: null, fingerprint: hash(rows) };
    }
    private readFingerprint(id: string) {
        const op = this.op(id), grant = this.s.one(`SELECT id,root,target,epoch,${bounded('data', 65536)} AS data FROM effect_delegations WHERE id=?`, op.grant_id), causal = this.s.all(`SELECT id,kind,${bounded('data', 1048576)} AS data FROM effect_receipts WHERE operation=? AND kind='merge-send' ORDER BY rowid LIMIT 2`, id);
        const work = this.work(op.work), source = this.s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 32768)} AS raw FROM sources WHERE id=?`, work.source);
        return hash({ op, work, source, target: this.target(op.target), grant, causal });
    }
    /** Historical read admission: no current merge grant, procedure or model authority. */
    inspectReconciliation(id: string, busy = this.h.busy(this.op(id).work)) {
        return this.inspectAction(id, 'read', busy);
    }
    inspectPreparation(id: string, busy = this.h.busy(this.op(id).work)) { return this.inspectAction(id, 'prepare', busy); }
    inspectDispatch(id: string, busy = this.h.busy(this.op(id).work)) { return this.inspectAction(id, 'send', busy); }
    private reauthorizationState(id: string, busy: boolean) {
        this.h.assertOpen();
        const previous = this.op(id), work = this.work(previous.work), delegation = this.inspectDelegation(work.id, previous.target, busy), original = this.retained(id), holds = [...delegation.holds], room = this.s.one('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM effect_receipts WHERE operation=?', id);
        let proof: ReturnType<typeof ownerMergePublicationHistory> | null = null;
        try {
            this.assertUnsent(id);
            if (original.state !== 'RETAINED')
                throw Error('Original bounded merge descriptor unavailable');
            proof = ownerMergePublicationHistory(this.s, previous, this.target(previous.target), this.h.options.installationHome);
            const grant = proof.grant, data = parse(grant.data);
            if (!proof.history.events || !proof.history.epochs.some(epoch => epoch.grantEpoch === previous.data.grantEpoch && epoch.rootEpoch === previous.data.epoch) || previous.data.grantEpoch >= grant.epoch || previous.data.epoch >= work.epoch || work.generation < previous.data.generation || data.rootEpoch !== work.epoch)
                throw Error('Original merge requires a separately renewed grant for its older captured epoch');
            if (room.count >= 256 || room.bytes >= 2097152)
                throw Error('Original merge receipt capacity unavailable');
        }
        catch (error) {
            holds.push(error instanceof Error ? error.message : 'Original owner merge reauthorization unavailable');
        }
        const owner = this.authority.owner(work.id), source = this.s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 32768)} AS raw FROM sources WHERE id=?`, work.source), project = this.s.one(`SELECT id,${bounded('root', 4096)} AS root,${bounded('profile', 131072)} AS profile FROM projects WHERE id=?`, work.project);
        if (!source || typeof source.origin !== 'string' || typeof source.raw !== 'string' || parse(work.data).raw !== source.raw)
            holds.push('Original immutable owner request/source correspondence unavailable');
        const review = { operationId: id, workId: work.id as string, targetId: previous.target as string, sourceId: work.source as string, original, delegation, previousEpoch: previous.data.epoch as number, currentEpoch: work.epoch as number, candidate: proof ? { version: proof.candidate.id as string, digest: proof.candidate.hash as string, headCommit: proof.publication.row.data.integrationCommit as string, tree: proof.publication.row.data.tree as string } : null, priorReauthorizations: proof?.reauthorizations ?? 0, procedureStanding: 'NOT RECHECKED', nativeEligibility: 'NOT RECHECKED', receipts: { count: room.count as number, remainingBytes: 2097152 - room.bytes }, eligible: holds.length === 0, holds, fingerprint: hash({ previous, work, delegation, proof, room, owner, source, project, holds, busy }) };
        return { review, proof, previous, work, owner };
    }
    inspectReauthorization(id: string, busy = this.h.busy(this.op(id).work)) { return this.reauthorizationState(id, busy).review; }
    reauthorize(id: string, expectedContext: string, reason: string, signal: AbortSignal | undefined, validate: () => void, busy: () => boolean) {
        return this.own((async () => {
            if (typeof reason !== 'string' || !reason.trim() || Buffer.byteLength(reason) > 4096)
                throw Error('A bounded owner reauthorization reason of1..4096 bytes is required');
            const abort = AbortSignal.any([this.closing.signal, ...signal ? [signal] : []]);
            const current = () => {
                this.h.assertOpen();
                this.h.assertOwnerConfigurationAdmission();
                abort.throwIfAborted();
                if (validate() !== undefined)
                    throw Error('Synchronous owner merge reauthorization validation required');
                this.h.assertOpen();
                this.h.assertOwnerConfigurationAdmission();
                abort.throwIfAborted();
                const context = this.reauthorizationState(id, busy());
                if (!context.review.eligible || context.review.fingerprint !== expectedContext || !context.proof)
                    throw Error('Original merge reauthorization context changed or is held; review again');
                return context;
            };
            const captured = current(), evidence = await this.h.changes.currentEvidence(captured.work.id);
            current();
            this.h.changes.assertCurrentEvidence(evidence);
            if (evidence.workId !== captured.work.id || evidence.epoch !== captured.work.epoch || evidence.generation !== captured.work.generation || evidence.versions.candidate !== captured.proof!.candidate.id || evidence.candidateDigest !== captured.proof!.candidate.hash)
                throw Error('Current software standing does not cover this unchanged original published candidate');
            return this.s.tx(() => {
                const context = current();
                this.h.changes.assertCurrentEvidence(evidence);
                const proof = context.proof!, previous = context.previous;
                const next = { grantEpoch: proof.grant.epoch, epoch: context.work.epoch, generation: context.work.generation, evidence, ownerSnapshot: context.owner }, event = { version: 1, origin: { kind: 'owner-merge-reauthorization', uid: process.getuid?.(), sourceId: context.review.sourceId }, reason, previous, current: next, publication: proof.publication, candidate: proof.candidate };
                const receiptId = this.receipt(id, 'merge-owner-reauthorization', event), data = { kind: family, branchOperationId: previous.data.branchOperationId, headCommit: previous.data.headCommit, candidateSnapshot: previous.data.candidateSnapshot, ...next, reauthorization: { version: 1, receiptId }, blocked: [], nextAction: 'Explicitly prepare this original merge again; reauthorization does not prepare or send' };
                const serialized = JSON.stringify(data);
                if (Buffer.byteLength(serialized) > 1048576)
                    throw Error('Original owner merge reauthorization exceeds bounded inspection size');
                this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', 'PREPARED', serialized, id);
                this.validate(id);
                if (this.retained(id).state !== 'RETAINED')
                    throw Error('Reauthorized original merge descriptor unavailable');
                return { operationId: id, workId: previous.work, targetId: previous.target, grantId: previous.grant_id, grantEpoch: next.grantEpoch, receiptId, phase: 'PREPARED' as const };
            });
        })());
    }
    private inspectAction(id: string, action: 'read' | 'prepare' | 'send', busy: boolean) {
        this.h.assertOpen();
        const original = this.retained(id), op = this.op(id), work = this.work(op.work);
        const source = this.s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 32768)} AS raw FROM sources WHERE id=?`, work.source);
        const runs = this.s.all(`SELECT id,phase,reservation,${bounded('data', 65536)} AS data FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 129`, work.id), capacities = this.s.all("SELECT id,state FROM capacity_leases WHERE work=? AND state NOT IN ('RELEASED','CANCELLED') LIMIT 129", work.id), budget = this.s.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'", work.lineage), room = this.s.one('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM effect_receipts WHERE operation=?', id);
        const holds: string[] = [];
        let causality: ReturnType<Merges['readCausality']> | null = null, writeIdentity: string | null = null;
        try {
            if (original.state !== 'RETAINED')
                throw Error('Original bounded historical merge identity unavailable');
            if (!source || typeof source.origin !== 'string' || typeof source.raw !== 'string')
                throw Error('Original bounded work source unavailable');
            if (action === 'read') {
                if (!op.data.subject || !['UNKNOWN', 'INVOKING', 'CONFIRMED'].includes(op.phase))
                    throw Error('Original possible handoff or confirmation required for reconciliation');
                causality = this.readCausality(id);
            }
            else {
                this.assertUnsent(id);
                writeIdentity = this.writeFingerprint(id);
                const grant = this.grant(op.work, op.target);
                if (!['ACTIVE', 'DELIVERED'].includes(work.state) || op.grant_id !== grant.id || op.data.grantEpoch !== grant.epoch || work.epoch !== op.data.epoch || work.generation !== op.data.generation)
                    throw Error('Original current work or merge grant requires separate recovery');
                this.holds(op.target, id);
                if (action === 'send' && (op.phase !== 'RESERVED' || !op.data.subject || !op.data.nativeFingerprint))
                    throw Error('Current reserved original merge preparation required');
                if (action === 'send' && (!this.session || op.data.credentialSessionId !== this.session.credentialSessionId))
                    throw Error('Prepared native credential session unavailable or replaced; explicitly prepare this original again before sending');
            }
            // A send must be able to retain its native response receipt (at most 1 MiB) after the possible handoff.
            if (room.count + (action === 'read' ? (op.data.mergedCommit || causality?.commit ? 1 : 2) : action === 'send' ? 2 : 1) > 256 || room.bytes >= 2097152 || action === 'send' && room.bytes + 1048576 > 2097152)
                throw Error('Original receipt capacity unavailable');
        }
        catch (error) {
            holds.push(error instanceof Error ? error.message : 'Original historical read unavailable');
        }
        const settled = (row: any) => {
            try {
                if (!row.data || !['consumed', 'released'].includes(row.reservation))
                    return false;
                const data = parse(row.data);
                if (!['SETTLED', 'INTERRUPTED'].includes(row.phase))
                    return false;
                if (['removed', 'not-allocated', 'unbound', 'confirmed'].includes(data.cleanup))
                    return true;
                if (data.kind !== 'merge-http' || !['prepare', 'dispatch', 'reconcile'].includes(data.phase) || !(row.phase === 'SETTLED' && data.cleanup === 'in-process-http-settled' || row.phase === 'INTERRUPTED' && data.cleanup === 'owner-dead-http-producer'))
                    return false;
                const related = this.op(data.operationId);
                return related.work === work.id;
            }
            catch {
                return false;
            }
        };
        if (busy || runs.length > 128 || runs.reduce((n, row) => n + Buffer.byteLength(row.data ?? ''), 0) > 1048576 || runs.some(row => !settled(row)) || capacities.length)
            holds.push('Original producer, reservation or cleanup is unsettled');
        const valid = budget && ['lim', 'consumed', 'reserved'].every(key => Number.isSafeInteger(budget[key]) && budget[key] >= 0) && budget.reserved === 0 && budget.consumed < budget.lim;
        if (!valid)
            holds.push('Original finite execution allowance unavailable; extend or settle the same work separately');
        return { action, operationId: id, workId: work.id as string, targetId: op.target as string, sourceId: work.source as string, original, workState: work.state as string, preparedBase: op.data.subject?.expectedBase as string | undefined, baseChange: op.data.baseChange ?? null, procedureStanding: 'NOT RECHECKED', nativeEligibility: 'NOT RECHECKED', credential: action === 'send' ? { available: !!this.session, matchesPreparation: !!this.session && op.data.credentialSessionId === this.session.credentialSessionId } : null, causality: causality ? { nativeSuccess: causality.nativeSuccess, commit: causality.commit } : null, execution: budget ? { limit: budget.lim as number, consumed: budget.consumed as number, reserved: budget.reserved as number, remaining: budget.lim - budget.consumed - budget.reserved } : null, receipts: { count: room.count as number, remainingSlots: 256 - room.count, remainingBytes: 2097152 - room.bytes }, eligible: holds.length === 0, holds, fingerprint: hash({ action, identity: this.readFingerprint(id), writeIdentity, session: action === 'send' ? this.session?.credentialSessionId : null, source, runs, capacities, budget, room, busy, holds }) };
    }
    reconcile(id: string, commit?: string, signal?: AbortSignal, guard?: () => void, admission?: () => void) {
        return this.own((async () => {
            this.h.assertOpen();
            if (commit !== undefined)
                mergeCommitId(commit);
            const original = this.readFingerprint(id);
            const stable = () => {
                this.h.assertOpen();
                signal?.throwIfAborted();
                if (guard?.() !== undefined)
                    throw Error('Synchronous original merge read validation required');
                this.h.assertOpen();
                signal?.throwIfAborted();
                if (this.readFingerprint(id) !== original)
                    throw Error('Original merge read identity or send evidence changed');
            };
            const admit = () => {
                stable();
                admission?.();
                stable();
                const op = this.op(id);
                if (!['UNKNOWN', 'INVOKING', 'CONFIRMED'].includes(op.phase))
                    throw Error('Original possible handoff or confirmation required for reconciliation');
                if (!op.data.subject || this.retained(id).state !== 'RETAINED')
                    throw Error('Original bounded native merge subject or historical descriptor unavailable');
                const causal = this.readCausality(id);
                if (commit && causal.commit && commit !== causal.commit)
                    throw Error('Explicit merged commit conflicts with original native response');
                const room = this.s.one('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM effect_receipts WHERE operation=?', id), needed = commit || op.data.mergedCommit || causal.commit ? 1 : 2;
                if (room.n + needed > 256 || room.bytes >= 2097152)
                    throw Error('Original merge receipt capacity unavailable; preserve its records before another read');
            };
            return this.run(id, 'reconcile', signal, async (session, abort) => {
                const check = () => { abort.throwIfAborted(); stable(); };
                check();
                const op = this.op(id), causal = this.readCausality(id);
                let candidate = commit ?? op.data.mergedCommit ?? causal.commit;
                if (!candidate) {
                    const observed = await session.observeMergedCandidate(op.data.subject, abort);
                    check();
                    this.s.tx(() => { check(); this.receipt(id, 'merge-candidate-observation', observed); });
                    candidate = observed.commit;
                }
                if (op.data.mergedCommit && op.data.mergedCommit !== candidate)
                    throw Error('Original merged commit correspondence differs');
                check();
                return this.correspond(id, candidate, session, abort, causal.nativeSuccess, check);
            }, admit);
        })());
    }
    private run<T>(id: string, phase: string, outer: AbortSignal | undefined, body: (session: NonNullable<Merges['session']>, signal: AbortSignal) => Promise<T>, admission?: () => void): Promise<T> {
        return this.own((async () => {
            this.h.assertOpen();
            this.h.assertInteractionAdmission();
            const op = this.op(id), work = this.work(op.work), session = this.session;
            if (!session)
                throw Error('Explicit native merge credential required');
            if (this.h.busy(work.id) || this.aborts.has(id))
                throw Error('Original merge work busy');
            if (phase !== 'reconcile' && ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(work.state))
                throw Error('Original work requires separate recovery');
            const abort = new AbortController(), signal = AbortSignal.any([abort.signal, this.closing.signal, ...outer ? [outer] : []]), run = randomUUID();
            signal.throwIfAborted();
            admission?.();
            this.s.tx(() => {
                admission?.();
                this.h.assertOpen();
                this.h.assertInteractionAdmission();
                signal.throwIfAborted();
                if (session !== this.session || this.h.busy(work.id) || this.aborts.has(id) || hash(this.op(id)) !== hash(op))
                    throw Error('Original merge admission changed or is busy');
                const budget = this.s.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'", work.lineage);
                if (!budget || !['lim', 'consumed', 'reserved'].every(key => Number.isSafeInteger(budget[key]) && budget[key] >= 0) || budget.consumed + budget.reserved >= budget.lim)
                    throw Error('Original merge execution allowance exhausted');
                this.s.run("UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind='execution'", work.lineage);
                this.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', run, work.id, work.epoch, work.generation, 'RUNNING', path.join(this.h.options.installationHome, 'state'), 'reserved', JSON.stringify({ kind: 'merge-http', operationId: id, phase, controllerPid: process.pid, ...phase === 'reconcile' ? { retainedIntegrationRead: true, readPhase: 'admitted', originalWorkState: work.state } : {} }));
            });
            this.h.register(work.id, { abort, ...phase === 'reconcile' ? { retainedIntegrationRead: true as const } : {} });
            this.aborts.set(id, abort);
            try {
                const result = await body(session, signal);
                if (phase === 'reconcile')
                    this.h.patchRun(run, 'RUNNING', { readPhase: 'observed' });
                return result;
            }
            catch (error) {
                const current = this.op(id);
                if (phase === 'reconcile')
                    this.h.patchRun(run, 'RUNNING', { readPhase: 'unavailable', readDiagnostic: String(error).slice(0, 4096) });
                else if (current.phase !== 'CONFIRMED')
                    this.patch(id, ['INVOKING', 'UNKNOWN'].includes(current.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: [String(error)], nextAction: 'Inspect original retained merge; no automatic retry or authority renewal' });
                throw error;
            }
            finally {
                this.s.tx(() => {
                    this.h.settleBudget(run);
                    this.h.patchRun(run, 'SETTLED', { cleanup: 'in-process-http-settled' });
                });
                this.aborts.delete(id);
                this.h.unregister(work.id);
            }
        })());
    }
    cancel(works: ReadonlySet<string>) {
        for (const row of this.s.all("SELECT id,work,phase FROM effect_operations WHERE json_extract(data,'$.kind')=?", family)) {
            if (!works.has(row.work))
                continue;
            this.aborts.get(row.id)?.abort();
            if (row.phase !== 'CONFIRMED')
                this.patch(row.id, ['INVOKING', 'UNKNOWN'].includes(row.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: ['Original work cancelled'], nextAction: 'Separate original recovery; possible transmission permits read reconciliation only' });
        }
    }
    recoverRun(run: any) {
        const op = this.op(parse(run.data).operationId);
        if (run.work !== op.work)
            throw Error('Original merge run correspondence differs');
        // One recovery transaction: a partial settlement would hold the lineage's reservation forever.
        this.s.tx(() => {
            this.h.settleBudget(run.id);
            this.h.patchRun(run.id, 'INTERRUPTED', { cleanup: 'owner-dead-http-producer' });
            if (parse(run.data).phase === 'reconcile') {
                this.h.patchRun(run.id, 'INTERRUPTED', { readPhase: 'interrupted', retainedIntegrationRead: true });
                return;
            }
            if (op.phase !== 'CONFIRMED')
                this.patch(op.id, ['INVOKING', 'UNKNOWN'].includes(op.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: ['Original merge producer interrupted'], nextAction: 'Inspect original; reconcile possible handoff without replay' });
        });
    }
    async close() {
        this.closing.abort();
        for (const abort of this.aborts.values())
            abort.abort();
        while (this.tasks.size)
            await Promise.allSettled([...this.tasks]);
        await this.session?.close();
    }
}
