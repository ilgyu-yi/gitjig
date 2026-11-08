import test from 'node:test';
import assert from 'node:assert/strict';
import {managedChangeCompletionNotice,taskPresentation} from '../../dist/ui/task-presentation.js';

function conversation(extra = {}) {
    return {conversationId: 'owner', label: 'Owner request', projectId: 'project', generation: 1, state: 'IDLE',
        historyRef: null, nativeSessionId: null, workId: null, parentId: null, relationRevision: 0, directionRevision: 0,
        draft: {revision: 0, text: ''}, scroll: {entryId: null, offset: 0, followEnd: true}, humanLastUsed: 0,
        inputNeeded: false, archived: false, deleted: false, ...extra};
}
const present = (view, extra = {}) => taskPresentation({view, roster: [view], locale: 'en', ...extra});
const goal = (view, state) => ({conversationId: view.conversationId, state, startedAttempts: 2, turnLimit: 8, nextAction: 'Wait for the owner to provide the deployment result'});

test('managed start reports its live phase once in the navigator and preserves higher-priority holds', () => {
    const owner = conversation({workId: 'W'});
    const activity = {workId: 'W', state: 'ACTIVE', recordedPhase: 'BASE_CAPTURING', activationPending: true};
    const rules = present(conversation(), {managedPreparation: 'rules'});
    assert.equal(rules.navigatorSummary, 'Reading workflow rules');
    const live = present(owner, {changeActivity: activity, managedPreparation: 'capture'});
    assert.equal(live.preparationStatus, 'Capturing project snapshot');
    assert.equal(live.navigatorSummary, live.preparationStatus);
    assert.equal(live.attention, false);
    assert.deepEqual(live.lines, []);
    const retained = present(owner, {changeActivity: activity, managedPending: true});
    assert.equal(retained.preparationStatus, undefined);
    assert.equal(retained.attention, true);
    const input = present({...owner, inputNeeded: true}, {changeActivity: activity, managedPreparation: 'capture'});
    assert.equal(input.preparationStatus, undefined);
    assert.equal(input.attention, true);
    const unknown = present(owner, {changeActivity: {...activity, state: 'UNKNOWN'}, managedPreparation: 'capture'});
    assert.equal(unknown.preparationStatus, undefined);
    assert.equal(unknown.attention, true);
});

test('an idle coordinator shows active related work without claiming a dependency or retargeting input', () => {
    const owner = conversation(), child = conversation({conversationId: 'child', parentId: owner.conversationId, workId: 'child-work', state: 'RUNNING'});
    const result = present(owner, {roster: [owner, child], goal: goal(owner, 'COMPLETED')});
    assert.equal(result.resourceLabel, 'Conversation idle');
    assert.equal(result.idleStatus, 'Related work in progress: 1');
    assert.match(result.navigatorSummary, /Conversation idle.*Related work in progress: 1/);
    assert.doesNotMatch(result.lines.join('\n'), /waiting for|dependency|ready|complete/i);
    assert.equal(owner.state, 'IDLE');
});

test('running roles keep related progress visible while their direct owner conversation is idle', () => {
    const owner = conversation({workId: 'parent-work'});
    const child = conversation({conversationId: 'child', parentId: 'owner', workId: 'child-work'});
    const alias = conversation({conversationId: 'another-child', parentId: 'owner', workId: 'child-work', state: 'RUNNING'});
    const activeChildWorks = new Set(['child-work', 'unrelated-work', 'parent-work']);
    const result = present(owner, {roster: [child, alias], activeChildWorks});
    assert.equal(result.resourceLabel, 'Conversation idle');
    assert.equal(result.idleStatus, 'Related work in progress: 1');
    assert.equal(result.waitingStatus, undefined);
    assert.equal(result.attention, false);
    assert.equal(present(owner, {roster: [child], activeChildWorks, locale: 'ko'}).idleStatus, '관련 작업 1개 진행 중');

    const inactive = present(owner, {roster: [child], activeChildWorks: new Set()});
    assert.equal(inactive.idleStatus, undefined);
    const unrelated = present(owner, {activeChildWorks, roster: [
        {...child, archived: true},
        {...child, parentId: 'another-parent'},
        {...child, workId: 'parent-work'},
        {...child, role: 'planner'},
    ]});
    assert.equal(unrelated.idleStatus, undefined);
});

