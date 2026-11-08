/** Historical absence retains LF-fragment coordinates. New captures explicitly
 * distinguish physical assessment lines from lossless source framing. */
export function sourceScopeVersion(context: Record<string, unknown>): 1 | 2 {
    if (!Object.hasOwn(context, 'sourceScopeInput')) return 1;
    const value = context.sourceScopeInput;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).join(',') !== 'version' || (value as { version?: unknown }).version !== 2)
        throw Error('Unsupported source scope declaration');
    return 2;
}

export function assessedLineCount(text: string, context: Record<string, unknown>): number {
    const fragments = text.split('\n').length;
    return sourceScopeVersion(context) === 2 ? Math.max(1, fragments - Number(text.endsWith('\n'))) : fragments;
}
