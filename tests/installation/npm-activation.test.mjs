import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {activateNpmPayload} from '../../dist/installation/npm-activation.js';
import {inventoryTree} from '../../dist/installation/tree.js';

async function fixture(t) {
    const root = await temporaryDirectory('npm-activation'), prefix = path.join(root, 'prefix with spaces');
    await fs.mkdir(prefix);
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const active = path.join(prefix, 'lib/node_modules/gitjig'), bin = path.join(prefix, 'bin/gitjig');
    const options = (label = 'original') => ({prefix, artifactHash: 'a'.repeat(64), migrateLegacy: false,
        install: async stage => {
            const payload = path.join(stage, 'lib/node_modules/gitjig');
            await fs.mkdir(path.join(payload, 'dist/cli'), {recursive: true});
            await fs.mkdir(path.join(stage, 'bin'));
            await fs.writeFile(path.join(payload, 'package.json'), JSON.stringify({name: 'gitjig', version: '0.0.0', type: 'module'}));
            await fs.writeFile(path.join(payload, 'dist/cli/entry.js'), label);
            await fs.symlink('../lib/node_modules/gitjig/dist/cli/entry.js', path.join(stage, 'bin/gitjig'));
        },
        verify: async entry => { assert.equal(await fs.readFile(entry, 'utf8'), label); },
    });
    return {root, prefix, active, bin, options};
}
test('source activation publishes a complete version and keeps the prior canonical tree intact', async t => {
    const f = await fixture(t), first = await activateNpmPayload(f.options());
    assert.equal(await fs.realpath(f.bin), first.entry);
    const oldPayload = path.resolve(path.dirname(first.entry), '../..'), tree = await inventoryTree(oldPayload);
    const before = await fs.readFile(first.entry);
    const second = await activateNpmPayload(f.options('replacement'));
    assert.notEqual(first.entry, second.entry);
    assert.deepEqual(await fs.readFile(first.entry), before);
    assert.equal(await fs.readFile(await fs.realpath(f.bin), 'utf8'), 'replacement');
    assert.equal((await fs.lstat(f.active)).isSymbolicLink(), true);
    assert.deepEqual(await inventoryTree(oldPayload), tree);
});
for (const failure of ['install', 'verify']) test('failed ' + failure + ' leaves the active version unchanged', async t => {
    const f = await fixture(t), original = await activateNpmPayload(f.options()), oldLink = await fs.readlink(f.active);
    const options = f.options('replacement');options[failure] = async () => {throw Error('CONTROLLED_' + failure);};
    await assert.rejects(activateNpmPayload(options), new RegExp('CONTROLLED_' + failure));
    assert.equal(await fs.realpath(f.bin), original.entry);assert.equal(await fs.readlink(f.active), oldLink);
});
test('one prefix serializes installers independently of application homes', async t => {
    const f = await fixture(t);let entered, release;
    const ready = new Promise(resolve => {entered = resolve;});
    const wait = new Promise(resolve => {release = resolve;});
    const options = f.options(), install = options.install;
    options.install = async stage => {entered();await wait;await install(stage);};
    const first = activateNpmPayload(options);await ready;
    try {await assert.rejects(activateNpmPayload(f.options()), /OWNER|owner|guard/);} finally {release();}
    await first;
});
for (const target of ['active', 'bin']) test('changed ' + target + ' is preserved and refuses staging publication', async t => {
    const f = await fixture(t);await activateNpmPayload(f.options());
    const options = f.options('replacement'), install = options.install;
    options.install = async stage => {await install(stage);await fs.unlink(f[target]);await fs.symlink('unrelated-owned-link', f[target]);};
    await assert.rejects(activateNpmPayload(options), /paths changed/);
    assert.equal(await fs.readlink(f[target]), 'unrelated-owned-link');
});
test('legacy migration requires an explicit stopped-session precondition and preserves its original tree', async t => {
    const f = await fixture(t);
    await fs.mkdir(path.join(f.active, 'dist/cli'), {recursive: true});await fs.mkdir(path.dirname(f.bin));
    await fs.copyFile('package.json', path.join(f.active, 'package.json'));
    await fs.writeFile(path.join(f.active, 'dist/cli/entry.js'), 'legacy');
    await fs.symlink('../lib/node_modules/gitjig/dist/cli/entry.js', f.bin);
    const before = await inventoryTree(f.active);
    await assert.rejects(activateNpmPayload(f.options()), /--migrate-legacy/);
    assert.deepEqual(await inventoryTree(f.active), before);
    const result = await activateNpmPayload({...f.options(), migrateLegacy: true});
    assert.deepEqual(await inventoryTree(path.join(result.versions, 'legacy-' + result.versionId)), before);
    assert.equal(await fs.realpath(f.bin), result.entry);
});
for (const foreign of ['root', 'active', 'bin']) test('foreign ' + foreign + ' is not adopted or replaced', async t => {
    const f = await fixture(t);
    await fs.mkdir(path.join(f.prefix, 'lib/node_modules'), {recursive: true});await fs.mkdir(path.join(f.prefix, 'bin'));
    const target = foreign === 'root' ? path.join(f.prefix, 'lib/gitjig-versions') : f[foreign];
    if (foreign === 'root') await fs.mkdir(target);else await fs.symlink('unrelated', target);
    await assert.rejects(activateNpmPayload(f.options()));
    if (foreign === 'root') assert.deepEqual(await fs.readdir(target), []);else assert.equal(await fs.readlink(target), 'unrelated');
});
for (const boundary of ['package-before', 'package-after', 'bin-before', 'bin-after', 'journal-before']) test('repeat finishes only the recorded candidate after ' + boundary, async t => {
    const f = await fixture(t);await activateNpmPayload(f.options());
    const rename = fs.rename.bind(fs), unlink = fs.unlink.bind(fs);let interrupted = false;
    t.mock.method(fs, 'rename', async (from, to) => {
        const selected = boundary.startsWith('package') ? to === f.active : boundary.startsWith('bin') && to === f.bin;
        if (!interrupted && selected) {
            interrupted = true;
            if (boundary.endsWith('after')) await rename(from, to);
            throw Error('CONTROLLED_INTERRUPTION');
        }
        return rename(from, to);
    });
    t.mock.method(fs, 'unlink', async file => {
        if (!interrupted && boundary === 'journal-before' && String(file).endsWith('/pending.json')) {interrupted = true;throw Error('CONTROLLED_INTERRUPTION');}
        return unlink(file);
    });
    await assert.rejects(activateNpmPayload(f.options('candidate')), /CONTROLLED_INTERRUPTION/);
    const pendingFile = path.join(f.prefix, 'lib/gitjig-versions/state/pending.json');
    const pending = JSON.parse(await fs.readFile(pendingFile));
    const result = await activateNpmPayload(f.options('next'));
    assert.equal(result.recovered, pending.candidate.id);
    assert.equal(await fs.readFile(await fs.realpath(f.bin), 'utf8'), 'next');
    await assert.rejects(fs.access(pendingFile), {code: 'ENOENT'});
});
test('tampered retained candidate refuses recovery instead of suppressing its missing/changed evidence', async t => {
    const f = await fixture(t);await activateNpmPayload(f.options());
    const rename = fs.rename.bind(fs);let stop = true;
    t.mock.method(fs, 'rename', async (from, to) => {if (stop && to === f.active) {stop = false;throw Error('CONTROLLED_INTERRUPTION');}return rename(from, to);});
    await assert.rejects(activateNpmPayload(f.options('candidate')), /CONTROLLED_INTERRUPTION/);
    const pendingFile = path.join(f.prefix, 'lib/gitjig-versions/state/pending.json'), raw = await fs.readFile(pendingFile);
    const pending = JSON.parse(raw), entry = path.join(f.prefix, 'lib/gitjig-versions', pending.candidate.id, 'lib/node_modules/gitjig/dist/cli/entry.js');
    await fs.writeFile(entry, 'tampered');
    await assert.rejects(activateNpmPayload(f.options('next')), /Staged payload unavailable or changed/);
    assert.deepEqual(await fs.readFile(pendingFile), raw);
    await fs.unlink(entry);
    await assert.rejects(activateNpmPayload(f.options('next')), /Staged payload unavailable or changed/);
    assert.deepEqual(await fs.readFile(pendingFile), raw);
});

