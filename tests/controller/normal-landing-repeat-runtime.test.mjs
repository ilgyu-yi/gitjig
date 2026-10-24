import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedNormalHostedIntegrationFixture,configureOwnedContributionFixture,configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
import {subject} from './hosted-core-fixture.mjs';
import {settledRoot} from './effect-fixture.mjs';
import {repeatedMergeFixture,cycleModel,cyclePublicationFixture} from './repeated-merge-fixture.mjs';
const execute=promisify(execFile), git='/opt/homebrew/bin/git';

// Synthetic model/approval decisions; actual SDK, runtime procedures, healthy and
// adverse checks, HTTPS Git and two distinct native PR merges. Admin fence changes
// and source sync are EXTERNAL test-operator actions, never agent authority or UI.
test('two reviewed hosted cycles require explicit external fence transitions and synchronized base ancestry',{timeout:240000},async t=>{
    for(const name of ['GITJIG_DOCKER_CONFIG_DIRECTORY','GITJIG_RUNTIME_FIXTURE_ROOT']){
        const directory=process.env[name];assert.ok(directory&&path.isAbsolute(directory),'Explicit private '+name+' required');
        assert.equal(await fs.realpath(directory),directory);const stat=await fs.stat(directory);
        assert.ok(stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700);
    }
    const oldTmp=process.env.TMPDIR,sets=[],f=await subject({normalNative:true,retainSuccess:true,ref:'refs/heads/feature/path',sets,native:{fixtureRoot:process.env.GITJIG_RUNTIME_FIXTURE_ROOT}});
    let c,branchRest,failure,releaseCurrent=()=>{};const receipts={adminTransitions:[],sourceSync:null,cycles:[]};
    try {
        await f.native.command(['update-ref','refs/heads/feature/path',f.native.B]);f.configure();
        const native=await repeatedMergeFixture(t,f.native.receiver,sets);
        branchRest=await cyclePublicationFixture(f.native,sets,'refs/heads/feature/path');
        const policyFile=path.join(f.native.root,'repeat-enforced-policy.json'),hook=path.join(f.native.root,'repeat-enforce-policy.mjs'),receiveLog=path.join(f.native.root,'repeat-native-receives.jsonl');
        await fs.writeFile(policyFile,'[]');
        await fs.writeFile(hook,`import fs from 'node:fs';const sets=JSON.parse(fs.readFileSync(${JSON.stringify(policyFile)},'utf8'));const input=fs.readFileSync(0,'utf8').trim().split('\\n');fs.appendFileSync(${JSON.stringify(receiveLog)},JSON.stringify(input)+'\\n');for(const line of input){const [old,next,ref]=line.split(' ');if(sets.some(s=>s.enforcement==='active'&&s.current_user_can_bypass==='never'&&s.conditions.ref_name.include.includes('~ALL')&&!s.conditions.ref_name.exclude.includes(ref)&&s.rules.some(r=>r.type==='update'||r.type==='creation'&&/^0+$/.test(old)))){process.stderr.write('Native owned policy refused '+ref+'\\n');process.exit(1);}}`);
        await fs.mkdir(path.join(f.native.receiver,'hooks'),{recursive:true});
        await fs.writeFile(path.join(f.native.receiver,'hooks/pre-receive'),'#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' '+JSON.stringify(hook)+'\n',{mode:0o700});
        const fence=native.mergeRules.find(s=>s.rules.some(r=>r.type==='update'));
        assert.ok(fence);assert.deepEqual(fence.conditions.ref_name,{include:['~ALL'],exclude:['refs/heads/main']});assert.equal(fence.current_user_can_bypass,'never');
        const transport=['-c','http.sslCAInfo='+f.native.ca,'-c','http.extraHeader=Authorization: Basic '+Buffer.from('x-access-token:'+f.native.token).toString('base64')];
        const gitEnv={PATH:'/opt/homebrew/bin:/usr/bin:/bin',HOME:f.native.root,LANG:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_AUTHOR_NAME:'Owned external operator',GIT_AUTHOR_EMAIL:'operator@example.invalid',GIT_COMMITTER_NAME:'Owned external operator',GIT_COMMITTER_EMAIL:'operator@example.invalid'};
        const runGit=async args=>(await execute(git,args,{env:gitEnv,timeout:10000,maxBuffer:1024*1024})).stdout.trim();
        const push=async(sha,ref)=>runGit(['--git-dir='+f.native.receiver,...transport,'push',f.native.origin+'/owner/repo.git',sha+':'+ref]);
        async function register(controller,number,headRef,basis){
            configureOwnedNormalHostedIntegrationFixture(controller,{origin:branchRest.origin,token:f.native.token,https:{origin:f.native.origin,caFile:f.native.ca,execPath:f.native.execPath}});
            configureOwnedContributionFixture(controller,{origin:native.origin,token:'owned-native-merge-only'});configureOwnedMergeFixture(controller,{origin:native.origin,token:'owned-native-merge-only'});
            const branch=await controller.registerHostedIntegrationTarget({...f.registration,ref:'refs/heads/'+headRef,basisCommit:basis,authorizedDeltaPaths:['consumer.cjs','check.cjs']});
            const resource=await controller.trackRepositoryResource({repository:{owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9'},kind:'pull-request',number});
            const merge=await controller.registerMergeTarget({resourceId:resource.resourceId??resource.id,sourceBranchTargetId:branch.targetId,baseRef:'main'});
            return {branchTarget:branch.targetId,mergeTarget:merge.targetId};
        }
        async function reopen(targets){
            await c?.close();await f.c.close();
            c=await openController({installationHome:path.join(f.native.root,'home'),capacityLimit:2,runtimeProfile:{dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,image:process.env.GITJIG_RUNTIME_IMAGE},effectsProfile:{gitBinary:git},interactionDelegation:{projectIds:['P'],maxAssignments:2},effectDelegations:[{projectId:'P',targetId:targets.branchTarget,operationLimit:1}],mergeDelegations:[{projectId:'P',targetId:targets.mergeTarget,operationLimit:1,notifications:'allow-merge-notifications'}]});
            configureOwnedNormalHostedIntegrationFixture(c,{origin:branchRest.origin,token:f.native.token,https:{origin:f.native.origin,caFile:f.native.ca,execPath:f.native.execPath}});
            configureOwnedMergeFixture(c,{origin:native.origin,token:'owned-native-merge-only'});
        }
        async function rejectPush(sha,ref){
            let refusal;
            await assert.rejects(push(sha,ref),error=>{refusal={ref,attempted:sha,exitCode:error.code,stderr:error.stderr};return /Native owned policy refused/.test(error.stderr);});
            return refusal;
        }
        async function cycle(number,value,headRef,basis,targets){
            const release=Promise.withResolvers(),held=Promise.withResolvers();releaseCurrent=()=>release.resolve();let calls=0;
            const parent=c.createConversation(), producer=cycleModel(value,(context,turn)=>{
                calls++;
                const receipt=name=>JSON.parse(context.messages.filter(m=>m.role==='toolResult'&&m.toolName===name).at(-1).content.filter(x=>x.type==='text').map(x=>x.text).join(''));
                if(turn===0)return{tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Export'+value+'; keep user local choice local, publish reviewed delta and merge existing PR '+number,operation:'change',resultDependency:true}}};
                if(turn===1)return{tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_assign').assignmentId]}}};
                if(turn===2)return{tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:receipt('conversation_assign').assignmentId,targetId:targets.branchTarget}}};
                if(turn===3)return{tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_integrate').assignmentId]}}};
                if(turn===4){const branch=c.store.one("SELECT * FROM effect_operations WHERE target=? AND phase='CONFIRMED'",targets.branchTarget);assert.ok(branch);return{tool:{name:'conversation_merge',arguments:{reviewedAssignmentId:receipt('conversation_assign').assignmentId,targetId:targets.mergeTarget,branchOperationId:branch.id}}};}
                if(turn===5)return{tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_merge').assignmentId]}}};
                if(turn===6)return{tool:{name:'effect_inspect',arguments:{operationId:receipt('conversation_merge').operationId}}};
                return{text:'Original cycle '+number+' merged; exact native result inspected'};
            });
            const original=producer.definition.streamSimple;
            const model={...producer,definition:{...producer.definition,streamSimple(m,context,options){
                const first=context.messages.find(message=>message.role==='user').content.filter(x=>x.type==='text').map(x=>x.text).join('');
                if(!first.startsWith('Perform the assigned ')&&calls===4){const stream=createAssistantMessageEventStream();held.resolve();void(async()=>{await release.promise;const inner=original(m,context,options);for await(const event of inner)stream.push(event);stream.end(await inner.result());})();return stream;}
                return original(m,context,options);
            }}};
            await c.queueConversationInput({conversationId:parent.conversationId,expectedGeneration:0,text:'ROOT cycle '+number+' author export'+value+', publish exact head and merge this distinct PR under captured finite grants',mode:'idle'});
            const started=await c.runConversation({conversationId:parent.conversationId,model});assert.equal(started.status,'waiting');
            let timer;try{await Promise.race([held.promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Cycle '+number+' did not reach confirmed-publication barrier')),85000))]);}finally{clearTimeout(timer);}
            const branch=c.store.one("SELECT * FROM effect_operations WHERE target=? AND phase='CONFIRMED'",targets.branchTarget);assert.ok(branch);
            const publication=JSON.parse(branch.data),head=(await f.native.command(['rev-parse','refs/heads/'+headRef])).toString().trim();
            assert.equal(publication.integrationCommit,head);assert.equal((await f.native.command(['rev-parse','refs/heads/main'])).toString().trim(),basis);
            await f.native.command(['merge-base','--is-ancestor',basis,head]);
            const tree=(await f.native.command(['rev-parse',head+'^{tree}'])).toString().trim();assert.equal(publication.tree,tree);
            sets.splice(0,sets.length,...structuredClone(native.mergeRules));await fs.writeFile(policyFile,JSON.stringify(sets));
            receipts.adminTransitions.push({operator:'external fixture administrator',action:'activate exact fence after confirmed publication',number,branchOperationId:branch.id,head,basis,fence:structuredClone(sets),at:Date.now()});
            const adversary=(await f.native.command(['commit-tree',tree,'-p',head],Buffer.from('Forbidden post-fence source update'))).toString().trim();
            const rejected=await rejectPush(adversary,'refs/heads/'+headRef);
            const fencedRef='refs/heads/zz-fenced-cycle-'+number;
            let multiRefRefusal;
            await assert.rejects(runGit(['--git-dir='+f.native.receiver,...transport,'push','--atomic',f.native.origin+'/owner/repo.git',adversary+':refs/heads/main',adversary+':'+fencedRef]),error=>{multiRefRefusal={exitCode:error.code,stderr:error.stderr,ref:fencedRef};return /Native owned policy refused/.test(error.stderr);});
            const received=JSON.parse((await fs.readFile(receiveLog,'utf8')).trim().split('\n').at(-1));
            assert.equal(received.length,2);assert.equal(received[0].split(' ')[2],'refs/heads/main');assert.equal(received[1].split(' ')[2],fencedRef);
            assert.equal((await f.native.command(['rev-parse','refs/heads/main'])).toString().trim(),basis,'Atomic refusal preserves even the exempt first ref');
            await assert.rejects(f.native.command(['rev-parse','--verify',fencedRef]),/unknown revision|not a valid|Needed a single|ambiguous/u);
            multiRefRefusal.received=received;
            assert.equal((await f.native.command(['rev-parse','refs/heads/'+headRef])).toString().trim(),head);
            release.resolve();const deadline=Date.now()+25000;
            while(!settledRoot(c,parent.conversationId,started.workId,4)){const operations=c.store.all('SELECT * FROM effect_operations WHERE target=?',targets.mergeTarget);if(Date.now()>deadline||operations.some(op=>op.phase==='REFUSED'))throw Error('Cycle '+number+' coordinator did not settle: '+JSON.stringify(operations.map(op=>({id:op.id,phase:op.phase,blocked:JSON.parse(op.data).blocked}))));await new Promise(resolve=>setTimeout(resolve,20));}
            const merge=c.store.one('SELECT * FROM effect_operations WHERE target=?',targets.mergeTarget);assert.equal(merge.phase,'CONFIRMED');
            const merged=JSON.parse(merge.data),actual=(await f.native.command(['rev-parse','refs/heads/main'])).toString().trim();assert.equal(merged.mergedCommit,actual);
            assert.equal((await f.native.command(['show','-s','--format=%P',actual])).toString().trim(),basis+' '+head);assert.equal((await f.native.command(['rev-parse',actual+'^{tree}'])).toString().trim(),tree);
            assert.match((await f.native.command(['show',actual+':consumer.cjs'])).toString(),new RegExp('exports='+value));
            assert.equal(c.store.one('SELECT COUNT(*) n FROM budgets WHERE reserved!=0').n,0);assert.equal(c.store.one("SELECT COUNT(*) n FROM capacity_leases WHERE state IN ('QUEUED','ACTIVE','ADMITTED','QUARANTINED')").n,0);
            const assignment=c.store.one("SELECT * FROM conversation_assignments WHERE source_conversation=? AND json_extract(data,'$.operation')='change'",parent.conversationId)??c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=? ORDER BY rowid',parent.conversationId);
            assert.equal(c.inspectChange(assignment.work).reviewReady,true);
            const checks=c.store.all('SELECT * FROM check_runs WHERE work=?',assignment.work);assert.ok(checks.some(check=>check.status==='pass'&&JSON.parse(check.data).caseResults?.complete));
            const history=(await c.getConversationHistory(parent.conversationId)).sessionManager.getEntries();for(const tool of ['conversation_assign','conversation_integrate','conversation_merge','effect_inspect'])assert.ok(history.some(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName===tool));
            const result={number,value,parent:parent.conversationId,workId:started.workId,assignmentWork:assignment.work,targets,basis,head,tree,actual,branch,merge,rejected,multiRefRefusal,checks,roles:c.store.all('SELECT * FROM role_launches WHERE work=?',assignment.work)};
            receipts.cycles.push(result);return result;
        }
        native.addPull(12,'feature/path',3);const firstTargets=await register(f.c,12,'feature/path',f.native.B);await reopen(firstTargets);
        const first=await cycle(12,3,'feature/path',f.native.B,firstTargets);
        const rejectedCreation=await rejectPush(first.actual,'refs/heads/feature/second');
        // Fully settle original product execution before external maintenance. The
        // native administrator disables the unchanged fence, never a source exception.
        await c.ordinaryCore.drain();await c.close();c=undefined;
        sets.find(s=>s.id===fence.id).enforcement='disabled';await fs.writeFile(policyFile,JSON.stringify(sets));
        receipts.adminTransitions.push({operator:'external fixture administrator',action:'disable same fence after first confirmed endpoint and full drain',after:first.actual,rejectedCreation,fence:structuredClone(sets),at:Date.now()});
        const before=await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8');
        await runGit(['init','--initial-branch=local-original','--template=',f.source]);
        await runGit(['-C',f.source,'add','consumer.cjs','check.cjs']);await runGit(['-C',f.source,'-c','commit.gpgsign=false','commit','-m','Owned pre-sync local snapshot']);
        await runGit(['-C',f.source,...transport,'fetch','--no-tags',f.native.origin+'/owner/repo.git','refs/heads/main']);
        assert.equal(await runGit(['-C',f.source,'rev-parse','FETCH_HEAD']),first.actual);
        await runGit(['-C',f.source,'checkout','-B','second-cycle','FETCH_HEAD']);
        assert.equal(await runGit(['-C',f.source,'rev-parse','HEAD']),first.actual);
        const synchronized=await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8');assert.match(synchronized,/exports=3/);
        // Reapply only the explicitly preserved local user choice; neither product
        // publication nor merge silently updates or overwrites the original folder.
        await fs.writeFile(path.join(f.source,'consumer.cjs'),synchronized.replace('choice: 10','choice: 11'));
        await push(first.actual,'refs/heads/feature/second');
        assert.equal((await f.native.command(['rev-parse','refs/heads/feature/second'])).toString().trim(),first.actual);
        receipts.sourceSync={operator:'external owned source maintainer',before,receivedMerge:first.actual,gitHead:await runGit(['-C',f.source,'rev-parse','HEAD']),nativeTree:(await f.native.command(['rev-parse',first.actual+'^{tree}'])).toString().trim(),preservedLocalChoice:'11',sourceRoot:f.source,newRef:'refs/heads/feature/second',at:Date.now()};
        native.addPull(13,'feature/second',4);
        await branchRest.close();branchRest=await cyclePublicationFixture(f.native,sets,'refs/heads/feature/second');
        // Startup defaults select new roots; old finite grants are never reset.
        c=await openController({installationHome:path.join(f.native.root,'home'),effectsProfile:{gitBinary:git}});
        const secondTargets=await register(c,13,'feature/second',first.actual);await reopen(secondTargets);
        const second=await cycle(13,4,'feature/second',first.actual,secondTargets);
        assert.notEqual(first.head,second.head);assert.notEqual(first.tree,second.tree);assert.notEqual(first.targets.mergeTarget,second.targets.mergeTarget);
        assert.equal(second.basis,first.actual);await f.native.command(['merge-base','--is-ancestor',first.actual,second.head]);
        assert.equal(native.puts(),2);assert.deepEqual(native.outcomes.map(o=>o.number),[12,13]);assert.ok(native.ci.some(o=>o.number===12&&o.exitCode===0)&&native.ci.some(o=>o.number===13&&o.exitCode===0));
        assert.match(await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8'),/choice: 11/);assert.match(await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8'),/exports=3/,'Second publication and merge do not synchronize original source implicitly');
        assert.deepEqual(sets.find(s=>s.id===fence.id),fence,'Second merge uses the original exact active fence, no source exception/bypass');
        receipts.nativeOutcomes=native.outcomes;receipts.nativeCI=native.ci;receipts.supportLimit='External admin disable/reactivate and explicit source sync/new branch are manual prerequisites. Actual owned fixture only; no live-host or ergonomic qualification; no persistent-goal interaction claim.';
        await fs.writeFile(process.env.GITJIG_REPEAT_MERGE_OUTCOME_FILE??path.join(f.native.root,'two-cycle-outcome.json'),JSON.stringify(receipts,null,2),{mode:0o600});
        t.diagnostic('Actual two-cycle procedure/native receipts: '+f.native.root);native.pass();f.pass();
    } catch(error) {failure=error;throw error;} finally {
        releaseCurrent();const cleanupErrors=[];
        try {
            for(const close of [()=>c?.close(),()=>branchRest?.close(),()=>f.c.close(),()=>f.rest.close(),()=>f.native.close()]) {
                try {await close();} catch(error) {cleanupErrors.push(error);}
            }
        } finally {if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;}
        if(cleanupErrors.length){if(failure)t.diagnostic('Cleanup errors retained with primary failure: '+cleanupErrors.map(String).join('; '));else throw new AggregateError(cleanupErrors,'Two-cycle fixture cleanup failed');}
    }
});
