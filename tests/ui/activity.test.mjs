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


test('overlapping send preparation belongs to its new run without rebasing current native events', t => {
    let now=1000;t.mock.method(performance,'now',()=>now);
    for(const locale of ['en','ko']){
        const activity=new ConversationActivity(()=>{}),first={},second={},third={};
        try{
            activity.beginPreparation(first);activity.update('IDLE',{locale,preparing:true,preparationOwner:first});
            now+=3000;activity.update('QUEUED',{locale,runId:'A',requestOwner:first,stage:'capacity'});assert.match(text(activity),/3s|3초/);
            activity.update('RUNNING',{locale,runId:'A',stage:'model'});activity.observe({type:'message_update',assistantMessageEvent:{type:'text_delta'}});
            now+=7000;activity.beginPreparation(second);activity.update('RUNNING',{locale,runId:'A',requestOwner:first,preparationOwner:second,stage:'model'});assert.match(text(activity),/10s|10초/);assert.match(text(activity),locale==='ko'?/응답 작성/:/Writing response/);
            now+=5000;activity.update('IDLE',{locale,preparing:true,preparationOwner:second});assert.match(text(activity),/5s|5초/);
            now+=1000;activity.update('QUEUED',{locale,runId:'B',requestOwner:second,stage:'capacity'});assert.match(text(activity),/6s|6초/);
            activity.bindRun('B',second);activity.observe({type:'message_update',assistantMessageEvent:{type:'thinking_delta'}});
            activity.update('RUNNING',{locale,runId:'B',requestOwner:second,stage:'model'});assert.match(text(activity),locale==='ko'?/생각/:/Thinking/);assert.match(text(activity),/6s|6초/);
            now+=3000;activity.update('RUNNING',{locale,runId:'B',stage:'model'});assert.match(text(activity),/9s|9초/);
            activity.observe({type:'turn_start'});assert.match(text(activity),/9s|9초/,'Same-run native turns keep elapsed time');
            now+=1000;activity.beginPreparation(third);activity.bindRun('B',third);
            now+=2000;activity.update('IDLE',{locale,preparing:true,preparationOwner:third});assert.match(text(activity),/2s|2초/,'Same-run bind did not consume another send');
            activity.bindRun('C',third);activity.observe({type:'message_update',assistantMessageEvent:{type:'text_delta'}});activity.update('RUNNING',{locale,runId:'C',stage:'model'});assert.match(text(activity),locale==='ko'?/응답 작성/:/Writing response/);
            now+=16000;activity.update('RUNNING',{locale,stage:'model'});assert.match(text(activity),/18s|18초/,'Missing run observation keeps current ownership');
            activity.bindRun('automatic');activity.update('RUNNING',{locale,runId:'automatic',stage:'model'});assert.match(text(activity),/0s|0초/);assert.doesNotMatch(text(activity),/No new output|새 출력 없음|Writing response|응답 작성/);
        }finally{activity.dispose();}
    }
});

test('first observed binding preserves queued time and inactive cleanup starts a fresh observation',t=>{
    let now=0;t.mock.method(performance,'now',()=>now);const activity=new ConversationActivity(()=>{});
    try{
        activity.update('QUEUED',{stage:'capacity'});now=5000;activity.update('QUEUED',{runId:'first',stage:'capture'});assert.match(text(activity),/5s/);
        activity.update('UNKNOWN',{runId:'first'});assert.match(text(activity),/Status unknown/);assert.doesNotMatch(text(activity),/5s/);
        now=10000;activity.bindRun('later');activity.update('RUNNING',{runId:'later',stage:'model'});assert.match(text(activity),/0s/);
    }finally{activity.dispose();}
});


