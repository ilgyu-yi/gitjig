import { InspectionDetails } from './inspection-details.js';
import { plainTerminalText } from './chrome.js';
function display(value: string, maximum: number): string {
    const clean = plainTerminalText(value);
    return clean.length <= maximum ? clean : `${clean.slice(0, maximum)}\n[Display shortened; inspect the retained work for full details]`;
}
export interface FailurePresentation {
    readonly code?: string;
    readonly summary: string;
    readonly detail: string;
    readonly workId?: string;
}
/** Only presentation fields, never a dump of provider/configuration objects or causes. */
export function failurePresentation(error: unknown): FailurePresentation {
    const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const message = typeof value.message === 'string' ? value.message : typeof error === 'string' ? error : 'Operation unavailable';
    const code = typeof value.code === 'string' ? display(value.code, 128).split('\n')[0] : undefined;
    const main = display(message, 8192);
    const fields = [`${code ? code + ' · ' : ''}${main}`];
    if (typeof value.recovery === 'string' && value.recovery)
        fields.push(`Recovery\n${display(value.recovery, 16384)}`);
    for (const key of ['workId', 'runId'] as const)
        if (typeof value[key] === 'string' && value[key])
            fields.push(`${key}: ${display(value[key], 1024)}`);
    return { ...(code ? { code } : {}), ...(typeof value.workId === 'string' && /^[A-Za-z0-9-]{1,128}$/u.test(value.workId) ? { workId: value.workId } : {}), summary: `/error · ${code ? code + ' · ' : ''}${main.split('\n')[0]!.slice(0, 180)}`, detail: fields.join('\n\n') };
}
/** Preserve the error-specific title over the shared read-only public layout. */
export class FailureDetails extends InspectionDetails {
    constructor(detail: string, close: () => void) { super('Error details · inspection only', detail, close); }
}
