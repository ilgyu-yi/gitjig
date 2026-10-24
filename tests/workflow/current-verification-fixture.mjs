/** Controlled producer protocol only; never selects or manufactures host evidence. */
export function applyCurrentVerificationFixture(result, context) {
    if (context?.planningVerificationProfile?.supported === true && result.plan?.verification &&
        Array.isArray(result.plan.requirements) && Array.isArray(result.plan.verification.checks) &&
        !Object.hasOwn(result.plan.verification, 'strategies')) {
        result.plan.verification.strategies = result.plan.requirements.map(requirement => ({
            requirementId: requirement.id,
            kind: 'consumer-cases',
            checkIds: result.plan.verification.checks.filter(check => check.guaranteeIds.includes(requirement.id)).map(check => check.id),
        }));
    }
    if (Array.isArray(context?.verificationReviewRequirements) &&
        !Object.hasOwn(result, 'verificationDecisions')) {
        result.verificationDecisions = context.verificationReviewRequirements.map(requirement => ({
            requirementId: requirement.requirementId,
            strategyDigest: requirement.strategyDigest,
            witnessIds: [...requirement.witnessIds],
            verdict: 'satisfied',
            reason: 'Controlled fixture assessment of the exact supplied host-selected verification witnesses; not semantic qualification.',
        }));
    }
    return result;
}
