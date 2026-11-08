import { repositoryHasConfirmedForwardedTransmission, repositoryHasTransmissionToReconcile, repositoryHasUnsettledTransmission, repositoryPlanRequiresPrivateGitHubWrite, type RepositoryConfigurationAudit, type RepositoryConfigurationGuidance, type RepositoryConfigurationView } from '../controller/configuration-types.js';
import type { RepositoryProfile, RepositoryTarget } from '../platform/configuration-session.js';
import { escapeDisplayControls, escapeJsonControls } from './inspection-text.js';
import { uiText, type UiLocale } from './i18n.js';

type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
const literal = (value: unknown) => escapeDisplayControls(JSON.stringify(value) ?? 'not available');
const field = (name: string, value: unknown) => escapeDisplayControls(name) + ': ' + literal(value);
const list = (title: string, values: readonly string[]) => values.length ? [title, ...values.map(value => field('•', value))] : [];

/** One existing scroll view, with whole-field omissions rather than shortened identities. */
function details(lines: string[], original: unknown, cli: string, completeSummary = false) {
    const shown: string[] = []; let used = 0, omitted = 0;
    for (const line of lines) {
        if (!completeSummary && (bytes(line) > 8192 || used + bytes(line) + 1 > 24576)) { omitted++; continue; }
        shown.push(line); used += bytes(line) + 1;
    }
    if (omitted) shown.push(`${omitted} summary fields omitted whole by the display limit. Use ${cli} for the original record.`);
    const originalText = escapeJsonControls(JSON.stringify(original, null, 2));
    shown.push('', 'Original observation · details', bytes(originalText) <= 24576 ? originalText : `Original details omitted as a whole: exceeds 24576 display bytes. Use ${cli} for the complete observation. No shortened IDs or paths are substituted.`);
    return shown.join('\n');
}

function targetLines(target: RepositoryTarget) {
    return [field('Provider', 'provider' in target ? target.provider : 'github'),
        field('API base', 'provider' in target ? target.apiBase : 'https://api.github.com'),
        field('Repository', target.owner + '/' + target.repository), field('Native repository ID', target.repositoryId), field('Registered actor ID', target.actorUserId),
        ...'provider' in target ? [] : [field('GitHub host', target.host), field('Repository node ID', target.repositoryNodeId), field('Registered visibility', target.visibility)]];
}

/** Preserve native field names, explicit false/zero/empty values and unknown reasons.
 * This is a display traversal, not a policy evaluator or provider normalization. */
function fields(name: string, value: unknown) {
    const lines: string[] = []; let remaining = 180, omitted = false;
    const visit = (name: string, value: unknown, depth: number) => {
        if (--remaining < 0 || depth > 12) { omitted = true; return; }
        if (row(value) && value.state === 'UNAVAILABLE') {
            lines.push(escapeDisplayControls(name) + ': UNAVAILABLE · ' + literal(value.reason)); return;
        }
        if (row(value) && value.state === 'OBSERVED') {
            if (!row(value.value) && !Array.isArray(value.value) || Array.isArray(value.value) && !value.value.length) {
                lines.push(escapeDisplayControls(name) + ': OBSERVED ' + literal(value.value)); return;
            }
            lines.push(escapeDisplayControls(name) + ': OBSERVED'); visit(name, value.value, depth + 1); return;
        }
        if (Array.isArray(value) && value.length) {
            for (let i = 0; i < value.length && remaining >= 0; i++) visit(name + '[' + i + ']', value[i], depth + 1);
            if (remaining < 0) omitted = true;
        } else if (row(value) && Object.keys(value).length) {
            for (const [key, item] of Object.entries(value)) visit(name ? name + '.' + key : key, item, depth + 1);
        } else lines.push(field(name, value));
    };
    visit(name, value, 0);
    if (omitted) lines.push('Additional nested fields omitted whole by the summary limit; inspect Original observation details or the matching repo CLI command.');
    return lines;
}

