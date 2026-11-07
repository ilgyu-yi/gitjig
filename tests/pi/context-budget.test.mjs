import { ModelContextBudgetError as RetainedBudgetError } from '../../dist/pi/context-budget-error.js';
import { modelContextFailureCode } from '../../dist/pi/context-budget.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {clampMaxTokensToContext} from '@earendil-works/pi-ai/api/simple-options';
import {estimateContextTokens} from '@earendil-works/pi-ai/utils/estimate';
import {assertModelContextBudget,MODEL_CONTEXT_MARGIN,ModelContextBudgetError} from '../../dist/pi/context-budget.js';
const model={contextWindow:32000,maxTokens:1000};
const user=text=>({role:'user',content:[{type:'text',text}],timestamp:1});
test('complete context budget ignores a tiny reported usage that would hide the original prefix',()=>{
 const messages=[user('original '.repeat(9000)),{role:'assistant',content:[{type:'text',text:'read more'}],usage:{input:1,output:0,cacheRead:0,cacheWrite:0,totalTokens:1},stopReason:'stop',timestamp:2},
  {role:'toolResult',toolCallId:'original-call',toolName:'read',content:[{type:'text',text:'source '.repeat(9000)}],isError:false,timestamp:3}];
 assert.ok(estimateContextTokens({messages}).tokens<model.contextWindow-model.maxTokens-MODEL_CONTEXT_MARGIN,'The public usage shortcut must actually differ for this adversary');
 assert.throws(()=>assertModelContextBudget(model,{messages}),error=>error.code==='MODEL_CONTEXT_LIMIT'&&error.budget.estimatedInput>error.budget.availableInput);
});
test('system sections and tool declarations consume context even when the user text is small',()=>{
 for(const extra of [{sections:{policy:'required '.repeat(15000)}},{toolsAdded:[{name:'required-tool',description:'schema '.repeat(20000),parameters:{type:'object',properties:{}}}]}]){
  const messages=[{role:'system',content:'',...extra,timestamp:0},user('small owner request')];
  assert.throws(()=>assertModelContextBudget(model,{messages}),{code:'MODEL_CONTEXT_LIMIT'});
 }
});
test('context fit retains declared output and margin without mutating the request or trusting missing metadata',()=>{
 const context={messages:[user('Owner intent 한국어 {request}\nKeep all bytes')]},before=structuredClone(context);
 const budget=assertModelContextBudget(model,context);assert.equal(budget.outputReserve,1000);assert.equal(budget.availableInput,32000-1000-4096);assert.ok(budget.estimatedInput>0);assert.deepEqual(context,before);assert.equal(Object.isFrozen(budget),true);
 for(const invalid of [{contextWindow:0,maxTokens:1000},{contextWindow:32000,maxTokens:0},{contextWindow:NaN,maxTokens:1000},{contextWindow:32000,maxTokens:undefined}])assert.throws(()=>assertModelContextBudget(invalid,context),{code:'MODEL_CONTEXT_UNAVAILABLE'});
 assert.throws(()=>assertModelContextBudget({contextWindow:4096,maxTokens:4096},context),error=>error.code==='MODEL_CONTEXT_LIMIT'&&error.budget.outputReserve===4096);
});

test('public top-level system and tool framing cannot bypass the complete request budget',()=>{
 for(const extra of [{systemPrompt:'mandatory policy '.repeat(10000)},{tools:[{name:'required-tool',description:'required schema '.repeat(10000),parameters:{type:'object',properties:{}}}]}]){
  const context={messages:[user('small')],...extra},before=structuredClone(context);
  assert.throws(()=>assertModelContextBudget(model,context),{code:'MODEL_CONTEXT_LIMIT'});assert.deepEqual(context,before);
 }
});

test('higher valid SDK usage cannot silently consume the declared response reserve',()=>{
 const selected={contextWindow:128000,maxTokens:16384},messages=[user('small current text'),{role:'assistant',content:[{type:'text',text:'small answer'}],usage:{input:120000,output:0,cacheRead:0,cacheWrite:0,totalTokens:120000},stopReason:'stop',timestamp:2}];
 const context={messages};assert.ok(clampMaxTokensToContext(selected,context,selected.maxTokens)<selected.maxTokens,'The real SDK output clamp must actually reduce this answer ceiling');
 assert.throws(()=>assertModelContextBudget(selected,context),error=>error.code==='MODEL_CONTEXT_LIMIT'&&error.budget.sdkContextEstimate===120000&&error.budget.fullMessageEstimate<100&&error.budget.estimatedInput===120000);
 const healthy={messages:[user('ordinary required input')]},budget=assertModelContextBudget(selected,healthy);
 assert.equal(clampMaxTokensToContext(selected,healthy,selected.maxTokens),budget.outputReserve);
});
test('invalid reported token fields never establish context capacity',()=>{
 for(const value of [NaN,Infinity,-1,1.5,undefined]){
  const message={role:'assistant',content:[{type:'text',text:'small'}],usage:{input:1,output:0,cacheRead:0,cacheWrite:0,totalTokens:value},stopReason:'stop',timestamp:2};
  assert.throws(()=>assertModelContextBudget(model,{messages:[user('original'),message]}),{code:'MODEL_CONTEXT_UNAVAILABLE'});
 }
});

test('recorded context cause recognizes exact owned failures and ignores quotations or unknown data',()=>{
 for(const code of ['MODEL_CONTEXT_LIMIT','MODEL_CONTEXT_UNAVAILABLE'])for(const prefix of ['ModelContextBudgetError: ','ControllerError: PROVIDER:HOST_CONTEXT_GUARD:ModelContextBudgetError: '])assert.equal(modelContextFailureCode(prefix+code+': original diagnosis'),code);
 for(const cause of [undefined,null,42,{},[],new Error('MODEL_CONTEXT_LIMIT'), 'Owner quoted ModelContextBudgetError: MODEL_CONTEXT_LIMIT: text','PROVIDER: MODEL_CONTEXT_LIMIT: prose','ModelContextBudgetError: UNKNOWN: text','ControllerError: unrelated HOST_CONTEXT_GUARD:ModelContextBudgetError: MODEL_CONTEXT_LIMIT: text'])assert.equal(modelContextFailureCode(cause),undefined);
});

test('actual request refusal preserves the shared SDK-free retained error identity',()=>{
 const context={messages:[user('owner input')]};
 assert.throws(()=>assertModelContextBudget({contextWindow:4096,maxTokens:4096},context),error=>{
  assert.ok(error instanceof RetainedBudgetError);
  assert.ok(error instanceof ModelContextBudgetError);
  assert.equal(error.name,'ModelContextBudgetError');
  assert.equal(error.code,'MODEL_CONTEXT_LIMIT');
  assert.equal(error.budget.availableInput,-4096);
  assert.equal(modelContextFailureCode(String(error)),'MODEL_CONTEXT_LIMIT');
  return true;
 });
});
