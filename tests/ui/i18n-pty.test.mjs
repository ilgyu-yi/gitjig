import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
test('original terminal switches Korean chrome and project/model/account/runtime choices while preserving literal draft and zero model work',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ui-language-'))),home=path.join(root,'home'),source=path.join(root,'project');await fs.mkdir(source);
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained UI language terminal '+root);});
 const empty=[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]}];
 const file=path.join(root,'ko.json');const steps=[
  {wait:'/ready setup',send:'/language ko\x1b\r'},
  {wait:'대화 언어 · ko',send:'KEEP 한국어 literal\x07t'},
  {wait:'다음 단계 · 프로젝트 폴더 선택',queries:empty,assertDraft:'KEEP 한국어 literal',send:'\r'},
  {wait:'이 대화의 프로젝트',send:'\r'},
  {wait:'프로젝트 폴더 · 절대 경로',send:'\x15'+source+'\r'},
  {wait:'프로젝트 ID',send:'\r'},
  {wait:'다음 단계 · 모델 계정 연결',queries:empty,assertDraft:'KEEP 한국어 literal',send:'\r'},
  {wait:'모델 계정 연결 경로 선택',queries:empty,assertDraft:'KEEP 한국어 literal',send:'Pi에서 관리하는 공급자 계정\r'},
  {wait:'Pi 계정 로그인',queries:empty,send:'\x1b'},
  {wait:'설정과 다음 동작',queries:empty,assertDraft:'KEEP 한국어 literal',send:'\x1b'},
  {wait:'입력 · 대화 대기',send:'\x15/model\x1b\r'},
  {wait:'현재 대화 모델',queries:empty,send:'\x1b'},
  {wait:'입력 · 대화 대기',send:'\x15/setup runtime\x1b\r'},
  {wait:'실행 환경 설정 · 편집 중인 값',queries:empty,send:'실행 환경 항목 편집\r'},
  {wait:'Docker 실행 파일 · 실제 절대 경로',queries:empty,send:'\x1b'},
  {wait:'실행 환경 설정 · 편집 중인 값',send:'\x1b'},
  {wait:'입력 · 대화 대기',queries:empty,send:'\x15/language en\x1b\r'},
  {wait:'Reply language · en',queries:empty,send:'/quit\x1b\r'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js'],env:{...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 const actual=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:16000,maxBuffer:2**20})).stdout);
 assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);
 const output=await fs.readFile(file+'.terminal','utf8');assert.ok(output.includes('/ready 설정'));assert.ok(output.includes('Model: not selected'));
 passed=true;
});

test('account status awaited in one language cannot open a dialog after its source language changes',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ui-language-source-'))),home=path.join(root,'home'),hold=path.join(root,'hold'),entered=path.join(root,'entered'),release=path.join(root,'release'),called=path.join(root,'login-called');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained account language-source terminal '+root);});
 const guard=path.join(root,'guard.mjs');
 await fs.writeFile(guard,`import ${JSON.stringify(new URL('./readiness-no-execution.mjs',import.meta.url).href)};import fs from 'node:fs/promises';import {ApplicationAccounts} from ${JSON.stringify(new URL('../../dist/app/accounts.js',import.meta.url).href)};const status=ApplicationAccounts.prototype.status;ApplicationAccounts.prototype.status=async function(...args){if(await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false)){await fs.unlink(${JSON.stringify(hold)});await fs.writeFile(${JSON.stringify(entered)},'entered');while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));const c=this.controller,cid=c.store.one('SELECT selected FROM interaction_view').selected,view=c.inspectConversation(cid),language=c.getConversationLanguage(cid);c.setConversationLanguage({conversationId:cid,expectedGeneration:view.generation,expectedRevision:language.revision,replyLanguage:'en'});}return status.apply(this,args);};ApplicationAccounts.prototype.login=async()=>{await fs.writeFile(${JSON.stringify(called)},'called');throw Error('Stale login must not start');};`);
 const steps=[
  {wait:'/ready setup',send:'/language ko\x1b\r'},
  {wait:'대화 언어 · ko',releaseFile:hold,send:'/login openai api_key\x1b\r'},
  // The held host command owns input. Inject an independent owner-language change
  // through the real controller API when its read is released, rather than typing behind it.
  {wait:'선택한 동작을 처리하고 있습니다',waitFiles:[{path:entered,value:'entered'}],releaseFile:release,assertDraft:'/login openai api_key',send:''},
  {wait:'Account dialog source changed',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x15/quit\x1b\r'},
 ];
 const file=path.join(root,'stale-account.json');await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,'dist/cli/entry.js'],env:{...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:16000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);await assert.rejects(fs.access(called));
 const text=await fs.readFile(file+'.terminal','utf8');assert.ok(!text.includes('Secret input (hidden)'));assert.ok(!text.includes('비밀값 입력'));
 passed=true;
});
