import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { managedModelGuidance, managedModelRepairDetail } from '../../dist/ui/managed-model-guidance.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { readinessCommands } from '../../dist/ui/readiness-commands.js';

async function createManagedWorkFixture(t, available = [], overrides = {}, differentCurrent = true, originalProvider = 'base') {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/managed-guidance-')));
    const home = path.join(root, 'app');
    const source = path.join(root, 'project');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'a.txt'), 'owned source');
    const c = await openController({
        installationHome: home,
        runtimeProfile: { dockerBinary: '/usr/bin/false', dockerContext: 'fixture', image: 'sha256:' + '0'.repeat(64) }
    });
    const models = new ApplicationModels(c);
    const accounts = ApplicationAccounts.open(c);
    models.install({ resumeAuthorized: false });
    t.after(async () => {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    await c.registerProject({ id: 'P', sourceRoot: source });
    await accounts.configure({
        providers: Object.fromEntries([originalProvider, 'override', 'current'].map(provider => [
            provider,
            {
                api: 'openai-completions',
                baseUrl: 'http://127.0.0.1:9/v1',
                ...(available.includes(provider) ? { apiKey: 'DUMMY_' + provider } : {}),
                models: [{ id: 'fixture' }]
            }
        ]))
    });
    for (const [role, provider] of Object.entries(overrides))
        await models.setRole(role, await models.choice(provider, 'fixture'));
    const chosen = await models.choice(originalProvider, 'fixture');
    const view = await models.newConversation({ projectId: 'P', choice: chosen });
    const baseline = {
        ...await models.baseline('P', chosen),
        source: {
            kind: 'conversation',
            conversationId: view.conversationId,
            choiceRevision: c.getConversationModelChoice(view.conversationId).revision
        }
    };
    c.changes.drive = async (input) => c.changes.inspect(input.workId);
    const work = await c.startConversationChange({
        conversationId: view.conversationId,
        expectedGeneration: 0,
        expectedModelRevision: baseline.source.choiceRevision,
        projectId: 'P',
        request: 'Retain the original stage source',
        applicationModelBaseline: baseline
    });
    if (differentCurrent)
        await c.cancelWork({ workId: work.workId });
    const now = c.inspectConversation(view.conversationId);
    if (differentCurrent)
        await models.select({
            conversationId: view.conversationId,
            expectedGeneration: now.generation,
            expectedRevision: c.getConversationModelChoice(view.conversationId).revision,
            provider: 'current',
            modelId: 'fixture'
        });
    const host = { controller: c, models, accounts };
    const assessment = () => managedModelGuidance(host, work.workId);
    const state = c.store.one('SELECT * FROM change_state WHERE work=?', work.workId);
    const plan = {
        requirements: [{ id: 'req' }],
        verification: {
            checks: [
                {
                    guaranteeIds: ['req'],
                    cases: [
                        { id: 'healthy', kind: 'healthy', guaranteeIds: ['req'] },
                        { id: 'adverse', kind: 'adverse', guaranteeIds: ['req'] }
                    ]
                }
            ]
        }
    };
    c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'fixture-plan', work.workId, 'plan', work.baseVersion, null, 'fixture-metadata-only', JSON.stringify({ plan }));
    const stage = (phase, patch = {}) => c.store.run('UPDATE change_state SET phase=?,plan=?,data=? WHERE work=?', phase, phase === 'BASE_CAPTURED' ? null : 'fixture-plan', JSON.stringify({ ...JSON.parse(state.data), ...patch }), work.workId);
    return { root, home, c, models, accounts, view, work, baseline, host, assessment, state, stage };
}
for (const scenario of [
    {
        name: 'missing retained source is not masked by a configured current choice',
        available: ['current'],
        overrides: {},
        missing: ['base']
    },
    {
        name: 'missing current choice does not block a configured original source',
        available: ['base'],
        overrides: {},
        missing: []
    },
    {
        name: 'all planning role overrides can replace an unavailable baseline',
        available: ['override', 'current'],
        overrides: { planner: 'override', challenger: 'override', adjudicator: 'override' },
        missing: []
    },
    {
        name: 'missing planning override blocks even when baseline is configured',
        available: ['base', 'current'],
        overrides: { planner: 'override' },
        missing: ['override']
    },
    {
        name: 'unrelated future-role override is not a planning prerequisite',
        available: ['base', 'current'],
        overrides: { reviewer: 'override' },
        missing: []
    },
])
    test(scenario.name, async (t) => {
        const f = await createManagedWorkFixture(t, scenario.available, scenario.overrides);
        const before = JSON.stringify(f.c.store.all('SELECT * FROM budgets'));
        const result = f.assessment();
        assert.equal(result.stage, 'plan');
        assert.deepEqual(result.issues.filter(issue => issue.kind === 'account').map(issue => issue.provider), scenario.missing);
        assert.equal(f.c.getWorkApplicationModelBaseline(f.work.workId).choice.provider, 'base');
        assert.equal(f.c.getConversationModelChoice(f.view.conversationId).provider, 'current');
        assert.equal(JSON.stringify(f.c.store.all('SELECT * FROM budgets')), before);
        assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n, 1);
        // Exercise the original execution resolver before any run/scope allocation.
        const expected = scenario.overrides.planner ?? 'base';
        if (scenario.available.includes(expected)) {
            const actual = await f.c.changes.selectRoleModel(f.models.workOperation(f.work.workId), 'planner');
            assert.equal(actual.model.provider, expected);
        }
        else
            await assert.rejects(f.c.changes.selectRoleModel(f.models.workOperation(f.work.workId), 'planner'), /account is missing/);
    });

