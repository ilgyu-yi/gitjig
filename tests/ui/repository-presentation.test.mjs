import test from 'node:test';
import assert from 'node:assert/strict';
import {repositoryApplicationReviewAvailable,repositoryAuditText,repositoryGuidanceText,repositoryPhaseText,repositoryPlanText,repositoryProfileText,repositoryTargetText} from '../../dist/ui/repository-presentation.js';

const target={provider:'gitea',apiBase:'https://forge.example/api/v1',owner:'owner',repository:'repo',repositoryId:9,actorUserId:7};
const profile={provider:'gitea',version:'fixture/v1',repository:{allow_merge_commits:false},protection:{name:'main',fields:{required_approvals:0,status_check_contexts:[]}}};
const view=()=>({planId:'original-plan',operationId:'original-plan',workId:'original-work',targetId:'original-target',revision:2,phase:'PREVIEWED',activation:'disabled',blocked:[],nextAction:'applyRepositoryConfiguration',receiptIds:[],
    plan:{operationId:'original-plan',target,profile,profileHash:'retained',activation:'disabled',steps:[{id:'protection',kind:'patch-native-protection',fields:[{path:'required_approvals',before:2,intended:0},{path:'status_check_contexts',before:['check'],intended:[]}]}],preserved:['Unselected native settings stay unmanaged'],manual:[],limitations:['No server CAS'],receipts:[]},
    steps:[{journalId:'journal',revision:2,stepId:'protection',kind:'patch-native-protection',state:'PENDING',transportOutcome:null,observations:[],creationHint:null,receiptIds:[]}]});
const summary=text=>text.split('Original observation · details')[0];

test('staged repository summary preserves omitted, false, zero and empty values without declaring active policy',()=>{
    const before=JSON.stringify(profile),text=summary(repositoryProfileText(profile));
    assert.match(text,/no preview or repository write has started/);
    assert.match(text,/profile.repository.allow_merge_commits: false/);
    assert.match(text,/profile.protection.fields.required_approvals: 0/);
    assert.match(text,/profile.protection.fields.status_check_contexts: \[\]/);
    assert.doesNotMatch(text,/allow_rebase:/);assert.match(text,/An unmanaged field differs from an explicit false/);
    assert.equal(JSON.stringify(profile),before);
});

