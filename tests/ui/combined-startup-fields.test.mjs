import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import * as settingsUI from '../../dist/ui/startup-settings.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
 const root=await temporaryDirectory('combined-startup'),home=path.join(root,'app');for(const name of ['docker-config','host','agent','agent/home','account','project'])await fs.mkdir(path.join(root,name),{mode:0o700});
 const oldDocker=path.join(root,'old-docker'),oldNative=path.join(root,'old-native'),replacement=path.join(root,'new-native');
 for(const file of [oldDocker,oldNative,replacement])await fs.writeFile(file,'#!/bin/sh\nexit '+(file===replacement?'17':'99')+'\n',{mode:0o700});
 await fs.writeFile(path.join(root,'agent/claude-bridge.json'),'{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}',{mode:0o600});
 const runtime={dockerBinary:oldDocker,dockerContext:'retained-route',dockerConfigDirectory:path.join(root,'docker-config'),image:'sha256:'+'0'.repeat(64),memoryMiB:1536,cpus:0.5};
 const bridge={profile:{kind:'installed-claude-bridge',cwd:path.join(root,'host'),agentDir:path.join(root,'agent'),executable:{file:oldNative,sha256:hash(await fs.readFile(oldNative))}},nativeAccountDirectory:path.join(root,'account')};
 const c=await openController({installationHome:home,runtimeProfile:{...runtime,dockerBinary:'/usr/bin/false'}});let passed=false;t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained combined startup '+root);});
 await c.registerProject({id:'P',sourceRoot:path.join(root,'project')});const {conversationId:cid}=c.createConversation();c.setDraft({conversationId:cid,expectedRevision:0,text:'Retain combined repair 한국어 draft'});
 const startup=ApplicationStartup.open(c);await startup.save({version:1,runtime,bridge});const file=path.join(home,'config/startup.json'),before=await fs.readFile(file),active=c.options.runtimeProfile;
 await fs.rm(oldDocker);await fs.rm(oldNative);
 return {root,home,c,cid,startup,file,before,active,runtime,bridge,newRuntime:{...runtime,dockerBinary:'/usr/bin/false'},newBridge:{...bridge,profile:{...bridge.profile,executable:{file:replacement,sha256:hash(await fs.readFile(replacement))}}},pass(){passed=true;}};
}
function originalLedgers(c){return Object.fromEntries(['works','runs','budgets','conversation_inputs'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));}
function host(f,choices,inputs=[]){const shown=[],notices=[],defaults=[];return {shown,notices,defaults,guard(){},notice:text=>notices.push(text),show:async(title,text)=>shown.push({title,text}),choose:async(title,rows)=>{assert.deepEqual(await fs.readFile(f.file),f.before,'A stage wrote saved settings');assert.equal(f.c.options.runtimeProfile,f.active);const choice=choices.shift();assert.notEqual(choice,undefined,'Unexpected menu '+title);if(typeof choice==='function')return choice(title,rows);assert.ok(rows.includes(choice),'Missing '+choice+' in '+JSON.stringify(rows));return choice;},input:async(_title,value)=>{defaults.push(value);assert.ok(inputs.length,'Unexpected input');return inputs.shift();}};}

test('both unavailable components can be corrected through fields and one original complete save',async t=>{
 const f=await fixture(t),before=originalLedgers(f.c);
 await assert.rejects((await f.startup.prepareRuntimeEdit({applyRuntime:false})).save(f.newRuntime));
 await assert.rejects((await f.startup.prepareBridgeEdit()).save(f.newBridge));assert.deepEqual(await fs.readFile(f.file),f.before);
 assert.equal(typeof settingsUI.editCombinedStartupFields,'function','A combined field continuation must exist');
 const choices=['Edit runtime settings','Edit runtime fields','Review runtime changes for combined review','Keep runtime changes for combined review','Edit Claude bridge settings','Edit bridge paths and executable pin','Review bridge changes for combined review','Keep bridge changes for combined review','Review and save all changes','Save all settings for next launch'];
 const h=host(f,choices,['/usr/bin/false',f.runtime.dockerContext,f.runtime.image,f.runtime.dockerConfigDirectory,f.bridge.profile.cwd,f.bridge.profile.agentDir,f.bridge.nativeAccountDirectory,f.newBridge.profile.executable.file,f.newBridge.profile.executable.sha256]);
 assert.equal(await settingsUI.editCombinedStartupFields(h,f.startup),'completed');assert.equal(choices.length,0);assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1,runtime:f.newRuntime,bridge:f.newBridge});
 assert.equal(f.c.options.runtimeProfile,f.active);assert.equal(f.c.inspectConversation(f.cid).draft.text,'Retain combined repair 한국어 draft');assert.deepEqual(originalLedgers(f.c),before);
 assert.ok(h.shown.some(view=>view.title.startsWith('Review all startup settings')&&view.text.includes(f.newBridge.profile.executable.sha256)));f.pass();
});

