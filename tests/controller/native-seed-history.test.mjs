import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { openController } from '../../dist/controller/index.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
import { prepareNativeSeed } from '../../dist/controller/native-seed.js';

test('internal native seed reaches actual controller history without fabricated successful work', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/native-seed-')));
    const home = path.join(root, 'app'), state = path.join(home, 'state');
    let controller = await openController({ installationHome: home }), db = new DatabaseSync(path.join(state, 'controller.sqlite'));
    let passed = false;
    t.after(async () => { db.close(); await controller.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained failed seed fixture: ' + root); });
    const sourceView = controller.createConversation(), destinationView = controller.createConversation();
    const directory = path.join(state, 'fixture-source'); await fs.mkdir(directory, { mode: 0o700 });
    // Non-authority native file fixture data: no model turn, run, work, role,
    // review success or production registration is asserted by this setup.
    const source = SessionManager.create(root, directory);
    const setup = source.appendModelChange('fixture', 'not-executed');
    const message = text => ({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
    const first = source.appendMessage(message('retained root'));
    source.appendLabelChange(first, 'bookmark');
    source.appendMessage(message('abandoned branch')); source.branch(first);
    source.appendMessage(message('current source branch'));
    const input = { stateRoot: state, cwd: root, kind: 'fork', destinationId: destinationView.conversationId, source: {
        conversationId: sourceView.conversationId, generation: 0, projectId: null, modelRevision: 0,
        sessionId: source.getSessionId(), historyRef: source.getSessionFile(), checkpoint: await nativeCheckpoint(source.getSessionFile()), selectedLeaf: first,
    } };
    const original = await fs.readFile(source.getSessionFile());
    const receipt = await prepareNativeSeed(input);
    assert.deepEqual(await fs.readFile(source.getSessionFile()), original);
    const texts = manager => manager.getBranch().filter(e => e.type === 'message').map(e => e.message.content[0].text);
    const install = value => {
        db.prepare('UPDATE conversations SET history=? WHERE id=?').run(receipt.destination.historyRef, destinationView.conversationId);
        db.prepare('UPDATE conversation_state SET native_id=?,data=? WHERE conversation=?').run(receipt.destination.sessionId,
            JSON.stringify({ fixtureOnly: 'non-authority native seed history input', ...(value === undefined ? {} : { nativeSeed: value }) }), destinationView.conversationId);
    };
    const history = () => controller.getConversationHistory(destinationView.conversationId);
    install(receipt);
    assert.deepEqual(texts((await history()).sessionManager), ['retained root']);
    assert.equal((await history()).sessionManager.getLabel(first), 'bookmark');
    const destination = SessionManager.open(receipt.destination.historyRef, path.dirname(receipt.destination.historyRef));
    destination.appendMessage(message('later destination fixture'));
    assert.deepEqual(texts((await history()).sessionManager), ['retained root', 'later destination fixture']);
    source.appendMessage(message('later source fixture'));
    assert.deepEqual(texts((await history()).sessionManager), ['retained root', 'later destination fixture']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
    db.close(); await controller.close();
    controller = await openController({ installationHome: home }); db = new DatabaseSync(path.join(state, 'controller.sqlite'));
    assert.deepEqual(texts((await history()).sessionManager), ['retained root', 'later destination fixture']);
    for (const [alter, pattern] of [
        [r => { r.extra = true; }, /Invalid native seed record/],
        [r => { r.source.conversationId = 'missing-source'; }, /source provenance unavailable/],
        [r => { r.destination.conversationId = sourceView.conversationId; }, /identity mismatch/],
        [r => { r.destination.sessionId = 'another-session'; }, /identity mismatch/],
        [r => { r.destination.historyRef = path.join(root, 'outside.jsonl'); }, /identity mismatch/],
        [r => { r.destination.checkpoint.sha256 = '0'.repeat(64); }, /checkpoint identity\/content lost/],
        [r => { r.source.historyRef = path.join(state, 'different-parent.jsonl'); }, /parent session mismatch/],
    ]) {
        const changed = structuredClone(receipt); alter(changed); install(changed); await assert.rejects(history(), pattern);
    }
    for (const malformed of [null, false]) { install(malformed); await assert.rejects(history(), /Invalid native seed record/); }
    install(undefined); await assert.rejects(history(), /checkpoint unavailable/); install(receipt);
    const file = receipt.destination.historyRef, bytes = await fs.readFile(file), backup = file + '.backup';
    await fs.writeFile(file, bytes.toString().replace('retained root', 'modified root'));
    await assert.rejects(history(), /checkpoint identity\/content lost/); await fs.writeFile(file, bytes);
    await fs.rename(file, backup); await fs.symlink(backup, file);
    await assert.rejects(history(), /Unsafe state leaf/); await fs.unlink(file); await fs.rename(backup, file);
    await fs.link(file, backup); await assert.rejects(history(), /Unsafe state leaf/); await fs.unlink(backup);
    await fs.chmod(path.dirname(file), 0o755); await assert.rejects(history(), /owner-only state/); await fs.chmod(path.dirname(file), 0o700);
    await fs.rename(file, backup); await assert.rejects(history(), /ENOENT/); await fs.rename(backup, file);
    const pending = history(); db.prepare('UPDATE conversations SET generation=1 WHERE id=?').run(destinationView.conversationId);
    await assert.rejects(pending, /target changed/); db.prepare('UPDATE conversations SET generation=0 WHERE id=?').run(destinationView.conversationId);
    const archiveDrift = history(); db.prepare('UPDATE conversation_state SET archived=1 WHERE conversation=?').run(destinationView.conversationId);
    await assert.rejects(archiveDrift, /target changed/); db.prepare('UPDATE conversation_state SET archived=0 WHERE conversation=?').run(destinationView.conversationId);
    await controller.archiveConversation({ conversationId: destinationView.conversationId, expectedGeneration: 0 });
    assert.deepEqual(texts((await history()).sessionManager), ['retained root', 'later destination fixture']);
    await controller.restoreConversation({ conversationId: destinationView.conversationId, expectedGeneration: 0 });
    await assert.rejects(prepareNativeSeed(input), /source changed during preparation/);
    const fresh = { ...input, source: { ...input.source, checkpoint: await nativeCheckpoint(source.getSessionFile()) } };
    await assert.rejects(prepareNativeSeed({ ...fresh, source: { ...fresh.source, selectedLeaf: setup } }), /file deferred/);
    await assert.rejects(prepareNativeSeed({ ...fresh, source: { ...fresh.source, selectedLeaf: 'not-present' } }), /leaf unavailable/);
    const oldFile = path.join(directory, 'old-format.jsonl');
    const oldBytes = (await fs.readFile(source.getSessionFile(), 'utf8')).split('\n').map((line, index) => index === 0 ? JSON.stringify({ ...JSON.parse(line), version: 2 }) : line).join('\n');
    await fs.writeFile(oldFile, oldBytes);
    await assert.rejects(prepareNativeSeed({ ...fresh, source: { ...fresh.source, historyRef: oldFile, checkpoint: await nativeCheckpoint(oldFile) } }), /current-format history/);
    assert.equal(await fs.readFile(oldFile, 'utf8'), oldBytes);
    assert.equal(controller.listConversations().length, 2);
    await controller.deleteConversation({ conversationId: sourceView.conversationId, expectedGeneration: 0 });
    assert.deepEqual(texts((await history()).sessionManager), ['retained root', 'later destination fixture']);
    await controller.deleteConversation({ conversationId: destinationView.conversationId, expectedGeneration: 0 });
    assert.deepEqual(texts((await history()).sessionManager), ['retained root', 'later destination fixture']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
    t.diagnostic('Actual controller seed-history consumer; fixture-only native records; no production registration, model calls or normal-run handoff claimed');
    passed = true;
});