export function repositoryProfileText(profile: RepositoryProfile, target?: RepositoryTarget, locale: UiLocale = 'en') {
    return details(['Staged settings · no preview or repository write has started.',
        uiText(locale, 'repository.reviewPreviewNext'),
        'Only selected profile fields are managed. An unmanaged field differs from an explicit false, zero, null or empty list.',
        ...(target ? targetLines(target) : []), ...fields('profile', profile)], profile, 'repo preview with the selected profile');
}

const phases = ['PREVIEWING', 'PREVIEWED', 'APPLYING', 'PARTIAL', 'CONFIRMED', 'REFUSED', 'UNKNOWN', 'CANCELLED'] as const;
export function repositoryPhaseText(phase: RepositoryConfigurationView['phase'], locale: UiLocale, describe = false) {
    if (!phases.includes(phase)) return uiText(locale, 'repository.phase.unavailable');
    const label = uiText(locale, `repository.phase.label.${phase}`, { phase });
    return describe ? label + ' · ' + uiText(locale, `repository.phase.description.${phase}`) : label;
}
export function repositoryPlanReadAction(view: RepositoryConfigurationView) {
    if (repositoryHasTransmissionToReconcile(view.steps))
        return 'repository.plan.reconcile' as const;
    if (view.plan && !view.plan.steps.length && !view.plan.manual.length &&
        (view.phase === 'PREVIEWED' || view.phase === 'UNKNOWN') &&
        repositoryHasConfirmedForwardedTransmission(view.revision, view.steps))
        return 'repository.plan.confirmCurrent' as const;
}
/** Recorded holds only. The controller owns current eligibility and dispatch. */
export function repositoryApplicationReviewAvailable(view: RepositoryConfigurationView): boolean {
    return !!view.plan && !repositoryPlanRequiresPrivateGitHubWrite(view.plan) && !view.plan.manual.length && ['PREVIEWED', 'PARTIAL', 'REFUSED', 'UNKNOWN'].includes(view.phase) &&
        (view.plan.steps.length > 0 || (!repositoryHasTransmissionToReconcile(view.steps) &&
            !repositoryHasConfirmedForwardedTransmission(view.revision, view.steps))) &&
        !repositoryHasUnsettledTransmission(view.steps) &&
        view.plan.steps.every(step => {
            const [journal, duplicate] = view.steps.filter(candidate => candidate.revision === view.revision && candidate.stepId === step.id);
            return !duplicate && (journal?.state === 'PENDING' || journal?.state === 'CONFIRMED');
        });
}

