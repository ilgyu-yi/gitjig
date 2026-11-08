import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {world,ledger} from '../controller/local-check-fixture.mjs';
const execute=promisify(execFile);
const cliEntry=process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js';
test('captured unavailable check opens live runtime setup and returns to the original review', {timeout:20000}, async t=>{
 const f=await world(t),runtime=f.c.options.runtimeProfile;
 delete f.c.capacity.acquire;
 f.c.options.runtimeProfile={...runtime,image:'stale-fixture'};
 const original=await f.c.runLocalCheck({projectId:'p',command:'printf original-preflight'});
 assert.ok(original.captureRef);assert.equal(original.status,'unavailable');assert.equal(original.cleanup,'not-allocated');
 f.c.options.runtimeProfile=runtime;
 const savedConfig=path.join(f.root,'saved-docker-config');
 await fs.mkdir(savedConfig,{mode:0o700});
 await ApplicationStartup.open(f.c).save({version:1,runtime:{...runtime,dockerContext:'SAVED_ROUTE',
  dockerConfigDirectory:savedConfig,image:'sha256:'+'1'.repeat(64)}});
 const {conversationId}=f.c.createConversation({projectId:'p'}),before=ledger(f.c);
 const savedDraft='Keep this separate 한국어 draft';
 f.c.setDraft({conversationId,expectedRevision:0,text:savedDraft});await f.c.close();
 const output=path.join(f.root,'runtime-repair-terminal'),file=output+'.json',observation=output+'.current';
 const exact={wait:'Original local check · BLOCKED · '+original.workId,assertDraft:savedDraft};
 const choices=[
  {wait:'Model: not selected',send:'\x07/'},{wait:'Gitjig commands · search',send:'/local\r'},
  {wait:'Local development',send:'Retained local checks\r'},
  {wait:'Retained local checks',send:'original-preflight\r'},
  {...exact,send:'Review execution setup\r'},{wait:'Staged Docker context · "NO_ENGINE"',send:'\x1b'},
  {...exact,send:'Review execution setup\r'},{wait:'Staged Docker context · "NO_ENGINE"',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\r'},{wait:'Docker context',send:'\x15REPAIRED_ROUTE\r'},
  {wait:'Runtime image',send:'\r'},{wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
  {wait:'Open settings confirmation',send:'\r'},{wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},
  {...exact,send:'Resume original check\r'},
  {wait:'Open check confirmation',assertDraft:savedDraft,send:'\r',frame:{selected:conversationId,draft:savedDraft,
   contains:['Previous attempt runtime','Docker context: "NO_ENGINE"','Docker context: "REPAIRED_ROUTE"']}},
  {wait:'Explicit original-check action',send:'Back without resuming\r'},
  {...exact,send:'Back\r'},{wait:'Retained local checks',send:'Back\r'},
  {wait:'Local development',send:'Close\r'},{wait:'INPUT',assertDraft:savedDraft,send:'\x07q'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),'--import',path.resolve('tests/ui/local-no-execution.mjs'),
  '--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),cliEntry,'conversation','ui','--home',f.home,'--conversation',conversationId,
  '--docker-binary',runtime.dockerBinary,'--docker-context',runtime.dockerContext,'--image',runtime.image],
  env:{HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',GITJIG_RESULT_OBSERVATION:observation},
  steps:choices,timeoutSeconds:10,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),observation,output,rows:48}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);
 assert.equal(result.stages,choices.length);assert.equal(result.exitCode,0);assert.equal(result.terminalRestored,true);
 const saved=JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8')).runtime;
 assert.equal(saved.dockerContext,'REPAIRED_ROUTE');assert.equal(saved.image,runtime.image);assert.equal(saved.dockerConfigDirectory,undefined);
 const reopened=await openController({installationHome:f.home});
 try{assert.equal(ledger(reopened),before);assert.equal(reopened.inspectConversation(conversationId).draft.text,savedDraft);}
 finally{await reopened.close();}
});
test('local check returns from live runtime setup to its original form and Back admits no work',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-local-check-ui-'))),home=path.join(root,'home'),project=path.join(root,'project'),file=path.join(root,'terminal.json');let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained no-runtime local check UI '+root);});await fs.mkdir(project);
 const c=await openController({installationHome:home});try{await c.registerProject({id:'p',sourceRoot:project});}finally{await c.close();}
 const empty=['works','runs','budgets'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const steps=[
  {wait:'Model: not selected',send:'/project p\x1b\r'},
  {wait:'Project selected: p',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],send:'/local\x1b\r'},
  {wait:'Local development',send:'Run new isolated check\r'},
  {wait:'Local check needs an execution runtime',queries:empty,assertDraft:'/local',send:'\x1b'},
  {wait:'Local development',send:'Retained local checks\r'},
  {wait:'Retained local checks',send:'Back\r'},
  {wait:'Local development',send:'Retained candidates and commit audit\r'},
  {wait:'Retained candidates',send:'Back\r'},
  {wait:'Local development',send:'Run new isolated check\r'},
  {wait:'Local check needs an execution runtime',queries:empty,assertDraft:'/local',send:'Configure execution runtime\r'},
  {wait:'Runtime setup · staged',queries:empty,send:'\x1b'},
  {wait:'Local development',queries:empty,send:'Run new isolated check\r'},
  {wait:'Local check needs an execution runtime',queries:empty,assertDraft:'/local',send:'Configure execution runtime\r'},
  {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'/usr/bin/false\r'},
  {wait:'Docker context',send:'OWNED_HANDOFF\r'},
  {wait:'Runtime image',send:'sha256:'+'a'.repeat(64)+'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
  {wait:'Open settings confirmation',queries:empty,send:'\x1b'},
  {wait:'Runtime setup · staged',queries:empty,send:'Review and save runtime\r'},
  {wait:'Open settings confirmation',queries:empty,send:'\r'},
  {wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},
  {wait:'Isolated check command',queries:empty,assertDraft:'/local',send:'\r'},
  {wait:'Enter a nonempty check command up to 32 KiB',queries:empty,send:'printf handoff\r'},
  {wait:'Isolated check working directory',send:'/scratch\r'},
  {wait:'Open check confirmation',queries:empty,send:'\x1b'},
  {wait:'Local development',queries:empty,send:'Run new isolated check\r'},
  {wait:'Isolated check command',queries:empty,assertDraft:'/local',send:'\r'},
  {wait:'Isolated check working directory',send:'\r'},
  {wait:'Isolated directory: /scratch',queries:empty,assertDraft:'/local',send:'\r'},
  {wait:'Explicit local check action',queries:empty,send:'Edit working directory\r'},
  {wait:'Isolated check working directory',queries:empty,send:'\x1b'},
  {wait:'Isolated directory: /scratch',queries:empty,assertDraft:'/local',send:'\r'},
  {wait:'Explicit local check action',queries:empty,send:'Edit working directory\r'},
  {wait:'Isolated check working directory',queries:empty,send:'/work\r'},
  {wait:'Isolated directory: /work',queries:empty,assertDraft:'/local',send:'\r'},
  {wait:'Explicit local check action',queries:empty,send:'Edit check command\r'},
  {wait:'Isolated check command',queries:empty,assertDraft:'/local',send:'-edited\r'},
  {wait:'Exact command: "printf handoff-edited"',queries:empty,assertDraft:'/local',send:'\r'},
  {wait:'Explicit local check action',queries:empty,send:'Back without starting\r'},
  {wait:'Local development',send:'Close\r'},
  {wait:'INPUT',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['/local']]}],assertDraft:'/local',send:'\x07'},
  {wait:'Commands · Ctrl+G',send:'q'},
 ];
 const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),'--import','./tests/ui/local-no-execution.mjs',cliEntry],env,steps,timeoutSeconds:8,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.match(output,/Local check needs an execution runtime/);assert.match(output,/Docker context: "OWNED_HANDOFF"/);assert.match(output,/Exact command: "printf handoff"/);await assert.rejects(fs.lstat(path.join(home,'local-candidates')),{code:'ENOENT'});passed=true;}finally{if(!passed)t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-12000));}
});

