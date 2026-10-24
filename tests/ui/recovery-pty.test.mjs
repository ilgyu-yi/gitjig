import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';

test('actual UI exposes scrollable structured recovery and permits clean close after a command refusal',{timeout:12000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/recovery-ui-'))),home=path.join(root,'home'),file=path.join(root,'pty.json');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained recovery UI '+root);});
    const cfg=path.join(root,'child.json');await fs.writeFile(cfg,JSON.stringify({home}));
    const steps=[
        {wait:'Model: not selected',send:'\x07n'},
        {wait:'RECOVERY_REQUIRED',assertDraft:'Retained 한국어 draft',send:'\x07e'},
        {wait:'Error recovery · choose a next step',send:'\r'},
        {wait:'Error details · inspection only',send:'\x1b[6~'.repeat(20)},
        {wait:'original-run',assertDraft:'Retained 한국어 draft',send:'\x1b'},
        {wait:'INPUT',assertDraft:'Retained 한국어 draft',terminate:true,send:''},
    ];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/cli/account-ui-no-network.mjs','tests/ui/recovery-pty-child.mjs',cfg],env:{...process.env,TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color'},steps,timeoutSeconds:8,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
    const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    const output=await fs.readFile(file+'.terminal','utf8');assert.ok(!output.includes('is not saved'));
    const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});
    try{assert.equal(db.prepare('SELECT draft FROM conversation_views').get().draft,'Retained 한국어 draft');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);}finally{db.close();}
    passed=true;
});

test('blocked project draft opens setup directly without submission or forced follow-up dialogs',{timeout:15000},async t=>{
 const {openController}=await import('../../dist/controller/index.js');const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/error-preflight-'))),home=path.join(root,'home'),project=path.join(root,'project');await fs.mkdir(project);const c=await openController({installationHome:home});await c.registerProject({id:'P',sourceRoot:project});const view=c.createConversation({projectId:'P'});c.setConversationView({selectedId:view.conversationId});await c.close();let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained first-input recovery '+root);});
 const file=path.join(root,'preflight.json'),empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const steps=[{wait:'/ready setup',send:'Keep this exact blocked request\x1b\r'},
  {wait:'Request not sent · your text is kept',assertDraft:'Keep this exact blocked request',queries:empty,send:'Open setup\r'},
  {wait:'Setup and next actions',assertDraft:'Keep this exact blocked request',queries:empty,send:'Return to request\r'},
  {wait:'Setup needed · Enter for options',assertDraft:'Keep this exact blocked request',queries:empty,terminate:true,send:''}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js'],env:{...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:10,database:path.join(home,'state/controller.sqlite'),expectedInputs:0,output:file+'.terminal',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);passed=true;
});

test('error recovery refuses a changed source before opening setup',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/error-stale-'))),home=path.join(root,'home'),flag=path.join(root,'mutate'),cfg=path.join(root,'child.json'),file=path.join(root,'stale.json');await fs.writeFile(cfg,JSON.stringify({home,mutateFile:flag}));let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained stale error '+root);});
 const steps=[{wait:'Model: not selected',send:'\x07n'},{wait:'RECOVERY_REQUIRED',send:'\x07e'},
  {wait:'Error recovery · choose a next step',releaseFile:flag,send:''},{wait:'OWNED_ERROR_SOURCE_CHANGED',send:'Open setup and readiness\r'},
  {wait:'Error source changed',assertDraft:'Retained 한국어 draft',terminate:true,send:''}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/cli/account-ui-no-network.mjs','tests/ui/recovery-pty-child.mjs',cfg],env:{...process.env,TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color'},steps,timeoutSeconds:10,database:path.join(home,'state/controller.sqlite'),expectedInputs:0,output:file+'.terminal',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.ok(!(await fs.readFile(file+'.terminal','utf8')).includes('Setup and next actions'));passed=true;
});
