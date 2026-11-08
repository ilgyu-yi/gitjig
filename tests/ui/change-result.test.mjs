import test from 'node:test';
import assert from 'node:assert/strict';
import {changeCaseValuesText,changeResultText} from '../../dist/ui/change-result.js';
import {changeCommands, reviewChangeResult} from '../../dist/ui/change-commands.js';
import {workCommands} from '../../dist/ui/work-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {uiText} from '../../dist/ui/i18n.js';
import {workAllowanceText} from '../../dist/ui/work-allowance-presentation.js';
import {registryWorld, workLedger} from '../controller/change-registry-fixture.mjs';
import {managedWorld} from './managed-change-fixture.mjs';

// Controlled presentation input; this is not evidence of actual checks or review.
const result = overrides => ({
    workId:'original-work', projectId:'P', request:'Keep the requested behavior', requestTruncated:false,
    registeredSourceRoot:'/project', state:'BLOCKED', recordedPhase:'CHECKED', reviewReady:false,
    blocked:[], blockedOmitted:0, nextAction:'repairChange',
    candidate:{versionId:'candidate',path:'/saved/candidate',hash:'0'.repeat(64)},
    changes:{availability:'recorded',entries:[{path:'consumer.cjs',kind:'modified'}],total:1,omitted:0},
    checks:{availability:'recorded',entries:[{checkId:'consumer-check',status:'pass',passed:true,cleanup:'removed'}],total:1,omitted:0},
    reviews:{availability:'recorded',entries:[{key:'reviewer:behavior',state:'selected',outcome:'clear',findingCount:0}],total:1,omitted:0},
    provenance:{baseVersion:'base',candidateVersion:'candidate',planVersion:'plan',verificationVersion:'verification'},
    limitations:['Recorded metadata only.'], ...overrides,
});

for (const locale of ['en','ko']) test(locale+' separates a delivered review-ready checkpoint from a current criteria hold', () => {
    const earlier = uiText(locale, 'result.readyUnderEarlierCriteria');
    const current = uiText(locale, 'result.ready');
    const base = {state:'DELIVERED', recordedPhase:'REVIEW_READY'};
    for (const hold of ['changed','unavailable']) {
        const reason = uiText(locale, 'criteria.recovery.'+hold);
        const held = {...base, workflowCriteriaHold:hold, blocked:['Retained diagnostic']};
        const text = changeResultText(result(held),locale,false,true,{deliveryAvailable:true});
        assert.ok(text.startsWith(earlier+'\n'+reason));
        assert.equal(text.split(reason).length,2);
        assert.ok(!text.includes(current));
        assert.ok(!text.includes(uiText(locale, 'result.nextReadyActions')));
        assert.ok(text.includes(hold==='unavailable' ? uiText(locale, 'criteria.recovery.unavailableAction') : '/work original-work'));
        for (const overrides of [{state:'UNKNOWN'}, {state:'CANCELLED'}, {recordedPhase:'CHECKED'}, {reviewReady:true}])
            assert.ok(!changeResultText(result({...held,...overrides}),locale).includes(earlier));
    }
    assert.ok(changeResultText(result({...base, reviewReady:true}),locale).startsWith(current));
});

for (const locale of ['en','ko']) test(locale+' recovery shows current shared balances beside the primary action', () => {
    const primary = 'Review the current workflow criteria';
    const otherBlocker = 'The previous role reached its separate request limit';
    const execution = {limit:32,consumed:21,reserved:0};
    const spent = {limit:8,consumed:8,reserved:0};
    const reserved = {limit:8,consumed:6,reserved:2};
    const heading = uiText(locale,'result.sharedAllowanceInWork',{id:'original-work'});
    const view = {blocked:['Workflow criteria changed',otherBlocker],nextAction:primary};
    for (const resolution of [spent,reserved]) {
        const shown = changeResultText(result({...view,sharedAllowance:{execution,resolution}}),locale);
        const balance = workAllowanceText(locale,'resolution',resolution);
        assert.ok(shown.includes(heading));
        assert.ok(shown.includes(workAllowanceText(locale,'execution',execution)));
        assert.ok(shown.indexOf(primary) < shown.indexOf(balance));
        assert.ok(shown.indexOf(balance) < shown.indexOf(otherBlocker));
    }
    const funded = {limit:8,consumed:4,reserved:2};
    for (const overrides of [{sharedAllowance:undefined}, {sharedAllowance:{execution,resolution:funded}},
        {sharedAllowance:{execution,resolution:spent},reviewReady:true}]) {
        assert.ok(!changeResultText(result({...view,...overrides}),locale).includes(heading));
    }
    const reopened = changeResultText(result({...view,sharedAllowance:{execution,resolution:spent}}),locale,true);
    assert.ok(reopened.includes(uiText(locale,'result.sharedAllowance')));
    assert.ok(!reopened.includes(heading));
    const action = uiText(locale,'workRecovery.allowanceNeeded',{action:uiText(locale,'workRecovery.resolution')});
    assert.ok(!reopened.includes(action), 'An empty balance is not a stage-specific hold');
    const withHold = changeResultText(result({...view,sharedAllowance:{execution,resolution:spent}}),locale,true,false,{allowanceHold:'resolution'});
    assert.ok(withHold.indexOf(primary) < withHold.indexOf(action) && withHold.includes(action));
});

for (const locale of ['en','ko']) test(locale+' result distinguishes cancellation from an unready or uncertain task', () => {
    const state = {state:'CANCELLED', blocked:['Historical diagnostic'], nextAction:'STALE_CONTINUATION'};
    const text = changeResultText(result(state),locale);
    const title = locale==='ko'?'이 작업의 취소가 기록되었습니다.':'Cancellation is recorded for this work.';
    assert.ok(text.startsWith(title));
    assert.ok(text.includes('/work original-work'));
    assert.ok(text.includes('Historical diagnostic'));
    assert.ok(!text.includes(state.nextAction));
    const unknown=changeResultText(result({...state,state:'UNKNOWN'}),locale);
    assert.ok(!unknown.includes(title));
    assert.ok(unknown.includes('Historical diagnostic'));
});

for (const locale of ['en','ko']) test(locale+' current failed check details precede candidate artifacts', () => {
    const localCheck = result().checks.entries[0];
    const failed = {...localCheck,checkId:'current-failure',status:'fail',passed:false,
        production:{exitCode:0,termination:null,report:'accepted'},
        failures:{assertionIds:['value-assertion'],caseIds:['value-case'],omitted:0,
            caseValues:[{id:'value-case',expected:{kind:'return',value:'PRIVATE_EXPECTATION'},observed:{kind:'return',value:'PRIVATE_OBSERVATION'}}]}};
    const stale = {...failed,checkId:'historical-stale',status:'stale'};
    const baseline = {...failed,checkId:'base-observation',target:'base',purpose:'baseline',status:'baseline-observed',observed:true};
    const incomplete = {...localCheck,checkId:'incomplete-report',status:'unavailable',passed:false,unavailableReason:'output-contract'};
    const view = result({blocked:['Candidate requires repair'],nextAction:'Review current check before retrying',
        checks:{availability:'recorded',entries:[localCheck,baseline,stale,incomplete,failed],total:5,omitted:0}});
    const text = changeResultText(view,locale,false,true);
    const details = text.indexOf(uiText(locale,'result.checkAttention'));
    const artifact = text.indexOf(view.candidate.path);
    assert.ok(text.indexOf(view.nextAction) < details && details < artifact);
    for (const id of ['current-failure','incomplete-report','value-assertion','value-case'])
        assert.ok(text.indexOf(id) > details && text.indexOf(id) < artifact);
    for (const id of ['historical-stale','base-observation','consumer-check']) assert.ok(text.indexOf(id) > artifact);
    assert.equal(text.split('"current-failure"').length,2);
    const action = uiText(locale,'result.check.caseValuesAction');
    assert.ok(text.indexOf(action) > text.indexOf(view.nextAction) && text.indexOf(action) < details);
    assert.ok(!changeResultText(view,locale).includes(action));
    assert.doesNotMatch(text,/PRIVATE_EXPECTATION|PRIVATE_OBSERVATION/);
});

