import path from 'node:path';
import type { Store } from './store.js';
import { hash, effective } from './change-files.js';
import { mergeGrantHistory } from './merge-grant-history.js';
import { integrationGrantHistory } from './integration-grant-history.js';
import { historicalGrantRoot } from './historical-grant.js';
import { mergeCommitId } from '../platform/github-merge-protocol.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
const object = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original owner merge history requires an object');
    return value as Record<string, any>;
};
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const unsent = (data: Record<string, any>) => ['dispatchRun', 'transportOutcome', 'mergedCommit', 'correspondence'].every(key => data[key] === undefined || data[key] === null) && !['origin', 'assignmentId', 'conversationId', 'reviewedAssignmentId', 'subjectContextFingerprint'].some(key => Object.hasOwn(data, key));
/** Capture before asynchronous original preparation; unstamped legacy originals cannot be reauthorized. */
export function ownerMergeCandidateSnapshot(store: Store, work: string, id: unknown, home: string) {
    if (typeof id !== 'string')
        return null;
    const candidate = store.one(`SELECT id,work,kind,predecessor,${bounded('artifact', 4096)} AS artifact,hash,${bounded('data', 1048576)} AS data FROM change_versions WHERE id=?`, id);
    if (!candidate)
        return null;
    const relative = typeof candidate.artifact === 'string' ? path.relative(home, candidate.artifact) : '..';
    if (candidate.work !== work || candidate.kind !== 'candidate' || typeof candidate.artifact !== 'string' || !path.isAbsolute(candidate.artifact) || !relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || typeof candidate.data !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.hash) || hash(effective(object(JSON.parse(candidate.data)).manifest)) !== candidate.hash)
        throw Error('Original bounded private candidate snapshot unavailable');
    return { ...candidate };
}
/** Historical proof only. Callers must separately validate current software standing. */
export function ownerMergePublicationHistory(store: Store, operation: Record<string, any>, target: Record<string, any>, home: string) {
    const fail = () => { throw Error('Original owner merge publication/candidate/reauthorization history unavailable or inconsistent'); };
    const grant = store.one(`SELECT id,root,target,epoch,${bounded('data', 65536)} AS data FROM effect_delegations WHERE id=?`, operation.grant_id);
    if (!grant || typeof grant.data !== 'string' || grant.root !== operation.work || grant.target !== operation.target)
        fail();
    const grantData = object(JSON.parse(grant.data)), history = mergeGrantHistory(store, grant);
    if (grantData.scope !== 'work' || grantData.projectId !== target.project)
        fail();
    const branch = store.one(`SELECT id,work,target,grant_id,phase,${bounded('data', 1048576)} AS data FROM effect_operations WHERE id=?`, operation.data.branchOperationId);
    if (!branch || typeof branch.data !== 'string' || branch.work !== operation.work || branch.target !== target.data.sourceBranchTargetId || branch.phase !== 'CONFIRMED')
        fail();
    const published = object(JSON.parse(branch.data)), sourceTarget = store.one(`SELECT id,project,${bounded('data', 131072)} AS data FROM effect_targets WHERE id=?`, branch.target), branchGrant = store.one(`SELECT id,root,target,epoch,${bounded('data', 65536)} AS data FROM effect_delegations WHERE id=?`, branch.grant_id);
    if (!sourceTarget || typeof sourceTarget.data !== 'string' || !branchGrant || typeof branchGrant.data !== 'string')
        fail();
    const sourceConfiguration = object(JSON.parse(sourceTarget.data)), branchAuthority = object(JSON.parse(branchGrant.data));
    if (published.kind !== 'github-existing-ref' || published.evidence?.workId !== operation.work || sourceTarget.project !== target.project || sourceConfiguration.kind !== 'github-existing-ref' || sourceConfiguration.repository?.visibility !== 'public' || hash(sourceConfiguration.repository) !== hash(target.data.repository) || sourceConfiguration.expectedUserId !== target.data.identity.expectedUserId || sourceConfiguration.target?.host !== 'github.com' || sourceConfiguration.target.ref !== 'refs/heads/' + target.data.identity.headRef || sourceConfiguration.target.repositoryId !== target.data.repository.repositoryId || sourceConfiguration.target.repositoryNodeId !== target.data.repository.repositoryNodeId || sourceConfiguration.target.owner !== target.data.repository.owner || sourceConfiguration.target.repository !== target.data.repository.repository || branchAuthority.kind !== 'github-existing-ref' || branchGrant.target !== branch.target)
        fail();
    historicalGrantRoot(store, operation.work, branchGrant.root, branchAuthority.scope);
    const branchSource = store.one(`SELECT conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 65536)} AS raw FROM sources WHERE id=?`, branchAuthority.source);
    if (!branchSource || branchSource.conversation !== null || typeof branchSource.origin !== 'string' || typeof branchSource.raw !== 'string' || branchAuthority.mode !== 'ordinary' || branchAuthority.projectId !== sourceTarget.project || !positive(branchAuthority.operationLimit) || branchAuthority.operationLimit > 100)
        fail();
    const branchIssuer = object(JSON.parse(branchSource.origin)), branchRequest = object(JSON.parse(branchSource.raw));
    if (branchIssuer.kind !== 'owner-effect-grant' || branchIssuer.uid !== process.getuid?.() || branchIssuer.root !== branchGrant.root || branchRequest.workId !== branchGrant.root || branchRequest.targetId !== branchGrant.target || branchRequest.mode !== 'ordinary' || branchRequest.operationLimit !== branchAuthority.operationLimit || (branchRequest.scope ?? 'work') !== branchAuthority.scope || store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', branchGrant.id).n > branchAuthority.operationLimit)
        fail();
    const branchHistory = integrationGrantHistory(store, branchGrant);
    if (!branchHistory.epochs.some(epoch => epoch.grantEpoch === published.grantEpoch && epoch.rootEpoch === published.rootEpoch))
        fail();
    mergeCommitId(published.integrationCommit);
    mergeCommitId(published.tree);
    const evidence = object(operation.data.evidence), candidate = ownerMergeCandidateSnapshot(store, operation.work, evidence.versions?.candidate, home), work = store.one('SELECT source FROM works WHERE id=?', operation.work);
    if (!candidate || !work || candidate.hash !== evidence.candidateDigest || published.evidence.versions?.candidate !== candidate.id || published.evidence.candidateDigest !== candidate.hash)
        fail();
    const publication = { row: { ...branch, data: published }, target: { ...sourceTarget, data: sourceConfiguration } }, receipts: unknown[] = [], seen = new Set<string>();
    let current = operation, bytes = 0;
    while (true) {
        const data = object(current.data), snapshot = object(data.evidence);
        if (current.id !== operation.id || current.work !== operation.work || current.target !== operation.target || current.grant_id !== operation.grant_id || data.kind !== 'github-merge' || !unsent(data) || hash(data.candidateSnapshot) !== hash(candidate) || data.ownerSnapshot?.source !== work.source || data.branchOperationId !== branch.id || data.headCommit !== published.integrationCommit || snapshot.workId !== operation.work || snapshot.versions?.candidate !== candidate.id || snapshot.candidateDigest !== candidate.hash || snapshot.epoch !== data.epoch || snapshot.generation !== data.generation || !positive(data.epoch) || !positive(data.generation) || !positive(data.grantEpoch) || data.ownerSnapshot?.workId !== operation.work || data.ownerSnapshot?.epoch !== data.epoch || !history.epochs.some(epoch => epoch.grantEpoch === data.grantEpoch && epoch.rootEpoch === data.epoch))
            fail();
        const source = store.one(`SELECT conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 32768)} AS raw FROM sources WHERE id=?`, data.ownerSnapshot.source);
        if (!source || typeof source.origin !== 'string' || typeof source.raw !== 'string')
            fail();
        const owner = object(JSON.parse(source.origin));
        if (!String(owner.kind).startsWith('owner-') || owner.uid !== process.getuid?.())
            fail();
        if (data.subject) {
            const { expectedHead, expectedBase, expectedTree, ...identity } = data.subject;
            mergeCommitId(expectedBase);
            if (expectedHead !== published.integrationCommit || expectedTree !== published.tree || hash(identity) !== hash(target.data.identity))
                fail();
        }
        if (!Object.hasOwn(data, 'reauthorization')) {
            if (snapshot.fingerprint !== published.evidence.fingerprint)
                fail();
            break;
        }
        const pointer = object(data.reauthorization);
        if (pointer.version !== 1 || typeof pointer.receiptId !== 'string' || seen.has(pointer.receiptId) || receipts.length >= 64)
            fail();
        seen.add(pointer.receiptId);
        const receipt = store.one(`SELECT id,operation,kind,${bounded('data', 1048576)} AS data FROM effect_receipts WHERE id=?`, pointer.receiptId);
        if (!receipt || receipt.operation !== operation.id || receipt.kind !== 'merge-owner-reauthorization' || typeof receipt.data !== 'string')
            fail();
        bytes += Buffer.byteLength(receipt.data);
        if (bytes > 2097152)
            fail();
        const event = object(JSON.parse(receipt.data)), previous = object(event.previous), prior = object(previous.data);
        const bound = { grantEpoch: data.grantEpoch, epoch: data.epoch, generation: data.generation, evidence: snapshot, ownerSnapshot: data.ownerSnapshot };
        if (event.version !== 1 || event.origin?.kind !== 'owner-merge-reauthorization' || event.origin.uid !== process.getuid?.() || event.origin.sourceId !== data.ownerSnapshot.source || typeof event.reason !== 'string' || !event.reason.trim() || Buffer.byteLength(event.reason) > 4096 || hash(event.current) !== hash(bound) || hash(event.publication) !== hash(publication) || hash(event.candidate) !== hash(candidate) || !['PREPARED', 'RESERVED', 'REFUSED'].includes(previous.phase) || !unsent(prior) || prior.epoch >= data.epoch || prior.grantEpoch >= data.grantEpoch || prior.generation > data.generation)
            fail();
        receipts.push(receipt);
        current = previous;
    }
    return { publication, candidate, grant, history, reauthorizations: receipts.length, fingerprint: hash({ operation, publication, candidate, branchGrant, branchHistory, grant, history, receipts }) };
}
