import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {fixture,resource} from '../contributions/fixture.mjs';
const execute=promisify(execFile);
test('original no-execution terminal discovers retained GitHub PR, inspects, explicitly prepares local summary and reopens without refresh',{timeout:20000},async t=>{
 const f=await fixture();let passed=false;t.after(()=>f.close({preserve:!passed}));f.merged.add(1);const pr=await f.c.trackRepositoryResource(resource(1)),source=f.c.createConversation().conversationId,home=path.join(f.root,'home'),dbfile=path.join(home,'state/controller.sqlite'),calls=f.calls;
 const tables=['tracked_resources','resource_links','contribution_observations','works','sources','requirements','runs','budgets','effect_operations','effect_receipts'];
 const retained=tables.map(table=>({table,rows:f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')})),queries=retained.map(({table,rows})=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:rows.map(row=>Object.values(row))}));await f.c.close();
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
 const run=async(label,steps)=>{const file=path.join(f.root,label+'.json');await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js','conversation','ui','--conversation',source],env,steps,timeoutSeconds:7,expectedInputs:0,database:dbfile,output:file+'.terminal',gracefulShutdownSeconds:3}));try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const text=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(text,/fixture-only/);return text;}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-12000));throw error;}};
 const output=await run('prepare',[
  {wait:'Model: not selected',send:'KEEP 한국어\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'}, {wait:'More settings and details',send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',queries:[...queries,{sql:'SELECT COUNT(*) FROM summary_revisions',rows:[[0]]}],send:'pull-request #1\r'},
  {wait:'Retained pull-request #1',send:'Inspect retained observations\r'},
  {wait:'Retained contribution observations · not current remote state or approval',queries:[...queries,{sql:'SELECT COUNT(*) FROM summary_revisions',rows:[[0]]}],send:'\x1b'},
  {wait:'Retained pull-request #1',send:'Prepare local summary revision\r'},
  {wait:'Local summary revision retained · not published',queries:[...queries,{sql:"SELECT json_extract(data,'$.complete'),json_extract(data,'$.publication') FROM summary_revisions",rows:[[1,'not-prepared']]}],send:'\x1b'},
  {wait:'Retained pull-request #1',send:'Back\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'More settings and details',assertDraft:'KEEP 한국어',send:'Return to request\r'},
  {wait:'KEEP 한국어',assertDraft:'KEEP 한국어',send:'\x15/quit\x1b\r'},
 ]);assert.match(output,new RegExp(pr.resourceId));
 const db=new DatabaseSync(dbfile,{readOnly:true});let summaries,members;try{summaries=db.prepare('SELECT * FROM summary_revisions').all();members=db.prepare('SELECT * FROM summary_members').all();assert.equal(summaries.length,1);assert.ok(members.length>0);}finally{db.close();}
 await run('reopen',[
  {wait:'Model: not selected',send:'\x15/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #1\r'},
  {wait:'Retained pull-request #1',send:'Inspect retained observations\r'},
  {wait:'Retained contribution observations',queries:[...queries,{sql:'SELECT * FROM summary_revisions',rows:summaries.map(row=>Object.values(row))},{sql:'SELECT * FROM summary_members',rows:members.map(row=>Object.values(row))}],send:'\x1b'},
  {wait:'Retained pull-request #1',send:'Back\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'INPUT',send:'\x15/quit\x1b\r'},
 ]);assert.equal(f.calls,calls);passed=true;
});
