// Actual source CLI, managed model resolver, Pi codec, workflow and local engine.
// Only the provider HTTP response is synthetic; no workflow/controller overrides.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';
import {scripted} from '../controller/effect-fixture.mjs';
import {wireResponse} from '../pi/provider-wire-fixture.mjs';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8')),roles=[],models=[],tools=[],reviews=[];
const producer=scripted(()=>{throw Error('Unexpected ordinary model request');},({role,body,context})=>{
 roles.push(role);
 if(role==='reviewer'){
  const text=context.messages.find(m=>m.role==='user').content.filter(p=>p.type==='text').map(p=>p.text).join('');
  const sources=[...text.matchAll(/\nSOURCE ([^\n]+)\n([\s\S]*?)\nEND SOURCE\n/g)].map(m=>({metadata:JSON.parse(m[1]),content:m[2]}));
  const consumer=sources.find(s=>s.metadata.side==='candidate'&&s.metadata.path==='consumer.cjs');
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
process.argv=[process.execPath,path.resolve('dist/cli/entry.js'),'conversation','ui','--home',cfg.home,'--conversation',cfg.cid];
await import('../../dist/cli/entry.js');