test('a missing nested prefix is created without requiring a prior installation', async t => {
    const f = await fixture(t);await fs.rmdir(f.prefix);
    const prefix = path.join(f.prefix, 'nested');
    const result = await activateNpmPayload({...f.options(), prefix});
    assert.equal(result.prefix, await fs.realpath(prefix));
    assert.equal(await fs.readFile(result.entry, 'utf8'), 'original');
});
for (const timing of ['before', 'after']) test('legacy move interruption ' + timing + ' preserves and recovers the exact original', async t => {
    const f = await fixture(t);
    await fs.mkdir(path.join(f.active, 'dist/cli'), {recursive: true});await fs.mkdir(path.dirname(f.bin));
    await fs.copyFile('package.json', path.join(f.active, 'package.json'));
    await fs.writeFile(path.join(f.active, 'dist/cli/entry.js'), 'legacy');
    const before = await inventoryTree(f.active), rename = fs.rename.bind(fs);let stop = true;
    t.mock.method(fs, 'rename', async (from, to) => {
        if (stop && from === f.active) {stop = false;if (timing === 'after') await rename(from, to);throw Error('CONTROLLED_LEGACY_INTERRUPTION');}
        return rename(from, to);
    });
    await assert.rejects(activateNpmPayload({...f.options(), migrateLegacy: true}), /CONTROLLED_LEGACY_INTERRUPTION/);
    const pending = JSON.parse(await fs.readFile(path.join(f.prefix, 'lib/gitjig-versions/state/pending.json')));
    // Recovery uses original durable consent; a rerun does not need another migration grant.
    const result = await activateNpmPayload(f.options('next'));
    assert.equal(result.recovered, pending.candidate.id);
    assert.deepEqual(await inventoryTree(path.join(result.versions, 'legacy-' + pending.candidate.id)), before);
});

