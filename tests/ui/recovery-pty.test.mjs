import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
const entry=process.env.GITJIG_TEST_CLI_ENTRY;
const dist=entry?path.resolve(path.dirname(realpathSync(entry)),'..'):fileURLToPath(new URL('../../dist',import.meta.url));
const {uiText}=await import(pathToFileURL(path.join(dist,'ui/i18n.js')).href);
const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];

test('actual UI exposes scrollable structured recovery and permits clean close after a command refusal',{timeout:12000},async t=>{
    const root=await temporaryDirectory('recovery-ui'),home=path.join(root,'home'),file=path.join(root,'pty.json');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained recovery UI '+root);});
    const cfg=path.join(root,'child.json');await fs.writeFile(cfg,JSON.stringify({home}));
    const steps=[
        {wait:'Model: not selected',send:'\x07n'},
        {wait:'RECOVERY_REQUIRED',assertDraft:'Retained 한국어 draft',send:'\x07e'},
        {wait:'Error recovery · choose a next step',send:'\r'},
        {wait:'Error details · inspection only',send:'\x1b[6~'.repeat(20)},
        {wait:'original-run',assertDraft:'Retained 한국어 draft',send:'\x1b'},
        {wait:'Error recovery · choose a next step',assertDraft:'Retained 한국어 draft',send:'\x1b'},
        {wait:'INPUT',assertDraft:'Retained 한국어 draft',terminate:true,send:''},
    ];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/cli/account-ui-no-network.mjs','tests/ui/recovery-pty-child.mjs',cfg],env:{...process.env,TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color'},steps,timeoutSeconds:8,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
    const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    const output=await fs.readFile(file+'.terminal','utf8');assert.ok(!output.includes('is not saved'));
    const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});
    try{assert.equal(db.prepare('SELECT draft FROM conversation_views').get().draft,'Retained 한국어 draft');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);}finally{db.close();}
    passed=true;
});

test('actual error recovery preserves the original refusal when retained requests are unreadable and refreshes them explicitly',{timeout:15000},async t=>{
    const root=await temporaryDirectory('error-unreadable-request'),home=path.join(root,'home'),cfg=path.join(root,'child.json'),file=path.join(root,'pty.json'),output=file+'.terminal';
    const original=path.join(root,'original.json'),text='Original retained request 한국어',draft='Retained 한국어 draft';
    let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained unavailable request recovery '+root);});
    await fs.writeFile(cfg,JSON.stringify({home,language:'en',retainedRequest:{text,original}}));
    const unallocated=['works','runs','budgets'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const input=valid=>({sql:'SELECT text,state,json_valid(data) FROM conversation_inputs',rows:[[text,'QUEUED',valid]]});
    const mutate=sql=>[{sql:sql+' WHERE conversation=(SELECT selected FROM interaction_view) AND text=?',params:[text]}];
    const unavailable='Retained requests are unavailable. Refresh recovery choices to check again.';
    const recovery=uiText('en','error.title'),chooseDetails=uiText('en','error.details'),chooseInput=uiText('en','error.inputs');
    const openDetails={wait:unavailable,assertDraft:draft,queries:[...unallocated,input(0)],send:chooseDetails+'\r'};
    const refresh={wait:unavailable,assertDraft:draft,queries:[...unallocated,input(0)],mutations:mutate('UPDATE conversation_inputs SET data=substr(data,2)'),send:uiText('en','error.refreshProjectRecovery')+'\r'};
    const showRequests={wait:uiText('en','input.recoveryList'),assertDraft:draft,queries:[...unallocated,input(1)],send:'\x1b'};
    const steps=[
        {wait:'Model: not selected',send:'\x07n'},
        {wait:'RECOVERY_REQUIRED',assertDraft:draft,queries:[...unallocated,input(1)],mutations:mutate("UPDATE conversation_inputs SET data='!'||data"),send:'\x07e'},
        openDetails,
        {wait:uiText('en','error.detailsTitle'),assertDraft:draft,queries:[...unallocated,input(0)],send:'\x1b[6~'.repeat(20)},
        {wait:'original-run',send:'\x1b'},
        refresh,
        {wait:chooseInput,assertDraft:draft,queries:[...unallocated,input(1)],send:chooseInput+'\r'},
        showRequests,
        {wait:recovery,assertDraft:draft,queries:[...unallocated,input(1)],send:'\x1b'},
        {wait:'INPUT',assertDraft:draft,queries:[...unallocated,input(1)],terminate:true,send:''},
    ];
    const database=path.join(home,'state/controller.sqlite');
    const env={PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color',LC_ALL:'en_US.UTF-8',LANG:'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs','tests/ui/recovery-pty-child.mjs',cfg],env,steps,timeoutSeconds:10,expectedInputs:1,database,output,gracefulShutdownSeconds:3,noForceKill:true}));
    try{
        const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
        assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
        const bytes=await fs.readFile(output),{actionOutputOffsets:offsets,forceKilled}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
        assert.equal(forceKilled,false);
        const before=step=>{const i=steps.indexOf(step);return bytes.subarray(offsets[i-1],offsets[i]).toString('utf8');};
        const choices=before(openDetails);
        for(const line of [recovery,'RECOVERY_REQUIRED',chooseDetails,uiText('en','error.ready'),uiText('en','error.allWork')]) assert.ok(choices.includes(line),'Recovery choices must still show '+line);
        assert.ok(!choices.includes(chooseInput));
        assert.ok(before(showRequests).includes(text),'Explicit refresh must reveal the original queued request');
        const db=new DatabaseSync(database,{readOnly:true});
        try{
            assert.deepEqual(JSON.parse(JSON.stringify(db.prepare('SELECT * FROM conversation_inputs').get())),JSON.parse(await fs.readFile(original,'utf8')));
        }finally{db.close();}
        passed=true;
    }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-10000));throw error;}
});

