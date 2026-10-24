#!/usr/bin/env node
// Build a source checkout and install its packaged snapshot through npm's normal global prefix.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

/** Keep prompt resource ownership local; each caller retains its own closed result. */
async function withTerminal(task, closedValue) {
    const terminal = createInterface({input: process.stdin, output: process.stdout});
    const abort = new AbortController(), cancel = () => abort.abort();
    terminal.on('SIGINT', cancel); terminal.on('close', cancel);
    try { return await task(terminal, abort.signal); }
    catch (error) { if (!abort.signal.aborted) throw error; return closedValue; }
    finally { terminal.close(); }
}

async function confirm(question, defaultYes = true) {
    return withTerminal(async (terminal, signal) => {
        while (true) {
            const answer = (await terminal.question(question, {signal})).trim();
            if (!answer) return defaultYes;
            if (/^y(?:es)?$/iu.test(answer)) return true;
            if (/^n(?:o)?$/iu.test(answer)) return false;
            console.log('Please answer yes or no.');
        }
    }, false);
}

async function choose(question, labels) {
    return withTerminal(async (terminal, signal) => {
        while (true) {
            console.log(question + '\n' + labels.map((label, index) => `${index + 1}. ${label}`).join('\n'));
            const answer = (await terminal.question('Choose [1]: ', {signal})).trim() || '1';
            const index = Number(answer) - 1;
            if (Number.isInteger(index) && index >= 0 && index < labels.length) return labels[index];
            console.log('Choose one of the numbered actions.');
        }
    }, labels[0]);
}

async function writablePrefix(prefix) {
    for (const target of [prefix, path.join(prefix, 'bin'), path.join(prefix, 'lib/node_modules')]) {
        let current = target;
        while (true) {
            try {
                if (!(await fs.stat(current)).isDirectory()) throw Error('Not a directory: ' + current);
                await fs.access(current, fs.constants.W_OK | fs.constants.X_OK); break;
            } catch (error) {
                if (error.code !== 'ENOENT') throw Error(`Installation path is not writable: ${target} (${error.message})`);
                const parent = path.dirname(current);
                if (parent === current) throw error;
                current = parent;
            }
        }
    }
}

async function runTerminalChild(file, args, childEnv, label) {
    const rawBefore = !!process.stdin.isRaw;
    return await new Promise(resolve => {
        let child, timer, requested, failure, finished = false, cleanupUnknown = false;
        const armCleanup = () => { timer ??= setTimeout(() => {
            cleanupUnknown = true;
            try { child?.kill('SIGKILL'); } catch (error) { failure ??= error; }
            console.error(`${label} cleanup unconfirmed; inspect original ${label === 'Runtime helper' ? 'helper' : 'application'} PID ${child?.pid ?? 'not-started'} and its subprocesses. Package/VM/engine effects may remain.`);
            child?.unref(); finish({error: failure, status: null});
        }, 10000); };
        const cancel = signal => { requested = signal; armCleanup(); try { child?.kill(signal); } catch (error) { failure ??= error; } };
        const interrupt = () => cancel('SIGINT'), terminate = () => cancel('SIGTERM');
        process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
        const finish = result => {
            if (finished) return;
            finished = true; clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
            try { process.stdin.setRawMode(rawBefore); } catch (error) { cleanupUnknown = true; result.error ??= error; }
            resolve({...result, cleanupUnknown, interrupted: !!requested});
        };
        child = spawn(file, args, {env: childEnv, stdio: 'inherit'});
        child.on('error', error => {
            failure ??= error;
            if (!child.pid) finish({error, status: null});
            else { cleanupUnknown = true; armCleanup(); }
        });
        child.on('close', status => { if (status === 2 && label === 'Runtime helper') cleanupUnknown = true; finish({status, error: failure}); });
        if (requested) child.kill(requested);
    });
}

