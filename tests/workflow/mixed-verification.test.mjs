import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runInNewContext} from 'node:vm';
import Ajv2020 from 'ajv/dist/2020.js';
import {parseRoleOutput,parseCheckOutput,assertApprovedProposal} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {writeFixtureVerificationDomain} from './current-verification-fixture.mjs';
import {verificationReviewRequirements,requirementSourceIds} from '../../dist/workflow/role-input.js';
import {verificationCommandContract,verificationReportExample,buildCaseDescriptor,buildAssertionRoster} from '../../dist/workflow/verification-contract.js';
import {consumerControlInputConflict} from '../../dist/workflow/verification-strategy.js';
import {coverageIssue,compareCases,checkOutputDiagnosis} from '../../dist/controller/check-cases.js';
import {common,mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
const parsed=plan=>parseRoleOutput(JSON.stringify({...common,plan}),'planner');
test('control substitution keeps fixed inputs but allows the runtime to load the consumer',()=>{
 const plan=mixedPlan(), [check, other]=plan.verification.checks, path='consumer.cjs', replacementPath='alternate.cjs';
 check.consumerControl={path, replacementPath, failedAssertions:[], observations:[]};
 check.fixturePaths=[path];
 assert.equal(consumerControlInputConflict(plan),undefined);
 other.expectationPaths=[path];
 other.cases[0].input.fixturePaths=[path];
 assert.match(consumerControlInputConflict(plan),/consumer\.cjs.*expectationPaths and case\.input\.fixturePaths/);
 other.expectationPaths=[];
 other.cases[0].input.fixturePaths=[];
 other.fixturePaths.push(replacementPath);
 other.cases[0].consumerPaths.push(replacementPath);
 assert.match(consumerControlInputConflict(plan),/alternate\.cjs.*check\.fixturePaths, case\.consumerPaths/);
 check.consumerControl.replacementPath=path;
 assert.match(consumerControlInputConflict(plan),/distinct consumer and BASE replacement paths/);
});
test('closed exhaustive mixed strategies preserve behavior cases and never fall back to legacy on present invalid declarations',()=>{
 const plan=mixedPlan();assert.ok(parsed(plan).value);assert.equal(coverageIssue(plan),null);
 for(const mutate of [p=>p.verification.strategies=null,p=>p.verification.strategies.push(p.verification.strategies[0]),p=>p.verification.strategies[1].kind='qualitative-waiver',p=>delete p.verification.strategies[1].caseIds,p=>p.verification.strategies[2].authorApproved=true]){const p=structuredClone(plan);mutate(p);assert.equal(parsed(p).value,null,JSON.stringify(p.verification.strategies));}
 const undefinedValue=mixedPlan();undefinedValue.verification.strategies=undefined;assert.match(coverageIssue(undefinedValue),/every requirement/);
 const legacy=mixedPlan();delete legacy.verification.strategies;assert.match(coverageIssue(legacy),/baseline lacks healthy/);
 for(const mutate of [p=>p.verification.strategies[0].checkIds=['base-check'],p=>p.verification.checks[0].cases.pop(),p=>p.verification.strategies[1].caseIds=['invented'],p=>p.verification.strategies[1].reviewKey='missing',p=>p.verification.strategies[2].unchangedPaths.push('consumer.cjs')]){const p=mixedPlan();mutate(p);assert.notEqual(coverageIssue(p),null);}
});
test('current planning reports malformed strategy slots before suggesting incomplete-accounting recovery',()=>{
 for(const role of ['planner','adjudicator'])for(const blocking of [false,true]){
  const plan=mixedPlan();plan.verification.strategies[1].requirementId='behavior';
  const findings=blocking?[{requirementId:'behavior',severity:'blocking',repair:'substantive',description:'Unsupported proposal remains pending',evidence:[]}]:[];
  const output={...common,findings,...(role==='planner'?{plan}:{acceptedPlan:plan,planAccepted:true,decisions:[]})};
  const result=parseRoleOutput(JSON.stringify(output),role,[],{planningProfile:initialVerificationProfile});
  assert.equal(result.value,null);assert.match(result.issues.join(),/verification\.strategies\[1\]\.requirementId repeats/);
  assert.doesNotMatch(result.issues.join(),/need a retained blocking finding/);
 }
});
test('producer schema and strict parser share required per-kind operands and exact retained source identities',()=>{
 const schema=roleOutputSchema('planner','planning',[],{sourceIds:['actual-owner','owner-request']});assert.deepEqual(schema.properties.plan.properties.requirements.items.properties.source.enum,['actual-owner','owner-request']);
 const branches=schema.properties.plan.properties.verification.properties.strategies.items.anyOf;
 assert.deepEqual(branches.find(x=>x.properties.kind.const==='base-execution-duty').required,['requirementId','kind','checkId','caseIds','reviewKey']);assert.deepEqual(branches.find(x=>x.properties.kind.const==='manifest-scope-duty').required,['requirementId','kind','allowedChangePaths','unchangedPaths','reviewKey']);
 const p=mixedPlan();p.requirements[0].source='owner-request; base:file';assert.equal(parseRoleOutput(JSON.stringify({...common,plan:p}),'planner',[],{sourceIds:['owner-request']}).value,null);
 assert.throws(()=>requirementSourceIds({requirementSourceIds:null}),/unavailable/);assert.deepEqual(requirementSourceIds({requirementSourceIds:['owner-request']}),['owner-request']);
});
test('different strategy kinds cannot repeat a requirement and unknown references identify their exact slot',()=>{
 const plan=mixedPlan(),duplicate=structuredClone(plan);
 duplicate.verification.strategies[1].requirementId='behavior';
 const result=parsed(duplicate);
 assert.equal(result.value,null);assert.match(result.issues.join(),/verification\.strategies\[1\]\.requirementId repeats/);
 const unknown=structuredClone(plan);unknown.verification.strategies[0].requirementId='foreign-'.repeat(1000);
 const rejected=parsed(unknown);assert.equal(rejected.value,null);
 assert.match(rejected.issues.join(),/verification\.strategies\[0\]\.requirementId is not declared/);
 assert.ok(!rejected.issues.join().includes('foreign-'));
 const shared=mixedPlan();shared.verification.strategies[0].checkIds.push('second-candidate-check');
 shared.verification.checks.push({...structuredClone(shared.verification.checks[0]),id:'second-candidate-check',cases:shared.verification.checks[0].cases.map(c=>({...c,id:'second-'+c.id}))});
 assert.ok(parsed(shared).value);assert.equal(coverageIssue(shared),null,'One consumer strategy may use several actual checks');
 const multi=mixedPlan();multi.requirements[0].text='Valid requests return incremented value';
 multi.requirements.push({id:'invalid-behavior',text:'Invalid requests are rejected',source:'owner-request'});
 multi.verification.strategies.push({kind:'consumer-cases',requirementId:'invalid-behavior',checkIds:['behavior-check']});
 multi.verification.checks[0].guaranteeIds.push('invalid-behavior');
 for(const item of multi.verification.checks[0].cases)item.guaranteeIds.push('invalid-behavior');
 assert.ok(parsed(multi).value);assert.equal(coverageIssue(multi),null,'One check and its cases may reference several actual requirements; semantic adequacy still needs review');
 const roleNamedKey=mixedPlan();roleNamedKey.verification.reviewRoles[0].key='reviewer';
 for(const strategy of roleNamedKey.verification.strategies)if('reviewKey' in strategy)strategy.reviewKey='reviewer';
 assert.ok(parsed(roleNamedKey).value);assert.equal(coverageIssue(roleNamedKey),null,'A declared key may equal its role kind');
});
test('advertised strategy capabilities do not require unused kinds or invented duties',()=>{
 const constraints={planningProfile:initialVerificationProfile};
 const behaviorOnly=mixedPlan();behaviorOnly.requirements=behaviorOnly.requirements.filter(r=>r.id==='behavior');behaviorOnly.verification.strategies=behaviorOnly.verification.strategies.filter(s=>s.kind==='consumer-cases');behaviorOnly.verification.checks=behaviorOnly.verification.checks.filter(c=>c.id==='behavior-check');
 assert.ok(parseRoleOutput(JSON.stringify({...common,plan:behaviorOnly}),'planner',[],constraints).value);
 assert.equal(coverageIssue(behaviorOnly),null,'Advertised baseline/scope kinds do not create additional duties');
});
test('context-required independent fit decisions bind exact strategy/witnesses without choosing a semantic verdict',()=>{
 const fit=[{requirementId:'scope',strategyDigest:'a'.repeat(64),witnessIds:['actual-scope-record']}];
 const context={stage:'fresh-review',verificationReviewRequirements:fit};assert.deepEqual(verificationReviewRequirements('reviewer',context),fit);assert.throws(()=>verificationReviewRequirements('reviewer',{...context,verificationReviewRequirements:null}),/unavailable/);
 const schema=roleOutputSchema('reviewer','fresh-review',[],{verificationFit:fit});assert.ok(schema.required.includes('verificationDecisions'));assert.equal(schema.properties.verificationDecisions.minItems,1);assert.deepEqual(schema.properties.verificationDecisions.items.anyOf[0].properties.witnessIds.items.enum,['actual-scope-record']);
 const decision={...fit[0],verdict:'satisfied',reason:'Independently checked the actual complete comparison against owner intent'};assert.ok(parseRoleOutput(JSON.stringify({...common,verificationDecisions:[decision]}),'reviewer',[],{verificationFit:fit}).value);
 for(const output of [common,{...common,verificationDecisions:[]},{...common,verificationDecisions:[{...decision,witnessIds:['forged']}]},{...common,verificationDecisions:[{...decision,strategyDigest:'b'.repeat(64)}]}])assert.equal(parseRoleOutput(JSON.stringify(output),'reviewer',[],{verificationFit:fit}).value,null);
 assert.ok(parseRoleOutput(JSON.stringify({...common,verificationDecisions:[{...decision,verdict:'unavailable',witnessIds:[],reason:'Source evidence incomplete'}]}),'reviewer',[],{verificationFit:fit}).value);
 const complete={...decision,witnessIds:['actual-scope-record','current-review']};
 const adjudicate=row=>parseRoleOutput(JSON.stringify({...common,decisions:[],verificationDecisions:[row]}),'adjudicator',[],{verificationFit:[{...fit[0],witnessIds:complete.witnessIds}]});
 const incomplete=adjudicate(decision);
 assert.equal(incomplete.value,null);
 assert.match(incomplete.issues.join(),/expected 2, received 1.*context\.verificationReviewRequirements\[0\]\.witnessIds/);
 assert.ok(adjudicate(complete).value);
});
test('the owned checker detects input mutation even when the expected rejection is unchanged',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-mixed-contract-')));let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained '+root)});
 const check=mixedPlan().verification.checks[0];
 check.assertions.push('input-unchanged');
 for(const row of check.cases) {
  row.input.literalUtf8=JSON.stringify({prior:{value:1},value:JSON.parse(row.input.literalUtf8)});
 }
 const program=`
 const fs = require('node:fs');
 const consume = require('./consumer.cjs');
 const descriptor = JSON.parse(fs.readFileSync('descriptor.json', 'utf8'));
 const roster = JSON.parse(fs.readFileSync('assertions.json', 'utf8'));
 let inputUnchanged = true;
 let outcomesMatch = true;
 const cases = descriptor.cases.map(({declaration, id, inputDigest}) => {
  const input = JSON.parse(declaration.input.literalUtf8);
  const before = JSON.stringify(input);
  let observed;
  try {
   observed = {kind:'return', value:String(consume(input))};
  } catch (error) {
   observed = {kind:'rejection', value:error.constructor.name};
  }
  inputUnchanged = JSON.stringify(input) === before && inputUnchanged;
  outcomesMatch = observed.kind === declaration.expected.kind &&
    observed.value === declaration.expected.value && outcomesMatch;
  return {id, inputDigest, observed};
 });
 const evaluated = {'actual-consumer':outcomesMatch, 'input-unchanged':inputUnchanged};
 const assertions = roster.assertionIds.map(id => ({id, passed:evaluated[id]}));
 console.log(JSON.stringify({version:1, assertions, cases}));
 `;
 async function run(variant, mutation) {
  const consumer=`module.exports=input=>{
   if(typeof input.value!=='number') {
    ${mutation}
    throw new TypeError('invalid');
   }
   return input.value+1;
  };\n`;
  await fs.writeFile(path.join(root,'consumer.cjs'),consumer);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const file={path:'consumer.cjs',sha256:hash(consumer)};
  const candidateDigest=hash(JSON.stringify({files:[{...file,executable:0}],directories:[]}));
  const descriptor=buildCaseDescriptor(check,{hash:candidateDigest,data:{manifest:{files:[{...file,effectiveMode:0o600}]}}},
   {base:'B',candidate:variant,verification:'V'},variant);
  await fs.writeFile(path.join(root,'descriptor.json'),JSON.stringify(descriptor));
  await fs.writeFile(path.join(root,'assertions.json'),JSON.stringify(buildAssertionRoster(check,descriptor)));
  const {stdout}=await promisify(execFile)(process.execPath,['-e',program],{cwd:root});
  const output=parseCheckOutput(stdout);
  assert.ok(output.value,output.issues.join());
  assert.equal(checkOutputDiagnosis(check,descriptor,output.value).complete,true);
  assert.deepEqual(compareCases(check,descriptor,output.value).mismatches,[]);
  return output.value;
 }
 const clean=await run('clean','');
 const mutant=await run('mutant','input.prior.value = 9;');
 assert.deepEqual(clean.cases.map(row=>row.observed),mutant.cases.map(row=>row.observed));
 assert.deepEqual(mutant.cases[1].observed,{kind:'rejection',value:'TypeError'});
 assert.deepEqual(clean.assertions,[{id:'actual-consumer',passed:true},{id:'input-unchanged',passed:true}]);
 assert.deepEqual(mutant.assertions,[{id:'actual-consumer',passed:true},{id:'input-unchanged',passed:false}]);
 assert.equal(parseCheckOutput(JSON.stringify({...clean,acceptanceSha256:'not-admitted'})).value,null);
 const bad=structuredClone(clean);bad.cases[0].passed=true;
 assert.equal(parseCheckOutput(JSON.stringify(bad)).value,null);
 passed=true;
});

