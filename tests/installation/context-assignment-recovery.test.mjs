import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {managedFixtureInputs,assertCurrentBuild,withInstalledManagedFixture,receiverBase,receiverCandidate,sourceBase} from './managed-installed-fixture.mjs';
import {installedAgentEndpoint} from './managed-agent-endpoint.mjs';

test('fresh installed original inherited assignment recovers the same task through actual procedures and original local endpoint',{timeout:240000},async t=>{
    const inputs=await managedFixtureInputs();
    await withInstalledManagedFixture(t,inputs,async fixture=>{
        const {root,home,project,payload,env,run,requests,setOrdinaryResponder}=fixture;
        const git=await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY??'/opt/homebrew/bin/git'),seed=path.join(root,'receiver seed');
        await fs.mkdir(seed,{mode:0o700});await fs.writeFile(path.join(seed,'consumer.cjs'),receiverBase);await fs.copyFile(path.join(project,'check.cjs'),path.join(seed,'check.cjs'));
        await run(git,['init','--initial-branch=main',seed],'context-seed-init');await run(git,['-C',seed,'add','consumer.cjs','check.cjs'],'context-seed-add');
        await run(git,['-C',seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Original context endpoint basis'],'context-seed-commit');
        const driver=path.join(root,'context-driver.mjs'),trace=path.join(root,'context-trace.mjs');await fs.copyFile('tests/installation/context-assignment-driver.mjs',driver);
        await fs.writeFile(trace,`import{registerHooks}from'node:module';import fs from'node:fs';import{fileURLToPath}from'node:url';const payload=fs.realpathSync(${JSON.stringify(payload)}),allow=new Set(${JSON.stringify([driver,trace])}),loaded=new Set();registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('file:')){const file=fs.realpathSync(fileURLToPath(result.url));if(!file.startsWith(payload+'/')&&!allow.has(file))throw Error('Installed context source fallback: '+file);if(file.startsWith(payload+'/'))loaded.add(file);}return result;}});process.on('exit',()=>fs.writeFileSync(${JSON.stringify(path.join(root,'context-loaded-'))}+process.pid+'.json',JSON.stringify({pid:process.pid,execPath:process.execPath,modules:[...loaded].sort()})));`,{mode:0o600});
        env.NODE_OPTIONS='--import='+JSON.stringify(trace);
        env.TMPDIR=path.join(home,'artifacts');
        const boundTerminal=async(label,steps,timeoutSeconds=12,args=[])=>{
            const file=path.join(root,label+'.json');
            await fs.writeFile(file,JSON.stringify({command:[path.join(home,'bootstrap/node'),'--import',trace,path.join(payload,'dist/cli/entry.js'),...args,'--home',home],env,steps,timeoutSeconds,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:8}),{mode:0o600});
            const receipt=JSON.parse(await run('/usr/bin/python3',[path.resolve('tests/cli/fork-ui-pty.py'),file],label,(timeoutSeconds+12)*1000));assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
        };
        let original;
        const endpoint=await installedAgentEndpoint({...fixture,terminal:boundTerminal,receiverBase,receiverCandidate,sourceBase,prepareCoordinator:async({targetId})=>{
            let seedPhase=0;
            setOrdinaryResponder(body=>{
                if(!body.messages.some(message=>JSON.stringify(message.content).includes('Admit original inherited task')))return{text:'Original installed context before cancellation'};
                if(seedPhase++===0)return{tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Export3 using the existing consumer; publish only agent delta and keep the user local edit local',operation:'change',resultDependency:true}}};
                const names=new Map(body.messages.flatMap(message=>(message.tool_calls??[]).map(call=>[call.id,call.function.name]))),result=body.messages.findLast(message=>message.role==='tool'&&names.get(message.tool_call_id)==='conversation_assign'),receipt=JSON.parse(typeof result.content==='string'?result.content:result.content.filter(p=>p.type==='text').map(p=>p.text).join(''));
                return{tool:{name:'conversation_wait',arguments:{resultHandles:[receipt.assignmentId]}}};
            });
            const file=path.join(root,'context-original.json');
            await run(path.join(home,'bootstrap/node'),[driver,payload,home,targetId,git,file],'context-original-seed',25000);
            original=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(requests.length,4);
            const unchanged=[{sql:'SELECT epoch FROM works WHERE id=?',params:[original.workId],rows:[[original.cancelledEpoch]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[original.runs.length]]},{sql:'SELECT COUNT(*) FROM effect_operations',rows:[[0]]}];
            const enter=[{wait:'Work recovery · #',send:'Review retained context admission recovery\r'},{wait:'Owner reason to recover this retained context',send:'Restore this same installed context\r'},{wait:'Review exact retained context admission',send:'\x1b'}];
            return {...original,readyWait:'admission recovered · retained histories verified · no execution',readyQueries:[{sql:'SELECT epoch FROM works WHERE id=?',params:[original.workId],rows:[[original.cancelledEpoch+1]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[original.runs.length]]},{sql:'SELECT COUNT(*) FROM effect_operations',rows:[[0]]}],steps:[{wait:'Model: original',send:'/work '+original.workId+'\x1b\r'},...enter,{wait:'Confirm retained context admission recovery',queries:unchanged,send:'\r'},{wait:'Work recovery · #',send:'Review retained context admission recovery\r'},{wait:'Owner reason to recover this retained context',send:'\x1b'},{wait:'Work recovery · #',queries:unchanged,send:'Review retained context admission recovery\r'},{wait:'Owner reason to recover this retained context',send:'Owner explicitly recovers same context\r'},{wait:'Review exact retained context admission',send:'\x1b'},{wait:'Confirm retained context admission recovery',send:'Recover this retained context admission\r'}]};
        }});
        const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});
        try{
            const work=db.prepare('SELECT * FROM works WHERE id=?').get(original.workId),data=JSON.parse(work.data);
            assert.equal(work.source,original.original.work.source);assert.equal(work.lineage,original.rootWorkId);assert.equal(work.epoch,original.cancelledEpoch+1);assert.deepEqual(data.contextOrigin,original.original.origin);assert.deepEqual(data.contextContinuation,JSON.parse(original.original.work.data).contextContinuation);
            assert.deepEqual({...db.prepare('SELECT * FROM sources WHERE id=?').get(original.original.event.id)},original.original.event);
            const proof=JSON.parse(db.prepare('SELECT raw FROM sources WHERE id=?').get(data.contextAdmissionRecoverySource).raw);assert.equal(proof.histories.length,2);assert.equal(proof.previousSource,null);
            const task=db.prepare('SELECT * FROM works WHERE id=?').get(original.child.id),assignment=db.prepare('SELECT * FROM conversation_assignments WHERE id=?').get(original.assignmentId);assert.equal(endpoint.assignmentId,original.assignmentId);assert.equal(endpoint.workId,original.child.id);assert.equal(assignment.state,'COMPLETE');assert.equal(task.source,original.child.source);assert.deepEqual(JSON.parse(task.data).invocation,JSON.parse(original.child.data).invocation);assert.deepEqual(JSON.parse(task.data).contextOrigin,JSON.parse(original.child.data).contextOrigin);assert.equal(proof.cancelledWait.assignmentId,original.assignmentId);
            const grant=db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(original.grantId);assert.equal(grant.epoch,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM effect_operations WHERE grant_id=?').get(grant.id).n,1);
            for(const h of original.original.histories){const bytes=await fs.readFile(h.historyRef),verified=proof.histories.find(p=>p.historyRef===h.historyRef).verified;assert.equal(createHash('sha256').update(bytes.subarray(0,verified.bytes)).digest('hex'),verified.sha256);}
        }finally{db.close();}
        const traces=[];for(const file of await fs.readdir(root))if(file.startsWith('context-loaded-')){const value=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));assert.equal(await fs.realpath(value.execPath),await fs.realpath(path.join(home,'bootstrap/node')));assert.ok(value.modules.length);assert.ok(value.modules.every(file=>file.startsWith(payload+path.sep)));traces.push(value);}
        assert.ok(traces.length>=2);assert.ok(traces.some(value=>value.modules.includes(path.join(payload,'dist/controller/context-admission-recovery.js'))));
        return {contextRecovery:{...endpoint,sourceRoot:original.rootWorkId,contextWork:original.workId,proofPreservesOriginal:true,boundPids:traces.map(v=>v.pid),scope:'Fresh installed original coordinator cancelled WAIT recovery, actual SDK same original inherited assignment/task recovery and reentry, real procedures and one original finite local send. Initial task is paused before governed dispatch; scripted HTTP, no abrupt governed-process or live-provider qualification.'}};
    });
    await assertCurrentBuild(inputs.built);
});
