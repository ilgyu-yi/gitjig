import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {managedWorld} from './managed-change-fixture.mjs';import {ApplicationSettings} from '../../dist/app/settings.js';import {HostCommands} from '../../dist/ui/host-commands.js';import {configurationCommands} from '../../dist/ui/configuration-commands.js';
function editor(f,actions=[],inputs=[],override={}){const settings=ApplicationSettings.open(f.c),notices=[];let current=true,index=0;const registry=new HostCommands(configurationCommands({controller:f.c,accounts:f.accounts,models:f.models,settings,commandKey:'Ctrl+G',isCurrent:()=>current,choose:async(title,rows)=>{const choice=actions[index++];return typeof choice==='function'?choice(title,rows):rows.find(row=>row.startsWith(choice??'NO_CHOICE'));},input:async()=>inputs.shift(),notice:t=>notices.push(t),apply(){},assertPresentationChange(){},...override}));return{settings,notices,setCurrent:v=>current=v,run:(text,target=f.cid)=>registry.execute(text,target)};}
test('staged ordered patterns preserve suffixes and duplicates; cancellation leaves original settings and current/default choices',async t=>{
 const f=await managedWorld(t);await f.accounts.setScope(['managed-fixture/original:high','managed-fixture/future','managed-fixture/future']);const file=path.join(f.home,'config/settings.json'),before=await fs.readFile(file),choice=f.c.getConversationModelChoice(f.cid);
 const cancel=editor(f,['Remove 2','Add Pi pattern','Cancel'],['managed-fixture/*']);assert.equal(await cancel.run('/scoped-models'),'cancelled');assert.ok((await fs.readFile(file)).equals(before));
 const save=editor(f,['Remove 2','Save application cycling pool']);await save.run('/scoped-models');assert.deepEqual(save.settings.inspect().global.enabledModels,['managed-fixture/original:high','managed-fixture/future']);assert.deepEqual(f.c.getConversationModelChoice(f.cid),choice);assert.equal((await f.models.list()).default.model,'future');f.pass();
});
test('application thinking map retains unavailable models for reset and never copies effective project values',async t=>{
 const f=await managedWorld(t),settings=ApplicationSettings.open(f.c);await settings.setPreference('modelThinkingLevels',{'missing-provider/old-model':'high','managed-fixture/original':'low'});settings.approveProject('P');await fs.mkdir(path.join(f.root,'project/.gitjig'));await fs.writeFile(path.join(f.root,'project/.gitjig/settings.json'),JSON.stringify({modelThinkingLevels:{'managed-fixture/future':'max'},enabledModels:['managed-fixture/original']}));
 const h=editor(f,['missing-provider/old-model','Reset application override','Save application thinking preferences']);await h.run('/settings modelThinkingLevels');assert.deepEqual(h.settings.inspect('P').global.modelThinkingLevels,{'managed-fixture/original':'low'});assert.deepEqual(h.settings.inspect('P').project.modelThinkingLevels,{'managed-fixture/future':'max'});assert.ok(h.notices.at(-1).includes('project override remains'));
 const scope=editor(f,['Save application cycling pool']);await scope.run('/scoped-models');assert.deepEqual(scope.settings.inspect('P').global.enabledModels,[]);assert.deepEqual(scope.settings.inspect('P').project.enabledModels,['managed-fixture/original']);f.pass();
});
test('raw preference/approval drift and async resolver target changes reject before saving',async t=>{
 const f=await managedWorld(t),file=path.join(f.home,'config/settings.json');
 const raw=editor(f,[async(_title,rows)=>{await fs.appendFile(file,'\n');return rows.find(row=>row.startsWith('Save application'));}]);await assert.rejects(raw.run('/scoped-models'),/changed while editing/);const after=await fs.readFile(file);
 const h=editor(f,[],[],{}),original=f.models.scope;const {ApplicationModels}=await import('../../dist/app/models.js');const scope=ApplicationModels.prototype.scope;
 ApplicationModels.prototype.scope=async function(patterns){const result=await scope.call(this,patterns);h.setCurrent(false);return result;};try{await assert.rejects(h.run('/scoped-models ["managed-fixture/future"]'),/target changed/);}finally{ApplicationModels.prototype.scope=scope;f.models.scope=original;}
 assert.ok((await fs.readFile(file)).equals(after));const snapshot=h.settings.prepareEdit('P');h.settings.approveProject('P');assert.throws(snapshot.assertCurrent,/changed while editing/);f.pass();
});
test('plain numeric zero, boolean false and empty cycling pool retain correct consumer behavior',async t=>{
 const f=await managedWorld(t),h=editor(f,['false'],['0']);await h.run('/settings editorPaddingX');await h.run('/settings fullscreenCopyOnSelect');assert.equal(h.settings.manager().getEditorPaddingX(),0);assert.equal(h.settings.manager().getFullscreenCopyOnSelect(),false);
 const before=f.c.getConversationModelChoice(f.cid),empty=editor(f,['Save application cycling pool']);await empty.run('/scoped-models');await assert.rejects(f.models.next({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,expectedRevision:before.revision}),/cycling pool/);assert.deepEqual(f.c.getConversationModelChoice(f.cid),before);assert.equal((await f.models.list()).default.model,'future');f.pass();
});

test('invalid pattern recovery preserves staged additions/removals and never saves automatically',async t=>{
 const f=await managedWorld(t);await f.accounts.setScope(['managed-fixture/original:high','managed-fixture/future']);
 const h=editor(f,['Remove 1','Add Pi pattern','Add Pi pattern','Back to staged edits','Save application cycling pool'],['managed-fixture/original:low','bad\npattern']);
 await h.run('/scoped-models');assert.deepEqual(h.settings.inspect().global.enabledModels,['managed-fixture/future','managed-fixture/original:low']);
 const file=path.join(f.home,'config/settings.json'),before=await fs.readFile(file);
 for(const invalid of ['', 'x'.repeat(1025),'bad\u0085pattern','bad\u2028pattern']){
  const cancelled=editor(f,['Remove 1','Add Pi pattern','Back to staged edits','Cancel'],[invalid]);
  assert.equal(await cancelled.run('/scoped-models'),'cancelled');assert.ok((await fs.readFile(file)).equals(before));
 }
 const stale=editor(f,['Add Pi pattern',()=>{stale.setCurrent(false);return 'Back to staged edits';}],['bad\tpattern']);
 await assert.rejects(stale.run('/scoped-models'),/target changed/);assert.ok((await fs.readFile(file)).equals(before));f.pass();
});

test('full cycling pool recovery preserves prior removals and allows an explicit later save',async()=>{
 const {editModelScope}=await import('../../dist/ui/preference-editors.js');
 const initial=Array.from({length:500},(_,i)=>'fixture/model-'+i),actions=['Add Pi pattern','Back to staged edits','Remove 1','Save application cycling pool'];
 let checks=0,sawLimit=false;
 const result=await editModelScope({choose:async(title,rows)=>{if(title.includes('limited to 500'))sawLimit=true;const action=actions.shift();return rows.find(row=>row.startsWith(action));},input:async()=>'fixture/extra',assertCurrent:()=>checks++},initial,[],false);
 assert.equal(sawLimit,true);assert.equal(checks,5);assert.deepEqual(result,initial.slice(1));assert.equal(initial.length,500);
});
