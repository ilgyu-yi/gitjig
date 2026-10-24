import { chooseRecoveryEntry } from './recovery-navigation.js';
import { localEvidenceCommands } from './local-evidence-commands.js';
import { localCheckCommands } from './local-check-commands.js';
import { statSync, realpathSync } from 'node:fs';
import type { Controller } from '../controller/controller.js';
import type { HostCommand, HostCommandExecutor } from './host-commands.js';
import { ApplicationLocalConventions, recommendedLocalConventions } from '../app/local-conventions.js';
import { inspectLocalGit } from '../controller/local-git.js';
import { prepareLocalChange } from '../controller/local-preparation.js';
import { editLocalConventions } from './local-conventions-editor.js';
import { localConventionsSummary, localGitSummary, localPreparationSummary } from './local-presentation.js';
interface Host {
    execute?: HostCommandExecutor;
    controller: Controller;
    isCurrent(target: string): boolean;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    notice(text: string): void;
}
const display = (value: unknown) => { const text = JSON.stringify(value, null, 2); return text.length > 32768 ? text.slice(0, 32768) + '\n[Shortened; use the corresponding local CLI command for full observations]' : text; };
/** Explicit human local actions, independent of model/agent procedures. No Git mutation. */
export function localCommands(host: Host) {
    const c = host.controller, abort = new AbortController(), owned = new Set<Promise<unknown>>();
    let closing = false;
    const cleanupFailures = new Set<unknown>();
    const track = <T>(task: Promise<T>) => {
        owned.add(task);
        void task.then(() => owned.delete(task), error => {
            owned.delete(task);
            if (['LOCAL_GIT_CLEANUP_UNKNOWN', 'LOCAL_EVIDENCE_CLEANUP_UNKNOWN'].includes(error?.code))
                cleanupFailures.add(error);
        });
        return task;
    };
    const commands: HostCommand[] = [{ name: 'local', description: 'Local Git, conventions, isolated checks and historical commit correspondence', run: async (_argument, source, context) => {
                const before = c.inspectConversation(source), choice = c.getConversationModelChoice(source);
                if (!before.projectId) {
                    if (!host.execute)
                        throw Error('Select or register the intended project with /project, then reopen /local. No local action was started.');
                    const outcome = await chooseRecoveryEntry({
                        choose: host.choose,
                        navigate: (command: string) => host.execute!(command, source, context),
                    }, () => {
                        if (!host.isCurrent(source) || c.inspectConversation(source).generation !== before.generation || c.inspectConversation(source).projectId !== before.projectId)
                            throw Error('Local source changed; reopen /local');
                    }, [{ command: '/project', label: 'Select or register a project' }]);
                    return outcome ?? 'cancelled';
                }
                const project = c.listProjects().find(p => p.id === before.projectId);
                if (!project)
                    throw Error('Selected registered project is unavailable; reopen /project');
                const rootIdentity = statSync(project.sourceRoot, { bigint: true });
                let completed = false, savedRevision: number | undefined, gitBinary = '/usr/bin/git', messageFile = '';
                const guard = () => {
                    abort.signal.throwIfAborted();
                    let root;
                    try {
                        root = statSync(project.sourceRoot, { bigint: true });
                        if (realpathSync(project.sourceRoot) !== project.sourceRoot || !root.isDirectory() || root.dev !== rootIdentity.dev || root.ino !== rootIdentity.ino)
                            throw Error();
                    }
                    catch {
                        throw Error('Local project source was replaced or is unavailable; reopen /local for the intended project ' + project.id);
                    }
                    const now = c.inspectConversation(source), current = c.listProjects().find(p => p.id === project.id);
                    if (closing || !host.isCurrent(source) || now.generation !== before.generation || now.projectId !== before.projectId || now.archived || now.deleted || c.getConversationModelChoice(source).revision !== choice.revision || current?.sourceRoot !== project.sourceRoot)
                        throw Error('Local form source changed; reopen /local for the intended project ' + project.id + '.' + (savedRevision === undefined ? '' : ' Saved conventions remain at revision ' + savedRevision + '.'));
                };
                const choose = async (title: string, labels: string[]) => { guard(); const picked = await host.choose(title, labels); guard(); return picked; }, input = async (title: string, value = '') => { guard(); const text = await host.input(title, value); guard(); return text; }, show = async (title: string, value: unknown) => { guard(); await host.show(title, typeof value === 'string' ? value : display(value)); guard(); }, notice = (text: string) => { guard(); host.notice(text); };
                const inputGit = async () => {
                    const selected = await input('Trusted Git executable · absolute path outside projects', gitBinary);
                    if (selected !== undefined) gitBinary = selected;
                    return selected;
                };
                const localHost = { ...host.execute ? { navigate: async (command: string) => { guard(); return host.execute!(command, source, context); } } : {}, controller: c, projectId: project.id, signal: abort.signal, guard, choose, input, inputGit, show, notice, track };
                const evidence = localEvidenceCommands(localHost), checks = localCheckCommands({ ...localHost, evidence: evidence.check });
                while (true) {
                    const action = await choose('Local development · ' + project.id + ' · ' + project.sourceRoot, ['Inspect Git changes and history', 'Inspect local conventions', 'Edit local conventions', 'Prepare staged change', 'Run new isolated check', 'Retained local checks', 'Retained candidates and commit audit', 'Close']);
                    if (!action || action === 'Close')
                        return completed ? 'completed' : 'cancelled';
                    if (action === 'Run new isolated check') {
                        const outcome = await checks.newCheck();
                        if (typeof outcome === 'string')
                            return outcome;
                        completed = outcome || completed;
                        continue;
                    }
                    if (action === 'Retained local checks') {
                        const outcome = await checks.browse();
                        if (outcome)
                            return outcome;
                        continue;
                    }
                    if (action === 'Retained candidates and commit audit') {
                        await evidence.browse();
                        continue;
                    }
                    if (action === 'Inspect local conventions') {
                        await show('Local conventions · inspection does not apply recommendations', localConventionsSummary(new ApplicationLocalConventions(c).inspect(project.id)));
                        continue;
                    }
                    if (action === 'Edit local conventions') {
                        const app = new ApplicationLocalConventions(c), edit = app.prepare(project.id), rules = await editLocalConventions({ choose, input, guard, notice }, edit.view.rules ?? recommendedLocalConventions(), edit.view.revision);
                        if (!rules)
                            continue;
                        guard();
                        edit.assertCurrent();
                        const saved = app.set(project.id, edit.view.revision, rules);
                        savedRevision = saved.revision;
                        completed = true;
                        notice('Local conventions saved · ' + project.id + ' · revision ' + saved.revision + ' · no repository or agent policy changed');
                        await show('Saved local conventions', localConventionsSummary(saved));
                        continue;
                    }
                    if (!['Inspect Git changes and history', 'Prepare staged change'].includes(action))
                        throw Error('Unknown local action');
                    const app = action === 'Prepare staged change' ? new ApplicationLocalConventions(c) : undefined;
                    if (app?.inspect(project.id).rules === null) {
                        await show('Preparation unavailable · configure local conventions first', 'Preparation is unavailable (UNAVAILABLE).\n\nChoose Edit local conventions, review the values, and explicitly Save staged conventions before preparing a change. Recommendations are not applied automatically. No check or Git command ran.');
                        continue;
                    }
                    const binary = await inputGit();
                    if (binary === undefined)
                        continue;
                    let message: string | undefined;
                    if (action === 'Prepare staged change') {
                        message = await input('Owned UTF-8 commit message file · canonical absolute path', messageFile);
                        if (message === undefined)
                            continue;
                    }
                    guard();
                    notice('Reading local project ' + project.id + ' · no stage, commit, check or remote request');
                    const result = action === 'Prepare staged change'
                        ? localPreparationSummary(await track(prepareLocalChange({ conventions: app!, projectId: project.id, messageFile: message!, gitBinary: binary, projectRoots: c.listProjects().map(p => p.sourceRoot), installationHome: c.applicationHome(), signal: abort.signal })))
                        : localGitSummary(await track(inspectLocalGit({ project, projectRoots: c.listProjects().map(p => p.sourceRoot), installationHome: c.applicationHome(), gitBinary: binary, signal: abort.signal })));
                    guard();
                    gitBinary = binary;
                    if (message !== undefined)
                        messageFile = message;
                    completed = true;
                    await show(action === 'Prepare staged change' ? 'Staged preparation · rules only, not tested candidate or commit approval' : 'Local Git observation · stable configuration required', result);
                }
            } }];
    return { commands: commands.map(command => ({ ...command, run: (...args: Parameters<HostCommand['run']>) => track(Promise.resolve(command.run(...args))) })), async close() {
            closing = true;
            abort.abort(Error('Local UI closing'));
            while (owned.size)
                await Promise.allSettled([...owned]);
            if (cleanupFailures.size === 1)
                throw [...cleanupFailures][0];
            if (cleanupFailures.size > 1)
                throw new AggregateError([...cleanupFailures], 'Local cleanup remains uncertain: ' + [...cleanupFailures].map(error => error && typeof error === 'object' && 'recovery' in error ? String(error.recovery) : String(error)).join(' | '));
        } };
}
