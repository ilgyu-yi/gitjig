import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openController } from '../../dist/controller/index.js';
test('actual V3 retained W/source/input migrate atomically to effects V4 and reopen without changing procedure/budget', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-effect-v4-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'consumer.txt'), 'retained');
    let c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const begun = await c.beginChange({ projectId: 'P', request: '원본 source survives migration', executionLimit: 7 }), before = c.inspectWork(begun.workId), change = c.inspectChange(begun.workId);
        await c.close();
        const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'));
        db.exec('PRAGMA foreign_keys=OFF;DROP TABLE effect_receipts;DROP TABLE effect_operations;DROP TABLE authority_observations;DROP TABLE effect_delegations;DROP TABLE effect_targets;PRAGMA user_version=3');
        db.close();
        c = await openController({ installationHome: home });
        assert.equal(c.store.one('PRAGMA user_version').user_version, 8);
        assert.deepEqual(c.inspectWork(begun.workId), before);
        assert.deepEqual(c.inspectChange(begun.workId), change);
        assert.equal(c.store.all('PRAGMA foreign_key_check').length, 0);
        assert.equal(c.store.all('SELECT * FROM effect_operations').length, 0);
        await c.close();
        c = await openController({ installationHome: home });
        assert.deepEqual(c.inspectWork(begun.workId), before);
        assert.equal(c.inspectChange(begun.workId).reviewReady, false);
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('actual project-owned Git helper is rejected before host process creation while a naive explicit executable control plants marker',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),run=promisify(execFile),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-git-boundary-'))),source=path.join(root,'source'),home=path.join(root,'home'),receiver=path.join(root,'receiver'),marker=path.join(root,'marker');await fs.mkdir(source);await fs.mkdir(receiver);const helper=path.join(source,'git'),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";await fs.writeFile(helper,'#!/bin/sh\nprintf planted > '+quote(marker)+'\nprintf "git version 2.55.0\\n"\n',{mode:0o700});await run(helper,['--version']);assert.equal(await fs.readFile(marker,'utf8'),'planted');await fs.unlink(marker);const c=await openController({installationHome:home,effectsProfile:{gitBinary:helper}});
 try{await c.registerProject({id:'P',sourceRoot:source});await assert.rejects(c.registerLocalTarget({projectId:'P',path:receiver,ref:'refs/heads/main',basisCommit:'0'.repeat(40),publicationInventory:['git'],authorizedDeltaPaths:['git']}),/cannot originate from project/);await assert.rejects(fs.access(marker));assert.equal(c.store.all('SELECT * FROM effect_targets').length,0);assert.equal(c.store.all('SELECT * FROM effect_operations').length,0);}
 finally{await c.close();await fs.rm(root,{recursive:true,force:true});}
});

test('source-fit validates ALL held decisions against one tuple before mutation; invalid last decision leaves every hold and old plan',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-fit-batch-'))),source=path.join(root,'source'),home=path.join(root,'home');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.txt'),'actual bytes');const c=await openController({installationHome:home});try{await c.registerProject({id:'P',sourceRoot:source});const w=await c.beginChange({projectId:'P',request:'Original R1'}),core=c.changeCore,plan=core.newVersion(w.workId,'plan',null,{plan:{requirements:[{id:'R1',text:'Original retained requirement'}],verification:{checks:[],requiredPaths:[],reviewRoles:[]}}},'fixture-plan');c.store.run('UPDATE change_state SET plan=? WHERE work=?',plan,w.workId);const C=c.createConversation({projectId:'P'});c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?',w.workId,C.conversationId);const first=await c.queueConversationInput({conversationId:C.conversationId,expectedGeneration:0,text:'Owner source A',mode:'idle'}),second=await c.queueConversationInput({conversationId:C.conversationId,expectedGeneration:0,text:'Owner source B',mode:'idle'}),run=c.inspectWork(w.workId).runs[0];c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','fixture-J',w.workId,run.id,'adjudicator',w.epoch,'COMPLETE','none',JSON.stringify({stage:'source-fit'}));const valid=[first,second].map(i=>({inputId:i.inputId,directionRevision:i.directionRevision,impact:'scope-change',reason:'Both actual owner inputs have been considered in one fixture judgment',requirementIds:['R1']}));
  for(const kind of ['unknown','ambiguous','omitted','stage']){const decisions=structuredClone(valid);if(kind==='unknown')decisions[1].requirementIds=['UNKNOWN'];if(kind==='ambiguous')decisions[1].impact='ambiguous';if(kind==='omitted')decisions.pop();c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({stage:kind==='stage'?'review-adjudication':'source-fit'}),'fixture-J');assert.throws(()=>core.inputDecisions(w.workId,'fixture-J',{inputDecisions:decisions}),/unknown|ambiguity|clarification|omitted|stage/);assert.ok(c.interactionCore.impacts(w.workId).every(i=>i.data.effectHold));assert.equal(c.inspectChange(w.workId).planVersion,plan);}
  c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({stage:'source-fit'}),'fixture-J');core.inputDecisions(w.workId,'fixture-J',{inputDecisions:valid});assert.ok(c.interactionCore.impacts(w.workId).every(i=>!i.data.effectHold));assert.equal(c.inspectChange(w.workId).planVersion,null);assert.equal(c.inspectChange(w.workId).phase,'BASE_CAPTURED');assert.ok(c.inspectChange(w.workId).versions.some(v=>v.id===plan));
 }finally{await c.close();await fs.rm(root,{recursive:true,force:true});}
});

