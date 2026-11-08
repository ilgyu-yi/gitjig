import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {stripVTControlCharacters} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {managedFixtureInputs, assertCurrentBuild, withInstalledManagedFixture, receiverBase, sourceBase, sourceCandidate, receiverCandidate} from './managed-installed-fixture.mjs';
import {installedInterruption} from './managed-interruption.mjs';
import {installedAgentEndpoint} from './managed-agent-endpoint.mjs';
import {recoverOwnerOriginal} from './managed-owner-recovery.mjs';
import {inspectInstalledManagedResult} from './managed-result-inspection.mjs';

// Only model HTTP answers are scripted; application state is produced by installed commands and SDK tools.
for (const badCandidate of [false,true]) test(badCandidate
    ? 'installed managed work with failed checks remains blocked and opens its retained result'
    : 'installed setup and real managed procedures reach an authorized local branch', {timeout:240000}, async t=>{
    const fixture = await managedFixtureInputs();
    await withInstalledManagedFixture(t, {...fixture, badCandidate}, journey);
    await assertCurrentBuild(fixture.built);
});

test('installed owner extends a depleted allowance and resumes the same checked and reviewed work', {timeout:180000}, async t => {
    const fixture = await managedFixtureInputs();
    await withInstalledManagedFixture(t, fixture, async ({root, home, launcher, run, cli, terminal, requests, roles, reviews, setRoleResponseGate}) => {
        const request = 'Consumer must export3 using its existing simple implementation.';
        const stopped = JSON.parse(await run(launcher, ['change', 'start', '--project', 'P', '--message', request,
            '--provider', 'installed-managed', '--model', 'original', '--execution-limit', '4'], 'stop-at-execution-budget', 80000, 2));
        const id = stopped.workId;
        assert.ok(stopped.planVersion && stopped.baseVersion);
        assert.equal(stopped.execution.consumed, stopped.execution.limit);
        assert.equal(stopped.execution.reserved, 0);
        assert.equal(stopped.candidateVersion, null);
        assert.deepEqual(roles, ['planner', 'challenger', 'adjudicator']);
        const original = await cli(['work', 'inspect', '--work', id], 'original-stopped-work');
        const originalRequests = requests.length, originalRuns = original.runs.map(run => run.id);
        const database = path.join(home, 'state/controller.sqlite');
        const db = new DatabaseSync(database, {readOnly:true});
        let heldRows, owner;
        try {
            owner=db.prepare('SELECT selected FROM interaction_view').get().selected;
            heldRows = ['works','runs','budgets','role_launches','conversation_inputs'].map(table => ({
                sql:'SELECT * FROM '+table+' ORDER BY rowid', rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(Object.values),
            }));
        } finally { db.close(); }
        const resume = '/change resume ' + id;
        await terminal('held-resume-extension', [
            {wait:'Model: original', send:resume+'\x1b\r'},
            {wait:'Original work execution allowance exhausted', queries:heldRows, send:'\x1b'},
            {wait:'INPUT · Conversation idle', queries:heldRows, send:'\x15'+resume+'\x1b\r'},
            {wait:'Inspect original work and recovery', queries:heldRows, send:'\r'},
            {wait:'Before resuming, choose Extend shared execution allowance', queries:heldRows, send:'Extend shared execution allowance\r'},
            {wait:'Additional execution units', queries:heldRows, send:'8\r'},
            {wait:'Owner reason', queries:heldRows, send:'Authorize implementation and independent verification for the original work\r'},
            {wait:'Review shared allowance change', queries:heldRows, send:'\r'},
            {wait:'Extend execution', queries:heldRows, send:'Add 8 execution\r'},
            {wait:'Work recovery · #'+id, send:'\x1b'},
            {wait:'INPUT · Conversation idle', send:'\x07q'},
        ], 25);
        const extended = await cli(['work', 'inspect', '--work', id], 'extended-original');
        assert.equal(requests.length, originalRequests);
        assert.deepEqual(extended.runs, original.runs);
        assert.equal(extended.allowance.consumed, original.allowance.consumed);
        assert.equal(extended.allowance.limit, original.allowance.limit + 8);
        const resumedOwner = {assertDraft:'', expectedInputs:6, queries:[
            {sql:'SELECT state,mode,COUNT(*) FROM conversation_inputs GROUP BY state,mode', rows:[['CONSUMED','initial',6]]},
            {sql:'SELECT s.work FROM interaction_view v JOIN conversation_state s ON s.conversation=v.selected', rows:[[null]]},
        ]};
        const holding=path.join(root,'standalone-producer-held'), release=path.join(root,'standalone-producer-release');
        let heldImplementer=false;
        setRoleResponseGate(async ({text,response})=>{
            if (heldImplementer || !text.startsWith('Perform the assigned implementer task')) return;
            heldImplementer=true;
            await fs.writeFile(holding,'waiting',{mode:0o600});
            const deadline=Date.now()+30000;
            while (!response.destroyed) {
                if (await fs.readFile(release,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;})) return;
                if (Date.now()>deadline) throw Error('Owner terminal did not release the held implementer');
                await delay(25);
            }
        });
        const liveOriginal=[
            {sql:'SELECT id FROM works',rows:[[id]]},
            {sql:'SELECT COUNT(*) FROM role_launches WHERE work=?',params:[id],rows:[[4]]},
        ];
        const selectedOwner={sql:'SELECT selected FROM interaction_view',rows:[[owner]]};
        const selectedOther={sql:'SELECT COUNT(*) FROM interaction_view WHERE selected<>?',params:[owner],rows:[[1]]};
        const reviewReady={sql:'SELECT phase FROM change_state WHERE work=?',params:[id],rows:[['REVIEW_READY']]};
        const returnToOwner={wait:'INPUT · Conversation idle',queries:[selectedOther,reviewReady],send:'/resume '+owner+'\x1b\r'};
        const steps=[
            {wait:'Model: original', send:resume+'\x1b\r'},
            {wait:'Open resume confirmation', send:'\r'},
            {wait:'Resume · P · #', send:'Resume this original work\r'},
            {wait:'Working on this change: Implementing', waitFiles:[{path:holding,value:'waiting'}], queries:liveOriginal, send:'\x07t'},
            {wait:'Next step · Inspect the running work', queries:liveOriginal, send:'\r'},
            {wait:'This work is still running or settling.', queries:liveOriginal, send:'\x1b'},
            {wait:'Next step · Inspect the running work', queries:liveOriginal, send:'\x1b'},
            {wait:'Working on this change: Implementing', queries:liveOriginal, send:'\x15/new root\x1b\r'},
            {wait:'Independent conversation opened', queries:[...liveOriginal,selectedOther], releaseFile:release, send:'\x07t'},
            {wait:'Setup and next actions', queries:[selectedOther,reviewReady], send:'\x1b'},
            returnToOwner,
            {wait:'Inspect this work with /result '+id, ...resumedOwner, queries:[...resumedOwner.queries,selectedOwner], send:'/result '+id+'\x1b\r'},
            {wait:'Open result actions', ...resumedOwner, send:'\x1b'},
            {wait:'INPUT · Conversation idle', ...resumedOwner, send:'\x07q'},
        ];
        try {await terminal('explicit-original-resume', steps, 100);}
        finally {setRoleResponseGate(null);}
        const recordedTerminal = path.join(root,'explicit-original-resume.json.terminal');
        const terminalBytes = await fs.readFile(recordedTerminal);
        const activity = stripVTControlCharacters(terminalBytes.toString());
        const offsets = JSON.parse(await fs.readFile(recordedTerminal+'.progress.json','utf8')).actionOutputOffsets;
        assert.ok(!terminalBytes.subarray(0,offsets[steps.indexOf(returnToOwner)]).includes('Inspect this work with /result '+id), 'Background completion must stay off the independent pane');
        assert.match(activity,/Working on this change: Implementing/u);
        assert.match(activity,/Review-ready result recorded/u);
        assert.ok(!activity.includes('Review resume · /change resume '+id), 'A second Resume must be absent while the original runs');
        const finished = await cli(['change', 'inspect', '--work', id], 'finished-original');
        const settled = await cli(['work', 'inspect', '--work', id], 'settled-original');
        assert.equal(finished.reviewReady, true);
        assert.equal(finished.planVersion, stopped.planVersion);
        assert.equal(finished.baseVersion, stopped.baseVersion);
        assert.deepEqual(settled.source, original.source);
        assert.equal(settled.lineageRoot, original.lineageRoot);
        assert.deepEqual(settled.runs.filter(run => originalRuns.includes(run.id)), original.runs);
        assert.ok(finished.checks.some(check => check.status === 'pass'));
        assert.ok(reviews.length && requests.length > originalRequests);
        assert.deepEqual((await cli(['change', 'list'], 'only-original-work')).changes.map(work => work.workId), [id]);
        return {workId:id, usedBefore:original.allowance.consumed, usedAfter:settled.allowance.consumed};
    });
    await assertCurrentBuild(fixture.built);
});

