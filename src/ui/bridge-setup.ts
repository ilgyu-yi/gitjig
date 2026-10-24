import type { ApplicationStartup } from '../app/startup.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';

interface Host extends UiChoiceHost {
    locale: UiLocale;
    guard(): void;
    show?(title: string, text: string): Promise<void>;
    runPreparation?<T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>, presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T>;
    notice(text: string): void;
    inspect(): ReturnType<ApplicationStartup['inspect']>;
    restartCommand: string;
    execute?(command: string): Promise<unknown>;
}

/** Guided connection owns no native process, credential reader or configuration writer. */
export async function connectBridge(host: Host, edit: Awaited<ReturnType<ApplicationStartup['prepareBridgeConnection']>>) {
    const t = translator(host.locale), guard = () => { host.guard(); edit.assertCurrent(); };
    const prepare = <T>(title: string, action: (signal: AbortSignal) => Promise<T>) => host.runPreparation
        ? host.runPreparation(title, action, { running: t('bridge.progressRunning'), cancelling: t('bridge.progressCancelling'), cancelHint: t('bridge.progressCancelHint') })
        : action(new AbortController().signal);
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
    const advanced = async () => {
        guard();
        if (host.execute)
            await host.execute('/setup bridge');
        host.guard();
        return 'completed' as const;
    };
    const view = await host.inspect();
    guard();
    await show(t('bridge.title'), [
        t('bridge.scope'),
        t('bridge.active', { value: t(view.effective?.bridge ? 'bridge.configured' : 'bridge.absent') }),
        t('bridge.saved', { value: t(view.saved?.bridge ? 'bridge.configured' : 'bridge.absent') }),
        ...(view.diagnostic ? [view.diagnostic] : []),
    ].join('\n\n'));
    const entry = await choose(t('bridge.title'), [
        ...(view.restartRequired && view.saved?.bridge ? [{ value: 'restart', label: t('bridge.restart') }] : []),
        ...(view.effective?.bridge && host.execute ? [{ value: 'model', label: t('bridge.model') }] : []),
        { value: 'discover', label: t('bridge.discover') },
        ...(host.execute ? [{ value: 'ready', label: t('bridge.ready') }] : []),
        ...(host.execute ? [{ value: 'advanced', label: t('bridge.advanced') }] : []),
        { value: 'close', label: t('bridge.close') },
    ]);
    if (entry === 'advanced')
        return advanced();
    if (entry === 'restart') {
        await show(t('bridge.restart'), t('bridge.restartBody', { command: host.restartCommand }));
        return 'completed' as const;
    }
    if (entry === 'model' || entry === 'ready') {
        await host.execute?.(entry === 'model' ? '/model' : '/ready');
        return 'completed' as const;
    }
    if (!entry || entry === 'close')
        return 'cancelled' as const;
    while (true) {
        const discovered = await edit.discover(guard);
        guard();
        if (!discovered.candidates.length || !discovered.routes.length) {
            await show(t('bridge.title'), [t(!discovered.candidates.length ? 'bridge.missing' : 'bridge.noRoute'), discovered.diagnostic].filter(Boolean).join('\n\n'));
            const action = await choose(t('bridge.title'), [
                { value: 'discover', label: t('bridge.discover') },
                ...(host.execute ? [{ value: 'advanced', label: t('bridge.advanced') }] : []),
                { value: 'close', label: t('bridge.close') },
            ]);
            if (action === 'advanced')
                return advanced();
            if (!action || action === 'close')
                return 'cancelled' as const;
            continue;
        }
        let candidate = discovered.candidates[0]!, route = discovered.routes[0]!;
        let checked: Awaited<ReturnType<typeof edit.check>> | undefined;
        while (true) {
            const action = await choose(t('bridge.title') + '\n' + candidate.label + '\n' + route.label, [
                ...(checked?.ready && checked.review ? [{ value: 'review', label: t('bridge.review') }] : []),
                { value: 'check', label: t('bridge.check') },
                ...(checked?.permissionRepair ? [{ value: 'repair', label: t('bridge.repair') }] : []),
                { value: 'client', label: t('bridge.clientChange') },
                { value: 'route', label: t('bridge.routeChange') },
                { value: 'discover', label: t('bridge.discover') },
                { value: 'close', label: t('bridge.close') },
            ]);
            if (!action || action === 'close')
                return 'cancelled' as const;
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
                    guard();
                    await show(t('bridge.account'), error instanceof Error ? error.message : String(error));
                    continue;
                }
                guard();
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
                    ...(checked.diagnostic ? [checked.diagnostic] : []),
                    ...(needsLogin ? [t('bridge.loginHelp'), t('bridge.loginCommand', { value: checked.loginCommand })] : []),
                ].join('\n'));
                continue;
            }
            if (action === 'repair' && checked?.permissionRepair) {
                const repair = checked.permissionRepair;
                await show(t('bridge.repair'), t('bridge.repairScope') + '\n\n' + repair.labels.join('\n'));
                const confirmation = await choose(t('bridge.repair'), [
                    { value: 'back', label: t('bridge.back') },
                    { value: 'repair', label: t('bridge.repairConfirm') },
                ]);
                if (confirmation === 'repair') {
                    checked = undefined;
                    try {
                        await edit.repairPermissions(repair.id, guard);
                    }
                    catch (error) {
                        guard();
                        await show(t('bridge.repair'), error instanceof Error ? error.message : String(error));
                        continue;
                    }
                    guard();
                }
                continue;
            }
            if (action === 'review' && checked?.ready && checked.review) {
                await show(t('bridge.reviewTitle'), [
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
                ].join('\n\n'));
                const confirmation = await choose(t('bridge.reviewTitle'), [
                    { value: 'back', label: t('bridge.back') },
                    { value: 'connect', label: t('bridge.connect') },
                ]);
                if (confirmation !== 'connect')
                    continue;
                const checkId = checked.id;
                try {
                    await prepare(t('bridge.connectProgress') + '\n' + candidate.label + '\n' + route.label, signal => edit.connect(checkId, guard, signal));
                }
                catch (error) {
                    guard();
                    checked = undefined;
                    await show(t('bridge.connectFailed'), error instanceof Error ? error.message : String(error));
                    continue;
                }
                // Own Save invalidates the prepared byte snapshot. Inspect with source/close guards only.
                try { host.guard(); } catch { return 'completed' as const; }
                host.notice(t('bridge.savedNotice'));
                let fresh: Awaited<ReturnType<Host['inspect']>>;
                try {
                    fresh = await host.inspect();
                    host.guard();
                }
                catch {
                    return 'completed' as const;
                }
                try {
                    while (true) {
                        const next = await choose([
                            t('bridge.next'),
                            t('bridge.active', { value: t(fresh.effective?.bridge ? 'bridge.configured' : 'bridge.absent') }),
                            t('bridge.saved', { value: t('bridge.configured') }),
                        ].join('\n'), [
                            ...(fresh.restartRequired ? [{ value: 'restart', label: t('bridge.restart') }] : fresh.effective?.bridge && host.execute ? [{ value: 'model', label: t('bridge.model') }] : []),
                            ...(host.execute ? [{ value: 'ready', label: t('bridge.ready') }] : []),
                            { value: 'close', label: t('bridge.close') },
                        ], host.guard);
                        if (next === 'restart') {
                            await show(t('bridge.restart'), t('bridge.restartBody', { command: host.restartCommand }), host.guard);
                            continue;
                        }
                        if (next === 'model' || next === 'ready') {
                            await host.execute?.(next === 'model' ? '/model' : '/ready');
                            return 'completed' as const;
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
