import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {editRuntimeFields} from '../../dist/ui/runtime-fields.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';import {ApplicationStartup} from '../../dist/app/startup.js';import {ApplicationModels} from '../../dist/app/models.js';import {ApplicationAccounts} from '../../dist/app/accounts.js';import {ApplicationSettings} from '../../dist/app/settings.js';import {HostCommands} from '../../dist/ui/host-commands.js';import {configurationCommands} from '../../dist/ui/configuration-commands.js';
async function world(t){const root=await temporaryDirectory('runtime-fields');for(const name of ['host','agent','agent/home','native-account','docker'])await fs.mkdir(path.join(root,name),{recursive:true,mode:0o700});const c=await openController({installationHome:path.join(root,'home')}),startup=ApplicationStartup.open(c),models=new ApplicationModels(c),accounts=ApplicationAccounts.open(c),settings=ApplicationSettings.open(c),conversation=await models.newConversation();t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});return{root,c,startup,models,accounts,settings,conversation};}
test('runtime fields preserve bridge and resource limits, cancel atomically and reject invalid or stale saved setup',async t=>{
 const f=await world(t),executable=await fs.realpath(process.execPath),bridge={profile:{kind:'installed-claude-bridge',cwd:path.join(f.root,'host'),agentDir:path.join(f.root,'agent'),executable:{file:executable,sha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},nativeAccountDirectory:path.join(f.root,'native-account')};
 await fs.writeFile(path.join(f.root,'agent/claude-bridge.json'),'{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}',{mode:0o600});
 const runtime={dockerBinary:'/usr/bin/false',dockerContext:'OLD',image:'sha256:'+'0'.repeat(64),dockerConfigDirectory:path.join(f.root,'docker'),memoryMiB:1024,cpus:2};await f.startup.save({version:1,runtime,bridge});
 const notices=[];let choices=['Edit runtime fields','Review and save runtime','Save and apply runtime'],values=['/usr/bin/false','NEW',runtime.image,runtime.dockerConfigDirectory];
 const registry=new HostCommands(configurationCommands({isCurrent:()=>true,controller:f.c,models:f.models,accounts:f.accounts,settings:f.settings,choose:async()=>choices.shift(),show:async(_title,_text,primary)=>{await primary?.run();},input:async()=>values.shift(),notice:text=>notices.push(text),apply(){},assertPresentationChange(){},commandKey:'Ctrl+G'}));
 await registry.execute('/setup runtime',f.conversation.conversationId);let inspected=await f.startup.inspect();assert.equal(inspected.saved.runtime.dockerContext,'NEW');assert.equal(inspected.saved.runtime.memoryMiB,1024);assert.equal(inspected.saved.runtime.cpus,2);assert.deepEqual(inspected.saved.bridge,bridge);assert.equal(f.c.options.runtimeProfile.dockerContext,'NEW');assert.equal(inspected.effective.runtime.dockerContext,'NEW');assert.equal(inspected.effective.bridge,undefined);assert.equal(inspected.restartRequired,true);assert.match(notices.at(-1),/saved and applied.*current process/);
 const file=path.join(f.c.applicationHome(),'config/startup.json'),before=await fs.readFile(file);choices=['Edit runtime fields','Cancel'];values=['/usr/bin/false',undefined];assert.equal(await registry.execute('/setup runtime',f.conversation.conversationId),'cancelled');assert.ok((await fs.readFile(file)).equals(before));
 const edit=await f.startup.prepareRuntimeEdit();await f.startup.clear();await assert.rejects(edit.save({...runtime,dockerContext:'STALE'}),/changed while editing/);assert.deepEqual((await f.startup.inspect()).saved,{version:1});
 const invalid='{"bridge":"DO_NOT_DESTROY';await fs.writeFile(file,invalid,{mode:0o600});await assert.rejects(registry.execute('/setup runtime',f.conversation.conversationId),/explicit repair/);assert.equal(await fs.readFile(file,'utf8'),invalid);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});
function command(f,choices,inputs=[],extra={},argument='runtime'){
 const shown=[],defaults=[];
 const registry=new HostCommands(configurationCommands({controller:f.c,models:f.models,accounts:f.accounts,settings:f.settings,isCurrent:()=>true,
  choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next!==undefined)assert.ok(rows.includes(next));return next;},
  input:async(title,value)=>{defaults.push(value);return inputs.shift();},show:async(title,text,primary)=>{shown.push({title,text});await primary?.run();},notice(){},apply(){},assertPresentationChange(){},commandKey:'Ctrl+G',...extra}));
 return {shown,defaults,run:context=>registry.execute('/setup '+argument,f.conversation.conversationId,context)};
}
const image='sha256:'+'0'.repeat(64);
test('current and saved runtime entries retain their own full profiles with the same context and image', async t => {
 const f = await world(t);
 const original = {dockerBinary:'/usr/bin/false',dockerConfigDirectory:path.join(f.root,'docker'),dockerContext:'same-context',image,memoryMiB:1024,cpus:1};
 const replacement = {...original,dockerConfigDirectory:path.join(f.root,'other-docker'),memoryMiB:2048,cpus:2};
 await fs.mkdir(replacement.dockerConfigDirectory,{mode:0o700});
 await assert.rejects(command(f,[],[],{},'runtime current').run(),/No runtime is active/);
 await (await f.startup.prepareRuntimeEdit()).save(original);
 await f.startup.save({version:1,runtime:replacement});
 const active = f.c.options.runtimeProfile, verify = p => [p.dockerConfigDirectory,p.memoryMiB,p.cpus];
 const saved = command(f,[(title,rows)=>{
  assert.match(title,/Draft started from the saved runtime/);
  assert.match(title,/Differs from current · Docker configuration directory/);
  return 'Review and save runtime';
 },'Back without saving','Cancel']);
 assert.equal(await saved.run(),'cancelled');
 const savedReview = JSON.parse(saved.shown[0].text);
 assert.deepEqual(verify(savedReview.runtime),verify(replacement));
 assert.deepEqual(verify(savedReview.previousActiveRuntime),verify(original));
 assert.equal(f.c.options.runtimeProfile,active);
 assert.deepEqual((await f.startup.inspect()).saved.runtime,replacement);

 for (const runtimeSetupFocus of ['context','image']) {
  const repair = command(f,[(title,rows)=>{
   assert.match(title,/Draft started from the current runtime\nSaving replaces the saved runtime/);
   assert.equal(rows[0],runtimeSetupFocus==='context'?'Choose Docker context':'Choose existing runtime image');
   return 'Review and save runtime';
  },'Back without saving','Cancel']);
  assert.equal(await repair.run({runtimeSetupFocus}),'cancelled');
  const review=JSON.parse(repair.shown[0].text);
  assert.deepEqual(verify(review.runtime),verify(original));
  assert.deepEqual(verify(review.previousSavedRuntime),verify(replacement));
  assert.equal(f.c.options.runtimeProfile,active);
  assert.deepEqual((await f.startup.inspect()).saved.runtime,replacement);
 }

 const current = command(f,[(title,rows)=>{
  assert.match(title,/Draft started from the current runtime\nSaving replaces the saved runtime/);
  assert.doesNotMatch(title,/Differs from current/);
  return 'Inspect saved runtime';
 },'Inspect current runtime','Review and save runtime','Save and apply runtime'],[],{},'runtime current');
 assert.equal(await current.run(),'completed');
 assert.deepEqual(verify(JSON.parse(current.shown[0].text)),verify(replacement));
 assert.deepEqual(verify(JSON.parse(current.shown[1].text)),verify(original));
 const currentReview = JSON.parse(current.shown[2].text);
 assert.deepEqual(verify(currentReview.runtime),verify(original));
 assert.deepEqual(verify(currentReview.previousSavedRuntime),verify(replacement));
 assert.deepEqual(verify((await f.startup.inspect()).saved.runtime),verify(original));
 assert.deepEqual(verify(f.c.options.runtimeProfile),verify(original));
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});