test('installed operator cancels an active original work and reopens its retained result', {timeout:180000}, async t => {
    const fixture = await managedFixtureInputs();
    await withInstalledManagedFixture(t, fixture, async ({root,home,project,cli,terminal,requests,setRoleResponseGate}) => {
        const prepare=async (message,label)=>cli(['change','prepare','--project','P','--message',message,
            '--model-source','application','--provider','installed-managed','--model','original'],label);
        const sibling=await prepare('Independent sibling must stay unchanged','prepare-sibling');
        const original=await prepare('Consumer must export3 using its existing simple implementation.','prepare-cancel-target');
        const id=original.workId, siblingBefore=await cli(['work','inspect','--work',sibling.workId],'sibling-before');
        const before=await cli(['work','inspect','--work',id],'original-before-cancel');
        const hold=path.join(root,'cancel-after-native-write');
        let observed=false, closed=false;
        setRoleResponseGate(async ({text,body,answer,response})=>{
            if (observed || !text.startsWith('Perform the assigned implementer task') || answer.tool) return;
            const write=body.messages.flatMap(message=>message.tool_calls??[]).find(call=>call.function.name==='write');
            const receipt=write && body.messages.find(message=>message.role==='tool'&&message.tool_call_id===write.id);
            assert.match(JSON.stringify(receipt?.content),/Successfully wrote/);
            observed=true;
            await fs.writeFile(hold,'held',{mode:0o600});
            await new Promise(resolve=>{
                if (response.destroyed) {closed=true;resolve();}
                else response.once('close',()=>{closed=true;resolve();});
            });
        });
        const siblingState={sql:'SELECT state,epoch FROM works WHERE id=?',params:[sibling.workId],rows:[[siblingBefore.state,siblingBefore.epoch]]};
        const countCancel=expected=>({sql:"SELECT COUNT(*) FROM sources WHERE json_extract(origin,'$.kind')='owner-task-cancel'",rows:[[expected]]});
        const active=[siblingState, countCancel(0), {sql:'SELECT state,epoch FROM works WHERE id=?',params:[id],rows:[['ACTIVE',before.epoch]]}];
        const receipt={sql:"SELECT json_extract(origin,'$.requestedWork.id'), json_extract(origin,'$.requestedWork.fromEpoch'), json_extract(origin,'$.requestedWork.toEpoch'), json_extract(origin,'$.requestedWork.fromState'), json_extract(origin,'$.requestedWork.toState'), json_extract(origin,'$.requestedWork.sourceId')=(SELECT source FROM works WHERE id=?) FROM sources WHERE json_extract(origin,'$.kind')='owner-task-cancel'",
            params:[id],rows:[[id,before.epoch,before.epoch+1,'ACTIVE','CANCELLED',1]]};
        const cancelled=[siblingState, receipt, {sql:'SELECT state,epoch FROM works WHERE id=?',params:[id],rows:[['CANCELLED',before.epoch+1]]}];
        const chooseCancel={wait:'This work is still running or settling.',queries:active,send:'Review cancellation\r'};
        const openCancel={wait:'Open cancellation confirmation',queries:active,send:'\r'};
        const cancelAction='Cancel this work and its delegated executions';
        try {
            await terminal('cancel-original-while-live', [
                {wait:'Model: original',send:'/change resume '+id+'\x1b\r'},
                {wait:'Open resume confirmation',send:'\r'},
                {wait:'Resume · P · #',send:'Resume this original work\r'},
                {wait:'Working on this change: Implementing',waitFiles:[{path:hold,value:'held'}],queries:active,send:'\x07t'},
                {wait:'Next step · Inspect the running work',queries:active,send:'\r'},
                chooseCancel,
                {...openCancel,send:'\x1b'},
                chooseCancel,
                openCancel,
                {wait:cancelAction,queries:active,send:'\r'},
                chooseCancel,
                openCancel,
                {wait:cancelAction,queries:active,send:cancelAction+'\r'},
                {wait:'Cancellation recorded',queries:cancelled,send:'\x1b'},
                {wait:'INPUT · Conversation idle',queries:cancelled,send:'\x07q'},
            ],75);
        } finally {setRoleResponseGate(null);}
        assert.ok(observed&&closed);
        const cancelledWork=await cli(['work','inspect','--work',id],'cancelled-original');
        const procedure=await cli(['change','inspect','--work',id],'cancelled-original-procedure');
        assert.deepEqual(cancelledWork.source,before.source);
        assert.equal(cancelledWork.lineageRoot,before.lineageRoot);
        assert.ok(cancelledWork.allowance.consumed>before.allowance.consumed);
        assert.equal(cancelledWork.allowance.reserved,0);
        assert.equal(procedure.reviewReady,false);
        const implementer=procedure.launches.find(launch=>launch.role==='implementer');
        assert.ok(implementer && implementer.status!=='COMPLETE');
        assert.equal(implementer.data.cleanup,'removed');
        const implementationHistory=await fs.readFile(implementer.data.historyRef,'utf8');
        assert.match(implementationHistory,/Successfully wrote/);
        assert.equal(await fs.readFile(path.join(project,'consumer.cjs'),'utf8'),sourceBase);
        assert.deepEqual(await cli(['work','inspect','--work',sibling.workId],'sibling-after'),siblingBefore);
        const requestCount=requests.length;
        const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});
        let protectedRows;
        try {
            protectedRows=['works','sources','change_state','budgets','runs','role_launches','role_outputs','check_runs','obligations','effect_operations'].map(table=>{
                const sql='SELECT * FROM '+table+' ORDER BY rowid';
                return {sql,rows:db.prepare(sql).all().map(Object.values)};
            });
        } finally {db.close();}
        const unchanged=[...cancelled,...protectedRows];
        await terminal('cancelled-original-cold-result', [
            {wait:'Model: original',queries:unchanged,send:'/result '+id+'\x1b\r'},
            {wait:'Cancellation is recorded for this work.',queries:unchanged,send:'\r'},
            {wait:'Work recovery · #'+id,queries:unchanged,send:'\x1b'},
            {wait:'Cancellation is recorded for this work.',queries:unchanged,send:'\x1b'},
            {wait:'INPUT · Conversation idle',queries:unchanged,send:'\x07q'},
        ]);
        assert.equal(requests.length,requestCount);
        assert.equal(await fs.readFile(implementer.data.historyRef,'utf8'),implementationHistory);
        return {workId:id,siblingWorkId:sibling.workId,retainedProducer:implementer.id};
    });
    await assertCurrentBuild(fixture.built);
});

