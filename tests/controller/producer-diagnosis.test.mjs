import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../dist/controller/store.js';
import {ChangeCore} from '../../dist/controller/change-core.js';
import {hash} from '../../dist/controller/change-files.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
const common={version:1,summary:'Independent exact producer diagnosis',findings:[],assessedScope:[]};
const claim={requirementId:'R1',severity:'blocking',repair:'substantive',description:'Actual BASE still exports2 rather than3',evidence:['base:consumer.cjs']};
async function fixture(raw='<function=bash>node check.cjs</function>',issues=['PROTOCOL: invalid JSON']){
 const s=new Store(':memory:'),tuple={contracts:'K',requirements:null,base:'B',candidate:null,plan:null,verification:null};
 s.run('INSERT INTO sources VALUES(?,?,?,?)','S',null,'{}','Original owner request');s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W',null,'S',null,'W','ACTIVE',1,1,null,'{}');
 for(const[k,id]of[['contracts','K'],['base','B']])s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,'W',k,null,null,hash(id),'{}');
 s.run('INSERT INTO change_state VALUES(?,?,?,?,?,?,?,?)','W','BASE_CAPTURED','B',null,null,null,1,JSON.stringify({contractsVersion:'K'}));
 const core=new ChangeCore({store:s,sourceImpacts:()=>[]}),native=new Map();
 const seed=(id,role,stage,status,phase,reservation)=>{const nativeId=id+'Native',historyRef=id+'History';s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',id+'Run','W',1,1,phase,'fixture-only',reservation,JSON.stringify({cleanup:'removed',historyRef,nativeSessionId:nativeId,nativeCheckpoint:{sessionId:nativeId,leafId:'before',bytes:1,sha256:'a'.repeat(64)},sourceInputHash:hash([])}));s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',id,'W',id+'Run',role,1,status,'none',JSON.stringify({stage,inputVersions:tuple,cleanup:'removed',historyRef,nativeSessionId:nativeId}));};
 seed('origin','planner','planning','UNUSABLE','SETTLED','consumed');
 const output=core.collect('W','origin',{role:'planner',rawFinal:raw,issues,exposures:[],terminal:'complete',historyRef:'originHistory',rawFinalTruncated:false,protocol:null,events:[],providerRequests:1,nativeEntryId:'originEntry'},false);
 native.set('originRun',[{type:'message',id:'originEntry',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:raw}]}}]);core.nativeEntries=async id=>structuredClone(native.get(id)??[]); // pure guard fixture; ROOT native consumer proves actual histories separately
 seed('judge','adjudicator','planning-adjudication','CREATED','CREATED','reserved');
 const bundle={context:{producerDiagnostics:core.producerDiagnostics('W')}};await core.captureDiagnosticInput('W','judge',bundle);const supplied=bundle.context.producerDiagnosticReceipt;
 const synthetic=s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',output).at(-1),material=s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',output).slice(0,-1);
 let protocol={...common,planAccepted:true,decisions:[...material.map(o=>({occurrenceId:o.id,disposition:'upheld',reason:'BASE implementation remains pending, not repaired',witnesses:['base:consumer.cjs']})),{occurrenceId:synthetic.id,disposition:'upheld',resolution:'diagnosed',reason:'Complete exact retained text independently diagnosed; extracted claim separately assessed',witnesses:['actual supplied raw operand'],diagnosis:{outputId:output,rawSha256:hash(raw),inputReceiptHash:supplied.receiptHash,materialOccurrenceIds:material.map(o=>o.id)}}]};
 let judgment;
 const bind=()=>{const ld=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?','judge').data);s.run('UPDATE role_launches SET status=?,data=? WHERE id=?','COMPLETE',JSON.stringify({...ld,cleanup:'removed'}),'judge');s.run('UPDATE runs SET phase=?,reservation=? WHERE id=?','SETTLED','consumed','judgeRun');const raw=JSON.stringify(protocol);s.run('DELETE FROM role_outputs WHERE id=?','Jout');s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)','Jout','judge',raw,'usable',JSON.stringify({protocol,terminal:'complete',rawFinalTruncated:false,omittedFindingCount:0,nativeEntryId:'Jentry',historyRef:'judgeHistory'}));native.set('judgeRun',[{type:'message',id:'Jentry',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:raw}]}}]);judgment={launchId:'judge',runId:'judgeRun',output:'Jout',protocol,execution:{selectedFinalEntryId:'Jentry',historyRef:'judgeHistory'},assertInputCurrent:()=>{}};return judgment;};
 bind();return{s,core,output,synthetic,material,bundle,supplied,native,tuple,seed,get protocol(){return protocol;},set protocol(value){protocol=value;},bind,get judgment(){return judgment;},close(){s.close();}};
}
test('strict typed diagnosis operand preserves repaired/roles and phase-specific schema admission',()=>{
 const d={occurrenceId:'F',disposition:'upheld',reason:'Exact diagnosis',witnesses:['raw'],resolution:'diagnosed',diagnosis:{outputId:'O',rawSha256:'a'.repeat(64),inputReceiptHash:'b'.repeat(64),materialOccurrenceIds:[]}};
 assert.ok(parseRoleOutput(JSON.stringify({...common,decisions:[d]}),'adjudicator').value);
 for(const patch of[{diagnosis:null},{diagnosis:{...d.diagnosis,extra:true}},{diagnosis:{...d.diagnosis,materialOccurrenceIds:['F','F']}},{diagnosis:{...d.diagnosis,rawSha256:'wrong'}},{resolution:'repaired'},{disposition:'rejected'}])assert.equal(parseRoleOutput(JSON.stringify({...common,decisions:[{...d,...patch}]}),'adjudicator').value,null);
 assert.ok(parseRoleOutput(JSON.stringify({...common,decisions:[{...d,resolution:'repaired',diagnosis:undefined}]}),'adjudicator').value);assert.equal(parseRoleOutput(JSON.stringify({...common,decisions:[d]}),'reviewer').value,null);
 for(const stage of['planning-adjudication','review-adjudication'])assert.ok(roleOutputSchema('adjudicator',stage).properties.decisions.items.properties.resolution.enum.includes('diagnosed'));
 for(const stage of['source-fit','publication-payload-fit']){const s=roleOutputSchema('adjudicator',stage);assert.deepEqual(s.properties.decisions.items.properties.resolution.enum,['repaired']);assert.equal(s.properties.decisions.items.properties.diagnosis,undefined);}
});
for(const drift of ['row','latest','pending'])test('review retention '+drift+' drift after diagnosis await cannot publish verification judgment',async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');
 try{
  const {core,s}=f,subject=f.material[0].id,oldId='old-closed-row';
  // Historical closure and review eligibility are controlled premises. This
  // reaches the real resolve/retention/phase consumers, not a live review.
  s.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',oldId,subject,'judge','rejected',JSON.stringify({occurrenceId:subject,disposition:'rejected',reason:'Controlled prior rejection',witnesses:['base:consumer.cjs']}));
  s.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',state:'resolved'}),subject);
  const occurrences=s.all('SELECT * FROM finding_occurrences WHERE work=?','W').map(row=>({...row,data:JSON.parse(row.data)}));
  const ld=JSON.parse(s.one('SELECT data FROM role_launches WHERE id=?','judge').data);
  s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...ld,stage:'review-adjudication',decisionReferences:core.adjudicationReferences('W',occurrences)}),'judge');
  s.run('UPDATE change_state SET phase=?,data=? WHERE work=?','RESOLVING',JSON.stringify({contractsVersion:'K',selection:{review:'controlled-review'},verificationJudge:'previous-judge'}),'W');
  f.protocol={...common,decisions:[],verificationDecisions:[],retainedDispositions:[oldId]};f.bind();
  core.inspect=()=>({occurrences,phase:core.row('W').phase,blocked:core.row('W').data.blocked});
  core.role=async()=>f.judgment;core.nitPreview=async()=>null;core.strategies=()=>[];core.strategyReviewEvidence=()=>[];
  core.createVerificationRead=()=>({strategies:()=>[]});
  let effects=0;core.inputDecisions=()=>{effects++;assert.fail('Stale retention reached source-fit')};
  const original=core.prevalidateDiagnoses.bind(core);let semantic;
  core.prevalidateDiagnoses=async(...args)=>{
   const proofs=await original(...args);
   if(drift==='row')s.run('UPDATE finding_dispositions SET data=? WHERE id=?','{"reason":"Changed old verdict"}',oldId);
   if(drift==='latest')s.run('INSERT INTO finding_dispositions SELECT ?,occurrence,launch,status,data FROM finding_dispositions WHERE id=?','new-latest',oldId);
   if(drift==='pending')s.run('UPDATE obligations SET data=? WHERE id=?','{"kind":"finding","state":"pending"}',subject);
   semantic={dispositions:s.all('SELECT * FROM finding_dispositions ORDER BY rowid'),obligations:s.all('SELECT * FROM obligations ORDER BY id')};return proofs;
  };
  const result=await core.resolveInner({workId:'W'});assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/Retained disposition changed/);
  assert.equal(core.row('W').data.verificationJudge,'previous-judge');assert.equal(effects,0);
  assert.deepEqual(s.all('SELECT * FROM finding_dispositions ORDER BY rowid'),semantic.dispositions);assert.deepEqual(s.all('SELECT * FROM obligations ORDER BY id'),semantic.obligations);
 }finally{f.close();}
});
test('legacy exact collect + current input receipt resolves only diagnosis, keeps material and unusable raw',async()=>{
 for(const raw of['<function=bash>node check.cjs</function>',JSON.stringify({...common,findings:[claim]})+'}']){
  const f=await fixture(raw);try{const before=f.s.one('SELECT * FROM role_outputs WHERE id=?',f.output),proofs=await f.core.prevalidateDiagnoses('W',f.judgment);assert.equal(proofs.size,1);f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs));assert.equal(JSON.parse(f.s.one('SELECT data FROM obligations WHERE id=?',f.synthetic.id).data).state,'resolved');assert.equal(f.s.one('SELECT status FROM finding_dispositions WHERE occurrence=?',f.synthetic.id).status,'upheld');assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.output),before);for(const o of f.material)assert.equal(JSON.parse(f.s.one('SELECT data FROM obligations WHERE id=?',o.id).data).state,'pending');}finally{f.close();}
 }
});
function retainReceiverMaterial(f, launch='judge') {
 return f.core.collect('W',launch,{role:'adjudicator',rawFinal:JSON.stringify({...common,findings:[claim]})+'}',issues:['PROTOCOL: invalid JSON'],exposures:[],terminal:'incomplete',historyRef:launch+'History',rawFinalTruncated:false,protocol:null,events:[],providerRequests:1,nativeEntryId:'intermediate',materialAssessment:{version:1}},false,true);
}
function addDiagnosticOrigin(f,raw){
 f.seed('second','challenger','planning-challenge','UNUSABLE','SETTLED','consumed');
 f.core.collect('W','second',{role:'challenger',rawFinal:raw,issues:['PROTOCOL: invalid JSON'],exposures:[],terminal:'complete',historyRef:'secondHistory',rawFinalTruncated:false,protocol:null,events:[],providerRequests:1,nativeEntryId:'secondEntry'},false);
 f.native.set('secondRun',[{type:'message',id:'secondEntry',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:raw}]}}]);
}
test('retained diagnostic custody does not consume the bounded delivered evidence budget',async t=>{
 const raw='a'.repeat(128500),f=await fixture(raw);
 try{
  addDiagnosticOrigin(f,raw);
  const projection=f.core.producerDiagnostics('W'),bundle={context:{producerDiagnostics:projection}};
  await f.core.captureDiagnosticInput('W','judge',bundle);
  const snapshot=JSON.parse(f.s.one('SELECT data FROM role_launches WHERE id=?','judge').data).producerDiagnosticInput;
  const {receiptHash,...retained}=snapshot;
  const suppliedReceipt=bundle.context.producerDiagnosticReceipt,bytes=value=>Buffer.byteLength(JSON.stringify(value));
  t.diagnostic(JSON.stringify({projectionBytes:bytes(projection),deliveredBytes:bytes({producerDiagnostics:projection,producerDiagnosticReceipt:suppliedReceipt}),oldAggregateBytes:bytes({projection,snapshot:retained,suppliedReceipt})}));
  assert.ok(bytes({producerDiagnostics:projection,producerDiagnosticReceipt:suppliedReceipt})<=256*1024,'Complete delivered evidence fits its original budget');
  assert.ok(bytes({projection,snapshot:retained,suppliedReceipt})>256*1024,'Only separately retained custody causes the old refusal');
  assert.equal(projection.outputs.length,2);assert.ok(projection.outputs.every(output=>output.raw===raw));
  assert.equal(suppliedReceipt.eligible.length,2);assert.equal(snapshot.operands.length,2);
  assert.equal(hash(retained),receiptHash);assert.equal(suppliedReceipt.receiptHash,receiptHash);
  f.core.assertDiagnosticInputCurrent('W','judge',snapshot);
  f.protocol={...common,planAccepted:true,decisions:suppliedReceipt.eligible.map(row=>({occurrenceId:row.occurrenceId,disposition:'upheld',resolution:'diagnosed',reason:'Exact complete retained operands independently assessed',witnesses:['supplied original raw'],diagnosis:{outputId:row.outputId,rawSha256:row.rawSha256,inputReceiptHash:suppliedReceipt.receiptHash,materialOccurrenceIds:row.materialOccurrenceIds}}))};
  f.bind();const proofs=await f.core.prevalidateDiagnoses('W',f.judgment);assert.equal(proofs.size,2);
  f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs));
  for(const row of suppliedReceipt.eligible)assert.equal(JSON.parse(f.s.one('SELECT data FROM obligations WHERE id=?',row.occurrenceId).data).state,'resolved');
 }finally{f.close();}
});
test('actually oversized diagnostic delivery refuses without replacing retained custody or dropping origins',async()=>{
 const raw='a'.repeat(129600),f=await fixture(raw);
 try{
  addDiagnosticOrigin(f,raw);
  const projection=f.core.producerDiagnostics('W');assert.ok(Buffer.byteLength(JSON.stringify(projection))<=256*1024);
  const before=f.s.all('SELECT * FROM role_launches ORDER BY id'),pending=f.core.pending('W'),bundle={context:{producerDiagnostics:projection}};
  await assert.rejects(f.core.captureDiagnosticInput('W','judge',bundle),/Diagnostic receipt\/evidence exceeds256KiB/);
  assert.deepEqual(f.s.all('SELECT * FROM role_launches ORDER BY id'),before);
  assert.equal(bundle.context.producerDiagnosticReceipt,undefined);assert.equal(projection.outputs.length,2);
  assert.ok(projection.outputs.every(output=>output.raw===raw));assert.deepEqual(f.core.pending('W'),pending);
 }finally{f.close();}
});
test('original diagnosis commits while receiver additions remain immutable pending independent duties',async()=>{
 const f=await fixture();try{
  const original=f.s.all('SELECT * FROM finding_occurrences WHERE work=?','W');
  const ld=JSON.parse(f.s.one('SELECT data FROM role_launches WHERE id=?','judge').data);
  f.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...ld,decisionReferences:f.core.adjudicationReferences('W',original.map(o=>({...o,data:JSON.parse(o.data)})))}),'judge');
  const output=retainReceiverMaterial(f),added=f.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',output);
  assert.equal(added.length,2,'Ordinary material and its separate host diagnosis are retained');
  const before={output:f.s.one('SELECT * FROM role_outputs WHERE id=?',output),obligations:added.map(o=>f.s.one('SELECT * FROM obligations WHERE id=?',o.id))};
  const proofs=await f.core.prevalidateDiagnoses('W',f.judgment);
  const scope={occurrenceIds:original.map(o=>o.id),pendingUnjudged:'planning-accounting'};
  for(const id of [added[0].id,'future-occurrence']){
   const invalid={...f.protocol,decisions:[...f.protocol.decisions,{occurrenceId:id,disposition:'rejected',reason:'Cannot claim authority outside original input',witnesses:['invented']}]};
   assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','judge',invalid,scope,undefined,proofs)),/duplicate\/unknown occurrence/);
  }
  f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,scope,undefined,proofs));
  assert.ok(!f.core.pending('W').some(o=>o.id===f.synthetic.id));
  for(const row of before.obligations){assert.equal(JSON.parse(row.data).state,'pending');assert.deepEqual(f.s.one('SELECT * FROM obligations WHERE id=?',row.id),row);assert.ok(!f.s.one('SELECT id FROM finding_dispositions WHERE occurrence=?',row.id));}
  assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',output),before.output);
  assert.deepEqual(f.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',output),added);
 }finally{f.close();}
});
test('diagnosis receiver exclusion does not hide another producer or forged receiver provenance',async()=>{
 for(const mode of ['foreign','forged']){
  const f=await fixture();try{
   f.seed('other','adjudicator','planning-adjudication','COMPLETE','SETTLED','consumed');
   const output=retainReceiverMaterial(f,'other');
   if(mode==='forged'){
    const synthetic=f.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',output).at(-1),data=JSON.parse(synthetic.data);
    f.s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify({...data,launchId:'judge'}),synthetic.id);
   }
   await assert.rejects(f.core.prevalidateDiagnoses('W',f.judgment),mode==='foreign'?/pending\/raw input changed/:/provenance mismatch/);
   assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);
  }finally{f.close();}
 }
});
for(const boundary of ['during-read','before-commit'])for(const producer of ['judge','other'])test('diagnostic input custody '+boundary+': '+producer,async()=>{
 const f=await fixture();try{
  const original=f.s.all('SELECT id FROM finding_occurrences WHERE work=?','W').map(o=>o.id);
  f.seed('other','adjudicator','planning-adjudication','COMPLETE','SETTLED','consumed');
  let added;
  if(boundary==='during-read'){
   const read=f.core.nativeEntries;
   f.core.nativeEntries=async id=>{const entries=await read(id);if(id==='originRun'&&!added)added=retainReceiverMaterial(f,producer);return entries;};
  }
  if(producer==='other'&&boundary==='during-read'){
   await assert.rejects(f.core.prevalidateDiagnoses('W',f.judgment),/pending\/raw input changed/);
  }else{
   const proofs=await f.core.prevalidateDiagnoses('W',f.judgment);
   if(boundary==='before-commit')added=retainReceiverMaterial(f,producer);
   const commit=()=>f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,{occurrenceIds:original},undefined,proofs));
   if(producer==='other')assert.throws(commit,/pending\/raw input changed/);
   else{commit();assert.ok(!f.core.pending('W').some(o=>o.id===f.synthetic.id));}
  }
  assert.ok(added);
  for(const o of f.s.all('SELECT id FROM finding_occurrences WHERE output=?',added)){
   assert.equal(JSON.parse(f.s.one('SELECT data FROM obligations WHERE id=?',o.id).data).state,'pending');
   assert.ok(!f.s.one('SELECT id FROM finding_dispositions WHERE occurrence=?',o.id));
  }
  if(producer==='other')assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);
 }finally{f.close();}
});
test('valid diagnosis then invalid ordinary repair rolls entire disposition batch back',async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{
  f.protocol.decisions.reverse();f.protocol.decisions[1].resolution='repaired';f.bind();const proofs=await f.core.prevalidateDiagnoses('W',f.judgment),before=f.s.all('SELECT * FROM obligations ORDER BY id');assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs)),/BASE|Repair|changed|carry/);assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);assert.deepEqual(f.s.all('SELECT * FROM obligations ORDER BY id'),before);
 }finally{f.close();}
});
test('pending diagnosis retains a previously resolved material sibling as a required separate decision',async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{
  // Explicit historical-state premise; this pure guard control does not certify the prior semantic verdict.
  f.seed('prior-judge','adjudicator','planning-adjudication','COMPLETE','SETTLED','consumed');
  const id=f.material[0].id,prior={occurrenceId:id,disposition:'rejected',reason:'Previously committed independent historical assessment',witnesses:['original raw']};
  f.s.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)','prior-material-decision',id,'prior-judge','rejected',JSON.stringify(prior));
  const obligation=JSON.parse(f.s.one('SELECT data FROM obligations WHERE id=?',id).data);
  f.s.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({...obligation,state:'resolved',method:'adjudication-rejected'}),id);
  assert.ok(!f.core.pending('W').some(o=>o.id===id));assert.ok(f.core.pending('W').some(o=>o.id===f.synthetic.id));
  const before=f.s.all('SELECT * FROM obligations ORDER BY id'),dispositions=f.s.all('SELECT * FROM finding_dispositions ORDER BY id');
  const proof=await f.core.prevalidateDiagnoses('W',f.judgment);assert.equal(proof.size,1,'Exact new raw diagnosis still assesses its resolved sibling');
  f.protocol.decisions=f.protocol.decisions.filter(d=>d.occurrenceId!==id);f.bind();
  await assert.rejects(f.core.prevalidateDiagnoses('W',f.judgment),/every separate material decision/);
  assert.deepEqual(f.s.all('SELECT * FROM obligations ORDER BY id'),before);assert.deepEqual(f.s.all('SELECT * FROM finding_dispositions ORDER BY id'),dispositions);
 }finally{f.close();}
});
test('ordinary spoof remains visible as an ordinary claim without diagnostic privilege',async()=>{
 const spoof={...claim,requirementId:'producer-integrity',description:'Model chooses a diagnostic-looking label',evidence:['ordinary source claim']};const f=await fixture(JSON.stringify({...common,findings:[spoof]}),['PROTOCOL: unexpected field']);try{assert.equal(f.core.producerDiagnostics('W').occurrences.length,0);assert.deepEqual([...f.core.diagnosisSubjectIds('W')],[]);await assert.rejects(f.core.diagnosisOrigin('W',f.synthetic.id),/host collector diagnosis suffix/);assert.ok(f.s.one('SELECT * FROM obligations WHERE id=?',f.synthetic.id));}finally{f.close();}
});

