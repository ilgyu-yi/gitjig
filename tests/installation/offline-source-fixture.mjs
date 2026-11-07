import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const checkout = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
export const digest = data => createHash('sha256').update(data).digest('hex');
const absent = pid => { try { process.kill(-pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
export async function inventory(root) {
    const rows = [];
    async function visit(relative) {
        const file = path.join(root, relative), stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) rows.push({path: relative, kind: 'link', mode: stat.mode, target: await fs.readlink(file)});
        else if (stat.isDirectory()) { rows.push({path: relative, kind: 'directory', mode: stat.mode}); for (const name of (await fs.readdir(file)).sort()) await visit(path.join(relative, name)); }
        else { assert.ok(stat.isFile()); rows.push({path: relative, kind: 'file', mode: stat.mode, sha256: digest(await fs.readFile(file))}); }
    }
    await visit(''); return rows;
}

/** Owned fixture processes share the test's aggregate admission/cancellation boundary. */
export function installationProcessRunner({root, env, invocations = [], groups = new Set(), signal, cwd = root}) {
    return async (binary, args, label, {environment = env, timeout = 10000, expected = 0, workdir = cwd} = {}) => {
        signal?.throwIfAborted();
        const child = spawn(binary, args, {cwd: workdir, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        if (child.pid) groups.add(child.pid);
        let out = '', err = '', bytes = 0, expired = false, overflow = false, aborted = false;
        const interrupt = () => { if (child.pid) try { process.kill(-child.pid, 'SIGINT'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
        const collect = (chunk, stderr) => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { overflow = true; interrupt(); } else if (stderr) err += chunk; else out += chunk; };
        child.stdout.on('data', chunk => collect(chunk, false)); child.stderr.on('data', chunk => collect(chunk, true));
        // Observe immediately, including spawn errors and children that exit before
        // the asynchronous early-PID receipt has reached disk.
        const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal})); });
        void completed.catch(() => {});
        const onAbort = () => { aborted = true; interrupt(); };
        signal?.addEventListener('abort', onAbort, {once: true});
        if (signal?.aborted) onAbort();
        const timer = setTimeout(() => { expired = true; interrupt(); }, timeout);
        let result;
        try {
            await fs.writeFile(path.join(root, label + '.started.json'), JSON.stringify({pid: child.pid, binary, args, timeout}), {mode: 0o600});
            result = await completed;
        }
        catch (error) { interrupt(); await completed.catch(() => {}); throw error; }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
        const receipt = {label, pid: child.pid, ...result, expired, overflow, aborted, out, err}; invocations.push(receipt);
        await fs.writeFile(path.join(root, label + '.result.json'), JSON.stringify(receipt, null, 2), {mode: 0o600});
        assert.ok(absent(child.pid), label + ' original process group not joined'); groups.delete(child.pid);
        assert.equal(aborted, false, label + ' aggregate cancellation');
        assert.equal(expired, false, label + ' deadline'); assert.equal(overflow, false, label + ' output limit');
        assert.equal(result.signal, null, label + ' ' + err); assert.equal(result.code, expected, label + ' ' + err + out);
        return out;
    };
}

/** Public source installation mechanics only; no application standing or actions. */
export async function offlineSourceInstallation(t, label = 'status', {beforeCleanup} = {}) {
    if (beforeCleanup !== undefined && typeof beforeCleanup !== 'function') throw Error('Fixture cleanup must be a function');
    assert.match(label, /^[a-z-]+$/u);
    assert.ok(process.env.npm_config_cache, 'Explicit prepared offline npm_config_cache required; no personal-cache fallback');
    const cache = await fs.realpath(process.env.npm_config_cache);
    const parent = await fs.realpath(process.env.GITJIG_INSTALLATION_FIXTURE_ROOT ?? os.tmpdir());
    assert.ok(parent !== checkout && !parent.startsWith(checkout + path.sep), 'Installation fixture parent must be outside checkout ancestry');
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'gitjig-installed-' + label + '-'))); await fs.chmod(root, 0o700);
    assert.ok(!root.startsWith(checkout + path.sep), 'Installed world must be outside checkout ancestry');
    const source = path.join(root, 'source snapshot'), prefix = path.join(root, 'prefix with spaces'), user = path.join(root, 'user'), cwd = path.join(root, 'outside checkout'), home = path.join(root, 'application');
    for (const dir of [source, user, cwd]) await fs.mkdir(dir, {mode: 0o700});
    const npmrc = path.join(root, 'empty-npmrc'), globalNpmrc = path.join(root, 'empty-global-npmrc');
    await fs.writeFile(npmrc, '', {mode: 0o600}); await fs.writeFile(globalNpmrc, '', {mode: 0o600});
    const env = {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: user, USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture',
        LANG: 'C.UTF-8', TERM: 'xterm-256color', SHELL: '/bin/sh', TMPDIR: root, GITJIG_HOME: home, NODE_OPTIONS: '', NODE_PATH: ''};
    const invocations = [], groups = new Set(); let passed = false;
    t.after(async () => {
        // Join caller-owned tails and retain completion evidence before deletion.
        await beforeCleanup?.();
        const live = [...groups].filter(pid => !absent(pid));
        if (live.length) t.diagnostic('Unsettled original process groups retained without forced cleanup: ' + live.join(','));
        if (passed && !live.length && process.env.GITJIG_RETAIN_INSTALLATION_FIXTURE !== '1') await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained installed fixture: ' + root);
    });
    const run = installationProcessRunner({root, env, invocations, groups, signal: t.signal, cwd});
    // The installer builds only this exact private source snapshot, never checkout dist/node_modules.
    const pkg = JSON.parse(await fs.readFile(path.join(checkout, 'package.json'), 'utf8'));
    const names = [...new Set(['src', 'qualification', 'tools/build.mjs', 'tsconfig.json', 'tsconfig.qualification.json', 'package.json', 'package-lock.json', 'install.mjs', 'install.sh', 'vendor', ...pkg.files.filter(file => file !== 'dist/').map(file => file.replace(/\/$/u, ''))])];
    const inputs = [];
    for (const name of names) {
        const before = await inventory(path.join(checkout, name));
        await fs.mkdir(path.dirname(path.join(source, name)), {recursive: true});
        await fs.cp(path.join(checkout, name), path.join(source, name), {recursive: true, force: false, errorOnExist: true});
        assert.deepEqual(await inventory(path.join(source, name)), before, name + ' private snapshot');
        assert.deepEqual(await inventory(path.join(checkout, name)), before, name + ' changed during snapshot'); inputs.push({name, entries: before});
    }
    const assertCurrent = async () => { for (const input of inputs) assert.deepEqual(await inventory(path.join(checkout, input.name)), input.entries, 'Current source drift: ' + input.name); };
    await fs.writeFile(path.join(root, 'source-inputs.json'), JSON.stringify(inputs), {mode: 0o600});
    await run(process.execPath, [path.join(source, 'install.mjs'), '--prefix', prefix], 'install', {timeout: 150000,
        environment: {...env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, npm_config_cache: cache, npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_userconfig: npmrc, npm_config_globalconfig: globalNpmrc, npm_config_logs_dir: path.join(root, 'npm-logs')}});
    const command = path.join(prefix, 'bin/gitjig'), actualEntry = await fs.realpath(command);
    const payload = path.resolve(path.dirname(actualEntry), '../..');
    assert.equal(actualEntry, path.join(payload, 'dist/cli/entry.js'));
    assert.ok(payload.startsWith(path.join(prefix, 'lib/gitjig-versions') + path.sep));
    assert.ok((await fs.realpath(command)).startsWith(payload + path.sep)); await assert.rejects(fs.access(home), {code: 'ENOENT'});
    for (const name of ['src', 'tests', 'qualification', '.qualification', 'development', '.git', 'AGENTS.md', 'CONTRIBUTING.md', 'node_modules/typescript']) await assert.rejects(fs.access(path.join(payload, name)), {code: 'ENOENT'});
    // npm makes declared bin entries executable; all emitted bytes and other modes stay exact.
    const declaredBins = new Set(Object.values(pkg.bin).map(file => file.replace(/^dist\//u, '')));
    const emitted = (await inventory(path.join(source, 'dist'))).map(entry => declaredBins.has(entry.path) ? {...entry, mode: entry.mode | 0o111} : entry);
    assert.deepEqual(await inventory(path.join(payload, 'dist')), emitted);
    for (const name of pkg.files.filter(name => name !== 'dist/')) assert.deepEqual(await inventory(path.join(payload, name)), await inventory(path.join(source, name)), name + ' installed current assets');
    const payloadBefore = await inventory(payload);
    await fs.writeFile(path.join(root,'payload-before.json'),JSON.stringify(payloadBefore),{mode:0o600});
    return {root,source,prefix,user,cwd,home,env,run,pkg,inputs,assertCurrent,command,payload,payloadBefore,cache,invocations,groups,pass:()=>{passed=true;}};
}
