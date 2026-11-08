import { isPlanningGrammar } from './types.js';
import { createHash } from 'node:crypto';
import { planningVerificationProfile } from './role-input.js';
import type { Role } from './types.js';

type CurrentPlanPath = readonly [string] | readonly [string, string];
const currentPlans = (role: Role): readonly CurrentPlanPath[] => role === 'challenger'
    ? [['planProposal'], ['plannerOutput', 'plan']] : role === 'adjudicator' ? [['planProposal']] : [];
const baselineNames = {
    newObservation: 'newObservationAllowed',
    crossPlanReuse: 'crossPlanReuseAllowed',
    priorDuty: 'retainedDutyPresent',
} as const;
const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
function unavailable(): never { throw Error('Original current planning domain presentation unavailable'); }

const proposalReference = { $ref: 'context.planProposal' } as const;
function plannerPlanReference(role: Role, context: Record<string, unknown>, version: number | undefined): 1 | undefined {
    if ((!isPlanningGrammar(version) || version < 8) || !Object.hasOwn(context, 'plannerPlanReference')) return undefined;
    if (role !== 'challenger' || context.stage !== 'planning-challenge' || context.plannerPlanReference !== 1)
        unavailable();
    return 1;
}

function mapPlannerPlanReference(context: Record<string, unknown>, restore: boolean): Record<string, unknown> {
    const { planProposal, plannerOutput } = context;
    if (!record(planProposal) || !record(plannerOutput) || !Object.hasOwn(plannerOutput, 'plan') ||
        JSON.stringify(plannerOutput.plan) !== JSON.stringify(restore ? proposalReference : planProposal)) unavailable();
    return { ...context, plannerOutput: { ...plannerOutput, plan: restore ? planProposal : proposalReference } };
}

/** Rename only declared own keys, preserving order and every unrelated literal. */
function rename(value: unknown, names: Readonly<Record<string, string>>): Record<string, unknown> {
    if (!record(value) || Object.keys(names).some(key => !Object.hasOwn(value, key)) ||
        Object.values(names).some(key => Object.hasOwn(value, key))) unavailable();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [Object.hasOwn(names, key) ? names[key]! : key, item]));
}

function mapCurrentPlans(role: Role, context: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
    const result = { ...context };
    for (const path of currentPlans(role)) {
        const parent = path.length === 1 ? context : context[path[0]];
        const key = path.at(-1)!;
        if (!record(parent) || !Object.hasOwn(parent, key) || parent[key] === null) continue;
        const plan = rename(parent[key], { [from]: to });
        if (path.length === 1) result[key] = plan;
        else result[path[0]] = { ...(result[path[0]] as Record<string, unknown>), [key]: plan };
    }
    return result;
}

function requirementsView(planVersion: unknown) {
    if (planVersion !== null && (typeof planVersion !== 'string' || !planVersion.trim())) unavailable();
    return { kind: planVersion === null ? 'task-request-and-constraints' : 'selected-plan-verification-requirements', planVersion };
}

/** Only typed current host pointers change; prose, IDs and other paths stay literal. */
function mapDiagnosticPointers(context: Record<string, unknown>, forward: boolean): Record<string, unknown> {
    if (!Object.hasOwn(context, 'currentProposalDiagnostics') || context.currentProposalDiagnostics === null) return context;
    const diagnostic = context.currentProposalDiagnostics;
    if (!record(diagnostic) || diagnostic.version !== 2 || diagnostic.kind !== 'current-proposal-validation') unavailable();
    if (!Object.hasOwn(diagnostic, 'referenceDiagnostics')) return context;
    const reference = diagnostic.referenceDiagnostics;
    const inputDomain = forward ? 'canonical-plan' : 'current-planning-view';
    const outputDomain = forward ? 'current-planning-view' : 'canonical-plan';
    const from = forward ? '/requirements' : '/verificationRequirements';
    const to = forward ? '/verificationRequirements' : '/requirements';
    const rooted = (value: string, prefix: string) => value === prefix || value.startsWith(prefix + '/');
    const pointer = (value: unknown) => {
        if (typeof value !== 'string' || rooted(value, to)) unavailable();
        return rooted(value, from) ? to + value.slice(from.length) : value;
    };
    if (!record(reference) || reference.version !== 1 || reference.pointerDomain !== inputDomain ||
        !Array.isArray(reference.problems) || reference.problems.length > 12 ||
        !Number.isSafeInteger(reference.omittedProblems) || (reference.omittedProblems as number) < 0) unavailable();
    const allowance = forward ? 0 : 512;
    if (Buffer.byteLength(JSON.stringify(diagnostic)) > 8192 + allowance ||
        Buffer.byteLength(JSON.stringify(reference)) > 4096 + allowance) unavailable();
    const problems = reference.problems.map(problem => {
        if (!record(problem)) unavailable();
        return { ...problem, pointer: pointer(problem.pointer), expectedPointer: pointer(problem.expectedPointer) };
    });
    const mappedReference = { ...reference, pointerDomain: outputDomain, problems };
    const mapped = { ...diagnostic, referenceDiagnostics: mappedReference };
    const outputAllowance = forward ? 512 : 0;
    if (Buffer.byteLength(JSON.stringify(mapped)) > 8192 + outputAllowance ||
        Buffer.byteLength(JSON.stringify(mappedReference)) > 4096 + outputAllowance) unavailable();
    return { ...context, currentProposalDiagnostics: mapped };
}

