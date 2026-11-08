import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
const runtime=context=>({dockerBinary:'/usr/bin/false',dockerContext:context,image:'sha256:'+'1'.repeat(64)});
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-runtime-application-'))),home=path.join(root,'app'),initial=runtime('original');
 const c=await openController({installationHome:home,runtimeProfile:initial});
 const startup=ApplicationStartup.open(c,{configuration:{version:1,runtime:initial},sources:{runtime:'invocation',bridge:'none'}});let passed=false;
 t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained runtime application '+root);});
 await startup.save({version:1,runtime:initial});const source=c.createConversation();c.setDraft({conversationId:source.conversationId,expectedRevision:0,text:'Keep unsent 한국어 draft'});
 return {c,startup,source,file:path.join(home,'config/startup.json'),pass(){passed=true;}};
}
test('runtime field Save supersedes invocation settings without a restart or execution; generic Save stays next-launch only',async t=>{
 const f=await fixture(t),before=f.c.store.all('SELECT * FROM runs'),budget=f.c.store.all('SELECT * FROM budgets'),edit=await f.startup.prepareRuntimeEdit();
 const result=await edit.save(runtime('applied'));assert.equal(result.runtimeApplied,true);assert.equal(result.activeExecutionChanged,false);
 assert.equal(f.c.options.runtimeProfile.dockerContext,'applied');assert.equal(f.c.options.runtimeProfile.uid,process.getuid());
 let view=await f.startup.inspect();assert.equal(view.sources.runtime,'saved');assert.equal(view.effective.runtime.dockerContext,'applied');assert.equal(Object.hasOwn(view.saved.runtime,'uid'),false);assert.equal(view.restartRequired,false,'Implicit uid/gid defaults must not create an unapplied-change diagnostic');
 assert.equal(f.c.inspectConversation(f.source.conversationId).draft.text,'Keep unsent 한국어 draft');assert.deepEqual(f.c.store.all('SELECT * FROM runs'),before);assert.deepEqual(f.c.store.all('SELECT * FROM budgets'),budget);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM conversation_inputs').n,0);
 await f.startup.save({version:1,runtime:runtime('saved-only')});view=await f.startup.inspect();assert.equal(view.saved.runtime.dockerContext,'saved-only');assert.equal(view.effective.runtime.dockerContext,'applied');assert.equal(f.c.options.runtimeProfile.dockerContext,'applied');assert.equal(view.restartRequired,true);f.pass();
});
test('runtime field Save writes only inside the final controller commit; failure retains saved bytes and live profile',async t=>{
 const f=await fixture(t),bytes=await fs.readFile(f.file),profile=f.c.options.runtimeProfile,edit=await f.startup.prepareRuntimeEdit(),apply=f.c.applyRuntimeProfile.bind(f.c);let commits=0;
 // Controlled final persistence-boundary fault; the actual controller validates and owns the replacement.
 f.c.applyRuntimeProfile=(candidate,_commit)=>apply(candidate,()=>{commits++;assert.equal(f.c.options.runtimeProfile,profile);throw Error('OWNED_FINAL_COMMIT_FAILURE');});
 try{await assert.rejects(edit.save(runtime('must-not-apply')),/OWNED_FINAL_COMMIT_FAILURE/);}finally{f.c.applyRuntimeProfile=apply;}
 assert.equal(commits,1);assert.deepEqual(await fs.readFile(f.file),bytes);assert.equal(f.c.options.runtimeProfile,profile);assert.equal((await f.startup.inspect()).sources.runtime,'invocation');
 await edit.save(runtime('retry'));assert.equal(f.c.options.runtimeProfile.dockerContext,'retry');assert.equal((await f.startup.inspect()).restartRequired,false);f.pass();
});
test('competing runtime field edits cannot replace the first saved and applied selection',async t=>{
 const f=await fixture(t),first=await f.startup.prepareRuntimeEdit(),second=await f.startup.prepareRuntimeEdit();await first.save(runtime('first'));const bytes=await fs.readFile(f.file),profile=f.c.options.runtimeProfile;
 await assert.rejects(second.save(runtime('stale')),/changed while editing/);assert.deepEqual(await fs.readFile(f.file),bytes);assert.equal(f.c.options.runtimeProfile,profile);assert.equal(profile.dockerContext,'first');f.pass();
});

