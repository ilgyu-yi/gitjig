import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { modelCommands } from '../../dist/ui/model-commands.js';
import { readinessCommands } from '../../dist/ui/readiness-commands.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
async function world(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/model-repair-'))), home = path.join(root, 'home'), c = await openController({ installationHome: home }), accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c), view = await models.newConversation(), source = path.join(root, 'project');
    await fs.mkdir(source);
    await c.registerProject({ id: 'P', sourceRoot: source });
    c.setConversationProject({ conversationId: view.conversationId, projectId: 'P', expectedGeneration: 0 });
    t.after(async () => {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return {
        root, home, c, accounts, models, cid: view.conversationId, file: path.join(home, 'config/models.json'), auth: path.join(home, 'config/auth.json')
    };
}
test('ready repairs malformed model configuration through reviewed private backup without catalogue recursion or secret disclosure', async (t) => {
    const f = await world(t), raw = '{"PRIVATE_EMBEDDED_MODEL_KEY":"DO_NOT_SHOW', auth = '{"openai":{"type":"api_key","key":"DUMMY_STORED_ACCOUNT"}}';
    await fs.writeFile(f.file, raw, { mode: 0o600 });
    await fs.writeFile(f.auth, auth, { mode: 0o600 });
    const shown = [];
    let ready = 0;
    const h = {
        controller: f.c, models: f.models, accounts: f.accounts, isCurrent: () => true, notice() { }, show: async (title, text) => shown.push({ title, text }), choose: async (title, rows) => {
            if (title.startsWith('Setup and next actions')) {
                if (ready++ === 0) {
                    assert.match(rows[0], /Repair unavailable model or account configuration/);
                    return rows[0];
                }
                return rows.at(-1);
            }
            if (title === 'Select the unavailable file to repair')
                return rows.find(row => row === 'Review reset · ' + f.file);
            if (title.startsWith('Reset only ')) {
                assert.equal(rows[0], 'Back without changes');
                return rows[1];
            }
            assert.fail(title);
        }
    };
    const commands = modelCommands(h);
    let registry;
    registry = new HostCommands([...commands.commands, ...readinessCommands({ ...h, execute: (...args) => registry.execute(...args) })]);
    assert.equal(await registry.execute('/ready', f.cid), 'completed');
    await commands.close();
    assert.deepEqual(JSON.parse(await fs.readFile(f.file)), { providers: {} });
    assert.equal(await fs.readFile(f.auth, 'utf8'), auth);
    const backup = (await fs.readdir(path.dirname(f.file))).find(name => name.startsWith('models.json.recovery-'));
    assert.ok(backup);
    assert.equal(await fs.readFile(path.join(path.dirname(f.file), backup), 'utf8'), raw);
    assert.equal((await fs.stat(path.join(path.dirname(f.file), backup))).mode & 0o077, 0);
    assert.ok((await f.models.list()).models.length > 0);
    assert.ok(shown.some(v => v.text.includes(f.file)));
    assert.ok(!JSON.stringify(shown).includes('DO_NOT_SHOW'));
    assert.ok(!JSON.stringify(shown).includes('DUMMY_STORED_ACCOUNT'));
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n, 0);
});
test('repair cancellation, changed bytes, unsafe files and close preserve the original selected configuration', async (t) => {
    const f = await world(t), raw = '{broken';
    await fs.writeFile(f.file, raw, { mode: 0o600 });
    let edit = await f.accounts.prepareConfigurationRepair();
    await fs.appendFile(f.file, 'changed');
    await assert.rejects(edit.reset('models', () => { }), /changed while reviewing/);
    assert.equal(await fs.readFile(f.file, 'utf8'), raw + 'changed');
    edit = await f.accounts.prepareConfigurationRepair();
    await assert.rejects(edit.reset('models', () => { throw Error('SOURCE_NAVIGATED'); }), /SOURCE_NAVIGATED/);
    assert.equal(await fs.readFile(f.file, 'utf8'), raw + 'changed');
    const h = {
        controller: f.c, accounts: f.accounts, models: f.models, isCurrent: () => true, show: async () => { }, choose: async () => 'Back without changes', notice() { }
    };
    const commands = modelCommands(h);
    assert.equal(await new HostCommands(commands.commands).execute('/model-repair', f.cid), 'cancelled');
    await commands.close();
    assert.equal(await fs.readFile(f.file, 'utf8'), raw + 'changed');
    await fs.chmod(f.file, 0o644);
    await assert.rejects(f.accounts.prepareConfigurationRepair(), /Unsafe/);
    await fs.chmod(f.file, 0o600);
    edit = await f.accounts.prepareConfigurationRepair();
    await f.accounts.close();
    await assert.rejects(async () => edit.reset('models', () => { }), /closing/);
    assert.equal(await fs.readFile(f.file, 'utf8'), raw + 'changed');
});
test('invalid account configuration identifies auth.json and does not reset valid custom models', async (t) => {
    const f = await world(t), models = '{"providers":{}}', auth = '{broken-account';
    await fs.writeFile(f.file, models, { mode: 0o600 });
    await fs.writeFile(f.auth, auth, { mode: 0o600 });
    const edit = await f.accounts.prepareConfigurationRepair();
    assert.equal(edit.files.find(file => file.kind === 'auth').file, f.auth);
    assert.ok(edit.files.find(file => file.kind === 'auth').reason);
    assert.equal(edit.files.find(file => file.kind === 'models').reason, null);
    const saved = await edit.reset('auth', () => { });
    assert.equal(await fs.readFile(saved.backup, 'utf8'), auth);
    assert.equal(await fs.readFile(f.file, 'utf8'), models);
    assert.deepEqual(JSON.parse(await fs.readFile(f.auth)), {});
});
test('repair refuses changed configuration directory identity, symlinks and permissions without backups or replacement', async (t) => {
    for (const mode of ['symlink', 'permissions', 'replacement'])
        await t.test(mode, async (t) => {
            const f = await world(t), raw = '{ORIGINAL_PRIVATE_CONFIGURATION', folder = path.dirname(f.file), moved = path.join(f.root, 'moved-config');
            await fs.writeFile(f.file, raw, { mode: 0o600 });
            const edit = await f.accounts.prepareConfigurationRepair();
            let retained = f.file;
            if (mode === 'permissions')
                await fs.chmod(folder, 0o755);
            else {
                await fs.rename(folder, moved);
                retained = path.join(moved, 'models.json');
                if (mode === 'symlink')
                    await fs.symlink(moved, folder);
                else {
                    await fs.mkdir(folder, { mode: 0o700 });
                    await fs.writeFile(f.file, raw, { mode: 0o600 });
                }
            }
            await assert.rejects(async () => edit.reset('models', () => { }), /Unsafe.*directory|directory changed while reviewing/);
            assert.equal(await fs.readFile(retained, 'utf8'), raw);
            assert.equal(await fs.readFile(f.file, 'utf8'), raw);
            for (const dir of new Set([folder, path.dirname(retained)]))
                assert.ok(!(await fs.readdir(dir)).some(name => name.includes('.recovery-') || name.endsWith('.tmp')));
            if (mode !== 'replacement')
                await assert.rejects(async () => f.accounts.prepareConfigurationRepair(), /Unsafe.*directory/);
        });
});
test('fresh CLI with an unavailable saved default opens model-free recovery instead of refusing UI startup', { timeout: 12000 }, async (t) => {
    const f = await world(t), home = path.join(f.root, 'fresh-home'), c = await openController({ installationHome: home }), accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c), builtin = (await models.list()).models.find(model => model.provider === 'openai');
    await accounts.setDefault('openai', builtin.id);
    await c.close();
    const file = path.join(home, 'config/models.json'), raw = '{BROKEN_FRESH_MODEL';
    await fs.writeFile(file, raw, { mode: 0o600 });
    const config = path.join(f.root, 'fresh-terminal.json'), steps = [
        { wait: 'Start with /ready', send: '/model-repair\x1b\r' },
        { wait: 'Model/account recovery · exact files', send: '\x1b' },
        { wait: 'Select the unavailable file to repair', send: '\x1b' },
        { wait: 'INPUT', send: '\x15/quit\x1b\r' },
    ];
    await fs.writeFile(config, JSON.stringify({
        command: [process.execPath, '--import', './tests/ui/readiness-no-execution.mjs', 'dist/cli/entry.js', 'conversation', 'ui', '--home', home], env: {
            ...process.env, HOME: f.root, TMPDIR: f.root, PATH: path.dirname(process.execPath), TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: ''
        }, steps, timeoutSeconds: 6, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output: config + '.terminal', gracefulShutdownSeconds: 2
    }));
    const actual = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], { timeout: 9000, maxBuffer: 2 ** 20 })).stdout);
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stages, steps.length);
    assert.equal(actual.terminalRestored, true);
    assert.equal(await fs.readFile(file, 'utf8'), raw);
    const reopened = await openController({ installationHome: home });
    try {
        assert.equal(reopened.listConversations().length, 1);
        assert.equal(reopened.getConversationModelChoice(reopened.listConversations()[0].conversationId).kind, 'unbound');
        assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM works').n, 0);
    }
    finally {
        await reopened.close();
    }
});
