import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {amendmentModel,correct} from '../controller/check-amendment-fixture.mjs';
const exec=promisify(execFile);
test('explicit public replan amends an actual case-only failure and preserves same-W failure history through final independent resolution',{timeout:25000},async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/cli-replan-'))),home=path.join(root,'home'),source=path.join(root,'source');
 await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),correct.replace("require('./consumer.cjs')===3",'true'));process.env.TMPDIR=path.join(home,'artifacts');
 const runtimeProfile={dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE},model=amendmentModel({caseOnly:true});
 let c=await openController({installationHome:home,runtimeProfile}),success=false,server;const sockets=new Set(),roles=[];
 try{
  await c.registerProject({id:'P',sourceRoot:source});const {workId}=await c.beginChange({projectId:'P',request:'Consumer must export3. Claim4 is rejected. Expected4 in a checker is a fixture defect.',executionLimit:48,resolutionLimit:24});
  await c.planChange({workId,model});await c.implementChange({workId,model});const failed=await c.checkChange({workId});assert.equal(failed.phase,'REPAIR_REQUIRED');const old=failed.checks.find(x=>x.status==='fail');assert.ok(old.data.parsed.value.assertions.every(x=>x.passed));await c.close();c=null;
  const fixture=amendmentModel({caseOnly:true});
  server=http.createServer(async(req,res)=>{try{
   let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>3*1024*1024)throw Error('owned request bound');chunks.push(chunk);}const payload=JSON.parse(Buffer.concat(chunks).toString());
   const user=payload.messages.find(x=>x.role==='user');const text=typeof user.content==='string'?user.content:user.content.filter(x=>x.type==='text').map(x=>x.text).join('');roles.push(text.match(/assigned (\w+) task/)[1]);
   const stream=fixture.definition.streamSimple({api:'check-amendment-api',provider:fixture.provider,id:'fixture'},{messages:[{role:'user',content:[{type:'text',text}]}]});const output=await stream.result();assert.equal(output.stopReason,'stop');
   const chunk=(delta,finish_reason=null)=>({id:'owned-replan',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify(chunk({role:'assistant',content:output.content[0].text}))}\n\n`);res.write(`data: ${JSON.stringify(chunk({},'stop'))}\n\n`);res.end('data: [DONE]\n\n');
  }catch(e){res.destroy(e);}});server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=path.join(root,'model.json');await fs.writeFile(profile,JSON.stringify({provider:'owned-replan',modelId:'fixture',definition:{api:'openai-completions',apiKey:'literal-owned-fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:fixture.definition.models}}),{mode:0o600});
  const result=await exec(process.execPath,['dist/cli/main.js','change','replan','--home',home,'--work',workId,'--model-profile',profile,'--docker-binary',runtimeProfile.dockerBinary,'--docker-context',runtimeProfile.dockerContext,'--image',runtimeProfile.image],{timeout:12000,maxBuffer:4*1024*1024});const planned=JSON.parse(result.stdout);assert.equal(planned.phase,'PLAN_READY');assert.equal(planned.workId,workId);assert.deepEqual(roles,['planner','challenger','adjudicator']);assert.ok(planned.checks.some(x=>x.id===old.id&&x.status==='fail'));
  c=await openController({installationHome:home,runtimeProfile});const ready=await c.driveChange({workId,model});assert.equal(ready.reviewReady,true,JSON.stringify(ready.blocked));assert.equal(ready.workId,workId);assert.equal(ready.baseVersion,failed.baseVersion);assert.ok(ready.checks.some(x=>x.id===old.id&&x.status==='fail'));assert.equal(ready.resolution.reserved,0);assert.equal(ready.execution.reserved,0);assert.ok(ready.checks.some(x=>x.data.purpose==='fixture-amendment-negative'&&x.data.caseResults.complete));success=true;
 }finally{if(c)await c.close();if(server){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}if(success)await fs.rm(root,{recursive:true,force:true});else console.error('Preserved '+root);}
});