for(const missing of ['binary','configuration'])test('runtime repair entry keeps the selected values after its '+missing+' disappears',async t=>{
 const f=await fixture(t),root=path.dirname(path.dirname(f.file)),binary=path.join(root,'old-docker'),config=path.join(root,'old-docker-config');
 await fs.writeFile(binary,'#!/bin/sh\nexit 99\n',{mode:0o700});await fs.mkdir(config,{mode:0o700});
 const saved={...runtime('old-route'),dockerBinary:binary,dockerConfigDirectory:config,memoryMiB:1536,cpus:0.5};await f.startup.save({version:1,runtime:saved});const bytes=await fs.readFile(f.file),active=f.c.options.runtimeProfile;
 await fs.rm(missing==='binary'?binary:config,{recursive:true});
 const edit=await f.startup.prepareRuntimeEdit();assert.deepEqual(edit.runtime,saved);assert.deepEqual(await fs.readFile(f.file),bytes);assert.equal(f.c.options.runtimeProfile,active);
 await assert.rejects(edit.save(saved));assert.deepEqual(await fs.readFile(f.file),bytes);assert.equal(f.c.options.runtimeProfile,active);
 const corrected={...saved,dockerBinary:'/usr/bin/false',dockerConfigDirectory:undefined};await edit.save(corrected);
 assert.equal(f.c.options.runtimeProfile.dockerContext,'old-route');assert.equal(f.c.options.runtimeProfile.memoryMiB,1536);assert.equal(f.c.options.runtimeProfile.cpus,0.5);
 assert.equal(f.c.inspectConversation(f.source.conversationId).draft.text,'Keep unsent 한국어 draft');assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM conversation_inputs').n,0);f.pass();
});

for(const [name,value] of [
 ['unknown startup field',{version:1,unknown:true}],['runtime array',{version:1,runtime:[]}],['runtime null',{version:1,runtime:null}],
 ['unknown runtime field',{version:1,runtime:{...runtime('old'),unknown:true}}],['runtime field type',{version:1,runtime:{...runtime('old'),cpus:'2'}}],
 ['bridge array',{version:1,bridge:[]}],['bridge null',{version:1,bridge:null}],['bridge profile null',{version:1,bridge:{profile:null,nativeAccountDirectory:'/unused'}}],
 ['bridge field type',{version:1,bridge:{profile:{kind:'installed-claude-bridge',cwd:'/unused',agentDir:'/unused',executable:{file:'/unused',sha256:42}},nativeAccountDirectory:'/unused'}}],
 ['duplicate field','{"version":1,"runtime":null,"runtime":null}'],
])test('field repair refuses '+name+' without changing original setup',async t=>{
 const f=await fixture(t),bytes=typeof value==='string'?value:JSON.stringify(value),active=f.c.options.runtimeProfile;
 await fs.writeFile(f.file,bytes,{mode:0o600});
 for(const kind of ['Runtime','Bridge','Combined'])await assert.rejects(f.startup['prepare'+kind+'Edit'](),/explicit repair/);
 assert.equal(await fs.readFile(f.file,'utf8'),bytes);assert.equal(f.c.options.runtimeProfile,active);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);f.pass();
});

test('explicit setup-only runtime fields save for next launch without changing the effective profile',async t=>{
 const f=await fixture(t),active=f.c.options.runtimeProfile,edit=await f.startup.prepareRuntimeEdit({applyRuntime:false});
 assert.equal(edit.appliesRuntime,false);const result=await edit.save(runtime('next-launch-repair'));assert.equal(result.runtimeApplied,false);
 assert.equal(f.c.options.runtimeProfile,active);assert.equal((await f.startup.inspect()).saved.runtime.dockerContext,'next-launch-repair');assert.equal((await f.startup.inspect()).effective.runtime.dockerContext,'original');
 assert.equal(f.c.inspectConversation(f.source.conversationId).draft.text,'Keep unsent 한국어 draft');assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM conversation_inputs').n,0);f.pass();
});
