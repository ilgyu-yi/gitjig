import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const paste = text => '\x1b[200~' + text + '\x1b[201~';

for (const closeWhileWaiting of [false, true]) {
    test(`readiness owns input across a held parent read${closeWhileWaiting ? ' and joins it before exit' : ' until returning to the composer'}`, { timeout: 20000 }, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-modal-ownership-')));
        const home = path.join(root, 'home'), observation = path.join(root, 'current.json');
        const file = path.join(root, 'terminal.json'), output = path.join(root, 'terminal.output'), gate = path.join(root, 'inspect-gate');
        let passed = false;
        t.after(async () => {
            if (passed) await fs.rm(root, { recursive: true, force: true });
            else t.diagnostic('Retained modal ownership terminal ' + root);
        });
        const request = '  KEEP 한국어 exact owner request  ';
        const state = (editorFocused, draft, contains, send, extra = {}) => ({ editorFocused, draft, contains, send, ...extra });
        const waiting = (send, extra) => state(false, request, ['Working on your selected action', 'Your request is kept'], send, {
            absent: ['Commands ·', 'Setup and next actions'], ...extra,
        });
        const steps = [
            state(true, '', ['Setup needed'], paste(request)),
            state(true, request, ['Setup needed'], '\x07t'),
            state(false, request, ['Setup and next actions'], 'Getting started\r'),
            state(false, request, ['Give your first request'], '\x1b', { writeFile: gate }),
            waiting(paste('TYPE_PROBE') + '\x07'),
            waiting(closeWhileWaiting ? '\x04' : '', closeWhileWaiting ? undefined : { writeFile: gate + '.release' }),
            ...(closeWhileWaiting ? [
                state(false, request, ['Closing Gitjig'], paste('AFTER_CLOSE') + '\r'),
                state(false, request, ['Closing Gitjig'], '', { writeFile: gate + '.release' }),
            ] : [
                state(false, request, ['Setup and next actions'], '\x1b'),
                state(true, request, ['Setup needed'], '\x07'),
                state(false, request, ['Commands · Ctrl+G'], 'q'),
            ]),
        ];
        await fs.writeFile(file, JSON.stringify({
            command: [process.execPath, '--import', path.resolve('tests/ui/modal-ownership-delay.mjs'), path.resolve('dist/cli/entry.js')],
            env: {
                PATH: path.dirname(process.execPath), HOME: root, GITJIG_HOME: home, TMPDIR: root,
                GITJIG_COMPOSER_OBSERVATION: observation, GITJIG_MODAL_GATE: gate,
                LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: '',
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