test('descriptor captures declarations and tuple bytes before later caller mutation',()=>{
 const check=mixedPlan().verification.checks[0],versions={candidate:'original-C',verification:'original-V'};const descriptor=buildCaseDescriptor(check,{hash:'original-hash',data:{manifest:{files:[{path:'consumer.cjs',sha256:'a'.repeat(64),effectiveMode:0o600}]}}},versions,'original-run');const expected=JSON.stringify(descriptor);check.cases[0].input.literalUtf8='forged';versions.candidate='foreign-C';assert.equal(JSON.stringify(descriptor),expected);assert.equal(Object.isFrozen(verificationCommandContract.descriptor.caseFields),true);
});
test('the displayed example preserves case bindings and rejects absent assertion implementations', () => {
 const check = mixedPlan().verification.checks[0];
 const target = {hash:'candidate-digest',data:{manifest:{files:[{path:'consumer.cjs',sha256:'a'.repeat(64),effectiveMode:0o600}]}}};
 const descriptor = buildCaseDescriptor(check, target, {candidate:'C',verification:'V'}, 'run');
 const files = new Map([
  [verificationCommandContract.descriptorPath, JSON.stringify(descriptor)],
  [verificationCommandContract.assertionRosterPath, JSON.stringify(buildAssertionRoster(check, descriptor))]
 ]);
 const output = [];
 const report = runInNewContext(verificationReportExample + '\nreport', {
  require(name) {
   assert.equal(name, 'node:fs');
   return {readFileSync: file => files.get(file)};
  },
  console: {log: text => output.push(text)}
 });
 const observe = (literalUtf8, fixturePaths) => {
  assert.equal(typeof literalUtf8,'string');
  assert.equal(fixturePaths.length,0);
  return {kind:'return',value:'wrong:' + literalUtf8};
 };
 assert.throws(() => report(observe, new Map()), /Missing assertion implementation: actual-consumer/);
 assert.deepEqual(output, []);
 report(observe, new Map([['actual-consumer', () => false]]));
 const decoded = parseCheckOutput(output[0]);
 assert.deepEqual(decoded.issues, []);
 assert.deepEqual(decoded.value.assertions, [{id:'actual-consumer',passed:false}]);
 assert.equal(checkOutputDiagnosis(check, descriptor, decoded.value).complete, true);
 assert.equal(compareCases(check, descriptor, decoded.value).mismatches.length, descriptor.cases.length);
});

