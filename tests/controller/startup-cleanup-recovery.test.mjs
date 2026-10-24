import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertStartupCleanupSnapshot } from '../../dist/controller/startup-cleanup-recovery.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { readinessCommands } from '../../dist/ui/readiness-commands.js';
import { workCommands } from '../../dist/ui/work-commands.js';
import { inputCommands } from '../../dist/ui/input-commands.js';
import { classifyCreateRejection } from '../../dist/execution/create-rejection.js';
import { createStartupCleanupFixture } from './startup-cleanup-fixture.mjs';


test('original complete create rejection is inspectable without a daemon call or a state change', async t => {
    const f = await createStartupCleanupFixture(t);
    const before = f.store.db.prepare('SELECT * FROM runs').all();
    const result = await f.inspect();
    assert.equal(result.eligible, true, result.holds.join('; '));
    assert.equal(result.review.runId, 'R');
    assert.equal(result.review.journalFile, f.journalFile);
    assert.equal(result.captured.evidence.original.kind, 'legacy-controller-observation');
    assert.equal(result.captured.evidence.original.error, f.error);
    assert.doesNotThrow(() => assertStartupCleanupSnapshot(f.store, result.captured));
    assert.deepEqual(f.store.db.prepare('SELECT * FROM runs').all(), before);
    assert.equal((await f.inspect()).fingerprint, result.fingerprint);
    assert.equal(JSON.parse(await fs.readFile(f.journalFile, 'utf8')).state, 'quarantined');
    f.changeRun({cleanup: 'quarantined-new-diagnostic'});
    assert.notEqual((await f.inspect()).fingerprint, result.fingerprint);
    assert.throws(() => assertStartupCleanupSnapshot(f.store, result.captured), /recovery changed/);
});

for (const [name, change] of [
    ['native prompt attempt', async f => f.changeRun({nativePromptAttempted: true})],
    ['native history', async f => f.store.run('UPDATE conversations SET history=? WHERE id=?', '/retained/native.jsonl', 'C')],
    ['changed conversation cursor', async f => f.store.run('UPDATE conversation_state SET work=NULL WHERE conversation=?', 'C')],
    ['reserved budget', async f => f.store.run("UPDATE budgets SET reserved=1 WHERE lineage='W' AND kind='execution'")],
    ['wrong lease', async f => f.changeRun({capacityId: 'foreign'})],
    ['different original route', async f => f.changeRun({runtimeProfile: {...f.runtime, dockerContext: 'other'}})],
    ['unknown create result', async f => f.store.run('UPDATE observations SET data=? WHERE id=?', JSON.stringify({kind: 'ordinary-response-unavailable', error: 'Error: transport closed after create'}), 'O')],
    ['mismatched bind path', async f => f.store.run('UPDATE observations SET data=? WHERE id=?', JSON.stringify({kind: 'ordinary-response-unavailable', error: f.error.replace(f.staging + '\n', '/foreign/staging\n')}), 'O')],
    ['another observation', async f => f.store.run('INSERT INTO observations VALUES(?,?,?)', 'O2', 'R', JSON.stringify({kind: 'native-model-dispatch'}))],
    ['retained full container ID', async f => fs.writeFile(f.journalFile, JSON.stringify({...f.journal, id: 'a'.repeat(64)}))],
    ['uncertain native process cleanup', async f => fs.writeFile(f.journalFile, JSON.stringify({...f.journal, nativeCleanupUnknown: {processGroup: 12}}))],
    ['wrong journal work', async f => fs.writeFile(f.journalFile, JSON.stringify({...f.journal, workId: 'foreign'}))],
    ['unsafe journal permissions', async f => fs.chmod(f.journalFile, 0o644)],
]) {
    test('original startup cleanup remains held for ' + name, async t => {
        const f = await createStartupCleanupFixture(t);
        await change(f);
        const result = await f.inspect();
        assert.equal(result.eligible, false);
        assert.ok(result.holds.length);
        assert.equal(result.captured, undefined);
        assert.equal(f.store.one('SELECT state FROM works WHERE id=?', 'W').state, 'UNKNOWN');
        assert.equal(f.store.one('SELECT state FROM capacity_leases WHERE id=?', 'L').state, 'QUARANTINED');
    });
}

test('busy startup and linked goals cannot use historical rejection to bypass current obligations', async t => {
    const f = await createStartupCleanupFixture(t);
    assert.equal((await f.inspect(() => true)).eligible, false);
    f.store.run('INSERT INTO goals VALUES(?,?,?,?,?)', 'G', 'C', 1, 'READY', '{}');
    assert.equal((await f.inspect()).eligible, false);
});

