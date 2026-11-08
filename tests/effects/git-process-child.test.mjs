import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function absent(group) {
    try { process.kill(-group, 0); return false; }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
async function fixture(t, inheritedPipes) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-supervisor-group-')));
    await fs.chmod(root, 0o700);
    let group, supervisor, passed = false;
    t.after(async () => {
        if (!group) {
            try { group = JSON.parse(await fs.readFile(path.join(root, 'git-start.json'), 'utf8')).gitPid; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (group && !absent(group)) {
            process.kill(-group, 'SIGKILL');
            const until = Date.now() + 2000;
            while (!absent(group) && Date.now() < until) await pause(20);
            assert.ok(absent(group), 'Retain fixture because its process group remains: ' + root);
        }
        if (supervisor?.exitCode === null && supervisor?.signalCode === null) {
            supervisor.kill('SIGKILL');
            await new Promise(resolve => supervisor.once('close', resolve));
        }
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained failed fixture: ' + root);
    });
    const descendant = path.join(root, 'descendant.mjs'), leader = path.join(root, 'leader.mjs');
    await fs.writeFile(descendant, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.send('ready');`);
    await fs.writeFile(leader, `import {spawn} from 'node:child_process'; import fs from 'node:fs';
const child = spawn(process.execPath, [${JSON.stringify(descendant)}], {stdio: ['ignore', ${JSON.stringify(inheritedPipes ? 'inherit' : 'ignore')}, ${JSON.stringify(inheritedPipes ? 'inherit' : 'ignore')}, 'ipc']});
child.once('message', () => { fs.writeFileSync(${JSON.stringify(path.join(root, 'pids.json'))}, JSON.stringify({leader:process.pid,descendant:child.pid})); child.disconnect(); child.unref(); });`);
    const descriptor = path.join(root, 'descriptor.json');
    await fs.writeFile(path.join(root, 'stdin.bin'), '', {mode: 0o600});
    await fs.writeFile(descriptor, JSON.stringify({version: 1, parentPid: process.pid, commandId: 'group-cleanup', directory: root,
        binary: await fs.realpath(process.execPath), argv: [leader], cwd: root, env: {PATH: '/usr/bin:/bin'}, timeoutMs: 5000,
        maxStdout: 1024, excerptBytes: 1024, inputBytes: 0, inputSha256: createHash('sha256').update('').digest('hex')}), {mode: 0o600});
    supervisor = spawn(process.execPath, ['dist/effects/git-process-child.js', descriptor], {stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    let diagnostic = '';
    supervisor.stderr.on('data', bytes => { diagnostic += bytes; });
    const closed = new Promise(resolve => supervisor.once('close', resolve));
    const until = Date.now() + 3000;
    let pids;
    while (!pids && Date.now() < until) {
        try { pids = JSON.parse(await fs.readFile(path.join(root, 'pids.json'), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; await pause(20); }
    }
    assert.ok(pids, 'Native fixture did not start: ' + diagnostic);
    group = pids.leader;
    await closed;
    const outcome = JSON.parse(await fs.readFile(path.join(root, 'result.json'), 'utf8'));
    return {root, group, pids, outcome, diagnostic, pass() { passed = true; }};
}
for (const inheritedPipes of [false, true]) {
    test('Git supervisor joins descendants after leader exit with ' + (inheritedPipes ? 'inherited' : 'closed') + ' pipes', {timeout: 10000}, async t => {
        const f = await fixture(t, inheritedPipes);
        assert.equal(f.outcome.exitCode, 0, f.diagnostic);
        assert.equal(f.outcome.cleanup, 'confirmed');
        assert.equal(f.outcome.settled, true);
        assert.equal(f.outcome.timedOut, false);
        assert.equal(f.outcome.aborted, false);
        assert.ok(absent(f.group), 'Closed stdio must not certify a live native group');
        assert.throws(() => process.kill(f.pids.descendant, 0), error => error.code === 'ESRCH');
        f.pass();
    });
}
