/** Original TUI, Controller and SDK request ceiling. Provider streams are controlled; no engine/live account. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID}from'node:crypto';import{execFile}from'node:child_process';import{promisify}from'node:util';
import{temporaryDirectory}from'../helpers/temporary-directory.mjs';import{nodePreloads}from'../helpers/node-preloads.mjs';
import{openController}from'../../dist/controller/index.js';import{uiText}from'../../dist/ui/i18n.js';
const execute=promisify(execFile);
for(const locale of ['en','ko'])for(const newerError of [false,true])test(`actual ${locale} request-limit error and cold reopen preserve ${newerError?'newer local error':'app recovery'} without a model final`,{timeout:30000},async t=>{
 const root=await temporaryDirectory('conversation-limit-pty'),home=path.join(root,'home'),identity=randomUUID();let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained request-limit terminal '+root);});
 const c=await openController({installationHome:home}),cid=c.createConversation().conversationId;
 c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});await c.close();
 const title=uiText(locale,'requestLimit.title',{limit:16}),details=uiText(locale,'error.details');
 const records=[];
 for(const cold of [false,true]){
  const prefix=path.join(root,cold?'cold':'live'),cfg={home,cid,identity,entered:prefix+'.entered',receipt:prefix+'.receipt.json',observation:prefix+'.observation',output:prefix+'.terminal',timeoutSeconds:10};
  const retainedDraft=newerError?'/work UNKNOWN_WORK_ID':'';
  const editor=(send,extra={})=>({selected:cid,editorFocused:true,draft:retainedDraft,send,...extra});
  const menu=(send,contains)=>({selected:cid,editorFocused:false,draft:retainedDraft,send,contains});
  const delayed=newerError&&!cold;if(delayed){cfg.releaseFile=prefix+'.release';cfg.delivered=prefix+'.delivered';cfg.releaseFilesOnFailure=[cfg.releaseFile];}
  const steps=[...(!cold?[editor('원래 @@literal 요청을 확인해 주세요.\r',{draft:''})]:[]),
   ...(delayed?[editor('/work UNKNOWN_WORK_ID\r',{draft:'',waitFiles:[{path:cfg.entered}]}),editor('',{contains:['Unknown original work'],releaseFile:cfg.releaseFile})]:[]),
   editor('\x07/',{contains:[delayed?'Unknown original work':title],...(!cold?{waitFiles:[{path:delayed?cfg.delivered:cfg.entered}]}:{})}),menu('/error\r',[uiText(locale,'command.discovery.title')]),menu(details+'\r',[uiText(locale,'error.title')]),menu('\x1b',[uiText(locale,'error.detailsTitle'),...(delayed?['Unknown original work']:[locale==='ko'?'최종 답변':'no final assistant answer'])]),menu('\x1b',[uiText(locale,'error.title')]),editor('\x07q')];
  const env={HOME:root,GITJIG_HOME:home,GITJIG_MAX_PROVIDER_REQUESTS:'16',TMPDIR:home+'/artifacts',PATH:path.dirname(process.execPath)+':/usr/bin:/bin',USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',SHELL:'/bin/sh',TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:cfg.observation};
  const file=prefix+'.json';cfg.command=[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('tests/ui/conversation-request-limit-child.mjs'),file];await fs.writeFile(file,JSON.stringify({...cfg,env,steps}));
  const actual=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:14000,maxBuffer:2**20})).stdout);
  assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);
  const result=JSON.parse(await fs.readFile(cfg.receipt,'utf8'));assert.equal(result.ownerClosed,true);assert.equal(result.requests,cold?0:16);assert.equal(result.runs.length,1);assert.equal(result.inputs.length,1);assert.equal(result.inputs[0].state,'CONSUMED');assert.ok(result.failure);records.push(result);
 }
 assert.deepEqual(records[1].failure,records[0].failure);assert.deepEqual(records[1].runs,records[0].runs);assert.deepEqual(records[1].inputs,records[0].inputs);assert.deepEqual(records[1].budgets,records[0].budgets);passed=true;
});
