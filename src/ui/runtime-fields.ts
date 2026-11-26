import { isDeepStrictEqual } from 'node:util';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';
import type { RuntimeProfile } from '../controller/types.js';
import type { ApplicationStartup, StartupConfiguration } from '../app/startup.js';
import { runtimePrerequisites, runtimeImageBuildHelp } from './runtime-setup-help.js';
import { quoteIdentity } from './inspection-text.js';
import { plainTerminalText } from './chrome.js';
import { showExactReview, showReviewAction, type ReviewPrimaryAction } from './exact-review.js';
import type { HostCommandContext } from './host-commands.js';
import { startupSaveNotice } from './startup-guidance.js';
interface Host extends UiChoiceHost {
    locale?: UiLocale;
    fieldsOnly?: boolean;
    focus?: HostCommandContext['runtimeSetupFocus'];
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    show?(title: string, text: string, primary?: ReviewPrimaryAction): Promise<void>;
    runPreparation?<T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>,
        presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T>;
    guard(): void;
    notice(text: string, wrap?: boolean): void;
}
type PreparedRuntimeEdit = Awaited<ReturnType<ApplicationStartup['prepareRuntimeEdit']>>;
type RuntimeFieldEdit = Omit<PreparedRuntimeEdit, 'save'> & {
    activeRuntime?: RuntimeProfile | undefined;
    savedRuntime?: RuntimeProfile | undefined;
    draftSource?: 'current' | 'saved' | undefined;
} & (
    | { stageForReview?: never; save: PreparedRuntimeEdit['save'] }
    | { stageForReview: true; save(runtime: RuntimeProfile, guard?: () => unknown, reviewed?: StartupConfiguration): Promise<void> }
);
type CheckedRoute = Awaited<ReturnType<RuntimeFieldEdit['checkRuntimeInputs']>>;
type BuildRoute = Awaited<ReturnType<RuntimeFieldEdit['runtimeRouteInputs']>>;
type RuntimeCheck =
    | { kind: 'passed'; route: CheckedRoute; verify: () => Promise<void> }
    | { kind: 'stale'; route: CheckedRoute }
    | { kind: 'prerequisite'; reason: string }
    | { kind: 'failed' | 'context' | 'image' | 'cancelled'; route: CheckedRoute; reason: string };
