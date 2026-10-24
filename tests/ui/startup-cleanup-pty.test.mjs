import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

test('terminal routes held startup through exact work recovery and explicit request withdrawal', {timeout: 25000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/startup-cleanup-terminal-')));
    const file = path.join(root, 'driver.json');
    const home = path.join(root, 'home');
    const receipt = path.join(root, 'receipt.json');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained startup cleanup terminal ' + root);
    });
    const steps = [
        {wait: 'Blocked: execution or input cleanup is unresolved', send: '/ready\x1b\r'},
        {wait: 'Next step · Inspect original work and cleanup before retrying or withdrawing requests', send: '\r'},
        {wait: 'Work recovery · #W · UNKNOWN', send: 'Review failed startup cleanup\r'},
        {wait: 'Review original startup rejection', send: '\x1b'},
        {wait: 'Confirm original startup cleanup recovery', send: 'Recover this rejected startup\r'},
        {
            wait: 'Next step · Review pending sent requests before starting a task',
            queries: [
                {sql: "SELECT phase,reservation FROM runs WHERE id='R'", rows: [['SETTLED', 'consumed']]},
                {sql: "SELECT state FROM capacity_leases WHERE id='L'", rows: [['RELEASED']]},
                {sql: "SELECT state FROM conversation_inputs WHERE id='I'", rows: [['INITIAL_RESERVED']]},
            ],
            send: '\r',
        },
        {wait: 'Sent requests · retained independently', send: '\r'},
        {wait: 'Original sent request · review before action', send: '\x1b'},
        {wait: 'This exact request · choose explicitly', send: 'Withdraw original request\r'},
        {
            wait: 'No pending sent requests',
            queries: [{sql: "SELECT state FROM conversation_inputs WHERE id='I'", rows: [['CONFLICTED']]}],
            terminate: true,
            send: '',
        },
    ];
    await fs.writeFile(file, JSON.stringify({
        home, receipt,
        command: [process.execPath, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'), path.resolve('tests/ui/startup-cleanup-child.mjs'), file],
        env: {
            PATH: path.dirname(process.execPath), HOME: root, GITJIG_HOME: home,
            TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '',
        },
        steps, timeoutSeconds: 15, gracefulShutdownSeconds: 3,
        database: path.join(home, 'state', 'controller.sqlite'), output: file + '.terminal',
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout: 20000, maxBuffer: 2 ** 20})).stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stages, steps.length);
    assert.equal(result.terminalRestored, true);
    assert.deepEqual(JSON.parse(await fs.readFile(receipt, 'utf8')), {
        work: 'ACTIVE', run: {phase: 'SETTLED', reservation: 'consumed'},
        input: 'CONFLICTED', lease: 'RELEASED', spent: 1, workCount: 1,
    });
    const screen = await fs.readFile(file + '.terminal', 'utf8');
    assert.ok(!screen.includes('Context assignment unavailable; recover original source work cleanup'));
    passed = true;
});
