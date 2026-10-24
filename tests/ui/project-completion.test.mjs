import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { projectAutocomplete } from '../../dist/ui/project-autocomplete.js';
import { HostCommands } from '../../dist/ui/host-commands.js';

test('file completion replaces the whole quoted token and retains following text and directory cursor', async () => {
    const candidates = [{ path: 'src/alpha name.txt', directory: false }], notices = [];
    const controller = { inspectConversation: () => ({ projectId: 'P', generation: 0, draft: { revision: 0 } }), completeConversationFiles: async () => ({ paths: candidates, bounded: false }) };
    const provider = projectAutocomplete({ controller, conversationId: 'C', slash: new HostCommands([]).autocomplete, isCurrent: () => true, revision: () => 0, notice: text => notices.push(text) });
    const line = 'inspect @"src/alpha old.txt" tail', col = 'inspect @"src/alpha '.length;
    let result = await provider.getSuggestions([line], 0, col, { signal: new AbortController().signal });
    let applied = provider.applyCompletion([line], 0, col, result.items[0], result.prefix);
    assert.equal(applied.lines[0], 'inspect @"src/alpha name.txt" tail');
    candidates[0] = { path: 'space @name', directory: true };
    result = await provider.getSuggestions(['@space'], 0, 6, { signal: new AbortController().signal });
    applied = provider.applyCompletion(['@space'], 0, 6, result.items[0], result.prefix);
    assert.equal(applied.lines[0], '@"space @name/"'); assert.equal(applied.cursorCol, applied.lines[0].length - 1);
    const inside = '@"space @name/c"';
    result = await provider.getSuggestions([inside], 0, inside.length - 1, { signal: new AbortController().signal });
    assert.ok(result); assert.equal(result.prefix, inside.slice(0, -1));
});

test('actual split project terminal preserves quoted directory continuation and distinct focused project drafts without dispatch', { timeout: 7000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/project-completion-'))), home = path.join(root, 'app'), project = path.join(root, 'project');
    for (const name of ['user', 'tmp', 'project', 'project/src', 'project/many', 'project/space dir', 'other', 'other/dest']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
    await fs.writeFile(path.join(project, 'space dir/c.txt'), 'DIRECTORY_TEXT');
    await fs.writeFile(path.join(root, 'other/dest/목록 문서.txt'), 'OTHER_PROJECT');
    await fs.writeFile(path.join(project, 'src/한 글.txt'), 'TEXT'); await fs.writeFile(path.join(project, 'src/alpha name.txt'), 'TEXT');
    await Promise.all(Array.from({ length: 51 }, (_, i) => fs.writeFile(path.join(project, 'many/f' + String(i).padStart(2, '0')), 'TEXT')));
    let c = await openController({ installationHome: home }); await c.registerProject({ id: 'P', sourceRoot: project }); const view = c.createConversation({ projectId: 'P' });
    await c.registerProject({ id: 'Q', sourceRoot: path.join(root, 'other') }); const second = c.createConversation({ projectId: 'Q' });
    c.setConversationName({ conversationId: second.conversationId, expectedGeneration: 0, name: 'SECOND_PATH' });
    c.setDraft({ conversationId: second.conversationId, expectedRevision: 0, text: 'SIBLING_KEEP' });
    c.setConversationView({ selectedId: view.conversationId, secondId: second.conversationId });
    await fs.unlink(path.join(project, 'many/f50'));
    let bounded = await c.completeConversationFiles({ conversationId: view.conversationId, expectedGeneration: 0, draftRevision: 0, prefix: 'many/f' });
    assert.equal(bounded.paths.length, 50); assert.equal(bounded.bounded, false);
    await fs.writeFile(path.join(project, 'many/f50'), 'TEXT');
    bounded = await c.completeConversationFiles({ conversationId: view.conversationId, expectedGeneration: 0, draftRevision: 0, prefix: 'many/f' });
    assert.equal(bounded.paths.length, 50); assert.equal(bounded.bounded, true); await c.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained completion PTY: ' + root); });
    const config = path.join(root, 'pty.json'), steps = [
        { wait: 'Model: not selected', send: 'inspect @src/한\t' },
        { wait: '한 글.txt', assertDraft: 'inspect @"src/한 글.txt" ', send: '\u0015inspect @"src/alpha old.txt" tail' + '\u001b[D'.repeat(13) + '\t' },
        { wait: 'alpha name.txt', assertDraft: 'inspect @"src/alpha name.txt" tail', send: '\u0005\u0015@space\t' },
        { wait: 'space dir/', assertDraft: '@"space dir/"', send: 'c\t' },
        { wait: 'space dir/c.txt', assertDraft: '@"space dir/c.txt" ', send: '\u0005\u0015@many/f\t' },
        { wait: 'Showing first50 matches', assertDraft: '@many/f', queries: [{ sql: 'SELECT draft FROM conversation_views WHERE conversation=?', params: [second.conversationId], rows: [['SIBLING_KEEP']] }], send: '\u001b\u0005\u0015/resume ' + second.conversationId + '\u001b\r' },
        { wait: 'SIBLING_KEEP', assertDraft: 'SIBLING_KEEP', expectedSelected: second.conversationId, send: '\u0005\u0015@dest/목\t' },
        { wait: '목록 문서.txt', assertDraft: '@"dest/목록 문서.txt" ', expectedSelected: second.conversationId,
            queries: [{ sql: 'SELECT draft FROM conversation_views WHERE conversation=?', params: [view.conversationId], rows: [['']] }], send: '\u0005\u0015/quit\u001b\r' },
    ];
    await fs.writeFile(config, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home, '--conversation', view.conversationId],
        env: { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'tmp'), PATH: path.dirname(process.execPath), TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
        database: path.join(home, 'state/controller.sqlite'), expectedInputs: 0, timeoutSeconds: 3, steps, output: config + '.terminal' }), { mode: 0o600 });
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], { timeout: 4500, maxBuffer: 1024 * 1024 })).stdout);
    assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
    c = await openController({ installationHome: home });
    try { assert.equal(c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n, 0); assert.equal(c.store.one('SELECT COUNT(*) AS n FROM works').n, 0); assert.equal(c.getConversationModelChoice(view.conversationId).kind, 'unbound'); } finally { await c.close(); }
    passed = true;
});

test('cancelled or unfocused public-provider responses cannot insert candidates or publish capped notices', async () => {
    for (const cause of ['abort', 'focus']) {
        let release, entered, current = true; const notices = [], reached = new Promise(resolve => entered = resolve), delayed = new Promise(resolve => release = resolve);
        const controller = { inspectConversation: () => ({ projectId: 'P', generation: 0, draft: { revision: 0 } }),
            completeConversationFiles: async () => { entered(); await delayed; return { paths: [{ path: 'x', directory: false }], bounded: true }; } };
        const provider = projectAutocomplete({ controller, conversationId: 'C', slash: new HostCommands([]).autocomplete, isCurrent: () => current, revision: () => 0, notice: text => notices.push(text) });
        const abort = new AbortController(), pending = provider.getSuggestions(['@x'], 0, 2, { signal: abort.signal }); await reached;
        if (cause === 'abort') abort.abort(); else current = false;
        release(); assert.equal(await pending, null); assert.deepEqual(notices, []);
    }
});
