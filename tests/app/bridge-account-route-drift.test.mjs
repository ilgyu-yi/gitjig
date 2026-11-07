// Late metadata drift at the actual SDK birth hook; only the native protocol is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativeOwnerHistory} from '../pi/native-owner-history.mjs';

const worker = fileURLToPath(new URL('./bridge-account-route-drift-worker.mjs', import.meta.url));
const protocol = fileURLToPath(new URL('./bridge-native-protocol.mjs', import.meta.url));
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const absent = (pid, group = false) => {
    try { process.kill(group ? -pid : pid, 0); return false; }
    catch (error) { return error.code === 'ESRCH'; }
};

async function settleOwnedFixture(root) {
    const ownerRoot = path.join(root, 'app/state/runtime/native-owners/v1');
    const owners = await nativeOwnerHistory(ownerRoot).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    const originalWorker = owners.length ? JSON.parse(await fs.readFile(path.join(root, 'exercise.result.json'), 'utf8')).pid : undefined;
    const deadline = performance.now() + 6000;
    const cleanup = [];
    for (const {nonce, dir} of owners) {
        const read = async name => JSON.parse(await fs.readFile(path.join(dir, name + '.json'), 'utf8'));
        const admission = await read('admission');
        assert.equal(admission.nonce, nonce);
        assert.equal(admission.hostPid, originalWorker, 'Only this fixture worker owns the detached scope');
        const birth = await read('birth').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (birth) assert.equal(birth.nonce, nonce);
        const nativePid = birth?.nativePid;
        if (nativePid && !absent(nativePid, true)) {
            try { process.kill(-nativePid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        if (!absent(admission.guardianPid)) {
            try { process.kill(admission.guardianPid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        while (performance.now() < deadline && (!absent(admission.guardianPid) || nativePid && !absent(nativePid, true)))
            await new Promise(resolve => setTimeout(resolve, 20));
        const settled = absent(admission.guardianPid) && (!nativePid || absent(nativePid, true));
        cleanup.push({nonce, nativePid, guardianPid: admission.guardianPid, settled});
    }
    await fs.writeFile(path.join(root, 'cleanup.json'), JSON.stringify(cleanup, null, 2), {mode: 0o600});
    assert.ok(cleanup.every(record => record.settled), 'Owned detached fixture scopes are absent before removal');
}

async function execute(root, args, env) {
    const child = spawn(process.execPath, [worker, ...args], {
        cwd: path.join(root, 'host'), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', error = '', bytes = 0, expired = false, overflow = false;
    const kill = signal => { try { process.kill(-child.pid, signal); } catch (failure) { if (failure.code !== 'ESRCH') throw failure; } };
    const timer = setTimeout(() => { expired = true; kill('SIGKILL'); }, 24000);
    const collect = stderr => chunk => {
        bytes += chunk.length;
        if (bytes > 262144) { overflow = true; kill('SIGKILL'); }
        else if (stderr) error += chunk;
        else output += chunk;
    };
    child.stdout.on('data', collect(false));
    child.stderr.on('data', collect(true));
    let terminal;
    try { terminal = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal})); }); }
    finally { clearTimeout(timer); }
    await fs.writeFile(path.join(root, args[0] + '.result.json'), JSON.stringify({pid: child.pid, ...terminal, expired, overflow, output, error}, null, 2), {mode: 0o600});
    assert.equal(absent(child.pid, true), true, 'Owned worker process group settled');
    assert.equal(expired, false, error);
    assert.equal(overflow, false, error);
    assert.equal(terminal.signal, null, error);
    assert.equal(terminal.code, 0, error + output);
    return child.pid;
}

const cases = ['explicit-directory', 'default-home'].flatMap(accountRoute =>
    ['provider', 'later-provider', 'summary'].flatMap(purpose => ['account-mode', 'account-link'].map(drift => ({accountRoute, purpose, drift}))));
cases.push(...['home-mode', 'settings-mode', 'settings-link'].map(drift => ({accountRoute: 'default-home', purpose: 'summary', drift})));

for (const {accountRoute, purpose, drift} of cases) {
    test(`bridge ${accountRoute} ${purpose} refuses late ${drift} before native birth`, {
        timeout: 35000,
        skip: process.platform === 'win32' ? 'Owned native process groups require a supported POSIX host' : false,
    }, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-account-route-drift-')));
        let passed = false;
        t.after(async () => {
            await settleOwnedFixture(root);
            if (passed) await fs.rm(root, {recursive: true, force: true});
            else t.diagnostic('Retained owned account-route fixture: ' + root);
        });
        for (const relative of ['host', 'agent/home', 'native-account', 'native-home/.claude', 'bootstrap-temp'])
            await fs.mkdir(path.join(root, relative), {recursive: true, mode: 0o700});
        await fs.writeFile(path.join(root, 'agent/claude-bridge.json'), JSON.stringify({askClaude: {enabled: false}, provider: {strictMcpConfig: true, autoMemoryEnabled: false}}), {mode: 0o600});
        await fs.writeFile(path.join(root, 'native-home/.claude.json'), 'OWNED_FAKE_NATIVE_METADATA_NOT_PARSED', {mode: 0o600});
        const executable = path.join(root, 'selected native fixture');
        await fs.writeFile(executable, '#!/bin/sh\nexec ' + quote(await fs.realpath(process.execPath)) + ' ' + quote(protocol) + ' healthy "$@"\n', {mode: 0o700});
        const account = accountRoute === 'default-home' ? path.join(root, 'native-home/.claude') : path.join(root, 'native-account');
        const env = {PATH: '/usr/bin:/bin', USER: 'owned', LOGNAME: 'owned', LANG: 'C', SHELL: '/bin/sh',
            HOME: path.join(root, 'agent/home'), PI_CODING_AGENT_DIR: path.join(root, 'agent'), CLAUDE_CONFIG_DIR: account,
            TMPDIR: path.join(root, 'bootstrap-temp')};
        await execute(root, ['bootstrap', root, accountRoute, purpose, drift], env);
        await execute(root, ['exercise', root, accountRoute, purpose, drift], {...env, TMPDIR: path.join(root, 'app/artifacts')});
        const receipt = JSON.parse(await fs.readFile(path.join(root, 'receipt.json'), 'utf8'));
        assert.equal(receipt.complete, true);
        assert.equal(receipt.cleanupError, null);
        assert.equal(receipt.networkAttempts, 0);
        assert.equal(receipt.queries.length, purpose === 'provider' ? 0 : purpose === 'later-provider' ? 1 : 3);
        const owners = await nativeOwnerHistory(path.join(root, 'app/state/runtime/native-owners/v1'));
        assert.equal(owners.length, receipt.queries.length, 'Refusal creates no additional native admission');
        for (const {dir} of owners) {
            const read = async name => JSON.parse(await fs.readFile(path.join(dir, name + '.json'), 'utf8'));
            const admission = await read('admission'), birth = await read('birth'), settlement = await read('settlement');
            assert.equal(admission.purpose, 'provider');
            assert.equal(settlement.cleanup, 'confirmed');
            assert.equal(settlement.groupAbsent, true);
            assert.equal(settlement.stdioReleased, true);
            assert.equal(birth.nativePid, settlement.nativePid);
            assert.equal(absent(birth.nativePid, true), true);
            assert.equal(absent(admission.guardianPid), true);
        }
        passed = true;
    });
}
