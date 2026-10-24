import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { trustedDockerBinary, trustedDockerConfiguration } from './container-scope.js';
/** Explicit local metadata suggestions, never native discovery or ambient routing. */
export async function suggestRuntimePaths(options: {
    guard(): void;
    checkPath(file: string): void;
}, candidates: readonly string[] = ['/opt/homebrew/bin/docker', '/usr/local/bin/docker', '/usr/bin/docker'], configuration = join(homedir(), '.docker')) {
    const result: {
        dockerBinary?: string;
        dockerConfigDirectory?: string;
    } = {};
    for (const file of candidates) {
        options.guard();
        try {
            const value = await trustedDockerBinary(file);
            options.guard();
            options.checkPath(value);
            result.dockerBinary = value;
            break;
        }
        catch {
            options.guard();
        }
    }
    options.guard();
    try {
        const value = await trustedDockerConfiguration(await realpath(configuration));
        options.guard();
        options.checkPath(value);
        result.dockerConfigDirectory = value;
    }
    catch {
        options.guard();
    }
    options.guard();
    return result;
}