export function repositoryPlanNextAction(view: RepositoryConfigurationView, locale: UiLocale = 'en') {
    const read = repositoryPlanReadAction(view);
    if (read)
        return uiText(locale, read === 'repository.plan.reconcile' ? 'repository.plan.nextReconcile' : 'repository.plan.nextConfirmCurrent', { action: uiText(locale, read) });
    if (view.phase === 'CONFIRMED' || view.nextAction === 'auditRepositoryConfiguration')
        return uiText(locale, 'repository.plan.nextAudit', { action: uiText(locale, 'repository.plan.audit') });
    if (view.plan && repositoryPlanRequiresPrivateGitHubWrite(view.plan))
        return uiText(locale, 'repository.plan.privateReadOnly');
    if (view.nextAction === 'applyRepositoryConfiguration')
        return repositoryApplicationReviewAvailable(view)
            ? uiText(locale, 'repository.plan.nextApply', { action: uiText(locale, 'repository.plan.reviewApply') })
            : uiText(locale, 'repository.plan.applyUnavailable');
    return uiText(locale, 'repository.plan.nextRecorded', { action: literal(view.nextAction) });
}
function planIdentity(view: RepositoryConfigurationView) {
    return [field('Original plan', view.planId), field('Original work', view.workId), field('Registered target', view.targetId), field('Revision', view.revision),
        ...(view.plan ? targetLines(view.plan.target) : ['Original preview: unavailable'])];
}
function planFields(view: RepositoryConfigurationView, review: boolean, locale: UiLocale) {
    const plan = view.plan;
    if (!plan) return ['Selected changes: unavailable without the original preview'];
    const profile = plan.profile;
    const lines = [...'provider' in profile
        ? [field('Native protection rule', profile.protection?.name ?? 'not selected; repository settings only')]
        : profile.ruleset ? [field('GitHub ruleset', profile.ruleset.name), field('Included branch patterns', profile.ruleset.include), field('Excluded branch patterns', profile.ruleset.exclude)] : ['GitHub ruleset: not selected; merge settings only'],
        'Selected changes · recorded before → intended'];
    if (!plan.steps.length) lines.push('No selected setting changes were required by this preview. This is not complete policy verification.');
    for (const step of plan.steps) {
        lines.push(field('Native step', step.kind));
        if (review && view.steps.some(journal => journal.revision === view.revision && journal.stepId === step.id && journal.state === 'CONFIRMED'))
            lines.push(uiText(locale, 'repository.plan.confirmedStep'));
        for (const value of step.fields) lines.push(escapeDisplayControls(value.path) + ': ' + literal(value.before) + ' → ' + literal(value.intended));
    }
    return [...lines, ...list('Preserved scope', plan.preserved), ...list('Manual or unsupported settings', plan.manual), ...list('Native limitations', plan.limitations)];
}
export function repositoryPlanText(view: RepositoryConfigurationView, review = false, locale: UiLocale = 'en') {
    const lines = [review ? uiText(locale, 'repository.plan.reviewLead') : repositoryPhaseText(view.phase, locale, true),
        review ? uiText(locale, 'repository.reviewApplyNext') : repositoryPlanNextAction(view, locale),
        ...list(uiText(locale, 'repository.plan.blockers'), view.blocked), ...planIdentity(view),
        'The selected repository target is independent of the conversation project.', ...planFields(view, review, locale)];
    if (!review) {
        lines.push(uiText(locale, 'repository.plan.observations'));
        for (const step of view.steps) {
            lines.push(field('Step', step.stepId) + ' · ' + field('revision', step.revision) + ' · ' + field('state', step.state), field('Native transport outcome', step.transportOutcome));
            for (const observation of step.observations) lines.push(escapeDisplayControls(observation.path) + ': ' + escapeDisplayControls(observation.state) + ' · recorded actual ' + literal(observation.actual));
        }
    }
    if (view.phase === 'UNKNOWN' || repositoryHasUnsettledTransmission(view.steps))
        lines.push(uiText(locale, 'repository.plan.possibleHandoff'));
    lines.push(uiText(locale, 'repository.plan.observationLimits'));
    if (review && (!view.plan || bytes(lines.join('\n')) > 36000))
        throw Error('Complete repository application review is unavailable or exceeds 36000 display bytes. Original plan ' + escapeDisplayControls(view.planId) + ' · work ' + escapeDisplayControls(view.workId) + ' remains retained. No Apply confirmation or dispatch was offered. Inspect the complete original with repo plan --plan ' + literal(view.planId) + ' before using an explicit CLI action.');
    return details(lines, view, 'repo plan --plan PLAN_ID', review);
}
export function repositoryAuditText(audit: RepositoryConfigurationAudit, locale: UiLocale = 'en') {
    const lines = [uiText(locale, audit.complete ? 'repository.audit.match' : 'repository.audit.incomplete'),
        uiText(locale, audit.complete ? 'repository.auditGuidanceNext' : 'repository.audit.inspectIncomplete'),
        ...list(uiText(locale, 'repository.audit.unknowns'), audit.unknowns), ...planIdentity(audit.view),
        field(uiText(locale, 'repository.audit.historicalPhase'), audit.view.phase), uiText(locale, 'repository.audit.observations')];
    for (const step of audit.steps) {
        lines.push(field('Original journal', step.journalId));
        const result = step.result;
        if (row(result) && Array.isArray(result.fieldObservations)) {
            lines.push(field('Current step outcome', result.outcome), field('Current reason', result.reason));
            for (const observation of result.fieldObservations) {
                if (row(observation)) lines.push(uiText(locale, 'repository.audit.field', {
                    path: escapeDisplayControls(String(observation.path)), state: literal(observation.state), value: literal(observation.actual),
                }));
            }
        } else lines.push(...fields('Current observation', result));
    }
    lines.push(uiText(locale, 'repository.audit.limits'));
    return details(lines, audit, 'repo audit --plan PLAN_ID');
}
function giteaRequirements(observation: Row) {
    const observations = row(observation.observations) ? observation.observations : {}, effective = observations.effectiveRule;
    const labels = [['required_approvals', 'Required approvals'], ['dismiss_stale_approvals', 'Dismiss stale approvals'],
        ['enable_force_push', 'Allow force push'], ['enable_status_check', 'Require status checks'], ['status_check_contexts', 'Status check contexts']] as const;
    const lines = ['Selected branch requirements · Gitea native read observations'];
    if (row(effective) && effective.state === 'OBSERVED' && row(effective.value)) {
        const unavailable: string[] = [];
        for (const [key, label] of labels) {
            const value = effective.value[key];
            if (row(value) && value.state === 'OBSERVED' && Object.hasOwn(value, 'value')) lines.push(field(label + ' · native effective rule', value.value));
            else unavailable.push(label);
        }
        if (unavailable.length) lines.push(field('UNAVAILABLE in the native effective rule', unavailable), 'Unknown field reasons remain in the native observations below; no default is inferred.');
    } else {
        lines.push('Effective rule requirements: UNAVAILABLE · ' + literal(row(effective) ? effective.reason : 'Native effective-rule observation unavailable'),
            'Approval, stale-approval, force-push and check requirements cannot be inferred from the rule inventory.');
        const branch = observations.branch, branchFields = row(branch) && branch.state === 'OBSERVED' && row(branch.value) && row(branch.value.fields) ? branch.value.fields : {};
        for (const [key, label] of labels) {
            const value = branchFields[key];
            if (row(value) && value.state === 'OBSERVED' && Object.hasOwn(value, 'value')) lines.push(field(label + ' · branch summary only', value.value));
        }
    }
    lines.push('Context names are configured values; their requirement depends on the observed status-check flag.',
        'These selected native observations do not establish complete policy, request-specific approval or merge permission.');
    return lines;
}
function gitlabRequirements(observation: Row, locale: UiLocale) {
    const repository = row(observation.repository) ? observation.repository : {};
    const settings = row(repository.settings) ? repository.settings : {};
    const observations = row(observation.observations) ? observation.observations : {};
    const branch = observations.branch;
    const branchFields = row(branch) && branch.state === 'OBSERVED' && row(branch.value) && row(branch.value.fields) ? branch.value.fields : {};
    const unavailable = (value: unknown) => row(value) && value.state === 'UNAVAILABLE' ? value : {
        state: 'UNAVAILABLE', reason: uiText(locale, 'repository.gitlabObservationMissing'),
    };
    const observedBoolean = (label: string, value: unknown) =>
        fields(label, row(value) && value.state === 'OBSERVED' && typeof value.value === 'boolean' ? value : unavailable(value));
    const approvals = observations.approvalRules;
    return [
        uiText(locale, 'repository.gitlabMergeSettings'),
        ...observedBoolean(uiText(locale, 'repository.gitlabPipelineSuccess'), settings.only_allow_merge_if_pipeline_succeeds),
        ...observedBoolean(uiText(locale, 'repository.gitlabSkippedPipeline'), settings.allow_merge_on_skipped_pipeline),
        ...observedBoolean(uiText(locale, 'repository.gitlabDiscussions'), settings.only_allow_merge_if_all_discussions_are_resolved),
        ...observedBoolean(uiText(locale, 'repository.gitlabProtectedBranch'), branchFields.protected ?? branch),
        ...(row(approvals) && approvals.state === 'OBSERVED' && Array.isArray(approvals.value)
            ? [uiText(locale, 'repository.gitlabApprovalObserved')]
            : fields(uiText(locale, 'repository.gitlabApprovalRules'), unavailable(approvals))),
        uiText(locale, 'repository.gitlabApprovalScope'),
    ];
}