const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
async function pathCommand(name, search = process.env.PATH ?? '') {
    for (const directory of search.split(path.delimiter)) {
        const candidate = path.resolve(directory || '.', name);
        try {
            if (!(await fs.stat(candidate)).isFile()) continue;
            await fs.access(candidate, fs.constants.X_OK);
            return await fs.realpath(candidate);
        } catch { /* The shell skips unavailable or nonexecutable candidates. */ }
    }
}
const source = path.dirname(fileURLToPath(import.meta.url));
let scratch;
try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
        console.log('Usage: node install.mjs [--prefix ABSOLUTE_PATH] [--setup-runtime]\nBuild and install gitjig. Interactive terminals offer optional Docker/Colima and execution-image preparation. --setup-runtime requires an interactive terminal. Noninteractive installation prepares only the application. No automatic sudo, shell profile edits or account import.');
    } else {
        let selectedPrefix, setupRuntime = false;
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--prefix' && !selectedPrefix && path.isAbsolute(args[i + 1] ?? '')) selectedPrefix = args[++i];
            else if (args[i] === '--setup-runtime' && !setupRuntime) setupRuntime = true;
            else throw Error('Use --help, --prefix ABSOLUTE_PATH, or --setup-runtime');
        }
        if (setupRuntime && (!process.stdin.isTTY || !process.stdout.isTTY)) throw Error('--setup-runtime requires an interactive terminal; no installation started');
        if (process.platform === 'win32') throw Error('Native Windows is not yet supported; run installation inside WSL with a Linux Node installation.');
        const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
        const minimum = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(pkg.engines.node);
        if (!minimum) throw Error('Unsupported Node requirement format');
        const observed = process.versions.node.split('.').map(Number), wanted = minimum.slice(1).map(Number);
        let comparison = 0;
        for (let i = 0; i < 3 && comparison === 0; i++) comparison = Math.sign(observed[i] - wanted[i]);
        if (comparison < 0 || !/^\d+\.\d+\.\d+$/.test(process.versions.node)) throw Error(`Node ${pkg.engines.node} required; found ${process.version}`);
        // Run npm's JavaScript CLI with the same Node that passed admission.
        const npmCandidates = [path.join(path.dirname(process.execPath), 'npm'),
            ...(process.env.npm_execpath ? [process.env.npm_execpath] : []),
            ...(process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, 'npm'))];
        let npm;
        for (const candidate of npmCandidates) {
            try { const resolved = await fs.realpath(candidate); if (resolved.endsWith('.js')) { npm = resolved; break; } } catch { /* Try the next installed CLI. */ }
        }
        if (!npm) throw Error('Cannot find the npm JavaScript CLI. Install npm alongside Node or put its npm launcher on PATH.');
        const childEnv = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? '') };
        let validateRetry = async () => {};
        let emitted, artifact, artifactHash;
        const run = async (argv, capture = false) => {
            const command = [...argv];
            while (true) {
                const began = performance.now();
                console.log(`Starting npm ${command[0]}…`);
                const result = spawnSync(process.execPath, [npm, ...command], { cwd: source, env: childEnv, shell: false, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
                if (!result.error && result.status === 0) {
                    console.log(`Finished npm ${command[0]} · ${((performance.now() - began) / 1000).toFixed(1)}s`);
                    return result.stdout?.trim();
                }
                const failure = Error(`npm ${command[0]} failed; ${result.error?.message ?? result.signal ?? 'see output above'}. Package/build files may have changed; no rollback is claimed.`);
                if (result.error || result.signal || !process.stdin.isTTY || !process.stdout.isTTY) throw failure;
                console.error(failure.message);
                if (!await confirm(`Retry only npm ${command[0]} after rechecking source and installation paths? [y/N]: `, false)) throw failure;
                await validateRetry();
                if (command[0] === 'pack') {
                    await fs.rm(scratch, {recursive: true, force: true});
                    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-install-'));
                    command[command.indexOf('--pack-destination') + 1] = scratch;
                }
            }
        };
        let prefix = selectedPrefix ?? await run(['prefix', '--global'], true);
        if (!path.isAbsolute(prefix)) throw Error('npm global prefix must be absolute');
        try { await writablePrefix(prefix); }
        catch (error) {
            if (selectedPrefix || !process.stdin.isTTY || !process.stdout.isTTY)
                throw Error(`${error.message}. Select a writable --prefix ABSOLUTE_PATH; no build or installation started.`);
            const fallback = path.join(os.homedir(), '.local');
            console.log(error.message);
            await writablePrefix(fallback);
            if (!await confirm(`Install into your user directory ${fallback} instead? [Y/n]: `)) throw Error('Installation cancelled; no build or installation started.');
            prefix = fallback;
        }
        // Never run as root automatically or change npm's persistent configuration.
        const inputNames = [...new Set(['src', 'runtime', 'qualification', 'tools/build.mjs', 'tsconfig.qualification.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'install.mjs', 'install.sh', ...pkg.files.filter(p => p !== 'dist/').map(p => p.replace(/\/$/, ''))])];
        const census = async names => {
            const result = [];
            const visit = async relative => {
                const file = path.join(source, relative), info = await fs.lstat(file);
                if (info.isSymbolicLink()) throw Error('Source snapshot cannot contain symlinks: ' + relative);
                if (info.isDirectory()) { for (const name of (await fs.readdir(file)).sort()) await visit(path.join(relative, name)); }
                else if (info.isFile()) result.push([relative, createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
                else throw Error('Source snapshot requires regular files: ' + relative);
            };
            for (const name of names) await visit(name);
            return JSON.stringify(result);
        };
        const inputs = await census(inputNames);
        validateRetry = async () => {
            if (inputs !== await census(inputNames) || emitted !== undefined && emitted !== await census(['dist'])) throw Error('Source/build inputs changed; retry refused. Reopen installation from a stable checkout.');
            await writablePrefix(prefix);
            if (artifact) {
                const info = await fs.lstat(artifact);
                if (!info.isFile() || createHash('sha256').update(await fs.readFile(artifact)).digest('hex') !== artifactHash) throw Error('Packaged archive changed; retry refused.');
            }
        };
        console.log(`Installing gitjig into ${prefix}`);
        await run(['ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
        await fs.rm(path.join(source, 'dist'), { recursive: true, force: true });
        await run(['run', 'build']);
        emitted = await census(['dist']);
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-install-'));
        const filename = await run(['pack', '--ignore-scripts', '--quiet', '--pack-destination', scratch], true);
        if (filename !== `${pkg.name}-${pkg.version}.tgz` || path.basename(filename) !== filename) throw Error('Unexpected npm pack result');
        if (inputs !== await census(inputNames) || emitted !== await census(['dist'])) throw Error('Source/build inputs changed during packaging. Rerun from a stable checkout; global installation was not changed.');
        artifact = path.join(scratch, filename);
        artifactHash = createHash('sha256').update(await fs.readFile(artifact)).digest('hex');
        await run(['install', '--global', '--prefix', prefix, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(scratch, filename)]);
        const command = path.join(prefix, 'bin', 'gitjig');
        const check = spawnSync(command, ['--version'], { env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        if (check.error || check.status !== 0) throw Error(`Installed command check failed: ${check.error?.message ?? check.stderr}`);
        const identity = JSON.parse(check.stdout);
        if (identity.application !== pkg.name || identity.version !== pkg.version || identity.piSdkVersion !== pkg.dependencies['@earendil-works/pi-coding-agent']) throw Error('Installed command identity differs from the packaged application/SDK');
        const installedEntry = await fs.realpath(command), resolvedCommand = await pathCommand('gitjig');
        const launchSetupNeeded = resolvedCommand !== installedEntry;
        console.log(`Installed: ${command}\nRun: ${launchSetupNeeded ? shellQuote(process.execPath) + ' ' + shellQuote(installedEntry) : 'gitjig'}\nExact Node launch: ${shellQuote(process.execPath)} ${shellQuote(installedEntry)}\nUninstall: npm uninstall --global --prefix ${shellQuote(prefix)} gitjig`);
        if (launchSetupNeeded) console.log(`PATH setup remains: ${resolvedCommand ? 'gitjig currently resolves to ' + resolvedCommand + '. Put ' + path.join(prefix, 'bin') + ' before that entry' : 'add ' + path.join(prefix, 'bin') + ' to PATH'}, or use the exact Node launch above. Your shell profile was not edited.`);
        if (process.stdin.isTTY && process.stdout.isTTY) {
            if (!setupRuntime) setupRuntime = await confirm('Prepare a Docker/Colima runtime and execution image now? [Y/n]: ');
            let launchForRepair = false;
            if (setupRuntime) {
                const helper = path.resolve(path.dirname(await fs.realpath(command)), '../../runtime/setup.mjs');
                while (true) {
                    const prepared = await runTerminalChild(process.execPath, [helper], childEnv, 'Runtime helper');
                    if (!prepared.error && prepared.status === 0 && !prepared.cleanupUnknown) break;
                    console.error(prepared.cleanupUnknown ? 'Gitjig remains installed. Runtime preparation is unconfirmed. Inspect the original helper/subprocesses and saved runtime before retrying.' :
                        'Gitjig remains installed. Runtime preparation did not complete. You can reopen setup without reinstalling the application.');
                    process.exitCode = prepared.cleanupUnknown ? 2 : 1;
                    if (prepared.cleanupUnknown || prepared.interrupted) break;
                    const action = await choose('Choose how to continue after runtime preparation', ['Finish installation', 'Retry runtime preparation', 'Open gitjig to repair setup']);
                    if (action === 'Retry runtime preparation') { process.exitCode = 0; continue; }
                    if (action === 'Open gitjig to repair setup') { launchForRepair = true; process.exitCode = 0; }
                    break;
                }
            }
            if (launchForRepair || !process.exitCode && launchSetupNeeded && await confirm('Launch gitjig now using the installed command? [Y/n]: ')) {
                const launched = await runTerminalChild(command, [], childEnv, 'Application');
                if (launched.error || launched.status !== 0 || launched.cleanupUnknown) {
                    console.error(launched.cleanupUnknown ? 'Gitjig remains installed. Application cleanup is unconfirmed; inspect the reported process before retrying.' : 'Gitjig remains installed. Application launch failed; follow its startup diagnostic above and retry the exact Node launch command.');
                    process.exitCode = launched.cleanupUnknown ? 2 : launched.status || 1;
                }
            }
        }
    }
} catch (error) {
    console.error(`Installation failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    if (scratch) await fs.rm(scratch, { recursive: true, force: true });
}
