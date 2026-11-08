import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fixture,git} from '../controller/local-evidence-fixture.mjs';
import {ApplicationLocalConventions,recommendedLocalConventions} from '../../dist/app/local-conventions.js';
const execute=promisify(execFile);
const cliEntry=process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js';

test('local tools inspect original check and candidate history after the worktree moves', {timeout:14000}, async t => {
    const f = await fixture(t,undefined,'sha1',false,false), messageFile = path.join(f.root,'message'), file = path.join(f.root,'offline-terminal.json');
    await fs.writeFile(messageFile,'Keep the original receipt\n',{mode:0o600});
    new ApplicationLocalConventions(f.controller).set('p',0,recommendedLocalConventions());
    const {candidate:{id}} = await f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile});
    const cid = f.controller.createConversation({projectId:'p'}).conversationId, draft = '/local';
    f.controller.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    await f.controller.close();
    const moved = f.source+'-moved';
    await fs.rename(f.source,moved);
    const checks = [
        {sql:'SELECT state FROM works WHERE id=?',params:['w'],rows:[['DELIVERED']]},
        {sql:'SELECT consumed,reserved FROM budgets WHERE kind=?',params:['execution'],rows:[[1,0]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[1]]},
    ];
    const step = (wait,send) => ({wait,send,assertDraft:draft,expectedSelected:cid,queries:checks});
    const stages = [
        step(draft,'\x1b\r'),
        step('Project folder unavailable','Retained local checks\r'),
        step('Retained local checks ·','fixture-command\r'),
        step('Original local check · DELIVERED','Inspect original result and output\r'),
        step('Original local check result and output','\x1b'),
        step('Original local check · DELIVERED','Back\r'),
        step('Retained local checks ·','Back\r'),
        step('Project folder unavailable','Retained candidates\r'),
        step('Retained candidates · p','Candidate\r'),
        step('Original candidate · '+id,'Inspect check used for this candidate\r'),
        step('Original candidate check and output','\x1b'),
        step('Original candidate · '+id,'Back\r'),
        step('Retained candidates · p','Back\r'),
        step('Project folder unavailable','Close\r'),
        step('Command cancelled · draft kept','\x07q'),
    ];
    const output = file+'.terminal';
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/local-no-execution.mjs','dist/cli/entry.js',
        'conversation','ui','--home',f.home,'--conversation',cid],env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8'},
        steps:stages,timeoutSeconds:8,noForceKill:true,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output}));
    const result = JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000})).stdout);
    assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,stages.length,true]);
    assert.doesNotMatch(await fs.readFile(output,'utf8'),/Resume original check|Audit native commit|Run new isolated check/);
    assert.equal(await fs.readFile(path.join(moved,'answer'),'utf8'),'good');
    f.accept();
});

test('candidate receipt changes keep the terminal in local history without auditing stale evidence', {timeout:14000}, async t => {
    const f = await fixture(t,undefined,'sha1',false,false), messageFile = path.join(f.root,'message');
    await fs.writeFile(messageFile,'Preserve original evidence\n',{mode:0o600});
    new ApplicationLocalConventions(f.controller).set('p',0,recommendedLocalConventions());
    const {candidate:{id}} = await f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile});
    const cid = f.controller.createConversation({projectId:'p'}).conversationId;
    f.controller.setDraft({conversationId:cid,expectedRevision:0,text:'/local'});
    await f.controller.close();
    const file = path.join(f.root,'drift-terminal.json'), output = file+'.terminal';
    const receipt = path.join(f.home,'local-candidates',id+'.json');
    const listed = path.join(f.root,'listed'), opened = path.join(f.root,'opened');
    const title = 'Retained candidates · p', candidate = 'Original candidate · '+id;
    const changed = 'Unavailable original candidate';
    const step = (wait,send) => ({wait,send,assertDraft:'/local',expectedSelected:cid,queries:[
        {sql:'SELECT COUNT(*) FROM runs',rows:[[1]]},
        {sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[1,0]]},
    ]});
    const steps = [
        step('/local','\x1b\r'),
        step('Local development','Retained candidates and commit audit\r'),
        {...step(title,'Candidate\r'),waitFiles:[{path:listed,value:'changed'}]},
        step(changed,'\x1b'),
        step(title,'Candidate\r'),
        {...step(candidate,'Audit native commit\r'),waitFiles:[{path:opened,value:'changed'}]},
        step(changed,'\x1b'),
        step('Unavailable candidate · '+id,'\x1b'),
        step('Local development','Close\r'),
        step('Command cancelled · draft kept','\x07q'),
    ];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/local-no-execution.mjs','dist/cli/entry.js',
        'conversation','ui','--home',f.home,'--conversation',cid],env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8'},
        steps,timeoutSeconds:8,noForceKill:true,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output}));
    const changeAfter = async (marker, fence, change) => {
        const limit = Date.now()+6500;
        while (Date.now()<limit) {
            if ((await fs.readFile(output,'utf8').catch(()=> '')).includes(marker)) {
                await change();
                await fs.writeFile(fence,'changed');
                return;
            }
            await new Promise(resolve=>setTimeout(resolve,15));
        }
        assert.fail('Controlled receipt change did not reach '+marker);
    };
    const [terminal] = await Promise.all([
        execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000}),
        (async()=>{
            await changeAfter(title,listed,()=>fs.appendFile(receipt,'\n'));
            await changeAfter(candidate,opened,()=>fs.writeFile(receipt,'{malformed receipt',{mode:0o600}));
        })(),
    ]);
    const result = JSON.parse(terminal.stdout);
    assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
    const log = await fs.readFile(output,'utf8');
    assert.doesNotMatch(log,/Trusted Git executable|Explicit commit audit/);
    assert.ok(log.includes('Retained candidate changed since it was shown'));
    f.accept();
});