test('journal symlinks never become cleanup evidence', async t => {
    const f = await createStartupCleanupFixture(t);
    const privateCopy = path.join(f.home, 'copied-journal');
    await fs.rename(f.journalFile, privateCopy);
    await fs.symlink(privateCopy, f.journalFile);
    assert.equal((await f.inspect()).eligible, false);
});

test('a second same-run runtime journal refuses inspection and a previously reviewed snapshot', async t => {
    const f = await createStartupCleanupFixture(t);
    const reviewed = await f.inspect();
    assert.equal(reviewed.eligible, true);
    const duplicate = path.join(path.dirname(f.journalFile), '98765432-1234-1234-1234-123456789abc.json');
    await fs.writeFile(duplicate, JSON.stringify({...f.journal, nonce: '98765432-1234-1234-1234-123456789abc'}), {mode: 0o600});
    assert.equal((await f.inspect()).eligible, false);
    assert.throws(() => assertStartupCleanupSnapshot(f.store, reviewed.captured), /duplicate runtime journals/);
});

test('new goal or changed budget after asynchronous inspection refuses final settlement', async t => {
    const f = await createStartupCleanupFixture(t);
    const reviewed = await f.inspect();
    f.store.run('INSERT INTO goals VALUES(?,?,?,?,?)', 'G', 'C', 1, 'READY', '{}');
    assert.throws(() => assertStartupCleanupSnapshot(f.store, reviewed.captured), /recovery changed/);
    f.store.run("UPDATE goals SET state='CANCELLED' WHERE id='G'");
    f.store.run("UPDATE budgets SET consumed=2 WHERE lineage='W' AND kind='execution'");
    assert.throws(() => assertStartupCleanupSnapshot(f.store, reviewed.captured), /recovery changed/);
});

test('final snapshot binds the exact durable journal rewrite, including same-run changes', async t => {
    const f = await createStartupCleanupFixture(t);
    const reviewed = await f.inspect();
    const rewritten = JSON.stringify({...f.journal, state: 'removed', createRejection: reviewed.captured.evidence});
    await fs.writeFile(f.journalFile, rewritten);
    const journalHash = createHash('sha256').update(rewritten).digest('hex');
    assert.throws(() => assertStartupCleanupSnapshot(f.store, reviewed.captured), /journal population changed/);
    assert.doesNotThrow(() => assertStartupCleanupSnapshot(f.store, reviewed.captured, journalHash));
    await fs.writeFile(f.journalFile, JSON.stringify({...JSON.parse(rewritten), reason: 'Changed after owned settlement'}));
    assert.throws(() => assertStartupCleanupSnapshot(f.store, reviewed.captured, journalHash), /journal population changed/);
});

test('captured manifests may exceed small metadata records while retaining a finite run-history bound', async t => {
    const f = await createStartupCleanupFixture(t);
    f.changeRun({manifest: {files: [], directories: [], capturedMetadata: 'x'.repeat(96 * 1024)}});
    const context = await f.inspect();
    assert.equal(context.eligible, true, context.holds.join('; '));
    assert.doesNotThrow(() => assertStartupCleanupSnapshot(f.store, context.captured));
    f.changeRun({manifest: {files: [], directories: [], capturedMetadata: 'x'.repeat(8 * 1024 * 1024)}});
    assert.equal((await f.inspect()).eligible, false);
});

test('aggregate original run history remains bounded even when individual manifests fit', async t => {
    const f = await createStartupCleanupFixture(t);
    const prior = JSON.stringify({
        kind: 'ordinary-conversation', conversation: 'C', cleanup: 'not-allocated', outcome: 'unavailable',
        manifest: {files: [], directories: [], capturedMetadata: 'x'.repeat(6 * 1024 * 1024)},
    });
    for (let n = 0; n < 3; n++)
        f.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'prior-' + n, 'W', 1, 1, 'SETTLED', '/unused', 'consumed', prior);
    const result = await f.inspect();
    assert.equal(result.eligible, false);
    assert.match(result.holds.join('; '), /bounded recovery profile/);
});

function uiHost(controller, choose, show = async () => {}) {
    return {
        controller, choose, show, isCurrent: () => true,
        input: async () => assert.fail('Startup recovery does not require a replacement request'),
        notice: () => {}, activate: async () => assert.fail('Inspection must not switch conversations'),
    };
}

