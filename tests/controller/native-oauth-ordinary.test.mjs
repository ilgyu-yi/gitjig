import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {readModelProfile} from '../../dist/cli/model-profile.js';

// Whole ordinary-controller/factory path. Original SDK transport parses synthetic
// SSE; no supplied ModelRuntime/provider, real credential, network or container.
test('owner native OAuth profile reaches ordinary controller and durable native history across reopen', {timeout:10000}, async () => {
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'gitjig-native-ordinary-'))),home=path.join(root,'home');
 const oldFetch=globalThis.fetch,oldTemp=process.env.TMPDIR;
 let controller,requests=0,unexpected=0;
 const owner='DUMMY owner ordinary factory request',answer='DUMMY native ordinary factory response';
 try {
  const auth=path.join(root,'auth.json'),profile=path.join(root,'profile.json');
  const access='DUMMY.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'DUMMY_ACCOUNT'}})).toString('base64url')+'.DUMMY';
  await fs.writeFile(auth,JSON.stringify({'openai-codex':{type:'oauth',access,refresh:'DUMMY_REFRESH',expires:Date.now()+86400000,accountId:'DUMMY_ACCOUNT'}}),{mode:0o600});
  await fs.writeFile(profile,JSON.stringify({provider:'openai-codex',modelId:'gpt-6.1-sol',native:{kind:'pi-oauth',authPath:auth}}),{mode:0o600});
  const model=await readModelProfile(profile,[]);
  assert.equal(model.runtime,undefined);assert.equal(model.definition,undefined);
  globalThis.fetch=async url=>{
   if(String(url)!=='https://chatgpt.com/backend-api/codex/responses'){unexpected++;throw Error('Unexpected external transport in DUMMY fixture');}
   requests++;assert.equal(requests,1,'Ordinary no-tool response requires one synthetic generation');
   const item={id:'ordinary-message',type:'message',role:'assistant',content:[{type:'output_text',text:answer,annotations:[]}]};
   const events=[{type:'response.created',response:{id:'ordinary-response'}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:answer},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'ordinary-response',status:'completed',output:[item],usage:{input_tokens:7,output_tokens:5,total_tokens:12,input_tokens_details:{cached_tokens:0}}}}];
   return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
  };
  controller=await openController({installationHome:home});process.env.TMPDIR=path.join(home,'artifacts');
  const conversation=controller.createConversation();
  await controller.queueConversationInput({conversationId:conversation.conversationId,expectedGeneration:0,text:owner,mode:'idle'});
  const result=await controller.runConversation({conversationId:conversation.conversationId,model});
  assert.equal(result.status,'delivered');assert.equal(result.cleanup,'unbound');assert.equal(requests,1);assert.equal(unexpected,0);
  const view=controller.inspectConversation(conversation.conversationId),before=await fs.readFile(view.historyRef,'utf8');
  assert.ok(typeof view.nativeSessionId==='string'&&view.nativeSessionId.length>0);
  const manager=(await controller.getConversationHistory(conversation.conversationId)).sessionManager;
  assert.equal(manager.getSessionId(),view.nativeSessionId);const entries=manager.getEntries();
  const messages=entries.filter(entry=>entry.type==='message').map(entry=>entry.message);
  assert.ok(messages.some(message=>message.role==='user'&&JSON.stringify(message.content).includes(owner)));
  const final=messages.filter(message=>message.role==='assistant').at(-1);
  assert.equal(final.provider,'openai-codex');assert.equal(final.model,'gpt-6.1-sol');assert.equal(final.stopReason,'stop');
  assert.equal(final.content.find(block=>block.type==='text').text,answer);
  assert.equal(controller.store.all("SELECT * FROM capacity_leases WHERE state IN ('QUEUED','ACTIVE')").length,0);
  assert.equal(controller.store.all('SELECT * FROM conversation_assignments').length,0);
  await controller.close();controller=undefined;
  controller=await openController({installationHome:home});
  const reopened=controller.inspectConversation(conversation.conversationId);
  assert.equal(reopened.historyRef,view.historyRef);assert.equal(reopened.nativeSessionId,view.nativeSessionId);
  assert.equal(await fs.readFile(reopened.historyRef,'utf8'),before);assert.equal(requests,1);
 } finally {
  try { await controller?.close(); } finally {
   globalThis.fetch=oldFetch;
   if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;
   await fs.rm(root,{recursive:true,force:true});
  }
 }
});