const runtimeStage=['Edit runtime settings','Edit runtime fields','Review runtime changes for combined review','Keep runtime changes for combined review'];
const bridgeStage=['Edit Claude bridge settings','Edit bridge paths and executable pin','Review bridge changes for combined review','Keep bridge changes for combined review'];
const runtimeInputs=f=>['/usr/bin/false',f.runtime.dockerContext,f.runtime.image,f.runtime.dockerConfigDirectory];
const bridgeInputs=f=>[f.bridge.profile.cwd,f.bridge.profile.agentDir,f.bridge.nativeAccountDirectory,f.newBridge.profile.executable.file,f.newBridge.profile.executable.sha256];

test('staged runtime reopens from the current draft and cancelled partial input cannot replace it',async t=>{
 const f=await fixture(t),choices=[...runtimeStage,'Edit runtime settings','Edit runtime fields','Review runtime changes for combined review','Keep runtime changes for combined review','Leave combined repair','Discard staged changes'];
 const h=host(f,choices,['/usr/bin/false','draft-route',f.runtime.image,f.runtime.dockerConfigDirectory,'/must-not-replace-draft',undefined]);
 assert.equal(await settingsUI.editCombinedStartupFields(h,f.startup),'cancelled');assert.deepEqual(h.defaults.slice(4),['/usr/bin/false','draft-route']);
 const last=h.shown.filter(view=>view.title==='Review runtime draft · nothing saved').at(-1);assert.ok(last.text.includes('draft-route'));assert.ok(!last.text.includes('/must-not-replace-draft'));assert.ok(last.text.includes('pendingCombinedReview'));
 assert.deepEqual(await fs.readFile(f.file),f.before);assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});
test('staging a valid runtime and bridge does not forgive an invalid complete combination',async t=>{
 const f=await fixture(t),choices=[...runtimeStage,...bridgeStage,'Review and save all changes','Leave combined repair','Discard staged changes'],h=host(f,choices,[...runtimeInputs(f).slice(0,3),'',...bridgeInputs(f)]);
 assert.equal(await settingsUI.editCombinedStartupFields(h,f.startup),'cancelled');assert.ok(h.shown.some(view=>view.title==='Complete setup is not ready to save · draft retained'&&view.text.includes('explicit dockerConfigDirectory')));assert.deepEqual(await fs.readFile(f.file),f.before);assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});
test('explicit bridge removal is only a draft and default Back in complete review saves nothing',async t=>{
 const f=await fixture(t),choices=[...runtimeStage,'Edit Claude bridge settings','Stage Claude bridge removal','Keep bridge removal for combined review','Review and save all changes',(_title,rows)=>{assert.equal(rows[0],'Keep editing');return rows[0];},'Leave combined repair','Discard staged changes'],h=host(f,choices,runtimeInputs(f));
 assert.equal(await settingsUI.editCombinedStartupFields(h,f.startup),'cancelled');const complete=h.shown.find(view=>view.title.startsWith('Review all startup settings'));const value=JSON.parse(complete.text);assert.deepEqual(value.before.bridge,f.bridge);assert.equal(value.after.bridge,undefined);assert.deepEqual(await fs.readFile(f.file),f.before);f.pass();
});
for(const drift of ['source','project','close'])test('combined draft refuses original '+drift+' drift before another field opens',async t=>{
 const f=await fixture(t);let current=true;
 const h=host(f,[async()=>{if(drift==='source')await fs.appendFile(f.file,'\n');if(drift==='project'){const added=path.join(f.root,'new-project');await fs.mkdir(added);await f.c.registerProject({id:'NEW',sourceRoot:added});}if(drift==='close')current=false;return 'Edit runtime settings';}]);h.guard=()=>{if(!current)throw Error('SETTINGS_CLOSING');};
 await assert.rejects(settingsUI.editCombinedStartupFields(h,f.startup),drift==='close'?/SETTINGS_CLOSING/:/changed while editing/);assert.equal(h.defaults.length,0);assert.deepEqual(await fs.readFile(f.file),drift==='source'?Buffer.concat([f.before,Buffer.from('\n')]):f.before);assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});
