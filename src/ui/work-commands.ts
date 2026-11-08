import { isDeepStrictEqual } from 'node:util';
import type { Controller } from '../controller/controller.js';
import { ControllerError } from '../controller/types.js';
import type { WorkflowCriteriaHold } from '../controller/change-types.js';
import { isWorkSettlementUnconfirmed } from '../controller/work-recovery.js';
import type { HostCommand, HostCommandOutcome, HostCommandExecutor } from './host-commands.js';
import { showExactInspection, showExactReview, type ReviewPageHost } from './exact-review.js';
import { reviewChangeResult } from './change-commands.js';
import { uiText, translator, type UiLocale } from './i18n.js';
import { availableWorkAllowance, limitedSharedAllowanceText, workAllowanceText, type ContinuationAllowanceHold } from './work-allowance-presentation.js';
import { reviewCriteriaRefresh } from './criteria-refresh.js';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { conversationDisplayIdentity, plainTerminalText } from './chrome.js';
import { modelContextPresentation } from './model-context-presentation.js';
import { producerFailurePresentation, roleRequestLimitPresentation } from './planning-failure-presentation.js';
import { ownerActivationGuidance } from './startup-guidance.js';
import { inspectWorkResumeEntry, workOriginLifecycle } from './work-resume-entry.js';
import { escapeDisplayControls } from './inspection-text.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
type WorkRecoveryAction = 'back' | 'browse' | 'result' | 'inspect' | 'resume' | 'replan' | 'cancel-change' | 'criteria' | 'details' | 'obligations' | 'findings' | 'open' | 'restore' | 'cancel-work' | 'startup' | 'ordinary' | 'context' | 'execution' | 'resolution' | 'activation';
/** Bind the choice to the displayed subject and action routing; detailed evidence has its own guards. */
const workMenuSource = (work: ReturnType<Controller['inspectWorkRecovery']>) => [
    work.workId, work.epoch, work.generation, work.sourceId, work.projectId, work.lineageRoot,
    work.state, work.recordedPhase, work.governed, work.kind, work.contextDerived,
    work.sourceConversationId, work.conversationId, work.replanKind, work.activationPending, work.recoveryHold?.kind, work.recoveryHold?.workflowCriteriaBlocksResume, work.heldDirectionCount,
];
const workOriginScope = (work: ReturnType<Controller['inspectWorkRecovery']>) =>
    [work.workId, work.epoch, work.generation, work.sourceId, work.projectId, work.conversationId];
