import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';
import {translator} from '../../dist/ui/i18n.js';

for(const locale of ['en','ko'])test('original terminal returns to the scoped older managed page in '+locale,{timeout:14000},async t=>{
 const f=await registryWorld(t,'change-registry-ui-','\x1b]52;c;MUST_NOT_EMIT\x07');
 const s=f.c.store, [first,,second]=f.works;
 const {conversationId:cid,generation}=f.c.createConversation({projectId:'A'});
 const draft='PRESERVE exact draft · 한글';
 f.c.setConversationLanguage({conversationId:cid,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 // Bounded catalogue fillers share existing metadata; only the two actual originals are opened.
 s.run(`WITH RECURSIVE pages(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM pages WHERE n<50)
  INSERT INTO works SELECT 'catalogue-page-'||n,project,source,predecessor,lineage,state,epoch,generation,current_result,data
  FROM works,pages WHERE id=?`,second.workId);
 s.run(`INSERT INTO change_state SELECT w.id,c.phase,c.base,c.candidate,c.plan,c.verification,c.epoch,c.data
  FROM works w JOIN change_state c ON c.work=? WHERE w.id GLOB 'catalogue-page-*'`,second.workId);
 const before=workLedger(f.c);
 await f.c.close();
 const file=path.join(f.root,'pty.json'),output=file+'.terminal',tr=translator(locale);
 const row=(wait,send)=>({wait,send,assertDraft:draft,expectedSelected:cid});
 const title=tr('change.registry.inspect'), scoped=title+' · A',older=scoped+' · '+tr('change.registry.olderPage');
 const steps=[
  row(draft,'\x07t'),row(tr('ready.title'),tr('ready.more')+'\r'),
  row(tr('ready.detailsTitle'),tr('ready.changes')+'\r'),
  row(title+' · '+tr('change.registry.allScope'),tr('change.registry.current')+'\r'),
  row(scoped,tr('change.registry.older')+'\r'),
  row(older,first.workId+'\r'),
  row(tr('change.inspectRecovery',{id:first.workId}),'\x1b'),
  row(older,second.workId+'\r'),
  row(tr('change.inspectRecovery',{id:second.workId}),'\x1b'),
  row(older,'\x1b'),
  row(tr('ready.detailsTitle'),'\x1b'),
  row(tr('ready.title'),tr('ready.returnRequest')+'\r'),
  row(draft,'\x07q'),
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs',
  'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
  env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
   LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:9,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output}));
 const execute=promisify(execFile);
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11500,maxBuffer:2**20})).stdout);
  assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 }catch(error){
  t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-5300));throw error;
 }
 const terminal=await fs.readFile(output,'utf8');
 assert.ok(!terminal.includes('\x1b]52;'));
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});
 try{
  for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows.map(row=>({...row})));
 }finally{db.close();}
});
