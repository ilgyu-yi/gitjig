/** Pi can truncate fractions while coercing an integer schema. Reject the raw
 * value before that coercion while retaining the native wire schema. */
export function assertNonFractionalInteger(value: unknown): void {
    const numeric = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (typeof numeric === 'number' && Number.isFinite(numeric) && !Number.isInteger(numeric))
        throw Error('Expected an exact integer argument');
}
