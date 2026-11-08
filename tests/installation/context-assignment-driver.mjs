// Copied outside checkout; all product imports resolve from one immutable installed payload.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [payload,home,targetId,git,output]=process.argv.slice(2),load=file=>import(pathToFileURL(path.join(payload,'dist',file)).href);
const {openController}=await load('controller/index.js'),{ApplicationModels}=await load('app/models.js'),{initializeApplicationEnvironment}=await load('app/environment.js');
initializeApplicationEnvironment();
const c=await openController({installationHome:home,effectsProfile:{gitBinary:git},interactionDelegation:{projectIds:['P'],maxAssignments:2},effectDelegations:[{projectId:'P',targetId,operationLimit:1}]});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
    const models=new ApplicationModels(c);models.install();
    const root=await models.newConversation({projectId:null,choice:{kind:'managed',provider:'installed-managed',modelId:'original',thinkingLevel:'off'}});
    const turn=async(cid,text,expected='delivered')=>{const v=c.inspectConversation(cid);await c.queueConversationInput({conversationId:cid,expectedGeneration:v.generation,text,mode:'idle'});const result=await c.runConversation({conversationId:cid,...models.conversationOperation(cid)});assert.equal(result.status,expected);return result;};
    const first=await turn(root.conversationId,'Original installed root intent and finite authority');
    const rootView=c.inspectConversation(root.conversationId),clone=await c.forkConversation({conversationId:root.conversationId,expectedGeneration:rootView.generation,expectedModelRevision:c.getConversationModelChoice(root.conversationId).revision,kind:'clone'});
    const cloned=await turn(clone.conversationId,'Original installed clone dialogue before root cancellation');
    const s=c.store,original=s.one('SELECT * FROM works WHERE id=?',cloned.workId),grant=s.one('SELECT * FROM effect_delegations WHERE root=? AND target=?',first.workId,targetId);
    assert.ok(grant);const origin=JSON.parse(original.data).contextOrigin,event={...s.one('SELECT * FROM sources WHERE id=?',origin.sourceEventId)},view=c.inspectConversation(clone.conversationId);
    const core=c.changeCore,drive=core.drive;core.drive=async input=>core.inspect(input.workId);
    try{await turn(clone.conversationId,'Admit original inherited task and wait before cancellation','waiting');await c.ordinaryCore.drain();}finally{core.drive=drive;}
    const assignment=s.one("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.operation')='change'"),child=s.one('SELECT * FROM works WHERE id=?',assignment.work);assert.ok(child);
    const currentView=c.inspectConversation(clone.conversationId);
    const histories=await Promise.all([rootView,currentView].map(async v=>({conversationId:v.conversationId,historyRef:v.historyRef,sha256:hash(await fs.readFile(v.historyRef)),sessionId:v.nativeSessionId})));
    await c.cancelWork({workId:cloned.workId});await c.cancelWork({workId:first.workId});
    const recovery=c.inspectOrdinaryWorkRecovery(first.workId);assert.equal(recovery.eligible,true,JSON.stringify(recovery.holds));
    c.recoverOrdinaryWorkAdmission({workId:first.workId,expectedContext:recovery.fingerprint,reason:'Restore original installed root independently'},()=>{});
    const renewal=c.inspectIntegrationGrantRenewal(first.workId,targetId);assert.equal(renewal.eligible,true,JSON.stringify(renewal.holds));
    c.renewOwnerIntegration({workId:first.workId,targetId,expectedContext:renewal.fingerprint,reason:'Keep original finite lineage grant; no reset or send'},()=>{});
    assert.equal(c.inspectContextWorkRecovery(cloned.workId).eligible,true);
    const record={cancelledEpoch:s.one('SELECT epoch FROM works WHERE id=?',cloned.workId).epoch,assignmentId:assignment.id,assignment,child,priorOutcomes:['delivered','waiting'],conversationId:clone.conversationId,workId:cloned.workId,rootConversationId:root.conversationId,rootWorkId:first.workId,grantId:grant.id,original:{work:original,origin,event,histories},budgets:s.all('SELECT * FROM budgets ORDER BY kind'),runs:s.all('SELECT * FROM runs'),inputs:s.all('SELECT * FROM conversation_inputs')};
    await fs.writeFile(output,JSON.stringify(record,null,2),{mode:0o600});
}finally{await c.close();}
