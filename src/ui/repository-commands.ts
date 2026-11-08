import { translator, uiText, type MessageId, type UiLocale } from './i18n.js';
import { isAbsolute } from 'node:path';
import { chooseUiItem, type UiChoice } from './choices.js';
import { escapeDisplayControls, quoteIdentity } from './inspection-text.js';
import { browseIntegrationDelegation } from './integration-delegation-browser.js';
import { captureDeliveryWork, captureResultDelivery } from './result-delivery.js';
import { showReviewAction, showReviewText, type ReviewPrimaryAction } from './exact-review.js';
import { browseIntegrationTargets } from './integration-target-browser.js';
import { browseMergeTargets } from './merge-target-browser.js';
import { browseMerges } from './merge-browser.js';
import { browseIntegrations } from './integration-browser.js';
import { integrationText } from './integration-presentation.js';
import type { SummaryPublicationRequest } from './contribution-publication.js';
import type { ContributionResource } from '../platform/github-contributions.js';
import { browseContributions } from './contribution-browser.js';
import { browsePublications } from './publication-browser.js';
import type { Controller } from '../controller/controller.js';
import type { HostCommand, HostCommandExecutor, HostCommandOutcome } from './host-commands.js';
import { readOwnerJson } from '../app/owner-json.js';
import { readRepositoryCredential } from '../app/repository-credential.js';
import { observeNativeConfigurationTarget, observeGitHubConfigurationTarget, validateGitHubConfigurationPath, validateRepositoryIdentityPath } from '../platform/repository-identity.js';
import { repositoryApiBase } from '../platform/repository-inspect-transport.js';
import { openGitHubReadClient } from '../platform/github.js';
import { parseRepositoryConfigurationProfile, type RepositoryProfile, type RepositoryTarget } from '../platform/configuration-session.js';
import { editRepositoryProfile } from './repository-profile.js';
import { readSingleLineInput } from './product-input.js';
import { repositoryApplicationReviewAvailable, repositoryAuditText, repositoryGuidanceText, repositoryPhaseText, repositoryPlanNextAction, repositoryPlanReadAction, repositoryPlanText, repositoryProfileText, repositoryTargetText } from './repository-presentation.js';
import { isRepositoryGuidanceBranch, type RepositoryConfigurationAudit, type RepositoryConfigurationView } from '../controller/configuration-types.js';
export type RepositoryInterruptHint = 'interaction.interruptibleObservation';
interface Host {
    uiLocale?(target: string): UiLocale;
    chooseItems?(title: string, items: readonly UiChoice[], initialValue?: string): Promise<string | undefined>;
    execute?: HostCommandExecutor;
    model?: import('../pi/session.js').PiModelSelection;
    controller: Controller;
    isCurrent(target: string): boolean;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    show(title: string, text: string, primary?: ReviewPrimaryAction): Promise<void>;
    notice(text: string): void;
    withActivity?<T>(source: string, describe: (locale: UiLocale) => string, task: () => Promise<T>, interrupt?: AbortController, interruptHint?: RepositoryInterruptHint): Promise<T>;
}
class RepositoryCredentialFileError extends Error {}
const credentialLeases = new WeakSet<Controller>();
type RepositoryActivity = Extract<MessageId, `repository.activity.${string}`>;
const identity = (target: RepositoryTarget) => ('provider' in target ? target.provider + ' · ' + target.apiBase : 'github · https://api.github.com') + ' · ' + target.owner + '/' + target.repository + ' · actor ' + target.actorUserId;
const display = (value: unknown, recovery = 'repo plan') => { const text = JSON.stringify(value, null, 2); return text.length > 32768 ? text.slice(0, 32768) + '\n[Shortened; use ' + recovery + ' for full detail]' : text; };
const retainedOperationArgument = /^operation\s+([A-Za-z0-9-]{1,128})\s+([A-Za-z0-9-]{1,128})$/u;
const repositoryActions = ['targets', 'plans', 'contributions', 'publications', 'merges', 'mergeTargets', 'integrations', 'integrationTargets', 'register', 'close'] as const;
type RepositoryAction = typeof repositoryActions[number];
const commandEntries: Partial<Record<string, RepositoryAction>> = {
    register: 'register', targets: 'targets', 'integration-targets': 'integrationTargets', 'merge-targets': 'mergeTargets',
};
function retainedOperationEntry(c: Controller, operationId: string, workId: string, targetId?: string) {
    const readers = [
        ['integrations', () => c.inspectRetainedIntegration(operationId).view],
        ['publications', () => c.inspectRetainedPublication(operationId).view],
        ['merges', () => {
            const retained = c.inspectRetainedMerge(operationId);
            return retained.state === 'RETAINED' ? retained.view : undefined;
        }],
    ] as const;
    for (const [entry, read] of readers) {
        try {
            const result = read();
            if (result?.operationId === operationId && result.workId === workId && (targetId === undefined || result.targetId === targetId))
                return entry;
        } catch {
            // A reader does not admit other families or unavailable originals.
        }
    }
}
function operationCommand(operationId: string, workId: string) {
    const argument = 'operation ' + operationId + ' ' + workId;
    const match = retainedOperationArgument.exec(argument);
    if (match?.[1] === operationId && match[2] === workId)
        return '/repo ' + argument;
}
export function retainedOperationCommand(c: Controller, operationId: string, workId: string, targetId: string): string | undefined {
    const command = operationCommand(operationId, workId);
    return command && retainedOperationEntry(c, operationId, workId, targetId) ? command : undefined;
}
/** Owner UI only. No conversation/model authority, credential store or second journal. */
export function repositoryCommands(host: Host) {
    const c = host.controller, abort = new AbortController(), owned = new Set<Promise<unknown>>();
    let closing = false;
    const cleanupFailures = new Set<unknown>();
    const track = <T>(task: Promise<T>) => {
        owned.add(task);
        void task.then(() => owned.delete(task), error => {
            owned.delete(task);
            if (error?.code === 'INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN')
                cleanupFailures.add(error);
        });
        return task;
    };
    const commands: HostCommand[] = [{ name: 'repo', descriptionId: 'command.description.repo', argumentHint: '[register|targets|integration-targets|deliver WORK_ID [history]|merge-targets|merge OPERATION_ID|operation OPERATION_ID WORK_ID]', run: async (argument, source, context) => {
                const originalMerge = /^merge\s+(\S+)$/u.exec(argument)?.[1];
                const deliveryArgument = /^deliver\s+(\S+)(?:\s+(history))?$/u.exec(argument);
                const resultWork = deliveryArgument?.[1], directHistory = deliveryArgument?.[2] === 'history';
                const operation = retainedOperationArgument.exec(argument);
                const operationId = operation?.[1];
                if (argument && !originalMerge && !resultWork && !operation && !Object.hasOwn(commandEntries, argument))
                    throw Error('Unknown repository command. See /help repo.');
                const locale = host.uiLocale?.(source) ?? 'en';
                const t = translator(locale);
                const originalEntry = operation ? retainedOperationEntry(c, operation[1]!, operation[2]!) : undefined;
                if (operation && !originalEntry) {
                    host.notice(uiText(locale, 'notice.operationUnavailable'));
                    return 'cancelled';
                }
                const history = resultWork && directHistory ? captureDeliveryWork(c, resultWork, locale) : undefined;
                const delivery = resultWork && !directHistory ? captureResultDelivery(c, resultWork, { locale }) : undefined;
                let followingDeliveryRecord = false;
                const resultCurrent = () => {
                    if (history) history.assertCurrent();
                    else if (followingDeliveryRecord) delivery?.assertWorkCurrent();
                    else delivery?.assertCurrent();
                };
                let initialAction: RepositoryAction | undefined = originalEntry ?? (delivery ? 'integrationTargets' : originalMerge ? 'merges' : commandEntries[argument]);
                const before = c.inspectConversation(source), choice = c.getConversationModelChoice(source), language = c.getConversationLanguage(source);
                const integrationPresentation = { locale, ...(host.chooseItems ? { chooseItems: async (title: string, items: readonly UiChoice[], initialValue?: string) => { guard(); const result = await host.chooseItems!(title, items, initialValue); guard(); return result; } } : {}) };
                let completed = false, retained: {
                    planId: string;
                    workId: string;
                } | undefined, retainedResource: string | undefined, retainedPublication: string | undefined, retainedIntegration: string | undefined, retainedIntegrationTarget: string | undefined, retainedMergeTarget: string | undefined, retainedMerge: string | undefined;
                const guard = () => {
                    if (abort.signal.aborted && retainedMerge)
                        throw Error('Repository form closed; Original PR merge ' + retainedMerge + ' remains retained. Inspect Retained PR merges before another action.', { cause: abort.signal.reason });
                    if (abort.signal.aborted && retainedMergeTarget)
                        throw Error('Repository form closed; Original PR merge target ' + retainedMergeTarget + ' remains retained. Inspect /repo or merge target-inspect before registering again.', { cause: abort.signal.reason });
                    abort.signal.throwIfAborted();
                    const now = c.inspectConversation(source);
                    if (closing || !host.isCurrent(source) || now.generation !== before.generation || now.projectId !== before.projectId || now.deleted || now.archived || c.getConversationModelChoice(source).revision !== choice.revision || c.getConversationLanguage(source).revision !== language.revision)
                        throw Error('Repository form source changed; reopen /repo. Existing target and plan identities remain retained.' + (retained ? ' Original plan ' + retained.planId + ' · work ' + retained.workId : '') + (retainedResource ? ' Original tracked resource ' + retainedResource : '') + (retainedPublication ? ' Original publication ' + retainedPublication : '') + (retainedIntegration ? ' Original integration ' + retainedIntegration : '') + (retainedIntegrationTarget ? ' Original integration target ' + retainedIntegrationTarget : '') + (retainedMerge ? ' Original PR merge ' + retainedMerge : '') + (retainedMergeTarget ? ' Original PR merge target ' + retainedMergeTarget : ''));
                    resultCurrent();
                };
                const choose = async (title: string, labels: string[]) => { guard(); const result = await host.choose(title, labels); guard(); return result; };
                const option = <Value extends string>(value: Value, label: string): UiChoice<Value> => ({ value, label });
                const pick = <Value extends string>(title: string, items: readonly UiChoice<Value>[], initialValue?: Value) =>
                    chooseUiItem<Value>({ choose, ...integrationPresentation }, title, items, initialValue);
                const input = async (title: string, value = '', description?: string) => {
                    guard();
                    const result = await host.input(title, value, description);
                    guard();
                    return result;
                };
                const show = async (title: string, value: unknown, primary?: ReviewPrimaryAction) => { guard(); await host.show(title, typeof value === 'string' ? value : display(value), primary); guard(); };
                const navigation = host.execute ? { navigate: async (command: string) => { guard(); return host.execute!(command, source, context); } } : {};
                const operationRecovery = ({ id, work, target, unavailable }: ReturnType<Controller['inspectFirstIntegrationPreparation']>['targetHolds'][number]) => {
                    if (unavailable || !work || !target)
                        return;
                    return retainedOperationCommand(c, id, work, target);
                };
                const withActivity = async <T>(describe: (locale: UiLocale) => string, task: () => Promise<T>, interrupt?: AbortController, interruptHint?: RepositoryInterruptHint) =>
                    host.withActivity ? host.withActivity(source, describe, task, interrupt, interruptHint) : task();
                const withLeasedActivity = <T>(describe: (locale: UiLocale) => string, task: () => Promise<T>, interrupt?: AbortController, interruptHint?: RepositoryInterruptHint) => {
                    if (credentialLeases.has(c))
                        throw Error('Another repository action owns the credential session; wait for its original outcome');
                    credentialLeases.add(c);
                    return track(withActivity(describe, task, interrupt, interruptHint).finally(() => { credentialLeases.delete(c); }));
                };
                const notice = (text: string) => {
                    try {
                        guard();
                    }
                    catch {
                        return;
                    }
                    host.notice(text);
                };
                const credential = async (file: string) => {
                    const projectRoots = c.listProjects().map(p => p.sourceRoot);
                    try {
                        return await readRepositoryCredential(file, projectRoots);
                    }
                    catch {
                        throw new RepositoryCredentialFileError('Cannot read repository credential profile. Use a canonical private owner-only JSON file outside registered projects with only a token field. No credential was configured.');
                    }
                };
                const chooseCredentialFile = async <T>(use: (file: string) => Promise<T>, fresh: () => void, retryFileRead?: () => Promise<boolean>) => {
                    let previousPath = '';
                    while (true) {
                        const file = await readSingleLineInput(async (value, description) => {
                            fresh();
                            return input(t('repository.credentialFilePrompt'), value, description);
                        }, previousPath, t('repository.fieldSingleLine'));
                        if (file === undefined)
                            return;
                        guard();
                        fresh();
                        try {
                            return await use(file);
                        }
                        catch (error) {
                            if (!retryFileRead || !(error instanceof RepositoryCredentialFileError))
                                throw error;
                            fresh();
                            const retry = await retryFileRead();
                            fresh();
                            if (!retry)
                                return;
                            previousPath = isAbsolute(file) ? file : '';
                        }
                    }
                };
                const withCredential = <T>(activity: RepositoryActivity, task: (signal: AbortSignal) => Promise<T>, fresh: () => void,
                    route: 'configuration' | 'contribution' | 'publication' | 'merge' = 'configuration',
                    options: { retryFileRead?: () => Promise<boolean>; interrupt?: AbortController; interruptHint?: RepositoryInterruptHint } = {}) =>
                    chooseCredentialFile(file => {
                        const { interrupt } = options;
                        const signal = interrupt ? AbortSignal.any([abort.signal, interrupt.signal]) : abort.signal;
                        return withLeasedActivity(locale => uiText(locale, activity), async () => {
                            const token = await credential(file).catch(error => {
                                if (!(error instanceof RepositoryCredentialFileError && interrupt?.signal.aborted))
                                    throw error;
                            });
                            guard();
                            fresh();
                            if (token === undefined || interrupt?.signal.aborted)
                                return;
                            if (route === 'merge')
                                c.configureMergeCredential(token);
                            else if (route === 'contribution')
                                c.configureContributionReader(token);
                            else if (route === 'publication')
                                c.configurePublicationCredential(token);
                            else
                                c.configureRepositoryConfigurationCredential(token);
                            guard();
                            fresh();
                            return task(signal);
                        }, interrupt, options.interruptHint);
                    }, fresh, options.retryFileRead);
                const correctConfigurationCredentialFile = () => showReviewAction({ show },
                    uiText(locale, 'repository.credentialFileUnavailable'),
                    uiText(locale, 'repository.credentialFileRequirements'), uiText(locale, 'repository.correctCredentialFile'));
                const prepareFirstMerge = (context: ReturnType<Controller['inspectOwnerMergePreparation']>, fresh: () => void) => withCredential('repository.activity.prepareMerge', async (signal) => { fresh(); const result = await c.prepareOwnerMerge(context.workId, context.targetId, context.branchOperationId, signal, guard); retainedMerge = result.operationId; guard(); return result; }, fresh, 'merge');
                const reconcileMerge = (context: ReturnType<Controller['inspectMergeReconciliation']>, fresh: () => void) => {
                    const interrupt = new AbortController();
                    return withCredential('repository.activity.readMergeResult', async (signal) => {
                        fresh();
                        retainedMerge = context.operationId;
                        try {
                            return await c.reconcileOwnerMerge({ operationId: context.operationId, expectedContext: context.fingerprint, signal }, guard);
                        }
                        catch (error) {
                            if (interrupt.signal.aborted && signal.reason === interrupt.signal.reason && error === interrupt.signal.reason) {
                                guard();
                                return 'interrupted' as const;
                            }
                            throw Error('Original PR merge ' + context.operationId + ' · work ' + context.workId + ' · target ' + context.targetId + ' read unavailable: ' + (error instanceof Error ? error.message : 'Native read unavailable'), { cause: error });
                        }
                    }, fresh, 'merge', { interrupt });
                };
                const prepareRetainedMerge = (context: ReturnType<Controller['inspectRetainedMergePreparation']>, fresh: () => void) => withCredential('repository.activity.prepareMerge', async (signal) => {
                    fresh();
                    retainedMerge = context.operationId;
                    try {
                        return await c.prepareRetainedOwnerMerge({ operationId: context.operationId, expectedContext: context.fingerprint, signal }, guard);
                    }
                    catch (error) {
                        throw Error('Original PR merge ' + context.operationId + ' · work ' + context.workId + ' · target ' + context.targetId + ' preparation unavailable: ' + (error instanceof Error ? error.message : 'Native preparation unavailable'), { cause: error });
                    }
                }, fresh, 'merge');
                const dispatchPreparedMerge = async (context: ReturnType<Controller['inspectMergeDispatch']>, fresh: () => void) => {
                    fresh();
                    return withLeasedActivity(locale => uiText(locale, 'repository.activity.sendMerge'), async () => {
                        fresh();
                        retainedMerge = context.operationId;
                        try {
                            return await c.dispatchOwnerMerge({ operationId: context.operationId, expectedContext: context.fingerprint, signal: abort.signal }, guard);
                        }
                        catch (error) {
                            throw Error('Original PR merge ' + context.operationId + ' · work ' + context.workId + ' · target ' + context.targetId + ' send unavailable: ' + (error instanceof Error ? error.message : 'Native merge unavailable'), { cause: error });
                        }
                    });
                };
                const registerMergeTarget = (request: import('../controller/merge-types.js').RegisterMergeTarget, fresh: () => void) => withCredential('repository.activity.verifyPullRequest', async (signal) => { fresh(); const result = await c.registerMergeTarget(request, signal, fresh); retainedMergeTarget = result.targetId; guard(); return result; }, fresh, 'merge');
                const registerIntegrationTarget = async (request: import('../controller/effect-types.js').RegisterLocalTarget, fresh: () => void) => {
                    let gitProfile = c.options.effectsProfile ? structuredClone(c.options.effectsProfile) : undefined;
                    if (!gitProfile) {
                        const gitBinary = await input(uiText(locale, 'integration.localGit'));
                        if (gitBinary === undefined)
                            return;
                        gitProfile = { gitBinary };
                    }
                    fresh();
                    return track(withActivity(locale => uiText(locale, 'integration.activity.localReceiver', { ref: quoteIdentity(request.ref, 64) }), async () => {
                        const result = await c.registerLocalTarget(request, { gitProfile, signal: abort.signal, validate: fresh });
                        retainedIntegrationTarget = result.targetId;
                        guard();
                        return result;
                    }));
                };
                const registerHostedTarget = async (request: import('../controller/hostedintegration.js').RegisterHostedIntegrationTarget, fresh: () => void) => {
                    let gitProfile = c.options.effectsProfile ? structuredClone(c.options.effectsProfile) : undefined;
                    if (!gitProfile) {
                        const binary = await input('Trusted Git executable for hosted target registration · canonical absolute path');
                        if (binary === undefined)
                            return;
                        gitProfile = { gitBinary: binary };
                    }
                    fresh();
                    const file = await input('Private repository credential JSON file · canonical absolute path');
                    if (file === undefined)
                        return;
                    fresh();
                    return withLeasedActivity(locale => uiText(locale, 'integration.activity.hostedReceiver', { ref: quoteIdentity(request.ref, 64) }), async () => {
                        const token = await credential(file);
                        fresh();
                        c.configureHostedIntegrationCredential(token);
                        fresh();
                        const result = await c.registerHostedIntegrationTarget(request, { gitProfile, signal: abort.signal, validate: fresh });
                        retainedIntegrationTarget = result.targetId;
                        guard();
                        return result;
                    });
                };
                const integrationAction = async <T>(operationId: string, context: {
                    gitProfile: import('../controller/effect-types.js').EffectsProfile | null;
                    family: string;
                }, fresh: () => void, perform: (gitProfile: import('../controller/effect-types.js').EffectsProfile, signal: AbortSignal) => Promise<T>, label: 'read' | 'preparation' | 'first preparation' | 'send', options: { firstWorkId?: string; interrupt?: AbortController } = {}) => {
                    const { firstWorkId, interrupt } = options;
                    let gitProfile = context.gitProfile ?? undefined;
                    if (!gitProfile) {
                        const binary = await input('Trusted Git executable for this ' + label + ' · canonical absolute path');
                        if (binary === undefined)
                            return;
                        gitProfile = { gitBinary: binary };
                        fresh();
                    }
                    const file = context.family === 'github-existing-ref' ? await input('Private repository credential JSON file · canonical absolute path') : undefined;
                    if (context.family === 'github-existing-ref' && file === undefined)
                        return;
                    fresh();
                    const activity = label === 'first preparation' ? 'preparation' : label;
                    const signal = interrupt ? AbortSignal.any([abort.signal, interrupt.signal]) : abort.signal;
                    return withLeasedActivity(locale => uiText(locale, `integration.activity.${activity}`), async () => {
                        if (file !== undefined) {
                            const token = await credential(file);
                            fresh();
                            if (interrupt?.signal.aborted)
                                return;
                            c.configureHostedIntegrationCredential(token);
                        }
                        fresh();
                        if (!firstWorkId)
                            retainedIntegration = operationId;
                        try {
                            const result = await perform(gitProfile!, signal);
                            if (firstWorkId && result && typeof result === 'object' && 'operationId' in result && typeof result.operationId === 'string')
                                retainedIntegration = result.operationId;
                            return result;
                        }
                        catch (error) {
                            throw Error((firstWorkId ? 'First integration for work ' + firstWorkId : 'Original integration ' + operationId) + ' ' + label + ' unavailable: ' + (error instanceof Error ? error.message : 'Native request unavailable'), { cause: error });
                        }
                    }, interrupt);
                };
                const reconcileIntegration = (operationId: string, context: ReturnType<Controller['inspectIntegrationReconciliation']>, fresh: () => void) => {
                    const interrupt = new AbortController();
                    return integrationAction(operationId, context, fresh, async (gitProfile, signal) => {
                        try {
                            return await c.reconcileRetainedIntegration({ operationId, expectedContext: context.fingerprint, gitProfile, signal }, fresh);
                        } catch (error) {
                            if (interrupt.signal.aborted && signal.reason === interrupt.signal.reason && error === interrupt.signal.reason) {
                                guard();
                                return 'interrupted' as const;
                            }
                            throw error;
                        }
                    }, 'read', { interrupt });
                };
                const prepareIntegration = (operationId: string, context: ReturnType<Controller['inspectIntegrationPreparation']>, fresh: () => void) => integrationAction(operationId, context.context, fresh, gitProfile => { const operation = c.retainedWorkModelOperation(context.reviewed.work.id, host.model); return c.prepareRetainedIntegration({ ...operation, operationId, targetId: context.reviewed.targetId, expectedContext: context.contextFingerprint, gitProfile, signal: abort.signal }, guard); }, 'preparation');
                const firstIntegration = (workId: string, targetId: string, context: ReturnType<Controller['inspectFirstIntegrationPreparation']>, fresh: () => void) => integrationAction(workId, { gitProfile: context.gitProfile, family: context.delegation.target.state === 'RETAINED' ? context.delegation.target.family : 'unavailable' }, fresh, gitProfile => {
                    const operation = c.retainedWorkModelOperation(workId, host.model);
                    return c.prepareFirstIntegration({ ...operation, targetId, expectedContext: context.contextFingerprint, gitProfile, signal: abort.signal }, guard, id => {
                        // The original allocation has rechecked the exact result and current evidence.
                        // Its own authority/derived-candidate lifecycle now owns further result changes.
                        retainedIntegration = id;
                        if (delivery) {
                            delivery.assertWorkCurrent();
                            followingDeliveryRecord = true;
                        }
                    });
                }, 'first preparation', { firstWorkId: workId });
                const reauthorizeMerge = (context: ReturnType<Controller['inspectMergeReauthorization']>, reason: string, fresh: () => void) => { retainedMerge = context.operationId; return track(c.reauthorizeOwnerMerge({ operationId: context.operationId, expectedContext: context.fingerprint, reason, signal: abort.signal }, fresh).catch(error => { throw Error('Original PR merge ' + context.operationId + ' · work ' + context.workId + ' · target ' + context.targetId + ' reauthorization unavailable: ' + (error instanceof Error ? error.message : 'Current procedure unavailable'), { cause: error }); })); };
                const reauthorizeIntegration = (operationId: string, context: ReturnType<Controller['inspectIntegrationReauthorization']>, reason: string, fresh: () => void) => { retainedIntegration = operationId; return track(c.reauthorizeOwnerIntegration({ operationId, expectedContext: context.fingerprint, reason, signal: abort.signal }, fresh)); };
                const openOriginalIntegration = async (id: string, targetId: string, exact?: true) => {
                    guard();
                    if (delivery) {
                        const original = c.inspectRetainedIntegration(id), snapshot = JSON.stringify(original);
                        if (original.entry.operationId !== id || original.entry.workId !== delivery.workId || original.entry.targetId !== targetId)
                            throw Error('Original integration does not match this result and receiver');
                        const assertOriginal = () => {
                            guard();
                            if (JSON.stringify(c.inspectRetainedIntegration(id)) !== snapshot)
                                throw Error('Selected original integration changed; reopen its review');
                        };
                        assertOriginal();
                        if (!original.view) {
                            await show(t('integration.unavailableTitle'), integrationText(original, locale));
                            assertOriginal();
                            return false;
                        }
                        retainedIntegration = id;
                        delivery.assertWorkCurrent();
                        followingDeliveryRecord = true;
                    }
                    return browseIntegrations({ ...navigation, ...integrationPresentation, guard, choose, input, show, notice, reauthorize: reauthorizeIntegration, reconcile: reconcileIntegration, dispatch: dispatchIntegration, prepare: prepareIntegration, ...host.model ? { preparationModel: { provider: host.model.provider, modelId: host.model.modelId } } : {} }, c, id, { pinned: !!delivery || exact === true });
                };
                const dispatchIntegration = (operationId: string, context: ReturnType<Controller['inspectIntegrationDispatch']>, fresh: () => void) => integrationAction(operationId, context.context, fresh, gitProfile => c.dispatchRetainedIntegration({ operationId, expectedContext: context.contextFingerprint, gitProfile, signal: abort.signal }, guard), 'send');
                const planChanged = (id: string) => Error(t('repository.plan.changed', { id: escapeDisplayControls(id) }));
                const configurationPlanGuard = (plan: RepositoryConfigurationView) => {
                    const captured = JSON.stringify(plan);
                    const targetCurrent = plan.plan ? repositoryTargetGuard(plan.targetId, plan.plan.target) : guard;
                    return () => {
                        targetCurrent();
                        if (JSON.stringify(c.inspectRepositoryConfiguration(plan.planId)) !== captured)
                            throw planChanged(plan.planId);
                    };
                };
                const inspectPlan = async (opened: RepositoryConfigurationView) => {
                    const id = opened.planId;
                    let plan = opened;
                    let current = configurationPlanGuard(plan);
                    current();
                    while (true) {
                        const fresh = current;
                        if (!plan.plan) {
                            await show(t('repository.plan.previewUnavailable'), repositoryPlanText(plan, false, locale));
                            return;
                        }
                        const canReviewApplication = repositoryApplicationReviewAvailable(plan);
                        const read = repositoryPlanReadAction(plan);
                        const target = plan.plan.target;
                        const repository = escapeDisplayControls(`${target.owner}/${target.repository}`);
                        const title = t('repository.plan.title', { repository, phase: repositoryPhaseText(plan.phase, locale), revision: plan.revision });
                        const selected = await pick(canReviewApplication ? title : title + '\n' + repositoryPlanNextAction(plan, locale), [
                            option('inspect', t('repository.plan.inspect')),
                            ...canReviewApplication ? [option('apply', t('repository.plan.reviewApply'))] : [],
                            ...read ? [option('reconcile', t(read))] : [],
                            option('audit', t('repository.plan.audit')),
                            option('back', t('repository.navigation.back')),
                        ]);
                        fresh();
                        if (!selected || selected === 'back')
                            return;
                        if (selected === 'inspect') {
                            await show(t('repository.plan.inspectTitle'), repositoryPlanText(plan, false, locale));
                            fresh();
                            continue;
                        }
                        const apply = selected === 'apply';
                        if (apply) {
                            if (!canReviewApplication)
                                throw Error('Application review is unavailable for this retained plan');
                            const reviewed = await showReviewText({ show }, uiText(locale, 'repository.reviewApplyTitle'),
                                repositoryPlanText(plan, true, locale), fresh, uiText(locale, 'review.only'), locale,
                                { next: uiText(locale, 'review.next'), finish: uiText(locale, 'repository.openApplyConfirmation') });
                            if (!reviewed)
                                continue;
                            fresh();
                            const confirmation = t('repository.plan.confirmTitle', { id }) + '\n' + escapeDisplayControls(identity(target));
                            const decision = await pick(confirmation, [option('back', t('repository.plan.applyBack')),
                                option('apply', t('repository.plan.applyConfirm', { repository, revision: plan.revision }))]);
                            fresh();
                            if (decision !== 'apply')
                                continue;
                        }
                        const reconcile = selected === 'reconcile';
                        const interrupt = apply ? undefined : new AbortController();
                        const activity = apply ? 'repository.activity.applySettings' : reconcile
                            ? read === 'repository.plan.confirmCurrent' ? 'repository.activity.confirmCurrentSettings' : 'repository.activity.readSettingsResult'
                            : 'repository.activity.auditSettings';
                        const result = await withCredential<RepositoryConfigurationView | RepositoryConfigurationAudit>(activity,
                            signal => apply ? c.applyRepositoryConfiguration({ planId: id, signal }) : reconcile ? c.reconcileRepositoryConfiguration({ planId: id, signal }) : c.auditRepositoryConfiguration({ planId: id, signal }),
                            fresh, 'configuration', { retryFileRead: correctConfigurationCredentialFile, ...interrupt ? { interrupt } : {} });
                        if (result === undefined) {
                            fresh();
                            continue;
                        }
                        completed = true;
                        retained = { planId: id, workId: plan.workId };
                        if (closing || !host.isCurrent(source))
                            return;
                        const audit = 'view' in result;
                        const next = audit ? result.view : result;
                        const receipts = new Set(next.receiptIds);
                        if (result.planId !== id || result.targetId !== plan.targetId || next.planId !== id ||
                            next.operationId !== plan.operationId || next.workId !== plan.workId ||
                            next.targetId !== plan.targetId || next.revision !== plan.revision ||
                            JSON.stringify(next.plan) !== JSON.stringify(plan.plan) ||
                            plan.receiptIds.some(receipt => !receipts.has(receipt)))
                            throw planChanged(id);
                        const outcomeCurrent = configurationPlanGuard(next);
                        outcomeCurrent();
                        notice(t('repository.plan.outcomeRetained', { id, work: plan.workId }));
                        const readComplete = audit ? result.complete : next.phase === 'CONFIRMED';
                        const outcomeTitle = t(interrupt?.signal.aborted && !readComplete
                            ? audit ? 'repository.audit.stopRequested' : 'repository.plan.readInterrupted' : 'repository.plan.outcomeTitle');
                        if (audit) {
                            const target = result.complete && result.view.plan?.target;
                            await show(outcomeTitle, repositoryAuditText(result, locale), target ? {
                                label: uiText(locale, 'repository.openAuditGuidance'),
                                run: () => readPolicy(result.view.targetId, target, outcomeCurrent),
                            } : undefined);
                        } else {
                            await show(outcomeTitle, repositoryPlanText(result, false, locale));
                        }
                        outcomeCurrent();
                        plan = next;
                        current = outcomeCurrent;
                    }
                };
                const plans = async (targetId?: string, scopeCurrent = guard) => {
                    let cursor: string | undefined, focused: string | undefined;
                    const stack: (string | undefined)[] = [];
                    while (true) {
                        scopeCurrent();
                        const page = c.listRepositoryConfigurationPlans({ limit: 25, ...targetId ? { targetId } : {}, ...cursor ? { before: cursor } : {} });
                        const picked = await pick(t('repository.navigation.planList'), [
                            ...page.plans.map(plan => ({ value: `plan:${plan.planId}`, label: plan.state === 'RETAINED'
                                ? t('repository.navigation.planRow', { repository: `${plan.target.owner}/${plan.target.repository}`, phase: repositoryPhaseText(plan.recordedPhase, locale), revision: plan.revision, id: plan.planId })
                                : t('repository.navigation.unavailablePlanRow', { id: plan.planId }) })),
                            ...page.nextCursor ? [option('older', t('repository.navigation.olderPlans'))] : [],
                            ...stack.length ? [option('newer', t('repository.navigation.newerPlans'))] : [], option('back', t('repository.navigation.back')),
                        ], focused);
                        scopeCurrent();
                        if (!picked || picked === 'back')
                            return;
                        if (picked === 'older' && page.nextCursor) {
                            stack.push(cursor);
                            cursor = page.nextCursor;
                            continue;
                        }
                        if (picked === 'newer' && stack.length) {
                            cursor = stack.pop();
                            continue;
                        }
                        const selected = page.plans.find(plan => `plan:${plan.planId}` === picked);
                        if (!selected)
                            throw Error('Plan selection changed');
                        if (JSON.stringify(c.inspectRepositoryConfigurationPlanEntry(selected.planId)) !== JSON.stringify(selected))
                            throw planChanged(selected.planId);
                        focused = picked;
                        if (selected.state === 'UNAVAILABLE') {
                            await show(t('repository.navigation.unavailablePlan'), selected);
                            continue;
                        }
                        const plan = c.inspectRepositoryConfiguration(selected.planId);
                        if (plan.workId !== selected.workId || plan.targetId !== selected.targetId ||
                            plan.revision !== selected.revision || plan.phase !== selected.recordedPhase ||
                            plan.nextAction !== selected.nextAction)
                            throw planChanged(selected.planId);
                        await inspectPlan(plan);
                    }
                };
                const repositoryTargetGuard = (targetId: string, target: RepositoryTarget) => {
                    const expected = JSON.stringify(target);
                    return () => {
                        guard();
                        const current = c.inspectRepositoryConfigurationTarget(targetId);
                        if (current.state !== 'RETAINED' || JSON.stringify(current.target) !== expected)
                            throw Error('Selected repository target changed; reopen registered targets');
                    };
                };
                const newPreview = async (targetId: string, target: RepositoryTarget) => {
                    const fresh = repositoryTargetGuard(targetId, target);
                    fresh();
                    const provider = 'provider' in target ? target.provider : 'github', mode = await choose('New configuration preview · ' + identity(target), ['Edit recommendation fields', 'Import private profile file', 'Cancel']);
                    if (!mode || mode === 'Cancel')
                        return;
                    fresh();
                    let stoppedPreview: RepositoryConfigurationView | undefined;
                    const submit = async (profile: RepositoryProfile): Promise<'finished' | 'declined' | 'stopped'> => {
                        const original = stoppedPreview;
                        const originalCurrent = original && configurationPlanGuard(original);
                        const check = () => { fresh(); originalCurrent?.(); };
                        check();
                        const desired = structuredClone(profile);
                        if (('provider' in desired ? desired.provider : 'github') !== provider)
                            throw Error('Desired profile provider differs from the selected repository target');
                        if (!await showReviewText({ show }, uiText(locale, 'repository.reviewPreviewTitle'), repositoryProfileText(desired, target, locale),
                            check, uiText(locale, 'review.only'), locale,
                            { next: uiText(locale, 'review.next'), finish: uiText(locale, 'repository.openPreviewCredentials') }))
                            return 'declined';
                        check();
                        const interrupt = new AbortController();
                        const result = await withCredential('repository.activity.previewSettings',
                            signal => c.previewRepositoryConfiguration({ targetId, profile: desired, signal, ...original ? { continuationPlanId: original.planId } : {} }), check, 'configuration',
                            { retryFileRead: correctConfigurationCredentialFile, interrupt });
                        if (result === undefined)
                            return interrupt.signal.aborted ? 'stopped' : 'declined';
                        completed = true;
                        retained = { planId: result.planId, workId: result.workId };
                        if (result.targetId !== targetId || original && (result.planId !== original.planId || result.workId !== original.workId || result.revision !== original.revision + 1))
                            throw planChanged(original?.planId ?? result.planId);
                        const noticeKey = result.plan ? 'repository.plan.previewRetained' : 'repository.plan.previewNotAvailable';
                        notice(t(noticeKey, { id: result.planId, work: result.workId, phase: repositoryPhaseText(result.phase, locale) }));
                        if (closing || !host.isCurrent(source))
                            return 'finished';
                        const detail = repositoryPlanText(result, false, locale);
                        if (interrupt.signal.aborted && !result.plan && result.phase === 'REFUSED') {
                            const stoppedCurrent = configurationPlanGuard(result);
                            fresh();
                            stoppedCurrent();
                            await show(t('repository.plan.previewStopped'), detail);
                            fresh();
                            stoppedCurrent();
                            stoppedPreview = result;
                            return 'stopped';
                        }
                        if (!result.plan) {
                            await show(t('repository.plan.previewUnavailable'), detail);
                            return 'finished';
                        }
                        const snapshot = JSON.stringify(result), previewCurrent = () => {
                            fresh();
                            if (JSON.stringify(c.inspectRepositoryConfiguration(result.planId)) !== snapshot)
                                throw Error('Retained preview changed; inspect original plan ' + result.planId + ' · work ' + result.workId + ' in /repo');
                        };
                        previewCurrent();
                        if (await showReviewAction({ show }, t('repository.retainedPreviewTitle'), detail, uiText(locale, 'repository.openOriginalPlan'))) {
                            previewCurrent();
                            await inspectPlan(result);
                        }
                        return 'finished';
                    };
                    if (mode === 'Edit recommendation fields') {
                        let operation: 'update' | 'create' = 'update';
                        if (provider !== 'github') {
                            const selected = await choose('Native protection operation · never inferred from a failed lookup', ['Update existing rule', 'Create new rule', 'Cancel']);
                            if (!selected || selected === 'Cancel')
                                return;
                            if (selected === 'Create new rule')
                                operation = 'create';
                            else if (selected !== 'Update existing rule')
                                throw Error('Unknown native protection operation');
                        }
                        const branch = await input('Literal branch / native protection rule · recommendation starting point', 'main');
                        if (branch === undefined)
                            return;
                        await editRepositoryProfile({ locale, choose, input, guard: fresh, show,
                            submit: async profile => await submit(profile) === 'finished' }, provider, branch, operation);
                        return;
                    }
                    if (mode !== 'Import private profile file')
                        throw Error('Unknown repository profile entry');
                    const file = await input('Private desired profile JSON file · canonical absolute path');
                    if (file === undefined)
                        return;
                    let profile: RepositoryProfile;
                    try {
                        profile = parseRepositoryConfigurationProfile(await readOwnerJson(file, c.listProjects().map(p => p.sourceRoot), 'Repository configuration profile', 32768));
                    }
                    catch {
                        throw Error('Cannot read desired profile. Use a valid private same-provider configuration file outside registered projects.');
                    }
                    while (await submit(profile) === 'stopped') {
                        const retry = await pick(t('repository.plan.importedProfileRetained'), [option('back', t('repository.navigation.back')),
                            option('retry', t('repository.plan.retryPreview'))]);
                        if (retry !== 'retry') return;
                    }
                };
                const readPolicy = async (targetId: string, target: RepositoryTarget, assertAuditCurrent?: () => void) => {
                    const targetCurrent = repositoryTargetGuard(targetId, target);
                    const fresh = () => { assertAuditCurrent?.(); targetCurrent(); };
                    fresh();
                    let title = uiText(locale, 'repository.guidanceBranch');
                    let branch = '';
                    while (true) {
                        const entered = await input(title, branch);
                        fresh();
                        if (entered === undefined)
                            return;
                        branch = entered;
                        if (!isRepositoryGuidanceBranch(branch)) {
                            title = uiText(locale, 'repository.invalidGuidanceBranch');
                            continue;
                        }
                        const interrupt = new AbortController();
                        let result;
                        try {
                            result = await withCredential('repository.activity.readBranchPolicy', async signal => {
                                fresh();
                                try { return await c.guideRepositoryConfiguration({ targetId, branch, signal }); }
                                catch (error) {
                                    if (interrupt.signal.aborted && signal.reason === interrupt.signal.reason && error === signal.reason)
                                        return 'stopped' as const;
                                    throw error;
                                }
                            }, fresh, 'configuration', { retryFileRead: correctConfigurationCredentialFile, interrupt, interruptHint: 'interaction.interruptibleObservation' });
                            fresh();
                        } catch (error) {
                            throw Error('Policy read for target ' + targetId + ' · branch ' + branch + ' failed: ' + (error instanceof Error ? error.message : 'Read unavailable'));
                        }
                        if (result === 'stopped' || result === undefined && interrupt.signal.aborted) {
                            title = uiText(locale, 'repository.branchReadStopped');
                            continue;
                        }
                        if (result === undefined)
                            return;
                        completed = true;
                        await show('Current branch policy observations · not complete policy or permission', repositoryGuidanceText(result, target, locale));
                        return;
                    }
                };
                const trackResource = async (targetId: string, target: RepositoryTarget) => {
                    if ('provider' in target)
                        throw Error('Issue/PR contribution tracking currently supports GitHub.com only');
                    const expected = JSON.stringify(target), fresh = () => {
                        guard();
                        const now = c.inspectRepositoryConfigurationTarget(targetId);
                        if (now.state !== 'RETAINED' || JSON.stringify(now.target) !== expected)
                            throw Error('Selected repository identity changed; reopen registered targets before tracking');
                    };
                    fresh();
                    const kind = await choose('Track existing GitHub resource · repository identity only', ['issue', 'pull-request']);
                    if (!kind)
                        return;
                    if (kind !== 'issue' && kind !== 'pull-request')
                        throw Error('Choose issue or pull-request');
                    const raw = await input('Existing GitHub issue / PR number · positive whole number');
                    if (raw === undefined)
                        return;
                    fresh();
                    if (!/^[1-9][0-9]{0,15}$/.test(raw) || !Number.isSafeInteger(Number(raw)))
                        throw Error('Enter an existing positive safe GitHub issue or PR number');
                    const request: ContributionResource = { repository: { owner: target.owner, repository: target.repository, repositoryId: target.repositoryId, repositoryNodeId: target.repositoryNodeId }, kind, number: Number(raw) };
                    await show('Track existing GitHub resource · read requests and local observations only', { targetId, request, existingTracking: 'An already tracked resource is refreshed under its original ID.', scope: 'No remote issue/PR creation, policy change, publication or merge. The supplied credential reads this repository; the registered actor is not authenticated by this contribution reader.' });
                    fresh();
                    const result = await withCredential('repository.activity.trackContribution', signal => c.trackRepositoryResource(request, signal), fresh, 'contribution');
                    if (!result)
                        return;
                    retainedResource = result.resourceId;
                    completed = true;
                    guard();
                    await show('GitHub resource tracked · original identity retained', display(result, 'repo contributions --resource ' + result.resourceId));
                };
                const refreshResource = async (resourceId: string, fresh: () => void) => {
                    const result = await withCredential('repository.activity.refreshContribution', signal => { retainedResource = resourceId; return c.refreshContributions({ resourceIds: [resourceId], signal }); }, fresh, 'contribution');
                    if (result !== undefined) {
                        completed = true;
                        guard();
                    }
                    return result;
                };
                const parentResource = async (request: {
                    childId: string;
                    parentId: string | null;
                    expectedRevision: number;
                }, fresh: () => void) => {
                    const result = await withCredential('repository.activity.updateSummaryRouting', async (signal) => {
                        retainedResource = request.childId;
                        try {
                            return await c.setResourceSummaryParent(request, signal);
                        }
                        catch (error) {
                            throw Error('Summary routing for original resource ' + request.childId + ' unavailable: ' + (error instanceof Error ? error.message : 'Native read or link update unavailable'), { cause: error });
                        }
                    }, fresh, 'contribution');
                    if (result !== undefined) {
                        completed = true;
                        guard();
                    }
                    return result;
                };
                const prepareSummary = async (request: SummaryPublicationRequest, fresh: () => void) => {
                    const result = await withCredential('repository.activity.preparePublication', async (signal) => {
                        fresh();
                        const targetId = 'targetId' in request ? request.targetId : c.registerPublicationTarget(request.registration).targetId;
                        try {
                            const original = await c.prepareContributionSummaryPublication({ resourceId: request.resourceId, revisionId: request.revisionId, targetId, signal });
                            retainedPublication = original.operationId;
                            return original;
                        }
                        catch (error) {
                            throw Error('Summary preparation for original resource ' + request.resourceId + ' · publication target ' + targetId + ' unavailable: ' + (error instanceof Error ? error.message : 'Native preflight unavailable'), { cause: error });
                        }
                    }, fresh, 'publication');
                    if (result !== undefined) {
                        completed = true;
                        guard();
                    }
                    return result;
                };
                const resumeSummaryPreparation = async (request: {
                    operationId: string;
                    resourceId: string;
                    revisionId: string;
                    targetId: string;
                }, fresh: () => void) => {
                    const result = await withCredential('repository.activity.preparePublication', async (signal) => {
                        retainedPublication = request.operationId;
                        try {
                            return await c.prepareContributionSummaryPublication({ ...request, signal });
                        }
                        catch (error) {
                            throw Error('Preparation recovery for original publication ' + request.operationId + ' unavailable: ' + (error instanceof Error ? error.message : 'Native preflight unavailable'), { cause: error });
                        }
                    }, fresh, 'publication');
                    if (result !== undefined) {
                        completed = true;
                        guard();
                    }
                    return result;
                };
                const reconcilePublication = async (operationId: string, fresh: () => void) => {
                    const interrupt = new AbortController();
                    const result = await withCredential('repository.activity.readPublicationResult', async (signal) => {
                        retainedPublication = operationId;
                        try {
                            const view = await c.reconcilePublication({ operationId, signal });
                            return { view, interrupted: interrupt.signal.aborted };
                        }
                        catch (error) {
                            throw Error('Reconciliation for original publication ' + operationId + ' unavailable: ' + (error instanceof Error ? error.message : 'Native read unavailable'), { cause: error });
                        }
                    }, fresh, 'publication', { interrupt });
                    if (result !== undefined) {
                        completed = true;
                        guard();
                    }
                    return result;
                };
                const dispatchPublication = async (operationId: string, fresh: () => void) => {
                    const result = await withCredential('repository.activity.sendPublication', async (signal) => {
                        retainedPublication = operationId;
                        try {
                            return await c.dispatchPublication({ operationId, signal });
                        }
                        catch (error) {
                            throw Error('Send for original publication ' + operationId + ' unavailable: ' + (error instanceof Error ? error.message : 'Native dispatch unavailable'), { cause: error });
                        }
                    }, fresh, 'publication');
                    if (result !== undefined) {
                        completed = true;
                        guard();
                    }
                    return result;
                };
                const retainedPublications = (id?: string) => browsePublications({ ...navigation, ...integrationPresentation, guard, choose, show,
                    reopenCommand: view => operationCommand(view.operationId, view.workId),
                    reconcile: reconcilePublication, dispatch: dispatchPublication, resumePreparation: resumeSummaryPreparation }, c, id);
                const inspectTarget = async (targetId: string, target: RepositoryTarget) => {
                    const fresh = repositoryTargetGuard(targetId, target);
                    const title = t('repository.navigation.targetTitle', { identity: identity(target) });
                    const actions = [option('identity', t('repository.navigation.identity')), option('policy', t('repository.navigation.policy')),
                        option('preview', t('repository.navigation.preview')), option('plans', t('repository.navigation.findPlans')),
                        ...!('provider' in target) ? [option('track', t('repository.navigation.track'))] : [], option('back', t('repository.navigation.back'))];
                    while (true) {
                        fresh();
                        const action = await pick(title, actions);
                        if (!action || action === 'back')
                            return;
                        fresh();
                        switch (action) {
                            case 'identity':
                                await show(t('repository.navigation.identityTitle'), repositoryTargetText(targetId, target));
                                break;
                            case 'policy':
                                await readPolicy(targetId, target);
                                break;
                            case 'preview':
                                await newPreview(targetId, target);
                                break;
                            case 'plans':
                                await plans(targetId, fresh);
                                break;
                            case 'track':
                                await trackResource(targetId, target);
                                break;
                            default:
                                throw Error('Unknown target action');
                        }
                    }
                };
                const targets = async () => {
                    let cursor: string | undefined, focused: string | undefined;
                    const stack: (string | undefined)[] = [];
                    while (true) {
                        guard();
                        const page = c.listRepositoryConfigurationTargets({ limit: 25, ...cursor ? { before: cursor } : {} });
                        const empty = !page.targets.length && !cursor && !stack.length && !page.nextCursor;
                        const picked = await pick(t(empty ? 'repository.navigation.emptyTargets' : 'repository.navigation.targets'), [
                            ...page.targets.map(target => ({ value: `target:${target.targetId}`, label: target.state === 'RETAINED'
                                ? identity(target.target) + ' · ' + target.targetId
                                : t('repository.navigation.unavailableTargetRow', { id: target.targetId }) })),
                            ...empty ? [option('register', t('repository.menu.register'))] : [],
                            ...page.nextCursor ? [option('older', t('repository.navigation.olderTargets'))] : [],
                            ...stack.length ? [option('newer', t('repository.navigation.newerTargets'))] : [], option('back', t('repository.navigation.back')),
                        ], focused);
                        if (!picked || picked === 'back')
                            return;
                        if (picked === 'register' && empty) {
                            await register();
                            continue;
                        }
                        if (picked === 'older' && page.nextCursor) {
                            stack.push(cursor);
                            cursor = page.nextCursor;
                            continue;
                        }
                        if (picked === 'newer' && stack.length) {
                            cursor = stack.pop();
                            continue;
                        }
                        const selected = page.targets.find(target => `target:${target.targetId}` === picked);
                        if (!selected)
                            throw Error('Repository target selection changed');
                        focused = picked;
                        if (selected.state === 'UNAVAILABLE') {
                            await show(t('repository.navigation.unavailableTarget'), selected);
                            continue;
                        }
                        await inspectTarget(selected.targetId, selected.target);
                    }
                };
                const register = async () => {
                    const providers = ['github', 'gitea', 'gitlab'] as const;
                    const provider = await pick<typeof providers[number]>(t('repository.registration.provider'), providers.map(value => ({ value, label: value })));
                    if (!provider)
                        return;
                    const base = provider === 'github' ? undefined : await input(t('repository.registration.apiBase'), provider === 'gitea' ? 'https://forge.example/api/v1' : 'https://gitlab.example/api/v4');
                    if (provider !== 'github' && base === undefined)
                        return;
                    const owner = await input(t(provider === 'gitlab' ? 'repository.registration.namespace' : 'repository.registration.owner'));
                    if (owner === undefined)
                        return;
                    const repository = await input(t('repository.registration.name'));
                    if (repository === undefined)
                        return;
                    if (provider === 'github')
                        validateGitHubConfigurationPath(owner, repository);
                    else {
                        repositoryApiBase(provider, base!);
                        validateRepositoryIdentityPath(provider, owner, repository);
                    }
                    const target = await chooseCredentialFile(file => track(withActivity(locale => uiText(locale, 'repository.activity.verifyIdentity'), async () => {
                        const token = await credential(file);
                        guard();
                        const args = { owner, repository, signal: abort.signal };
                        const result = provider === 'github'
                            ? await observeGitHubConfigurationTarget(openGitHubReadClient(token), args)
                            : await observeNativeConfigurationTarget({ ...token, provider, apiBase: base! }, args);
                        guard();
                        return result;
                    })), guard, correctConfigurationCredentialFile);
                    if (!target)
                        return;
                    guard();
                    const registered = c.registerRepositoryConfigurationTarget({ target });
                    completed = true;
                    notice(t('repository.registration.registered', { id: registered.targetId }));
                };
                const browseDeliveryHistory = async (workId: string) => {
                    followingDeliveryRecord = true;
                    const outcome = await browseIntegrations({
                        ...integrationPresentation, guard, choose, show, notice, reconcile: reconcileIntegration,
                    }, c, undefined, { workId });
                    return typeof outcome === 'string' ? outcome : outcome ? 'completed' : 'cancelled';
                };
                guard();
                if (history)
                    return browseDeliveryHistory(history.workId);
                if (delivery) {
                    const t = translator(locale), result = delivery.result;
                    const scope = t('result.receiverScope', {
                        work: delivery.workId, project: quoteIdentity(delivery.projectId), conversationProject: before.projectId ? quoteIdentity(before.projectId) : t('value.none'),
                    });
                    const guidance = t(result.reviewReady ? 'result.receiverGuidance' : 'result.receiverHeld');
                    while (true) {
                        const hasHistory = c.listIntegrations({ workId: delivery.workId, limit: 1 }).operations.length > 0;
                        const action = await chooseUiItem({ choose, ...integrationPresentation }, [t('result.receiverTitle'), scope, guidance].join('\n'), [
                            { value: 'back', label: t('result.back') },
                            ...(hasHistory ? [{ value: 'history', label: t('result.deliveryHistory') }] : []),
                            ...(result.reviewReady ? [{ value: 'receivers', label: t('result.receiverOpen') }] :
                                navigation.navigate ? [{ value: 'recover', label: t('result.recovery') }] : []),
                            { value: 'details', label: t('result.receiverDetails') },
                        ]);
                        guard();
                        if (action === 'receivers')
                            break;
                        if (action === 'recover')
                            return navigation.navigate!('/work ' + delivery.workId);
                        if (action === 'history')
                            return browseDeliveryHistory(delivery.workId);
                        if (action !== 'details')
                            return 'cancelled';
                        const candidate = result.candidate;
                        await show(t('result.receiverDetails'), [
                            scope, guidance,
                            t('result.receiverSource', { path: quoteIdentity(result.registeredSourceRoot) }),
                            candidate ? t('result.receiverCandidate', { version: candidate.versionId, path: quoteIdentity(candidate.path), hash: candidate.hash }) : t('result.receiverNoCandidate'),
                        ].join('\n\n'));
                    }
                }
                while (true) {
                    const action = initialAction ?? await pick(t('repository.menu.title'), repositoryActions.map(value => option(value, t(`repository.menu.${value}`))));
                    initialAction = undefined;
                    if (!action || action === 'close')
                        return completed ? 'completed' : 'cancelled';
                    let outcome: boolean | HostCommandOutcome = false;
                    switch (action) {
                        case 'targets':
                            await targets();
                            break;
                        case 'plans':
                            await plans();
                            break;
                        case 'contributions':
                            outcome = await browseContributions({ ...integrationPresentation, guard, choose, show, refresh: refreshResource, setParent: parentResource, preparePublication: prepareSummary, reviewPublication: retainedPublications }, c);
                            break;
                        case 'publications':
                            outcome = await retainedPublications(operationId);
                            break;
                        case 'merges':
                            outcome = await browseMerges({ ...navigation, ...integrationPresentation, guard, choose, input, show, reauthorize: reauthorizeMerge, reconcile: reconcileMerge, prepare: prepareRetainedMerge, dispatch: dispatchPreparedMerge }, c, operationId ?? originalMerge, !!operationId);
                            break;
                        case 'mergeTargets':
                            outcome = await browseMergeTargets({ ...navigation, ...integrationPresentation, guard, choose, input, show, register: registerMergeTarget, prepare: prepareFirstMerge }, c);
                            break;
                        case 'integrations':
                            outcome = await browseIntegrations({ ...navigation, ...integrationPresentation, guard, choose, input, show, notice, reauthorize: reauthorizeIntegration, reconcile: reconcileIntegration, dispatch: dispatchIntegration, prepare: prepareIntegration, ...host.model ? { preparationModel: { provider: host.model.provider, modelId: host.model.modelId } } : {} }, c, operationId, { pinned: !!operationId });
                            break;
                        case 'integrationTargets': {
                            const receiverHost = { ...navigation, ...integrationPresentation, guard, choose, input, show };
                            outcome = await browseIntegrationTargets({
                                ...receiverHost,
                                register: registerIntegrationTarget,
                                registerHosted: registerHostedTarget,
                                first: {
                                    ...receiverHost,
                                    operationRecovery,
                                    delegate: (workId, targetId) => browseIntegrationDelegation(receiverHost, c, targetId, workId, !!delivery),
                                    prepare: firstIntegration,
                                    openOriginal: openOriginalIntegration,
                                    ...host.model ? { preparationModel: { provider: host.model.provider, modelId: host.model.modelId } } : {},
                                },
                            }, c, delivery?.projectId ?? before.projectId, delivery ? { workId: delivery.workId, assertCurrent: resultCurrent } : undefined);
                            break;
                        }
                        case 'register':
                            await register();
                            break;
                        default: throw Error('Unknown repository management action');
                    }
                    // Navigation owns its result; only local browser mutations accumulate completion.
                    if (typeof outcome === 'string')
                        return outcome;
                    if (outcome)
                        completed = true;
                    if (delivery || operation)
                        return completed ? 'completed' : 'cancelled';
                }
            } }];
    return { commands: commands.map(command => ({ ...command, run: (...args: Parameters<HostCommand['run']>) => track(Promise.resolve(command.run(...args))) })), async close() {
            closing = true;
            abort.abort(Error('Repository UI closing; retain original outcomes'));
            while (owned.size)
                await Promise.allSettled([...owned]);
            if (cleanupFailures.size === 1)
                throw [...cleanupFailures][0];
            if (cleanupFailures.size > 1)
                throw new AggregateError([...cleanupFailures], 'Integration registration cleanup UNKNOWN: ' + [...cleanupFailures].map(error => error && typeof error === 'object' && 'recovery' in error ? String(error.recovery) : String(error)).join(' | '));
        } };
}
