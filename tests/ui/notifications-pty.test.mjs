import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {prepareLegacyInputHistory} from '../controller/legacy-input-history-fixture.mjs';
import {recordedResultWorld} from '../controller/recorded-delegated-results-fixture.mjs';
import {writeNotice} from '../../dist/controller/conversation-results.js';
import {openController} from '../../dist/controller/index.js';
import {uiText} from '../../dist/ui/i18n.js';

const execute = promisify(execFile);
const entry = path.resolve(process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js');
const moduleGuard = process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : [];

for (const locale of ['en', 'ko']) for (const scenario of ['malformed sibling', 'publication drift']) {
    test(`actual notifications keep the original receipts across ${scenario} in ${locale}`, {timeout: 20000}, async t => {
        const f = await recordedResultWorld(t), {c, root, home, parent} = f;
        const tr = (key, params) => uiText(locale, key, params);
        const draft = 'Keep this parent draft · 한국어';
        const childDraft = 'Keep this child draft · 별도';
        const child = f.children[0].conversationId;
        const [result] = c.inspectRecordedDelegatedResults(parent).entries;
        assert.equal(result.conversationId, child);
        const notice = c.inspectNotifications(parent).find(row => row.resultId === result.resultId);
        assert.equal(notice.state, 'PENDING');
        for (const [conversationId, text] of [[parent, draft], [child, childDraft]]) {
            const view = c.inspectConversation(conversationId);
            c.setConversationLanguage({conversationId, expectedGeneration: view.generation, expectedRevision: 0, replyLanguage: locale});
            c.setDraft({conversationId, expectedRevision: view.draft.revision, text});
        }
        c.setConversationView({selectedId: parent});
        let malformedNoticeId;
        if (scenario === 'malformed sibling') {
            malformedNoticeId = c.store.tx(() => writeNotice(c.store, parent, {kind: 'parent-changed',
                eventKey: 'owned-malformed-sibling-fixture', conversationId: child}));
            c.store.run('UPDATE conversation_notifications SET data=? WHERE id=?', '{', malformedNoticeId);
        }

        const scratch = await fs.mkdtemp(path.join(root, 'notifications-'));
        const database = path.join(home, 'state/controller.sqlite');
        const file = path.join(scratch, 'notices.json'), output = file + '.terminal';
        const trace = path.join(scratch, 'navigation.json');
        const observation = path.join(scratch, 'frame.json');
        const marker = path.join(scratch, 'publication-changed-during-history');
        const tables = ['works', 'sources', 'runs', 'budgets', 'conversation_inputs', 'conversation_assignments',
            'conversation_directions', 'effect_operations', 'effect_receipts'];
        const snapshot = table => c.store.all('SELECT * FROM ' + table + ' ORDER BY rowid').map(Object.values);
        const workflow = tables.map(table => ({sql: 'SELECT * FROM ' + table + ' ORDER BY rowid', rows: snapshot(table)}));
        const notices = snapshot('conversation_notifications');
        const originalPublications = c.store.all('SELECT * FROM conversation_results ORDER BY rowid');
        const publications = rows => ({sql: 'SELECT * FROM conversation_results ORDER BY rowid', rows});
        const noticeRows = rows => ({sql: 'SELECT * FROM conversation_notifications ORDER BY rowid', rows});
        const unchangedPublications = publications(originalPublications.map(Object.values));
        const affectedPublications = publications(originalPublications.map(row =>
            Object.values(row.id === result.resultId ? {...row, data: '{}'} : row)));
        const parentDraft = {sql: 'SELECT draft FROM conversation_views WHERE conversation=?', params: [parent], rows: [[draft]]};
        const childDraftQuery = {sql: 'SELECT draft FROM conversation_views WHERE conversation=?', params: [child], rows: [[childDraft]]};
        const before = [...workflow, parentDraft, childDraftQuery, noticeRows(notices), unchangedPublications];
        const expectedInputs = snapshot('conversation_inputs').length;
        await c.close();

        const preloads = [...moduleGuard, '--import', path.resolve('tests/ui/navigation-no-execution.mjs'),
            '--import', path.resolve('tests/ui/inspection-pty-observer.mjs')];
        if (scenario === 'publication drift') {
            const held = path.join(scratch, 'change-publication-on-history.mjs');
            const controller = pathToFileURL(path.resolve(path.dirname(entry), '../controller/controller.js')).href;
            await fs.writeFile(held, `
                import assert from 'node:assert/strict';
                import {writeFileSync} from 'node:fs';
                import {Controller} from ${JSON.stringify(controller)};
                const original = Controller.prototype.getConversationHistory;
                let injected = false;
                Controller.prototype.getConversationHistory = async function (id) {
                    const history = await original.call(this, id);
                    if (!injected && id === ${JSON.stringify(child)}) {
                        injected = true;
                        assert.equal(this.store.one('SELECT selected FROM interaction_view').selected, id);
                        assert.equal(this.store.one('SELECT state FROM conversation_notifications WHERE id=?', ${JSON.stringify(notice.id)}).state, 'PENDING');
                        this.store.run('UPDATE conversation_results SET data=? WHERE id=?', '{}', ${JSON.stringify(result.resultId)});
                        writeFileSync(${JSON.stringify(marker)}, 'changed', {mode: 0o600});
                    }
                    return history;
                };
            `);
            preloads.push('--import', held);
        }

        const step = (wait, send, queries = before) => ({wait, send, assertDraft: draft, expectedSelected: parent, queries});
        const steps = [step(draft, '\x1b[15~'), step(tr('notice.title'), '\x1b'),
            step(draft, '\x07/'), step(tr('command.discovery.title').split(' · ')[0], '/notifications\r')];
        if (malformedNoticeId) {
            const unavailable = tr('notice.recordUnavailable'), suffix = '#' + malformedNoticeId.slice(-6);
            steps.push(step(unavailable + ' · ' + suffix, suffix + '\r'), {
                ...step(unavailable, '\x1b[15~'),
                frame: {editorFocused: true, contains: [unavailable], selected: parent},
            });
        }
        steps.push(step(tr('notice.title'), '#' + notice.id.slice(-6) + '\r'));
        if (scenario === 'malformed sibling') {
            const acknowledged = notices.map(row => row[0] === notice.id ? [row[0], row[1], 'ACKNOWLEDGED', row[3]] : row);
            const after = [...workflow, parentDraft, childDraftQuery, noticeRows(acknowledged), unchangedPublications];
            steps.push(
                {wait: tr('notice.resultTitle'), send: '\x1b', expectedSelected: child, assertDraft: childDraft, queries: after},
                {wait: childDraft, send: '\x07q', expectedSelected: child, assertDraft: childDraft, queries: after},
            );
        } else {
            steps.push({wait: tr('notice.changed'), send: '\x07q', waitFiles: [{path: marker, value: 'changed'}],
                queries: [...workflow, parentDraft, childDraftQuery, noticeRows(notices), affectedPublications]});
        }
        await fs.writeFile(file, JSON.stringify({
            command: [process.execPath, ...preloads, entry, 'conversation', 'ui', '--home', home, '--conversation', parent],
            env: {HOME: root, GITJIG_HOME: home, TMPDIR: root, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
                TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '',
                GITJIG_NAVIGATION_RECEIPT: trace, GITJIG_RESULT_OBSERVATION: observation},
            steps, output, observation, database, expectedInputs, columns: 126, rows: 36, timeoutSeconds: 9, noForceKill: true,
        }));
        try {
            const observed = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout: 13500, maxBuffer: 2 ** 20})).stdout);
            assert.deepEqual([observed.exitCode, observed.stages, observed.terminalRestored], [0, steps.length, true]);
            assert.deepEqual(JSON.parse(await fs.readFile(trace, 'utf8')), {process: 0, network: 0, run: 0, model: 0});
            const terminal = await fs.readFile(output, 'utf8');
            if (scenario === 'publication drift')
                assert.ok(!terminal.includes(tr('notice.resultTitle')), 'Stale publication must stay undisplayed');
            f.pass();
        } catch (error) {
            t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-6500));
            throw error;
        } finally {
            const db = new DatabaseSync(database);
            try {
                if (malformedNoticeId)
                    db.prepare('DELETE FROM conversation_notifications WHERE id=?').run(malformedNoticeId);
                else
                    db.prepare('UPDATE conversation_results SET data=? WHERE id=?').run(
                        originalPublications.find(row => row.id === result.resultId).data, result.resultId);
            } finally {
                db.close();
            }
        }
    });
}

