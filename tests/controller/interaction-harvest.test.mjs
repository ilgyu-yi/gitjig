import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { parseSessionEntries } from '@earendil-works/pi-coding-agent';
import { initializePiHost } from '../../dist/pi/index.js';
import { runRole } from '../../dist/workflow/index.js';
import { Store } from '../../dist/controller/store.js';
import { ChangeCore } from '../../dist/controller/change-core.js';
import { loadCriteriaSync } from '../../dist/controller/criteria.js';
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
test('actual native oversized intermediate findings retain bounded extraction or required omission diagnostic; prose stays nonfinding', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-harvest-'))), stateRoot = path.join(root, 'state'), artifactRoot = path.join(root, 'artifacts'), workRoot = path.join(root, 'work');
    for (const dir of [stateRoot, artifactRoot, workRoot])
        await fs.mkdir(dir, { mode: 0o700 });
    process.env.TMPDIR = artifactRoot;
    const host = await initializePiHost({ stateRoot, artifactRoot }), store = new Store(path.join(root, 'core.sqlite'));
    const operations = { workspaceRoot: workRoot, validatePath(value) {
            const target = path.resolve(workRoot, value), relative = path.relative(workRoot, target);
            if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative))
                throw Error('Outside owned test root');
            return target;
        }, async exec() {
            throw Error('No execution route');
        }, async readFile() {
            throw Error('No file route');
        }, async access() {
            throw Error('No file route');
        }, async writeFile() {
            throw Error('No file route');
        }, async mkdir() {
            throw Error('No file route');
        } };
    try {
        for (const world of ['bounded-findings', 'oversized-findings', 'ordinary-prose']) {
            const id = world, expected = { requirementId: 'R1', severity: 'blocking', repair: 'unknown', description: world === 'oversized-findings' ? 'F1 ' + 'x'.repeat(140000) : 'Exact F1 beyond the raw prefix', evidence: ['E1'] };
            const first = world === 'ordinary-prose' ? 'ordinary tool explanation '.repeat(7000) : JSON.stringify({ version: 1, summary: 'x'.repeat(140000), findings: [expected], assessedScope: [] });
            const clear = JSON.stringify({ version: 1, summary: 'Current source assessed', findings: [], assessedScope: [] });
            let native, requests = 0;
            const model = { provider: 'harvest-' + id, modelId: 'fixture', definition: { api: 'fixture-api', apiKey: 'fixture-only', baseUrl: 'http://unused.invalid', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }], streamSimple(m) {
                        const n = requests++;
                        if (n < 2)
                            void native.followUp('Continue current actual native response ' + n);
                        const stream = createAssistantMessageEventStream();
                        queueMicrotask(() => {
                            const message = { role: 'assistant', content: [{ type: 'text', text: n < 2 ? first : clear }], api: m.api, provider: m.provider, model: m.id, usage, stopReason: 'stop', timestamp: Date.now() };
                            stream.push({ type: 'done', reason: 'stop', message });
                            stream.end(message);
                        });
                        return stream;
                    } } };
            const identity = { conversationId: id, workId: id, runId: id, launchId: id, generation: 1, directionRevision: 0, initialInputId: id };
            const result = await runRole({ launchId: id, role: 'reviewer', inputBundle: { requirements: [{ id: 'R1', text: 'Preserve actual finding occurrences', source: 'S' + id }], contracts: 'Preserve findings before final selection', context: {}, sources: [], requiredScope: [] }, operations, host, model, assertEntry() {
                }, async beforeModelRequest(manager) {
                    assert.ok(manager.getLeafId());
                }, nativeIdentity: identity, nativeLifecycle: { ready(r) {
                        native = r.session;
                    }, settling() {
                    }, released() {
                    } } });
            assert.equal(result.usable, true, JSON.stringify(result));
            assert.equal(requests, 3);
            const entries = parseSessionEntries(await fs.readFile(result.historyRef, 'utf8')), assistants = entries.filter(e => e.type === 'message' && e.message.role === 'assistant');
            assert.equal(assistants.length, 3);
            assert.notEqual(assistants[0].id, assistants[1].id);
            store.run('INSERT INTO sources VALUES(?,?,?,?)', 'S' + id, null, '{}', 'R1');
            store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', id, null, 'S' + id, null, id, 'ACTIVE', 1, 1, null, '{}');
            store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', id, id, 1, 1, 'SETTLED', workRoot, 'consumed', '{}');
            store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', id, id, id, 'reviewer', 1, 'COMPLETE', 'consumed', '{}');
            // This collector fixture must have current criteria so drive reaches the
            // producer-completeness hold rather than an unrelated criteria hold.
            const criteria=loadCriteriaSync(),contracts='contracts-'+id;
            store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',contracts,id,'contracts',null,null,criteria.hash,JSON.stringify({text:criteria.text,assets:criteria.assets}));
            store.run('INSERT INTO change_state VALUES(?,?,?,?,?,?,?,?)', id, 'RESOLVING', null, null, null, null, 1, JSON.stringify({contractsVersion:contracts}));
            store.run('INSERT INTO budgets VALUES(?,?,?,?,?)', id, 'execution', 8, 1, 0);
            store.run('INSERT INTO budgets VALUES(?,?,?,?,?)', id, 'resolution', 8, 1, 0);
            const core = new ChangeCore({ store, assertOpen() {
                }, busy() {
                    return false;
                }, sourceImpacts() {
                    return [];
                } });
            core.harvestEntries(id, id, 'reviewer', entries, result, result.selectedFinalEntryId);
            core.collect(id, id, { ...result, nativeEntryId: result.selectedFinalEntryId }, result.usable);
            const occurrences = store.all('SELECT * FROM finding_occurrences WHERE work=?', id), outputs = store.all('SELECT * FROM role_outputs WHERE launch=?', id);
            assert.equal(occurrences.length, world === 'ordinary-prose' ? 0 : 2);
            if (world === 'bounded-findings')
                for (const row of occurrences)
                    assert.deepEqual(JSON.parse(row.data).finding, expected);
            if (world === 'oversized-findings')
                for (const row of occurrences) {
                    const finding = JSON.parse(row.data).finding;
                    assert.equal(finding.requirementId, 'producer-integrity');
                    assert.match(finding.description, /1 findings exceeding/);
                    assert.ok(finding.evidence.includes(result.historyRef));
                }
            if (world !== 'ordinary-prose')
                for (const row of outputs.filter(o => o.status === 'accounted-intermediate')) {
                    assert.ok(Buffer.byteLength(row.raw) <= 128 * 1024);
                    assert.equal(JSON.parse(row.data).rawFinalTruncated, true);
                    assert.ok(JSON.parse(row.data).nativeEntryId);
                }
            core.harvestEntries(id, id, 'reviewer', entries, result, result.selectedFinalEntryId);
            assert.equal(store.all('SELECT * FROM finding_occurrences WHERE work=?', id).length, occurrences.length);
            assert.equal(core.pending(id).filter(o => o.kind === 'finding').length, occurrences.length);
            if (world === 'oversized-findings') {
                assert.equal(core.pending(id).filter(o => o.kind === 'raw-findings-incomplete').length, 2);
                core.resumeDiagnostics(id);
                core.dispositions(id, id, { decisions: occurrences.map(o => ({ occurrenceId: o.id, disposition: 'rejected', reason: 'This attempted independent rejection cannot establish missing producer completeness', witnesses: ['clear-final'] })) });
                core.collect(id, id, { ...result, nativeEntryId: 'later-clear' }, true);
                const beforeRuns = store.all('SELECT id FROM runs WHERE work=?', id).length;
                const blocked = await core.drive({ workId: id, model, maximumSteps: 8 });
                assert.equal(blocked.phase, 'BLOCKED');
                assert.equal(blocked.reviewReady, false);
                assert.equal(blocked.execution.consumed, 1);
                assert.match(blocked.nextAction, /exact native history/);
                assert.equal(store.all('SELECT id FROM runs WHERE work=?', id).length, beforeRuns);
                assert.equal(core.pending(id).filter(o => o.kind === 'raw-findings-incomplete').length, 2);
            }
        }
    }
    finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
