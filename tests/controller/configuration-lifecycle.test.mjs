import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openController } from '../../dist/controller/index.js';
import { configureOwnedRepositoryConfigurationFixture } from '../../.qualification/controller-testing.js';
import { configurationServer, configurationTarget } from './configuration-fixture.mjs';

async function fixture(t) {
    const server = await configurationServer();
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-config-life-')));
    const home = path.join(root, 'home');
    const controller = await openController({ installationHome: home });
    t.after(async () => {
        await controller.close();
        await server.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const target = controller.registerRepositoryConfigurationTarget({ target: configurationTarget });
    configureOwnedRepositoryConfigurationFixture(controller, { origin: server.origin, token: 'fixture-original' });
    const plan = await controller.previewRepositoryConfiguration({
        targetId: target.targetId,
        profile: { version: 'owner-selected-merge', mergeMethods: { rebase: true } },
    });
    assert.equal(plan.phase, 'PREVIEWED');
    return { server, home, controller, plan };
}

for (const action of ['cancel', 'close']) {
    test(`configuration ${action} during actual preflight returns the retained cancellation and prevents a write`,
        { timeout: 5000 }, async t => {
            const { server, home, controller, plan } = await fixture(t);
            const unhandled = [];
            const listener = error => unhandled.push(error);
            process.on('unhandledRejection', listener);
            t.after(() => process.removeListener('unhandledRejection', listener));
            const hold = server.holdNext();
            try {
                const attempt = controller.applyRepositoryConfiguration({ planId: plan.planId });
                await hold.entered;
                if (action === 'cancel') await controller.cancelWork({ workId: plan.workId });
                else await controller.close();
                const result = await attempt;
                assert.equal(result.phase, 'CANCELLED');
                assert.equal(server.requests.filter(request => request.method !== 'GET').length, 0);
                await controller.close();
                const reopened = await openController({ installationHome: home });
                try {
                    const work = reopened.inspectWork(plan.workId);
                    const retained = reopened.inspectRepositoryConfiguration(plan.planId);
                    assert.equal(work.state, 'CANCELLED');
                    assert.equal(work.allowance.reserved, 0);
                    assert.equal(work.allowance.consumed, 2);
                    assert.equal(retained.phase, result.phase);
                    assert.equal(retained.steps[0].state, 'PENDING');
                    await new Promise(resolve => setImmediate(resolve));
                    assert.deepEqual(unhandled, []);
                } finally {
                    await reopened.close();
                }
            } finally {
                hold.release();
            }
        });
}

test('configuration close joins a possible native write and retains the original uncertain result', { timeout: 5000 }, async t => {
    const { server, home, controller, plan } = await fixture(t);
    const applicationsClosed = Promise.withResolvers();
    controller.adoptApplicationResource({ close: async () => applicationsClosed.resolve() });
    const hold = server.holdNext('/repos/owner/repo', 'PATCH');
    try {
        const attempt = controller.applyRepositoryConfiguration({ planId: plan.planId });
        await hold.entered;
        assert.equal(controller.inspectRepositoryConfiguration(plan.planId).steps[0].state, 'INVOKING');
        const closing = controller.close();
        let closed = false;
        void closing.then(() => { closed = true; }, () => {});
        await applicationsClosed.promise;
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(closed, false);
        server.setDrop(true);
        hold.release();
        const [result] = await Promise.all([attempt, closing]);
        assert.equal(result.phase, 'UNKNOWN');
        assert.equal(result.steps[0].state, 'UNKNOWN');
        assert.equal(server.requests.filter(request => request.method === 'PATCH').length, 1);
        assert.equal(server.repo.allow_rebase_merge, true);

        const reopened = await openController({ installationHome: home });
        try {
            const retained = reopened.inspectRepositoryConfiguration(plan.planId);
            assert.equal(retained.phase, result.phase);
            assert.equal(retained.steps[0].state, 'UNKNOWN');
            assert.equal(reopened.inspectWork(plan.workId).allowance.reserved, 0);
        } finally {
            await reopened.close();
        }
    } finally {
        hold.release();
    }
});