test('actual notification keeps an unavailable legacy destination unread', {timeout: 15000}, async t => {
    const root = await temporaryDirectory('legacy-notice'), home = path.join(root, 'app');
    const c = await openController({installationHome: home});
    let passed = false;
    t.after(async () => {
        await c.close();
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained legacy notification terminal: ' + root);
    });
    const {conversationId: child} = await prepareLegacyInputHistory(c, root, home);
    await assert.rejects(c.getConversationHistory(child), /Required native history checkpoint unavailable/);
    const {conversationId: parent} = c.createConversation({projectId: 'P'});
    const parentView = c.inspectConversation(parent), draft = 'Keep original parent draft';
    c.setDraft({conversationId: parent, expectedRevision: parentView.draft.revision, text: draft});
    for (const id of [parent, child])
        c.setConversationLanguage({conversationId: id, expectedGeneration: c.inspectConversation(id).generation,
            expectedRevision: 0, replyLanguage: 'en'});
    c.setConversationView({selectedId: parent});
    const notice = c.store.tx(() => writeNotice(c.store, parent, {
        kind: 'parent-changed', eventKey: 'legacy-history-unavailable', conversationId: child,
    }));
    await c.close();

    const database = path.join(home, 'state/controller.sqlite'), file = path.join(root, 'notices.json');
    const output = file + '.terminal', trace = path.join(root, 'navigation.json');
    const unread = [{sql: 'SELECT state FROM conversation_notifications WHERE id=?', params: [notice], rows: [['PENDING']]}];
    const steps = [
        {wait: draft, send: '\x1b[15~', queries: unread},
        {wait: uiText('en', 'notice.title'), send: '#' + notice.slice(-6) + '\r'},
        {wait: uiText('en', 'input.recoveryLegacyOpen'), expectedSelected: child, send: '\x07q'},
    ];
    await fs.writeFile(file, JSON.stringify({
        command: [process.execPath, ...moduleGuard, '--import', path.resolve('tests/ui/navigation-no-execution.mjs'),
            entry, 'conversation', 'ui', '--home', home, '--conversation', parent],
        env: {HOME: root, GITJIG_HOME: home, TMPDIR: root, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
            TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', GITJIG_NAVIGATION_RECEIPT: trace},
        steps, output, database, expectedInputs: 1, columns: 145, rows: 36, timeoutSeconds: 8, noForceKill: true,
    }));
    const observed = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file],
        {timeout: 13000, maxBuffer: 2 ** 20})).stdout);
    assert.deepEqual([observed.exitCode, observed.stages, observed.terminalRestored], [0, steps.length, true]);
    assert.deepEqual(JSON.parse(await fs.readFile(trace, 'utf8')), {process: 0, network: 0, run: 0, model: 0});
    const db = new DatabaseSync(database, {readOnly: true});
    try {
        assert.equal(db.prepare(unread[0].sql).get(notice).state, 'PENDING');
        assert.equal(db.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(parent).draft, draft);
    } finally {
        db.close();
    }
    passed = true;
});