test('ready opens the exact held work and Back preserves its startup and input', async t => {
    const f = await createStartupCleanupFixture(t), controller = f.controller();
    let reviews = 0, confirms = 0, workMenus = 0, overviews = 0;
    const calls = [];
    const choose = async (title, rows) => {
        if (title.startsWith('Setup and next actions')) {
            if (++overviews > 1) return rows.at(-1);
            assert.match(rows[0], /Inspect original work and cleanup/);
            return rows[0];
        }
        if (title === 'Original work and allowances · all projects') return 'Close work registry';
        if (title.startsWith('Work recovery')) {
            workMenus++;
            return workMenus === 1 ? 'Review failed startup cleanup' : 'Back to all works';
        }
        assert.equal(title, 'Confirm original startup cleanup recovery');
        assert.equal(rows[0], 'Back without recovery');
        confirms++;
        return rows[0];
    };
    const host = uiHost(controller, choose, async (title, text) => {
        assert.match(title, /Review original startup rejection/);
        assert.match(text, /before container allocation/);
        reviews++;
    });
    let registry;
    registry = new HostCommands([
        ...workCommands(host),
        ...readinessCommands({...host, hostLanguage: 'en', execute: async (command, target, context) => {
            calls.push(command);
            return registry.execute(command, target, context);
        }}),
    ]);
    assert.equal(await registry.execute('/ready', 'C'), 'cancelled');
    assert.deepEqual(calls, ['/work W']);
    assert.equal(reviews, 1);
    assert.equal(confirms, 1);
    assert.equal(f.store.one('SELECT state FROM works WHERE id=?', 'W').state, 'UNKNOWN');
    assert.equal(f.store.one('SELECT state FROM conversation_inputs WHERE id=?', 'I').state, 'INITIAL_RESERVED');
    assert.equal(JSON.parse(await fs.readFile(f.journalFile, 'utf8')).state, 'quarantined');
});

test('reviewed work recovery preserves originals and permits existing input withdrawal and conversation deletion', async t => {
    const f = await createStartupCleanupFixture(t), controller = f.controller();
    const originalSource = f.store.one('SELECT * FROM sources WHERE id=?', 'S');
    const originalInput = f.store.one('SELECT * FROM conversation_inputs WHERE id=?', 'I');
    const originalWork = f.store.one('SELECT * FROM works WHERE id=?', 'W');
    const budgets = f.store.all('SELECT * FROM budgets ORDER BY kind');
    const host = uiHost(controller, async (title, rows) => {
        if (title.startsWith('Work recovery')) return 'Review failed startup cleanup';
        assert.equal(title, 'Confirm original startup cleanup recovery');
        assert.equal(rows[0], 'Back without recovery');
        return 'Recover this rejected startup';
    });
    assert.equal(await new HostCommands(workCommands(host)).execute('/work W', 'C'), 'completed');
    const work = f.store.one('SELECT * FROM works WHERE id=?', 'W');
    assert.deepEqual({...work}, {...originalWork, state: 'ACTIVE'});
    assert.deepEqual(f.store.one('SELECT * FROM sources WHERE id=?', 'S'), originalSource);
    assert.deepEqual(f.store.one('SELECT * FROM conversation_inputs WHERE id=?', 'I'), originalInput);
    assert.deepEqual(f.store.all('SELECT * FROM budgets ORDER BY kind'), budgets);
    const run = f.store.one('SELECT * FROM runs WHERE id=?', 'R');
    assert.equal(run.phase, 'SETTLED');
    assert.equal(run.reservation, 'consumed');
    assert.equal(JSON.parse(run.data).cleanup, 'removed');
    assert.equal(JSON.parse(run.data).outcome, 'unavailable');
    assert.equal(f.store.one('SELECT state FROM capacity_leases WHERE id=?', 'L').state, 'RELEASED');
    assert.equal(JSON.parse(await fs.readFile(f.journalFile, 'utf8')).state, 'removed');
    assert.equal(f.store.one('SELECT COUNT(*) AS n FROM runs').n, 1);
    assert.equal(controller.inspectConversation('C').state, 'IDLE');

    const inputs = inputCommands({
        ...uiHost(controller, async (title, rows) => {
            if (title.startsWith('Sent requests')) return rows[0];
            assert.equal(title, 'This exact request · choose explicitly');
            return 'Withdraw original request';
        }),
        retry: async () => assert.fail('Withdrawal must not dispatch'),
        inspectWork: async () => assert.fail('No blocking-work inspection expected'),
    });
    assert.equal(await new HostCommands(inputs).execute('/inputs', 'C'), 'completed');
    assert.equal(f.store.one('SELECT state FROM conversation_inputs WHERE id=?', 'I').state, 'CONFLICTED');
    assert.deepEqual(f.store.all('SELECT * FROM budgets ORDER BY kind'), budgets);
    await controller.deleteConversation({conversationId: 'C', expectedGeneration: 1});
    assert.equal(controller.inspectConversation('C').deleted, true);
    assert.equal(f.store.one('SELECT COUNT(*) AS n FROM runs').n, 1);
});

