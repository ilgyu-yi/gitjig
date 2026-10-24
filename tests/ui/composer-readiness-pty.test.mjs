import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const paste = text => '\x1b[200~' + text + '\x1b[201~';
const cases = [
    {
        locale: 'en_US.UTF-8',
        request: '  Fix the failing test · preserve my exact request  ',
        setupBlocked: 'Setup needed · use the command menu to inspect',
        needed: 'Setup needed · Enter for options · request kept',
        ready: 'Ready · Enter send',
        repair: 'Request not sent · your text is kept',
        back: '\x1b',
        setup: 'Open setup',
        overview: 'Setup and next actions',
        hiddenSetup: ['Future application default', 'Reply language', 'Active bridge', 'Next-launch bridge'],
        menu: 'Commands · Ctrl+G',
        leave: 'Ctrl+G q leave',
    },
    {
        locale: 'ko_KR.UTF-8',
        request: '  한국어 요청을 그대로 보존하고 고쳐 주세요  ',
        setupBlocked: '설정 필요 · 명령 메뉴에서 확인하세요',
        needed: '설정 필요 · Enter로 선택 · 요청 보존',
        ready: '입력 대기 · Enter 전송',
        repair: '요청을 보내지 않았습니다 · 작성한 내용은 보존됩니다',
        back: '요청으로 돌아가기\r',
        setup: '설정 열기',
        overview: '설정과 다음 동작',
        hiddenSetup: ['새 대화의 기본 모델', '대화 언어', '현재 브리지', '다음 실행 시 사용할 브리지'],
        menu: '명령 · Ctrl+G',
        leave: 'Ctrl+G q 종료',
    },
];

for (const scenario of cases) {
    test(`blocked ${scenario.locale} composer repairs setup without losing or sending its request`, { timeout: 20000 }, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-composer-readiness-')));
        const home = path.join(root, 'home'), observation = path.join(root, 'current.json');
        const file = path.join(root, 'terminal.json'), output = path.join(root, 'terminal.output');
        let passed = false;
        t.after(async () => {
            if (passed) await fs.rm(root, { recursive: true, force: true });
            else t.diagnostic('Retained composer readiness terminal ' + root);
        });
        const request = scenario.request, suffix = ' INPUT_OWNER_PROBE';
        const composer = (draft, send) => ({
            editorFocused: true, draft, contains: [scenario.needed, scenario.leave], absent: [scenario.ready], send,
        });
        const emptyComposer = (draft, send) => ({
            editorFocused: true, draft, contains: [scenario.setupBlocked, scenario.leave], absent: [scenario.ready, scenario.needed, scenario.repair], send,
        });
        const steps = [
            emptyComposer('', '\r'),
            emptyComposer('', paste('   ')),
            emptyComposer('   ', '\r'),
            emptyComposer('   ', '\x15' + paste(request)),
            composer(request, '\r'),
            { editorFocused: false, draft: request, contains: [scenario.repair, scenario.setup], send: scenario.back },
            composer(request, paste(suffix)),
            composer(request + suffix, '\x15' + paste(request)),
            composer(request, '\r'),
            { editorFocused: false, draft: request, contains: [scenario.repair, scenario.setup], send: scenario.setup + '\r' },
            { editorFocused: false, draft: request, contains: [scenario.overview], absent: scenario.hiddenSetup, send: '\x1b' },
            composer(request, paste(suffix)),
            composer(request + suffix, '\x15'),
            emptyComposer('', paste(request)),
            composer(request, '\x07'),
            { editorFocused: false, draft: request, contains: [scenario.menu], send: 'q' },
        ];
        await fs.writeFile(file, JSON.stringify({
            command: [process.execPath, '--import', path.resolve('tests/ui/composer-readiness-observer.mjs'), path.resolve('dist/cli/entry.js')],
            env: {
                PATH: path.dirname(process.execPath), HOME: root, GITJIG_HOME: home, TMPDIR: root,
                GITJIG_COMPOSER_OBSERVATION: observation, LANG: scenario.locale, LC_ALL: scenario.locale,
                TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: '',
            },
            observation, output, steps, database: path.join(home, 'state/controller.sqlite'), expectedFinalDraft: request,
        }), { mode: 0o600 });
        const result = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/composer-readiness-pty.py', file], {
            timeout: 17000, maxBuffer: 2 ** 20,
        })).stdout);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stages, steps.length);
        assert.equal(result.terminalRestored, true);
        assert.equal(result.retainedDraft, request);
        const frames = JSON.parse(await fs.readFile(output + '.frames.json', 'utf8'));
        assert.equal(frames.error, null);
        assert.equal(frames.snapshots.length, steps.length);
        passed = true;
    });
}