function deliveryReads(view) {
    return {
        inspectDeliveryWork: () => ({workId:view.workId,projectId:view.projectId,sourceRoot:view.registeredSourceRoot,fingerprint:'original-work'}),
        listIntegrations: () => ({operations:[]}),
    };
}

test('a read-only result host can compare earlier checks without offering execution actions', async () => {
    const locale = 'en', action = uiText(locale,'result.check.caseValuesAction');
    const original = result({replanKind:'check', checks:{availability:'not-planned',entries:[],total:null,omitted:0}});
    const failure = {checkId:'earlier-check',receiptId:'earlier-receipt',failures:{assertionIds:[],caseIds:['exact-case'],omitted:0}};
    const comparisons = [{id:'exact-case',expected:{kind:'return',value:'expected answer'},observed:{kind:'return',value:'prior answer'}}];
    let count = 0, canCompare = true;
    const host = {
        controller:{
            ...deliveryReads(original),
            hasLiveChangeOperation:()=>false,
            inspectWork:()=>({workId:original.workId,projectId:original.projectId,epoch:1}),
            inspectChangeResult:(_id,{caseValues})=>canCompare ? {...original,retainedCheckFailures:{omitted:0,unavailable:0,entries:[{
                ...failure, failures:{...failure.failures,...caseValues ? {caseValues:comparisons} : {}},
            }]}} : original,
        },
        controls:{activateSource:()=>assert.fail('Read-only evidence changed conversation'),notice:()=>assert.fail('Unexpected notice')},
        isCurrent:()=>true,
        choose:async(_title,rows)=>{
            assert.deepEqual(rows,[uiText(locale,'result.returnToResult'),action]);
            return action;
        },
        async show(title,text,primary,position) {
            count++;
            if (!canCompare) {
                assert.equal(primary,undefined);
                assert.ok(!text.includes(action));
            } else if (title===action) {
                assert.ok(text.includes(uiText(locale,'result.retainedChecks')));
                assert.ok(text.includes('earlier-receipt') && text.includes('expected answer') && text.includes('prior answer'));
                await primary.run();
            } else {
                assert.ok(text.includes(uiText(locale,'result.openActions')+' → '+action));
                if (count===1) { position.scrollTop=5; await primary.run(); }
                else assert.equal(position.scrollTop,5);
            }
        },
    };
    await reviewChangeResult(host,original.workId,'owner',()=>{});
    assert.equal(count,3);
    canCompare=false;
    await reviewChangeResult(host,original.workId,'owner',()=>{});
    assert.equal(count,4);
});

for(const [locale,scenario] of [['en','resume'],['ko','resume'],['en','live'],['en','allowance'],['en','archived'],['en','drift']])
test(locale+' retained delivered result offers the same feedback resume route · '+scenario,async()=>{
    const held=result({state:'DELIVERED',recordedPhase:'REVIEW_READY',heldDirections:{entries:[],omitted:1}});
    const budget={execution:{limit:4,consumed:scenario==='allowance'?4:1,reserved:0},resolution:{limit:4,consumed:1,reserved:0}};
    const heading=locale==='ko' ? '이전 검토 준비 결과가 보존되어 있습니다. 후속 요청은 독립 평가를 기다리고 있습니다.'
        : 'Earlier review-ready result retained. Follow-up directions await independent assessment.';
    const resumeLabel=uiText(locale,'result.reviewResume');
    let archived=scenario==='archived',shown=0;
    const calls=[];
    const review=reviewChangeResult({
        controller:{...deliveryReads(held),inspectChangeResult:()=>held,
            listSourceSnapshotOperations:()=>({operations:[]}),
            inspectWorkRecovery:()=>({workId:held.workId,governed:true,state:'DELIVERED',heldDirectionCount:1,
                conversationId:'original-owner',sourceConversationId:'original-owner',...budget}),
            inspectConversation:()=>({archived,deleted:false}),
            hasLiveChangeOperation:()=>scenario==='live',
            inspectChangeContinuationPrerequisites:()=>({allowanceHold:'execution'})},
        controls:{},locale:()=>locale,isCurrent:()=>true,
        show:async(_title,text,primary)=>{
            assert.ok(text.includes(heading));
            assert.ok(!text.includes(uiText(locale,'result.ready')));
            assert.equal(text.includes(resumeLabel),scenario==='resume'||scenario==='drift');
            if (scenario==='resume'||scenario==='drift') {
                assert.equal(primary.label,uiText(locale,'result.openActions'));
                if (++shown===1) await primary.run();
            } else {
                assert.equal(primary.label,uiText(locale,'result.recovery'));
            }
        },
        choose:async(_title,rows)=>{
            assert.equal(rows[0],uiText(locale,'result.returnToResult'));
            assert.ok(rows.includes(uiText(locale,'result.reviewResume')));
            assert.ok(!rows.includes(uiText(locale,'result.saveBranch')));
            if(scenario==='drift')archived=true;
            return uiText(locale,'result.reviewResume');
        },
        execute:async(...args)=>{calls.push(args);return 'cancelled';},
    },held.workId,'viewer',()=>{});
    if(scenario==='drift')await assert.rejects(review,{message:uiText(locale,'result.changed')});
    else await review;
    assert.deepEqual(calls,scenario==='resume'?[['/change resume '+held.workId,'viewer',undefined]]:[]);
});

