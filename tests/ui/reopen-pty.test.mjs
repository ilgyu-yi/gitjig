import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {seedForkUI} from './fork-fixture.mjs';
import {nodePreloads} from '../helpers/node-preloads.mjs';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);
const cli=process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js';
const controllerModule=new URL('../controller/controller.js',pathToFileURL(await fs.realpath(cli))).href;
async function world(t){const root=await temporaryDirectory('reopen'),home=path.join(root,'home'),c=await openController({installationHome:home});let passed=false;t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reopen world '+root);});return{root,home,c,pass(){passed=true;}};}
async function launch(f, name, steps, args = [], columns = 140, preload) {
 const file = path.join(f.root, name + '.json');
 const guard = process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : [];
 const command = [process.execPath, ...nodePreloads(), ...guard, '--import', './tests/ui/reopen-no-dispatch.mjs',
  ...(preload ? ['--import', preload] : []), cli,
  ...(args.length ? ['conversation', 'ui', '--home', f.home, ...args] : [])];
 await fs.writeFile(file, JSON.stringify({
  command, env: {...process.env, HOME:f.root, GITJIG_HOME:f.home, PATH:path.dirname(process.execPath), TERM:'xterm-256color', NODE_OPTIONS:'', NODE_PATH:''},
  steps, columns, timeoutSeconds:5, expectedInputs:0, database:path.join(f.home, 'state/controller.sqlite'), output:file+'.terminal',
 }));
 const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout:7000, maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode, 0);
 assert.equal(result.stages, steps.length);
 assert.equal(result.terminalRestored, true);
 return fs.readFile(file + '.terminal', 'utf8');
}
test('bare source CLI reopens exact selected conversation and draft; explicit ID and project retain their routing',{timeout:15000},async t=>{
 const f=await world(t),a=f.c.createConversation(),b=f.c.createConversation(),draft='Retained 한국어\nSecond line',secondDraft='Retained second draft';await fs.mkdir(path.join(f.root,'project'));await f.c.registerProject({id:'P',sourceRoot:path.join(f.root,'project')});
 f.c.setConversationName({conversationId:a.conversationId,expectedGeneration:0,name:'REOPEN_SOURCE'});f.c.setConversationName({conversationId:b.conversationId,expectedGeneration:0,name:'EXPLICIT_OTHER'});f.c.setDraft({conversationId:a.conversationId,expectedRevision:0,text:draft});f.c.setConversationView({selectedId:a.conversationId,secondId:b.conversationId});
 f.c.setDraft({conversationId:b.conversationId,expectedRevision:0,text:secondDraft});
 f.c.store.run('UPDATE conversation_state SET human_used=? WHERE conversation=?',Date.now()+10000,b.conversationId);await f.c.close();
 const pair=(selected,second)=>({sql:'SELECT selected,second FROM interaction_view',rows:[[selected,second]]});
 const noRuns={sql:'SELECT COUNT(*) FROM runs',rows:[[0]]};
 const bare=await launch(f,'bare',[{wait:secondDraft,assertDraft:draft,expectedSelected:a.conversationId,queries:[pair(a.conversationId,b.conversationId),{sql:'SELECT COUNT(*) FROM conversations',rows:[[2]]},noRuns],terminate:true,send:''}]);
 assert.match(bare,/Reopened retained conversation/);
 await launch(f,'narrow',[{wait:'side by side needs 100 columns',assertDraft:draft,queries:[pair(a.conversationId,b.conversationId),noRuns],send:'\x07w'},
  {wait:secondDraft,assertDraft:secondDraft,queries:[pair(b.conversationId,a.conversationId),noRuns],send:'\x07w'},
  {wait:'REOPEN_SOURCE',assertDraft:draft,queries:[pair(a.conversationId,b.conversationId),noRuns],terminate:true,send:''}],[],80);
 await launch(f,'explicit',[{wait:'EXPLICIT_OTHER',assertDraft:secondDraft,expectedSelected:b.conversationId,queries:[pair(b.conversationId,null),noRuns],terminate:true,send:''}],['--conversation',b.conversationId]);
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
 assert.equal(f.c.inspectConversationEntry(),undefined);
 f.c.setConversationView({selectedId:b.conversationId,secondId:b.conversationId});
 assert.deepEqual(f.c.inspectConversationEntry(),{conversationId:b.conversationId,reason:'last-view'});
 f.c.store.run('UPDATE interaction_view SET second=?',a.conversationId);
 assert.deepEqual(f.c.inspectConversationEntry(),{conversationId:b.conversationId,reason:'last-view'});
 f.c.store.run('UPDATE interaction_view SET selected=NULL');
 const before=f.c.inspectConversation(b.conversationId);
 assert.deepEqual(f.c.inspectConversationEntry(),{conversationId:b.conversationId,reason:'recent-view'});
 assert.deepEqual(f.c.inspectConversation(b.conversationId),before);await f.c.close();
 await launch(f,'fallback',[{wait:'Reopened retained conversation',assertDraft:'',expectedSelected:b.conversationId,terminate:true,send:''}]);f.pass();
 const fresh=await world(t);await fresh.c.close();await launch(fresh,'fresh',[
  {wait:'Model: not selected',queries:[{sql:'SELECT COUNT(*) FROM conversations',rows:[[1]]}],send:'\x1bOS'},
  {wait:'Use /new to open another conversation',queries:[{sql:'SELECT COUNT(*) FROM conversations',rows:[[1]]},{sql:'SELECT second FROM interaction_view',rows:[[null]]}],terminate:true,send:''},
 ]);fresh.pass();
});