/** Profiles7–9 change the current view, never stored plans or historical bodies. */
export function presentPlanningDomains(role: Role, context: Record<string, unknown>, planVersion: unknown): Record<string, unknown> {
    const version = planningVerificationProfile(role, context)?.version;
    const reference = plannerPlanReference(role, context, version);
    if ((version ?? 0) < 7) return context;
    const profile = context.planningVerificationProfile as Record<string, unknown>;
    if (Object.hasOwn(context, 'requirementsView')) unavailable();
    const presented = { ...mapDiagnosticPointers(mapCurrentPlans(role, context, 'requirements', 'verificationRequirements'), true),
        planningVerificationProfile: { ...profile, baseline: rename(profile.baseline, baselineNames) },
        requirementsView: requirementsView(planVersion) };
    return reference ? mapPlannerPlanReference(presented, false) : presented;
}

/** Use the original receiver; absence cannot silently select today's recipe. */
export function restorePlanningDomains(role: Role, context: Record<string, unknown>, capturedVersion: number | undefined,
    planVersion: unknown, capturedReference?: unknown): Record<string, unknown> {
    const reference = plannerPlanReference(role, context, capturedVersion);
    if (isPlanningGrammar(capturedVersion) && capturedVersion >= 8 && reference !== capturedReference) unavailable();
    const profile = context.planningVerificationProfile;
    if (!isPlanningGrammar(capturedVersion) || capturedVersion < 7) {
        if (record(profile) && isPlanningGrammar(profile.version) && profile.version >= 7) unavailable();
        return context;
    }
    if (!record(profile) || profile.version !== capturedVersion) unavailable();
    if (JSON.stringify(context.requirementsView) !== JSON.stringify(requirementsView(planVersion))) unavailable();
    const { requirementsView: _view, ...withoutView } = reference ? mapPlannerPlanReference(context, true) : context;
    const restored = { ...mapDiagnosticPointers(mapCurrentPlans(role, withoutView, 'verificationRequirements', 'requirements'), false),
        planningVerificationProfile: { ...profile, baseline: rename(profile.baseline,
            Object.fromEntries(Object.entries(baselineNames).map(([key, value]) => [value, key]))) } };
    planningVerificationProfile(role, restored);
    return restored;
}

/** Captured before awaits; includes presence, exact current plans and capability. */
export function planningDomainFootprint(role: Role, context: Record<string, unknown>, rootRequirementsHash: unknown, planVersion: unknown): string | undefined {
    const version = planningVerificationProfile(role, context)?.version;
    const reference = plannerPlanReference(role, context, version);
    if (version === undefined || version < 7) return undefined;
    if (typeof rootRequirementsHash !== 'string' || !/^[a-f0-9]{64}$/.test(rootRequirementsHash)) unavailable();
    const fields = currentPlans(role).map(path => {
        const parent = path.length === 1 ? context : context[path[0]];
        const key = path.at(-1)!;
        return { path, present: record(parent) && Object.hasOwn(parent, key),
            ...(record(parent) && Object.hasOwn(parent, key) ? { value: parent[key] } : {}) };
    });
    const bytes = JSON.stringify({ version, profile: context.planningVerificationProfile, rootRequirementsHash,
        ...(reference ? {plannerPlanReference: reference} : {}),
        requirementsView: requirementsView(planVersion), fields,
        diagnostics: { present: Object.hasOwn(context, 'currentProposalDiagnostics'),
            ...(Object.hasOwn(context, 'currentProposalDiagnostics') ? { value: context.currentProposalDiagnostics } : {}) } });
    if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) unavailable();
    return createHash('sha256').update(bytes).digest('hex');
}
