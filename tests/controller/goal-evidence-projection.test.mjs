import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../dist/controller/store.js';
import {goalEvidenceProjection,captureGoalEvidence} from '../../dist/controller/goal-evidence.js';
import {Goals} from '../../dist/controller/goals.js';
import {hash} from '../../dist/controller/change-files.js';

// Controlled retained ledgers exercise the presentation boundary, not procedure standing.
function fixture(t){
 const s=new Store(':memory:');t.after(()=>s.close());
 s.run('INSERT INTO sources VALUES(?,?,?,?)','source',null,'{}','Keep the original task requirement');
 s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W',null,'source',null,'W','DELIVERED',1,1,null,'{}');
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','run','W',1,1,'SETTLED','owned','consumed','{}');
 const version=(id,kind,data)=>s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,'W',kind,null,null,'digest-'+id,JSON.stringify(data));
 version('base','base',{});version('candidate','candidate',{delta:{files:[{path:'consumer.cjs',before:'old',after:'new'}]}});version('plan','plan',{plan:{requirements:[{id:'R',description:'Actual requirement'}]}});version('verification','verification',{verification:{checks:[{id:'check'}]}});
 s.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)','receipt','W','run','candidate','verification','check','pass',JSON.stringify({purpose:'candidate',boundVersions:{base:'base',candidate:'candidate'},cleanup:'removed',caseDescriptor:{cases:[{id:'healthy',declaration:{expected:{kind:'value',value:3}}}]},parsed:{value:{cases:[{id:'healthy',observed:{kind:'value',value:3}}],assertions:[{id:'A',passed:true}]}},actual:{exitCode:0,stdout:'raw native diagnostic',stderr:''}}));
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','review','W','run','reviewer',1,'COMPLETE','consumed',JSON.stringify({stage:'fresh-review',reviewKey:'independent',cleanup:'removed',inputVersions:{candidate:'candidate'},planProposal:'Historical duplicated prompt'.repeat(10000)}));
 s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)','output','review','original raw','usable',JSON.stringify({protocol:{verdict:'clear',findings:[],verificationDecisions:[{requirementId:'R',verdict:'satisfied',witnessIds:['receipt']}]},terminal:'completed'}));
 const body={workId:'W',epoch:1,phase:'REVIEW_READY',reviewReady:true,launches:[{data:{planProposal:'repeat'.repeat(30000)}}],checks:[],occurrences:[],dispositions:[],versions:[]};
 const source={goal:'G',criteria:['Actual result'],author:{},links:[{id:'assignment',work:'W',state:'COMPLETE',data:JSON.stringify({source:{runId:'author'},result:body,resultId:'result'})}],results:[{id:'result',conversation:'child',work:'W',data:JSON.stringify({assignmentId:'assignment',publicationHash:'originalhash',result:body})}],operations:[],findings:[]};
 const evidence={workId:'W',epoch:1,generation:1,versions:{base:'base',candidate:'candidate',plan:'plan',verification:'verification',requirements:null,contracts:'base'},checkIds:['receipt'],reviewLaunchIds:['review'],fingerprint:'actual-selection-premise'};
 return{s,source,evidence};
}
test('goal presentation avoids historical body duplication while retaining selected expected/observed/review evidence',t=>{
 const {s,source,evidence}=fixture(t),before=JSON.stringify(source),value=goalEvidenceProjection(s,source,[evidence]);assert.equal(JSON.stringify(source),before);
 assert.ok(Buffer.byteLength(before)>256*1024);assert.ok(Buffer.byteLength(JSON.stringify(value))<32*1024);
 assert.equal(value.links[0].data.result,undefined);assert.equal(value.results[0].result.launches,undefined);assert.equal(value.results[0].publicationHash,'originalhash');
 const selected=value.governed[0];assert.equal(selected.ownerRequest,'Keep the original task requirement');assert.equal(selected.checks[0].data.caseDescriptor.cases[0].declaration.expected.value,3);assert.equal(selected.checks[0].data.parsed.value.cases[0].observed.value,3);assert.equal(selected.checks[0].data.cleanup,'removed');
 assert.equal(selected.reviews[0].outputs[0].protocol.verdict,'clear');assert.equal(selected.reviews[0].outputs[0].protocol.verificationDecisions[0].witnessIds[0],'receipt');assert.equal(selected.reviews[0].planProposal,undefined);
});
test('linked ordinary observation reaches the capsule once without explicit IDs and deduplicates only exact original publications',t=>{
 const {s,source}=fixture(t),body={conversationId:'child',workId:'W',runId:'run',status:'delivered',cleanup:'removed',coordinatorReport:{kind:'ordinary-coordinator-report/v1',state:'delivered',text:[{type:'text',text:'ACTUAL_ORIGINAL_CHILD_OBSERVATION'}]}};
 const link={id:'ordinary',target:'child',work:'W',state:'COMPLETE',data:JSON.stringify({operation:'investigate',resultId:'ordinary-result',result:body})};
 source.links=[link];source.results=[];
 const once=goalEvidenceProjection(s,source,[]);assert.deepEqual(once.links[0].data.result,body);assert.equal(JSON.stringify(once).split('ACTUAL_ORIGINAL_CHILD_OBSERVATION').length-1,1);
 const publication={id:'ordinary-result',conversation:'child',work:'W',data:JSON.stringify({assignmentId:'ordinary',result:body})};source.results=[publication];
 const duplicate=goalEvidenceProjection(s,source,[]);assert.equal(duplicate.links[0].data.result,undefined);assert.equal(JSON.stringify(duplicate).split('ACTUAL_ORIGINAL_CHILD_OBSERVATION').length-1,1);
 for(const changed of [{...publication,id:'other'},{...publication,conversation:'foreign'},{...publication,work:'foreign'},
  {...publication,data:JSON.stringify({assignmentId:'foreign',result:body})},{...publication,data:JSON.stringify({assignmentId:'ordinary',result:{...body,cleanup:'quarantined'}})}]){
  source.results=[changed];assert.deepEqual(goalEvidenceProjection(s,source,[]).links[0].data.result,body,'A mismatched canonical row cannot erase the original linked observation');
 }
});
test('missing selected records refuse and changed necessary facts change the frozen presentation',t=>{
 const {s,source,evidence}=fixture(t);assert.throws(()=>goalEvidenceProjection(s,source,[{...evidence,checkIds:['foreign']}]),/unavailable/);
 const first=JSON.stringify(goalEvidenceProjection(s,source,[evidence]));const row=s.one('SELECT data FROM check_runs WHERE id=?','receipt'),data=JSON.parse(row.data);data.cleanup='quarantined-owned';data.parsed={issues:['Unavailable native assertion']};s.run('UPDATE check_runs SET status=?,data=? WHERE id=?','unavailable',JSON.stringify(data),'receipt');
 const second=goalEvidenceProjection(s,source,[evidence]);assert.notEqual(JSON.stringify(second),first);assert.equal(second.governed[0].checks[0].status,'unavailable');assert.equal(second.governed[0].checks[0].data.cleanup,'quarantined-owned');assert.deepEqual(second.governed[0].checks[0].data.parsed.issues,['Unavailable native assertion']);
});
test('mixed capsule preserves base observation, scope predicate and independent adjudication without relabeling them candidate success',t=>{
 const {s,source,evidence}=fixture(t);
 s.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)','baseline','W','run','base','verification','base-check','baseline-observed',JSON.stringify({purpose:'baseline',target:{kind:'base',versionId:'base',digest:'original-base'},cleanup:'removed',caseDescriptor:{cases:[{id:'baseline-failure',declaration:{expected:{kind:'exception',value:'original defect'}}}]},parsed:{value:{cases:[{id:'baseline-failure',observed:{kind:'exception',value:'original defect'}}]}},actual:{exitCode:0}}));
 const scope={actual:{satisfied:true},adverse:{satisfied:false},baseDigest:'base',candidateDigest:'candidate',predicateVersion:1};s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)','scope','W','scope-evidence',null,null,'scope-digest',JSON.stringify({evidence:scope}));
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','judge','W','run','adjudicator',1,'COMPLETE','consumed',JSON.stringify({stage:'review-adjudication',cleanup:'removed',inputVersions:{candidate:'candidate'}}));
 s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)','judge-output','judge','retained raw','usable',JSON.stringify({protocol:{verdict:'accept',verificationDecisions:[{requirementId:'scope-R',verdict:'satisfied',witnessIds:['scope','review']}]}}));
 const selected={digest:'mixed-digest',requirements:[{requirementId:'base-R',strategyDigest:'base-strategy',kind:'base-execution-duty',reviewKey:'independent',witnessIds:['baseline'],reviews:[{launchId:'review',decision:{verdict:'satisfied'}}]},{requirementId:'scope-R',strategyDigest:'scope-strategy',kind:'manifest-scope-duty',reviewKey:'independent',witnessIds:['scope'],reviews:[{launchId:'review',decision:{verdict:'satisfied'}}]}],adjudication:{launchId:'judge',decisions:[{requirementId:'scope-R',witnessIds:['scope','review'],verdict:'satisfied'}]}};
 const mixed={...evidence,verificationStrategyDigest:selected.digest},value=goalEvidenceProjection(s,source,[mixed],new Map([['W',selected]])).governed[0];
 assert.equal(value.checks.find(check=>check.id==='baseline').status,'baseline-observed');assert.equal(value.checks.find(check=>check.id==='baseline').data.target.kind,'base');assert.deepEqual(value.verificationEvidence.scopeWitnesses[0].evidence,scope);assert.equal(value.verificationEvidence.digest,'mixed-digest');assert.equal(value.reviews.find(review=>review.id==='judge').role,'adjudicator');assert.equal(value.reviews.filter(review=>review.id==='review').length,1);
});
test('mixed digest without exact authoritative witness selection cannot fall back to a legacy capsule',t=>{
 const {s,source,evidence}=fixture(t);assert.throws(()=>goalEvidenceProjection(s,source,[{...evidence,verificationStrategyDigest:'mixed'}]),/selection unavailable/);
});
test('original final snapshot guard refuses selected role-output and effect-receipt drift, including appended receipts',t=>{
 const {s,source,evidence}=fixture(t);
 s.run('INSERT INTO effect_targets VALUES(?,?,?)','target',null,'{}');s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','grant','W','target',1,'{}');s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','operation','W','target','grant','CONFIRMED','{}');s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)','native','operation','readback',JSON.stringify({observed:'actual endpoint A'}));source.operations=[s.one('SELECT * FROM effect_operations WHERE id=?','operation')];
 const g=new Goals({store:s,assertEvidence:()=>{}});g.evidenceSource=()=>source;const snapshot=captureGoalEvidence(s,source,[evidence]);
 const assertCurrent=()=>g.assertSnapshot({},hash(source),[evidence],snapshot.selectedSourceHash);assert.doesNotThrow(assertCurrent);
 const receipt=s.one('SELECT data FROM effect_receipts WHERE id=?','native');s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify({observed:'different endpoint B'}),'native');assert.throws(assertCurrent,/selected evidence sources changed/);s.run('UPDATE effect_receipts SET data=? WHERE id=?',receipt.data,'native');
 const output=s.one('SELECT data FROM role_outputs WHERE id=?','output');s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({protocol:{verdict:'findings',findings:[{description:'new actual finding'}]}}),'output');assert.throws(assertCurrent,/selected evidence sources changed/);s.run('UPDATE role_outputs SET data=? WHERE id=?',output.data,'output');
 s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)','later','operation','reconciliation','{}');assert.throws(assertCurrent,/selected evidence sources changed/);s.run('DELETE FROM effect_receipts WHERE id=?','later');assert.doesNotThrow(assertCurrent);
});
test('unrelated retained rows do not invalidate the selected private proof and new review proof cannot downgrade to legacy',t=>{
 const {s,source,evidence}=fixture(t),g=new Goals({store:s,assertEvidence:()=>{}});g.evidenceSource=()=>source;const proof=captureGoalEvidence(s,source,[evidence]);
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','unselected','W','run','reviewer',1,'COMPLETE','consumed','{}');s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)','unselected-output','unselected','unrelated','usable','{}');
 assert.doesNotThrow(()=>g.assertSnapshot({},hash(source),[evidence],proof.selectedSourceHash));
 assert.throws(()=>g.assertReviewSnapshot({},{evidenceVersion:2,sourceHash:hash(source),governed:[evidence]}),/proof unavailable/);
 const current={sourceHash:hash(source),selectedSourceHash:proof.selectedSourceHash,value:proof.value};
 assert.throws(()=>g.assertReviewSnapshot({},{sourceHash:hash(source),governed:[evidence],evidence:hash(current)}),/Legacy goal evidence proof unavailable/);
 assert.doesNotThrow(()=>g.assertReviewSnapshot({},{sourceHash:hash(source),governed:[evidence],evidence:hash({...source,governed:[evidence]})}));
});