test('returning installed project conversation repairs runtime before explicitly sending its next draft', {timeout: 120000}, async t => {
    const fixture = await managedFixtureInputs();
    await withInstalledManagedFixture(t, fixture, async ({home, terminal, cli, requests, setOrdinaryResponder}) => {
        const first = 'Describe the current project without editing it.';
        const next = '  Continue the same project conversation 한국어.  ';
        const prompts = [];
        setOrdinaryResponder(body => {
            prompts.push(JSON.stringify(body.messages));
            return {text: prompts.length === 1 ? 'FIRST_PROJECT_ANSWER' : 'SECOND_PROJECT_ANSWER'};
        });
        await terminal('returning-first-request', [
            {wait: 'Model: original', send: first + '\r'},
            {wait: 'FIRST_PROJECT_ANSWER', waitIdle: true, send: '/quit\x1b\r'},
        ], 24);
        const read = action => {
            const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly: true});
            try {return action(db);} finally {db.close();}
        };
        const ledgers = () => read(db => db.prepare(
            "SELECT w.id AS workId, w.lineage, b.consumed, b.reserved FROM works w JOIN budgets b ON b.lineage=w.lineage AND b.kind='execution'"
        ).all().map(row => ({...row})));
        const [before] = ledgers();
        assert.ok(before && before.consumed > 0);
        assert.equal(requests.length, 1);
        const route = JSON.parse(await fs.readFile(path.join(home, 'config/startup.json'), 'utf8')).runtime;
        await cli(['setup', 'clear'], 'clear-returning-runtime');
        const selected = read(db => db.prepare('SELECT selected FROM interaction_view').get().selected);
        const original = read(db => ['works', 'runs', 'budgets', 'conversation_inputs'].map(table => {
            const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
            return {sql, rows:db.prepare(sql).all().map(Object.values)};
        }));
        const kept = {assertDraft: next, expectedInputs: 1, expectedSelected: selected, queries: original};
        await terminal('returning-runtime-repair', [
            {wait: 'Setup needed', send: '\x1b[200~' + next + '\x1b[201~\r'},
            {wait: 'Request not sent · your text is kept', ...kept, send: 'Configure execution runtime\r'},
            {wait: 'Runtime setup · staged values', send: 'Edit runtime fields\r'},
            {wait: 'Docker executable', send: route.dockerBinary + '\r'},
            {wait: 'Docker context', send: route.dockerContext + '\r'},
            {wait: 'Runtime image', send: route.image + '\r'},
            {wait: 'Docker configuration directory', send: route.dockerConfigDirectory + '\r'},
            {wait: 'Runtime setup · staged values', send: 'Review and save runtime\r'},
            {wait: 'Open settings confirmation', ...kept, send: '\r'},
            {wait: 'Explicit runtime setup action', ...kept, send: 'Save and apply runtime\r'},
            {wait: 'Request still in the editor · press Enter to send', ...kept, send: '\r'},
            {wait: 'SECOND_PROJECT_ANSWER', waitIdle: true, assertDraft:'', expectedSelected:selected, expectedInputs:2, send: '/quit\x1b\r'},
        ], 24);
        const after = ledgers();
        assert.deepEqual(after, [{...before, consumed: before.consumed + 1}]);
        assert.equal(requests.length, 2);
        assert.ok(prompts[1].includes(first));
        assert.ok(prompts[1].includes(next.trim()));
        return {workId: before.workId, originalAllowance: before.consumed, finalAllowance: after[0].consumed};
    });
});

