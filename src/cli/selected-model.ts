import type { Controller } from '../controller/controller.js';
import type { PiModelSelection } from '../pi/session.js';
import { readModelProfile } from './model-profile.js';
import { nativeClaudeEnvironment } from '../pi/claude-profile.js';
let initialized = false;
/** One explicit CLI startup transition after registered-root profile validation.
 * Programmatic factories never call this and never change ambient cwd/environment. */
export async function selectControllerModel(file: string, controller: Controller, environment: Readonly<NodeJS.ProcessEnv>): Promise<PiModelSelection> {
    const nativeEnvironment = environment && Object.freeze(nativeClaudeEnvironment(environment));
    const parsed = await readModelProfile(file, controller.listProjects().map(project => project.sourceRoot));
    if (!parsed.bridgeProfile)
        return parsed as PiModelSelection;
    if (initialized)
        throw new Error('CLI bridge startup already selected; no per-session environment retargeting');
    initialized = true;
    const { createOwnedClaudeHost } = await import('../pi/claude-host.js');
    const { kind: _kind, ...input } = parsed.bridgeProfile;
    const owner = await createOwnedClaudeHost({ ...input, environment: nativeEnvironment });
    try {
        await controller.adoptModelResource(owner);
    }
    catch (error) {
        await owner.close();
        throw error;
    }
    return owner.modelSelection;
}
