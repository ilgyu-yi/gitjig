// Final installed CLI process: no extra bootstrap parent or separate task timeout.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
try {
    const payload = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), home = path.resolve(payload, '../..');
    if (!/^[a-f0-9]{64}$/.test(path.basename(payload)) || path.dirname(payload) !== path.join(home, 'versions') || process.execPath !== path.join(home, 'bootstrap/node') || process.version !== 'v24.22.0')
        throw Error('Use the owned installed launcher and runtime');
    if (process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.PI_PACKAGE_DIR || process.env.TMPDIR !== path.join(home, 'artifacts'))
        throw Error('Installed startup environment differs; use the owned launcher');
    const args = process.argv.slice(2);
    // Bind the terminal's implicit UI entry before main expands it. An empty
    // non-terminal invocation still prints usage without opening application state.
    if (!args.length && process.stdin.isTTY && process.stdout.isTTY)
        args.push('conversation', 'ui');
    const homeIndex = args.indexOf('--home');
    if (homeIndex >= 0 && args[homeIndex + 1] !== home)
        throw Error('Installed launcher binds --home to its own canonical installation');
    if (process.env.GITJIG_HOME !== undefined && (!path.isAbsolute(process.env.GITJIG_HOME) || path.resolve(process.env.GITJIG_HOME) !== home))
        throw Error('GITJIG_HOME conflicts with this bound installation; unset it or use the intended installation launcher');
    const help = !args.length || args.length === 1 && (args[0] === '--help' || args[0] === '--version'), stateless = args[0] === 'doctor' || args[0] === 'repo' && args[1] === 'recommend', productArgs = help || stateless || homeIndex >= 0 ? args : [...args, '--home', home];
    const cli = path.join(payload, 'dist/cli/main.js');
    process.argv = [process.execPath, cli, ...productArgs];
    await import(pathToFileURL(cli).href);
}
catch (e) {
    console.error(JSON.stringify({ error: 'INSTALLATION_ENTRY_UNAVAILABLE', message: (e as Error).message, recovery: 'Use this installation\'s owned launcher; retained state has not been opened by the entry' }));
    process.exitCode = 2;
}