test('the assertion roster binds the exact check without changing original case descriptor bytes',()=>{
 const check=mixedPlan().verification.checks[0], versions={candidate:'C',verification:'V'};
 const target={hash:'candidate-digest',data:{manifest:{files:[{path:'consumer.cjs',sha256:'a'.repeat(64),effectiveMode:0o600}]}}};
 const descriptor=buildCaseDescriptor(check,target,versions,'run');
 const original=JSON.stringify(descriptor),roster=buildAssertionRoster(check,descriptor);
 assert.equal(JSON.stringify(descriptor),original);
 const {runId,candidateDigest,boundVersions,checkBinding}=descriptor;
 assert.deepEqual(roster,{version:1,runId,candidateDigest,boundVersions,checkBinding,
  caseDescriptorHash:createHash('sha256').update(original).digest('hex'),assertionIds:check.assertions});
 assert.throws(()=>buildAssertionRoster({...check,assertions:descriptor.cases.map(row=>row.id)},descriptor),/check binding/);
 const report={version:1,cases:descriptor.cases.map(row=>({id:row.id,inputDigest:row.inputDigest,observed:row.declaration.expected})),
  assertions:descriptor.cases.map(row=>({id:row.id,passed:true}))};
 assert.deepEqual(compareCases(check,descriptor,report).mismatches,[]);
 assert.deepEqual(checkOutputDiagnosis(check,descriptor,report).counts,{'assertion-roster-size':1,'assertion-missing':1,'assertion-unexpected':2});
 check.assertions.push('later');versions.candidate='later';
 assert.deepEqual(roster.assertionIds,['actual-consumer']);assert.equal(roster.boundVersions.candidate,'C');
});

