import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { openController } from '../../dist/controller/index.js';
const root = process.argv[2], originalOpen = fs.open, originalOpendir = fs.opendir;
let serial = 0, openHandles = 0, permissionDenial = 'unproven', finalSignal;
const tables = ['sources', 'conversation_inputs', 'works', 'runs', 'conversation_directions'];
const snapshot = c => Object.fromEntries(tables.map(name => [name, c.store.all('SELECT * FROM ' + name + ' ORDER BY rowid')]));
async function world() {
    const n = serial++, home = path.join(root, 'a' + n), project = path.join(root, 'user', 'p' + n), q = path.join(root, 'user', 'q' + n);
    await fs.mkdir(project); await fs.mkdir(q); await fs.writeFile(path.join(project, 'file'), 'ORIGINAL');
    let c = await openController({ installationHome: home }); await c.registerProject({ id: 'P', sourceRoot: project }); await c.registerProject({ id: 'Q', sourceRoot: q });
    const v = c.createConversation({ projectId: 'P' }), cid = v.conversationId;
    const draft = c.setDraft({ conversationId: cid, expectedRevision: 0, text: '@file' });
    return { home, project, q, cid, draft, get c() { return c; }, async reopen() { c = await openController({ installationHome: home }); }, options: { conversationId: cid, expectedGeneration: 0, draftRevision: draft.revision, text: '@file', mode: 'idle' } };
}
// Only actual owned artifact handles are held. The real read, preparation and open occur first.
function holdArtifact(f, afterClose) {
    const entered = Promise.withResolvers(), release = Promise.withResolvers(); let held = false;
    fs.open = async function (name, flags, ...rest) {
        const handle = await originalOpen.call(this, name, flags, ...rest);
        if (typeof name === 'string' && name.startsWith(path.join(f.home, 'state/input-context') + path.sep) && flags === 'wx') {
            openHandles++; const close = handle.close.bind(handle); handle.close = async () => { try { await close(); } finally { openHandles--; afterClose?.(); } };
            if (!held) { held = true; entered.resolve(); await release.promise; }
        }
        return handle;
    };
    return { entered: entered.promise, release: () => release.resolve(), restore: () => { fs.open = originalOpen; } };
}
async function stagedOnly(f) {
    const dirs = await fs.readdir(path.join(f.home, 'state/input-context'));
    assert.ok(dirs.length);
    for (const dir of dirs) assert.match(JSON.parse(await fs.readFile(path.join(f.home, 'state/input-context', dir, 'preparation.json'), 'utf8')).registration, /^unregistered/);
}
for (const kind of ['draft', 'project', 'generation', 'root-corruption', 'caller-abort', 'close', 'pane-only']) {
    const f = await world(), abort = new AbortController(), hold = holdArtifact(f); let closed = false;
    const task = f.c.queueConversationInputWithContext(f.options, abort.signal); const outcome = task.then(value => ({ value }), error => ({ error }));
    try {
        await hold.entered; const before = snapshot(f.c); let expectedDraft = f.c.inspectConversation(f.cid).draft;
        if (kind === 'draft') expectedDraft = f.c.setDraft({ conversationId: f.cid, expectedRevision: f.draft.revision, text: 'NEWER_DRAFT' });
        if (kind === 'project') f.c.setConversationProject({ conversationId: f.cid, projectId: 'Q', expectedGeneration: 0 });
        if (kind === 'generation') f.c.store.run('UPDATE conversations SET generation=generation+1 WHERE id=?', f.cid); // Controlled guard fault, not an executed run.
        if (kind === 'root-corruption') f.c.store.run('UPDATE projects SET root=? WHERE id=?', f.q, 'P'); // Unsupported registry corruption, not public rebind.
        let sibling;
        if (kind === 'pane-only') { sibling = f.c.createConversation({ projectId: 'Q' }); f.c.setConversationView({ selectedId: sibling.conversationId }); }
        const afterAllowed = snapshot(f.c);
        if (kind !== 'project') assert.deepEqual(afterAllowed, before);
        if (kind === 'caller-abort') abort.abort();
        let closeTask, taskSettled = false, storeClosed = false;
        void outcome.then(() => { taskSettled = true; });
        if (kind === 'close') {
            const storeClose = f.c.store.close.bind(f.c.store); f.c.store.close = () => { assert.equal(taskSettled, true); assert.equal(openHandles, 0); storeClosed = true; storeClose(); };
            closeTask = f.c.close().then(() => { closed = true; }); await immediate(); assert.equal(closed, false); assert.equal(storeClosed, false);
            assert.ok(await fs.stat(path.join(f.home, 'state/owner.json')));
        }
        hold.release(); const result = await outcome;
        if (kind === 'pane-only') {
            assert.ok(result.value); assert.equal(f.c.store.one('SELECT conversation FROM conversation_inputs WHERE id=?', result.value.inputId).conversation, f.cid);
            assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=?', sibling.conversationId).n, 0);
        } else assert.ok(result.error, kind + ' must refuse');
        if (closeTask) { await closeTask; assert.equal(storeClosed, true); await assert.rejects(fs.stat(path.join(f.home, 'state/owner.json')), { code: 'ENOENT' }); await f.reopen(); }
        if (kind !== 'pane-only') assert.deepEqual(snapshot(f.c), afterAllowed);
        assert.deepEqual(f.c.inspectConversation(f.cid).draft, { revision: expectedDraft.revision, text: expectedDraft.text });
        await stagedOnly(f); assert.equal(openHandles, 0);
    } finally { hold.release(); hold.restore(); await outcome; await f.c.close(); }
}
// Actual source/parent identities change before post-read checks, not after completed capture.
for (const kind of ['content', 'root-identity', 'parent-identity']) {
    const f = await world(), before = snapshot(f.c); let changed = false;
    if (kind === 'parent-identity') { await fs.mkdir(path.join(f.project, 'dir')); await fs.rename(path.join(f.project, 'file'), path.join(f.project, 'dir/file')); }
    const leaf = path.join(f.project, kind === 'parent-identity' ? 'dir/file' : 'file'), renamed = (kind === 'root-identity' ? f.project : path.dirname(leaf)) + '-old';
    fs.open = async function (name, ...args) {
        const handle = await originalOpen.call(this, name, ...args);
        if (name === leaf) { openHandles++; const read = handle.read.bind(handle), close = handle.close.bind(handle);
            handle.read = async (...params) => { const result = await read(...params); if (!changed) { changed = true; if (kind === 'content') await fs.appendFile(leaf, 'X'); else { const target = kind === 'root-identity' ? f.project : path.dirname(leaf); await fs.rename(target, renamed); await fs.mkdir(target); await fs.writeFile(leaf, 'REPLACEMENT'); } } return result; };
            handle.close = async () => { try { await close(); } finally { openHandles--; } };
        } return handle;
    };
    try { await assert.rejects(f.c.queueConversationInputWithContext({ ...f.options, draftRevision: undefined, text: kind === 'parent-identity' ? '@dir/file' : '@file' })); assert.equal(changed, true); assert.deepEqual(snapshot(f.c), before); assert.equal(openHandles, 0); }
    finally { fs.open = originalOpen; await f.c.close(); }
}
// Completion uses the same ownership collection but its own actual directory task.
for (const kind of ['caller-abort', 'close']) {
    const f = await world(), entered = Promise.withResolvers(), release = Promise.withResolvers(); let dirClosed = false, held = false, settled = false;
    fs.opendir = async (...args) => { const handle = await originalOpendir(...args), read = handle.read.bind(handle), close = handle.close.bind(handle); openHandles++;
        handle.read = async () => { const result = await read(); if (!held) { held = true; entered.resolve(); await release.promise; } return result; };
        handle.close = async () => { try { await close(); } finally { openHandles--; dirClosed = true; } }; return handle; };
    const abort = new AbortController(), task = f.c.completeConversationFiles({ conversationId: f.cid, expectedGeneration: 0, draftRevision: f.draft.revision, prefix: 'fi' }, abort.signal);
    const outcome = task.then(value => ({ value }), error => ({ error })); void outcome.then(() => { settled = true; });
    try {
        await entered.promise; const before = snapshot(f.c); let closeTask, storeClosed = false;
        if (kind === 'close') { const close = f.c.store.close.bind(f.c.store); f.c.store.close = () => { assert.equal(dirClosed, true); assert.equal(settled, true); storeClosed = true; close(); }; closeTask = f.c.close(); await immediate(); assert.equal(storeClosed, false); }
        else abort.abort();
        release.resolve(); assert.ok((await outcome).error); assert.equal(dirClosed, true); assert.equal(openHandles, 0);
        if (closeTask) { await closeTask; await f.reopen(); }
        assert.deepEqual(snapshot(f.c), before); assert.deepEqual(f.c.inspectConversation(f.cid).draft, { revision: f.draft.revision, text: '@file' });
    } finally { release.resolve(); await outcome; fs.opendir = originalOpendir; await f.c.close(); }
}
{
    const f = await world(), agents = path.join(f.project, 'AGENTS.md'); await fs.writeFile(agents, 'PRIVATE_PERMISSION'); await fs.chmod(agents, 0);
    try { let denied = false; try { await fs.readFile(agents); } catch (e) { if (e.code !== 'EACCES') throw e; denied = true; }
        if (denied) { const before = snapshot(f.c); await assert.rejects(f.c.queueConversationInputWithContext(f.options)); assert.deepEqual(snapshot(f.c), before); permissionDenial = 'actual-denial'; }
    } finally { await fs.chmod(agents, 0o600); await f.c.close(); }
}
// Fixed schedule, observation-only enqueue wrapper. Never tune/retry a nondiscriminating result.
{
    const f = await world(), abort = new AbortController();
    const hold = holdArtifact(f, () => queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => abort.abort()))));
    const before = snapshot(f.c), draft = f.c.inspectConversation(f.cid).draft;
    let enqueueAborted = null; const enqueue = f.c.interactions.enqueue.bind(f.c.interactions);
    f.c.interactions.enqueue = (...args) => { enqueueAborted = abort.signal.aborted; return enqueue(...args); };
    const task = f.c.queueConversationInputWithContext(f.options, abort.signal), outcome = task.then(value => ({ value }), error => ({ error }));
    try { await hold.entered; hold.release(); const result = await outcome; await immediate();
        assert.equal(enqueueAborted, true); assert.equal(abort.signal.aborted, true); assert.ok(result.error); assert.equal(result.value, undefined);
        assert.deepEqual(snapshot(f.c), before); assert.deepEqual(f.c.inspectConversation(f.cid).draft, draft); assert.equal(openHandles, 0); await stagedOnly(f);
        finalSignal = { classification: 'refused', enqueueAborted, admitted: !!result.value, callerAborted: abort.signal.aborted, inputs: f.c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n };
    } finally { hold.release(); hold.restore(); await outcome; await f.c.close(); }
}
assert.equal(openHandles, 0);
console.log(JSON.stringify({ outcome: 'passed', requests: 0, openHandles, permissionDenial, finalSignal }));