test('current role activity follows exact work identity independently of the navigation tree', () => {
    const owner = conversation({workId: 'W'}), reviewer = conversation({conversationId: 'reviewer', parentId: 'another-parent', workId: 'W', role: 'reviewer', state: 'RUNNING'});
    const unrelated = conversation({conversationId: 'other-reviewer', parentId: owner.conversationId, workId: 'OTHER', role: 'implementer', state: 'RUNNING'});
    const result = present(owner, {roster: [owner, reviewer, unrelated]});
    assert.equal(result.idleStatus, 'Working on this change: Reviewing');
    assert.ok(result.lines.includes('Related work in progress: 1'));
    assert.doesNotMatch(result.lines.join('\n'), /Implementing|dependency|waiting for/i);
});

test('archived, deleted, idle and reparented conversations do not invent active child work', () => {
    const owner = conversation();
    const roster = [owner,
        conversation({conversationId: 'archived', parentId: 'owner', state: 'RUNNING', archived: true}),
        conversation({conversationId: 'deleted', parentId: 'owner', state: 'RUNNING', deleted: true}),
        conversation({conversationId: 'settled', parentId: 'owner', state: 'IDLE'}),
        conversation({conversationId: 'reparented', parentId: 'another-parent', state: 'RUNNING'}),
    ];
    const result = present(owner, {roster});
    assert.equal(result.idleStatus, undefined);
    assert.deepEqual(result.lines, []);
    assert.equal(result.navigatorSummary, 'Conversation idle');
});

test('cancelled work and unknown related cleanup take precedence over old review-ready stages', () => {
    const owner = conversation({workId: 'W'});
    const activity = {workId: 'W', state: 'CANCELLED', recordedPhase: 'REVIEW_READY', activationPending: false};
    const result = present(owner, {changeActivity: activity, managedPending: true});
    assert.equal(result.idleStatus, 'Change needs attention · /work to inspect');
    assert.equal(result.attention, true);
    assert.doesNotMatch(result.navigatorSummary, /ready|landed|merged/i);
    const child = conversation({conversationId: 'child', parentId: owner.conversationId, state: 'UNKNOWN'});
    const unknown = present(owner, {roster: [owner, child], goal: goal(owner, 'COMPLETED')});
    assert.equal(unknown.idleStatus, 'Related conversations need recovery: 1');
    assert.equal(unknown.attention, true);
});

test('idle activity distinguishes its current work from a related-conversation fallback', () => {
    const owner = conversation({workId:'W'});
    const child = conversation({conversationId:'child',parentId:'owner',state:'UNKNOWN'});
    const roster = [owner,child];
    const related = 'Related conversations need recovery: 1';
    const background = present(owner,{roster});
    assert.equal(background.idleOwnStatus,undefined);
    assert.equal(background.idleStatus,related);
    assert.ok(background.lines.includes(related));
    const checking = present(owner,{roster,changeActivity:{
        workId:'W',state:'ACTIVE',recordedPhase:'CHECKING',activationPending:false,
        activeCheck:{id:'value',phase:'running'},
    }});
    assert.equal(checking.idleOwnStatus,'Running project check · value');
    assert.ok(checking.lines.includes(related));
    const waiting = present(owner,{roster,goal:goal(owner,'WAITING_INPUT')});
    assert.equal(waiting.idleOwnStatus,'Goal needs owner input · /goal to inspect');
    assert.ok(waiting.lines.includes(related));
});