test('original model-free terminal discovers a retained candidate and audits a real native commit with synthetic prior check evidence',{timeout:15000},async t=>{
 const f=await fixture(t),messageFile=path.join(f.root,'message'),file=path.join(f.root,'audit-terminal.json');await fs.writeFile(messageFile,'Implement correspondence\n',{mode:0o600});new ApplicationLocalConventions(f.controller).set('p',0,recommendedLocalConventions());const receipt=await f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile});await f.native('commit','--cleanup=verbatim','-F',messageFile);const oid=await f.native('rev-parse','HEAD');await f.controller.close();
 const original='Original candidate · '+receipt.candidate.id;
 const originalCheck='Original local check · DELIVERED · w';
 const correction='Enter one line without control characters or line separators.';
 const malformed=value=>'\x1b[200~'+value+'\u0085tail\x1b[201~\r';
 const custody=[{sql:'SELECT consumed,reserved FROM budgets WHERE kind=?',params:['execution'],rows:[[1,0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}];
 const auditFields=[{wait:original,send:'Audit native commit\r'},
  {wait:'Trusted Git executable',send:'\x15'+git+'\r'},
  {wait:'Explicit native commit reference',send:'\x15HEAD\r'}];
 const steps=[
  {wait:'Model: not selected',send:'/project p\x1b\r'},
  {wait:'Project selected: p',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],send:'/local\x1b\r'},
  {wait:'Local development',send:'Retained local checks\r'},
  {wait:'Retained local checks',send:'fixture-command\r'},
  {wait:originalCheck,send:'Record exact commit candidate\r'},
  {wait:'Trusted Git executable',send:'\x15'+malformed(git)},
  {wait:correction,queries:custody,assertDraft:'/local',send:'\x1b'},
  {wait:originalCheck,send:'Record exact commit candidate\r'},
  {wait:'Trusted Git executable',send:'\x15'+git+'\r'},
  {wait:'Owned exact commit message file',send:malformed(messageFile)},
  {wait:correction,queries:custody,assertDraft:'/local',send:'missing-relative-message\r'},
  {wait:'Enter an absolute path.',queries:custody,send:'\x15'+path.join(f.root,'missing-message')+'\r'},
  {wait:'Open recording confirmation',queries:custody,send:'\r'},
  {wait:'Explicit candidate recording',queries:custody,send:'Record exact candidate\r'},
  {wait:'Commit message file is unavailable or unreadable',queries:custody,assertDraft:'/local',send:'\x15'+messageFile+'\r'},
  {wait:'Open recording confirmation',queries:custody,send:'\r'},
  {wait:'Explicit candidate recording',queries:custody,send:'Back without recording\r'},
  {wait:originalCheck,send:'Back\r'},
  {wait:'Retained local checks',send:'Back\r'},
  {wait:'Local development',send:'Retained candidates and commit audit\r'},
  {wait:'Retained candidates',send:'Candidate\r'},
  {wait:original,send:'Inspect original candidate\r'},
  {wait:'Original candidate · historical preparation',send:'\x1b'},
  {wait:original,send:'Inspect check used for this candidate\r'},
  {wait:'Original candidate check and output',send:'\x1b'},
  {wait:original,send:'Audit native commit\r'},
  {wait:'Trusted Git executable',send:'\x1b'},
  {wait:original,send:'Audit native commit\r'},
  {wait:'Trusted Git executable',send:'\x15'+git+'\r'},
  {wait:'Explicit native commit reference',send:'\x15\r'},
  {wait:'Enter a commit reference',queries:custody,assertDraft:'/local',send:malformed('HEAD')},
  {wait:correction,queries:custody,send:'HEAD\r'},
  {wait:'Open audit confirmation',send:'\x1b'},
  ...auditFields,
  {wait:'Open audit confirmation',send:'\r'},
  {wait:'Explicit commit audit',send:'Back without audit\r'},
  ...auditFields,
  {wait:'Open audit confirmation',send:'\r'},
  {wait:'Explicit commit audit',send:'Audit selected commit\r'},
  {wait:'Historical native commit correspondence · MATCH',queries:[{sql:'SELECT consumed,reserved FROM budgets WHERE kind=?',params:['execution'],rows:[[1,0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}],send:'\r'},
  {wait:'This is the recorded check used for the candidate',send:'\x1b'},
  {wait:original,send:'Back\r'},
  {wait:'Retained candidates',send:'Back\r'},
  {wait:'Local development',send:'Close\r'},
  {wait:'INPUT',assertDraft:'/local',send:'\x07q'},
 ];
 const env={...process.env,HOME:f.root,GITJIG_HOME:f.home,GITJIG_LOCAL_GIT_BINARY:git,TMPDIR:f.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),'--import','./tests/ui/local-no-execution.mjs',cliEntry],env,steps,timeoutSeconds:9,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.match(output,/Historical native commit correspondence · MATCH/);assert.match(output,new RegExp(receipt.candidate.id));assert.equal(await f.native('rev-parse','HEAD'),oid);assert.deepEqual(await fs.readdir(path.join(f.home,'local-candidates')),[receipt.candidate.id+'.json']);f.accept();}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}
});