test('installed retained project request offers runtime repair before a separately confirmed retry', {timeout: 120000}, async t => {
    const fixture = await managedFixtureInputs();
    await withInstalledManagedFixture(t, fixture, async ({home, payload, run, cli, terminal, requests, setOrdinaryResponder}) => {
        const original = 'Read the project without editing it.';
        const draft = '  A separate unsent draft 한국어  ';
        const controllerModule = pathToFileURL(path.join(payload, 'dist/controller/index.js')).href;
        const seed = `const {openController}=await import(${JSON.stringify(controllerModule)});
            const c=await openController({installationHome:${JSON.stringify(home)}});
            try {
                const {conversationId}=c.inspectConversationEntry();
                const view=c.inspectConversation(conversationId);
                const input=await c.queueConversationInputWithContext({
                    conversationId,expectedGeneration:view.generation,text:${JSON.stringify(original)},mode:'idle'
                });
                console.log(JSON.stringify({inputId:input.inputId,conversationId}));
            } finally {await c.close();}`;
        const {inputId, conversationId} = JSON.parse(await run(path.join(home, 'bootstrap/node'), ['--input-type=module', '-e', seed], 'queue-original'));
        const route = JSON.parse(await fs.readFile(path.join(home, 'config/startup.json'), 'utf8')).runtime;
        await cli(['setup', 'clear'], 'clear-original-runtime');
        setOrdinaryResponder(body => {
            const messages = JSON.stringify(body.messages);
            assert.ok(messages.includes(original));
            assert.ok(!messages.includes(draft.trim()));
            return {text:'ORIGINAL_RETRY_RECEIVED'};
        });
        const unchanged = [
            {sql: 'SELECT id,state,text FROM conversation_inputs', rows: [[inputId, 'QUEUED', original]]},
            ...['works','runs','budgets'].map(table => ({sql: 'SELECT COUNT(*) FROM ' + table, rows: [[0]]})),
        ];
        const kept = {assertDraft: draft, expectedInputs: 1, expectedSelected: conversationId, queries: unchanged};
        const list = 'Earlier received request needs review · current draft kept';
        const review = 'Open recovery actions';
        const blocked = 'Execution runtime is required before retry · request kept';
        await terminal('retry-runtime-repair', [
            {wait:'Request retained · /inputs to inspect', send:'\x1b[200~' + draft + '\x1b[201~\r'},
            {wait:list, ...kept, send:'\r'},
            {wait:review, ...kept, send:'\r'},
            {wait:blocked, ...kept, send:'Configure execution runtime\r'},
            {wait:'Runtime setup · staged values', ...kept, send:'\x1b'},
            {wait:review, ...kept, send:'\r'},
            {wait:blocked, ...kept, send:'Configure execution runtime\r'},
            {wait:'Runtime setup · staged values', send:'Edit runtime fields\r'},
            {wait:'Docker executable', send:route.dockerBinary+'\r'},
            {wait:'Docker context', send:route.dockerContext+'\r'},
            {wait:'Runtime image', send:route.image+'\r'},
            {wait:'Docker configuration directory', send:route.dockerConfigDirectory+'\r'},
            {wait:'Runtime setup · staged values', send:'Review and save runtime\r'},
            {wait:'Open settings confirmation', ...kept, send:'\r'},
            {wait:'Explicit runtime setup action', ...kept, send:'Save and apply runtime\r'},
            {wait:review, ...kept, send:'\r'},
            {wait:'This exact request · choose explicitly', ...kept, send:'Retry original request\r'},
            {wait:'ORIGINAL_RETRY_RECEIVED', waitIdle:true, assertDraft:draft, expectedSelected:conversationId, expectedInputs:1, send:'\x07q'},
        ], 25);
        assert.equal(requests.length,1);
        const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly:true});
        try {
            const [input] = db.prepare('SELECT id,state,text FROM conversation_inputs').all();
            assert.deepEqual({...input}, {id:inputId,state:'CONSUMED',text:original});
            assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,1);
        } finally {db.close();}
        return {inputId,originalRetry:true};
    });
});

