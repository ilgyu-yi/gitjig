import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
const execute = promisify(execFile), git = '/opt/homebrew/bin/git', runtimeProfile = { dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
import {withValueCases,scripted,settledRoot,cleanupFixture} from './effect-fixture.mjs';
test('actual parent source change refuses native send and re-enters SAME original child and operation after independent fit',{timeout:60000},async()=>{
    assert.ok(runtimeProfile.image && runtimeProfile.dockerContext);
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/effect-core-'))), home = path.join(root, 'home'), source = path.join(root, 'source'), seed = path.join(root, 'seed'), receiver = path.join(root, 'receiver.git');
    await fs.mkdir(source);
    await fs.mkdir(seed);
    const initial = '// User local choice: 10\n' + Array.from({ length: 8 }, (_, i) => '// Context ' + i + '\n').join('') + 'module.exports=2;\n', dirty = initial.replace('choice: 10', 'choice: 11'), checker = withValueCases(`console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n`);
    await fs.writeFile(path.join(seed, 'consumer.cjs'), initial);
    await fs.writeFile(path.join(seed, 'check.cjs'), checker);
    await execute(git, ['init', '--initial-branch=main', seed]);
    await execute(git, ['-C', seed, 'add', 'consumer.cjs', 'check.cjs']);
    await execute(git, ['-C', seed, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial K']);
    const K = (await execute(git, ['-C', seed, 'rev-parse', 'HEAD'])).stdout.trim();
    await execute(git, ['init', '--bare', receiver]);
    await execute(git, ['-C', seed, 'push', receiver, 'HEAD:refs/heads/main']);
    await fs.writeFile(path.join(source, 'consumer.cjs'), dirty);
    await fs.writeFile(path.join(source, 'check.cjs'), checker);
    let passed=false;
    let c = await openController({ installationHome: home, runtimeProfile, effectsProfile: { gitBinary: git } });
    process.env.TMPDIR = path.join(home, 'artifacts');
    try {
        await c.registerProject({id:'P',sourceRoot:source});
        const receiver3=path.join(root,'changed-parent-receiver.git');await execute(git,['init','--bare',receiver3]);await execute(git,['-C',seed,'push',receiver3,'HEAD:refs/heads/main']);const target3=await c.registerLocalTarget({projectId:'P',path:receiver3,ref:'refs/heads/main',basisCommit:K,publicationInventory:['consumer.cjs','check.cjs'],authorizedDeltaPaths:['consumer.cjs','check.cjs']});await c.close();c=await openController({installationHome:home,runtimeProfile,effectsProfile:{gitBinary:git},interactionDelegation:{projectIds:['P'],maxAssignments:4},effectDelegations:[{projectId:'P',targetId:target3.targetId,operationLimit:1}]});
        const {openNativeGit}=await import('../../dist/effects/index.js'),probe=await openNativeGit({gitBinary:git,ownedClientRoot:path.join(root,'prototype-client')}),proto=Object.getPrototypeOf(probe);await probe.close();const originalPrepare=proto.prepareForwardSend;let reached,release,blockedOperation;const preflightReached=new Promise(r=>reached=r),barrier=new Promise(r=>release=r);let once=true;
        proto.prepareForwardSend=async function(input,signal){const prepared=await originalPrepare.call(this,input,signal);if(input.target.targetId===target3.targetId&&once){once=false;blockedOperation=input.operationId;reached();await Promise.race([barrier,new Promise(r=>signal.addEventListener('abort',r,{once:true}))]);}return prepared;};
        try{
            const parent3=c.createConversation(),changedAgent=scripted((context,turn)=>{const receipt=name=>{const result=context.messages.filter(m=>m.role==='toolResult'&&m.toolName===name).at(-1);return JSON.parse(result.content.filter(x=>x.type==='text').map(x=>x.text).join(''));};const firstAssign=()=>{const result=context.messages.find(m=>m.role==='toolResult'&&m.toolName==='conversation_assign');return JSON.parse(result.content.filter(x=>x.type==='text').map(x=>x.text).join(''));};
                if(turn===0)return {tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Export3 and preserve user local edit locally',operation:'change',resultDependency:true}}};
                if(turn===1)return {tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_assign').assignmentId]}}};
                if(turn===2)return {tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:firstAssign().assignmentId,targetId:target3.targetId}}};
                if(turn===3)return {tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_integrate').assignmentId]}}};
                if(turn===4)return {tool:{name:'conversation_status',arguments:{conversationId:firstAssign().conversationId}}};
                if(turn===5)return {tool:{name:'conversation_assign',arguments:{conversationId:firstAssign().conversationId,observedDirectionRevision:receipt('conversation_status').directionRevision,projectId:'P',instructions:'Actual owner now requires value4; update consumer and its existing checker on the SAME retained task, preserving notes',operation:'change',resultDependency:true}}};
                if(turn===6)return {tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_assign').assignmentId]}}};
                if(turn===7)return {tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:firstAssign().assignmentId,targetId:target3.targetId}}};
                if(turn===8)return {tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_integrate').assignmentId]}}};
                if(turn===9)return {tool:{name:'effect_inspect',arguments:{operationId:receipt('conversation_integrate').operationId}}};
                return {text:'Exact retained operation confirmed after actual changed-owner source-fit and same-child replan'};
            });
            await c.queueConversationInput({conversationId:parent3.conversationId,expectedGeneration:0,text:'ROOT changed-parent integration scenario',mode:'idle'});const first3=await c.runConversation({conversationId:parent3.conversationId,model:changedAgent});assert.equal(first3.status,'waiting');await Promise.race([preflightReached,new Promise((_,reject)=>setTimeout(()=>reject(Error('Actual preflight barrier not reached')),30000).unref())]);
            const oldOp=c.inspectEffect(blockedOperation),oldChild=c.inspectChange(oldOp.workId),oldSource=c.inspectWork(oldOp.workId).source,parentView=c.inspectConversation(parent3.conversationId);c.extendResolutionAllowance({workId:oldOp.workId,additional:12,reason:'Actual owner criterion revision has bounded same-W replan allowance'});
            const changedInput=await c.queueConversationInput({conversationId:parent3.conversationId,expectedGeneration:parentView.generation,text:'Owner changed requirement: consumer must export value4 instead of3.',mode:'idle'}),notesInput=await c.queueConversationInput({conversationId:parent3.conversationId,expectedGeneration:parentView.generation,text:'Also retain the existing context notes unchanged.',mode:'idle'});release();
            for(let i=0;i<500;i++){const row=c.store.one("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.effectOperationId')=?",blockedOperation);if(row.state==='UNAVAILABLE')break;await new Promise(r=>setTimeout(r,10));}
            const refused=c.inspectEffect(blockedOperation);assert.equal(refused.phase,'REFUSED',JSON.stringify(refused));assert.equal((await execute(git,['--git-dir='+receiver3,'rev-parse','refs/heads/main'])).stdout.trim(),K);assert.equal(c.store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='send'",blockedOperation).length,0);assert.equal(c.inspectChange(oldOp.workId).reviewReady,false);
            const inherited=c.store.all("SELECT * FROM conversation_inputs WHERE work=? AND json_extract(data,'$.inheritedOwnerSource') IS NOT NULL",oldOp.workId);assert.equal(inherited.length,2);assert.deepEqual(new Set(inherited.map(i=>i.source)),new Set([changedInput.sourceId,notesInput.sourceId]));assert.ok(inherited.every(i=>i.state==='DISPATCHED_WORKFLOW'));c.effectsCore.recover();assert.equal(c.store.all("SELECT * FROM conversation_inputs WHERE work=? AND json_extract(data,'$.inheritedOwnerSource') IS NOT NULL",oldOp.workId).length,2);
            const resumed=await c.runConversation({conversationId:parent3.conversationId,model:changedAgent});assert.equal(resumed.status,'waiting',JSON.stringify(c.store.all('SELECT * FROM conversation_assignments')));
            for(let i=0;i<3000;i++){if(c.inspectEffect(blockedOperation).phase==='CONFIRMED'&&settledRoot(c,parent3.conversationId,first3.workId,5))break;await new Promise(r=>setTimeout(r,10));}
            assert.ok(settledRoot(c,parent3.conversationId,first3.workId,5),'Changed-source root final result must actually settle');
            const final3=c.inspectEffect(blockedOperation);assert.equal(final3.phase,'CONFIRMED',JSON.stringify({final3,child:c.inspectChange(oldOp.workId),assignments:c.store.all('SELECT * FROM conversation_assignments')}));assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',target3.targetId).n,1);assert.equal(c.store.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE source_conversation=? AND json_extract(data,'$.operation')='change'",parent3.conversationId).n,1);assert.deepEqual(c.inspectWork(oldOp.workId).source,oldSource);assert.ok(c.inspectChange(oldOp.workId).execution.consumed>oldChild.execution.consumed);assert.equal(c.inspectChange(oldOp.workId).execution.limit,oldChild.execution.limit);assert.notEqual(c.inspectChange(oldOp.workId).planVersion,oldChild.planVersion);assert.ok(c.interactionCore.impacts(oldOp.workId).every(i=>!i.data.effectHold));assert.ok(c.store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='source-fit-reentry'",blockedOperation).length);assert.equal((await execute(git,['--git-dir='+receiver3,'show','refs/heads/main:consumer.cjs'])).stdout,initial.replace('exports=2','exports=4'));assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),dirty);
        }finally{release?.();proto.prepareForwardSend=originalPrepare;}

        passed=true;
    }finally{await cleanupFixture(c,root,passed);}
});