test('owned check activity replaces an old stage while preserving response, role and cleanup precedence', () => {
    const owner = conversation({workId: 'W'});
    const activity = {workId: 'W', state: 'ACTIVE', recordedPhase: 'BLOCKED', activationPending: false};
    const running = { ...activity, activeCheck: { id: 'value', phase: 'running' } };
    const result = present(owner, {changeActivity: running, navigatorRequestLabel: 'Checking selected model'});
    assert.equal(result.resourceLabel, 'Task in progress');
    assert.equal(result.idleStatus, 'Running project check · value');
    assert.equal(result.attention, false);
    assert.equal(result.navigatorSummary, 'Task in progress · Running project check · value');
    assert.equal(present(owner, {changeActivity: {...running, activeCheck: {...running.activeCheck, phase: 'settling'}}, locale: 'ko'}).idleStatus, '검사 후 정리 중 · value');
    assert.doesNotMatch(present(owner, {changeActivity: activity}).navigatorSummary, /Running project check/);
    assert.doesNotMatch(present(owner, {changeActivity: {...running, state: 'UNKNOWN'}}).navigatorSummary, /Running project check/);
    assert.doesNotMatch(present({...owner, state: 'RUNNING'}, {changeActivity: running}).navigatorSummary, /Running project check/);
    const role = conversation({conversationId: 'reviewer', workId: 'W', role: 'reviewer', state: 'RUNNING'});
    assert.equal(present(owner, {changeActivity: running, roster:[owner, role]}).idleStatus, 'Working on this change: Reviewing');
});

test('recorded readiness remains attributed history and foreign work or goal cannot supply context', () => {
    const owner = conversation({workId: 'W'}), activity = {workId: 'W', state: 'ACTIVE', recordedPhase: 'REVIEW_READY', activationPending: false};
    const result = present(owner, {changeActivity: activity});
    assert.match(result.idleStatus, /Review-ready result recorded.*publication and merge are separate/);
    assert.match(result.navigatorSummary, /^Conversation idle/);
    const finishing = present(owner, {changeActivity: activity, managedPending: true});
    assert.equal(finishing.idleStatus, 'Finishing the current task');
    assert.doesNotMatch(finishing.navigatorSummary, /review-ready/i);
    assert.equal(present(owner, {changeActivity: activity, managedPending: true, locale: 'ko'}).idleStatus, '현재 작업 마무리 중');
    const foreign = present(owner, {changeActivity: {...activity, workId: 'OTHER'}, goal: {conversationId: 'OTHER', state: 'COMPLETED'}});
    assert.deepEqual(foreign.lines, []);
    assert.equal(foreign.idleStatus, undefined);
});

for (const [locale, blocked, repair] of [
    ['en','Change blocked','Change needs repair'],
    ['ko','변경 작업이 보류됨','변경 수정 필요'],
]) test('a stopped managed phase exposes a result shortcut only in its selected owner pane · '+locale, () => {
    const owner=conversation({workId:'W'}), tail=locale==='ko'?'/result에서 상세 내용과 다음 단계 확인':'/result for details and next steps';
    for (const [phase,status] of [['BLOCKED',blocked],['REPAIR_REQUIRED',repair]]) {
        const view={workId:'W',phase,epoch:1,ownerActivation:'complete',reviewReady:false,blocked:['Original workflow reason'],nextAction:'repairChange'};
        const activity={workId:'W',state:'ACTIVE',recordedPhase:phase,activationPending:false};
        const input={locale,changeActivity:activity,showResultShortcut:true}, expected=status+' · '+tail;
        assert.equal(present(owner,input).idleStatus, expected);
        assert.equal(managedChangeCompletionNotice(view,view,activity,owner,locale),expected);
        assert.equal(present(owner,{...input,showResultShortcut:false}).idleStatus,status);
        assert.equal(present(owner,{...input,managedPending:true}).idleStatus,status);
        assert.ok(present({...owner,role:'reviewer'},input).lines.every(line=>!line.includes('/result')));
        assert.equal(managedChangeCompletionNotice(view,view,activity,{...owner,inputNeeded:true},locale),undefined);
        assert.equal(managedChangeCompletionNotice(view,{...view,epoch:2},activity,owner,locale),undefined);
    }
});

