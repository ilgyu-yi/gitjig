import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControllerError } from '../controller/types.js';
import { privateFile } from '../controller/ownership.js';
const invalid = (message: string) => new ControllerError('INSTALLATION_BINDING_INVALID', message, 'Recover the owned installation binding with its compatible installed runtime before opening state');
async function optionalJson(file: string) {
    await privateFile(file);
    try {
        const stat = await fs.lstat(file);
        if (stat.size > 64 * 1024)
            throw invalid('Installation metadata exceeds its bounded profile');
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw invalid('Installation metadata requires an object');
        return value as Record<string, unknown>;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return null;
        throw e;
    }
}
/** Called under the existing owner lock BEFORE live Store open/migration.
 * Maintenance migrates only its owned clone and does not open a live Controller. */
export async function assertNoPendingActivation(home: string): Promise<void> {
    let pending = false;
    try {
        await fs.lstat(path.join(home, 'activation.json'));
        pending = true;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw e;
    }
    if (pending)
        throw new ControllerError('ACTIVATION_PENDING', 'Owned installation activation is undecided', 'Run explicit installation recovery under the existing owner lock before opening live controller state');
    const marker = await optionalJson(path.join(home, 'controller.json')), managed = marker?.installation;
    if (managed !== undefined) {
        if (!managed || typeof managed !== 'object' || Array.isArray(managed) || Object.keys(managed).some(k => !['format', 'state'].includes(k)) || (managed as {
            format?: unknown;
        }).format !== 1 || !['active', 'removed'].includes((managed as {
            state: string;
        }).state))
            throw invalid('Managed installation marker is invalid');
        if ((managed as {
            state: string;
        }).state === 'removed')
            throw new ControllerError('INSTALLATION_REMOVED', 'Installed assets were removed; durable owner state is retained', 'Reinstall a compatible owned bundle before opening this managed state');
    }
    const binding = await optionalJson(path.join(home, 'binding.json'));
    if (!binding) {
        if (managed !== undefined)
            throw invalid('Managed state has no active binding');
        return;
    }
    if (Object.keys(binding).some(k => !['format', 'payloadId', 'manifestSha256', 'generation', 'previous'].includes(k)) || binding.format !== 1 || typeof binding.payloadId !== 'string' || !/^[a-f0-9]{64}$/.test(binding.payloadId) || typeof binding.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binding.manifestSha256) || !Number.isSafeInteger(binding.generation) || (binding.generation as number) < 1 || binding.previous !== null && (typeof binding.previous !== 'string' || !/^[a-f0-9]{64}$/.test(binding.previous)))
        throw invalid('Active installation binding is invalid');
    const actualPayload = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
    if (actualPayload !== path.join(home, 'versions', binding.payloadId) || await fs.realpath(process.execPath) !== path.join(home, 'bootstrap/node') || process.version !== 'v24.22.0')
        throw new ControllerError('INSTALLATION_RUNTIME_MISMATCH', 'Actual loaded controller/runtime does not match the current owned installation binding', 'Use this installation\'s owned launcher; completed updates cannot admit an older queued runtime');
}
/** Early read-only checks are allowed; repeat under the owner lock before maintenance writes. */
export async function assertNoPendingReset(home: string): Promise<void> {
    try {
        await fs.lstat(path.join(home, 'reset-pending.json'));
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return;
        throw error;
    }
    throw new ControllerError('RESET_PENDING', 'Local reset is interrupted', 'Run gitjig reset recover --home ' + home + ' before installation maintenance or reopening');
}
