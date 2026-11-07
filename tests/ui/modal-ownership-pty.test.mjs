import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {openController} from '../../dist/controller/index.js';

const execute = promisify(execFile);
const paste = text => '\x1b[200~' + text + '\x1b[201~';

for (const locale of ['en', 'ko']) for (const entry of ['menu', 'slash']) for (const closeWhileWaiting of [false, true]) {
    test(`${locale} ${entry} readiness identifies its owned wait${closeWhileWaiting ? ' and joins it before exit' : ' until returning to the composer'}`, { timeout: 20000 }, async t => {
        const root = await temporaryDirectory('modal-ownership');
        const home = path.join(root, 'home'), observation = path.join(root, 'current.json');
        const file = path.join(root, 'terminal.json'), output = path.join(root, 'terminal.output'), gate = path.join(root, 'inspect-gate');
        let passed = false;
        t.after(async () => {
            if (passed) await fs.rm(root, { recursive: true, force: true });
            else t.diagnostic('Retained modal ownership terminal ' + root);
        });
        const c = await openController({installationHome: home});
        let cid;
        try {
            cid = c.createConversation().conversationId;
            c.setConversationName({conversationId: cid, expectedGeneration: 0, name: 'WAIT_SOURCE'});
        } finally { await c.close(); }
        const copy = locale === 'ko' ? {
            setup: '설정과 다음 동작', needed: '설정 필요', guide: '시작 안내', first: '첫 요청 전달하기',
            working: '처리 중 · ', kept: '작성한 요청은 보존됩니다', source: '요청한 대화 · ',
            closing: 'Gitjig 종료 중', commands: '명령 · Ctrl+G',
        } : {
            setup: 'Setup and next actions', needed: 'Setup needed', guide: 'Getting started', first: 'Give your first request',
            working: 'Working · ', kept: 'Your request is kept', source: 'From conversation · ',
            closing: 'Closing Gitjig', commands: 'Commands · Ctrl+G',
        };
        const request = entry === 'menu' ? '  KEEP 한국어 exact owner request  ' : '/ㄱㄷㅁㅇㅛ';
        const action = entry === 'menu' ? copy.setup : '/ready';
        const state = (editorFocused, draft, contains, send, extra = {}) => ({ editorFocused, draft, contains, send, ...extra });
        const waiting = (send, extra) => state(false, request, [copy.working + action, copy.source + 'WAIT_SOURCE · ' + cid, copy.kept], send, {
            absent: [copy.commands, copy.first, 'TYPE_PROBE', 'AFTER_CLOSE'], ...extra,
        });
        const steps = [
            state(true, '', [copy.needed], paste(request)),
            state(true, request, [copy.needed], entry === 'menu' ? '\x07t' : '\x1b\r'),
            state(false, request, [copy.setup], copy.guide + '\r'),
            state(false, request, [copy.first], '\x1b', { writeFile: gate }),
            waiting(paste('TYPE_PROBE') + '\x07'),
            waiting(closeWhileWaiting ? '\x04' : '', closeWhileWaiting ? undefined : { writeFile: gate + '.release' }),
            ...(closeWhileWaiting ? [
                state(false, request, [copy.closing], paste('AFTER_CLOSE') + '\r'),
                state(false, request, [copy.closing], '', { writeFile: gate + '.release' }),
            ] : [
                state(false, request, [copy.setup], '\x1b'),
                state(true, request, [copy.needed], '\x07'),
                state(false, request, [copy.commands], 'q'),
            ]),
        ];
        await fs.writeFile(file, JSON.stringify({
            command: [process.execPath, '--import', path.resolve('tests/ui/modal-ownership-delay.mjs'), path.resolve('dist/cli/entry.js'), 'conversation', 'ui', '--home', home, '--conversation', cid],
            env: {
                PATH: path.dirname(process.execPath), HOME: root, GITJIG_HOME: home, TMPDIR: root,
                GITJIG_COMPOSER_OBSERVATION: observation, GITJIG_MODAL_GATE: gate,
                LANG: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', LC_ALL: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: '',
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
        assert.equal(await fs.readFile(gate + '.entered', 'utf8'), 'original startup inspection held');
        assert.equal(await fs.readFile(gate + '.settled', 'utf8'), 'original startup inspection released');
        passed = true;
    });
}