const checkDiagnostic = (error: unknown) => plainTerminalText(error instanceof Error ? error.message : String(error)).slice(0, 4096);
/** Preparation is explicit; the original startup validator/storage owns Save. */
export async function editRuntimeFields(host: Host, edit: RuntimeFieldEdit) {
    const locale = host.locale ?? 'en';
    const t = translator(locale);
    const stageForReview = edit.stageForReview === true;
    const appliesRuntime = !stageForReview && edit.appliesRuntime !== false;
    const saveAction = stageForReview ? 'Keep runtime changes for combined review' : appliesRuntime ? 'Save and apply runtime' : 'Save runtime for next launch';
    const draftSource = edit.draftSource && t(edit.draftSource === 'current' ? 'runtime.currentDraft' : 'runtime.savedDraft');
    const replacesSaved = edit.draftSource === 'current' && edit.savedRuntime;
    const actionCopy = {
        'Interactive runtime installer': 'runtime.install',
        'Suggest local Docker paths': 'runtime.suggest',
        'Edit runtime fields': 'runtime.edit',
        'Choose Docker context': 'runtime.context',
        'Choose existing runtime image': 'runtime.image',
        'Prepare an execution image': 'runtime.build',
        'Extra image packages': 'runtime.packages',
        'Check runtime connection and image': 'runtime.check',
        'Inspect last runtime check': 'runtime.inspectCheck',
        'Check connection and image first': 'runtime.checkBeforeSave',
        'Review and save runtime': stageForReview ? 'runtime.reviewStage' : 'runtime.review',
        'Runtime setup help': 'runtime.help',
        'Inspect current runtime': 'runtime.inspectActive',
        'Inspect saved runtime': 'runtime.inspectSaved',
        'Cancel': 'runtime.cancel',
        'Use these paths': 'runtime.usePaths',
        'Back without changes': 'runtime.backChanges',
        'Back without building': 'runtime.backBuild',
        'Build execution image': 'runtime.buildConfirm',
        'Back': 'runtime.back',
        'Check connection and image': 'runtime.checkConfirm',
        'Discover with this route': 'runtime.discoverConfirm',
        'Save and apply runtime': 'runtime.save',
        'Save runtime for next launch': 'runtime.saveNextLaunch',
        'Keep runtime changes for combined review': 'runtime.keepStage',
        'Back without saving': 'runtime.backSave',
        'Back to runtime setup': 'runtime.backSetup',
    } as const;
    const chooseActions = async (title: string, values: string[]) => {
        // Legacy action values remain exact; only authored labels are localized.
        const items = values.map(value => ({
            value,
            label: Object.hasOwn(actionCopy, value) ? t(actionCopy[value as keyof typeof actionCopy]) : value,
        }));
        return chooseUiItem(host, title, items);
    };
    const guard = () => {
        host.guard();
        edit.assertCurrent();
    };
    const show = async (title: string, value: unknown) => {
        guard();
        const text = JSON.stringify(value, null, 2);
        if (host.show)
            await host.show(title, text);
        else
            await host.choose(title, [text, 'Back']);
        guard();
    };
    const reviewAction = (title: string, value: unknown) => {
        guard();
        if (!host.show)
            throw Error(t('runtime.actionReviewUnavailable'));
        return showExactReview({ show: host.show.bind(host) }, title, value, guard, t('review.only'), locale);
    };
    const explain = async (title: string, text: string) => {
        guard();
        if (host.show)
            await host.show(title, text);
        else
            await host.choose(title, [text, 'Back']);
        guard();
    };
    const fields = [
        ['dockerBinary', t('runtime.dockerField'), t('runtime.dockerExecutableName')],
        ['dockerContext', t('runtime.contextField'), undefined],
        ['image', t('runtime.imageField'), undefined],
        ['dockerConfigDirectory', t('runtime.configField'), t('runtime.dockerConfigurationName')],
    ] as const;
    const descriptions: Record<typeof fields[number][0], string> = {
        dockerBinary: t('runtime.describeDockerBinary'),
        dockerContext: t('runtime.describeDockerContext'),
        image: t('runtime.describeImage'),
        dockerConfigDirectory: t('runtime.describeDockerConfig'),
    };
    let staged = Object.fromEntries(fields.map(([key]) => [key, edit.runtime?.[key] ?? ''])) as Record<typeof fields[number][0], string>;
    let lastCheck: RuntimeCheck | undefined;
    const forgetCheckForDifferentRoute = (route: Partial<CheckedRoute> | undefined) => {
        const checked = lastCheck;
        if (checked && 'route' in checked && fields.some(([key]) => checked.route[key] !== route?.[key]))
            lastCheck = undefined;
    };
    const checkStatus = (outcome?: RuntimeCheck) => t(outcome ? ({
        passed: 'runtime.checkFound', prerequisite: 'runtime.checkNotStartedStatus',
        stale: 'runtime.checkStale', failed: 'runtime.checkFailed', context: 'runtime.checkContextFailed',
        image: 'runtime.checkImageFailed', cancelled: 'runtime.checkCancelled',
    } as const)[outcome.kind] : 'runtime.noCheckResult');
    const refreshCheck = async () => {
        const checked = lastCheck;
        if (checked?.kind !== 'passed') return true;
        try {
            await checked.verify();
            return true;
        } catch {
            guard();
            lastCheck = { kind: 'stale', route: checked.route };
            return false;
        }
    };
    const stage = (next: typeof staged) => {
        if (fields.some(([key]) => next[key] !== staged[key])) {
            staged = next;
            lastCheck = undefined;
        }
    };
    let extraPackages = '';
    let nextAction = host.focus === 'context' ? 'Choose Docker context' : host.focus === 'image' ? 'Choose existing runtime image' : undefined;
    let suggested = false, pendingAction: string | undefined;
    let cancelledDiscovery = false;
    let pendingBuildRoute: BuildRoute | undefined;
    const openRecovery = async (title: string, detail: string) => {
        guard();
        const label = t('runtime.openRecovery');
        const opened = host.show ? await showReviewAction({ show: host.show.bind(host) }, title, detail, label) :
            await host.choose(title, [detail, t('runtime.backSetup'), label]) === label;
        guard();
        return opened;
    };
    const recover = async (title: string, error: unknown, alternatives: string[], note = t('runtime.install.recoveryNote'), buildRoute?: BuildRoute) => {
        guard();
        const detail = `${error instanceof Error ? error.message : String(error)}\n\n${note}`;
        if ((error as {
            code?: string;
        })?.code === 'RUNTIME_PREPARATION_CANCELLED') {
            await explain(title, detail);
            return;
        }
        if (!await openRecovery(title, detail))
            return;
        const hasRoute = !!staged.dockerBinary && !!staged.dockerConfigDirectory && !!staged.dockerContext;
        const candidates = [...(!host.fieldsOnly && (!staged.dockerBinary || !staged.dockerConfigDirectory) ? ['Suggest local Docker paths'] : []), ...alternatives]
            .filter((action, index, all) => all.indexOf(action) === index)
            .filter(action => action !== 'Prepare an execution image' || hasRoute || buildRoute)
            .filter(action => action !== 'Check runtime connection and image' || hasRoute && !!staged.image);
        const selected = await chooseActions(t('runtime.recovery'), ['Back to runtime setup', ...candidates]);
        guard();
        if (selected && selected !== 'Back to runtime setup') {
            if (!candidates.includes(selected))
                throw Error('Unknown runtime recovery action');
            if (selected === 'Prepare an execution image')
                pendingBuildRoute = buildRoute;
            pendingAction = selected;
        }
    };
    while (true) {
        guard();
        const canCheck = !host.fieldsOnly && !!host.runPreparation && fields.every(([key]) => staged[key].trim());
        const outcome = lastCheck;
        const problem = outcome && 'reason' in outcome ? outcome : undefined;
        const prepareCompleteRoute = canCheck && outcome?.kind !== 'passed' ? 'Check runtime connection and image' : 'Review and save runtime';
        let recommended = nextAction ?? (staged.dockerBinary && staged.dockerContext && staged.image ? prepareCompleteRoute :
            !staged.dockerBinary || !staged.dockerConfigDirectory ? suggested ? 'Edit runtime fields' : 'Suggest local Docker paths' :
                !staged.dockerContext ? 'Choose Docker context' : host.runPreparation ? 'Prepare an execution image' : 'Choose existing runtime image');
        const actions = [...host.fieldsOnly ? ['Edit runtime fields', 'Review and save runtime', 'Runtime setup help'] :
            ['Interactive runtime installer', 'Suggest local Docker paths', 'Edit runtime fields', 'Choose Docker context', 'Choose existing runtime image', 'Prepare an execution image', 'Extra image packages', 'Check runtime connection and image', 'Review and save runtime', 'Runtime setup help'],
            ...edit.activeRuntime ? ['Inspect current runtime'] : [],
            ...edit.savedRuntime ? ['Inspect saved runtime'] : [],
            ...problem ? ['Inspect last runtime check'] : [], 'Cancel'];
        if (!actions.includes(recommended)) recommended = 'Edit runtime fields';
        const active = edit.activeRuntime;
        const changedFields = active ? fields.filter(([key]) => (active[key] ?? '') !== staged[key]) : [];
        const changedPaths = changedFields.flatMap(([, , name]) => name ? [name] : []);
        const title = [
            t('runtime.title'),
            ...(changedPaths.length ? [t('runtime.routeDifferences', { fields: changedPaths.join(' · ') })] : []),
            ...(active && changedFields.length ? [
                t('runtime.activeRoute', { context: quoteIdentity(active.dockerContext, 160), image: quoteIdentity(active.image, 180) }),
            ] : []),
            t('runtime.stagedContext', { value: staged.dockerContext ? quoteIdentity(staged.dockerContext, 160) : t('value.unselected') }),
            t('runtime.stagedImage', { value: staged.image ? quoteIdentity(staged.image, 180) : t('value.unselected') }),
            ...(draftSource ? [draftSource] : []),
            ...(replacesSaved ? [t('runtime.replacesSaved')] : []),
            ...(cancelledDiscovery ? [t('runtime.discoveryCancelled')] : []),
            ...(host.fieldsOnly ? [] : [checkStatus(outcome)]),
        ].join('\n');
        const action = pendingAction ?? await chooseActions(title, [recommended, ...actions.filter(label => label !== recommended)]);
        pendingAction = undefined;
        cancelledDiscovery = false;
        guard();
        if (!action || action === 'Cancel')
            return 'cancelled' as const;
        nextAction = undefined;
        if (action === 'Inspect current runtime' && edit.activeRuntime) {
            await show(t('runtime.inspectActiveTitle'), edit.activeRuntime);
            continue;
        }
        if (action === 'Inspect saved runtime' && edit.savedRuntime) {
            await show(t('runtime.inspectSavedTitle'), edit.savedRuntime);
            continue;
        }
        if (action === 'Inspect last runtime check' && problem) {
            const detail = [checkStatus(problem), problem.reason];
            if ('route' in problem) detail.push(JSON.stringify(problem.route, null, 2));
            await explain(t('runtime.inspectCheck'), detail.join('\n\n'));
            continue;
        }
        if (action === 'Interactive runtime installer') {
            if (!host.runPreparation) {
                await explain(t('runtime.install'), t('runtime.helpStandalone'));
                continue;
            }
            let explanation = '';
            try {
                const helper = await import(new URL('../../runtime/setup.mjs', import.meta.url).href);
                let verify: (() => Promise<void>) | undefined;
                const built = await edit.prepareInteractive(staged, guard, {
                    extraPackages,
                    locale,
                    choose: async (title, items) => {
                        const detail = explanation;
                        explanation = '';
                        if (detail && !await openRecovery(title, detail))
                            return;
                        const answer = await chooseUiItem(host, title, items);
                        guard();
                        return answer;
                    },
                    ask: async (question, value) => {
                        const detail = explanation;
                        explanation = '';
                        const answer = await host.input(question, value, detail);
                        guard();
                        if (answer === undefined)
                            throw Object.assign(Error(t('runtime.install.cancelled')), { code: 'RUNTIME_PREPARATION_CANCELLED' });
                        return answer;
                    },
                    output: text => { explanation = (explanation + text).slice(-16384); },
                    checkStarted: () => { lastCheck = undefined; },
                    checked: check => { verify = check; },
                    execute: (file, args, options) => {
                        const phase = args[0] === 'install' ? 'runtime.installProgress' : args[0] === 'start' ? 'runtime.colimaProgress' :
                            args[4] === 'version' ? 'runtime.checkConnectionProgress' : args[4] === 'build' ? 'runtime.buildProgress' : 'runtime.toolsProgress';
                        return host.runPreparation!(t(phase), (signal, output) => helper.runCommand(file, args, {
                            ...options, signal: AbortSignal.any([signal, options.signal as AbortSignal]),
                            onOutput: options.onOutput ? output : undefined,
                        }));
                    },
                });
                guard();
                if (verify) {
                    lastCheck = { kind: 'passed', route: { ...staged }, verify };
                } else if (built) {
                    stage({ dockerBinary: built.dockerBinary, dockerConfigDirectory: built.dockerConfigDirectory ?? '', dockerContext: built.dockerContext, image: built.image });
                    nextAction = 'Review and save runtime';
                }
            }
            catch (error) {
                if ((error as {
                    code?: string;
                })?.code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN')
                    throw error;
                await recover(t('runtime.install.stopped'), error, ['Interactive runtime installer', 'Edit runtime fields', 'Choose Docker context']);
            }
            continue;
        }
        if (action === 'Suggest local Docker paths') {
            const found = await edit.suggestPaths(guard);
            suggested = true;
            guard();
            const next = { ...staged };
            if (!next.dockerBinary && found.dockerBinary)
                next.dockerBinary = found.dockerBinary;
            if (!next.dockerConfigDirectory && found.dockerConfigDirectory)
                next.dockerConfigDirectory = found.dockerConfigDirectory;
            if (!await reviewAction(t('runtime.suggestReview'), {
                scope: t('runtime.suggestReviewScope'), suggested: found, staged: next,
            }))
                continue;
            const decision = await chooseActions(t('runtime.stageTitle'), ['Back without changes', 'Use these paths']);
            guard();
            if (decision === 'Use these paths')
                stage(next);
            else
                nextAction = 'Suggest local Docker paths';
            continue;
        }
        if (action === 'Prepare an execution image') {
            const discoveredRoute = pendingBuildRoute;
            pendingBuildRoute = undefined;
            let routeResolved = false;
            try {
                const input = await edit.runtimeRouteInputs(discoveredRoute ?? staged, guard);
                guard();
                if (discoveredRoute && !isDeepStrictEqual(discoveredRoute, input))
                    throw Error(t('runtime.discoveredBuildRouteChanged'));
                routeResolved = true;
                if (!host.runPreparation) {
                    await explain(t('runtime.build'), runtimeImageBuildHelp(input, undefined, locale));
                    nextAction = 'Choose existing runtime image';
                    continue;
                }
                if (!await reviewAction(t('runtime.buildReview'), {
                    scope: t('runtime.buildReviewScope'), route: input, extraPackages: extraPackages || t('runtime.standardRecipe'),
                })) {
                    nextAction = 'Choose existing runtime image';
                    continue;
                }
                const decision = await chooseActions(t('runtime.buildTitle'), ['Back without building', 'Build execution image']);
                guard();
                if (decision !== 'Build execution image') {
                    nextAction = 'Choose existing runtime image';
                    continue;
                }
                const built = await host.runPreparation(t('runtime.prepareImageProgress'), (signal, output) => edit.buildImage(input, guard, signal, output, extraPackages));
                guard();
                stage({ dockerBinary: built.dockerBinary, dockerConfigDirectory: built.dockerConfigDirectory ?? '', dockerContext: built.dockerContext, image: built.image });
                nextAction = 'Review and save runtime';
            }
            catch (error) {
                const code = (error as { code?: string })?.code;
                if (code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN')
                    throw error;
                if (discoveredRoute && (!routeResolved || code === 'RUNTIME_PREPARATION_ROUTE_CHANGED'))
                    await recover(t('runtime.discoveryUnavailable'), error, ['Choose existing runtime image', 'Edit runtime fields']);
                else if (code === 'RUNTIME_ROUTE_METADATA_UNAVAILABLE') {
                    nextAction = 'Choose Docker context';
                    await recover(t('runtime.install.buildContextStopped'), error, ['Choose Docker context', 'Edit runtime fields'], t('runtime.install.contextRecovery'));
                } else if (code === 'RUNTIME_DOCKER_SERVER_UNAVAILABLE')
                    await recover(t('runtime.buildConnectionFailed'), error, ['Prepare an execution image', 'Choose Docker context', 'Edit runtime fields'], t('runtime.install.buildConnectionRecovery'), discoveredRoute);
                else if (code === 'RUNTIME_PREPARATION_ROUTE_CHANGED')
                    await recover(t('runtime.buildStopped'), error, ['Choose Docker context', 'Edit runtime fields']);
                else
                    await recover(t('runtime.buildStopped'), error, ['Prepare an execution image', 'Edit runtime fields', 'Choose Docker context', 'Extra image packages', 'Interactive runtime installer'], undefined, discoveredRoute);
            }
            continue;
        }
        if (action === 'Extra image packages') {
            let value = extraPackages;
            while (true) {
                const answer = await host.input(t('runtime.packagesField'), value, t('runtime.describePackages'));
                guard();
                if (answer === undefined)
                    break;
                value = answer;
                try {
                    const helper = await import(new URL('../../runtime/setup.mjs', import.meta.url).href);
                    const valid = helper.imagePackages(value);
                    guard();
                    extraPackages = valid;
                    break;
                }
                catch (error) {
                    guard();
                    await explain(t('runtime.correctPackages'), error instanceof Error ? error.message : String(error));
                }
            }
            continue;
        }
        if (action === 'Check runtime connection and image') {
            if (!host.runPreparation) {
                await explain(t('runtime.checkUnavailable'), t('runtime.helpCheckUnavailable'));
                continue;
            }
            let input: CheckedRoute;
            try {
                input = await edit.checkRuntimeInputs(staged, guard);
            }
            catch (error) {
                guard();
                lastCheck = { kind: 'prerequisite', reason: checkDiagnostic(error) };
                nextAction = 'Edit runtime fields';
                await recover(t('runtime.checkPrerequisites'), error, ['Edit runtime fields', 'Choose Docker context', 'Choose existing runtime image', 'Interactive runtime installer'], t('runtime.checkNotStarted'));
                continue;
            }
            forgetCheckForDifferentRoute(input);
            if (!await reviewAction(t('runtime.checkReview'), { scope: t('runtime.checkReviewScope'), route: input }))
                continue;
            if (await chooseActions(t('runtime.checkTitle'), ['Back', 'Check connection and image']) !== 'Check connection and image')
                continue;
            guard();
            try {
                let verify: (() => Promise<void>) | undefined;
                await host.runPreparation(t('runtime.checkProgress'), (signal, output) => edit.checkRuntime(input, guard, signal, output, check => { verify = check; }));
                guard();
                if (!verify) throw Error(t('runtime.checkStale'));
                lastCheck = { kind: 'passed', route: input, verify };
            }
            catch (error) {
                const code = (error as { code?: string })?.code;
                if (code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN')
                    throw error;
                guard();
                const kind = code === 'RUNTIME_PREPARATION_CANCELLED' ? 'cancelled' :
                    code === 'RUNTIME_ROUTE_METADATA_UNAVAILABLE' ? 'context' :
                    code === 'RUNTIME_DOCKER_IMAGE_UNAVAILABLE' ? 'image' : 'failed';
                lastCheck = { kind, route: input, reason: checkDiagnostic(error) };
                if (code === 'RUNTIME_DOCKER_SERVER_UNAVAILABLE') {
                    nextAction = 'Choose Docker context';
                    await recover(t('runtime.checkConnectionFailed', { context: quoteIdentity(input.dockerContext, 160) }), error,
                        ['Choose Docker context', 'Check runtime connection and image', 'Edit runtime fields', 'Interactive runtime installer'],
                        t('runtime.install.buildConnectionRecovery'));
                } else if (kind === 'context') {
                    nextAction = 'Choose Docker context';
                    await recover(t('runtime.checkContextUnavailable'), error, ['Choose Docker context', 'Edit runtime fields'], t('runtime.install.contextRecovery'));
                } else if (kind === 'image') {
                    nextAction = 'Choose existing runtime image';
                    await recover(t('runtime.checkImageUnavailable', {context: quoteIdentity(input.dockerContext, 160)}), error,
                        ['Choose existing runtime image', 'Check runtime connection and image', 'Edit runtime fields'],
                        t('runtime.checkImageRecovery', {image: quoteIdentity(input.image, 180)}));
                } else {
                    if (kind === 'failed') nextAction = 'Edit runtime fields';
                    await recover(t('runtime.checkStopped'), error, ['Check runtime connection and image', 'Edit runtime fields', 'Choose Docker context', 'Choose existing runtime image', 'Interactive runtime installer']);
                }
            }
            continue;
        }
        if (action === 'Runtime setup help') {
            const text = [
                runtimePrerequisites(edit.defaultDockerConfigDirectory, locale),
                ...fields.map(([key, title]) => `${title}\n${descriptions[key]}`),
                t('runtime.helpExamplesAndSave'),
                stageForReview ? t('runtime.stageScope') : appliesRuntime ? t('runtime.helpApply') : t('runtime.nextLaunchScope'),
            ].join('\n\n');
            await explain(t('runtime.help'), text);
            continue;
        }
        if (action === 'Choose Docker context' || action === 'Choose existing runtime image') {
            const kind = action === 'Choose Docker context' ? 'contexts' : 'images', next = { ...staged };
            const routeFields = fields.filter(([key]) => key === 'dockerBinary' || key === 'dockerConfigDirectory' || kind === 'images' && key === 'dockerContext');
            if (!routeFields.every(([key]) => next[key].trim())) {
                let cancelled = false;
                for (const [key, title] of routeFields) {
                    const value = await host.input(key === 'dockerConfigDirectory' ? t('runtime.discoveryConfigField') : title, next[key], descriptions[key]);
                    guard();
                    if (value === undefined) {
                        cancelled = true;
                        break;
                    }
                    next[key] = value;
                }
                if (cancelled)
                    continue;
            }
            let result: Awaited<ReturnType<typeof edit.discover>> | undefined;
            try {
                const route = await edit.discoveryRouteInputs(kind, next, guard);
                if (!await reviewAction(t('runtime.discoveryReview'), {
                    operation: t(kind === 'contexts' ? 'runtime.discoveryContextsScope' : 'runtime.discoveryImagesScope'),
                    route, limits: t('runtime.discoveryReviewLimits'),
                }))
                    continue;
                const confirmed = await chooseActions(t('runtime.discoverTitle'), ['Back', 'Discover with this route']);
                guard();
                if (confirmed !== 'Discover with this route')
                    continue;
                const discover = async (signal?: AbortSignal) => {
                    try {
                        const observation = await edit.discover(kind, route, guard, { reviewed: true, ...(signal ? { signal } : {}) });
                        signal?.throwIfAborted();
                        return observation;
                    } catch (error) {
                        if (!signal?.aborted || error !== signal.reason) throw error;
                    }
                };
                const title = kind === 'contexts' ? t('runtime.discoveryContextsProgress') :
                    t('runtime.discoveryImagesProgress', { context: quoteIdentity(route.dockerContext!, 160) });
                result = await (host.runPreparation ? host.runPreparation(title, discover, {
                    running: t('runtime.discoveryRunning'), cancelling: t('runtime.discoveryCancelling'), cancelHint: t('runtime.discoveryCancelHint'),
                }) : discover());
            }
            catch (error) {
                const code = (error as { code?: string })?.code;
                if (code === 'RUNTIME_DISCOVERY_CLEANUP_UNKNOWN')
                    throw error;
                if (kind === 'images' && code === 'RUNTIME_ROUTE_METADATA_UNAVAILABLE') {
                    nextAction = 'Choose Docker context';
                    await recover(t('runtime.discoveryContextUnavailable'), error, ['Choose Docker context', 'Edit runtime fields'], t('runtime.install.contextRecovery'));
                } else {
                    nextAction = 'Edit runtime fields';
                    await recover(t('runtime.discoveryUnavailable'), error,
                        ['Edit runtime fields', 'Choose Docker context', ...(kind === 'images' ? ['Choose existing runtime image'] : [])],
                        t('runtime.discoveryRecoveryNote'));
                }
                continue;
            }
            guard();
            if (!result) {
                cancelledDiscovery = true;
                nextAction = action;
                continue;
            }
            const empty = !result.candidates.length;
            const recipeImages = new Set(result.recipeImages);
            const buildInstead = kind === 'images' && !recipeImages.size && !!host.runPreparation;
            const title = empty ? (kind === 'images'
                ? t('runtime.emptyImages', { context: quoteIdentity(result.dockerContext ?? next.dockerContext, 160) })
                : t('runtime.emptyContexts', { config: quoteIdentity(result.dockerConfigDirectory, 160) }))
                : kind === 'images' ? [t('runtime.observedImages'), t('runtime.observedImagesScope')].join('\n') : t('runtime.observedContexts');
            if (empty && !buildInstead) {
                nextAction = 'Runtime setup help';
                await explain(title, t('runtime.emptyInventoryHelp'));
                continue;
            }
            const selected = await chooseUiItem(host, title, [
                ...empty ? [{ value: 'Back to runtime setup', label: t('runtime.backSetup') }] : [],
                ...buildInstead ? [{ value: 'Prepare an execution image', label: t('runtime.build') }] : [],
                ...result.candidates.map((value, index) => ({
                    value, label: recipeImages.has(value) ? t('runtime.recipeImageLabel', { image: result.labels[index]! }) : result.labels[index]!,
                })),
            ]);
            guard();
            if (selected === undefined || selected === 'Back to runtime setup')
                continue;
            next.dockerBinary = result.dockerBinary;
            next.dockerConfigDirectory = result.dockerConfigDirectory;
            if (result.dockerContext !== undefined)
                next.dockerContext = result.dockerContext;
            if (selected === 'Prepare an execution image') {
                const { dockerBinary, dockerConfigDirectory, dockerContext } = next;
                pendingBuildRoute = { dockerBinary, dockerConfigDirectory, dockerContext };
                pendingAction = selected;
                continue;
            }
            if (kind === 'contexts')
                next.dockerContext = selected;
            else
                next.image = selected;
            stage(next);
            continue;
        }
        if (action === 'Edit runtime fields') {
            const next = { ...staged };
            let cancelled = false;
            for (const [key, title] of fields) {
                const value = await host.input(title, next[key], descriptions[key]);
                guard();
                if (value === undefined) {
                    cancelled = true;
                    break;
                }
                next[key] = value;
            }
            if (!cancelled)
                stage(next);
            continue;
        }
        if (action !== 'Review and save runtime')
            throw Error('Unknown runtime setup action');
        const runtime: RuntimeProfile = { ...edit.runtime, ...staged };
        if (!runtime.dockerConfigDirectory)
            delete runtime.dockerConfigDirectory;
        let valid: Awaited<ReturnType<typeof edit.validate>>;
        try {
            valid = await edit.validate(runtime, guard);
        }
        catch (error) {
            guard();
            nextAction = 'Edit runtime fields';
            await show(t('runtime.unavailable'), {
                reason: error instanceof Error ? error.message : 'Validation unavailable',
                nextAction: t('runtime.helpInvalidFields'),
            });
            continue;
        }
        if (!host.show)
            throw Error('Runtime settings review requires an inspection view; use gitjig setup edit with the same --home');
        forgetCheckForDifferentRoute(valid.runtime);
        await refreshCheck();
        const reviewedCheck = lastCheck;
        const checkedReview = reviewedCheck?.kind === 'passed';
        const observation = checkStatus(reviewedCheck);
        const reviewTitle = t(stageForReview ? 'runtime.reviewStageTitle' : appliesRuntime ? 'runtime.reviewTitle' : 'runtime.reviewNextTitle');
        const review = JSON.stringify({
            metadataObservation: observation, runtime: valid.runtime, preservedBridge: valid.bridge ?? null, existingOperationsChanged: false,
            ...(reviewedCheck && 'reason' in reviewedCheck ? { metadataDiagnostic: reviewedCheck.reason } : {}),
            ...(draftSource ? { draftSource } : {}),
            ...(edit.activeRuntime && !isDeepStrictEqual(edit.activeRuntime, valid.runtime) ? { previousActiveRuntime: edit.activeRuntime } : {}),
            ...(edit.savedRuntime && !isDeepStrictEqual(edit.savedRuntime, valid.runtime) ? { previousSavedRuntime: edit.savedRuntime } : {}),
            ...(stageForReview ? { pendingCombinedReview: true } : {}),
            scope: t(stageForReview ? 'runtime.stageScope' : appliesRuntime ? 'runtime.applyScope' : 'runtime.nextLaunchScope')
        }, null, 2);
        guard();
        const confirm = await showReviewAction({ show: host.show.bind(host) }, reviewTitle, review, t('common.openSettingsConfirmation'));
        guard();
        if (!confirm)
            continue;
        const saveTitle = t(stageForReview ? 'runtime.combinedStageTitle' : appliesRuntime ? 'runtime.saveTitle' : 'runtime.saveNextTitle');
        const checkFirst = 'Check connection and image first';
        const decision = await chooseActions(saveTitle + '\n' + observation, ['Back without saving', ...(canCheck && !checkedReview ? [checkFirst] : []), saveAction]);
        guard();
        if (!decision || decision === 'Back without saving')
            continue;
        if (decision === checkFirst && canCheck && !checkedReview) {
            pendingAction = 'Check runtime connection and image';
            continue;
        }
        if (decision !== saveAction)
            throw Error('Unknown runtime save action');
        if (!await refreshCheck())
            continue;
        let receipt: Awaited<ReturnType<RuntimeFieldEdit['save']>>;
        try {
            receipt = await edit.save(runtime, guard, valid);
        }
        catch (error) {
            await recover(t(stageForReview ? 'runtime.stageUnavailable' : 'runtime.saveUnavailable'), error,
                ['Review and save runtime', 'Edit runtime fields'], t('runtime.saveRecoveryNote'));
            continue;
        }
        if (appliesRuntime && receipt)
            host.notice(startupSaveNotice('runtime', receipt.activation, t), true);
        else
            host.notice(t(stageForReview ? 'runtime.staged' : appliesRuntime ? 'runtime.saved' : 'runtime.savedNextLaunch'));
        return 'completed' as const;
    }
}
