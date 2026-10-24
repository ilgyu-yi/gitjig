import type { RepositoryConfigurationAudit, RepositoryConfigurationGuidance, RepositoryConfigurationView } from '../controller/configuration-types.js';
import type { RepositoryProfile, RepositoryTarget } from '../platform/configuration-session.js';
import { escapeDisplayControls, escapeJsonControls } from './inspection-text.js';

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

export function repositoryProfileText(profile: RepositoryProfile) {
    return details(['Staged settings · no preview or repository write has started.',
        'Next: close this view to supply the private credential for a read-only preview. Applying is a separate explicit action.',
        'Only listed fields are managed. Omitted fields stay unmanaged; false, zero, null and empty lists remain explicit values.',
        ...fields('profile', profile)], profile, 'repo preview with the selected profile');
}

const phases: Record<RepositoryConfigurationView['phase'], string> = {
    PREVIEWING: 'PREVIEWING · A complete configuration preview is not yet recorded.',
    PREVIEWED: 'PREVIEWED · Preview retained. Preview did not write repository settings.',
    APPLYING: 'APPLYING · The recorded request has not reached a settled outcome.',
    PARTIAL: 'PARTIAL · Some selected settings remain incomplete.',
    CONFIRMED: 'CONFIRMED · Selected settings were observed matching.',
    REFUSED: 'REFUSED · The operation was refused. Inspect the recorded reason.',
    UNKNOWN: 'UNKNOWN · A request may have reached the repository. Its outcome is uncertain.',
    CANCELLED: 'CANCELLED · The original operation is cancelled; earlier native effects remain recorded.',
};
function nextAction(view: RepositoryConfigurationView) {
    if (view.nextAction === 'applyRepositoryConfiguration') return 'Next: open this retained plan and choose Review changes for application. The confirmation defaults to Back.';
    if (view.nextAction === 'auditRepositoryConfiguration') return 'Next: choose Audit selected settings (read only) for a fresh comparison with the intended settings.';
    if (/^reconcileRepositoryConfiguration(?:\s|$)/u.test(view.nextAction)) return 'Next: choose Reconcile original request (read only). Read the original outcome without replaying its request.';
    return field('Recorded next action', view.nextAction);
}
function planIdentity(view: RepositoryConfigurationView) {
    return [field('Original plan', view.planId), field('Original work', view.workId), field('Registered target', view.targetId), field('Revision', view.revision),
        ...(view.plan ? targetLines(view.plan.target) : ['Original preview: unavailable'])];
}
function planFields(view: RepositoryConfigurationView) {
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
        for (const value of step.fields) lines.push(escapeDisplayControls(value.path) + ': ' + literal(value.before) + ' → ' + literal(value.intended));
    }
    return [...lines, ...list('Preserved scope', plan.preserved), ...list('Manual or unsupported settings', plan.manual), ...list('Native limitations', plan.limitations)];
}
export function repositoryPlanText(view: RepositoryConfigurationView, review = false) {
    const lines = [review ? 'Review selected changes · no write has been started by opening this view.' : phases[view.phase] ?? 'UNAVAILABLE · Recorded operation phase is not recognized.',
        review ? 'Next: close this review to choose whether to apply this original plan. The confirmation defaults to Back.' : nextAction(view),
        ...list('Recorded blockers', view.blocked), ...planIdentity(view),
        'The selected repository target is independent of the conversation project.', ...planFields(view)];
    if (!review) {
        lines.push('Recorded per-field observations · these are retained facts, not a fresh read');
        for (const step of view.steps) {
            lines.push(field('Step', step.stepId) + ' · ' + field('revision', step.revision) + ' · ' + field('state', step.state), field('Native transport outcome', step.transportOutcome));
            for (const observation of step.observations) lines.push(escapeDisplayControls(observation.path) + ': ' + escapeDisplayControls(observation.state) + ' · recorded actual ' + literal(observation.actual));
        }
    }
    if (view.phase === 'UNKNOWN' || view.steps.some(step => step.revision === view.revision && ['UNKNOWN', 'INVOKING'].includes(step.state)))
        lines.push('Possible handoff remains UNKNOWN until read-only reconciliation. Do not replay an uncertain request.');
    lines.push('Selected-value correspondence does not establish complete effective policy, causation, ownership, approval or merge permission.');
    if (review && (!view.plan || bytes(lines.join('\n')) > 36000))
        throw Error('Complete repository application review is unavailable or exceeds 36000 display bytes. Original plan ' + escapeDisplayControls(view.planId) + ' · work ' + escapeDisplayControls(view.workId) + ' remains retained. No Apply confirmation or dispatch was offered. Inspect the complete original with repo plan --plan ' + literal(view.planId) + ' before using an explicit CLI action.');
    return details(lines, view, 'repo plan --plan PLAN_ID', review);
}
export function repositoryAuditText(audit: RepositoryConfigurationAudit) {
    const lines = [audit.complete ? 'AUDIT MATCH · This audit observed all selected settings matching.' : 'AUDIT INCOMPLETE · This audit did not confirm all selected settings.',
        audit.complete ? 'Next: inspect current branch policy for developer guidance; selected settings alone do not describe every applicable rule.' : 'Next: inspect the current audit reasons and native observations. Do not replay an uncertain request or assume the old recorded outcome still applies.',
        ...list('Current audit unknowns or conflicts', audit.unknowns), ...planIdentity(audit.view),
        field('Historical operation phase (separate from this audit)', audit.view.phase), 'Current audit observations'];
    for (const step of audit.steps) {
        lines.push(field('Original journal', step.journalId));
        const result = step.result;
        if (row(result) && Array.isArray(result.fieldObservations)) {
            lines.push(field('Current step outcome', result.outcome), field('Current reason', result.reason));
            for (const observation of result.fieldObservations) {
                if (row(observation)) lines.push(escapeDisplayControls(String(observation.path)) + ': ' + literal(observation.state) + ' · current actual ' + literal(observation.actual));
            }
        } else lines.push(...fields('Current observation', result));
    }
    lines.push('A read-only audit neither writes settings nor rewrites the historical operation phase. Matching selected values do not prove complete effective policy or action permission.');
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
export function repositoryGuidanceText(guidance: RepositoryConfigurationGuidance, target: RepositoryTarget) {
    const observation = guidance.observation;
    const lines = ['Current branch policy · visible native observations, not complete policy or permission.',
        'Selected branch: ' + escapeDisplayControls(guidance.branch),
        'Next: inspect the branch requirements below. Resolve unavailable fields with the administrator and native UI; check inherited and request-specific rules before work or integration.',
        ...(row(observation) && observation.kind === 'repository-observation' && observation.provider === 'gitea' ? giteaRequirements(observation) : []),
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