test('runtime editor refuses a changed active route while showing the captured settings', async t => {
 const f = await world(t);
 const runtime = {dockerBinary:'/usr/bin/false', dockerContext:'original', image};
 await f.c.applyRuntimeProfile(runtime);
 const h = command(f, [async (_title, rows) => {
  assert.ok(rows.includes('Inspect current runtime'));
  await f.c.applyRuntimeProfile({...runtime, dockerContext:'replacement'});
  return 'Inspect current runtime';
 }]);
 await assert.rejects(h.run(), /The current runtime changed/);
 assert.equal(h.shown.length, 0);
 assert.equal(f.c.options.runtimeProfile.dockerContext, 'replacement');
 assert.equal((await f.startup.inspect()).saved, null);
});

test('closing runtime review preserves the staged route and Back is the default decision',async t=>{
 const f=await world(t),runtime={dockerBinary:'/usr/bin/false',dockerContext:'OLD',image};
 await f.startup.save({version:1,runtime});
 const file=path.join(f.c.applicationHome(),'config/startup.json'),before=await fs.readFile(file),active=f.c.options.runtimeProfile;
 let reviews=0;
 const choices=['Edit runtime fields','Review and save runtime',(title,rows)=>{
  assert.match(title,/^Runtime setup · staged values\n.*NEW/);return rows[0];
 },(title,rows)=>{
  assert.equal(title,'Explicit runtime setup action\nLast check · no successful check for this draft');
  assert.deepEqual(rows,['Back without saving','Save and apply runtime']);
  assert.equal(rows[0],'Back without saving');return rows[0];
 },'Cancel'];
 const h=command(f,choices,['/usr/bin/false','NEW',image,''],{show:async(title,text,primary)=>{
  assert.equal(title,'Review runtime setup before applying');
  const review=JSON.parse(text);
  assert.equal(review.runtime.dockerContext,'NEW');
  assert.equal(review.metadataObservation,'Last check · no successful check for this draft');
  assert.equal(primary?.label,'Open settings confirmation');
  if(++reviews===2)await primary.run();
 }});
 assert.equal(await h.run(),'cancelled');assert.equal(reviews,2);assert.deepEqual(await fs.readFile(file),before);
 assert.equal(f.c.options.runtimeProfile,active);
});
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


