import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Public owner decisions over the real installed procedure evidence. SQLite is
// read-only: it observes retained identity and spend, never manufactures standing.
export async function recoverOwnerOriginal({workId, targetId, prepared, read, budgets, cli, terminal, requests, reviews, head}) {
    const one = (table, id) => read(db => db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(id));
    const operation = () => one('effect_operations', prepared.operationId);
    const original = operation(), data = JSON.parse(original.data), work = one('works', workId), grant = one('effect_delegations', original.grant_id);
    const ownerFile = path.join(data.clientRoot, 'native-owner.json');
    const ownerBytes = await fs.readFile(ownerFile), clientIdentity = await fs.stat(data.clientRoot), ownerIdentity = await fs.stat(ownerFile);
    const priorEvidence = await cli(['change', 'inspect', '--work', workId], 'pre-cancel-procedures');
    const before = budgets(), beforeHead = await head('receiver-before-cancel'), beforeRequests = requests.length, beforeReviews = reviews.length;
    const frozen = () => ['works', 'budgets', 'runs', 'effect_operations', 'effect_delegations', 'effect_receipts', 'conversation_inputs'].map(table => ({
        sql: 'SELECT * FROM ' + table + ' ORDER BY rowid', rows: read(db => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()).map(Object.values)
    }));
    await cli(['work', 'cancel', '--work', workId, '--epoch', String(work.epoch)], 'cancel-original');
    const cancelled = one('works', workId);
    assert.equal(cancelled.state, 'CANCELLED'); assert.equal(cancelled.epoch, work.epoch + 1);
    assert.deepEqual(budgets(), before); assert.equal(requests.length, beforeRequests);
    assert.equal(await head('receiver-after-cancel'), beforeHead);
    assert.equal(operation().id, original.id); assert.equal(JSON.parse(operation().data).clientRoot, data.clientRoot);
    const withdrawn = operation();
    assert.equal(withdrawn.phase, 'REFUSED');
    const cancelledRows = frozen();
    await terminal('cancelled-pure-reopen', [
        {wait: 'Model: original', send: '/change inspect ' + workId + '\x1b\r'},
        {wait: 'Managed change · inspection only', queries: cancelledRows, send: '\x1b'},
        {wait: 'INPUT · Conversation idle', queries: cancelledRows, send: '\x15/quit\x1b\r'}
    ]);
    assert.equal(requests.length, beforeRequests);
    await terminal('resume-original', [
        {wait: 'Model: original', send: '\x15/change resume ' + workId + '\x1b\r'},
        {wait: 'Resume · P · #', send: 'Recover and resume this original work\r'},
        {wait: 'Review-ready result recorded', send: '/quit\x1b\r'}
    ], 60);
    const resumed = one('works', workId);
    assert.equal(resumed.state, 'DELIVERED'); assert.equal(resumed.epoch, cancelled.epoch + 1);
    for (const key of ['id', 'source', 'lineage', 'project']) assert.equal(resumed[key], work[key]);
    assert.deepEqual(JSON.parse(resumed.data).applicationModelBaseline, JSON.parse(work.data).applicationModelBaseline);
    assert.deepEqual(one('effect_delegations', grant.id), grant);
    assert.deepEqual(operation(), withdrawn, 'Resuming work does not restore old external authority');
    const recovered = await cli(['change', 'inspect', '--work', workId], 'resumed-current-procedures');
    assert.equal(recovered.reviewReady, true);
    assert.equal(recovered.epoch, resumed.epoch);
    assert.equal(recovered.candidateVersion, priorEvidence.candidateVersion);
    assert.equal(recovered.planVersion, priorEvidence.planVersion);
    assert.equal(recovered.verificationVersion, priorEvidence.verificationVersion);
    assert.deepEqual(recovered.checks, priorEvidence.checks);
    assert.deepEqual(recovered.launches, priorEvidence.launches);
    assert.equal(requests.length, beforeRequests, 'Unchanged valid procedure evidence is retained without ceremonial reruns');
    assert.equal(reviews.length, beforeReviews); assert.deepEqual(budgets(), before);
    const retainedInputs = read(db => db.prepare('SELECT COUNT(*) n FROM conversation_inputs').get().n);
    const afterResume = budgets(), afterRequests = requests.length, afterReviews = reviews.length;
    const start = [{wait: 'Model: original', send: '\x15KEEP recovery 한국어\x07t'},
        {wait: 'Setup and next actions', send: 'More settings and details\r'},
        {wait: 'More settings and details · current and saved configuration', send: 'Repository management\r'},
        {wait: 'Repository management · owner actions', send: 'Integration targets\r'},
        {wait: 'Integration targets · retained observations', send: targetId + '\r'},
        {wait: 'Original integration target · actions', send: 'Delegate ordinary integration to owner work\r'}];
    await terminal('renew-and-reauthorize-original', [...start,
        {wait: 'Integration delegation · select original owner work', send: workId + '\r'},
        {wait: 'Original integration delegation held', send: '\x1b'},
        {wait: 'Original grant is stale', send: 'Review renewal of this original grant\r'},
        {wait: 'Owner reason to renew the same integration grant', send: 'Preserve the original ceiling and cumulative use\r'},
        {wait: 'Review exact original grant renewal', send: '\x1b'},
        {wait: 'Confirm exact original grant renewal', send: 'Renew this original grant\r'},
        {wait: 'Original integration grant renewed', send: '\x1b'},
        {wait: 'Integration delegation · select original owner work', send: 'Back\r'},
        {wait: 'Integration targets · retained observations', send: 'Back\r'},
        {wait: 'Repository management · owner actions', send: 'Retained integrations\r'},
        {wait: 'Retained integrations · recorded facts', send: prepared.operationId + '\r'},
        {wait: 'Original integration · ' + prepared.operationId, send: 'Review original authority reauthorization\r'},
        {wait: 'Owner reason to reauthorize this unsent original', send: 'Keep this original unsent operation and client\r'},
        {wait: 'Review exact original authority reauthorization', send: '\x1b'},
        {wait: 'Confirm exact original authority reauthorization', send: 'Reauthorize this unsent original\r'},
        {wait: 'Original integration reauthorized', send: '\x1b'},
        {wait: 'Retained integrations · recorded facts', send: 'Back\r'},
        {wait: 'Repository management · owner actions', send: 'Close\r'},
        {wait: 'More settings and details · current and saved configuration', send: 'Back to current setup\r'},
        {wait: 'Setup and next actions', send: 'Return to request\r'},
        {wait: 'KEEP recovery 한국어', assertDraft: 'KEEP recovery 한국어', expectedInputs: retainedInputs, send: '\x15/quit\x1b\r'}
    ], 25);
    assert.deepEqual(budgets(), afterResume); assert.equal(requests.length, afterRequests); assert.equal(reviews.length, afterReviews);
    const renewed = one('effect_delegations', grant.id), renewedData = JSON.parse(renewed.data), priorData = JSON.parse(grant.data);
    assert.equal(renewed.epoch, grant.epoch + 1);
    for (const key of ['operationLimit', 'scope', 'mode', 'source', 'projectId']) assert.deepEqual(renewedData[key], priorData[key]);
    assert.equal(renewedData.rootEpoch, resumed.epoch);
    const restored = operation(); assert.equal(restored.phase, 'PREPARED');
    for (const key of ['id', 'work', 'target', 'grant_id']) assert.equal(restored[key], original[key]);
    assert.equal(JSON.parse(restored.data).clientRoot, data.clientRoot);
    assert.deepEqual(await fs.readFile(ownerFile), ownerBytes);
    for (const [file, beforeStat] of [[data.clientRoot, clientIdentity], [ownerFile, ownerIdentity]]) {
        const after = await fs.stat(file); assert.equal(after.dev, beforeStat.dev); assert.equal(after.ino, beforeStat.ino);
    }
    read(db => {assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE operation=? AND kind='owner-reauthorization'").get(original.id).n, 1);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE operation=? AND kind='send'").get(original.id).n, 0);});
    assert.equal(await head('receiver-after-reauthorization'), beforeHead);
    for (const row of afterResume) {const prior = before.find(value => value.kind === row.kind); assert.equal(row.lim, prior.lim); assert.ok(row.consumed >= prior.consumed); assert.equal(row.reserved, 0);}
    return {originalWork: work.id, originalOperation: original.id, originalGrant: grant.id, clientRoot: data.clientRoot,
        cancelledEpoch: cancelled.epoch, resumedEpoch: resumed.epoch, grantEpoch: renewed.epoch, phase: restored.phase,
        scope: 'Settled owner work cancellation and pure reopen; separate same-work resume, grant renewal and definitely-unsent original reauthorization; not in-flight or agent-assignment recovery'};
}
