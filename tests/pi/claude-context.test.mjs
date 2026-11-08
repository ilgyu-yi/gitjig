import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

for (const mode of ['snapshot', 'concurrent', 'retry', 'temp-project', 'temp-missing', 'temp-drift', 'advanced-default', 'advanced-explicit', 'public-account', 'linked-account', 'dangling-account', 'unsafe-settings', 'explicit-missing', 'missing-home', 'invalid-home-override', 'object-path', 'nul-temp']) {
    test(`owned Claude explicit context ${mode}`, {timeout: 10000}, async t => {
        const root = await temporaryDirectory('claude-context');
        const result = spawnSync(process.execPath, [fileURLToPath(new URL('./claude-context-child.mjs', import.meta.url)), root, mode], {
            cwd: root, env: {HOME: root, PATH: '/usr/bin:/bin', LANG: 'C'}, encoding: 'utf8', timeout: 8000, maxBuffer: 128 * 1024,
        });
        if (result.status !== 0 || result.error) t.diagnostic(`Retained context fixture: ${root}`);
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), {mode, complete: true, processes: 0, network: 0});
        await fs.rm(root, {recursive: true, force: true});
    });
}