test('reviewed runtime candidate cannot redirect a canonical executable path before Save or application', async t=>{
 for (const duringApplication of [false,true]) {
  const f=await world(t), initial={dockerBinary:'/usr/bin/false',dockerContext:'OLD',image};
  await (await f.startup.prepareRuntimeEdit()).save(initial);
  const file=path.join(f.c.applicationHome(),'config/startup.json'), before=await fs.readFile(file);
  const client=path.join(f.root,'candidate-docker'), replacement=path.join(f.root,'unreviewed-client');
  await fs.copyFile('/usr/bin/false',client);
  await fs.copyFile('/usr/bin/false',replacement);
  const redirect=async()=>{
   await fs.unlink(client);
   await fs.symlink(replacement,client);
  };
  const edit=await f.startup.prepareRuntimeEdit(), candidate={...initial,dockerBinary:client,dockerContext:'NEW'};
  const reviewed=await edit.validate(candidate);
  assert.equal(reviewed.runtime.dockerBinary,client);
  if (duringApplication) {
   const apply=f.c.applyRuntimeProfile.bind(f.c);
   f.c.applyRuntimeProfile=async (runtime,commit)=>{
    await redirect();
    return apply(runtime,commit);
   };
  } else await redirect();
  await assert.rejects(edit.save(candidate,undefined,reviewed),duringApplication?/Docker executable path changed before application/:/Startup settings resolved differently after review/);
  assert.deepEqual(await fs.readFile(file),before);
  assert.equal(f.c.options.runtimeProfile.dockerContext,'OLD');
 }
});

