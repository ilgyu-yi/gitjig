// Closed historical guard fixtures. Real Native correspondence is exercised separately.
import test from 'node:test';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { freeze, effective, hash } from '../../dist/controller/change-files.js';
import { manifestScopeEvidence } from '../../dist/controller/verification-strategies.js';
import { nativeAdministrativeScopeView, administrativeScopeBaseline } from '../../dist/controller/scope-projection.js';
const strategy = {
    requirementId: 'scope', kind: 'manifest-scope-duty', allowedChangePaths: [
        'consumer.cjs'
    ], unchangedPaths: [
        'owner.txt'
    ], reviewKey: 'general'
};
let seed, seedRoot;
async function capturedSeed() {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scope-projection-'))), source = path.join(root, 'source');
    await fs.mkdir(path.join(source, '.git'), {
        recursive: true
    });
    await fs.writeFile(path.join(source, '.git/HEAD'), 'ref: refs/heads/main\n');
    await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
    await fs.writeFile(path.join(source, 'owner.txt'), 'fixed');
    const b = await freeze(source, path.join(root, 'B'), {});
    await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=3;\n');
    const c = await freeze(source, path.join(root, 'C'), {});
    seedRoot = root;
    return {
        b, c
    };
}
process.once('exit', code => {
    if (code === 0 && seedRoot)
        rmSync(seedRoot, {
            recursive: true, force: true
        });
});
async function fixture(t) {
    const { b, c } = structuredClone(await (seed ??= capturedSeed()));
    const base = {
        id: 'B', work: 'W', kind: 'base', predecessor: null, hash: b.digest, data: {
            manifest: b.manifest
        }
    }, previous = {
        id: 'C', work: 'W', kind: 'candidate', predecessor: 'B', hash: c.digest, data: {
            manifest: c.manifest
        }
    }, manifest = administrativeScopeBaseline(c.manifest), native = {
        baseVersion: 'B', targetId: 'T', basisCommit: '1'.repeat(40), headCommit: '2'.repeat(40), integrationCommit: '2'.repeat(40), tree: '3'.repeat(40), receiptId: 'I'
    }, projected = {
        id: 'H', work: 'W', kind: 'candidate', predecessor: 'C', hash: hash(effective(manifest)), data: {
            manifest, derived: 'publication-projection', producer: 'O', native
        }
    };
    const projection = {
        id: 'P', sequence: 1, operation: 'O', kind: 'projection', data: JSON.stringify({
            kind: 'projected', receipt: {
                operationId: 'O', sourceVersions: {
                    base: 'B', candidate: 'C'
                }, sourceDigests: {
                    base: base.hash, candidate: previous.hash
                }, basisCommit: native.basisCommit, projectedCommit: native.headCommit, projectedTree: native.tree
            }
        })
    }, integration = {
        id: 'I', sequence: 2, operation: 'O', kind: 'integration', data: JSON.stringify({
            kind: 'candidate', head: native.headCommit, commit: native.integrationCommit, tree: native.tree, files: manifest.files.map(f => ({
                path: f.path, sha256: f.sha256, mode: '100644'
            }))
        })
    }, op = {
        id: 'O', work: 'W', target: 'T', phase: 'REFUSED'
    }, versions = {
        B: base, C: previous, H: projected
    };
    const store = {
        one(sql, id) {
            return sql.includes('effect_operations') ? (id === op.id ? op : undefined) : [
                projection, integration
            ].find(r => r.id === id);
        }, all(sql, id) {
            return id === op.id ? [
                projection
            ] : [];
        }
    };
    return {
        base, previous, projected, versions, store, op, projection, integration, view: () => nativeAdministrativeScopeView(store, 'W', base, projected, id => versions[id])
    };
}
test('raw BASE and ordinary v1 stay exact while a qualified native view removes only baseline administration', async (t) => {
    const f = await fixture(t), before = structuredClone(f.base);
    assert.equal(manifestScopeEvidence(f.base, f.projected, strategy, {}).actual.satisfied, false);
    const view = f.view(), e = manifestScopeEvidence(f.base, f.projected, strategy, {}, {}, view);
    assert.equal(e.actual.satisfied, true);
    assert.equal(e.actual.changedCount, 1);
    assert.equal(e.base.id, 'B');
    assert.equal(e.base.digest, f.base.hash);
    assert.notEqual(e.base.scopeView.digest, f.base.hash);
    assert.equal(e.adverse.observation.satisfied, false);
    assert.deepEqual(f.base, before);
    assert.equal(manifestScopeEvidence(f.base, f.previous, strategy, {}).predicate, 'complete-effective-manifest-scope/v1');
});
test('actual candidate remains unfiltered: restored/changed administration and owner deletion still violate', async (t) => {
    const f = await fixture(t), view = f.view();
    for (const kind of [
        'git', 'owner', 'mode', 'directory'
    ]) {
        const c = structuredClone(f.projected), m = c.data.manifest;
        if (kind === 'git') {
            const dir = f.base.data.manifest.directories.find(d => d.path === '.git'), file = f.base.data.manifest.files.find(f => f.path === '.git/HEAD');
            m.directories.push(dir);
            m.files.push(file);
        }
        else if (kind === 'owner')
            m.files = m.files.filter(f => f.path !== 'owner.txt');
        else if (kind === 'mode') {
            const file = m.files.find(f => f.path === 'owner.txt');
            file.mode |= 0o100;
            file.effectiveMode |= 0o100;
        }
        else
            m.directories.push({
                path: 'unexpected', mode: 0o700, effectiveMode: 0o700
            });
        m.entries = m.files.length + m.directories.length;
        m.bytes = m.files.reduce((n, f) => n + f.size, 0);
        c.hash = hash(effective(m));
        assert.equal(manifestScopeEvidence(f.base, c, strategy, {}, {}, view).actual.satisfied, false, kind);
    }
});
test('foreign/missing historical receipt, source, target, tree, nonadmin omission and authored git deletion cannot qualify', async (t) => {
    const mutations = [
        f => f.op.target = 'foreign', f => f.integration.operation = 'foreign', f => f.integration.kind = 'other', f => f.projected.data.native.tree = 'changed', f => f.projected.data.native.baseVersion = 'other', f => f.previous.work = 'other', f => f.previous.data.manifest.files.pop(), f => {
            f.previous.data.manifest.files = f.previous.data.manifest.files.filter(x => !x.path.startsWith('.git/'));
        }, f => {
            const p = JSON.parse(f.projection.data);
            p.receipt.sourceVersions.candidate = 'other';
            f.projection.data = JSON.stringify(p);
        }, f => f.projected.predecessor = 'H', f => f.projected.data.derived = 'unknown'
    ];
    for (const mutate of mutations) {
        const f = await fixture(t);
        mutate(f);
        assert.throws(() => f.view());
    }
});
test('repair ancestry and a second exact same-op projection preserve original root despite later phase changes', async (t) => {
    const f = await fixture(t), repair = {
        ...structuredClone(f.projected), id: 'R', predecessor: 'H', data: {
            manifest: structuredClone(f.projected.data.manifest), producer: 'repairer'
        }
    };
    f.versions.R = repair;
    assert.ok(nativeAdministrativeScopeView(f.store, 'W', f.base, repair, id => f.versions[id]));
    const second = {
        ...structuredClone(f.projected), id: 'H2', predecessor: 'R', data: {
            ...structuredClone(f.projected.data), native: {
                ...f.projected.data.native, receiptId: 'I2'
            }
        }
    };
    f.versions.H2 = second;
    const p = JSON.parse(f.projection.data);
    p.receipt.sourceVersions.candidate = 'R';
    p.receipt.sourceDigests.candidate = repair.hash;
    const p2 = {
        ...f.projection, id: 'P2', sequence: 3, data: JSON.stringify(p)
    }, i2 = {
        ...f.integration, id: 'I2', sequence: 4
    }, store = {
        one(sql, id) {
            return sql.includes('effect_operations') ? f.op : [
                f.integration, i2
            ].find(r => r.id === id);
        }, all() {
            return [
                f.projection, p2
            ];
        }
    };
    const view = nativeAdministrativeScopeView(store, 'W', f.base, second, id => f.versions[id]);
    assert.equal(view.proof.roots.length, 2);
    assert.equal(manifestScopeEvidence(f.base, second, strategy, {}, {}, view).actual.satisfied, true);
});
test('no-administration original BASE retains ordinary derived/raw scope; foreign selected BASE never gains a view', async (t) => {
    const f = await fixture(t), base = {
        ...f.base, data: {
            manifest: administrativeScopeBaseline(f.base.data.manifest)
        }
    };
    base.hash = hash(effective(base.data.manifest));
    const candidate = {
        ...f.projected, data: {
            ...f.projected.data, derived: 'base-integration'
        }
    };
    assert.equal(nativeAdministrativeScopeView(f.store, 'W', base, candidate, id => f.versions[id]), undefined);
    assert.equal(manifestScopeEvidence(base, candidate, strategy, {}).actual.satisfied, true);
    assert.throws(() => nativeAdministrativeScopeView(f.store, 'W', {
        ...f.base, work: 'foreign'
    }, f.projected, id => f.versions[id]));
});
test('no-admin native publication needs no waiver when raw scope passes, but unknown or failing projection holds', async (t) => {
    const f = await fixture(t), base = {
        ...f.base, data: {
            manifest: administrativeScopeBaseline(f.base.data.manifest)
        }
    };
    base.hash = hash(effective(base.data.manifest));
    assert.equal(nativeAdministrativeScopeView(f.store, 'W', base, f.projected, id => f.versions[id], true), undefined);
    assert.throws(() => nativeAdministrativeScopeView(f.store, 'W', base, f.projected, id => f.versions[id], false), /no author repair/);
    const unknown = {
        ...f.projected, data: {
            ...f.projected.data, derived: 'unknown'
        }
    };
    assert.throws(() => nativeAdministrativeScopeView(f.store, 'W', base, unknown, id => f.versions[id], true));
});
test('later equivalent preparation receipts never change an earlier immutable scope-root proof', async (t) => {
    const f = await fixture(t), first = f.view();
    const duplicate = {
        ...f.projection, id: 'later', sequence: 3
    }, store = {
        ...f.store, all() {
            return [
                f.projection, duplicate
            ];
        }
    };
    const later = nativeAdministrativeScopeView(store, 'W', f.base, f.projected, id => f.versions[id]);
    assert.deepEqual(later, first);
    const borrowed = {
        ...f.store, all() {
            return [
                duplicate
            ];
        }
    };
    assert.throws(() => nativeAdministrativeScopeView(borrowed, 'W', f.base, f.projected, id => f.versions[id]));
});