test('unavailable saved second-pane history leaves both the original and surviving pane editable',{timeout:10000},async t=>{
 const f=await world(t),a=f.c.createConversation(),b=f.c.createConversation(),draft='Primary editable draft';
 const retainedScroll={entryId:'01ace234',offset:6,followEnd:false};
 f.c.setConversationView({selectedId:a.conversationId,secondId:b.conversationId});
 f.c.setDraft({conversationId:a.conversationId,expectedRevision:0,text:draft});
 f.c.setScroll({conversationId:b.conversationId,...retainedScroll});
 f.c.store.run('UPDATE conversations SET history=? WHERE id=?',path.join(f.home,'missing-session.jsonl'),b.conversationId);
 await f.c.close();
 await launch(f,'secondary-history',[
  {wait:'/error · Required native history checkpoint',assertDraft:draft,expectedSelected:a.conversationId,send:' editable'},
  {wait:'draft editable',assertDraft:draft+' editable',expectedSelected:a.conversationId,queries:[
   {sql:'SELECT selected,second FROM interaction_view',rows:[[a.conversationId,b.conversationId]]},
   {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
  ],send:'\x07l'},
  {wait:'Conversation lifecycle',send:'\x1b[B\r'},
  {wait:'Conversation archived',assertDraft:'',expectedSelected:b.conversationId,send:'Survivor remains editable'},
  {wait:'Survivor remains editable',assertDraft:'Survivor remains editable',expectedSelected:b.conversationId,queries:[
   {sql:'SELECT selected,second FROM interaction_view',rows:[[b.conversationId,null]]},
   {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
  ],send:'\x07q'},
 ]);
 const reopened=await openController({installationHome:f.home});
 try{assert.deepEqual(reopened.inspectConversation(b.conversationId).scroll,retainedScroll);}
 finally{await reopened.close();}
 f.pass();
});

test('unavailable history stays on the destination after /resume and on direct reopen',{timeout:10000},async t=>{
 const f=await world(t),a=f.c.createConversation(),b=f.c.createConversation(),draft='Retained destination draft';
 f.c.setConversationName({conversationId:a.conversationId,expectedGeneration:0,name:'HEALTHY_SOURCE'});
 f.c.setConversationName({conversationId:b.conversationId,expectedGeneration:0,name:'HISTORY_UNAVAILABLE'});
 f.c.setConversationView({selectedId:a.conversationId});
 f.c.setDraft({conversationId:b.conversationId,expectedRevision:0,text:draft});
 f.c.setConversationParent({childId:b.conversationId,parentId:a.conversationId,expectedRevision:0});
 f.c.store.run('UPDATE conversations SET history=? WHERE id=?',path.join(f.home,'missing-session.jsonl'),b.conversationId);
 await f.c.close();
 const sourceDraft={sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[a.conversationId],rows:[['']]};
 const noRuns={sql:'SELECT COUNT(*) FROM runs',rows:[[0]]};
 await launch(f,'resume-unavailable',[
  {wait:'HEALTHY_SOURCE',assertDraft:'',expectedSelected:a.conversationId,send:'/resume '+b.conversationId+'\x1b\r'},
  {wait:'/error · Required native history checkpoint',assertDraft:draft,expectedSelected:b.conversationId,
   queries:[sourceDraft,noRuns],send:'\x1bOQ'},
  {wait:'Conversations',send:a.conversationId+'\r'},
  {wait:'HEALTHY_SOURCE',assertDraft:'',expectedSelected:a.conversationId,queries:[sourceDraft,noRuns],send:'\x07e'},
  {wait:'No retained error details for this conversation',assertDraft:'',expectedSelected:a.conversationId,send:'\x07q'},
 ]);
 await launch(f,'direct-unavailable',[
  {wait:'/error · Required native history checkpoint',assertDraft:draft,expectedSelected:b.conversationId,queries:[noRuns],send:' editable'},
  {wait:draft+' editable',assertDraft:draft+' editable',expectedSelected:b.conversationId,queries:[noRuns],send:'\x07q'},
 ],['--conversation',b.conversationId]);
 await launch(f,'notice-unavailable',[
  {wait:'HEALTHY_SOURCE',assertDraft:'',expectedSelected:a.conversationId,send:'\x1b[15~'},
  {wait:'Conversation notices',send:'\r'},
  {wait:'/error · Required native history checkpoint',assertDraft:draft+' editable',expectedSelected:b.conversationId,
   queries:[{sql:"SELECT COUNT(*) FROM conversation_notifications WHERE target=? AND state<>'ACKNOWLEDGED'",params:[a.conversationId],rows:[[1]]},noRuns],send:'\x07q'},
 ],['--conversation',a.conversationId]);
 f.pass();
});

for(const outcome of ['failure','success'])test(`a late background history ${outcome} cannot replace a newer exact open`,{timeout:10000},async t=>{
 const f=await world(t),{source:history,sibling:initial}=await seedForkUI(f.c,f.root,f.home);
 f.c.setConversationView({selectedId:initial.conversationId,secondId:history.conversationId});
 const draft='Preserve exact history-pane draft';
 f.c.setDraft({conversationId:history.conversationId,expectedRevision:0,text:draft});
 await f.c.close();
 const fixture={target:history.conversationId,parent:initial.conversationId,
  trigger:path.join(f.root,'trigger'),entered:path.join(f.root,'entered'),release:path.join(f.root,'release'),finished:path.join(f.root,'finished'),fresh:path.join(f.root,'fresh')};
 const obsolete='Controlled older history read '+outcome;
 const guard=path.join(f.root,'held-history.mjs');
 await fs.writeFile(guard,`import fs from 'node:fs';
import {Controller} from ${JSON.stringify(controllerModule)};
const fixture=${JSON.stringify(fixture)};
const outcome=${JSON.stringify(outcome)}, obsolete=${JSON.stringify(obsolete)};
let triggered=false,held=false;
const getHistory=Controller.prototype.getConversationHistory;
Controller.prototype.getConversationHistory=async function(id){
 if(id===fixture.target&&triggered&&!held){
  held=true;
  const original=await getHistory.call(this,id);
  fs.writeFileSync(fixture.entered,'held');
  while(!fs.existsSync(fixture.release))await new Promise(resolve=>setTimeout(resolve,5));
  fs.writeFileSync(fixture.finished,outcome);
  if(outcome==='failure')throw Error(obsolete);
  const old=original.sessionManager.constructor.inMemory(original.cwd);
  old.appendMessage({role:'user',content:obsolete,timestamp:1});
  return {cwd:original.cwd,sessionManager:old};
 }
 const result=await getHistory.call(this,id);
 if(id===fixture.target&&held)fs.writeFileSync(fixture.fresh,'loaded');
 return result;
};
const subscribe=Controller.prototype.subscribeInteraction;
Controller.prototype.subscribeInteraction=function(listener){
 const stop=subscribe.call(this,listener);
 const timer=setInterval(()=>{
  if(!fs.existsSync(fixture.trigger))return;
  clearInterval(timer);
  triggered=true;
  this.setConversationParent({childId:fixture.target,parentId:fixture.parent,expectedRevision:0});
 },5);
 timer.unref();
 return ()=>{clearInterval(timer);stop();};
};
`);
 const noRuns={sql:'SELECT COUNT(*) FROM runs',rows:[[0]]};
 const sameGeneration={sql:'SELECT generation FROM conversations WHERE id=?',params:[history.conversationId],rows:[[history.generation]]};
 const output=await launch(f,'late-history-'+outcome,[
  {wait:'FIXTURE_SECOND_CONTEXT',assertDraft:'SIBLING_KEEP',expectedSelected:initial.conversationId,releaseFile:fixture.trigger,send:''},
  {wait:'',waitFiles:[{path:fixture.entered,value:'held'}],send:'\x1bOQ'},
  {wait:'Conversations',send:history.conversationId+'\r'},
  {wait:'FIXTURE_SECOND_CONTEXT',assertDraft:draft,expectedSelected:history.conversationId,queries:[noRuns,sameGeneration],
   waitFiles:[{path:fixture.fresh,value:'loaded'}],releaseFile:fixture.release,send:''},
  {wait:'',waitFiles:[{path:fixture.finished,value:outcome}],send:'\x07e'},
  {wait:'No retained error details for this conversation',assertDraft:draft,expectedSelected:history.conversationId,queries:[noRuns,sameGeneration],send:'\x07q'},
 ],[],140,guard);
 assert.ok(!output.includes(obsolete));
 f.pass();
});

for(const route of ['resume','picker','split'])test(`${route} keeps the editor usable while destination history loads`,{timeout:10000},async t=>{
 const f=await world(t),{source:destination,sibling:initial}=await seedForkUI(f.c,f.root,f.home);
 const draft='Destination draft',sourceDraft=route==='resume'?'':'SIBLING_KEEP';
 f.c.setConversationView({selectedId:initial.conversationId});
 f.c.setDraft({conversationId:destination.conversationId,expectedRevision:0,text:draft});
 if(route==='resume')f.c.setDraft({conversationId:initial.conversationId,expectedRevision:1,text:''});
 await f.c.close();
 const guard=path.join(f.root,'held-history.mjs'),entered=path.join(f.root,'entered'),release=path.join(f.root,'release');
 await fs.writeFile(guard,`import fs from 'node:fs';
import {Controller} from ${JSON.stringify(controllerModule)};
const target=${JSON.stringify(destination.conversationId)}, entered=${JSON.stringify(entered)}, release=${JSON.stringify(release)};
const getHistory=Controller.prototype.getConversationHistory;
Controller.prototype.getConversationHistory=async function(id){
 if(id===target&&!fs.existsSync(release)){
  fs.writeFileSync(entered,'held');
  while(!fs.existsSync(release))await new Promise(resolve=>setTimeout(resolve,5));
 }
 return getHistory.call(this,id);
};
`);
 const split=route==='split',active=split?initial.conversationId:destination.conversationId;
 const activeDraft=split?sourceDraft:draft;
 const ledger=[
  {sql:'SELECT selected,second FROM interaction_view',rows:[[active,split?destination.conversationId:null]]},
  {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
  ...(split?[]:[{sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[initial.conversationId],rows:[[sourceDraft]]}]),
 ];
 const open=route==='resume'?'/resume '+destination.conversationId+'\x1b\r':split?'\x1bOS':'\x1bOQ';
 await launch(f,'navigate-loading',[
  {wait:'UI_SIBLING',assertDraft:sourceDraft,expectedSelected:initial.conversationId,send:open},
  ...route==='resume'?[]:[{wait:split?'choose the second pane':'Conversations',send:destination.conversationId+'\r'}],
  {wait:'Loading conversation history',assertDraft:activeDraft,expectedSelected:active,waitFiles:[{path:entered,value:'held'}],queries:ledger,send:' edited'},
  {wait:activeDraft+' edited',assertDraft:activeDraft+' edited',expectedSelected:active,queries:ledger,releaseFile:release,send:''},
  {wait:'FIXTURE_SECOND_CONTEXT',assertDraft:activeDraft+' edited',expectedSelected:active,queries:ledger,send:'\x07q'},
 ],[],140,guard);
 f.pass();
});

for(const action of ['edit','quit'])test(`startup allows ${action} while both saved-pane history reads are pending`,{timeout:10000},async t=>{
 const f=await world(t),{source,sibling}=await seedForkUI(f.c,f.root,f.home);
 const draft='Startup draft to keep';
 f.c.setDraft({conversationId:source.conversationId,expectedRevision:0,text:draft});
 await f.c.close();
 const release=path.join(f.root,'release-startup'),guard=path.join(f.root,'held-startup.mjs');
 const entered=Object.fromEntries([source,sibling].map(view=>[view.conversationId,path.join(f.root,view.conversationId+'.entered')]));
 await fs.writeFile(guard,`import fs from 'node:fs';
import {Controller} from ${JSON.stringify(controllerModule)};
const marker=${JSON.stringify(entered)},release=${JSON.stringify(release)};
const getHistory=Controller.prototype.getConversationHistory;
Controller.prototype.getConversationHistory=async function(id){
 if(marker[id]&&!fs.existsSync(release)){
  fs.writeFileSync(marker[id],'held');
  while(!fs.existsSync(release))await new Promise(resolve=>setTimeout(resolve,5));
 }
 const result=await getHistory.call(this,id);
 if(marker[id])fs.writeFileSync(marker[id]+'.loaded','loaded');
 return result;
};
`);
 const noRuns={sql:'SELECT COUNT(*) FROM runs',rows:[[0]]};
 await launch(f,'concurrent-startup',[
  {wait:'Loading conversation history',assertDraft:draft,expectedSelected:source.conversationId,
   waitFiles:Object.values(entered).map(path=>({path,value:'held'})),queries:[noRuns],send:action==='edit'?' edited':'\x07q'},
  ...action==='edit'?[
   {wait:draft+' edited',assertDraft:draft+' edited',expectedSelected:source.conversationId,queries:[noRuns],send:'\x07w'},
   {wait:'INPUT ·',assertDraft:'SIBLING_KEEP',expectedSelected:sibling.conversationId,queries:[noRuns],send:'\x07w'},
   {wait:'INPUT ·',assertDraft:draft+' edited',expectedSelected:source.conversationId,queries:[noRuns],releaseFile:release,send:''},
   {wait:'FIXTURE_SECOND_CONTEXT',assertDraft:draft+' edited',expectedSelected:source.conversationId,queries:[noRuns],send:'\x07q'},
  ]:[{wait:'Closing Gitjig',releaseFile:release,send:''}],
 ],[],140,guard);
 for(const file of Object.values(entered))assert.equal(await fs.readFile(file+'.loaded','utf8'),'loaded');
 f.pass();
});

for(const columns of [140,80])test(`archive and deletion keep the surviving pane usable at ${columns} columns`,{timeout:10000},async t=>{
 const f=await world(t),a=f.c.createConversation(),b=f.c.createConversation(),unrelated=f.c.createConversation();
 f.c.setConversationView({selectedId:a.conversationId,secondId:b.conversationId});
 f.c.setDraft({conversationId:a.conversationId,expectedRevision:0,text:'ARCHIVE_OWNER_DRAFT'});
 f.c.setDraft({conversationId:b.conversationId,expectedRevision:0,text:'SURVIVOR_DRAFT'});
 f.c.store.run('UPDATE conversation_state SET human_used=? WHERE conversation=?',Date.now()+10000,unrelated.conversationId);
 await f.c.close();
 const pair=(selected,second)=>({sql:'SELECT selected,second FROM interaction_view',rows:[[selected,second]]});
 const splitNotice=columns>=100?'SURVIVOR_DRAFT':'side by side needs 100 columns';
 await launch(f,'delete-notice',[
  {wait:splitNotice,assertDraft:'ARCHIVE_OWNER_DRAFT',queries:[pair(a.conversationId,b.conversationId)],send:'\x07l'},
  {wait:'Conversation lifecycle',send:'\x1b[B\r'},
  {wait:'Conversation archived',assertDraft:'SURVIVOR_DRAFT',queries:[pair(b.conversationId,null)],send:'\x07l'},
  {wait:'Conversation lifecycle',send:'\x1b[B\x1b[B\x1b[B\r'},
  {wait:'Restored '+a.conversationId,assertDraft:'ARCHIVE_OWNER_DRAFT',queries:[pair(a.conversationId,null)],send:'\x1bOS'},
  {wait:'choose the second pane',send:b.conversationId+'\r'},
  {wait:splitNotice,assertDraft:'ARCHIVE_OWNER_DRAFT',queries:[pair(a.conversationId,b.conversationId)],send:'\x07l'},
  {wait:'Conversation lifecycle',send:'\x1b[B\x1b[B\r'},
  {wait:'Retain evidence; permanently deny execution',send:'\x1b[B\r'},
  {wait:'Conversation deleted',assertDraft:'SURVIVOR_DRAFT',queries:[pair(b.conversationId,null),{sql:"SELECT json_extract(data,'$.lifecycle.deleted.conversationId') FROM conversation_state WHERE conversation=?",params:[a.conversationId],rows:[[a.conversationId]]}],send:' edited'},
  {wait:'SURVIVOR_DRAFT edited',assertDraft:'SURVIVOR_DRAFT edited',queries:[pair(b.conversationId,null),{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x07q'},
 ],[],columns);f.pass();
});

test('controller lifecycle commits retain the saved survivor without an open terminal',async t=>{
 const f=await world(t),a=f.c.createConversation(),b=f.c.createConversation();
 const stored=()=>[...Object.values(f.c.store.one('SELECT selected,second FROM interaction_view'))];
 const source=view=>({conversationId:view.conversationId,expectedGeneration:view.generation});
 f.c.setConversationView({selectedId:a.conversationId,secondId:b.conversationId});
 await f.c.archiveConversation(source(b));
 assert.deepEqual(stored(),[a.conversationId,null]);
 await f.c.restoreConversation(source(b));
 assert.deepEqual(stored(),[a.conversationId,null]);
 f.c.setConversationView({selectedId:a.conversationId,secondId:b.conversationId});
 await f.c.deleteConversation(source(a));
 assert.deepEqual(stored(),[b.conversationId,null]);
 assert.deepEqual(f.c.inspectConversationEntry(),{conversationId:b.conversationId,reason:'last-view'});
 f.pass();
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