export function repositoryGuidanceText(guidance: RepositoryConfigurationGuidance, target: RepositoryTarget, locale: UiLocale = 'en') {
    const observation = guidance.observation;
    const lines = ['Current branch policy · visible native observations, not complete policy or permission.',
        'Selected branch: ' + escapeDisplayControls(guidance.branch),
        'Next: inspect the branch requirements below. Resolve unavailable fields with the administrator and native UI; check inherited and request-specific rules before work or integration.',
        ...(row(observation) && observation.kind === 'repository-observation' && observation.provider === 'gitea' ? giteaRequirements(observation) : []),
        ...(row(observation) && observation.kind === 'repository-observation' && observation.provider === 'gitlab' ? gitlabRequirements(observation, locale) : []),
        field('Registered target', guidance.targetId), ...targetLines(target)];
    if (row(observation) && observation.kind === 'repository-observation') {
        lines.push(field('Native observation status', observation.status), field('Observed at', observation.observedAt),
            'OBSERVED endpoints may still contain UNAVAILABLE fields. False, zero and empty values are never inferred from unavailable data.',
            'Native field observations · exact names and unavailable reasons');
        const observations = row(observation.observations) ? observation.observations : {};
        for (const name of ['branch', 'effectiveRule', 'protectionInventory', 'approvalRules', 'approvalSettings'])
            if (Object.hasOwn(observations, name)) lines.push(...fields(name, observations[name]));
        if (row(observation.repository)) lines.push(...fields('repository.settings', observation.repository.settings));
        if (Array.isArray(observation.limitations)) lines.push(...list('Native visibility limits', observation.limitations.filter((value): value is string => typeof value === 'string')));
        lines.push(field('Native next action', observation.nextAction));
    } else if (row(observation) && Object.hasOwn(observation, 'policy') && Object.hasOwn(observation, 'mergeMethods')) {
        lines.push('GitHub visible policy · route metadata does not grant approval, bypass or merge permission.');
        if (!row(observation.policy)) lines.push('GitHub policy: UNAVAILABLE');
        else {
            const policy = observation.policy;
            lines.push(field('GitHub complete visible inputs (not complete policy)', policy.completeVisibleInputs),
                ...fields('GitHub ordinary path', policy.ordinary), ...fields('GitHub override path', policy.override),
                ...fields('GitHub policy conditions', policy.conditions), ...fields('GitHub classic visibility', policy.classic),
                ...fields('GitHub applicable rule-set keys', policy.applicableSetKeys), ...fields('GitHub visible rule sets', policy.sets));
        }
        if (observation.mergeMethods === null) lines.push('GitHub merge methods: UNAVAILABLE');
        else lines.push(...fields('GitHub merge methods', observation.mergeMethods));
        lines.push(...fields('GitHub read conditions', observation.conditions));
    } else lines.push('UNAVAILABLE · Native guidance summary format is not recognized; inspect the original observation.');
    lines.push(...list('Guidance limits', guidance.limitations), 'This read grants no configuration, review approval or merge permission. Desired recommendations are not evidence of active enforcement.');
    return details(lines, guidance, 'repo guide --target TARGET_ID --branch BRANCH');
}
export function repositoryTargetText(targetId: string, target: RepositoryTarget) {
    return details(['Registered repository identity · current permissions have not been observed.', ...targetLines(target), field('Registered target', targetId),
        'Next: choose Inspect current branch policy for a read-only observation, or New configuration preview to stage settings.'], {targetId,target}, 'repo targets');
}