for (const locale of ['en','ko']) test(locale+' accepted plan result opens only the current original resume review', async () => {
    const plan = result({state:'ACTIVE',recordedPhase:'PLAN_READY'});
    let current=plan, selection='resume', views=0, live=false;
    const actions=[];
    const label=uiText(locale,'result.reviewResume');
    const command=new HostCommands(changeCommands({
        controller:{
            ...deliveryReads(plan),
            listSourceSnapshotOperations:()=>({operations:[]}),
            inspectConversation:()=>({generation:1,projectId:plan.projectId}),
            getConversationModelChoice:()=>({revision:0}),
            getConversationLanguage:()=>({revision:0}),
            inspectWork:()=>({workId:plan.workId,projectId:plan.projectId,epoch:1,lineageRoot:plan.workId,source:{raw:plan.request}}),
            inspectChangeResult:()=>current,
            hasLiveChangeOperation:()=>live,
        },
        controls:{},locale:()=>locale,isCurrent:()=>true,
        async show(_title,text,primary) {
            assert.equal(text.includes(uiText(locale,'result.planAccepted')),current===plan);
            assert.ok(!text.includes(uiText(locale,'result.ready')));
            assert.equal(text.includes(uiText(locale,'workRecovery.live')),live);
            if (current !== plan) {
                assert.equal(primary.label,uiText(locale,'result.recovery'));
                return;
            }
            assert.equal(primary.label,uiText(locale,'result.openActions'));
            if (selection !== 'close' && views++ === 0) await primary.run();
        },
        async choose(_title,rows) {
            assert.notEqual(selection,'close','Closing inspection opens no chooser');
            assert.equal(rows.includes(label),current===plan && !live);
            assert.equal(rows[0],uiText(locale,'result.returnToResult'));
            if(selection==='stale')current=result({...plan,blocked:['New hold']});
            return selection==='back'?rows[0]:label;
        },
        async execute(...args) {
            actions.push(args);
            if (selection.startsWith('changed-')) {
                current=result({...plan,blocked:['New hold']});
                return selection.slice('changed-'.length);
            }
            return 'cancelled';
        },
    }));
    const open=()=>{ views=0; return command.execute('/result '+plan.workId,'source-conversation'); };
    selection='close';
    assert.equal(await open(),'completed');
    assert.deepEqual(actions,[]);
    selection='resume';
    assert.equal(await open(),'completed');
    assert.equal(views,2);
    assert.deepEqual(actions,[['/change resume '+plan.workId,'source-conversation',undefined]]);
    selection='stale';
    await assert.rejects(open(),{message:uiText(locale,'result.changed')});
    selection='back';
    await open();
    current=plan;
    live=true;
    await open();
    live=false;
    for(const overrides of [
        {state:'UNKNOWN'}, {recordedPhase:'CHECKED'}, {blocked:['Retained hold']}, {blockedOmitted:1},
        {heldDirections:{entries:[],omitted:1}}, {provenance:{...plan.provenance,planVersion:null}},
        {provenance:{...plan.provenance,verificationVersion:null}},
    ]){
        current={...plan,...overrides};
        await open();
    }
    assert.equal(actions.length,1);
    for (const outcome of ['cancelled','started','completed']) {
        selection='changed-'+outcome;
        current=plan;
        if (outcome==='cancelled') await assert.rejects(open(),{message:uiText(locale,'result.changed')});
        else assert.equal(await open(),outcome);
        assert.equal(views,1);
    }
});

for (const kind of ['scope','check']) test(`live result keeps recorded ${kind} evidence and withholds duplicate replan`, async () => {
    const locale = 'ko', t = (key, options) => uiText(locale,key,options);
    const recorded = result({state:'ACTIVE',recordedPhase:'BLOCKED',blocked:['Original stop'],
        checks:{availability:'recorded',entries:[{checkId:'check',status:'fail',failures:{assertionIds:[],caseIds:['case'],omitted:0}}],total:1,omitted:0},
        replanKind:kind,...kind==='scope' ? {scopeFailure:{evidenceId:'scope-evidence',requirementId:'R',allowedChangePaths:{entries:['consumer.cjs'],omitted:0},
            unchangedPaths:{entries:[],omitted:0},replanAvailable:true}} : {}});
    const replan = t(kind==='scope'?'change.scopeReplanAction':'change.checkReplanAction');
    let live = true, shown = 0, changeWhileChoosing = false;
    const host = {
        controller:{
            ...deliveryReads(recorded),
            listSourceSnapshotOperations:()=>({operations:[]}),
            hasLiveChangeOperation: id => { assert.equal(id,recorded.workId); return live; },
            inspectWork:()=>({workId:recorded.workId,projectId:recorded.projectId,epoch:1}),
            inspectChangeResult:()=>recorded,
        },
        controls:{}, locale:()=>locale, isCurrent:()=>true,
        async show(_title,text,primary) {
            assert.equal(text.includes(t('workRecovery.live')),live);
            assert.ok(text.includes(t(live?'result.recordedBlockers':'result.blockers')) && text.includes('Original stop'));
            if (kind==='scope') {
                assert.ok(text.includes('scope-evidence'));
                assert.equal(text.includes(t('result.scopeReplan',{work:recorded.workId})),!live);
            }
            if (++shown===1) await primary.run();
        },
        async choose(_title,rows) {
            assert.ok(rows.includes(t('result.check.caseValuesAction')) && rows.includes(t('result.recovery')));
            assert.equal(rows.includes(replan),!live);
            if (changeWhileChoosing) live = true;
            return rows[0];
        },
        execute:async()=>assert.fail('Inspection dispatched work'),
    };
    await reviewChangeResult(host,recorded.workId,'owner',()=>{});
    live=false;
    shown=0;
    await reviewChangeResult(host,recorded.workId,'owner',()=>{});
    shown=0;
    changeWhileChoosing=true;
    await assert.rejects(reviewChangeResult(host,recorded.workId,'owner',()=>{}),{message:t('result.changed')});
});

test('sole original work inspection refuses changed result evidence before navigation', async () => {
    const original=result({state:'ACTIVE',recordedPhase:'BLOCKED',blocked:['Original failure']});
    let current=original;
    const host={
        controller:{
            ...deliveryReads(original),
            listSourceSnapshotOperations:()=>({operations:[]}),
            hasLiveChangeOperation:()=>false,
            inspectWork:()=>({workId:original.workId,projectId:original.projectId,epoch:1}),
            inspectChangeResult:()=>current,
        },
        isCurrent:()=>true,
        async show(_title,text,primary) {
            assert.equal(primary.label,uiText('en','result.recovery'));
            assert.ok(text.includes(uiText('en','result.nextDirectRecovery')));
            await primary.run();
            current=result({...original,blocked:['New failure']});
        },
        choose:()=>assert.fail('Sole inspection should not open a chooser'),
        execute:()=>assert.fail('Changed result must stop navigation'),
    };
    await assert.rejects(reviewChangeResult(host,original.workId,'owner',()=>{}),
        {message:uiText('en','result.changed')});
});

test('accepted plan with exhausted required allowance routes to its original work and fences drift', async () => {
    const execution = {limit:3, consumed:3, reserved:0}, resolution = {limit:8, consumed:2, reserved:0};
    const recorded = result({state:'ACTIVE',recordedPhase:'PLAN_READY',sharedAllowance:{execution,resolution}});
    const recovery = uiText('en','result.recovery'), resume = uiText('en','result.reviewResume');
    const holdLabel = 'Before resuming, choose ' + uiText('en','workRecovery.execution');
    const calls = [], selections = [];
    let allowanceHold = 'execution', fromWork = false, drift = false;
    const source = {submission:{conversationId:'owner',text:'/result original-work',revision:2}};
    const host = {
        controller:{
            ...deliveryReads(recorded),
            listSourceSnapshotOperations:()=>({operations:[]}),
            inspectWork:()=>({workId:recorded.workId,projectId:recorded.projectId,epoch:1}),
            inspectChangeResult:()=>recorded,
            hasLiveChangeOperation:()=>false,
            inspectChangeContinuationPrerequisites:()=>({allowanceHold}),
        },
        controls:{}, isCurrent:()=>true,
        async show(_title,text,primary) {
            assert.ok(text.includes(uiText('en','result.planAccepted')));
            assert.ok(text.includes(holdLabel));
            assert.ok(!text.includes(uiText('en','result.nextAcceptedPlan')));
            assert.ok(!text.includes(recorded.nextAction));
            assert.ok(text.includes(workAllowanceText('en','execution',execution)));
            assert.ok(text.includes(workAllowanceText('en','resolution',resolution)));
            if (fromWork) {
                assert.equal(primary, undefined);
                assert.ok(text.includes(uiText('en','result.nextFromWork')));
            } else {
                await primary.run();
            }
        },
        async choose(_title,rows) {
            selections.push(rows);
            assert.ok(!rows.includes(resume));
            if (drift) allowanceHold = undefined;
            return recovery;
        },
        async execute(...args) { calls.push(args); return 'completed'; },
    };
    const open=()=>reviewChangeResult(host,recorded.workId,'owner',()=>{}, {context:source,fromWork});
    assert.equal(await open(),'completed');
    assert.deepEqual(calls,[['/work original-work','owner',source]]);
    fromWork = true;
    assert.equal(await open(),undefined);
    assert.equal(calls.length,1);
    assert.equal(selections.length,1);
    fromWork = false;
    drift = true;
    await assert.rejects(open(),{message:uiText('en','result.changed')});
    assert.equal(calls.length,1);
});