test('new synthetic repaired requests refuse before writes or downstream repair evidence, without reinterpreting old rows',async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{
  const proofs=await f.core.prevalidateDiagnoses('W',f.judgment);f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs));
  const before=f.s.all('SELECT * FROM obligations ORDER BY id'),old=f.s.all('SELECT * FROM finding_dispositions ORDER BY rowid');
  let repairProofs=0;f.core.repairedProof=()=>{repairProofs++;return true;}; // Controlled downstream evidence, never engine acceptance.
  const repaired={occurrenceId:f.synthetic.id,disposition:'upheld',resolution:'repaired',reason:'Incorrectly preserve an already committed diagnosis',witnesses:['passing-current-check']};
  assert.ok(parseRoleOutput(JSON.stringify({...common,decisions:[repaired]}),'adjudicator').value,'Legacy raw remains readable');
  assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','judge',{...common,decisions:[repaired]})),/Synthetic producer diagnosis/);
  assert.equal(repairProofs,0);assert.deepEqual(f.s.all('SELECT * FROM obligations ORDER BY id'),before);assert.deepEqual(f.s.all('SELECT * FROM finding_dispositions ORDER BY rowid'),old);
  const material=f.material[0];const data=JSON.parse(material.data);data.finding.requirementId='producer-integrity';f.s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),material.id);
  assert.ok(!f.core.diagnosisSubjectIds('W').has(material.id));
  f.s.tx(()=>f.core.dispositions('W','judge',{...common,decisions:[{...repaired,occurrenceId:material.id}]}));
  assert.equal(repairProofs,1,'An ordinary label still reaches existing repair proof');
 }finally{f.close();}
});
test('receipt/native/raw/current provenance and exact separate material coverage fail before mutation',async()=>{
 const mutations=[f=>f.protocol.decisions.at(-1).diagnosis.rawSha256='c'.repeat(64),f=>f.protocol.decisions.at(-1).diagnosis.inputReceiptHash='c'.repeat(64),f=>f.protocol.decisions.at(-1).diagnosis.materialOccurrenceIds=[],f=>f.protocol.decisions.shift(),f=>f.s.run('UPDATE role_launches SET status=? WHERE id=?','RUNNING','origin'),f=>f.s.run('UPDATE runs SET reservation=? WHERE id=?','reserved','originRun'),f=>f.native.set('originRun',[]),f=>f.s.run('UPDATE role_outputs SET raw=NULL WHERE id=?',f.output),f=>{const d=JSON.parse(f.s.one('SELECT data FROM role_outputs WHERE id=?',f.output).data);d.rawFinalTruncated=true;f.s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(d),f.output);},f=>{const d=JSON.parse(f.s.one('SELECT data FROM role_launches WHERE id=?','judge').data);d.producerDiagnosticInput.sourceInputHash='changed';f.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(d),'judge');},f=>f.s.run('UPDATE works SET epoch=2 WHERE id=?','W')];
 for(const mutate of mutations){const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{mutate(f);f.bind();await assert.rejects(f.core.prevalidateDiagnoses('W',f.judgment));assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);assert.ok(f.s.all('SELECT data FROM obligations').every(o=>JSON.parse(o.data).state==='pending'));}finally{f.close();}}
});
test('semantic transitive/later equivalence to diagnosed target cannot inherit closure even after raw damage',async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{const proofs=await f.core.prevalidateDiagnoses('W',f.judgment);f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs));assert.ok(f.core.diagnosisSubjectIds('W').has(f.synthetic.id));const semantic=f.material[0].id;assert.throws(()=>f.core.diagnosisDecisionGuard('W',{decisions:[{occurrenceId:semantic,disposition:'equivalent',equivalentTo:f.synthetic.id}]}),/Synthetic diagnosis/);
  const mid='semantic-mid';f.s.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)',mid,f.output,50,'W',JSON.stringify({finding:claim,launchId:'origin',role:'planner'}));f.s.run('INSERT INTO obligations VALUES(?,?,?)',mid,'W',JSON.stringify({kind:'finding',state:'pending'}));f.s.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)','old-eq',mid,'judge','equivalent',JSON.stringify({occurrenceId:mid,disposition:'equivalent',equivalentTo:f.synthetic.id}));f.s.run('UPDATE role_outputs SET raw=NULL WHERE id=?',f.output);assert.ok(f.core.diagnosisSubjectIds('W').has(f.synthetic.id));assert.throws(()=>f.core.diagnosisDecisionGuard('W',{decisions:[{occurrenceId:semantic,disposition:'equivalent',equivalentTo:mid}]}),/Synthetic diagnosis/);
 }finally{f.close();}
});

