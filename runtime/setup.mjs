#!/usr/bin/env node
// Shared owner-operated preparation. No SDK, agent authority or alternate startup store.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {createHash, randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';

const recipeNames = ['Dockerfile', 'Dockerfile.dockerignore', 'io-helper.mjs'];
const recipeDirectory = fileURLToPath(new URL('./', import.meta.url));
const printable = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value);
const check = options => { options.signal?.throwIfAborted(); options.guard?.(); };

export async function executable(file) {
    if (process.platform === 'win32') throw Error('Native Windows runtime preparation is unavailable; use Linux/WSL');
    if (!printable(file) || !path.isAbsolute(file)) throw Error('Choose an absolute executable path');
    const resolved = await fs.realpath(file), info = await fs.stat(resolved);
    if (!info.isFile() || info.mode & 0o022 || ![0, process.getuid()].includes(info.uid)) throw Error('Executable must be an owner/root-owned file without group/world write access');
    await fs.access(resolved, constants.X_OK);
    return resolved;
}

export async function findExecutable(name, search = process.env.PATH ?? '') {
    for (const directory of search.split(path.delimiter).filter(path.isAbsolute)) {
        try { return await executable(path.join(directory, name)); } catch { /* Try the next existing candidate. */ }
    }
}

export function preparationEnvironment(env = process.env) {
    const result = {...env};
    for (const key of Object.keys(result)) if (/^(DOCKER_|BUILDX_|BUILDKIT_|COLIMA_|LIMA_)/u.test(key)) delete result[key];
    delete result.NODE_OPTIONS; delete result.NODE_PATH;
    return result;
}

