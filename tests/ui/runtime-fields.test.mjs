import {editRuntimeFields} from '../../dist/ui/runtime-fields.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';import {ApplicationStartup} from '../../dist/app/startup.js';import {ApplicationModels} from '../../dist/app/models.js';import {ApplicationAccounts} from '../../dist/app/accounts.js';import {ApplicationSettings} from '../../dist/app/settings.js';import {HostCommands} from '../../dist/ui/host-commands.js';import {configurationCommands} from '../../dist/ui/configuration-commands.js';
async function world(t){const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/runtime-fields-')));for(const name of ['host','agent','agent/home','native-account','docker'])await fs.mkdir(path.join(root,name),{recursive:true,mode:0o700});const c=await openController({installationHome:path.join(root,'home')}),startup=ApplicationStartup.open(c),models=new ApplicationModels(c),accounts=ApplicationAccounts.open(c),settings=ApplicationSettings.open(c),conversation=await models.newConversation();t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});return{root,c,startup,models,accounts,settings,conversation};}
test('runtime fields preserve bridge and resource limits, cancel atomically and reject invalid or stale saved setup',async t=>{
 const f=await world(t),executable=await fs.realpath(process.execPath),bridge={profile:{kind:'installed-claude-bridge',cwd:path.join(f.root,'host'),agentDir:path.join(f.root,'agent'),executable:{file:executable,sha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},nativeAccountDirectory:path.join(f.root,'native-account')};
 await fs.writeFile(path.join(f.root,'agent/claude-bridge.json'),'{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}',{mode:0o600});
 const runtime={dockerBinary:'/usr/bin/false',dockerContext:'OLD',image:'sha256:'+'0'.repeat(64),dockerConfigDirectory:path.join(f.root,'docker'),memoryMiB:1024,cpus:2};await f.startup.save({version:1,runtime,bridge});
 const notices=[];let choices=['Edit runtime fields','Review and save runtime','Save and apply runtime'],values=['/usr/bin/false','NEW',runtime.image,runtime.dockerConfigDirectory];
 const registry=new HostCommands(configurationCommands({isCurrent:()=>true,controller:f.c,models:f.models,accounts:f.accounts,settings:f.settings,choose:async()=>choices.shift(),show:async()=>{},input:async()=>values.shift(),notice:text=>notices.push(text),apply(){},assertPresentationChange(){},commandKey:'Ctrl+G'}));
 await registry.execute('/setup runtime',f.conversation.conversationId);let inspected=await f.startup.inspect();assert.equal(inspected.saved.runtime.dockerContext,'NEW');assert.equal(inspected.saved.runtime.memoryMiB,1024);assert.equal(inspected.saved.runtime.cpus,2);assert.deepEqual(inspected.saved.bridge,bridge);assert.equal(f.c.options.runtimeProfile.dockerContext,'NEW');assert.equal(inspected.effective.runtime.dockerContext,'NEW');assert.equal(inspected.effective.bridge,undefined);assert.equal(inspected.restartRequired,true);assert.match(notices.at(-1),/saved and applied.*not checked/);
 const file=path.join(f.c.applicationHome(),'config/startup.json'),before=await fs.readFile(file);choices=['Edit runtime fields','Cancel'];values=['/usr/bin/false',undefined];assert.equal(await registry.execute('/setup runtime',f.conversation.conversationId),'cancelled');assert.ok((await fs.readFile(file)).equals(before));
 const edit=await f.startup.prepareRuntimeEdit();await f.startup.clear();await assert.rejects(edit.save({...runtime,dockerContext:'STALE'}),/changed while editing/);assert.deepEqual((await f.startup.inspect()).saved,{version:1});
 const invalid='{"bridge":"DO_NOT_DESTROY';await fs.writeFile(file,invalid,{mode:0o600});await assert.rejects(registry.execute('/setup runtime',f.conversation.conversationId),/explicit repair/);assert.equal(await fs.readFile(file,'utf8'),invalid);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});
function command(f,choices,inputs=[],extra={}){
 const shown=[],defaults=[];
 const registry=new HostCommands(configurationCommands({controller:f.c,models:f.models,accounts:f.accounts,settings:f.settings,isCurrent:()=>true,
  choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next!==undefined)assert.ok(rows.includes(next));return next;},
  input:async(title,value)=>{defaults.push(value);return inputs.shift();},show:async(title,text)=>shown.push({title,text}),notice(){},apply(){},assertPresentationChange(){},commandKey:'Ctrl+G',...extra}));
 return {shown,defaults,run:()=>registry.execute('/setup runtime',f.conversation.conversationId)};
}
const image='sha256:'+'0'.repeat(64);
test('invalid runtime fields remain staged for correction; review Back and cancelled partial edits preserve the previous staged set',async t=>{
 const f=await world(t),runtime={dockerBinary:'/usr/bin/false',dockerContext:'OLD',image,memoryMiB:3072,cpus:0.5,pidsLimit:64,scratchMiB:128,uid:1234,gid:1235,maxOutputBytes:4096,defaultTimeoutMs:100};await f.startup.save({version:1,runtime});
 const file=path.join(f.c.applicationHome(),'config/startup.json'),before=await fs.readFile(file);
 const h=command(f,['Edit runtime fields','Review and save runtime','Edit runtime fields','Review and save runtime','Back without saving','Edit runtime fields','Review and save runtime','Save and apply runtime'],
  ['/does-not-exist','NEW','latest','', '/usr/bin/false','NEW',image,'', '/usr/bin/false',undefined]);
 await h.run();assert.ok(h.shown.some(v=>v.title.includes('unavailable')));assert.equal(h.defaults[4],'/does-not-exist');assert.equal(h.defaults[5],'NEW');assert.equal(h.defaults[6],'latest');assert.equal(h.defaults[8],'/usr/bin/false');
 assert.deepEqual(JSON.parse(await fs.readFile(file)),{version:1,runtime:{...runtime,dockerContext:'NEW'}});assert.equal(f.c.options.runtimeProfile.dockerContext,'NEW');assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
 const saved=await fs.readFile(file),cancel=command(f,['Edit runtime fields','Review and save runtime','Back without saving','Cancel'],['/usr/bin/false','UNSAVED',image,'']);assert.equal(await cancel.run(),'cancelled');assert.deepEqual(await fs.readFile(file),saved);assert.notDeepEqual(saved,before);
});
test('clearing Docker configuration is explicit and refuses a saved bridge dependency without losing inputs',async t=>{
 const f=await world(t),executable=await fs.realpath(process.execPath),bridge={profile:{kind:'installed-claude-bridge',cwd:path.join(f.root,'host'),agentDir:path.join(f.root,'agent'),executable:{file:executable,sha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},nativeAccountDirectory:path.join(f.root,'native-account')};await fs.writeFile(path.join(f.root,'agent/claude-bridge.json'),'{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}',{mode:0o600});
 const runtime={dockerBinary:'/usr/bin/false',dockerContext:'OLD',image,dockerConfigDirectory:path.join(f.root,'docker')};await f.startup.save({version:1,runtime,bridge});const file=path.join(f.c.applicationHome(),'config/startup.json'),before=await fs.readFile(file);
 const h=command(f,['Edit runtime fields','Review and save runtime','Edit runtime fields','Cancel'],['/usr/bin/false','NEW',image,'',undefined]);await h.run();assert.match(h.shown[0].text,/requires explicit dockerConfigDirectory/);assert.equal(h.defaults[4],'/usr/bin/false');assert.deepEqual(await fs.readFile(file),before);
 await f.startup.save({version:1,runtime});await command(f,['Edit runtime fields','Review and save runtime','Save and apply runtime'],['/usr/bin/false','NEW',image,'']).run();assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(file)).runtime,'dockerConfigDirectory'),false);
});
test('runtime review refuses stale setup/source and final validation checks navigation and close before writing',async t=>{
 const f=await world(t),runtime={dockerBinary:'/usr/bin/false',dockerContext:'OLD',image};await f.startup.save({version:1,runtime});const file=path.join(f.c.applicationHome(),'config/startup.json'),before=await fs.readFile(file);let current=true;
 const stale=command(f,['Review and save runtime',()=>{current=false;return 'Save and apply runtime';}],[],{isCurrent:()=>current});await assert.rejects(stale.run(),/source changed/);assert.deepEqual(await fs.readFile(file),before);
 const changed=command(f,['Review and save runtime',async()=>{await fs.appendFile(file,'\n');return 'Save and apply runtime';}]);await assert.rejects(changed.run(),/changed while editing/);assert.equal(await fs.readFile(file,'utf8'),before.toString()+'\n');
 let edit=await f.startup.prepareRuntimeEdit();current=true;await assert.rejects(edit.validate(runtime,()=>{if(!current)throw Error('NAVIGATED_DURING_VALIDATION');queueMicrotask(()=>current=false);}),/NAVIGATED_DURING_VALIDATION/);
 edit=await f.startup.prepareRuntimeEdit();current=true;await assert.rejects(edit.save({...runtime,dockerContext:'NO_WRITE'},()=>{if(!current)throw Error('NAVIGATED_DURING_SAVE');queueMicrotask(()=>current=false);}),/NAVIGATED_DURING_SAVE/);
 edit=await f.startup.prepareRuntimeEdit();let closing;await assert.rejects(edit.save(runtime,()=>{queueMicrotask(()=>{closing=f.startup.close();});}),/closing|changed while editing/);await closing;assert.equal(await fs.readFile(file,'utf8'),before.toString()+'\n');
});