test('committed procedural evidence does not itself close an ordinary finding or replace code repair',async()=>{
 const procedural={...claim,description:'Earlier unusable producer still needs independent diagnosis before proceeding'};
 const f=await fixture(JSON.stringify({...common,findings:[procedural]})+'}');
 try {
  const rawBefore=f.s.one('SELECT * FROM role_outputs WHERE id=?',f.output),proofs=await f.core.prevalidateDiagnoses('W',f.judgment);
  f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs));
  const prior=f.s.all('SELECT * FROM finding_dispositions ORDER BY rowid'),committed=prior.find(d=>d.occurrence===f.synthetic.id);
  assert.ok(JSON.parse(committed.data).diagnosisWitness);
  const oldLaunch=f.s.one('SELECT * FROM role_launches WHERE id=?','judge');
  const oldRun=f.s.one('SELECT * FROM runs WHERE id=?','judgeRun');
  f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','later-run','W',1,1,'SETTLED','fixture-only','consumed',oldRun.data);
  f.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','later-judge','W','later-run','adjudicator',1,'COMPLETE','none',oldLaunch.data);
  const ordinary=f.material[0].id,decision={occurrenceId:ordinary,disposition:'upheld',reason:'The historical absence is accurate; an independent diagnosis is now recorded',witnesses:[committed.id]};
  f.s.tx(()=>f.core.dispositions('W','later-judge',{...common,decisions:[decision]}));
  assert.equal(f.core.pending('W').find(o=>o.id===ordinary).state,'pending');
  assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','later-judge',{...common,decisions:[{...decision,resolution:'repaired'}]})),/BASE|Repair|changed|carry/);
  // Independent current-relevance judgment is fallible. This tests retention and
  // existing disposition semantics, not host certification of the prose's truth.
  f.s.tx(()=>f.core.dispositions('W','later-judge',{...common,decisions:[{...decision,disposition:'rejected'}]}));
  assert.ok(!f.core.pending('W').some(o=>o.id===ordinary));
  assert.deepEqual(f.s.all('SELECT * FROM finding_dispositions ORDER BY rowid').slice(0,prior.length),prior);
  assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.output),rawBefore);
 } finally { f.close(); }
});

