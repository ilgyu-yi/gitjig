import type { Store } from './store.js';
import type { CurrentEvidence } from './effect-types.js';
import { createHash } from 'node:crypto';

const parse = (value: string) => JSON.parse(value);
type SelectedVerification = NonNullable<ReturnType<import('./change-core.js').ChangeCore['inspectVerificationEvidence']>>;
/** Presentation only. Goals retains the complete private source fingerprint and current-evidence gates. */
export function goalEvidenceProjection(store: Store, source: any, governed: readonly CurrentEvidence[], verification: ReadonlyMap<string, SelectedVerification> = new Map(), capture: (value: unknown) => void = () => {}) {
    const retained = <T>(kind: string, rows: T): T => {capture([kind, rows]); return rows;};
    const observed = (value: any) => {
        if (!value || typeof value !== 'object' || !value.workId || !Object.hasOwn(value, 'reviewReady')) return value;
        const {launches, checks, occurrences, dispositions, versions, ...current} = value;
        return {...current, ...(value.kind ? {} : {kind: 'legacy-governed-observation-summary/v1',
            historicalDetail: 'Original complete publication remains available under its captured audience',
            counts: {launches: launches?.length ?? 0, checks: checks?.length ?? 0, occurrences: occurrences?.length ?? 0, dispositions: dispositions?.length ?? 0, versions: versions?.length ?? 0}})};
    };
    const version = (id: string, work: string) => {
        const row = store.one('SELECT * FROM change_versions WHERE id=? AND work=?', id, work);
        if (!row) throw Error('Selected goal evidence version unavailable');
        retained('version', row);
        const data = parse(row.data);
        // Whole inventories and producer history remain retained. Selected declarations/deltas are actual review evidence.
        return {id: row.id, kind: row.kind, predecessor: row.predecessor, hash: row.hash,
            ...(data.plan ? {plan: data.plan} : {}), ...(data.verification ? {verification: data.verification} : {}),
            ...(data.requirements ? {requirements: data.requirements, intent: data.intent, source: data.source} : {}),
            ...(data.delta ? {delta: data.delta} : {}),
            ...(row.kind === 'scope-evidence' ? {evidence: data.evidence} : {}),
            ...(data.manifest ? {inventory: {digest: data.manifest.digest, entries: data.manifest.entries, bytes: data.manifest.bytes}} : {})};
    };
    const check = (id: string, work: string) => {
        const row = store.one('SELECT * FROM check_runs WHERE id=? AND work=?', id, work);
        if (!row) throw Error('Selected goal check evidence unavailable');
        retained('check', row);
        const data = parse(row.data), actual = data.actual;
        return {...row, data: {...data, ...(actual ? {actual: {...actual,
            ...Object.fromEntries(['stdout', 'stderr'].filter(key => typeof actual[key] === 'string').map(key => [key, {kind: 'retained-diagnostic/v1', sha256: createHash('sha256').update(actual[key], 'utf8').digest('hex'), bytes: Buffer.byteLength(actual[key])}]))}} : {})}};
    };
    const review = (id: string, work: string) => {
        const row = store.one('SELECT * FROM role_launches WHERE id=? AND work=?', id, work);
        if (!row) throw Error('Selected goal review evidence unavailable');
        retained('review', row);
        const metadata = parse(row.data);
        const outputs = retained('review-outputs', store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', id)).map(output => {
            const data = parse(output.data);
            return {id: output.id, status: output.status, protocol: data.protocol, issues: data.issues,
                terminal: data.terminal, rawFinalTruncated: data.rawFinalTruncated, nativeEntryId: data.nativeEntryId};
        });
        return {id, role: row.role, runId: row.run, epoch: row.epoch, status: row.status,
            reviewKey: metadata.reviewKey ?? null, purpose: metadata.purpose ?? null, inputVersions: metadata.inputVersions,
            cleanup: metadata.cleanup, outputs};
    };
    return {
        ...source,
        links: source.links.map((row: any) => {
            const {result, ...task} = parse(row.data);
            const ordinary = (!task.operation || task.operation === 'investigate') && result && typeof result === 'object' &&
                !Object.hasOwn(result, 'reviewReady') && typeof result.runId === 'string' && typeof result.status === 'string';
            // A report may legitimately name no explicit result IDs. Its linked ordinary
            // observation must still reach the reviewer, once, under the existing source proof.
            const represented = ordinary && source.results.some((publication: any) => {
                const data = parse(publication.data);
                return publication.id === task.resultId && publication.conversation === row.target && publication.work === row.work &&
                    data.assignmentId === row.id && JSON.stringify(data.result) === JSON.stringify(result);
            });
            return {...row, data: {...task, ...(ordinary && !represented ? {result} : {})}};
        }),
        results: source.results.map((row: any) => {
            const data = parse(row.data);
            return {id: row.id, conversationId: row.conversation, workId: row.work, previous: row.previous,
                assignmentId: data.assignmentId, projectId: data.projectId, publicationHash: data.publicationHash, result: observed(data.result)};
        }),
        operations: source.operations.map((row: any) => ({...row, data: parse(row.data),
            receipts: retained('operation-receipts', {operationId: row.id, rows: store.all('SELECT * FROM effect_receipts WHERE operation=? ORDER BY rowid', row.id)}).rows.map(receipt => ({...receipt, data: parse(receipt.data)}))})),
        governed: governed.map(evidence => {
            const selected = verification.get(evidence.workId);
            if (evidence.verificationStrategyDigest ? selected?.digest !== evidence.verificationStrategyDigest : selected !== undefined)
                throw Error('Goal typed verification selection unavailable');
            const witnessIds = [...new Set(selected?.requirements.flatMap(item => item.witnessIds) ?? [])];
            const checkIds = [...new Set([...evidence.checkIds, ...witnessIds.filter(id => !!store.one('SELECT id FROM check_runs WHERE id=? AND work=?', id, evidence.workId))])];
            const scopeWitnesses = witnessIds.filter(id => !checkIds.includes(id)).map(id => {
                if (!store.one("SELECT id FROM change_versions WHERE id=? AND work=? AND kind='scope-evidence'", id, evidence.workId))
                    throw Error('Selected goal scope witness unavailable');
                return version(id, evidence.workId);
            });
            const reviewIds = [...new Set([...evidence.reviewLaunchIds, ...(selected?.requirements.flatMap(item => item.reviews.map(review => review.launchId)) ?? []), ...(selected ? [selected.adjudication.launchId] : [])])];
            return {...evidence,
            ownerRequest: retained('owner-source', store.one('SELECT s.* FROM sources s JOIN works w ON w.source=s.id WHERE w.id=?', evidence.workId))?.raw ?? null,
            selectedVersions: [...new Set(Object.values(evidence.versions).filter((id): id is string => !!id))].map(id => version(id, evidence.workId)),
            checks: checkIds.map(id => check(id, evidence.workId)),
            reviews: reviewIds.map(id => review(id, evidence.workId)),
            ...(selected ? {verificationEvidence: {...selected, scopeWitnesses}} : {}),
            findings: retained('findings', {workId: evidence.workId, rows: store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid', evidence.workId)}).rows.map(row => ({...row, data: parse(row.data)})),
            dispositions: retained('dispositions', {workId: evidence.workId, rows: store.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=? ORDER BY d.rowid', evidence.workId)}).rows.map(row => ({...row, data: parse(row.data)})),
        };}),
    };
}

/** Capture exactly the selected raw inputs used above, including empty collection membership. */
export function captureGoalEvidence(store: Store, source: any, governed: readonly CurrentEvidence[], verification: ReadonlyMap<string, SelectedVerification> = new Map()) {
    const digest = createHash('sha256');
    const value = goalEvidenceProjection(store, source, governed, verification, input => {digest.update(JSON.stringify(input)).update('\n');});
    return {value, selectedSourceHash: digest.digest('hex')};
}
