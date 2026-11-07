import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {fixture} from '../contributions/fixture.mjs';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
const execute=promisify(execFile);
test('actual original GitHub terminal registers identity, tracks existing PR, explicitly refreshes and prepares local summary without raw profile or UUID',{timeout:20000},async t=>{
 const tls=await repositoryTlsFixture(t),f=await fixture({tls:tls.tls}),home=path.join(f.root,'home'),credential=path.join(f.root,'credential.json'),file=path.join(f.root,'actions-pty.json');let passed=false;t.after(()=>f.close({preserve:!passed}));f.merged.add(1);await fs.writeFile(credential,'{"token":"fixture-only"}',{mode:0o600});await f.c.close();
 const empty=[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM budgets',rows:[[0]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM effect_operations',rows:[[0]]}],retained=[...empty,{sql:'SELECT COUNT(*) FROM tracked_resources',rows:[[1]]},{sql:"SELECT COUNT(*) FROM sources WHERE json_extract(origin,'$.kind')='owner-resource-track'",rows:[[1]]}];
 const steps=[
  {wait:'Model: not selected',send:'KEEP 한국어\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'}, {wait:'More settings and details',send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Register repository\r'},
  {wait:'Repository provider',send:'github\r'},
  {wait:'Repository owner',send:'owner\r'},
  {wait:'Repository name',send:'repo\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Repository management · owner actions',queries:[...empty,{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[1]]}],send:'Registered targets\r'},
  {wait:'Registered repository targets',send:'github\r'},
  {wait:'retained identity only',send:'Track existing issue or pull request\r'},
  {wait:'Track existing GitHub resource · repository identity only',send:'pull-request\r'},
  {wait:'Existing GitHub issue / PR number',send:'1\r'},
  {wait:'Track existing GitHub resource · read requests',queries:[...empty,{sql:'SELECT COUNT(*) FROM tracked_resources',rows:[[0]]}],send:'\x1b'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'GitHub resource tracked · original identity retained',queries:retained,send:'\x1b'},
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #1\r'},
  {wait:'Retained pull-request #1',send:'Refresh selected native observations\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Native contribution refresh retained · inspect observed/unavailable outcome',queries:retained,send:'\x1b'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #1\r'},
  {wait:'Retained pull-request #1',send:'Prepare local summary revision\r'},
  {wait:'Local summary revision retained · not published',queries:[...retained,{sql:"SELECT json_extract(data,'$.complete'),json_extract(data,'$.publication') FROM summary_revisions",rows:[[1,'not-prepared']]}],send:'\x1b'},
  {wait:'Retained pull-request #1',send:'Back\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'More settings and details',assertDraft:'KEEP 한국어',send:'Return to request\r'},
  {wait:'KEEP 한국어',assertDraft:'KEEP 한국어',send:'\x15/quit\x1b\r'},
 ];
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_CONTRIBUTION_PORT:new URL(f.origin).port};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/contribution-network-only.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:16000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const text=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(text,/fixture-only/);assert.equal(f.requests.length,18);assert.ok(f.requests.every(r=>r.method==='GET'&&r.authorization==='Bearer fixture-only'));const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM contribution_observations').get().n,4);assert.equal(db.prepare('SELECT COUNT(*) n FROM summary_members').get().n,4);}finally{db.close();}passed=true;}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-15000));throw error;}
});
