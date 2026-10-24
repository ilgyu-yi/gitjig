// Actual local Git, captured-source execution and original terminal commands; no model or seeded success.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {ApplicationLocalConventions,recommendedLocalConventions} from '../../dist/app/local-conventions.js';
import {listLocalCandidates} from '../../dist/controller/local-candidate.js';
import {runtimeFixtureProfile,runtimeFixtureConfig} from '../runtime/profile.mjs';

const execute=promisify(execFile);

test('actual local result continues through correspondence, candidate, native commit and attributed audit; repeats preserve the original', {timeout:90000}, async t=>{
    const runtime={...runtimeFixtureProfile(),dockerConfigDirectory:runtimeFixtureConfig()};
    assert.ok(path.isAbsolute(process.env.GITJIG_RUNTIME_FIXTURE_ROOT??''),'Explicit shared runtime fixture root required');
    const root=await fs.realpath(await fs.mkdtemp(path.join(process.env.GITJIG_RUNTIME_FIXTURE_ROOT,'local-result-ui-')));
    const home=path.join(root,'home'),source=path.join(root,'source'),messageFile=path.join(root,'message');
    const git=await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY??'/opt/homebrew/bin/git');
    assert.match((await execute(git,['--version'])).stdout,/git version 2\.55\./u);
    let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original local result runtime fixture: '+root);});
    await fs.mkdir(source,{mode:0o700});
    const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
        LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''};
    const native=async(...args)=>(await execute(git,args,{cwd:source,env})).stdout;
    await native('init','-b','feat/local-result');await native('config','user.name','Local Result Fixture');await native('config','user.email','local-result@example.invalid');
    const script="const fs=require('node:fs');if(fs.readFileSync('answer','utf8')!=='checked\\n')process.exit(1);console.log('source-checked');\n";
    await fs.writeFile(path.join(source,'check.cjs'),script);await fs.writeFile(path.join(source,'answer'),'base\n');
    await native('add','.');await native('commit','-m','base');await fs.writeFile(path.join(source,'answer'),'checked\n');await native('add','answer');
    await fs.writeFile(messageFile,'Verify the local result\n',{mode:0o600});
    const head=await native('rev-parse','HEAD'),index=await fs.readFile(path.join(source,'.git/index'));
    const c=await openController({installationHome:home,runtimeProfile:runtime});let cid;
    const draft='  Preserve this separate 한국어 request\nwhile checking local files  ';
    try{
        await c.registerProject({id:'p',sourceRoot:source});cid=c.createConversation({projectId:'p'}).conversationId;
        c.setConversationView({selectedId:cid});c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        await ApplicationStartup.open(c).save({version:1,runtime});
        new ApplicationLocalConventions(c).set('p',0,recommendedLocalConventions());
    }finally{await c.close();}
    const state=(editorFocused,contains,send,extra={})=>({editorFocused,draft,contains,send,...extra});
    const modal=(contains,send,extra)=>state(false,contains,send,extra),unchanged={unchanged:true};
    const enterLocal=[state(true,['Model: not selected'],'\x07'),modal(['Commands · Ctrl+G'],'/'),
        modal(['Gitjig commands · search'],'/local\r')];
    const successfulResult=[
        modal(['Local check result','The check command finished successfully.','Requested command for this attempt: "node check.cjs"',
            'Your project files and Git index were not changed by this check.'],'\x1b',{baseline:true}),
        modal(['Next step for this check'],'Inspect current check correspondence\r',unchanged),
        modal(['Trusted Git executable'],'\x15'+git+'\r',unchanged),
        modal(['Original source/index correspondence','CURRENT · Current full source and index files match the original successful check.'],'\x1b',unchanged),
    ];
    const leave=[modal(['Local development'],'Close\r',unchanged),state(true,['Model: not selected'],'\x07',unchanged),modal(['Commands · Ctrl+G'],'q',unchanged)];
    const terminal=async(name,steps,expectedLedger)=>{
        const file=path.join(root,name+'.json'),output=file+'.terminal',observation=file+'.current';
        await fs.writeFile(file,JSON.stringify({cid,steps,expectedLedger,observation,output,timeoutSeconds:35,
            command:[process.execPath,'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
                path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],
            env:{...env,GITJIG_RESULT_OBSERVATION:observation}}));
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:49000,maxBuffer:2**20})).stdout);
        assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
        return {...result,frames:JSON.parse(await fs.readFile(output+'.frames.json','utf8')).snapshots};
    };
    const first=await terminal('new-check',[
        ...enterLocal,modal(['Local development'],'Run new isolated check\r'),
        modal(['Isolated check command'],'node check.cjs\r'),modal(['Isolated check working directory'],'\r'),
        modal(['Review new independent local check'],'\x1b'),modal(['Explicit local check action'],'Run new independent check\r'),
        ...successfulResult,
        modal(['Next step for this check'],'Record exact commit candidate\r',unchanged),
        modal(['Trusted Git executable',git],'\r',unchanged),
        modal(['Owned exact commit message file'],messageFile+'\r',unchanged),
        modal(['Review exact candidate recording'],'\x1b',unchanged),
        modal(['Explicit candidate recording'],'Record exact candidate\r',unchanged),
        modal(['Exact candidate retained','RECORDED · Historical candidate receipt. No commit was made by recording it.'],'\x1b',unchanged),...leave,
    ]);
    assert.ok(first.frames.every(frame=>!frame.frame.some(line=>line.startsWith('Retained local checks'))),'First-result continuation must not require rediscovering the check');
    let workId,firstRun,firstResult,secondRun,candidateId;
    const firstController=await openController({installationHome:home,runtimeProfile:runtime});
    try{
        const list=firstController.listLocalChecks('p');assert.equal(list.checks.length,1);workId=list.checks[0].workId;
        const work=firstController.inspectLocalCheck(workId);firstRun=work.result.runId;firstResult=work.result.resultId;
        assert.equal(work.result.status,'succeeded');assert.equal(work.result.exitCode,0);assert.equal(work.result.cleanup,'removed');
        assert.equal(work.latestRun.runId,firstRun);assert.equal(work.latestRun.phase,'SETTLED');assert.equal(work.allowance.execution.consumed,1);
        const candidates=listLocalCandidates(firstController,'p');assert.equal(candidates.candidates.length,1);candidateId=candidates.candidates[0].candidateId;
        assert.equal(candidates.candidates[0].check.workId,workId);assert.equal(candidates.candidates[0].check.runId,firstRun);
        assert.equal(firstController.inspectConversation(cid).draft.text,draft);
    }finally{await firstController.close();}
    const candidateFile=path.join(home,'local-candidates',candidateId+'.json'),candidateBytes=await fs.readFile(candidateFile);
    assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.equal(await native('rev-parse','HEAD'),head);
    const second=await terminal('repeat-original',[
        ...enterLocal.map(step=>({...step,...unchanged})),modal(['Local development'],'Retained local checks\r',unchanged),
        modal(['Retained local checks'],'node check.cjs\r',unchanged),modal(['Original local check'],'Resume original check\r',unchanged),
        modal(['Review original local check continuation'],'\x1b',unchanged),modal(['Explicit original-check action'],'Resume original command\r',unchanged),
        ...successfulResult,modal(['Next step for this check'],'Return to local tools\r',unchanged),...leave,
    ],first.ledger);
    assert.notEqual(second.ledger,first.ledger,'Explicit same-original continuation must record its new attempt');
    const final=await openController({installationHome:home,runtimeProfile:runtime});
    try{
        const work=final.inspectLocalCheck(workId);assert.equal(work.state,'DELIVERED');secondRun=work.result.runId;assert.notEqual(secondRun,firstRun);
        assert.equal(work.result.status,'succeeded');assert.equal(work.result.exitCode,0);assert.equal(work.result.cleanup,'removed');
        assert.equal(work.allowance.execution.consumed,2);assert.equal(work.allowance.execution.reserved,0);
        assert.equal(final.store.one('SELECT COUNT(*) AS n FROM works').n,1);assert.equal(final.store.one('SELECT COUNT(*) AS n FROM runs').n,2);
        assert.equal(final.store.one('SELECT COUNT(*) AS n FROM role_launches').n,0);assert.equal(final.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n,0);
        assert.equal(final.store.one("SELECT COUNT(*) AS n FROM runs WHERE phase!='SETTLED'").n,0);
        assert.equal(final.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state!='RELEASED'").n,0);
        assert.equal(final.inspectConversation(cid).draft.text,draft);
        const candidates=listLocalCandidates(final,'p').candidates;assert.equal(candidates.length,1);assert.equal(candidates[0].candidateId,candidateId);
        assert.equal(candidates[0].check.runId,firstRun,'Second attempt must not rewrite the historical first candidate');
        for(const row of final.store.all('SELECT data FROM results'))assert.match(JSON.parse(row.data).stdout,/source-checked/u);
    }finally{await final.close();}
    // The owner makes the native commit explicitly, outside the app. Recording
    // the candidate and both real check attempts must leave the source untouched.
    assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.equal(await native('rev-parse','HEAD'),head);
    assert.match(await native('diff','--cached','--','answer'),/-base\n\+checked/u);
    await native('commit','--cleanup=verbatim','-F',messageFile);
    const committed=(await native('rev-parse','HEAD')).trim(),committedIndex=await fs.readFile(path.join(source,'.git/index'));
    assert.notEqual(committed,head.trim());assert.equal((await native('rev-parse','HEAD^')).trim(),head.trim());
    assert.equal((await native('rev-list','--count','HEAD')).trim(),'2');
    const historical={...unchanged,scrollUntil:true,scrollTitle:'Historical native commit correspondence',scrollByLine:true};
    const auditSteps=[
        ...enterLocal.map(step=>({...step,...unchanged})),modal(['Local development'],'Retained candidates and commit audit\r',unchanged),
        modal(['Retained candidates'],'Candidate\r',unchanged),modal(['Original candidate',candidateId],'Audit native commit\r',unchanged),
        modal(['Trusted Git executable'],'\x15'+git+'\r',unchanged),
        modal(['Explicit native commit reference'],'\x15'+committed+'\r',unchanged),
        modal(['Review historical commit audit',candidateId,committed],'\x1b',unchanged),
        modal(['Explicit commit audit'],'Audit selected commit\r',unchanged),
        modal(['Historical native commit correspondence · MATCH','MATCH · Native commit matches this historical candidate receipt.',
            committed,candidateId,'Whole tree: matches','Exact message: matches','Normal parent or initial root: matches'],'',unchanged),
        modal(['Original checked command: "node check.cjs"','Original run: "'+firstRun+'"','Original result: "'+firstResult+'"'],'',historical),
        modal(['Later context · shown separately; it does not replace the historical receipt or make its check current.',
            'Current result run: "'+secondRun+'"'],'',historical),
        modal(['Historical correspondence only: no current eligibility, test adequacy, independent review, account standing or'],
            '\x1b',historical),
        modal(['Retained candidates'],'Back\r',unchanged),...leave,
    ];
    const audited=await terminal('native-commit-audit',auditSteps,second.ledger);
    const repeatedAudit=await terminal('reopened-native-commit-audit',auditSteps,second.ledger);
    assert.equal(audited.ledger,second.ledger);assert.equal(repeatedAudit.ledger,second.ledger);
    assert.deepEqual(await fs.readFile(candidateFile),candidateBytes,'Audits preserve the original first-run receipt bytes');
    for(const file of await fs.readdir(path.join(home,'state/runtime')))
        if(file.endsWith('.json'))assert.equal(JSON.parse(await fs.readFile(path.join(home,'state/runtime',file),'utf8')).state,'removed');
    assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),committedIndex);assert.equal((await native('rev-parse','HEAD')).trim(),committed);
    assert.equal(await fs.readFile(path.join(source,'answer'),'utf8'),'checked\n');assert.equal(await fs.readFile(path.join(source,'check.cjs'),'utf8'),script);
    t.diagnostic(JSON.stringify({scope:'Actual source terminal/local engine/source correspondence/candidate, native owner commit and original historical audit; same-work repeat and reopened audit; no model, seeded success or app commit',root,workId,firstRun,secondRun,firstResult,candidateId,committed,firstStages:first.stages,repeatStages:second.stages,auditStages:audited.stages,reopenedAuditStages:repeatedAudit.stages}));
    passed=true;
});
