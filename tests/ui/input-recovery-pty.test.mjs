import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
const execute = promisify(execFile);
test('original terminal shows a failed first send, retains its text and routes readiness to explicit withdrawal', { timeout: 30000 }, async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/input-recovery-')));
    const home = path.join(root, 'home');
    let passed = false;
    t.after(async () => {
        if (passed)
            await fs.rm(root, { recursive: true, force: true });
        else
            t.diagnostic('Retained sent-request terminal ' + root);
    });
    const c = await openController({ installationHome: home });
    const accounts = ApplicationAccounts.open(c);
    await accounts.configure({
        providers: {
            'input-fixture': { api: 'openai-completions', apiKey: 'DUMMY', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixture' }] }
        }
    });
    await accounts.setDefault('input-fixture', 'fixture');
    await new ApplicationModels(c).newConversation();
    await c.close();
    const hold = path.join(root, 'hold-retry');
    const entered = path.join(root, 'retry-entered');
    const release = path.join(root, 'release-retry');
    const guard = path.join(root, 'guard.mjs');
    await fs.writeFile(guard, `import ${JSON.stringify(new URL('./readiness-no-execution.mjs', import.meta.url).href)};\nimport {Capacity} from ${JSON.stringify(new URL('../../dist/controller/capacity.js', import.meta.url).href)};\nCapacity.prototype.acquire=async()=>{throw Error('Controlled startup prerequisite unavailable');};\nimport fs from 'node:fs/promises';import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js', import.meta.url).href)};const original=ApplicationModels.prototype.resolve;ApplicationModels.prototype.resolve=async function(...args){if(await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false)){await fs.unlink(${JSON.stringify(hold)});await fs.writeFile(${JSON.stringify(entered)},'entered');while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));}return original.apply(this,args);};\n`);
    const file = path.join(root, 'driver.json');
    const steps = [
        { wait: '/ready setup', send: 'My original first request\x1b\r' },
        {
            wait: 'Controlled startup prerequisite unavailable',
            waitIdle: true,
            queries: [
                {
                    sql: "SELECT state,text FROM conversation_inputs",
                    rows: [['INITIAL_RESERVED', 'My original first request']]
                }
            ],
            send: '/error\x1b\r'
        },
        { wait: 'Error recovery · choose a next step', send: 'Review retained sent requests\r' },
        { wait: 'Sent requests · retained independently', send: '\r' },
        { wait: 'Original sent request · review before action', send: '\x1b' },
        { wait: 'This exact request · choose explicitly', send: 'Retry original request\r' },
        {
            wait: 'Controlled startup prerequisite unavailable',
            waitIdle: true,
            assertDraft: '',
            expectedInputs: 1,
            queries: [{ sql: 'SELECT COUNT(*) FROM runs', rows: [[2]] }],
            send: '/inputs\x1b\r'
        },
        { wait: 'Sent requests · retained independently', send: '\r' },
        { wait: 'Original sent request · review before action', send: '\x1b' },
        { wait: 'This exact request · choose explicitly', releaseFile: hold, send: 'Retry original request\r' },
        { wait: 'INPUT', waitFiles: [{ path: entered, value: 'entered' }], send: '\x15NEWER exact draft' },
        {
            wait: 'NEWER exact draft',
            assertDraft: 'NEWER exact draft',
            expectedInputs: 1,
            releaseFile: release,
            send: ''
        },
        {
            wait: 'Controlled startup prerequisite unavailable',
            waitIdle: true,
            assertDraft: 'NEWER exact draft',
            expectedInputs: 1,
            queries: [{ sql: 'SELECT COUNT(*) FROM runs', rows: [[3]] }],
            send: '\x15/inputs\x1b\r'
        },
        { wait: 'Sent requests · retained independently', send: '\r' },
        { wait: 'Original sent request · review before action', send: '\x1b' },
        { wait: 'This exact request · choose explicitly', send: 'Withdraw original request\r' },
        {
            wait: 'No pending sent requests',
            queries: [
                { sql: "SELECT state,text FROM conversation_inputs", rows: [['CONFLICTED', 'My original first request']] },
                { sql: 'SELECT COUNT(*) FROM runs', rows: [[3]] }
            ],
            send: '\x15/quit\x1b\r'
        },
    ];
    await fs.writeFile(file, JSON.stringify({
        command: [process.execPath, '--import', guard, 'dist/cli/entry.js'],
        env: {
            ...process.env,
            HOME: root,
            GITJIG_HOME: home,
            TMPDIR: root,
            TERM: 'xterm-256color',
            LANG: 'C.UTF-8',
            NODE_OPTIONS: '',
            NODE_PATH: ''
        },
        steps,
        timeoutSeconds: 18,
        database: path.join(home, 'state/controller.sqlite'),
        output: file + '.terminal',
        gracefulShutdownSeconds: 3
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], { timeout: 23000, maxBuffer: 2 ** 20 })).stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stages, steps.length);
    assert.equal(result.terminalRestored, true);
    const terminal = await fs.readFile(file + '.terminal', 'utf8');
    assert.ok(terminal.includes('Sent request ·'));
    assert.ok(terminal.includes('My original first request'));
    assert.ok(terminal.includes('Controlled startup prerequisite unavailable'));
    const source = path.join(root, 'project');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'hello.txt'), 'owned');
    const setup = await openController({ installationHome: home });
    await setup.registerProject({ id: 'P', sourceRoot: source });
    const projectConversation = await new ApplicationModels(setup).newConversation({ projectId: 'P' });
    await setup.close();
    const missing = path.join(root, 'missing-runtime.json');
    const config = JSON.parse(await fs.readFile(file, 'utf8'));
    config.command.push('conversation', 'ui', '--conversation', projectConversation.conversationId);
    config.output = missing + '.terminal';
    config.steps = [
        { wait: '/ready setup', send: 'Keep my project request\x1b\r' },
        {
            wait: 'Request not sent · your text is kept',
            assertDraft: 'Keep my project request',
            expectedInputs: 1,
            queries: [{ sql: 'SELECT COUNT(*) FROM runs', rows: [[3]] }],
            send: '\x1b'
        },
        { wait: 'Setup needed · Enter for options', assertDraft: 'Keep my project request', expectedInputs: 1, queries: [{ sql: 'SELECT COUNT(*) FROM runs', rows: [[3]] }], send: '\x15/quit\x1b\r' },
    ];
    await fs.writeFile(missing, JSON.stringify(config));
    const refused = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', missing], { timeout: 23000, maxBuffer: 2 ** 20 })).stdout);
    assert.equal(refused.exitCode, 0);
    assert.equal(refused.stages, config.steps.length);
    assert.equal(refused.terminalRestored, true);
    passed = true;
});