test('current supported planning requires accounting on acceptance and preserves a valid unavailable proposal/negative decision',()=>{
 const constraints={planningProfile:initialVerificationProfile},plan=mixedPlan();const planner=roleOutputSchema('planner','planning',[],constraints);assert.ok(planner.properties.plan.properties.verification.required.includes('strategies'));
 const judge=roleOutputSchema('adjudicator','planning-adjudication',[],constraints);assert.ok(judge.then.required.includes('acceptedPlan'));assert.equal(judge.required.includes('acceptedPlan'),false);
 const missing=structuredClone(plan);delete missing.verification.strategies;assert.equal(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner',[],constraints).value,null);assert.ok(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner').value,'Historical three-argument structural parsing does not migrate old plans');
 const incomplete=structuredClone(plan);incomplete.verification.strategies=[];const finding={requirementId:'baseline',severity:'blocking',repair:'unknown',description:'This necessary oracle cannot be represented by the supported finite profile',evidence:['Actual retained owner source and bounded profile']};assert.ok(parseRoleOutput(JSON.stringify({...common,findings:[finding],plan:incomplete}),'planner',[],constraints).value);assert.notEqual(coverageIssue(incomplete),null);assert.equal(parseRoleOutput(JSON.stringify({...common,decisions:[],planAccepted:true,acceptedPlan:incomplete}),'adjudicator',[],constraints).value,null);assert.ok(parseRoleOutput(JSON.stringify({...common,findings:[finding],decisions:[],planAccepted:false}),'adjudicator',[],constraints).value);
 const unavailable={planningProfile:{version:1,supported:false,allowedKinds:[],baseline:{newObservation:false,crossPlanReuse:false,priorDuty:false},reason:'Inherited original editing history unavailable'}};assert.equal(roleOutputSchema('planner','planning',[],unavailable).properties.plan.properties.verification.properties.strategies,undefined);assert.equal(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],unavailable).value,null);assert.ok(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner',[],unavailable).value);
});

