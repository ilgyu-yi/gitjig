import { startupComponentStatus } from './startup-guidance.js';
import type { ApplicationStartup } from '../app/startup.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';
import { showReviewAction, type ReviewPrimaryAction } from './exact-review.js';
import type { HostCommandOutcome } from './host-commands.js';
import { failurePresentation } from './failure-details.js';

interface Host extends UiChoiceHost {
    locale: UiLocale;
    guard(): void;
    show?(title: string, text: string, primary?: ReviewPrimaryAction): Promise<void>;
    runPreparation?<T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>, presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T>;
    notice(text: string): void;
    inspect(): ReturnType<ApplicationStartup['inspect']>;
    restartCommand: string;
    execute?(command: string): Promise<HostCommandOutcome>;
}
type BridgeStatus = Awaited<ReturnType<Host['inspect']>>;

/** Guided connection owns no native process, credential reader or configuration writer. */
export async function connectBridge(host: Host, edit: Awaited<ReturnType<ApplicationStartup['prepareBridgeConnection']>>): Promise<HostCommandOutcome> {
    const t = translator(host.locale), guard = () => { host.guard(); edit.assertCurrent(); };
    const prepare = <T>(title: string, action: (signal: AbortSignal) => Promise<T>) => {
        const run = async (signal: AbortSignal) => {
            try { return await action(signal); }
            catch (error) {
                if (!signal.aborted || error !== signal.reason) throw error;
            }
        };
        return host.runPreparation ? host.runPreparation(title, run, {
            running: t('bridge.progressRunning'), cancelling: t('bridge.progressCancelling'), cancelHint: t('bridge.progressCancelHint'),
        }) : run(new AbortController().signal);
    };
    const show = async (title: string, text: string, assertCurrent = guard) => {
        assertCurrent();
        if (host.show)
            await host.show(title, text);
        else
            await chooseUiItem(host, title + '\n' + text, [{ value: 'back', label: t('bridge.back') }]);
        assertCurrent();
    };
    const choose = async (title: string, items: { value: string; label: string }[], assertCurrent = guard) => {
        assertCurrent();
        const result = await chooseUiItem(host, title, items);
        assertCurrent();
        return result;
    };
    const showFailure = async (title: string, error: unknown) => {
        const failure = failurePresentation(error);
        if (failure.code && ['CLAUDE_SETUP_CLEANUP_UNKNOWN', 'RUNTIME_DISCOVERY_CLEANUP_UNKNOWN', 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN'].includes(failure.code))
            throw error;
        await show(title, failure.detail);
    };
    const review = async (title: string, text: string, label: string) => {
        guard();
        if (!host.show)
            throw Error('Claude connection review requires an inspection view');
        const confirmed = await showReviewAction({ show: host.show.bind(host) }, title, text, label);
        guard();
        return confirmed;
    };
    const status = (view: BridgeStatus) => [
        t('bridge.activation', { value: t(startupComponentStatus(view.activation.bridge)) }),
        t('bridge.active', { value: t(!view.effective ? 'value.statusUnavailable' : view.effective.bridge ? 'bridge.configured' : 'bridge.absent') }),
        t('bridge.saved', { value: t(view.diagnostic ? 'value.savedRepair' : view.saved?.bridge ? 'bridge.configured' : 'bridge.absent') }),
    ];
    const continuations = (view: BridgeStatus) => [
        ...(view.activation.bridge === 'relaunch' ? [{ value: 'restart', label: t('bridge.restart') }] : []),
        ...(view.effective?.bridge && host.execute ? [{ value: 'model', label: t('bridge.model') }] : []),
        ...(view.activation.bridge === 'unknown' && host.execute ? [{ value: 'inspect', label: t('startup.menu.inspect') }] : []),
    ];
    const restart = (view: BridgeStatus, assertCurrent = guard) => show(t('bridge.restart'), [
        t('bridge.restartBody', { command: host.restartCommand }),
        t(view.saved?.bridge ? 'bridge.restartModel' : 'bridge.restartRemoved'),
    ].join('\n\n'), assertCurrent);
    const commands = { model: '/model', ready: '/ready', inspect: '/setup inspect', advanced: '/setup bridge' } as const;
    const runtime = edit.runtimeConfigurationRequired, execute = host.execute;
    const runtimeRequired = runtime && t(runtime === 'saved' ? 'bridge.runtimeRequiredSaved' : 'bridge.runtimeRequiredCurrent');
    const runtimeActions = runtime && execute ? [{value: 'runtime', label: t(runtime === 'saved' ? 'bridge.runtimeEditSaved' : 'bridge.runtimeEditCurrent')}] : [];
    const openRuntime = async () => {
        const outcome = await execute!(runtime === 'saved' ? '/setup runtime' : '/setup runtime current');
        if (outcome === 'completed') {
            // The runtime editor owns its save. Its new settings require a fresh bridge edit.
            try { host.guard(); } catch { return outcome; }
            host.notice(t('bridge.runtimeReturn'));
        }
        return outcome;
    };
    const view = await host.inspect();
    guard();
    const actions = [
        ...runtimeActions,
        ...continuations(view),
        { value: 'discover', label: t('bridge.discover') },
        ...(host.execute ? [{ value: 'ready', label: t('bridge.ready') }] : []),
        ...(host.execute ? [{ value: 'advanced', label: t('bridge.advanced') }] : []),
        { value: 'details', label: t('bridge.details') },
        { value: 'close', label: t('bridge.close') },
    ];
    const heading = [t('bridge.title'), runtimeRequired, ...status(view)].filter(Boolean).join('\n');
    while (true) {
        const entry = await choose(heading, actions);
        if (entry === 'discover')
            break;
        if (entry === 'runtime' && runtimeActions.length) {
            const outcome = await openRuntime();
            if (outcome !== 'cancelled') return outcome;
            continue;
        }
        if (entry === 'details') {
            await show(t('bridge.details'), [t('bridge.scope'), ...status(view), view.diagnostic].filter(Boolean).join('\n\n'));
            continue;
        }
        if (entry === 'restart') {
            await restart(view);
            return 'completed';
        }
        if (host.execute && (entry === 'model' || entry === 'ready' || entry === 'inspect' || entry === 'advanced')) {
            const outcome = await host.execute(commands[entry]);
            if (outcome !== 'cancelled')
                return outcome;
            continue;
        }
        return 'cancelled';
    }
    while (true) {
        const discovered = await edit.discover(guard);
        guard();
        if (!discovered.candidates.length || !discovered.routes.length) {
            await show(t('bridge.title'), [t(!discovered.candidates.length ? 'bridge.missing' : 'bridge.noRoute'), discovered.diagnostic].filter(Boolean).join('\n\n'));
            const actions = [
                { value: 'discover', label: t('bridge.discover') },
                ...(host.execute ? [{ value: 'advanced', label: t('bridge.advanced') }] : []),
                { value: 'close', label: t('bridge.close') },
            ];
            while (true) {
                const action = await choose(t('bridge.title'), actions);
                if (action === 'discover')
                    break;
                if (action !== 'advanced' || !host.execute)
                    return 'cancelled';
                const outcome = await host.execute(commands.advanced);
                if (outcome !== 'cancelled')
                    return outcome;
            }
            continue;
        }
        let candidate = discovered.candidates[0]!, route = discovered.routes[0]!;
        let checked: Awaited<ReturnType<typeof edit.check>> | undefined;
        let cancelled: 'bridge.checkCancelled' | 'bridge.connectCancelled' | undefined;
        while (true) {
            const action = await choose([t('bridge.title'), runtimeRequired, cancelled && t(cancelled), t('bridge.checkFootprint'), candidate.label, route.label].filter(Boolean).join('\n'), [
                ...runtimeActions,
                ...(checked?.ready && checked.review ? [{ value: 'review', label: t('bridge.review') }] : []),
                { value: 'check', label: t('bridge.check') },
                ...(checked?.permissionRepair ? [{ value: 'repair', label: t('bridge.repair') }] : []),
                { value: 'client', label: t('bridge.clientChange') },
                { value: 'route', label: t('bridge.routeChange') },
                { value: 'discover', label: t('bridge.discover') },
                { value: 'close', label: t('bridge.close') },
            ]);
            cancelled = undefined;
            if (!action || action === 'close')
                return 'cancelled' as const;
            if (action === 'runtime' && runtimeActions.length) {
                const outcome = await openRuntime();
                if (outcome !== 'cancelled') return outcome;
                continue;
            }
            if (action === 'discover')
                break;
            if (action === 'client' || action === 'route') {
                const options = action === 'client' ? discovered.candidates : discovered.routes;
                const selected = await choose(t(action === 'client' ? 'bridge.client' : 'bridge.route', { value: action === 'client' ? candidate.label : route.label }), [
                    ...options.map((option, index) => ({ value: 'option-' + index, label: option.label })),
                    { value: 'back', label: t('bridge.back') },
                ]);
                if (selected && selected !== 'back') {
                    const index = Number(selected.slice('option-'.length));
                    if (action === 'client')
                        candidate = discovered.candidates[index]!;
                    else
                        route = discovered.routes[index]!;
                    checked = undefined;
                }
                continue;
            }
            if (action === 'check') {
                checked = undefined;
                try {
                    checked = await prepare(t('bridge.checkProgress') + '\n' + candidate.label + '\n' + route.label, signal => edit.check(candidate.id, route.id, guard, signal));
                }
                catch (error) {
                    await showFailure(t('bridge.account'), error);
                    continue;
                }
                guard();
                if (!checked) {
                    cancelled = 'bridge.checkCancelled';
                    continue;
                }
                if (checked.permissionRepair) {
                    await show(t('bridge.repair'), t('bridge.repairScope') + '\n\n' + checked.permissionRepair.labels.join('\n'));
                    continue;
                }
                const account = checked.account, unknown = t('bridge.unknown');
                const needsLogin = !account.loggedIn || account.authMethod !== 'claude.ai';
                await show(t('bridge.account'), [
                    checked.client.label + ' · ' + checked.client.version,
                    t('bridge.loginState', { value: t(account.loggedIn ? 'bridge.loggedIn' : 'bridge.loggedOut') }),
                    t('bridge.email', { value: account.email ?? unknown }),
                    t('bridge.organization', { value: account.organization ?? unknown }),
                    t('bridge.plan', { value: account.plan ?? unknown }),
                    t('bridge.authMethod', { value: account.authMethod ?? unknown }),
                    t('bridge.source', { value: checked.routeLabel }),
                    t('bridge.loginScope'),
                    ...(runtimeRequired ? [runtimeRequired] : []),
                    ...(checked.diagnostic ? [checked.diagnostic] : []),
                    ...(needsLogin ? [t('bridge.loginHelp'), t('bridge.loginCommand', { value: checked.loginCommand })] : []),
                ].join('\n'));
                continue;
            }
            if (action === 'repair' && checked?.permissionRepair) {
                const repair = checked.permissionRepair;
                if (!await review(t('bridge.repair'), t('bridge.repairScope') + '\n\n' + repair.labels.join('\n'), t('bridge.openRepairConfirmation')))
                    continue;
                const confirmation = await choose(t('bridge.repairConfirmation'), [
                    { value: 'back', label: t('bridge.back') },
                    { value: 'repair', label: t('bridge.repairConfirm') },
                ]);
                if (confirmation === 'repair') {
                    checked = undefined;
                    try {
                        await edit.repairPermissions(repair.id, guard);
                    }
                    catch (error) {
                        await showFailure(t('bridge.repair'), error);
                        continue;
                    }
                    guard();
                }
                continue;
            }
            if (action === 'review' && checked?.ready && checked.review) {
                const connection = [
                    t('bridge.reviewScope'),
                    checked.client.label + ' · ' + checked.client.version,
                    t('bridge.email', { value: checked.account.email ?? t('bridge.unknown') }),
                    t('bridge.organization', { value: checked.account.organization ?? t('bridge.unknown') }),
                    t('bridge.plan', { value: checked.account.plan ?? t('bridge.unknown') }),
                    t('bridge.source', { value: checked.routeLabel }),
                    t('bridge.clientPath', { value: checked.review.clientPath }),
                    t('bridge.pin', { value: checked.review.sha256 }),
                    t('bridge.managedDirectory', { value: checked.review.managedDirectory }),
                    t('bridge.accountDirectory', { value: checked.review.accountDirectory }),
                    ...(checked.review.nativeHome ? [t('bridge.nativeHome', { value: checked.review.nativeHome })] : []),
                    t('bridge.policyFile', { value: checked.review.policyFile }),
                ].join('\n\n');
                if (!await review(t('bridge.reviewTitle'), connection, t('common.openSettingsConfirmation')))
                    continue;
                const confirmation = await choose(t('bridge.connectConfirmation'), [
                    { value: 'back', label: t('bridge.back') },
                    { value: 'connect', label: t('bridge.connect') },
                ]);
                if (confirmation !== 'connect')
                    continue;
                const checkId = checked.id;
                checked = undefined;
                try {
                    const outcome = await prepare(t('bridge.connectProgress') + '\n' + candidate.label + '\n' + route.label, signal => edit.connect(checkId, guard, signal));
                    if (!outcome) {
                        guard();
                        cancelled = 'bridge.connectCancelled';
                        continue;
                    }
                }
                catch (error) {
                    await showFailure(t('bridge.connectFailed'), error);
                    continue;
                }
                // Own Save invalidates the prepared byte snapshot. Inspect with source/close guards only.
                try { host.guard(); } catch { return 'completed' as const; }
                host.notice(t('bridge.savedNotice'));
                try {
                    while (true) {
                        host.guard();
                        let fresh: BridgeStatus;
                        try { fresh = await host.inspect(); }
                        catch { return 'completed' as const; }
                        const next = await choose([t('bridge.next'), ...status(fresh), fresh.diagnostic].filter(Boolean).join('\n'), [
                            ...continuations(fresh),
                            ...(host.execute ? [{ value: 'ready', label: t('bridge.ready') }] : []),
                            { value: 'close', label: t('bridge.close') },
                        ], host.guard);
                        if (next === 'restart') {
                            await restart(fresh, host.guard);
                            continue;
                        }
                        if (host.execute && (next === 'model' || next === 'ready' || next === 'inspect')) {
                            const outcome = await host.execute(commands[next]);
                            if (outcome === 'cancelled')
                                continue;
                            return outcome;
                        }
                        return 'completed' as const;
                    }
                }
                catch (error) {
                    try { host.guard(); } catch { return 'completed' as const; }
                    throw error;
                }
            }
        }
    }
}
