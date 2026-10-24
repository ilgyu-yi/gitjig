import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const execute=promisify(execFile);
test('fresh source UI edits runtime with fields and relaunch shows active setup without executing a client',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/readiness-ui-'))),home=path.join(root,'home');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained readiness UI '+root);});
 const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
 const run=async(name,steps)=>{const file=path.join(root,name+'.json');await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:5,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));const actual=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:7000,maxBuffer:2**20})).stdout);assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);};
 await run('save',[
  {wait:'Start with /ready to check setup',send:'KEEP 한국어\x07t'},
  {wait:'Setup and next actions',send:'More settings and details\r'},
  {wait:'More settings and details · current and saved configuration',send:'Saved runtime\r'},
  {wait:'Runtime setup · staged values',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'/usr/bin/false\r'},
  {wait:'Docker context',send:'NO_ENGINE\r'},
  {wait:'Runtime image',send:'latest\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged values',send:'Review and save runtime\r'},
  {wait:'Runtime setup unavailable · staged values retained',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'Runtime setup · staged values',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\r'},
  {wait:'Docker context',send:'\r'},
  {wait:'Runtime image',send:'\x15sha256:'+'0'.repeat(64)+'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged values',send:'Review and save runtime\r'},
  {wait:'Review runtime setup before applying',send:'\x1b'},
  {wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},
  {wait:'More settings and details · current and saved configuration',send:'Startup'},
  {wait:'current process kept',assertDraft:'KEEP 한국어',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'More settings and details',send:'Return to request\r'},
  {wait:'KEEP 한국어',assertDraft:'KEEP 한국어',send:'\x15/quit\x1b\r'},
 ]);
 assert.ok((await fs.readFile(path.join(root,'save.json.terminal'),'utf8')).includes('/ready setup'));
 const saved=JSON.parse(await fs.readFile(path.join(home,'config/startup.json'),'utf8'));assert.equal(saved.runtime.dockerContext,'NO_ENGINE');
 await run('relaunch',[
  {wait:'/ready setup',send:'/ready\x1b\r'},
  {wait:'Active runtime',send:'Active runtime'},
  {wait:'Active runtime',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'INPUT',send:'\x15/quit\x1b\r'},
 ]);
 const output=await fs.readFile(path.join(root,'relaunch.json.terminal'),'utf8');assert.ok(output.includes('NO_ENGINE'));
 await run('language-save',[
  {wait:'/ready setup',send:'/language ko\x1b\r'},
  {wait:'대화 언어 · ko',queries:[{sql:"SELECT json_extract(data,'$.language.replyLanguage') FROM conversation_state JOIN interaction_view ON conversation=selected",rows:[['ko']]}],send:'/quit\x1b\r'},
 ]);
 await run('language-reopen',[
  {wait:'/ready 설정',send:'/ready\x1b\r'},
  {wait:'설정과 다음 동작',send:'추가 설정과 상세 정보\r'},
  {wait:'추가 설정과 상세 정보 · 현재 설정과 저장된 설정',send:'대화 언어\r'},
  {wait:'대화 언어 · 현재 대화 · ko',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'추가 설정과 상세 정보 · 현재 설정과 저장된 설정',send:'현재 설정으로 돌아가기\r'},
  {wait:'설정과 다음 동작',send:'요청으로 돌아가기\r'},
  {wait:'입력',queries:[{sql:"SELECT json_extract(data,'$.language.replyLanguage') FROM conversation_state JOIN interaction_view ON conversation=selected",rows:[['ko']]}],send:'\x15/quit\x1b\r'},
 ]);passed=true;
});
