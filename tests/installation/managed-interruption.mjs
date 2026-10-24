import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export async function installedInterruption({root, home, project, terminal, cli, requests, setRoleResponseGate, sourceBase, sourceCandidate}) {
    const holdFile = path.join(root, 'actual-write-held'), holdValue = 'actual-write-final-response-held';
    let held = null, responseClosed = false;
    setRoleResponseGate(async ({text, body, answer, response}) => {
        if (held || !text.startsWith('Perform the assigned implementer task') || answer.tool) return;
        const call = body.messages.flatMap(message => message.tool_calls ?? []).find(call => call.function.name === 'write');
        assert.ok(call, 'Actual SDK write call precedes the held response');
        const output = body.messages.find(message => message.role === 'tool' && message.tool_call_id === call.id);
        assert.ok(output); assert.match(JSON.stringify(output.content), /Successfully wrote/);
        held = {call, output};
        assertHeldWrite(held, sourceCandidate);
        await fs.writeFile(path.join(root, 'held-write-receipt.json'), JSON.stringify(held), {mode: 0o600});
        await fs.writeFile(holdFile, holdValue, {mode: 0o600});
        await new Promise(resolve => {
            if (response.destroyed) {responseClosed = true; resolve();}
            else response.once('close', () => {responseClosed = true; resolve();});
        });
    });
    const request = 'Recover actual interrupted write: consumer must export3 using its existing simple implementation.';
    try {
        await terminal('interrupt-after-write', [
            {wait: 'Model: original', send: '\x15/new root\x1b\r'},
            {wait: 'Independent conversation opened · unbound', send: '/model installed-managed/original\x1b\r'},
            {wait: 'Model: original', send: '/project P\x1b\r'},
            {wait: 'Project selected: P', send: '/change start ' + request + '\x1b\r'},
            {wait: 'Start managed work', send: '\r'},
            {wait: 'Preparing task · capture uses the task allowance', waitFiles: [{path: holdFile, value: holdValue}], send: '/quit\x1b\r'}
        ], 60);
    } finally {setRoleResponseGate(null);}
    assert.ok(held); assert.equal(responseClosed, true, 'Graceful application exit closes its actual pending response');
    const changes = await cli(['change', 'list'], 'interrupted-work-discovery');
    const retained = changes.changes.find(change => change.requestPreview.startsWith('Recover actual interrupted write'));
    assert.ok(retained);
    const workId = retained.workId, work = await cli(['work', 'inspect', '--work', workId], 'interrupted-original-work');
    assert.equal(work.source.raw, request);
    const before = await cli(['change', 'inspect', '--work', workId], 'interrupted-procedures');
    assert.equal(before.reviewReady, false);
    const producer = before.launches.find(launch => launch.role === 'implementer');
    assert.ok(producer); assert.notEqual(producer.status, 'COMPLETE');
    assert.equal(producer.data.cleanup, 'removed');
    const history = await fs.readFile(producer.data.historyRef);
    assert.ok(history.includes(Buffer.from('Successfully wrote')));
    const database = path.join(home, 'state/controller.sqlite');
    const read = action => {const db = new DatabaseSync(database, {readOnly: true}); try {return action(db);} finally {db.close();}};
    const budgets = () => read(db => db.prepare('SELECT * FROM budgets WHERE lineage=? ORDER BY kind').all(workId));
    const initialBudget = budgets(); assert.ok(initialBudget.some(row => row.consumed > 0));
    const partialRun = read(db => db.prepare('SELECT * FROM runs WHERE id=?').get(producer.run));
    assert.equal(await fs.readFile(path.join(partialRun.staging, 'consumer.cjs'), 'utf8'), sourceCandidate);
    assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), sourceBase);
    const originalObligations = read(db => db.prepare('SELECT * FROM obligations WHERE work=? ORDER BY rowid').all(workId));
    assert.ok(originalObligations.some(row => JSON.parse(row.data).state !== 'resolved'));
    const freeze = ['budgets', 'runs', 'role_launches', 'obligations'].map(table => ({sql: 'SELECT * FROM ' + table + ' ORDER BY rowid', rows: read(db => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()).map(Object.values)}));
    const count = requests.length;
    await terminal('interrupted-registry-pure-reopen', [
        {wait: 'Model: original', send: '/change\x1b\r'},
        {wait: 'Managed changes', send: 'Recover actual interrupted write\r'},
        {wait: 'Managed change · inspection only', queries: freeze, send: '\x1b'},
        {wait: 'INPUT · Conversation idle', queries: freeze, send: '\x15/quit\x1b\r'}
    ]);
    assert.equal(requests.length, count); assert.deepEqual(budgets(), initialBudget);
    await terminal('interrupted-same-work-resume', [
        {wait: 'Model: original', send: '\x15/change resume ' + workId + '\x1b\r'},
        {wait: 'Resume · P · #', send: '\r'},
        {wait: 'Review-ready result recorded', send: '/quit\x1b\r'}
    ], 70);
    const after = await cli(['change', 'inspect', '--work', workId], 'interrupted-final-procedures');
    assert.equal(after.reviewReady, true); assert.ok(requests.length > count);
    const original = await cli(['work', 'inspect', '--work', workId], 'interrupted-preserved-work');
    assert.equal(original.source.raw, request); assert.equal(original.workId, work.workId);
    assert.deepEqual(await fs.readFile(producer.data.historyRef), history);
    assert.deepEqual(after.launches.find(launch => launch.id === producer.id), producer);
    assert.ok(after.launches.some(launch => launch.role === 'implementer' && launch.id !== producer.id && launch.status === 'COMPLETE'));
    const selected = read(db => JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(workId).data));
    const reviewer = after.launches.find(launch => launch.id === selected.selection.general); assert.ok(reviewer);
    assert.equal(reviewer.data.inputVersions.candidate, after.candidateVersion);
    assert.equal(reviewer.data.inputVersions.requirements, selected.requirementVersion);
    assert.equal(reviewer.data.inputVersions.contracts, selected.contractsVersion); assert.equal(reviewer.data.cleanup, 'removed');
    assert.ok(after.checks.some(check => check.candidate === after.candidateVersion && check.status === 'pass' && check.data.actual.exitCode === 0 && check.data.caseResults.complete));
    for (const row of budgets()) {const prior = initialBudget.find(value => value.kind === row.kind); assert.equal(row.lim, prior.lim); assert.ok(row.consumed >= prior.consumed); assert.equal(row.reserved, 0);}
    for (const row of originalObligations) assert.ok(read(db => db.prepare('SELECT id FROM obligations WHERE id=?').get(row.id)));
    assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), sourceBase);
    const result = {workId, originalProducer: producer.id, nativeSessionId: producer.data.nativeSessionId, historyRef: producer.data.historyRef,
        requestsBeforeResume: count, requestsAfterResume: requests.length, candidateVersion: after.candidateVersion,
        scope: 'Actual installed write and pending HTTP response interrupted by graceful quit, pure registry reopen, same-work explicit recovery to current review-ready; no agent recovery or external action'};
    await fs.writeFile(path.join(root, 'interruption.json'), JSON.stringify(result, null, 2), {mode: 0o600});
    return result;
}

export function assertHeldWrite(held, expected) {
    const arguments_ = JSON.parse(held.call.function.arguments);
    assert.equal(arguments_.path, 'consumer.cjs'); assert.equal(arguments_.content, expected);
    assert.equal(held.output.tool_call_id, held.call.id);
    assert.match(JSON.stringify(held.output.content), /Successfully wrote/);
}