test('persistent typed replanning advertises only current consumer/scope kinds and cannot manufacture a later baseline event',()=>{
 const profile={version:1,supported:true,allowedKinds:['consumer-cases','manifest-scope-duty'],baseline:{newObservation:false,crossPlanReuse:false,priorDuty:false}},constraints={planningProfile:profile};
 const schema=roleOutputSchema('planner','planning',[],constraints),kinds=schema.properties.plan.properties.verification.properties.strategies.items.anyOf.map(branch=>branch.properties.kind.const);assert.deepEqual(kinds,profile.allowedKinds);
 const plan=mixedPlan();assert.equal(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],constraints).value,null);plan.requirements=plan.requirements.filter(r=>r.id!=='baseline');plan.verification.strategies=plan.verification.strategies.filter(r=>r.kind!=='base-execution-duty');plan.verification.checks=plan.verification.checks.filter(r=>r.id!=='base-check');assert.ok(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],constraints).value);
 const historicalDuty={planningProfile:{...profile,baseline:{...profile.baseline,priorDuty:true}}};const judge=roleOutputSchema('adjudicator','planning-adjudication',[],historicalDuty);assert.equal(judge.properties.planAccepted.const,false);assert.equal(parseRoleOutput(JSON.stringify({...common,decisions:[],planAccepted:true,acceptedPlan:plan}),'adjudicator',[],historicalDuty).value,null);assert.ok(parseRoleOutput(JSON.stringify({...common,decisions:[],planAccepted:false}),'adjudicator',[],historicalDuty).value);
});


test('the actual second-cycle controlled producer retains matching strategy references when renaming a check',async()=>{
 const {cycleModel}=await import('../controller/repeated-merge-fixture.mjs'),model=cycleModel(4),body={requiredScope:[],context:{stage:'planning',ownerSource:'owner-request',planningVerificationProfile:initialVerificationProfile}},context={messages:[{role:'user',content:[{type:'text',text:'Perform the assigned planner task\n'+JSON.stringify(body)}]}]};
 const message=await model.definition.streamSimple({api:'owned-fixture',provider:'owned-fixture',id:'owned-fixture'},context).result(),output=parseRoleOutput(message.content.find(part=>part.type==='text').text,'planner',[],{planningProfile:initialVerificationProfile});assert.ok(output.value,output.issues.join());const plan=output.value.plan;assert.deepEqual(plan.verification.checks.map(check=>check.id),['value4']);assert.deepEqual(plan.verification.strategies,[{requirementId:'R1',kind:'consumer-cases',checkIds:['value4']}]);assert.equal(coverageIssue(plan),null);
});