function workRecoveryGuidance(work: ReturnType<Controller['inspectWorkRecovery']>, locale: UiLocale, allowanceHold: ContinuationAllowanceHold, live: boolean) {
    const hold = work.recoveryHold, t = translator(locale);
    const settlementUnconfirmed = isWorkSettlementUnconfirmed(work.state);
    if (!hold && !allowanceHold && !live && !settlementUnconfirmed && !work.heldDirectionCount) return [];
    const continuationGuidance = [
        ...(live ? [t('workRecovery.live')] : []),
        ...(work.heldDirectionCount ? [t('workRecovery.heldDirections', {count:work.heldDirectionCount})] : []),
        ...(allowanceHold ? [t('workRecovery.allowanceNeeded', { action: t(`workRecovery.${allowanceHold}`) })] : []),
        ...(work.governed ? limitedSharedAllowanceText(locale, work) : []),
    ];
    if (!hold) return settlementUnconfirmed
        ? [t('workRecovery.settlementUnconfirmed'), ...continuationGuidance] : continuationGuidance;
    const criteriaHold: WorkflowCriteriaHold | undefined = hold.kind === 'blocked' ? hold.workflowCriteriaHold : undefined;
    let reason: string;
    if (hold.kind === 'blocked') {
        const { roleRequestLimit, ...otherDiagnostics } = hold;
        const failure = modelContextPresentation(hold.modelContextFailure, work.workId, locale)?.title
            ?? roleRequestLimitPresentation(roleRequestLimit, work.workId, locale)?.summary
            ?? producerFailurePresentation({ workId: work.workId, ...otherDiagnostics }, locale)?.title;
        const preview = truncateToWidth(plainTerminalText(hold.blocker ?? '').replace(/\s+/gu, ' ').trim(), 100, '…');
        reason = work.activationPending ? t('workRecovery.activationPending') : criteriaHold ? t(`criteria.recovery.${criteriaHold}`)
            : failure ?? (preview ? t('workRecovery.blocker', {reason:preview}) : t('workRecovery.blocked'));
    } else {
        reason = t(hold.kind === 'settlement' ? 'workRecovery.settlementUnconfirmed' : 'workRecovery.guidanceUnavailable');
    }
    return [reason, ...(criteriaHold === 'unavailable' ? [t('criteria.recovery.unavailableAction')] : []),
        ...continuationGuidance, t('workRecovery.readResult', {action:t('result.view')})];
}
interface WorkHost extends ReviewPageHost, UiChoiceHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    notice(text: string): void;
    activate(target: string): Promise<void>;
    execute?: HostCommandExecutor;
    locale?(target: string): UiLocale;
}
export function workCommands(host: WorkHost): HostCommand[] {
    const c = host.controller;
    return [{ name: 'work', descriptionId: 'command.description.work', argumentHint: '[WORK_ID]', opensInspection: () => true, run: async (argument, target, context) => {
                const source = c.inspectConversation(target), choice = c.getConversationModelChoice(target), language = c.getConversationLanguage(target);
                const locale = host.locale?.(target) ?? 'en', t = translator(locale);
                const shorten = (value: unknown, max = 32768) => { const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); return text.length > max ? text.slice(0, max) + '\n' + t('workRecovery.shortened') : text; };
                const current = () => {
                    const now = c.inspectConversation(target);
                    if (!host.isCurrent(target) || now.generation !== source.generation || now.projectId !== source.projectId || now.archived || now.deleted || c.getConversationModelChoice(target).revision !== choice.revision || c.getConversationLanguage(target).revision !== language.revision)
                        throw Error(t('workRecovery.sourceChanged'));
                };
                const choose = async (title: string, rows: string[]) => {
                    if (new Set(rows).size !== rows.length) throw Error(t('workRecovery.ambiguous'));
                    const selected = await host.choose(title, rows);
                    current();
                    if (selected !== undefined && !rows.includes(selected)) throw Error(t('workRecovery.choiceUnknown'));
                    return selected;
                };
                const reviewForConfirmation = (title: string, value: unknown, fresh: () => void, suffix: string, mayAdvance?: () => Promise<boolean>) =>
                    showExactReview(host, title, value, fresh, suffix, locale, {
                        next: t('review.nextPage'), finish: t('review.openConfirmation'),
                        ...(mayAdvance ? { mayAdvance } : {}),
                    });
                const evidence = async (id: string, kind: 'obligations' | 'findings') => {
                    let cursor: string | undefined;
                    const back: (string | undefined)[] = [];
                    while (true) {
                        current();
                        const page = c.listWorkEvidence(id, kind, cursor), labels = page.items.map(item => `${item.id} · ${kind === 'findings' ? (item.producer?.role ?? t('workRecovery.producerUnavailable')) + ' · ' + (item.disposition?.status ?? t('workRecovery.undisposed')) : (item.data.state ?? t('workRecovery.stateUnavailable')) + ' · ' + (item.data.kind ?? t('workRecovery.obligation'))}`);
                        const picked = await choose(`${kind === 'findings' ? t('workRecovery.findings') : t('workRecovery.obligations')} · #${id}`, [...labels, ...(page.nextCursor ? [t('workRecovery.olderEvidence')] : []), ...(back.length ? [t('workRecovery.newerEvidence')] : []), t('workRecovery.closeEvidence')]);
                        current();
                        if (!picked || picked === t('workRecovery.closeEvidence'))
                            return;
                        if (picked === t('workRecovery.olderEvidence') && page.nextCursor) {
                            back.push(cursor);
                            cursor = page.nextCursor;
                            continue;
                        }
                        if (picked === t('workRecovery.newerEvidence') && back.length) {
                            cursor = back.pop();
                            continue;
                        }
                        const item = page.items[labels.indexOf(picked)];
                        if (!item)
                            throw Error(t('workRecovery.evidenceChanged'));
                        await host.show(t(kind==='findings'?'workRecovery.findingsTitle':'workRecovery.obligationsTitle', {id:item.id}), shorten(item));
                        current();
                    }
                };
                let savedChange = false;
                const finish = (outcome: HostCommandOutcome): HostCommandOutcome =>
                    outcome === 'cancelled' && savedChange ? 'completed' : outcome;
                const inspect = async (id: string, fromRegistry = false): Promise<HostCommandOutcome | 'registry'> => {
                    let known = fromRegistry;
                    const read = () => {
                        try {
                            const work = c.inspectWorkRecovery(id);
                            if (work.workId === id && typeof work.request === 'string')
                                return { work, entry: inspectWorkResumeEntry(c, work, !!host.execute) };
                        } catch (error) {
                            if (!known && error instanceof ControllerError && error.code === 'MISSING_WORK' && error.workId === id)
                                throw error;
                        }
                    };
                    const unavailable = async () => {
                        current();
                        await host.show(t('workRecovery.recordUnavailableTitle', { id: escapeDisplayControls(id) }), t('workRecovery.recordUnavailableBody'));
                        current();
                        return 'cancelled' as const;
                    };
                    let refreshMessage: string | undefined;
                    const showSave = (message: string) => {
                        savedChange = true;
                        refreshMessage = message;
                    };
                    while (true) {
                        current();
                        const observed = read();
                        if (!observed)
                            return unavailable();
                        known = true;
                        let { work } = observed;
                        const {origin, originOpen, originBlocked, originHeld, live, allowanceHold, activationGuide, runtime, resumeAvailable} = observed.entry;
                        const routes = new Map<WorkRecoveryAction, {label:string;command:string}>();
                        if (host.execute && work.governed) {
                            if (work.recoveryHold?.kind !== 'unavailable')
                                routes.set('inspect', {label:t('workRecovery.inspectRoute', {id}), command:`/change inspect ${id}`});
                            if (!live && !originHeld && work.replanKind && (!source.role || work.sourceConversationId && work.sourceConversationId !== target))
                                routes.set('replan', {label:t(work.replanKind === 'verification' ? 'change.verificationReplanAction' : work.replanKind === 'scope' ? 'change.scopeReplanAction' : 'change.checkReplanAction'), command:`/change replan ${id}`});
                            if (resumeAvailable)
                                routes.set('resume', {label:t('workRecovery.resumeRoute', {id}), command:`/change resume ${id}`});
                            if (['ACTIVE', 'BLOCKED', 'INTERRUPTED', 'UNKNOWN', 'QUARANTINED'].includes(work.state))
                                routes.set('cancel-change', {label:t('workRecovery.cancelRoute', {id}), command:`/change cancel ${id}`});
                        }
                        const viewResult = uiText(locale, 'result.view'), refreshCriteria = uiText(locale, 'criteria.entry');
                        const allowanceOptions: Array<[WorkRecoveryAction,string]> = [['execution',t('workRecovery.execution')]];
                        if (work.governed)
                            allowanceOptions.push(['resolution',t('workRecovery.resolution')]);
                        const options: Array<[WorkRecoveryAction,string]> = [
                            ['back',t(fromRegistry ? 'workRecovery.back' : 'workRecovery.backToSource')],
                            ...(work.kind === 'ordinary-conversation' && isWorkSettlementUnconfirmed(work.state)
                                ? [['startup',t('workRecovery.startup')] as [WorkRecoveryAction,string]] : []),
                            ...(activationGuide ? [['activation',t('workRecovery.activation')]] as Array<[WorkRecoveryAction,string]> : []),
                            ...allowanceOptions.filter(([action]) => action === allowanceHold),
                            ...(work.governed ? [['result',viewResult] as [WorkRecoveryAction,string]] : []),
                            ...[...routes].map(([action,route]):[WorkRecoveryAction,string]=>[action,route.label]),
                            ...(work.governed && !source.role ? [['criteria',refreshCriteria] as [WorkRecoveryAction,string]] : []),
                            ['details',t('workRecovery.details')], ['obligations',t('workRecovery.obligationsCount',{count:work.obligations})], ['findings',t('workRecovery.findingsCount',{count:work.findings})],
                            ...(originOpen ? [['open',t('workRecovery.open')] as [WorkRecoveryAction,string]] : []),
                            ...(origin?.archived && !origin.deleted ? [['restore',t('workRecovery.reviewArchivedOrigin')] as [WorkRecoveryAction,string]] : []),
                            ...(!work.governed && ['ordinary-conversation','investigation'].includes(work.kind) && work.state!=='CANCELLED' ? [['cancel-work',t('workRecovery.cancelWork')] as [WorkRecoveryAction,string]] : []),
                            ...(!originBlocked && work.kind==='ordinary-conversation' && ['CANCELLED','INTERRUPTED'].includes(work.state) ? [['ordinary',t('workRecovery.ordinary')] as [WorkRecoveryAction,string]] : []),
                            ...(!originBlocked && work.kind==='ordinary-conversation' && work.contextDerived ? [['context',t('workRecovery.context')] as [WorkRecoveryAction,string]] : []),
                            ...allowanceOptions.filter(([action]) => action !== allowanceHold),
                            ...(!fromRegistry ? [['browse',t('workRecovery.browseRegistry')] as [WorkRecoveryAction,string]] : []),
                        ];
                        const title = t('workRecovery.title',{id,state:work.state});
                        const guidance = workRecoveryGuidance(work, locale, allowanceHold, live);
                        const originGuidance = originBlocked ? t(origin?.deleted ? 'workRecovery.originDeleted' : origin?.archived
                            ? 'workRecovery.originArchived' : 'workRecovery.originUnavailable', {conversation: work.conversationId}) : undefined;
                        const picked = await choose([title, ...(refreshMessage ? [refreshMessage] : []), ...guidance,
                            ...(originGuidance ? [originGuidance] : [])].join('\n'), options.map(([,label])=>label));
                        refreshMessage = undefined;
                        const action = options.find(([,label])=>label===picked)?.[0];
                        current();
                        if (!action || action === 'back')
                            return 'cancelled';
                        if (action === 'browse')
                            return 'registry';
                        const refreshed = read();
                        if (!refreshed)
                            return unavailable();
                        const { work: latest, entry: {origin: latestOrigin, live: latestLive, allowanceHold: latestAllowanceHold, runtime: latestRuntime} } = refreshed;
                        if (!isDeepStrictEqual(workMenuSource(latest), workMenuSource(work)) ||
                            !isDeepStrictEqual(workOriginLifecycle(latestOrigin), workOriginLifecycle(origin)) ||
                            latestLive !== live || latestAllowanceHold !== allowanceHold ||
                            latestRuntime !== runtime ||
                            !isDeepStrictEqual(workRecoveryGuidance(latest, locale, latestAllowanceHold, latestLive), guidance)) {
                            refreshMessage = t('workRecovery.workChanged');
                            continue;
                        }
                        work = latest;
                        if (action === 'activation') {
                            await host.show(t('workRecovery.activationPending'), ownerActivationGuidance(c.applicationHome(), work, locale));
                            continue;
                        }
                        if (action === 'criteria' && work.governed) {
                            const outcome = await reviewCriteriaRefresh({ ...host, locale, guard: current }, id, target);
                            if (outcome === 'completed')
                                showSave(t('criteria.saved'));
                            continue;
                        }
                        if (action === 'result' && work.governed) {
                            const outcome = await reviewChangeResult({
                                ...host, controls: { activateSource: host.activate, notice: host.notice },
                            }, id, target, current, { context, fromWork: true });
                            if (outcome === 'started' || outcome === 'completed' || !host.isCurrent(target))
                                return outcome ?? 'cancelled';
                            continue;
                        }
                        const route = routes.get(action);
                        if (route) {
                            const outcome = await host.execute!(route.command, target, context);
                            if (action === 'inspect' || outcome === 'cancelled' && host.isCurrent(target)) {
                                current();
                                continue;
                            }
                            return outcome;
                        }
                        if (action === 'cancel-work') {
                            const original = c.inspectWork(id);
                            const originalConversation = work.conversationId ? c.inspectConversation(work.conversationId) : null;
                            const token = (value: typeof original) => JSON.stringify({ id: value.workId, epoch: value.epoch, project: value.projectId, source: value.source, state: value.state });
                            const fresh = () => {
                                current();
                                if (token(c.inspectWork(id)) !== token(original)) throw Error(t('workRecovery.cancelSourceChanged'));
                                if (originalConversation) {
                                    const now = c.inspectConversation(originalConversation.conversationId);
                                    if (now.generation !== originalConversation.generation || now.directionRevision !== originalConversation.directionRevision ||
                                        now.projectId !== originalConversation.projectId || now.workId !== originalConversation.workId)
                                        throw Error(t('workRecovery.cancelConversationChanged'));
                                }
                            };
                            if (!await reviewForConfirmation(t('workRecovery.reviewCancel'), {
                                workId: id, epoch: original.epoch, project: original.projectId, state: original.state, source: original.source,
                                scope: t('workRecovery.cancelScope'),
                            }, fresh, t('workRecovery.noCancel'))) continue;
                            const choice = await choose(t('workRecovery.cancelTitle', {id}), [t('workRecovery.backCancel'), t('workRecovery.confirmCancel')]);
                            fresh();
                            if (!choice || choice === t('workRecovery.backCancel')) continue;
                            await c.cancelWork({ workId: id, expectedEpoch: original.epoch });
                            host.notice(t('workRecovery.cancelled'));
                            return 'completed';
                        }
                        if (action === 'details') {
                            const managedCommands = work.governed ? work.state === 'DELIVERED'
                                ? t('workRecovery.deliveredCommands', {id})
                                : t('workRecovery.managedCommands', {id}) : '';
                            const details = t('workRecovery.detailsBody', {id, project: work.projectId ?? t('workRecovery.none'), state: work.state,
                                phase: work.recordedPhase ?? t('workRecovery.ordinaryPhase'), next: work.nextAction ?? t('workRecovery.noNext'), lineage: work.lineageRoot,
                                count: work.family.count, execution: workAllowanceText(locale, 'execution', work.execution), resolution: workAllowanceText(locale, 'resolution', work.resolution),
                                conversation: work.conversationId ?? t('workRecovery.notRetained'), obligations: work.obligations, findings: work.findings, request: shorten(work.request), commands: managedCommands});
                            await host.show(t('workRecovery.detailsTitle'), details);
                            continue;
                        }
                        if (action === 'obligations') {
                            await evidence(id, 'obligations');
                            continue;
                        }
                        if (action === 'findings') {
                            await evidence(id, 'findings');
                            continue;
                        }
                        if (action === 'startup') {
                            const context = await c.inspectStartupCleanup(id);
                            current();
                            if (!context.eligible || !context.captured) {
                                await showExactInspection(host, t('workRecovery.startupHeld'), {
                                    ...context.review,
                                    holds: context.holds,
                                    nextAction: t('workRecovery.startupHoldNext'),
                                }, current, t('workRecovery.noRecoveryDispatch'), locale);
                                continue;
                            }
                            if (!await reviewForConfirmation(t('workRecovery.reviewStartup'), {
                                workId: id, ...context.review,
                                evidence: t(context.captured.evidence.kind === 'context-missing-before-create'
                                    ? 'workRecovery.startupContextEvidence' : 'workRecovery.startupEvidence'),
                                effects: t('workRecovery.startupEffects'),
                            }, current, t('workRecovery.noRecovery'), async () => {
                                const latest = await c.inspectStartupCleanup(id);
                                if (latest.eligible && latest.fingerprint === context.fingerprint)
                                    return true;
                                refreshMessage = t('workRecovery.startupChanged');
                                return false;
                            })) continue;
                            const decision = await choose(t('workRecovery.confirmStartup'), [
                                t('workRecovery.backRecovery'), t('workRecovery.recoverStartup'),
                            ]);
                            current();
                            if (decision !== t('workRecovery.recoverStartup'))
                                continue;
                            let result: Awaited<ReturnType<Controller['recoverStartupCleanup']>>;
                            try {
                                result = await c.recoverStartupCleanup({ workId: id, expectedContext: context.fingerprint }, current);
                            } catch (error) {
                                if (!(error instanceof ControllerError) || error.code !== 'STARTUP_CLEANUP_REVIEW_CHANGED') throw error;
                                current();
                                refreshMessage = t('workRecovery.startupChanged');
                                continue;
                            }
                            const next = result.conversationId === target
                                ? t('workRecovery.startupNext')
                                : t('workRecovery.startupNextOther', {conversation: result.conversationId});
                            host.notice(t('workRecovery.startupRecovered', {run: result.runId, next}));
                            return 'completed';
                        }
                        if (action === 'context') {
                            const context = c.inspectContextWorkRecovery(id), fresh = () => {
                                current();
                                if (c.inspectContextWorkRecovery(id).fingerprint !== context.fingerprint)
                                    throw Error(t('workRecovery.contextChanged'));
                            };
                            if (!context.eligible) {
                                await showExactInspection(host, t('workRecovery.contextHeld'), context.review, fresh, t('workRecovery.noRecoveryDispatch'), locale);
                                continue;
                            }
                            const reason = await host.input(t('workRecovery.contextReason'), '');
                            fresh();
                            if (reason === undefined)
                                continue;
                            if (!reason.trim() || Buffer.byteLength(reason) > 4096)
                                throw Error(t('workRecovery.reasonInvalid'));
                            if (!await reviewForConfirmation(t('workRecovery.reviewContext'), { scope: t('workRecovery.contextScope'), context: context.review, reason },
                                fresh, t('workRecovery.noExecution'))) continue;
                            const decision = await choose(t('workRecovery.confirmContext'), [t('workRecovery.backRecovery'), t('workRecovery.recoverContext')]);
                            fresh();
                            if (!decision || decision === t('workRecovery.backRecovery'))
                                continue;
                            const result = await c.recoverContextWorkAdmission({ workId: id, expectedContext: context.fingerprint, reason }, fresh);
                            try {
                                host.notice(t('workRecovery.contextRecovered', {id: result.workId}));
                            }
                            catch (error) {
                                throw Error(t('workRecovery.contextRecoveredNoticeFailed', {id: result.workId}), { cause: error });
                            }
                            return 'completed';
                        }
                        if (action === 'ordinary') {
                            const context = c.inspectOrdinaryWorkRecovery(id), fresh = () => {
                                current();
                                if (c.inspectOrdinaryWorkRecovery(id).fingerprint !== context.fingerprint)
                                    throw Error(t('workRecovery.conversationChanged'));
                            };
                            if (!context.eligible) {
                                await showExactInspection(host, t('workRecovery.ordinaryHeld'), context, fresh, t('workRecovery.noRecoveryDispatch'), locale);
                                continue;
                            }
                            const reason = await host.input(t('workRecovery.ordinaryReason'), '');
                            fresh();
                            if (reason === undefined)
                                continue;
                            if (!reason.trim() || Buffer.byteLength(reason) > 4096)
                                throw Error(t('workRecovery.reasonInvalid'));
                            if (!await reviewForConfirmation(t('workRecovery.reviewOrdinary'), { scope: t('workRecovery.ordinaryScope'), context, reason },
                                fresh, t('workRecovery.noExecution'))) continue;
                            const decision = await choose(t('workRecovery.confirmOrdinary'), [t('workRecovery.backRecovery'), t('workRecovery.recoverOrdinary')]);
                            fresh();
                            if (!decision || decision === t('workRecovery.backRecovery'))
                                continue;
                            const result = c.recoverOrdinaryWorkAdmission({ workId: id, expectedContext: context.fingerprint, reason }, fresh);
                            try {
                                host.notice(t('workRecovery.ordinaryRecovered', {id: result.workId}));
                            }
                            catch (error) {
                                throw Error(t('workRecovery.ordinaryRecoveredNoticeFailed', {id: result.workId}), { cause: error });
                            }
                            return 'completed';
                        }
                        if (action === 'open' && origin) {
                            await host.activate(origin.conversationId);
                            host.notice(t('workRecovery.opened'));
                            return 'completed';
                        }
                        if (action === 'restore' && origin) {
                            const conversation = origin.conversationId, restore = t('workRecovery.confirmRestoreOrigin');
                            const decision = await choose([
                                t('workRecovery.originArchived', {conversation: conversationDisplayIdentity(origin)}),
                                t('workRecovery.restoreOriginScope'),
                            ].join('\n'), [t('workRecovery.backToSource'), restore]);
                            if (decision !== restore) continue;
                            const fresh = () => {
                                current();
                                if (!isDeepStrictEqual(workOriginScope(c.inspectWorkRecovery(id)), workOriginScope(work)) ||
                                    !isDeepStrictEqual(workOriginLifecycle(c.inspectConversation(conversation)), workOriginLifecycle(origin)))
                                    throw Error(t('workRecovery.conversationChanged'));
                            };
                            const receipt = await c.restoreConversation({conversationId:conversation,expectedGeneration:origin.generation}, fresh);
                            if (!('actionId' in receipt) || receipt.outcome !== 'restored' ||
                                receipt.conversationId !== conversation || receipt.generation !== origin.generation)
                                throw Error(t('workRecovery.conversationChanged'));
                            try {
                                current();
                                const restored = c.inspectConversation(conversation);
                                if (restored.generation !== receipt.generation || restored.archived || restored.deleted ||
                                    restored.lifecycle?.lastAction?.actionId !== receipt.actionId)
                                    throw Error(t('workRecovery.conversationChanged'));
                                await host.activate(conversation);
                                if (!host.isCurrent(conversation)) throw Error(t('workRecovery.conversationChanged'));
                                host.notice(t('workRecovery.restoredOrigin', {conversation}));
                            } catch (error) {
                                throw Error(t('workRecovery.restoredOriginOpenFailed', {conversation}), {cause:error});
                            }
                            return 'completed';
                        }
                        if (action !== 'execution' && action !== 'resolution')
                            throw Error(t('workRecovery.actionUnknown'));
                        const {snapshot: expected, unsettled} = c.inspectWorkAllowanceExtension(id);
                        if (unsettled) {
                            await host.show(t('workRecovery.allowanceHeld'), t('workRecovery.allowanceHeldBody', {id, lineage:expected.lineageRoot}));
                            continue;
                        }
                        const kind = action;
                        const fresh = () => {
                            current();
                            if (!isDeepStrictEqual(c.inspectWorkAllowance(id),expected)) throw Error(t('workRecovery.allowanceChanged'));
                        };
                        const allowance = expected[kind], kindLabel = t(kind === 'execution' ? 'workRecovery.executionKind' : 'workRecovery.resolutionKind');
                        const defaultUnits = '4';
                        const entered = await host.input(
                            t('workRecovery.additional', { kind: kindLabel, available: availableWorkAllowance(allowance) }),
                            '', t('allowance.default', { value: defaultUnits, maximum: 100 }));
                        fresh();
                        if (entered === undefined)
                            continue;
                        const raw = entered || defaultUnits;
                        if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(raw))
                            throw Error(t('workRecovery.unitsInvalid'));
                        const additional = Number(raw), limit = allowance.limit + additional;
                        if (!Number.isSafeInteger(limit)) throw Error(t('workRecovery.limitInvalid'));
                        const reason = await host.input(t('workRecovery.allowanceReason'), '');
                        fresh();
                        if (reason === undefined)
                            continue;
                        if (!reason.trim())
                            throw Error(t('workRecovery.reasonRequired'));
                        if (!await reviewForConfirmation(t('workRecovery.reviewAllowance'),{
                            original: expected,
                            change: {kind,additional,before:allowance,after:{...allowance,limit}},
                            familyPreview: {total:expected.family.count,shown:expected.family.workIds.length,omitted:expected.family.count-expected.family.workIds.length},
                            reason, scope:t('workRecovery.allowanceScope'),
                        },fresh,t('workRecovery.noAllowanceChange'))) continue;
                        const accept = t('workRecovery.confirmAllowance',{additional,kind:kindLabel});
                        const selected = await choose(t('workRecovery.extendTitle',{kind:kindLabel,id,lineage:expected.lineageRoot}),[t('workRecovery.cancel'),accept]);
                        fresh();
                        if (!selected || selected === t('workRecovery.cancel')) continue;
                        c.extendWorkAllowance({expected,kind,additional,reason});
                        const message = t('workRecovery.extended', {kind: kindLabel});
                        showSave(message);
                        host.notice(message);
                    }
                };
                current();
                if (argument) {
                    const outcome = await inspect(argument.trim());
                    if (outcome !== 'registry')
                        return finish(outcome);
                }
                let projectId = source.projectId ?? undefined, cursor: string | undefined;
                let focusedWork: string | undefined;
                const back: (string | undefined)[] = [];
                while (true) {
                    current();
                    const page = c.listWorks({ limit: 50, ...(projectId ? { projectId } : {}), ...(cursor ? { before: cursor } : {}) });
                    let linked: string[] = [], linkFailure: string | undefined;
                    try {
                        const goal = c.conversationGoal(target);
                        if (goal)
                            linked = c.goalRecoveryWorkIds(goal.goalId);
                    }
                    catch (error) {
                        linkFailure = String(error);
                    }
                    const preferred = [...new Set([...(source.workId ? [source.workId] : []), ...linked])];
                    const preview = (work: (typeof page.works)[number]) => typeof work.requestPreview === 'string'
                        ? truncateToWidth(plainTerminalText(work.requestPreview).replace(/\s+/gu, ' ').trim(), 48, '…')
                        : t('workRecovery.requestUnavailable');
                    const linkedRows = preferred.map(id => {
                        const listed = page.works.find(work => work.workId === id);
                        const relation = t(id === source.workId ? 'workRecovery.currentConversation' : 'workRecovery.goalRelation');
                        return { id, label: t('workRecovery.linked', {id, relation}) + (listed ? ` · ${listed.state} · ${preview(listed)}` : '') };
                    });
                    const rows = page.works.filter(w => !preferred.includes(w.workId)).map(w => ({ id: w.workId, label: `${w.state} · ${preview(w)} · ${w.projectId ?? t('workRecovery.none')} · #${w.workId} · ${w.recordedPhase ?? t('workRecovery.ordinaryLocal')}` }));
                    const switchScope = source.projectId ? projectId ? t('workRecovery.allProjects') : t('workRecovery.currentProject', {project: source.projectId}) : undefined;
                    const title = projectId ? t('workRecovery.projectRegistryTitle', {project: projectId}) : t('workRecovery.registryTitle');
                    const records = [...linkedRows, ...rows].map(row => ({ ...row, value: 'work:' + row.id }));
                    const selected = await chooseUiItem(host, title + (page.works.length ? '' : '\n' + t('workRecovery.emptyRegistry')), [
                        ...(switchScope ? [{ value: 'scope', label: switchScope }] : []),
                        ...(linkFailure ? [{ value: 'goal-links', label: t('workRecovery.goalLinks') }] : []),
                        ...records,
                        ...(page.nextCursor ? [{ value: 'older', label: t('workRecovery.olderWorks') }] : []),
                        ...(back.length ? [{ value: 'newer', label: t('workRecovery.newerWorks') }] : []),
                        { value: 'close', label: t('workRecovery.closeRegistry') },
                    ], focusedWork);
                    current();
                    if (selected === 'goal-links') {
                        await host.show(t('workRecovery.goalLinksTitle'), shorten(linkFailure) + t('workRecovery.linkDetails'));
                        continue;
                    }
                    if (!selected || selected === 'close')
                        return finish('cancelled');
                    if (selected === 'scope') {
                        projectId = projectId ? undefined : source.projectId ?? undefined;
                        cursor = undefined;
                        back.length = 0;
                        focusedWork = undefined;
                        continue;
                    }
                    if (selected === 'older' && page.nextCursor) {
                        back.push(cursor);
                        cursor = page.nextCursor;
                        focusedWork = undefined;
                        continue;
                    }
                    if (selected === 'newer' && back.length) {
                        cursor = back.pop();
                        focusedWork = undefined;
                        continue;
                    }
                    const row = records.find(record => record.value === selected);
                    if (!row)
                        throw Error(t('workRecovery.selectionChanged'));
                    focusedWork = selected;
                    const outcome = await inspect(row.id, true);
                    // A reviewed resume may open its original owner. Cancelling that fresh
                    // review ends this old-source registry instead of reopening it as stale.
                    if (outcome === 'completed' || outcome === 'started' || outcome === 'cancelled' && !host.isCurrent(target))
                        return finish(outcome);
                }
            } }];
}
