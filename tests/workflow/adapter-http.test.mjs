import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {initializePiHost} from '../../dist/pi/index.js';
import {runRole,hashText} from '../../dist/workflow/index.js';

// The installed official openai-completions adapter uses its real HTTP client,
// SSE parser and cancellation. No custom streamSimple or provider mocks here.
const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'workflow-http-')));
const stateRoot=path.join(root,'state'),artifactRoot=path.join(root,'artifacts'),workspaceRoot=path.join(root,'work');
for(const p of [stateRoot,artifactRoot,workspaceRoot])await fs.mkdir(p,{mode:0o700});
process.env.TMPDIR=artifactRoot;const host=await initializePiHost({stateRoot,artifactRoot});let sequence=0,accepted=0;
const source={id:'candidate:consumer.ts',version:'HTTP-C1',side:'candidate',path:'consumer.ts',content:'export const requestCount = 1; // actual HTTP source\n',exposeInPrompt:true};source.sha256=hashText(source.content);
const assessed={sourceId:source.id,startLine:1,endLine:source.content.split('\n').length};
const final=JSON.stringify({version:1,summary:'Actual HTTP transport received the source and requirements.',findings:[],assessedScope:[assessed],outcome:'clear'});
const operations={workspaceRoot,validatePath:p=>path.resolve(workspaceRoot,p),async exec(){throw Error('Unexpected project execution');},async readFile(){throw Error('Unexpected project read');},async access(){throw Error('Unexpected project access');},async writeFile(){throw Error('Unexpected project write');},async mkdir(){throw Error('Unexpected project mkdir');}};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function within(promise,ms,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]).finally(()=>clearTimeout(timer));}
async function serverFixture(t,mode='healthy',observeRequest=()=>({})){
 const records=[],sockets=new Set(),received=deferred(),closed=deferred();
 const server=http.createServer(async(req,res)=>{
  let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>128*1024){req.destroy();return;}chunks.push(chunk);}
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  records.push({method:req.method,path:req.url,payload,fixtureAuthorization:req.headers.authorization==='Bearer fixture-only-http-key',...observeRequest()});
  res.once('close',()=>closed.resolve({ended:res.writableEnded,socketDestroyed:req.socket.destroyed}));
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.flushHeaders();
  const chunk=(delta,finish_reason=null)=>({id:'chatcmpl-owned-fixture',object:'chat.completion.chunk',created:1,model:'fixture-http',choices:[{index:0,delta,finish_reason}]});
  res.write(`data: ${JSON.stringify(chunk({role:'assistant',content:mode==='healthy'?final.slice(0,40):''}))}\n\n`);
  received.resolve(records[0]);
  if(mode==='healthy'){res.write(`data: ${JSON.stringify(chunk({content:final.slice(40)}))}\n\n`);res.write(`data: ${JSON.stringify(chunk({},'stop'))}\n\n`);res.end('data: [DONE]\n\n');}
  // Stalled mode intentionally keeps SSE open without a finish_reason.
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert.equal(address.address,'127.0.0.1');
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 return {records,received:received.promise,closed:closed.promise,url:`http://127.0.0.1:${address.port}/v1`};
}
function roleOptions(server,extra={}){
 return {launchId:'http-host-launch-'+(++sequence),role:'reviewer',host,operations,
 inputBundle:{requirements:[{id:'R1',text:'One effect for duplicate request ID',source:'owner-event-http'}],contracts:'C4 requires actual independent source review.',context:{candidateVersion:'HTTP-C1'},sources:[source],requiredScope:[assessed]},
 model:{provider:'http-owned-'+sequence,modelId:'fixture-http',definition:{baseUrl:server.url,apiKey:'fixture-only-http-key',api:'openai-completions',models:[{id:'fixture-http',name:'Owned local HTTP fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}]}},
 assertEntry(){},beforeModelRequest:async manager=>{const bytes=await fs.readFile(manager.getSessionFile(),'utf8');assert.match(bytes,/One effect for duplicate request ID/);assert.ok(manager.getLeafId());},timeoutMs:3000,...extra};
}

test('official OpenAI-compatible HTTP/SSE reaches actual role JSON and source projection',{timeout:5000},async t=>{
 let checkpoints=0,checkpointFile;const server=await serverFixture(t,'healthy',()=>({checkpointCountAtReceive:checkpoints}));
 const options=roleOptions(server);const guard=options.beforeModelRequest;options.beforeModelRequest=async manager=>{await guard(manager);checkpointFile=manager.getSessionFile();checkpoints++;};
 const result=await runRole(options);assert.equal(result.usable,true,result.issues.join('\n'));assert.equal(result.protocol.summary,'Actual HTTP transport received the source and requirements.');assert.equal(result.rawFinal,final);assert.equal(server.records.length,1);assert.equal(checkpoints,1);assert.equal(result.providerRequests,1);
 const request=server.records[0];assert.equal(request.path,'/v1/chat/completions');assert.equal(request.method,'POST');assert.equal(request.fixtureAuthorization,true);assert.equal(request.payload.model,'fixture-http');assert.equal(request.payload.stream,true);assert.equal(request.checkpointCountAtReceive,1);const user=request.payload.messages.findLast(m=>m.role==='user');const userText=typeof user.content==='string'?user.content:user.content.filter(c=>c.type==='text').map(c=>c.text).join('');assert.ok(userText.includes(source.content),'Actual HTTP user payload contains exact supplied source text');assert.match(JSON.stringify(request.payload.messages),/actual HTTP source/);assert.match(JSON.stringify(request.payload.messages),/One effect for duplicate request ID/);assert.match(await fs.readFile(checkpointFile,'utf8'),/actual HTTP source/);assert.equal(result.exposures[0].version,'HTTP-C1');
 t.diagnostic(JSON.stringify({provider:'official openai-completions',transport:'owned127.0.0.1 HTTP/SSE',requests:1,checkpoints:1,sourceProjected:true,externalCalls:0}));accepted++;
});
test('checkpoint failure prevents an actual HTTP request to the owned server',{timeout:5000},async t=>{
 const server=await serverFixture(t);const result=await runRole(roleOptions(server,{beforeModelRequest:async()=>{throw Error('durable-checkpoint-refused-before-http');}}));assert.equal(result.usable,false);assert.equal(result.providerRequests,0);assert.equal(server.records.length,0);assert.match(result.issues.join(),/durable-checkpoint-refused-before-http/);
 t.diagnostic(JSON.stringify({provider:'official openai-completions',requests:0,checkpointRefused:true,externalCalls:0}));accepted++;
});
test('actual stalled official HTTP/SSE request aborts, closes connection and returns unusable',{timeout:5000},async t=>{
 const server=await serverFixture(t,'stalled');const owner=new AbortController();const started=performance.now();const operation=runRole(roleOptions(server,{signal:owner.signal}));await within(server.received,2000,'HTTP request never reached owned server');owner.abort(new Error('owner canceled actual HTTP stream'));const result=await within(operation,2000,'Native HTTP abort did not settle');const closed=await within(server.closed,2000,'Actual stalled SSE connection did not close');assert.equal(result.usable,false);assert.equal(result.terminal,'aborted');assert.equal(server.records.length,1);assert.equal(closed.ended,false);assert.equal(closed.socketDestroyed,true);assert.ok(performance.now()-started<4000);
 t.diagnostic(JSON.stringify({provider:'official openai-completions',requests:1,ownerAbort:true,unfinishedSSEClosed:true,elapsedMs:Math.round(performance.now()-started),externalCalls:0}));accepted++;
});
test('declared whole-role deadline aborts actual official stalled SSE',{timeout:5000},async t=>{
 const server=await serverFixture(t,'stalled');const started=performance.now();const operation=runRole(roleOptions(server,{timeoutMs:250}));await within(server.received,2000,'HTTP request never reached owned server before deadline');const result=await within(operation,2000,'Native HTTP deadline did not settle');const closed=await within(server.closed,2000,'Deadline did not close stalled SSE');assert.equal(result.usable,false);assert.equal(result.terminal,'aborted');assert.equal(server.records.length,1);assert.equal(closed.ended,false);assert.equal(closed.socketDestroyed,true);
 t.diagnostic(JSON.stringify({provider:'official openai-completions',requests:1,deadlineMs:250,unfinishedSSEClosed:true,elapsedMs:Math.round(performance.now()-started),externalCalls:0}));accepted++;
});
test.after(async()=>{if(accepted===4)await fs.rm(root,{recursive:true,force:true});else console.error('HTTP fixture failure retained at '+root);});
