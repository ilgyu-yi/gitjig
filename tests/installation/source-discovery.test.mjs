import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {offlineSourceInstallation,inventory,checkout,digest} from './offline-source-fixture.mjs';
import {scripted,withValueCases} from '../controller/effect-fixture.mjs';
import {wireResponse} from '../pi/provider-wire-fixture.mjs';
import {estimateTextTokens} from '@earendil-works/pi-ai/utils/estimate';
const wireText=message=>typeof message.content==='string'?message.content:(message.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('');
function readResults(messages){
 const calls=new Map(messages.flatMap(message=>(message.tool_calls??[]).map(call=>[call.id,call])));
 return messages.filter(message=>message.role==='tool').flatMap(message=>{
  const call=calls.get(message.tool_call_id);if(call?.function.name!=='read')return[];
  return [{id:message.tool_call_id,path:JSON.parse(call.function.arguments).path,text:wireText(message)}];
 });
}
test('public offline installed terminal starts EN and KO large-project work and reopens the original result with its draft',{timeout:300000},async t=>{
 assert.ok(process.env.GITJIG_DOCKER_BINARY&&process.env.GITJIG_DOCKER_CONFIG_DIRECTORY&&process.env.GITJIG_DOCKER_CONTEXT&&process.env.GITJIG_RUNTIME_IMAGE,'Explicit prepared engine required');
 let finishOwned=async()=>{};
 const fixture=await offlineSourceInstallation(t,'source-discovery',{beforeCleanup:()=>finishOwned()}),{root,payload,command,env,run}=fixture;
 const runtime={dockerBinary:await fs.realpath(process.env.GITJIG_DOCKER_BINARY),dockerConfigDirectory:await fs.realpath(process.env.GITJIG_DOCKER_CONFIG_DIRECTORY),dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
 const control=path.join(root,'control');await fs.mkdir(control,{mode:0o700});
 const controls=[];
 for(const [source,name]of [['tests/installation/source-discovery-install-guard.mjs','guard.mjs'],['tests/cli/guarded-process-method.mjs','guarded-process-method.mjs'],['tests/cli/fork-ui-pty.py','terminal.py']]){
  const bytes=await fs.readFile(path.join(checkout,source)),file=path.join(control,name);await fs.writeFile(file,bytes,{mode:0o600});controls.push({path:file,sha256:digest(bytes),source});
 }
 const trace=path.join(root,'installed-imports.jsonl'),requestsFile=path.join(root,'model-requests.jsonl'),sockets=new Set(),cases=[],worlds=[];
 let current,sealed=false,closing;const handlers=new Set();
 const handle=async(request,response,world)=>{
  try{
   t.signal.throwIfAborted();assert.equal(sealed,false);assert.ok(world);assert.equal(request.method,'POST');assert.equal(request.url,'/v1/chat/completions');assert.equal(request.headers.authorization,'Bearer OWNED_SCRIPTED_ONLY');
   const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;assert.ok(size<=8*1024*1024,'Owned model wire transport bound');chunks.push(chunk);}
   t.signal.throwIfAborted();assert.ok(world.requests.length<32,'Finite per-world synthetic model request ceiling');
   const body=JSON.parse(Buffer.concat(chunks));assert.equal(body.model,'original');assert.equal(body.max_completion_tokens,16384,'Actual installed wire must retain the full resolved output allowance');const ordinal=world.requests.length+1;
   const record={locale:world.locale,ordinal,body};world.requests.push(record);await fs.appendFile(requestsFile,JSON.stringify(record)+'\n',{mode:0o600});
   const user=body.messages.find(message=>message.role==='user'),text=wireText(user);assert.ok(text.startsWith('Perform the assigned '),'Only explicit governed-role requests are expected');
   const input=JSON.parse(text.split('\n')[1]),reads=readResults(body.messages);let answer;
   if(input.sourceDiscovery?.side==='base'&&String(input.context.stage).startsWith('planning')){
    assert.equal(input.sources.some(source=>['consumer.cjs','check.cjs'].includes(source.path)),false,'Needed modules must be genuinely off-seed');
    for(const read of reads)assert.equal(read.text,world.original.get(read.path),'Actual original SDK-rendered tool result must reach the HTTP provider');
    if(reads.length<2)answer={tool:{name:'read',arguments:{path:['consumer.cjs','check.cjs'][reads.length]}}};
    else{assert.deepEqual(reads.map(read=>read.path),['consumer.cjs','check.cjs']);assert.equal(new Set(reads.map(read=>read.id)).size,2);world.discoveries.push({input,reads,ordinal});}
   }
   if(!answer){
    // Synthetic answer oracle only. The actual installed codec's complete wire
    // history is retained above and its read results are checked before release.
    const output=await world.producer.definition.streamSimple({api:'openai-completions',provider:'installed-discovery',id:body.model},{messages:[{role:'user',content:[{type:'text',text}]}]}).result();
    const tool=output.content.find(part=>part.type==='toolCall');answer=tool?{tool:{name:tool.name,arguments:tool.arguments}}:{text:output.content.find(part=>part.type==='text').text};
   }
   const responseEstimate=estimateTextTokens(JSON.stringify(answer));assert.ok(responseEstimate<=body.max_completion_tokens,'Synthetic oracle must respect the actual requested output allowance');
   world.outputBudgets.push({ordinal,maxCompletionTokens:body.max_completion_tokens,responseEstimate,wireInputBytes:Buffer.byteLength(JSON.stringify({messages:body.messages,tools:body.tools}))});
   t.signal.throwIfAborted();if(response.destroyed)return;
   const wire=wireResponse('openai-completions',body.model,answer),rendered=await wire.text();t.signal.throwIfAborted();if(response.destroyed)return;
   response.writeHead(200,Object.fromEntries(wire.headers));response.end(rendered.replaceAll('call_owned','call_discovery_'+world.locale+'_'+ordinal));
  }catch(error){if(world)world.errors.push(String(error));response.destroy(error);}
 };
 const server=http.createServer((request,response)=>{
  if(sealed||t.signal.aborted||handlers.size>=8){response.destroy(Error('Owned model admission is sealed or full'));return;}
  const task=handle(request,response,current);handlers.add(task);
  void task.then(()=>handlers.delete(task),()=>handlers.delete(task));
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const close=()=>{if(!closing){sealed=true;for(const socket of sockets)socket.destroy();const listenerClosed=new Promise(resolve=>server.close(()=>resolve()));closing=(async()=>{await listenerClosed;while(handlers.size)await Promise.allSettled([...handlers]);})();}return closing;};
 const onAbort=()=>{void close();};t.signal.addEventListener('abort',onAbort,{once:true});
 finishOwned=async()=>{await close();t.signal.removeEventListener('abort',onAbort);await fs.writeFile(path.join(root,'server-completion.json'),JSON.stringify({aggregateAborted:t.signal.aborted,sealed,pendingHandlers:handlers.size,sockets:sockets.size,current:current?{locale:current.locale,requests:current.requests.length,errors:current.errors}:null,worlds:worlds.map(({locale,requests,errors})=>({locale,requests:requests.length,errors})),completedCases:cases.map(({locale,workId,cid})=>({locale,workId,cid}))},null,2),{mode:0o600});};
 t.signal.throwIfAborted();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.signal.throwIfAborted();
 const manifest={payload,trace,controls,runtime,port:server.address().port},manifestFile=path.join(root,'control-manifest.json');await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2),{mode:0o600});
 const guarded={...env,NODE_OPTIONS:'--import='+pathToFileURL(path.join(control,'guard.mjs')).href,GITJIG_DISCOVERY_MANIFEST:manifestFile};
 for(const locale of ['en','ko']){
  t.signal.throwIfAborted();const directory=path.join(root,'case-'+locale),project=path.join(directory,'project'),home=path.join(directory,'application');await fs.mkdir(project,{recursive:true,mode:0o700});
  const original=new Map();for(let i=0;i<96;i++)original.set('a-context-'+String(i).padStart(3,'0')+'.txt',('context '+i+'\n').padEnd(16383,'x')+'\n');
  original.set('consumer.cjs','// '+'consumer context '.padEnd(40000,'x')+'\nmodule.exports=2;\n');
  original.set('check.cjs','// '+'checker context '.padEnd(40000,'y')+'\n'+withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
  original.set('README.md','The required consumer is consumer.cjs and its checker is check.cjs. Preserve unrelated context.\n');
  for(const [name,text]of original)await fs.writeFile(path.join(project,name),text);
  const claims=['consumer.cjs','check.cjs'].map(name=>({sourceId:'base:'+name,startLine:1,endLine:original.get(name).split('\n').length}));
  const world={locale,original,requests:[],errors:[],discoveries:[],roles:[],outputBudgets:[]};
  world.producer=scripted(undefined,({role,body,result})=>{world.roles.push(role);if(body.sourceDiscovery?.side==='base'&&String(body.context.stage).startsWith('planning'))result.assessedScope=claims;});current=world;worlds.push(world);
  const language=locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',caseEnv={...guarded,GITJIG_HOME:home,LANG:language,LC_ALL:language};
  const cli=async(args,label)=>JSON.parse(await run(command,[...args,'--home',home],locale+'-'+label,{environment:caseEnv}));
  await cli(['project','register','--id','P','--root',project],'project');
  const startup=path.join(directory,'startup.json');await fs.writeFile(startup,JSON.stringify({version:1,runtime}),{mode:0o600});await cli(['setup','save','--file',startup],'setup');
  const models=path.join(directory,'models.json');await fs.writeFile(models,JSON.stringify({providers:{'installed-discovery':{api:'openai-completions',baseUrl:'http://127.0.0.1:'+manifest.port+'/v1',apiKey:'OWNED_SCRIPTED_ONLY',models:[{id:'original'},{id:'future'}]}}}),{mode:0o600});
  await cli(['models','configure','--file',models],'models');
  const modelCatalogue=await cli(['models','list'],'resolved-models');
  for(const id of ['original','future']){const selected=modelCatalogue.models.find(model=>model.provider==='installed-discovery'&&model.id===id);assert.ok(selected);assert.equal(selected.contextWindow,128000);assert.equal(selected.maxTokens,16384);}
  await cli(['models','default','--provider','installed-discovery','--model','future'],'default');
  assert.equal(current.requests.length,0);
  const terminal=async(label,args,steps,seconds)=>{
   t.signal.throwIfAborted();const file=path.join(directory,label+'.json'),output=file+'.terminal';
   await fs.writeFile(file,JSON.stringify({command:[command,'conversation','ui','--home',home,...args],cwd:directory,env:caseEnv,steps,timeoutSeconds:seconds,noForceKill:true,gracefulShutdownSeconds:8,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output}),{mode:0o600});
   const receipt=JSON.parse(await run('/usr/bin/python3',[path.join(control,'terminal.py'),file],locale+'-'+label,{environment:caseEnv,timeout:(seconds+12)*1000}));
   assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);assert.equal(receipt.alternateEntered,true);assert.equal(receipt.alternateExited,true);
   const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));assert.equal(progress.forceKilled,false);assert.equal(progress.outputTruncated,false);return{file,output,receipt,progress};
  };
  const strings=locale==='ko'?{selected:'현재 대화의 모델이 선택되었습니다',start:'관리형 작업 시작',ready:'리뷰 준비 완료 결과가 기록됨',result:'작업 결과',next:'이 결과의 다음 단계',palette:'명령 · Ctrl+G',footer:'Ctrl+G 명령'}:{selected:'Model selected for this conversation',start:'Start managed work',ready:'Review-ready result recorded',result:'Task result',next:'Next step for this result',palette:'Commands · Ctrl+G',footer:'Ctrl+G commands'};
  const request=locale==='ko'?'consumer.cjs가3을 내보내도록 수정하고 check.cjs로 검증하라. 무관한 파일은 보존하라.':'Make consumer.cjs export3, verify with check.cjs and preserve unrelated files.';
  const first=await terminal('start',['--project','P'],[
   {wait:'Model: future',send:'/model installed-discovery/original\x1b\r'},
   {wait:strings.selected,send:'/change start '+request+'\x1b\r'},
   {wait:strings.start,send:'\r'},
   {wait:strings.ready,send:'/result\x1b\r',waitIdle:true},
   {wait:strings.result,send:'\x1b'},
   {wait:strings.next,send:'\x1b'},
   {wait:strings.footer,send:'/quit\x1b\r',waitIdle:true},
  ],90);
  const changes=await cli(['change','list'],'changes');assert.equal(changes.changes.length,1);const workId=changes.changes[0].workId;
  const view=await cli(['change','inspect','--work',workId],'inspect');assert.equal(view.reviewReady,true,JSON.stringify(view.blocked));assert.equal(view.phase,'REVIEW_READY');assert.deepEqual(view.execution,{limit:32,consumed:8,reserved:0});assert.equal(current.discoveries.length,3);assert.deepEqual(current.errors,[]);
  const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});let cid,base,candidate,launches,proof;
  try{
   const work=db.prepare('SELECT * FROM works WHERE id=?').get(workId),workData=JSON.parse(work.data);assert.equal(workData.applicationModelBaseline.choice.modelId,'original');assert.equal(workData.applicationModelBaseline.source.kind,'conversation');cid=workData.applicationModelBaseline.source.conversationId;
   assert.equal(db.prepare('SELECT raw FROM sources WHERE id=?').get(work.source).raw,request);
   base=db.prepare('SELECT * FROM change_versions WHERE id=?').get(view.baseVersion);candidate=db.prepare('SELECT * FROM change_versions WHERE id=?').get(view.candidateVersion);
   const catalogue={format:1,version:base.id,side:'base',files:JSON.parse(base.data).manifest.files.map(({path,sha256,size})=>({path,sha256,size}))};
   for(const discovery of current.discoveries){assert.equal(discovery.input.sourceDiscovery.sha256,digest(JSON.stringify(catalogue)));assert.equal(discovery.input.sourceDiscovery.count,99);assert.equal(discovery.input.sourceDiscovery.version,base.id);}
   launches=db.prepare('SELECT * FROM role_launches WHERE work=?').all(workId);const planning=[];
   for(const launch of launches){const data=JSON.parse(launch.data);if(!String(data.stage).startsWith('planning'))continue;const output=db.prepare('SELECT * FROM role_outputs WHERE launch=?').get(launch.id),out=JSON.parse(output.data);planning.push({launch,data,output,out});
    for(const claim of claims){assert.ok(out.protocol.assessedScope.some(s=>s.sourceId===claim.sourceId));assert.ok(out.exposures.some(e=>e.sourceId===claim.sourceId&&e.version===base.id&&e.producer==='read'&&e.sourceSha256===digest(original.get(e.path))));if(data.inputScope){assert.equal(data.inputScope.selectedSources.some(s=>s.id===claim.sourceId),false);assert.equal(data.inputScope.promptIncludedSourceIds.includes(claim.sourceId),false);}}
   }
   assert.equal(planning.length,3);assert.equal(planning.filter(p=>p.data.inputScope).length,2);assert.equal(new Set(launches.map(l=>l.run)).size,launches.length);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','ACTIVE','QUEUED','SETTLING','QUARANTINED')").get().n,0);
   proof={workId,cid,catalogue,planning,view,base,candidate,modelCatalogue,outputBudgets:current.outputBudgets,sourceHashes:Object.fromEntries([...original].map(([name,text])=>[name,digest(text)]))};
  }finally{db.close();}
  for(const [name,text]of original){assert.equal(await fs.readFile(path.join(project,name),'utf8'),text);assert.equal(await fs.readFile(path.join(base.artifact,name),'utf8'),text);assert.equal(await fs.readFile(path.join(candidate.artifact,name),'utf8'),name==='consumer.cjs'?text.replace('exports=2','exports=3'):text);}
  const domain=()=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{
   const tables=['works','sources','requirements','budgets','obligations','runs','observations','results','change_state','change_versions','role_launches','role_outputs','finding_occurrences','finding_dispositions','check_runs','remedy_confirmations','conversation_inputs','conversation_directions','conversation_assignments','conversation_dependencies','conversation_results','capacity_leases','effect_targets','effect_delegations'];
   return{tables:Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])),selectedInputs:db.prepare('SELECT * FROM conversation_inputs WHERE conversation=? ORDER BY rowid').all(cid)};
  }finally{db.close();}};
  const beforeReopen=domain();assert.equal(beforeReopen.selectedInputs.length,0);
  const count=current.requests.length;assert.equal(current.outputBudgets.length,count);for(const budget of current.outputBudgets){assert.equal(budget.maxCompletionTokens,16384);assert.ok(budget.responseEstimate<=16384);}
  const draft='  Followup 한국어 {project}  ';
  const reopened=await terminal('reopen',['--conversation',cid],[
   {wait:'Model: original',send:'\x1b[200~'+draft+'\x1b[201~'},
   {wait:'Followup 한국어 {project}',send:'\x07'},
   {wait:strings.palette,send:'r'},
   {wait:strings.result,send:'\x1b'},
   {wait:strings.next,send:'\x1b'},
   {wait:strings.footer,send:'\x07',waitIdle:true},
   {wait:strings.palette,send:'q'},
  ],20);
  assert.equal(current.requests.length,count);const afterReopen=domain();assert.deepEqual(afterReopen,beforeReopen);
  for(const [name,text]of original){assert.equal(await fs.readFile(path.join(project,name),'utf8'),text);assert.equal(await fs.readFile(path.join(base.artifact,name),'utf8'),text);assert.equal(await fs.readFile(path.join(candidate.artifact,name),'utf8'),name==='consumer.cjs'?text.replace('exports=2','exports=3'):text);}
  const finalDb=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(finalDb.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(cid).draft,draft);}finally{finalDb.close();}
  const proofFile=path.join(directory,'installed-discovery-proof.json');await fs.writeFile(proofFile,JSON.stringify({...proof,first,reopened,beforeReopen,afterReopen,requests:count,roles:current.roles,errors:current.errors},null,2),{mode:0o600});cases.push({locale,home,project,workId,cid,proofFile,requests:count,first,reopened});
 }
 const probes=[];
 for(const [label,code,boundary]of [
  ['checkout',`await import(${JSON.stringify(pathToFileURL(path.join(checkout,'dist/controller/index.js')).href)})`,'module outside installed payload'],
  ['process',"(await import('node:child_process')).spawn('/usr/bin/true',[])",'spawn'],
  ['socket',"const net=await import('node:net');await new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port:0});socket.once('error',reject);socket.once('connect',()=>{socket.end();resolve();});});",'socket outside owned model fixture'],
 ]){
  await run(process.execPath,['--input-type=module','-e',code],'deny-'+label,{environment:guarded,expected:1});
  const invocation=fixture.invocations.at(-1);assert.equal(invocation.label,'deny-'+label);probes.push({label,pid:invocation.pid,boundary});
 }
 await close();assert.equal(sockets.size,0);assert.equal(handlers.size,0);for(const world of worlds)assert.deepEqual(world.errors,[]);
 const events=(await fs.readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(events.filter(e=>e.kind==='denied').length,3);
 for(const probe of probes){assert.deepEqual(events.filter(event=>event.pid===probe.pid&&event.kind==='denied').map(event=>event.boundary),[probe.boundary]);assert.ok(events.some(event=>event.pid===probe.pid&&event.kind==='exit'&&event.denied===1));}
 assert.ok(events.some(e=>e.kind==='module'&&e.file===path.join(payload,'dist/workflow/source-catalogue.js')));for(const file of ['dist/workflow/role-framing.js','dist/pi/context-budget.js'])for(const pid of cases.map(c=>c.first.progress.childPid))assert.ok(events.some(event=>event.pid===pid&&event.kind==='module'&&event.file===path.join(payload,file)));assert.ok(events.some(e=>e.kind==='capture-worker'));assert.ok(events.some(e=>e.kind==='engine'));assert.ok(events.some(e=>e.kind==='model-socket'));
 const uiPids=cases.flatMap(c=>[c.first.progress.childPid,c.reopened.progress.childPid]);for(const pid of uiPids){const own=events.filter(e=>e.pid===pid);assert.ok(own.some(e=>e.kind==='exit'&&e.denied===0));assert.equal(own.some(e=>e.kind==='denied'),false);}
 for(const file of controls)assert.equal(digest(await fs.readFile(file.path)),file.sha256);await fixture.assertCurrent();assert.deepEqual(await inventory(payload),fixture.payloadBefore);
 const receipt={scope:'Public offline source/npm install; actual installed EN/KO terminal request/start and result/draft reopen; real Pi codec/SDK/owned engine with synthetic HTTP role answers, not live-model/general-size/whole-goal maturity',root,payload,command,cases,controls,runtime,manifestFile,requestsFile,trace,probes,payloadInventorySha256:digest(JSON.stringify(fixture.payloadBefore)),sourceInputsSha256:digest(await fs.readFile(path.join(root,'source-inputs.json'))),invocations:fixture.invocations.map(({out,err,...rest})=>rest)};
 const file=path.join(root,'qualification.json');await fs.writeFile(file,JSON.stringify(receipt,null,2),{mode:0o600});t.diagnostic(JSON.stringify({root,receipt:file,payload,command}));fixture.pass();
});
