import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
const common={version:1,summary:'Independent unchanged-proposal decision',findings:[],assessedScope:[]};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function input(){const plan=mixedPlan();return{requirements:plan.requirements,contracts:'Current criteria',sources:[],requiredScope:[],context:{stage:'planning-adjudication',planProposal:plan,planningVerificationProfile:initialVerificationProfile,requirementSourceIds:['owner-request'],plannerInputScope:{version:1,role:'planner',stage:'planning',outputId:'P-output',launchId:'P-launch',workId:'W'},proposalApproval:{version:1,plannerOutputId:'P-output',proposalHash:digest(plan),plannerOutputHash:'a'.repeat(64)}}};}
test('new captured mode allows only absent unchanged-plan approval and preserves literal protocol',()=>{
 const bundle=input(),framing=roleFraming('adjudicator',bundle,true),output={...common,planAccepted:true,decisions:[]};
 const validate=new Ajv2020({strict:false}).compile(framing.schema);assert.equal(validate(output),true,JSON.stringify(validate.errors));
 const parsed=parseRoleOutput(JSON.stringify(output),'adjudicator',[],framing.constraints);assert.deepEqual(parsed.value,output);assert.equal(Object.hasOwn(parsed.value,'acceptedPlan'),false);
assert.match(framing.systemPrompt,/acceptedPlan omitted approves only that unchanged proposal/);
 assert.ok(!JSON.stringify(framing.schema).includes(JSON.stringify(bundle.context.planProposal)));
});
test('historical absence keeps supported-profile full-plan requirement',()=>{
 const bundle=input();delete bundle.context.proposalApproval;const f=roleFraming('adjudicator',bundle,true),output={...common,planAccepted:true,decisions:[]};
 assert.equal(new Ajv2020({strict:false}).compile(f.schema)(output),false);assert.equal(parseRoleOutput(JSON.stringify(output),'adjudicator',[],f.constraints).value,null);
 assert.ok(parseRoleOutput(JSON.stringify({...output,acceptedPlan:bundle.context.planProposal}),'adjudicator',[],f.constraints).value);
});
test('present invalid or null amendment cannot fall back; full correction remains literal',()=>{
 const bundle=input(),f=roleFraming('adjudicator',bundle,true),output={...common,planAccepted:true,decisions:[]};
 for(const acceptedPlan of [null,{}, {...bundle.context.planProposal,verification:{}}, {...bundle.context.planProposal,ambiguities:['Unknown owner intent']}]){
  const parsed=parseRoleOutput(JSON.stringify({...output,acceptedPlan}),'adjudicator',[],f.constraints);
  // Ambiguity stays an explicit valid result for the host to hold, never fallback.
  if(acceptedPlan?.ambiguities?.length)assert.deepEqual(parsed.value.acceptedPlan,acceptedPlan);else assert.equal(parsed.value,null);
 }
 const corrected=structuredClone(bundle.context.planProposal);corrected.approach='Independently corrected implementation approach';
 const parsed=parseRoleOutput(JSON.stringify({...output,acceptedPlan:corrected}),'adjudicator',[],f.constraints);assert.deepEqual(parsed.value.acceptedPlan,corrected);
});
test('selected identity, version, complete profile and source domains are checked before framing',()=>{
 for(const mutate of [b=>b.context.proposalApproval.version=2,b=>b.context.proposalApproval.plannerOutputId='other',b=>b.context.proposalApproval.proposalHash='0'.repeat(64),b=>b.context.proposalApproval.extra=true,b=>b.context.plannerInputScope.role='challenger',b=>{b.context.planProposal.ambiguities=['Unknown'];b.context.proposalApproval.proposalHash=digest(b.context.planProposal);},b=>{delete b.context.planProposal.verification.strategies;b.context.proposalApproval.proposalHash=digest(b.context.planProposal);},b=>b.context.requirementSourceIds=['foreign']]){
  const b=input();mutate(b);assert.throws(()=>roleFraming('adjudicator',b,true));
 }
 assert.throws(()=>roleFraming('reviewer',input(),true));
});
test('captured proposal and schema remain detached across caller mutation',()=>{
 const b=input(),before=structuredClone(b.context.planProposal),f=roleFraming('adjudicator',b,true);b.context.planProposal.verification.strategies=[];b.context.proposalApproval.plannerOutputId='changed';
 assert.deepEqual(f.constraints.proposalApproval.proposal,before);assert.ok(Object.isFrozen(f.constraints.proposalApproval.proposal.verification.strategies));
 assert.ok(parseRoleOutput(JSON.stringify({...common,planAccepted:true,decisions:[]}),'adjudicator',[],f.constraints).value);
});