test('standalone operations project only their original progress and settled result', () => {
    const owner = conversation({workId:null});
    const running = {workId:'W', state:'ACTIVE', recordedPhase:'IMPLEMENTING', activationPending:false};
    const preferences = {changeActivity:running, managedPending:true, standaloneManagedWork:'W'};
    const role = conversation({conversationId:'role', workId:'W', role:'implementer',state:'RUNNING'});
    assert.match(present(owner,{...preferences,roster:[owner,role]}).idleStatus,/Implementing/);
    assert.equal(present(owner,{...preferences,standaloneManagedWork:'foreign'}).idleStatus,undefined);
    assert.equal(present({...owner,workId:'linked'},preferences).idleStatus,undefined);
    const done = {workId:'W',epoch:1,phase:'REVIEW_READY',reviewReady:true};
    const activity = {...running,recordedPhase:done.phase};
    assert.match(managedChangeCompletionNotice(done,done,activity,owner,'en','W'),/Review-ready result recorded/);
    assert.equal(managedChangeCompletionNotice(done,done,activity,owner,'en','foreign'),undefined);
    assert.equal(managedChangeCompletionNotice(done,done,activity,{...owner,workId:'linked'},'en','W'),undefined);
});

test('a strict role keeps its resource state when the shared work has a recorded result', () => {
    const workId = 'W', view = conversation({workId, role:'reviewer'});
    const changeActivity = {workId, state:'DELIVERED', recordedPhase:'REVIEW_READY', activationPending:false};
    for (const locale of ['en', 'ko']) for (const state of ['IDLE', 'RUNNING', 'SETTLING', 'UNKNOWN']) {
        const role = {...view, state};
        const physical = present(role, {locale});
        const result = present(role, {locale, changeActivity});
        assert.equal(result.navigatorSummary, physical.navigatorSummary);
        assert.deepEqual(result.lines, physical.lines);
        assert.equal(result.idleStatus, physical.idleStatus);
    }
});

test('a completed goal cannot replace current unknown, active, settling, waiting or archived resource state', () => {
    for (const state of ['UNKNOWN', 'RUNNING', 'SETTLING', 'WAITING', 'ARCHIVED']) {
        const view = conversation({state}), result = present(view, {goal: goal(view, 'COMPLETED')});
        assert.equal(result.idleStatus, undefined);
        assert.ok(result.navigatorSummary.startsWith(result.resourceLabel + ' · '));
        assert.match(result.lines[0], /Goal completion recorded/);
        if (state === 'UNKNOWN') {
            assert.equal(result.resourceLabel, 'Execution outcome needs recovery');
            assert.equal(result.attention, true);
        }
    }
});

test('goal waits and exhaustion remain distinct from conversation activity and work allowances', () => {
    const view = conversation();
    const waiting = present(view, {goal: goal(view, 'WAITING_DEPENDENCY')});
    assert.equal(waiting.idleStatus, 'Goal waiting · /goal to inspect why and what comes next');
    assert.ok(waiting.lines.includes('Goal turns 2/8 · Next: Wait for the owner to provide the deployment result'));
    const exhausted = present(view, {goal: goal(view, 'BUDGET_EXHAUSTED')});
    assert.equal(exhausted.idleStatus, 'Goal turn allowance exhausted · /goal to inspect');
    assert.equal(exhausted.attention, true);
    assert.doesNotMatch(exhausted.idleStatus, /execution allowance|resolution allowance/i);
    for (const state of ['BLOCKED', 'BUDGET_EXHAUSTED']) {
        const held = present(view, {goal: goal(view, state)});
        assert.ok(held.lines.includes('Goal turns 2/8 · /goal for recovery options'));
        assert.ok(!held.lines.some(line => line.includes('Next:')));
    }
});

