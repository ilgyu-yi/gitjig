import fs from 'node:fs/promises';
import { loadCriteriaSync } from './criteria.js';
import { validateCaptureProfile } from './capture.js';
import type { ProjectProtectionView } from './protection-types.js';
import type { Project, RuntimeProfile } from './types.js';
/** Read-only description of a registered project; never an execution certificate. */
export async function inspectLocalConfiguration(input: {
    project: Project;
    protection: ProjectProtectionView;
    runtimeProfile?: RuntimeProfile;
}) {
    const project = structuredClone(input.project);
    const capture = validateCaptureProfile(project.captureProfile);
    const criteria = loadCriteriaSync();
    let source: {
        state: 'matches-registration' | 'unavailable';
        reason: string | null;
    };
    try {
        const canonical = await fs.realpath(project.sourceRoot);
        const stat = await fs.stat(canonical);
        source = canonical === project.sourceRoot && stat.isDirectory()
            ? { state: 'matches-registration', reason: null }
            : { state: 'unavailable', reason: 'Registered source path no longer names the same canonical directory' };
    }
    catch (error) {
        source = { state: 'unavailable', reason: `Registered source directory unavailable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}` };
    }
    const runtime = input.runtimeProfile ? {
        dockerBinary: input.runtimeProfile.dockerBinary,
        dockerContext: input.runtimeProfile.dockerContext,
        image: input.runtimeProfile.image,
    } : null;
    return {
        projectId: project.id,
        sourceRoot: project.sourceRoot,
        source,
        discoveredRules: [
            { kind: 'registered-capture-profile', origin: 'controller-project-registration', values: capture },
            { kind: 'product-workflow-criteria', origin: 'owned-product-assets', hash: criteria.hash,
                assets: Object.fromEntries(Object.entries(criteria.assets).map(([name, value]) => [name, value.sha256])) },
        ],
        availableChecks: [{
                entry: 'local check',
                inputs: ['project', 'command', 'explicit trusted Docker binary/context/immutable image'],
                state: source.state === 'unavailable' ? 'source-unavailable' : runtime ? 'requires-execution-preflight' : 'runtime-configuration-required',
                outcome: 'Exact captured-source or scratch command observation; no agent plan or review required',
            }],
        enforcement: {
            configuredRuntime: runtime,
            currentVerification: 'not-observed-by-inspection',
            localCheckProfile: 'Read-only captured work; isolated writable scratch; native runner preflight and cleanup required',
            protectedSubpaths: { configuration: 'registered-project-policy', configured: input.protection.configured, revision: input.protection.revision, hash: input.protection.hash, protectedPaths: input.protection.protectedPaths, sourceEventId: input.protection.sourceEventId, boundRuns: input.protection.boundRuns, verified: false },
        },
        limitations: [
            'Configuration and product criteria identify intended rules, not current engine health or a successful check.',
            'No project code, Git configuration, hooks or arbitrary local policy format was executed or interpreted.',
            'Project protection configuration and bound run inputs are reported separately; native enforcement requires its actual runtime consumer and cleanup observations.',
            'No historical observation is promoted to current enforcement proof by inspection.',
        ],
        nextAction: source.state === 'unavailable'
            ? 'Restore the registered canonical directory or register a new explicit project ID.'
            : runtime ? 'Run local check with the explicit runtime profile to obtain an actual bound command outcome.'
                : 'Select an explicit runtime profile, then run local check; offline rule inspection remains available.',
    };
}
