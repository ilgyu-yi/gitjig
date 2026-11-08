import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {offlineSourceInstallation, inventory} from './offline-source-fixture.mjs';

// Explicit prepared offline npm cache and Python3; no account, model or engine.
test('public source update retains a live installed session and switches only new launches', {timeout: 360000}, async t => {
    const f = await offlineSourceInstallation(t, 'source-update');
    const guard = path.join(f.root, 'source-update-guard.mjs');
    const guardBytes = await fs.readFile(new URL('./source-update-guard.mjs', import.meta.url));
    await fs.writeFile(guard, guardBytes, {mode: 0o600});
    const guarded = label => ({...f.env, GITJIG_TEST_PAYLOAD: f.payload, GITJIG_TEST_TRACE: path.join(f.root, label + '.trace.json')});
    const assertTrace = async label => {
        const trace = JSON.parse(await fs.readFile(path.join(f.root, label + '.trace.json')));
        assert.deepEqual(trace.counts, {network: 0, process: 0, foreignImport: 0});assert.equal(trace.traceLimit, false);
        return trace;
    };
    const cli = async (args, label) => {
        const output = await f.run(process.execPath, ['--import', guard, f.command, ...args, '--home', f.home], label, {environment: guarded(label)});
        await assertTrace(label);return JSON.parse(output);
    };
    const source = path.join(f.root, 'project');await fs.mkdir(source, {mode: 0o700});
    await fs.writeFile(path.join(source, 'owned.txt'), 'original project bytes');
    await cli(['project', 'register', '--id', 'P', '--root', source], 'source-update-register');
    const conversation = await cli(['conversation', 'create'], 'source-update-create');
    const database = path.join(f.home, 'state/controller.sqlite');
    const read = () => {
        const db = new DatabaseSync(database, {readOnly: true});
        try {return Object.fromEntries(['works', 'runs', 'budgets', 'conversation_inputs', 'capacity_leases', 'obligations'].map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));}
        finally {db.close();}
    };
    const assertVersion = async (version, expected, label) => {
        const actual = await inventory(version);
        if (!isDeepStrictEqual(actual, expected)) {
            await fs.writeFile(path.join(f.root, label + '.actual.json'), JSON.stringify(actual), {mode: 0o600});
            assert.fail('Version bytes/modes/links changed: ' + label + '; inspect retained inventory receipts');
        }
    };
    const before = read(), oldEntry = await fs.realpath(f.command), oldStat = await fs.stat(oldEntry);
    const oldVersion = path.resolve(f.payload, '../../..'), oldInventory = await inventory(oldVersion);
    await fs.writeFile(path.join(f.root, 'original-version-before.json'), JSON.stringify(oldInventory), {mode: 0o600});
    assert.equal(await fs.realpath(path.join(f.prefix, 'lib/node_modules/gitjig/runtime')), path.join(f.payload, 'runtime'));
    const installEnvironment = {...f.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, npm_config_cache: f.cache, npm_config_offline: 'true',
        npm_config_update_notifier: 'false', npm_config_userconfig: path.join(f.root, 'empty-npmrc'), npm_config_globalconfig: path.join(f.root, 'empty-global-npmrc'), npm_config_logs_dir: path.join(f.root, 'update-npm-logs')};
    const ready = path.join(f.root, 'ui-ready'), done = path.join(f.root, 'update-done'), output = path.join(f.root, 'ui.raw'), config = path.join(f.root, 'ui.json');
    await fs.writeFile(config, JSON.stringify({command: [process.execPath, '--import', guard, f.command, 'conversation', 'ui', '--home', f.home, '--conversation', conversation.conversationId],
        env: guarded('source-update-ui'), cwd: f.cwd, output, noForceKill: true, gracefulShutdownSeconds: 8, timeoutSeconds: 250,
        steps: [{wait: 'Model: ', releaseFile: ready, send: '\x15/language en\x1b\r'},
            {wait: '', waitFiles: [{path: done, value: 'done'}], send: '\x15/project P\x1b\r'},
            {wait: 'Project selected: P', send: '\x15/quit\x1b\r'}]}), {mode: 0o600});
    const ui = f.run('python3', [path.resolve('tests/cli/fork-ui-pty.py'), config], 'source-update-ui', {timeout: 263000});
    void ui.catch(() => {});
    let updateError, newEntry;
    try {
        let observed = false;
        for (let attempt = 0; attempt < 100; attempt++) {
            try {await fs.access(ready);observed = true;break;} catch (error) {if (error.code !== 'ENOENT') throw error;}
            await delay(100);
        }
        assert.ok(observed, 'Original terminal readiness');
        const pid = JSON.parse(await fs.readFile(output + '.progress.json')).childPid;
        process.kill(pid, 0);
        const ownerFile = path.join(f.home, 'state/owner.json'), owner = await fs.readFile(ownerFile);
        await f.run(process.execPath, [path.join(f.source, 'install.mjs'), '--prefix', f.prefix], 'source-update-install', {timeout: 155000,
            environment: installEnvironment});
        process.kill(pid, 0);assert.deepEqual(await fs.readFile(ownerFile), owner);
        newEntry = await fs.realpath(f.command);assert.notEqual(newEntry, oldEntry);
        assert.equal((await fs.stat(oldEntry)).ino, oldStat.ino);await assertVersion(oldVersion, oldInventory, 'original-version');
        const updatedPayload = path.resolve(path.dirname(newEntry), '../..'), updatedVersion = path.resolve(updatedPayload, '../../..'), updatedInventory = await inventory(updatedVersion);
        await fs.writeFile(path.join(f.root, 'updated-version-before.json'), JSON.stringify(updatedInventory), {mode: 0o600});
        const npm = await fs.realpath(path.join(path.dirname(process.execPath), 'npm'));
        await f.run(process.execPath, [npm, 'uninstall', '--global', '--prefix', f.prefix, '--ignore-scripts', '--no-audit', '--no-fund', 'gitjig'], 'source-update-uninstall', {timeout: 15000, environment: installEnvironment});
        process.kill(pid, 0);assert.deepEqual(await fs.readFile(ownerFile), owner);
        await assert.rejects(fs.lstat(f.command), {code: 'ENOENT'});
        await assert.rejects(fs.lstat(path.join(f.prefix, 'lib/node_modules/gitjig')), {code: 'ENOENT'});
        await assertVersion(updatedVersion, updatedInventory, 'updated-version');await assertVersion(oldVersion, oldInventory, 'original-version');
        await f.run(process.execPath, [path.join(f.source, 'install.mjs'), '--prefix', f.prefix], 'source-update-reinstall', {timeout: 155000, environment: installEnvironment});
        const reinstalledEntry = await fs.realpath(f.command);assert.notEqual(reinstalledEntry, newEntry);newEntry = reinstalledEntry;
        process.kill(pid, 0);assert.deepEqual(await fs.readFile(ownerFile), owner);
        await assertVersion(updatedVersion, updatedInventory, 'updated-version');await assertVersion(oldVersion, oldInventory, 'original-version');
    } catch (error) {updateError = error;}
    finally {await fs.writeFile(done, 'done', {mode: 0o600});}
    const terminal = JSON.parse(await ui), progress = JSON.parse(await fs.readFile(output + '.progress.json'));
    assert.equal(terminal.exitCode, 0);assert.equal(terminal.stages, 3);assert.equal(terminal.terminalRestored, true);
    assert.equal(terminal.alternateEntered, true);assert.equal(terminal.alternateExited, true);
    assert.equal(progress.error, null);assert.equal(progress.forceKilled, false);assert.equal(progress.outputTruncated, false);
    const trace = await assertTrace('source-update-ui');
    assert.deepEqual(read(), before);assert.equal(await fs.readFile(path.join(source, 'owned.txt'), 'utf8'), 'original project bytes');
    if (updateError) throw updateError;
    const version = JSON.parse(await f.run(process.execPath, [f.command, '--version'], 'source-update-new-launch'));
    assert.equal(version.application, 'gitjig');
    await f.assertCurrent();assert.equal(f.groups.size, 0);
    await fs.writeFile(path.join(f.root, 'source-update-result.json'), JSON.stringify({oldEntry, newEntry, terminal, progress, trace, ledgerUnchanged: true,
        scope: 'Real locked source/npm deployment, live no-account terminal through update/uninstall/reinstall, unchanged full old/new versions, normal metadata command/quit, new version entry; not model/engine or legacy migration qualification'}, null, 2), {mode: 0o600});
    f.pass();
});