test('fresh navigator summaries expose current owner input and remove it after the prompt is answered', () => {
    const view = conversation({state:'RUNNING',inputNeeded:true});
    const navigatorRequestLabel = 'Checking selected model';
    assert.match(present(view, {navigatorRequestLabel}).navigatorSummary, /Response running · input needed/);
    assert.doesNotMatch(present({...view,inputNeeded:false}).navigatorSummary, /input needed/);
    assert.equal(present({...view,state:'IDLE'}, {navigatorRequestLabel}).navigatorSummary, 'Conversation idle · input needed');
    assert.equal(present({...view,state:'IDLE',inputNeeded:false}, {navigatorRequestLabel}).navigatorSummary, navigatorRequestLabel);
});

test('the navigator keeps the exact active response stage alongside related recovery', () => {
    const owner = conversation({state:'RUNNING'});
    const child = conversation({conversationId:'child',parentId:owner.conversationId,state:'UNKNOWN'});
    const navigatorRequestLabel = 'Waiting for model response';
    const related = 'Related conversations need recovery: 1';
    const context = {roster:[owner,child],navigatorRequestLabel};
    for (const state of ['QUEUED','RUNNING']) {
        const result = present({...owner,state},context);
        assert.equal(result.navigatorSummary,navigatorRequestLabel+' · '+related);
        assert.equal(result.attention,true);
    }
    for (const boundary of [{inputNeeded:true},{state:'UNKNOWN'},{state:'SETTLING'},{state:'IDLE'},{archived:true},{deleted:true}]) {
        const result = present({...owner,...boundary},context);
        assert.ok(result.navigatorSummary.startsWith(result.resourceLabel+' · '));
        assert.ok(result.navigatorSummary.endsWith(related));
    }
});

test('English and Korean labels express the same source-bound distinctions without altering observations', () => {
    const owner = conversation({workId: 'W'}), role = conversation({conversationId: 'role', parentId: 'owner', workId: 'W', role: 'implementer', state: 'RUNNING'});
    const input = {view: owner, roster: [owner, role], changeActivity: {workId: 'W', state: 'ACTIVE', recordedPhase: 'PLAN_READY', activationPending: false}, goal: goal(owner, 'ACTIVE')};
    const before = structuredClone(input);
    const en = taskPresentation({...input, locale: 'en'}), ko = taskPresentation({...input, locale: 'ko'});
    assert.equal(en.idleStatus, 'Working on this change: Implementing');
    assert.equal(ko.idleStatus, '이 변경에서 진행 중: 구현 중');
    assert.equal(ko.resourceLabel, '대화 대기');
    assert.equal(en.lines.length, ko.lines.length);
    assert.deepEqual(input, before);
});

test('queued and settling roles do not claim the role is currently executing', () => {
    const owner = conversation({workId: 'W'});
    for (const [state, expected] of [['QUEUED', 'Reviewing queued'], ['SETTLING', 'Reviewing settling']]) {
        const role = conversation({conversationId: 'role', workId: 'W', role: 'reviewer', state});
        assert.equal(present(owner, {roster: [owner, role]}).idleStatus, 'Working on this change: ' + expected);
    }
});

test('the active role pane does not frame its prior checkpoint as a current hold', () => {
    const view = conversation({workId: 'W', role: 'repairer', state: 'RUNNING'});
    const changeActivity = {workId: 'W', state: 'ACTIVE', recordedPhase: 'BLOCKED', activationPending: false};
    const active = present(view, {changeActivity});
    assert.equal(active.attention, false);
    assert.doesNotMatch(active.navigatorSummary, /needs attention/);
    assert.equal(present({...view, state: 'IDLE'}, {changeActivity}).attention, true);
    assert.equal(present(view, {changeActivity:{...changeActivity, state: 'UNKNOWN'}}).attention, true);
});
