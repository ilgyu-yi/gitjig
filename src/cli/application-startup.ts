import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Controller } from '../controller/controller.js';
import type { PreparedStartup } from '../app/startup.js';
import { assertNoClaudeRoutingSelectors, claudeStartupEnvironment } from '../pi/claude-profile.js';
let configured = false;
/** CLI-owned one-time projection; preferences cannot mutate a running context. */
export async function applyApplicationStartup(prepared: PreparedStartup, home: string): Promise<void> {
    const bridge = prepared.configuration.bridge;
    if (!bridge)
        return;
    if (configured)
        throw Error('Application bridge startup already established; relaunch before changing it');
    if (await realpath(tmpdir()) !== join(home, 'artifacts'))
        throw Error('Bridge startup requires the owned launcher or process-start TMPDIR set to application artifacts; close and relaunch');
    assertNoClaudeRoutingSelectors();
    configured = true;
    for (const key of Object.keys(process.env))
        if (!claudeStartupEnvironment.includes(key))
            delete process.env[key];
    process.chdir(bridge.profile.cwd);
    process.env.HOME = join(bridge.profile.agentDir, 'home');
    process.env.PI_CODING_AGENT_DIR = bridge.profile.agentDir;
    process.env.CLAUDE_CONFIG_DIR = bridge.nativeAccountDirectory;
}
export async function adoptApplicationStartup(prepared: PreparedStartup | undefined, controller: Controller): Promise<void> {
    const bridge = prepared?.configuration.bridge;
    if (!bridge)
        return;
    const { createOwnedClaudeHost } = await import('../pi/claude-host.js');
    const { kind: _kind, ...input } = bridge.profile;
    const owner = await createOwnedClaudeHost({ ...input, ...(bridge.nativeAccountHome ? { nativeAccountHome: bridge.nativeAccountHome } : {}) });
    try {
        await controller.adoptModelResource(owner);
    }
    catch (error) {
        await owner.close();
        throw error;
    }
}