test('repair detail respects actual mutation holds and keeps the original identity and spend', async (t) => {
    const f = await createManagedWorkFixture(t, ['current'], {}, false);
    const assessment = f.assessment();
    assert.throws(() => f.c.assertApplicationMutationAllowed(), /retained conversation obligations/);
    const detail = managedModelRepairDetail(f.c, f.work.workId, assessment);
    assert.match(detail, /\/change cancel/);
    assert.match(detail, /\/login base/);
    assert.ok(detail.includes('/change resume ' + f.work.workId));
    assert.match(detail, /does not guarantee/);
    let review;
    const commands = new HostCommands(readinessCommands({
        ...f.host,
        isCurrent: () => true,
        choose: async (title, rows) => {
            if (title === 'Choose a recovery action') { assert.ok(rows.includes('Back to setup overview')); assert.ok(!rows.some(row => row.startsWith('Choose another current model'))); return undefined; }
            assert.match(rows[0], /original work model\/account prerequisites/);
            return review ? undefined : rows[0];
        },
        show: async (_title, text) => { review = text; },
        execute: async () => assert.fail('Inspection dispatched an action'),
    }));
    await commands.execute('/ready', f.view.conversationId);
    assert.match(review, /\/change cancel/);
    assert.equal(f.c.inspectWork(f.work.workId).state, 'ACTIVE');
    assert.equal(f.c.inspectChange(f.work.workId).execution.consumed, 1);
});

test('checks and review-ready checkpoints do not require a model account; unknown recovery takes priority', async (t) => {
    const f = await createManagedWorkFixture(t, []);
    f.stage('CANDIDATE_CAPTURED');
    assert.deepEqual(f.assessment().issues, []);
    f.stage('REVIEW_READY');
    assert.deepEqual(f.assessment().issues, []);
    f.c.store.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', f.work.workId);
    assert.equal(f.assessment().stage, 'held');
    assert.deepEqual(f.assessment().issues, []);
});

test('malformed role preferences are inspectable and explicit-profile work ignores application overrides', async (t) => {
    const f = await createManagedWorkFixture(t, ['base']);
    await fs.writeFile(path.join(f.home, 'config/role-models.json'), '{PRIVATE_INVALID_ROLE_SETTINGS', { mode: 0o600 });
    const result = f.assessment();
    assert.deepEqual(result.issues.map(issue => issue.kind), ['role-config']);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_INVALID'));
    const standalone = await f.c.beginChange({ projectId: 'P', request: 'Original external source' });
    const external = managedModelGuidance({ ...f.host, externalModel: { provider: 'explicit', modelId: 'original' } }, standalone.workId);
    assert.deepEqual(external.issues, []);
    const missing = managedModelGuidance(f.host, standalone.workId);
    assert.equal(missing.issues[0].kind, 'external');
    const detail = managedModelRepairDetail(f.c, standalone.workId, missing);
    assert.ok(!detail.includes('/change cancel'));
    assert.match(detail, /--model-profile/);
});

