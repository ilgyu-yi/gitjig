import { indexedColor, stripTerminalSequences, styleText, truncateToWidth } from '@earendil-works/pi-tui';
import type { ConversationView } from '../controller/interaction-types.js';
/** Display text keeps line breaks while removing terminal commands and other controls. */
export function plainTerminalText(text: string): string {
    return stripTerminalSequences(text).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/gu, ' ');
}
export function conversationDisplayIdentity(view: Pick<ConversationView, 'conversationId' | 'userLabel'>): string {
    const name = view.userLabel ? truncateToWidth(plainTerminalText(view.userLabel).replace(/[\n\u2028\u2029]/gu, ' '), 64, '…').trim() : '';
    return name ? `${name} · ${view.conversationId}` : view.conversationId;
}
/** Display only. Labels and dividers carry the same meaning without color. */
export function chrome(role: 'active' | 'context' | 'secondary' | 'key' | 'model' | 'attention' | 'error', text: string): string {
    const colors = { active: 81, context: 110, secondary: 250, key: 81, model: 183, attention: 221, error: 203 };
    return styleText(plainTerminalText(text), { fg: indexedColor(colors[role]), bold: role !== 'context' && role !== 'secondary' }, '256color');
}
