import type { ChangeView } from '../controller/change-types.js';

/** Only these mutation commands return a ChangeView snapshot. */
export const changeResultCommands: ReadonlySet<string> = new Set([
    'change prepare', 'change start', 'change run', 'change resume', 'change replan',
    'change activate', 'change refresh-criteria', 'change extend-resolution',
]);

export function changeReplanExitCode(result: Pick<ChangeView, 'phase' | 'blocked' | 'verificationReplanAccepted'>): 0 | 2 {
    return !result.blocked.length && (result.phase === 'PLAN_READY' ||
        result.phase === 'CANDIDATE_CAPTURED' && result.verificationReplanAccepted === true) ? 0 : 2;
}

/** Presentation only: keep the original result for exit status and --details. */
export function changeCommandResult(command: string, result: unknown, details: boolean, home: string): unknown {
    if (details || !changeResultCommands.has(command)) return result;
    const { versions, launches, checks, occurrences, dispositions, verificationEvidence, ...status } = result as ChangeView;
    return {
        format: 'change-status-v1',
        ...status,
        ...(verificationEvidence ? { verificationEvidence: {
            availability: verificationEvidence.availability,
            ...(verificationEvidence.digest ? { digest: verificationEvidence.digest } : {}),
            ...(verificationEvidence.reason ? { reason: verificationEvidence.reason } : {}),
            requirementCount: verificationEvidence.requirements.length,
        } } : {}),
        detailsOmitted: true,
        recordCounts: {
            versions: versions.length, launches: launches.length, checks: checks.length,
            occurrences: occurrences.length, dispositions: dispositions.length,
        },
        inspect: { command: 'change inspect', home, workId: status.workId },
    };
}
