import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';
import type { RuntimeProfile } from '../controller/types.js';
import type { ApplicationStartup } from '../app/startup.js';
import { runtimePrerequisites, runtimeImageBuildHelp } from './runtime-setup-help.js';
interface Host extends UiChoiceHost {
    locale?: UiLocale;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    show?(title: string, text: string): Promise<void>;
    runPreparation?<T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>): Promise<T>;
    guard(): void;
    notice(text: string): void;
}
/** Preparation is explicit; the original startup validator/storage owns Save. */
export async function editRuntimeFields(host: Host, edit: Awaited<ReturnType<ApplicationStartup['prepareRuntimeEdit']>>) {
    const t = translator(host.locale ?? 'en');
    const actionCopy = {
        'Interactive runtime installer': 'runtime.install',
        'Suggest local Docker paths': 'runtime.suggest',
        'Edit runtime fields': 'runtime.edit',
        'Choose Docker context': 'runtime.context',
        'Choose existing runtime image': 'runtime.image',
        'Prepare an execution image': 'runtime.build',
        'Extra image packages': 'runtime.packages',
        'Check runtime connection and image': 'runtime.check',
        'Review and save runtime': 'runtime.review',
        'Runtime setup help': 'runtime.help',
        'Cancel': 'runtime.cancel',
        'Use these paths': 'runtime.usePaths',
        'Back without changes': 'runtime.backChanges',
        'Back without building': 'runtime.backBuild',
        'Build execution image': 'runtime.buildConfirm',
        'Back': 'runtime.back',
        'Check connection and image': 'runtime.checkConfirm',
        'Save and apply runtime': 'runtime.save',
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
    const explain = async (title: string, text: string) => {
        guard();
        if (host.show)
            await host.show(title, text);
        else
            await host.choose(title, [text, 'Back']);
        guard();
    };
    const fields = [
        ['dockerBinary', t('runtime.dockerField')],
        ['dockerContext', t('runtime.contextField')],
        ['image', t('runtime.imageField')],
        ['dockerConfigDirectory', t('runtime.configField')],
    ] as const;
    const descriptions: Record<typeof fields[number][0], string> = {
        dockerBinary: 'Docker CLI executable on this computer. Use command -v docker in your shell to locate it, then enter its resolved absolute file path. Example: /usr/local/bin/docker. Use a trusted executable outside registered projects.',
        dockerContext: 'Named connection to the Docker backend that runs project commands. Examples: colima, desktop-linux. Use Choose Docker context to list existing names from your Docker configuration.',
        image: 'Prepared Linux image with project tools and the gitjig I/O helper. Use Choose existing runtime image, or Prepare an execution image to build the installed recipe here. Enter sha256: plus 64 lowercase hex digits, or a repository@sha256: digest. Tags such as latest are not accepted.',
        dockerConfigDirectory: 'Existing Docker client configuration directory. Examples: /Users/alice/.docker, /home/alice/.docker. Enter the resolved absolute directory path, not config.json. Required for candidate discovery and a saved Claude Code bridge; otherwise blank omits this setting.',
    };
    let staged = Object.fromEntries(fields.map(([key]) => [key, edit.runtime?.[key] ?? ''])) as Record<typeof fields[number][0], string>;
    let extraPackages = '';
    let suggested = false, nextAction: string | undefined, pendingAction: string | undefined;
    const recover = async (title: string, error: unknown, alternatives: string[]) => {
        guard();
        await explain(title, `${error instanceof Error ? error.message : String(error)}\n\nPrevious staged values and saved settings are kept. Completed package, VM or engine effects may remain.`);
        if ((error as {
            code?: string;
        })?.code === 'RUNTIME_PREPARATION_CANCELLED')
            return;
        const hasRoute = !!staged.dockerBinary && !!staged.dockerConfigDirectory && !!staged.dockerContext;
        const candidates = [...(!staged.dockerBinary || !staged.dockerConfigDirectory ? ['Suggest local Docker paths'] : []), ...alternatives]
            .filter((action, index, all) => all.indexOf(action) === index)
            .filter(action => action !== 'Prepare an execution image' || hasRoute)
            .filter(action => action !== 'Check runtime connection and image' || hasRoute && !!staged.image);
        const selected = await chooseActions(t('runtime.recovery'), ['Back to runtime setup', ...candidates]);
        guard();
        if (selected && selected !== 'Back to runtime setup') {
            if (!candidates.includes(selected))
                throw Error('Unknown runtime recovery action');
            pendingAction = selected;
        }
    };
    while (true) {
        guard();
        const recommended = nextAction ?? (staged.dockerBinary && staged.dockerContext && staged.image ? 'Review and save runtime' :
            !staged.dockerBinary || !staged.dockerConfigDirectory ? suggested ? 'Edit runtime fields' : 'Suggest local Docker paths' :
                !staged.dockerContext ? 'Choose Docker context' : 'Choose existing runtime image');
        const actions = ['Interactive runtime installer', 'Suggest local Docker paths', 'Edit runtime fields', 'Choose Docker context', 'Choose existing runtime image', 'Prepare an execution image', 'Extra image packages', 'Check runtime connection and image', 'Review and save runtime', 'Runtime setup help', 'Cancel'];
        const action = pendingAction ?? await chooseActions(t('runtime.title'), [recommended, ...actions.filter(label => label !== recommended)]);
        pendingAction = undefined;
        guard();
        if (!action || action === 'Cancel')
            return 'cancelled' as const;
        nextAction = undefined;
        if (action === 'Interactive runtime installer') {
            if (!host.runPreparation) {
                await explain('Interactive installer', 'Run node runtime/setup.mjs from the installed package or source checkout to prepare an existing Docker route or Colima on macOS/Linux.');
                continue;
            }
            let explanation = '';
            try {
                const helper = await import(new URL('../../runtime/setup.mjs', import.meta.url).href);
                const built = await edit.prepareInteractive(staged, guard, {
                    extraPackages,
                    choose: async (title, labels) => {
                        const detail = explanation;
                        explanation = '';
                        if (detail)
                            await explain(title, detail);
                        const answer = await host.choose(title, labels);
                        guard();
                        return answer;
                    },
                    ask: async (question, value) => {
                        const detail = explanation;
                        explanation = '';
                        const answer = await host.input(question, value, detail);
                        guard();
                        if (answer === undefined)
                            throw Object.assign(Error('Runtime preparation cancelled; saved and staged runtime kept'), { code: 'RUNTIME_PREPARATION_CANCELLED' });
                        return answer;
                    },
                    output: text => { explanation = (explanation + text).slice(-16384); },
                    execute: (file, args, options) => host.runPreparation!(args[0] === 'install' ? 'Installing Colima, Docker and Buildx' : args[0] === 'start' ? 'Starting selected Colima profile' : args[4] === 'build' ? 'Building execution image' : 'Checking preparation tools', (signal, output) => helper.runCommand(file, args, { ...options, signal: AbortSignal.any([signal, options.signal as AbortSignal]), onOutput: output })),
                });
                guard();
                if (built) {
                    staged = { ...staged, dockerBinary: built.dockerBinary, dockerConfigDirectory: built.dockerConfigDirectory ?? '', dockerContext: built.dockerContext, image: built.image };
                    nextAction = 'Review and save runtime';
                }
            }
            catch (error) {
                if ((error as {
                    code?: string;
                })?.code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN')
                    throw error;
                await recover('Runtime preparation stopped · previous staged values retained', error, ['Interactive runtime installer', 'Edit runtime fields', 'Choose Docker context']);
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
            await show('Suggested local Docker paths · review before using', {
                suggested: found, staged: next, scope: 'Local metadata only; Docker was not run. Existing nonblank fields are kept. Context and image require your explicit choice.', nextAction: 'Use these paths to stage, then Choose Docker context and Choose existing runtime image. If a path is missing, open Runtime setup help to prepare Docker or Edit runtime fields for a custom installation.'
            });
            const decision = await chooseActions(t('runtime.stageTitle'), ['Use these paths', 'Back without changes']);
            guard();
            if (decision === 'Use these paths')
                staged = next;
            else
                nextAction = 'Suggest local Docker paths';
            continue;
        }
        if (action === 'Prepare an execution image') {
            try {
                const input = await edit.imageBuildInputs({ dockerBinary: staged.dockerBinary, dockerConfigDirectory: staged.dockerConfigDirectory, dockerContext: staged.dockerContext }, guard);
                guard();
                if (!host.runPreparation) {
                    await explain('Prepare an execution image', runtimeImageBuildHelp(input));
                    nextAction = 'Choose existing runtime image';
                    continue;
                }
                await show('Review execution image build', { route: input, extraPackages: extraPackages || 'standard recipe only',
                    action: 'Build this installed version’s three-file recipe in a fresh temporary context. Downloads and engine build state may remain after cancellation. No project files or credentials enter the context.',
                    save: 'Only a successful immutable image ID is staged. Review and Save remain separate. Choose Interactive runtime installer to prepare Colima or missing Docker/Buildx tools.' });
                const decision = await chooseActions(t('runtime.buildTitle'), ['Back without building', 'Build execution image']);
                guard();
                if (decision !== 'Build execution image')
                    continue;
                const built = await host.runPreparation('Building execution image', (signal, output) => edit.buildImage(input, guard, signal, output, extraPackages));
                guard();
                staged = { ...staged, dockerBinary: built.dockerBinary, dockerConfigDirectory: built.dockerConfigDirectory ?? '', dockerContext: built.dockerContext, image: built.image };
                nextAction = 'Review and save runtime';
                host.notice('Execution image built · immutable ID staged · review and Save and apply runtime to use for subsequent operations');
            }
            catch (error) {
                if ((error as {
                    code?: string;
                })?.code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN')
                    throw error;
                await recover('Image preparation stopped · previous staged values retained', error, ['Prepare an execution image', 'Edit runtime fields', 'Choose Docker context', 'Extra image packages', 'Interactive runtime installer']);
            }
            continue;
        }
        if (action === 'Extra image packages') {
            let value = extraPackages;
            while (true) {
                const answer = await host.input('Extra Debian packages for the next image build', value, 'Optional. Blank uses the standard Node image. Examples: python3 python3-pip build-essential. Enter package names separated by spaces; no shell commands. Packages are installed inside the image. This choice lasts for this form; the built image retains its packages. Advanced custom recipes remain available.');
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
                    await explain('Correct image package names', error instanceof Error ? error.message : String(error));
                }
            }
            continue;
        }
        if (action === 'Check runtime connection and image') {
            if (!host.runPreparation) {
                await explain('Runtime check unavailable', 'Use an interactive application terminal to check the selected engine connection and immutable image.');
                continue;
            }
            await show('Review runtime metadata check', { route: staged, scope: 'Contact the selected engine and inspect image metadata. No container, project code or model runs. This does not verify isolation, shared paths or project tools.' });
            if (await chooseActions(t('runtime.checkTitle'), ['Back', 'Check connection and image']) !== 'Check connection and image')
                continue;
            guard();
            try {
                await host.runPreparation('Checking selected runtime', (signal, output) => edit.checkRuntime({ ...staged, dockerContext: staged.dockerContext }, guard, signal, output));
                guard();
                host.notice('Runtime connection and image found · isolation and project tools not verified · staged settings kept');
            }
            catch (error) {
                if ((error as {
                    code?: string;
                })?.code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN')
                    throw error;
                await recover('Runtime check stopped · staged settings kept', error, ['Check runtime connection and image', 'Edit runtime fields', 'Choose existing runtime image', 'Interactive runtime installer']);
            }
            continue;
        }
        if (action === 'Runtime setup help') {
            const text = [
                'Runtime is the isolated Docker environment where gitjig executes project commands and tests. Model/account settings are separate.',
                runtimePrerequisites,
                ...fields.map(([key, title]) => `${title}\n${descriptions[key]}`),
                'Example paths and context names are illustrations; enter values from your own computer. Saving does not install Docker, start the backend, build or download images, or check image contents.',
                'Edit runtime fields, then Review and save runtime. Save and apply runtime updates subsequent operations in this process and future launches. Existing operations retain their captured runtime. /ready shows current and saved selections.',
            ].join('\n\n');
            await explain('Runtime setup help', text);
            continue;
        }
        if (action === 'Choose Docker context' || action === 'Choose existing runtime image') {
            const kind = action === 'Choose Docker context' ? 'contexts' : 'images', next = { ...staged };
            await show('Explicit Docker discovery', {
                operation: kind === 'contexts' ? 'Read context names from the selected client configuration' : 'List existing image IDs at the selected context endpoint; this may connect and authenticate',
                limits: 'Trusted native client execution is not a sandbox. No engine start, image pull, build or configuration write is requested. Candidates are not qualified runtimes. Cancel preserves staged values.'
            });
            let cancelled = false;
            for (const [key, title] of fields.filter(([key]) => key === 'dockerBinary' || key === 'dockerConfigDirectory' || kind === 'images' && key === 'dockerContext')) {
                const value = await host.input(key === 'dockerConfigDirectory' ? 'Docker configuration directory · required for discovery' : title, next[key], descriptions[key]);
                guard();
                if (value === undefined) {
                    cancelled = true;
                    break;
                }
                next[key] = value;
            }
            if (cancelled)
                continue;
            let result: Awaited<ReturnType<typeof edit.discover>>;
            try {
                result = await edit.discover(kind, { dockerBinary: next.dockerBinary, dockerConfigDirectory: next.dockerConfigDirectory, dockerContext: next.dockerContext }, guard);
            }
            catch (error) {
                if ((error as {
                    code?: string;
                })?.code === 'RUNTIME_DISCOVERY_CLEANUP_UNKNOWN')
                    throw error;
                guard();
                nextAction = 'Edit runtime fields';
                await show('Docker discovery unavailable · staged values retained', {
                    reason: error instanceof Error ? error.message : 'Discovery unavailable', nextAction: 'Check the explicit client/configuration/context or use Edit runtime fields. No complete inventory or runtime qualification is claimed.'
                });
                continue;
            }
            guard();
            if (!result.candidates.length) {
                nextAction = kind === 'images' ? 'Prepare an execution image' : 'Runtime setup help';
                await show('Docker discovery · empty inventory', { ...result, nextAction: 'Use another explicit configuration/context or prepare prerequisites separately. Nothing is selected or saved.' });
                continue;
            }
            const label = await host.choose('Observed ' + kind + ' · select to stage, not save', result.labels);
            guard();
            const selected = label === undefined ? undefined : result.candidates[result.labels.indexOf(label)];
            if (label === undefined)
                continue;
            if (selected === undefined)
                throw Error('Docker discovery selection is no longer available');
            if (!result.candidates.includes(selected))
                throw Error('Docker discovery selection is no longer available');
            next.dockerBinary = result.dockerBinary;
            next.dockerConfigDirectory = result.dockerConfigDirectory;
            if (kind === 'contexts')
                next.dockerContext = selected;
            else
                next.image = selected;
            staged = next;
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
                staged = next;
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
                nextAction: 'Edit the explicit runtime fields and review again. Use an existing trusted executable, context configuration and immutable image. No engine is started or image downloaded.',
            });
            continue;
        }
        await show(t('runtime.reviewTitle'), {
            runtime: valid.runtime, preservedBridge: valid.bridge ?? null, existingOperationsChanged: false,
            scope: 'Save persists and applies this runtime for subsequent operations. Existing operations retain their captured runtime. Bridge changes still require relaunch. Engine availability and image contents are not checked.'
        });
        const decision = await chooseActions(t('runtime.saveTitle'), ['Save and apply runtime', 'Back without saving']);
        guard();
        if (!decision || decision === 'Back without saving')
            continue;
        if (decision !== 'Save and apply runtime')
            throw Error('Unknown runtime save action');
        try {
            await edit.save(runtime, guard);
        }
        catch (error) {
            guard();
            await show('Runtime setup save unavailable · staged values retained', {
                reason: error instanceof Error ? error.message : 'Save unavailable', nextAction: 'Recheck the explicit runtime inputs and review again; no active setup change is claimed.'
            });
            continue;
        }
        host.notice(t('runtime.saved'));
        return 'completed' as const;
    }
}
