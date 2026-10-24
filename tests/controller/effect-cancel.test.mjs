import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
const execute = promisify(execFile), git = '/opt/homebrew/bin/git', runtimeProfile = { dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
import {withValueCases,scripted,settledRoot,cleanupFixture} from './effect-fixture.mjs';
async function boundaryScenario(kind) {
    assert.ok(runtimeProfile.image && runtimeProfile.dockerContext);
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/effect-core-'))), home = path.join(root, 'home'), source = path.join(root, 'source'), seed = path.join(root, 'seed'), receiver = path.join(root, 'receiver.git');
    await fs.mkdir(source);
    await fs.mkdir(seed);
    const initial = '// User local choice: 10\n' + Array.from({ length: 8 }, (_, i) => '// Context ' + i + '\n').join('') + 'module.exports=2;\n', dirty = initial.replace('choice: 10', 'choice: 11'), checker = withValueCases(`console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n`);
    await fs.writeFile(path.join(seed, 'consumer.cjs'), initial);
    await fs.writeFile(path.join(seed, 'check.cjs'), checker);
    await execute(git, ['init', '--initial-branch=main', seed]);
    await execute(git, ['-C', seed, 'add', 'consumer.cjs', 'check.cjs']);
    await execute(git, ['-C', seed, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial K']);
    const K = (await execute(git, ['-C', seed, 'rev-parse', 'HEAD'])).stdout.trim();
    await execute(git, ['init', '--bare', receiver]);
    await execute(git, ['-C', seed, 'push', receiver, 'HEAD:refs/heads/main']);
    await fs.writeFile(path.join(source, 'consumer.cjs'), dirty);
    await fs.writeFile(path.join(source, 'check.cjs'), checker);
    let passed=false;
    let c = await openController({ installationHome: home, runtimeProfile, effectsProfile: { gitBinary: git } });
    process.env.TMPDIR=path.join(home,'artifacts');
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const { targetId } = await c.registerLocalTarget({ projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit: K, publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs'] });
        const model = scripted(), begun = await c.beginChange({ projectId: 'P', request: 'Export3; publish only agent delta, keep user local edit local', executionLimit: 64, resolutionLimit: 16 }), ready = await c.driveChange({ workId: begun.workId, model });
        assert.equal(ready.reviewReady, true, JSON.stringify(ready.blocked));
        await assert.rejects(c.prepareIntegration({ workId: begun.workId, targetId, model }), /No actual current owner grant/);
        c.delegateIntegration({ workId: begun.workId, targetId, mode: 'ordinary', operationLimit: 4 });
        const prepared = await c.prepareIntegration({ workId: begun.workId, targetId, model });
        assert.equal(prepared.phase, 'RESERVED', JSON.stringify(prepared));
        const derived = c.inspectChange(begun.workId);
        assert.notEqual(derived.candidateVersion, ready.candidateVersion);
        assert.ok(derived.checks.some(r => r.candidate === derived.candidateVersion && r.status === 'pass'));
        assert.ok(derived.launches.some(l => l.role === 'reviewer' && l.data.inputVersions.candidate === derived.candidateVersion));
        const rootView = derived.versions.find(v => v.id === derived.candidateVersion);
        assert.equal(await fs.readFile(path.join(rootView.artifact, 'consumer.cjs'), 'utf8'), initial.replace('exports=2', 'exports=3'));
        assert.equal((await execute(git, ['--git-dir=' + receiver, 'rev-parse', 'refs/heads/main'])).stdout.trim(), K);
        if(kind==='cancel'){
            const before=c.inspectWork(begun.workId);await c.cancelWork({workId:begun.workId,expectedEpoch:before.epoch});const cancelled=await c.dispatchIntegration({operationId:prepared.operationId});assert.equal(cancelled.phase,'REFUSED');assert.equal(c.inspectWork(begun.workId).state,'CANCELLED');assert.equal(c.inspectWork(begun.workId).epoch,before.epoch+1);assert.equal(c.store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='send'",prepared.operationId).length,0);assert.equal((await execute(git,['--git-dir='+receiver,'rev-parse','refs/heads/main'])).stdout.trim(),K);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE work=?',begun.workId).n,1);assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n,0);passed=true;return;
        }
        passed=true;
    }finally{await cleanupFixture(c,root,passed);}
}
test('actual original subject cancellation after preparation refuses launcher handoff and retains original operation/budget',{timeout:60000},()=>boundaryScenario('cancel'));