function rejectSynthetic(f) {
 const old=f.protocol.decisions.find(d=>d.occurrenceId===f.synthetic.id);
 f.protocol={...f.protocol,decisions:f.protocol.decisions.map(d=>d===old?{occurrenceId:d.occurrenceId,disposition:'rejected',reason:'Independent exact raw assessment rejects this procedural concern',witnesses:['actual supplied raw operand']}:d)};f.bind();
}
for(const mode of ['absent-receipt','missing-sibling','captured-source-loss'])test('synthetic rejection requires actual raw assessment: '+mode,async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{
  rejectSynthetic(f);
  if(mode==='absent-receipt'){const ld=JSON.parse(f.s.one('SELECT data FROM role_launches WHERE id=?','judge').data);delete ld.producerDiagnosticInput;f.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),'judge');}
  if(mode==='missing-sibling'){f.protocol.decisions=f.protocol.decisions.filter(d=>d.occurrenceId===f.synthetic.id);f.bind();}
  if(mode==='captured-source-loss'){const ld=JSON.parse(f.s.one('SELECT data FROM role_launches WHERE id=?','judge').data);ld.decisionReferences=f.core.adjudicationReferences('W',f.s.all('SELECT * FROM finding_occurrences WHERE work=?','W').map(r=>({...r,data:JSON.parse(r.data)})));f.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),'judge');f.s.run('UPDATE role_outputs SET raw=NULL WHERE id=?',f.output);}
  const before=f.s.all('SELECT * FROM obligations ORDER BY id');await assert.rejects(f.core.prevalidateDiagnoses('W',f.judgment));assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);assert.deepEqual(f.s.all('SELECT * FROM obligations ORDER BY id'),before);
 }finally{f.close();}
});
test('synthetic rejection cannot commit without prevalidated raw assessment',async()=>{
 const f=await fixture();try{rejectSynthetic(f);const before=f.s.all('SELECT * FROM obligations');assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','judge',f.protocol)),/assessment|prevalidat/i);assert.deepEqual(f.s.all('SELECT * FROM obligations'),before);assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);}finally{f.close();}
});
test('proven synthetic rejection preserves its verdict and synthetic identity after source damage',async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{
  rejectSynthetic(f);const raw=f.s.one('SELECT * FROM role_outputs WHERE id=?',f.output),proofs=await f.core.prevalidateDiagnoses('W',f.judgment);assert.equal(proofs.size,1);f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs));const row=f.s.one('SELECT * FROM finding_dispositions WHERE occurrence=?',f.synthetic.id),data=JSON.parse(row.data),duty=JSON.parse(f.s.one('SELECT data FROM obligations WHERE id=?',f.synthetic.id).data);assert.equal(row.status,'rejected');assert.equal(data.resolution,undefined);assert.equal(data.diagnosisWitness.assessment,'rejected-raw-assessment/v1');assert.equal(duty.resolution,undefined);assert.equal(duty.state,'resolved');assert.deepEqual(f.s.one('SELECT * FROM role_outputs WHERE id=?',f.output),raw);assert.ok(f.core.pending('W').some(o=>o.id===f.material[0].id));
  f.s.run('UPDATE role_outputs SET raw=NULL WHERE id=?',f.output);assert.ok(f.core.diagnosisSubjectIds('W').has(f.synthetic.id));assert.throws(()=>f.core.diagnosisDecisionGuard('W',{decisions:[{occurrenceId:f.synthetic.id,disposition:'upheld',resolution:'repaired'}]}),/Synthetic/);assert.throws(()=>f.core.diagnosisDecisionGuard('W',{decisions:[{occurrenceId:f.material[0].id,disposition:'equivalent',equivalentTo:f.synthetic.id}]}),/Synthetic/);
 }finally{f.close();}
});

