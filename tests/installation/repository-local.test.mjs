import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {installedRepositoryJourney} from './repository-journey.mjs';
import {runtimeFixtureProfile,runtimeFixtureConfig} from '../runtime/profile.mjs';

const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('installed administrator guidance and separately owned developer checks reach the same project commit and audit',{timeout:240000},async t=>{
    const runtime={...runtimeFixtureProfile(),dockerConfigDirectory:runtimeFixtureConfig()},shared=process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(shared&&path.isAbsolute(shared));
    for(const directory of [shared,runtime.dockerConfigDirectory]){
        assert.equal(await fs.realpath(directory),directory);const stat=await fs.stat(directory);
        assert.ok(stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700);
    }
    const root=await fs.realpath(await fs.mkdtemp(path.join(shared,'repository-developer-'))),git=await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY??'/opt/homebrew/bin/git');
    const nativeEnv={PATH:'/usr/bin:/bin',HOME:root,LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Owned repository administrator',GIT_AUTHOR_EMAIL:'admin@example.invalid',GIT_COMMITTER_NAME:'Owned repository administrator',GIT_COMMITTER_EMAIL:'admin@example.invalid'};
    const native=async(...args)=>(await execute(git,args,{env:nativeEnv,timeout:10000})).stdout;
    const projects={},branchHeads={};
    for(const provider of ['gitea','gitlab']){
        const seed=path.join(root,provider+'-seed'),bare=path.join(root,provider+'.git');await fs.mkdir(seed,{mode:0o700});await fs.writeFile(path.join(seed,'consumer.cjs'),'module.exports=2;\n');
        await native('init','--initial-branch=main',seed);await native('-C',seed,'add','consumer.cjs');await native('-C',seed,'-c','commit.gpgsign=false','commit','-m','Original administrator repository basis');await native('clone','--bare','--template=',seed,bare);await native('--git-dir='+bare,'config','--remove-section','remote.origin');
        branchHeads[provider]=(await native('--git-dir='+bare,'rev-parse','refs/heads/main')).trim();projects[provider]={bare,basis:branchHeads[provider]};
    }
    t.after(()=>t.diagnostic('Retained administrator/developer world: '+root));
    await installedRepositoryJourney(t,{fixtureRoot:root,branchHeads,retain:true,afterGuide:async({provider,guide,partial,plan,target,root:adminRoot,payload,command,run,env})=>{
        const project=projects[provider],projectRoot=path.join(root,provider+'-developer-project'),developerHome=path.join(root,provider+'-developer-home'),user=path.join(root,provider+'-developer-user');await fs.mkdir(user,{mode:0o700});
        await native('clone','--template=',project.bare,projectRoot);
        const localGit=async(...args)=>(await execute(git,['-C',projectRoot,...args],{env:{...nativeEnv,GIT_AUTHOR_NAME:'Independent local developer',GIT_AUTHOR_EMAIL:'developer@example.invalid',GIT_COMMITTER_NAME:'Independent local developer',GIT_COMMITTER_EMAIL:'developer@example.invalid'},timeout:10000})).stdout;
        await localGit('config','user.name','Independent local developer');await localGit('config','user.email','developer@example.invalid');
        const developerEnv={...env,HOME:user,GITJIG_HOME:developerHome,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',PI_PACKAGE_DIR:''};
        const trace=path.join(root,provider+'-developer-trace.mjs'),tracePrefix=path.join(root,provider+'-developer-loaded-');
        await fs.writeFile(trace,`import{registerHooks}from'node:module';import fs from'node:fs';import{fileURLToPath}from'node:url';const payload=fs.realpathSync(${JSON.stringify(payload)}),modules=new Set();registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('file:')){const file=fs.realpathSync(fileURLToPath(result.url));if(!file.startsWith(payload+'/'))throw Error('Developer installed source fallback '+file);modules.add(file);}return result;}});process.on('exit',()=>fs.writeFileSync(${JSON.stringify(tracePrefix)}+process.pid+'.json',JSON.stringify({pid:process.pid,node:process.execPath,modules:[...modules].sort()})));`,{mode:0o600});
        const installedArgs=['--import',trace,path.join(payload,'dist/cli/entry.js')];
        const cli=async(args,label,{expected=0,timeout=10000}={})=>JSON.parse(await run(process.execPath,[...installedArgs,...args,'--home',developerHome],provider+'-developer-'+label,{expected,timeout,environment:developerEnv,workdir:root}));
        assert.equal(plan.phase,'CONFIRMED');const observed=guide.observation.observations.branch;assert.equal(observed.state,'OBSERVED');assert.equal(observed.value.name,'main');assert.equal(observed.value.head,project.basis);
        const sourceStat=await fs.stat(projectRoot),common=await fs.realpath(path.resolve(projectRoot,(await localGit('rev-parse','--git-common-dir')).trim())),commonStat=await fs.stat(common),origin=(await localGit('remote','get-url','origin')).trim();assert.equal(origin,project.bare);
        assert.equal((await localGit('rev-parse','HEAD')).trim(),project.basis);assert.notEqual(developerHome,path.join(adminRoot,'application'));
        const guideBytes=Buffer.from(JSON.stringify(guide)),handoff={version:1,provider,target,planId:plan.planId,configurationPlan:plan,guideHash:sha(guideBytes),guide,partial,repositoryHead:project.basis,branch:'main',local:{sourceRoot:projectRoot,dev:sourceStat.dev,ino:sourceStat.ino,commonDir:common,commonDev:commonStat.dev,commonIno:commonStat.ino,origin,initialCommit:project.basis},ownerDecision:'Explicit manual association of this exact repository guide and its actual bare basis with this local-only developer project; no automatic policy translation or merge authority'};
        await fs.writeFile(path.join(root,provider+'-handoff.json'),JSON.stringify(handoff,null,2),{mode:0o600});
        await cli(['project','register','--id','P','--root',projectRoot],'register');
        const rules={protectedBranches:['main'],branchPrefixes:['fix/'],commitTypes:['fix'],subjectMaxLength:72,requireBody:true},policy=path.join(root,provider+'-local-rules.json'),message=path.join(root,provider+'-message.txt');
        await fs.writeFile(policy,JSON.stringify(rules),{mode:0o600});await fs.writeFile(message,'fix: export three\n\nVerify this exact local consumer; hosting approvals remain outstanding.\n',{mode:0o600});
        await cli(['local','configure','--project','P','--revision','0','--profile',policy],'explicit-conventions');
        await fs.writeFile(path.join(projectRoot,'consumer.cjs'),'module.exports=3;\n');await localGit('add','consumer.cjs');
        const prepare=['local','prepare','--project','P','--git-binary',git,'--message-file',message];
        const protectedBranch=await cli(prepare,'protected-branch',{expected:1});assert.equal(protectedBranch.status,'FAIL');
        await localGit('switch','-c','fix/three');const goodMessage=await fs.readFile(message);await fs.writeFile(message,'chore: wrong local type\n\nRetain the configured rule.\n',{mode:0o600});
        const wrongType=await cli(prepare,'wrong-message-type',{expected:1});assert.equal(wrongType.status,'FAIL');await fs.writeFile(message,goodMessage);
        const prepared=await cli(prepare,'prepared');assert.equal(prepared.status,'PASS');
        const stateFile=path.join(developerHome,'state/controller.sqlite'),read=fn=>{const db=new DatabaseSync(stateFile,{readOnly:true});try{return fn(db);}finally{db.close();}};
        assert.equal(read(db=>db.prepare('SELECT COUNT(*) n FROM works').get().n),0,'Local conventions and preparation need no agent work');
        const checkCommand=`node -e 'const assert=require("node:assert/strict");assert.equal(require("/work/consumer.cjs"),3);console.log("owned export3 verified")'`;
        const checked=await cli(['local','check','--project','P','--command',checkCommand,'--cwd','work','--docker-binary',runtime.dockerBinary,'--docker-context',runtime.dockerContext,'--image',runtime.image,'--docker-config-directory',runtime.dockerConfigDirectory],'actual-check',{timeout:30000});assert.equal(checked.status,'succeeded');assert.equal(checked.cleanup,'removed');
        const evidenceArgs=['local','evidence','--project','P','--work',checked.workId,'--git-binary',git],evidence=await cli(evidenceArgs,'current-evidence');assert.equal(evidence.status,'CURRENT');assert.equal(evidence.runId,checked.runId);
        const candidateArgs=['local','candidate','--project','P','--work',checked.workId,'--git-binary',git,'--message-file',message];
        await fs.writeFile(path.join(projectRoot,'consumer.cjs'),'module.exports=4;\n');await run(process.execPath,[...installedArgs,...candidateArgs,'--home',developerHome],provider+'-developer-stale-candidate',{expected:2,environment:developerEnv,workdir:root});
        assert.deepEqual((await cli(['local','candidates','--project','P'],'no-stale-candidate')).candidates,[]);await fs.writeFile(path.join(projectRoot,'consumer.cjs'),'module.exports=3;\n');
        const candidate=(await cli(candidateArgs,'candidate')).candidate;assert.equal(candidate.check.runId,checked.runId);
        // The human separately uses native Git; gitjig never creates this commit.
        await localGit('-c','user.name=Independent local developer','-c','user.email=developer@example.invalid','-c','commit.gpgsign=false','commit','--cleanup=verbatim','-F',message);
        assert.equal((await localGit('show','-s','--format=%an|%ae','HEAD')).trim(),'Independent local developer|developer@example.invalid');
        const commit=(await localGit('rev-parse','HEAD')).trim(),auditArgs=['local','audit','--project','P','--candidate',candidate.id,'--git-binary',git],audit=await cli([...auditArgs,'--commit',commit],'native-commit-audit');assert.equal(audit.status,'MATCH');
        assert.equal((await native('--git-dir='+project.bare,'rev-parse','refs/heads/main')).trim(),project.basis,'Local commit does not update hosting or the original receiver');
        await fs.mkdir(path.join(common,'hooks'),{recursive:true,mode:0o700});await fs.writeFile(path.join(common,'hooks/pre-commit'),'#!/bin/sh\ngit rm -f -- consumer.cjs\n',{mode:0o700});await localGit('-c','user.name=Independent local developer','-c','user.email=developer@example.invalid','-c','commit.gpgsign=false','commit','--amend','--cleanup=verbatim','-F',message);
        const changed=(await localGit('rev-parse','HEAD')).trim(),mismatch=await cli([...auditArgs,'--commit',changed],'native-hook-mismatch',{expected:1});assert.equal(mismatch.status,'MISMATCH');assert.equal(mismatch.checks.wholeTree,false);assert.equal((await localGit('rev-parse','HEAD')).trim(),changed);
        const ledger=read(db=>{
            for(const table of ['role_launches','goal_attempts','conversation_inputs','effect_delegations','effect_operations'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,'Developer local work requires no agent/governance authority: '+table);
            assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,1);assert.equal(db.prepare("SELECT consumed FROM budgets WHERE kind='execution'").get().consumed,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE phase!='SETTLED'").get().n,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM capacity_leases WHERE state!='RELEASED'").get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM budgets WHERE reserved!=0').get().n,0);
            return {works:db.prepare('SELECT id,state FROM works').all(),runs:db.prepare('SELECT id,phase,reservation FROM runs').all(),budgets:db.prepare('SELECT * FROM budgets').all()};
        });
        const checkInvocation=JSON.parse(await fs.readFile(path.join(adminRoot,provider+'-developer-actual-check.result.json'),'utf8')),checkTrace=JSON.parse(await fs.readFile(tracePrefix+checkInvocation.pid+'.json','utf8'));
        for(const file of ['dist/cli/entry.js','dist/controller/local-checks.js'])assert.ok(checkTrace.modules.includes(path.join(payload,file)));
        assert.ok(checkTrace.modules.every(file=>file.startsWith(payload+'/')));
        const candidateInvocation=JSON.parse(await fs.readFile(path.join(adminRoot,provider+'-developer-candidate.result.json'),'utf8')),candidateTrace=JSON.parse(await fs.readFile(tracePrefix+candidateInvocation.pid+'.json','utf8'));
        assert.ok(candidateTrace.modules.includes(path.join(payload,'dist/controller/local-candidate.js')));assert.ok(candidateTrace.modules.every(file=>file.startsWith(payload+'/')));
        for(const file of ['models.json','auth.json','startup.json'])await assert.rejects(fs.access(path.join(developerHome,'config',file)),{code:'ENOENT'});
        await fs.writeFile(path.join(root,provider+'-developer-endpoint.json'),JSON.stringify({handoffHash:sha(await fs.readFile(path.join(root,provider+'-handoff.json'))),payload,developerHome,rules,prepared,checked,evidence,candidate,commit,audit,changed,mismatch,ledger,checkTrace,candidateTrace,scope:'Actual current npm installed admin policy/readback/guide to explicitly associated same-basis developer project; actual engine check/native local commit and audit, no model/agent standing/live hosting/merge qualification'},null,2),{mode:0o600});
    }});
});
