import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chmodSync } from 'node:fs';
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

async function nativeHomeFixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-native-home-')));
    const operatorHome = path.join(root, 'operator');
    const project = path.join(operatorHome, 'project');
    const account = path.join(operatorHome, '.claude');
    const bin = path.join(root, 'bin');
    for (const directory of [operatorHome, project, account, bin])
        await fs.mkdir(directory, { mode: 0o700 });
    const settings = path.join(operatorHome, '.claude.json');
    await fs.writeFile(settings, '{}', { mode: 0o600 });
    const executable = path.join(bin, 'claude');
    await fs.writeFile(executable, `#!/bin/sh
if [ "$1" = "--version" ]; then
    printf '%s\\n' '2.1.0 (Claude Code)'
else
    printf '%s\\n' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"team"}'
fi
`, { mode: 0o700 });
    const { openController } = await import('../../dist/controller/index.js');
    const controller = await openController({ installationHome: path.join(root, 'application') });
    t.after(async () => {
        await controller.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const startup = ApplicationStartup.open(controller);
    return {
        root, operatorHome, project, account, settings, executable, controller, startup,
        async selection() {
            const edit = await startup.prepareBridgeConnection({ home: operatorHome, path: bin });
            const found = await edit.discover();
            const candidate = found.candidates.find(value => value.label === executable);
            const route = found.routes.find(value => value.kind === 'default-home');
            assert.ok(candidate); assert.ok(route);
            return { edit, candidate, route };
        },
    };
}

test('guided native login checks and connects with a registered project under operator HOME', async t => {
    const f = await nativeHomeFixture(t);
    await f.controller.registerProject({ id: 'P', sourceRoot: f.project });
    const original = await fs.readFile(f.settings);
    const { edit, candidate, route } = await f.selection();
    const checked = await edit.check(candidate.id, route.id);
    assert.equal(checked.ready, true);
    assert.equal(checked.account.plan, 'team');
    assert.deepEqual(await edit.connect(checked.id), { saved: true });
    const saved = JSON.parse(await fs.readFile(path.join(f.root, 'application/config/startup.json'), 'utf8'));
    assert.equal(saved.bridge.nativeAccountHome, f.operatorHome);
    assert.equal(saved.bridge.nativeAccountDirectory, f.account);
    assert.deepEqual(await fs.readFile(f.settings), original);
    assert.deepEqual(f.controller.listProjects().map(project => project.sourceRoot), [f.project]);
});

for (const location of ['account', 'settings']) {
    test(`guided native login keeps ${location} outside registered project inputs`, async t => {
        const f = await nativeHomeFixture(t);
        if (location === 'settings') {
            await fs.unlink(f.settings);
            await fs.mkdir(f.settings, { mode: 0o700 });
            await f.controller.registerProject({ id: 'P', sourceRoot: f.settings });
            await fs.rmdir(f.settings);
        } else {
            await f.controller.registerProject({ id: 'P', sourceRoot: f.account });
        }
        const { edit, candidate, route } = await f.selection();
        await assert.rejects(edit.check(candidate.id, route.id), /disjoint/);
        await assert.rejects(fs.lstat(path.join(f.root, 'application/config/startup.json')), { code: 'ENOENT' });
    });
}

test('guided native login retains reviewed HOME identity at the final synchronous save guard', async t => {
    const f = await nativeHomeFixture(t);
    await f.controller.registerProject({ id: 'P', sourceRoot: f.project });
    const { edit, candidate, route } = await f.selection();
    const checked = await edit.check(candidate.id, route.id);
    assert.equal(checked.ready, true);
    const save = f.startup.saveChecked;
    let enteredSave = false;
    f.startup.saveChecked = function (...arguments_) {
        enteredSave = true;
        chmodSync(f.operatorHome, 0o755);
        return save.apply(this, arguments_);
    };
    try {
        await assert.rejects(edit.connect(checked.id), /Reviewed Claude account route changed/);
        assert.equal(enteredSave, true);
    } finally {
        f.startup.saveChecked = save;
    }
    await assert.rejects(fs.lstat(path.join(f.root, 'application/config/startup.json')), { code: 'ENOENT' });
});