test('delegated result choices distinguish separate assignments to the same conversation', async () => {
    const entries = [1, 2].map(index => ({assignmentId: 'sameprefix-' + index, conversationId: 'same-child',
        workId: 'work-' + index, resultId: 'result-' + index, publicationHash: String(index).repeat(64),
        assignmentProof: 'assignment-proof-' + index, instructionPreview: `Task ${index}\n\u001b[31m검사 ${'가'.repeat(80)}`,
        phase: 'BLOCKED', reviewReady: false, uncertain: false}));
    const selected = entries[1], opened = [];
    const command = changeCommands({
        controller: {
            inspectConversation: () => ({generation: 1, projectId: 'P', workId: 'ordinary-parent'}),
            inspectChangeActivity: () => undefined,
            getConversationModelChoice: () => ({revision: 0}),
            getConversationLanguage: () => ({revision: 0}),
            conversationChange: () => ({workId: selected.workId}),
            inspectRecordedDelegatedResults: () => ({entries}),
            inspectConversationResult: id => {
                assert.equal(id, selected.resultId);
                return {...selected, result: {kind: 'governed-work-observation/v1', workId: selected.workId, phase: 'BLOCKED', reviewReady: false}};
            },
        },
        isCurrent: id => id === 'parent',
        choose: () => assert.fail('expected a stable result choice'),
        async chooseItems(_title, items) {
            assert.notEqual(items[1].label, items[2].label);
            assert.match(items[1].label, /Task 1 검사/);
            assert.match(items[2].label, /Task 2 검사/);
            assert.doesNotMatch(items[2].label, /[\n\u001b]/u);
            assert.match(items[2].label, /…/u);
            assert.match(items[1].label, /Recorded result: blocked/);
            assert.match(items[2].label, /Recorded result: blocked/);
            return selected.resultId;
        },
        async show(_title, text, action) {
            assert.match(text, /Original result result-2/);
            assert.match(text, /continue assignment sameprefix-2/);
            await action.run();
        },
        async execute(command, target) { opened.push([command, target]); return 'completed'; },
    }).find(command => command.name === 'result');
    assert.equal(await command.run('', 'parent'), 'completed');
    assert.deepEqual(opened, [['/work work-2', 'parent']]);
});

for (const route of ['registry', 'captured continuation']) test(`parent result preserves ${route} when a work is inferred`, async t => {
    const f = await registryWorld(t), id = f.works[1].workId;
    const target = f.c.createConversation({projectId:'B'}).conversationId;
    f.c.conversationChange = () => ({workId:id, ...(route === 'captured continuation' ? {capturedContinuation:true} : {})});
    f.c.inspectRecordedDelegatedResults = () => ({entries:[], unavailable:true, omitted:false});
    const visited = [], shown = [], before = workLedger(f.c);
    const command = changeCommands({
        controller:f.c, isCurrent:cid => cid === target,
        choose:() => assert.fail('Expected stable result choices'),
        async chooseItems(title, items) {
            visited.push(title);
            return items.find(item => item.value === (visited.length === 1 ? 'registry' : 'close')).value;
        },
        show:async(title,text) => shown.push({title,text}),
    }).find(command => command.name === 'result');
    await command.run('',target);
    if (route === 'registry') {
        assert.match(visited[0], /^Recorded delegated results/);
        assert.match(visited[1], /^Task result · B/);
        assert.equal(shown.length,0);
    } else {
        assert.deepEqual(visited,[]);
        assert.equal(shown.length,1);
        assert.match(shown[0].text, /Owner request 1/);
    }
    assert.deepEqual(workLedger(f.c),before);
});