test('retained checks explain unavailable evidence and spent allowance before choosing an action', {timeout:15000}, async t=>{
    const f=await world(t), observation=await f.c.runLocalCheck({projectId:'p',command:'printf original'});
    for (let index=0;index<24;index++)
        await f.c.runLocalCheck({projectId:'p',command:`printf later-${index}`});
    const exhausted=await f.c.runLocalCheck({projectId:'p',command:'printf exhausted'});
    f.c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",exhausted.workId);
    const {conversationId}=f.c.createConversation({projectId:'p'});
    f.c.setConversationView({selectedId:conversationId});
    const originalTitle=`Original local check · ${f.c.inspectLocalCheck(observation.workId).state} · ${observation.workId}`;
    const draft='Keep this draft while reviewing the original check';
    f.c.setDraft({conversationId,expectedRevision:0,text:draft});
    const before=ledger(f.c);
    await f.c.close();
    const output=path.join(f.root,'retained-terminal'), file=output+'.json';
    const explanation='Source correspondence and candidate recording require a successful latest /work check with cleanup confirmed.';
    const steps=[
        {wait:'Model: not selected',send:'\x07/'},
        {wait:'Gitjig commands · search',send:'/local\r'},
        {wait:'Local development',send:'Retained local checks\r'},
        {wait:'Retained local checks · p',send:'Older checks\r'},
        {wait:'Newer checks',send:'printf original\r'},
        {wait:explanation,assertDraft:draft,send:'Open original work recovery and allowances\r'},
        {wait:'Work recovery · #'+observation.workId,assertDraft:draft,send:'\x1b'},
        {wait:originalTitle,assertDraft:draft,send:'Inspect original check and allowance\r'},
        {wait:'Original command observation · history',send:'\x1b'},
        {wait:'Original local check ·',send:'Back\r'},
        {wait:'Newer checks',assertDraft:draft,send:'Newer checks\r'},
        {wait:'printf exhausted',send:'printf exhausted\r'},
        {wait:'Execution allowance is spent',send:'Back\r'},
        {wait:'Retained local checks',send:'Back\r'},
        {wait:'Local development',send:'Close\r'},
        {wait:'INPUT',assertDraft:draft,send:'\x07'},
        {wait:'Commands · Ctrl+G',send:'q'},
    ];
    await fs.writeFile(file,JSON.stringify({
        command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
            '--import','./tests/ui/local-no-execution.mjs',cliEntry],
        env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',
            LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,timeoutSeconds:8,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3,
    }));
    try{
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);
        assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
        const {actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
        const terminal=await fs.readFile(output);
        const menu=terminal.subarray(offsets[4],offsets[5]).toString('utf8');
        assert.ok(menu.includes(explanation));
        assert.match(menu,/Inspect original result and output/);
        assert.match(menu,/Resume original check/);
        assert.doesNotMatch(menu,/Inspect current check correspondence|Record exact commit candidate/);
        const exhaustedMenu=terminal.subarray(offsets[11],offsets[12]).toString('utf8');
        assert.match(exhaustedMenu,/Execution allowance is spent/);
        assert.match(exhaustedMenu,/Open original work recovery and allowances/);
        assert.doesNotMatch(exhaustedMenu,/Resume original check/);
        const reopened=await openController({installationHome:f.home});
        try{
            assert.equal(ledger(reopened),before);
            assert.equal(reopened.inspectConversation(conversationId).draft.text,draft);
            assert.equal(reopened.inspectLocalCheck(observation.workId).result.status,'unavailable');
        }finally{await reopened.close();}
    }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-5000));throw error;}
});