test('each finite stage uses only its mandatory role sources and bridge absence stays distinct', async (t) => {
    const f = await createManagedWorkFixture(t, ['base'], { reviewer: 'override' });
    for (const [phase, roles] of [
        ['PLAN_READY', ['implementer']],
        ['CHECKED', ['reviewer']],
        ['RESOLVING', ['adjudicator']],
        ['REPAIR_REQUIRED', ['repairer']],
        ['NIT_AUTHORIZED', ['confirmer']]
    ]) {
        f.stage(phase);
        const actual = f.assessment();
        assert.deepEqual(f.c.inspectChangeModelPrerequisites(f.work.workId).roles, roles);
        assert.deepEqual(actual.issues.map(issue => issue.provider), phase === 'CHECKED' ? ['override'] : []);
    }
    f.c.store.run('UPDATE change_state SET phase=?,plan=NULL,data=? WHERE work=?', 'BASE_CAPTURED', f.state.data, f.work.workId);
    await fs.writeFile(path.join(f.home, 'config/role-models.json'), JSON.stringify({
        planner: { kind: 'managed', provider: 'claude-bridge', modelId: 'retained-bridge-model', thinkingLevel: 'off' }
    }), { mode: 0o600 });
    assert.deepEqual(f.assessment().issues.map(issue => issue.kind), ['bridge']);
    await assert.rejects(f.c.changes.selectRoleModel(f.models.workOperation(f.work.workId), 'planner'), /Bridge model requires saved startup/);
});

test('legacy review-ready coverage hold is assessed as planning, matching drive precedence', async (t) => {
    const f = await createManagedWorkFixture(t, []);
    f.stage('REVIEW_READY');
    f.c.store.run('UPDATE change_versions SET data=? WHERE id=?', JSON.stringify({ plan: { requirements: [{ id: 'legacy' }], verification: { checks: [] } } }), 'fixture-plan');
    const result = f.assessment();
    assert.equal(result.stage, 'plan');
    assert.deepEqual(f.c.inspectChangeModelPrerequisites(f.work.workId).roles, ['planner', 'challenger', 'adjudicator']);
    assert.equal(result.issues[0].provider, 'base');
});

test('external resume recipe remains required at checks, without adding account requirements to a completed endpoint', async (t) => {
    const f = await createManagedWorkFixture(t, ['base']);
    const work = await f.c.beginChange({ projectId: 'P', request: 'External retained check' });
    const plan = {
        requirements: [{ id: 'req' }],
        verification: {
            checks: [
                {
                    guaranteeIds: ['req'],
                    cases: [{ id: 'h', kind: 'healthy', guaranteeIds: ['req'] }, { id: 'a', kind: 'adverse', guaranteeIds: ['req'] }]
                }
            ]
        }
    };
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'external-plan', work.workId, 'plan', work.baseVersion, null, 'metadata-only', JSON.stringify({ plan }));
    f.c.store.run('UPDATE change_state SET phase=?,plan=? WHERE work=?', 'CANDIDATE_CAPTURED', 'external-plan', work.workId);
    const missing = managedModelGuidance(f.host, work.workId);
    assert.equal(missing.stage, 'checks');
    assert.equal(missing.issues[0].kind, 'external');
    assert.deepEqual(missing.issues[0].roles, []);
    assert.deepEqual(managedModelGuidance({ ...f.host, externalModel: { provider: 'explicit', modelId: 'original' } }, work.workId).issues, []);
    f.c.store.run('UPDATE change_state SET phase=? WHERE work=?', 'REVIEW_READY', work.workId);
    assert.deepEqual(managedModelGuidance(f.host, work.workId).issues, []);
});

