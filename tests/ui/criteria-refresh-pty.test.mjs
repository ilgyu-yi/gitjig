import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { criteriaWorld } from '../controller/criteria-refresh-fixture.mjs';
import { uiText } from '../../dist/ui/i18n.js';
import { workAllowanceText } from '../../dist/ui/work-allowance-presentation.js';

for (const locale of ['en', 'ko']) test('original ' + locale + ' terminal reviews workflow-rule changes, keeps default Back and explicitly adopts without execution', { timeout: 25000 }, async t => {
    const f = await criteriaWorld(t), home = path.join(f.root, 'home'), draft = 'KEEP exact owner 한국어 draft';
    const reason = locale === 'ko' ? '명시적인 소유자 검토 사유 '.repeat(90) : 'Owner reviews exact installed workflow rules';
    f.c.setConversationLanguage({ conversationId: f.target, expectedGeneration: 0, expectedRevision: 0, replyLanguage: locale });
    f.c.setDraft({ conversationId: f.target, expectedRevision: 0, text: draft });
    const exhausted = locale === 'ko';
    if (exhausted) f.c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='resolution'",f.workId);
    await f.change(); const reviewed = f.snapshot(), before = f.ledger();
    const zero = exhausted ? workAllowanceText(locale,'resolution',reviewed.sharedAllowance.resolution) : undefined;
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
    const catalogue = uiText(locale, 'result.title') + ' · ' + uiText(locale, 'change.registry.allScope');
    const work = uiText(locale, 'workRecovery.title', {id:f.workId,state:''});
    const route = (advance = true) => [
        { wait: draft, assertDraft: draft, send: '\x07r' },
        { wait: catalogue, send: 'Preserve original project purpose\r' },
        { wait: uiText(locale, 'criteria.recovery.changed'), send: '\r' },
        { wait: work, assertDraft: draft, send: uiText(locale, 'criteria.entry') + '\r' },
        { wait: zero ?? uiText(locale, 'criteria.reviewOptions'), send: advance ? '\r' : '\x1b' },
    ];
    const adopted = { wait: work, queries: [...noExecution,
        { sql: 'SELECT epoch FROM works WHERE id=?', params: [f.workId], rows: [[reviewed.epoch + 1]] },
        { sql: 'SELECT phase FROM change_state WHERE work=?', params: [f.workId], rows: [['BASE_CAPTURED']] },
        { sql: "SELECT COUNT(*) FROM change_versions WHERE work=? AND kind='contracts' AND predecessor=? AND hash=?", params: [f.workId, reviewed.fromContractsVersion, reviewed.currentHash], rows: [[1]] },
        { sql: "SELECT raw FROM sources WHERE json_extract(origin,'$.kind')='owner-criteria-refresh'", rows: [[reason]] }], assertDraft: draft, send: '\x1b' };
    const steps = [
        ...route(false),
        { wait: work, queries: [...noExecution, ...old], assertDraft: draft, send: uiText(locale, 'criteria.entry') + '\r' },
        { wait: uiText(locale, 'criteria.reviewOptions'), send: '\r' },
        { wait: uiText(locale, 'criteria.reviewAdoption'), send: uiText(locale, 'criteria.reviewAdoption') + '\r' },
        { wait: uiText(locale, 'criteria.reason'), send: 'Owner backs out of reviewed update\r' },
        { wait: uiText(locale, 'criteria.adopt'), queries: [...noExecution, ...old], assertDraft: draft, send: '\r' },
        { wait: work, queries: [...noExecution, ...old], assertDraft: draft, send: '\x1b' },
        { wait: uiText(locale, 'result.attention'), assertDraft: draft, send: '\x1b' },
        { wait: catalogue, assertDraft: draft, send: '\x1b' },
        ...route(),
        { wait: uiText(locale, 'criteria.reviewAdoption'), send: uiText(locale, 'criteria.reviewAdoption') + '\r' },
        { wait: uiText(locale, 'criteria.reason'), send: '\x1b[200~' + reason + '\x1b[201~\r' },
        { wait: uiText(locale, 'criteria.adopt'), queries: [...noExecution, ...old], assertDraft: draft, send: uiText(locale, 'criteria.adopt') + '\r' },
        adopted,
        { wait: draft, assertDraft: draft, send: '\x07q' },
    ];
    const file = path.join(f.root, 'criteria-pty.json'), output = file + '.terminal';
    await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'), path.join(f.payload, 'dist/cli/entry.js'), 'conversation', 'ui', '--home', home, '--conversation', f.target],
        cwd: f.root, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: f.root, USER: 'fixture', LOGNAME: 'fixture', TERM: 'xterm-256color', LANG: 'C.UTF-8', TMPDIR: path.join(home, 'artifacts') },
        steps, timeoutSeconds: 18, gracefulShutdownSeconds: 3, database: path.join(home, 'state/controller.sqlite'), expectedInputs: 0, output }), { mode: 0o600 });
    try {
        const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], { timeout: 22000, maxBuffer: 2 ** 20 })).stdout);
        assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
        assert.equal(result.alternateExited, true);
        const terminal = await fs.readFile(output);
        const progress = JSON.parse(await fs.readFile(output + '.progress.json', 'utf8'));
        const view = (step) => terminal.subarray(progress.actionOutputOffsets[step],progress.actionOutputOffsets[step+1]).toString();
        const blocker = uiText(locale,'criteria.recovery.changed');
        assert.ok(view(1).includes(blocker));
        assert.ok(view(2).includes(blocker));
        assert.ok(!view(2).includes(uiText(locale,'workRecovery.resumeRoute',{id:f.workId})));
        const guidance = uiText(locale,'criteria.planningAllowanceHint',{work:f.workId});
        assert.equal(terminal.includes(guidance.slice(0,35)), exhausted);
        const refreshed = view(steps.indexOf(adopted) - 1);
        assert.ok(refreshed.includes(uiText(locale,'criteria.saved')));
        assert.equal(refreshed.includes(uiText(locale,'workRecovery.resumeRoute',{id:f.workId})), !exhausted);
        if (exhausted) assert.ok(refreshed.includes(uiText(locale,'workRecovery.resolution')));
        f.pass();
    } catch (error) { t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-6500)); throw error; }
});