test('complete review refuses a source change between its pages before confirmation',async t=>{
 const f=await fixture(t),raw={version:1,runtime:{...f.runtime,dockerBinary:'/'+ 'old-unavailable-path-'.repeat(2500)},bridge:f.bridge};await fs.writeFile(f.file,JSON.stringify(raw),{mode:0o600});f.before=await fs.readFile(f.file);
 const choices=[...runtimeStage,...bridgeStage,'Review and save all changes'],h=host(f,choices,[...runtimeInputs(f),...bridgeInputs(f)]);let pages=0;const show=h.show;
 h.show=async(title,text)=>{await show(title,text);if(title.startsWith('Review all startup settings')){pages++;assert.ok(title.includes('page 1 of 2'));await fs.appendFile(f.file,'\n');}};
 await assert.rejects(settingsUI.editCombinedStartupFields(h,f.startup),/changed while editing/);assert.equal(pages,1);assert.equal(choices.length,0);assert.deepEqual(await fs.readFile(f.file),Buffer.concat([f.before,Buffer.from('\n')]));f.pass();
});

test('failed final prerequisite validation retains the complete draft for a fresh reviewed save',async t=>{
 const f=await fixture(t);let removed=false,restored=false;
 const choices=[...runtimeStage,...bridgeStage,'Review and save all changes',async()=>{await fs.rm(f.newBridge.profile.executable.file);removed=true;return 'Save all settings for next launch';},'Review and save all changes','Save all settings for next launch'];
 const h=host(f,choices,[...runtimeInputs(f),...bridgeInputs(f)]),show=h.show;
 h.show=async(title,text)=>{await show(title,text);if(title==='Settings could not be saved · combined draft retained'){assert.equal(removed,true);assert.deepEqual(await fs.readFile(f.file),f.before);await fs.writeFile(f.newBridge.profile.executable.file,'#!/bin/sh\nexit 17\n',{mode:0o700});restored=true;}};
 assert.equal(await settingsUI.editCombinedStartupFields(h,f.startup),'completed');assert.equal(restored,true);assert.equal(choices.length,0);assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1,runtime:f.newRuntime,bridge:f.newBridge});assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});

test('complete combined review traverses every exact page before the original saved-only write',async t=>{
 const f=await fixture(t),raw={version:1,runtime:{...f.runtime,dockerBinary:'/'+ 'old-unavailable-path-'.repeat(2500)},bridge:f.bridge};await fs.writeFile(f.file,JSON.stringify(raw),{mode:0o600});f.before=await fs.readFile(f.file);const pages=[];
 const choices=[...runtimeStage,...bridgeStage,'Review and save all changes',(_title,rows)=>{assert.equal(pages.length,2);assert.ok(pages.every(page=>page.length<=32000));const reviewed=JSON.parse(pages.join(''));assert.deepEqual(reviewed.before,raw);assert.deepEqual(reviewed.after,{version:1,runtime:f.newRuntime,bridge:f.newBridge});assert.equal(rows[0],'Keep editing');return 'Save all settings for next launch';}],h=host(f,choices,[...runtimeInputs(f),...bridgeInputs(f)]),show=h.show;
 h.show=async(title,text)=>{await show(title,text);if(title.startsWith('Review all startup settings'))pages.push(text);};
 assert.equal(await settingsUI.editCombinedStartupFields(h,f.startup),'completed');assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1,runtime:f.newRuntime,bridge:f.newBridge});assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});
