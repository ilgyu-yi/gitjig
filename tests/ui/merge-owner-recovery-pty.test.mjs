import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {recoveredMerge} from '../controller/merge-owner-recovery-fixture.mjs';
import {execute} from './integration-read-fixture.mjs';
test('actual terminal separately renews and reauthorizes original with default Back, no native requests or spend and preserved draft',{timeout:25000},async t=>{
 const f=await recoveredMerge(t,{candidate:true}),id=f.original.operationId,file=path.join(f.native.root,'merge-authority-terminal.json'),standing=path.join(f.native.root,'controlled-standing.json'),spent=f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed,requests=f.native.requests.length,grant=f.c.store.one('SELECT * FROM effect_delegations WHERE target=?',f.targetId);await fs.writeFile(standing,JSON.stringify({operationId:id,workId:f.workId,evidence:f.evidence}),{mode:0o600});
 const draft='KEEP 한국어',list='Retained PR merges · opening does not resume or send';
 const unchanged={sql:'SELECT consumed FROM budgets WHERE lineage=? AND kind=\'execution\'',params:[f.workId],rows:[[spent]]};
 const renewed={sql:'SELECT epoch FROM effect_delegations WHERE id=?',params:[grant.id],rows:[[2]]};
 const reauthorized={sql:'SELECT phase,grant_id,json_extract(data,\'$.grantEpoch\') FROM effect_operations WHERE id=?',params:[id],rows:[['PREPARED',grant.id,2]]};
 const steps=[{wait:'Model: not selected',send:draft+'\x07t'},{wait:'Setup and next actions',send:'More settings\r'}, {wait:'More settings and details · current and saved configuration',send:'Repository management\r'},{wait:'Repository management · owner actions',send:'Retained PR merges\r'},{wait:list,send:'owner/repo\r'}];
 const heldAction='Review original merge reauthorization';
 const held={wait:'Original PR merge reauthorization held',send:'\x1b'};
 const authorityUnchanged=[unchanged,...[['effect_operations',id],['effect_delegations',grant.id]].map(([table,record])=>{
  const sql='SELECT * FROM '+table+' WHERE id=?';
  return {sql,params:[record],rows:[Object.values(f.c.store.one(sql,record))]};
 })];
 const cancelReturn={wait:heldAction,queries:authorityUnchanged,assertDraft:draft,send:heldAction+'\r'};
 const recoveryReturn={...cancelReturn,send:'Review original merge grant renewal\r'};
 const directWorkReturn={...cancelReturn,send:heldAction+'\r'};
 const workMenu={wait:'Work recovery · #'+f.workId,queries:authorityUnchanged,assertDraft:draft,send:'\x1b'};
 const openWork={wait:'Choose a recovery entry',send:'Open original work recovery and allowances\r'};
 steps.push({wait:heldAction,send:heldAction+'\r'},held,cancelReturn,
  {...held,wait:'Open recovery options',send:'\r'},
  {wait:'Choose a recovery entry',send:'\x1b'},
  {...cancelReturn,send:'Open original work recovery\r'},openWork,workMenu,directWorkReturn,
  {...held,wait:'Open recovery options',send:'\r'},openWork,workMenu,recoveryReturn);
 const returned=[cancelReturn,directWorkReturn,recoveryReturn];
 for(const mode of ['renewal','reauthorization'])for(const accept of [false,true]){
  const renewal=mode==='renewal',action=renewal?'Review original merge grant renewal':'Review original merge reauthorization';
  const picker={wait:action,queries:renewal?[unchanged]:[unchanged,renewed],send:action+'\r'};
  if(!renewal&&!accept)returned.push(picker);
  if(!renewal||accept)steps.push(picker);
  steps.push({wait:'Owner reason for original PR merge '+mode,send:'Explicit owner '+mode+'\r'},{wait:'Continue to confirmation',send:'\r'},{wait:'Confirm original PR merge '+mode,queries:[unchanged],send:accept?(renewal?'Renew this original PR merge grant':'Reauthorize this unsent original PR merge')+'\r':'\r'});
  if(accept)steps.push({wait:'Original PR merge '+mode+' retained · prepare and send separately',queries:[unchanged,renewal?renewed:reauthorized],send:'\x1b'});
 }
 const back={wait:'Review original merge preparation',queries:[unchanged,renewed,reauthorized],assertDraft:draft,send:'Back\r'};
 returned.push(back);
 steps.push(back,{wait:list,send:'Back\r'},{wait:'Repository management · owner actions',send:'Close\r'},{wait:'More settings and details · current and saved configuration',send:'Return to request\r'},{wait:draft,assertDraft:draft,send:'\x15/quit\x1b\r'});
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
 const env={PATH:path.dirname(process.execPath),HOME:f.native.root,GITJIG_HOME:f.home,TMPDIR:f.native.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',TEST_OWNED_MERGE_ORIGIN:f.native.origin,TEST_MERGE_SEND_STANDING_FILE:standing,...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await f.c.close();
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/merge-send-preload.mjs',entry??'dist/cli/entry.js','conversation','ui','--conversation',f.conversation],env,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:22000,maxBuffer:1024*1024})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  const bytes=await fs.readFile(file+'.terminal'),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(file+'.terminal.progress.json','utf8'));
  for(const stage of returned){
   const index=steps.indexOf(stage),picker=bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');
   for(const line of ['PR merge record',id])assert.ok(picker.includes(line),'Refreshed original must show '+line);
  }
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{const current=db.prepare('SELECT * FROM effect_operations WHERE id=?').get(id),data=JSON.parse(current.data),renewed=db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(grant.id);assert.equal(current.phase,'PREPARED');assert.equal(current.grant_id,grant.id);assert.equal(renewed.epoch,2);assert.equal(data.grantEpoch,2);assert.equal(Object.hasOwn(data,'subject'),false);assert.equal(db.prepare("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'").get(f.workId).consumed,spent);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE reservation='reserved'").get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?').get(f.targetId).n,1);}finally{db.close();}assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-4500));throw error;}
});