test('an unrelated manual operation cannot take another input preparation clock',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);const activity=new ConversationActivity(()=>{}),ordinary={};
 try{
  activity.update('IDLE',{operation:'Summary in progress'});now=1000;activity.beginPreparation(ordinary);
  activity.update('IDLE',{operation:'Summary in progress',preparing:true,preparationOwner:ordinary});assert.match(text(activity),/1s/);
  now=2000;activity.bindRun('manual-A');activity.update('RUNNING',{runId:'manual-A',operation:'Summary in progress'});assert.match(text(activity),/0s/,'Unrelated preparation cannot qualify the manual clock');
  now=3000;activity.update('IDLE',{operation:'Summary finishing',preparing:true,preparationOwner:ordinary});activity.bindRun('ordinary-B',ordinary);
  activity.update('RUNNING',{runId:'ordinary-B',requestOwner:ordinary,operation:'Summary finishing'});assert.match(text(activity),/2s/,'Qualified ordinary input retains its own preparation despite another operation tail');
  activity.observe({type:'message_update',assistantMessageEvent:{type:'thinking_delta'}});activity.update('RUNNING',{runId:'ordinary-B',stage:'model'});assert.match(text(activity),/Thinking.*2s/);
 }finally{activity.dispose();}
});


test('an admitted input keeps its preparation while another send begins before native readiness',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);const activity=new ConversationActivity(()=>{}),first={},next={};
 try{
  activity.beginPreparation(first);activity.update('IDLE',{preparing:true,preparationOwner:first});now=1000;activity.bindPreparation(first);
  now=2000;activity.beginPreparation(next);activity.update('IDLE',{preparing:true,preparationOwner:next});
  now=3000;activity.bindRun('first',first);activity.update('RUNNING',{runId:'first',requestOwner:first,stage:'model'});assert.match(text(activity),/3s/,'The acknowledged input keeps its original preparation');
  now=4000;activity.bindRun('automatic',first);activity.update('RUNNING',{runId:'automatic',requestOwner:first,stage:'model'});assert.match(text(activity),/0s/,'A new run cannot reuse the preparation already bound to a previous run');
  now=5000;activity.update('IDLE',{preparing:true,preparationOwner:next});assert.match(text(activity),/3s/);
  now=6000;activity.bindRun('automatic-again',first);activity.update('RUNNING',{runId:'automatic-again',requestOwner:first,stage:'model'});assert.match(text(activity),/0s/);
  now=7000;activity.update('IDLE',{preparing:true,preparationOwner:next});assert.match(text(activity),/5s/,'Pending preparation can become primary again after another run');
  activity.bindRun('next',next);activity.update('RUNNING',{runId:'next',requestOwner:next,stage:'model'});assert.match(text(activity),/5s/,'The pending send retains its separate clock');
 }finally{activity.dispose();}
});


test('a later preparation retains its clock when an acknowledged input never reaches native readiness',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);const activity=new ConversationActivity(()=>{}),first={},next={};
 const text=()=>stripTerminalSequences(activity.render(160).join(' '));
 try{
  activity.beginPreparation(first);activity.update('IDLE',{preparing:true,preparationOwner:first});
  now=1000;activity.bindPreparation(first);now=2000;activity.beginPreparation(next);
  activity.update('IDLE',{preparing:true,preparationOwner:next});assert.match(text(),/0s/);
  now=5000;activity.update('IDLE',{preparing:true,preparationOwner:next});assert.match(text(),/3s/);
  // The first dispatch fails before any native registration; the next send remains owned.
  now=6000;activity.bindPreparation(next);activity.bindRun('next',next);
  activity.update('RUNNING',{runId:'next',requestOwner:next,stage:'model'});assert.match(text(),/4s/);
 }finally{activity.dispose();}
});


test('manual-only cancellation labels retain ordinary-stop and unknown precedence',()=>{
 const activity=new ConversationActivity(()=>{});
 try{
  for(const locale of ['en','ko']){
   const label=locale==='ko'?'히스토리 작업 취소 중':'Cancelling history action';
   activity.update('RUNNING',{locale,cancelling:true,cancellationLabel:label});
   assert.ok(text(activity).includes(label));assert.doesNotMatch(text(activity),/Esc/);
   activity.update('RUNNING',{locale,cancelling:true,cancellationLabel:undefined,operation:label});
   assert.match(text(activity),locale==='ko'?/요청 중단 중/:/Stopping request/);
   activity.update('UNKNOWN',{locale,cancelling:true,cancellationLabel:label});
   assert.match(text(activity),locale==='ko'?/상태 불확실/:/Status unknown/);assert.ok(!text(activity).includes(label));
   activity.update('IDLE',{locale,cancellationLabel:label});assert.ok(!text(activity).includes(label));
  }
 }finally{activity.dispose();}
});
