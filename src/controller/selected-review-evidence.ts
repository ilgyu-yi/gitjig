import { parseRoleOutput } from '../workflow/protocol.js';
import { exposureIssues, hashText } from '../workflow/exposure.js';
import type { InputBundle, SourceExposure } from '../workflow/types.js';
import { hash } from './change-files.js';
export const REVIEW_EVIDENCE_LIMITS = Object.freeze({ rawBytes: 128 * 1024, serializedBytes: 256 * 1024, references: 64, scopeRanges: 4096 });
export function reviewEvidenceHold(reason: string): never {
    throw new Error(`SELECTED_REVIEW_EVIDENCE_UNAVAILABLE: ${reason}; restore the exact current selected reviewer/native record or perform an explicitly authorized fresh review; no evidence omitted`);
}
const requireEvidence = (value: unknown, reason: string): void => {
    if (!value)
        reviewEvidenceHold(reason);
};
/** Pure projection of host-retained records. Only Changes supplies actual rows/native entries/bundle. */
function projectSelectedReviewInner(input: {
    workId: string;
    epoch: number;
    generation: number;
    versions: Record<string, string | null>;
    reviewKey: string;
    purpose: string;
    requiredPaths: readonly string[];
    launch: any;
    run: any;
    outputs: any[];
    entries: any[];
    bundle: InputBundle;
}) {
    const { launch, run, outputs, entries, bundle } = input;
    requireEvidence(launch && run && outputs.length <= REVIEW_EVIDENCE_LIMITS.references, 'missing launch/run or output roster exceeds64');
    const ld = JSON.parse(launch.data), rd = JSON.parse(run.data);
    requireEvidence(launch.work === input.workId && run.work === input.workId && launch.run === run.id && launch.epoch === input.epoch && run.epoch === input.epoch && run.generation === input.generation, 'foreign/stale work or epoch');
    requireEvidence(launch.role === 'reviewer' && launch.status === 'COMPLETE' && ld.stage === 'fresh-review' && ld.reviewKey === input.reviewKey && ld.purpose === input.purpose && hash(ld.requiredPaths) === hash(input.requiredPaths) && hash(ld.inputVersions) === hash(input.versions), 'wrong reviewer/roster/current tuple');
    requireEvidence(run.phase === 'SETTLED' && run.reservation === 'consumed' && ld.cleanup === 'removed' && rd.cleanup === 'removed', 'review run not settled/consumed/removed');
    const selected = outputs.filter(o => o.launch === launch.id && o.status === 'usable');
    requireEvidence(selected.length === 1, 'selected usable final missing or ambiguous');
    const output = selected[0], metadata = JSON.parse(output.data), raw = output.raw;
    requireEvidence(typeof raw === 'string' && Buffer.from(raw, 'utf8').toString('utf8') === raw && Buffer.byteLength(raw) <= REVIEW_EVIDENCE_LIMITS.rawBytes, 'raw unsupported or exceeds128KiB');
    requireEvidence(metadata.terminal === 'complete' && metadata.rawFinalTruncated === false && metadata.omittedFindingCount === 0 && Array.isArray(metadata.issues) && metadata.issues.length === 0, 'selected final incomplete/known loss/validation issues');
    requireEvidence(rd.historyRef && ld.historyRef === rd.historyRef && metadata.historyRef === rd.historyRef && rd.nativeSessionId && ld.nativeSessionId === rd.nativeSessionId && rd.nativeCheckpoint?.sessionId === rd.nativeSessionId, 'native history/session/checkpoint mismatch');
    const checkpoint = rd.nativeCheckpoint;
    requireEvidence(typeof checkpoint.leafId === 'string' && checkpoint.leafId.length > 0 && Number.isSafeInteger(checkpoint.bytes) && checkpoint.bytes > 0 && checkpoint.bytes <= 32 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(checkpoint.sha256), 'native checkpoint shape unavailable');
    const finals = entries.filter(e => e.id === metadata.nativeEntryId);
    requireEvidence(typeof metadata.nativeEntryId === 'string' && finals.length === 1, 'selected native entry missing/ambiguous');
    const final = finals[0];
    requireEvidence(final.type === 'message' && final.message?.role === 'assistant' && final.message.stopReason === 'stop' && Array.isArray(final.message.content), 'native final not completed assistant');
    const content = final.message.content, texts = content.filter((b: any) => b.type === 'text');
    requireEvidence(content.every((b: any) => b.type === 'text' && typeof b.text === 'string' || b.type === 'thinking' && typeof b.thinking === 'string') && texts.length === 1 && texts[0].text === raw, 'native raw differs from selected final');
    const parsed = parseRoleOutput(raw, 'reviewer');
    requireEvidence(parsed.value && parsed.issues.length === 0 && hash(parsed.value) === hash(metadata.protocol), 'raw/protocol validation mismatch');
    const assessedScope = parsed.value!.assessedScope, exposures = metadata.exposures as SourceExposure[];
    requireEvidence(Array.isArray(exposures) && exposures.length <= REVIEW_EVIDENCE_LIMITS.scopeRanges && assessedScope.length <= REVIEW_EVIDENCE_LIMITS.scopeRanges && bundle.requiredScope.length <= REVIEW_EVIDENCE_LIMITS.scopeRanges, 'scope/exposure ranges exceed4096');
    for (const exposure of exposures) {
        const source = bundle.sources.find(s => s.id === exposure.sourceId);
        requireEvidence(source && exposure.launchId === launch.id && exposure.version === source.version && exposure.side === source.side && exposure.path === source.path && exposure.sourceSha256 === source.sha256 && ['prompt', 'read'].includes(exposure.producer), 'foreign exposure/source');
        const lines = source!.content.split('\n');
        requireEvidence(Number.isSafeInteger(exposure.startLine) && Number.isSafeInteger(exposure.endLine) && exposure.startLine >= 1 && exposure.endLine >= exposure.startLine && exposure.endLine <= lines.length && hashText(lines.slice(exposure.startLine - 1, exposure.endLine).join('\n')) === exposure.rangeSha256, 'exposure range differs');
    }
    requireEvidence(exposureIssues(assessedScope, bundle.requiredScope, bundle, exposures).length === 0, 'assessed/required scope unsupported');
    return { reviewKey: input.reviewKey, purpose: input.purpose, requiredPaths: input.requiredPaths,
        launchId: launch.id, runId: run.id, outputId: output.id, epoch: input.epoch, generation: input.generation, inputVersions: input.versions,
        validation: { launchStatus: launch.status, outputStatus: output.status, terminal: metadata.terminal, rawFinalTruncated: metadata.rawFinalTruncated, omittedFindingCount: metadata.omittedFindingCount, issues: metadata.issues },
        native: { sessionId: rd.nativeSessionId, checkpoint: { sessionId: checkpoint.sessionId, leafId: checkpoint.leafId, bytes: checkpoint.bytes, sha256: checkpoint.sha256 }, selectedEntryId: metadata.nativeEntryId, proof: 'Original nativeEntries validated owned run checkpoint/session and exact selected native final; no private history path exposed' },
        raw, rawSha256: hashText(raw), rawUtf8Bytes: Buffer.byteLength(raw), requiredScope: bundle.requiredScope, assessedScope, exposures: exposures.map(e => ({ launchId: e.launchId, sourceId: e.sourceId, version: e.version, side: e.side, path: e.path, startLine: e.startLine, endLine: e.endLine, sourceSha256: e.sourceSha256, rangeSha256: e.rangeSha256, producer: e.producer, ...(e.toolCallId === undefined ? {} : { toolCallId: e.toolCallId }) })) };
}
export function projectSelectedReview(input: Parameters<typeof projectSelectedReviewInner>[0]) {
    try {
        return projectSelectedReviewInner(input);
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('SELECTED_REVIEW_EVIDENCE_UNAVAILABLE:'))
            throw error;
        reviewEvidenceHold('malformed selected review/native/scope record');
    }
}
export function boundSelectedReviews(binding: string, reviews: ReturnType<typeof projectSelectedReview>[]) {
    if (reviews.length > REVIEW_EVIDENCE_LIMITS.references)
        reviewEvidenceHold('selected review references exceed64');
    const evidence = { version: 1, semantics: 'Verbatim actual current selected independent reviews; epoch/generation are original producer provenance, not current action authority, a host verdict or automatic repair authority', binding, reviews };
    if (Buffer.byteLength(JSON.stringify(evidence)) > REVIEW_EVIDENCE_LIMITS.serializedBytes)
        reviewEvidenceHold('complete projection exceeds256KiB');
    return evidence;
}
