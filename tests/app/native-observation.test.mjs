import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readNativeObservation, readNativeObservationResult } from '../../dist/execution/native-observation.js';

async function fixture(t, script) {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-observation-')));
    const file = path.join(home, 'client');
    await fs.writeFile(file, '#!/bin/sh\n' + script, {mode: 0o700});
    t.after(() => fs.rm(home, {recursive: true, force: true}));
    return {file, options: {cwd: home, env: {PATH: '/usr/bin:/bin'}, signal: new AbortController().signal, kind: 'Claude setup'}};
}

test('explicit logged-out status preserves structured exit while legacy observation still rejects it', async t => {
    const f = await fixture(t, 'echo \'{"loggedIn":false}\'\nexit 1\n');
    const result = await readNativeObservationResult(f.file, [], {...f.options, allowedExitCodes: [0, 1]});
    assert.equal(result.exitCode, 1);
    assert.deepEqual(JSON.parse(result.stdout), {loggedIn: false});
    await assert.rejects(readNativeObservation(f.file, [], f.options), /observation failed/);
});

test('nonadmitted exits expose neither stdout nor stderr credential material', async t => {
    const f = await fixture(t, 'echo PRIVATE_STDOUT\necho PRIVATE_STDERR >&2\nexit 2\n');
    await assert.rejects(readNativeObservationResult(f.file, [], {...f.options, allowedExitCodes: [0, 1]}), error => {
        assert.match(error.message, /observation failed/);
        assert.doesNotMatch(error.message, /PRIVATE/);
        return true;
    });
});

test('legacy successful Buffer observation remains compatible', async t => {
    const f = await fixture(t, 'printf hello\n');
    const result = await readNativeObservation(f.file, [], {...f.options, kind: 'Docker discovery'});
    assert.ok(Buffer.isBuffer(result));
    assert.equal(result.toString(), 'hello');
});

test('Claude setup cancellation joins native descendants before returning', {timeout: 5000}, async t => {
    const f = await fixture(t, 'echo $$ > parent\n/bin/sleep 30 &\necho $! > descendant\nwait\n');
    const abort = new AbortController();
    const task = readNativeObservationResult(f.file, [], {...f.options, signal: abort.signal});
    void task.catch(() => {});
    const until = Date.now() + 2000;
    let parent, descendant;
    while (Date.now() < until) {
        const values = await Promise.all(['parent', 'descendant'].map(name => fs.readFile(path.join(f.options.cwd, name), 'utf8').catch(() => '')));
        if (values.every(value => /^[1-9][0-9]*\n$/.test(value))) {
            [parent, descendant] = values.map(Number);
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    abort.abort();
    await assert.rejects(task, /cancelled/);
    assert.ok(parent > 1 && descendant > 1);
    for (const pid of [parent, descendant]) assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
});
