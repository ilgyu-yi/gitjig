import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {after} from 'node:test';
import {openController} from '../../dist/controller/index.js';
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
let sequence=0,worldSequence=0,sharedRoot,allPassed=true;
const originalTmp=process.env.TMPDIR;
after(async()=>{if(originalTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTmp;if(sharedRoot&&allPassed)await fs.rm(sharedRoot,{recursive:true,force:true});});
function scripted(tool) {
    const id=++sequence;let calls=0;
    return {provider:'structured-assignment-'+id,modelId:'fixture',definition:{apiKey:'UNUSED',baseUrl:'http://unused.invalid',api:'structured-assignment-api-'+id,
        models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:32000,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],
        streamSimple(m){const stream=createAssistantMessageEventStream(),call=++calls===1?tool():null;
            const message={role:'assistant',content:call?[{type:'toolCall',id:'owned-call-'+id,...call}]:[{type:'text',text:'Owned coordination turn finished.'}],
                api:m.api,provider:m.provider,model:m.id,usage,stopReason:call?'toolUse':'stop',timestamp:Date.now()};
            queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message);});return stream;}}};
}
/** Original native tools, child capture, allocation, publication and cancellation.
 * Governed procedure and external-effect outcomes are controlled; no engine/send/model endpoint is used.
 */
export async function structuredAssignmentWorld(t, { originalGovernedDispatch = false, retainRoot = false } = {}) {
    if (retainRoot) allPassed = false; // A dynamically imported owner controls its own cleanup order.
    sharedRoot??=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-structured-assignment-')));
    const root=sharedRoot,home=path.join(root,'home'),source=path.join(root,'source'),worldId=++worldSequence;
    await fs.mkdir(source,{recursive:true});await fs.writeFile(path.join(source,'file.txt'),'owned source');
    const c=await openController({installationHome:home,interactionDelegation:{projectIds:['P'],maxAssignments:8}});
    process.env.TMPDIR=path.join(home,'artifacts');if(!c.listProjects().some(project=>project.id==='P'))await c.registerProject({id:'P',sourceRoot:source});const parent=c.createConversation().conversationId;
    let passed=false,expectedBackgroundFailure=false,child,effect,onGoverned=()=>{},onEffect=()=>{};
    t.after(async()=>{try{await c.close().catch(error=>{if(!expectedBackgroundFailure)throw error;});}finally{if(!passed){allPassed=false;t.diagnostic('Retained structured assignment '+root);}}});
    if (!originalGovernedDispatch) c.ordinary.h.launchChange=async assignmentId=>{
        const row=c.store.one('SELECT * FROM conversation_assignments WHERE id=?',assignmentId),data=JSON.parse(row.data);
        const begun=await c.changeCore.begin({projectId:'P',request:'Owned delegated task'},{kind:'agent-governed-assignment',actor:data.source,delegationRoot:data.delegationRoot,sourceEvent:data.instructionsSource,conversationId:row.target,assignmentId});
        const run=c.store.one('SELECT id FROM runs WHERE work=?',begun.workId);
        c.store.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?',begun.workId,JSON.stringify({runId:run.id}),row.target);
        child={assignmentId,conversationId:row.target,workId:begun.workId};
        const result={workId:begun.workId,epoch:c.store.one('SELECT epoch FROM works WHERE id=?',begun.workId).epoch,reviewReady:true,phase:'REVIEW_READY'};await onGoverned(child,result);return result;
    };
    return {c,root,home,parent,get child(){return child;},get effect(){return effect;},
        onGoverned(fn){onGoverned=fn;},onEffect(fn){onEffect=fn;},expectBackgroundFailure(){expectedBackgroundFailure=true;},
        async assign(){await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'Delegate owned task',mode:'idle'});
            const result=await c.runConversation({conversationId:parent,model:scripted(()=>({name:'conversation_assign',arguments:{projectId:'P',instructions:'Owned delegated task',operation:'change',resultDependency:true}}))});await c.ordinary.drain();return result;},
        async integrate(){
            const receiverRoot=path.join(root,'receiver-'+worldId);await fs.mkdir(receiverRoot);const receiver=await fs.stat(receiverRoot),target='owned-target-'+worldId,grant='owned-grant-'+worldId;
            c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',target,'P',JSON.stringify({kind:'local-git',target:{targetId:target,canonicalPath:receiverRoot,device:String(receiver.dev),inode:String(receiver.ino),ownerUid:process.getuid(),objectFormat:'sha1',ref:'refs/heads/main'},basisCommit:'a'.repeat(40),publicationInventory:['file.txt'],authorizedDeltaPaths:['file.txt'],ownerUid:process.getuid()}));
            c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',grant,c.inspectConversation(parent).workId,target,1,JSON.stringify({kind:'local-git',rootEpoch:1,mode:'ordinary',scope:'delegation-lineage',operationLimit:4}));
            c.ordinary.h.effectControls=(identity,onQueue)=>({integrate:async()=>{
                const operationId=c.effects.allocate(child.workId,target,{versions:{candidate:'controlled-procedure-standing'}},{reviewedAssignmentId:child.assignmentId,origin:c.effects.sourceToken(identity),ownerRoot:c.effects.ownerToken(c.inspectConversation(parent).workId)},{identity,reviewedAssignmentId:child.assignmentId});
                const data=JSON.parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',operationId).data);
                effect={operationId,assignmentId:data.assignmentId,conversationId:data.conversationId,workId:child.workId};onQueue(effect);return effect;
            }});
            c.ordinary.h.launchEffect=async assignmentId=>{
                c.store.run("UPDATE conversation_assignments SET state='RUNNING' WHERE id=?",assignmentId);
                const result={operationId:effect.operationId,workId:child.workId,phase:'CONFIRMED'},retainedPhase=await onEffect(effect,result);
                c.store.run('UPDATE effect_operations SET phase=? WHERE id=?',typeof retainedPhase==='string'?retainedPhase:result.phase,effect.operationId);
                return result;
            };
            await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'Integrate owned task',mode:'idle'});
            const result=await c.runConversation({conversationId:parent,model:scripted(()=>({name:'conversation_integrate',arguments:{reviewedAssignmentId:child.assignmentId,targetId:target}}))});await c.ordinary.drain();return result;
        },pass(){passed=true;}};
}
