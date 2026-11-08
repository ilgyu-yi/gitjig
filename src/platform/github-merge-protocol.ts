/** Finite synchronous one-PR protocol. Parsing establishes no authority or standing. */
export interface OrdinaryMergeOptions {
    sha: string;
    merge_method: 'merge';
}
export type NativeMergeResult = {
    kind: 'merged';
    commit: string;
    causality: 'native-success-response';
} | {
    kind: 'rejected';
};
export function mergeCommitId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value))
        throw Error('Exact native GitHub commit identity required');
    return value;
}
export function ordinaryMergeOptions(head: string): Readonly<OrdinaryMergeOptions> {
    return Object.freeze({ sha: mergeCommitId(head), merge_method: 'merge' });
}
/** The synchronous endpoint cannot merge stacks or enqueue a PR. It has no async fallback. */
export function parseNativeMergeResult(value: unknown, status: number): NativeMergeResult {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Native merge response object unavailable');
    const root = value as Record<string, unknown>;
    if (status === 200) {
        if (Object.keys(root).some(key => !['sha', 'merged', 'message'].includes(key)) || root.merged !== true || typeof root.message !== 'string' || Buffer.byteLength(root.message) > 4096)
            throw Error('Native merge response does not establish successful synchronous merging');
        return { kind: 'merged', commit: mergeCommitId(root.sha), causality: 'native-success-response' };
    }
    // Native refusals retain their status/receipt. In particular, a timeout or
    // malformed success never becomes a definitely-rejected operation.
    if ([403, 404, 405, 409, 422].includes(status))
        return { kind: 'rejected' };
    throw Error('Native merge response does not establish a supported result');
}
/** One literal native branch name; no ref expressions or pattern expansion. */
export function mergeBranchName(value: unknown): string {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024 || /[\x00-\x20\x7f~^:?*\[\\]/.test(value) || value.startsWith('/') || value.endsWith('/') || value.includes('..') || value.includes('@{') || value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')))
        throw Error('Literal native merge branch required');
    return value;
}
