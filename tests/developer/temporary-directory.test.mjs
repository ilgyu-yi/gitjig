import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

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