for(const locale of ['en','ko']) {
    test(`${locale} overview shows project and recovery before the evidence summary`,()=>{
        const reason='Original final judgment still needs retained witnesses';
        const view=result({projectId:'Project\n\u009bscope',blocked:[reason],verificationEvidence:{availability:'unavailable',reason:'Independent verification assessment remains incomplete',requirements:[]}});
        const text=changeResultText(view,locale),header=text.slice(0,text.indexOf(uiText(locale,'result.output')));
        for(const expected of [uiText(locale,'result.project',{id:'"Project\\n\\u009bscope"'}),uiText(locale,'result.readOnly'),
            uiText(locale,'result.checkSummary')+' · '+uiText(locale,'result.check.pass')+': 1',
            uiText(locale,'result.reviewSummary')+' · '+uiText(locale,'result.review.clear')+': 1',uiText(locale,'result.verificationPending')])assert.ok(header.includes(expected),expected);
        assert.ok(!header.includes(uiText(locale,'result.ready')));assert.ok(!text.includes('\u009b'));
        assert.ok(header.indexOf(reason)<header.indexOf(uiText(locale,'result.checkSummary')));
        assert.ok(text.includes('/work original-work'));
        assert.ok(text.indexOf('/change inspect original-work')>text.indexOf(uiText(locale,'result.provenance')));
        assert.ok(text.includes(reason));assert.ok(text.includes(uiText(locale,'result.delivery')));
    });
    test(`${locale} overview distinguishes known, unplanned, unavailable and omitted outcomes`,()=>{
        const header=overrides=>{const text=changeResultText(result(overrides),locale);return text.slice(text.indexOf(uiText(locale,'result.checkSummary')),text.indexOf(uiText(locale,'result.output')));};
        for(const availability of ['not-planned','unavailable']){
            const text=header({checks:{availability,entries:[{checkId:'old-pass',status:'pass',passed:true}],total:null,omitted:0}});
            const checkLine=text.split('\n').find(line=>line.startsWith(uiText(locale,'result.checkSummary')+' · '));
            assert.ok(checkLine.includes(uiText(locale,availability==='not-planned'?'result.notPlanned':'result.unavailable')));
            assert.ok(!checkLine.includes(uiText(locale,'result.check.pass')+': 1'));
        }
        const empty=header({checks:{availability:'recorded',entries:[],total:0,omitted:0}});
        assert.ok(empty.includes(uiText(locale,'result.noChecks')));
        const omitted=header({checks:{availability:'recorded',entries:[],total:3,omitted:3},reviews:{availability:'recorded',entries:[],total:2,omitted:2}});
        assert.ok(omitted.includes(uiText(locale,'result.summaryOmitted',{count:3})));
        assert.ok(omitted.includes(uiText(locale,'result.summaryOmitted',{count:2})));
        for(const key of ['result.noChecks','result.noReview','result.check.fail','result.check.missing','result.unavailable'])assert.ok(!omitted.includes(uiText(locale,key)),key);
        const mixed=header({checks:{availability:'recorded',entries:[
            {checkId:'candidate',status:'pass',passed:true},{checkId:'unproven',status:'pass',passed:false},
            {checkId:'base',target:'base',purpose:'baseline',status:'baseline-observed',observed:true,passed:false},
        ],total:4,omitted:1},reviews:{availability:'recorded',entries:[
            {key:'current',state:'selected',outcome:'clear',findingCount:0},{key:'old',state:'stale',outcome:'clear',findingCount:0},
            {key:'carry',state:'carried',outcome:'findings',findingCount:2},
        ],total:3,omitted:0}});
        const checkLine=mixed.split('\n').find(line=>line.startsWith(uiText(locale,'result.checkSummary')+' · '));
        const reviewLine=mixed.split('\n').find(line=>line.startsWith(uiText(locale,'result.reviewSummary')+' · '));
        assert.ok(checkLine.includes(uiText(locale,'result.check.pass')+': 1'));
        assert.ok(!checkLine.includes(uiText(locale,'result.check.pass')+': 2'));
        assert.ok(checkLine.includes(uiText(locale,'result.baseline')+' · '+uiText(locale,'result.check.baseline-observed')+': 1'));
        assert.ok(checkLine.includes(uiText(locale,'result.check.unavailable')+': 1'));
        assert.ok(reviewLine.includes(uiText(locale,'result.review.clear')+': 1'));
        assert.ok(!reviewLine.includes(uiText(locale,'result.review.clear')+': 2'));
        assert.ok(reviewLine.includes(uiText(locale,'result.carried')));
    });
    test(`${locale} context recovery action is visible before retained output evidence`, () => {
        const nextAction = 'Inspect model choices with /role-model adjudicator.';
        const text = changeResultText(result({modelContextFailure: 'MODEL_CONTEXT_LIMIT', nextAction}), locale);
        assert.ok(text.includes(uiText(locale, 'modelContext.limitTitle')));
        assert.ok(text.indexOf(nextAction) < text.indexOf(uiText(locale, 'result.output')));
        assert.equal(text.split(nextAction).length, 2);
    });
    test(`${locale} a missing composite part stays visible despite recorded checks and reviewer positions`,()=>{
        const text=changeResultText(result({verificationEvidence:{availability:'unavailable',reason:'Required scope evidence is unavailable',requirements:[{
            requirementId:'compound',kind:'all-of',strategyDigest:'a'.repeat(64),reviewKeys:['behavior-review','scope-review'],witnessAvailability:'unavailable',witnessIds:[],reviewLaunchIds:[],
            parts:[{kind:'consumer-cases',strategyDigest:'b'.repeat(64),reviewKeys:['behavior-review','scope-review'],witnessAvailability:'recorded',witnessIds:['actual-check']},
                {kind:'manifest-scope-duty',strategyDigest:'c'.repeat(64),reviewKeys:['scope-review'],witnessAvailability:'unavailable',witnessIds:[],scope:{witnessId:'scope-observation',predicate:'scope',actual:{satisfied:false,changedCount:2,violationCount:1},adverse:{satisfied:false}}}],
        }]}}),locale);
        assert.ok(text.includes(uiText(locale,'result.strategy.all-of')));
        assert.ok(text.includes(uiText(locale,'result.strategy.consumer-cases')+' · '+uiText(locale,'result.observationRecorded')));
        assert.ok(text.includes(uiText(locale,'result.strategy.manifest-scope-duty')+' · '+uiText(locale,'result.unavailable')));
        for(const key of ['result.scopeViolation','result.verificationReviewPending','result.verificationPending'])assert.ok(text.includes(uiText(locale,key)),key);
        assert.ok(!text.includes(uiText(locale,'result.scopeWithin')));
    });
    test(`${locale} baseline observations stay distinct from candidate passes and pending independent assessment`,()=>{
        const view=result({checks:{availability:'recorded',entries:[
            {checkId:'baseline-check',target:'base',purpose:'baseline',status:'baseline-observed',observed:true,passed:false},
            {checkId:'candidate-check',status:'pass',passed:true},
        ],total:2,omitted:0},verificationEvidence:{availability:'unavailable',reason:'A distinct review is pending',requirements:[{
            requirementId:'scope',kind:'manifest-scope-duty',strategyDigest:'a'.repeat(64),reviewKey:'independent-review',witnessAvailability:'recorded',witnessIds:['original-scope-witness'],reviewLaunchIds:[],
            scope:{witnessId:'original-scope-witness',predicate:'complete-effective-manifest-scope/v1',actual:{satisfied:true,changedCount:1,violationCount:0},adverse:{satisfied:false}},
        }]}});
        const text=changeResultText(view,locale);
        assert.ok(text.includes(uiText(locale,'result.checksWithBaseline')));
        assert.ok(text.includes(uiText(locale,'result.baseline')+' · '+uiText(locale,'result.check.baseline-observed')+' · "baseline-check"'));
        assert.ok(!text.includes(uiText(locale,'result.check.pass')+' · "baseline-check"'));
        assert.ok(text.includes(uiText(locale,'result.check.pass')+' · "candidate-check"'));
        for(const key of ['result.scopeWithin','result.scopeAdverseRejected','result.verificationReviewPending','result.verificationPending'])assert.ok(text.includes(uiText(locale,key)),key);
        const violation=changeResultText(result({verificationEvidence:{...view.verificationEvidence,requirements:[{
            ...view.verificationEvidence.requirements[0],scope:{witnessId:'failed-scope-witness',predicate:'complete-effective-manifest-scope/v1',actual:{satisfied:false,changedCount:2,violationCount:1},adverse:{satisfied:false}},
        }]}}),locale);
        assert.ok(violation.includes(uiText(locale,'result.scopeViolation')));
        assert.ok(!violation.includes(uiText(locale,'result.scopeWithin')));
        for(const oversized of [{requirementId:'identity'.repeat(800)},{reason:'long diagnosis '.repeat(500)}]){
            const omitted=changeResultText(result({verificationEvidence:{availability:'unavailable',requirements:[{
                ...view.verificationEvidence.requirements[0],...oversized,
            }]}}),locale);
            assert.ok(omitted.includes(uiText(locale,'result.omitted',{count:1})));
            for(const key of ['result.scopeWithin','result.scopeAdverseRejected','result.verificationReviewPending'])assert.ok(!omitted.includes(uiText(locale,key)),key);
            assert.ok(omitted.includes(uiText(locale,'result.verificationPending')));
            assert.ok(omitted.includes('/work original-work'));
        }
        const invalid=changeResultText(result({checks:{availability:'recorded',entries:[
            {checkId:'unproven-baseline',target:'base',purpose:'baseline',status:'baseline-observed',observed:false,passed:false},
            {checkId:'candidate-is-not-baseline',target:'candidate',status:'baseline-observed',observed:true,passed:true},
        ],total:2,omitted:0}}),locale);
        assert.ok(!invalid.includes(uiText(locale,'result.check.baseline-observed')));
        for(const id of ['unproven-baseline','candidate-is-not-baseline'])assert.ok(invalid.includes(uiText(locale,'result.check.unavailable')+' · '+JSON.stringify(id)));
    });
    test(`${locale} result never promotes an unproven pass, hides omitted entries as empty, or sends recovery to a different task`,()=>{
        const view=result({
            checks:{availability:'recorded',entries:[{checkId:'missing-case-proof',status:'pass',passed:false}],total:1,omitted:0},
            changes:{availability:'recorded',entries:[],total:1,omitted:1},
            reviews:{availability:'recorded',entries:[],total:2,omitted:2},
            request:'Long owner text\n'.repeat(300),
        });
        const text=changeResultText(view,locale);
        assert.ok(text.includes(uiText(locale,'result.check.unavailable')+' · "missing-case-proof"'));
        assert.ok(!text.includes(uiText(locale,'result.check.pass')+' · "missing-case-proof"'));
        for(const key of ['result.noChanges','result.noReview']) assert.ok(!text.includes(uiText(locale,key)));
        assert.ok(text.includes(uiText(locale,'result.omitted',{count:1})));
        assert.ok(text.includes(uiText(locale,'result.omitted',{count:2})));
        assert.ok(text.includes('/work original-work')); assert.ok(text.includes('/change inspect original-work'));
        assert.ok(text.indexOf('missing-case-proof')<text.indexOf(view.request.slice(0,100)));
        assert.ok(text.includes(uiText(locale,'result.delivery')));
        assert.ok(text.includes(uiText(locale,'result.sourceUncompared')));
        assert.ok(text.includes('Recorded metadata only.'));
        const primary=text.split(uiText(locale,'result.provenance'))[0];
        assert.ok(!primary.includes('repairChange'));
    });
}

