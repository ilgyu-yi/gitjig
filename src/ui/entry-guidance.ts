import { uiText, type UiLocale } from './i18n.js';
import type { ConversationView } from '../controller/interaction-types.js';
import { matchesExternalModel, type ConversationModelChoice } from '../controller/model-choice.js';
export interface EntrySetup {
    runtime: boolean;
    bridge: boolean;
    managed: boolean;
    account?: 'present' | 'missing' | 'unavailable';
    externalModel?: {
        provider: string;
        modelId: string;
    };
}
export interface EntryIssue {
    kind: 'setup' | 'recovery';
    message: string;
    repair?: 'runtime';
}
export function isPlainRequest(text: string): boolean {
    const trimmed = text.trimStart();
    return !!trimmed.trim() && !trimmed.startsWith('!') && (!trimmed.startsWith('/') || trimmed.startsWith('//'));
}
/** Known metadata only; no issue does not establish execution eligibility. */
export function entryIssues(view: ConversationView, choice: ConversationModelChoice, setup: EntrySetup, locale: UiLocale = 'en'): EntryIssue[] {
    if (view.role || ['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state))
        return [];
    if (view.state === 'UNKNOWN')
        return [{ kind: 'recovery', message: uiText(locale, 'blocker.unknown') }];
    const reasons: string[] = [];
    if (!setup.managed) {
        if (choice.kind === 'unbound' && !setup.externalModel)
            reasons.push(uiText(locale, 'blocker.model'));
        else if (choice.kind === 'legacy-external' && !matchesExternalModel(choice, setup.externalModel))
            reasons.push(uiText(locale, 'blocker.external'));
        else if (choice.kind === 'managed' && choice.provider === 'claude-bridge' && !setup.bridge)
            reasons.push(uiText(locale, 'blocker.bridge'));
        else if (choice.kind === 'managed' && choice.provider !== 'claude-bridge' && setup.account === 'missing')
            reasons.push(uiText(locale, 'blocker.account', { provider: choice.provider }));
        else if (choice.kind === 'managed' && choice.provider !== 'claude-bridge' && setup.account === 'unavailable')
            reasons.push(uiText(locale, 'blocker.config'));
    }
    const issues: EntryIssue[] = reasons.map(message => ({ kind: 'setup', message }));
    if (view.projectId && !setup.runtime)
        issues.push({ kind: 'setup', message: uiText(locale, 'blocker.runtime'), repair: 'runtime' });
    return issues;
}
