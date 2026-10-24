import {applyCurrentVerificationFixture} from '../workflow/current-verification-fixture.mjs';
import fs from 'node:fs/promises';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai/compat';
import {randomUUID} from 'node:crypto';
export function withAssignedReports(model){
 const pending=new Map(),original=model.definition.streamSimple;
 return {...model,definition:{...model.definition,streamSimple(selected,context,options){
  if(!getCurrentTools(context.messages).some(tool=>tool.name==='conversation_report'))return original.call(model.definition,selected,context,options);
  const key=getCurrentSystemPrompt(context.messages)+JSON.stringify(context.messages.filter(message=>message.role==='user').at(-1)),stream=createAssistantMessageEventStream();
  void(async()=>{try{
   let message=pending.get(key);if(message)pending.delete(key);else{message=await(await original.call(model.definition,selected,context,options)).result();if(message.stopReason==='stop'){
    const text=message.content.filter(part=>part.type==='text').map(part=>part.text).join('\n');if(text){pending.set(key,message);message={...message,content:[{type:'toolCall',id:'report-'+randomUUID(),name:'conversation_report',arguments:{text}}],stopReason:'toolUse'};}
   }}
   message={...message,timestamp:Date.now()};stream.push(['error','aborted'].includes(message.stopReason)?{type:'error',reason:message.stopReason,error:message}:{type:'done',reason:message.stopReason,message});stream.end(message);
  }catch(error){const message={role:'assistant',content:[],api:selected.api,provider:selected.provider,model:selected.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'error',errorMessage:String(error),timestamp:Date.now()};stream.push({type:'error',reason:'error',error:message});stream.end(message);}})();return stream;
 }}};
}

