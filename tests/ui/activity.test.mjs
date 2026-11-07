import test from 'node:test';
import assert from 'node:assert/strict';
import {stripTerminalSequences, visibleWidth} from '@earendil-works/pi-tui';
import {ConversationActivity, responseOutcome, shellOutcome} from '../../dist/ui/conversation-activity.js';

const text = (activity, width = 140) => activity.render(width).map(stripTerminalSequences).join('\n');

test('activity distinguishes admission, silence, recovery and settlement and stops redraw timers', t => {
    let now = 1000, redraws = 0;
    t.mock.method(performance, 'now', () => now);
    t.mock.timers.enable({apis: ['setInterval']});
    const activity = new ConversationActivity(() => redraws++);
    try {
        assert.match(text(activity), /Ready.*Enter send/);
        activity.update('IDLE', {preparing: true});
        assert.match(text(activity), /Preparing request.*0s/);
        activity.update('QUEUED');
        assert.match(text(activity), /Request received.*queued/);
        activity.update('RUNNING');
        assert.match(text(activity), /Waiting for model response.*Esc interrupt/);
        now += 16000; t.mock.timers.tick(1000);
        assert.equal(redraws, 1);
        assert.match(text(activity), /16s.*No new output for 16s/);
        assert.doesNotMatch(text(activity), /healthy|failed|complete/i);
        activity.observe({type:'message_update', assistantMessageEvent:{type:'text_delta'}});
        assert.match(text(activity), /Writing response/);
        assert.doesNotMatch(text(activity), /No new output/);
        activity.update('SETTLING');
        assert.match(text(activity), /Finishing response.*cleaning up/);
        activity.update('UNKNOWN', {preparing:true, pending:true});
        assert.match(text(activity), /Status unknown.*\/inputs/);
        assert.doesNotMatch(text(activity), /Preparing|Waiting for model|\d+s/);
        t.mock.timers.tick(1000); assert.equal(redraws, 1);
        activity.update('IDLE', {pending:true});
        assert.match(text(activity), /Request retained.*\/inputs/);
        assert.doesNotMatch(text(activity), /Ready|complete/);
        activity.update('IDLE', {error:true}); assert.match(text(activity), /Needs attention/);
        activity.update('IDLE', {inputNeeded:true}); assert.match(text(activity), /Input needed/);
        activity.update('WAITING'); assert.match(text(activity), /Waiting.*check conversation/);
        activity.update('RUNNING'); t.mock.timers.tick(1000); assert.equal(redraws, 2);
        activity.dispose(); t.mock.timers.tick(3000); assert.equal(redraws, 2);
    } finally { activity.dispose(); }
});

test('native phases stay local, retry end cannot signal response completion, and narrow activity stays bounded', () => {
    const first = new ConversationActivity(() => {}), second = new ConversationActivity(() => {});
    try {
        first.update('RUNNING'); second.update('QUEUED');
        for (const [event, expected] of [
            [{type:'message_update', assistantMessageEvent:{type:'thinking_delta'}}, /Thinking/],
            [{type:'message_update', assistantMessageEvent:{type:'toolcall_delta'}}, /Preparing tool call/],
            [{type:'tool_execution_start', toolName:'read'}, /Running tool: read/],
            [{type:'auto_retry_start', attempt:2, maxAttempts:3}, /Retrying model request \(2\/3\)/],
            [{type:'agent_end', willRetry:true}, /Retrying model request/],
            [{type:'auto_retry_end', success:true}, /Waiting for model response/],
            [{type:'compaction_start'}, /Summarizing conversation/],
            [{type:'compaction_end'}, /Waiting for model response/],
        ]) { first.observe(event); assert.match(text(first), expected); assert.match(text(second), /queued/); }
        first.observe({type:'tool_execution_start', toolName:'read\x1b[31m\nunsafe'});
        for (const width of [1, 20, 40, 100]) {
            const lines=first.render(width); assert.equal(lines.length,1);
            assert.ok(visibleWidth(lines[0])<=width); assert.doesNotMatch(stripTerminalSequences(lines[0]), /[\x00-\x1f]/u);
        }
        first.update('IDLE', {operation:'Running shell command'});
        assert.match(text(first), /Running shell command.*0s/);
    } finally { first.dispose(); second.dispose(); }
});

