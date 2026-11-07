// Real Controller/Pi/engine consumers with scripted judgment; no paid provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { openController } = await import(process.env.GITJIG_UNUSABLE_AUTHOR_CONTROLLER ?? '../../dist/controller/index.js');
import { scripted, withValueCases } from './effect-fixture.mjs';
const runtimeProfile = {
    dockerBinary: process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, image: process.env.GITJIG_RUNTIME_IMAGE
};
test('unusable first author survives reopen and produces a fresh checked reviewed candidate on the accepted plan', {
    timeout: 120000
}, async () => {
    assert.ok(runtimeProfile.dockerContext && runtimeProfile.image, 'Explicit prepared private engine required');
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parent && path.isAbsolute(parent), 'Explicit private shared fixture root required');
    assert.equal(await fs.realpath(parent), parent);
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'unusable-author-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
    await fs.writeFile(path.join(source, 'check.cjs'), withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3}]}));\n"));
    await fs.writeFile(path.join(source, 'owner-note.md'), 'Fixed owner context\n');
    process.env.TMPDIR = path.join(home, 'artifacts');
    let c, bad = true, passed = false;
    const roles = [];
    const model = scripted(undefined, ({ role, result }) => {
        roles.push(role);
        if (role === 'implementer' && bad)
            result.assessedScope = result.assessedScope.slice(1);
    });
    try {
        c = await openController({
            installationHome: home, runtimeProfile
        });
        await c.registerProject({
            id: 'P', sourceRoot: source
        });
        const begun = await c.beginChange({
            projectId: 'P', request: 'Consumer exports3; retain fixed owner note and actual checks', executionLimit: 16, resolutionLimit: 6
        }), workId = begun.workId;
        const planned = await c.planChange({
            workId, model
        });
        assert.equal(planned.phase, 'PLAN_READY', JSON.stringify(planned.blocked));
        const failed = await c.implementChange({
            workId, model
        });
        assert.equal(failed.phase, 'BLOCKED');
        assert.equal(failed.candidateVersion, null);
        assert.match(failed.blocked.join(), /MISSING_REQUIRED_SCOPE/);
        const old = c.store.all('SELECT * FROM role_outputs ORDER BY rowid'), oldRuns = c.store.all('SELECT * FROM runs ORDER BY rowid');
        assert.equal(old.at(-1).status, 'unusable');
        assert.match(JSON.parse(old.at(-1).data).issues.join(), /MISSING_REQUIRED_SCOPE/);
        const originalLaunch = old.at(-1).launch;
        await c.close();
        c = null;
        bad = false;
        c = await openController({
            installationHome: home, runtimeProfile
        });
        const originalRun = c.store.one('SELECT run FROM role_launches WHERE id=?', originalLaunch).run, conversationId = c.store.one("SELECT conversation FROM conversation_state WHERE json_extract(data,'$.runId')=?", originalRun).conversation;
        const direction = await c.queueConversationInput({
            conversationId, expectedGeneration: c.inspectConversation(conversationId).generation, text: 'Retry the same accepted export3 intent without changing requirements or owner files.', mode: 'idle'
        });
        const beforeRoles = roles.length;
        const next = await c.driveChange({
            workId, model, maximumSteps: 1
        });
        assert.equal(next.phase, 'CANDIDATE_CAPTURED', JSON.stringify(next.blocked));
        assert.ok(next.candidateVersion);
        assert.equal(next.planVersion, planned.planVersion);
        assert.deepEqual(roles.slice(beforeRoles), [
            'adjudicator', 'implementer', 'implementer'
        ]);
        assert.equal(next.execution.consumed - failed.execution.consumed, 2);
        assert.equal(next.resolution.consumed, failed.resolution.consumed + 1);
        assert.deepEqual(c.store.all('SELECT * FROM role_outputs ORDER BY rowid').slice(0, old.length), old);
        assert.deepEqual(c.store.all('SELECT * FROM runs ORDER BY rowid').slice(0, oldRuns.length), oldRuns);
        assert.equal(c.store.one('SELECT status FROM role_launches WHERE id=?', originalLaunch).status, 'UNUSABLE');
        const ready = await c.driveChange({
            workId, model
        });
        assert.equal(ready.reviewReady, true, JSON.stringify(ready.blocked));
        assert.equal(ready.execution.reserved, 0);
        assert.equal(ready.resolution.reserved, 0);
        assert.equal(ready.planVersion, planned.planVersion);
        assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n');
        assert.equal(await fs.readFile(path.join(c.changeCore.version(ready.candidateVersion).artifact, 'consumer.cjs'), 'utf8'), 'module.exports=3;\n');
        await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify({
            scope: 'Actual Controller/Pi/engine and checks, scripted judgment only', workId, planned, failed, next, ready, roles, originalLaunch, direction, oldOutputs: old
        }, null, 2), {
            flag: 'wx', mode: 0o600
        });
        passed = true;
    }
    finally {
        await c?.close();
        console.log('RETAINED_UNUSABLE_AUTHOR ' + root + ' passed=' + passed);
    }
});