test('result displays path identities safely and distinguishes carried findings from current clear review',()=>{
    const view=result({request:'Owner\x1b[2J text',changes:{availability:'recorded',entries:[{path:'line\n\x1b[2Jfile',kind:'modified'},{path:'C1\u009btest.cjs',kind:'added'}],total:2,omitted:0},reviews:{availability:'recorded',entries:[{key:'carried',state:'carried',outcome:'findings',findingCount:2},{key:'old-clear',state:'stale',outcome:'clear',findingCount:0}],total:2,omitted:0}});
    const text=changeResultText(view,'en');
    assert.ok(!text.includes('\x1b')); assert.ok(text.includes(JSON.stringify(view.changes.entries[0].path)));
    assert.ok(text.includes('"C1\\u009btest.cjs"'));assert.ok(!text.includes('\u009b'));
    assert.match(text,/Review has findings · "carried" · 2 findings · Carried/);
    assert.match(text,/Evidence unavailable or no longer applicable · "old-clear"/);
    assert.ok(!text.includes('Review clear · "old-clear"'));
});

test('large recorded sections retain checks, review and exact recovery within the actual host display limit',async()=>{
    const long='\u009b'.repeat(1000),view=result({request:'owner '.repeat(5461),blocked:Array(16).fill('reason '.repeat(170)),nextAction:'next'.repeat(1024),candidate:{versionId:'candidate',path:'/saved/'+long.repeat(8)},registeredSourceRoot:'/source/'+long.repeat(8),
        changes:{availability:'recorded',entries:Array.from({length:100},(_,i)=>({path:long+i,kind:'modified'})),total:101,omitted:1},
        checks:{availability:'recorded',entries:Array.from({length:100},(_,i)=>({checkId:'check'+i+'x'.repeat(600),status:'pass',passed:true})),total:101,omitted:1},
        reviews:{availability:'recorded',entries:Array.from({length:100},(_,i)=>({key:'review'+i+'x'.repeat(600),state:'selected',outcome:'clear',findingCount:0})),total:101,omitted:1},
        verificationEvidence:{availability:'unavailable',reason:'Missing observation '.repeat(600),requirements:Array.from({length:100},(_,i)=>({requirementId:'requirement'+i+'x'.repeat(600),kind:'manifest-scope-duty',strategyDigest:'a'.repeat(64),reviewKey:'independent-review',witnessAvailability:'unavailable',witnessIds:[],reviewLaunchIds:[]}))},
    });
    const text=changeResultText(view,'en');assert.ok(text.length<65536,text.length);
    for(const key of ['result.changes','result.checks','result.verificationEvidence','result.reviews','result.next','result.provenance','result.shortened','result.longLocation'])assert.ok(text.includes(uiText('en',key)),key);
    assert.ok(text.includes('/work original-work'));assert.ok(text.includes('101 additional entries are omitted'));
    assert.ok(!text.includes(uiText('en','result.noChanges')));assert.ok(!text.includes('\u009b'));
    // Exercise the real display component; reaching the end must retain provenance, not its overflow warning.
    const {InspectionDetails}=await import('../../dist/ui/inspection-details.js');
    const {initTheme}=await import('@earendil-works/pi-coding-agent');
    const {stripTerminalSequences,TuiAltScreen}=await import('@earendil-works/pi-tui');
    initTheme('dark',false);const detail=new InspectionDetails('Task result',text,()=>{});
    const terminal={columns:80,rows:24,kittyProtocolActive:false,start(){},stop(){},async drainInput(){},write(){},moveBy(){},clearLine(){},clearFromCursor(){},clearScreen(){},hideCursor(){},showCursor(){},setTitle(){},setProgress(){},setProgramStatus(){}};
    const screen=new TuiAltScreen(terminal,true);screen.setLayoutRoot(detail);let rendered='';
    try {
        screen.start();await new Promise(resolve=>setTimeout(resolve,30));
        for(let page=0;page<150;page++) {
            rendered=screen.getScreenLines().map(stripTerminalSequences).join('\n');
            assert.ok(!rendered.includes('[Display shortened; inspect the original retained work for full details]'));
            if(rendered.includes('Verification: verification'))break;
            detail.handleInput('\x1b[6~');screen.requestRender();await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.ok(rendered.includes('Verification: verification'),rendered);
    }finally{detail.dispose();screen.stop({preserveScreen:true});}
});

test('result discovery scopes to selected project, preserves exact selected work and rejects navigation drift',async t=>{
    const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId;
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:'  Keep 한국어\nrequest  '});
    const before=workLedger(f.c),shown=[];let current=true;
    const host={controller:f.c,isCurrent:()=>current,show:async(title,text)=>shown.push({title,text}),choose:async(title,rows)=>{
        assert.match(title,/Task result · B/);assert.ok(!rows.some(row=>row.startsWith('Start a new')));
        assert.ok(!rows.some(row=>row.includes(f.works[0].workId)));
        if(shown.length)return rows.find(row=>row.startsWith('Close'));
        return rows.find(row=>row.includes(f.works[1].workId));
    }};
    const registry=new HostCommands(changeCommands(host));
    await registry.execute('/result',cid);assert.equal(shown.length,1);assert.ok(shown[0].text.includes('Owner request 1 한국어'));
    await registry.execute('/result '+f.works[0].workId,cid);assert.ok(shown[1].text.includes('/work '+f.works[0].workId));
    const stale=new HostCommands(changeCommands({...host,choose:async(_title,rows)=>{current=false;return rows[0];}}));
    await assert.rejects(stale.execute('/result',cid),/target changed/);assert.equal(shown.length,2);
    assert.equal(f.c.inspectConversation(cid).draft.text,'  Keep 한국어\nrequest  ');assert.deepEqual(workLedger(f.c),before);
});

test('linked original result opens directly and work result returns to original menu without dispatch',async t=>{
    const f=await managedWorld(t),tasks=[];
    const starter=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,
        choose:async(_title,rows)=>rows.find(row=>row===uiText('en','change.startAccept')),
        show:async(_title,_text,primary)=>{await primary?.run();},
        controls:{models:f.models,input:async()=>undefined,draft:()=>'',notice(){},activateSource:async()=>assert.fail('Unexpected source switch'),launch:(_cid,task)=>tasks.push(task)}}));
    assert.equal(await starter.execute('/change start Preserve original identity',f.cid),'started');
    assert.equal(tasks.length,1);
    const work=await tasks[0];
    const before=workLedger(f.c),shown=[],h={controller:f.c,isCurrent:()=>true,locale:()=> 'ko',show:async(title,text)=>shown.push({title,text})};
    await new HostCommands(changeCommands({...h,choose:async()=>assert.fail('Linked result should open directly')})).execute('/result',f.cid);
    assert.equal(shown[0].title,'작업 결과');assert.ok(shown[0].text.includes('Preserve original identity'));
    let menus=0;
    const registry=new HostCommands(workCommands({...h,choose:async(title,rows)=>{assert.ok(title.includes(work.workId));menus++;return menus===1?rows.find(row=>row==='결과 보기'):undefined;},input:async()=>assert.fail('No write form'),notice(){},activate:async()=>assert.fail('No navigation')}));
    assert.equal(await registry.execute('/work '+work.workId,f.cid),'cancelled');assert.equal(menus,2);assert.equal(shown.length,2);
    assert.equal(f.calls.length,1);assert.deepEqual(workLedger(f.c),before);f.pass();
});