/** Own/join the local process group; cancellation does not roll back engine/package effects. */
export async function runCommand(file, args, options = {}) {
    if (process.platform === 'win32') throw Error('Runtime preparation requires Unix process-group ownership; use Linux/WSL');
    check(options);
    file = await executable(file); check(options);
    options.checkPath?.(file);
    const began = performance.now();
    options.onOutput?.(`\n> ${path.basename(file)} ${args.join(' ')}\n`);
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, {cwd: options.cwd ?? homedir(), env: options.env ?? preparationEnvironment(), detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        let stdout = '', stderr = '', closed = false, failure, finished = false, cleanup, grace, poll;
        const gone = () => { if (!child.pid) return true; try { process.kill(-child.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };
        const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure ??= error; } };
        const release = () => { clearTimeout(deadline); clearTimeout(cleanup); clearTimeout(grace); clearInterval(poll); clearInterval(heartbeat); options.signal?.removeEventListener('abort', abort); };
        const finish = () => {
            if (finished || !closed || !gone()) return;
            finished = true; release();
            const durationMs = performance.now() - began;
            try { options.onOutput?.(`\n${failure ? 'Stopped' : 'Finished'} · ${(durationMs / 1000).toFixed(1)}s\n`); } catch (error) { failure ??= error; }
            if (failure) reject(failure); else resolve({stdout, stderr, durationMs});
        };
        const stop = error => {
            if (finished) return;
            clearTimeout(grace); failure ??= error; kill();
            if (!cleanup) {
                poll ??= setInterval(finish, 20);
                cleanup = setTimeout(() => {
                    if (finished) return;
                    kill();
                    if (closed && gone()) { finish(); return; }
                    finished = true; release(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
                    reject(Object.assign(Error(`Preparation cleanup unconfirmed for process group ${child.pid ?? 'not-started'}. Inspect it before retrying. Engine/package changes may remain.`), {code: 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN'}));
                }, 2000);
            }
            finish();
        };
        const abort = () => stop(Object.assign(Error('Preparation cancelled. Downloaded packages, a started VM or engine build state may remain; saved runtime is unchanged.'), {code: 'RUNTIME_PREPARATION_CANCELLED'}));
        const deadline = setTimeout(() => stop(Error('Preparation exceeded its 30-minute deadline; engine/package changes may remain.')), options.timeoutMs ?? 1800000);
        const heartbeat = options.onProgress ? setInterval(() => { try { options.onProgress(performance.now() - began); } catch (error) { stop(error); } }, 1000) : undefined;
        for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) {
            const decoder = new StringDecoder('utf8');
            const collect = text => {
                if (!text) return;
                if (isError) stderr = (stderr + text).slice(-65536); else stdout = (stdout + text).slice(-65536);
                try { options.onOutput?.(text); } catch (error) { stop(error); }
            };
            stream.on('data', bytes => collect(decoder.write(bytes)));
            stream.on('end', () => collect(decoder.end()));
        }
        child.on('error', stop);
        child.on('exit', (code, signal) => {
            if (code !== 0 || signal) stop(Object.assign(Error(`Preparation command failed (${signal ?? code}). ${stderr.slice(-1200)}`), {code: signal ? 'RUNTIME_PREPARATION_CANCELLED' : 'RUNTIME_PREPARATION_COMMAND_FAILED'}));
            else if (!failure && !finished) {
                grace = setTimeout(() => stop(Error('Preparation left an unsettled local process group')), 2000);
                poll ??= setInterval(finish, 20);
                finish();
            }
        });
        child.on('close', () => { closed = true; finish(); });
        options.signal?.addEventListener('abort', abort, {once: true});
        if (options.signal?.aborted) abort();
    });
}

async function futurePath(file) {
    if (!printable(file) || !path.isAbsolute(file)) throw Error('Choose an absolute single-line path');
    let ancestor = file;
    const suffix = [];
    while (true) {
        try { return path.join(await fs.realpath(ancestor), ...suffix); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const info = await fs.lstat(ancestor).catch(missing => { if (missing.code !== 'ENOENT') throw missing; });
            if (info?.isSymbolicLink()) throw Error('Preparation cannot use a dangling path link');
            const parent = path.dirname(ancestor);
            if (parent === ancestor) throw error;
            suffix.unshift(path.basename(ancestor)); ancestor = parent;
        }
    }
}
async function configurationDirectory(file, create = false, options = {}) {
    check(options);
    if (!printable(file) || !path.isAbsolute(file)) throw Error('Choose an absolute Docker configuration directory');
    if (create && !await fs.access(file).then(() => true, () => false)) {
        const parent = await fs.realpath(path.dirname(file)), info = await fs.stat(parent);
        if (info.mode & 0o022 || ![0, process.getuid()].includes(info.uid)) throw Error('Configuration parent must be owner/root-owned without group/world write access');
        options.checkPath?.(path.join(parent, path.basename(file))); check(options);
        await fs.mkdir(path.join(parent, path.basename(file)), {mode: 0o700});
    }
    const resolved = await fs.realpath(file), info = await fs.stat(resolved);
    if (!info.isDirectory() || info.mode & 0o022 || ![0, process.getuid()].includes(info.uid)) throw Error('Choose an owner/root-owned configuration directory without group/world write access');
    options.checkPath?.(resolved); check(options); return resolved;
}
async function route(input, options = {}) {
    const dockerBinary = await executable(input.dockerBinary), dockerConfigDirectory = await configurationDirectory(input.dockerConfigDirectory, false, options);
    options.checkPath?.(dockerBinary);
    if (!/^[a-zA-Z0-9_.-]{1,100}$/u.test(input.dockerContext ?? '')) throw Error('Choose an explicit Docker context');
    return {dockerBinary, dockerConfigDirectory, dockerContext: input.dockerContext};
}
export async function routeIdentity(input) {
    const hash = createHash('sha256'); let entries = 0, bytes = 0;
    const visit = async file => {
        if (++entries > 2048) throw Error('Docker route metadata exceeds the preparation bound');
        let info;
        try { info = await fs.lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; hash.update(file + ':absent'); return; }
        if (info.isSymbolicLink() || ![0, process.getuid()].includes(info.uid) || info.mode & 0o022) throw Error('Docker route metadata must be trusted regular files/directories');
        hash.update(JSON.stringify([file, info.dev, info.ino, info.mode, info.size, info.mtimeMs]));
        if (info.isDirectory()) for (const name of (await fs.readdir(file)).sort()) await visit(path.join(file, name));
        else if (info.isFile()) {
            bytes += info.size;
            if (info.size > 1024 * 1024 || bytes > 8 * 1024 * 1024) throw Error('Docker route metadata exceeds the preparation byte bound');
            hash.update(await fs.readFile(file));
        } else throw Error('Docker route metadata requires regular files');
    };
    const executableInfo = await fs.stat(input.dockerBinary);
    const directoryInfo = await fs.stat(input.dockerConfigDirectory);
    hash.update(JSON.stringify([input.dockerBinary, executableInfo.dev, executableInfo.ino, executableInfo.mode, executableInfo.uid, executableInfo.size, executableInfo.mtimeMs]));
    hash.update(JSON.stringify([input.dockerConfigDirectory, directoryInfo.dev, directoryInfo.ino, directoryInfo.mode, directoryInfo.uid]));
    // Buildx runtime/cache files can change during a build; route and TLS metadata cannot.
    await visit(path.join(input.dockerConfigDirectory, 'config.json'));
    await visit(path.join(input.dockerConfigDirectory, 'contexts'));
    return hash.digest('hex');
}

export function imagePackages(value = '') {
    if (typeof value !== 'string' || value.length > 2048) throw Error('Enter at most 32 Debian package names');
    const names = value.trim() ? value.trim().split(/\s+/u) : [];
    if (names.length > 32 || names.some(name => !/^[a-z0-9][a-z0-9+.-]{0,99}$/u.test(name))) throw Error('Use literal Debian package names separated by spaces, for example python3 build-essential; shell commands and options are not accepted');
    return [...new Set(names)].join(' ');
}

export async function buildImage(input, options = {}) {
    const packages = imagePackages(options.extraPackages);
    check(options); const captured = await route(input, options); check(options);
    const before = JSON.stringify(await routeIdentity(captured));
    const root = path.join(await fs.realpath(options.temporaryRoot ?? '/tmp'), 'gitjig-image-' + randomUUID());
    options.checkPath?.(root); check(options);
    await fs.mkdir(root, {mode: 0o700});
    try {
        options.checkPath?.(root); check(options);
        const context = path.join(root, 'context'), idFile = path.join(root, 'image-id');
        await fs.mkdir(context);
        for (const name of recipeNames) {
            const source = path.join(options.recipe ?? recipeDirectory, name), info = await fs.lstat(source);
            if (!info.isFile()) throw Error('Installed recipe requires regular assets');
            await fs.copyFile(source, path.join(context, name), constants.COPYFILE_EXCL);
        }
        check(options);
        await (options.execute ?? runCommand)(captured.dockerBinary, ['--config', captured.dockerConfigDirectory, '--context', captured.dockerContext, 'build', ...packages ? ['--build-arg', 'GITJIG_EXTRA_PACKAGES=' + packages] : [], '--file', path.join(context, 'Dockerfile'), '--iidfile', idFile, context], options);
        check(options);
        if (JSON.stringify(await routeIdentity(captured)) !== before) throw Object.assign(Error('Docker route changed during preparation; image is not staged'), {code: 'RUNTIME_PREPARATION_ROUTE_CHANGED'});
        const info = await fs.lstat(idFile);
        if (!info.isFile() || info.size > 256) throw Error('Build did not produce a fresh regular image-ID file');
        const image = (await fs.readFile(idFile, 'utf8')).trim();
        if (!/^sha256:[a-f0-9]{64}$/u.test(image)) throw Error('Build did not return an immutable image ID');
        check(options); return {...captured, image};
    } finally { await fs.rm(root, {recursive: true, force: true}); }
}

/** Explicit engine/image metadata check only: no container, project code or model. */
export async function checkRuntime(input, options = {}) {
    check(options);
    if (!/^(?:sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/u.test(input.image ?? '')) throw Error('Select an immutable image ID or digest before checking runtime');
    const captured = await route(input, options), before = JSON.stringify(await routeIdentity(captured));
    const args = ['--config', captured.dockerConfigDirectory, '--context', captured.dockerContext];
    const execute = options.execute ?? runCommand;
    const version = await execute(captured.dockerBinary, [...args, 'version', '--format', '{{json .Server.Version}}'], {...options, timeoutMs: 15000});
    check(options);
    const engineVersion = JSON.parse(version.stdout.trim());
    if (typeof engineVersion !== 'string' || !engineVersion.trim()) throw Error('Selected engine did not report a version');
    const inspected = await execute(captured.dockerBinary, [...args, 'image', 'inspect', '--format', '{{json .Id}}', input.image], {...options, timeoutMs: 15000});
    check(options);
    const id = JSON.parse(inspected.stdout.trim());
    if (typeof id !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(id) || input.image.startsWith('sha256:') && id !== input.image) throw Error('Selected image was not found with its expected immutable identity');
    if (JSON.stringify(await routeIdentity(captured)) !== before) throw Object.assign(Error('Docker route changed during runtime check'), {code: 'RUNTIME_PREPARATION_ROUTE_CHANGED'});
    options.onOutput?.(`Engine ${engineVersion} · image ${id} found. This checks connection and image presence only; isolation, shared paths and project tools are not verified.\n`);
    check(options); return {...captured, image: input.image};
}

export async function prepareColima(input, options = {}) {
    const platform = options.platform ?? process.platform;
    if (!['darwin', 'linux'].includes(platform)) throw Error('Automatic Colima preparation supports macOS and Linux');
    const ownerHome = await fs.realpath(options.ownerHome ?? homedir()), profile = input.profile ?? 'gitjig';
    if (!/^[a-zA-Z0-9_-]{1,48}$/u.test(profile)) throw Error('Choose a simple Colima profile name');
    check(options);
    const colimaHome = await futurePath(path.join(ownerHome, '.colima'));
    const profilePath = await futurePath(path.join(colimaHome, profile));
    const context = profile === 'default' ? 'colima' : 'colima-' + profile;
    const validateColimaPaths = async () => {
        check(options);
        if (await futurePath(path.join(ownerHome, '.colima')) !== colimaHome || await futurePath(path.join(ownerHome, '.colima', profile)) !== profilePath) throw Error('Colima storage changed; review profile settings again');
        options.checkPath?.(colimaHome); options.checkPath?.(profilePath);
        // Reuse the complete storage census after every retry choice, before dispatch.
        for (const name of ['_lima', '_store', '_lima/_disks', '_lima/_disks/' + context, '_lima/' + context,
            '_lima/' + context + '/lima.yaml', '_store/' + context + '.json', profile + '/colima.yaml'])
            options.checkPath?.(await futurePath(path.join(colimaHome, name)));
    };
    await validateColimaPaths();
    if (!input.reuse && await fs.access(profilePath).then(() => true, () => false)) throw Error('This Colima profile already exists. Explicitly reuse it or choose a new name; it was not changed.');
    const phase = async (file, args, settings, title) => {
        const resolved = await executable(file);
        const identity = async () => { const s = await fs.stat(resolved); return JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.mode, s.uid]); };
        const before = await identity();
        while (true) {
            check(options);
            if (await executable(file) !== resolved || await identity() !== before) throw Error('Preparation executable changed; review prerequisites again');
            await validateColimaPaths();
            await configurationDirectory(config, false, options);
            try { return await (options.execute ?? runCommand)(resolved, args, settings); }
            catch (error) {
                if (['RUNTIME_PREPARATION_CLEANUP_UNKNOWN', 'RUNTIME_PREPARATION_ROUTE_CHANGED', 'RUNTIME_PREPARATION_CANCELLED'].includes(error.code)) throw error;
                check(options);
                if (error.code !== 'RUNTIME_PREPARATION_COMMAND_FAILED' || !options.retryCommand || !await options.retryCommand(title, error)) throw error;
            }
        }
    };
    let dockerBinary = input.dockerBinary, colimaBinary = input.colimaBinary;
    const config = await configurationDirectory(input.dockerConfigDirectory ?? path.join(ownerHome, '.docker'), true, options);
    if (input.installPackages) {
        const brew = await executable(input.brewBinary);
        options.checkPath?.(brew);
        await phase(brew, ['install', 'colima', 'docker', 'docker-buildx'], {...options, env: {...options.env ?? preparationEnvironment(), NONINTERACTIVE: '1', HOMEBREW_NO_AUTO_UPDATE: '1'}}, 'Install Colima, Docker and Buildx'); check(options);
        const prefix = (await (options.execute ?? runCommand)(brew, ['--prefix'], options)).stdout.trim();
        if (!path.isAbsolute(prefix) || !printable(prefix)) throw Error('Homebrew did not report an absolute prefix');
        dockerBinary = path.join(prefix, 'bin/docker'); colimaBinary = path.join(prefix, 'bin/colima');
        // Add only a new plugin link; never overwrite existing client configuration or plugins.
        const pluginDir = await configurationDirectory(path.join(config, 'cli-plugins'), true, options);
        const plugin = await executable(path.join(prefix, 'opt/docker-buildx/bin/docker-buildx')), link = path.join(pluginDir, 'docker-buildx');
        options.checkPath?.(plugin); check(options);
        try { await fs.symlink(plugin, link); } catch (error) {
            if (error.code !== 'EEXIST' || await fs.realpath(link) !== plugin) throw Error('Existing Buildx plugin differs; no plugin was overwritten');
        }
    }
    dockerBinary = await executable(dockerBinary); colimaBinary = await executable(colimaBinary);
    options.checkPath?.(dockerBinary); options.checkPath?.(colimaBinary);
    await configurationDirectory(colimaHome, true, options);
    check(options);
    const env = {...(options.env ?? preparationEnvironment()), DOCKER_CONFIG: config, COLIMA_HOME: colimaHome};
    // Never activate an ambient Docker context; select this named route explicitly afterward.
    await phase(colimaBinary, ['start', '--profile', profile, ...input.reuse ? [] : ['--runtime', 'docker'], '--activate=false'], {...options, env}, 'Start Colima profile ' + profile);
    check(options);
    return route({dockerBinary, dockerConfigDirectory: config, dockerContext: context}, options);
}

export async function interactiveSetup({ask, choose, output, signal, guard, checkPath, execute, onProgress, extraPackages = '', stageOnly = false, initialRuntime = {}, saveRuntime, home = path.join(homedir(), '.gitjig'), platform = process.platform} = {}) {
    let pathRefused = false;
    const safePath = checkPath ? file => { try { checkPath(file); } catch (error) { pathRefused = true; throw error; } } : undefined;
    const options = {signal, guard, checkPath: safePath, execute, onProgress, extraPackages: imagePackages(extraPackages), onOutput: output, env: preparationEnvironment()};
    const confirm = async (question, value) => {
        while (true) {
            const answer = (await ask(question, value)).trim().toLowerCase(); check(options);
            if (['y', 'yes'].includes(answer)) return true;
            if (['n', 'no'].includes(answer)) return false;
            output('Please answer yes or no.\n');
        }
    };
    const select = async (title, labels) => {
        if (choose) { const answer = await choose(title, labels); check(options); if (answer !== undefined && !labels.includes(answer)) throw Error('Unknown preparation recovery action'); return answer ?? labels[0]; }
        while (true) {
            const answer = await ask(title + '\n' + labels.map((label, index) => `${index + 1} ${label}`).join('\n') + '\nChoose', '1');
            check(options);
            if (typeof answer !== 'string') throw Object.assign(Error('Runtime preparation input closed'), {code: 'RUNTIME_PREPARATION_CANCELLED'});
            const index = Number(answer) - 1;
            if (Number.isInteger(index) && index >= 0 && index < labels.length) return labels[index];
            output('Choose one of the numbered actions.\n');
        }
    };
    let reviewedFailure;
    options.retryCommand = async (title, error) => {
        if (pathRefused) throw error;
        output(`${title} stopped: ${error.message}\nPartial package/profile effects may remain; retry repeats only this command.\n`);
        reviewedFailure = error;
        return await select('Preparation command stopped', ['Back to route choices', 'Retry ' + title]) === 'Retry ' + title;
    };
    output('Runtime preparation may download packages/images and create a named VM. Cancelling does not undo those effects. Save remains a separate choice.\n');
    const existingDocker = await findExecutable('docker');
    let forcedChoice;
    let routeDraft = {...initialRuntime}, profileDraft = 'gitjig';
    const editDockerRoute = async draft => {
        const edited = {dockerBinary: await ask('Docker executable', draft.dockerBinary || await findExecutable('docker') || ''), dockerConfigDirectory: await ask('Docker configuration directory', draft.dockerConfigDirectory || path.join(homedir(), '.docker')), dockerContext: await ask('Docker context', draft.dockerContext || 'default')};
        routeDraft = {...edited};
        if (await confirm('Create this Docker configuration directory if absent? y/n', 'y')) edited.dockerConfigDirectory = await configurationDirectory(edited.dockerConfigDirectory, true, options);
        return edited;
    };
    let input;
    while (!input) {
        const choice = forcedChoice ?? await ask('1 Existing Docker backend\n2 Prepare Colima (macOS/Linux)\n3 Cancel\nChoose', existingDocker ? '1' : '2');
        if (choice === '3') return;
        forcedChoice = undefined;
        try {
            if (choice === '2') {
                let dockerBinary = await findExecutable('docker'), colimaBinary = await findExecutable('colima');
                const installPackages = !dockerBinary || !colimaBinary || await confirm('Install/repair Colima, Docker and Buildx with Homebrew? y/n', 'n');
                const brewBinary = installPackages ? await findExecutable('brew') : undefined;
                if (installPackages && !brewBinary) throw Error('Automatic package installation requires Homebrew on macOS/Linux. Existing Docker or Colima installations can also be used; no package installation started.');
                const profile = await ask('Colima profile', profileDraft); profileDraft = profile;
                const reuse = await fs.access(path.join(homedir(), '.colima', profile)).then(() => true, () => false);
                if (reuse && !await confirm('Profile exists. Start/reuse it without changing its settings? y/n', 'n')) return;
                output(`\nPrepare profile ${profile} with Docker configuration ${path.join(homedir(), '.docker')}.\n${installPackages ? 'Homebrew will install colima, docker and docker-buildx; these shared tools remain installed on cancellation/removal.\n' : ''}The selected VM may download files and consume disk space. The ambient Docker context stays unchanged.\n`);
                if (!await confirm('Run Colima preparation now? y/n', 'y')) return;
                input = await prepareColima({dockerBinary, colimaBinary, brewBinary, installPackages, profile, reuse}, {...options, platform});
            } else if (choice === '1') {
                input = await editDockerRoute(routeDraft);
            } else throw Error('Choose 1, 2 or 3');
        } catch (error) {
            if (input) routeDraft = {...input};
            input = undefined;
            if (pathRefused) throw error;
            if (['RUNTIME_PREPARATION_CLEANUP_UNKNOWN', 'RUNTIME_PREPARATION_ROUTE_CHANGED', 'RUNTIME_PREPARATION_CANCELLED'].includes(error.code)) throw error;
            check(options);
            if (error !== reviewedFailure) output(`Runtime route preparation stopped: ${error.message}\n`);
            const action = await select('Choose another runtime preparation route', ['Finish without saving', 'Use existing Docker backend', 'Review Colima settings']);
            if (action === 'Finish without saving') return;
            forcedChoice = action === 'Use existing Docker backend' ? '1' : '2';
        }
    }

    if (options.extraPackages) output(`Extra Debian packages inside the image: ${options.extraPackages}\n`);
    if (!await confirm('Build the installed execution image now? y/n', 'y')) return;
    routeDraft = {...input};
    let runtime, correctRoute = false;
    while (true) {
        try {
            if (correctRoute) {
                input = await editDockerRoute(routeDraft);
                if (!await confirm('Build the installed execution image with this corrected route? y/n', 'y')) return;
                correctRoute = false;
            }
            runtime = await buildImage(input, options); break;
        }
        catch (error) {
            if (pathRefused || ['RUNTIME_PREPARATION_CLEANUP_UNKNOWN', 'RUNTIME_PREPARATION_CANCELLED'].includes(error.code)) throw error;
            check(options);
            if (error.code === 'RUNTIME_PREPARATION_ROUTE_CHANGED') throw error;
            if (correctRoute) input = {...routeDraft};
            output(`Image build stopped: ${error.message}\nCurrent Docker route values are retained; package/VM steps will not repeat.\n`);
            const action = await select('Choose image build recovery', ['Finish without saving', 'Correct Docker route', 'Retry only the image build']);
            if (action === 'Finish without saving') return;
            correctRoute = action === 'Correct Docker route';
        }
    }
    output(`\nPrepared image: ${runtime.image}\nBuild success does not establish backend isolation or project-tool compatibility.\n`);
    if (stageOnly) return runtime;
    if (!await confirm(`Save runtime settings in ${home}? y/n`, 'y')) return runtime;
    check(options);
    if (!saveRuntime) throw Error('No captured startup editor is available; the prepared image was not saved');
    await saveRuntime(runtime);
    output('Runtime saved. Launch gitjig and open /ready to continue.\n');
    return runtime;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.includes('--help')) console.log('Usage: node runtime/setup.mjs [--home ABSOLUTE_PATH]\nInteractive existing-Docker/Colima preparation and execution-image build. Requires Node >=22.19 and an interactive terminal; automatic packages require existing Homebrew.');
    else {
        let terminal, controller, interrupted;
        const abort = new AbortController();
        const stop = () => abort.abort();
        try {
            const {assertCompatibleNode} = await import(new URL('../dist/app/runtime-requirements.js', import.meta.url));
            assertCompatibleNode();
            const args = process.argv.slice(2);
            if (args.length && (args.length !== 2 || args[0] !== '--home' || !path.isAbsolute(args[1]))) throw Error('Use --help or --home ABSOLUTE_PATH');
            if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Runtime preparation requires an interactive terminal; no operation started');
            terminal = createInterface({input: process.stdin, output: process.stdout});
            terminal.on('SIGINT', stop); terminal.on('close', stop); process.on('SIGINT', stop); process.on('SIGTERM', stop); interrupted = true;
            process.stdout.write('Ctrl+C cancels preparation; Ctrl+D closes the installer.\n');
            const {openController} = await import(new URL('../dist/controller/index.js', import.meta.url));
            const {ApplicationStartup} = await import(new URL('../dist/app/startup.js', import.meta.url));
            const home = args[1] ?? process.env.GITJIG_HOME ?? path.join(homedir(), '.gitjig');
            controller = await openController({installationHome: home});
            const edit = await ApplicationStartup.open(controller).prepareRuntimeEdit();
            const guard = () => { abort.signal.throwIfAborted(); edit.assertCurrent(); };
            await interactiveSetup({home, signal: abort.signal, guard, checkPath: edit.checkPath, initialRuntime: edit.runtime ?? {},
                saveRuntime: runtime => edit.save({...edit.runtime, ...runtime}, guard),
                ask: async (question, value) => (await terminal.question(`${question} [${value}]: `, {signal: abort.signal})).trim() || value,
                onProgress: milliseconds => process.stdout.write(`Running · ${(milliseconds / 1000).toFixed(0)}s elapsed\n`),
                output: text => process.stdout.write(text)});
        } catch (error) {
            const unknown = error.code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN';
            console.error(`Runtime preparation stopped: ${unknown ? error.code + ' · ' : ''}${error.message}`);
            process.exitCode = unknown ? 2 : 1;
        }
        finally { terminal?.close(); await controller?.close(); if (interrupted) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); } }
    }
}
