// Deterministic host-predicate control. Actual charged author/repair is a separate runtime consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeCore } from '../../dist/controller/change-core.js';
import { hash } from '../../dist/controller/change-files.js';
test('identical candidate/scope failure holds before further authoring; new content can receive a fresh repair decision', () => {
    const obligations = new Map(), versions = new Map();
    let n = 0, phase;
    const strategy = {
        requirementId: 'scope', kind: 'manifest-scope-duty', allowedChangePaths: [
            'a'
        ], unchangedPaths: [
            'b'
        ], reviewKey: 'review'
    };
    let digest = 'same';
    const core = new ChangeCore({
        store: {
            one(sql, id) {
                return obligations.has(id) ? {
                    data: obligations.get(id)
                } : undefined;
            }, run(sql, id, work, data) {
                obligations.set(id, data);
            }
        }
    });
    core.strategies = () => [
        strategy
    ];
    core.scopeReceipt = () => undefined;
    core.verificationPremises = () => ({
        base: 'B', plan: 'P'
    });
    core.scopeEvidence = () => ({
        evidence: {candidate:{digest}, actual:{satisfied:false, violationDigest:'outside-b', deltaDigest:digest}},
        violationSample: {entries:[{path:'test', before:'absent', after:'directory', reason:'outside-scope'}], omitted:2},
    });
    core.newVersion = (work, kind, artifact, data) => {
        const id = 'E' + (++n);
        versions.set(id, {
            data
        });
        return id;
    };
    core.version = id => versions.get(id);
    core.phase = (work, value, patch) => {
        phase = {
            value, ...patch
        };
    };
    assert.equal(core.observeScopeStrategies('W'), false);
    assert.equal(phase.value, 'REPAIR_REQUIRED');
    assert.deepEqual(phase.blocked.slice(1), ['"test" (absent → directory) is outside the accepted change scope','2 more scope violation paths omitted']);
    assert.equal(core.observeScopeStrategies('W'), false);
    assert.equal(phase.value, 'BLOCKED');
    assert.equal(phase.resumeStage, 'checks');
    assert.equal(phase.blocked[1], '"test" (absent → directory) is outside the accepted change scope');
    assert.match(phase.nextAction, /no automatic author retry/);
    digest = 'meaningfully-different';
    assert.equal(core.observeScopeStrategies('W'), false);
    assert.equal(phase.value, 'REPAIR_REQUIRED');
    assert.equal(versions.size, 3);
});

