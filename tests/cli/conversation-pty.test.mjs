import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../../dist/cli/main.js',import.meta.url));
const driver=fileURLToPath(new URL('./conversation-pty.py',import.meta.url));
for(const stalled of [false,true])test(`public native CLI PTY ${stalled?'leave interrupts active SSE without cancelling work':'submits exact Unicode whitespace and restores terminal'}`,{timeout:30000},async t=>{
  await fs.mkdir('.runtime-fixtures',{recursive:true});
  const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ui-pty-'))),home=path.join(root,'home');
  let accepted=false,closed=0;const requests=[],sockets=new Set();
  const marker=stalled?'OWNED_PTY_STREAM_ACTIVE':'OWNED_PTY_RESPONSE_COMPLETE';
  const turns=stalled?1:2;
  const server=http.createServer(async(req,res)=>{
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Error('Request cap');chunks.push(chunk);}
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.on('close',()=>closed++);res.writeHead(200,{'content-type':'text/event-stream'});
      const chunk=(delta,finish_reason=null)=>({id:'owned-ui-pty',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
      res.write(`data: ${JSON.stringify(chunk({role:'assistant',content:marker+'_'+requests.length}))}\n\n`);
      if(!stalled){res.write(`data: ${JSON.stringify(chunk({},'stop'))}\n\n`);res.end('data: [DONE]\n\n');}
    }catch(error){res.destroy(error);}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));if(accepted)await fs.rm(root,{recursive:true,force:true});else t.diagnostic(`PTY failure retained: ${root}`);});
  const run=async words=>JSON.parse((await exec(process.execPath,[cli,...words,'--home',home],{timeout:10000,maxBuffer:1024*1024})).stdout);
  const conversation=await run(['conversation','create']);assert.equal(conversation.projectId,null);
  const publicationArgs=[];let publicationTarget;
  if(!stalled){
    const targetProfile=path.join(root,'publication-target.json'),delegations=path.join(root,'publication-grants.json');
    await fs.writeFile(targetProfile,JSON.stringify({target:{host:'github.com',repositoryId:8,repositoryNodeId:'REPO',owner:'owner',repository:'repo',actorUserId:7},visibility:'private'}),{mode:0o600});
    publicationTarget=(await run(['publication','register-target','--target-profile',targetProfile])).targetId;
    await fs.writeFile(delegations,JSON.stringify([{targetId:publicationTarget,actions:['create-issue'],operationLimit:1,projectIds:[null]}]),{mode:0o600});
    publicationArgs.push('--delegate-publications',delegations);
  }
  const profile=path.join(root,'model.json');
  await fs.writeFile(profile,JSON.stringify({provider:'owned-ui-pty',modelId:'fixture',definition:{api:'openai-completions',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture-only',models:[{id:'fixture',name:'Owned PTY fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}]}}),{mode:0o600});
  const input='  원문 공백 유지  ',config=path.join(root,'driver.json');
  await fs.writeFile(config,JSON.stringify({input,marker,commandKey:stalled?'ctrl+p':'ctrl+g',markers:Array.from({length:turns},(_,i)=>marker+'_'+(i+1)),artifacts:path.join(home,'artifacts'),output:path.join(root,'terminal.bin'),command:[process.execPath,cli,'conversation','ui','--home',home,'--conversation',conversation.conversationId,'--model-profile',profile,...(stalled?['--command-key','ctrl+p']:[]),...publicationArgs,'--completed-view-limit',stalled?'0':'100','--view-idle-grace-ms',stalled?'0':'86400000']}));
  const actual=JSON.parse((await exec('python3',[driver,config],{timeout:25000,maxBuffer:1024*1024})).stdout);
  assert.equal(actual.exitCode,0,JSON.stringify(actual));assert.equal(actual.sent,true);assert.equal(actual.left,true);assert.equal(actual.terminalRestored,true);assert.equal(actual.alternateScreenEntered,true);assert.equal(actual.alternateScreenExited,true);
  assert.equal(requests.length,turns);assert.ok(actual.childMaxRssBytes>0);assert.equal(actual.turnResponseMs.length,turns);const user=requests[0].messages.filter(message=>message.role==='user').at(-1);
  const text=typeof user.content==='string'?user.content:user.content.filter(item=>item.type==='text').map(item=>item.text).join('');assert.equal(text,input);
  const reopened=await run(['conversation','inspect','--conversation',conversation.conversationId]);assert.equal(reopened.state,'IDLE');assert.equal(reopened.draft.text,'');assert.ok(reopened.historyRef);assert.ok(reopened.workId);
  const work=await run(['work','inspect','--work',reopened.workId]);assert.notEqual(work.state,'CANCELLED');assert.equal(work.epoch,work.runs[0].epoch);assert.equal(work.allowance.reserved,0);assert.equal(work.allowance.consumed,turns);assert.equal(closed,turns);
  const history=await fs.readFile(reopened.historyRef,'utf8');assert.ok(history.includes(input));
  if(!stalled){
    assert.ok(requests[0].tools.some(tool=>tool.function.name==='conversation_publish'),'Finite publication entry must reach the actual native UI provider');
    const db=new DatabaseSync(path.join(home,'state','controller.sqlite'),{readOnly:true});
    try{const grants=db.prepare('SELECT root,data FROM effect_delegations WHERE target=?').all(publicationTarget);assert.equal(grants.length,1);assert.equal(grants[0].root,reopened.workId);const grant=JSON.parse(grants[0].data);assert.deepEqual(grant.actions,['create-issue']);assert.equal(grant.operationLimit,1);assert.deepEqual(grant.projectIds,[null]);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM effect_operations').get().n,0);}finally{db.close();}
  }
  t.diagnostic(JSON.stringify({...actual,actualOfficialHTTPRequests:requests.length,externalCalls:0,workCancelled:false,retainedNativeHistory:true,artificialProjects:0}));accepted=true;
});
