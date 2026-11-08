import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedNormalHostedIntegrationFixture} from '../../.qualification/controller-testing.js';
import {subject} from './hosted-core-fixture.mjs';
import {scripted,settledRoot} from './effect-fixture.mjs';

test('recovered original inherited assignment replans the same task through actual procedures and its original finite endpoint',{timeout:120000},async t=>{
    const f=await subject({normalNative:true,retainSuccess:true,native:{fixtureRoot:process.env.GITJIG_RUNTIME_FIXTURE_ROOT}});let c;
    try{
        f.configure();const {targetId}=await f.c.registerHostedIntegrationTarget(f.registration);await f.c.close();
        c=await openController({installationHome:path.join(f.native.root,'home'),capacityLimit:2,runtimeProfile:{dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,...process.env.GITJIG_DOCKER_CONFIG_DIRECTORY?{dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY}:{},image:process.env.GITJIG_RUNTIME_IMAGE},effectsProfile:{gitBinary:'/opt/homebrew/bin/git'},interactionDelegation:{projectIds:['P'],maxAssignments:2},effectDelegations:[{projectId:'P',targetId,operationLimit:1}]});
        configureOwnedNormalHostedIntegrationFixture(c,{origin:f.rest.origin,token:f.native.token,https:{origin:f.native.origin,caFile:f.native.ca,execPath:f.native.execPath}});
        let phase='seed',endpointTurn=0,originalAssignment,originalChild;
        const instructions='Export3; preserve user local choice locally, land only reviewed delta';
        const model=scripted(context=>{
            if(phase==='seed')return{text:'Actual retained original context before cancellation'};
            const turn=endpointTurn++;
            const receipt=name=>JSON.parse(context.messages.filter(m=>m.role==='toolResult'&&m.toolName===name).at(-1).content.filter(p=>p.type==='text').map(p=>p.text).join(''));
            if(phase==='original'){
                if(turn===0)return{tool:{name:'conversation_assign',arguments:{projectId:'P',instructions,operation:'change',resultDependency:true}}};
                originalAssignment=receipt('conversation_assign');return{tool:{name:'conversation_wait',arguments:{resultHandles:[originalAssignment.assignmentId]}}};
            }
            if(turn===0)return{tool:{name:'conversation_status',arguments:{conversationId:originalAssignment.conversationId}}};
            if(turn===1){const observed=receipt('conversation_status');return{tool:{name:'conversation_recover_assignment',arguments:{assignmentId:originalAssignment.assignmentId,expectedWorkEpoch:observed.workEpoch,observedDirectionRevision:observed.directionRevision,reason:'Explicitly recover this same inherited task'}}};}
            if(turn===2){assert.equal(receipt('conversation_recover_assignment').state,'RECOVERY_READY');return{tool:{name:'conversation_status',arguments:{conversationId:originalAssignment.conversationId}}};}
            if(turn===3)return{tool:{name:'conversation_assign',arguments:{conversationId:originalAssignment.conversationId,observedDirectionRevision:receipt('conversation_status').directionRevision,projectId:'P',instructions,operation:'change',resultDependency:true}}};
            if(turn===4){assert.equal(receipt('conversation_assign').assignmentId,originalAssignment.assignmentId);return{tool:{name:'conversation_wait',arguments:{resultHandles:[originalAssignment.assignmentId]}}};}
            if(turn===5)return{tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:originalAssignment.assignmentId,targetId}}};
            if(turn===6)return{tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_integrate').assignmentId]}}};
            return{text:'Recovered original clone received its actual immutable endpoint result'};
        });
        const turn=async(cid,text)=>{const view=c.inspectConversation(cid);await c.queueConversationInput({conversationId:cid,expectedGeneration:view.generation,text,mode:'idle'});return c.runConversation({conversationId:cid,model});};
        const root=c.createConversation().conversationId,rootRun=await turn(root,'Original independent owner intent');assert.equal(rootRun.status,'delivered');
        const rootView=c.inspectConversation(root),clone=await c.forkConversation({conversationId:root,expectedGeneration:rootView.generation,expectedModelRevision:c.getConversationModelChoice(root).revision,kind:'clone'});
        const first=await turn(clone.conversationId,'Original cloned ordinary context before root cancellation');assert.equal(first.status,'delivered');
        const s=c.store,original=s.one('SELECT * FROM works WHERE id=?',first.workId),origin=JSON.parse(original.data).contextOrigin,grant=s.one('SELECT * FROM effect_delegations WHERE root=? AND target=?',rootRun.workId,targetId);
        // Admit the genuine original task/source, then stop before governed model
        // dispatch. No procedure success is fabricated. Explicit cancellation
        // withdraws the original coordinator and the original inherited task.
        const core=c.changeCore,drive=core.drive;core.drive=async input=>core.inspect(input.workId);
        try{phase='original';assert.equal((await turn(clone.conversationId,'Delegate the original inherited task and wait')).status,'waiting');await c.ordinaryCore.drain();}finally{core.drive=drive;}
        originalChild=s.one('SELECT * FROM works WHERE id=(SELECT work FROM conversation_assignments WHERE id=?)',originalAssignment.assignmentId);assert.ok(originalChild);
        const history=c.inspectConversation(clone.conversationId).historyRef,bytes=await fs.readFile(history);
        await c.cancelWork({workId:first.workId});await c.cancelWork({workId:rootRun.workId});
        const recovery=c.inspectOrdinaryWorkRecovery(rootRun.workId);assert.equal(recovery.eligible,true,JSON.stringify(recovery.holds));
        c.recoverOrdinaryWorkAdmission({workId:rootRun.workId,expectedContext:recovery.fingerprint,reason:'Separately recover same original root'},()=>{});
        const renewal=c.inspectIntegrationGrantRenewal(rootRun.workId,targetId);assert.equal(renewal.eligible,true,JSON.stringify(renewal.holds));
        c.renewOwnerIntegration({workId:rootRun.workId,targetId,expectedContext:renewal.fingerprint,reason:'Keep same original finite lineage endpoint'},()=>{});
        const context=c.inspectContextWorkRecovery(first.workId);assert.equal(context.eligible,true,JSON.stringify(context.holds));
        await c.recoverContextWorkAdmission({workId:first.workId,expectedContext:context.fingerprint,reason:'Recover this same clone without assigning or sending'},()=>{});
        assert.deepEqual(await fs.readFile(history),bytes);assert.equal(s.one('SELECT COUNT(*) AS n FROM conversation_assignments').n,1);assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?',originalAssignment.assignmentId).state,'CANCELLED');assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_operations').n,0);
        phase='endpoint';endpointTurn=0;const started=await turn(clone.conversationId,'Perform reviewed export3 change and integrate under the separately renewed original finite grant');assert.equal(started.workId,first.workId);assert.equal(started.status,'waiting',JSON.stringify(started));
        const deadline=Date.now()+90000;
        while(!settledRoot(c,clone.conversationId,first.workId,5)){const held=s.one("SELECT id,state FROM conversation_assignments WHERE state='UNAVAILABLE' LIMIT 1");if(held)throw Error('Actual original assignment held: '+JSON.stringify(held));if(Date.now()>deadline)throw Error('Recovered original clone did not receive its endpoint result');await new Promise(resolve=>setTimeout(resolve,20));}
        const operations=s.all('SELECT * FROM effect_operations');assert.equal(operations.length,1);assert.equal(operations[0].phase,'CONFIRMED',JSON.stringify(operations));assert.equal(operations[0].grant_id,grant.id);
        assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?',grant.id).n,1);
        const assigned=s.one("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.operation')='change'");assert.equal(assigned.id,originalAssignment.assignmentId);assert.equal(assigned.work,originalChild.id);const retained=s.one('SELECT * FROM works WHERE id=?',assigned.work);assert.equal(retained.source,originalChild.source);assert.deepEqual(JSON.parse(retained.data).invocation,JSON.parse(originalChild.data).invocation);const change=c.inspectChange(assigned.work);assert.equal(change.reviewReady,true);
        assert.ok(change.checks.some(check=>check.status==='pass'&&check.candidate===change.candidateVersion&&check.data.actual.exitCode===0&&check.data.caseResults.complete&&!check.data.caseResults.mismatches.length));
        const selected=JSON.parse(s.one('SELECT data FROM change_state WHERE work=?',assigned.work).data),review=change.launches.find(launch=>launch.id===selected.selection.general),author=change.launches.find(launch=>launch.role==='implementer');assert.ok(review&&author);assert.notEqual(review.run,author.run);assert.equal(review.data.inputVersions.candidate,change.candidateVersion);assert.equal(review.data.inputVersions.requirements,selected.requirementVersion);assert.equal(review.data.inputVersions.contracts,selected.contractsVersion);assert.equal(s.one('SELECT epoch FROM runs WHERE id=?',review.run).epoch,retained.epoch);assert.equal(s.one("SELECT COUNT(*) n FROM capacity_leases WHERE state!='RELEASED'").n,0);
        assert.deepEqual(JSON.parse(s.one('SELECT data FROM works WHERE id=?',first.workId).data).contextOrigin,origin);
        assert.equal(f.native.requests.filter(request=>request.path.endsWith('/git-receive-pack')).length,1);
        assert.equal(s.one("SELECT COUNT(*) AS n FROM runs WHERE phase!='SETTLED'").n,0);assert.equal(s.one("SELECT COUNT(*) AS n FROM budgets WHERE reserved!=0").n,0);
        t.diagnostic(JSON.stringify({root:f.native.root,rootWork:rootRun.workId,contextWork:first.workId,childWork:assigned.work,operation:operations[0].id,grant:grant.id,scope:'Same original cancelled coordinator and inherited assignment/work; actual recovery, replanning, procedures and one owned native fixture push.'}));f.pass();
    }finally{await c?.close();await f.close();}
});
