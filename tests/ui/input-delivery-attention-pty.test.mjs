/** Original CLI/pane and /inputs over controlled retained faults and an explicitly controlled active-view state.
 * No native active-response or provider qualification; the reviewer runtime PTY owns that proof. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath,pathToFileURL} from 'node:url';import {DatabaseSync} from 'node:sqlite';
const installedEntry=process.env.GITJIG_TEST_CLI_ENTRY;
const packageRoot=path.resolve(process.env.GITJIG_TEST_PACKAGE_ROOT??(installedEntry?path.resolve(path.dirname(await fs.realpath(installedEntry)),'../..'):'.'));
const {openController}=await import(pathToFileURL(path.join(packageRoot,'dist/controller/index.js')));
const execute=promisify(execFile),tables=['conversation_inputs','sources','works','runs','budgets'];
for(const locale of ['en','ko'])test('original '+locale+' active pane exposes retained delivery cause and /inputs without dispatch',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-input-attention-'))),home=path.join(root,'home'),draft='KEEP exact 한국어 draft';let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained input attention '+root);});
 const c=await openController({installationHome:home});const cid=c.createConversation().conversationId;
 c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 const receipt=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'ORIGINAL queued input',mode:'steer'});
 const row=c.store.one('SELECT data FROM conversation_inputs WHERE id=?',receipt.inputId);c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),routeError:'CONTROLLED_DELIVERY_CAUSE\u001b[31m\nexact retained detail'}),receipt.inputId);
 const before=Object.fromEntries(tables.map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(row=>({...row}))]));await c.close();
 const guard=path.join(root,'active-view.mjs');await fs.writeFile(guard,`import ${JSON.stringify(new URL('./readiness-no-execution.mjs',import.meta.url).href)};import {Controller} from ${JSON.stringify(pathToFileURL(path.join(packageRoot,'dist/controller/controller.js')).href)};const inspect=Controller.prototype.inspectConversation;Controller.prototype.inspectConversation=function(id){const view=inspect.call(this,id);return id===${JSON.stringify(cid)}?{...view,state:'RUNNING'}:view;};`);
 const file=path.join(root,'pty.json'),output=file+'.terminal',attention=locale==='ko'?'입력 전달 확인 필요':'Input delivery needs attention';
 const labels=locale==='ko'
  ? {list:'보관된 요청 확인',issue:'처리 대기 중인 요청 · 전달 확인 필요',diagnostic:'기록된 전달 정보',open:'복구 동작 열기',choices:'재시도하려면 모델 선택 필요 · 요청 보존',unchanged:'변경 없이 뒤로',back:'뒤로'}
  : {list:'Retained requests · separate',issue:'Queued request · delivery needs attention',diagnostic:'Recorded delivery details',open:'Open recovery actions',choices:'Choose a model before retrying · request kept',unchanged:'Back without changes',back:'Back'};
 const steps=[{wait:attention,assertDraft:draft,send:'\x07/'},{wait:locale==='en'?'Gitjig commands · search':'gitjig 명령 검색',send:'/inputs\r'},
  {wait:labels.issue,send:'\r'},{wait:labels.diagnostic,assertDraft:draft,send:'\x1b'},
  {wait:labels.list,send:'\r'},{wait:labels.open,assertDraft:draft,send:'\r'},
  {wait:labels.choices,send:labels.unchanged+'\r'},{wait:labels.open,assertDraft:draft,send:'\x1b'},
  {wait:labels.list,send:labels.back+'\r'},
  {wait:attention,assertDraft:draft,send:'\x07q'}];
 await fs.writeFile(file,JSON.stringify({command:[process.env.GITJIG_TEST_NODE??process.execPath,'--import',guard,installedEntry??path.join(packageRoot,'dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],cwd:root,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,gracefulShutdownSeconds:3,expectedInputs:1,database:path.join(home,'state/controller.sqlite'),output}));
 try{const result=JSON.parse((await execute('python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:16000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const terminal=await fs.readFile(output,'utf8');assert.ok(terminal.includes('CONTROLLED_DELIVERY_CAUSE\\u001b[31m\\nexact retained detail'));assert.match(terminal,/ORIGINAL queued input/);
 const reviewAt=terminal.indexOf(labels.diagnostic),listAt=terminal.indexOf(labels.issue),detailAt=terminal.indexOf(labels.issue,listAt+labels.issue.length);
 assert.ok(listAt>=0&&detailAt>listAt&&detailAt<reviewAt);
 const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{for(const [table,rows]of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows);assert.equal(db.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(cid).draft,draft);}finally{db.close();}passed=true;
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-4500));throw error;}
});
