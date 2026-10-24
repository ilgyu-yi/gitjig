import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { criteriaWorld } from '../controller/criteria-refresh-fixture.mjs';
import { uiText } from '../../dist/ui/i18n.js';

for (const locale of ['en', 'ko']) test('original ' + locale + ' terminal reviews workflow-rule changes, keeps default Back and explicitly adopts without execution', { timeout: 25000 }, async t => {
    const f = await criteriaWorld(t), home = path.join(f.root, 'home'), draft = 'KEEP exact owner 한국어 draft';
    const reason = locale === 'ko' ? '명시적인 소유자 검토 사유 '.repeat(90) : 'Owner reviews exact installed workflow rules';
    f.c.setConversationLanguage({ conversationId: f.target, expectedGeneration: 0, expectedRevision: 0, replyLanguage: locale });
    f.c.setDraft({ conversationId: f.target, expectedRevision: 0, text: draft });
    await f.change(); const reviewed = f.snapshot(), before = f.ledger();
    await f.c.close();
    const noExecution = [
        { sql: 'SELECT COUNT(*) FROM runs', rows: [[before.runs.length]] },
        { sql: 'SELECT COUNT(*) FROM conversation_inputs', rows: [[0]] },
        { sql: 'SELECT COUNT(*) FROM effect_operations', rows: [[0]] },
        { sql: 'SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage=? ORDER BY kind', params: [f.workId], rows: before.budgets.filter(row => row.lineage === f.workId).sort((a, b) => a.kind.localeCompare(b.kind)).map(row => [row.kind, row.lim, row.consumed, row.reserved]) },
        { sql: 'SELECT state,revision,data FROM goals WHERE id=?', params: [f.goalId], rows: before.goals.filter(row => row.id === f.goalId).map(row => [row.state, row.revision, row.data]) },
    ];
    const old = [{ sql: 'SELECT epoch FROM works WHERE id=?', params: [f.workId], rows: [[reviewed.epoch]] },
        { sql: "SELECT json_extract(data,'$.contractsVersion') FROM change_state WHERE work=?", params: [f.workId], rows: [[reviewed.fromContractsVersion]] }];
    const route = () => [
        { wait: draft, assertDraft: draft, send: '\x07r' },
        { wait: uiText(locale, 'result.title') + ' · all projects', send: 'Preserve original project purpose\r' },
        { wait: uiText(locale, 'result.attention'), send: '\x1b' },
        { wait: uiText(locale, 'result.nextTitle'), assertDraft: draft, send: uiText(locale, 'result.recovery') + '\r' },
        { wait: 'Work recovery', assertDraft: draft, send: uiText(locale, 'criteria.entry') + '\r' },
        { wait: uiText(locale, 'criteria.title'), send: '\x1b' },
    ];
    const steps = [
        ...route(),
        { wait: uiText(locale, 'criteria.reviewAdoption'), send: uiText(locale, 'criteria.reviewAdoption') + '\r' },
        { wait: uiText(locale, 'criteria.reason'), send: 'Owner backs out of reviewed update\r' },
        { wait: uiText(locale, 'criteria.adopt'), queries: [...noExecution, ...old], assertDraft: draft, send: '\r' },
        ...route(),
        { wait: uiText(locale, 'criteria.reviewAdoption'), send: uiText(locale, 'criteria.reviewAdoption') + '\r' },
        { wait: uiText(locale, 'criteria.reason'), send: reason + '\r' },
        { wait: uiText(locale, 'criteria.adopt'), queries: [...noExecution, ...old], assertDraft: draft, send: uiText(locale, 'criteria.adopt') + '\r' },
        { wait: uiText(locale, 'criteria.saved'), queries: [...noExecution,
            { sql: 'SELECT epoch FROM works WHERE id=?', params: [f.workId], rows: [[reviewed.epoch + 1]] },
            { sql: 'SELECT phase FROM change_state WHERE work=?', params: [f.workId], rows: [['BASE_CAPTURED']] },
            { sql: "SELECT COUNT(*) FROM change_versions WHERE work=? AND kind='contracts' AND predecessor=? AND hash=?", params: [f.workId, reviewed.fromContractsVersion, reviewed.currentHash], rows: [[1]] },
            { sql: "SELECT raw FROM sources WHERE json_extract(origin,'$.kind')='owner-criteria-refresh'", rows: [[reason]] }], assertDraft: draft, send: '\x07q' },
    ];
    const file = path.join(f.root, 'criteria-pty.json'), output = file + '.terminal';
    await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'), path.join(f.payload, 'dist/cli/entry.js'), 'conversation', 'ui', '--home', home, '--conversation', f.target],
        cwd: f.root, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: f.root, USER: 'fixture', LOGNAME: 'fixture', TERM: 'xterm-256color', LANG: 'C.UTF-8', TMPDIR: path.join(home, 'artifacts') },
        steps, timeoutSeconds: 18, gracefulShutdownSeconds: 3, database: path.join(home, 'state/controller.sqlite'), expectedInputs: 0, output }), { mode: 0o600 });
    try {
        const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], { timeout: 22000, maxBuffer: 2 ** 20 })).stdout);
        assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
        assert.equal(result.alternateExited, true); f.pass();
    } catch (error) { t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-6500)); throw error; }
});