test('stale source validation refuses recovery before journal or database changes', async t => {
    const f = await createStartupCleanupFixture(t), controller = f.controller();
    const context = await controller.inspectStartupCleanup('W');
    assert.equal(context.eligible, true, context.holds.join('; '));
    await assert.rejects(controller.recoverStartupCleanup({workId: 'W', expectedContext: context.fingerprint}, () => {
        throw Error('Original view changed');
    }), /Original view changed/);
    assert.equal(JSON.parse(await fs.readFile(f.journalFile, 'utf8')).state, 'quarantined');
    assert.equal(f.store.one('SELECT state FROM works WHERE id=?', 'W').state, 'UNKNOWN');
});

test('durable rejected-create settlement survives database rollback and finishes on model-free reopen', async t => {
    const f = await createStartupCleanupFixture(t), controller = f.controller();
    const context = await controller.inspectStartupCleanup('W');
    const originalRun = f.store.run.bind(f.store);
    let refused = false;
    f.store.run = (sql, ...values) => {
        if (!refused && sql === 'INSERT INTO sources VALUES(?,?,?,?)') {
            refused = true;
            throw Error('Controlled recovery transaction failure');
        }
        return originalRun(sql, ...values);
    };
    await assert.rejects(controller.recoverStartupCleanup({workId: 'W', expectedContext: context.fingerprint}, () => undefined), /Controlled recovery transaction failure/);
    f.store.run = originalRun;
    assert.equal(JSON.parse(await fs.readFile(f.journalFile, 'utf8')).state, 'removed');
    assert.equal(f.store.one('SELECT state FROM works WHERE id=?', 'W').state, 'UNKNOWN');
    const reopened = await f.reopen();
    assert.equal(reopened.inspectWorkRecovery('W').state, 'ACTIVE');
    assert.equal(reopened.inspectWorkRecovery('W').epoch, 1);
    assert.equal(reopened.inspectWorkRecovery('W').execution.consumed, 1);
    assert.equal(reopened.inspectConversation('C').state, 'IDLE');
    assert.equal(reopened.inspectConversationInputs('C')[0].eligible, true);
});

async function prepareCreateRefusalCrash(f) {
    const result = {
        stdout: '', exitCode: 1,
        stderr: `Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ${f.staging}\n`,
    };
    const evidence = classifyCreateRejection(result, [f.staging]);
    assert.ok(evidence);
    await fs.writeFile(f.journalFile, JSON.stringify({
        ...f.journal, state: 'removed', createOutcome: result, createRejection: evidence,
        reason: 'Original Docker create rejected before allocation',
    }));
    const run = f.store.one('SELECT * FROM runs WHERE id=?', 'R');
    const data = JSON.parse(run.data);
    delete data.outcome;
    delete data.cleanup;
    f.store.run('UPDATE runs SET phase=?,reservation=?,data=? WHERE id=?', 'RUNTIME_CREATING', 'reserved', JSON.stringify(data), 'R');
    f.store.run("UPDATE works SET state='ACTIVE' WHERE id='W'");
    f.store.run("UPDATE conversation_state SET resource='RUNNING' WHERE conversation='C'");
    f.store.run("UPDATE capacity_leases SET state='ADMITTED' WHERE id='L'");
    f.store.run("UPDATE budgets SET consumed=0,reserved=1 WHERE lineage='W' AND kind='execution'");
    f.store.run("DELETE FROM observations WHERE run='R'");
}

