import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
async function world(t){const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/reopen-'))),home=path.join(root,'home'),c=await openController({installationHome:home});let passed=false;t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reopen world '+root);});return{root,home,c,pass(){passed=true;}};}
async function launch(f,name,steps,args=[]){const file=path.join(f.root,name+'.json');await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/reopen-no-dispatch.mjs','dist/cli/entry.js',...(args.length?['conversation','ui','--home',f.home,...args]:[])],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:5,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal'}));const r=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:7000,maxBuffer:2**20})).stdout);assert.equal(r.exitCode,0);assert.equal(r.stages,steps.length);assert.equal(r.terminalRestored,true);return fs.readFile(file+'.terminal','utf8');}
test('bare source CLI reopens exact selected conversation and draft; explicit ID and project retain their routing',{timeout:15000},async t=>{
 const f=await world(t),a=f.c.createConversation(),b=f.c.createConversation(),draft='Retained 한국어\nSecond line';await fs.mkdir(path.join(f.root,'project'));await f.c.registerProject({id:'P',sourceRoot:path.join(f.root,'project')});
 f.c.setConversationName({conversationId:a.conversationId,expectedGeneration:0,name:'REOPEN_SOURCE'});f.c.setConversationName({conversationId:b.conversationId,expectedGeneration:0,name:'EXPLICIT_OTHER'});f.c.setDraft({conversationId:a.conversationId,expectedRevision:0,text:draft});f.c.setConversationView({selectedId:a.conversationId,secondId:b.conversationId});
 f.c.store.run('UPDATE conversation_state SET human_used=? WHERE conversation=?',Date.now()+10000,b.conversationId);await f.c.close();
 await launch(f,'bare',[{wait:'Reopened retained conversation',assertDraft:draft,expectedSelected:a.conversationId,queries:[{sql:'SELECT COUNT(*) FROM conversations',rows:[[2]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],terminate:true,send:''}]);
 await launch(f,'explicit',[{wait:'EXPLICIT_OTHER',assertDraft:'',expectedSelected:b.conversationId,terminate:true,send:''}],['--conversation',b.conversationId]);
 await launch(f,'project',[{wait:'Investigation',assertDraft:'',queries:[{sql:'SELECT COUNT(*) FROM conversations',rows:[[3]]},{sql:'SELECT c.project FROM conversations c JOIN interaction_view v ON c.id=v.selected',rows:[['P']]}],terminate:true,send:''}],['--project','P']);f.pass();
});
test('recovery-held legacy conversation opens without rebinding, spending allowance or resuming retained dependencies',{timeout:10000},async t=>{
 const f=await world(t),a=f.c.createConversation(),draft='Keep uncertain owner input',goal=f.c.createGoal({conversationId:a.conversationId,objective:'Retained objective',criteria:['Retain exact state'],turnLimit:3});
 f.c.setConversationView({selectedId:a.conversationId});f.c.setDraft({conversationId:a.conversationId,expectedRevision:0,text:draft});await f.c.setConversationModelChoice({conversationId:a.conversationId,expectedGeneration:0,expectedRevision:0,choice:{kind:'legacy-external',provider:'reopen-external',modelId:'original'}});
 const st=JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?',a.conversationId).data);const marker={format:'gitjig-native-input-recovery-1',runId:'UNBOUND_FIXTURE',generation:0,reason:'queue-disposition-uncertain'};
 // Controlled retained disposition; not an actual generated model result.
 f.c.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?','UNKNOWN',JSON.stringify({...st,nativeInputRecovery:marker,continuationAuthorized:true,waitHandles:['UNBOUND_FIXTURE']}),a.conversationId);const waiting=f.c.createConversation();f.c.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?','WAITING',JSON.stringify({continuationAuthorized:true,waitHandles:['UNBOUND_FIXTURE']}),waiting.conversationId);const before=JSON.stringify(f.c.inspectGoal(goal.goalId));await f.c.close();
 const output=await launch(f,'uncertain',[{wait:'external profile required',assertDraft:draft,expectedSelected:a.conversationId,terminate:true,send:''}]);assert.ok(output.includes('Execution outcome needs recovery'));
 const c=await openController({installationHome:f.home});try{assert.equal(JSON.stringify(c.inspectGoal(goal.goalId)),before);assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?',a.conversationId).data).nativeInputRecovery,marker);assert.equal(c.getConversationModelChoice(a.conversationId).kind,'legacy-external');assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);assert.equal(c.inspectConversation(waiting.conversationId).state,'WAITING');assert.equal(JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?',waiting.conversationId).data).continuationAuthorized,true);assert.throws(()=>c.queueConversationInput({conversationId:a.conversationId,expectedGeneration:0,text:'Cannot execute yet',mode:'idle'}),/NATIVE_INPUT_RECOVERY_REQUIRED/);}finally{await c.close();}f.pass();
});
test('entry fallback ignores stale selection and never-viewed background roles; fresh home still creates a usable view',{timeout:10000},async t=>{
 const f=await world(t),a=f.c.createConversation(),b=f.c.createConversation();f.c.setConversationView({selectedId:a.conversationId});await f.c.archiveConversation({conversationId:a.conversationId,expectedGeneration:0});f.c.store.run('UPDATE interaction_view SET selected=?',a.conversationId);
 assert.equal(f.c.inspectConversationEntry(),undefined);f.c.setConversationView({selectedId:b.conversationId});f.c.store.run('UPDATE interaction_view SET selected=NULL');const before=f.c.inspectConversation(b.conversationId);assert.deepEqual(f.c.inspectConversationEntry(),{conversationId:b.conversationId,reason:'recent-view'});assert.deepEqual(f.c.inspectConversation(b.conversationId),before);await f.c.close();
 await launch(f,'fallback',[{wait:'Reopened retained conversation',assertDraft:'',expectedSelected:b.conversationId,terminate:true,send:''}]);f.pass();
 const fresh=await world(t);await fresh.c.close();await launch(fresh,'fresh',[{wait:'Model: not selected',queries:[{sql:'SELECT COUNT(*) FROM conversations',rows:[[1]]}],terminate:true,send:''}]);fresh.pass();
});