test('response and shell outcomes do not turn failed cleanup or interruption into completion', () => {
    assert.equal(responseOutcome({status:'delivered',cleanup:'unbound'}),'Response complete');
    for (const status of ['interrupted','cancelled','waiting','unavailable']) {
        assert.doesNotMatch(responseOutcome({status,cleanup:'removed'}), /complete/);
        const shell=shellOutcome({status,cleanup:'removed'});
        assert.equal(shell.completed,false); assert.ok(shell.message.includes(status)); assert.match(shell.message,/draft kept/);
    }
    for (const status of ['delivered','interrupted','unavailable']) {
        assert.match(responseOutcome({status,cleanup:'quarantined'}), /needs attention.*quarantined/);
        assert.deepEqual(shellOutcome({status,cleanup:'quarantined'}), {message:'Shell command needs attention · cleanup: quarantined',completed:false});
    }
    assert.deepEqual(shellOutcome({status:'delivered',cleanup:'removed',nativeResult:{exitCode:1}}),
        {message:'Shell command finished · inspect its output',completed:true});
    assert.equal(shellOutcome(undefined).completed,false);
});

test('known missing setup never advertises sending and does not hide running or recovery states', () => {
    const activity = new ConversationActivity(() => {});
    try {
        activity.update('IDLE', {setupNeeded:true, setupHandoff:true});
        assert.match(text(activity), /Setup needed.*Enter for options.*request kept/);
        assert.doesNotMatch(text(activity), /Ready|Enter send/);
        activity.update('IDLE', {setupNeeded:true});
        assert.match(text(activity), /Setup needed.*command menu/);
        assert.doesNotMatch(text(activity), /Enter for options/);
        activity.update('IDLE', {setupNeeded:true, pending:true});
        assert.match(text(activity), /Request retained/);
        activity.update('UNKNOWN', {setupNeeded:true, setupHandoff:true});
        assert.match(text(activity), /Status unknown/);
        assert.doesNotMatch(text(activity), /Setup needed|Ready/);
        activity.update('RUNNING', {setupNeeded:true, setupHandoff:true});
        assert.match(text(activity), /Waiting for model response/);
        assert.doesNotMatch(text(activity), /Setup needed|Ready/);
        activity.update('IDLE', {setupNeeded:true, setupHandoff:true, locale:'ko'});
        assert.match(text(activity), /설정 필요.*Enter로 선택.*요청 보존/);
        activity.update('IDLE');
        assert.match(text(activity), /Ready.*Enter send/);
    } finally { activity.dispose(); }
});

test('startup names actual preparation stages in both languages without hiding native output or cleanup', () => {
    for (const [locale, labels] of [['en', ['Waiting for execution capacity','Reading project snapshot','Starting execution environment','Preparing model session','Sending request to model','Waiting for model response']], ['ko', ['실행 차례 기다리는 중','프로젝트 읽는 중','실행 환경 시작 중','모델 세션 준비 중','모델에 요청 보내는 중','모델 응답 기다리는 중']]]) {
        const activity = new ConversationActivity(() => {});
        try {
            for (const [index, stage] of ['capacity','capture','runtime','session','dispatch','model'].entries()) {
                activity.update(index < 3 ? 'QUEUED' : 'RUNNING', {locale, stage, preparing:true});
                assert.ok(text(activity).includes(labels[index]), text(activity));
            }
            activity.observe({type:'message_update', assistantMessageEvent:{type:'thinking_delta'}});
            activity.update('RUNNING', {locale,stage:'model',preparing:true});
            assert.equal(activity.hasNativeActivity,true);
            assert.ok(text(activity).includes(locale === 'ko' ? '생각' : 'Thinking'));
            assert.ok(!text(activity).includes(labels[5]));
            activity.update('SETTLING', {locale,stage:'model',preparing:true});
            assert.ok(!text(activity).includes(labels[5]));
            activity.update('UNKNOWN', {locale,stage:'capture',preparing:true});
            assert.ok(!text(activity).includes(labels[1]));
        } finally { activity.dispose(); }
    }
});

test('cancelled additional send keeps native activity visible; response interruption remains explicit', () => {
    const activity=new ConversationActivity(()=>{});
    try {
        activity.update('RUNNING');
        activity.observe({type:'message_update',assistantMessageEvent:{type:'text_delta'}});
        activity.update('RUNNING',{cancellingSend:true});
        assert.match(text(activity),/Writing response/);assert.doesNotMatch(text(activity),/Stopping request/);
        activity.update('RUNNING',{cancelling:true});
        assert.match(text(activity),/Stopping request.*waiting for cleanup/);assert.doesNotMatch(text(activity),/Esc interrupt/);
        activity.update('IDLE',{preparing:true,cancellingSend:true});
        assert.match(text(activity),/Cancelling preparation/);
        activity.update('QUEUED',{stage:'capacity',interruptible:true});
        assert.match(text(activity),/Waiting for execution capacity.*Esc interrupt/);
        activity.update('UNKNOWN',{cancelling:true});
        assert.match(text(activity),/Status unknown/);
    } finally {activity.dispose();}
});
