import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Public original controller APIs; the only cut is before the removed journal write.
export async function scopeRemovalJourney({root, payload, node, runtime, environment = process.env}) {
    const worker = path.join(root, 'scope-removal-worker.mjs');
    await fs.copyFile(fileURLToPath(new URL('./scope-removal-worker.mjs', import.meta.url)), worker);
    const env = {...environment, GITJIG_REMOVAL_RUNTIME: JSON.stringify(runtime), NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: ''};
    const invocations = [];
    const run = async mode => {
        const started = performance.now(), child = spawn(node, [worker, payload, root, mode], {cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        let stdout = '', stderr = '', size = 0, expired = false, overflow = false;
        const kill = () => {try {process.kill(-child.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}};
        const timer = setTimeout(() => {expired = true; kill();}, 45000);
        const collect = (bytes, error) => {size += bytes.length; if (size > 2 ** 20) {overflow = true; kill();} else if (error) stderr += bytes; else stdout += bytes;};
        child.stdout.on('data', bytes => collect(bytes, false)); child.stderr.on('data', bytes => collect(bytes, true));
        let result;
        try {result = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal}));});}
        finally {clearTimeout(timer);}
        const receipt = {mode, pid: child.pid, milliseconds: performance.now() - started, ...result, stdout, stderr, expired, overflow};
        invocations.push(receipt);
        await fs.writeFile(path.join(root, 'invocations.json'), JSON.stringify(invocations, null, 2), {mode: 0o600});
        assert.equal(expired, false, mode + ' deadline'); assert.equal(overflow, false, mode + ' output cap');
        assert.deepEqual(result, mode === 'crash' ? {code: null, signal: 'SIGKILL'} : {code: 0, signal: null}, mode + ': ' + stderr);
        assert.throws(() => process.kill(-child.pid, 0), {code: 'ESRCH'}, 'Owned process group settled');
        const modules = (await fs.readFile(path.join(root, mode + '-modules.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
        assert.ok(modules.length > 0); assert.ok(modules.every(row => row.pid === child.pid));
        assert.ok(modules.some(row => row.url.endsWith('/dist/execution/container-scope.js')));
    };
    let failure;
    try {
        await run('crash');
        const crash = JSON.parse(await fs.readFile(path.join(root, 'crash.json'), 'utf8'));
        const original = await fs.readFile(path.join(root, 'original-journal.json'));
        assert.deepEqual(await fs.readFile(crash.journal), original, 'SIGKILL preceded removed record');
        // Adverse retained evidence: a different original daemon must hold, even on a healthy current route.
        const wrong = {...crash.saved, creationBinding: {...crash.saved.creationBinding, daemonId: 'different-original-daemon'}};
        await fs.writeFile(crash.journal, JSON.stringify(wrong), {mode: 0o600});
        await run('hold');
        await fs.writeFile(crash.journal, original, {mode: 0o600});
        await run('recover');
        return {root, payload, invocations};
    } catch (error) {failure = error; throw error;}
    finally {
        // Includes a replacement scope if recovery itself failed; no broad engine cleanup.
        try {await run('cleanup');}
        catch (error) {throw failure ? new AggregateError([failure, error], 'Journey and exact cleanup failed') : error;}
    }
}
