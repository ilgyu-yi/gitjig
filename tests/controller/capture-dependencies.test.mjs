import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { capture, validateManifest } from '../../dist/controller/capture.js';
import { freeze, materialize, delta, effective, hash } from '../../dist/controller/change-files.js';
const execute = promisify(execFile);

async function createDependencyFixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-dependency-capture-')));
    const source = path.join(root, 'source');
    await fs.mkdir(path.join(source, 'node_modules/.bin'), { recursive: true });
    await fs.mkdir(path.join(source, 'node_modules/pkg'));
    await fs.writeFile(path.join(source, 'node_modules/pkg/value.mjs'), "export default 'original relative import';\n");
    await fs.writeFile(path.join(source, 'node_modules/pkg/cli.mjs'), "import value from './value.mjs'; console.log(value);\n", { mode: 0o755 });
    await fs.symlink('../pkg/cli.mjs', path.join(source, 'node_modules/.bin/tool'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const take = async (name) => {
        const target = path.join(root, name);
        await fs.mkdir(target);
        return { target, manifest: validateManifest(await capture(source, target, {}).result) };
    };
    return { root, source, take };
}

test('dependency executables retain symlink semantics, full bytes, stable materialization and original manifest compatibility', async (t) => {
    const f = await createDependencyFixture(t);
    const { target, manifest } = await f.take('first');
    assert.equal(await fs.readlink(path.join(target, 'node_modules/.bin/tool')), '../pkg/cli.mjs');
    assert.equal((await execute(process.execPath, [path.join(target, 'node_modules/.bin/tool')])).stdout, 'original relative import\n');
    assert.equal(manifest.entries, manifest.files.length + manifest.directories.length + 1);
    assert.equal(manifest.bytes, manifest.files.reduce((total, file) => total + file.size, 0) + Buffer.byteLength('../pkg/cli.mjs'));
    assert.ok(manifest.files.some(file => file.path === 'node_modules/pkg/value.mjs'));
    const copy = await freeze(target, path.join(f.root, 'frozen'), {});
    assert.equal(hash(effective(copy.manifest)), hash(effective(manifest)));
    await materialize(target, path.join(f.root, 'materialized'), {}, copy.digest);
    await fs.unlink(path.join(f.source, 'node_modules/.bin/tool'));
    const legacy = await f.take('legacy');
    assert.equal(legacy.manifest.dependencyLinks, undefined);
    assert.equal(validateManifest(legacy.manifest), legacy.manifest);
});

test('dependency link targets, additions/removals and ignored dependency bytes change capture and effective identity', async (t) => {
    const f = await createDependencyFixture(t);
    const a = await f.take('a');
    await fs.writeFile(path.join(f.source, 'node_modules/pkg/other.mjs'), "console.log('other');\n");
    const b = await f.take('b');
    await fs.unlink(path.join(f.source, 'node_modules/.bin/tool'));
    await fs.symlink('../pkg/other.mjs', path.join(f.source, 'node_modules/.bin/tool'));
    const c = await f.take('c');
    assert.notEqual(b.manifest.digest, c.manifest.digest);
    assert.notEqual(hash(effective(b.manifest)), hash(effective(c.manifest)));
    assert.deepEqual(delta(b.manifest, c.manifest).dependencyLinks, [{ path: 'node_modules/.bin/tool', before: '../pkg/cli.mjs', after: '../pkg/other.mjs' }]);
    await fs.writeFile(path.join(f.source, 'node_modules/pkg/value.mjs'), 'changed ignored dependency');
    const d = await f.take('d');
    assert.notEqual(c.manifest.digest, d.manifest.digest);
    assert.notEqual(hash(effective(c.manifest)), hash(effective(d.manifest)));
    assert.notEqual(a.manifest.digest, b.manifest.digest);
});

test('internal dependency directory aliases and file-link chains preserve their target graph', async (t) => {
    const f = await createDependencyFixture(t);
    await fs.symlink('pkg', path.join(f.source, 'node_modules/alias'));
    await fs.unlink(path.join(f.source, 'node_modules/.bin/tool'));
    await fs.symlink('../alias/cli.mjs', path.join(f.source, 'node_modules/.bin/tool'));
    const a = await f.take('aliases');
    assert.equal((await execute(process.execPath, [path.join(a.target, 'node_modules/.bin/tool')])).stdout, 'original relative import\n');
    assert.equal(a.manifest.dependencyLinks.length, 2);
});

test('external, absolute, dangling, chained escape and cyclic links remain refused without reading outside bytes', async (t) => {
    const f = await createDependencyFixture(t);
    const link = path.join(f.source, 'node_modules/.bin/tool');
    await fs.writeFile(path.join(f.root, 'outside'), 'PRIVATE_OUTSIDE');
    for (const [i, target] of ['../../../outside', path.join(f.root, 'outside'), '../pkg/missing', 'tool', '../alias/cli.mjs'].entries()) {
        await fs.unlink(link);
        await fs.symlink(target, link);
        if (i === 4)
            await fs.symlink('../../', path.join(f.source, 'node_modules/alias'));
        const dest = path.join(f.root, 'refuse-' + i);
        await fs.mkdir(dest);
        await assert.rejects(capture(f.source, dest, {}).result, /Unsupported dependency link/);
        await assert.rejects(fs.access(path.join(dest, 'outside')));
    }
    await fs.unlink(path.join(f.source, 'node_modules/alias'));
    await fs.unlink(link);
    await fs.symlink('../pkg/cli.mjs', link);
    await fs.symlink('..', path.join(f.source, 'node_modules/pkg/loop'));
    const dest = path.join(f.root, 'directory-cycle');
    await fs.mkdir(dest);
    await assert.rejects(capture(f.source, dest, {}).result, /Unsupported dependency link/);
});

test('dependency link records cannot be injected without valid manifest digest or graph', async (t) => {
    const f = await createDependencyFixture(t);
    const a = await f.take('valid');
    assert.throws(() => validateManifest({ ...a.manifest, dependencyLinks: [{ path: 'node_modules/.bin/tool', target: '../../../outside' }] }), /manifest unavailable/);
    assert.throws(() => validateManifest({ ...a.manifest, dependencyLinks: undefined }), /manifest unavailable/);
    const byteBound = path.join(f.root, 'byte-bound');
    await fs.mkdir(byteBound);
    await assert.rejects(capture(f.source, byteBound, { maxBytes: a.manifest.bytes - 1 }).result, /bytes exceed/);
    const destination = path.join(f.root, 'bounded');
    await fs.mkdir(destination);
    await assert.rejects(capture(f.source, destination, { maxEntries: 2 }).result, /entries exceed/);
});

test('ignored contributor scratch links explain refusal without following targets; relocating evidence permits full capture', async t => {
    const f = await createDependencyFixture(t);
    const scratch = path.join(f.source, '.runtime-fixtures');
    await fs.mkdir(scratch);
    await fs.writeFile(path.join(f.source, '.gitignore'), '.runtime-fixtures/\nignored.txt\n');
    await fs.writeFile(path.join(f.source, 'ignored.txt'), 'included ignored source');
    const outside = path.join(f.root, 'private-evidence');
    await fs.writeFile(outside, 'PRIVATE_OUTSIDE');
    await fs.symlink(outside, path.join(scratch, 'config-alias'));
    await assert.rejects(f.take('refused-scratch'), error => {
        assert.match(error.message, /unsupported capture entry: "\.runtime-fixtures\/config-alias"/);
        assert.match(error.message, /symbolic link outside node_modules/);
        assert.match(error.message, /includes Git-ignored files/);
        assert.match(error.message, /Move temporary evidence outside the project/);
        assert.match(error.message, /target was not followed/);
        return true;
    });
    await fs.rename(scratch, path.join(f.root, 'retained-scratch'));
    const captured = await f.take('after-relocation');
    assert.ok(captured.manifest.files.some(file => file.path === 'ignored.txt'));
    assert.equal(await fs.readFile(path.join(captured.target, 'ignored.txt'), 'utf8'), 'included ignored source');
    assert.equal(await fs.readlink(path.join(f.root, 'retained-scratch/config-alias')), outside);
    assert.ok(!captured.manifest.files.some(file => file.path.includes('private-evidence')));
});


test('owned captures and materialization honor exact executable normalization under isolated umask022/077', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-capture-umask-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const module = pathToFileURL(path.resolve('dist/controller/change-files.js')).href;
    const script = path.join(root, 'observe.mjs');
    await fs.writeFile(script, `
        import fs from 'node:fs/promises';
        import path from 'node:path';
        import { freeze, materialize } from ${JSON.stringify(module)};

        const [root, mask] = process.argv.slice(2);
        const source = path.join(root, 'source');
        await fs.mkdir(source, { mode: 0o700 });
        const inputs = [
            ['public.sh', 0o755, '#!/bin/sh\\nexit 0\\n'],
            ['owner.sh', 0o700, '#!/bin/sh\\nexit 0\\n'],
            ['plain.txt', 0o644, 'plain bytes\\n'],
        ];
        for (const [name, mode, body] of inputs) {
            await fs.writeFile(path.join(source, name), body);
            await fs.chmod(path.join(source, name), mode);
        }
        const snapshot = async () => Promise.all(inputs.map(async ([name]) => ({
            name,
            mode: (await fs.stat(path.join(source, name))).mode & 0o777,
            bytes: (await fs.readFile(path.join(source, name))).toString('base64'),
        })));
        const before = await snapshot();
        const previous = process.umask(Number.parseInt(mask, 8));
        try {
            const frozen = await freeze(source, path.join(root, 'frozen'), {});
            const copy = await materialize(path.join(root, 'frozen'), path.join(root, 'materialized'), {}, frozen.digest);
            const observations = [];
            for (const file of frozen.manifest.files) {
                observations.push({
                    name: file.path,
                    declared: file.effectiveMode,
                    frozen: (await fs.stat(path.join(root, 'frozen', file.path))).mode & 0o777,
                    materialized: (await fs.stat(path.join(root, 'materialized', file.path))).mode & 0o777,
                });
            }
            console.log(JSON.stringify({
                mask, before, after: await snapshot(), digest: frozen.digest,
                materializedDigest: copy.digest, observations,
            }));
        } finally {
            process.umask(previous);
        }
    `, { mode: 0o600 });
    const outcomes = [];
    for (const mask of ['022', '077']) {
        const runRoot = path.join(root, mask);
        await fs.mkdir(runRoot, { mode: 0o700 });
        const result = await execute(process.execPath, [script, runRoot, mask], { timeout: 10000, maxBuffer: 65536 });
        const value = JSON.parse(result.stdout);
        assert.deepEqual(value.after, value.before);
        assert.equal(value.materializedDigest, value.digest);
        assert.deepEqual(value.observations.map(row => [row.name, row.declared, row.frozen, row.materialized]), [
            ['owner.sh', 0o700, 0o700, 0o700],
            ['plain.txt', 0o600, 0o600, 0o600],
            ['public.sh', 0o711, 0o711, 0o711],
        ]);
        outcomes.push(value);
    }
    assert.equal(outcomes[0].digest, outcomes[1].digest);
    t.diagnostic(JSON.stringify({
        isolatedFixture: root,
        masks: outcomes.map(value => ({ mask: value.mask, digest: value.digest, observations: value.observations })),
    }));
});

