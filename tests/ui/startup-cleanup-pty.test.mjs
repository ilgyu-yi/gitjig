import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createStartupCleanupFixture } from '../controller/startup-cleanup-fixture.mjs';
import { translator } from '../../dist/ui/i18n.js';

const execute = promisify(execFile);

for (const locale of ['en', 'ko']) test(`unknown execution guides project recovery before reserved input in ${locale}`, {timeout: 20000}, async t => {
    const root = await temporaryDirectory('project-unknown-execution');
    const file = path.join(root, 'driver.json'), home = path.join(root, 'home');
    const fixture = await createStartupCleanupFixture(t, home);
    const legacy = locale === 'ko';
    if (legacy) {
        fixture.store.run("UPDATE works SET state='QUARANTINED' WHERE id='W'");
        const {context, dockerConfigDirectory} = fixture.journal;
        const digest = createHash('sha256').update(context).digest('hex');
        const metadata = path.join(dockerConfigDirectory, 'contexts/meta', digest, 'meta.json');
        const stderr = `Failed to initialize: unable to resolve docker endpoint: context "${context}": context not found: open ${metadata}: no such file or directory\n`;
        const error = `Error: scope create uncertain/failed; retained ${fixture.journalFile}: ${stderr}`;
        fixture.store.run('UPDATE observations SET data=? WHERE id=?', JSON.stringify({kind:'ordinary-response-unavailable', error}), 'O');
        await fs.writeFile(fixture.journalFile, JSON.stringify({...fixture.journal, createOutcome:{exitCode:1, stdout:'', stderr}}));
    }
    const original = path.join(root, 'P'), destination = path.join(root, 'Q');
    await fs.mkdir(original);
    await fs.mkdir(destination);
    fixture.store.run('UPDATE projects SET root=? WHERE id=?', original, 'P');
    fixture.store.run('INSERT INTO requirements VALUES(?,?,?,?)', 'W', 1, 'Original request', JSON.stringify({status:'unconfirmed'}));
    const controller = fixture.controller(), draft = 'Preserve original cleanup draft';
    await controller.registerProject({id:'Q', sourceRoot:destination});
    controller.setDraft({conversationId:'C', expectedRevision:0, text:draft});
    controller.setConversationView({selectedId:'C'});
    await controller.close();
    const tr = translator(locale);
    const held = locale === 'ko' ? '프로젝트 변경 보류 · 원래 실행 상태를 확인해야 합니다' : 'Project unchanged · the original execution state needs reconciliation';
    const unchanged = [
        {sql: "SELECT project,generation FROM conversations WHERE id='C'", rows: [['P', 2]]},
        {sql: "SELECT draft FROM conversation_views WHERE conversation='C'", rows: [[draft]]},
        {sql: "SELECT phase,reservation FROM runs WHERE id='R'", rows: [['UNKNOWN', 'consumed']]},
        {sql: "SELECT state FROM capacity_leases WHERE id='L'", rows: [['QUARANTINED']]},
        {sql: "SELECT state FROM conversation_inputs WHERE id='I'", rows: [['INITIAL_RESERVED']]},
        {sql: "SELECT consumed FROM budgets WHERE lineage='W' AND kind='execution'", rows: [[1]]},
    ];
    const step = (wait, send) => ({wait, send, queries: unchanged});
    const proof = legacy ? '원래 Docker 실행환경을 찾지 못해' : 'Docker rejecting this exact bind source';
    const steps = [
        step(draft, '\x07j'),
        step(tr('project.title', {project:'P'}), '\x1b[B\r'),
        step(held, tr('error.work', {id:'W'}) + '\r'),
        step(tr('workRecovery.settlementUnconfirmed'), tr('workRecovery.startup') + '\r'),
        step(proof, '\x1b'),
        step(tr('workRecovery.startup'), '\x1b'),
        step(tr('error.title'), tr('error.retryProjectSwitch', {project:'Q'}) + '\r'),
        step(tr('error.projectRetryHeld'), tr('error.independentSelectedProject', {project:'Q'}) + '\r'),
        {...step(tr('newConversation.opened', {project:'Q'}), '\x07q'), assertDraft:'',
            queries:[...unchanged, {sql:'SELECT project FROM conversations c JOIN interaction_view v ON c.id=v.selected', rows:[['Q']]}]},
    ];
    await fs.writeFile(file, JSON.stringify({
        command:[process.execPath, '--import', './tests/ui/readiness-no-execution.mjs', process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js',
            'conversation','ui','--home',home,'--conversation','C'],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
            LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps, expectedInputs:1, timeoutSeconds:12, gracefulShutdownSeconds:3,
        database:path.join(home, 'state/controller.sqlite'), output:file+'.terminal',
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout:18000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stages, steps.length);
    assert.equal(result.terminalRestored, true);
    await fs.rm(root, {recursive:true, force:true});
});

test('terminal routes legacy held startup through exact work recovery and explicit request withdrawal', {timeout: 25000}, async t => {
    const root = await temporaryDirectory('startup-cleanup-terminal');
    const file = path.join(root, 'driver.json');
    const home = path.join(root, 'home');
    const receipt = path.join(root, 'receipt.json');
    const otherJournal = {requested:path.join(root,'another-operation'),ready:path.join(root,'another-journal-ready')};
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained startup cleanup terminal ' + root);
    });
    const steps = [
        {wait: 'Blocked: execution or input cleanup is unresolved', send: '/ready\x1b\r'},
        {wait: 'Next step · Inspect original work and cleanup before retrying or withdrawing requests', send: '\r'},
        {wait: 'Work recovery · #W · QUARANTINED', send: 'Review failed startup cleanup\r'},
        {wait: 'Open confirmation', send: '\x1b'},
        {wait: 'Work recovery · #W · QUARANTINED', send: 'Review failed startup cleanup\r'},
        {wait: 'Open confirmation', mutations: [{sql: "UPDATE budgets SET lim=lim+1 WHERE lineage='W' AND kind='execution'"}], send: '\r'},
        {wait: 'Cleanup evidence changed. Review the current evidence', queries: [
            {sql: "SELECT phase FROM runs WHERE id='R'", rows: [['UNKNOWN']]},
            {sql: "SELECT state FROM capacity_leases WHERE id='L'", rows: [['QUARANTINED']]},
        ], send: 'Review failed startup cleanup\r'},
        {wait: 'Open confirmation', send: '\r'},
        {wait: 'Confirm original startup cleanup recovery', mutations: [{sql: "UPDATE budgets SET lim=lim+1 WHERE lineage='W' AND kind='execution'"}], send: 'Recover this rejected startup\r'},
        {wait: 'Cleanup evidence changed. Review the current evidence', queries: [
            {sql: "SELECT phase,reservation FROM runs WHERE id='R'", rows: [['UNKNOWN','consumed']]},
            {sql: "SELECT state FROM capacity_leases WHERE id='L'", rows: [['QUARANTINED']]},
            {sql: "SELECT state FROM conversation_inputs WHERE id='I'", rows: [['INITIAL_RESERVED']]},
            {sql: "SELECT consumed,reserved FROM budgets WHERE lineage='W' AND kind='execution'", rows: [[1,0]]},
            {sql: "SELECT COUNT(*) FROM sources WHERE json_extract(origin,'$.kind')='owner-startup-cleanup-recovery'", rows: [[0]]},
        ], send: 'Review failed startup cleanup\r'},
        {wait: 'Open confirmation', send: '\r'},
        {wait: 'Confirm original startup cleanup recovery', releaseFile: otherJournal.requested, send: 'Recover this rejected startup'},
        {wait: 'Recover this rejected startup', waitFiles: [{path: otherJournal.ready, value: 'ready'}], send: '\r'},
        {
            wait: 'Next step · Review the original request and its failure',
            queries: [
                {sql: "SELECT phase,reservation FROM runs WHERE id='R'", rows: [['SETTLED', 'consumed']]},
                {sql: "SELECT state FROM capacity_leases WHERE id='L'", rows: [['RELEASED']]},
                {sql: "SELECT state FROM conversation_inputs WHERE id='I'", rows: [['INITIAL_RESERVED']]},
            ],
            send: '\r',
        },
        {wait: 'Open recovery actions', send: '\r'},
        {wait: 'This exact request · choose explicitly', send: 'Withdraw original request\r'},
        {
            wait: 'Request withdrawn',
            queries: [{sql: "SELECT state FROM conversation_inputs WHERE id='I'", rows: [['CONFLICTED']]}],
            terminate: true,
            send: '',
        },
    ];
    await fs.writeFile(file, JSON.stringify({
        home, receipt, otherJournal,
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
