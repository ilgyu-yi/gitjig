import type { Store } from './store.js';
import { hash } from './change-files.js';
import { policyCanonical, policyHash } from '../platform/github-policy-schema.js';
interface Repository {
    host: string;
    repositoryId: number;
    repositoryNodeId: string;
}
const json = (value: string) => JSON.parse(value);
const check = (value: unknown): void => {
    if (!value)
        throw Error('Configuration creation provenance unavailable');
};
const same = (a: unknown, b: unknown) => policyCanonical(a) === policyCanonical(b);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hint = (value: any) => value && Number.isSafeInteger(value.id) && value.id > 0 && typeof value.nodeId === 'string' && value.nodeId.length > 0;
function runBinding(store: Store, id: string, work: string, operation: string, revision: number, stage: string, fresh: boolean) {
    const run = store.one('SELECT * FROM runs WHERE id=? AND work=?', id, work);
    check(run && run.reservation === 'consumed' && (fresh ? run.phase === 'SETTLED' : ['SETTLED', 'INTERRUPTED'].includes(run.phase)));
    const data = json(run.data);
    check(data.kind === 'configuration-http' && data.operationId === operation && data.revision === revision && data.stage === stage);
    check(fresh ? data.cleanup === 'in-process-configuration-http-settled' : ['in-process-configuration-http-settled', 'in-process-owner-restarted'].includes(data.cleanup));
    return run;
}
function nativeReceipt(row: any, method: string, route: string, status: number) {
    return row?.method === method && row.route === route && row.status === status && digest(row.bodyHash) && Number.isSafeInteger(row.bodyBytes) && row.bodyBytes > 0;
}
/** Private pure join. Historical intent/equality never becomes current authority. */
function creation(store: Store, operationId: string, expected: Repository, journalId?: string) {
    const op = store.one('SELECT * FROM effect_operations WHERE id=?', operationId);
    check(op);
    const data = json(op.data), targetRow = store.one('SELECT * FROM effect_targets WHERE id=?', op.target);
    check(targetRow && targetRow.project === null);
    const td = json(targetRow.data), target = td.target;
    check(data.kind === 'configuration' && td.kind === 'github-configuration' && target.host === 'github.com' && target.host === expected.host && target.repositoryId === expected.repositoryId && target.repositoryNodeId === expected.repositoryNodeId && same(data.target, target));
    const work = store.one('SELECT * FROM works WHERE id=?', op.work);
    check(work && work.project === null && json(work.data).kind === 'repository-configuration' && json(work.data).operationId === op.id);
    const journals = data.steps.filter((j: any) => j.kind === 'create-ruleset');
    check(journals.length === 1);
    const j = journals[0];
    check(j.state === 'UNKNOWN' && (!journalId || j.journalId === journalId) && j.intent && Array.isArray(j.receiptIds));
    const revisions = data.revisions.filter((r: any) => r.revision === j.revision);
    check(revisions.length === 1);
    const revision = revisions[0], plan = revision.plan;
    check(plan && revision.planHash === hash(plan) && plan.operationId === op.id && same(plan.target, target) && plan.profileHash === policyHash(plan.profile));
    const steps = plan.steps.filter((s: any) => s.id === j.stepId && s.kind === 'create-ruleset');
    check(steps.length === 1);
    const step = steps[0], base = `/repos/${target.owner}/${target.repository}`;
    check(step.method === 'POST' && step.route === base + '/rulesets' && step.payloadHash === policyHash(step.payload) && step.basisHash === policyHash(step.basis) && step.payload.name === `gitjig/${plan.profile.ruleset.name}/${op.id}`);
    const source = store.one('SELECT * FROM sources WHERE id=?', revision.source), requirement = store.one('SELECT * FROM requirements WHERE work=? AND version=?', op.work, j.revision);
    check(source && requirement);
    const origin = json(source.origin);
    check(origin.kind === 'owner-repository-configuration' && origin.operationId === op.id && origin.targetId === op.target && origin.revision === j.revision && origin.uid === td.ownerUid && origin.uid === process.getuid?.() && same(json(source.raw), plan.profile) && same(json(requirement.raw), plan.profile) && json(requirement.interpretation).sourceId === source.id);
    check(j.intent.revision === j.revision && j.intent.payloadHash === step.payloadHash && typeof j.intent.credentialSessionId === 'string' && j.intent.credentialSessionId.length > 0);
    runBinding(store, j.intent.runId, op.work, op.id, j.revision, 'apply-step', false);
    const attempts = store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='configuration-step-attempt'", op.id).filter(row => j.receiptIds.includes(row.id));
    check(attempts.length === 1);
    const attempt = attempts[0], saved = json(attempt.data), result = saved.result;
    check(saved.stepJournalId === j.journalId && saved.revision === j.revision && result.operationId === op.id && result.stepId === step.id && result.handoff === 'request-created' && hint(result.creationHint) && hint(j.creationHint) && same(result.creationHint, j.creationHint));
    check(Array.isArray(result.receipts));
    const posts = result.receipts.filter((r: any) => r.method === 'POST' && r.route === step.route);
    check(posts.length === 1 && nativeReceipt(posts[0], 'POST', step.route, 201));
    return { op, data, target, j, step, plan, revision, source, attempt, identity: result.creationHint, base };
}
function candidate(store: Store, operationId: string, expected: Repository, journalId: string, reconciliationReceiptId: string, reconciliationRunId: string) {
    const c = creation(store, operationId, expected, journalId);
    runBinding(store, reconciliationRunId, c.op.work, c.op.id, c.j.revision, 'reconcile', true);
    const receipt = store.one("SELECT * FROM effect_receipts WHERE id=? AND operation=? AND kind='configuration-step-reconciliation'", reconciliationReceiptId, c.op.id);
    check(receipt && c.j.receiptIds.includes(receipt.id));
    const saved = json(receipt.data), r = saved.result, observation = r?.resourceObservation;
    check(saved.stepJournalId === c.j.journalId && saved.revision === c.j.revision && saved.runId === reconciliationRunId && r.operationId === c.op.id && r.stepId === c.step.id && r.outcome === 'unknown');
    check(observation?.version === 'configuration-resource-observation/v1' && observation.kind === 'ruleset' && observation.supported === true && observation.identitySource === 'retained-post-hint' && same(observation.identity, c.identity) && same(r.creationHint, c.identity) && observation.sourceType === 'Repository' && observation.source === c.target.owner + '/' + c.target.repository && observation.target === 'branch');
    check(same(observation.repository, { id: c.target.repositoryId, nodeId: c.target.repositoryNodeId, fullName: c.target.owner + '/' + c.target.repository, visibility: c.target.visibility, ownerId: c.target.actorUserId }));
    check(r.observed && Object.keys(r.observed).sort().join(',') === 'bypass_actors,conditions,enforcement,name,rules,target');
    check(Array.isArray(r.fieldObservations) && r.fieldObservations.length === c.step.fields.length);
    for (const field of c.step.fields) {
        const observations = r.fieldObservations.filter((o: any) => o.path === field.path);
        check(observations.length === 1 && ['matching', 'conflicting'].includes(observations[0].state) && same(observations[0].actual, r.observed[field.path.replace(/^ruleset\./, '')]));
    }
    const detail = c.base + '/rulesets/' + c.identity.id + '?includes_parents=true';
    check(Array.isArray(r.receipts) && r.receipts.length === 2 && nativeReceipt(r.receipts[0], 'GET', detail, 200) && nativeReceipt(r.receipts[1], 'GET', c.base, 200));
    const intentHash = hash(c.j.intent), stableKey = hash([c.op.id, c.j.journalId, intentHash, c.attempt.id, c.identity]);
    return { version: 'configuration-native-resource-accounted/v1', stableKey, operationId: c.op.id, workId: c.op.work, targetId: c.op.target, target: c.target, journalId: c.j.journalId, revision: c.j.revision, sourceId: c.source.id, planHash: c.revision.planHash, payloadHash: c.step.payloadHash, intentHash, attemptReceiptId: c.attempt.id, resource: c.identity, reconciliationReceiptId: receipt.id, reconciliationRunId };
}
/** Called only AFTER the existing read-only run has settled. Returns data, never a permit. */
export function buildCreatedResourceAccounting(store: Store, operationId: string, expected: Repository, journalId: string, receiptId: string, runId: string) {
    try {
        return candidate(store, operationId, expected, journalId, receiptId, runId);
    }
    catch {
        return null;
    }
}
/** Same exact proof validator for owned identity and pending-write exclusion. No native I/O. */
export function accountedCreatedResource(store: Store, operationId: string, expected: Repository, journalId?: string): {
    id: number;
    nodeId: string;
} | null {
    try {
        const c = creation(store, operationId, expected, journalId);
        const proofs = store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='configuration-native-resource-accounted'", operationId).filter(row => json(row.data).journalId === c.j.journalId);
        check(proofs.length === 1);
        const proof = json(proofs[0].data);
        const expectedProof = candidate(store, operationId, expected, c.j.journalId, proof.reconciliationReceiptId, proof.reconciliationRunId);
        check(same(proof, expectedProof));
        return structuredClone(c.identity);
    }
    catch {
        return null;
    }
}
