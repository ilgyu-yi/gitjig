#!/usr/bin/env node
// Shared owner-operated preparation. No SDK, agent authority or alternate startup store.
// Exported preparation entries capture scalar selections before callbacks or awaits.
import fs from 'node:fs/promises';
import {constants, realpathSync} from 'node:fs';
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
const validContextName = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/u.test(value);
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

/** Refuse a different interpretation of the two paths the operator reviewed. */
export function assertReviewedDockerRoute(reviewed, dockerBinary, dockerConfigDirectory) {
    let current = false;
    try {
        current = dockerBinary === reviewed.dockerBinary && dockerConfigDirectory === reviewed.dockerConfigDirectory &&
            realpathSync(dockerBinary) === dockerBinary && realpathSync(dockerConfigDirectory) === dockerConfigDirectory;
    } catch { /* A path no longer available cannot match the review. */ }
    if (!current)
        throw Object.assign(Error('Reviewed Docker route changed. Review the executable and configuration directory again.'), {code: 'RUNTIME_PREPARATION_ROUTE_CHANGED'});
}

/** Own/join the local process group; cancellation does not roll back engine/package effects. */
export async function runCommand(file, args, options = {}) {
    if (process.platform === 'win32') throw Error('Runtime preparation requires Unix process-group ownership; use Linux/WSL');
    check(options);
    file = await executable(file); check(options);
    options.checkPath?.(file);
    const began = performance.now();
    options.onOutput?.(`\n> ${path.basename(file)} ${args.join(' ')}\n`);
    check(options);
    if (options.reviewedDockerRoute) {
        assertReviewedDockerRoute(options.reviewedDockerRoute, file, args[0] === '--config' ? args[1] : undefined);
    }
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, {cwd: options.cwd ?? homedir(), env: options.env ?? preparationEnvironment(), detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        let stdout = '', stderr = '', closed = false, failure, failedExit, finished = false, cleanup, grace, poll;
        const gone = () => { if (!child.pid) return true; try { process.kill(-child.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };
        const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure ??= error; } };
        const release = () => { clearTimeout(deadline); clearTimeout(cleanup); clearTimeout(grace); clearInterval(poll); clearInterval(heartbeat); options.signal?.removeEventListener('abort', abort); };
        const finish = () => {
            if (finished || !closed || !gone()) return;
            finished = true; release();
            const durationMs = performance.now() - began;
            try { options.onOutput?.(`\n${failure ? 'Stopped' : 'Finished'} · ${(durationMs / 1000).toFixed(1)}s\n`); } catch (error) { failure ??= error; }
            if (failure) {
                if (failure === failedExit && stderr) failure.message += ' ' + stderr.slice(-1200);
                reject(failure);
            } else resolve({stdout, stderr, durationMs});
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
        const timeout = options.timeoutMs ?? 1800000;
        const deadline = setTimeout(() => stop(Object.assign(Error(`Preparation command exceeded its ${timeout / 1000}-second deadline.`), {code: 'RUNTIME_PREPARATION_TIMEOUT'})), timeout);
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
            if (code !== 0 || signal) {
                failedExit = Object.assign(Error(`Preparation command failed (${signal ?? code}).`), {code: 'RUNTIME_PREPARATION_COMMAND_FAILED'});
                stop(failedExit);
            }
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
    if (!validContextName(input.dockerContext)) throw Error('Choose an explicit Docker context');
    const { assertDockerPreparationRoute } = await import('../dist/execution/docker-environment.js');
    check(options);
    assertDockerPreparationRoute(input.dockerContext);
    return {dockerBinary, dockerConfigDirectory, dockerContext: input.dockerContext};
}

async function dockerPreparationOptions(context, options) {
    const { assertDockerPreparationRoute } = await import('../dist/execution/docker-environment.js');
    return {...options, env: preparationEnvironment(options.env), guard: () => {
        options.guard?.();
        assertDockerPreparationRoute(context);
    }};
}

/** A local form suggestion only; the selected route is still validated at build. */
async function suggestedContext(directory, draft, options) {
    const selected = await configurationDirectory(directory).catch(() => undefined);
    check(options);
    if (!selected) return 'default';
    options.checkPath?.(selected);
    if (validContextName(draft.dockerContext) && draft.dockerConfigDirectory &&
        await fs.realpath(draft.dockerConfigDirectory).catch(() => undefined) === selected) {
        check(options);
        return draft.dockerContext;
    }
    const file = path.join(selected, 'config.json');
    options.checkPath?.(file);
    check(options);
    let hint;
    try {
        const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const info = await handle.stat();
            if (info.isFile() && [0, process.getuid()].includes(info.uid) && !(info.mode & 0o022) && info.size <= 1024 * 1024) {
                const buffer = Buffer.alloc(info.size + 1);
                const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
                if (bytesRead === info.size)
                    hint = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))?.currentContext;
            }
        } finally {
            await handle.close();
        }
    } catch { /* A missing or unreadable preference does not select a route. */ }
    check(options);
    return validContextName(hint) ? hint : 'default';
}
// Public context inspect projection; never stream arbitrary context Metadata or credential data.
export const dockerContextInspectionFormat = '{"Name":{{json .Name}},"Docker":{{json .Endpoints.docker}},"Storage":{{json .Storage}}}';