test('Enter defaults follow staged metadata and empty images recommend help when building is unavailable',async t=>{
 const f=await world(t),prepared=await f.startup.prepareRuntimeEdit(),menus=[],config=path.join(f.root,'docker');let reads=0;
 const expected=['Suggest local Docker paths','Choose Docker context','Choose existing runtime image','Runtime setup help'];
 const edit={...prepared,suggestPaths:async guard=>{guard();return{dockerBinary:'/usr/bin/false',dockerConfigDirectory:config};},discover:async(kind,_input,guard)=>{guard();reads++;return{kind,candidates:kind==='contexts'?['owned']:[],labels:kind==='contexts'?['owned']:[],dockerBinary:'/usr/bin/false',dockerConfigDirectory:config};}};
 const result=await editRuntimeFields({guard:()=>{},notice(){},show:async(_title,_text,primary)=>{await primary?.run();},input:async(_title,value)=>value,choose:async(title,rows)=>{
  if(title.startsWith('Runtime setup ·')){menus.push(rows[0]);assert.equal(rows[0],expected[menus.length-1]);return menus.length===expected.length?'Cancel':rows[0];}
  if(title==='Stage suggested paths?'){assert.equal(rows[0],'Back without changes');return 'Use these paths';}
  if(title==='Use this Docker route for discovery?'){assert.equal(rows[0],'Back');return 'Discover with this route';}
  return rows[0];
 }},edit);
 assert.equal(result,'cancelled');assert.equal(reads,2);assert.deepEqual(menus,expected);assert.equal((await f.startup.inspect()).saved,null);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
});

test('missing image-build prerequisites return to the applicable path action',async t=>{
 const f=await world(t),prepared=await f.startup.prepareRuntimeEdit();let menu=0;
 await editRuntimeFields({guard:()=>{},notice(){},show:async(_title,_text,primary)=>{await primary?.run();},input:async()=>undefined,choose:async(title,rows)=>{
  menu++;if(menu===1)return 'Prepare an execution image';
  if(title==='Choose a recovery action'){assert.equal(rows[0],'Back to runtime setup');assert.ok(rows.includes('Suggest local Docker paths'));assert.ok(!rows.includes('Prepare an execution image'));return'Suggest local Docker paths';}
  if(title==='Stage suggested paths?')return'Back without changes';
  assert.equal(rows[0],'Suggest local Docker paths');return'Cancel';
 }},prepared);
 assert.equal(menu,4);assert.equal((await f.startup.inspect()).saved,null);
});

test('retry from image inventory reviews the same unstaged Docker route again', async t => {
 const f = await world(t), prepared = await f.startup.prepareRuntimeEdit();
 const route = {dockerBinary:'/usr/bin/false',dockerConfigDirectory:path.join(f.root,'docker'),dockerContext:'owned'};
 const fields = [route.dockerBinary, route.dockerContext, route.dockerConfigDirectory];
 const decisions = ['Choose existing runtime image', 'Discover with this route', 'Prepare an execution image',
  'Build execution image', 'Prepare an execution image', 'Back without building', 'Cancel'];
 const reviews = [];
 let builds = 0;
 const result = await editRuntimeFields({
  guard(){}, notice(){}, input:async()=>fields.shift(),
  choose:async(_title,rows)=>{
   const action = decisions.shift();
   assert.ok(rows.includes(action), `Missing ${action} from ${rows.join(', ')}`);
   return action;
  },
  show:async(title,text,primary)=>{
   if(title.startsWith('Review execution image build')) reviews.push(JSON.parse(text).route);
   await primary?.run();
  },
  runPreparation:async(_title,run)=>run(new AbortController().signal,()=>{}),
 }, {
  ...prepared,
  discover:async()=>({kind:'images',...route,candidates:[image],recipeImages:[],labels:['owned:unchecked']}),
  buildImage:async reviewed=>{
   assert.deepEqual(reviewed,route);
   builds++;
   throw Object.assign(Error('Owned engine unreachable'), {code:'RUNTIME_DOCKER_SERVER_UNAVAILABLE'});
  },
 });
 assert.equal(result,'cancelled');
 assert.deepEqual(decisions,[]);
 assert.deepEqual(fields,[]);
 assert.deepEqual(reviews,[route,route]);
 assert.equal(builds,1);
 assert.equal((await f.startup.inspect()).saved,null);
});

