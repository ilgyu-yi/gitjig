import { browseIntegrationDelegation } from './integration-delegation-browser.js';
import { captureResultDelivery } from './result-delivery.js';
import { browseIntegrationTargets } from './integration-target-browser.js';
import { browseMergeTargets } from './merge-target-browser.js';
import { browseMerges } from './merge-browser.js';
import { browseIntegrations } from './integration-browser.js';
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
import { parseRepositoryConfigurationProfile, type RepositoryTarget } from '../platform/configuration-session.js';
import { editRepositoryProfile } from './repository-profile.js';
import { repositoryAuditText, repositoryGuidanceText, repositoryPlanText, repositoryProfileText, repositoryTargetText } from './repository-presentation.js';
import type { RepositoryConfigurationAudit, RepositoryConfigurationView } from '../controller/configuration-types.js';
interface Host {
    execute?: HostCommandExecutor;
    model?: import('../pi/session.js').PiModelSelection;
    controller: Controller;
    isCurrent(target: string): boolean;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    notice(text: string): void;
}
const credentialLeases = new WeakSet<Controller>();
const identity = (target: RepositoryTarget) => ('provider' in target ? target.provider + ' · ' + target.apiBase : 'github · https://api.github.com') + ' · ' + target.owner + '/' + target.repository + ' · actor ' + target.actorUserId;
const display = (value: unknown, recovery = 'repo plan') => { const text = JSON.stringify(value, null, 2); return text.length > 32768 ? text.slice(0, 32768) + '\n[Shortened; use ' + recovery + ' for full detail]' : text; };
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
    const commands: HostCommand[] = [{ name: 'repo', description: 'Manage repository settings and retained issue/PR contributions', argumentHint: '[register|targets|integration-targets|deliver WORK_ID|merge-targets|merge OPERATION_ID]', run: async (argument, source, context) => {
                const initialEntries: Record<string, string> = { register: 'Register repository', targets: 'Registered targets', 'integration-targets': 'Integration targets', 'merge-targets': 'PR merge targets' };
                const originalMerge = /^merge\s+(\S+)$/u.exec(argument)?.[1];
                const resultWork = /^deliver\s+(\S+)$/u.exec(argument)?.[1];
                if (argument && !originalMerge && !resultWork && !Object.hasOwn(initialEntries, argument))
                    throw Error('Use /repo register, targets, integration-targets, deliver WORK_ID, merge-targets or merge OPERATION_ID');
                const delivery = resultWork ? captureResultDelivery(c, resultWork) : undefined;
                let deliveryOriginalId: string | undefined;
                const resultCurrent = () => {
                    if (deliveryOriginalId) delivery?.assertWorkCurrent();
                    else delivery?.assertCurrent();
                };
                let initialAction = delivery ? 'Integration targets' : originalMerge ? 'Retained PR merges' : argument ? initialEntries[argument] : undefined;
                const before = c.inspectConversation(source), choice = c.getConversationModelChoice(source), language = c.getConversationLanguage(source);
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
                const input = async (title: string, value = '') => { guard(); const result = await host.input(title, value); guard(); return result; };
                const show = async (title: string, value: unknown) => { guard(); await host.show(title, typeof value === 'string' ? value : display(value)); guard(); };
                const navigation = host.execute ? { navigate: async (command: string) => { guard(); return host.execute!(command, source, context); } } : {};
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
                    try {
                        return await readRepositoryCredential(file, c.listProjects().map(p => p.sourceRoot));
                    }
                    catch {
                        throw Error('Cannot read repository credential profile. Use a canonical private owner-only JSON file outside registered projects with only a token field. No credential was configured.');
                    }
                };
                const withCredential = async <T>(task: (signal: AbortSignal) => Promise<T>, fresh: () => void, route: 'configuration' | 'contribution' | 'publication' | 'merge' = 'configuration') => {
                    const file = await input('Private repository credential JSON file · canonical absolute path');
                    if (file === undefined)
                        return;
                    guard();
                    fresh();
                    if (credentialLeases.has(c))
                        throw Error('Another repository configuration action owns the credential session; wait for its original outcome');
                    credentialLeases.add(c);
                    return track((async () => {
                        let progressShown = false;
                        try {
                            const token = await credential(file);
                            guard();
                            fresh();
                            if (route === 'merge')
                                c.configureMergeCredential(token);
                            else if (route === 'contribution')
                                c.configureContributionReader(token);
                            else if (route === 'publication')
                                c.configurePublicationCredential(token);
                            else
                                c.configureRepositoryConfigurationCredential(token);
                            guard();
                            notice('Repository request in progress · original target and work retained');
                            progressShown = true;
                            fresh();
                            return await task(abort.signal);
                        }
                        finally {
                            credentialLeases.delete(c);
                            if (progressShown) notice('');
                        }
                    })());
                };
                const prepareFirstMerge = (context: ReturnType<Controller['inspectOwnerMergePreparation']>, fresh: () => void) => withCredential(async (signal) => { fresh(); const result = await c.prepareOwnerMerge(context.workId, context.targetId, context.branchOperationId, signal, guard); retainedMerge = result.operationId; guard(); return result; }, fresh, 'merge');
                const reconcileMerge = (context: ReturnType<Controller['inspectMergeReconciliation']>, fresh: () => void) => withCredential(async (signal) => {
                    fresh();
                    retainedMerge = context.operationId;
                    try {
                        return await c.reconcileOwnerMerge({ operationId: context.operationId, expectedContext: context.fingerprint, signal }, guard);
                    }
                    catch (error) {
                        throw Error('Original PR merge ' + context.operationId + ' · work ' + context.workId + ' · target ' + context.targetId + ' read unavailable: ' + (error instanceof Error ? error.message : 'Native read unavailable'), { cause: error });
                    }
                }, fresh, 'merge');
                const prepareRetainedMerge = (context: ReturnType<Controller['inspectRetainedMergePreparation']>, fresh: () => void) => withCredential(async (signal) => {
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
                    if (credentialLeases.has(c))
                        throw Error('Another repository action owns the credential session; wait for its original outcome');
                    credentialLeases.add(c);
                    return track((async () => {
                        try {
                            fresh();
                            retainedMerge = context.operationId;
                            try {
                                return await c.dispatchOwnerMerge({ operationId: context.operationId, expectedContext: context.fingerprint, signal: abort.signal }, guard);
                            }
                            catch (error) {
                                throw Error('Original PR merge ' + context.operationId + ' · work ' + context.workId + ' · target ' + context.targetId + ' send unavailable: ' + (error instanceof Error ? error.message : 'Native merge unavailable'), { cause: error });
                            }
                        }
                        finally {
                            credentialLeases.delete(c);
                        }
                    })());
                };
                const registerMergeTarget = (request: import('../controller/merge-types.js').RegisterMergeTarget, fresh: () => void) => withCredential(async (signal) => { fresh(); const result = await c.registerMergeTarget(request, signal, fresh); retainedMergeTarget = result.targetId; guard(); return result; }, fresh, 'merge');
                const registerIntegrationTarget = async (request: import('../controller/effect-types.js').RegisterLocalTarget, fresh: () => void) => {
                    let gitProfile = c.options.effectsProfile ? structuredClone(c.options.effectsProfile) : undefined;
                    if (!gitProfile) {
                        const gitBinary = await input('Trusted Git executable for target registration · canonical absolute path');
                        if (gitBinary === undefined)
                            return;
                        gitProfile = { gitBinary };
                    }
                    fresh();
                    return track((async () => { const result = await c.registerLocalTarget(request, { gitProfile, signal: abort.signal, validate: fresh }); retainedIntegrationTarget = result.targetId; guard(); return result; })());
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
                    if (credentialLeases.has(c))
                        throw Error('Another repository action owns the credential session; wait for its original outcome');
                    credentialLeases.add(c);
                    return track((async () => {
                        try {
                            const token = await credential(file);
                            fresh();
                            c.configureHostedIntegrationCredential(token);
                            fresh();
                            notice('Observing GitHub receiver · no work, grant or send');
                            const result = await c.registerHostedIntegrationTarget(request, { gitProfile, signal: abort.signal, validate: fresh });
                            retainedIntegrationTarget = result.targetId;
                            guard();
                            return result;
                        }
                        finally {
                            credentialLeases.delete(c);
                        }
                    })());
                };
                const integrationAction = async (operationId: string, context: {
                    gitProfile: import('../controller/effect-types.js').EffectsProfile | null;
                    family: string;
                }, fresh: () => void, perform: (gitProfile: import('../controller/effect-types.js').EffectsProfile) => Promise<unknown>, label: string, firstWorkId?: string) => {
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
                    if (credentialLeases.has(c))
                        throw Error('Another repository action owns the credential session; wait for its original outcome');
                    credentialLeases.add(c);
                    return track((async () => {
                        try {
                            if (file !== undefined) {
                                const token = await credential(file);
                                fresh();
                                c.configureHostedIntegrationCredential(token);
                            }
                            fresh();
                            if (!firstWorkId)
                                retainedIntegration = operationId;
                            notice('Integration ' + label + ' in progress · original work and allowance retained');
                            try {
                                const result = await perform(gitProfile!);
                                if (firstWorkId && result && typeof result === 'object' && 'operationId' in result && typeof result.operationId === 'string')
                                    retainedIntegration = result.operationId;
                                return result;
                            }
                            catch (error) {
                                throw Error((firstWorkId ? 'First integration for work ' + firstWorkId : 'Original integration ' + operationId) + ' ' + label + ' unavailable: ' + (error instanceof Error ? error.message : 'Native request unavailable'), { cause: error });
                            }
                        }
                        finally {
                            credentialLeases.delete(c);
                        }
                    })());
                };
                const reconcileIntegration = (operationId: string, context: ReturnType<Controller['inspectIntegrationReconciliation']>, fresh: () => void) => integrationAction(operationId, context, fresh, gitProfile => c.reconcileRetainedIntegration({ operationId, expectedContext: context.fingerprint, gitProfile, signal: abort.signal }, fresh), 'read');
                const prepareIntegration = (operationId: string, context: ReturnType<Controller['inspectIntegrationPreparation']>, fresh: () => void) => integrationAction(operationId, context.context, fresh, gitProfile => { const operation = c.retainedWorkModelOperation(context.reviewed.work.id, host.model); return c.prepareRetainedIntegration({ ...operation, operationId, targetId: context.reviewed.targetId, expectedContext: context.contextFingerprint, gitProfile, signal: abort.signal }, guard); }, 'preparation');
                const firstIntegration = (workId: string, targetId: string, context: ReturnType<Controller['inspectFirstIntegrationPreparation']>, fresh: () => void) => integrationAction(workId, { gitProfile: context.gitProfile, family: context.delegation.target.state === 'RETAINED' ? context.delegation.target.family : 'unavailable' }, fresh, gitProfile => {
                    const operation = c.retainedWorkModelOperation(workId, host.model);
                    return c.prepareFirstIntegration({ ...operation, targetId, expectedContext: context.contextFingerprint, gitProfile, signal: abort.signal }, guard, id => {
                        // The original allocation has rechecked the exact result and current evidence.
                        // Its own authority/derived-candidate lifecycle now owns further result changes.
                        retainedIntegration = id;
                        if (delivery) {
                            delivery.assertWorkCurrent();
                            deliveryOriginalId = id;
                        }
                    });
                }, 'first preparation', workId);
                const reauthorizeMerge = (context: ReturnType<Controller['inspectMergeReauthorization']>, reason: string, fresh: () => void) => { retainedMerge = context.operationId; return track(c.reauthorizeOwnerMerge({ operationId: context.operationId, expectedContext: context.fingerprint, reason, signal: abort.signal }, fresh).catch(error => { throw Error('Original PR merge ' + context.operationId + ' · work ' + context.workId + ' · target ' + context.targetId + ' reauthorization unavailable: ' + (error instanceof Error ? error.message : 'Current procedure unavailable'), { cause: error }); })); };
                const reauthorizeIntegration = (operationId: string, context: ReturnType<Controller['inspectIntegrationReauthorization']>, reason: string, fresh: () => void) => { retainedIntegration = operationId; return track(c.reauthorizeOwnerIntegration({ operationId, expectedContext: context.fingerprint, reason, signal: abort.signal }, fresh)); };
                const openOriginalIntegration = (id: string, targetId: string) => {
                    guard();
                    if (delivery) {
                        const original = c.inspectRetainedIntegration(id), snapshot = JSON.stringify(original);
                        if (!original.view || original.entry.workId !== delivery.workId || original.entry.targetId !== targetId)
                            throw Error('Original integration does not match this result and receiver');
                        guard();
                        if (JSON.stringify(c.inspectRetainedIntegration(id)) !== snapshot)
                            throw Error('Selected original integration changed; reopen its review');
                        retainedIntegration = id;
                        delivery.assertWorkCurrent();
                        deliveryOriginalId = id;
                    }
                    return browseIntegrations({ ...navigation, guard, choose, input, show, reauthorize: reauthorizeIntegration, reconcile: reconcileIntegration, dispatch: dispatchIntegration, prepare: prepareIntegration, ...host.model ? { preparationModel: { provider: host.model.provider, modelId: host.model.modelId } } : {} }, c, id, !!delivery);
                };
                const dispatchIntegration = (operationId: string, context: ReturnType<Controller['inspectIntegrationDispatch']>, fresh: () => void) => integrationAction(operationId, context.context, fresh, gitProfile => c.dispatchRetainedIntegration({ operationId, expectedContext: context.contextFingerprint, gitProfile, signal: abort.signal }, guard), 'send');
                const inspectPlan = async (id: string) => {
                    while (true) {
                        guard();
                        const plan = c.inspectRepositoryConfiguration(id);
                        if (!plan.plan) {
                            await show('Retained configuration · preview unavailable', repositoryPlanText(plan));
                            return;
                        }
                        const captured = JSON.stringify(plan), fresh = () => {
                            guard();
                            if (JSON.stringify(c.inspectRepositoryConfiguration(id)) !== captured)
                                throw Error('Original configuration plan changed while the action was open; inspect its current revision with /repo');
                        };
                        let selected = await choose(`Repository plan · ${plan.plan.target.owner}/${plan.plan.target.repository} · ${plan.phase} · revision ${plan.revision}`, ['Inspect original plan and observations', 'Review changes for application', 'Reconcile original request (read only)', 'Audit selected settings (read only)', 'Back']);
                        fresh();
                        if (!selected || selected === 'Back')
                            return;
                        if (selected === 'Inspect original plan and observations') {
                            await show('Original configuration · no dispatch', repositoryPlanText(plan));
                            continue;
                        }
                        if (selected === 'Review changes for application') {
                            await show('Review configuration changes · no write yet', repositoryPlanText(plan, true));
                            fresh();
                            const applyLabel = `Apply original ${plan.plan.target.owner}/${plan.plan.target.repository} · revision ${plan.revision}`;
                            const decision = await choose('Explicit owner action · original plan ' + id, ['Back without applying', applyLabel]);
                            fresh();
                            if (!decision || decision === 'Back without applying')
                                continue;
                            if (decision !== applyLabel)
                                throw Error('Unknown original-plan action');
                            selected = 'Apply selected original plan';
                        }
                        if (!['Apply selected original plan', 'Reconcile original request (read only)', 'Audit selected settings (read only)'].includes(selected))
                            throw Error('Unknown repository plan action');
                        const result = await withCredential<RepositoryConfigurationView | RepositoryConfigurationAudit>(signal => selected === 'Apply selected original plan' ? c.applyRepositoryConfiguration({ planId: id, signal }) : selected === 'Reconcile original request (read only)' ? c.reconcileRepositoryConfiguration({ planId: id, signal }) : c.auditRepositoryConfiguration({ planId: id, signal }), fresh);
                        if (result === undefined)
                            return;
                        completed = true;
                        retained = { planId: id, workId: plan.workId };
                        if (closing || !host.isCurrent(source))
                            return;
                        notice('Repository outcome retained · plan ' + id + ' · work ' + plan.workId);
                        await show('Repository outcome · inspect actual scope and next action', 'view' in result ? repositoryAuditText(result) : repositoryPlanText(result));
                    }
                };
                const plans = async (targetId?: string) => {
                    let cursor: string | undefined;
                    const stack: (string | undefined)[] = [];
                    while (true) {
                        guard();
                        const page = c.listRepositoryConfigurationPlans({ limit: 25, ...targetId ? { targetId } : {}, ...cursor ? { before: cursor } : {} }), labels = page.plans.map(p => p.state === 'RETAINED' ? `${p.target.owner}/${p.target.repository} · ${p.recordedPhase} · revision ${p.revision} · ${p.planId}` : `Unavailable original plan · ${p.planId}`), picked = await choose('Retained repository plans · opening does not recover or dispatch', [...labels, ...page.nextCursor ? ['Older plans'] : [], ...stack.length ? ['Newer plans'] : [], 'Back']);
                        if (!picked || picked === 'Back')
                            return;
                        if (picked === 'Older plans' && page.nextCursor) {
                            stack.push(cursor);
                            cursor = page.nextCursor;
                            continue;
                        }
                        if (picked === 'Newer plans' && stack.length) {
                            cursor = stack.pop();
                            continue;
                        }
                        const selected = page.plans[labels.indexOf(picked)];
                        if (!selected)
                            throw Error('Plan selection changed');
                        if (selected.state === 'UNAVAILABLE') {
                            await show('Unavailable retained plan', selected);
                            continue;
                        }
                        await inspectPlan(selected.planId);
                    }
                };
                const newPreview = async (targetId: string, target: RepositoryTarget) => {
                    const provider = 'provider' in target ? target.provider : 'github', mode = await choose('New configuration preview · ' + identity(target), ['Edit recommendation fields', 'Import private profile file', 'Cancel']);
                    if (!mode || mode === 'Cancel')
                        return;
                    let profile;
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
                        profile = await editRepositoryProfile({ choose, input, guard, show }, provider, branch, operation);
                        if (profile === undefined)
                            return;
                    }
                    else if (mode === 'Import private profile file') {
                        const file = await input('Private desired profile JSON file · canonical absolute path');
                        if (file === undefined)
                            return;
                        try {
                            profile = parseRepositoryConfigurationProfile(await readOwnerJson(file, c.listProjects().map(p => p.sourceRoot), 'Repository configuration profile', 32768));
                        }
                        catch {
                            throw Error('Cannot read desired profile. Use a valid private same-provider configuration file outside registered projects.');
                        }
                        guard();
                    }
                    else
                        throw Error('Unknown repository profile entry');
                    const desired = structuredClone(profile);
                    if (('provider' in desired ? desired.provider : 'github') !== provider)
                        throw Error('Desired profile provider differs from the selected repository target');
                    await show('Staged profile · no work or requests yet', repositoryProfileText(desired));
                    const result = await withCredential(signal => c.previewRepositoryConfiguration({ targetId, profile: desired, signal }), guard);
                    if (!result)
                        return;
                    completed = true;
                    retained = { planId: result.planId, workId: result.workId };
                    notice('Preview retained · plan ' + result.planId + ' · work ' + result.workId + ' · ' + result.phase);
                    if (!closing && host.isCurrent(source))
                        await show('Retained preview · apply is a separate explicit action', repositoryPlanText(result));
                };
                const readPolicy = async (targetId: string, target: RepositoryTarget) => {
                    const expected = JSON.stringify(target), fresh = () => {
                        guard();
                        const current = c.inspectRepositoryConfigurationTarget(targetId);
                        if (current.state !== 'RETAINED' || JSON.stringify(current.target) !== expected)
                            throw Error('Selected repository target changed; reopen registered targets before reading policy');
                    };
                    fresh();
                    const branch = await input('Existing branch · current visible policy observations', 'main');
                    if (branch === undefined)
                        return;
                    fresh();
                    let result;
                    try {
                        result = await withCredential(signal => { fresh(); return c.guideRepositoryConfiguration({ targetId, branch, signal }); }, fresh);
                        fresh();
                    }
                    catch (error) {
                        throw Error('Policy read for target ' + targetId + ' · branch ' + branch + ' failed: ' + (error instanceof Error ? error.message : 'Read unavailable'));
                    }
                    if (result === undefined)
                        return;
                    fresh();
                    completed = true;
                    await show('Current branch policy observations · not complete policy or permission', repositoryGuidanceText(result, target));
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
                    const result = await withCredential(signal => c.trackRepositoryResource(request, signal), fresh, 'contribution');
                    if (!result)
                        return;
                    retainedResource = result.resourceId;
                    completed = true;
                    guard();
                    await show('GitHub resource tracked · original identity retained', display(result, 'repo contributions --resource ' + result.resourceId));
                };
                const refreshResource = async (resourceId: string, fresh: () => void) => {
                    const result = await withCredential(signal => { retainedResource = resourceId; return c.refreshContributions({ resourceIds: [resourceId], signal }); }, fresh, 'contribution');
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
                    const result = await withCredential(async (signal) => {
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
                    const result = await withCredential(async (signal) => {
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
                    const result = await withCredential(async (signal) => {
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
                    const result = await withCredential(async (signal) => {
                        retainedPublication = operationId;
                        try {
                            return await c.reconcilePublication({ operationId, signal });
                        }
                        catch (error) {
                            throw Error('Reconciliation for original publication ' + operationId + ' unavailable: ' + (error instanceof Error ? error.message : 'Native read unavailable'), { cause: error });
                        }
                    }, fresh, 'publication');
                    if (result !== undefined) {
                        completed = true;
                        guard();
                    }
                    return result;
                };
                const dispatchPublication = async (operationId: string, fresh: () => void) => {
                    const result = await withCredential(async (signal) => {
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
                const targets = async () => {
                    let cursor: string | undefined;
                    const stack: (string | undefined)[] = [];
                    while (true) {
                        guard();
                        const page = c.listRepositoryConfigurationTargets({ limit: 25, ...cursor ? { before: cursor } : {} }), labels = page.targets.map(t => t.state === 'RETAINED' ? identity(t.target) + ' · ' + t.targetId : 'Unavailable target · ' + t.targetId);
                        const empty = !page.targets.length && !cursor && !stack.length && !page.nextCursor;
                        const picked = await choose(empty ? 'Registered repository targets · none registered' : 'Registered repository targets · independent of conversation project', [...labels, ...empty ? ['Register repository'] : [], ...page.nextCursor ? ['Older targets'] : [], ...stack.length ? ['Newer targets'] : [], 'Back']);
                        if (!picked || picked === 'Back')
                            return;
                        if (picked === 'Register repository' && empty) {
                            await register();
                            continue;
                        }
                        if (picked === 'Older targets' && page.nextCursor) {
                            stack.push(cursor);
                            cursor = page.nextCursor;
                            continue;
                        }
                        if (picked === 'Newer targets' && stack.length) {
                            cursor = stack.pop();
                            continue;
                        }
                        const selected = page.targets[labels.indexOf(picked)];
                        if (!selected)
                            throw Error('Repository target selection changed');
                        if (selected.state === 'UNAVAILABLE') {
                            await show('Unavailable target', selected);
                            continue;
                        }
                        const action = await choose(identity(selected.target) + ' · retained identity only', ['Inspect target identity', 'Inspect current branch policy', 'New configuration preview', 'Find plans for this target', ...!('provider' in selected.target) ? ['Track existing issue or pull request'] : [], 'Back']);
                        if (action === 'Inspect target identity')
                            await show('Registered identity · no current permission claim', repositoryTargetText(selected.targetId, selected.target));
                        else if (action === 'Inspect current branch policy')
                            await readPolicy(selected.targetId, selected.target);
                        else if (action === 'New configuration preview')
                            await newPreview(selected.targetId, selected.target);
                        else if (action === 'Find plans for this target')
                            await plans(selected.targetId);
                        else if (action === 'Track existing issue or pull request')
                            await trackResource(selected.targetId, selected.target);
                        else if (action && action !== 'Back')
                            throw Error('Unknown target action');
                    }
                };
                const register = async () => {
                    const provider = await choose('Repository provider · identity registration only', ['github', 'gitea', 'gitlab']);
                    if (!provider)
                        return;
                    if (!['github', 'gitea', 'gitlab'].includes(provider))
                        throw Error('Unknown repository provider');
                    const base = provider === 'github' ? undefined : await input('Canonical trusted HTTPS API base · token is sent here', provider === 'gitea' ? 'https://forge.example/api/v1' : 'https://gitlab.example/api/v4');
                    if (provider !== 'github' && base === undefined)
                        return;
                    const owner = await input(provider === 'gitlab' ? 'Repository namespace · group/subgroup' : 'Repository owner');
                    if (owner === undefined)
                        return;
                    const repository = await input('Repository name');
                    if (repository === undefined)
                        return;
                    if (provider === 'github')
                        validateGitHubConfigurationPath(owner, repository);
                    else {
                        repositoryApiBase(provider as 'gitea' | 'gitlab', base!);
                        validateRepositoryIdentityPath(provider as 'gitea' | 'gitlab', owner, repository);
                    }
                    const file = await input('Private repository credential JSON file · canonical absolute path');
                    if (file === undefined)
                        return;
                    const target = await track((async () => { const token = await credential(file); guard(); notice('Observing repository identity · no policy or write request'); const args = { owner, repository, signal: abort.signal }, result = provider === 'github' ? await observeGitHubConfigurationTarget(openGitHubReadClient(token), args) : await observeNativeConfigurationTarget({ ...token, provider: provider as 'gitea' | 'gitlab', apiBase: base! }, args); guard(); return result; })());
                    guard();
                    const registered = c.registerRepositoryConfigurationTarget({ target });
                    completed = true;
                    notice('Repository identity registered · ' + registered.targetId + ' · no write authority granted');
                };
                guard();
                if (delivery) {
                    await show('Review original result delivery scope', { workId: delivery.workId, projectId: delivery.projectId,
                        conversationProject: before.projectId, candidate: delivery.result.candidate,
                        scope: 'Recorded review-ready status is not delivery or current native eligibility. This opens branch receiver/delegation/preparation controls for this original result only. It does not apply files to the source folder, publish an issue/PR or merge a PR. Each existing action has its own authority and confirmation. The current conversation project is unchanged.' });
                    if (!delivery.result.reviewReady) {
                        const action = await choose('Original result is not review-ready', ['Back without action', ...host.execute ? ['Inspect original work and recovery'] : []]);
                        if (action === 'Inspect original work and recovery') return navigation.navigate!('/work ' + delivery.workId);
                        return 'cancelled';
                    }
                    const action = await choose('Choose the next branch-delivery step', ['Back without action', 'Review receivers for this original result']);
                    if (action !== 'Review receivers for this original result') return 'cancelled';
                }
                while (true) {
                    const action = initialAction ?? await choose('Repository management · owner actions, not agent approval', ['Registered targets', 'Retained configuration plans', 'Tracked issues and pull requests', 'Retained publications', 'Retained PR merges', 'PR merge targets', 'Retained integrations', 'Integration targets', 'Register repository', 'Close']);
                    initialAction = undefined;
                    if (!action || action === 'Close')
                        return completed ? 'completed' : 'cancelled';
                    let outcome: boolean | HostCommandOutcome = false;
                    switch (action) {
                        case 'Registered targets':
                            await targets();
                            break;
                        case 'Retained configuration plans':
                            await plans();
                            break;
                        case 'Tracked issues and pull requests':
                            outcome = await browseContributions({ guard, choose, show, refresh: refreshResource, setParent: parentResource, preparePublication: prepareSummary }, c);
                            break;
                        case 'Retained publications':
                            outcome = await browsePublications({ ...navigation, guard, choose, show, reconcile: reconcilePublication, dispatch: dispatchPublication, resumePreparation: resumeSummaryPreparation }, c);
                            break;
                        case 'Retained PR merges':
                            outcome = await browseMerges({ ...navigation, guard, choose, input, show, reauthorize: reauthorizeMerge, reconcile: reconcileMerge, prepare: prepareRetainedMerge, dispatch: dispatchPreparedMerge }, c, originalMerge);
                            break;
                        case 'PR merge targets':
                            outcome = await browseMergeTargets({ ...navigation, guard, choose, input, show, register: registerMergeTarget, prepare: prepareFirstMerge }, c);
                            break;
                        case 'Retained integrations':
                            outcome = await browseIntegrations({ ...navigation, guard, choose, input, show, reauthorize: reauthorizeIntegration, reconcile: reconcileIntegration, dispatch: dispatchIntegration, prepare: prepareIntegration, ...host.model ? { preparationModel: { provider: host.model.provider, modelId: host.model.modelId } } : {} }, c);
                            break;
                        case 'Integration targets':
                            outcome = await browseIntegrationTargets({ ...navigation, guard, choose, input, show, register: registerIntegrationTarget, registerHosted: registerHostedTarget, first: { ...navigation, guard, choose, show, delegate: (workId, targetId) => browseIntegrationDelegation({ ...navigation, guard, choose, input, show }, c, targetId, workId, !!delivery), prepare: firstIntegration, openOriginal: openOriginalIntegration, ...host.model ? { preparationModel: { provider: host.model.provider, modelId: host.model.modelId } } : {} } }, c, delivery?.projectId ?? before.projectId, delivery ? { workId: delivery.workId, assertCurrent: resultCurrent } : undefined);
                            break;
                        case 'Register repository':
                            await register();
                            break;
                        default: throw Error('Unknown repository management action');
                    }
                    // Navigation owns its result; only local browser mutations accumulate completion.
                    if (typeof outcome === 'string')
                        return outcome;
                    if (outcome)
                        completed = true;
                    if (delivery)
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