/** One snapshot owner: complete context-name catalogue or the explicitly selected route. */
export async function routeIdentity(input, options = {}) {
    return (await readRouteIdentity(input, options)).fingerprint;
}

const contextMetadataUnavailable = cause => Object.assign(
    Error('Selected Docker context metadata is unavailable; inspect or correct the explicit context', {cause}),
    {code: 'RUNTIME_ROUTE_METADATA_UNAVAILABLE'},
);

async function readRouteIdentity(input, options, selectedContext) {
    input = {...input};
    check(options);
    const dockerBinary = await executable(input.dockerBinary), dockerConfigDirectory = await configurationDirectory(input.dockerConfigDirectory, false, options);
    check(options); options.checkPath?.(dockerBinary);
    const hash = createHash('sha256'); let entries = 0, bytes = 0;
    const info = async (file, catalogueEntry = false) => {
        check(options);
        if (++entries > 2048) throw Error('Docker route metadata exceeds the preparation bound');
        let value;
        try { value = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
        // Catalogue auxiliaries are not routes. Do not follow or read them.
        if (catalogueEntry && !value.isDirectory()) return value;
        if (value.isSymbolicLink() || ![0, process.getuid()].includes(value.uid) || value.mode & 0o022)
            throw Error('Docker route metadata must be trusted regular files/directories');
        return value;
    };
    const node = (file, value) => {
        // Directory content/mtime/size is not authority for an unrelated child.
        hash.update(JSON.stringify([file, value.dev, value.ino, value.mode, value.uid, ...(value.isFile() ? [value.size, value.mtimeMs] : [])]));
    };
    const chain = async (file, required = false) => {
        if (!printable(file) || !path.isAbsolute(file) || path.resolve(file) !== file)
            throw Error('Selected Docker context storage requires canonical absolute paths');
        const relative = path.relative(dockerConfigDirectory, file);
        if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
            throw Error('Selected Docker context storage must stay inside its Docker configuration');
        options.checkPath?.(file);
        let current = dockerConfigDirectory; const nodes = [];
        for (const part of relative.split(path.sep)) {
            current = path.join(current, part);
            const value = await info(current);
            if (!value) {
                if (required) throw contextMetadataUnavailable();
                for (const [name, parent] of nodes) node(name, parent);
                hash.update(current + ':absent');
                return;
            }
            if (!value.isDirectory()) throw Error('Docker context storage parents must be trusted directories');
            nodes.push([current, value]);
        }
        return nodes;
    };
    const file = async (name, required = false) => {
        const value = await info(name);
        if (!value) { if (required) throw contextMetadataUnavailable(); hash.update(name + ':absent'); return; }
        if (!value.isFile()) throw Error('Docker route metadata requires regular files');
        bytes += value.size;
        if (value.size > 1024 * 1024 || bytes > 8 * 1024 * 1024) throw Error('Docker route metadata exceeds the preparation byte bound');
        const contents = await fs.readFile(name).catch(error => {
            if (required && error.code === 'ENOENT') throw contextMetadataUnavailable(error);
            throw error;
        });
        node(name, value); hash.update(contents); check(options);
    };
    const tree = async (name, value) => {
        if (value.isFile()) return file(name, true);
        if (!value.isDirectory()) throw Error('Docker route metadata requires regular files/directories');
        node(name, value);
        for (const child of (await fs.readdir(name)).sort()) {
            const childPath = path.join(name, child), childInfo = await info(childPath);
            if (!childInfo) throw Error('Selected Docker context metadata changed during observation');
            await tree(childPath, childInfo);
        }
    };
    node(dockerBinary, await fs.stat(dockerBinary)); node(dockerConfigDirectory, await fs.stat(dockerConfigDirectory));
    await file(path.join(dockerConfigDirectory, 'config.json'));
    const metaRoot = path.join(dockerConfigDirectory, 'contexts/meta');
    if (input.dockerContext === undefined) {
        const parents = await chain(metaRoot);
        if (!parents) hash.update(metaRoot + ':absent');
        else {
            for (const [name, value] of parents) node(name, value);
            for (const name of (await fs.readdir(metaRoot)).sort()) {
                const directory = path.join(metaRoot, name), value = await info(directory, true);
                if (!value) throw Error('Docker context catalogue changed during observation');
                if (!value.isDirectory()) continue;
                node(directory, value); await file(path.join(directory, 'meta.json'), true);
            }
        }
        check(options); return { fingerprint: hash.digest('hex') };
    }
    if (!validContextName(input.dockerContext)) throw Error('Choose an explicit Docker context');
    // Local inspect is an admitted metadata read. Selected file/TLS trust gates engine operations below.
    if (input.dockerContext !== 'default') { await chain(metaRoot); await chain(path.join(dockerConfigDirectory, 'contexts/tls')); }
    check(options);
    const observed = selectedContext ?? await inspectSelectedContext(dockerBinary, dockerConfigDirectory, input.dockerContext, options);
    check(options);
    const storage = observed?.Storage;
    if (observed?.Name !== input.dockerContext || !observed.Docker || typeof observed.Docker !== 'object' || Array.isArray(observed.Docker) || !printable(observed.Docker.Host) ||
        observed.Docker.SkipTLSVerify !== undefined && typeof observed.Docker.SkipTLSVerify !== 'boolean' || !storage || typeof storage !== 'object' || Array.isArray(storage) ||
        Object.keys(storage).some(key => !['MetadataPath','TLSPath'].includes(key)))
        throw Error('Selected Docker context metadata does not match the requested context');
    if (storage.MetadataPath === '<IN MEMORY>' && storage.TLSPath === '<IN MEMORY>') {
        if (input.dockerContext !== 'default') throw Error('Unexpected in-memory selected Docker context storage');
    } else {
        const under = (parent, name) => typeof name === 'string' && name.startsWith(parent + path.sep);
        if (!under(metaRoot, storage.MetadataPath) || !under(path.join(dockerConfigDirectory, 'contexts/tls'), storage.TLSPath))
            throw Error('Selected Docker context storage must stay inside its selected configuration namespace');
        const metadata = await chain(storage.MetadataPath, true);
        for (const [name, value] of metadata) node(name, value);
        await file(path.join(storage.MetadataPath, 'meta.json'), true);
        const tls = await chain(storage.TLSPath);
        if (!tls) hash.update(storage.TLSPath + ':absent');
        else {
            for (const [name, value] of tls.slice(0, -1)) node(name, value);
            await tree(storage.TLSPath, tls.at(-1)[1]);
        }
    }
    hash.update(JSON.stringify(observed)); check(options);
    return { fingerprint: hash.digest('hex'), observed };
}

async function inspectSelectedContext(dockerBinary, dockerConfigDirectory, context, options) {
    options.onOutput?.('\nInspecting selected Docker context ' + context + ' · local metadata\n');
    try {
        const args = ['--config', dockerConfigDirectory, 'context', 'inspect', '--format', dockerContextInspectionFormat, context];
        const quiet = { ...options, env: preparationEnvironment(options.env), timeoutMs: 15000, onOutput: undefined };
        const result = await (options.execute ? options.execute(dockerBinary, args, quiet) : runCommand(dockerBinary, args, quiet));
        if (typeof result?.stdout !== 'string' || Buffer.byteLength(result.stdout) > 65536) throw Error('Unsupported Docker context observation');
        return JSON.parse(result.stdout);
    } catch (error) {
        if (['RUNTIME_PREPARATION_CLEANUP_UNKNOWN', 'RUNTIME_DISCOVERY_CLEANUP_UNKNOWN', 'RUNTIME_PREPARATION_CANCELLED'].includes(error?.code) ||
            options.signal?.aborted && error === options.signal.reason) throw error;
        // A later cancellation cannot replace a failed native observation that already settled.
        if (!options.signal?.aborted) check(options);
        throw contextMetadataUnavailable(error);
    }
}

export function imagePackages(value = '') {
    if (typeof value !== 'string' || value.length > 2048) throw Error('Enter at most 32 Debian package names');
    const names = value.trim() ? value.trim().split(/\s+/u) : [];
    if (names.length > 32 || names.some(name => !/^[a-z0-9][a-z0-9+.-]{0,99}$/u.test(name))) throw Error('Use literal Debian package names separated by spaces, for example python3 build-essential; shell commands and options are not accepted');
    return [...new Set(names)].join(' ');
}

async function capturePreparationRoute(captured, options, changed) {
    const before = await readRouteIdentity(captured, options);
    return {
        assertSameRoute: () => assertRouteMatches(captured, before, changed, options),
        assertLocalRoute: localRouteCheck(captured, before, changed),
    };
}

async function assertRouteMatches(captured, before, changed, options, observed) {
    let current;
    try {
        current = await readRouteIdentity(captured, options, observed);
    } catch (error) {
        if (error?.code !== 'RUNTIME_ROUTE_METADATA_UNAVAILABLE') throw error;
        throw Object.assign(Error('Docker context could no longer be verified. Review the Docker route again.', {cause: error}), {code: 'RUNTIME_PREPARATION_ROUTE_CHANGED'});
    }
    if (current.fingerprint !== before.fingerprint)
        throw Object.assign(Error(changed), {code: 'RUNTIME_PREPARATION_ROUTE_CHANGED'});
    check(options);
}

// Only the observed context and local file guards outlive the explicit check.
function localRouteCheck(captured, before, changed) {
    return async ({guard, checkPath}) => {
        if (!before.observed) throw Error('Checked Docker route observation unavailable');
        const { assertDockerPreparationRoute } = await import('../dist/execution/docker-environment.js');
        const localGuard = () => {
            guard();
            assertDockerPreparationRoute(captured.dockerContext);
        };
        return assertRouteMatches(captured, before, changed, { guard: localGuard, checkPath }, before.observed);
    };
}

const dockerCommandUnavailable = error => ['RUNTIME_PREPARATION_COMMAND_FAILED', 'RUNTIME_PREPARATION_TIMEOUT'].includes(error?.code);

async function observeDockerServer(captured, args, options, assertSameRoute) {
    const execute = options.execute ?? runCommand;
    let failure;
    try {
        const result = await execute(captured.dockerBinary, [...args, 'version', '--format', '{{json .Server.Version}}'], {...options, timeoutMs: 15000});
        check(options);
        const version = JSON.parse(result.stdout.trim());
        if (printable(version) && version.trim()) return version;
    } catch (error) {
        if (!dockerCommandUnavailable(error) && !(error instanceof SyntaxError)) throw error;
        failure = error;
    }
    await assertSameRoute();
    const reason = !failure || failure instanceof SyntaxError ? 'Selected engine did not report a version' : failure.message;
    throw Object.assign(Error(reason, {cause: failure}), {code: 'RUNTIME_DOCKER_SERVER_UNAVAILABLE'});
}

export async function buildImage(input, options = {}) {
    input = {...input};
    const packages = imagePackages(options.extraPackages);
    const reviewed = options.reviewedDockerRoute;
    check(options);
    if (reviewed)
        assertReviewedDockerRoute(reviewed, input.dockerBinary, input.dockerConfigDirectory);
    const captured = await route(input, options);
    const execution = await dockerPreparationOptions(captured.dockerContext, reviewed ? {...options,
        guard: () => {
            options.guard?.();
            assertReviewedDockerRoute(reviewed, captured.dockerBinary, captured.dockerConfigDirectory);
        },
    } : options);
    check(execution);
    const { assertSameRoute } = await capturePreparationRoute(captured, execution, 'Docker route changed during preparation; image is not staged');
    const args = ['--config', captured.dockerConfigDirectory, '--context', captured.dockerContext];
    await observeDockerServer(captured, args, execution, assertSameRoute);
    const root = path.join(await fs.realpath(options.temporaryRoot ?? '/tmp'), 'gitjig-image-' + randomUUID());
    options.checkPath?.(root); check(execution);
    await fs.mkdir(root, {mode: 0o700});
    try {
        options.checkPath?.(root); check(execution);
        const context = path.join(root, 'context'), idFile = path.join(root, 'image-id');
        await fs.mkdir(context);
        for (const name of recipeNames) {
            const source = path.join(options.recipe ?? recipeDirectory, name), info = await fs.lstat(source);
            if (!info.isFile()) throw Error('Installed recipe requires regular assets');
            await fs.copyFile(source, path.join(context, name), constants.COPYFILE_EXCL);
        }
        await assertSameRoute();
        await (options.execute ?? runCommand)(captured.dockerBinary, [...args, 'build', ...packages ? ['--build-arg', 'GITJIG_EXTRA_PACKAGES=' + packages] : [], '--file', path.join(context, 'Dockerfile'), '--iidfile', idFile, context], execution);
        await assertSameRoute();
        const info = await fs.lstat(idFile);
        if (!info.isFile() || info.size > 256) throw Error('Build did not produce a fresh regular image-ID file');
        const image = (await fs.readFile(idFile, 'utf8')).trim();
        if (!/^sha256:[a-f0-9]{64}$/u.test(image)) throw Error('Build did not return an immutable image ID');
        check(execution); return {...captured, image};
    } finally { await fs.rm(root, {recursive: true, force: true}); }
}

export function runtimeCheckImage(image) {
    if (typeof image !== 'string' || !/^(?:sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/u.test(image))
        throw Error('Select an immutable image ID or digest before checking runtime');
    return image;
}

/** Explicit engine/image metadata check only: no container, project code or model. */
export async function checkRuntime(input, options = {}) {
    input = {...input};
    const execution = await dockerPreparationOptions(input.dockerContext, options);
    check(execution);
    const image = runtimeCheckImage(input.image);
    const captured = await route(input, execution);
    const { assertSameRoute, assertLocalRoute } = await capturePreparationRoute(captured, execution, 'Docker route changed since runtime check');
    const args = ['--config', captured.dockerConfigDirectory, '--context', captured.dockerContext];
    const execute = options.execute ?? runCommand;
    const engineVersion = await observeDockerServer(captured, args, execution, assertSameRoute);
    await assertSameRoute();
    let inspected, failure;
    try {
        inspected = await execute(captured.dockerBinary, [...args, 'image', 'inspect', '--format', '{{json .Id}}', image], {...execution, timeoutMs: 15000});
    } catch (error) {
        if (!dockerCommandUnavailable(error)) throw error;
        failure = error;
    }
    await assertSameRoute();
    let id;
    if (inspected) {
        try { id = JSON.parse(inspected.stdout.trim()); }
        catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            failure = error;
        }
    }
    if (typeof id !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(id) || image.startsWith('sha256:') && id !== image) {
        const reason = dockerCommandUnavailable(failure) ? failure.message : 'Image inspection did not verify the selected immutable identity';
        throw Object.assign(Error(reason, {cause: failure}), {code: 'RUNTIME_DOCKER_IMAGE_UNAVAILABLE'});
    }
    options.onOutput?.(`Engine ${engineVersion} · image ${id} found. This checks connection and image presence only; isolation, shared paths and project tools are not verified.\n`);
    check(execution);
    options.onCheckedRoute?.(assertLocalRoute);
    return {...captured, image};
}

export async function prepareColima(input, options = {}) {
    input = {...input};
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
    const observedProfile = async allowExisting => {
        const stat = file => fs.lstat(file).catch(error => {
            if (error.code !== 'ENOENT') throw error;
        });
        const directory = await stat(profilePath);
        if (!directory) return null;
        if (!allowExisting) throw Error('This Colima profile already exists. Explicitly reuse it or choose a new name; it was not changed.');
        const file = await stat(path.join(profilePath, 'colima.yaml'));
        if (!directory.isDirectory() || !file?.isFile() || file.size === 0 ||
            [directory, file].some(info => ![0, process.getuid()].includes(info.uid) || info.mode & 0o022))
            throw Error('The selected Colima profile has no trusted saved configuration. Inspect it in Colima or choose another profile.');
        return JSON.stringify([directory.dev, directory.ino, file.dev, file.ino, file.mode, file.uid, file.size, file.mtimeMs, file.ctimeMs]);
    };
    const selectedProfile = await observedProfile(input.reuse === true);
    if (input.reuse && selectedProfile === null) throw Error('The selected Colima profile is no longer present. Review profile settings again.');
    const startAttempt = selected => ({
        args: ['start', '--profile', profile, ...selected === null ? ['--runtime', 'docker'] : ['--save-config=false'], '--activate=false'],
        profile: selected,
    });
    const phase = async (file, settings, attempt) => {
        const resolved = await executable(file);
        const identity = async () => { const s = await fs.stat(resolved); return JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.mode, s.uid]); };
        const before = await identity();
        const startsProfile = Object.hasOwn(attempt, 'profile');
        while (true) {
            check(options);
            if (await executable(file) !== resolved || await identity() !== before) throw Error('Preparation executable changed; review prerequisites again');
            await validateColimaPaths();
            await configurationDirectory(config, false, options);
            if (startsProfile && await observedProfile(attempt.profile !== null) !== attempt.profile)
                throw Error('The selected Colima profile changed. Review profile settings again.');
            check(options);
            try { return await (options.execute ?? runCommand)(resolved, attempt.args, settings); }
            catch (error) {
                if (['RUNTIME_PREPARATION_CLEANUP_UNKNOWN', 'RUNTIME_PREPARATION_ROUTE_CHANGED', 'RUNTIME_PREPARATION_CANCELLED'].includes(error.code)) throw error;
                check(options);
                if (error.code !== 'RUNTIME_PREPARATION_COMMAND_FAILED' || !options.retryCommand) throw error;
                let retry = attempt;
                if (startsProfile) {
                    await validateColimaPaths();
                    const selected = await observedProfile(true).catch(profileError => {
                        throw Error(`${error.message}\n${profileError.message}`, {cause: error});
                    });
                    if (attempt.profile !== null && selected !== attempt.profile)
                        throw Error('The selected Colima profile changed. Review profile settings again.', {cause: error});
                    retry = startAttempt(selected);
                }
                check(options);
                const failedPhase = startsProfile ? { kind: 'colima', profile, reuse: retry.profile !== null } : { kind: 'packages' };
                if (!await options.retryCommand(failedPhase, error)) throw error;
                attempt = retry;
            }
        }
    };
    let dockerBinary = input.dockerBinary, colimaBinary = input.colimaBinary;
    const config = await configurationDirectory(input.dockerConfigDirectory ?? path.join(ownerHome, '.docker'), true, options);
    if (input.installPackages) {
        const brew = await executable(input.brewBinary);
        options.checkPath?.(brew);
        await phase(brew, {...options, env: {...options.env ?? preparationEnvironment(), NONINTERACTIVE: '1', HOMEBREW_NO_AUTO_UPDATE: '1'}}, {
            args: ['install', 'colima', 'docker', 'docker-buildx'],
        }); check(options);
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
    await phase(colimaBinary, {...options, env}, startAttempt(selectedProfile));
    check(options);
    return route({dockerBinary, dockerConfigDirectory: config, dockerContext: context}, options);
}

