import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApplicationStartup } from '../../dist/app/startup.js';

async function fixture(t, value, prepared) {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-guided-ownership-')));
    await fs.mkdir(path.join(home, 'config'), {mode: 0o700});
    const file = path.join(home, 'config/startup.json');
    await fs.writeFile(file, JSON.stringify(value), {mode: 0o600});
    const resources = [];
    let projects = [];
    const controller = {applicationHome: () => home, listProjects: () => projects, adoptApplicationResource: resource => resources.push(resource), applyRuntimeProfile: async (_runtime, commit) => commit()};
    const startup = ApplicationStartup.open(controller, prepared);
    t.after(async () => {await startup.close(); await fs.rm(home, {recursive: true, force: true});});
    return {home, file, startup, setProjects(value) {projects = value;}};
}

test('guided replacement can open broken bridge without deleting its original bytes', async t => {
    const f = await fixture(t, {version: 1, bridge: {broken: true}});
    const before = await fs.readFile(f.file);
    const edit = await f.startup.prepareBridgeConnection({});
    edit.assertCurrent();
    assert.deepEqual(await fs.readFile(f.file), before);
    await fs.writeFile(f.file, '{"version":1}', {mode: 0o600});
    assert.throws(() => edit.assertCurrent(), /changed/);
});

for (const value of [{version: 1, bridge: {}, unknown: true}, {version: 1, bridge: {}, runtime: {image: 'invalid'}}]) {
    test('guided bridge replacement refuses invalid unrelated settings', async t => {
        const f = await fixture(t, value);
        const before = await fs.readFile(f.file);
        await assert.rejects(f.startup.prepareBridgeConnection({}));
        assert.deepEqual(await fs.readFile(f.file), before);
    });
}

test('guided discovery source cannot survive project registration or application close', async t => {
    const f = await fixture(t, {version: 1});
    const edit = await f.startup.prepareBridgeConnection({});
    f.setProjects([{sourceRoot: path.join(f.home, 'registered')}]);
    assert.throws(() => edit.assertCurrent(), /changed/);
    f.setProjects([]);
    await f.startup.close();
    assert.throws(() => edit.assertCurrent(), /changed/);
    await assert.rejects(f.startup.prepareBridgeConnection({}), /closing/);
});


test('restart preserves explicit choices until runtime field Save supersedes invocation runtime', async t => {
    const runtime = {dockerBinary: '/usr/bin/false', dockerContext: 'NO_ENGINE', image: 'sha256:' + '0'.repeat(64)};
    const f = await fixture(t, {version: 1}, {configuration: {version: 1, runtime}, sources: {runtime: 'invocation', bridge: 'none'}});
    const args = ['--docker-binary', '/usr/bin/false', '--docker-context', 'NO_ENGINE', '--image', runtime.image, '--model-profile', '/private/original profile.json', '--command-key', 'ctrl+p'];
    assert.deepEqual(f.startup.continuationArguments(args), args);
    const edit = await f.startup.prepareRuntimeEdit();
    await edit.save(runtime);
    assert.deepEqual(f.startup.continuationArguments(args), ['--model-profile', '/private/original profile.json', '--command-key', 'ctrl+p']);
});
