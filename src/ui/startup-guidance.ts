import { startupActivationSteps, type StartupActivation, type StartupActivationAction } from '../app/startup.js';
import { translator, type MessageId, type UiLocale } from './i18n.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundLauncher, quoteShellOperand } from '../installation/bound-launcher.js';
const cliEntry = fileURLToPath(new URL('../cli/entry.js', import.meta.url));
const unsafeOperand = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u;
function applicationInvocation(home: string, node: string, entry: string) {
    const launcher = boundLauncher(home, node, dirname(dirname(dirname(entry))));
    return launcher ? [launcher] : [node, entry];
}
/** Preserve installation identity in a copyable restart command; never invoke it here. */
export function restartCommand(home: string, conversation?: string, node = process.execPath, entry = cliEntry, continuation: readonly string[] = []) {
    const command = applicationInvocation(home, node, entry);
    if ([...command, home, conversation ?? '', ...continuation].some(value => unsafeOperand.test(value)))
        return 'Use the same launcher and application home. A copyable command is unavailable for control-bearing paths.';
    const args = ['conversation', 'ui', '--home', quoteShellOperand(home)];
    if (conversation !== undefined)
        args.push('--conversation', quoteShellOperand(conversation));
    return [...command.map(quoteShellOperand), ...args, ...continuation.map(quoteShellOperand)].join(' ');
}

/** Model-free recovery guidance. The owner supplies any original grant options. */
export function ownerActivationGuidance(home: string, work: { workId: string; epoch: number; state: string }, locale: UiLocale) {
    const t = translator(locale), command = applicationInvocation(home, process.execPath, cliEntry);
    const base = [...command, home, work.workId].some(value => unsafeOperand.test(value))
        ? t('workRecovery.activationCommandUnavailable')
        : `${command.map(quoteShellOperand).join(' ')} change activate --home ${quoteShellOperand(home)} --work ${quoteShellOperand(work.workId)} --epoch ${work.epoch}`;
    const recover = ['CANCELLED', 'INTERRUPTED'].includes(work.state);
    return [t('workRecovery.activationInstructions'), base, ...(recover ? [t('workRecovery.activationStopped')] : []),
        t('workRecovery.activationFollowUp')].join('\n\n');
}

type ActivationMessage = 'value.activationUnknown' | 'value.restart' | 'value.runtimePending' | 'value.currentProcess';
export function startupComponentStatus(action: StartupActivationAction): ActivationMessage {
    switch (action) {
        case 'unknown': return 'value.activationUnknown';
        case 'relaunch': return 'value.restart';
        case 'apply': return 'value.runtimePending';
        case 'current': return 'value.currentProcess';
    }
}
/** Present the canonical observation without combining independent actions. */
export function startupComponentLabel(component: 'runtime' | 'bridge', action: StartupActivationAction, t: ReturnType<typeof translator>) {
    return t(`startup.${component}Status`, { status: t(startupComponentStatus(action)) });
}

const activationMessages = {
    inspect: 'startup.inspectActivation',
    'apply-runtime': 'startup.applyRuntimeNow',
    'remove-runtime': 'startup.removeRuntimeOnRestart',
    'relaunch-bridge': 'startup.applyBridgeOnRestart',
} as const satisfies Record<ReturnType<typeof startupActivationSteps>[number], MessageId>;

export function startupSaveNotice(kind: 'save' | 'clear' | 'combined' | 'runtime', activation: StartupActivation, t: ReturnType<typeof translator>): string {
    const heading = { save: 'startup.savedNotice', clear: 'startup.clearedNotice', combined: 'setupCombined.saved', runtime: 'runtime.saved' } as const;
    const actions = startupActivationSteps(activation).map(step => t(activationMessages[step]));
    if (!actions.length && kind !== 'runtime')
        actions.push(t('startup.currentSelectionsKept'));
    return [t(heading[kind]), ...actions].join('\n');
}