test('crash after native create rejection but before finally settles the same attempt once without a runtime', async t => {
    const f = await createStartupCleanupFixture(t);
    await prepareCreateRefusalCrash(f);
    const reopened = await f.reopen();
    assert.equal(reopened.inspectWorkRecovery('W').state, 'ACTIVE');
    assert.equal(reopened.inspectWorkRecovery('W').epoch, 1);
    assert.equal(reopened.inspectWorkRecovery('W').execution.consumed, 1);
    assert.equal(reopened.inspectWorkRecovery('W').execution.reserved, 0);
    assert.equal(reopened.inspectConversation('C').state, 'IDLE');
    const [input] = reopened.inspectConversationInputs('C');
    assert.equal(input.state, 'INITIAL_RESERVED');
    assert.equal(input.eligible, true);
    // Public same-input recovery consumes the recovered unavailable/settled
    // run proof, so this also exercises its terminal phase and outcome.
    reopened.recoverConversationInput({conversationId: 'C', inputId: 'I', expectedContext: input.fingerprint, action: 'withdraw'});
    const again = await f.reopen();
    assert.equal(again.inspectWorkRecovery('W').execution.consumed, 1);
    assert.equal(again.inspectWorkRecovery('W').execution.reserved, 0);
    assert.equal(again.inspectConversationInputs('C').length, 0);
});

for (const [name, change] of [
    ['cancelled work', f => f.store.run("UPDATE works SET state='CANCELLED' WHERE id='W'")],
    ['changed work generation', f => f.store.run("UPDATE works SET generation=2 WHERE id='W'")],
    ['cancelled interrupted run', f => {
        f.store.run("UPDATE works SET state='CANCELLED' WHERE id='W'");
        f.store.run("UPDATE runs SET phase='INTERRUPTED' WHERE id='R'");
    }],
]) {
    test('a durable create refusal does not revive ' + name, async t => {
        const f = await createStartupCleanupFixture(t);
        await prepareCreateRefusalCrash(f);
        change(f);
        const reopened = await f.reopen();
        assert.notEqual(reopened.inspectWorkRecovery('W').state, 'ACTIVE');
        assert.equal(reopened.inspectWorkRecovery('W').epoch, 1);
        assert.equal(reopened.inspectConversationInputs('C')[0].eligible, false);
    });
}

test('reopening retains uncertainty when a removed rejection journal has another same-run scope', async t => {
    const f = await createStartupCleanupFixture(t);
    await prepareCreateRefusalCrash(f);
    const otherNonce = '98765432-1234-1234-1234-123456789abc';
    await fs.writeFile(path.join(path.dirname(f.journalFile), otherNonce + '.json'), JSON.stringify({
        ...f.journal, nonce: otherNonce, name: 'gitjig-' + otherNonce,
    }), {mode: 0o600});
    const reopened = await f.reopen();
    assert.equal(reopened.inspectWorkRecovery('W').state, 'UNKNOWN');
    assert.equal(reopened.inspectConversationInputs('C')[0].eligible, false);
});

test('a later cancellation epoch cannot be revived by an earlier durable startup rejection', async t => {
    const f = await createStartupCleanupFixture(t);
    await prepareCreateRefusalCrash(f);
    // Controlled checkpoint after the rejection journal committed, followed by
    // owner cancellation advancing the work epoch before database settlement.
    f.changeRun({});
    f.store.run("UPDATE runs SET phase='UNKNOWN',reservation='consumed' WHERE id='R'");
    f.store.run("UPDATE works SET state='UNKNOWN',epoch=2 WHERE id='W'");
    f.store.run("UPDATE budgets SET consumed=1,reserved=0 WHERE lineage='W' AND kind='execution'");
    f.store.run("UPDATE capacity_leases SET state='QUARANTINED' WHERE id='L'");
    const reopened = await f.reopen();
    assert.notEqual(reopened.inspectWorkRecovery('W').state, 'ACTIVE');
    assert.equal(reopened.inspectWorkRecovery('W').epoch, 2);
    assert.equal(reopened.inspectConversationInputs('C')[0].eligible, false);
    assert.equal(reopened.inspectWorkRecovery('W').execution.consumed, 1);
});

test('cross-conversation startup recovery directs the owner to the original input conversation', async t => {
    const f = await createStartupCleanupFixture(t), controller = f.controller();
    const other = controller.createConversation();
    let notice;
    const host = {
        ...uiHost(controller, async title => title.startsWith('Work recovery')
            ? 'Review failed startup cleanup' : 'Recover this rejected startup'),
        notice: text => { notice = text; },
    };
    assert.equal(await new HostCommands(workCommands(host)).execute('/work W', other.conversationId), 'completed');
    assert.match(notice, /open \/resume C, then \/inputs/);
    assert.equal(controller.inspectConversation(other.conversationId).workId, null);
    assert.equal(controller.inspectConversationInputs('C')[0].state, 'INITIAL_RESERVED');
});
