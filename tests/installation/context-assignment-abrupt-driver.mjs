// Copied outside checkout; product code comes exclusively from the selected payload.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [payload,home,targetId,git,output,mode]=process.argv.slice(2),load=file=>import(pathToFileURL(path.join(payload,'dist',file)).href);
const {openController}=await load('controller/index.js'),profile=JSON.parse(await fs.readFile(path.join(home,'config/startup.json'),'utf8')).runtime;
const c=await openController({installationHome:home,...mode==='missing'?{}:{runtimeProfile:profile},effectsProfile:{gitBinary:git},...['cut','restore'].includes(mode)?{interactionDelegation:{projectIds:['P'],maxAssignments:2},effectDelegations:[{projectId:'P',targetId,operationLimit:1}]}:{}});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
    if(mode==='cut'){
        await fs.writeFile(path.join(path.dirname(output),'context-seed-process.json'),JSON.stringify({pid:process.pid,node:process.execPath}),{mode:0o600});
        const {ApplicationModels}=await load('app/models.js'),{initializeApplicationEnvironment}=await load('app/environment.js');initializeApplicationEnvironment();
        const models=new ApplicationModels(c);models.install();
        const root=await models.newConversation({projectId:null,choice:{kind:'managed',provider:'installed-managed',modelId:'original',thinkingLevel:'off'}});
        const turn=async(cid,text,expected='delivered')=>{const v=c.inspectConversation(cid);await c.queueConversationInput({conversationId:cid,expectedGeneration:v.generation,text,mode:'idle'});const result=await c.runConversation({conversationId:cid,...models.conversationOperation(cid)});assert.equal(result.status,expected);return result;};
        const first=await turn(root.conversationId,'Original installed root intent and finite authority'),rootView=c.inspectConversation(root.conversationId),clone=await c.forkConversation({conversationId:root.conversationId,expectedGeneration:rootView.generation,expectedModelRevision:c.getConversationModelChoice(root.conversationId).revision,kind:'clone'});
        const cloned=await turn(clone.conversationId,'Original installed clone before actual abrupt child write');
        await turn(clone.conversationId,'Admit original inherited task and wait before actual abrupt write','waiting');
        const s=c.store,work=s.one('SELECT * FROM works WHERE id=?',cloned.workId),origin=JSON.parse(work.data).contextOrigin,event=s.one('SELECT * FROM sources WHERE id=?',origin.sourceEventId),assignment=s.one("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.operation')='change'"),child=s.one('SELECT * FROM works WHERE id=?',assignment.work),view=c.inspectConversation(clone.conversationId),grant=s.one('SELECT * FROM effect_delegations WHERE root=? AND target=?',first.workId,targetId);
        assert.ok(grant&&child);const histories=await Promise.all([rootView,view].map(async v=>({conversationId:v.conversationId,historyRef:v.historyRef,sha256:hash(await fs.readFile(v.historyRef)),sessionId:v.nativeSessionId})));
        await fs.writeFile(output,JSON.stringify({assignmentId:assignment.id,assignment,child,conversationId:clone.conversationId,workId:cloned.workId,rootConversationId:root.conversationId,rootWorkId:first.workId,grantId:grant.id,original:{work,origin,event,histories}},null,2),{mode:0o600});
        // Real governed dispatch remains active; the parent fixture kills this
        // process only after persisted native write and settled parent barriers.
        await c.ordinaryCore.drain();throw Error('Expected actual abrupt cut before governed final response');
    }
    if(mode==='cleanup-only'){for(const name of await fs.readdir(path.join(home,'state/runtime'))){if(name.endsWith('.json'))assert.equal(JSON.parse(await fs.readFile(path.join(home,'state/runtime',name),'utf8')).state,'removed','Exact owned scope still uncertain '+name);}console.log('Exact owned runtime journals verified removed');}else{
    const original=JSON.parse(await fs.readFile(output,'utf8')),s=c.store;
    if(mode==='missing'||mode==='cleanup'){
        console.log(JSON.stringify({work:c.inspectWork(original.child.id),runs:s.all('SELECT * FROM runs WHERE work=?',original.child.id),budgets:s.all('SELECT * FROM budgets ORDER BY lineage,kind'),coordinator:s.one('SELECT * FROM conversation_state WHERE conversation=?',original.conversationId)}));
    }else if(mode==='restore'){
        await c.cancelWork({workId:original.workId});await c.cancelWork({workId:original.rootWorkId});
        const recovery=c.inspectOrdinaryWorkRecovery(original.rootWorkId);assert.equal(recovery.eligible,true,JSON.stringify(recovery.holds));c.recoverOrdinaryWorkAdmission({workId:original.rootWorkId,expectedContext:recovery.fingerprint,reason:'Separately restore original root after actual inherited producer loss'},()=>{});
        const renewal=c.inspectIntegrationGrantRenewal(original.rootWorkId,targetId);assert.equal(renewal.eligible,true,JSON.stringify(renewal.holds));c.renewOwnerIntegration({workId:original.rootWorkId,targetId,expectedContext:renewal.fingerprint,reason:'Renew original finite grant without resetting usage'},()=>{});
        const before=c.inspectWorkAllowance(original.child.id),extension=c.extendWorkAllowance({expected:before,kind:'resolution',additional:8,reason:'Explicit owner allowance for interrupted original task replanning and derived endpoint verification; preserve prior use'}),after=c.inspectWorkAllowance(original.child.id);assert.equal(after.resolution.limit,before.resolution.limit+8);assert.equal(after.resolution.consumed,before.resolution.consumed);assert.equal(after.resolution.reserved,before.resolution.reserved);original.ownerAllowanceExtension={before,after,extension};
        const context=c.inspectContextWorkRecovery(original.workId);assert.equal(context.eligible,true,JSON.stringify(context.holds));
        await fs.writeFile(output,JSON.stringify({...original,cancelledEpoch:s.one('SELECT epoch FROM works WHERE id=?',original.workId).epoch,priorOutcomes:['delivered','waiting'],budgets:s.all('SELECT * FROM budgets ORDER BY lineage,kind'),runs:s.all('SELECT * FROM runs'),inputs:s.all('SELECT * FROM conversation_inputs')},null,2),{mode:0o600});
    }else throw Error('Explicit abrupt driver mode required');
    }
}finally{await c.close();}