async function journey({root, home, project, launcher, run, cli, terminal, badCandidate, roles, reviews, requests, invocations, result, setOrdinaryResponder, setRoleResponseGate}) {
    const request = 'Consumer must export3 using its existing simple implementation.';
    const blocked = 'Change blocked · /result for details and next steps';
    await terminal('managed-work', [
        {wait: 'Model: original', send: '/change start ' + request + '\x1b\r'},
        {wait: 'Open start confirmation', send: '\r'},
        {wait: 'Start managed work', send: '\x1b[B\r'},
        {wait: badCandidate ? blocked : 'Review-ready result recorded', send:'\x07'},
        {wait:'Commands · Ctrl+G, then a letter',send:'q'},
    ], 80);
    const listed = await cli(['change', 'list'], 'changes'); assert.equal(listed.changes.length, 1);
    const workId = listed.changes[0].workId, view = await cli(['change', 'inspect', '--work', workId], 'inspect');
    const work = await cli(['work', 'inspect', '--work', workId], 'work'); assert.equal(work.source.raw, request);
    assert.equal(view.reviewReady, !badCandidate); assert.ok(view.execution.consumed > 0);
    assert.equal(view.execution.reserved, 0); assert.equal(view.resolution.reserved, 0);
    assert.ok(requests.length > 5); assert.ok(requests.every(request => request.model === 'original'));
    assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), sourceBase);
    if (badCandidate) {
        assert.equal(view.phase, 'BLOCKED');
        assert.ok(view.checks.some(check => check.status === 'fail' && check.data.actual.exitCode === 0));
        assert.equal(reviews.length,0);
        const requestsBeforeInspection = requests.length;
        const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly:true});
        let unchanged;
        try {
            unchanged = ['works', 'change_state', 'budgets', 'runs', 'role_launches', 'effect_operations', 'effect_delegations'].map(table => {
                const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
                return {sql, rows:db.prepare(sql).all().map(Object.values)};
            });
        } finally {db.close();}
        await terminal('managed-stopped-result', [
            {wait:blocked,queries:unchanged,send:'/result\x1b\r',waitIdle:true},
            {wait:'Unexpected case outcomes · "value-healthy", "value-adverse"',queries:unchanged,send:'\r'},
            {wait:'Next step for this result',queries:unchanged,send:'Compare expected and observed case values\r'},
            {wait:'Observed · rejected with "2"',queries:unchanged,send:'\x1b'},
            {wait:'Checks that need attention',queries:unchanged,send:'\x1b[6~'},
            {wait:'Selected review evidence',queries:unchanged,send:'\r'},
            {wait:'Next step for this result',queries:unchanged,send:'\x1b'},
            {wait:'Selected review evidence',queries:unchanged,send:'\r'},
            {wait:'Next step for this result',queries:unchanged,send:'Inspect original work and recovery\r'},
            {wait:'Choose View result for details and recovery steps.',queries:unchanged,send:'\x1b'},
            {wait:'Selected review evidence',queries:unchanged,send:'\x1b'},
            {wait:blocked,queries:[...unchanged, {
                sql:'SELECT draft FROM conversation_views JOIN interaction_view ON conversation=selected',rows:[['']],
            }],send:'\x07',waitIdle:true},
            {wait:'Commands · Ctrl+G, then a letter',send:'q'},
        ],24);
        const terminalFile = path.join(root, 'managed-stopped-result.json.terminal');
        const inspection = await fs.readFile(terminalFile);
        const {actionOutputOffsets} = JSON.parse(await fs.readFile(terminalFile+'.progress.json', 'utf8'));
        const visible = (start, end) => stripVTControlCharacters(inspection.subarray(actionOutputOffsets[start],actionOutputOffsets[end]).toString('utf8'));
        const overview = visible(0,1), actions = visible(1,2), comparison = visible(2,3);
        for (const marker of ['No review-ready result is currently confirmed','Checks that need attention',
            'Failed · "value" · Recorded exit code 0','Failed assertions · "three"',
            'Unexpected case outcomes · "value-healthy", "value-adverse"','Open result actions → Compare expected and observed case values'])
            assert.ok(overview.includes(marker), 'First result view must show '+marker);
        assert.doesNotMatch(overview,/Expected · returned|Observed · rejected/);
        assert.match(actions,/Inspect original work and recovery/);
        assert.doesNotMatch(actions,/Save changes to a new branch|Review branch delivery for this result/);
        assert.ok(comparison.includes('Expected · returned "3"'));
        assert.ok(comparison.includes('Observed · rejected with "2"'));
        assert.ok(!inspection.toString('utf8').includes('Working · /result'), 'Immediate navigation must not paint a generic wait');
        assert.equal(requests.length, requestsBeforeInspection);
    }
    else {
        assert.equal(view.phase, 'REVIEW_READY'); assert.ok(view.checks.some(check => check.status === 'pass' && check.data.actual.exitCode === 0));
        const author = view.launches.find(launch => launch.role === 'implementer'), reviewer = view.launches.find(launch => launch.role === 'reviewer');
        assert.ok(author && reviewer); assert.notEqual(author.run, reviewer.run);
        assert.equal(reviewer.data.inputVersions.candidate, view.candidateVersion);
        const candidate = view.versions.find(version => version.id === view.candidateVersion);
        assert.equal(await fs.readFile(path.join(candidate.artifact, 'consumer.cjs'), 'utf8'), sourceCandidate);
        for (const role of ['planner', 'challenger', 'implementer', 'reviewer', 'adjudicator']) assert.ok(roles.includes(role), role);
        const launches = view.launches.filter(launch => ['planner', 'challenger', 'implementer', 'reviewer', 'adjudicator'].includes(launch.role));
        assert.equal(new Set(launches.map(launch => launch.data.nativeSessionId)).size, launches.length);
        assert.equal(new Set(launches.map(launch => launch.data.historyRef)).size, launches.length);
        for (const launch of launches) {assert.ok(launch.data.nativeSessionId && launch.data.historyRef); assert.equal(launch.data.cleanup, 'removed'); await fs.access(launch.data.historyRef);}
        assert.equal(reviews.length, 1); assert.equal(reviews[0].candidateVersion, view.candidateVersion); assert.equal(reviews[0].consumer, sourceCandidate);
    }
    const landing = badCandidate ? null : await landLocalBranch({root, home, project, launcher, workId, view, run, cli, invocations, terminal, requests, reviews});
    result.landing = landing;
    if (!badCandidate) result.agent = await installedAgentEndpoint({root, home, project, terminal, run, cli,
        setOrdinaryResponder, receiverBase, receiverCandidate, sourceBase});
    if (!badCandidate) result.interruption = await installedInterruption({root, home, project, terminal, cli, requests,
        setRoleResponseGate, sourceBase, sourceCandidate});
    const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly: true});
    try {
        const data = JSON.parse(db.prepare('SELECT data FROM works WHERE id=?').get(workId).data);
        assert.equal(data.applicationModelBaseline.choice.modelId, 'original');
        assert.equal(data.applicationModelBaseline.choice.provider, 'installed-managed');
        assert.equal(data.applicationModelBaseline.source.kind, 'conversation');
        if (!badCandidate) {
            const selected = JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(workId).data);
            const reviewer = view.launches.find(launch => launch.role === 'reviewer');
            assert.equal(reviewer.data.inputVersions.requirements, selected.requirementVersion);
            assert.equal(reviewer.data.inputVersions.contracts, selected.contractsVersion);
        }
    } finally {db.close();}
    return {workId, candidateVersion: view.candidateVersion, intermediate: view.phase, ...result,
        scope: 'Installed owner/local endpoint, SDK agent endpoint and owner interruption; scripted HTTP, no live hosting or agent recovery claim'};
}