test('archive, restore and deletion outcomes remain visible after switching conversations',{timeout:10000},async t=>{
 const f=await world(t),a=f.c.createConversation(),b=f.c.createConversation();f.c.setConversationView({selectedId:a.conversationId});await f.c.close();
 await launch(f,'delete-notice',[
  {wait:'/ready',send:'\x07l'},
  {wait:'Conversation lifecycle',send:'\x1b[B\r'},
  {wait:'Conversation archived',expectedSelected:b.conversationId,assertDraft:'',send:'\x07l'},
  {wait:'Conversation lifecycle',send:'\x1b[B\x1b[B\x1b[B\r'},
  {wait:'Restored '+a.conversationId,expectedSelected:a.conversationId,assertDraft:'',send:'\x07l'},
  {wait:'Conversation lifecycle',send:'\x1b[B\x1b[B\r'},
  {wait:'Retain evidence; permanently deny execution',send:'\x1b[B\r'},
  {wait:'Conversation deleted',expectedSelected:b.conversationId,assertDraft:'',queries:[{sql:"SELECT json_extract(data,'$.lifecycle.deleted.conversationId') FROM conversation_state WHERE conversation=?",params:[a.conversationId],rows:[[a.conversationId]]}],send:'/quit\x1b\r'},
 ]);f.pass();
});

test('lifecycle restores the exact named archive among duplicate display names without losing drafts',{timeout:10000},async t=>{
 const f=await world(t),owner=f.c.createConversation(),first=f.c.createConversation(),second=f.c.createConversation();
 for(const archived of [first,second]){
  f.c.setConversationName({conversationId:archived.conversationId,expectedGeneration:0,name:'Archived 한국어 same name'});
  f.c.setDraft({conversationId:archived.conversationId,expectedRevision:0,text:archived===first?'FIRST_ARCHIVE_KEEP':'SECOND_ARCHIVE_KEEP'});
  await f.c.archiveConversation({conversationId:archived.conversationId,expectedGeneration:0});
 }
 f.c.setConversationView({selectedId:owner.conversationId});
 f.c.setDraft({conversationId:owner.conversationId,expectedRevision:0,text:'OWNER_DRAFT_KEEP'});
 await f.c.close();
 const output=await launch(f,'named-archive',[
  {wait:'OWNER_DRAFT_KEEP',assertDraft:'OWNER_DRAFT_KEEP',expectedSelected:owner.conversationId,send:'\x07l'},
  {wait:'Archived 한국어 same name',assertDraft:'OWNER_DRAFT_KEEP',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b[B\x1b[B\x1b[B\x1b[B\r'},
  {wait:'Restored '+second.conversationId,assertDraft:'SECOND_ARCHIVE_KEEP',expectedSelected:second.conversationId,queries:[{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],terminate:true,send:''},
 ]);
 assert.ok(output.includes(first.conversationId),'First matching archive has its full identity in the actual dialog');
 assert.ok(output.includes(second.conversationId),'Second matching archive has its full identity in the actual dialog');
 const c=await openController({installationHome:f.home});
 try{
  assert.equal(c.inspectConversation(first.conversationId).archived,true);
  assert.equal(c.inspectConversation(first.conversationId).draft.text,'FIRST_ARCHIVE_KEEP');
  assert.equal(c.inspectConversation(second.conversationId).archived,false);
  assert.equal(c.inspectConversation(owner.conversationId).draft.text,'OWNER_DRAFT_KEEP');
 }finally{await c.close();}
 f.pass();
});
