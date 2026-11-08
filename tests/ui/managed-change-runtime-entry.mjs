// Actual source CLI, managed model resolver, Pi codec, workflow and local engine.
// Only the provider HTTP response is synthetic. The explicit settlement fixture delays the completed drive.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import fs from 'node:fs/promises';import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {scripted} from '../controller/effect-fixture.mjs';
import {wireResponse} from '../pi/provider-wire-fixture.mjs';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8')),roles=[],models=[],tools=[],reviews=[];
const producer=scripted(()=>{throw Error('Unexpected ordinary model request');},({role,body,context,result})=>{
 roles.push(role);
 if(cfg.observeCheck&&role==='planner')result.plan.verification.checks[0].timeoutMs=8000;
 if(role==='reviewer'){
  const text=context.messages.find(m=>m.role==='user').content.filter(p=>p.type==='text').map(p=>p.text).join('');
  const sources=[...text.matchAll(/\nSOURCE ([^\n]+)\n([\s\S]*?)\nEND SOURCE\n/g)].map(m=>({metadata:JSON.parse(m[1]),content:m[2]}));
  const consumer=sources.find(s=>s.metadata.id==='candidate:consumer.cjs');
  assert.equal(consumer?.content,'module.exports=3;\n');
  assert.ok(body.requiredScope.length);reviews.push({candidateVersion:body.context.candidateVersion,scope:body.requiredScope,consumer:consumer.content});
 }
});
globalThis.fetch=async(url,init)=>{
 if(cfg.inspectOnly)throw Error('Read-only result inspection attempted a model request');
 if(String(url)!=='http://127.0.0.1:9/v1/chat/completions')throw Error('Unexpected fixture network target');
 const body=JSON.parse(init.body);models.push(body.model);
 if(body.model!=='original')throw Error('Work retargeted from selected conversation to future default');
 const user=body.messages.find(m=>m.role==='user'),text=typeof user.content==='string'?user.content:user.content.filter(p=>p.type==='text').map(p=>p.text).join('');
 const output=await producer.definition.streamSimple({api:'openai-completions',provider:'managed-fixture',id:body.model},{messages:[{role:'user',content:[{type:'text',text}]}]}).result();
 const tool=output.content.find(p=>p.type==='toolCall');if(cfg.badCandidate&&tool?.name==='write'&&tool.arguments.path==='consumer.cjs')tool.arguments.content='module.exports=2;\n';if(tool)tools.push(tool.name);
 await fs.writeFile(cfg.receipt,JSON.stringify({roles,models,tools,reviews}));
 return wireResponse('openai-completions',body.model,tool?{tool:{name:tool.name,arguments:tool.arguments}}:{text:output.content.find(p=>p.type==='text').text});
};
const entry=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js');
if (cfg.observeCheck) {
 const {ContainerScope}=await import(pathToFileURL(path.resolve(path.dirname(entry),'../execution/container-scope.js')).href);
 const {Capacity}=await import(pathToFileURL(path.resolve(path.dirname(entry),'../controller/capacity.js')).href);
 const execute=ContainerScope.prototype.execute, close=ContainerScope.prototype.close;
 const acquire=Capacity.prototype.acquire;
 let checked, observed=false, prepared=false;
 const hold=async(marker,label)=>{
  await fs.writeFile(marker,label);
  const deadline=Date.now()+5000;
  while(!await fs.access(marker+'.release').then(()=>true,()=>false)){
   if(Date.now()>deadline) break;
   await new Promise(resolve=>setTimeout(resolve,15));
  }
 };
 Capacity.prototype.acquire=async function(request){
  if(request.kind==='check'&&!prepared){
   prepared=true;
   await hold(cfg.observeCheck.preparing,'Original check reserved before capacity');
  }
  return acquire.call(this,request);
 };
 ContainerScope.prototype.execute=function(command,options){
  if(command!=='node check.cjs'||observed) return execute.call(this,command,options);
  observed=true;
  checked=this;
  return execute.call(this,command,{...options,onData:bytes=>{
   options?.onData?.(bytes);
   if(bytes.includes('assertions')) writeFileSync(cfg.observeCheck.running,'Output received from the actual check');
  }});
 };
 ContainerScope.prototype.close=function(){
  if(checked!==this) return close.call(this);
  checked=undefined;
  return (async()=>{
   await hold(cfg.observeCheck.settling,'Original check entered cleanup');
   return close.call(this);
  })();
 };
}
if(cfg.holdManagedSettlement){
 const {ChangeCore}=await import(pathToFileURL(path.resolve(path.dirname(entry),'../controller/change-core.js')).href);
 const drive=ChangeCore.prototype.drive;
 const held=cfg.holdManagedSettlement;
 ChangeCore.prototype.drive=async function(...args){
  const result=await drive.apply(this,args);
  assert.equal(result.reviewReady,true);
  await fs.writeFile(held,'ready');
  const deadline=Date.now()+5000;
  while(!await fs.access(held+'.release').then(()=>true,()=>false)){
   if(Date.now()>deadline)throw Error('Held managed settlement was not released');
   await new Promise(resolve=>setTimeout(resolve,15));
  }
  return result;
 };
}
process.argv=[process.execPath,entry,'conversation','ui','--home',cfg.home,'--conversation',cfg.cid];
await import(pathToFileURL(entry).href);