for(const drift of ['source-during-read','source-after-proof','judge','subject','kind'])test('synthetic rejection proof remains bound through commit: '+drift,async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{
  rejectSynthetic(f);
  if(drift==='source-during-read'){const read=f.core.nativeEntries;f.core.nativeEntries=async id=>{const entries=await read(id);if(id==='originRun')f.s.run('UPDATE role_outputs SET raw=raw || ? WHERE id=?',' ',f.output);return entries;};await assert.rejects(f.core.prevalidateDiagnoses('W',f.judgment));return;}
  const proofs=await f.core.prevalidateDiagnoses('W',f.judgment),proof=proofs.get(f.synthetic.id);
  if(drift==='source-after-proof')f.s.run('UPDATE role_outputs SET raw=raw || ? WHERE id=?',' ',f.output);
  if(drift==='judge')proof.judgeLaunchId='foreign';
  if(drift==='subject')proof.origin.occurrenceId='foreign';
  if(drift==='kind')delete proof.assessment;
  const before=f.s.all('SELECT * FROM obligations ORDER BY id');assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs)));assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);assert.deepEqual(f.s.all('SELECT * FROM obligations ORDER BY id'),before);
 }finally{f.close();}
});

for(const scope of ['exact','origin-launch','unknown','duplicate'])test('exact assessment disposition scope preserves outside duties: '+scope,async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim]})+'}');try{
  const id=f.material[0].id,protocol={...common,decisions:[{occurrenceId:id,disposition:'rejected',reason:'Independently scoped ordinary finding assessment',witnesses:['actual supplied raw']}]},outside=f.s.one('SELECT * FROM obligations WHERE id=?',f.synthetic.id),before=f.s.all('SELECT * FROM obligations ORDER BY id');
  if(scope==='exact'){f.s.tx(()=>f.core.dispositions('W','judge',protocol,{occurrenceIds:[id]}));assert.deepEqual(f.s.one('SELECT * FROM obligations WHERE id=?',f.synthetic.id),outside);assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,1);assert.equal(JSON.parse(f.s.one('SELECT data FROM obligations WHERE id=?',id).data).state,'resolved');}
  else{const selected=scope==='origin-launch'?['origin']:{occurrenceIds:scope==='duplicate'?[id,id]:['foreign']};assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','judge',protocol,selected)));assert.deepEqual(f.s.all('SELECT * FROM obligations ORDER BY id'),before);assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);}
 }finally{f.close();}
});

