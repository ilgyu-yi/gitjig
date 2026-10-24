import type { ApplicationStartup, StartupConfiguration } from '../app/startup.js';
interface Host {
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show?(title: string, text: string): Promise<void>;
    guard(): void;
    notice(text: string): void;
}
const policy = '{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}';
/** Edits only gitjig's next-launch file. External policy/account directories are prerequisites. */
export async function editBridgeFields(h: Host, edit: Awaited<ReturnType<ApplicationStartup['prepareBridgeEdit']>>) {
    const guard = () => { h.guard(); edit.assertCurrent(); }, show = async (title: string, value: unknown) => {
        guard();
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        if (h.show)
            await h.show(title, text);
        else
            await h.choose(title, [text, 'Back']);
        guard();
    };
    let staged = { cwd: edit.bridge?.profile.cwd ?? '', agentDir: edit.bridge?.profile.agentDir ?? '', executable: edit.bridge?.profile.executable.file ?? '', sha256: edit.bridge?.profile.executable.sha256 ?? '', nativeAccountDirectory: edit.bridge?.nativeAccountDirectory ?? '', nativeAccountHome: edit.bridge?.nativeAccountHome ?? '' };
    await show('Bridge prerequisites · no client or account is started', { directories: 'Existing canonical owner-private host, agent, agent/home and native account directories outside projects and application work/state roots.', policyFile: 'agentDir/claude-bridge.json must contain the fixed policy below; optional host .pi/claude-bridge.json must match.', fixedPolicy: policy, executable: 'Existing canonical trusted executable with an explicit SHA256 pin. No automatic hash refresh.', nativeLogin: 'An optional default-home login route can be selected separately. It changes only the native child HOME and requires native account directory HOME/.claude; the Pi home stays private.', runtime: 'A saved runtime plus bridge needs an explicit Docker configuration directory.', scope: 'No external file creation, account reading/copying, login, native client execution or active model change. Save applies on next launch only.' });
    while (true) {
        guard();
        const action = await h.choose('Bridge setup · staged values · next launch only', ['Edit bridge paths and executable pin', 'Choose native default-home login', 'Review and save bridge', 'Remove bridge for next launch', 'Cancel']);
        guard();
        if (!action || action === 'Cancel')
            return 'cancelled' as const;
        if (action === 'Edit bridge paths and executable pin') {
            const next = { ...staged };
            let cancelled = false;
            for (const [key, title] of [['cwd', 'Bridge host directory · canonical private path'], ['agentDir', 'Bridge agent directory · canonical private path'], ['nativeAccountDirectory', 'Native Claude Code account directory · explicit private path'], ['executable', 'Pinned Claude executable · canonical trusted path'], ['sha256', 'Executable SHA256 · explicit full lowercase pin']] as const) {
                const value = await h.input(title, next[key]);
                guard();
                if (value === undefined) {
                    cancelled = true;
                    break;
                }
                next[key] = value;
            }
            if (!cancelled)
                staged = next;
            continue;
        }
        if (action === 'Choose native default-home login') {
            await show('Native default-home login · explicit shared account route', 'Optional: enter the existing home used by native Claude Code when CLAUDE_CONFIG_DIR is absent. Only the native child uses this HOME; Pi stays in its private agent home. Choosing a home also stages its HOME/.claude account directory. This route can select a different account from an explicit account directory. Login/refresh may update that native account and HOME/.claude.json. No login or credential reading/copying occurs here. Leave blank to use the explicit account-directory route.');
            const value = await h.input('Native Claude Code account home · optional canonical path; blank uses explicit directory', staged.nativeAccountHome);
            guard();
            if (value !== undefined)
                staged = { ...staged, nativeAccountHome: value, ...(value ? { nativeAccountDirectory: value + '/.claude' } : {}) };
            continue;
        }
        if (action !== 'Review and save bridge' && action !== 'Remove bridge for next launch')
            throw Error('Unknown bridge setup action');
        const bridge: StartupConfiguration['bridge'] = action === 'Remove bridge for next launch' ? undefined : { profile: { kind: 'installed-claude-bridge', cwd: staged.cwd, agentDir: staged.agentDir, executable: { file: staged.executable, sha256: staged.sha256 } }, nativeAccountDirectory: staged.nativeAccountDirectory, ...(staged.nativeAccountHome ? { nativeAccountHome: staged.nativeAccountHome } : {}) };
        let valid: StartupConfiguration;
        try {
            valid = await edit.validate(bridge, guard);
        }
        catch (error) {
            guard();
            await show('Bridge setup unavailable · staged values retained', { reason: error instanceof Error ? error.message : 'Validation unavailable', paths: { host: staged.cwd, agent: staged.agentDir, agentHome: staged.agentDir + '/home', policy: staged.agentDir + '/claude-bridge.json', account: staged.nativeAccountDirectory, ...(staged.nativeAccountHome ? { nativeHome: staged.nativeAccountHome, nativeAccountSettings: staged.nativeAccountHome + '/.claude.json' } : {}), executable: staged.executable }, fixedPolicy: policy, nextAction: 'Prepare or repair these explicit prerequisites outside gitjig, then edit/review again. Existing runtime, active choices and external files were kept.' });
            continue;
        }
        guard();
        await show('Review next-launch bridge setup', { bridge: valid.bridge ?? null, preservedRuntime: valid.runtime ?? null, activeChanged: false, scope: 'Save updates only application startup. Existing account identity, active models and retained work are not changed or authenticated.' });
        const label = bridge ? 'Save bridge for next launch' : 'Remove bridge for next launch', decision = await h.choose('Explicit bridge setup action', ['Back without saving', label]);
        guard();
        if (!decision || decision === 'Back without saving')
            continue;
        if (decision !== label)
            throw Error('Unknown bridge save action');
        try {
            await edit.save(bridge, guard);
        }
        catch (error) {
            guard();
            await show('Bridge setup save unavailable · staged values retained', { reason: error instanceof Error ? error.message : 'Save unavailable', nextAction: 'Recheck prerequisites and review again; no active setup change is claimed.' });
            continue;
        }
        h.notice(bridge ? 'Bridge saved for next launch · close normally and relaunch · account availability not checked' : 'Bridge removed for next launch · active bridge retained until close');
        return 'completed' as const;
    }
}
