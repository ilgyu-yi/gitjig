// Original application management/admission. No generation, native spawn or engine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [root,productRoot,mode]=process.argv.slice(2),cwd=path.join(root,'host'),agentDir=path.join(root,'agent');
const load=relative=>import(pathToFileURL(path.join(productRoot,relative)).href);
const {createOwnedClaudeHost}=await load('pi/claude-host.js');
const {openController}=await load('controller/index.js');
const {ApplicationAccounts}=await load('app/accounts.js');
const {ApplicationModels}=await load('app/models.js');
const {ApplicationSettings}=await load('app/settings.js');
const {modelConfigurationIdentity}=await load('pi/model-identity.js');
const {admitOwnedClaudeSelection}=await load('pi/claude-host.js');
const exe=fs.realpathSync(process.execPath),owner=await createOwnedClaudeHost({cwd,agentDir,executable:{file:exe,sha256:createHash('sha256').update(fs.readFileSync(exe)).digest('hex')}});
const home=path.join(root,'app'),c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'never-executed',image:'sha256:'+'0'.repeat(64)}}),accounts=ApplicationAccounts.open(c),models=new ApplicationModels(c);models.install();
const settingsFile=path.join(home,'config/settings.json'),rolesFile=path.join(home,'config/role-models.json');
const bytes=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
const tables=['conversations','conversation_state','conversation_views','conversation_relations','conversation_inputs','sources','works','runs','budgets','capacity_leases'];
const ledger=()=>Object.fromEntries(tables.map(name=>[name,c.store.all('SELECT * FROM '+name+' ORDER BY rowid')]));
const snapshot=()=>({settings:bytes(settingsFile),roles:bytes(rolesFile),ledger:ledger()});
let restore=()=>{},closeTail,receipt;
try{
 await accounts.configure({providers:{'b3-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'direct',reasoning:false,contextWindow:8192,maxTokens:256}]}}});
 await accounts.setDefault('b3-fixture','direct');
 const direct=await models.newConversation(),view=c.inspectConversation(direct.conversationId),rev=c.getConversationModelChoice(view.conversationId).revision;
 const unavailable=snapshot();
 await assert.rejects(accounts.setDefault('claude-bridge','unavailable'),/startup setup|restart/);
 await assert.rejects(models.setRole('reviewer',{kind:'managed',provider:'claude-bridge',modelId:'unavailable',thinkingLevel:'high'}),/startup setup|restart/);
 await assert.rejects(models.select({conversationId:view.conversationId,expectedGeneration:view.generation,expectedRevision:rev,provider:'claude-bridge',modelId:'unavailable'}),/startup setup|restart/);
 assert.deepEqual(snapshot(),unavailable);
 await c.adoptModelResource(owner);
 const listed=await accounts.models(),bridge=listed.models.find(model=>model.provider==='claude-bridge');assert.ok(bridge);assert.equal(listed.verification,'catalogue-only');
 const choice=await models.choice('claude-bridge',bridge.id,'high');
 const beforeConflict=snapshot();await assert.rejects(accounts.configure({providers:{'claude-bridge':{api:'openai-completions'}}}),/reserved/);assert.deepEqual(snapshot(),beforeConflict);
 if(mode==='management-admission'){
  await accounts.setDefault(choice.provider,choice.modelId);
  const scope=await accounts.setScope([choice.provider+'/'+choice.modelId,'b3-fixture/direct']);assert.equal(scope.models.length,2);
  await models.setRole('reviewer',choice);assert.deepEqual(models.rolePreferences().reviewer,choice);
  const conversation=await models.newConversation(),selectedChoice=c.getConversationModelChoice(conversation.conversationId);assert.equal(selectedChoice.revision,1);assert.equal(selectedChoice.kind,'managed');assert.equal(selectedChoice.provider,'claude-bridge');
  const selected=await models.resolve(conversation.conversationId);assert.equal(selected.managed,undefined);assert.ok(selected.bridge);assert.ok(selected.sessionPreferences);c.assertApplicationModelSource(selected,selectedChoice);
  const other=await openController({installationHome:path.join(root,'other-app')});try{assert.throws(()=>other.assertApplicationModelSource(selected,selectedChoice),/incompatible application source/);await assert.rejects(other.adoptModelResource(owner),/another controller/);}finally{await other.close();}
  let capacities=0;c.capacity.acquire=async()=>{capacities++;throw Error('B3_CONTROLLED_PRE_ENGINE_CAPACITY_REFUSAL');};
  const current=c.inspectConversation(conversation.conversationId);await c.queueConversationInput({conversationId:current.conversationId,expectedGeneration:current.generation,text:'NON_AUTHORITY B3 source-binding control',mode:'idle'});
  const result=await c.runConversation({conversationId:current.conversationId,...models.conversationOperation(current.conversationId)});assert.equal(result.status,'unavailable');assert.equal(capacities,1);
  const run=c.store.one('SELECT * FROM runs WHERE id=?',result.runId),data=JSON.parse(run.data),work=JSON.parse(c.store.one('SELECT data FROM works WHERE id=?',result.workId).data);
  assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(data.cleanup,'not-allocated');assert.equal(data.conversationModelMode.kind,'application');assert.equal(work.ordinaryRoleBinding.mode.baseline.choice.provider,'claude-bridge');
  assert.equal(c.store.one('SELECT COUNT(*) AS n FROM capacity_leases').n,0);for(const key of ['modelDispatch','historyRef','nativeSessionId','containerId'])assert.equal(Object.hasOwn(data,key),false);
  receipt={sharedModels:listed.models.length,registeredBridgeModels:listed.models.filter(model=>model.provider==='claude-bridge').length,choice:choice.modelId,desiredMode:'managed',actualSource:'owned bridge',queueEnvelopeResolved:true,originalOrdinaryAdmission:true,capacityRefusal:true,runId:run.id,workId:result.workId};
 }else if(mode==='bridge-role-admission'){
  fs.writeFileSync(path.join(root,'project/file.txt'),'SOURCE');await c.registerProject({id:'P',sourceRoot:path.join(root,'project')});
  await models.setRole('planner',choice);
  const baseline=await models.baseline('P'),work=await c.beginChange({projectId:'P',request:'Bounded original bridge role admission',applicationModelBaseline:baseline}),options={workId:work.workId,...models.workOperation(work.workId)};
  const issued=await owner.selectModel(choice.modelId,choice.thinkingLevel),descriptors=Object.getOwnPropertyDescriptors(issued);
  descriptors.sessionPreferences={value:options.sessionPreferences,enumerable:true};
  const selected=Object.create(Object.getPrototypeOf(issued),descriptors),admitted=admitOwnedClaudeSelection(selected);
  assert.deepEqual(admitted.sessionPreferences,options.sessionPreferences);assert.ok(Object.isFrozen(admitted));assert.ok(Object.isFrozen(admitted.sessionPreferences));
  assert.equal(admitOwnedClaudeSelection(issued),issued);
  const extra=Object.getOwnPropertyDescriptors(selected);extra.unknown={value:true,enumerable:true};assert.throws(()=>admitOwnedClaudeSelection(Object.create(Object.getPrototypeOf(selected),extra)),/does not match/);
  const malformed=Object.getOwnPropertyDescriptors(issued);malformed.sessionPreferences={value:{steeringMode:'all'},enumerable:true};assert.throws(()=>admitOwnedClaudeSelection(Object.create(Object.getPrototypeOf(issued),malformed)),/complete/);
  let capacities=0;c.changes.h.acquireCapacity=async()=>{capacities++;throw Error('B3_CONTROLLED_ROLE_PRE_ENGINE_CAPACITY_REFUSAL');};
  const result=await c.planChange(options);assert.equal(capacities,1);assert.match(result.blocked.join(' '),/B3_CONTROLLED_ROLE_PRE_ENGINE_CAPACITY_REFUSAL/);
  const launch=c.store.one('SELECT * FROM role_launches WHERE work=?',work.workId),run=c.store.one('SELECT * FROM runs WHERE id=?',launch.run),data=JSON.parse(run.data),identity=createHash('sha256').update(JSON.stringify(modelConfigurationIdentity(selected))).digest('hex');
  assert.equal(launch.status,'UNUSABLE');assert.equal(JSON.parse(launch.data).modelIdentity,identity);assert.equal(data.modelIdentity,identity);assert.deepEqual(data.modelMode,{kind:'application',version:1,baselineRevision:1});assert.equal(run.phase,'SETTLED');
  assert.equal(c.store.one('SELECT COUNT(*) AS n FROM budgets WHERE reserved<>0').n,0);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM capacity_leases').n,0);
  for(const key of ['modelDispatch','historyRef','nativeSessionId','containerId'])assert.equal(Object.hasOwn(data,key),false);
  receipt={originalRoleAdmission:true,queueEnvelopeRetained:true,unknownMetadataRefused:true,malformedQueueRefused:true,capacityRefusal:true,runId:run.id,workId:work.workId,modelIdentity:identity};
 }else{
  let checks=0;
  const before=snapshot();
  if(mode==='closed-default'){
   const original=ApplicationSettings.prototype.manager;
   ApplicationSettings.prototype.manager=function(project,guard){const manager=original.call(this,project,guard&&(()=>{checks++;guard();}));if(guard){const save=manager.setDefaultModelAndProvider.bind(manager);manager.setDefaultModelAndProvider=(...args)=>{save(...args);closeTail=owner.close();};}return manager;};
   restore=()=>ApplicationSettings.prototype.manager=original;
   await assert.rejects(accounts.setDefault(choice.provider,choice.modelId),/could not be saved/);assert.ok(checks>0);
  }else if(mode==='closed-role'){
   const original=ApplicationModels.prototype.prepareChoiceGuard;let prepared=0;
   ApplicationModels.prototype.prepareChoiceGuard=async function(...args){const guard=await original.apply(this,args);if(++prepared===2){await owner.close();return()=>{checks++;guard();};}return guard;};restore=()=>ApplicationModels.prototype.prepareChoiceGuard=original;
   await assert.rejects(models.setRole('reviewer',choice),/closing/);assert.equal(checks,1);
  }else if(mode==='closed-conversation'){
   const completed=c.completed,original=completed.reclaim.bind(completed);completed.reclaim=async(...args)=>{await original(...args);checks++;await owner.close();};restore=()=>completed.reclaim=original;
   await assert.rejects(models.select({conversationId:view.conversationId,expectedGeneration:view.generation,expectedRevision:rev,provider:choice.provider,modelId:choice.modelId,thinkingLevel:choice.thinkingLevel}),/closing/);assert.equal(checks,1);
  }else{
   assert.equal(mode,'closed-new');const original=c.store.tx.bind(c.store);c.store.tx=fn=>{checks++;closeTail=owner.close();return original(fn);};restore=()=>c.store.tx=original;
   await assert.rejects(models.newConversation({choice}),/closing/);assert.equal(checks,1);
  }
  restore();restore=()=>{};await closeTail;assert.deepEqual(snapshot(),before);
  const directOnly=await accounts.models();assert.ok(directOnly.models.some(model=>model.provider==='b3-fixture'));await accounts.setDefault('b3-fixture','direct');
  receipt={mode,finalGuardChecks:checks,exactSnapshotUnchanged:true,directManagementAfterBridgeClose:true};
 }
 fs.writeFileSync(path.join(root,'application-ledger.json'),JSON.stringify(ledger(),null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({complete:true,...receipt,scope:'management and original pre-engine admission only; no native generation/summary/coexistence'}));
}finally{restore();await closeTail;await c.close();await owner.close();}
