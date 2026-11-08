import { createHash } from 'node:crypto';
import type { AtomicVerificationStrategy, PlanProposal, Role } from './types.js';
import { verificationStrategyLeaves } from './verification-strategy.js';

export const scopeAmendmentActions = ['retain', 'replace', 'remove'] as const;

export interface ScopeAmendmentDecision {
    evidenceId: string;
    action: typeof scopeAmendmentActions[number];
    reason: string;
}

export interface ScopeAmendmentProfile {
    readonly version: 1;
    /** Digest of the complete host-owned duties, premises and failed evidence. */
    readonly checkpoint: string;
    readonly subjects: readonly {
        readonly evidenceId: string;
        readonly requirementId: string;
        readonly strategyDigest: string;
    }[];
}

const evidenceId = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export function scopeStrategyDigest(strategy: Extract<AtomicVerificationStrategy,{kind:'manifest-scope-duty'}>) {
    return createHash('sha256').update(JSON.stringify([strategy.requirementId, strategy.reviewKey,
        [...strategy.allowedChangePaths].sort(), [...strategy.unchangedPaths].sort()])).digest('hex');
}

/** Capture the exact finite domain before presenting it to an independent adjudicator. */
export function captureScopeAmendment(input: unknown): ScopeAmendmentProfile {
    const profile = input as ScopeAmendmentProfile | null;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
        Object.keys(profile).sort().join(',') !== 'checkpoint,subjects,version' || profile.version !== 1 ||
        !digest(profile.checkpoint) || !Array.isArray(profile.subjects) || !profile.subjects.length || profile.subjects.length > 16)
        throw Error('Original scope amendment profile unavailable');
    const subjects = Array.from(profile.subjects, subject => {
        if (!subject || typeof subject !== 'object' || Array.isArray(subject) ||
            Object.keys(subject).sort().join(',') !== 'evidenceId,requirementId,strategyDigest' ||
            !evidenceId(subject.evidenceId) || typeof subject.requirementId !== 'string' || !subject.requirementId.trim() ||
            Buffer.byteLength(subject.requirementId) > 1024 || Buffer.from(subject.requirementId).toString('utf8') !== subject.requirementId ||
            !digest(subject.strategyDigest))
            throw Error('Original scope amendment subject unavailable');
        return Object.freeze({ ...subject });
    });
    if (new Set(subjects.map(subject => subject.evidenceId)).size !== subjects.length ||
        new Set(subjects.map(subject => subject.requirementId)).size !== subjects.length)
        throw Error('Original scope amendment subjects must be distinct');
    return Object.freeze({ version: 1, checkpoint: profile.checkpoint, subjects: Object.freeze(subjects) });
}

export function scopeAmendmentProfile(role: Role, context: Record<string, unknown>) {
    if (!Object.hasOwn(context, 'scopeAmendment')) return undefined;
    if (role !== 'adjudicator' || context.stage !== 'planning-adjudication')
        throw Error('Scope amendment belongs to its assigned planning adjudicator');
    return captureScopeAmendment(context.scopeAmendment);
}

export function validateScopeAmendmentDecisions(input: unknown, profile: ScopeAmendmentProfile, plan: PlanProposal | undefined) {
    if (!plan?.verification.strategies || !Array.isArray(input) || input.length !== profile.subjects.length)
        throw Error('An accepting scope amendment needs a decision for every original failed scope');
    const seen = new Set<string>();
    for (const decision of input) {
        const subject = profile.subjects.find(item => item.evidenceId === decision?.evidenceId);
        if (!decision || typeof decision !== 'object' || Array.isArray(decision) ||
            Object.keys(decision).sort().join(',') !== 'action,evidenceId,reason' || !subject || seen.has(subject.evidenceId) ||
            !scopeAmendmentActions.includes(decision.action) || typeof decision.reason !== 'string' ||
            !decision.reason.trim() || Buffer.byteLength(decision.reason) > 2048 ||
            Buffer.from(decision.reason).toString('utf8') !== decision.reason)
            throw Error('Scope amendment decision must name an exact original failure, action and bounded reason');
        const replacement = plan.verification.strategies.find(strategy => strategy.requirementId === subject.requirementId);
        if (!replacement) throw Error('Scope amendment must retain verification for its original requirement');
        const scope = verificationStrategyLeaves(replacement).find(strategy => strategy.kind === 'manifest-scope-duty');
        const action = !scope ? 'remove' : scopeStrategyDigest(scope) === subject.strategyDigest ? 'retain' : 'replace';
        if (decision.action !== action) throw Error('Scope amendment decision differs from the plan for its original requirement');
        seen.add(subject.evidenceId);
    }
}
