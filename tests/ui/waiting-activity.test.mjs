import test from 'node:test';
import assert from 'node:assert/strict';
import {stripTerminalSequences,visibleWidth} from '@earendil-works/pi-tui';
import {ConversationActivity} from '../../dist/ui/conversation-activity.js';
import {uiText} from '../../dist/ui/i18n.js';
import {taskPresentation} from '../../dist/ui/task-presentation.js';

const view = extra => ({conversationId:'owner',label:'Owner',projectId:'P',generation:7,state:'WAITING',workId:'ROOT',parentId:null,
    relationRevision:0,directionRevision:11,historyRef:null,nativeSessionId:null,draft:{revision:0,text:''},scroll:{entryId:null,offset:0,followEnd:true},
    humanLastUsed:0,inputNeeded:false,archived:false,deleted:false,...extra});
for(const locale of ['en','ko'])test(`exact awaited work has neutral target/role feedback and preserves attention priority in ${locale}`,()=>{
    const owner=view({}), child=view({conversationId:'child',label:'Assigned task',workId:'TASK',parentId:'owner',state:'IDLE'});
    const checker=view({conversationId:'checker',workId:'TASK',parentId:'elsewhere',state:'RUNNING',role:'challenger'});
    const unrelated=view({conversationId:'unrelated',workId:'OTHER',parentId:'child',state:'UNKNOWN',role:'implementer'});
    const wait={conversationId:'owner',workId:'ROOT',runId:'R',generation:7,directionRevision:11,targets:[{assignmentId:'A',conversationId:'child',workId:'TASK',state:'RUNNING'}],omitted:0};
    const present=(extra={})=>taskPresentation({view:owner,roster:[owner,child,checker,unrelated],locale,wait,...extra});
    const result=present();
    assert.match(result.waitingStatus,/#child/);
    assert.ok(result.waitingStatus.includes(locale==='ko'?'계획 검토 중':'Checking the plan'));
    assert.equal(result.waitAttention,false);assert.equal(result.attention,false);
    assert.doesNotMatch(result.waitingStatus,/check conversation|대화를 확인|Implementing|구현 중|unrelated/);
    const native = {identity:{conversationId:checker.conversationId,workId:checker.workId,launchId:'L',generation:checker.generation,
        directionRevision:checker.directionRevision},providerActivity:{kind:'retry',attempt:2,maxAttempts:5,delayMs:1000}};
    const report = uiText(locale,'activity.providerRetry',{attempt:2,max:5});
    const withNotice = present({roleNative:id=>id===checker.conversationId?native:null});
    assert.ok(withNotice.waitingStatus.includes(report));
    assert.equal(withNotice.waitAttention,false);
    for (const state of ['QUEUED','SETTLING','IDLE','UNKNOWN']) {
        assert.ok(!present({roster:[owner,child,{...checker,state}],roleNative:()=>native}).waitingStatus.includes(report),state);
    }
    for (const field of ['conversationId','workId','generation','directionRevision','launchId']) {
        const stale = {...native,identity:{...native.identity,[field]:null}};
        assert.ok(!present({roleNative:()=>stale}).waitingStatus.includes(report),field);
    }
    assert.ok(!present({wait:{...wait,targets:[{...wait.targets[0],state:'UNAVAILABLE'}]},roleNative:()=>native}).waitingStatus.includes(report));
    assert.equal(present({wait:{...wait,directionRevision:10}}).waitingStatus,locale==='ko'?'작업 결과 기다리는 중':'Waiting for task results');
    const unknown=present({roster:[owner,{...child,state:'UNKNOWN'},checker]});
    assert.equal(unknown.waitAttention,true);assert.ok(!unknown.waitingStatus.includes(locale==='ko'?'계획 검토 중':'Checking the plan'));
    const unavailable=present({wait:{...wait,targets:[{...wait.targets[0],state:'UNAVAILABLE'}]}});
    assert.equal(unavailable.waitAttention,true);
    const queued=present({roster:[owner,child],wait:{...wait,targets:[{...wait.targets[0],state:'QUEUED'}]}});
    assert.equal(queued.waitAttention,false);assert.ok(queued.waitingStatus.includes(locale==='ko'?'작업 실행 대기':'Task queued'));
    const input=present({roster:[owner,{...child,inputNeeded:true}],wait:{...wait,targets:[{...wait.targets[0],state:'UNAVAILABLE'}]}});
    assert.match(input.waitingStatus,locale==='ko'?/입력 필요/:/input needed/i);
    const repair={...checker,role:'repairer'};
    for(const recordedPhase of ['BLOCKED','REPAIR_REQUIRED']){
        const checkpoint={workId:'TASK',state:'ACTIVE',recordedPhase,activationPending:false};
        const repairStatus=present({roster:[owner,child,repair],waitActivities:[checkpoint]});
        assert.ok(repairStatus.waitingStatus.includes(uiText(locale,'task.role.repairer')));
        assert.equal(repairStatus.waitAttention,false);
        const stopped=present({roster:[owner,child,{...repair,state:'IDLE'}],waitActivities:[checkpoint]});
        assert.equal(stopped.waitAttention,true);
        assert.ok(stopped.waitingStatus.includes(uiText(locale,recordedPhase==='BLOCKED'?'task.change.blocked':'task.change.repairNeeded')));
        assert.doesNotMatch(stopped.waitingStatus,/\/result/);
        const activation=present({roster:[owner,child,repair],waitActivities:[{...checkpoint,activationPending:true}]});
        assert.equal(activation.waitAttention,true);
        assert.ok(activation.waitingStatus.includes(uiText(locale,'task.change.activation')));
    }
    const activity=new ConversationActivity(()=>{}), rendered=()=>activity.render(140).map(stripTerminalSequences).join('\n');
    try {
        activity.update('WAITING',{locale,waitingStatus:result.waitingStatus,waitAttention:result.waitAttention});
        assert.match(rendered(),/#child/);assert.doesNotMatch(rendered(),/\d+s|\d+초|Esc|check conversation|대화를 확인/);
        activity.update('WAITING',{locale,waitingStatus:result.waitingStatus,inputNeeded:true});
        assert.ok(rendered().includes(locale==='ko'?'입력 필요':'Input needed'));
        activity.update('WAITING',{locale,waitingStatus:result.waitingStatus,error:uiText(locale,'activity.error')});
        assert.ok(rendered().includes(locale==='ko'?'확인 필요':'Needs attention'));
        activity.update('UNKNOWN',{locale,waitingStatus:result.waitingStatus});
        assert.ok(rendered().includes(locale==='ko'?'상태 불확실':'Status unknown'));assert.doesNotMatch(rendered(),/#child/);
        activity.update('SETTLING',{locale,waitingStatus:result.waitingStatus});assert.doesNotMatch(rendered(),/#child/);
        activity.update('WAITING',{locale,waitingStatus:result.waitingStatus});
        assert.ok(activity.render(24).every(line=>visibleWidth(line)<=24));
    } finally {activity.dispose();}
});

for (const locale of ['en', 'ko']) test(`${locale} awaited planning decisions and fault control proposals keep their own labels`, () => {
    const owner = view({}), child = view({conversationId:'child',label:'Assigned task',workId:'TASK',parentId:'owner',state:'IDLE'});
    const wait = {conversationId:'owner',workId:'ROOT',runId:'R',generation:7,directionRevision:11,
        targets:[{assignmentId:'A',conversationId:'child',workId:'TASK',state:'RUNNING'}],omitted:0};
    const waitLabel = (role,roleStage) => taskPresentation({view:owner,locale,wait,
        roster:[child,view({conversationId:'actor',workId:'TASK',state:'RUNNING',role,roleStage})]}).waitingStatus;
    assert.ok(waitLabel('adjudicator','planning-adjudication').includes(uiText(locale,'task.role.planningAdjudication')));
    assert.ok(waitLabel('reviewer','consumer-control-proposal').includes(uiText(locale,'task.role.consumerControlProposal')));
    assert.ok(waitLabel('reviewer',undefined).includes(uiText(locale,'task.role.reviewer')));
    assert.ok(waitLabel('adjudicator','consumer-control-proposal').includes(uiText(locale,'task.role.adjudicator')));
});
