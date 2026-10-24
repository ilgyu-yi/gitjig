import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { privateDirectory, privateFile, acquireOwner } from '../controller/ownership.js';
import { installedHandshake } from './handshake.js';
/** Standalone loaded diagnostic uses the same owner lock, a fresh namespace and no live Store. */
export async function runLoadedHealth(home: string) {
    await privateDirectory(home);
    await privateDirectory(path.join(home, 'state'));
    const release = await acquireOwner(path.join(home, 'state'));
    try {
        await privateFile(path.join(home, 'binding.json'));
        const binding = JSON.parse(await fs.readFile(path.join(home, 'binding.json'), 'utf8'));
        if (binding.format !== 1 || typeof binding.payloadId !== 'string' || !/^[a-f0-9]{64}$/.test(binding.payloadId) || await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) !== path.join(home, 'versions', binding.payloadId))
            throw Error('Loaded health module differs from selected installed version');
        try {
            await fs.lstat(path.join(home, 'activation.json'));
            throw Error('Recover activation before loaded health');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        const namespace = path.join(home, 'state', 'health-' + randomUUID());
        await privateDirectory(namespace);
        for (const name of ['state', 'work', 'artifacts'])
            await privateDirectory(path.join(namespace, name));
        // This process has not imported Pi. Its first SDK import observes one fixed health artifact root.
        process.env.TMPDIR = path.join(namespace, 'artifacts');
        const receipt = await installedHandshake(namespace);
        await fs.writeFile(path.join(namespace, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        return receipt;
    }
    finally {
        await release();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 3)
            throw Error('Explicit installed home required');
        console.log(JSON.stringify(await runLoadedHealth(process.argv[2]!)));
    }
    catch (e) {
        console.error(JSON.stringify({ error: 'LOADED_HEALTH_UNAVAILABLE', message: (e as Error).message }));
        process.exitCode = 2;
    }
}
