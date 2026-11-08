import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

for (const mode of ['observe', 'sync-failure', 'async-failure', 'close-owner', 'no-sink', 'standalone-debug']) {
    test(mode === 'standalone-debug' ? 'genuine standalone initializer preserves explicit debug logging without native execution' : `public hosted declarations preserve pre-native ownership: ${mode}`, {timeout: 10000}, async t => {
        const root = await temporaryDirectory('bridge-owned-context');
        const home = path.join(root, 'operator-home');
        await fs.mkdir(home, {mode: 0o700});
        const debugFile = path.join(root, 'standalone-debug.log'), recordFile = path.join(root, 'standalone-record.jsonl');
        await fs.writeFile(debugFile, 'DEBUG_SENTINEL', {mode: 0o600});
        await fs.writeFile(recordFile, 'RECORD_SENTINEL', {mode: 0o600});
        const child = fileURLToPath(new URL(mode === 'standalone-debug' ? './bridge-standalone-debug-child.mjs' : './bridge-owned-context-child.mjs', import.meta.url));
        const result = spawnSync(process.execPath, [child, mode, root], {
            cwd: root,
            env: {PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: path.join(root, 'operator-agent'), LANG: 'C',
                CLAUDE_BRIDGE_DEBUG: '1', CLAUDE_BRIDGE_DEBUG_PATH: debugFile, CLAUDE_BRIDGE_RECORD_STREAM: recordFile},
            timeout: 8000,
            maxBuffer: 128 * 1024,
            encoding: 'utf8',
        });
        if (result.status !== 0 || result.error) t.diagnostic(`Retained owned-context fixture: ${root}`);
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        assert.equal(result.status, 0, result.stderr);
        const receipt = JSON.parse(result.stdout);
        assert.equal(receipt.mode, mode);
        assert.equal(receipt.nativeBirths, 0);
        assert.equal(receipt.cleanup, 'confirmed');
        assert.equal(receipt.ambientConfigurationPreserved, true);
        assert.equal(receipt.ambientLogCreated, false);
        const debug = await fs.readFile(debugFile, 'utf8');
        if (mode === 'standalone-debug') assert.match(debug, /DEBUG_SENTINEL.*loadConfig:/s);
        else assert.equal(debug, 'DEBUG_SENTINEL');
        assert.equal(await fs.readFile(recordFile, 'utf8'), 'RECORD_SENTINEL');
        await assert.rejects(fs.access(path.join(root, 'cc-cli-logs')), {code: 'ENOENT'});
        await fs.rm(root, {recursive: true, force: true});
    });
}
