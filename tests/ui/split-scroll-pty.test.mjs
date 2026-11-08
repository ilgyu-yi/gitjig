import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const cli = await fs.realpath(process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js');
const product = path.resolve(path.dirname(cli), '../..');
const load = file => import(pathToFileURL(path.join(product, file)).href);
const [{openController}, {nativeCheckpoint}, {prepareNativeSeed}, {SessionManager}] = await Promise.all([
    load('dist/controller/index.js'), load('dist/controller/history.js'), load('dist/controller/native-seed.js'),
    load('node_modules/@earendil-works/pi-coding-agent/dist/index.js'),
]);

async function seedPane(controller, home, project, label, offset) {
    const {conversationId, generation} = controller.createConversation();
    const directory = path.join(home, 'state', `fixture-${label}`);
    await fs.mkdir(directory, {mode: 0o700});
    const manager = SessionManager.create(project, directory);
    manager.appendModelChange('fixture', 'not-executed');
    for (const word of ['OLDER', 'ANCHOR', 'NEWER']) {
        const text = `${label}-${word} `.repeat(100).trim();
        manager.appendMessage({role: 'user', content: [{type: 'text', text}], timestamp: Date.now()});
    }
    const sourceId = controller.createConversation().conversationId;
    const sourceFile = manager.getSessionFile();
    const seed = await prepareNativeSeed({stateRoot: path.join(home, 'state'), cwd: project, kind: 'clone', destinationId: conversationId,
        source: {conversationId: sourceId, generation: 0, projectId: null, modelRevision: 0, sessionId: manager.getSessionId(),
            historyRef: sourceFile, checkpoint: await nativeCheckpoint(sourceFile), selectedLeaf: manager.getLeafId()},
    });
    const {historyRef, sessionId} = seed.destination;
    controller.store.run('UPDATE conversations SET history=? WHERE id=?', historyRef, conversationId);
    controller.store.run('UPDATE conversation_state SET native_id=?,data=? WHERE conversation=?', sessionId,
        JSON.stringify({nativeSeed: seed}), conversationId);
    const storedHistory = await controller.getConversationHistory(conversationId);
    const anchor = storedHistory.sessionManager.getBranch().find(entry => entry.type === 'message' &&
        entry.message.content[0].text.startsWith(`${label}-ANCHOR`));
    assert.ok(anchor, 'the selected anchor must be an original SDK history entry');
    const draft = `${label} draft · 한글`;
    controller.setConversationName({conversationId, expectedGeneration: generation, name: label});
    controller.setDraft({conversationId, expectedRevision: 0, text: draft});
    const scroll = {entryId: anchor.id, offset, followEnd: false};
    controller.setScroll({conversationId, ...scroll});
    return {conversationId, marker: `${label}-ANCHOR`, draft, scroll, historyRef};
}

test('split resize, hidden-companion focus and closing keep both original history positions and drafts', {timeout: 20000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-split-scroll-')));
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic(`Retained split-scroll terminal fixture ${root}`);
    });
    const home = path.join(root, 'home');
    const controller = await openController({installationHome: home});
    let left, right;
    try {
        left = await seedPane(controller, home, root, 'LEFT', 2);
        right = await seedPane(controller, home, root, 'RIGHT', 3);
        controller.setConversationView({selectedId: left.conversationId, secondId: right.conversationId});
    } finally { await controller.close(); }
    const original = await Promise.all([left, right].map(pane => fs.readFile(pane.historyRef)));

    const output = path.join(root, 'screen.terminal'), observation = path.join(root, 'observation.json');
    const probe = path.join(root, 'record-scroll.mjs'), scrollWrites = path.join(root, 'scroll.jsonl');
    const stageFiles = Object.fromEntries(['control', 'narrow', 'expanded', 'close'].map(stage => [stage, path.join(root, stage)]));
    await fs.writeFile(probe, `
import fs from 'node:fs';
import {Controller} from ${JSON.stringify(pathToFileURL(path.join(product, 'dist/controller/controller.js')).href)};
const files = ${JSON.stringify(Object.entries(stageFiles).reverse())};
const save = Controller.prototype.setScroll;
Controller.prototype.setScroll = function (anchor) {
    const receipt = save.call(this, anchor);
    const stage = files.find(([, file]) => fs.existsSync(file))?.[0] ?? 'initial';
    fs.appendFileSync(${JSON.stringify(scrollWrites)}, JSON.stringify({stage, ...anchor}) + '\\n');
    return receipt;
};
`);
    const step = (active, companion, visible, rows, action) => ({wait: 'INPUT',
        frame: {contains: visible.flatMap(pane => [pane.draft, pane.marker.split('-')[0] + '-']), rows,
            excludes: [left, right].filter(pane => !visible.includes(pane)).map(pane => pane.draft),
            selected: active.conversationId, draft: active.draft, editorFocused: true},
        queries: [{sql: 'SELECT selected,second FROM interaction_view', rows: [[active.conversationId, companion?.conversationId ?? null]]}],
        ...action,
    });
    const wide = {columns: 100, rows: 32}, narrow = {columns: 42, rows: 24};
    const swap = '\x07w';
    const steps = [
        step(left, right, [left, right], wide.rows, {wait: 'RIGHT-', send: swap, releaseFile: stageFiles.control}),
        step(right, left, [left, right], wide.rows, {send: swap}),
        step(left, right, [left, right], wide.rows, {resize: narrow, send: '', releaseFile: stageFiles.narrow}),
        step(left, right, [left], narrow.rows, {send: swap}),
        step(right, left, [right], narrow.rows, {send: swap}),
        step(left, right, [left], narrow.rows, {resize: wide, send: '', releaseFile: stageFiles.expanded}),
        step(left, right, [left, right], wide.rows, {send: '\x07s', releaseFile: stageFiles.close}),
        step(left, null, [left], wide.rows, {send: '\x07q'}),
    ];
    const moduleGuard = process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : [];
    const config = path.join(root, 'pty.json');
    await fs.writeFile(config, JSON.stringify({
        command: [process.execPath, ...moduleGuard, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import', path.resolve('tests/ui/inspection-pty-observer.mjs'), '--import', probe, cli, 'conversation', 'ui', '--home', home],
        env: {HOME: root, GITJIG_HOME: home, TMPDIR: root, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
            TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', GITJIG_RESULT_OBSERVATION: observation},
        database: path.join(home, 'state/controller.sqlite'), observation, output, ...wide, timeoutSeconds: 11, steps,
    }));
    const report = JSON.parse((await execute('python3', ['tests/cli/fork-ui-pty.py', config], {timeout: 15000, maxBuffer: 2 ** 20})).stdout);
    assert.deepEqual(report, {exitCode: 0, stages: steps.length, terminalRestored: true, alternateEntered: true, alternateExited: true});
    const frames = await Promise.all(steps.map(async (_, index) => JSON.parse(await fs.readFile(`${output}.frame-${index}.json`, 'utf8'))));
    assert.equal(new Set(frames.map(frame => frame.ledger)).size, 1, 'split navigation must not produce workflow effects');
    assert.deepEqual(await Promise.all([left, right].map(pane => fs.readFile(pane.historyRef))), original);

    const writes = (await fs.readFile(scrollWrites, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const written = (stage, pane) => writes.filter(write => write.stage === stage && write.conversationId === pane.conversationId)
        .map(({entryId, offset, followEnd}) => ({entryId, offset, followEnd}));
    assert.deepEqual(written('narrow', right), [right.scroll], 'a hidden companion focused and left at 42 columns retains its exact original anchor');
    assert.deepEqual(written('control', left), [left.scroll], 'stationary wide control retains left anchor');
    assert.deepEqual(written('control', right), [right.scroll], 'stationary wide control retains right anchor');
    for (const index of [0, 6]) {
        assert.equal(frames[index].frame[0].indexOf('VIEW ·'), 50, `split keeps equal columns at step ${index}`);
    }
    for (const [index, panes] of [[3, [left]], [4, [right]], [6, [left, right]], [7, [left]]]) {
        for (const pane of panes) assert.ok(frames[index].frame.join('\n').includes(pane.marker), `original history visible at step ${index}`);
    }
    const reopened = await openController({installationHome: home});
    try {
        for (const pane of [left, right]) {
            const {scroll, draft} = reopened.inspectConversation(pane.conversationId);
            assert.deepEqual(scroll, pane.scroll, `${pane.marker} anchor survives close and shutdown`);
            assert.equal(draft.text, pane.draft);
        }
    } finally { await reopened.close(); }
    passed = true;
});
