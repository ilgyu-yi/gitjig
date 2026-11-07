import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fixture,git} from '../controller/local-evidence-fixture.mjs';
import {ApplicationLocalConventions,recommendedLocalConventions} from '../../dist/app/local-conventions.js';
const execute=promisify(execFile);
test('original model-free terminal discovers a retained candidate and audits a real native commit with synthetic prior check evidence',{timeout:15000},async t=>{
 const f=await fixture(t),messageFile=path.join(f.root,'message'),file=path.join(f.root,'audit-terminal.json');await fs.writeFile(messageFile,'Implement correspondence\n',{mode:0o600});new ApplicationLocalConventions(f.controller).set('p',0,recommendedLocalConventions());const receipt=await f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile});await f.native('commit','--cleanup=verbatim','-F',messageFile);const oid=await f.native('rev-parse','HEAD');await f.controller.close();
 const steps=[
  {wait:'Model: not selected',send:'/project p\x1b\r'},
  {wait:'Project selected: p',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],send:'/local\x1b\r'},
  {wait:'Local development',send:'Retained candidates and commit audit\r'},
  {wait:'Retained candidates',send:'Candidate\r'},
  {wait:'Original candidate',send:'Audit native commit\r'},
  {wait:'Trusted Git executable',send:'\x15'+git+'\r'},
  {wait:'Explicit native commit reference',send:'\x15HEAD\r'},
  {wait:'Review historical commit audit',send:'\x1b'},
  {wait:'Explicit commit audit',send:'Audit selected commit\r'},
  {wait:'Historical native commit correspondence · MATCH',queries:[{sql:'SELECT consumed,reserved FROM budgets WHERE kind=?',params:['execution'],rows:[[1,0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}],send:'\x1b'},
  {wait:'Retained candidates',send:'Back\r'},
  {wait:'Local development',send:'Close\r'},
  {wait:'INPUT',assertDraft:'/local',send:'\x15/quit\x1b\r'},
 ];
 const env={...process.env,HOME:f.root,GITJIG_HOME:f.home,GITJIG_LOCAL_GIT_BINARY:git,TMPDIR:f.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/local-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:9,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.match(output,/Historical native commit correspondence · MATCH/);assert.match(output,new RegExp(receipt.candidate.id));assert.equal(await f.native('rev-parse','HEAD'),oid);f.accept();}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}
});