test('combined form adapters preserve the original receiver of host methods',async t=>{
 const f=await fixture(t),base=host(f,[...runtimeStage,...bridgeStage,'Review and save all changes','Save all settings for next launch'],[...runtimeInputs(f),...bridgeInputs(f)]),h={};
 for(const name of ['guard','choose','input','show','notice'])Object.defineProperty(h,name,{value:function(...args){assert.equal(this,h,'Lost original '+name+' receiver');return base[name](...args);}});
 assert.equal(await settingsUI.editCombinedStartupFields(h,f.startup),'completed');assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1,runtime:f.newRuntime,bridge:f.newBridge});f.pass();
});

for(const component of ['runtime','bridge'])test(component+' callback failure remains a staging failure and retains its field values',async t=>{
 const f=await fixture(t),prepare=f.startup.prepareCombinedEdit.bind(f.startup);let calls=0;
 f.startup.prepareCombinedEdit=async()=>{const original=await prepare();return {...original,validate:async(value,guard)=>{if(value[component]&& !value[component==='runtime'?'bridge':'runtime']&&++calls===2)throw Error('OWNED_STAGE_REVIEW_FAILURE');return original.validate(value,guard);}};};
 const stage=component==='runtime'?runtimeStage:bridgeStage,repeat=stage.slice(2),choices=[...stage,...repeat,'Leave combined repair','Discard staged changes'],h=host(f,choices,component==='runtime'?runtimeInputs(f):bridgeInputs(f));
 assert.equal(await settingsUI.editCombinedStartupFields(h,f.startup),'cancelled');assert.ok(h.shown.some(view=>view.title===(component==='runtime'?'Runtime changes could not enter the combined draft · field values retained':'Claude changes could not enter the combined draft · field values retained')&&view.text.includes('OWNED_STAGE_REVIEW_FAILURE')));assert.equal(choices.length,0);assert.deepEqual(await fs.readFile(f.file),f.before);assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});

import {HostCommands} from '../../dist/ui/host-commands.js';
import {configurationCommands} from '../../dist/ui/configuration-commands.js';
function commandRegistry(f,h,extra={}){
 const unavailable=new Proxy({},{get(_target,key){assert.fail('Combined repair resolved an unrelated account/model setting: '+String(key));}});
 return new HostCommands(configurationCommands({controller:f.c,models:unavailable,accounts:unavailable,settings:unavailable,isCurrent:()=>true,uiLocale:()=> 'en',...h,apply(){},assertPresentationChange(){},commandKey:'ctrl+g',...extra}));
}
test('ordinary setup menu reaches the same combined draft through a selectable authored label',async t=>{
 const f=await fixture(t),h=host(f,['Repair runtime and Claude together','Leave combined repair']);assert.equal(await commandRegistry(f,h).execute('/setup',f.cid),'cancelled');assert.deepEqual(await fs.readFile(f.file),f.before);assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});
for(const drift of ['language','selection'])test('ordinary combined command refuses original '+drift+' drift before a field opens',async t=>{
 const f=await fixture(t);let current=true;const h=host(f,[()=>{if(drift==='language'){const language=f.c.getConversationLanguage(f.cid);f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:0,expectedRevision:language.revision,replyLanguage:'ko'});}else current=false;return 'Edit runtime settings';}]);
 await assert.rejects(commandRegistry(f,h,{isCurrent:()=>current}).execute('/setup combined',f.cid),/Startup form source changed/);assert.equal(h.defaults.length,0);assert.deepEqual(await fs.readFile(f.file),f.before);assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});
test('completed combined save survives later language drift and cannot post a notice into the changed source',async t=>{
 const f=await fixture(t),prepare=f.startup.prepareCombinedEdit.bind(f.startup);let saves=0;
 f.startup.prepareCombinedEdit=async()=>{const original=await prepare();return {...original,save:async(...args)=>{const result=await original.save(...args);saves++;const language=f.c.getConversationLanguage(f.cid);f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:0,expectedRevision:language.revision,replyLanguage:'ko'});return result;}};};
 const h=host(f,[...runtimeStage,...bridgeStage,'Review and save all changes','Save all settings for next launch'],[...runtimeInputs(f),...bridgeInputs(f)]);
 assert.equal(await commandRegistry(f,h).execute('/setup combined',f.cid),'completed');assert.equal(saves,1);assert.ok(!h.notices.some(text=>text.startsWith('All reviewed settings saved')));assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1,runtime:f.newRuntime,bridge:f.newBridge});assert.equal(f.c.options.runtimeProfile,f.active);f.pass();
});
