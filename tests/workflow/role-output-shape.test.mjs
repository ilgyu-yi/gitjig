import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoleOutput,parseCheckOutput} from '../../dist/workflow/protocol.js';
import {roleOutputSchema,roleShapes,protocolShapes} from '../../dist/workflow/role-output-shape.js';
export const common={version:1,summary:'Evidence',findings:[],assessedScope:[]};
export const declaredCase={id:'good',kind:'healthy',guaranteeIds:['R'],derivation:'Direct consumer observation',consumerPaths:['consumer.cjs'],input:{literalUtf8:'',fixturePaths:[]},expected:{kind:'return',value:''}};
export const plan={intent:'Preserve requirement',requirements:[{id:'R',text:'Owner requirement',source:'source'}],approach:'Inspect consumer',simplerAlternative:'Existing behavior',factualSources:[],ambiguities:[],verification:{checks:[{id:'C',guaranteeIds:['R'],command:'node check.cjs',assertions:['A'],timeoutMs:1,fixturePaths:['../legacy','../legacy'],cases:[declaredCase]}],requiredPaths:[],reviewRoles:[{key:'review',kind:'reviewer',purpose:'Independent evidence',requiredPaths:[]}]}};
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