test('a redirected image discovery route cannot open build review', async t => {
 const f = await world(t), prepared = await f.startup.prepareRuntimeEdit();
 const route = {dockerBinary:path.join(f.root,'client'),dockerConfigDirectory:path.join(f.root,'docker'),dockerContext:'owned'};
 await fs.copyFile('/usr/bin/false',route.dockerBinary);
 const fields = [route.dockerBinary,route.dockerContext,route.dockerConfigDirectory];
 const choices = ['Choose existing runtime image','Discover with this route','Prepare an execution image','Back to runtime setup','Cancel'];
 const result = await editRuntimeFields({
  guard(){}, notice(){}, input:async()=>fields.shift(),
  choose:async(title,rows)=>{
   const action = choices.shift();
   assert.ok(rows.includes(action), `Missing ${action} from ${rows.join(', ')}`);
   if (title.startsWith('No images found')) {
    await fs.rename(route.dockerBinary,route.dockerBinary+'.previous');
    await fs.symlink('/usr/bin/false',route.dockerBinary);
   }
   if (title==='Choose a recovery action') {
    assert.ok(rows.includes('Choose existing runtime image'));
    assert.ok(!rows.includes('Prepare an execution image'));
   }
   return action;
  },
  show:async(title,text,primary)=>{
   assert.doesNotMatch(title,/Review execution image build/);
   if (title.startsWith('Docker discovery unavailable')) assert.match(text,/observed Docker route changed/);
   await primary?.run();
  },
  runPreparation:async(title,run)=>{
   assert.match(title,/^Listing Docker images/);
   return run(new AbortController().signal,()=>{});
  },
 }, {
  ...prepared,
  discover:async()=>({kind:'images',...route,candidates:[],recipeImages:[],labels:[]}),
 });
 assert.equal(result,'cancelled');
 assert.deepEqual(choices,[]);
 assert.equal((await f.startup.inspect()).saved,null);
});

for(const locale of ['en','ko'])test('setup inspection labels a saved runtime replacement without claiming relaunch in '+locale,async t=>{
 const f=await world(t),runtime={dockerBinary:'/usr/bin/false',dockerContext:'active',image:'sha256:'+'0'.repeat(64)};
 await (await f.startup.prepareRuntimeEdit()).save(runtime);await f.startup.save({version:1,runtime:{...runtime,dockerContext:'pending'}});let shown;
 const registry=new HostCommands(configurationCommands({isCurrent:()=>true,controller:f.c,models:f.models,accounts:f.accounts,settings:f.settings,uiLocale:()=>locale,choose:async()=>undefined,show:async(title,text)=>{shown={title,text};},apply(){},assertPresentationChange(){},commandKey:'Ctrl+G'}));
 await registry.execute('/setup inspect',f.conversation.conversationId);assert.match(shown.text.split('\n')[0],locale==='en'?/^Runtime · .*available to review and apply/:/^실행 환경 · .*검토 및 적용 가능/);assert.ok(shown.text.includes('active'));assert.ok(shown.text.includes('pending'));assert.equal(f.c.options.runtimeProfile.dockerContext,'active');assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});
