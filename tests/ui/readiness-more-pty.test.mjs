import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const paste = value => '\x1b[200~' + value + '\x1b[201~';
const variants = [
    { locale: 'en_US.UTF-8', current: 'Setup and next actions', more: 'More settings and details',
        details: 'More settings and details · current and saved configuration', back: 'Back to current setup',
        return: 'Return to request', future: 'Future application default', language: 'Reply language',
        bridge: 'Active bridge', savedBridge: 'Next-launch bridge', repo: 'Repository management', model: 'Current model' },
    { locale: 'ko_KR.UTF-8', current: '설정과 다음 동작', more: '추가 설정과 상세 정보',
        details: '추가 설정과 상세 정보 · 현재 설정과 저장된 설정', back: '현재 설정으로 돌아가기',
        return: '요청으로 돌아가기', future: '새 대화의 기본 모델', language: '대화 언어',
        bridge: '현재 브리지', savedBridge: '다음 실행 시 사용할 브리지', repo: '저장소 관리', model: '현재 모델' },
];

for (const copy of variants) {
    test(`${copy.locale} readiness keeps current setup simple and opens real More actions without changing draft or models`, { timeout: 20000 }, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-ready-more-'))), home = path.join(root, 'home');
        const file = path.join(root, 'terminal.json'), output = path.join(root, 'terminal.output'), observation = path.join(root, 'current.json');
        const provider = 'owned opaque', currentModel = 'current opaque', futureModel = 'future opaque';
        const draft = '  KEEP 한국어 exact readiness request  ';
        let passed = false;
        t.after(async () => {
            if (passed) await fs.rm(root, { recursive: true, force: true });
            else t.diagnostic('Retained readiness More terminal ' + root);
        });
        const setup = path.join(root, 'prepare.mjs');
        await fs.writeFile(setup, `
import {openController} from ${JSON.stringify(new URL('../../dist/controller/index.js', import.meta.url).href)};
import {ApplicationAccounts} from ${JSON.stringify(new URL('../../dist/app/accounts.js', import.meta.url).href)};
import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js', import.meta.url).href)};
const controller=await openController({installationHome:${JSON.stringify(home)}});
try {
 const accounts=ApplicationAccounts.open(controller);
 await accounts.configure({providers:{${JSON.stringify(provider)}:{api:'openai-completions',apiKey:'DUMMY_READINESS_ONLY',baseUrl:'https://unused.invalid/v1',models:[{id:${JSON.stringify(currentModel)}},{id:${JSON.stringify(futureModel)}}]}}});
 await accounts.setDefault(${JSON.stringify(provider)},${JSON.stringify(currentModel)});
 const conversation=await new ApplicationModels(controller).newConversation();
 controller.setConversationView({selectedId:conversation.conversationId});
 await accounts.setDefault(${JSON.stringify(provider)},${JSON.stringify(futureModel)});
} finally {await controller.close();}
`, { mode: 0o600 });
        const env = { PATH: path.dirname(process.execPath), HOME: root, GITJIG_HOME: home, TMPDIR: root,
            LANG: copy.locale, LC_ALL: copy.locale, TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: '' };
        await execute(process.execPath, ['--import', path.resolve('tests/ui/readiness-no-execution.mjs'), setup], { env, timeout: 5000 });
        const settings = path.join(home, 'config/settings.json'), beforeSettings = await fs.readFile(settings);
        const state = (editorFocused, value, contains, send, absent = []) => ({ editorFocused, draft: value, contains, absent, send });
        const primary = send => state(false, draft, [copy.current, copy.model, provider + '/' + currentModel], send,
            [copy.future, copy.language, copy.bridge, copy.savedBridge, provider + '/' + futureModel]);
        const details = send => state(false, draft, [copy.details, copy.future, provider + '/' + futureModel], send);
        const steps = [
            state(true, '', [provider, currentModel], paste(draft) + '\x07t'),
            primary(copy.more + '\r'),
            details(copy.back + '\r'),
            primary(copy.more + '\r'),
            details('\x1b'),
            primary('\x1b'),
            state(true, draft, [provider, currentModel], '\x07t'),
            primary(copy.more + '\r'),
            details(copy.future + '\r'),
            state(false, draft, ['Default model for new conversations', provider + '/' + futureModel], '\x1b'),
            details(copy.repo + '\r'),
            state(false, draft, ['Repository management · owner actions'], '\x1b'),
            details(copy.back + '\r'),
            primary(copy.return + '\r'),
            state(true, draft, [provider, currentModel], '\x07'),
            state(false, draft, [copy.locale.startsWith('ko') ? '명령 · Ctrl+G' : 'Commands · Ctrl+G'], 'q'),
        ];
        await fs.writeFile(file, JSON.stringify({
            command: [process.execPath, '--import', path.resolve('tests/ui/composer-readiness-observer.mjs'), path.resolve('dist/cli/entry.js')],
            env: { ...env, GITJIG_COMPOSER_OBSERVATION: observation }, observation, output, steps,
            database: path.join(home, 'state/controller.sqlite'), expectedFinalDraft: draft,
        }), { mode: 0o600 });
        const result = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/composer-readiness-pty.py', file], {
            timeout: 17000, maxBuffer: 2 ** 20,
        })).stdout);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stages, steps.length);
        assert.equal(result.terminalRestored, true);
        assert.equal(result.retainedDraft, draft);
        assert.deepEqual(await fs.readFile(settings), beforeSettings, 'Cancelled future-default selection must not change saved preferences');
        const snapshots = JSON.parse(await fs.readFile(output + '.frames.json', 'utf8')).snapshots;
        for (const snapshot of snapshots) {
            assert.equal(snapshot.modelChoice.provider, provider);
            assert.equal(snapshot.modelChoice.modelId, currentModel, 'Future-default inspection must not retarget the current model');
        }
        passed = true;
    });
}
