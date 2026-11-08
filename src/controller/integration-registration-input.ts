import type { RegisterLocalTarget } from './effect-types.js';

export function isReceiverLiteralPath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
        !/[\x00-\x1f\x7f\\]/u.test(value) &&
        value.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
}

function validInventory(paths: unknown): paths is readonly string[] {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100000)
        return false;
    const unique = new Set<string>();
    for (const path of paths) {
        if (!isReceiverLiteralPath(path) || unique.has(path))
            return false;
        unique.add(path);
    }
    return true;
}

function fieldIssue(request: RegisterLocalTarget) {
    if (typeof request.path !== 'string' || !request.path)
        return 'receiverPath';
    if (typeof request.ref !== 'string' || !request.ref.startsWith('refs/heads/') || request.ref === 'refs/heads/' || request.ref.includes('\0'))
        return 'ref';
    if (typeof request.basisCommit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(request.basisCommit))
        return 'basis';
    if (!validInventory(request.publicationInventory))
        return 'publication';
    if (!validInventory(request.authorizedDeltaPaths))
        return 'delta';
    const published = new Set(request.publicationInventory);
    if (request.authorizedDeltaPaths.some(path => !published.has(path)))
        return 'scope';
}

type InputIssue = 'size' | NonNullable<ReturnType<typeof fieldIssue>>;

/** Request-only validation. Git establishes ref syntax, object format and ancestry at admission. */
export function captureLocalReceiverInput(request: RegisterLocalTarget): { issue: InputIssue } | { request: RegisterLocalTarget } {
    if (Buffer.byteLength(JSON.stringify(request)) > 131072)
        return { issue: 'size' };
    const captured = structuredClone(request);
    const issue = fieldIssue(captured);
    return issue ? { issue } : { request: captured };
}

export const receiverInputMessage = {
    size: 'Integration target input exceeds the 128KiB registry limit',
    receiverPath: 'Enter the path of the existing bare receiver',
    ref: 'Enter the full existing branch ref, for example refs/heads/main',
    basis: 'Enter the full pinned basis commit as a 40- or 64-character lowercase Git object ID',
    publication: 'Publication paths require a nonempty inventory of unique literal relative paths',
    delta: 'Authorized delta paths require a nonempty inventory of unique literal relative paths',
    scope: 'Authorized delta must remain within publication inventory',
} as const satisfies Record<InputIssue, string>;
