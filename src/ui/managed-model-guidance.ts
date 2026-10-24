import type { Controller } from '../controller/controller.js';
import type { ApplicationModels } from '../app/models.js';
import type { ApplicationAccounts } from '../app/accounts.js';
import type { Role } from '../workflow/types.js';
export interface ManagedModelIssue {
    kind: 'account' | 'account-config' | 'role-config' | 'bridge' | 'external';
    provider?: string;
    roles: readonly Role[];
}
export interface ManagedModelGuidance {
    stage: string;
    issues: ManagedModelIssue[];
    messages: string[];
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
function issueMessage(issue: ManagedModelIssue, stage: string): string {
    switch (issue.kind) {
        case 'account':
            return `Blocked: account missing · /ready · ${stage}: ${issue.provider} (${issue.roles.join(', ')})`;
        case 'external':
            return 'Blocked: original work needs an explicit model profile · /ready';
        case 'bridge':
            return 'Blocked: original work role needs its model bridge · /ready';
        case 'account-config':
            return 'Blocked: original work account configuration unavailable · /ready';
        case 'role-config':
            return 'Blocked: original work role-model settings unavailable · /ready';
    }
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
export function managedModelGuidance(host: ManagedModelHost, workId: string): ManagedModelGuidance {
    const requirements = host.controller.inspectChangeModelPrerequisites(workId);
    if (['busy', 'held', 'complete'].includes(requirements.stage)) {
        const messages = requirements.stage === 'held'
            ? [`Original work has a prior recovery hold · /change inspect ${workId}`]
            : [];
        return { ...requirements, issues: [], messages };
    }
    const baseline = host.controller.getWorkApplicationModelBaseline(workId);
    let issues: ManagedModelIssue[] = [];
    if (!baseline) {
        if (!host.externalModel)
            issues.push({ kind: 'external', roles: requirements.roles });
    }
    else if (requirements.roles.length) {
        issues = inspectRoleIssues(host, workId, requirements.roles);
    }
    return { ...requirements, issues, messages: issues.map(issue => issueMessage(issue, requirements.stage)) };
}
function repairAction(issue: ManagedModelIssue): string {
    switch (issue.kind) {
        case 'account':
            return `Connect the original stage provider with /login ${issue.provider}.`;
        case 'account-config':
            return 'Use /model-repair to inspect and repair only the unavailable account/model file.';
        case 'bridge':
            return 'Use /setup bridge to restore the original bridge, then follow /ready restart guidance. Do not replace a retained work model through /model.';
        case 'external':
            return 'Reopen the same conversation with --model-profile pointing to the original explicit private profile. Do not substitute the conversation default.';
        case 'role-config':
            return 'Inspect the original role settings with /role-model. If config/role-models.json is malformed, restore that owner-private file outside the application; no automatic reset is available for this file.';
    }
}
/** Inspection only. Authentication changes still pass the existing source/producer guard. */
export function managedModelRepairDetail(controller: Controller, workId: string, assessment: ManagedModelGuidance): string {
    let settingsHeld = false;
    if (assessment.issues.some(issue => issue.kind !== 'external')) {
        try {
            controller.assertApplicationMutationAllowed();
        }
        catch {
            settingsHeld = true;
        }
    }
    const paragraphs = [
        `Original work: ${workId}\nStage: ${assessment.stage}\n${assessment.messages.join('\n')}`,
        `Inspect the original with /change inspect ${workId}. No work is restarted by this view.`,
    ];
    if (settingsHeld) {
        const cancellation = controller.inspectWork(workId).state === 'CANCELLED'
            ? 'This original work is already cancelled; inspect the remaining blockers.'
            : `Use /change cancel ${workId} to review cancellation of this same work before changing its account. Cancellation also affects delegated work; it does not undo prior effects.`;
        paragraphs.push(`Account and role-setting changes are currently held by original work or other conversation obligations. ${cancellation} Keep its history and spent allowance. Settle any other blockers shown by /work or /goal before retrying settings. Cancellation alone does not guarantee settings become writable.`);
    }
    paragraphs.push(...assessment.issues.map(repairAction));
    paragraphs.push(`After repair, explicitly use /change resume ${workId}. This retains the same work, source, history and spent allowance. Required original grant recovery remains separate; no grant is renewed by this view.`);
    return paragraphs.join('\n\n');
}