export async function interactiveSetup({ask, choose, output, signal, guard, checkPath, execute, onProgress, extraPackages = '', stageOnly = false, initialRuntime = {}, saveRuntime, ownerHome = homedir(), env = process.env, home = path.join(ownerHome, '.gitjig'), platform = process.platform, locale = 'en'} = {}) {
    initialRuntime = {...initialRuntime};
    const { uiText } = await import('../dist/ui/i18n.js');
    const t = (id, values) => uiText(locale, 'runtime.install.' + id, ...(values ? [values] : []));
    let pathRefused = false;
    const safePath = checkPath ? file => { try { checkPath(file); } catch (error) { pathRefused = true; throw error; } } : undefined;
    const options = {signal, guard, checkPath: safePath, execute, onProgress, extraPackages: imagePackages(extraPackages), onOutput: output, ownerHome, cwd: ownerHome, env: {...preparationEnvironment(env), HOME: ownerHome}};
    check(options);
    const confirm = async (question, value) => {
        while (true) {
            const response = await ask(question, value); check(options);
            if (response === undefined) return false;
            const answer = response.trim().toLowerCase();
            if (['y', 'yes'].includes(answer) || locale === 'ko' && ['예', '네'].includes(answer)) return true;
            if (['n', 'no'].includes(answer) || locale === 'ko' && ['아니오', '아니요'].includes(answer)) return false;
            output(t('confirmAnswer') + '\n');
        }
    };
    const select = async (title, choices) => {
        const items = choices.map(({ id, label }) => ({ value: id, label: label ?? t(id) }));
        if (choose) {
            const answer = await choose(title, items); check(options);
            if (answer !== undefined && !items.some(item => item.value === answer)) throw Error(t('invalidAction'));
            return answer;
        }
        while (true) {
            const answer = await ask(title + '\n' + items.map(({ label }, index) => `${index + 1} ${label}`).join('\n') + '\n' + t('choose'), '1');
            check(options);
            if (typeof answer !== 'string') throw Object.assign(Error(t('inputClosed')), {code: 'RUNTIME_PREPARATION_CANCELLED'});
            const index = Number(answer) - 1;
            if (Number.isInteger(index) && index >= 0 && index < items.length) return items[index].value;
            output(t('chooseNumber') + '\n');
        }
    };
    let reviewedFailure;
    options.retryCommand = async (phase, error) => {
        if (pathRefused) throw error;
        const title = phase.kind === 'colima' ? t('startPhase', { profile: phase.profile }) : t('packagePhase');
        const retry = phase.reuse ? t('retryExisting', { profile: phase.profile }) : t('retryPhase', { phase: title });
        output(t('phaseStopped', { phase: title, reason: error.message }) + '\n' + t(phase.reuse ? 'keepProfile' : 'partialPhase') + '\n');
        const action = await select(t('phaseRecovery'), [{ id: 'backRoutes' }, { id: 'retry', label: retry }]);
        reviewedFailure = { error, dismissed: action === undefined };
        return action === 'retry';
    };
    output(t('intro') + '\n');
    const existingDocker = await findExecutable('docker', options.env.PATH ?? '');
    let forcedChoice;
    let routeDraft = {...initialRuntime}, profileDraft = 'gitjig';
    const editDockerRoute = async draft => {
        const dockerBinary = await ask(t('executable'), draft.dockerBinary || await findExecutable('docker', options.env.PATH ?? '') || '');
        const dockerConfigDirectory = await ask(t('configDirectory'), draft.dockerConfigDirectory || path.join(ownerHome, '.docker'));
        const dockerContext = await ask(t('context'), await suggestedContext(dockerConfigDirectory, draft, options));
        const edited = {dockerBinary, dockerConfigDirectory, dockerContext};
        routeDraft = {...edited};
        if (await confirm(t('createConfig'), 'y')) edited.dockerConfigDirectory = await configurationDirectory(edited.dockerConfigDirectory, true, options);
        return edited;
    };
    const display = value => printable(value) ? JSON.stringify(value) : t('invalidValue');
    const showBuildRoute = ({dockerBinary, dockerConfigDirectory, dockerContext}) =>
        output(t('route', { context: display(dockerContext), config: display(dockerConfigDirectory), binary: display(dockerBinary) }) + '\n');
    let input;
    while (!input) {
        const choice = forcedChoice ?? await ask(t('chooseRoute'), existingDocker ? '1' : '2');
        if (choice === '3') return;
        forcedChoice = undefined;
        try {
            if (choice === '2') {
                let dockerBinary = await findExecutable('docker', options.env.PATH ?? ''), colimaBinary = await findExecutable('colima', options.env.PATH ?? '');
                const installPackages = !dockerBinary || !colimaBinary || await confirm(t('installPackages'), 'n');
                const brewBinary = installPackages ? await findExecutable('brew', options.env.PATH ?? '') : undefined;
                if (installPackages && !brewBinary) throw Error(t('homebrewMissing'));
                const profile = await ask(t('colimaProfile'), profileDraft); profileDraft = profile;
                const reuse = await fs.access(path.join(ownerHome, '.colima', profile)).then(() => true, () => false);
                if (reuse && !await confirm(t('reuseProfile'), 'n')) return;
                output('\n' + t('reviewProfile', { profile: display(profile), config: display(path.join(ownerHome, '.docker')) }) + '\n');
                if (installPackages) output(t('packageEffects') + '\n');
                output(t('profileEffects') + '\n');
                if (!await confirm(t('prepareColima'), 'y')) return;
                input = await prepareColima({dockerBinary, colimaBinary, brewBinary, installPackages, profile, reuse}, {...options, platform});
            } else if (choice === '1') {
                input = await editDockerRoute(routeDraft);
            } else throw Error(t('chooseOne'));
        } catch (error) {
            if (input) routeDraft = {...input};
            input = undefined;
            if (pathRefused) throw error;
            if (['RUNTIME_PREPARATION_CLEANUP_UNKNOWN', 'RUNTIME_PREPARATION_ROUTE_CHANGED', 'RUNTIME_PREPARATION_CANCELLED'].includes(error.code)) throw error;
            check(options);
            if (error === reviewedFailure?.error) {
                if (reviewedFailure.dismissed) return;
            } else {
                output(t('routeStopped', { reason: error.message }) + '\n');
            }
            const action = await select(t('routeRecovery'), [{ id: 'finish' }, { id: 'useDocker' }, { id: 'reviewColima' }]);
            if (!action || action === 'finish') return;
            forcedChoice = action === 'useDocker' ? '1' : '2';
        }
    }

    if (options.extraPackages) output(t('packages', { packages: options.extraPackages }) + '\n');
    routeDraft = {...input};
    let runtime, reviewedRoute, correctRoute = false;
    while (true) {
        try {
            if (!reviewedRoute) {
                if (correctRoute)
                    input = await editDockerRoute(routeDraft);
                const candidate = await route(input, options);
                showBuildRoute(candidate);
                output(t('buildConnectionScope') + '\n');
                if (!await confirm(t(correctRoute ? 'buildCorrected' : 'build'), 'n')) return;
                reviewedRoute = candidate;
                routeDraft = {...candidate};
            }
            runtime = await buildImage(reviewedRoute, { ...options, reviewedDockerRoute: reviewedRoute }); break;
        }
        catch (error) {
            if (pathRefused || ['RUNTIME_PREPARATION_CLEANUP_UNKNOWN', 'RUNTIME_PREPARATION_CANCELLED'].includes(error.code)) throw error;
            check(options);
            if (error.code === 'RUNTIME_PREPARATION_ROUTE_CHANGED') throw error;
            showBuildRoute(reviewedRoute ?? routeDraft);
            const contextUnavailable = error.code === 'RUNTIME_ROUTE_METADATA_UNAVAILABLE';
            const serverUnavailable = error.code === 'RUNTIME_DOCKER_SERVER_UNAVAILABLE';
            if (contextUnavailable) output(t('buildContextStopped') + '\n' + t('contextRecovery') + '\n');
            else output(t(serverUnavailable ? 'buildConnectionStopped' : reviewedRoute ? 'buildStopped' : 'buildPreflightStopped', { reason: error.message }) + '\n');
            if (serverUnavailable) output(t('buildConnectionRecovery') + '\n');
            const retry = { id: 'retryBuild', label: t('retryBuildConnection') };
            const action = await select(t('buildRecovery'), [{ id: 'finish' }, { id: 'correctRoute' }, ...reviewedRoute && !contextUnavailable ? [retry] : []]);
            if (!action || action === 'finish') return;
            if (action === 'correctRoute') {
                reviewedRoute = undefined;
                correctRoute = true;
            }
        }
    }
    output('\n' + t('prepared', { image: runtime.image }) + '\n');
    if (stageOnly) return runtime;
    if (!await confirm(t('save', { home: display(home) }), 'y')) return runtime;
    check(options);
    if (!saveRuntime) throw Error(t('saveUnavailable'));
    await saveRuntime(runtime);
    output(t('saved') + '\n');
    return runtime;
}

