import {applyCurrentVerificationFixture} from '../workflow/current-verification-fixture.mjs';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
const caseOutput = `const descriptor=JSON.parse(require('fs').readFileSync('/input/verification-cases.json','utf8'));const cases=descriptor.cases.map(c=>{const value=require('./consumer.cjs');return {id:c.id,inputDigest:c.inputDigest,observed:{kind:value===Number(c.declaration.input.literalUtf8)?'return':'rejection',value:String(value)}}});`;
export const wrong = caseOutput+"console.log(JSON.stringify({version:1,cases,assertions:[{id:'three',passed:require('./consumer.cjs')===4,actual:String(require('./consumer.cjs'))}]}));\n";
export const correct = wrong.replace('===4','===3');
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
export function amendmentModel({weak=false,omitAmendment=false,invalidResolution=false,badInitial=false,omitCriteriaDecision=false,wrongReceipt=false,withoutCases=false,caseOnly=false}={}) {
 const turns=new Map();
 return {provider:'check-amendment-fixture',modelId:'fixture',definition:{api:'check-amendment-api',apiKey:'fixture',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:20000}],streamSimple(m,context){
 const text=context.messages.find(m=>m.role==='user').content.filter(c=>c.type==='text').map(c=>c.text).join(''),body=JSON.parse(text.split('\n')[1]),role=text.match(/assigned (\w+) task/)[1],turn=turns.get(text)??0;turns.set(text,turn+1);
 const revision=(body.context.sourceInputChain??[]).find(input=>input.text.includes('value4')),expected=revision?4:3;
 const result={version:1,summary:'Use actual consumer and retained failed checker operands',findings:[],assessedScope:body.requiredScope};let tool;
 if(role==='planner'){
 const old=(body.context.pendingObligations??[]).find(o=>o.kind==='check');
 const cases=[{id:'value-healthy',kind:'healthy',guaranteeIds:['R1'],derivation:'Owner numeric value is accepted by actual consumer comparison',consumerPaths:['consumer.cjs'],input:{literalUtf8:String(expected),fixturePaths:[]},expected:{kind:'return',value:String(expected)}},{id:'value-adverse',kind:'adverse',guaranteeIds:['R1'],derivation:'A different claimed value must be rejected by actual consumer comparison',consumerPaths:['consumer.cjs'],input:{literalUtf8:String(expected===3?4:3),fixturePaths:[]},expected:{kind:'rejection',value:String(expected)}}];
 if(caseOnly&&!old)for(const item of cases)item.expected.value='4';
 const check={...(withoutCases?{}:{cases}),id:'value',guaranteeIds:['R1'],command:'node check.cjs',assertions:['three'],timeoutMs:2000,fixturePaths:['check.cjs','consumer.cjs'],expectationPaths:['check.cjs']};
 result.plan={intent:'Consumer exports3',requirements:[{id:'R1',text:revision?'Consumer exports value4':'Consumer exports3',source:revision?.source??body.context.ownerSource}],approach:'Use actual consumer and correct exact fixture',simplerAlternative:'Restore original criterion rather than weaken it',factualSources:['base:consumer.cjs'],ambiguities:[],verification:{checks:[check],requiredPaths:['consumer.cjs','check.cjs'],reviewRoles:[{key:'general',kind:'reviewer',purpose:'Read actual consumer and healthy/adverse checker receipts',requiredPaths:['consumer.cjs','check.cjs']}],...(old&&!omitAmendment?{checkAmendments:[{obligationId:old.id,failedCheckRunId:wrongReceipt?'foreign-or-invented':body.context.checks.find(c=>c.status==='fail'&&c.candidate===old.candidate).id,basis:revision?'owner-requirement-revision':'fixture-defect',...(revision?{ownerInputId:revision.input_id}:{}),correctedCheckId:'value',fixturePaths:caseOnly?[]:['check.cjs'],negativeAssertions:caseOnly?[]:['three'],...(caseOnly?{caseIds:['value-healthy','value-adverse']}:{}),negativeCaseIds:withoutCases?[]:['value-healthy','value-adverse'],...((revision||(old&&!old.check.cases?.length&&!withoutCases))?{caseIds:['value-healthy','value-adverse']}:{}),reason:'Owner asks3; original checker incorrectly requires4'}]}:{})}};
 }
 if(role==='challenger')result.alternatives=['Retain exact owner requirement and demonstrate corrected checker rejects actual bad base'];
 if(role==='adjudicator'){
 result.decisions=[];result.inputDecisions=(body.context.sourceInputChain??[]).filter(input=>input.data.effectHold).map(input=>({inputId:input.input_id,directionRevision:input.revision,impact:revision?'scope-change':'explanation',requirementIds:['R1'],reason:'Consume actual owner source before affected action'}));
 if(body.context.stage==='planning-adjudication'){result.planAccepted=true;result.acceptedPlan=body.context.planProposal;}
 if(body.context.criteriaRefresh&&!omitCriteriaDecision){const {sourceId,fromContractsVersion,toContractsVersion}=body.context.criteriaRefresh;result.criteriaDecision={sourceId,fromContractsVersion,toContractsVersion,verdict:'adopt',reason:'Actual owner requested installed owned criteria refresh; task requirement stays3'};}
 if(body.context.stage==='review-adjudication')result.checkResolutions=(body.context.amendmentProofs??[]).map(p=>({amendmentId:p.amendmentId,disposition:revision?'authorized-requirement-revision':'corrected-fixture',reason:'Exact corrected expectation passes real C and rejects bad B with fresh independent review',witnesses:invalidResolution?['invented']:[p.healthy,p.probe]}));
 }
 if((role==='implementer'||role==='repairer')&&turn===0)tool={name:'write',arguments:{path:role==='repairer'?'check.cjs':'consumer.cjs',content:role==='repairer'?(weak?correct.replace("require('./consumer.cjs')===3",'true'):correct):`module.exports=${revision?4:badInitial?2:3};\n`}};
 if(revision&&(role==='implementer'||role==='repairer')&&turn===1)tool={name:'write',arguments:{path:'check.cjs',content:correct.replace('===3','===4')}};
 if(role==='reviewer')result.outcome='clear';
 applyCurrentVerificationFixture(result,body.context);
 const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const message={role:'assistant',content:tool?[{type:'toolCall',id:'actual-edit-'+turn,name:tool.name,arguments:tool.arguments}]:[{type:'text',text:JSON.stringify(result)}],api:m.api,provider:m.provider,model:m.id,usage,stopReason:tool?'toolUse':'stop',timestamp:Date.now()};stream.push({type:'done',reason:message.stopReason,message});stream.end(message);});return stream;
 }}};
}