// Explicit numeric consumer fixture. Native role tools lack the collector-only descriptor;
// ENOENT retains ordinary assertions and emits no cases, never invented coverage.
// A collector still requires its exact declared roster/digests. Other read/parse failures propagate.
// One real suite invokes the selected numeric consumer for both accepted claims.
export function withValueCases(checkSource) {
    const prefix = `let __gcDescriptor;try{__gcDescriptor=JSON.parse(require('fs').readFileSync('/input/verification-cases.json','utf8'))}catch(error){if(error.code!=='ENOENT')throw error}const __gcCases=(__gcDescriptor?.cases??[]).map(c=>{const actual=require('./consumer.cjs');return{id:c.id,inputDigest:c.inputDigest,observed:{kind:actual===Number(c.declaration.input.literalUtf8)?'return':'rejection',value:String(actual)}}});`;
    if (!/version:\s*1,\s*assertions:/.test(checkSource)) throw Error('Explicit fixture output shape required');
    return prefix + checkSource.replace(/version:\s*1,\s*assertions:/, 'version:1,cases:__gcCases,assertions:');
}
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export function scripted(onOrdinary, onRole) {
    const turns = new Map();
    return withAssignedReports({ provider: 'effect-core-fixture', modelId: 'fixture', definition: { api: 'effect-fixture-api', apiKey: 'fixture-only', baseUrl: 'http://unused.invalid', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 20000 }], streamSimple(m, context) {
                const user = context.messages.find(m => m.role === 'user'), text = user.content.filter(c => c.type === 'text').map(c => c.text).join(''), body = text.startsWith('Perform the assigned ') ? JSON.parse(text.split('\n')[1]) : null, role = text.match(/assigned (\w+) task/)?.[1], turn = turns.get(text) ?? 0;
                turns.set(text, turn + 1);
                const result = { version: 1, summary: 'Inspect actual selected consumer bytes', findings: [], assessedScope: body?.requiredScope ?? [] };
                let tool;
                const revision=body?.context.sourceInputChain?.find(i=>i.text.includes('value4')),expected=revision?4:3;
                if (!role) {
                    const ordinary = onOrdinary(context, turn);
                    if (ordinary.tool)
                        tool = ordinary.tool;
                    else
                        result.ordinaryText = ordinary.text;
                }
                if (role === 'planner')
                    result.plan = { intent: 'Export3 using existing consumer', requirements: [{ id: 'R1', text: 'Consumer exports3', source: body.context.ownerSource }], approach: 'One literal change', simplerAlternative: 'Reuse current export', factualSources: ['base:consumer.cjs'], ambiguities: [], verification: { checks: [{ id: 'value', guaranteeIds: ['R1'], command: 'node check.cjs', assertions: ['three'], timeoutMs: 2000, fixturePaths: ['check.cjs', 'consumer.cjs'], expectationPaths: ['check.cjs'] }], requiredPaths: ['consumer.cjs', 'check.cjs'], reviewRoles: [{ key: 'general', kind: 'reviewer', purpose: 'Read current consumer and actual check', requiredPaths: ['consumer.cjs', 'check.cjs'] }] } };
                if(role==='planner'&&revision){result.plan.requirements=[{id:'R1',text:'Consumer exports value4',source:revision.source}];result.plan.verification.checks=[{id:'value4',guaranteeIds:['R1'],command:'node check.cjs',assertions:['four'],timeoutMs:2000,fixturePaths:['consumer.cjs','check.cjs'],expectationPaths:['check.cjs']}];result.plan.verification.requiredPaths=['consumer.cjs','check.cjs'];result.plan.verification.reviewRoles[0].requiredPaths=['consumer.cjs','check.cjs'];}
                if (role === 'challenger')
                    result.alternatives = ['Reuse existing simple literal export'];
                if (role === 'adjudicator') {
                    result.decisions = [];
                    result.inputDecisions=(body.context.sourceInputChain??[]).filter(i=>i.data.effectHold).map(i=>({inputId:i.input_id,directionRevision:i.revision,impact:revision?'scope-change':'explanation',reason:revision?'Actual owner changed required consumer to value4':'Owner keeps existing export3 criterion',requirementIds:['R1']}));
                    if(body.context.stage==='publication-payload-fit'){result.inputDecisions=(body.context.sourceInputChain??[]).filter(i=>i.data.effectHold).map(i=>({inputId:i.input_id,directionRevision:i.revision,impact:'explanation',reason:'Actual supplied source remains consistent with this exact scoped summary',requirementIds:['publication-intent']}));result.payloadDecision={payloadHash:body.context.payloadHash,sourceFingerprint:body.context.sourceFingerprint,verdict:'fit',reason:'Actual current evidence summary and raw owner source supplied'};}
                    if (body.context.stage === 'planning-adjudication') {
                        result.planAccepted = true;
                        result.acceptedPlan = body.context.planProposal;
                    }
                }
                if ((role === 'implementer' || role === 'repairer') && turn === 0) {
                    const sources = [...text.matchAll(/\nSOURCE ([^\n]+)\n([\s\S]*?)\nEND SOURCE\n/g)].map(m => ({ metadata: JSON.parse(m[1]), content: m[2] })), source = sources.find(s => s.metadata.side === 'candidate' && s.metadata.path === 'consumer.cjs') ?? sources.find(s => s.metadata.path === 'consumer.cjs');
                    tool = { name: 'write', arguments: { path: 'consumer.cjs', content: source.content.replace(/exports=\d+/, 'exports='+expected) } };
                }
                if(revision&&(role==='implementer'||role==='repairer')&&turn===1){const source=[...text.matchAll(/\nSOURCE ([^\n]+)\n([\s\S]*?)\nEND SOURCE\n/g)].map(m=>({metadata:JSON.parse(m[1]),content:m[2]})).find(s=>s.metadata.path==='check.cjs');tool={name:'write',arguments:{path:'check.cjs',content:source.content.replaceAll('three','four').replace('===3','===4')}};}
                if (role === 'reviewer')
                    result.outcome = 'clear';
                onRole?.({role,body,context,turn,result});
                if (role === 'planner' && result.plan) for (const check of result.plan.verification.checks) if (check.command === 'node check.cjs') check.cases = [
                    {id: check.id+'-healthy',kind:'healthy',guaranteeIds:check.guaranteeIds,derivation:'The owner required value claim must match the actual consumer',consumerPaths:['consumer.cjs'],input:{literalUtf8:String(expected),fixturePaths:[]},expected:{kind:'return',value:String(expected)}},
                    {id: check.id+'-adverse',kind:'adverse',guaranteeIds:check.guaranteeIds,derivation:'A contradictory numeric value claim must be rejected by the actual consumer',consumerPaths:['consumer.cjs'],input:{literalUtf8:String(expected===3?4:3),fixturePaths:[]},expected:{kind:'rejection',value:String(expected)}}
                ];
                applyCurrentVerificationFixture(result, body?.context);
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    const message = { role: 'assistant', content: tool ? [{ type: 'toolCall', id: 'write-' + turn, name: tool.name, arguments: tool.arguments }] : [{ type: 'text', text: result.ordinaryText ?? JSON.stringify(result) }], api: m.api, provider: m.provider, model: m.id, usage, stopReason: tool ? 'toolUse' : 'stop', timestamp: Date.now() };
                    stream.push({ type: 'done', reason: message.stopReason, message });
                    stream.end(message);
                });
                return stream;
            } } });
}

// Admission counters are not completion. Bind the actual delivered record to its settled run.
export function settledRoot(c, conversationId, workId, attempts) {
    const row=c.store.one('SELECT data FROM conversation_results WHERE conversation=? ORDER BY rowid DESC LIMIT 1',conversationId),run=c.store.one('SELECT * FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1',workId),view=c.inspectConversation(conversationId);
    if(!row||!run)return false;
    const result=JSON.parse(row.data).result;
    return result?.status==='delivered'&&result.runId===run.id&&run.phase==='SETTLED'&&c.inspectWork(workId).allowance.consumed>=attempts&&view.state==='IDLE'&&!c.getNativeHandle(conversationId)&&!c.ordinaryCore?.isBusy(conversationId)&&c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n===0;
}
export async function cleanupFixture(controller, root, passed) {
    let clean=false;
    try { await controller.close(); clean=true; }
    finally {
        if(passed&&clean) await fs.rm(root,{recursive:true,force:true});
        else console.error('Retained failed effect fixture: '+root);
    }
}