test('blocked project draft opens setup directly without submission or forced follow-up dialogs',{timeout:15000},async t=>{
 const {openController}=await import(pathToFileURL(path.join(dist,'controller/index.js')).href);const root=await temporaryDirectory('error-preflight'),home=path.join(root,'home'),project=path.join(root,'project');await fs.mkdir(project);const c=await openController({installationHome:home});await c.registerProject({id:'P',sourceRoot:project});const view=c.createConversation({projectId:'P'});c.setConversationView({selectedId:view.conversationId});await c.close();let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained first-input recovery '+root);});
 const file=path.join(root,'preflight.json'),empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const steps=[{wait:'/ready setup',send:'Keep this exact blocked request\x1b\r'},
  {wait:'Request not sent · your text is kept',assertDraft:'Keep this exact blocked request',queries:empty,send:'Open setup\r'},
  {wait:'Next step · Connect your model account',assertDraft:'Keep this exact blocked request',queries:empty,send:'Return to request\r'},
  {wait:'Setup needed · Enter for options',assertDraft:'Keep this exact blocked request',queries:empty,terminate:true,send:''}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs',entry??'dist/cli/entry.js'],env:{...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:10,database:path.join(home,'state/controller.sqlite'),expectedInputs:0,output:file+'.terminal',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);passed=true;
});

test('error recovery refuses a changed source before opening setup',{timeout:15000},async t=>{
 const root=await temporaryDirectory('error-stale'),home=path.join(root,'home'),flag=path.join(root,'mutate'),cfg=path.join(root,'child.json'),file=path.join(root,'stale.json');await fs.writeFile(cfg,JSON.stringify({home,mutateFile:flag}));let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained stale error '+root);});
 const steps=[{wait:'Model: not selected',send:'\x07n'},{wait:'RECOVERY_REQUIRED',send:'\x07e'},
  {wait:'Error recovery · choose a next step',releaseFile:flag,send:''},{wait:'OWNED_ERROR_SOURCE_CHANGED',send:'Open setup and readiness\r'},
  {wait:'Error source changed',assertDraft:'Retained 한국어 draft',terminate:true,send:''}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/cli/account-ui-no-network.mjs','tests/ui/recovery-pty-child.mjs',cfg],env:{...process.env,TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color'},steps,timeoutSeconds:10,database:path.join(home,'state/controller.sqlite'),expectedInputs:0,output:file+'.terminal',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.ok(!(await fs.readFile(file+'.terminal','utf8')).includes('Setup and next actions'));passed=true;
});

for(const locale of ['en','ko'])test('original '+locale+' error terminal returns from inspection to recovery and preserves the draft',{timeout:15000},async t=>{
 const root=await temporaryDirectory('error-locale-terminal'),home=path.join(root,'home'),cfg=path.join(root,'child.json'),file=path.join(root,'pty.json');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained localized error terminal '+root);});
 await fs.writeFile(cfg,JSON.stringify({home,language:locale}));
 const steps=[
  {wait:locale==='ko'?'입력 · 대화 대기':'Model: not selected',send:'\x07n'},
  {wait:'RECOVERY_REQUIRED',assertDraft:'Retained 한국어 draft',send:'\x07e'},
  {wait:locale==='ko'?'오류 복구 · 다음 동작 선택':'Error recovery · choose a next step',send:'\r'},
  {wait:uiText(locale,'error.returnToChoices'),send:'\x1b[6~'.repeat(20)},
  {wait:'original-run',assertDraft:'Retained 한국어 draft',send:'\r'},
  {wait:uiText(locale,'error.title'),assertDraft:'Retained 한국어 draft',send:uiText(locale,'error.ready')+'\r'},
  {wait:uiText(locale,'ready.title').split(' · ')[0],assertDraft:'Retained 한국어 draft',send:'\x1b'},
  {wait:uiText(locale,'error.title'),assertDraft:'Retained 한국어 draft',send:'\x1b'},
  {wait:locale==='ko'?'입력 · 대화 대기':'INPUT',assertDraft:'Retained 한국어 draft',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]}],send:'\x15A separate draft 한국어'},
  {wait:'A separate draft 한국어',assertDraft:'A separate draft 한국어',send:'\x07e'},
  {wait:uiText(locale,'error.previousTitle'),assertDraft:'A separate draft 한국어',send:'\x1b'},
  {wait:locale==='ko'?'입력 · 대화 대기':'INPUT',send:'\x15/quit\x1b\r'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs','tests/ui/recovery-pty-child.mjs',cfg],env:{...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:path.join(home,'artifacts'),LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:10,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3,noForceKill:true}));
 const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(result.alternateEntered,true);assert.equal(result.alternateExited,true);
 const progress=JSON.parse(await fs.readFile(file+'.terminal.progress.json','utf8'));assert.equal(progress.forceKilled,false);assert.equal(progress.error,null);assert.equal(progress.outputTruncated,false);
 for(const pid of [progress.childPid,-progress.childPid])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 const output=await fs.readFile(file+'.terminal','utf8');assert.ok(output.includes(locale==='ko'?'닫기':'closes'));passed=true;
});
