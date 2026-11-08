import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {capture} from '../../dist/controller/capture.js';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';
async function fixture(t) {
    const root = await temporaryDirectory('controller'), source = path.join(root, 'source'), home = path.join(root, 'home');
    const options = { installationHome: home };
    await fs.mkdir(source, { mode: 0o700 });
    await fs.writeFile(path.join(source, 'calc.txt'), '2');
    await fs.writeFile(path.join(source, 'dirty-untracked'), 'retained');
    const controller = await openController(options);
    t.after(async () => {
        await controller.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    await controller.registerProject({ id: 'P', sourceRoot: source });
    return { root, source, home, controller, options };
}
test('offline owned registration, transactional schema, sole writer and stable root binding',async t=>{const f=await fixture(t);assert.equal(f.controller.listProjects()[0].sourceRoot,f.source);await assert.rejects(openController(f.options),e=>e.code==='OWNER_BUSY');await assert.rejects(f.controller.registerProject({id:'P',sourceRoot:f.root}),e=>e.code==='PROJECT_REBIND'||e.code==='PROJECT_ROOT');assert.equal(await fs.readFile(path.join(f.source,'dirty-untracked'),'utf8'),'retained');await assert.rejects(f.controller.runLocalCheck({projectId:'P',command:'true'}),e=>e.code==='MISSING_RUNTIME');const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'));assert.equal(db.prepare('PRAGMA user_version').get().user_version,9);db.close();});
test('bounded private copier detects unsupported and actual bytes; normal result is post-exit',async t=>{const f=await fixture(t);const target=path.join(f.root,'capture');await fs.mkdir(target,{mode:0o700});const job=capture(f.source,target,{maxBytes:1000});const manifest=await job.result;assert.equal(manifest.bytes,9);assert.equal(manifest.passes,2);assert.equal(await fs.readFile(path.join(target,'calc.txt'),'utf8'),'2');assert.equal((await fs.stat(path.join(target,'calc.txt'))).nlink,1);const overflow=path.join(f.root,'overflow');await fs.mkdir(overflow);await assert.rejects(capture(f.source,overflow,{maxBytes:1}).result,/bytes exceed/);await fs.symlink('calc.txt',path.join(f.source,'alias'));const special=path.join(f.root,'special');await fs.mkdir(special);await assert.rejects(capture(f.source,special,{}).result,/unsupported capture entry/);assert.equal(await fs.readFile(path.join(f.source,'calc.txt'),'utf8'),'2');});
test('directory census identity and normalized effective modes are in captured digest',async t=>{const f=await fixture(t);await fs.mkdir(path.join(f.source,'A'));const first=path.join(f.root,'first'),second=path.join(f.root,'second');await fs.mkdir(first);await fs.mkdir(second);const a=await capture(f.source,first,{}).result;await fs.rename(path.join(f.source,'A'),path.join(f.source,'B'));const b=await capture(f.source,second,{}).result;assert.notEqual(a.digest,b.digest);assert.deepEqual(a.directories.map(d=>d.path),['A']);assert.deepEqual(b.directories.map(d=>d.path),['B']);assert.equal(a.files[0].effectiveMode,0o600);});
test('close synchronously refuses new admission and remains idempotent',async t=>{const f=await fixture(t);const closing=f.controller.close();assert.equal(f.controller.close(),closing);await assert.rejects(f.controller.registerProject({id:'later',sourceRoot:f.source}),e=>e.code==='CONTROLLER_CLOSING');await assert.rejects(f.controller.runLocalCheck({projectId:'P',command:'true'}),e=>e.code==='CONTROLLER_CLOSING');await closing;});

const captureRun = (store, request) => store.one(`SELECT r.id,r.work,r.epoch FROM runs r
    JOIN works w ON w.id=r.work JOIN sources s ON s.id=w.source WHERE r.phase='CAPTURING' AND s.raw=?`, request);
async function waitForCapture(store, request) {
    const deadline = Date.now() + 5000;
    for (;;) {
        const run = captureRun(store, request);
        if (run) return run;
        assert.ok(Date.now() < deadline, 'Expected original capture to start');
        await new Promise(resolve => setImmediate(resolve));
    }
}

for (const damaged of [false, true]) test(damaged ? 'startup settles a cancelled capture despite an unreadable unrelated journal' : 'startup preserves a cancellation recorded before the capture process exited', async t => {
    const f = await fixture(t), request = 'Original interrupted capture';
    await f.controller.close();
    if (damaged) await fs.writeFile(path.join(f.home, 'state/runtime', randomUUID() + '.json'), '{', { mode: 0o600 });
    const script = `
        import assert from 'node:assert/strict';
        import { openController } from ${JSON.stringify(new URL('../../dist/controller/index.js', import.meta.url).href)};
        const captureRun = ${captureRun.toString()};
        const waitForCapture = ${waitForCapture.toString()};
        const c = await openController({ installationHome: process.argv[1] });
        const request = process.argv[2];
        const attempt = c.beginChange({ projectId: 'P', request });
        void attempt.catch(() => {});
        const run = await waitForCapture(c.store, request);
        void c.cancelWork({ workId: run.work, expectedEpoch: run.epoch }).catch(() => {});
        assert.equal(c.store.one('SELECT state FROM works WHERE id=?', run.work).state, 'CANCELLED');
        assert.ok(captureRun(c.store, request));
        process.kill(process.pid, 'SIGKILL');
    `;
    await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, f.home, request], { timeout: 10000 }),
        error => error.signal === 'SIGKILL');
    const reopened = await openController(f.options);
    try {
        const state = reopened.store.one(`SELECT w.id,w.state,w.epoch,r.phase,r.data,r.reservation FROM works w
            JOIN sources s ON s.id=w.source JOIN runs r ON r.work=w.id WHERE s.raw=?`, request);
        assert.equal(reopened.inspectWork(state.id).state, 'CANCELLED');
        assert.equal(state.epoch, 2);
        assert.equal(state.phase, 'INTERRUPTED');
        assert.equal(JSON.parse(state.data).cleanup, 'not-allocated');
        assert.notEqual(state.reservation, 'reserved');
    }
    finally { await reopened.close(); }
});

for (const record of ['assignment', 'effect']) test('cancelling a capture is independent of an unreadable unrelated ' + record, async t => {
    const { controller: c } = await fixture(t), s = c.store;
    if (record === 'assignment') {
        const source = c.createConversation().conversationId, target = c.createConversation().conversationId;
        s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', randomUUID(), source, target, null, 'QUEUED', '{');
    }
    else {
        const unrelated = await c.beginChange({ projectId: 'P', request: 'Other task' });
        const target = randomUUID(), grant = randomUUID();
        s.run('INSERT INTO effect_targets VALUES(?,?,?)', target, 'P', '{}');
        s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', grant, unrelated.workId, target, 1, '{}');
        s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', randomUUID(), unrelated.workId, target, grant, 'PREPARED', '{');
    }
    const request = 'Stop this original capture';
    const running = c.beginChange({ projectId: 'P', request });
    void running.catch(() => {});
    const run = await waitForCapture(s, request), signal = c.active.get(run.work).abort.signal;
    try {
        assert.equal((await c.cancelWork({ workId: run.work, expectedEpoch: run.epoch })).state, 'CANCELLED');
        assert.equal(signal.aborted, true);
    }
    finally { await running; }
});

for (const uncertain of [false, true]) test(uncertain ? 'an older unresolved native effect preserves cancellation and holds resume' : 'settling an older native effect preserves owner cancellation', async t => {
    const f = await fixture(t), c = f.controller, s = c.store;
    const { workId } = await c.beginChange({ projectId: 'P', request: 'Original native effect' });
    const original = s.one('SELECT epoch,generation FROM works WHERE id=?', workId);
    const target = randomUUID(), grant = randomUUID(), op = randomUUID(), run = randomUUID();
    const clientRoot = path.join(f.home, 'effects', op, 'client');
    if (uncertain) await fs.mkdir(clientRoot, { recursive: true, mode: 0o700 });
    s.run('INSERT INTO effect_targets VALUES(?,?,?)', target, 'P', JSON.stringify({ kind: 'local-git' }));
    s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', grant, workId, target, original.epoch, '{}');
    s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', op, workId, target, grant, 'CONFIRMED', JSON.stringify({ kind: 'local-git', clientRoot }));
    // Model the durable pre-dispatch checkpoint. An unexplained client root
    // prevents the admission record from proving that nothing was allocated.
    s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', run, workId, original.epoch, original.generation, 'CREATED',
        clientRoot, 'consumed', JSON.stringify({ kind: 'native-effect', operationId: op, clientRoot, admission: 'never-admitted' }));
    assert.equal((await c.cancelWork({ workId, expectedEpoch: original.epoch })).state, 'CANCELLED');
    await c.close();
    const reopened = await openController(f.options);
    try {
        const work = reopened.inspectWork(workId);
        const settled = work.runs.find(row => row.id === run);
        assert.equal(work.state, 'CANCELLED');
        assert.equal(work.epoch, original.epoch + 1);
        assert.equal(settled.phase, uncertain ? 'UNKNOWN' : 'INTERRUPTED');
        assert.equal(settled.data.cleanup, uncertain ? 'quarantined' : 'not-allocated');
        if (uncertain) {
            const { conversationId, generation } = reopened.createConversation({ projectId: 'P' });
            assert.throws(() => reopened.resumeConversationChange({
                conversationId, expectedGeneration: generation, expectedModelRevision: 0, workId,
                expectedEpoch: work.epoch, resumeCancelled: true,
            }), error => error.code === 'CLEANUP_UNKNOWN');
            assert.equal(reopened.inspectWork(workId).state, 'CANCELLED');
        }
    }
    finally { await reopened.close(); }
});

test('a damaged selected effect does not suppress cancellation of another owned producer', async t => {
    const { controller: c } = await fixture(t), s = c.store;
    const { workId } = await c.beginChange({ projectId: 'P', request: 'Cancel the selected effects' });
    const target = randomUUID(), grant = randomUUID(), malformed = randomUUID(), publication = randomUUID();
    s.run('INSERT INTO effect_targets VALUES(?,?,?)', target, 'P', '{}');
    s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', grant, workId, target, 1, '{}');
    s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', malformed, workId, target, grant, 'REFUSED', '{');
    s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', publication, workId, target, grant, 'CONFIRMED', JSON.stringify({ kind: 'publication' }));
    const producers = [malformed, publication].map(id => {
        const producer = new AbortController();
        c.publicationEngine.aborts.set(id, producer);
        return producer;
    });
    await assert.rejects(c.cancelWork({ workId }), /Cancellation was recorded; original cleanup is unconfirmed/u);
    assert.equal(c.inspectWork(workId).state, 'CANCELLED');
    assert.ok(producers.every(producer => producer.signal.aborted));
});
