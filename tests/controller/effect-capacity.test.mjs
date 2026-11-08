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
test('two actual native coordinators release WAIT slots and their governed integration tasks progress under shared capacity two', { timeout: 90000 }, async () => {
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
        await c.registerProject({ id: 'P', sourceRoot: source });
        const receivers=[receiver,path.join(root,'receiver-two.git')];await execute(git,['init','--bare',receivers[1]]);await execute(git,['-C',seed,'push',receivers[1],'HEAD:refs/heads/main']);
        const targets=[];for(const r of receivers)targets.push(await c.registerLocalTarget({projectId:'P',path:r,ref:'refs/heads/main',basisCommit:K,publicationInventory:['consumer.cjs','check.cjs'],authorizedDeltaPaths:['consumer.cjs']}));
        await c.close();c=await openController({installationHome:home,runtimeProfile,effectsProfile:{gitBinary:git},interactionDelegation:{projectIds:['P'],maxAssignments:2},effectDelegations:targets.map(t=>({projectId:'P',targetId:t.targetId,operationLimit:1}))});
        const parents=targets.map(()=>c.createConversation()),model=scripted((context,turn)=>{const firstUser=context.messages.find(m=>m.role==='user'),raw=firstUser.content.filter(x=>x.type==='text').map(x=>x.text).join(''),t=targets[raw.includes('ROOT parallel parent 1')?1:0];const receipt=name=>{const r=context.messages.filter(m=>m.role==='toolResult'&&m.toolName===name).at(-1);return JSON.parse(r.content.filter(x=>x.type==='text').map(x=>x.text).join(''));};if(turn===0)return{tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Export3 using existing consumer; preserve local user notes',operation:'change',resultDependency:true}}};if(turn===1)return{tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_assign').assignmentId]}}};if(turn===2)return{tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:receipt('conversation_assign').assignmentId,targetId:t.targetId}}};if(turn===3)return{tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_integrate').assignmentId]}}};return{text:'Distinct retained integration finished after WAIT, without a parent-wide driver lease'};});
        for(let i=0;i<parents.length;i++)await c.queueConversationInput({conversationId:parents[i].conversationId,expectedGeneration:0,text:'ROOT parallel parent '+i,mode:'idle'});
        const first=await Promise.all(parents.map((p,i)=>c.runConversation({conversationId:p.conversationId,model})));assert.ok(first.every(r=>r.status==='waiting'));
        for(let tick=0;tick<3000;tick++){if(c.store.one("SELECT COUNT(*) AS n FROM effect_operations WHERE phase='CONFIRMED'").n===2&&first.every((r,i)=>settledRoot(c,parents[i].conversationId,r.workId,3)))break;await new Promise(r=>setTimeout(r,10));}
        assert.ok(first.every((r,i)=>settledRoot(c,parents[i].conversationId,r.workId,3)),'Both parent results must be delivered and settled');
        const ops=c.store.all('SELECT * FROM effect_operations');assert.equal(ops.length,2);assert.ok(ops.every(o=>o.phase==='CONFIRMED'),JSON.stringify({ops,assignments:c.store.all('SELECT * FROM conversation_assignments')}));assert.notEqual(ops[0].work,ops[1].work);assert.notEqual(ops[0].grant_id,ops[1].grant_id);assert.ok(first.every(r=>c.inspectWork(r.workId).allowance.consumed===3));assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n,0);for(const r of receivers)assert.equal((await execute(git,['--git-dir='+r,'show','refs/heads/main:consumer.cjs'])).stdout,initial.replace('exports=2','exports=3'));assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),dirty);
        passed=true;
    }finally{await cleanupFixture(c,root,passed);}
});
