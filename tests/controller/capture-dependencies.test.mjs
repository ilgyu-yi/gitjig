import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { capture, validateManifest } from '../../dist/controller/capture.js';
import { freeze, materialize, delta, effective, hash } from '../../dist/controller/change-files.js';
const execute = promisify(execFile);

async function createDependencyFixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/dependency-capture-')));
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
