import {offlineSourceInstallation, inventory, checkout, digest} from './offline-source-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

test('fresh npm installation shows EN/KO retained integration status without executing or changing original work', {timeout: 240000}, async t => {
    const fixture = await offlineSourceInstallation(t, 'status');
    const {root,source,prefix,cwd,home,env,run,assertCurrent,command,payload,payloadBefore,cache,invocations} = fixture;
    const guard = path.join(root, 'installed-only.mjs'), driver = path.join(root, 'seed.mjs'), trace = path.join(root, 'loaded.jsonl');
    for (const [from, to] of [['integration-status-guard.mjs', guard], ['integration-status-seed.mjs', driver]]) await fs.copyFile(new URL(from, import.meta.url), to);
    const guarded = {...env, NODE_OPTIONS: '--import=' + pathToFileURL(guard).href, GITJIG_STATUS_PAYLOAD: payload, GITJIG_STATUS_MODE: 'ui', GITJIG_STATUS_TRACE: trace};
    const git = await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY ?? '/opt/homebrew/bin/git');
    const project = path.join(root, 'project'), receiver = path.join(root, 'receiver.git'); await fs.mkdir(project, {mode: 0o700}); await fs.writeFile(path.join(project, 'file.txt'), 'Owned original source\n');
    const gitEnv = {...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'};
    const native = (args, label) => run(git, args, label, {environment: gitEnv});
    await native(['init', '--initial-branch=main', project], 'git-init'); await native(['-C', project, 'add', 'file.txt'], 'git-add');
    await native(['-C', project, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Owned original basis'], 'git-commit');
    const basis = (await native(['-C', project, 'rev-parse', 'HEAD'], 'git-head')).trim();
    await native(['clone', '--bare', '--template=', project, receiver], 'git-clone'); await native(['--git-dir=' + receiver, 'config', '--remove-section', 'remote.origin'], 'git-local-receiver');
    const seedFile = path.join(root, 'seed.json'); await fs.writeFile(seedFile, JSON.stringify({home, project, receiver, basis, git}), {mode: 0o600});
    const seed = JSON.parse(await run(process.execPath, [driver], 'seed', {timeout: 45000,
        environment: {...guarded, GITJIG_STATUS_MODE: 'seed', GITJIG_STATUS_LABEL: 'seed', GITJIG_STATUS_DRIVER: driver, GITJIG_STATUS_SEED: seedFile}}));
    const tables = ['projects', 'sources', 'works', 'runs', 'budgets', 'effect_targets', 'effect_delegations', 'effect_operations', 'effect_receipts', 'change_state', 'change_versions', 'obligations', 'finding_occurrences', 'finding_dispositions', 'conversation_inputs'];
    const domain = () => { const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly: true}); try { return tables.map(name => ({sql: 'SELECT * FROM "' + name + '" ORDER BY rowid', rows: db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all().map(row => Object.values(row))})); } finally { db.close(); } };
    const originalDomain = domain(), projectBefore = await inventory(project), receiverBefore = await inventory(receiver);
    for (const locale of ['en', 'ko']) {
        const ko = locale === 'ko', steps = [
            {wait: ko ? '모델: 선택되지 않음' : 'Model: not selected', send: 'KEEP 한국어\x07t'},
            {wait: ko ? '설정과 다음 동작' : 'Setup and next actions', send: ko ? '추가 설정\r' : 'More settings\r'},
            {wait: ko ? '추가 설정과 상세' : 'More settings and details', send: ko ? '저장소 관리\r' : 'Repository management\r'},
            {wait: 'Repository management · owner actions', send: 'Retained integrations\r'},
        ];
        for (const op of seed.operations) {
            steps.push({wait: ko ? '저장된 통합 요청 · 기록 조회' : 'Retained integrations · recorded facts', queries: originalDomain, send: op.operationId + '\r'},
                {wait: ko ? '원래 통합 요청 · ' : 'Original integration · ', send: ko ? '원래 통합 요청의 상태와 기록 확인\r' : 'Inspect original integration facts\r'},
                {wait: ko ? '원래 통합 요청 · 단계, 전송, 내용 포함 여부' : 'Original integration · phase, transport and containment', queries: originalDomain, send: '\x1b'});
        }
        steps.push({wait: ko ? '저장된 통합 요청 · 기록 조회' : 'Retained integrations · recorded facts', send: ko ? '돌아가기\r' : 'Back\r'},
            {wait: 'Repository management · owner actions', send: 'Close\r'},
            {wait: ko ? '추가 설정과 상세' : 'More settings and details', send: ko ? '요청으로 돌아가기\r' : 'Return to request\r'},
            {wait: 'KEEP 한국어', assertDraft: 'KEEP 한국어', queries: originalDomain, send: '\x15/quit\x1b\r'});
        const file = path.join(root, 'ui-' + locale + '.json'), output = file + '.terminal';
        await fs.writeFile(file, JSON.stringify({command: [command, 'conversation', 'ui', '--conversation', seed.conversations[locale]], cwd,
            env: {...guarded, GITJIG_STATUS_LABEL: 'ui-' + locale}, steps, timeoutSeconds: 15, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output, gracefulShutdownSeconds: 3, noForceKill: true}), {mode: 0o600});
        const result = JSON.parse(await run('/usr/bin/python3', [path.join(checkout, 'tests/cli/fork-ui-pty.py'), file], 'ui-' + locale, {timeout: 20000}));
        assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
        const progress = JSON.parse(await fs.readFile(output + '.progress.json', 'utf8')); assert.equal(progress.forceKilled, false); assert.equal(progress.outputTruncated, false); assert.equal(progress.exitCode, 0);
        const text = await fs.readFile(output, 'utf8');
        for (const required of ko ? ['준비 검토가 필요합니다', '원래 요청의 결과 확인을 검토', '원래 전송 기록을 확인하세요', '전송이 이루어졌을 수 있으나 결과는 불명확'] : ['Preparation review required', 'Next: review the original result check', 'Next: inspect the recorded receiver result and original send facts', 'Handoff may have occurred; result is uncertain']) assert.ok(text.includes(required), locale + ' missing ' + required);
        assert.deepEqual(domain(), originalDomain);
    }
    for (const [label, code] of [
        ['source', 'await import(' + JSON.stringify(pathToFileURL(path.join(checkout, 'src/app/runtime-requirements.js')).href) + ')'],
        ['process', "(await import('node:child_process')).spawn('/usr/bin/true',[])"],
        ['network', "await fetch('https://example.invalid/')"],
    ]) await run(process.execPath, ['--input-type=module', '-e', code], 'deny-' + label, {expected: 1, environment: {...guarded, GITJIG_STATUS_LABEL: 'deny-' + label}});
    const loaded = (await fs.readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    for (const locale of ['en', 'ko']) {
        const events = loaded.filter(row => row.label === 'ui-' + locale); assert.ok(events.length > 20); assert.ok(events.every(row => row.kind === 'module'));
        assert.ok(events.some(row => row.file === path.join(payload, 'dist/ui/integration-presentation.js')));
        assert.ok(events.some(row => row.file.startsWith(path.join(payload, 'node_modules/@earendil-works/'))));
    }
    for (const label of ['source', 'process', 'network']) assert.ok(loaded.some(row => row.label === 'deny-' + label && row.kind === 'denied'));
    assert.deepEqual(await inventory(project), projectBefore); assert.deepEqual(await inventory(receiver), receiverBefore);
    assert.deepEqual(await inventory(payload), payloadBefore); await assertCurrent();
    const receipt = {scope: 'Current public npm installer/private source snapshot; installed EN/KO retained UI over explicitly synthetic historical states. Real owned registration/capture; no model, engine, send, personal installation or universal sandbox claim.',
        root, source, prefix, payload, cache, operations: seed.operations, conversations: seed.conversations, moduleEvents: loaded.length, invocations: invocations.map(({out, err, ...rest}) => rest),
        seedCleanup: seed.cleanup, sourceInputsSha256: digest(await fs.readFile(path.join(root, 'source-inputs.json'))), payloadInventorySha256: digest(JSON.stringify(payloadBefore)),
        guardSha256: digest(await fs.readFile(guard)), driverSha256: digest(await fs.readFile(driver))};
    await fs.writeFile(path.join(root, 'qualification.json'), JSON.stringify(receipt, null, 2), {mode: 0o600});
    t.diagnostic(JSON.stringify({root, receipt: path.join(root, 'qualification.json'), installed: command, moduleEvents: loaded.length})); fixture.pass();
});
