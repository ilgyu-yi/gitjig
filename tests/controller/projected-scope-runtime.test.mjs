// Actual normal procedures/SDK/engine/local Git. Scripted judgment, no paid provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { openController } = await import(process.env.GITJIG_SCOPE_CONTROLLER ?? '../../dist/controller/index.js');
import { scripted, withValueCases } from './effect-fixture.mjs';
const execute = promisify(execFile), git = '/opt/homebrew/bin/git';
test('normal typed complete scope survives native Git administration projection and same-original send after reopen', {
    timeout: 120000
}, async () => {
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parent && path.isAbsolute(parent));
    assert.equal(await fs.realpath(parent), parent);
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'projected-scope-'))), source = path.join(root, 'source'), home = path.join(root, 'home'), receiver = path.join(root, 'receiver.git');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
    await fs.writeFile(path.join(source, 'check.cjs'), withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
    const command = async (args) => (await execute(git, args, {
        timeout: 10000
    })).stdout.trim();
    await command([
        'init', '--template=', '--initial-branch=main', source
    ]);
    await command([
        '-C', source, 'add', '.'
    ]);
    await command([
        '-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial scope fixture'
    ]);
    const basis = await command([
        '-C', source, 'rev-parse', 'HEAD'
    ]);
    await command([
        'clone', '--bare', '--template=', source, receiver
    ]);
    await command([
        '--git-dir=' + receiver, 'config', '--remove-section', 'remote.origin'
    ]);
    const runtimeProfile = {
        dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, image: process.env.GITJIG_RUNTIME_IMAGE
    };
    assert.ok(runtimeProfile.dockerContext && runtimeProfile.image);
    process.env.TMPDIR = path.join(home, 'artifacts');
    let c, passed = false;
    const roles = [];
    const model = scripted(undefined, ({ role, result }) => {
        roles.push(role);
        if (role === 'planner') {
            result.plan.requirements.push({
                id: 'scope', text: 'Change only consumer.cjs and preserve owner check', source: result.plan.requirements[0].source
            });
            result.plan.verification.strategies = [
                {
                    requirementId: 'R1', kind: 'consumer-cases', checkIds: [
                        'value'
                    ]
                }, {
                    requirementId: 'scope', kind: 'manifest-scope-duty', allowedChangePaths: [
                        'consumer.cjs'
                    ], unchangedPaths: [
                        'check.cjs'
                    ], reviewKey: 'general'
                }
            ];
        }
    });
    try {
        c = await openController({
            installationHome: home, runtimeProfile, effectsProfile: {
                gitBinary: git
            }
        });
        await c.registerProject({
            id: 'P', sourceRoot: source
        });
        const { targetId } = await c.registerLocalTarget({
            projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit: basis, publicationInventory: [
                'consumer.cjs', 'check.cjs'
            ], authorizedDeltaPaths: [
                'consumer.cjs'
            ]
        });
        const begun = await c.beginChange({
            projectId: 'P', request: 'Export3; only consumer.cjs changes, fixed owner check unchanged; deliver to owned local receiver', executionLimit: 24, resolutionLimit: 8
        });
        const ready = await c.driveChange({
            workId: begun.workId, model
        });
        assert.equal(ready.reviewReady, true, JSON.stringify(ready.blocked));
        const originalBase = c.changeCore.version(ready.baseVersion), originalCandidate = c.changeCore.version(ready.candidateVersion);
        assert.ok(originalBase.data.manifest.files.some(f => f.path === '.git/HEAD'));
        assert.ok(originalCandidate.data.manifest.files.some(f => f.path === '.git/HEAD'));
        c.delegateIntegration({
            workId: begun.workId, targetId, mode: 'ordinary', operationLimit: 1
        });
        const prepared = await c.prepareIntegration({
            workId: begun.workId, targetId, model
        });
        assert.equal(prepared.phase, 'RESERVED', JSON.stringify(prepared));
        const derived = c.inspectChange(begun.workId);
        assert.equal(derived.reviewReady, true);
        assert.notEqual(derived.candidateVersion, ready.candidateVersion);
        assert.ok(!c.changeCore.version(derived.candidateVersion).data.manifest.files.some(f => f.path.startsWith('.git/')));
        assert.equal(roles.filter(r => r === 'repairer').length, 0);
        assert.ok(c.store.all("SELECT data FROM change_versions WHERE work=? AND kind='scope-evidence'", begun.workId).some(r => JSON.parse(r.data).evidence.base.scopeView));
        assert.deepEqual(c.changeCore.version(ready.baseVersion), originalBase);
        assert.deepEqual(c.changeCore.version(ready.candidateVersion), originalCandidate);
        await c.close();
        c = await openController({
            installationHome: home, runtimeProfile, effectsProfile: {
                gitBinary: git
            }
        });
        const sent = await c.dispatchIntegration({
            operationId: prepared.operationId
        });
        assert.equal(sent.phase, 'CONFIRMED', JSON.stringify(sent));
        assert.equal(await command([
            '--git-dir=' + receiver, 'show', 'refs/heads/main:consumer.cjs'
        ]), 'module.exports=3;');
        assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n');
        assert.equal(await command([
            '-C', source, 'rev-parse', 'HEAD'
        ]), basis);
        await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify({
            scope: 'Actual typed scope/SDK/engine/Git; scripted judgments only', root, workId: begun.workId, ready, derived, sent, roles, originalBase, originalCandidate
        }, null, 2), {
            flag: 'wx', mode: 0o600
        });
        passed = true;
    }
    finally {
        await c?.close();
        console.log('RETAINED_PROJECTED_SCOPE ' + root + ' passed=' + passed);
    }
});
