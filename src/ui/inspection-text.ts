const unicodeEscape = (character: string) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0');

/** JSON already escapes C0 controls; escape the remaining viewer-sensitive characters. */
export const escapeJsonControls = (text: string): string => text.replace(/[\u007f-\u009f]/gu, unicodeEscape);

/** Preserve control-bearing native field names as visible text rather than terminal input. */
export const escapeDisplayControls = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/gu, unicodeEscape);

export const quoteText = (value: string): string => escapeJsonControls(JSON.stringify(value));

/** An oversized identity is omitted whole, never abbreviated into another identity. */
export function quoteIdentity(value: string, limit = 4096): string {
    const quoted = quoteText(value);
    return quoted.length <= limit ? quoted : '[Value too long for summary; see original details]';
}

/** Keep complete rows and leave room for later sections in an inspection. */
export function summarizeRows(rows: readonly string[], limit = 6000): string {
    let text = '', count = 0;
    for (const row of rows) {
        if (count === 100 || text.length + row.length + 1 > limit) break;
        text += row + '\n';
        count++;
    }
    if (count < rows.length) text += `[${rows.length - count} more entries; see original details]\n`;
    return text.trimEnd();
}

/** Append the captured observation without another read; this limit counts characters. */
export function appendObservation(summary: string, observation: unknown): string {
    const details = escapeJsonControls(JSON.stringify(observation, null, 2));
    const bound = 24000;
    return summary + '\n\nOriginal observation · details\n' + (details.length <= bound
        ? details
        : '[Details exceed the display limit; use the corresponding local CLI command for the full observation]');
}