const entryFile = process.argv[1];
const helperFile = fileURLToPath(import.meta.url);
// Node can keep the invocation symlink in argv while loading the actual module.
if (entryFile && (path.resolve(entryFile) === helperFile || await fs.realpath(entryFile).catch(() => undefined) === helperFile)) {
    if (process.argv.includes('--help')) console.log('Usage: node runtime/setup.mjs [--home ABSOLUTE_PATH]\nInteractive existing-Docker/Colima preparation and execution-image build. Requires Node >=22.19 and an interactive terminal; automatic packages require existing Homebrew.');
    else {
        let terminal, controller, interrupted, standaloneText;
        const abort = new AbortController();
        const stop = () => abort.abort();
        try {
            const {assertCompatibleNode} = await import(new URL('../dist/app/runtime-requirements.js', import.meta.url));
            assertCompatibleNode();
            const args = process.argv.slice(2);
            if (args.length && (args.length !== 2 || args[0] !== '--home' || !path.isAbsolute(args[1]))) throw Error('Use --help or --home ABSOLUTE_PATH');
            if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Runtime preparation requires an interactive terminal; no operation started');
            const { hostUiLanguage, resolveUiLanguage, translator } = await import('../dist/ui/i18n.js');
            const { locale } = resolveUiLanguage(null, hostUiLanguage());
            standaloneText = translator(locale);
            terminal = createInterface({input: process.stdin, output: process.stdout});
            terminal.on('SIGINT', stop); terminal.on('close', stop); process.on('SIGINT', stop); process.on('SIGTERM', stop); interrupted = true;
            process.stdout.write(standaloneText('runtime.install.standaloneControls') + '\n');
            const {openController} = await import(new URL('../dist/controller/index.js', import.meta.url));
            const {ApplicationStartup} = await import(new URL('../dist/app/startup.js', import.meta.url));
            const home = args[1] ?? process.env.GITJIG_HOME ?? path.join(homedir(), '.gitjig');
            controller = await openController({installationHome: home});
            const edit = await ApplicationStartup.open(controller).prepareRuntimeEdit();
            const guard = () => { abort.signal.throwIfAborted(); edit.assertCurrent(); };
            await interactiveSetup({home, locale, signal: abort.signal, guard, checkPath: edit.checkPath, initialRuntime: edit.runtime ?? {},
                saveRuntime: runtime => edit.save({...edit.runtime, ...runtime}, guard),
                ask: async (question, value) => (await terminal.question(`${question} [${value}]: `, {signal: abort.signal})).trim() || value,
                onProgress: milliseconds => process.stdout.write(`Running · ${(milliseconds / 1000).toFixed(0)}s elapsed\n`),
                output: text => process.stdout.write(text)});
        } catch (error) {
            const unknown = error.code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN';
            const reason = unknown ? error.code + ' · ' + error.message : error.message;
            console.error(standaloneText?.('runtime.install.standaloneStopped', { reason }) ?? 'Runtime preparation stopped: ' + reason);
            process.exitCode = unknown ? 2 : 1;
        }
        finally { terminal?.close(); await controller?.close(); if (interrupted) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); } }
    }
}