function failedScope() {
    const strategy={requirementId:'scope',kind:'manifest-scope-duty',allowedChangePaths:['a'],unchangedPaths:['b'],reviewKey:'review'};
    const premises={base:'B',plan:'P'},row={phase:'BLOCKED',base:'B',plan:'P',candidate:'C',data:{resumeStage:'checks',blocked:['Any translated or historical explanation']}};
    const f={row,record:{id:'E',data:JSON.stringify({evidence:{actual:{satisfied:false}}})},data:{kind:'verification-scope',state:'pending',strategy,strategyDigest:hash(strategy),evidenceId:'E',premises}};
    const core=new ChangeCore({assertOpen(){},store:{one:()=>f.data?{id:'scope-W-'+hash(strategy),work:'W',data:JSON.stringify(f.data)}:undefined},sourceImpacts:()=>[]});
    f.sample={entries:[{path:'test',before:'absent',after:'directory',reason:'outside-scope'}],omitted:0};
    core.row=()=>f.row;core.coverageHoldReason=()=>null;core.retainedCandidateStage=()=>undefined;core.strategies=()=>[strategy];core.verificationPremises=()=>premises;core.scopeRecord=()=>f.record&&{record:f.record,violationSample:f.sample};core.checkOutputRecovery=()=>({assertAvailable(){}});
    return {core,f};
}
test('explicit scope repair selection uses current typed evidence, not failure text or checkpoint rewriting',()=>{
    const {core,f}=failedScope(),before=structuredClone(f);
    assert.equal(core.continuationStage('W'),'repair');assert.equal(core.sourceAwareStage('W'),'repair');assert.deepEqual(f,before);
    const current=core.currentScopeFailure('W');
    assert.deepEqual(current.diagnostic,{requirementId:'scope',evidenceId:'E',...f.sample});
});
test('changed pending scope evidence precedes roleless execution allowance advice',()=>{
    const {core,f}=failedScope();
    f.row.verification='V';
    core.version=id=>({id,work:'W',kind:id==='C'?'candidate':'verification'});
    core.budget=()=>({limit:1,consumed:1,reserved:0});
    core.requiredCandidateChecks=()=>[{command:'false'}];
    core.scopeEvidence=()=>({evidence:{actual:{satisfied:true}}});
    core.scopeRecord=()=>undefined;
    core.assertCheckExpectations=()=>{};
    const requirements={stage:'checks',roles:[]};
    assert.equal(core.inspectContinuationAllowance('W',requirements),'execution');
    f.data.premises={base:'other'};
    const before=structuredClone(f);
    assert.equal(core.inspectContinuationAllowance('W',requirements),undefined);
    assert.deepEqual(f,before);
});
test('explicit repair hands off the selected current paths and refuses after evidence drift',async()=>{
    const {core,f}=failedScope();
    core.operation=(_options,_stage,body)=>body();
    core.implementInner=(_options,repair,assertCurrent,diagnostic)=>{
        assert.equal(repair,true);
        assert.deepEqual(diagnostic,{requirementId:'scope',evidenceId:'E',...f.sample});
        assert.doesNotThrow(assertCurrent);
        f.record={...f.record,id:'replacement'};
        assert.throws(assertCurrent,/Original failed scope changed before repair admission/);
        return 'controlled repair boundary';
    };
    assert.equal(await core.implement({workId:'W',model:{provider:'owned-no-call',modelId:'owned-no-call'}},true),'controlled repair boundary');
});
const unavailable={
    missing:f=>{f.data=undefined;},
    unrelated:f=>{f.data.kind='finding';},
    resolved:f=>{f.data.state='resolved';},
    'strategy-digest':f=>{f.data.strategyDigest='other';},
    strategy:f=>{f.data.strategy={...f.data.strategy,allowedChangePaths:['other']};},
    premises:f=>{f.data.premises={...f.data.premises,plan:'other'};},
    'foreign-record':f=>{f.data.evidenceId='other';},
    'missing-current-record':f=>{f.record=undefined;},
    satisfied:f=>{f.record.data=JSON.stringify({evidence:{actual:{satisfied:true}}});},
    'no-candidate':f=>{f.row.candidate=null;},
};
for(const [name,change]of Object.entries(unavailable))test('scope recovery cannot select an author from '+name+' proof',()=>{
    const {core,f}=failedScope();change(f);const before=structuredClone(f);
    assert.equal(core.continuationStage('W'),'checks');assert.equal(core.sourceAwareStage('W'),'checks');assert.deepEqual(f,before);
});
test('unavailable current scope source grants no repair route',()=>{
    const {core}=failedScope();core.scopeRecord=()=>{throw Error('Controlled unavailable scope manifest');};assert.equal(core.continuationStage('W'),'checks');
});
test('an older refused replan checkpoint selects repair only with the exact current failed scope',()=>{
    const {core,f}=failedScope();
    f.row.data.resumeStage='plan';
    assert.equal(core.sourceAwareStage('W'),'repair');
    core.h.sourceImpacts=()=>[{data:{effectHold:true}}];
    assert.equal(core.sourceAwareStage('W'),'source-fit');
    core.coverageHoldReason=()=> 'Original coverage is held';
    assert.equal(core.sourceAwareStage('W'),'plan');
    core.coverageHoldReason=()=>null;
    f.record=undefined;
    assert.equal(core.sourceAwareStage('W'),'plan');
});
test('a scope failure recorded during settled-material restoration refuses planning before operation registration',async()=>{
    let obligations=[];
    const core=new ChangeCore({assertOpen(){},busy:()=>false,
        register:()=>assert.fail('Work with a pending scope duty registered a planning operation')});
    core.pending=()=>obligations;
    core.applicationBinding=()=>undefined;
    core.restoreSettledRoleMaterial=async()=>{
        obligations=[{id:'scope-duty',kind:'verification-scope'}];
        return true;
    };
    await assert.rejects(core.operation({workId:'W'},'plan',()=>assert.fail('Planning body executed')),
        /requires an explicit scope replan/);
});