test('Enter defaults follow staged metadata and empty images lead to preparation without saving',async t=>{
 const f=await world(t),prepared=await f.startup.prepareRuntimeEdit(),menus=[],config=path.join(f.root,'docker');let reads=0;
 const expected=['Suggest local Docker paths','Choose Docker context','Choose existing runtime image','Prepare an execution image','Choose existing runtime image'];
 const edit={...prepared,suggestPaths:async guard=>{guard();return{dockerBinary:'/usr/bin/false',dockerConfigDirectory:config};},discover:async(kind,_input,guard)=>{guard();reads++;return{kind,candidates:kind==='contexts'?['owned']:[],labels:kind==='contexts'?['owned']:[],dockerBinary:'/usr/bin/false',dockerConfigDirectory:config};}};
 const result=await editRuntimeFields({guard:()=>{},notice(){},show:async()=>{},input:async(_title,value)=>value,choose:async(title,rows)=>{
  if(title.startsWith('Runtime setup ·')){menus.push(rows[0]);assert.equal(rows[0],expected[menus.length-1]);return menus.length===expected.length?'Cancel':rows[0];}
  if(title==='Stage suggested paths?')assert.equal(rows[0],'Use these paths');
  return rows[0];
 }},edit);
 assert.equal(result,'cancelled');assert.equal(reads,2);assert.deepEqual(menus,expected);assert.equal((await f.startup.inspect()).saved,null);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});

test('missing image-build prerequisites return to the applicable path action',async t=>{
 const f=await world(t),prepared=await f.startup.prepareRuntimeEdit();let menu=0;
 await editRuntimeFields({guard:()=>{},notice(){},show:async()=>{},input:async()=>undefined,choose:async(title,rows)=>{
  menu++;if(menu===1)return 'Prepare an execution image';
  if(title==='Choose a recovery action'){assert.equal(rows[0],'Back to runtime setup');assert.ok(rows.includes('Suggest local Docker paths'));assert.ok(!rows.includes('Prepare an execution image'));return'Suggest local Docker paths';}
  if(title==='Stage suggested paths?')return'Back without changes';
  assert.equal(rows[0],'Suggest local Docker paths');return'Cancel';
 }},prepared);
 assert.equal(menu,4);assert.equal((await f.startup.inspect()).saved,null);
});
