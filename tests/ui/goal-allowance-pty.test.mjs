import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const packageRoot = path.resolve(process.env.GITJIG_TEST_PACKAGE_ROOT ?? '.');
const {openController} = await import(pathToFileURL(path.join(packageRoot, 'dist/controller/index.js')));

for (const mode of ['correction','custom','default']) test('original numeric goal entry uses '+mode+' without appending a default', {timeout: 12000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-goal-allowance-ui-')));
    const home = path.join(root, 'application'), file = path.join(root, 'terminal.json');
    let passed = false;
    t.after(async () => {if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained goal allowance terminal ' + root);});
    const controller = await openController({installationHome: home});
    let cid;
    try {
        cid = controller.createConversation().conversationId;
        controller.setConversationLanguage({conversationId: cid, expectedGeneration: 0, expectedRevision: controller.getConversationLanguage(cid).revision, replyLanguage: 'en'});
    } finally {await controller.close();}
    const empty = [{sql: 'SELECT COUNT(*) FROM works', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM runs', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM conversation_inputs', rows: [[0]]}];
    const steps = [
        {wait: '/ready', send: '/goal create\x1b\r'},
        {wait: 'Goal objective', send: 'Retain this exact owner objective\r'},
        {wait: 'Completion criterion 1', send: 'Observe the unchanged acceptance outcome\r'},
        {wait: 'Goal completion criteria', send: 'Use these criteria\r'},
        ...(mode === 'correction' ? [
            {wait: 'Goal turn allowance', send: '1.5\r'},
            {wait: 'Enter a whole number', queries: empty, send: '\x01\x0b6\r'},
        ] : [{wait: 'Goal turn allowance', send: mode === 'custom' ? '12\r' : '\r'}]),
        {wait: 'Goal saved', queries: [...empty,
            {sql: "SELECT state, json_extract(data,'$.objective'),json_extract(data,'$.criteria[0]'),json_extract(data,'$.turnLimit'),json_extract(data,'$.startedAttempts') FROM goals", rows: [['READY','Retain this exact owner objective','Observe the unchanged acceptance outcome',mode === 'custom' ? 12 : mode === 'default' ? 8 : 6,0]]}], send: '\x07q'},
    ];
    await fs.writeFile(file, JSON.stringify({command: [process.env.GITJIG_TEST_NODE ?? process.execPath, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'), process.env.GITJIG_TEST_CLI_ENTRY ?? path.join(packageRoot,'dist/cli/entry.js'), 'conversation','ui','--home',home,'--conversation',cid], cwd: root,
        env: {PATH:'/usr/bin:/bin',HOME:root,USER:'fixture',LOGNAME:'fixture',LANG:'en_US.UTF-8',TERM:'xterm-256color',TMPDIR:path.join(home,'artifacts')}, steps, timeoutSeconds:8, gracefulShutdownSeconds:3, database:path.join(home,'state/controller.sqlite'), output:file+'.terminal'}),{mode:0o600});
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    passed = true;
});