test('captured planning grammar4 requires explicit oracle inputs without changing grammars1–3',()=>{
 const profile={...initialVerificationProfile,version:4};
 const missing=mixedPlan();delete missing.verification.checks[0].expectationPaths;
 for(const version of [1,2,3])assert.ok(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner',[],{planningProfile:{...profile,version}}).value);
 assert.equal(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner',[],{planningProfile:profile}).value,null);
 assert.equal(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner',[],{strategyGrammarVersion:4}).value,null,'Historical structural decode preserves its original captured grammar');
 const schema=roleOutputSchema('planner','planning',[],{planningProfile:profile});
 const check=schema.properties.plan.properties.verification.properties.checks.items;
 assert.ok(check.required.includes('expectationPaths'));
 assert.match(check.properties.expectationPaths.description,/oracle/);
 for(const paths of [[],['check.cjs']]){const plan=mixedPlan();plan.verification.checks[0].expectationPaths=paths;assert.ok(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],{planningProfile:profile}).value);}
 for(const paths of [null,['check.cjs','check.cjs'],['../outside'],['/work/check.cjs']]){const plan=mixedPlan();plan.verification.checks[0].expectationPaths=paths;assert.equal(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],{planningProfile:profile}).value,null);}
 const approved={version:1,plannerOutputId:'original-planner',proposalHash:'a'.repeat(64),plannerOutputHash:'b'.repeat(64),proposal:missing};
 assert.throws(()=>assertApprovedProposal(approved,{planningProfile:profile}));
 approved.proposal=mixedPlan();assert.doesNotThrow(()=>assertApprovedProposal(approved,{planningProfile:profile}));
 const base=mixedPlan();base.verification.checks[1].baselineExpectedFailures=['concrete-subject-defect'];
 assert.ok(parseRoleOutput(JSON.stringify({...common,plan:base}),'planner',[],{planningProfile:profile}).value,'Grammar4 preserves the captured3 BASE expectation semantics');
});


test('planning grammar5 requires explicit case declarations while preserving literal grammars1–4',()=>{
 const profile={...initialVerificationProfile,version:5};
 for(const role of ['planner','adjudicator']){
  const output=plan=>role==='planner'?{...common,plan}:{...common,decisions:[],planAccepted:true,acceptedPlan:plan};
  const missing=mixedPlan();delete missing.verification.checks[0].cases;
  for(const version of [1,2,3,4])assert.ok(parseRoleOutput(JSON.stringify(output(missing)),role,[],{planningProfile:{...profile,version}}).value,'Literal historical '+version);
  for(const constraints of [{planningProfile:profile},{strategyGrammarVersion:5}])assert.equal(parseRoleOutput(JSON.stringify(output(missing)),role,[],constraints).value,null);
  const schema=roleOutputSchema(role,role==='planner'?'planning':'planning-adjudication',[],{planningProfile:profile});
  const check=(schema.properties.plan??schema.properties.acceptedPlan).properties.verification.properties.checks.items;
  assert.ok(check.required.includes('cases'));assert.ok(check.required.includes('expectationPaths'));
  assert.equal(check.properties.cases.minItems,undefined,'No blanket two-case minimum');
  const plan=mixedPlan();assert.equal(plan.verification.checks[1].cases.length,1,'One real BASE observation remains supported');
  assert.ok(parseRoleOutput(JSON.stringify(output(plan)),role,[],{planningProfile:profile}).value);assert.equal(coverageIssue(plan),null);
  plan.verification.checks.push({...structuredClone(plan.verification.checks[0]),id:'auxiliary',cases:[]});
  assert.ok(parseRoleOutput(JSON.stringify(output(plan)),role,[],{planningProfile:profile}).value);assert.equal(coverageIssue(plan),null);
  plan.verification.checks[0].cases=[];
  assert.ok(parseRoleOutput(JSON.stringify(output(plan)),role,[],{planningProfile:profile}).value,'Shape does not invent semantic coverage');
  assert.match(coverageIssue(plan),/healthy/);
 }
});

