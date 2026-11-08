import test from 'node:test';
import assert from 'node:assert/strict';
import {taskPresentation} from '../../dist/ui/task-presentation.js';

function conversation(extra = {}) {
    return {conversationId: 'owner', label: 'Owner request', projectId: 'project', generation: 1, state: 'IDLE',
        historyRef: null, nativeSessionId: null, workId: null, parentId: null, relationRevision: 0, directionRevision: 0,
        draft: {revision: 0, text: ''}, scroll: {entryId: null, offset: 0, followEnd: true}, humanLastUsed: 0,
        inputNeeded: false, archived: false, deleted: false, ...extra};
}
const present = (view, extra = {}) => taskPresentation({view, roster: [view], locale: 'en', ...extra});
const goal = (view, state) => ({conversationId: view.conversationId, state, startedAttempts: 2, turnLimit: 8, nextAction: 'Wait for the owner to provide the deployment result'});

test('an idle coordinator shows active related work without claiming a dependency or retargeting input', () => {
    const owner = conversation(), child = conversation({conversationId: 'child', parentId: owner.conversationId, workId: 'child-work', state: 'RUNNING'});
    const result = present(owner, {roster: [owner, child], goal: goal(owner, 'COMPLETED')});
    assert.equal(result.resourceLabel, 'Conversation idle');
    assert.equal(result.idleStatus, 'Related conversations active: 1');
    assert.match(result.navigatorSummary, /Conversation idle.*Related conversations active: 1/);
    assert.doesNotMatch(result.lines.join('\n'), /waiting for|dependency|ready|complete/i);
    assert.equal(owner.state, 'IDLE');
});

test('current role activity follows exact work identity independently of the navigation tree', () => {
    const owner = conversation({workId: 'W'}), reviewer = conversation({conversationId: 'reviewer', parentId: 'another-parent', workId: 'W', role: 'reviewer', state: 'RUNNING'});
    const unrelated = conversation({conversationId: 'other-reviewer', parentId: owner.conversationId, workId: 'OTHER', role: 'implementer', state: 'RUNNING'});
    const result = present(owner, {roster: [owner, reviewer, unrelated]});
    assert.equal(result.idleStatus, 'Working on this change: Reviewing');
    assert.ok(result.lines.includes('Related conversations active: 1'));
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
    const result = present(owner, {changeActivity: activity});
    assert.equal(result.idleStatus, 'Change needs attention · /work to inspect');
    assert.equal(result.attention, true);
    assert.doesNotMatch(result.navigatorSummary, /ready|landed|merged/i);
    const child = conversation({conversationId: 'child', parentId: owner.conversationId, state: 'UNKNOWN'});
    const unknown = present(owner, {roster: [owner, child], goal: goal(owner, 'COMPLETED')});
    assert.equal(unknown.idleStatus, 'Related conversations need recovery: 1');
    assert.equal(unknown.attention, true);
});

test('recorded readiness remains attributed history and foreign work or goal cannot supply context', () => {
    const owner = conversation({workId: 'W'}), activity = {workId: 'W', state: 'ACTIVE', recordedPhase: 'REVIEW_READY', activationPending: false};
    const result = present(owner, {changeActivity: activity});
    assert.match(result.idleStatus, /Review-ready result recorded.*publication and merge are separate/);
    assert.match(result.navigatorSummary, /^Conversation idle/);
    const foreign = present(owner, {changeActivity: {...activity, workId: 'OTHER'}, goal: {conversationId: 'OTHER', state: 'COMPLETED'}});
    assert.deepEqual(foreign.lines, []);
    assert.equal(foreign.idleStatus, undefined);
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
});

test('fresh navigator summaries expose current owner input and remove it after the prompt is answered', () => {
    const view = conversation({state:'RUNNING',inputNeeded:true});
    assert.match(present(view).navigatorSummary, /Response running · input needed/);
    assert.doesNotMatch(present({...view,inputNeeded:false}).navigatorSummary, /input needed/);
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
