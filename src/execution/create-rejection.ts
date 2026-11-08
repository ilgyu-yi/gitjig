import path from 'node:path';
import { createHash } from 'node:crypto';
export interface CreateOutcome {
    stdout: string;
    stderr: string;
    exitCode: number;
    termination?: 'timeout' | 'aborted' | 'output-limit';
}
type NativeResult = { kind: 'native-result'; result: CreateOutcome };
type ContextRoute = { context: string; dockerConfigDirectory?: string };
export class MissingDockerContextError extends Error {
    constructor(readonly context: string, diagnostic: string) {
        super(`Docker context "${context}" was not found.\n${diagnostic}`);
    }
}
export type CreateRejectionEvidence = {
    version: 1;
    kind: 'bind-source-missing-before-create';
    mountSource: string;
    original: NativeResult | {
        kind: 'legacy-controller-observation';
        journalPath: string;
        error: string;
    };
} | {
    version: 1;
    kind: 'context-missing-before-create';
    route: Required<ContextRoute>;
    original: NativeResult;
};
function safeAbsolute(value: string): boolean {
    return typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value &&
        Buffer.byteLength(value) <= 4096 && !/[\x00-\x1f\x7f]/u.test(value);
}
function missingBindSourceError(source: string): string | undefined {
    if (!safeAbsolute(source))
        return undefined;
    return `Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ${source}\n`;
}
/** Shared diagnostic grammar. This match alone is not native outcome or cleanup evidence. */
export function missingDockerContextRoute(diagnostic: string, route?: ContextRoute): Required<ContextRoute> | undefined {
    if (!route || typeof route.context !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/u.test(route.context) ||
        route.context === 'default' || !route.dockerConfigDirectory || !safeAbsolute(route.dockerConfigDirectory))
        return undefined;
    const { context, dockerConfigDirectory } = route;
    const directoryId = createHash('sha256').update(context).digest('hex');
    const metadata = path.join(dockerConfigDirectory, 'contexts', 'meta', directoryId, 'meta.json');
    const expected = `Failed to initialize: unable to resolve docker endpoint: context "${context}": context not found: open ${metadata}: no such file or directory\n`;
    return diagnostic === expected ? { context, dockerConfigDirectory } : undefined;
}
/** Recognize only the original daemon's complete preallocation rejection. */
export function classifyCreateRejection(result: CreateOutcome, mountSources: readonly string[], route?: ContextRoute): CreateRejectionEvidence | undefined {
    // Exit 125 can be this adapter's signal fallback, not a normal CLI refusal.
    if (!result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
        result.exitCode !== 1 ||
        result.termination !== undefined || result.stdout !== '')
        return undefined;
    const mountSource = mountSources.find(source => missingBindSourceError(source) === result.stderr);
    if (mountSource)
        return {
            version: 1,
            kind: 'bind-source-missing-before-create',
            mountSource,
            original: { kind: 'native-result', result: { ...result } },
        };
    const missing = missingDockerContextRoute(result.stderr, route);
    return missing && { version: 1, kind: 'context-missing-before-create', route: missing, original: { kind: 'native-result', result: { ...result } } };
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
    if (!evidence || evidence.version !== 1 || !evidence.original)
        return false;
    const original = evidence.original;
    let classified: CreateRejectionEvidence | undefined;
    if (evidence.kind === 'context-missing-before-create' && original.kind === 'native-result')
        classified = classifyCreateRejection(original.result, [], evidence.route);
    if (evidence.kind === 'bind-source-missing-before-create' && typeof evidence.mountSource === 'string')
        classified = original.kind === 'native-result'
            ? classifyCreateRejection(original.result, [evidence.mountSource])
            : classifyLegacyCreateRejection(original.error, original.journalPath, evidence.mountSource);
    return classified !== undefined && JSON.stringify(classified) === JSON.stringify(evidence);
}
export function createRejectionMatchesScope(evidence: CreateRejectionEvidence, workRoot: string, route: ContextRoute): boolean {
    return evidence.kind === 'bind-source-missing-before-create' ? evidence.mountSource === workRoot :
        evidence.route.context === route.context && evidence.route.dockerConfigDirectory === route.dockerConfigDirectory;
}
