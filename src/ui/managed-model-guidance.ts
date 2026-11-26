import type { Controller } from '../controller/controller.js';
import type { ApplicationModels } from '../app/models.js';
import type { ApplicationAccounts } from '../app/accounts.js';
import type { Role } from '../workflow/types.js';
import { translator, type UiLocale } from './i18n.js';
import { providerLoginCommand } from './model-route-presentation.js';
export type ManagedModelIssue = {
    roles: readonly Role[];
} & ({ kind: 'account' | 'bridge'; provider: string } | { kind: 'account-config' | 'role-config' | 'external' });
export interface ManagedModelGuidance {
    stage: string;
    roles?: readonly Role[];
    issues: ManagedModelIssue[];
    messages: string[];
    allowanceHold?: 'execution' | 'resolution' | undefined;
}
interface ManagedModelHost {
    controller: Controller;
    models?: ApplicationModels;
    accounts?: ApplicationAccounts;
    externalModel?: {
        provider: string;
        modelId: string;
    };
}
function issueMessage(issue: ManagedModelIssue, stage: string, t: ReturnType<typeof translator>): string {
    return issue.kind === 'account'
        ? t('managedRepair.issue.account', { stage, provider: issue.provider, roles: issue.roles.join(', ') })
        : t(`managedRepair.issue.${issue.kind}`);
}
function inspectRoleIssues(host: ManagedModelHost, workId: string, roles: readonly Role[]): ManagedModelIssue[] {
    if (!host.models)
        return [{ kind: 'role-config', roles }];
    let choices: ReturnType<ApplicationModels['workRoleChoices']>;
    try {
        choices = host.models.workRoleChoices(workId, roles);
    }
    catch {
        return [{ kind: 'role-config', roles }];
    }
    if (!choices)
        return [];
    const providerRoles = new Map<string, Role[]>();
    for (const { role, choice } of choices) {
        const selectedRoles = providerRoles.get(choice.provider) ?? [];
        selectedRoles.push(role);
        providerRoles.set(choice.provider, selectedRoles);
    }
    const issues: ManagedModelIssue[] = [];
    const directProviders = [...providerRoles.keys()].filter(provider => provider !== 'claude-bridge');
    let presence: Record<string, boolean> | undefined;
    try {
        if (directProviders.length && host.accounts)
            presence = host.accounts.accountPresences(directProviders);
    }
    catch {
        issues.push({ kind: 'account-config', roles });
    }
    for (const [provider, selectedRoles] of providerRoles) {
        if (provider === 'claude-bridge') {
            if (!host.controller.applicationModelResource())
                issues.push({ kind: 'bridge', provider, roles: selectedRoles });
        }
        else if (presence && presence[provider] === false) {
            issues.push({ kind: 'account', provider, roles: selectedRoles });
        }
    }
    return issues;
}
/** The recorded work and the actual resolver's role choices; never the current conversation choice. */
export function managedModelGuidance(host: ManagedModelHost, workId: string, locale: UiLocale = 'en'): ManagedModelGuidance {
    const t = translator(locale);
    let requirements: ReturnType<Controller['inspectChangeContinuationPrerequisites']>;
    try {
        requirements = host.controller.inspectChangeContinuationPrerequisites(workId);
    } catch (error) {
        if (host.controller.inspectWorkRecovery(workId).recoveryHold?.kind !== 'unavailable') throw error;
        return { stage: 'unavailable', issues: [], messages: [t('workRecovery.guidanceUnavailable')] };
    }
    if (['busy', 'held', 'complete'].includes(requirements.stage)) {
        const messages = requirements.stage === 'held'
            ? [t('managedRepair.priorHold', { command: `/change inspect ${workId}` })]
            : [];
        return { ...requirements, issues: [], messages };
    }
    const { allowanceHold } = requirements;
    if (allowanceHold)
        return { ...requirements, issues: [], messages: [t(`managedRepair.allowance.${allowanceHold}`, { command: `/work ${workId}` })] };
    const baseline = host.controller.getWorkApplicationModelBaseline(workId);
    if (!baseline && !host.externalModel) {
        const issues: ManagedModelIssue[] = [{ kind: 'external', roles: requirements.roles }];
        return { ...requirements, issues, messages: issues.map(issue => issueMessage(issue, requirements.stage, t)) };
    }
    if (!requirements.roles.length)
        return { ...requirements, issues: [], messages: [] };
    let issues: ManagedModelIssue[] = [];
    if (baseline) {
        issues = inspectRoleIssues(host, workId, requirements.roles);
    }
    return { ...requirements, issues, messages: issues.map(issue => issueMessage(issue, requirements.stage, t)) };
}
export type ManagedModelRepairState = 'available' | 'held' | 'held-cancelled';

/** Use the current mutation guard for both the repair actions and their explanation. */
export function managedModelRepairState(controller: Controller, workState: string, assessment: ManagedModelGuidance): ManagedModelRepairState {
    if (assessment.issues.some(issue => issue.kind !== 'external')) {
        try {
            controller.assertApplicationMutationAllowed();
        }
        catch {
            return workState === 'CANCELLED' ? 'held-cancelled' : 'held';
        }
    }
    return 'available';
}

/** Inspection only. Offered changes still pass their existing action guards. */
export function managedModelRepairDetail(workId: string, assessment: ManagedModelGuidance, state: ManagedModelRepairState, locale: UiLocale = 'en'): string {
    const t = translator(locale);
    const paragraphs = [
        t('managedRepair.detail', { work: workId, stage: assessment.stage, issues: assessment.messages.join('\n') }),
        t('managedRepair.inspectBody', { command: `/change inspect ${workId}` }),
    ];
    if (state === 'available') {
        paragraphs.push(...managedModelRepairDirections(assessment, locale));
    } else {
        const next = state === 'held-cancelled'
            ? t('managedRepair.alreadyCancelled')
            : t('managedRepair.cancelBody', { command: `/change cancel ${workId}` });
        paragraphs.push(t('managedRepair.heldBody', { next }));
    }
    paragraphs.push(t('managedRepair.resumeBody', { command: `/change resume ${workId}` }));
    return paragraphs.join('\n\n');
}

export function managedModelRepairDirections(assessment: ManagedModelGuidance, locale: UiLocale) {
    const t = translator(locale);
    return assessment.issues.map(issue => {
        if (issue.kind !== 'account') return t(`managedRepair.fix.${issue.kind}`);
        const provider = issue.provider;
        const command = providerLoginCommand(provider);
        return t(command === '/login' ? 'managedRepair.fix.accountPicker' : 'managedRepair.fix.account', { command, provider });
    });
}
