/** A retained publication can outlive the launch that produced it. */
export function currentAssignmentResultId(data: {
    operation?: unknown;
    resultId?: unknown;
    launchResultUnavailable?: unknown;
    reentries?: unknown;
    publishedForInputId?: unknown;
}): string | undefined {
    if (data.launchResultUnavailable === true || typeof data.resultId !== 'string' ||
        !data.resultId.length || Buffer.byteLength(data.resultId) > 512) return;
    if (data.operation === 'change' && data.reentries !== undefined) {
        if (!Array.isArray(data.reentries)) return;
        const latest = data.reentries.at(-1);
        if (data.reentries.length && (typeof latest?.inputId !== 'string' || latest.inputId !== data.publishedForInputId)) return;
    }
    return data.resultId;
}
