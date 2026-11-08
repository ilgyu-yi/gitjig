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
for(const locale of ['en','ko'])test(`Summary cancellation names only its own action while an independent response completes in ${locale}`,{timeout:20000},async t=>{
 const root=await temporaryDirectory('manual-cancel-live'),home=path.join(root,'home'),hold=path.join(root,'hold'),entered=path.join(root,'entered'),release=path.join(root,'release'),released=path.join(root,'released'),providerEntered=path.join(root,'provider-entered'),releaseProvider=path.join(root,'provider-release'),called=path.join(root,'unexpected-call');
 let passed=false;const requests=[],sockets=new Set();
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained manual/live cancellation terminal '+root);});
 const server=http.createServer(async(req,res)=>{try{
  let body='';for await(const bytes of req)body+=bytes;const index=requests.length;requests.push(JSON.parse(body));
  res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish_reason=null)=>({id:'scope-owned',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
  res.write('data: '+JSON.stringify(chunk({role:'assistant',content:index===0?'OWNED_INITIAL_HISTORY':'OWNED_LIVE_RESPONSE '}))+'\n\n');
  if(index===1){await fs.writeFile(providerEntered,'entered');while(!res.destroyed&&!await fs.access(releaseProvider).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));if(res.destroyed)return;res.write('data: '+JSON.stringify(chunk({content:'COMPLETE'}))+'\n\n');}
  res.write('data: '+JSON.stringify(chunk({},'stop'))+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){res.destroy(error);}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 const c=await openController({installationHome:home}),accounts=ApplicationAccounts.open(c);
 await accounts.configure({providers:{'scope-owned':{api:'openai-completions',apiKey:'DUMMY',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture'}]}}});await accounts.setDefault('scope-owned','fixture');const view=await new ApplicationModels(c).newConversation();await c.close();
 const guard=path.join(root,'guard.mjs');await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js',import.meta.url).href)};
import {Controller} from ${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)};
const resolve=ApplicationModels.prototype.resolve;ApplicationModels.prototype.resolve=async function(...args){
 if(await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false)&&!await fs.access(${JSON.stringify(entered)}).then(()=>true,()=>false)){
  await fs.writeFile(${JSON.stringify(entered)},'entered');while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));
  const result=await resolve.apply(this,args);await fs.writeFile(${JSON.stringify(released)},'released');return result;
 }return resolve.apply(this,args);
};
for(const name of ['compactConversation','interruptConversation']){const original=Controller.prototype[name];Controller.prototype[name]=function(...args){void fs.appendFile(${JSON.stringify(called)},name+'\\n');return original.apply(this,args);};}
`);
 const copy=locale==='ko'?{ready:'입력 대기 · Enter 전송',complete:'응답 완료',writing:'응답 작성 중',history:'히스토리 작업 취소 중',cancelled:'히스토리 작업 취소됨',stopping:'요청 중단 중'}:{ready:'Ready · Enter send',complete:'Response complete',writing:'Writing response',history:'Cancelling history action',cancelled:'History action cancelled',stopping:'Stopping request'};
 const observation=path.join(root,'current'),output=path.join(root,'terminal'),config=path.join(root,'driver.json'),newer='NEWER scope 한글 draft';
 const step=(draft,contains,send,extra={})=>({editorFocused:true,draft,contains,send,...extra});
 const steps=[
  step('',[copy.ready],'Make history\r'),
  step('',[copy.complete,'OWNED_INITIAL_HISTORY'],'\x07m',{releaseFile:hold}),
  step('',[locale==='ko'?'대화 요약 중':'Summary in progress'],'Start independent response\r',{waitFiles:[{path:entered}]}),
  step('',['OWNED_LIVE_RESPONSE',locale==='ko'?'대화 요약 중':'Summary in progress'],newer+'\x1b',{waitFiles:[{path:providerEntered}]}),
  step(newer,[copy.history],'',{releaseFile:release,absent:[copy.stopping]}),
  step(newer,[copy.writing,copy.cancelled],'',{waitFiles:[{path:released}],releaseFile:releaseProvider,absent:[copy.stopping]}),
  step(newer,[copy.complete,'OWNED_LIVE_RESPONSE COMPLETE'],'\x07q',{absent:[copy.stopping]})
 ];
 await fs.writeFile(config,JSON.stringify({cid:view.conversationId,observation,output,timeoutSeconds:12,releaseFilesOnFailure:[release,releaseProvider],
  command:[process.execPath,'--import',guard,'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',view.conversationId],
  env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',USER:'fixture',LOGNAME:'fixture',SHELL:'/bin/sh',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',TERM:'xterm-256color',TMPDIR:path.join(home,'artifacts'),NODE_OPTIONS:'',NODE_PATH:'',GITJIG_HOME:home,GITJIG_RESULT_OBSERVATION:observation},steps
 }));
 const actual=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:18000,maxBuffer:2**20})).stdout);
 assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);assert.equal(requests.length,2);await assert.rejects(fs.access(called),{code:'ENOENT'});
 const {snapshots}=JSON.parse(await fs.readFile(output+'.frames.json'));
 assert.ok(snapshots[4].frame.some(line=>/[◐◓◑◒]/u.test(line)&&line.includes(copy.history)),'Primary active line identifies history-only cancellation');
 const reopened=await openController({installationHome:home});try{
  const runs=reopened.store.all('SELECT phase,data FROM runs');assert.equal(runs.length,2);for(const row of runs){assert.equal(row.phase,'SETTLED');assert.equal(JSON.parse(row.data).outcome,'delivered');}
  assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n,2);assert.equal(reopened.inspectConversation(view.conversationId).draft.text,newer);
 }finally{await reopened.close();}passed=true;
});
