import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {restartCommand} from '../../dist/ui/startup-guidance.js';

test('copyable restart preserves exact external profile/runtime operands with shell metacharacters', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-restart-')));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const entry = path.join(root, 'record-argv.mjs');
    await fs.writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
    const args = ['--model-profile', "/private/owner's $(NEVER_EXECUTE).json", '--docker-context', 'original', '--image', 'sha256:' + 'a'.repeat(64)];
    const command = restartCommand('/private/app', 'same-conversation', process.execPath, entry, args);
    const result = await promisify(execFile)('/bin/sh', ['-c', command], {env: {PATH: '/usr/bin:/bin'}});
    assert.deepEqual(JSON.parse(result.stdout), ['conversation', 'ui', '--home', '/private/app', '--conversation', 'same-conversation', ...args]);
    assert.equal(result.stderr, '');
    assert.match(restartCommand('/private/app', 'c', process.execPath, entry, ['--model-profile', '/private/line\nbreak']), /copyable command is unavailable/);
});