test('work recovery opens the exact result actions and Back returns to the same menu without another work route',async t=>{
    const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId;
    const inspect=f.c.inspectChangeResult.bind(f.c);
    f.c.inspectChangeResult=workId=>({...inspect(workId),reviewReady:true});
    const before=workLedger(f.c);
    let menus=0, results=0;
    const registry=new HostCommands(workCommands({
        controller:f.c,isCurrent:()=>true,locale:()=> 'ko',
        choose:async(title,rows)=>{
            assert.ok(title.includes(id));
            if(title.startsWith(uiText('ko','result.nextTitle'))){
                assert.equal(rows[0],uiText('ko','result.returnToResult'));
                assert.ok(rows.includes(uiText('ko','result.reviewDelivery')));
                assert.ok(!rows.includes(uiText('ko','result.recovery')));
                return rows[0];
            }
            return ++menus===1?uiText('ko','result.view'):undefined;
        },
        show:async(title,_text,primary)=>{
            assert.equal(title,uiText('ko','result.title'));
            assert.equal(primary?.label,uiText('ko','result.openActions'));
            if (++results===1) await primary.run();
        },
        execute:async()=>assert.fail('Back dispatched another command'),input:async()=>assert.fail('No write form'),
        notice(){},activate:async()=>assert.fail('No navigation'),
    }));
    assert.equal(await registry.execute('/work '+id,cid),'cancelled');
    assert.equal(menus,2);
    assert.equal(results,2);
    assert.deepEqual(workLedger(f.c),before);
});

test('a work result hands same-conversation clarification back to the composer',async t=>{
    const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId;
    const inspect=f.c.inspectChangeResult.bind(f.c);
    f.c.inspectChangeResult=workId=>({...inspect(workId),planningClarification:{
        outputId:'original-questions',questions:{entries:['What should remain unchanged?'],total:1,omitted:0},
        reply:{conversationId:cid},
    }});
    const before=workLedger(f.c),notices=[],activated=[];
    let choices=0;
    const registry=new HostCommands(workCommands({
        controller:f.c,isCurrent:()=>true,
        choose:async(_title,rows)=>{
            assert.ok(++choices<=2,'Clarification must hand off to the editor');
            const label=uiText('en',choices===1?'result.view':'result.planningClarificationReply');
            assert.ok(rows.includes(label));
            return label;
        },
        show:async(_title,detail,primary)=>{
            assert.match(detail,/What should remain unchanged/);
            await primary.run();
        },
        execute:async()=>assert.fail('Entering the reply pane dispatched a command'),input:async()=>assert.fail('No write form'),
        notice:text=>notices.push(text),activate:async target=>activated.push(target),
    }));
    assert.equal(await registry.execute('/work '+id,cid),'completed');
    assert.equal(choices,2);
    assert.deepEqual(activated,[cid]);
    assert.equal(notices.length,1);
    assert.deepEqual(workLedger(f.c),before);
});

for (const locale of ['en', 'ko']) test(locale+' result initially explains the next step and known blocker before long histories', async()=>{
    const blocker='Choose the original runtime before resuming this work';
    const nextAction='Restore the original runtime route before resuming.';
    const value=result({blocked:[blocker],nextAction,changes:{availability:'recorded',entries:Array.from({length:100},(_,i)=>({path:'long-history-'+i+'.cjs',kind:'modified'})),total:100,omitted:0}});
    const before=JSON.stringify(value),text=changeResultText(value,locale);
    assert.equal(JSON.stringify(value),before);assert.equal(text.split(uiText(locale,'result.blockers')).length-1,1);
    assert.ok(text.indexOf(uiText(locale,'result.next'))<text.indexOf(blocker));assert.ok(text.indexOf(blocker)<text.indexOf(uiText(locale,'result.output')));
    assert.ok(text.indexOf(nextAction)<text.indexOf(uiText(locale,'result.output')));
    assert.equal(text.split(nextAction).length,2);
    const {InspectionDetails}=await import('../../dist/ui/inspection-details.js');
    const {initTheme}=await import('@earendil-works/pi-coding-agent');
    const {stripTerminalSequences,TuiAltScreen}=await import('@earendil-works/pi-tui');
    initTheme('dark',false);const detail=new InspectionDetails(uiText(locale,'result.title'),text,()=>{},locale);
    const terminal={columns:80,rows:24,kittyProtocolActive:false,start(){},stop(){},async drainInput(){},write(){},moveBy(){},clearLine(){},clearFromCursor(){},clearScreen(){},hideCursor(){},showCursor(){},setTitle(){},setProgress(){},setProgramStatus(){}};
    const screen=new TuiAltScreen(terminal,true);screen.setLayoutRoot(detail);
    try {screen.start();await new Promise(resolve=>setTimeout(resolve,30));const initial=screen.getScreenLines().map(stripTerminalSequences).join('\n');assert.ok(initial.includes(uiText(locale,'result.attention')),initial);assert.ok(initial.includes(uiText(locale,'result.next')),initial);assert.ok(initial.includes('/work original-work'),initial);assert.ok(initial.includes(blocker),initial);assert.ok(initial.includes(nextAction),initial);}finally{detail.dispose();screen.stop({preserveScreen:true});}
    const omitted=changeResultText(result({blocked:[],blockedOmitted:3}),locale);assert.ok(omitted.indexOf(uiText(locale,'result.omitted',{count:3}))<omitted.indexOf(uiText(locale,'result.output')));
    const supporting=Array.from({length:7},(_,i)=>`Supporting ${i} ${'x'.repeat(1000)}`);
    const bounded=changeResultText(result({blocked:[blocker,...supporting],blockedOmitted:3,nextAction}),locale);
    assert.ok(bounded.indexOf(nextAction)<bounded.indexOf(supporting[0]));
    assert.ok(bounded.includes(supporting[4]));
    assert.ok(!bounded.includes(supporting[5]));
    assert.ok(bounded.includes(uiText(locale,'result.omitted',{count:5})));
    const ready=changeResultText(result({reviewReady:true,blocked:[blocker]}),locale);assert.ok(ready.startsWith(uiText(locale,'result.ready')));assert.ok(ready.includes(blocker));
    const readyFromWork=changeResultText(result({reviewReady:true,nextAction}),locale,true);
    assert.ok(readyFromWork.includes(uiText(locale,'result.nextReadyFromWork')));
    const deliveryCue = uiText(locale,'result.nextReadyActions');
    assert.ok(!ready.includes(deliveryCue) && !readyFromWork.includes(deliveryCue));
    for (const fromWork of [false,true]) {
        const actionable = changeResultText(result({reviewReady:true}),locale,fromWork,false,{deliveryAvailable:true});
        assert.ok(actionable.indexOf(deliveryCue) > 0 && actionable.indexOf(deliveryCue) < actionable.indexOf(uiText(locale,'result.output')));
    }
    assert.ok(readyFromWork.indexOf(nextAction)>readyFromWork.indexOf(uiText(locale,'result.provenance')));
    const clear=changeResultText(result({blocked:[],blockedOmitted:0}),locale);assert.ok(!clear.includes(uiText(locale,'result.blockers')));
    const empty=changeResultText(result({blocked:[blocker],nextAction:''}),locale);
    assert.ok(!empty.includes(uiText(locale,'result.recordedNextAction',{action:''}).trim()));
});