// Seed malformed retained rows only for this direct guard control; the public
// SDK/planning fixture separately proves genuine ordinary adoption and rollback.
for(const damage of ['missing','malformed','cycle'])test('empty ordinary equivalence preserves '+damage+' refusal',async()=>{
 const f=await fixture(JSON.stringify({...common,findings:[claim,claim]})+'}');try{
  assert.equal(f.material.length,2);const [root,member]=f.material;
  f.protocol.decisions=[{occurrenceId:root.id,disposition:'upheld',reason:'Independent pending BASE claim',witnesses:[]},{occurrenceId:member.id,disposition:'equivalent',equivalentTo:root.id,reason:'Same independently assessed pending condition',witnesses:[]}];
  if(damage==='cycle'){f.protocol.decisions[0].disposition='equivalent';f.protocol.decisions[0].equivalentTo=member.id;}
  else{const data=JSON.parse(member.data);if(damage==='missing')delete data.finding;else data.finding={...data.finding,description:' '};f.s.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify(data),member.id);}
  const obligations=f.s.all('SELECT * FROM obligations ORDER BY id'),rows=f.s.all('SELECT * FROM finding_dispositions');
  assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,{occurrenceIds:f.material.map(o=>o.id)})),damage==='cycle'?/equivalence cycle/:/retained ordinary finding/);
  assert.deepEqual(f.s.all('SELECT * FROM obligations ORDER BY id'),obligations);assert.deepEqual(f.s.all('SELECT * FROM finding_dispositions'),rows);
 }finally{f.close();}
});
test('legacy diagnosis eligibility still requires the original free-text witness',async()=>{
 const f=await fixture();try{
  const captured=JSON.parse(f.s.one('SELECT data FROM role_launches WHERE id=?','judge').data);
  f.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...captured,diagnosisEligibility:{version:1}}),'judge');
  f.protocol.decisions.at(-1).witnesses=[];f.bind();const proofs=await f.core.prevalidateDiagnoses('W',f.judgment),before=f.s.all('SELECT * FROM obligations ORDER BY id');
  assert.throws(()=>f.s.tx(()=>f.core.dispositions('W','judge',f.protocol,undefined,undefined,proofs)),/Disposition needs retained reason\/witness/);
  assert.deepEqual(f.s.all('SELECT * FROM obligations ORDER BY id'),before);assert.equal(f.s.all('SELECT * FROM finding_dispositions').length,0);
 }finally{f.close();}
});
