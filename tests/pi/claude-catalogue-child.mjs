// Original public product host/catalogue/session consumer; never prompt or start native.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {getSupportedThinkingLevels,clampThinkingLevel} from '@earendil-works/pi-ai';
const [root,productRoot,mode]=process.argv.slice(2),cwd=path.join(root,'host'),agentDir=path.join(root,'agent'),project=path.join(root,'project');
assert.equal(process.cwd(),cwd);assert.equal(process.env.PI_CODING_AGENT_DIR,agentDir);
const moduleUrl=relative=>pathToFileURL(path.join(productRoot,relative)).href;
const {createOwnedClaudeHost,admitOwnedClaudeSelection}=await import(moduleUrl('pi/claude-host.js'));
const {captureNativeModelSelection,modelConfigurationIdentity}=await import(moduleUrl('pi/model-identity.js'));
const {initializePiHost,createPiSession}=await import(moduleUrl('pi/index.js'));
const executable={file:fs.realpathSync(process.execPath),sha256:createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex')};
const owner=await createOwnedClaudeHost({cwd,agentDir,executable});let sessions=[];
try{
 if(mode==='ambient-home'){
  await assert.rejects(owner.models(),/fixed application agentDir\/home startup HOME/);
  console.log(JSON.stringify({complete:true,sessions:0,ambientHomeRefused:true,scope:'refused before original loader discovery'}));
 }else{
 const models=await owner.models();assert.ok(models.length>1);assert.equal(Object.isFrozen(models),true);
 for(const model of models){assert.equal(Object.isFrozen(model),true);assert.equal(Object.isFrozen(model.input),true);}
 const alternate=models.find(model=>model.id!==owner.modelSelection.modelId&&getSupportedThinkingLevels(model).includes('high'));assert.ok(alternate);
 const resolvedDefault=await owner.selectModel(alternate.id);assert.equal(resolvedDefault.bridgeThinkingLevel,clampThinkingLevel(alternate,'off'));
 const selected=await owner.selectModel(alternate.id,'high');
 assert.equal(admitOwnedClaudeSelection(selected),selected);
 await assert.rejects(owner.selectModel('MISSING_MODEL'),/absent/);
 await assert.rejects(owner.selectModel(alternate.id,'INVALID_LEVEL'),/unsupported/);
 assert.throws(()=>admitOwnedClaudeSelection({...selected,bridge:owner}),/not issued/);
 const forged=Object.create(Object.getPrototypeOf(selected),{...Object.getOwnPropertyDescriptors(selected),modelId:{value:owner.modelSelection.modelId}});
 assert.throws(()=>admitOwnedClaudeSelection(forged),/does not match/);
 const queued=captureNativeModelSelection(Object.create(Object.getPrototypeOf(selected),{...Object.getOwnPropertyDescriptors(selected),sessionPreferences:{value:{steeringMode:'one-at-a-time',followUpMode:'all'},enumerable:true}}));
 const host=await initializePiHost({stateRoot:path.join(root,'state'),artifactRoot:path.join(root,'artifacts')});
 const operations={workspaceRoot:project,validatePath:p=>{const target=path.resolve(project,p);assert.ok(target===project||target.startsWith(project+'/'));return target;},async exec(){throw Error('NO_EXEC');},async readFile(){throw Error('NO_READ');},async access(){throw Error('NO_ACCESS');},async writeFile(){throw Error('NO_WRITE');},async mkdir(){throw Error('NO_MKDIR');}};
 const options={host,operations,systemPrompt:'Original unprompted construction only.',maxReadBytes:1024};
 sessions.push(await createPiSession({...options,model:queued}));sessions.push(await createPiSession({...options,model:owner.modelSelection}));
 assert.notEqual(sessions[0].sessionManager.getSessionId(),sessions[1].sessionManager.getSessionId());
 assert.equal(sessions[0].session.steeringMode,'one-at-a-time');assert.equal(sessions[0].session.followUpMode,'all');
 assert.equal(sessions[0].session.model.id,alternate.id);assert.equal(sessions[0].session.thinkingLevel,'high');assert.equal(sessions[1].session.model.id,owner.modelSelection.modelId);assert.equal(sessions[1].session.thinkingLevel,clampThinkingLevel(models.find(model=>model.id===owner.modelSelection.modelId),'off'));assert.equal(modelConfigurationIdentity(owner.modelSelection).thinkingLevelSource,'original-sdk-default');
 assert.equal(modelConfigurationIdentity(selected).thinkingLevel,'high');
 const other=sessions[0].modelRuntime.getModel('claude-bridge',owner.modelSelection.modelId);assert.ok(other);
 assert.throws(()=>sessions[0].modelRuntime.streamSimple(other,{messages:[]},{sessionId:sessions[0].sessionManager.getSessionId()}),/another provider\/model/);
 await sessions[0].closeOwned();assert.equal(sessions[1].session.model.id,owner.modelSelection.modelId);await sessions[1].closeOwned();
 assert.equal(fs.existsSync(path.join(agentDir,'auth.json')),false);assert.equal(fs.existsSync(path.join(root,'ambient-activated')),false);
 await owner.close();assert.throws(()=>owner.models(),/closing/);
 console.log(JSON.stringify({complete:true,registeredModels:models.length,alternate:alternate.id,thinking:'high',sessions:2,originalDeferredRegistration:true,runtimeRetargetRefused:true,forgedSelectionRefused:true,authFileCreated:false,scope:'original unprompted sessions; no native query, summary or entitlement'}));
 }
}finally{for(const session of sessions)await session.closeOwned();await owner.close();}
