import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

test('actual owned bridge preserves diagnostic write failure and retries without a native cleanup hold', {timeout: 10000}, async t => {
    const root = await temporaryDirectory('claude-diagnostics');
    for (const name of ['host', 'agent', 'agent/home', 'state', 'artifacts', 'project', 'native-account'])
        await fs.mkdir(path.join(root, name), {recursive: true, mode: 0o700});
    await fs.writeFile(path.join(root, 'agent/claude-bridge.json'), JSON.stringify({askClaude: {enabled: false}, provider: {strictMcpConfig: true, autoMemoryEnabled: false}}), {mode: 0o600});
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./claude-diagnostics-child.mjs', import.meta.url)), root], {
        cwd: path.join(root, 'host'), timeout: 8000, maxBuffer: 128 * 1024, encoding: 'utf8',
        env: {PATH: '/usr/bin:/bin', HOME: path.join(root, 'agent/home'), PI_CODING_AGENT_DIR: path.join(root, 'agent'),
            CLAUDE_CONFIG_DIR: path.join(root, 'native-account'), TMPDIR: path.join(root, 'artifacts'), LANG: 'C'},
    });
    if (result.status !== 0 || result.error) t.diagnostic(`Retained diagnostic fixture: ${root}`);
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {writeFailurePreserved: true, retryDiagnosticPersisted: true, processAttempts: 0, networkAttempts: 0, cleanup: 'joined'});
    await fs.rm(root, {recursive: true, force: true});
});