test('actual process exit after package publication retains original journal and is recovered under a new writer', async t => {
    const f = await fixture(t), script = path.join(f.root, 'crash.mjs');
    const activation = new URL('../../dist/installation/npm-activation.js', import.meta.url).href;
    await fs.writeFile(script, `import fs from 'node:fs/promises';import path from 'node:path';import {activateNpmPayload} from ${JSON.stringify(activation)};
const prefix=${JSON.stringify(f.prefix)},rename=fs.rename.bind(fs);
fs.rename=async(from,to)=>{await rename(from,to);if(to===path.join(prefix,'lib/node_modules/gitjig'))process.exit(73);};
await activateNpmPayload({prefix,artifactHash:'a'.repeat(64),migrateLegacy:false,verify:async()=>{},install:async stage=>{
const payload=path.join(stage,'lib/node_modules/gitjig');await fs.mkdir(path.join(payload,'dist/cli'),{recursive:true});await fs.writeFile(path.join(payload,'package.json'),JSON.stringify({name:'gitjig',version:'0.0.0'}));await fs.writeFile(path.join(payload,'dist/cli/entry.js'),'crashed candidate');}});`);
    const {execFile} = await import('node:child_process'), {promisify} = await import('node:util');
    const command = promisify(execFile)(process.execPath, [script], {timeout: 10000, env: {PATH: path.dirname(process.execPath), HOME: f.root}});
    await assert.rejects(command, error => error.code === 73);
    assert.throws(() => process.kill(command.child.pid, 0), {code: 'ESRCH'});
    const state = path.join(f.prefix, 'lib/gitjig-versions/state');
    const owner = JSON.parse(await fs.readFile(path.join(state, 'owner.json'))), pending = JSON.parse(await fs.readFile(path.join(state, 'pending.json')));
    assert.equal(owner.pid, command.child.pid);
    const result = await activateNpmPayload(f.options('next'));
    assert.equal(result.recovered, pending.candidate.id);
    assert.equal(await fs.readFile(await fs.realpath(f.bin), 'utf8'), 'next');
    await assert.rejects(fs.access(path.join(state, 'owner.json')), {code: 'ENOENT'});
});

for (const value of [null, {name: 'another-package'}, 'malformed']) test('invalid legacy identity refuses with its path and preserves original data: ' + JSON.stringify(value), async t => {
    const f = await fixture(t);await fs.mkdir(f.active, {recursive: true});
    const file = path.join(f.active, 'package.json'), bytes = value === 'malformed' ? 'DUMMY_PRIVATE_METADATA_NOT_FOR_DIAGNOSTICS' : JSON.stringify(value);
    await fs.writeFile(file, bytes);
    const options = {...f.options(), migrateLegacy: true, install: async () => assert.fail('Unknown legacy identity cannot start staging')};
    await assert.rejects(activateNpmPayload(options), error => error.message.includes(file) && !error.message.includes('DUMMY_PRIVATE_METADATA_NOT_FOR_DIAGNOSTICS'));
    assert.equal(await fs.readFile(file, 'utf8'), bytes);
});

test('unexpected command registration is not adopted or exposed to npm', async t => {
    const f = await fixture(t), original = await activateNpmPayload(f.options());
    const options = f.options('replacement'), install = options.install;let unexpected;
    options.install = async stage => {
        await install(stage);unexpected = path.join(stage, 'command/node_modules/unexpected');
        await fs.mkdir(path.dirname(unexpected), {recursive: true});await fs.writeFile(unexpected, 'preserve unexpected data');
    };
    await assert.rejects(activateNpmPayload(options), /EEXIST|registration/);
    assert.equal(await fs.readFile(unexpected, 'utf8'), 'preserve unexpected data');
    assert.equal(await fs.realpath(f.bin), original.entry);
});