test('retained preview explains exact change and next menu action before original details',()=>{
    const original=view(),before=JSON.stringify(original),text=repositoryPlanText(original),first=summary(text);
    assert.match(first,/^PREVIEWED · Preview retained/);assert.match(first,/choose Review changes for application/);
    assert.match(first,/Original plan: "original-plan"/);assert.match(first,/required_approvals: 2 → 0/);
    assert.match(first,/Native protection rule: "main"/);assert.doesNotMatch(first,/Possible handoff remains UNKNOWN/);
    assert.match(first,/status_check_contexts: \["check"\] → \[\]/);assert.match(first,/No server CAS/);
    assert.match(first,/retained facts, not a fresh read/);assert.match(text,/Original observation · details\n\{/);
    assert.equal(JSON.stringify(original),before);
    const review=summary(repositoryPlanText(original,true));
    assert.match(review,/^Review selected changes · no write/);assert.match(review,/choose Open Apply confirmation/);
    assert.doesNotMatch(review,/Next: open this retained plan|Possible handoff remains UNKNOWN/);
});

for(const phase of ['PREVIEWING','APPLYING','PARTIAL','REFUSED','UNKNOWN','CANCELLED'])test('repository '+phase+' remains distinct from confirmed selected observations',()=>{
    const original={...view(),phase,nextAction:'Inspect exact original intent',blocked:['Retained native reason']},text=summary(repositoryPlanText(original));
    assert.ok(text.startsWith(phase+' ·'));assert.match(text,/Recorded next action: "Inspect exact original intent"/);
    assert.match(text,/Retained native reason/);assert.doesNotMatch(text,/^CONFIRMED/);
});

test('application review follows the active journal and preserves eligible no-op and partial revisions',()=>{
    const available=repositoryApplicationReviewAvailable;
    const original=view(), journal=original.steps[0];
    assert.equal(available(original),true);
    assert.equal(available({...original,plan:{...original.plan,steps:[]},steps:[]}),true);
    for(const phase of ['PREVIEWING','APPLYING','CONFIRMED','CANCELLED'])
        assert.equal(available({...original,phase}),false,phase);
    for(const state of ['UNKNOWN','INVOKING','REFUSED'])
        assert.equal(available({...original,steps:[{...journal,state}]}),false,state);
    assert.equal(available({...original,steps:[]}),false);
    const refused={...journal,journalId:'unexpected-duplicate',state:'REFUSED'};
    assert.equal(available({...original,steps:[refused,journal]}),false);
    assert.equal(available({...original,steps:[journal,refused]}),false);
    assert.equal(available({...original,plan:{...original.plan,manual:['Unsupported']}}),false);
    const partial={...original,phase:'PARTIAL',plan:{...original.plan,steps:[...original.plan.steps,{id:'repository'}]},
        steps:[{...journal,state:'CONFIRMED'},{...journal,stepId:'repository'}]};
    assert.equal(available(partial),true);
    const older={...journal,revision:1,state:'UNKNOWN',forwardRevision:2};
    assert.equal(available({...original,steps:[older,journal]}),true);
    assert.equal(available({...original,steps:[{...older,state:'INVOKING'},journal]}),false);
    const priorUnsettled={...original,steps:[{...older,forwardRevision:undefined},journal]};
    assert.match(summary(repositoryPlanText(priorUnsettled)),/Possible handoff remains UNKNOWN/);
    const unknown={...original,phase:'UNKNOWN',steps:[{...journal,state:'UNKNOWN'}]};
    assert.match(repositoryPlanText(unknown),/Next: choose Reconcile original request/);
    assert.doesNotMatch(summary(repositoryPlanText(unknown)),/choose Review changes for application/);
});

test('fresh audit conflict is shown independently of historical CONFIRMED journal observations',()=>{
    const original=view();original.phase='CONFIRMED';original.steps[0].observations=[{path:'required_approvals',state:'matching',actual:0}];
    const audit={planId:original.planId,targetId:original.targetId,view:original,complete:false,unknowns:['Current selected value differs'],steps:[{journalId:'journal',result:{outcome:'unknown',reason:'Current selected value differs',fieldObservations:[{path:'required_approvals',state:'conflicting',actual:3}]}}]};
    const before=JSON.stringify(audit),text=summary(repositoryAuditText(audit));
    assert.match(text,/^AUDIT INCOMPLETE/);assert.match(text,/Historical operation phase \(separate from this audit\): "CONFIRMED"/);
    assert.match(text,/required_approvals: "conflicting" · current actual 3/);assert.doesNotMatch(text,/recorded actual 0|AUDIT MATCH/);
    assert.equal(JSON.stringify(audit),before);
    audit.complete=true;audit.unknowns=[];audit.steps[0].result={outcome:'confirmed',reason:'Observed selected values',fieldObservations:[]};
    assert.match(repositoryAuditText(audit),/^AUDIT MATCH/);
});

test('Korean repository results distinguish an uncertain apply from a current audit conflict',()=>{
    const recorded=view();
    const result={...recorded,phase:'UNKNOWN',steps:[{...recorded.steps[0],state:'UNKNOWN',transportOutcome:'uncertain'}]};
    const retained=summary(repositoryPlanText(result,false,'ko'));
    assert.match(retained,/^결과 미확인 · UNKNOWN/);
    assert.match(retained,/원래 요청 결과 확인 · 읽기 전용/);
    assert.match(retained,/required_approvals: 2 → 0/);
    const audit={planId:recorded.planId,targetId:recorded.targetId,view:{...recorded,phase:'CONFIRMED'},complete:false,unknowns:['Fixture drift'],steps:[{
        journalId:'journal',result:{outcome:'unknown',fieldObservations:[{path:'required_approvals',state:'conflicting',actual:3}]},
    }]};
    const fresh=summary(repositoryAuditText(audit,'ko'));
    assert.match(fresh,/^현재 설정 조회 · 일치 확인 미완료/);
    assert.match(fresh,/원래 요청의 기록 상태: "CONFIRMED"/);
    assert.match(fresh,/required_approvals: "conflicting" · 현재 값 3/);
});

test('an unrecognized retained phase remains inspectable and cannot offer application review',()=>{
    const original={...view(),phase:'CORRUPTED'};
    assert.equal(repositoryApplicationReviewAvailable(original),false);
    assert.match(repositoryPhaseText(original.phase,'ko'),/^기록 상태 확인 불가/);
    assert.match(repositoryPlanText(original),/^UNAVAILABLE.*phase is not recognized/);
});

test('native guidance keeps available endpoints separate from missing fields and preserves native values',()=>{
    const observed=value=>({state:'OBSERVED',value}),guidance={targetId:'target',branch:'main',limitations:['No complete coverage'],observation:{kind:'repository-observation',status:'OBSERVED',observedAt:'fixture',repository:{settings:{allow_merge_commits:observed(false)}},observations:{branch:observed({name:'main',fields:{required_approvals:observed(0),status_check_contexts:observed([]),user_can_merge:{state:'UNAVAILABLE',reason:'Field withheld'}}}),effectiveRule:{state:'UNAVAILABLE',reason:'Native effective-rule name missing'}},limitations:['Do not infer wildcard priority'],nextAction:'Resolve unavailable fields'}};
    const before=JSON.stringify(guidance),text=summary(repositoryGuidanceText(guidance,target));
    assert.match(text,/Selected branch: main/);assert.match(text,/Native observation status: "OBSERVED"/);
    assert.match(text,/OBSERVED endpoints may still contain UNAVAILABLE/);
    assert.match(text,/branch.fields.required_approvals: OBSERVED 0/);assert.match(text,/branch.fields.status_check_contexts: OBSERVED \[\]/);
    assert.match(text,/branch.fields.user_can_merge: UNAVAILABLE · "Field withheld"/);assert.match(text,/effectiveRule: UNAVAILABLE/);
    assert.match(text,/repository.settings.allow_merge_commits: OBSERVED false/);assert.match(text,/Do not infer wildcard priority/);
    assert.equal(JSON.stringify(guidance),before);
});

test('Gitea branch guidance promotes only its observed native effective rule and never substitutes inventory',()=>{
    const observed=value=>({state:'OBSERVED',value}),rule={required_approvals:observed(0),dismiss_stale_approvals:observed(true),enable_force_push:observed(false),enable_status_check:observed(true),status_check_contexts:observed(['unit','integration'])};
    const guidance={targetId:'opaque-target-id',branch:'main',limitations:[],observation:{kind:'repository-observation',provider:'gitea',status:'OBSERVED',observations:{effectiveRule:observed(rule),branch:observed({fields:{required_approvals:observed(2)}}),protectionInventory:observed([rule])}}};
    const text=summary(repositoryGuidanceText(guidance,target));
    assert.match(text,/Required approvals · native effective rule: 0/);assert.match(text,/Dismiss stale approvals · native effective rule: true/);
    assert.match(text,/Allow force push · native effective rule: false/);assert.match(text,/Status check contexts · native effective rule: \["unit","integration"\]/);
    assert.ok(text.indexOf('Required approvals · native effective rule')<text.indexOf('opaque-target-id'));
    guidance.observation.observations.effectiveRule={state:'UNAVAILABLE',reason:'Native selection missing'};
    const unavailable=summary(repositoryGuidanceText(guidance,target));
    assert.match(unavailable,/Effective rule requirements: UNAVAILABLE · "Native selection missing"/);
    assert.match(unavailable,/Required approvals · branch summary only: 2/);
    assert.doesNotMatch(unavailable,/Required approvals · native effective rule:|Allow force push · native effective rule:/);
});

test('GitHub unavailable policy is not reported as no rules or native write permission',()=>{
    const github={owner:'owner',repository:'repo',repositoryId:9,actorUserId:7,repositoryNodeId:'R9',ownerId:7,visibility:'public'};
    const text=summary(repositoryGuidanceText({targetId:'target',branch:'main',limitations:[],observation:{policy:null,mergeMethods:{allow_merge_commit:false},conditions:['Policy visibility unavailable'],activation:'disabled'}},github));
    assert.match(text,/Provider: "github"/);assert.match(text,/GitHub policy: UNAVAILABLE/);
    assert.match(text,/GitHub merge methods.allow_merge_commit: false/);assert.match(text,/Policy visibility unavailable/);
    assert.doesNotMatch(text,/no rules|write permission granted/i);
});

test('GitLab branch guidance summarizes project flags and keeps denied approvals distinct from observed empty rules', () => {
    const observed = value => ({state:'OBSERVED',value});
    const denied = {state:'UNAVAILABLE',reason:'Native collection denied (HTTP 403)'};
    const gitlab = {...target, provider:'gitlab'};
    const guidance = {
        targetId:'gitlab-target',branch:'release',limitations:[],
        observation:{kind:'repository-observation',provider:'gitlab',status:'PARTIAL',
            repository:{settings:{
                only_allow_merge_if_pipeline_succeeds:observed(true),
                allow_merge_on_skipped_pipeline:observed(false),
                only_allow_merge_if_all_discussions_are_resolved:observed('invalid'),
            }},
            observations:{branch:observed({fields:{protected:observed(true)}}),approvalRules:denied}},
    };
    const before = JSON.stringify(guidance);
    const text = summary(repositoryGuidanceText(guidance,gitlab));
    assert.ok(text.indexOf('GitLab project merge settings') < text.indexOf('Native field observations'));
    assert.match(text,/Require a successful pipeline: OBSERVED true/);
    assert.match(text,/Allow merge on a skipped pipeline: OBSERVED false/);
    assert.match(text,/Require all discussions resolved: UNAVAILABLE/);
    assert.match(text,/Selected branch is protected: OBSERVED true/);
    assert.match(text,/Project approval rules: UNAVAILABLE · "Native collection denied \(HTTP 403\)"/);
    assert.match(text,/Check the merge request for applicable approvals and inherited requirements/);
    assert.equal(JSON.stringify(guidance),before);

    guidance.observation.observations.approvalRules = observed([]);
    const korean = summary(repositoryGuidanceText(guidance,gitlab,'ko'));
    assert.match(korean,/GitLab 프로젝트 병합 설정/);
    assert.match(korean,/파이프라인 성공 필요: OBSERVED true/);
    assert.match(korean,/프로젝트 승인 규칙: OBSERVED · 원본 상세에서 확인/);
    assert.doesNotMatch(korean,/승인 규칙: OBSERVED \[\]/);
});

test('whole-field bounds keep controls inert and never substitute shortened plausible identities',()=>{
    const original=view(),oversized='UNIQUE-BEGIN-'+'한'.repeat(20000)+'-UNIQUE-END';
    original.plan.steps[0].fields.push({path:'controlled\x1b[31m\u009b',before:false,intended:'\n\u0085'});
    original.plan.steps[0].fields.push({path:'large',before:null,intended:oversized});
    const text=repositoryPlanText(original),first=summary(text);
    assert.match(first,/Original plan: "original-plan"/);assert.match(first,/summary fields omitted whole/);
    assert.match(text,/Original details omitted as a whole/);assert.doesNotMatch(text,/UNIQUE-BEGIN|UNIQUE-END/);
    assert.doesNotMatch(text,/[\x00-\x09\x0b-\x1f\x7f-\x9f]/u);assert.ok(Buffer.byteLength(text)<50000);
    assert.match(repositoryTargetText('target',target),/^Registered repository identity · current permissions have not been observed/);
});

test('application review shows every complete selected field or refuses before it can be confirmed',()=>{
    const original=view(),long='exact-context-'+('x'.repeat(9000));
    original.plan.steps[0].fields=[{path:'status_check_contexts',before:[],intended:[long]}];
    const reviewed=repositoryPlanText(original,true);
    assert.ok(summary(reviewed).includes(long),'A field above the read-only 8192-byte cap must stay complete in an allowed review');
    assert.doesNotMatch(summary(reviewed),/omitted/);
    original.plan.steps[0].fields[0].before=['y'.repeat(28000)];
    assert.throws(()=>repositoryPlanText(original,true),/Complete repository application review.*36000.*Original plan original-plan.*repo plan --plan/);
    const staleHint={...view(),phase:'UNKNOWN',nextAction:'reconcileRepositoryConfiguration (read-only; no replay)'};
    assert.doesNotMatch(repositoryPlanText(staleHint),/Next: choose Reconcile original request/);
    const forwarded={...view().steps[0],state:'UNKNOWN',forwardRevision:2,revision:1,transportOutcome:'uncertain'};
    assert.match(repositoryPlanText({...view(),phase:'CONFIRMED',steps:[forwarded]}),/Next: choose Reconcile original request \(read only\)/);
});
