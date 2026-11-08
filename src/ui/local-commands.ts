import { chooseRecoveryEntry } from './recovery-navigation.js';
import { localEvidenceCommands } from './local-evidence-commands.js';
import { localCheckCommands } from './local-check-commands.js';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Controller } from '../controller/controller.js';
import type { HostCommand, HostCommandExecutor } from './host-commands.js';
import { ApplicationLocalConventions, recommendedLocalConventions } from '../app/local-conventions.js';
import { inspectLocalGit } from '../controller/local-git.js';
import { LocalMessageInputUnavailable, prepareLocalChange } from '../controller/local-preparation.js';
import { editLocalConventions } from './local-conventions-editor.js';
import { localConventionsSummary, localGitSummary, localPreparationSummary } from './local-presentation.js';
import { translator, type UiLocale } from './i18n.js';
import { showReviewAction, type ReviewPageHost, type ReviewPrimaryAction } from './exact-review.js';
import type { UiChoice } from './choices.js';
import { readSingleLineInput } from './product-input.js';
interface Host extends ReviewPageHost {
    execute?: HostCommandExecutor;
    controller: Controller;
    isCurrent(target: string): boolean;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    chooseItems?(title: string, items: readonly UiChoice[]): Promise<string | undefined>;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    notice(text: string): void;
    locale?(target: string): UiLocale;
    runPreparation?<T>(title: string, task: (signal: AbortSignal) => Promise<T>, presentation: { running: string; cancelling: string; cancelHint: string }): Promise<T>;
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
    const commands: HostCommand[] = [{ name: 'local', descriptionId: 'command.description.local', run: async (_argument, source, context) => {
                const before = c.inspectConversation(source);
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
                const directory = () => {
                    try {
                        const root = lstatSync(project.sourceRoot, { bigint: true });
                        if (root.isDirectory() && realpathSync(project.sourceRoot) === project.sourceRoot) return root;
                    } catch { /* Retained history can be read with the worktree offline. */ }
                };
                const rootIdentity = directory();
                let completed = false, savedRevision: number | undefined, gitBinary = '/usr/bin/git', messageFile = '';
                const guard = () => {
                    abort.signal.throwIfAborted();
                    const now = c.inspectConversation(source), current = c.listProjects().find(p => p.id === project.id);
                    if (closing || !host.isCurrent(source) || now.generation !== before.generation || now.projectId !== before.projectId || now.archived || now.deleted || current?.sourceRoot !== project.sourceRoot)
                        throw Error('Local form source changed; reopen /local for the intended project ' + project.id + '.' + (savedRevision === undefined ? '' : ' Saved conventions remain at revision ' + savedRevision + '.'));
                };
                const hasSource = () => {
                    if (!rootIdentity) return false;
                    const root = directory();
                    return !!root && root.dev === rootIdentity.dev && root.ino === rootIdentity.ino;
                };
                const guardSource = () => {
                    guard();
                    if (!hasSource())
                        throw Error('Local project source was replaced or is unavailable; reopen /local for the intended project ' + project.id);
                };
                const choose = async (title: string, labels: string[]) => { guard(); const picked = await host.choose(title, labels); guard(); return picked; };
                const input = async (title: string, value = '', description?: string) => { guard(); const text = await host.input(title, value, description); guard(); return text; };
                const show = async (title: string, value: unknown, primary?: ReviewPrimaryAction) => {
                    guard();
                    await host.show(title, typeof value === 'string' ? value : display(value), primary);
                    guard();
                };
                const notice = (text: string) => { guard(); host.notice(text); };
                const locale = host.locale?.(source) ?? 'en', t = translator(locale);
                const readOperand = (title: string, initial: string, kind: 'path' | 'commit', fresh = guardSource, failure?: string) =>
                    readSingleLineInput(async (value, issue) => {
                        fresh();
                        const entered = await input(title, value, issue ?? failure);
                        fresh();
                        return entered;
                    }, initial, t('local.operandSingleLine'), kind === 'path'
                        ? value => isAbsolute(value) ? undefined : t('local.absolutePathRequired')
                        : value => value.trim() ? undefined : t('localEvidence.commitRefRequired'));
                const inputGit = async (fresh = guardSource) => {
                    const selected = await readOperand('Trusted Git executable · absolute path outside projects', gitBinary, 'path', fresh);
                    if (selected !== undefined) gitBinary = selected;
                    return selected;
                };
                const withMessageFile = async <T>(title: string, initial: string, fresh: () => void, attempt: (file: string) => Promise<T | undefined>) => {
                    let previous = initial, failure: string | undefined;
                    while (true) {
                        const file = await readOperand(title, previous, 'path', fresh, failure);
                        if (file === undefined)
                            return;
                        fresh();
                        try {
                            return await attempt(file);
                        } catch (error) {
                            if (!(error instanceof LocalMessageInputUnavailable))
                                throw error;
                            previous = file;
                            failure = error.message;
                        }
                    }
                };
                const localHost = { ...host.execute ? { navigate: async (command: string) => { guard(); return host.execute!(command, source, context); } } : {}, controller: c, projectId: project.id, signal: abort.signal, guard, hasSource, guardSource, choose, input, inputGit, show, notice, track };
                const editConventions = async (conventions: ApplicationLocalConventions) => {
                    const edit = conventions.prepare(project.id);
                    const rules = await editLocalConventions({ choose, input, guard: guardSource, notice }, edit.view.rules ?? recommendedLocalConventions(), edit.view.revision);
                    if (!rules) return false;
                    guardSource();
                    edit.assertCurrent();
                    const saved = conventions.set(project.id, edit.view.revision, rules);
                    savedRevision = saved.revision;
                    completed = true;
                    notice('Local conventions saved · ' + project.id + ' · revision ' + saved.revision + ' · no repository or agent policy changed');
                    await show('Saved local conventions', localConventionsSummary(saved));
                    return true;
                };
                const evidence = localEvidenceCommands({ ...localHost, locale, readOperand, withMessageFile }), checks = localCheckCommands({ ...localHost, locale, evidence: evidence.check,
                    ...host.chooseItems ? { chooseItems: async (title, items) => { guard(); const selected = await host.chooseItems!(title, items); guard(); return selected; } } : {},
                    ...host.runPreparation ? { runCheck: <T>(task: (signal: AbortSignal) => Promise<T>) => host.runPreparation!(t('localCheck.progress', { project: project.id }), task,
                        { running: t('localCheck.running'), cancelling: t('localCheck.cancelling'), cancelHint: t('localCheck.cancelHint') }) } : {},
                });
                while (true) {
                    const available = hasSource();
                    const candidates = available ? 'Retained candidates and commit audit' : t('local.retainedCandidates');
                    const readOnly = [t('localCheck.entry.retained'), candidates, 'Close'];
                    const treeActions = ['Inspect Git changes and history', 'Inspect local conventions', 'Edit local conventions', 'Prepare staged change', t('localCheck.entry.new')];
                    const action = await choose('Local development · ' + project.id + ' · ' + project.sourceRoot +
                        (available ? '' : '\n' + t('local.sourceUnavailable')), available ? [...treeActions, ...readOnly] : readOnly);
                    if (!action || action === 'Close')
                        return completed ? 'completed' : 'cancelled';
                    if (action === t('localCheck.entry.retained')) {
                        const outcome = await checks.browse();
                        if (outcome)
                            return outcome;
                        continue;
                    }
                    if (action === candidates) {
                        await evidence.browse();
                        continue;
                    }
                    guardSource();
                    if (action === t('localCheck.entry.new')) {
                        const outcome = await checks.newCheck();
                        if (typeof outcome === 'string')
                            return outcome;
                        completed = outcome || completed;
                        continue;
                    }
                    if (action === 'Inspect local conventions') {
                        await show('Local conventions · inspection does not apply recommendations', localConventionsSummary(new ApplicationLocalConventions(c).inspect(project.id)));
                        continue;
                    }
                    if (action === 'Edit local conventions') {
                        await editConventions(new ApplicationLocalConventions(c));
                        continue;
                    }
                    if (!['Inspect Git changes and history', 'Prepare staged change'].includes(action))
                        throw Error('Unknown local action');
                    const conventions = action === 'Prepare staged change' ? new ApplicationLocalConventions(c) : undefined;
                    if (conventions?.inspect(project.id).rules === null) {
                        const open = await showReviewAction({ show }, 'Preparation unavailable · configure local conventions first',
                            t('localConventions.preparationPrerequisite'), t('localConventions.review'));
                        if (!open || !await editConventions(conventions)) continue;
                    }
                    const binary = await inputGit();
                    if (binary === undefined)
                        continue;
                    const reading = 'Reading local project ' + project.id + ' · no stage, commit, check or remote request';
                    if (conventions) {
                        const title = 'Staged preparation · rules only, not tested candidate or commit approval';
                        while (true) {
                            const prepared = await withMessageFile('Owned UTF-8 commit message file · canonical absolute path', messageFile, guardSource, async message => {
                                notice(reading);
                                const observed = await track(prepareLocalChange({ conventions, projectId: project.id, messageFile: message, gitBinary: binary, projectRoots: c.listProjects().map(p => p.sourceRoot), installationHome: c.applicationHome(), signal: abort.signal }));
                                return { message, observed };
                            });
                            if (!prepared) break;
                            guardSource();
                            const { message, observed } = prepared;
                            messageFile = message;
                            completed = true;
                            const result = localPreparationSummary(observed);
                            if (observed.status !== 'FAIL') {
                                await show(title, result);
                                break;
                            }
                            if (!await showReviewAction({ show }, title, result, t('localConventions.reviewAnotherPreparation'))) break;
                        }
                        continue;
                    }
                    notice(reading);
                    const result = localGitSummary(await track(inspectLocalGit({ project, projectRoots: c.listProjects().map(p => p.sourceRoot), installationHome: c.applicationHome(), gitBinary: binary, signal: abort.signal })));
                    guardSource();
                    completed = true;
                    await show('Local Git observation · stable configuration required', result);
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