test('production BASE expectation guidance agrees with original schema/parser capability through grammar6',()=>{
 for(let version=1;version<=6;version++){
  const profile={...initialVerificationProfile,version,allowedKinds:[...initialVerificationProfile.allowedKinds,...(version>=2?['all-of']:[])]};
  const plan=mixedPlan();plan.verification.checks[1].baselineExpectedFailures=['concrete-subject-defect'];
  const bundle={requirements:[{id:'owner-request',text:'Observe the actual original BASE defect before editing.',source:'owner-request'}],contracts:'Preserve the original required BASE observation and candidate correctness.',sources:[],requiredScope:[],context:{stage:'planning',planningVerificationProfile:profile}};
  const frame=roleFraming('planner',bundle,true),schema=frame.schema.properties.plan.properties.verification.properties.checks.items;
  const encoded=writeFixtureVerificationDomain({...common,plan},bundle.context),parsed=parseRoleOutput(JSON.stringify(encoded),'planner',[],{planningProfile:profile});
  assert.equal(!!schema.properties.baselineExpectedFailures,version>=3,'The original captured grammar owns field availability');
  assert.equal(!!parsed.value,version>=3,parsed.issues.join());
  if(version>=3)assert.deepEqual(parsed.value.plan.verification.checks[1].baselineExpectedFailures,['concrete-subject-defect']);
  assert.match(frame.systemPrompt,/grammar3 or a supported later grammar may declare baselineExpectedFailures/);
  assert.match(verificationCommandContract.meaning,/grammar3 or a supported later grammar may name baselineExpectedFailures/);
  assert.ok(frame.systemPrompt.includes(verificationCommandContract.meaning),'The actual emitted owned-check contract uses the same permitted capture domain');
  assert.doesNotMatch(frame.systemPrompt,/Only captured planning grammar3 may declare|grammar3 alone may name/);
 }
});

for (const version of [1,6,7]) for (const role of ['planner','adjudicator']) test('incomplete strategy refusal names missing requirement in captured grammar '+version+' '+role,()=>{
 const plan=mixedPlan();plan.verification.strategies=plan.verification.strategies.filter(s=>s.requirementId!=='scope');
 const wire=structuredClone(plan);if(version>=6){wire.verificationRequirements=wire.requirements;delete wire.requirements;}
 const output={...common,...(role==='planner'?{plan:wire}:{decisions:[],planAccepted:true,acceptedPlan:wire})};
 const constraints={planningProfile:{...initialVerificationProfile,version}};
 const rejected=parseRoleOutput(JSON.stringify(output),role,[],constraints);
 assert.equal(rejected.value,null);const issue=rejected.issues.join();
 assert.match(issue,/Accepted strategy accounting incomplete/);
 assert.ok(issue.includes((role==='planner'?'plan':'acceptedPlan')+'.'+(version>=6?'verificationRequirements':'requirements')));
 assert.match(issue,/"value":"scope","omittedCodePoints":0/);
 assert.match(issue,/omittedRequirementIds=0/);
 assert.doesNotMatch(issue,/"value":"behavior"|"value":"baseline"/,'Only genuinely missing requirement IDs are named');
 output.findings=[{requirementId:'scope',severity:'blocking',repair:'unknown',description:'Necessary scope evidence unavailable',evidence:[]}];
 const unavailable=parseRoleOutput(JSON.stringify(output),role,[],constraints);
 assert.equal(unavailable.value!==null,role==='planner','Only planner may retain incomplete coverage with an explicit blocking finding');
 if(role==='adjudicator')assert.match(unavailable.issues.join(),/"value":"scope"/);
});
test('missing strategy diagnostics escape and bound IDs with honest omissions without altering raw output',()=>{
 const plan=mixedPlan();const ids=Array.from({length:10},(_,n)=>'missing-'+n+'\n\u001b\u2028\u202e'+('界😀'.repeat(90)));
 plan.requirements.push(...ids.map(id=>({id,text:'Actual additional owner requirement',source:'owner-request'})));
 const raw=JSON.stringify({...common,plan}),result=parseRoleOutput(raw,'planner',[],{planningProfile:initialVerificationProfile});
 assert.equal(result.value,null);const message=result.issues.join();
 assert.match(message,/omittedRequirementIds=2/);assert.match(message,/omittedCodePoints":[1-9]/);
 assert.ok(message.includes('missing-0\\n\\u001b'));assert.ok(!message.includes('missing-8'));
 assert.ok(!message.includes('\u001b'));assert.ok(!message.includes('\n'));assert.ok(!message.includes('\u2028'));assert.ok(!message.includes('\u202e'));assert.match(message,/previews, not complete IDs/);
 assert.ok(Buffer.byteLength(message)<6000);assert.equal(JSON.stringify({...common,plan}),raw);
});
test('bound proposal approval keeps canonical-source validation before response coverage diagnostics',()=>{
 const proposal=mixedPlan(),profile={...initialVerificationProfile,version:7};
 const approval=()=>({version:1,plannerOutputId:'original',proposalHash:createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),plannerOutputHash:'b'.repeat(64),proposal});
 const raw=JSON.stringify({...common,decisions:[],planAccepted:true});
 assert.ok(parseRoleOutput(raw,'adjudicator',[],{planningProfile:profile,proposalApproval:approval()}).value);
 proposal.verification.strategies.pop();
 const rejected=parseRoleOutput(raw,'adjudicator',[],{planningProfile:profile,proposalApproval:approval()});
 assert.equal(rejected.value,null);assert.match(rejected.issues.join(),/Bound proposal approval requires a complete current proposal/);
 assert.doesNotMatch(rejected.issues.join(),/acceptedPlan\./,'No acceptedPlan operand exists in this response');
});

