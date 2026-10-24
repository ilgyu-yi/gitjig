import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';

const execute = promisify(execFile);
const packageRoot = path.resolve(process.env.GITJIG_TEST_PACKAGE_ROOT ?? '.');
const cliEntry = process.env.GITJIG_TEST_CLI_ENTRY ?? path.join(packageRoot, 'dist/cli/entry.js');
const locales = {
    en: {
        title: 'Claude Code connection', discover: 'Find native Claude Code clients',
        changeRoute: 'Choose another login source', check: 'Check native login',
        account: 'Native login check', review: 'Review connection',
        reviewTitle: 'Review Claude Code connection', connect: 'Connect · save for next launch',
        next: 'Connection saved · next action', restart: 'Show close and relaunch instructions',
        close: 'Return to conversation',
    },
    ko: {
        title: 'Claude Code 연결', discover: 'Claude Code 클라이언트 찾기',
        changeRoute: '다른 로그인 경로 선택', check: '네이티브 로그인 확인',
        account: '네이티브 로그인 확인 결과', review: '연결 내용 검토',
        reviewTitle: 'Claude Code 연결 검토', connect: '연결 · 다음 실행 설정 저장',
        next: '연결 저장됨 · 다음 단계', restart: '종료 후 다시 실행하는 방법 보기',
        close: '대화로 돌아가기',
    },
};

