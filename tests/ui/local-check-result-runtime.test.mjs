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
const cliEntry=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js');

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
        modal(['Local check result','Open check actions','The check command finished successfully.','Requested command for this attempt: "node check.cjs"',
            'Your project files and Git index were not changed by this check.'],'\r',{baseline:true}),
        modal(['Next step for this check'],'Open original work recovery and allowances\r',unchanged),
        modal(['Work recovery'],'\x1b',unchanged),
        modal(['Next step for this check'],'Inspect current check correspondence\r',unchanged),
        modal(['Trusted Git executable'],'\x15'+git+'\r',unchanged),
        modal(['Original source/index correspondence','CURRENT · Current full source and index files match the original successful check.'],'\x1b',unchanged),
    ];
    const leave=[modal(['Local development'],'Close\r',unchanged),state(true,['Model: not selected'],'\x07',unchanged),modal(['Commands · Ctrl+G'],'q',unchanged)];
    const terminal=async(name,steps,expectedLedger)=>{
        const file=path.join(root,name+'.json'),output=file+'.terminal',observation=file+'.current';
        await fs.writeFile(file,JSON.stringify({cid,steps,expectedLedger,observation,output,timeoutSeconds:35,
            command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
                '--import',path.resolve('tests/cli/account-ui-no-network.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
                cliEntry,'conversation','ui','--home',home,'--conversation',cid],
            env:{...env,GITJIG_RESULT_OBSERVATION:observation}}));
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:49000,maxBuffer:2**20})).stdout);
        assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
        return {...result,frames:JSON.parse(await fs.readFile(output+'.frames.json','utf8')).snapshots};
    };
    const first=await terminal('new-check',[
        ...enterLocal,modal(['Local development'],'Run new isolated check\r'),
        modal(['Isolated check command'],'node fixture-unsent.cjs\r'),modal(['Isolated check working directory'],'\r'),
        modal(['Review new independent local check','Open check confirmation'],'\r'),modal(['Explicit local check action'],'Edit check command\r'),
        modal(['Isolated check command','node fixture-unsent.cjs'],'\x15node check.cjs\r'),
        modal(['Review new independent local check','Exact command: "node check.cjs"','Open check confirmation'],'\r'),
        modal(['Explicit local check action'],'Run new independent check\r'),
        ...successfulResult,
        modal(['Next step for this check'],'Record exact commit candidate\r',unchanged),
        modal(['Trusted Git executable',git],'\r',unchanged),
        modal(['Owned exact commit message file'],messageFile+'\r',unchanged),
        modal(['Review exact candidate recording','Open recording confirmation'],'\x1b',unchanged),
        modal(['Next step for this check'],'Record exact commit candidate\r',unchanged),
        modal(['Trusted Git executable',git],'\r',unchanged),
        modal(['Owned exact commit message file'],messageFile+'\r',unchanged),
        modal(['Review exact candidate recording','Open recording confirmation'],'\r',unchanged),
        modal(['Explicit candidate recording'],'Record exact candidate\r',unchanged),
        modal(['Exact candidate retained','RECORDED · Historical candidate receipt. No commit was made by recording it.','Open this candidate’s actions'],'\r',unchanged),
        modal(['Original candidate','Audit native commit'],'Back\r',unchanged),...leave,
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
        modal(['Review original local check continuation','Open check confirmation'],'\x1b',unchanged),
        modal(['Original local check · DELIVERED',workId],'Resume original check\r',unchanged),
        modal(['Review original local check continuation','Open check confirmation'],'\r',unchanged),modal(['Explicit original-check action'],'Resume original command\r',unchanged),
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
        modal(['Review historical commit audit',candidateId,committed,'Open audit confirmation'],'\x1b',unchanged),
        modal(['Original candidate',candidateId],'Audit native commit\r',unchanged),
        modal(['Trusted Git executable'],'\x15'+git+'\r',unchanged),
        modal(['Explicit native commit reference'],'\x15'+committed+'\r',unchanged),
        modal(['Review historical commit audit',candidateId,committed,'Open audit confirmation'],'\r',unchanged),
        modal(['Explicit commit audit'],'Audit selected commit\r',unchanged),
        modal(['Historical native commit correspondence · MATCH','MATCH · Native commit matches this historical candidate receipt.',
            committed,candidateId,'Whole tree: matches','Exact message: matches','Normal parent or initial root: matches'],'',unchanged),
        modal(['Original checked command: "node check.cjs"','Original run: "'+firstRun+'"','Original result: "'+firstResult+'"'],'',historical),
        modal(['Later context · shown separately; it does not replace the historical receipt or make its check current.',
            'Current result run: "'+secondRun+'"'],'',historical),
        modal(['Historical correspondence only: no current eligibility, test adequacy, independent review, account standing or'],
            '\x1b',historical),
        modal(['Original candidate',candidateId],'Back\r',unchanged),modal(['Retained candidates'],'Back\r',unchanged),...leave,
    ];
    const audited=await terminal('native-commit-audit',auditSteps,second.ledger);
    const repeatedAudit=await terminal('reopened-native-commit-audit',auditSteps,second.ledger);
    assert.equal(audited.ledger,second.ledger);assert.equal(repeatedAudit.ledger,second.ledger);
    assert.deepEqual(await fs.readFile(candidateFile),candidateBytes,'Audits preserve the original first-run receipt bytes');
    const cancellationFile=path.join(root,'cancel-check.json'),cancelCommand='node -e "setTimeout(() => {}, 60000)"';
    const cancelKorean=process.env.GITJIG_TEST_LOCAL_CANCEL_LOCALE==='ko';
    const cancelEnv=cancelKorean?{...env,LANG:'ko_KR.UTF-8',LC_ALL:'ko_KR.UTF-8'}:env;
    const ready=cancelKorean?'/ready 설정':'/ready setup';
    const confirmation=cancelKorean?'검사 실행 확인 열기':'Open check confirmation';
    const enterCheck=[
        {wait:'Local development',send:'Run new isolated check\r'},{wait:'Isolated check command',send:cancelCommand+'\r'},
        {wait:'Isolated check working directory',send:'\r'},
    ];
    const cancellationSteps=[
        {wait:ready,send:'\x07/'},{wait:cancelKorean?'gitjig 명령 검색':'Gitjig commands · search',send:'/local\r'},
        ...enterCheck,{wait:confirmation,send:'\x1b'},
        {...enterCheck[0],queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[2]]}]},{...enterCheck[1],send:'\r'},enterCheck[2],
        {wait:confirmation,send:'\r'},
        {wait:'Explicit local check action',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[2]]}],send:'Run new independent check\r'},
        {wait:cancelKorean?'Esc 취소 요청':'Esc requests cancellation',queries:[{sql:"SELECT COUNT(*) FROM runs WHERE phase='RUNNING'",rows:[[1]]}],send:'\x1b'},
        {wait:cancelKorean?'검사 후속 동작 열기':'Open check actions',queries:[{sql:"SELECT COUNT(*) FROM runs WHERE phase='SETTLED'",rows:[[3]]}],send:'\x1b'},
        {wait:'Local development',send:'Close\r'},
        {wait:ready,assertDraft:draft,send:'\x07q'},
    ];
    await fs.writeFile(cancellationFile,JSON.stringify({command:[process.execPath,'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),cliEntry,'conversation','ui','--home',home,'--conversation',cid],
        env:cancelEnv,steps:cancellationSteps,output:cancellationFile+'.terminal',database:path.join(home,'state/controller.sqlite'),timeoutSeconds:22,gracefulShutdownSeconds:3}));
    const cancelled=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',cancellationFile],{timeout:28000,maxBuffer:2**20})).stdout);
    assert.equal(cancelled.exitCode,0);assert.equal(cancelled.stages,cancellationSteps.length);assert.equal(cancelled.terminalRestored,true);
    const cancellationTerminal=await fs.readFile(cancellationFile+'.terminal','utf8');
    assert.match(cancellationTerminal,/The check was cancelled/);assert.doesNotMatch(cancellationTerminal,/Next step for this check/);
    const afterCancel=await openController({installationHome:home,runtimeProfile:runtime});
    try {
        const original=afterCancel.inspectLocalCheck(workId),check=afterCancel.listLocalChecks('p').checks.find(row=>row.workId!==workId);
        assert.equal(original.result.runId,secondRun);
        const stopped=afterCancel.inspectLocalCheck(check.workId);
        assert.equal(stopped.state,'CANCELLED');assert.equal(stopped.unsettled,false);assert.equal(stopped.latestRun.cleanup,'removed');
        assert.equal(stopped.allowance.execution.consumed,1);assert.equal(stopped.allowance.execution.reserved,0);
        const [result]=afterCancel.store.all('SELECT data FROM results WHERE work=?',check.workId).map(row=>JSON.parse(row.data));
        assert.equal(result.status,'cancelled');assert.equal(result.cleanup,'removed');
        assert.equal(afterCancel.inspectConversation(cid).draft.text,draft);
        assert.equal(afterCancel.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n,0);
    }finally{await afterCancel.close();}
    const retryReady=path.join(source,'retry-ready');
    const retryCommand=`node -e "if (!require('node:fs').existsSync('retry-ready')) { process.stderr.write('fixture repair required'); process.exit(7); }"`;
    const failed=modal(['Local check result','The check command failed.','fixture repair required'],'\r',{baseline:true});
    const openOriginal=modal(['Next step for this check','Review another attempt of this check'],'Review another attempt of this check\r',unchanged);
    const resume=modal(['Original local check','Resume original check'],'Resume original check\r',unchanged);
    const confirm=modal(['Explicit original-check action'],'Resume original command\r',unchanged);
    const retried=await terminal('failed-result-retry',[
        ...enterLocal,modal(['Local development'],'Run new isolated check\r'),
        modal(['Isolated check command'],retryCommand+'\r'),modal(['Isolated check working directory'],'\r'),
        modal(['Review new independent local check','Open check confirmation'],'\r'),modal(['Explicit local check action'],'Run new independent check\r'),
        failed,openOriginal,resume,modal(['Review original local check continuation','Open check confirmation'],'\x1b',unchanged),
        resume,modal(['Review original local check continuation','Open check confirmation'],'\r',unchanged),confirm,
        failed,openOriginal,{...resume,releaseFile:retryReady},
        modal(['Review original local check continuation','Open check confirmation'],'\r',unchanged),confirm,
        modal(['Local check result','The check command finished successfully.'],'\x1b',{baseline:true}),...leave,
    ]);
    assert.ok(retried.frames.every(frame=>!frame.frame.some(line=>line.startsWith('Retained local checks'))));
    const afterRetry=await openController({installationHome:home,runtimeProfile:runtime});
    try {
        const row=afterRetry.listLocalChecks('p').checks.find(check=>check.commandPreview.startsWith('node -e') && check.commandPreview.includes('retry-ready'));
        assert.ok(row);
        const repeated=afterRetry.inspectLocalCheck(row.workId);
        assert.equal(repeated.command,retryCommand);
        const outcomes=afterRetry.store.all('SELECT data FROM results WHERE work=? ORDER BY rowid',row.workId).map(record=>JSON.parse(record.data));
        assert.deepEqual(outcomes.map(result=>[result.status,result.exitCode,result.cleanup]),[['failed',7,'removed'],['failed',7,'removed'],['succeeded',0,'removed']]);
        assert.equal(new Set(outcomes.map(result=>result.runId)).size,3);
        assert.equal(repeated.allowance.execution.consumed,3);
        assert.equal(afterRetry.inspectConversation(cid).draft.text,draft);
    }finally{await afterRetry.close();}
    await fs.unlink(retryReady);
    const rejectedLink=path.join(source,'capture-refused-link');
    const rejectedCommand='node -e "console.log(\'capture preflight fixture\')"';
    await fs.symlink('answer',rejectedLink);
    try {
        await terminal('capture-refused',[
            ...enterLocal,modal(['Local development'],'Run new isolated check\r'),
            modal(['Isolated check command'],rejectedCommand+'\r'),modal(['Isolated check working directory'],'\r'),
            modal(['Review new independent local check','Open check confirmation'],'\r'),modal(['Explicit local check action'],'Run new independent check\r'),
            modal(['Local check result','The check stopped before recording a project snapshot.','cleanup: not-allocated',
                'correct the reported prerequisite before another attempt','unsupported capture entry'],'\r',{baseline:true}),
            openOriginal,modal(['Original local check','Resume original check'],'Back\r',unchanged),...leave,
        ]);
    }finally{await fs.unlink(rejectedLink);}
    const afterRefusal=await openController({installationHome:home,runtimeProfile:runtime});
    try {
        const row=afterRefusal.listLocalChecks('p').checks.find(check=>check.commandPreview===rejectedCommand);
        assert.ok(row);
        const check=afterRefusal.inspectLocalCheck(row.workId);
        const attempts=afterRefusal.store.all('SELECT data FROM results WHERE work=?',row.workId).map(record=>JSON.parse(record.data));
        assert.deepEqual(attempts.map(result=>[result.status,result.captureRef,result.exitCode,result.cleanup]),[['unavailable',null,null,'not-allocated']]);
        assert.equal(check.allowance.execution.consumed,1);
    }finally{await afterRefusal.close();}
    for(const file of await fs.readdir(path.join(home,'state/runtime')))
        if(file.endsWith('.json'))assert.equal(JSON.parse(await fs.readFile(path.join(home,'state/runtime',file),'utf8')).state,'removed');
    assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),committedIndex);assert.equal((await native('rev-parse','HEAD')).trim(),committed);
    assert.equal(await fs.readFile(path.join(source,'answer'),'utf8'),'checked\n');assert.equal(await fs.readFile(path.join(source,'check.cjs'),'utf8'),script);
    t.diagnostic(JSON.stringify({scope:'Actual source terminal/local engine/source correspondence/candidate, native owner commit and original historical audit; same-work repeat and reopened audit; no model, seeded success or app commit',root,workId,firstRun,secondRun,firstResult,candidateId,committed,firstStages:first.stages,repeatStages:second.stages,auditStages:audited.stages,reopenedAuditStages:repeatedAudit.stages}));
    passed=true;
});
