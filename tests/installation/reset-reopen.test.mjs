import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';

const execute = promisify(execFile);

test('installed setup and reset preserve exact configuration boundaries through reopen', {timeout: 140000}, async t => {
    const receipt = process.env.GITJIG_CLI_FINAL_BUILD_RECEIPT;
    assert.ok(receipt, 'Explicit frozen current bundle receipt required');
    const built = JSON.parse(await fs.readFile(receipt, 'utf8'));
    const manifest = await fs.readFile(path.join(built.destination, 'bundle.json'));
    assert.equal(createHash('sha256').update(manifest).digest('hex'), built.manifestSha256);
    const root = await temporaryDirectory('installed-reset-reopen');
    const home = path.join(root, "owner's application");
    const user = path.join(root, 'user');
    const artifacts = path.join(home, 'artifacts');
    await fs.mkdir(user, {mode: 0o700});
    const options = {cwd: root, env: {HOME: user, PATH: '/usr/bin:/bin'}, timeout: 60000, maxBuffer: 2 ** 20};
    const launcher = path.join(home, 'gitjig');
    const installer = path.join(built.destination, 'install');
    let passed = false;
    t.after(async () => {
        if (!passed) {
            t.diagnostic('Retained installed reset evidence: ' + root);
            return;
        }
        await execute(installer, ['remove', '--home', home], options);
        await fs.rm(root, {recursive: true, force: true});
    });
    const cli = async (...args) => JSON.parse((await execute(launcher, args, options)).stdout);
    const config = path.join(home, 'config');
    const stage = () => execute(installer, ['stage', '--bundle', built.destination, '--home', home], options);
    assert.equal(JSON.parse((await stage()).stdout).staged, true);
    await assert.rejects(fs.lstat(config), {code: 'ENOENT'});
    await fs.symlink(user, config);
    await assert.rejects(stage(), error => {
        assert.equal(error.code, 2);
        assert.equal(JSON.parse(error.stderr).message, `State directory ${config} is not an owner-private directory`);
        return true;
    });
    assert.equal(await fs.readlink(config), user);
    await fs.unlink(config);
    const {stdout} = await execute(installer, ['activate', '--bundle', built.destination, '--home', home], options);
    assert.equal(JSON.parse(stdout).payloadId, built.payloadId);
    await assert.rejects(fs.lstat(config), {code: 'ENOENT'});
    assert.deepEqual((await cli('settings', 'inspect')).effective, {});
    assert.deepEqual((await cli('reset', 'preview', '--scope', 'settings')).paths, []);
    await cli('settings', 'set', '--key', 'theme', '--value', '"light"');
    assert.equal((await fs.lstat(config)).mode & 0o777, 0o700);
    const preferences = await fs.readFile(path.join(config, 'settings.json'));
    await stage();
    assert.deepEqual(await fs.readFile(path.join(config, 'settings.json')), preferences);
    const original = await cli('conversation', 'create');
    await fs.writeFile(path.join(artifacts, 'sentinel'), 'original');
    const preview = await cli('reset', 'preview', '--scope', 'all');
    const reset = await cli('reset', 'apply', '--scope', 'all', '--confirm', preview.fingerprint);
    await assert.rejects(fs.lstat(artifacts), {code: 'ENOENT'});
    const {backups} = await cli('reset', 'backups');
    assert.equal(backups[0].backupId, path.basename(reset.backup));
    assert.equal(await fs.readFile(path.join(reset.backup, 'artifacts/sentinel'), 'utf8'), 'original');
    assert.deepEqual(await fs.readFile(path.join(reset.backup, 'config/settings.json')), preferences);
    await assert.rejects(fs.lstat(artifacts), {code: 'ENOENT'});
    for (const disposition of ['backup', 'delete']) {
        const empty = await cli('reset', 'preview', '--scope', 'all', '--disposition', disposition);
        assert.deepEqual(empty.paths, []);
        assert.equal(empty.backupDirectory, null);
        const noOp = await cli('reset', 'apply', '--scope', 'all', '--disposition', disposition, '--confirm', empty.fingerprint);
        assert.deepEqual([noOp.reset, noOp.reason, noOp.backup], [false, 'nothing-to-reset', null]);
    }
    assert.deepEqual((await cli('reset', 'backups')).backups, backups);
    await assert.rejects(fs.lstat(path.join(home, 'reset-deletions')), {code: 'ENOENT'});
    await assert.rejects(fs.lstat(artifacts), {code: 'ENOENT'});

    await fs.symlink(root, artifacts);
    await assert.rejects(execute(launcher, ['reset', 'backups'], options),
        error => error.code === 2 && error.stderr.includes('INSTALLATION_UNAVAILABLE'));
    await fs.unlink(artifacts);
    await fs.mkdir(artifacts, {mode: 0o700});
    await fs.chmod(artifacts, 0o755);
    await assert.rejects(execute(launcher, ['reset', 'backups'], options),
        error => error.code === 2 && error.stderr.includes('INSTALLATION_UNAVAILABLE'));
    await fs.rmdir(artifacts);

    assert.deepEqual(await cli('conversation', 'list'), []);
    assert.equal((await fs.lstat(artifacts)).mode & 0o777, 0o700);
    const reopened = await cli('conversation', 'create');
    assert.notEqual(reopened.conversationId, original.conversationId);
    await assert.rejects(fs.lstat(config), {code: 'ENOENT'});
    const terminal = path.join(root, 'readiness.json');
    const steps = [
        {wait: '/ready setup', send: '\x07t'},
        {wait: 'Setup and next action', send: '\x1b'},
        {wait: '/ready setup', send: '\x07q'},
    ];
    await fs.writeFile(terminal, JSON.stringify({
        command: [launcher, 'conversation', 'ui', '--conversation', reopened.conversationId],
        cwd: root, env: {...options.env, TERM: 'xterm-256color', LANG: 'C.UTF-8'},
        steps, output: terminal + '.terminal', timeoutSeconds: 15, noForceKill: true,
    }), {mode: 0o600});
    const {stdout: readiness} = await execute('/usr/bin/python3', [fileURLToPath(new URL('../cli/fork-ui-pty.py', import.meta.url)), terminal], options);
    const result = JSON.parse(readiness);
    assert.deepEqual([result.exitCode, result.stages, result.terminalRestored], [0, steps.length, true]);
    await assert.rejects(fs.lstat(config), {code: 'ENOENT'});
    assert.deepEqual((await cli('reset', 'preview', '--scope', 'settings')).paths, []);

    const payload = path.join(home, 'versions', built.payloadId);
    const interrupt = async (action, ...operands) => {
        const fixture = `
            import assert from 'node:assert/strict';
            import fs from 'node:fs/promises';
            import path from 'node:path';
            const [home, action, ...operands] = process.argv.slice(1);
            if (action === 'reset') {
                const {applyApplicationReset} = await import('./dist/app/reset.js');
                const rename = fs.rename;
                fs.rename = (from, to) => from === path.join(home, 'artifacts')
                    ? Promise.reject(Error('Controlled interruption')) : rename(from, to);
                await assert.rejects(applyApplicationReset(home, 'all', ...operands), /Controlled interruption/);
            } else {
                const {deleteResetBackup} = await import('./dist/app/reset-backups.js');
                const rm = fs.rm;
                fs.rm = (file, ...args) => path.dirname(file) === path.join(home, 'reset-deletions')
                    ? Promise.reject(Error('Controlled interruption')) : rm(file, ...args);
                await assert.rejects(deleteResetBackup(home, ...operands), /Controlled interruption/);
            }
        `;
        await execute(path.join(home, 'bootstrap/node'), ['--input-type=module', '-e', fixture, home, action, ...operands], {...options, cwd: payload});
    };
    const following = async command => JSON.parse((await execute('/bin/sh', ['-c', command], options)).stdout);

    await fs.writeFile(path.join(artifacts, 'recovery-marker'), 'retained during recovery');
    await interrupt('reset', (await cli('reset', 'preview', '--scope', 'all')).fingerprint);
    let recoveryCommand;
    await assert.rejects(execute(launcher, ['conversation', 'list'], options), error => {
        const refusal = JSON.parse(error.stderr);
        assert.equal(refusal.error, 'RESET_PENDING');
        recoveryCommand = /^Run (.+) before installation maintenance or reopening$/u.exec(refusal.recovery)?.[1];
        assert.ok(recoveryCommand);
        return error.code === 2;
    });
    const recovered = await following(recoveryCommand);
    assert.equal(await fs.readFile(path.join(recovered.backup, 'artifacts/recovery-marker'), 'utf8'), 'retained during recovery');
    assert.deepEqual(await cli('conversation', 'list'), []);

    const toDelete = (await cli('reset', 'backups')).backups.find(backup => backup.backupId === path.basename(recovered.backup));
    await interrupt('backup-delete', toDelete.backupId, toDelete.fingerprint);
    const pending = await cli('reset', 'backups');
    assert.equal((await following(pending.pendingDeletion.recovery)).backupId, toDelete.backupId);
    assert.deepEqual((await cli('reset', 'backups')).backups, backups);
    passed = true;
});
