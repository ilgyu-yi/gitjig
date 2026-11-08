#!/usr/bin/env node
import path from 'node:path';
import { stageBundle } from './transaction.js';
import { activateBundle, recoverActivation } from './activation.js';
import { removeInstallation } from './removal.js';
async function main(args: readonly string[]) {
    if (args.length === 1 && args[0] === '--help') {
        console.log('Owned offline installation: stage|activate --home ABSOLUTE --bundle CANONICAL_BUNDLE; recover|remove --home ABSOLUTE. Uses pinned bundle Node, no SDK/model needed for syntax, staging or removal. Activation performs isolated scripted SDK health. State/customization retained.');
        return;
    }
    if (process.version !== 'v24.22.0')
        throw Error('Use the bundle\'s pinned Node v24.22.0');
    const [command, ...flags] = args;
    if (!command || !['stage', 'activate', 'recover', 'remove'].includes(command))
        throw Error('Use --help for supported installation operations');
    const options = new Map<string, string>();
    for (let i = 0; i < flags.length; i += 2) {
        const key = flags[i]!, value = flags[i + 1];
        if (!['--home', '--bundle'].includes(key) || options.has(key) || !value || value.startsWith('--') || !path.isAbsolute(value))
            throw Error('Explicit distinct absolute --home/--bundle required');
        options.set(key, value);
    }
    const home = options.get('--home'), bundleRoot = options.get('--bundle');
    if (!home)
        throw Error('Required --home');
    if (['stage', 'activate'].includes(command) && !bundleRoot)
        throw Error('Required --bundle');
    if (['recover', 'remove'].includes(command) && bundleRoot)
        throw Error('This operation accepts only --home');
    const result = command === 'stage' ? await stageBundle({ installationHome: home, bundleRoot: bundleRoot! }) : command === 'activate' ? await activateBundle({ installationHome: home, bundleRoot: bundleRoot! }) : command === 'recover' ? await recoverActivation(home) : await removeInstallation(home);
    console.log(JSON.stringify(result, null, 2));
}
try {
    await main(process.argv.slice(2));
}
catch (e) {
    console.error(JSON.stringify({ error: 'INSTALLATION_UNAVAILABLE', message: (e as Error).message, recovery: 'Retain owned state and activation evidence; use explicit recovery or a compatible pinned bundle' }));
    process.exitCode = 2;
}
