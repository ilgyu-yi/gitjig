import path from 'node:path';
export interface CreateOutcome {
    stdout: string;
    stderr: string;
    exitCode: number;
    termination?: 'timeout' | 'aborted' | 'output-limit';
}
export type CreateRejectionEvidence = {
    version: 1;
    kind: 'bind-source-missing-before-create';
    mountSource: string;
    original: {
        kind: 'native-result';
        result: CreateOutcome;
    } | {
        kind: 'legacy-controller-observation';
        journalPath: string;
        error: string;
    };
};
function missingBindSourceError(source: string): string | undefined {
    if (!path.isAbsolute(source) || path.normalize(source) !== source ||
        Buffer.byteLength(source) > 4096 || /[\x00-\x1f\x7f]/u.test(source))
        return undefined;
    return `Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ${source}\n`;
}
/** Recognize only the original daemon's complete preallocation rejection. */
export function classifyCreateRejection(result: CreateOutcome, mountSources: readonly string[]): CreateRejectionEvidence | undefined {
    // Exit 125 can be this adapter's signal fallback, not a normal CLI refusal.
    if (!result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
        result.exitCode !== 1 ||
        result.termination !== undefined || result.stdout !== '')
        return undefined;
    const mountSource = mountSources.find(source => missingBindSourceError(source) === result.stderr);
    if (!mountSource)
        return undefined;
    return {
        version: 1,
        kind: 'bind-source-missing-before-create',
        mountSource,
        original: { kind: 'native-result', result: { ...result } },
    };
}
/** The caller must establish original controller observation/run provenance. */
export function classifyLegacyCreateRejection(error: unknown, journalPath: string, stagingPath: string): CreateRejectionEvidence | undefined {
    const nativeError = missingBindSourceError(stagingPath);
    if (!nativeError || typeof error !== 'string' || !path.isAbsolute(journalPath) ||
        path.normalize(journalPath) !== journalPath || /[\x00-\x1f\x7f]/u.test(journalPath) ||
        error !== `Error: scope create uncertain/failed; retained ${journalPath}: ${nativeError}`)
        return undefined;
    return {
        version: 1,
        kind: 'bind-source-missing-before-create',
        mountSource: stagingPath,
        original: { kind: 'legacy-controller-observation', journalPath, error },
    };
}
export function validCreateRejectionEvidence(evidence: CreateRejectionEvidence): boolean {
    if (!evidence || evidence.version !== 1 || evidence.kind !== 'bind-source-missing-before-create' ||
        !evidence.original || typeof evidence.mountSource !== 'string')
        return false;
    const original = evidence.original;
    const classified = original.kind === 'native-result'
        ? classifyCreateRejection(original.result, [evidence.mountSource])
        : original.kind === 'legacy-controller-observation'
            ? classifyLegacyCreateRejection(original.error, original.journalPath, evidence.mountSource)
            : undefined;
    return classified !== undefined && JSON.stringify(classified) === JSON.stringify(evidence);
}
