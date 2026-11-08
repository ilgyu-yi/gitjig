// Actual author tool writes and charged repair; deliberate scripted bad behavior is not standing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
import { scripted, withValueCases } from './effect-fixture.mjs';
test('identical failed scope after one charged repair stops before another author or check', {
    timeout: 60000
}, async () => {
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parent && path.isAbsolute(parent));
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'scope-repeat-'))), source = path.join(root, 'source'), home = path.join(root, 'home');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
    await fs.writeFile(path.join(source, 'check.cjs'), withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
    process.env.TMPDIR = path.join(home, 'artifacts');
    const roles = [];
    let extra = false, c, passed = false;
    const model = scripted(undefined, ({ role, result }) => {
        roles.push(role);
        if (role === 'planner') {
            result.plan.requirements.push({
                id: 'scope', text: 'Only consumer.cjs changes', source: result.plan.requirements[0].source
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
    }), original = model.definition.streamSimple;
    model.definition.streamSimple = (m, context, options) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
            try {
                let message = await original(m, context, options).result();
                const first = context.messages.find(x => x.role === 'user'), text = first?.content.filter(x => x.type === 'text').map(x => x.text).join('') ?? '';
                if (text.startsWith('Perform the assigned implementer task') && message.stopReason === 'stop' && !extra) {
                    extra = true;
                    message = {
                        ...message, content: [
                            {
                                type: 'toolCall', id: 'forbidden-extra', name: 'write', arguments: {
                                    path: 'forbidden.txt', content: 'Actual disallowed author addition\n'
                                }
                            }
                        ], stopReason: 'toolUse'
                    };
                }
                stream.push({
                    type: 'done', reason: message.stopReason, message
                });
                stream.end(message);
            }
            catch (error) {
                const failure = {
                    role: 'assistant', content: [], api: m.api, provider: m.provider, model: m.id, usage: {
                        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {
                            input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0
                        }
                    }, stopReason: 'error', errorMessage: String(error), timestamp: Date.now()
                };
                stream.push({
                    type: 'error', reason: 'error', error: failure
                });
                stream.end(failure);
            }
        })();
        return stream;
    };
    try {
        c = await openController({
            installationHome: home, runtimeProfile: {
                dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, image: process.env.GITJIG_RUNTIME_IMAGE
            }
        });
        await c.registerProject({
            id: 'P', sourceRoot: source
        });
        const begun = await c.beginChange({
            projectId: 'P', request: 'Export3; only consumer.cjs changes', executionLimit: 16, resolutionLimit: 6
        }), held = await c.driveChange({
            workId: begun.workId, model
        });
        assert.equal(held.phase, 'BLOCKED', JSON.stringify(held.blocked));
        assert.match(held.blocked.join(), /Unchanged candidate repeats/);
        assert.equal(c.store.one("SELECT count(*) AS n FROM role_launches WHERE work=? AND role='repairer'", begun.workId).n, 1);
        assert.equal(c.store.one('SELECT count(*) AS n FROM check_runs WHERE work=?', begun.workId).n, 0);
        assert.ok(c.changeCore.pending(begun.workId).some(o => o.kind === 'verification-scope'));
        const before = held.execution.consumed, launches = c.store.all('SELECT * FROM role_launches WHERE work=?', begun.workId);
        const again = await c.driveChange({
            workId: begun.workId, model
        });
        assert.equal(again.phase, 'BLOCKED');
        assert.equal(again.execution.consumed, before);
        assert.deepEqual(c.store.all('SELECT * FROM role_launches WHERE work=?', begun.workId), launches);
        assert.equal(again.execution.reserved, 0);
        assert.equal(again.resolution.reserved, 0);
        await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify({
            root, workId: begun.workId, held, again, roles, scope: 'Actual SDK/engine author and charged repair; scripted judgments only'
        }, null, 2), {
            flag: 'wx', mode: 0o600
        });
        passed = true;
    }
    finally {
        await c?.close();
        console.log('RETAINED_SCOPE_REPEAT ' + root + ' passed=' + passed);
    }
});