test('only grammar 11 allows a consumer substitution to preserve every observation', () => {
 const plan = mixedPlan(), check = plan.verification.checks[0];
 check.consumerControl = {path:'consumer.cjs', failedAssertions:[], observations:[]};
 const profiles = [10, 11].map(version => {
  const planningProfile = {...initialVerificationProfile, version};
  const bundle = {requirements:[], contracts:'', sources:[], requiredScope:[],
   context:{stage:'planning', planVersion:null, planningVerificationProfile:planningProfile}};
  const {schema, systemPrompt} = roleFraming('planner', bundle, true);
  assert.equal(systemPrompt.includes('the selected plan declares it in verification.checks[].consumerControl'), version === 11);
  return {planningProfile, validate:new Ajv2020({strict:false}).compile(schema)};
 });
 function assertAccepted(expected) {
  profiles.forEach(({planningProfile, validate}, index) => {
   const output = writeFixtureVerificationDomain({...common, plan}, {planningVerificationProfile:planningProfile});
   assert.equal(validate(output), expected[index], JSON.stringify(validate.errors));
   const parsed = parseRoleOutput(JSON.stringify(output), 'planner', [], {planningProfile});
   assert.equal(!!parsed.value, expected[index], parsed.issues.join());
  });
 }
 assertAccepted([false, true]);
 check.consumerControl.failedAssertions.push(check.assertions[0]);
 assertAccepted([false, false]);
 check.consumerControl.observations.push({id:check.cases[0].id, observed:{kind:'rejection', value:'wrong'}});
 assertAccepted([true, true]);
});

test('only the candidate amendment grammar accepts bounded replacement text for a fixture defect', () => {
 const plan = mixedPlan(), [check] = plan.verification.checks;
 const amendment = {obligationId:'O', failedCheckRunId:'F', basis:'fixture-defect', correctedCheckId:check.id,
  fixturePaths:[], caseIds:[check.cases[0].id], negativeAssertions:[check.assertions[0]], reason:'Repair the exact case expectation',
  negativeReplacement:{path:'consumer.cjs',text:'module.exports=2;\n'}};
 plan.verification.checkAmendments = [amendment];
 const parse = version => {
  const planningProfile = {...initialVerificationProfile, version};
  return parseRoleOutput(JSON.stringify(writeFixtureVerificationDomain({...common, plan}, {planningVerificationProfile:planningProfile})),
   'planner', [], {planningProfile});
 };
 const planningProfile = {...initialVerificationProfile, version:12};
 const input = writeFixtureVerificationDomain({...common, plan}, {planningVerificationProfile:planningProfile});
 const validate = new Ajv2020({strict:false}).compile(roleOutputSchema('planner','planning',[], {planningProfile}));
 assert.ok(validate(input), JSON.stringify(validate.errors));
 assert.ok(parse(12).value, parse(12).issues.join());
 assert.equal(parse(11).value,null);
 const original = amendment.negativeReplacement;
 for (const replacement of [{...original,path:'../consumer.cjs'},{...original,text:'t\0'},
  {...original,text:'한'.repeat(22_000)},{...original,extra:true}]) {
  amendment.negativeReplacement = replacement;
  assert.equal(parse(12).value,null);
 }
 amendment.negativeReplacement = original;
 amendment.basis = 'owner-requirement-revision';
 amendment.ownerInputId = 'owner';
 assert.match(parse(12).issues.join(),/only for a fixture defect/);
});
