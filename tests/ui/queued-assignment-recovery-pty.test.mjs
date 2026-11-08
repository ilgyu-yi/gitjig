import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID, createHash} from 'node:crypto';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {openController} from '../../dist/controller/index.js';

for (const locale of ['en', 'ko']) test('original ' + locale + ' terminal reopens an actual unstarted assignment and cancels only that reviewed task', {timeout: 25000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-queued-task-ui-')));
    const receiptFile = path.join(root, 'ready.json'), nonce = randomUUID(); let passed = false;
    const env = {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: root, TMPDIR: root,
        USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture', TERM: 'xterm-256color', LANG: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', LC_ALL: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', NODE_OPTIONS: '', NODE_PATH: ''};
    const worker = spawn(process.execPath, ['--import', path.resolve('tests/ui/readiness-no-execution.mjs'), path.resolve('tests/ui/queued-assignment-recovery-pty-worker.mjs'), receiptFile, nonce], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let tail = ''; worker.stdout.on('data', data => { tail = (tail + data).slice(-4000); }); worker.stderr.on('data', data => { tail = (tail + data).slice(-4000); });
    t.after(async () => {
        if (worker.exitCode === null && worker.signalCode === null) { worker.kill('SIGKILL'); await once(worker, 'exit'); }
        if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained original queued-task UI ' + root + '\n' + tail);
    });
    let receipt;
    for (let count = 0; count < 500; count++) {
        try { receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (worker.exitCode !== null || worker.signalCode !== null) throw Error('Owned queued worker exited before receipt: ' + tail);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(receipt, 'Owned original queued fixture did not become ready');
    assert.equal(receipt.nonce, nonce); assert.equal(receipt.pid, worker.pid);
    assert.ok(receipt.root.startsWith(root + path.sep));
    assert.equal(worker.exitCode, null); assert.equal(worker.signalCode, null);
    const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited;
    assert.equal(worker.signalCode, 'SIGKILL');
    const copy = locale === 'ko' ? {entry: '시작 전 위임 작업 취소 검토', review: '원래 대기 작업 검토', confirm: '시작 전인 이 작업만 취소할까요?', cancel: '시작 전인 이 위임 작업 취소', done: '시작 전 작업 취소됨'}
        : {entry: 'Review cancellation of unstarted delegated task', review: 'Review original queued task', confirm: 'Cancel this exact unstarted task?', cancel: 'Cancel this unstarted delegated task', done: 'Unstarted task cancelled'};
    const config = path.join(root, 'terminal.json'), output = config + '.terminal';
    const original = [{sql: 'SELECT COUNT(*) FROM works', rows: [[receipt.works.length]]}, {sql: 'SELECT COUNT(*) FROM runs', rows: [[receipt.runs.length]]}];
    const steps = [
        {wait: '/ready', send: '/error\x1b\r'},
        {wait: copy.entry, send: copy.entry + '\r'},
        {wait: copy.review, queries: original, send: '\x1b'},
        {wait: copy.confirm, queries: [{sql: 'SELECT state FROM conversation_assignments WHERE id=?', params: [receipt.assignmentId], rows: [['QUEUED']]}], send: copy.cancel + '\r'},
        {wait: copy.done, queries: [...original, {sql: 'SELECT state FROM conversation_assignments WHERE id=?', params: [receipt.assignmentId], rows: [['CANCELLED']]}, {sql: 'SELECT state FROM conversation_inputs WHERE id=?', params: [receipt.inputId], rows: [['CANCELLED']]}], send: '/quit\x1b\r'},
    ];
    await fs.writeFile(config, JSON.stringify({command: [process.execPath, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'), path.resolve('dist/cli/entry.js'), 'conversation', 'ui', '--home', receipt.home, '--conversation', receipt.child], env: {...env, GITJIG_HOME: receipt.home}, steps, timeoutSeconds: 10, database: path.join(receipt.home, 'state/controller.sqlite'), output, gracefulShutdownSeconds: 3}));
    try {
        const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], {timeout: 15000, maxBuffer: 2 ** 20})).stdout);
        assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
        const c = await openController({installationHome: receipt.home});
        try {
            assert.deepEqual(JSON.parse(JSON.stringify(c.store.all('SELECT * FROM works'))), receipt.works);
            assert.deepEqual(JSON.parse(JSON.stringify(c.store.all('SELECT * FROM runs'))), receipt.runs);
            assert.deepEqual(JSON.parse(JSON.stringify(c.store.all('SELECT * FROM budgets ORDER BY rowid'))), receipt.budgets);
            assert.equal(c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?', receipt.assignmentId).state, 'CANCELLED');
            assert.equal(createHash('sha256').update(await fs.readFile(receipt.parentHistory)).digest('hex'), receipt.historySha256);
        } finally { await c.close(); }
        passed = true;
    } catch (error) { t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-7000)); throw error; }
});
