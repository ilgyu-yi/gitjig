import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {runtimeFixtureRoot} from '../runtime/profile.mjs';

const execute = promisify(execFile);
const allocator = new URL('../helpers/temporary-directory.mjs', import.meta.url);

test('ordinary fixtures are canonical private roots, including a symlinked temporary parent', async t => {
    const root = await temporaryDirectory('allocation');
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    assert.equal(await fs.realpath(root), root);
    assert.equal((await fs.stat(root)).mode & 0o777, 0o700);
    const parent = path.join(root, 'parent'), alias = path.join(root, 'alias');
    await fs.mkdir(parent);
    await fs.symlink(parent, alias);
    const result = await execute(process.execPath, ['--input-type=module', '-e',
        `import {temporaryDirectory} from ${JSON.stringify(allocator.href)}; console.log(await temporaryDirectory('alias'));`],
    {timeout: 5000, env: {PATH: '/usr/bin:/bin', TMPDIR: alias, TMP: alias, TEMP: alias}});
    const allocated = result.stdout.trim();
    assert.equal(path.dirname(allocated), parent);
    assert.equal((await fs.stat(allocated)).mode & 0o777, 0o700);
});

test('ordinary allocation rejects a checkout temporary parent before writing a fixture', async () => {
    const checkout = fileURLToPath(new URL('../../', import.meta.url));
    const result = execute(process.execPath, ['--input-type=module', '-e',
        `import {temporaryDirectory} from ${JSON.stringify(allocator.href)}; await temporaryDirectory('must-not-create');`],
    {timeout: 5000, env: {PATH: '/usr/bin:/bin', TMPDIR: checkout, TMP: checkout, TEMP: checkout}});
    await assert.rejects(result, /temporary storage outside the checkout/);
    assert.ok(!(await fs.readdir(checkout)).some(name => name.startsWith('gitjig-must-not-create-')));
});

test('ordinary fixture names cannot select a parent or personal path', async () => {
    for (const prefix of ['', '../account', '/absolute', 'a/b', 'a\n', 'x'.repeat(81)])
        await assert.rejects(temporaryDirectory(prefix), /plain name/);
});

test('real-engine fixture roots are explicit canonical private storage outside the checkout', async t => {
    const checkout = fileURLToPath(new URL('../../', import.meta.url));
    const root = await temporaryDirectory('engine-storage');
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const alias = path.join(root, 'checkout-alias'), externalAlias = path.join(root, 'external-alias');
    const loose = path.join(root, 'loose'), missing = path.join(root, 'missing'), file = path.join(root, 'file');
    await fs.symlink(checkout, alias);
    await fs.symlink(root, externalAlias);
    await fs.mkdir(loose);
    await fs.chmod(loose, 0o755);
    await fs.writeFile(file, '');
    const read = value => runtimeFixtureRoot({GITJIG_RUNTIME_FIXTURE_ROOT: value});
    await assert.rejects(read(undefined), /Explicit absolute/);
    await assert.rejects(read('relative'), /Explicit absolute/);
    await assert.rejects(read(checkout), /outside the checkout/);
    await assert.rejects(read(alias), /outside the checkout/);
    await assert.rejects(read(externalAlias), /canonical/);
    await assert.rejects(read(loose), /private directory/);
    await assert.rejects(read(file), /private directory/);
    await assert.rejects(read(missing), {code: 'ENOENT'});
    await assert.rejects(fs.lstat(missing), {code: 'ENOENT'});
    assert.equal(await read(root), root);
    assert.equal((await fs.stat(loose)).mode & 0o777, 0o755);
});

test('the shared work registry refuses checkout TMPDIR before opening application state', async () => {
    const checkout = fileURLToPath(new URL('../../', import.meta.url));
    const fixture = new URL('../controller/change-registry-fixture.mjs', import.meta.url);
    const sdkGuard = fileURLToPath(new URL('../cli/no-sdk-loader.mjs', import.meta.url));
    await assert.rejects(execute(process.execPath, ['--import', sdkGuard, '--input-type=module', '-e',
        `import {registryWorld} from ${JSON.stringify(fixture.href)};
        const endings=[];
        try { await registryWorld({after: action => endings.push(action)}, 'must-not-create'); }
        finally { for (const end of endings.reverse()) await end(); }`],
    {timeout: 5000, env: {PATH: '/usr/bin:/bin', TMPDIR: checkout, TMP: checkout, TEMP: checkout}}), /temporary storage outside the checkout/);
});
