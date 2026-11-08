import type { RecoveryNavigation } from './recovery-navigation.js';
import { registerHostedTarget } from './integration-hosted-target-form.js';
import { editIntegrationPaths } from './integration-target-paths.js';
import { browseFirstIntegration } from './integration-start-browser.js';
import { browseIntegrationDelegation } from './integration-delegation-browser.js';
import type { Controller } from '../controller/controller.js';
import type { RegisterLocalTarget } from '../controller/effect-types.js';
import { captureLocalReceiverInput } from '../controller/integration-registration-input.js';
import { showExactInspection, showExactReview, type ReviewPageHost } from './exact-review.js';
import { translator, uiText, type UiLocale } from './i18n.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { quoteIdentity } from './inspection-text.js';
interface Host extends RecoveryNavigation, UiChoiceHost, ReviewPageHost {
    locale?: UiLocale;
    guard(): void;
    input(title: string, value: string): Promise<string | undefined>;
    register(request: RegisterLocalTarget, fresh: () => void): Promise<{
        targetId: string;
    } | undefined>;
    registerHosted?: Parameters<typeof registerHostedTarget>[0]['register'];
    first?: Parameters<typeof browseFirstIntegration>[0];
}
type RetainedReceiver = Extract<ReturnType<Controller['inspectIntegrationTarget']>, { state: 'RETAINED' }>;
function receiverIdentity(row: RetainedReceiver): string {
    const { target } = row.configuration;
    return quoteIdentity(row.family === 'local-git' ? target.canonicalPath : `${target.owner}/${target.repository}`);
}
/** Target observations only. Work delegation and preparation remain separate actions. */
export async function browseIntegrationTargets(host: Host, c: Controller, projectId: string | null, result?: { workId: string; assertCurrent(): void }) {
    if (result) {
        if (projectId === null) throw Error('Result delivery requires its original project');
        const original = host;
        const guard = () => { original.guard(); result.assertCurrent(); };
        host = { ...original, guard,
            register: (request, fresh) => {
                guard();
                if (request.projectId !== projectId) throw Error('Result delivery must keep its original project');
                return original.register(request, fresh);
            },
            ...(original.registerHosted ? { registerHosted: (request, fresh) => {
                guard();
                if (request.projectId !== projectId) throw Error('Result delivery must keep its original project');
                return original.registerHosted!(request, fresh);
            } } : {}),
            ...(original.first ? { first: { ...original.first, guard: () => { guard(); original.first!.guard(); } } } : {}),
        };
    }
    let before: string | undefined, completed = false;
    const locale = host.locale ?? 'en';
    const t = translator(locale);
    const newer: (string | undefined)[] = [];
    const register = async () => {
        const staged: RegisterLocalTarget = { projectId: projectId ?? '', path: '', ref: 'refs/heads/main', basisCommit: '', publicationInventory: [], authorizedDeltaPaths: [] };
        const fields = [
            ['path', 'integration.localPath', 'integration.localPathInput'],
            ['ref', 'integration.localRef', 'integration.localRefInput'],
            ['basisCommit', 'integration.localBasis', 'integration.localBasisInput'],
            ['publicationInventory', 'integration.localPublication', 'integration.localPublicationInput'],
            ['authorizedDeltaPaths', 'integration.localDelta', 'integration.localDeltaInput'],
        ] as const;
        while (true) {
            host.guard();
            const selected = await chooseUiItem(host, result ? t('integration.localFixed', { project: projectId! }) : t('integration.localStaged'), [
                ...result ? [] : [{ value: 'project', label: t('integration.localProject', { value: staged.projectId || t('integration.localChooseProject') }) }],
                ...fields.map(([value, label]) => {
                    const entry = staged[value];
                    return { value, label: t(label, { value: typeof entry === 'string' ? entry || t('integration.localRequired') : entry.length }) };
                }),
                { value: 'review', label: t('integration.localReview') },
                { value: 'back', label: t('integration.localBack') },
            ]);
            host.guard();
            if (!selected || selected === 'back')
                return;
            if (selected === 'project') {
                if (result) throw Error('Result delivery keeps its original project');
                const projects = c.listProjects();
                const pick = await chooseUiItem(host, t('integration.localProjects'), [
                    ...projects.map(p => ({ value: 'project:' + p.id, label: p.id + ' · ' + p.sourceRoot })),
                    ...(!projects.length && host.navigate ? [{ value: 'setup', label: t('integration.localProjectSetup') }] : []),
                    { value: 'back', label: t('integration.choice.listBack') },
                ]);
                host.guard();
                if (!pick || pick === 'back')
                    continue;
                if (pick === 'setup') {
                    const outcome = await host.navigate!('/project');
                    if (outcome !== 'cancelled')
                        return outcome;
                    host.guard();
                    continue;
                }
                const project = projects.find(p => 'project:' + p.id === pick);
                if (!project)
                    throw Error('Unknown source project');
                staged.projectId = project.id;
                continue;
            }
            const field = fields.find(([key]) => key === selected);
            if (field) {
                const [key, , title] = field;
                if (key === 'publicationInventory' || key === 'authorizedDeltaPaths') {
                    staged[key] = await editIntegrationPaths(host, staged[key], t(title));
                    continue;
                }
                const value = await host.input(t(title), staged[key]);
                host.guard();
                if (value !== undefined)
                    staged[key] = value;
                continue;
            }
            if (selected !== 'review')
                throw Error('Unknown integration receiver field');
            const project = c.listProjects().find(p => p.id === staged.projectId);
            const captured = project ? captureLocalReceiverInput(staged) : { issue: 'project' } as const;
            if ('issue' in captured) {
                await host.show(t('integration.registrationFields'), t(`integration.localInput.${captured.issue}`));
                host.guard();
                continue;
            }
            const request = captured.request;
            const fresh = () => {
                host.guard();
                if (JSON.stringify(c.listProjects().find(p => p.id === request.projectId)) !== JSON.stringify(project))
                    throw Error('Original project changed; reopen receiver registration');
            };
            if (!await showExactReview(host, t('integration.localReviewTitle'), {
                scope: t('integration.localReviewScope'), project, request,
            }, fresh, t('integration.localReviewFooter'), locale))
                continue;
            const decision = await chooseUiItem(host, t('integration.localConfirmTitle'), [
                { value: 'back', label: t('integration.localConfirmBack') },
                { value: 'register', label: t('integration.localConfirm') },
            ]);
            fresh();
            if (decision !== 'register')
                continue;
            const registered = await host.register(request, fresh);
            host.guard();
            if (registered) {
                completed = true;
                await host.show(t('integration.localRegistered'), JSON.stringify(c.inspectIntegrationTarget(registered.targetId), null, 2));
                host.guard();
                return;
            }
        }
    };
    while (true) {
        host.guard();
        const page = c.listIntegrationTargets({ limit: 25, ...before ? { before } : {}, ...(result && projectId !== null ? { projectId } : {}) });
        const emptyResult = result && !page.targets.length && !before && !page.nextCursor;
        const title = result ? [
            t('integration.receiverList', { project: quoteIdentity(projectId!), work: result.workId }),
            ...(emptyResult ? [t('integration.receiverListEmpty')] : []),
        ].join('\n') : 'Integration targets · retained observations only';
        const listBack = { value: 'back', label: result ? t('integration.choice.listBack') : 'Back' };
        const selected = await chooseUiItem(host, title, [
            ...emptyResult ? [listBack] : [],
            ...page.targets.map(row => ({
                value: 'target:' + row.targetId,
                label: row.state === 'RETAINED'
                    ? `${result ? receiverIdentity(row) : row.family + ' · ' + row.projectId} · ${JSON.stringify(row.ref)} · ${row.targetId}`
                    : result ? t('integration.receiverListUnavailable', { id: quoteIdentity(row.targetId) }) : `Unavailable integration target · ${row.targetId}`,
            })),
            { value: 'local', label: result ? t('integration.receiverRegisterLocal') : 'Register local bare receiver' },
            ...host.registerHosted ? [{ value: 'hosted', label: result ? t('integration.receiverRegisterHosted') : 'Register GitHub branch receiver' }] : [],
            ...page.nextCursor ? [{ value: 'older', label: result ? t('integration.receiverOlder') : 'Older targets' }] : [],
            ...newer.length ? [{ value: 'newer', label: result ? t('integration.receiverNewer') : 'Newer targets' }] : [],
            { value: 'refresh', label: result ? t('integration.receiverRefresh') : 'Refresh target list' },
            ...emptyResult ? [] : [listBack],
        ]);
        host.guard();
        if (!selected || selected === 'back')
            return completed;
        if (selected === 'local') {
            const outcome = await register();
            if (outcome)
                return outcome;
            before = undefined;
            newer.length = 0;
            continue;
        }
        if (selected === 'hosted' && host.registerHosted) {
            const outcome = await registerHostedTarget({ ...host, register: host.registerHosted }, c, projectId, !!result);
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            before = undefined;
            newer.length = 0;
            continue;
        }
        if (selected === 'refresh')
            continue;
        if (selected === 'older' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (selected === 'newer' && newer.length) {
            before = newer.pop();
            continue;
        }
        const row = page.targets.find(row => 'target:' + row.targetId === selected);
        if (!row)
            throw Error('Unknown retained integration target');
        const current = c.inspectIntegrationTarget(row.targetId);
        if (JSON.stringify(current) !== JSON.stringify(row))
            throw Error('Original target changed; refresh its list');
        const expected = result && host.first && current.state === 'RETAINED'
            ? c.inspectFirstIntegrationPreparation(result.workId, row.targetId)
            : undefined;
        const continuation = expected?.originals.length ? 'integration.receiverOpen' : 'integration.receiverPrepare';
        const back = { value: 'back', label: result ? uiText(locale, 'integration.choice.back') : 'Back' };
        const action = await chooseUiItem(host, result
            ? current.state === 'RETAINED'
                ? uiText(locale, 'integration.receiverActions', { receiver: receiverIdentity(current), ref: quoteIdentity(current.ref), id: current.targetId })
                : uiText(locale, 'integration.receiverUnavailable', { id: current.targetId })
            : 'Original integration target · actions', [
            ...result ? [back] : [],
            { value: 'inspect', label: result ? uiText(locale, 'integration.receiverInspect') : 'Inspect observed identity' },
            ...current.state === 'RETAINED' ? [
                { value: 'delegate', label: result ? uiText(locale, 'integration.receiverDelegate') : 'Delegate ordinary integration to owner work' },
                ...host.first ? [{ value: 'continue', label: result ? uiText(locale, continuation) : 'Prepare first integration for owner work' }] : [],
            ] : [],
            ...result ? [] : [back],
        ]);
        host.guard();
        if (JSON.stringify(c.inspectIntegrationTarget(row.targetId)) !== JSON.stringify(current))
            throw Error('Original target changed; refresh its list');
        if (!action || action === 'back')
            continue;
        if (action === 'delegate') {
            const outcome = await browseIntegrationDelegation(host, c, row.targetId, result?.workId, !!result);
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            continue;
        }
        if (action === 'continue' && host.first) {
            const outcome = await browseFirstIntegration(host.first, c, row.targetId, result?.workId, expected?.contextFingerprint);
            // Existing-original review can transfer the result pin to that operation.
            if (expected?.originals.length === 0 && (!outcome || outcome === 'cancelled'))
                continue;
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            if (result)
                return completed;
            continue;
        }
        if (action !== 'inspect')
            throw Error('Unknown integration target action');
        await showExactInspection(host, 'Original integration target · observed identity only', { scope: 'Historical target registration, not refreshed permission, a grant, a prepared change or a send. Unknown/malformed targets stay retained. Hosted registration and work/delegation/preparation have their separate entries.', target: current }, () => {
            host.guard();
            if (JSON.stringify(c.inspectIntegrationTarget(row.targetId)) !== JSON.stringify(current))
                throw Error('Original target changed; refresh its list');
        }, 'no native request', host.locale ?? 'en');
    }
}
