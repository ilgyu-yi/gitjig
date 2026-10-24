import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtimeImageBuildHelp, dockerConfigurationPreparation } from '../../dist/ui/runtime-setup-help.js';
import { suggestRuntimePaths } from '../../dist/execution/runtime-paths.js';
const execute = promisify(execFile);
test('displayed Docker configuration command prepares a previously absent private directory usable by discovery', async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/docker-config-help-'))), directory = path.join(root, "user's .docker");
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await assert.rejects(fs.access(directory));
    const guide = dockerConfigurationPreparation(directory);
    await execute('/bin/sh', ['-c', guide.command]);
    assert.equal((await fs.stat(directory)).mode & 0o077, 0);
    assert.deepEqual(await suggestRuntimePaths({ guard() { }, checkPath() { } }, [], directory), { dockerConfigDirectory: directory });
});
test('on-screen image commands quote actual paths, copy only recipe assets and show an ID only after successful build', async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/image-guide-'))), recipe = path.join(root, "recipe '$(false) `false`"), config = path.join(root, "config 'quoted'"), binary = path.join(root, "docker 'quoted'"), receipt = path.join(root, 'receipt');
    await fs.mkdir(recipe);
    await fs.mkdir(config);
    for (const name of ['Dockerfile', 'Dockerfile.dockerignore', 'io-helper.mjs', 'DO_NOT_COPY'])
        await fs.writeFile(path.join(recipe, name), name);
    await fs.writeFile(binary, '#!' + process.execPath + '\n' + `import fs from 'node:fs';const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify(args));if(process.env.FAIL_BUILD)process.exit(1);fs.writeFileSync(args[args.indexOf('--iidfile')+1],'sha256:'+'1'.repeat(64));`, { mode: 0o700 });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const text = runtimeImageBuildHelp({ dockerBinary: binary, dockerConfigDirectory: config, dockerContext: 'owned' }, recipe), blocks = text.split('\n\n'), script = blocks.filter(block => block.startsWith('gitjig_recipe=') || block.startsWith('if test ')).join('\n');
    assert.ok(script.includes('--iidfile'));
    let built;
    try {
        const output = await execute('/bin/sh', ['-c', script], { env: { PATH: '/usr/bin:/bin' } });
        assert.equal(output.stdout, 'sha256:' + '1'.repeat(64));
        const args = JSON.parse(await fs.readFile(receipt));
        assert.deepEqual(args.slice(0, 5), ['--config', config, '--context', 'owned', 'build']);
        built = args.at(-1);
        assert.deepEqual((await fs.readdir(built)).sort(), ['Dockerfile', 'Dockerfile.dockerignore', 'io-helper.mjs']);
        const failed = await execute('/bin/sh', ['-c', script], { env: { PATH: '/usr/bin:/bin', FAIL_BUILD: '1' } });
        assert.equal(failed.stdout, '');
        assert.match(failed.stderr, /No image selected/);
        const failedArgs = JSON.parse(await fs.readFile(receipt));
        assert.notEqual(failedArgs.at(-1), built);
        await fs.rm(path.dirname(failedArgs.at(-1)), { recursive: true, force: true });
        await fs.unlink(receipt);
        const missing = runtimeImageBuildHelp({ dockerBinary: binary, dockerConfigDirectory: config, dockerContext: 'owned' }, path.join(root, 'missing')).split('\n\n').filter(block => block.startsWith('gitjig_recipe=') || block.startsWith('if test ')).join('\n');
        const copyFailure = await execute('/bin/sh', ['-c', missing + '\nprintf "\\n%s" "$gitjig_image_work"'], { env: { PATH: '/usr/bin:/bin' } });
        assert.match(copyFailure.stderr, /No image selected/);
        await assert.rejects(fs.access(receipt));
        await fs.rm(copyFailure.stdout.trim(), { recursive: true, force: true });
    }
    finally {
        if (built)
            await fs.rm(path.dirname(built), { recursive: true, force: true });
    }
    assert.throws(() => runtimeImageBuildHelp({ dockerBinary: '/path\nline', dockerConfigDirectory: config, dockerContext: 'owned' }), /printable/);
});
test('local path suggestions skip unsafe/project candidates, resolve links and preserve stale guards without execution', async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/path-suggestions-'))), config = path.join(root, 'config'), unsafe = path.join(root, 'unsafe'), safe = path.join(root, 'safe'), link = path.join(root, 'link');
    await fs.mkdir(config, { mode: 0o700 });
    await fs.writeFile(unsafe, 'never execute', { mode: 0o777 });
    await fs.writeFile(safe, 'never execute', { mode: 0o700 });
    await fs.symlink(safe, link);
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.chmod(unsafe, 0o777);
    assert.deepEqual(await suggestRuntimePaths({ guard() { }, checkPath() { } }, [unsafe, link], config), { dockerBinary: safe, dockerConfigDirectory: config });
    assert.deepEqual(await suggestRuntimePaths({ guard() { }, checkPath(file) {
            if (file === safe)
                throw Error('project controlled');
        } }, [safe], config), { dockerConfigDirectory: config });
    assert.deepEqual(await suggestRuntimePaths({ guard() { }, checkPath() { } }, [], path.join(root, 'absent')), {});
    let calls = 0;
    await assert.rejects(suggestRuntimePaths({ guard() {
            if (++calls > 1)
                throw Error('STALE_SOURCE');
        }, checkPath() { } }, [safe], config), /STALE_SOURCE/);
});
