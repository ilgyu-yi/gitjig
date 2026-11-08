import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {ownedInputPathSchemaPattern,isOwnedRelativeInputPath} from '../../dist/workflow/owned-input-path.js';
import {parseRoleOutput,parseCheckOutput} from '../../dist/workflow/protocol.js';
import {roleOutputSchema,roleShapes,protocolShapes} from '../../dist/workflow/role-output-shape.js';
export const common={version:1,summary:'Evidence',findings:[],assessedScope:[]};
export const declaredCase={id:'good',kind:'healthy',guaranteeIds:['R'],derivation:'Direct consumer observation',consumerPaths:['consumer.cjs'],input:{literalUtf8:'',fixturePaths:[]},expected:{kind:'return',value:''}};
export const plan={intent:'Preserve requirement',requirements:[{id:'R',text:'Owner requirement',source:'source'}],approach:'Inspect consumer',simplerAlternative:'Existing behavior',factualSources:[],ambiguities:[],verification:{checks:[{id:'C',guaranteeIds:['R'],command:'node check.cjs',assertions:['A'],timeoutMs:1,fixturePaths:['check.cjs','check.cjs'],cases:[declaredCase]}],requiredPaths:[],reviewRoles:[{key:'review',kind:'reviewer',purpose:'Independent evidence',requiredPaths:[]}]}};
const sha='a'.repeat(64);
export const adjudicator={...common,decisions:[{occurrenceId:'O',disposition:'equivalent',reason:'Same observed defect',witnesses:[],equivalentTo:'P'}],planAccepted:true,acceptedPlan:plan,ownerDecisionRequired:[],nitAuthorization:{beforeCandidate:'C',afterDigest:'D',deltaHash:'H',consumerCheckIds:['C']},inputDecisions:[{inputId:'I',directionRevision:1,impact:'explanation',reason:'Actual source',requirementIds:[]}],payloadDecision:{payloadHash:sha,sourceFingerprint:sha,verdict:'fit',reason:'Actual sealed payload'},checkResolutions:[{amendmentId:'A',disposition:'corrected-fixture',reason:'Observed checks',witnesses:['check']}],criteriaDecision:{sourceId:'S',fromContractsVersion:'V1',toContractsVersion:'V2',verdict:'adopt',reason:'Actual criteria'}};
export const healthy={planner:{...common,plan},challenger:{...common,alternatives:[]},adjudicator,implementer:{...common},reviewer:{...common},repairer:{...common},confirmer:{...common,confirmed:false,witnesses:[]}};
// Test-only structural reader for this fixed schema vocabulary; no production validation/coercion.
export function structural(shape,value){
 if(shape.const!==undefined&&value!==shape.const)return false;
 if(shape.enum&&!shape.enum.includes(value))return false;
 if(shape.type==='object')return !!value&&typeof value==='object'&&!Array.isArray(value)&&shape.required.every(k=>k in value)&&Object.keys(value).every(k=>k in shape.properties)&&Object.entries(value).every(([k,v])=>structural(shape.properties[k],v));
 if(shape.type==='array')return Array.isArray(value)&&value.length<=shape.maxItems&&value.every(v=>structural(shape.items,v));
 if(shape.type==='string')return typeof value==='string'&&(shape.minLength===undefined||[...value].length>=shape.minLength)&&(shape.maxLength===undefined||[...value].length<=shape.maxLength)&&(!shape.pattern||new RegExp(shape.pattern).test(value));
 if(shape.type==='integer')return Number.isInteger(value)&&(shape.minimum===undefined||value>=shape.minimum)&&(shape.maximum===undefined||value<=shape.maximum);
 return shape.type==='boolean'&&typeof value==='boolean';
}
export const differential=[];
function exercise(value,role='planner',expected=false){const raw=typeof value==='string'?value:JSON.stringify(value);const parsed=parseRoleOutput(raw,role);assert.equal(!!parsed.value,expected,raw.slice(0,180));differential.push({raw,role,expected});return parsed;}
test('all seven complete role shapes preserve accepted optional fields and omission semantics',()=>{
 for(const [role,value] of Object.entries(healthy)){exercise(value,role,true);assert.ok(structural(roleOutputSchema(role),value),role);}
 const finding={requirementId:'R',severity:'blocking',repair:'mechanical',description:'Exact edit',evidence:[],mechanicalPatch:{path:'consumer',oldText:'x',newText:''},reproduction:{toolCallId:'tool',command:'node check',assertions:['A'],expectationPaths:[]}};
 const v={...healthy.reviewer,outcome:'findings',findings:[finding],assessedScope:[{sourceId:'source',startLine:1,endLine:1}]};exercise(v,'reviewer',true);assert.ok(structural(roleOutputSchema('reviewer'),v));
 const p=structuredClone(plan);delete p.verification.checks[0].cases;p.verification.checkAmendments=[{obligationId:'O',failedCheckRunId:'F',basis:'owner-requirement-revision',correctedCheckId:'C',fixturePaths:[],negativeAssertions:[],caseIds:['good'],negativeCaseIds:['bad'],ownerInputId:'I',reason:'Owner revision'}];exercise({...common,plan:p},'planner',true);assert.ok(structural(roleOutputSchema('planner'),{...common,plan:p}));
 assert.ok(parseCheckOutput(JSON.stringify({version:1,assertions:[]})).value);
});
test('shape guidance and strict parser reject structural mistakes without repairing actual answers',()=>{
 for(const [role,value] of Object.entries(healthy))for(const key of roleShapes[role].required){const v=structuredClone(value);delete v[key];exercise(v,role);assert.equal(structural(roleOutputSchema(role),v),false);}
 for(const [role,value] of Object.entries(healthy)){exercise({...value,launchId:'invented'},role);exercise({...value,summary:null},role);}
 const missing=structuredClone(healthy.planner);delete missing.plan.verification.checks[0].cases[0].input.fixturePaths;exercise(missing);assert.equal(structural(roleOutputSchema('planner'),missing),false);
 const misplaced=structuredClone(healthy.planner);misplaced.plan.verification.cases=misplaced.plan.verification.checks[0].cases;delete misplaced.plan.verification.checks[0].cases;exercise(misplaced);assert.equal(structural(roleOutputSchema('planner'),misplaced),false);
 exercise('{"version":1,"version":1,"summary":"x","findings":[],"assessedScope":[]}','reviewer');
 exercise({version:1,assertions:[],cases:[]},'planner');
});
test('strict semantic residuals remain effective beyond structural guidance',()=>{
 const bad=[];const mutate=fn=>{const v=structuredClone(healthy.planner);fn(v);bad.push(v);};
 mutate(v=>v.plan.verification.checks[0].cases[0].consumerPaths=['../outside']);
 mutate(v=>v.plan.verification.checks[0].cases[0].consumerPaths=['/absolute']);
 mutate(v=>v.plan.verification.checks[0].cases[0].input.literalUtf8='é'.repeat(8193));
 mutate(v=>v.plan.verification.checks[0].cases[0].input.literalUtf8='\ud800');
 mutate(v=>v.plan.requirements.push(v.plan.requirements[0]));
 mutate(v=>v.plan.verification.checks[0].cases.push(v.plan.verification.checks[0].cases[0]));
 mutate(v=>v.assessedScope=[{sourceId:'S',startLine:2,endLine:1}]);
 mutate(v=>v.summary='   ');mutate(v=>v.plan.verification.checks[0].timeoutMs=0);
 mutate(v=>v.plan.verification.checks[0].cases=Array.from({length:65},(_,i)=>({...declaredCase,id:'c'+i})));
 for(const v of bad)exercise(v);
 exercise({...common,summary:'x'.repeat(131073)},'reviewer');
 exercise({...common,decisions:[{occurrenceId:'O',disposition:'rejected',reason:'x',witnesses:[],resolution:'repaired'}]},'adjudicator');
 exercise({...common,decisions:[{occurrenceId:'O',disposition:'equivalent',reason:'x',witnesses:[]}]},'adjudicator');
 exercise({...common,findings:[{requirementId:'R',severity:'blocking',repair:'substantive',description:'x',evidence:[],mechanicalPatch:{path:'a',oldText:'x',newText:''}}]},'reviewer');
});
test('canonical descriptors are deeply immutable and exported role schemas are independent copies',()=>{
 assert.ok(Object.isFrozen(protocolShapes.plan.properties.verification.properties.checks.items.properties));
 const first=roleOutputSchema('planner');first.required.length=0;first.properties.plan.properties.verification.properties.checks.items.properties.id.type='boolean';
 assert.equal(roleOutputSchema('planner').properties.plan.properties.verification.properties.checks.items.properties.id.type,'string');assert.ok(roleOutputSchema('planner').required.includes('plan'));exercise(healthy.planner,'planner',true);
});


