import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
test('actual gitjig settings CLI bootstraps without model/engine and never follows Pi home', { timeout: 20000 }, async t => {
    await fs.mkdir('.runtime-fixtures', { recursive: true });
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/app-config-cli-')));
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained fixture: ' + root); });
    const home = path.join(root, 'app'), stock = path.join(root, 'pi'), project = path.join(root, 'project');
    await fs.mkdir(stock, { mode: 0o700 });
    await fs.mkdir(path.join(project, '.gitjig'), { recursive: true });
    const canary = '{"defaultModel":"stock-model"}';
    await fs.writeFile(path.join(stock, 'settings.json'), canary);
    await fs.writeFile(path.join(project, '.gitjig/settings.json'), '{"theme":"light"}');
    const env = { ...process.env, HOME: path.join(root, 'user'), GITJIG_HOME: home, PI_CODING_AGENT_DIR: stock, PI_CODING_AGENT_SESSION_DIR: stock, NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' };
    const run = async args => {
        try { return { code: 0, ...await execute(process.execPath, ['--import', './tests/normal-hosted/no-external.mjs', 'dist/cli/main.js', ...args], { env, timeout: 5000, maxBuffer: 1024 * 1024 }) }; }
        catch (error) { if (typeof error.code === 'number') return { code: error.code, stdout: error.stdout, stderr: error.stderr }; throw error; }
    };
    let result = await run(['settings', 'inspect']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).home, home);
    assert.equal(JSON.parse(result.stdout).effective.defaultModel, undefined);
    const identity = await run(['--version']);
    assert.equal(identity.code, 0, identity.stderr);
    const version = JSON.parse(identity.stdout);
    assert.equal(version.application, 'gitjig');
    assert.equal(version.piSdkVersion, '1.3.0');
    result = await run(['settings', 'set', '--key', 'theme', '--value', '"dark"']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).settings.effective.theme, 'dark');
    assert.equal(JSON.parse(result.stdout).activeExecutionChanged, false);
    assert.equal(JSON.parse((await run(['settings', 'inspect'])).stdout).effective.theme, 'dark');
    assert.equal(await fs.readFile(path.join(stock, 'settings.json'), 'utf8'), canary);
    const settingsFile = path.join(home, 'config/settings.json');
    const smallPrevious = await fs.readFile(settingsFile, 'utf8');
    await fs.writeFile(settingsFile, JSON.stringify({ ...JSON.parse(smallPrevious), filler: 'x'.repeat(70000) }), { mode: 0o600 });
    const previous = await fs.readFile(settingsFile, 'utf8');
    // Keep the individual argv value portable; aggregate stored state exceeds
    // the reader budget even though this argument and the old file each fit.
    const oversize = await run(['settings', 'set', '--key', 'enabledModels', '--value', JSON.stringify(Array.from({ length: 70 }, (_, i) => String(i).padStart(4, '0') + 'x'.repeat(1020)))]);
    assert.equal(oversize.code, 2);
    assert.match(oversize.stderr, /128KiB/);
    assert.equal(await fs.readFile(path.join(home, 'config/settings.json'), 'utf8'), previous);
    assert.equal(JSON.parse((await run(['settings', 'inspect'])).stdout).effective.theme, 'dark');
    await fs.writeFile(settingsFile, smallPrevious, { mode: 0o600 });
    const file = path.join(home, 'config/settings.json'), before = await fs.readFile(file, 'utf8');
    for (const [key, value] of [['auth', '"DO_NOT_ECHO"'], ['theme', '"unknown-theme"'], ['modelThinkingLevels', '{"invalid":"high"}']]) {
        const invalid = await run(['settings', 'set', '--key', key, '--value', value]);
        assert.equal(invalid.code, 2);
        assert.ok(!invalid.stderr.includes('DO_NOT_ECHO'));
        assert.equal(await fs.readFile(file, 'utf8'), before);
    }
    result = await run(['settings', 'set', '--key', 'modelThinkingLevels', '--value', '{"fixture/model":"high"}']);
    assert.equal(result.code, 0, result.stderr);
    result = await run(['settings', 'set', '--key', 'modelThinkingLevels', '--value', '{}']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse((await run(['settings', 'inspect'])).stdout).effective.modelThinkingLevels, undefined);
    result = await run(['project', 'register', '--id', 'p', '--root', project]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse((await run(['settings', 'inspect', '--project', 'p'])).stdout).effective.theme, 'dark');
    result = await run(['settings', 'approve-project', '--project', 'p']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).effective.theme, 'light');
    const alternate = path.join(root, 'alternate');
    result = await run(['settings', 'inspect', '--home', alternate]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).home, alternate);
    assert.equal(JSON.parse(result.stdout).effective.theme, undefined);
    assert.equal(JSON.parse((await run(['settings', 'inspect'])).stdout).effective.theme, 'dark');
    assert.equal(await fs.readFile(path.join(stock, 'settings.json'), 'utf8'), canary);
    passed = true;
});