for (const [locale, copy] of Object.entries(locales)) {
    test('original ' + locale + ' terminal connects an owned native fixture using pre-projection operator HOME', {timeout: 25000}, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-guided-bridge-ui-')));
        const home = path.join(root, 'application'), operator = path.join(root, 'operator');
        const executable = path.join(root, 'bin/claude'), nativeLog = path.join(root, 'native.jsonl');
        const profile = path.join(root, 'terminal.json'), output = profile + '.terminal';
        let passed = false;
        t.after(async () => {
            if (passed) await fs.rm(root, {recursive: true, force: true});
            else t.diagnostic('Retained guided bridge terminal ' + root);
        });
        for (const name of ['bin', 'operator', 'operator/.claude', 'old-host', 'old-agent', 'old-agent/home', 'old-account'])
            await fs.mkdir(path.join(root, name), {mode: 0o700});
        const secret = 'PRIVATE_NATIVE_ACCOUNT_CONTENT_MUST_NOT_APPEAR';
        await fs.writeFile(path.join(operator, '.claude/private-token'), secret, {mode: 0o600});
        const authArguments = ['--setting-sources', '', '--settings', JSON.stringify({
            disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false,
            enabledPlugins: {'agents-md@builtin': false, 'bento-slides@bento': false, 'drop@drop': false, 'plugin-authoring@builtin': false},
        }), 'auth', 'status', '--json'];
        const account = {loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'fixture@example.invalid', orgId: 'org_fixture', orgName: 'Fixture Org', subscriptionType: 'team'};
        const nativeWorker = path.join(root, 'native-fixture.cjs');
        await fs.writeFile(nativeWorker,
            'const fs=require("node:fs");const args=process.argv.slice(2);' +
            'fs.appendFileSync(' + JSON.stringify(nativeLog) + ',JSON.stringify({args,home:process.env.HOME,config:process.env.CLAUDE_CONFIG_DIR})+"\\n",{mode:0o600});' +
            'if(args.length===1&&args[0]==="--version")console.log("2.1.0 (Claude Code)");' +
            'else if(JSON.stringify(args)===' + JSON.stringify(JSON.stringify(authArguments)) + ')console.log(' + JSON.stringify(JSON.stringify(account)) + ');' +
            'else process.exitCode=81;\n', {mode: 0o700});
        const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
        await fs.writeFile(executable, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(nativeWorker) + ' "$@"\n', {mode: 0o700});
        const policy = '{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}';
        await fs.writeFile(path.join(root, 'old-agent/claude-bridge.json'), policy, {mode: 0o600});
        const controller = await openController({installationHome: home});
        try {
            await ApplicationStartup.open(controller).save({version: 1, bridge: {
                profile: {kind: 'installed-claude-bridge', cwd: path.join(root, 'old-host'), agentDir: path.join(root, 'old-agent'), executable: {file: executable, sha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},
                nativeAccountDirectory: path.join(root, 'old-account'),
            }});
        }
        finally { await controller.close(); }
        // Deny all native commands except this owned finite fixture, and deny network.
        const boundary = path.join(root, 'native-boundary.mjs');
        await fs.writeFile(boundary, 'import ' + JSON.stringify(pathToFileURL(path.resolve('tests/cli/account-ui-no-network.mjs')).href) + ';\n' +
            'import cp from "node:child_process";import {syncBuiltinESMExports} from "node:module";\n' +
            'const original=cp.spawn;let denied=0;const deny=()=>{denied++;throw Error("Unexpected native command during guided connection");};\n' +
            'cp.spawn=(file,args,options)=>file===' + JSON.stringify(executable) + '?original(file,args,options):deny();\n' +
            'for(const name of ["spawnSync","exec","execSync","execFile","execFileSync","fork"])cp[name]=deny;syncBuiltinESMExports();process.on("exit",()=>{if(denied)process.exitCode=82;});\n', {mode: 0o600});
        const empty = [{sql: 'SELECT COUNT(*) FROM works', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM runs', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM conversation_inputs', rows: [[0]]}];
        const steps = [
            {wait: '/ready', send: '/bridge\x1b\r'},
            {wait: copy.title, send: '\x1b'},
            {wait: copy.discover, send: copy.discover + '\r'},
            {wait: copy.changeRoute, send: copy.changeRoute + '\r'},
            {wait: 'Current operator home', send: 'Current operator home\r'},
            {wait: copy.check, send: copy.check + '\r'},
            {wait: copy.account, send: '\x1b'},
            {wait: copy.review, send: copy.review + '\r'},
            {wait: copy.reviewTitle, send: '\x1b'},
            {wait: copy.connect, queries: empty, send: copy.connect + '\r'},
            {wait: copy.next, send: copy.restart + '\r'},
            {wait: '--conversation', queries: empty, send: '\x1b'},
            {wait: copy.next, send: copy.close + '\r'},
            {wait: '/ready', queries: empty, assertDraft: '', send: '/quit\x1b\r'},
        ];
        await fs.writeFile(profile, JSON.stringify({command: [process.execPath, '--import', boundary, cliEntry],
            env: {PATH: path.dirname(executable) + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: operator, USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture', GITJIG_HOME: home, TMPDIR: root, TERM: 'xterm-256color', LANG: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', LC_ALL: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', SHELL: '/bin/sh', NODE_OPTIONS: '', NODE_PATH: ''},
            steps, timeoutSeconds: 15, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output, gracefulShutdownSeconds: 3}));
        try {
            const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', profile], {timeout: 20000, maxBuffer: 2 ** 20})).stdout);
            assert.equal(result.exitCode, 0);
            assert.equal(result.stages, steps.length);
            assert.equal(result.terminalRestored, true);
            const terminal = await fs.readFile(output, 'utf8');
            assert.doesNotMatch(terminal, new RegExp(secret));
            assert.match(terminal, /fixture@example\.invalid/u);
            const startup = JSON.parse(await fs.readFile(path.join(home, 'config/startup.json'), 'utf8'));
            assert.equal(startup.bridge.nativeAccountHome, operator);
            assert.equal(startup.bridge.nativeAccountDirectory, path.join(operator, '.claude'));
            assert.notEqual(startup.bridge.profile.agentDir, path.join(root, 'old-agent'));
            const native = (await fs.readFile(nativeLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
            const auth = native.filter(row => row.args.includes('auth'));
            assert.ok(auth.every(row => JSON.stringify(row.args) === JSON.stringify(authArguments)));
            assert.equal(auth.length, 2, 'Check and reviewed Connect each recheck the exact native account');
            assert.ok(auth.every(row => row.home === operator && row.config === undefined));
            assert.equal(await fs.readFile(path.join(operator, '.claude/private-token'), 'utf8'), secret);
            passed = true;
        }
        catch (error) {
            t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-9000));
            throw error;
        }
    });
}