test('fresh path schema and existing strict path guards preserve the current filename domain',()=>{
 const validate=new Ajv2020({strict:false,allErrors:true}).compile(roleOutputSchema('planner'));
 const paths=['check.cjs','src/mode.cjs','./mode.cjs','a//b','.github/check.yml','a b/한글.cjs','...','..\n','a/..\n','C:\\tmp\\file','C:/tmp/file','\\server\\share','/work/check.cjs','../file','a/../b','a\\..\\b','..','a/..','a\u0000b'];
 for(const value of paths){
  const expected=!path.isAbsolute(value)&&!value.split(/[\\/]/).includes('..')&&!value.includes('\u0000');
  assert.equal(isOwnedRelativeInputPath(value),expected,JSON.stringify(value));
  const body=structuredClone(healthy.planner);body.plan.verification.checks[0].cases[0].consumerPaths=[value];
  const schemaExpected=value.length>0&&!value.includes('\u0000')&&!value.startsWith('/')&&(path.sep!=='\\'||!value.startsWith('\\'));
  assert.equal(validate(body),schemaExpected,JSON.stringify({value,errors:validate.errors}));
  if(expected)assert.equal(validate(body),true,'Fresh guidance preserves accepted filenames');
  assert.equal(!!parseRoleOutput(JSON.stringify(body),'planner').value,expected,JSON.stringify(value));
 }
 const body=structuredClone(healthy.planner);body.plan.verification.checks[0].cases[0].consumerPaths=['/work/check.cjs'];
 assert.match(parseRoleOutput(JSON.stringify(body),'planner').issues.join(' '),/case\.consumerPaths\[0\]/);
 assert.ok(!parseRoleOutput(JSON.stringify(body),'planner').issues.join(' ').includes('/work/check.cjs'),'diagnostic identifies the slot without reflecting raw path');
 assert.equal(protocolShapes.verificationCase.properties.consumerPaths.items.pattern,ownedInputPathSchemaPattern);
 assert.ok(!/\(\?[!=<]|\\[1-9]/.test(ownedInputPathSchemaPattern),'Schema projection uses no unsupported lookaround or backreference');
});
test('fresh path guidance leaves commands/literals and historical broader path-list parsing intact',()=>{
 const body=structuredClone(healthy.planner),check=body.plan.verification.checks[0];
 check.command='node /work/check.cjs';check.cases[0].input.literalUtf8='/work/literal';check.cases[0].expected.value='/work/observation';
 const validate=new Ajv2020({strict:false}).compile(roleOutputSchema('planner'));assert.equal(validate(body),true);exercise(body,'planner',true);
 // These historical text-only lists intentionally retain their original runtime
 // parser semantics. New model guidance must not retroactively invalidate them.
 check.fixturePaths=['../legacy','../legacy'];body.plan.verification.requiredPaths=['/legacy/required'];body.plan.verification.reviewRoles[0].requiredPaths=['/legacy/reviewer'];
 assert.equal(validate(body),false);exercise(body,'planner',true);
 const parent=structuredClone(healthy.planner);parent.plan.verification.checks[0].cases[0].consumerPaths=['a/../b'];
 assert.equal(validate(parent),true);exercise(parent,'planner',false); // Parent topology remains a strict residual.
 const duplicate=structuredClone(healthy.planner);duplicate.plan.verification.checks[0].cases[0].consumerPaths=['consumer.cjs','consumer.cjs'];
 assert.equal(validate(duplicate),true);exercise(duplicate,'planner',false); // List uniqueness remains a separate strict duty.
 for(const value of ['', '   ',null,17]){const invalid=structuredClone(healthy.planner);invalid.plan.verification.checks[0].cases[0].consumerPaths=[value];exercise(invalid,'planner',false);}
});

test('assertions and cases may share actual identifier spelling without conflating membership',()=>{
 const output=structuredClone(healthy.planner),check=output.plan.verification.checks[0];
 check.assertions=[check.cases[0].id];
 assert.ok(parseRoleOutput(JSON.stringify(output),'planner').value);
 const schema=roleOutputSchema('planner'),validate=new Ajv2020({strict:false}).compile(schema);
 assert.equal(validate(output),true,JSON.stringify(validate.errors));
 assert.match(schema.properties.plan.properties.verification.properties.checks.items.properties.assertions.description,/identical spelling is valid/);
});

test('legacy and custom-stage role framing retain the prior complete evidence guidance',async()=>{
 const {roleFraming}=await import('../../dist/workflow/role-framing.js');
 for(const stage of [undefined,'custom-assessment'])for(const role of ['planner','challenger','adjudicator','reviewer']) {
  const input={requirements:[],contracts:'Original scope',context:stage===undefined?{}:{stage},sources:[],requiredScope:[]};
  const system=roleFraming(role,input,true).systemPrompt;
  assert.ok(system.includes('The finite mixed profile admits only exhaustive verification.strategies'));
  assert.ok(system.includes('When assigned publication source-fit'));
  assert.ok(system.includes('resolution diagnosed'));
 }
});

test('captured decision-local carry schema and strict parser share ordinary identity and lifecycle constraints',()=>{
 const constraints={decisionCarry:{version:1},decisionReferences:{version:1,occurrenceIds:['F','D'],diagnosisOccurrenceIds:['D']}},schema=roleOutputSchema('adjudicator','planning-adjudication',[],constraints);
 const validate=new Ajv2020({strict:false}).compile(schema);
 const base={version:1,summary:'Independent BASE mapping',findings:[],assessedScope:[],decisions:[{occurrenceId:'F',disposition:'upheld',reason:'Original requirement maps to current R1 and remains an implementation duty',witnesses:['base:consumer.cjs'],implementationCarry:{baselineVersion:'B',requirementIds:['R1']}}]};
 assert.equal(validate(base),true,JSON.stringify(validate.errors));assert.ok(parseRoleOutput(JSON.stringify(base),'adjudicator',[],constraints).value);
 for(const patch of [{occurrenceId:'D'},{disposition:'rejected'},{disposition:'deferred'},{resolution:'repaired'},{resolution:'diagnosed',diagnosis:{outputId:'O',rawSha256:'a'.repeat(64),inputReceiptHash:'b'.repeat(64),materialOccurrenceIds:[]}},{implementationCarry:{baselineVersion:'B',requirementIds:[]}},{implementationCarry:{baselineVersion:'B',requirementIds:['R1','R1']}}]){
  const body=structuredClone(base);Object.assign(body.decisions[0],patch);assert.equal(validate(body),false,JSON.stringify(patch));assert.equal(parseRoleOutput(JSON.stringify(body),'adjudicator',[],constraints).value,null);
 }
 const syntheticOnly={...constraints,decisionReferences:{version:1,occurrenceIds:['D'],diagnosisOccurrenceIds:['D']}},closed=roleOutputSchema('adjudicator','planning-adjudication',[],syntheticOnly);
 assert.equal(closed.properties.decisions.items.properties.implementationCarry,undefined);
 assert.doesNotThrow(()=>new Ajv2020({strict:false}).compile(closed));
 const legacy=roleOutputSchema('adjudicator');assert.equal(legacy.properties.decisions.items.properties.implementationCarry,undefined);
});
