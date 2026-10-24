import type { Controller } from '../controller/controller.js';
import type { PiModelSelection } from '../pi/session.js';
import { readModelProfile } from './model-profile.js';
import { assertNoClaudeRoutingSelectors, claudeStartupEnvironment } from '../pi/claude-profile.js';
let initialized = false;
/** One explicit CLI startup transition after registered-root profile validation.
 * Programmatic factories never call this and never change ambient cwd/environment. */
export async function selectControllerModel(file: string, controller: Controller): Promise<PiModelSelection> {
    const parsed = await readModelProfile(file, controller.listProjects().map(project => project.sourceRoot));
    if (!parsed.bridgeProfile)
        return parsed as PiModelSelection;
    if (initialized)
        throw new Error('CLI bridge startup already selected; no per-session environment retargeting');
    assertNoClaudeRoutingSelectors();
    initialized = true;
    // This CLI owns its process; known credential/helper selectors were refused
    // before projecting presentation/OS variables into the one controlled startup.
    for (const key of Object.keys(process.env))
        if (!claudeStartupEnvironment.includes(key))
            delete process.env[key];
    process.chdir(parsed.bridgeProfile.cwd);
    process.env.PI_CODING_AGENT_DIR = parsed.bridgeProfile.agentDir;
    const { createOwnedClaudeHost } = await import('../pi/claude-host.js');
    const { kind: _kind, ...input } = parsed.bridgeProfile;
    const owner = await createOwnedClaudeHost(input);
    try {
        await controller.adoptModelResource(owner);
    }
    catch (error) {
        await owner.close();
        throw error;
    }
    return owner.modelSelection;
}
