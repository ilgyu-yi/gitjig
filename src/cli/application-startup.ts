import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Controller } from '../controller/controller.js';
import type { PreparedStartup } from '../app/startup.js';
import { nativeClaudeEnvironment } from '../pi/claude-profile.js';
let configured = false;
/** Validate the one owned launcher temp boundary without changing operator identity. */
export async function validateApplicationStartup(prepared: PreparedStartup, home: string): Promise<void> {
    const bridge = prepared.configuration.bridge;
    if (!bridge)
        return;
    if (configured)
        throw Error('Application bridge startup already established; relaunch before changing it');
    if (await realpath(tmpdir()) !== join(home, 'artifacts'))
        throw Error('Bridge startup requires the owned launcher or process-start TMPDIR set to application artifacts; close and relaunch');
    configured = true;
}
export async function adoptApplicationStartup(prepared: PreparedStartup | undefined, controller: Controller, environment: Readonly<NodeJS.ProcessEnv>): Promise<void> {
    const bridge = prepared?.configuration.bridge;
    if (!bridge)
        return;
    const nativeEnvironment = { ...nativeClaudeEnvironment(environment), HOME: join(bridge.profile.agentDir, 'home'), CLAUDE_CONFIG_DIR: bridge.nativeAccountDirectory };
    const { createOwnedClaudeHost } = await import('../pi/claude-host.js');
    const { kind: _kind, ...input } = bridge.profile;
    const owner = await createOwnedClaudeHost({ ...input, environment: nativeEnvironment, ...(bridge.nativeAccountHome ? { nativeAccountHome: bridge.nativeAccountHome } : {}) });
    try {
        await controller.adoptModelResource(owner);
    }
    catch (error) {
        await owner.close();
        throw error;
    }
}
