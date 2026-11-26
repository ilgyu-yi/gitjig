import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';

function credential() {
 const payload = Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'DUMMY_ACCOUNT'}})).toString('base64url');
 return {type:'oauth',access:'DUMMY.'+payload+'.DUMMY',refresh:'DUMMY_REFRESH',expires:Date.now()+86400000,accountId:'DUMMY_ACCOUNT'};
}

test('application selection sends GPT-6.2 Sol through both original OpenAI codecs', async t => {
 const {openController} = await import('../../dist/controller/index.js');
 const {ApplicationModels} = await import('../../dist/app/models.js');
 const root = await temporaryDirectory('sol-routing');
 let passed = false;
 t.after(async () => { if (passed) await rm(root,{recursive:true,force:true}); else t.diagnostic('Retained routing fixture '+root); });
 const home = join(root,'sol-app'), app = await openController({installationHome:home});
 const config = join(home,'config');
 await mkdir(config,{mode:0o700});
 await writeFile(join(config,'auth.json'),JSON.stringify({'openai-codex':credential(),openai:{type:'api_key',key:'DUMMY_OPENAI'}}),{mode:0o600});
 const models = new ApplicationModels(app);
 models.install();
 const originalTemporaryDirectory = process.env.TMPDIR, originalFetch = globalThis.fetch;
 globalThis.fetch = () => assert.fail('Unexpected authentication or catalog transport');
 process.env.TMPDIR = join(home,'artifacts');
 try {
  const catalogue = await models.list('gpt-6.2-sol');
  assert.ok(catalogue.models.some(model=>model.provider==='openai'&&model.id==='gpt-6.2-sol'&&model.api==='openai-responses'));
  assert.ok(catalogue.models.some(model=>model.provider==='openai-codex'&&model.id==='gpt-6.2-sol'&&model.api==='openai-codex-responses'));
  const routes = [
   ['openai-codex','https://chatgpt.com/backend-api/codex/responses'],
   ['openai','https://api.openai.com/v1/responses'],
  ];
  for (const [provider,endpoint] of routes) {
   let requests = 0;
   const view = await models.newConversation();
   const receipt = await models.select({conversationId:view.conversationId,expectedGeneration:view.generation,
    expectedRevision:app.getConversationModelChoice(view.conversationId).revision,provider,modelId:'gpt-6.2-sol'});
   assert.equal(receipt.modelId,'gpt-6.2-sol');
   assert.notEqual(receipt.thinkingLevel,'off');
   globalThis.fetch = async (url,init) => {
    assert.equal(String(url),endpoint);
    requests++;
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'),'Bearer '+(provider==='openai'? 'DUMMY_OPENAI' : credential().access));
    const coding = headers.get('content-encoding');
    const request = JSON.parse(coding === 'zstd' ? zstdDecompressSync(init.body).toString('utf8') : init.body);
    assert.equal(request.model,'gpt-6.2-sol');
    assert.ok(request.reasoning?.effort && !['none','minimal'].includes(request.reasoning.effort));
    const item = {id:'sol-output',type:'message',role:'assistant',content:[{type:'output_text',text:'Controlled Sol response.',annotations:[]}]};
    const events = [{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
     {type:'response.output_text.delta',output_index:0,content_index:0,delta:'Controlled Sol response.'},
     {type:'response.output_item.done',output_index:0,item},
     {type:'response.completed',response:{id:'owned-sol',status:'completed',output:[item],usage:{input_tokens:7,output_tokens:5,total_tokens:12,input_tokens_details:{cached_tokens:0}}}}];
    return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
   };
   await app.queueConversationInput({conversationId:view.conversationId,expectedGeneration:view.generation,text:'Run the controlled GPT-6.2 Sol response.',mode:'idle'});
   const result = await app.runConversation({conversationId:view.conversationId,...models.conversationOperation(view.conversationId)});
   assert.equal(result.status,'delivered',result.failure);
   assert.equal(requests,1);
  }
  const held = await models.newConversation();
  await models.select({conversationId:held.conversationId,expectedGeneration:held.generation,
   expectedRevision:app.getConversationModelChoice(held.conversationId).revision,provider:'openai-codex',modelId:'gpt-6.2-sol'});
  let refusals = 0;
  globalThis.fetch = async (url) => {
   assert.equal(String(url),routes[0][1]);
   refusals++;
   return Response.json({error:{message:'Controlled model entitlement denied'}},{status:403});
  };
  await app.queueConversationInput({conversationId:held.conversationId,expectedGeneration:held.generation,text:'Retain this controlled refused request.',mode:'idle'});
  const refused = await app.runConversation({conversationId:held.conversationId,...models.conversationOperation(held.conversationId)});
  assert.equal(refused.status,'unavailable');
  assert.match(refused.failure,/403|entitlement denied/);
  assert.equal(refusals,1);
  assert.equal(app.getConversationModelChoice(held.conversationId).provider,'openai-codex');
  passed = true;
 } finally {
  globalThis.fetch = originalFetch;
  if (originalTemporaryDirectory === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTemporaryDirectory;
  await app.close();
 }
});