test('nested coordinator B renews ALL owner-root A receipts only after same-child independent fit; no B owner message is fabricated',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-root-fit-'))),source=path.join(root,'source'),home=path.join(root,'home');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.txt'),'actual bytes');const c=await openController({installationHome:home});try{
  await c.registerProject({id:'P',sourceRoot:source});const nodes=[];for(const name of ['A','B','child']){const w=await c.beginChange({projectId:'P',request:name}),C=c.createConversation({projectId:'P'});c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?',w.workId,C.conversationId);const row=c.store.one('SELECT * FROM works WHERE id=?',w.workId);c.store.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),conversation:C.conversationId}),w.workId);nodes.push({w:w.workId,C:C.conversationId});}
  const[A,B,child]=nodes,e=c.effects,identity={conversationId:B.C,workId:B.w,runId:'fixture-B-native',generation:0,initialInputId:'fixture-original-input'},origin=e.sourceToken(identity),ownerRoot=e.ownerToken(A.w);c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','reviewed',B.C,child.C,child.w,'COMPLETE',JSON.stringify({operation:'change',source:identity}));c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','target','P',JSON.stringify({kind:'local-git',canonicalPath:'/owned/fixture',ref:'refs/heads/main',basisCommit:'a'.repeat(40)}));c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','grant',A.w,'target',0,'{}');c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','op',child.w,'target','grant','RESERVED',JSON.stringify({origin,ownerRoot,reviewedAssignmentId:'reviewed',evidence:{fixture:'already-current-evidence',versions:{candidate:null}}}));
  const p=c.changeCore.newVersion(child.w,'plan',null,{plan:{requirements:[{id:'R1',text:'retained original scope'}]}},'fixture-plan');c.store.run('UPDATE change_state SET plan=? WHERE work=?',p,child.w);
  const one=await c.queueConversationInput({conversationId:A.C,expectedGeneration:0,text:'Actual original owner A changed criterion',mode:'idle'}),two=await c.queueConversationInput({conversationId:A.C,expectedGeneration:0,text:'Actual original owner A adds note preservation',mode:'idle'});e.recover();const inherited=c.interactionCore.impacts(child.w);assert.equal(inherited.length,2);assert.deepEqual(new Set(inherited.map(i=>i.source)),new Set([one.sourceId,two.sourceId]));assert.equal(c.store.all('SELECT * FROM conversation_inputs WHERE conversation=?',B.C).length,0);
  const core=c.changeCore,assertEvidence=core.assertCurrentEvidence;core.assertCurrentEvidence=()=>{}; // Source-boundary fixture supplies an already-accepted evidence tuple; does not certify a native candidate.
  try{assert.throws(()=>e.refreshSourceFit(e.op('op')),/Every changed parent\/root owner source/);const run=c.inspectWork(child.w).runs[0],wrow=c.store.one('SELECT epoch FROM works WHERE id=?',child.w);c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','root-fit-J',child.w,run.id,'adjudicator',wrow.epoch,'COMPLETE','none',JSON.stringify({stage:'source-fit'}));const decisions=inherited.map(i=>({inputId:i.input_id,directionRevision:i.revision,impact:'explanation',reason:'Fixture non-author scope judgment consumes each exact original source independently',requirementIds:['R1']}));core.inputDecisions(child.w,'root-fit-J',{inputDecisions:decisions});e.refreshSourceFit(e.op('op'));e.validateOrigin(e.op('op'));const receipt=c.store.one("SELECT data FROM effect_receipts WHERE operation='op' AND kind='source-fit-reentry'");assert.deepEqual(new Set(JSON.parse(receipt.data).sourceProofs.map(p=>p.sourceId)),new Set([one.sourceId,two.sourceId]));assert.equal(c.store.all('SELECT * FROM conversation_inputs WHERE conversation=?',B.C).length,0);assert.equal(e.op('op').data.ownerRoot.direction,2);assert.equal(e.op('op').data.origin.direction,0);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);
  }finally{core.assertCurrentEvidence=assertEvidence;}
 }finally{await c.close();await fs.rm(root,{recursive:true,force:true});}
});
