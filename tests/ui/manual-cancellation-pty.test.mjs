import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';

const execute=promisify(execFile);
const cases=['en','ko'].flatMap(locale=>['compact','tree'].flatMap(action=>[false,true].map(close=>({locale,action,close,boundary:'model'}))));
for(const locale of ['en','ko'])cases.push({locale,action:'compact',close:false,boundary:'refresh'});
for(const locale of ['en','ko'])cases.push({locale,action:'tree',close:'menu',boundary:'model'},{locale,action:'tree',close:false,boundary:'switch'});
for(const {locale,action,close,boundary} of cases)
test(boundary==='switch'?`History completion preserves a newer conversation picker and each draft in ${locale}`:boundary==='refresh'?'Completed summary result survives Escape while its original history refresh is pending':`${close==='menu'?'Command menu quit':close?'Host close':'Escape'} cancels ${action} model preparation without a late history action in ${locale}`,{timeout:20000},async t=>{
 const root=await temporaryDirectory('manual-cancellation'),home=path.join(root,'home'),hold=path.join(root,'hold'),entered=path.join(root,'entered'),release=path.join(root,'release'),called=path.join(root,'called'),probe=path.join(root,'guard-observation.json'),probeSource=path.join(root,'probe-source.json'),settled=path.join(root,'settled.json');
 let passed=false;const requests=[],sockets=new Set();
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained manual cancellation terminal '+root);});
 const server=http.createServer(async(req,res)=>{try{
  let body='';for await(const bytes of req)body+=bytes;requests.push(JSON.parse(body));
  res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish_reason=null)=>({id:'manual-owned',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
  res.write('data: '+JSON.stringify(chunk({role:'assistant',content:'OWNED_HISTORY_RESPONSE'}))+'\n\n');res.write('data: '+JSON.stringify(chunk({},'stop'))+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){res.destroy(error);}});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 const c=await openController({installationHome:home}),accounts=ApplicationAccounts.open(c);
 await accounts.configure({providers:{'manual-owned':{api:'openai-completions',apiKey:'DUMMY_MANUAL',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture'}]}}});await accounts.setDefault('manual-owned','fixture');
 const view=await new ApplicationModels(c).newConversation();
 let other;
 if(boundary==='switch'){
  other=await new ApplicationModels(c).newConversation();
  c.setConversationName({conversationId:view.conversationId,expectedGeneration:0,name:'History source'});
  c.setConversationName({conversationId:other.conversationId,expectedGeneration:0,name:'Other conversation'});
  c.setDraft({conversationId:other.conversationId,expectedRevision:0,text:'OTHER exact draft'});
 }
 c.setConversationView({selectedId:view.conversationId});await c.close();
 const guard=path.join(root,'guard.mjs');await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js',import.meta.url).href)};
import {Controller} from ${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)};
import {registerHooks} from 'node:module';import {createHash} from 'node:crypto';import {writeFileSync} from 'node:fs';
if(${JSON.stringify(boundary)}==='switch'){
 // Read-only sampling after the original tree finally: never replace a guard assignment.
 const key=Symbol.for('gitjig.fixture.history-switch-observation');
 globalThis[key]=(target,pending)=>{if(target===${JSON.stringify(view.conversationId)})writeFileSync(${JSON.stringify(probe)},JSON.stringify({target,pending}));};
 registerHooks({load(url,context,next){const loaded=next(url,context);if(url!==${JSON.stringify(new URL('../../dist/ui/index.js',import.meta.url).href)})return loaded;
  const source=String(loaded.source),end=source.indexOf('    const chooseHost ='),start=source.lastIndexOf('        finally {',end),close=source.indexOf('\\n        }',start);
  if(end<0||start<0||close<0||close>end)throw Error('Original tree-finally observation boundary unavailable');
  const instrumented=source.slice(0,close)+'\\n            globalThis[Symbol.for("gitjig.fixture.history-switch-observation")]?.(target, switchPending);'+source.slice(close);
  writeFileSync(${JSON.stringify(probeSource)},JSON.stringify({url,originalSHA256:createHash('sha256').update(source).digest('hex'),instrumentedSHA256:createHash('sha256').update(instrumented).digest('hex')}));
  return {...loaded,source:instrumented};
 }});
}

const resolve=ApplicationModels.prototype.resolve;ApplicationModels.prototype.resolve=async function(...args){if(${JSON.stringify(boundary)}!=='refresh'&&await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false)){await fs.writeFile(${JSON.stringify(entered)},'entered');while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));}return resolve.apply(this,args);};
process.once('SIGTERM',()=>{setTimeout(()=>{void fs.writeFile(${JSON.stringify(release)},'closing');},50);});
let summarySettled=false;
for(const method of ['compactConversation','navigateConversationTree']){const original=Controller.prototype[method];Controller.prototype[method]=async function(...args){await fs.appendFile(${JSON.stringify(called)},method+'\\n');const result=await original.apply(this,args);if(${JSON.stringify(boundary)}==='refresh'||${JSON.stringify(boundary)}==='switch'){await fs.writeFile(${JSON.stringify(settled)},JSON.stringify(result));await fs.writeFile(${JSON.stringify(settled+'.done')},'settled');summarySettled=${JSON.stringify(boundary)}==='refresh';}return result;};}
const history=Controller.prototype.getConversationHistory;Controller.prototype.getConversationHistory=async function(...args){if(summarySettled&&!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false)){await fs.writeFile(${JSON.stringify(entered)},'entered');while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));}return history.apply(this,args);};
`);
 const copy=locale==='ko'?{complete:'응답 완료',cancelling:'히스토리 작업 취소 중',cancelled:'히스토리 작업 취소됨',closing:'Gitjig 종료 중'}:{complete:'Response complete',cancelling:'Cancelling history action',cancelled:'History action cancelled',closing:'Closing Gitjig'};
 const expectedCount=boundary==='model'?1:2;
 const draft='PRESERVED newer 한글 draft',steps=boundary==='switch'?[
  {wait:'/ready',send:'Create genuine history\x1b\r'},
  {wait:copy.complete,waitIdle:true,releaseFile:hold,send:draft+'\x07h'},
  {wait:'Session Tree',send:'\r'},
  {wait:locale==='ko'?'히스토리 분기 여는 중':'Opening history branch',waitFiles:[{path:entered,value:'entered'}],assertDraft:draft,expectedInputs:1,send:'\x07c'},
  {wait:'Conversations',send:'Other conversation\r'},
  {wait:'OTHER exact draft',assertDraft:'OTHER exact draft',expectedInputs:1,expectedSelected:other.conversationId,send:'\x07c'},
  {wait:'Conversations',releaseFile:release,send:''},
  {wait:locale==='ko'?'대화 대기':'Conversation idle',waitFiles:[{path:probe,value:JSON.stringify({target:view.conversationId,pending:true})}],queries:[{sql:"SELECT COUNT(*) FROM runs WHERE phase='SETTLED'",rows:[[2]]}],assertDraft:'OTHER exact draft',expectedInputs:2,expectedSelected:other.conversationId,send:'\x1b'},
  {wait:'OTHER exact draft',assertDraft:'OTHER exact draft',expectedInputs:2,expectedSelected:other.conversationId,send:'\x07c'},
  {wait:'Conversations',send:'History source\r'},
  {wait:draft,assertDraft:draft,expectedInputs:2,expectedSelected:view.conversationId,send:'\x07q'},
 ]:[
  {wait:'/ready',send:'Create genuine history\x1b\r'},
  {wait:copy.complete,waitIdle:true,releaseFile:hold,send:draft+'\x07'+(action==='compact'?'m':'h')},
  ...(action==='tree'?[{wait:'Session Tree',send:'\r'}]:[]),
  {wait:action==='compact'?(locale==='ko'?'대화 요약 중':'Summary in progress'):(locale==='ko'?'히스토리 분기 여는 중':'Opening history branch'),waitFiles:[{path:entered,value:'entered'}],assertDraft:draft,expectedInputs:expectedCount,terminate:close===true,send:close==='menu'?'\x07q':close?'':'\x1b'},
  {wait:close?copy.closing:copy.cancelling,releaseFile:release,send:''},
  ...(!close?[{wait:boundary==='refresh'?(locale==='ko'?'대화 요약 사용 불가':'Summary unavailable'):copy.cancelled,assertDraft:draft,expectedInputs:expectedCount,queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[expectedCount]]}],send:'\x07q'}]:[])
 ];
 const output=path.join(root,'terminal'),config=path.join(root,'driver.json');await fs.writeFile(config,JSON.stringify({
  command:[process.execPath,'--import',guard,path.resolve('dist/cli/main.js'),'conversation','ui','--home',home],
  env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',USER:'fixture',LOGNAME:'fixture',SHELL:'/bin/sh',TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',GITJIG_HOME:home,TMPDIR:path.join(home,'artifacts'),NODE_OPTIONS:'',NODE_PATH:''},
  database:path.join(home,'state/controller.sqlite'),output,timeoutSeconds:15,steps,gracefulShutdownSeconds:3
 }));
 const actual=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',config],{timeout:23000,maxBuffer:2**20})).stdout);
 assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);
 const progress=JSON.parse(await fs.readFile(output+'.progress.json'));assert.equal(progress.forceKilled,false);
 if(boundary==='model')await assert.rejects(fs.access(called),{code:'ENOENT'});
 else {
  const result=JSON.parse(await fs.readFile(settled));
  if(boundary==='refresh'){assert.equal(result.status,'unavailable');assert.ok(result.failure);assert.match(await fs.readFile(output,'utf8'),locale==='ko'?/대화 요약 사용 불가/:/Summary unavailable/);}
  else {
   assert.equal(result.status,'delivered');assert.deepEqual(JSON.parse(await fs.readFile(probe)),{target:view.conversationId,pending:true});
   assert.match(await fs.readFile(output,'utf8'),locale==='ko'?/히스토리 분기 열림 · 파일 변경 없음/:/History branch opened · files unchanged/);
   const binding=JSON.parse(await fs.readFile(probeSource));const {createHash}=await import('node:crypto');
   assert.equal(createHash('sha256').update(await fs.readFile(new URL('../../dist/ui/index.js',import.meta.url))).digest('hex'),binding.originalSHA256);
  }
 }
 assert.equal(requests.length,1);
 const reopened=await openController({installationHome:home});try{
  assert.equal(reopened.inspectConversation(view.conversationId).draft.text,draft);
  if(other){assert.equal(reopened.inspectConversation(other.conversationId).draft.text,'OTHER exact draft');assert.ok((await reopened.getConversationHistory(view.conversationId)).sessionManager.getEntries().some(e=>e.type==='custom'&&e.customType==='gitjig.owner-tree-navigation'));}
  for(const table of ['runs','conversation_inputs'])assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM '+table).n,expectedCount);
 }finally{await reopened.close();}passed=true;
});
