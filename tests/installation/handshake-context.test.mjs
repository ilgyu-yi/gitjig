import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

test('actual health roles use bounded fixture contracts while retaining complete current criteria identity', {timeout: 30000}, async t => {
    const root = await temporaryDirectory('handshake-context');
    const artifacts = path.join(root, 'artifacts');
    await fs.mkdir(artifacts, {mode: 0o700});
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained actual handshake context: ' + root);
    });
    const {stdout} = await promisify(execFile)(process.execPath, ['dist/installation/handshake.js', root], {
        env: {...process.env, TMPDIR: artifacts, NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: ''},
        timeout: 25000, maxBuffer: 2 ** 20,
    });
    const result = JSON.parse(stdout);
    assert.equal(result.liveStanding, false);
    assert.equal(result.roleFixture.liveStanding, false);
    assert.equal(result.roleFixture.loadedCriteriaScope, 'asset-load-and-identity-only');
    assert.match(result.roleFixture.contracts, /^Installation health only:/u);
    assert.deepEqual(Object.keys(result.criteria.assets).sort(), ['CONTRACTS.md','DESIGN.md','MISSION.md','PRINCIPLES.md']);
    for (const [name, asset] of Object.entries(result.criteria.assets)) {
        assert.equal(asset.sha256, createHash('sha256').update(await fs.readFile(name)).digest('hex'));
        assert.ok(asset.selected.length > 0);
    }
    assert.deepEqual(result.roles.map(role => role.role), ['planner','challenger','adjudicator','implementer','reviewer','repairer','confirmer']);
    assert.equal(new Set(result.roles.map(role => role.nativeSessionId)).size, 7);
    for (const role of result.roles) {
        assert.equal(role.usable, true);
        assert.equal(role.providerRequests, 1);
        assert.ok(role.checkpoint.leafId);
        const history = await fs.readFile(role.history, 'utf8');
        assert.ok(history.includes(role.selectedFinalEntryId));
        assert.ok(history.includes(result.roleFixture.contracts));
        assert.ok(history.includes(result.criteria.hash));
        assert.ok(!history.includes('Product normative workflow criteria.'));
    }
    passed = true;
});
