import { uiText, type UiLocale } from './i18n.js';
import { plainTerminalText } from './chrome.js';
import { hasCleanCleanup } from './conversation-activity.js';
import type { ConversationTurnResult } from '../controller/interaction-types.js';
import type { Controller } from '../controller/controller.js';
import { IndependentConversationCreated, type IndependentProjectTarget, type RetainedIndependentConversation } from './new-conversation.js';
import { ProjectChangeHeld, type ProjectDependencyHold, type ProjectEffectHold } from './project-commands.js';
import { quoteText } from './inspection-text.js';
function display(value: string, maximum: number): string {
    const clean = plainTerminalText(value);
    return clean.length <= maximum ? clean : `${clean.slice(0, maximum)}\n[Display shortened; inspect the retained work for full details]`;
}
export interface FailurePresentation {
    readonly code?: string;
    readonly summary: string;
    readonly detail: string;
    readonly inputId?: string;
    readonly workId?: string;
    readonly runId?: string;
    readonly submittedRequest?: true;
    readonly relatedWorkIds?: readonly string[];
    readonly recoveryRoute?: 'claude-bridge' | 'runtime-context' | 'runtime-image';
    readonly projectTarget?: IndependentProjectTarget;
    readonly createdConversation?: RetainedIndependentConversation;
    readonly projectDependency?: ProjectDependencyHold;
    readonly projectEffect?: ProjectEffectHold;
    readonly originalHoldIsActive?: () => boolean;
}
export function runtimeRepairAction(route: FailurePresentation['recoveryRoute']) {
    if (route === 'runtime-context') return { focus: 'context', label: 'error.runtimeContextSettings' } as const;
    if (route === 'runtime-image') return { focus: 'image', label: 'error.runtimeImageSettings' } as const;
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
    const relatedWorkIds = Array.isArray(value.relatedWorkIds) ? [...new Set(value.relatedWorkIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{1,128}$/u.test(id)))].slice(0, 8) : [];
    const projectHold = error instanceof ProjectChangeHeld ? error : undefined;
    const headline = main.split('\n')[0]!.slice(0, 180);
    return {
        ...(code ? { code } : {}),
        ...(typeof value.workId === 'string' && /^[A-Za-z0-9-]{1,128}$/u.test(value.workId) ? { workId: value.workId } : {}),
        ...(typeof value.runId === 'string' && /^[A-Za-z0-9-]{1,128}$/u.test(value.runId) ? { runId: value.runId } : {}),
        ...(relatedWorkIds.length ? { relatedWorkIds } : {}),
        ...(projectHold ? { projectTarget: projectHold.projectTarget } : {}),
        ...(error instanceof IndependentConversationCreated ? { createdConversation: error.created } : {}),
        ...(projectHold?.dependency ? { projectDependency: projectHold.dependency } : {}),
        ...(projectHold?.effect ? { projectEffect: projectHold.effect } : {}),
        ...(projectHold?.isOriginalActive ? { originalHoldIsActive: projectHold.isOriginalActive } : {}),
        summary: projectHold ? headline : `/error · ${code ? code + ' · ' : ''}${headline}`,
        detail: fields.join('\n\n'),
    };
}
export function bridgeProfileFailure(result: Pick<ConversationTurnResult, 'bridgeProfileMismatch' | 'workId' | 'runId' | 'failure'>, locale: UiLocale): FailurePresentation {
    const diagnostic = result.bridgeProfileMismatch === 'plugins' ? 'error.bridgePlugins' : 'error.bridgeProfile';
    const failure = failurePresentation({
        message: uiText(locale, diagnostic) + (result.failure ? '\n\n' + result.failure : ''),
        recovery: uiText(locale, 'error.bridgeRecovery'),
        workId: result.workId,
        runId: result.runId,
    });
    return { ...failure, recoveryRoute: 'claude-bridge' };
}
export function ordinaryResponseFailure(result: Pick<ConversationTurnResult, 'bridgeProfileMismatch' | 'cleanup' | 'workId' | 'runId' | 'failure'>,
    locale: UiLocale, bridgeRecoveryAvailable: boolean): FailurePresentation {
    if (result.bridgeProfileMismatch && bridgeRecoveryAvailable && hasCleanCleanup(result.cleanup))
        return bridgeProfileFailure(result, locale);
    return failurePresentation({
        message: result.failure ?? uiText(locale, 'response.unavailable'),
        recovery: uiText(locale, 'error.responseRecovery'),
        workId: result.workId,
        runId: result.runId,
    });
}
function runtimeContextFailure(result: Pick<ConversationTurnResult, 'workId' | 'runId' | 'failure'>, context: string, locale: UiLocale): FailurePresentation {
    const message = uiText(locale, 'error.runtimeContext', { context });
    const failure = failurePresentation({
        message: message + (result.failure ? '\n\n' + result.failure : ''),
        recovery: uiText(locale, 'error.runtimeRecovery'),
        workId: result.workId,
        runId: result.runId,
    });
    return { ...failure, recoveryRoute: 'runtime-context' };
}
export function conversationStartupFailure(failure: NonNullable<ReturnType<Controller['inspectConversationStartupFailure']>>, locale: UiLocale): FailurePresentation {
    if (failure.kind === 'capture-link') return captureLinkFailure(failure, failure.entry, locale);
    if (failure.kind === 'runtime-context') return { ...runtimeContextFailure(failure, failure.context, locale), code: 'RUNTIME_CONTEXT_MISSING' };
    const display = failurePresentation({
        message: uiText(locale, 'error.runtimeHelper') + '\n\n' + failure.failure,
        recovery: uiText(locale, 'error.runtimeHelperRecovery'),
        workId: failure.workId,
        runId: failure.runId,
    });
    return { ...display, code: 'RUNTIME_HELPER_UNAVAILABLE', recoveryRoute: 'runtime-image' };
}
export function captureLinkFailure(result: Pick<ConversationTurnResult, 'workId' | 'runId' | 'failure'>, entry: string, locale: UiLocale): FailurePresentation {
    return failurePresentation({
        code: 'CAPTURE_UNSUPPORTED_LINK',
        message: uiText(locale, 'error.captureLink', { entry: quoteText(entry) }) + (result.failure ? '\n\n' + result.failure : ''),
        recovery: uiText(locale, 'error.captureLinkRecovery'),
        workId: result.workId,
        runId: result.runId,
    });
}
