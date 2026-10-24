import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
function entryMessage(mode) {
    switch (mode) {
        case 'model': return 'Blocked: no model selected';
        case 'runtime':
        case 'managed-runtime': return 'Blocked: project runtime is not active';
        case 'account':
        case 'managed-account': return 'Blocked: account missing';
        case 'broken': return 'Blocked: account configuration unavailable';
        default: return 'Model: fixture';
    }
}
function entrySteps(mode, wait, secret) {
    switch (mode) {
        case 'managed-account': return [
            { wait, send: '/ready\r' },
            { wait: 'Next step · Inspect original work model/account prerequisites', send: '\r' },
            {
                wait: 'Account and role-setting changes are currently held',
                queries: [{ sql: 'SELECT COUNT(*) FROM works', rows: [[1]] }],
                terminate: true,
                send: '',
            },
        ];
        case 'ready': return [
            { wait, send: 'Begin working\r' },
            { wait: 'Ready to work with your request.', waitIdle: true, send: '/quit\r' },
        ];
        case 'account': return [
            { wait, send: '/login openai api_key\r' },
            { wait: 'Secret input (hidden)', send: secret + '\r' },
            { wait: 'Account login stored', assertStored: true, send: '/logout openai\r' },
            { wait: 'Blocked: account missing', assertStored: false, send: '/quit\r' },
        ];
        case 'managed-runtime': return [
            { wait, send: '/ready\r' },
            { wait: 'Next step · Prepare the project execution environment', send: '\r' },
            {
                wait: 'Runtime setup · staged',
                queries: [{ sql: 'SELECT COUNT(*) FROM works', rows: [[1]] }],
                terminate: true,
                send: '',
            },
        ];
        default: return [{ wait, send: '/quit\r' }];
    }
}
test('entry explains actual missing settings while an unbound configured conversation accepts a request directly', { timeout: 25000 }, async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/entry-guidance-')));
    let passed = false;
    t.after(async () => {
        if (passed)
            await fs.rm(root, { recursive: true, force: true });
        else
            t.diagnostic('Retained entry guidance ' + root);
    });
    for (const mode of ['model', 'runtime', 'ready', 'account', 'literal', 'broken', 'managed-runtime', 'managed-account']) {
        const home = path.join(root, mode);
        const source = path.join(root, 'source-' + mode);
        const file = path.join(root, mode + '.json');
        const receipt = file + '.receipt';
        await fs.mkdir(source);
        await fs.writeFile(path.join(source, 'hello.txt'), 'owned');
        const secret = 'DUMMY_ACCOUNT_SECRET';
        const steps = entrySteps(mode, entryMessage(mode), secret);
        await fs.writeFile(file, JSON.stringify({
            home,
            source,
            mode,
            receipt,
            secret,
            authFile: path.join(home, 'config/auth.json'),
            command: [
                process.execPath,
                '--import',
                path.resolve('tests/ui/readiness-no-execution.mjs'),
                path.resolve('tests/ui/entry-guidance-child.mjs'),
                file
            ],
            env: {
                PATH: path.dirname(process.execPath),
                HOME: root,
                GITJIG_HOME: home,
                TMPDIR: path.join(home, 'artifacts'),
                TERM: 'xterm-256color',
                LANG: 'C.UTF-8',
                NODE_OPTIONS: '',
                NODE_PATH: ''
            },
            steps,
            timeoutSeconds: 6,
            gracefulShutdownSeconds: 3,
            database: path.join(home, 'state/controller.sqlite'),
            output: file + '.terminal'
        }));
        const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], { timeout: 9500, maxBuffer: 2 ** 20 })).stdout);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stages, steps.length);
        assert.equal(result.terminalRestored, true);
        const actual = JSON.parse(await fs.readFile(receipt, 'utf8'));
        const screen = await fs.readFile(file + '.terminal', 'utf8');
        assert.ok(!screen.includes(secret));
        assert.ok(!screen.includes('DUMMY_LITERAL_SECRET'));
        assert.ok(!screen.includes('PRIVATE_BROKEN_AUTH'));
        if (mode === 'ready') {
            assert.equal(actual.calls, 1);
            assert.equal(actual.works, 1);
            assert.equal(actual.inputs[0].state, 'CONSUMED');
            assert.equal(actual.inputs[0].text, 'Begin working');
            assert.ok(!screen.includes('Blocked:'));
            assert.ok(!screen.includes('Start with /ready'));
            assert.ok(!screen.includes('Setup and next actions'));
        }
        else if (mode === 'literal') {
            assert.equal(actual.calls, 0);
            assert.equal(actual.works, 0);
            assert.ok(!screen.includes('Blocked:'));
            assert.ok(!screen.includes('Start with /ready'));
        }
        else {
            assert.equal(actual.calls, 0);
            assert.equal(actual.works, ['managed-runtime', 'managed-account'].includes(mode) ? 1 : 0);
            assert.ok(screen.includes('/ready'));
            if (mode === 'model')
                assert.ok(screen.includes('/model'));
            if (mode === 'account') {
                assert.equal(actual.accountPresent, false);
                assert.ok(screen.includes('/login openai'));
            }
            if (mode === 'broken')
                assert.ok(screen.includes('/model-repair'));
        }
    }
    passed = true;
});