test('an already cancelled original is not told to cancel again when another conversation holds settings', async (t) => {
    const f = await createManagedWorkFixture(t, ['current']);
    const assessment = f.assessment();
    const other = f.c.createConversation();
    await f.c.queueConversationInput({ conversationId: other.conversationId, expectedGeneration: 0, text: 'Other retained request', mode: 'idle' });
    const detail = managedModelRepairDetail(f.c, f.work.workId, assessment);
    assert.match(detail, /already cancelled/);
    assert.ok(!detail.includes('/change cancel ' + f.work.workId));
    assert.match(detail, /other blockers/);
});

test('original provider repair is directly selectable without rebinding retained work',async t=>{
 const f=await createManagedWorkFixture(t,['current']);const baseline=f.c.getWorkApplicationModelBaseline(f.work.workId),choice=f.c.getConversationModelChoice(f.view.conversationId);let sent;
 const commands=new HostCommands(readinessCommands({...f.host,isCurrent:()=>true,show:async()=>{},choose:async(title,rows)=>sent?rows.at(-1):title==='Choose a recovery action'?rows.find(r=>r==='Connect original provider base'):rows[0],execute:async(command,target)=>{sent={command,target};return'cancelled';}}));
 await commands.execute('/ready',f.view.conversationId);assert.deepEqual(sent,{command:'/login base',target:f.view.conversationId});assert.deepEqual(f.c.getWorkApplicationModelBaseline(f.work.workId),baseline);assert.deepEqual(f.c.getConversationModelChoice(f.view.conversationId),choice);assert.equal(f.c.inspectChange(f.work.workId).execution.consumed,1);
});
test('held original work offers inspection and reviewed cancellation, not account mutation or model replacement',async t=>{
 const f=await createManagedWorkFixture(t,['current'],{},false);let sent;
 await new HostCommands(readinessCommands({...f.host,isCurrent:()=>true,show:async()=>{},choose:async(title,rows)=>{if(sent)return rows.at(-1);if(title==='Choose a recovery action'){assert.ok(!rows.some(r=>r.startsWith('Connect original provider')));assert.ok(!rows.some(r=>r.includes('another current model')));return'Review cancellation of original work and delegated executions';}return rows[0];},execute:async(command)=>{sent=command;return'cancelled';}})).execute('/ready',f.view.conversationId);
 assert.equal(sent,'/change cancel '+f.work.workId);assert.equal(f.c.inspectWork(f.work.workId).state,'ACTIVE');assert.equal(f.c.inspectChange(f.work.workId).execution.consumed,1);
});
test('changed original epoch during recovery choice refuses dispatch',async t=>{
 const f=await createManagedWorkFixture(t,['current'],{},false);
 await assert.rejects(new HostCommands(readinessCommands({...f.host,isCurrent:()=>true,show:async()=>{},choose:async(title,rows)=>{if(title==='Choose a recovery action'){await f.c.cancelWork({workId:f.work.workId});return'Inspect original work and recovery holds';}return rows[0];},execute:async()=>assert.fail('Stale original repair dispatched')})).execute('/ready',f.view.conversationId),/changed/);
});

for(const provider of ['owned api_key','owned\u2003api_key'])test('opaque original provider opens exact account picker instead of ambiguous login arguments '+JSON.stringify(provider),async t=>{
 const f=await createManagedWorkFixture(t,['current'],{},true,provider);const baseline=f.c.getWorkApplicationModelBaseline(f.work.workId),before=f.c.getConversationModelChoice(f.view.conversationId);let dispatched;
 await new HostCommands(readinessCommands({...f.host,isCurrent:()=>true,show:async()=>{},choose:async(title,rows)=>dispatched?rows.at(-1):title==='Choose a recovery action'?rows.find(r=>r==='Choose account login for original provider '+provider):rows[0],execute:async(command)=>{dispatched=command;return'cancelled';}})).execute('/ready',f.view.conversationId);
 assert.equal(dispatched,'/login');assert.deepEqual(f.c.getWorkApplicationModelBaseline(f.work.workId),baseline);assert.deepEqual(f.c.getConversationModelChoice(f.view.conversationId),before);assert.equal(f.c.inspectChange(f.work.workId).execution.consumed,1);
});