async function landLocalBranch({root, home, project, launcher, workId, view, run, cli, invocations, terminal, requests, reviews}) {
    const git = await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY ?? '/opt/homebrew/bin/git');
    const seed = path.join(root, 'receiver seed'), receiver = path.join(root, 'receiver.git');
    await fs.mkdir(seed, {mode: 0o700});
    for (const name of ['consumer.cjs', 'check.cjs']) await fs.copyFile(path.join(project, name), path.join(seed, name));
    await fs.writeFile(path.join(seed, 'consumer.cjs'), receiverBase);
    const native = (args, label) => run(git, args, label);
    await native(['init', '--initial-branch=main', seed], 'receiver-seed-init');
    await native(['-C', seed, 'add', 'consumer.cjs', 'check.cjs'], 'receiver-seed-add');
    await native(['-C', seed, '-c', 'user.name=Installed Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Original receiver basis'], 'receiver-seed-commit');
    const basis = (await native(['-C', seed, 'rev-parse', 'HEAD'], 'receiver-basis')).trim();
    await native(['init', '--bare', receiver], 'receiver-init');
    await native(['-C', seed, 'push', receiver, 'HEAD:refs/heads/main'], 'receiver-seed-push');
    const head = label => native(['--git-dir=' + receiver, 'rev-parse', 'refs/heads/main'], label).then(value => value.trim());
    const targetFile = path.join(root, 'target.json');
    await fs.writeFile(targetFile, JSON.stringify({projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit: basis,
        publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs']}), {mode: 0o600});
    const target = await cli(['effect', 'register-target', '--target-profile', targetFile, '--git-binary', git], 'register-receiver');
    const database = path.join(home, 'state/controller.sqlite');
    const read = action => {const db = new DatabaseSync(database, {readOnly: true}); try {return action(db);} finally {db.close();}};
    const operations = () => read(db => db.prepare('SELECT * FROM effect_operations WHERE work=?').all(workId));
    const budgets = () => read(db => db.prepare('SELECT * FROM budgets WHERE lineage=? ORDER BY kind').all(workId));
    const beforeGrant = budgets(); assert.deepEqual(operations(), []);
    const prepare = ['effect', 'prepare-integration', '--work', workId, '--target', target.targetId, '--git-binary', git];
    await run(launcher, prepare, 'refuse-missing-grant', 15000, 2);
    assert.match(invocations.at(-1).stderr, /No actual current owner grant/);
    assert.deepEqual(operations(), []); assert.deepEqual(budgets(), beforeGrant);
    assert.equal(await head('receiver-before-grant'), basis);
    const grant = await cli(['effect', 'delegate-integration', '--work', workId, '--target', target.targetId,
        '--operation-limit', '1', '--scope', 'work', '--mode', 'ordinary'], 'delegate-local');
    const originalGrant = read(db => db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(grant.delegationId));
    assert.equal(JSON.parse(originalGrant.data).operationLimit, 1); assert.equal(JSON.parse(originalGrant.data).scope, 'work');
    const prepared = JSON.parse(await run(launcher, prepare, 'prepare-local', 60000));
    assert.equal(prepared.phase, 'RESERVED', JSON.stringify(prepared)); assert.equal(prepared.workId, workId);
    const derived = await cli(['change', 'inspect', '--work', workId], 'derived-review');
    assert.equal(derived.reviewReady, true); assert.notEqual(derived.candidateVersion, view.candidateVersion);
    const checked = derived.checks.find(check => check.candidate === derived.candidateVersion && check.status === 'pass');
    const original = view.checks.find(check => check.candidate === view.candidateVersion && check.status === 'pass');
    assert.ok(checked && original); assert.equal(checked.data.actual.exitCode, 0);
    assert.equal(checked.data.caseResults.complete, true); assert.equal(checked.data.parsed.value.cases.length, 2);
    assert.notEqual(checked.data.caseDescriptor.cases[0].inputDigest, original.data.caseDescriptor.cases[0].inputDigest);
    const reviewer = derived.launches.find(launch => launch.role === 'reviewer' && launch.data.inputVersions.candidate === derived.candidateVersion);
    assert.ok(reviewer); assert.equal(reviewer.data.cleanup, 'removed');
    const priorReviewer = view.launches.find(launch => launch.role === 'reviewer');
    assert.notEqual(reviewer.run, priorReviewer.run);
    assert.notEqual(reviewer.data.nativeSessionId, priorReviewer.data.nativeSessionId);
    const selected = read(db => JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(workId).data));
    assert.equal(reviewer.data.inputVersions.requirements, selected.requirementVersion);
    assert.equal(reviewer.data.inputVersions.contracts, selected.contractsVersion);
    const recovery = await recoverOwnerOriginal({workId, targetId: target.targetId, prepared, read, budgets, cli, terminal, requests, reviews, head});
    const expectedGrant = read(db => db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(grant.delegationId));
    const reprepared = JSON.parse(await run(launcher, [...prepare, '--operation', prepared.operationId], 'reprepare-original', 60000));
    assert.equal(reprepared.phase, 'RESERVED', JSON.stringify(reprepared));
    assert.equal(reprepared.operationId, prepared.operationId);
    const final = await cli(['change', 'inspect', '--work', workId], 'final-current-procedures');
    assert.equal(final.reviewReady, true);
    const finalCandidate = final.versions.find(version => version.id === final.candidateVersion);
    assert.equal(await fs.readFile(path.join(finalCandidate.artifact, 'consumer.cjs'), 'utf8'), receiverCandidate);
    const current = read(db => JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(workId).data));
    const finalReview = final.launches.find(launch => launch.id === current.selection.general);
    assert.ok(finalReview);
    assert.equal(final.candidateVersion, derived.candidateVersion);
    assert.deepEqual(final.checks, derived.checks); assert.deepEqual(final.launches, derived.launches);
    assert.equal(finalReview.data.inputVersions.candidate, final.candidateVersion);
    assert.equal(finalReview.data.inputVersions.requirements, current.requirementVersion);
    assert.equal(finalReview.data.inputVersions.contracts, current.contractsVersion);
    assert.equal(finalReview.data.cleanup, 'removed');
    const finalCheck = final.checks.find(check => check.candidate === final.candidateVersion && check.status === 'pass');
    assert.ok(finalCheck); assert.equal(finalCheck.data.actual.exitCode, 0); assert.equal(finalCheck.data.caseResults.complete, true);
    assert.ok(reviews.some(review => review.candidateVersion === final.candidateVersion && review.consumer === receiverCandidate));
    assert.equal(JSON.parse(operations()[0].data).clientRoot, recovery.clientRoot);
    assert.equal(await head('receiver-before-dispatch'), basis);
    const sent = await cli(['effect', 'dispatch', '--operation', prepared.operationId, '--git-binary', git], 'dispatch-local');
    assert.equal(sent.phase, 'CONFIRMED', JSON.stringify(sent)); assert.equal(sent.operationId, prepared.operationId);
    const committed = await head('receiver-after-dispatch'); assert.notEqual(committed, basis);
    assert.equal(await native(['--git-dir=' + receiver, 'show', 'refs/heads/main:consumer.cjs'], 'receiver-result'), receiverCandidate);
    assert.equal(sent.integrationCommit, committed);
    assert.equal(await native(['--git-dir=' + receiver, 'diff', '--name-only', basis, committed], 'receiver-delta'), 'consumer.cjs\n');
    assert.equal(await native(['--git-dir=' + receiver, 'show', committed + ':check.cjs'], 'receiver-check-final'), await native(['--git-dir=' + receiver, 'show', basis + ':check.cjs'], 'receiver-check-basis'));
    await native(['--git-dir=' + receiver, 'merge-base', '--is-ancestor', basis, committed], 'receiver-ancestry');
    assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), sourceBase);
    const retained = operations(); assert.equal(retained.length, 1); assert.equal(retained[0].grant_id, grant.delegationId);
    const clientRoot = JSON.parse(retained[0].data).clientRoot; assert.ok(path.isAbsolute(clientRoot));
    const used = budgets();
    const reconciled = await cli(['effect', 'reconcile', '--operation', prepared.operationId, '--git-binary', git], 'reconcile-local');
    const repeated = await cli(['effect', 'dispatch', '--operation', prepared.operationId, '--git-binary', git], 'repeat-local');
    for (const result of [reconciled, repeated]) {assert.equal(result.phase, 'CONFIRMED'); assert.equal(result.operationId, prepared.operationId);}
    assert.equal(await head('receiver-after-repeat'), committed);
    assert.equal(operations().length, 1); assert.equal(JSON.parse(operations()[0].data).clientRoot, clientRoot);
    read(db => {
        assert.deepEqual(db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(grant.delegationId), expectedGrant);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM effect_receipts WHERE operation=? AND kind='send'").get(prepared.operationId).n, 1);
    });
    for (const row of budgets()) {const prior = used.find(value => value.kind === row.kind); assert.equal(row.lim, prior.lim); assert.ok(row.consumed >= prior.consumed); assert.equal(row.reserved, 0);}
    const resultInspection = await inspectInstalledManagedResult({root, project, workId, view: final,
        operationId: prepared.operationId, read, terminal, requests, reviews, sourceBase});
    return {endpoint: 'CONFIRMED', operationId: prepared.operationId, targetId: target.targetId, grantId: grant.delegationId,
        basis, committed, clientRoot, recovery, resultInspection, candidateVersion: final.candidateVersion, scope: 'Explicitly delegated private local bare branch; one send, actual current procedures, no hosted PR claim'};
}
