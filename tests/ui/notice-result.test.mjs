import test from 'node:test';
import assert from 'node:assert/strict';
import {noticeResultPresentation} from '../../dist/ui/notice-result.js';

const presentation = (result, locale = 'en') => noticeResultPresentation({resultId:'original-result', conversationId:'child', workId:'original-work',result},locale);
const view = (result, locale) => presentation(result, locale).text;
const summary = text => text.split('Recorded details')[0];

test('a governed result puts recorded status and exact inspection before raw data', () => {
    const result = {kind:'governed-work-observation/v1',workId:'original-work',phase:'BLOCKED',reviewReady:false,
        nextAction:'Inspect the failed planner',recordedResult:{workId:'other-work',recordedPhase:'BLOCKED',nextAction:'Foreign guidance',pendingFindings:99}};
    const text = view(result);
    assert.equal(text.split('\n')[0], 'Recorded result: blocked');
    assert.match(summary(text), /\/work original-work[\s\S]*Recorded next action: Inspect the failed planner/);
    assert.doesNotMatch(summary(text), /Foreign guidance|99/);
    assert.match(text, /Original result original-result[\s\S]*"Foreign guidance"/);
    assert.match(view({...result,phase:'REVIEW_READY',reviewReady:true,state:'UNKNOWN'}), /^Execution outcome needs recovery/);
    assert.match(view(result, 'ko'), /^기록된 결과: 진행 막힘/);
    const matched={...result,recordedResult:{workId:'original-work',recordedPhase:'BLOCKED',pendingFindings:2,blocked:['Provider rejected the request'],
        planningClarification:{outputId:'adjudicator-output',questionCount:1}}};
    assert.match(summary(view(matched)), /Provider rejected the request[\s\S]*Recorded pending findings · 2/);
    assert.match(view(matched,'ko'), /기록된 미해결 지적 2건 · \/work에서 확인/);
    assert.match(summary(view(matched)),/Independent planning requested an owner decision[\s\S]*adjudicator-output/);
    assert.doesNotMatch(summary(view({...matched,workId:'foreign'})), /Independent planning requested/);
    delete matched.recordedResult.pendingFindings;
    assert.doesNotMatch(summary(view(matched)), /Recorded pending findings/);
});

test('ordinary status stays bound to the original turn and unknown cleanup has priority', () => {
    const result = {conversationId:'child',workId:'original-work',runId:'original-run',cleanup:'removed',status:'unavailable'};
    assert.match(view(result), /^Response did not complete[\s\S]*\/work original-work/);
    assert.match(view({...result, cleanup:'quarantined',status:'delivered'}), /^Response needs attention · cleanup: quarantined/);
    assert.match(view({...result,conversationId:'other'}), /^Recorded outcome unavailable/);
    for (const body of [{failure:'Missing report'}, {coordinatorReport:{state:'unavailable'}}, {answer:{state:'unavailable'}}])
        assert.match(view({...result,status:'delivered',...body}), /^Recorded outcome unavailable/);
});

test('a recorded usage limit keeps the exact inspection and displays only a bound provider reset', () => {
    const compact = {workId:'original-work', recordedPhase:'BLOCKED', providerUsageLimitReset:1794020400,
        blocked:['Original provider error']};
    const result = {kind:'governed-work-observation/v1', workId:'original-work', phase:'BLOCKED', reviewReady:false, recordedResult:compact};
    assert.equal(presentation(result).command, '/work original-work');
    assert.match(summary(view(result)), /Provider usage limit reported[\s\S]*Provider-reported reset: .*GMT[\s\S]*Wait and check your account/);
    assert.match(view(result), /Recorded details[\s\S]*Original provider error/);
    assert.match(view(result, 'ko'), /제공자가 알린 한도 초기화 시각/);
    assert.match(view({...result, recordedResult:{...compact, providerUsageLimitReset:null}}), /did not supply a usable reset time/);
    for (const variant of [
        {...result, state:'UNKNOWN'}, {...result, reviewReady:true}, {...result, phase:'REVIEW_READY'},
        {...result, recordedResult:{...compact, state:'UNKNOWN'}},
        {...result, recordedResult:{...compact, workId:'foreign'}},
        {...result, recordedResult:{...compact, providerUsageLimitReset:'1794020400'}},
        {...result, recordedResult:{...compact, providerUsageLimitReset:undefined}},
    ]) assert.doesNotMatch(summary(view(variant)), /Provider usage limit reported|Provider-reported reset:/);
});

test('an external outcome uses the exact operation and keeps uncertain facts distinct', () => {
    const result = {workId:'original-work',operationId:'original-operation',phase:'UNKNOWN'};
    assert.equal(presentation(result).command,'/repo operation original-operation original-work');
    assert.equal(presentation({...result,workId:'other'}).command,'/work original-work');
    assert.match(view(result), /^External outcome unconfirmed\nFind this operation in \/repo\noriginal-operation/);
    assert.match(view({...result,phase:'CONFIRMED'}), /^External outcome confirmed/);
    assert.match(view({...result,phase:'CONFIRMED',transportOutcome:'uncertain'}), /^External outcome confirmed[\s\S]*Original send remains uncertain/);
    assert.match(view({...result,phase:'CONFIRMED',observedOutcome:'unknown'}), /^External outcome unconfirmed/);
    assert.match(view({...result,phase:'REFUSED'}), /^External operation refused/);
    assert.doesNotMatch(summary(view({...result,workId:'other'})), /original-operation|\/repo|External/);
    assert.doesNotMatch(summary(view({...result,operationId:'unexpected\n/send'})), /\/repo|\/send|External/);
    assert.match(view({...result,runId:'other-run'}), /^Recorded outcome unavailable/);
});