test('actual new-output chmod failure rejects capture and closes both original file handles', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-capture-chmod-failure-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'source');
    const target = path.join(root, 'captured');
    const log = path.join(root, 'handles.jsonl');
    const preload = path.join(root, 'preload.mjs');
    const script = path.join(root, 'run.mjs');
    await fs.mkdir(source, { mode: 0o700 });
    await fs.writeFile(path.join(source, 'run.sh'), '#!/bin/sh\nexit 0\n');
    await fs.chmod(path.join(source, 'run.sh'), 0o755);
    await fs.writeFile(log, '', { mode: 0o600 });
    await fs.writeFile(preload, `
        import fs from 'node:fs/promises';
        import sync from 'node:fs';
        import path from 'node:path';
        import { isMainThread, workerData } from 'node:worker_threads';

        if (!isMainThread && workerData?.source === ${JSON.stringify(source)} && workerData?.target === ${JSON.stringify(target)}) {
            const open = fs.open;
            const record = value => sync.appendFileSync(${JSON.stringify(log)}, JSON.stringify(value) + '\\n');
            fs.open = async (...args) => {
                const handle = await open(...args);
                const file = String(args[0]);
                const fd = handle.fd;
                const role = file.startsWith(workerData.target + path.sep) ? 'output'
                    : file.startsWith(workerData.source + path.sep) ? 'source' : null;
                if (role) {
                    record({ event: 'opened', role, fd });
                    const close = handle.close.bind(handle);
                    handle.close = async () => {
                        await close();
                        record({ event: 'closed', role, fd });
                    };
                    if (role === 'output' && args[1] === 'wx') {
                        handle.chmod = async () => {
                            record({ event: 'chmod-rejected', role, fd });
                            throw Error('OWNED_CAPTURE_CHMOD_FAILURE');
                        };
                    }
                }
                return handle;
            };
        }
    `, { mode: 0o600 });
    const module = pathToFileURL(path.resolve('dist/controller/change-files.js')).href;
    await fs.writeFile(script, `
        import fs from 'node:fs/promises';
        import { freeze } from ${JSON.stringify(module)};

        const before = (await fs.stat(${JSON.stringify(path.join(source, 'run.sh'))})).mode & 0o777;
        try {
            await freeze(${JSON.stringify(source)}, ${JSON.stringify(target)}, {});
            console.log(JSON.stringify({ usableManifest: true }));
        } catch (error) {
            console.log(JSON.stringify({
                usableManifest: false,
                error: error.message,
                sourceBefore: before,
                sourceAfter: (await fs.stat(${JSON.stringify(path.join(source, 'run.sh'))})).mode & 0o777,
                partialBytes: (await fs.stat(${JSON.stringify(path.join(target, 'run.sh'))})).size,
            }));
        }
    `, { mode: 0o600 });
    const result = await execute(process.execPath, ['--import=' + preload, script], { timeout: 10000, maxBuffer: 65536 });
    const value = JSON.parse(result.stdout);
    const events = (await fs.readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(value.usableManifest, false);
    assert.match(value.error, /OWNED_CAPTURE_CHMOD_FAILURE/);
    assert.equal(value.sourceBefore, 0o755);
    assert.equal(value.sourceAfter, 0o755);
    assert.equal(value.partialBytes, 0);
    assert.equal(events.filter(row => row.event === 'chmod-rejected').length, 1);
    for (const opened of events.filter(row => row.event === 'opened')) {
        assert.ok(events.some(row => row.event === 'closed' && row.role === opened.role && row.fd === opened.fd));
    }
    assert.deepEqual(events.filter(row => row.event === 'opened').map(row => row.role).sort(), ['output', 'source']);
});