test('recorded output-contract refusal explains unavailable check in EN and KO',()=>{
 const view=result({checks:{availability:'recorded',entries:[{checkId:'check-output',status:'unavailable',passed:false,cleanup:'removed',unavailableReason:'output-contract'}],total:1,omitted:0}});
 assert.match(changeResultText(view,'en'),/Verification report rejected or its items/);
 assert.match(changeResultText(view,'ko'),/검사 보고서가 거부되었거나 항목·입력 정보가 선언과 다름/);
 view.checks.entries[0].outputIssues={'case-missing':20,'assertion-unexpected':1};
 assert.match(changeResultText(view,'en'),/Missing case results · 20.*Unexpected assertion results · 1/);
 assert.match(changeResultText(view,'ko'),/케이스 결과 20개 누락.*선언에 없는 검증 항목 결과 1개/);
 view.checks.entries[0].outputIssueIds={'case-missing':['healthy','adverse'],'assertion-unexpected':['extra\nassertion']};
 for(const locale of ['en','ko']){
  const text=changeResultText(view,locale);
  assert.ok(text.includes('"healthy", "adverse", …'));
  assert.ok(text.includes('"extra\\nassertion"'));
 }
 assert.doesNotMatch(changeResultText(view,'en'),/Verification report rejected or its items/);
 const unrelated=result({checks:{availability:'recorded',entries:[{checkId:'check-timeout',status:'unavailable',passed:false,cleanup:'removed'}],total:1,omitted:0}});
 assert.doesNotMatch(changeResultText(unrelated,'en'),/Verification report rejected or its items/);
});

test('material failure items keep their exact quoted IDs and indicate omitted items in EN and KO',()=>{
    const failed = {checkId:'behavior', status:'fail', passed:false, cleanup:'removed',
        failures:{assertionIds:['value\nother'], caseIds:['adverse'], omitted:3}};
    const view = result({checks:{availability:'recorded', entries:[failed], total:1, omitted:0}});
    for(const locale of ['en','ko']) {
        const text = changeResultText(view,locale);
        assert.ok(text.includes(uiText(locale,'result.check.failedAssertions',{ids:'"value\\nother"'})));
        assert.ok(text.includes(uiText(locale,'result.check.mismatchedCases',{ids:'"adverse"'})));
        assert.ok(text.includes(uiText(locale,'result.check.failureIdsOmitted',{count:3})));
    }
});

for(const locale of ['en','ko'])test(`${locale} case details retain exact values with controls and omissions visible`,()=>{
    const bidi='\u202e', escaped='\\u202e';
    const failures={assertionIds:[],caseIds:['mismatch'],omitted:2,caseValues:[
        {id:'mismatch',expected:{kind:'return',value:'before'+bidi+'\n'},observed:{kind:'rejection',value:null}},
    ]};
    const view=result({checks:{availability:'recorded',entries:[{checkId:'check',status:'fail',failures}],total:1,omitted:0}});
    const details=changeCaseValuesText(view,locale);
    assert.ok(details.includes(uiText(locale,'result.check.caseExpected',{value:uiText(locale,'result.check.caseValue.return',{value:'"before'+escaped+'\\n"'})})));
    assert.ok(details.includes(uiText(locale,'result.check.caseObserved',{value:uiText(locale,'result.check.caseValue.rejection',{value:uiText(locale,'result.check.largeCaseValue')})})));
    assert.ok(details.includes(uiText(locale,'result.check.failureIdsOmitted',{count:2})));
    assert.ok(!details.includes(bidi));
    assert.ok(!changeResultText(view,locale).includes('before'));
});

for(const locale of ['en','ko'])test(`${locale} check details separate command production, report format and verdict`,()=>{
 const checks=[
  {checkId:'crashed',production:{exitCode:1,termination:null,report:'rejected'}},
  {checkId:'timeout',production:{exitCode:124,termination:'timeout',report:'unknown'}},
  {checkId:'cancelled',production:{exitCode:130,termination:'aborted',report:'unknown'}},
  {checkId:'limited',production:{exitCode:125,termination:'output-limit',report:'unknown'}},
  {checkId:'incomplete',production:{exitCode:0,termination:null,report:'accepted'}},
  {checkId:'unknown',production:{exitCode:null,termination:null,report:'unknown'}},
  {checkId:'legacy'},
 ].map(check=>({...check,status:'unavailable',passed:false,cleanup:'removed'}));
 const entries=[...checks,{checkId:'verified',status:'pass',passed:true,observedCounts:{assertions:15,cases:15}}];
 const text=changeResultText(result({reviewReady:false,checks:{availability:'recorded',entries,total:entries.length,omitted:0}}),locale);
 const row=id=>text.split('\n').find(line=>line.includes(' · '+JSON.stringify(id)));
 assert.ok(row('crashed').includes(uiText(locale,'result.check.exited',{code:1})));
 assert.ok(row('crashed').includes(uiText(locale,'result.check.report.rejected')));
 for(const [id,key]of[['timeout','timeout'],['cancelled','aborted'],['limited','output-limit'],['unknown','processUnknown']])assert.ok(row(id).includes(uiText(locale,'result.check.'+key)));
 assert.ok(row('incomplete').includes(uiText(locale,'result.check.report.accepted')));
 assert.ok(checks.every(check=>row(check.checkId).startsWith(uiText(locale,'result.check.unavailable'))));
 assert.equal(row('legacy'),uiText(locale,'result.check.unavailable')+' · "legacy"');
 const observations=uiText(locale,'result.check.observedCounts',{assertions:15,cases:15});
 assert.ok(row('verified').includes(observations));
 assert.ok(!row('incomplete').includes(observations));
 assert.doesNotMatch(text,/infrastructure|인프라/);
 assert.ok(!text.includes(uiText(locale,'result.check.outputContract')));
});

for (const locale of ['en', 'ko']) test(`${locale} result reports the fault control separately from the passing candidate`, () => {
    for (const consumerControl of ['pending', 'matched', 'prediction-mismatch', 'held']) {
        const view = result({});
        view.checks.entries[0].consumerControl = consumerControl;
        const text = changeResultText(view, locale);
        assert.ok(text.includes(uiText(locale, 'result.check.pass')));
        assert.ok(text.includes(uiText(locale, `result.check.consumerControl.${consumerControl}`, {id:'"consumer-check"'})));
        assert.ok(!text.split('\n').some(line => line.startsWith(uiText(locale, 'result.check.fail') + ' ·')));
    }
});


test('an oversized check with a fault control retains the bounded result and next action', () => {
    const view = result({});
    view.checks.entries[0].checkId = '\n'.repeat(32768);
    view.checks.entries[0].consumerControl = 'matched';
    const text = changeResultText(view, 'en');
    assert.ok(text.length < 16000);
    assert.ok(text.includes(uiText('en', 'result.nextAttention', {id:view.workId})));
    assert.ok(text.includes(uiText('en', 'result.omitted', {count:1})));
});
