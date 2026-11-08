import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {uiText} from '../../dist/ui/i18n.js';

const packageRoot = path.resolve(process.env.GITJIG_TEST_PACKAGE_ROOT ?? '.');
const {openController} = await import(pathToFileURL(path.join(packageRoot, 'dist/controller/index.js')));
const execute = promisify(execFile);

for (const locale of ['en','ko']) test('linked work closes back to its goal entry in '+locale,{timeout:14500},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-goal-work-return-'))),home=path.join(root,'home'),source=path.join(root,'source');
    let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained goal work terminal '+root);});
    await fs.mkdir(source);await fs.writeFile(path.join(source,'input.txt'),'Controlled fixture');
    const c=await openController({installationHome:home}),draft='Keep this unsent request · 한글',objective='Review the same original goal';
    let cid,goal,work,queries,expectedInputs;
    try{
        await c.registerProject({id:'P',sourceRoot:source});
        cid=c.createConversation({projectId:'P'}).conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        goal=c.createGoal({conversationId:cid,objective,criteria:['Keep the original request and work'],turnLimit:3});
        const initial=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:objective,mode:'idle'});
        work=(await c.beginChange({projectId:'P',request:'Inspect the original governed work'})).workId;
        const run=c.store.one('SELECT id FROM runs WHERE work=?',work).id;
        // Read-only navigation fixture. The attempt links the original capture and does not claim a completed goal turn.
        c.store.run("UPDATE conversation_inputs SET state='CONSUMED' WHERE id=?",initial.inputId);
        c.store.run('INSERT INTO goal_attempts VALUES(?,?,?,?,?,?,?,?,?,?)','goal-attempt',goal.goalId,1,'author',cid,initial.inputId,run,'UNAVAILABLE',goal.revision,'{}');
        c.store.run("UPDATE goals SET state='BLOCKED',data=json_set(data,'$.startedAttempts',1,'$.reason','A source request is pending') WHERE id=?",goal.goalId);
        const role=c.interactions.allocateRole({workId:work,runId:run,launchId:'retained-role',role:'implementer'});
        const pending=await c.queueConversationInput({conversationId:role.conversationId,expectedGeneration:role.generation,text:'Retained request with a source hold',mode:'follow-up'});
        assert.equal(c.goalPendingSourceWork(goal.goalId),work);
        expectedInputs=c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n;
        queries=[{sql:'SELECT state,revision,data FROM goals WHERE id=?',params:[goal.goalId],rows:c.store.all('SELECT state,revision,data FROM goals WHERE id=?',goal.goalId).map(Object.values)},
            {sql:'SELECT state,text FROM conversation_inputs WHERE id=?',params:[pending.inputId],rows:[['QUEUED','Retained request with a source hold']]},
            ...['runs','works','goal_attempts'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[1]]}))];
    }finally{await c.close();}
    const text=(key,args)=>uiText(locale,key,args),step=(wait,send)=>({wait,send,queries,assertDraft:draft});
    const menu=text('goal.menu',{state:text('goal.state.BLOCKED'),objective}),registry=text('workRecovery.projectRegistryTitle',{project:'P'});
    const workMenu=text('workRecovery.title',{id:work,state:'ACTIVE'}),details=text('goal.openPendingWork');
    const steps=[step(draft,'\x07/'),step(text('command.discovery.title'),'/goal\r'),step(menu,text('goal.work')+'\r'),
        step(registry,work+'\r'),step(workMenu,'\x1b'),step(registry,'\x1b'),step(menu,text('goal.details')+'\r'),
        step(details,'\r'),step(workMenu,'\x1b'),step(details,'\x1b'),step(menu,text('goal.close')+'\r'),step(draft,'\x07q')];
    const file=path.join(root,'terminal.json');
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
        '--import',path.resolve('tests/ui/readiness-no-execution.mjs'),process.env.GITJIG_TEST_CLI_ENTRY??path.join(packageRoot,'dist/cli/entry.js'),
        'conversation','ui','--home',home,'--conversation',cid],
        env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',steps,timeoutSeconds:9,expectedInputs}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    passed=true;
});

for(const locale of ['en','ko'])test('retained goal request Escape and default Back preserve the draft in '+locale,{timeout:13000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-goal-retained-input-'))),home=path.join(root,'home');
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained goal input terminal '+root);});
    const c=await openController({installationHome:home}),draft='A separate draft 한국어';
    const text='Original request · '+ 'Retained '.repeat(14)+'END OF ORIGINAL';
    let cid,input,goal;
    try {
        cid=c.createConversation().conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        const created=c.createGoal({conversationId:cid,objective:'Preserve original goal',criteria:['Keep the explicit record'],turnLimit:4});
        goal=await c.pauseGoal({goalId:created.goalId,expectedRevision:created.revision,reason:'Owner pauses before resuming'});
        input=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text,mode:'idle'});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    } finally {await c.close();}
    const label=key=>uiText(locale,key),file=path.join(root,'terminal.json'),ready=locale==='ko'?'/ready 설정':'/ready setup';
    const unchanged=[
        {sql:'SELECT state,revision FROM goals WHERE id=?',params:[goal.goalId],rows:[['PAUSED',goal.revision]]},
        {sql:'SELECT state,text FROM conversation_inputs WHERE id=?',params:[input.inputId],rows:[['QUEUED',text]]},
        ...['goal_attempts','runs','works'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]})),
    ];
    const open=[
        {wait:ready,assertDraft:draft,queries:unchanged,send:'\x07/'},
        {wait:locale==='ko'?'gitjig 명령 검색':'Gitjig commands · search',send:'/goal\r'},
        {wait:label('goal.resume'),send:label('goal.resume')+'\r'},
    ];
    const menu=(key)=>({wait:label('goal.resume'),assertDraft:draft,queries:unchanged,send:label(key)+'\r'});
    const steps=[...open,
        {wait:'END OF ORIGINAL',queries:unchanged,send:'\x1b'},
        menu('goal.resume'),
        {wait:label('review.openConfirmation'),queries:unchanged,send:'\r'},
        {wait:label('goal.inputConfirmTitle'),queries:unchanged,send:'\r'},
        menu('goal.extend'),
        {wait:label('goal.additionalTurnsInput'),send:'2\r'},
        {wait:label('goal.extensionReason'),queries:unchanged,send:'\x1b'},
        menu('goal.revise'),
        {wait:label('goal.objectiveInput'),queries:unchanged,send:'\x1b'},
        menu('goal.cancel'),
        {wait:label('goal.cancelScope'),queries:unchanged,send:'\r'},
        menu('goal.close'),
        {wait:ready,assertDraft:draft,queries:unchanged,send:'\x07q'},
    ];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.join(packageRoot,'dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],
        env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',steps,timeoutSeconds:9,expectedInputs:1,gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    passed=true;
});

for (const locale of ['en','ko']) test('ambiguous goal input opens the original requests and returns to the goal in '+locale,{timeout:13000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-goal-input-path-'))),home=path.join(root,'home');
    let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained goal input terminal '+root);});
    const c=await openController({installationHome:home}),draft='Keep this separate draft · 한글';
    const original=['First exact retained request','Second exact retained request'],inputs=[];
    let cid,goal;
    try {
        cid=c.createConversation().conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        const created=c.createGoal({conversationId:cid,objective:'Review the held goal input',criteria:['Observe the exact original request'],turnLimit:4});
        goal=await c.pauseGoal({goalId:created.goalId,expectedRevision:created.revision,reason:'Owner paused before continuing'});
        for(const text of original)
            inputs.push(await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text,mode:'idle'}));
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    } finally {await c.close();}
    const queries=[
        {sql:'SELECT state,revision FROM goals WHERE id=?',params:[goal.goalId],rows:[['PAUSED',goal.revision]]},
        ...inputs.map(({inputId},index)=>({sql:'SELECT state,text FROM conversation_inputs WHERE id=?',params:[inputId],rows:[['QUEUED',original[index]]]})),
        ...['goal_attempts','runs','works'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]})),
    ];
    const label=key=>uiText(locale,key),step=(wait,send)=>({wait,send,queries,assertDraft:draft});
    const steps=[step(draft,'\x07/'),step(label('command.discovery.title'),'/goal\r'),
        step(label('goal.inspectInputs'),label('goal.inspectInputs')+'\r'),
        step(label('input.recoveryList'),original[1]+'\r'),
        step(label('input.recoveryReview'),'\x1b'),
        step(label('input.recoveryList'),'\x1b'),
        step(label('goal.inspectInputs'),label('goal.close')+'\r'),
        step(draft,'\x07q')];
    const file=path.join(root,'terminal.json');
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.join(packageRoot,'dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],
        env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',steps,timeoutSeconds:9,expectedInputs:2,gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    passed=true;
});

for (const locale of ['en','ko']) test('project goal runtime setup returns to explicit Start in '+locale,{timeout:17000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-goal-runtime-'))),home=path.join(root,'home'),project=path.join(root,'project');
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained goal runtime terminal '+root);});
    await fs.mkdir(project);
    const c=await openController({installationHome:home}),draft='Separate draft 한국어',objective='Tracked project goal 한국어';
    let cid,goal;
    try {
        await c.registerProject({id:'P',sourceRoot:project});cid=c.createConversation({projectId:'P'}).conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        goal=c.createGoal({conversationId:cid,objective,criteria:['Track the original project result'],turnLimit:4});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    } finally {await c.close();}
    const label=key=>uiText(locale,key),file=path.join(root,'terminal.json');
    const noAdmission=['works','runs','conversation_inputs','goal_attempts'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    noAdmission.push({sql:"SELECT state,revision,json_extract(data,'$.objective') FROM goals WHERE id=?",params:[goal.goalId],rows:[['READY',goal.revision,objective]]});
    const ready=locale==='ko'?'/ready 설정':'/ready setup';
    const steps=[
        {wait:ready,assertDraft:draft,send:'\x07/'},
        {wait:locale==='ko'?'gitjig 명령 검색':'Gitjig commands · search',send:'/goal\r'},
        {wait:label('goal.runtimeRequired'),queries:noAdmission,send:label('requestSetup.openRuntime')+'\r'},
        {wait:label('runtime.title'),send:label('runtime.cancel')+'\r'},
        {wait:label('goal.runtimeRequired'),queries:noAdmission,send:label('requestSetup.openRuntime')+'\r'},
        {wait:label('runtime.title'),send:label('runtime.edit')+'\r'},
        {wait:label('runtime.dockerField'),send:'/usr/bin/false\r'},
        {wait:label('runtime.contextField'),send:'REPAIRED\r'},
        {wait:label('runtime.imageField'),send:'sha256:'+'0'.repeat(64)+'\r'},
        {wait:label('runtime.configField'),send:'\r'},
        {wait:label('runtime.title'),send:label('runtime.review')+'\r'},
        {wait:label('common.openSettingsConfirmation'),queries:noAdmission,send:'\r'},
        {wait:label('runtime.saveTitle'),send:label('runtime.save')+'\r'},
        {wait:label('goal.start'),assertDraft:draft,queries:noAdmission,send:label('goal.close')+'\r'},
        {wait:ready,assertDraft:draft,send:'\x07q'},
    ];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.join(packageRoot,'dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],
        env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',steps,timeoutSeconds:10,expectedInputs:0,gracefulShutdownSeconds:3}));
    const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    const saved=JSON.parse(await fs.readFile(path.join(home,'config/startup.json'),'utf8'));
    assert.equal(saved.runtime.dockerContext,'REPAIRED');
    passed=true;
});

for (const mode of ['correction','custom','default','korean']) test('original numeric goal entry uses '+mode+' without appending a default', {timeout: 12000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-goal-allowance-ui-')));
    const home = path.join(root, 'application'), file = path.join(root, 'terminal.json');
    let passed = false;
    t.after(async () => {if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained goal allowance terminal ' + root);});
    const controller = await openController({installationHome: home});
    const locale=mode==='korean'?'ko':'en', korean=locale==='ko';
    const objective=korean?'현재 동선을 확인하고 README도 보존하기':'Retain this exact owner objective';
    const criteria=korean?['첫 화면에서 상태를 읽을 수 있음','README의 원래 내용이 유지됨']:['Observe the unchanged acceptance outcome'];
    let cid;
    try {
        cid = controller.createConversation().conversationId;
        controller.setConversationLanguage({conversationId: cid, expectedGeneration: 0, expectedRevision: controller.getConversationLanguage(cid).revision, replyLanguage: locale});
    } finally {await controller.close();}
    const empty = [{sql: 'SELECT COUNT(*) FROM works', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM runs', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM conversation_inputs', rows: [[0]]}];
    const steps = [
        {wait: '/ready', send: '/goal create\x1b\r'},
        {wait: korean?'목표 · 이루려는 결과':'Goal objective', send: objective+'\r'},
        ...criteria.flatMap((value,index)=>[
            {wait:korean?`완료 기준 ${index+1} · 확인할 수 있는 결과`:'Completion criterion 1',send:value+'\r'},
            {wait:korean?'목표 완료 기준':'Goal completion criteria',send:(korean?index===0?'완료 기준 추가':'이 기준 사용':'Use these criteria')+'\r'},
        ]),
        ...(mode === 'correction'||korean ? [
            {wait: korean?'목표 실행 횟수':'Goal turn allowance', send: '1.5\r'},
            {wait: korean?'정수를 입력하세요':'Enter a whole number', queries: [...empty,{sql:'SELECT COUNT(*) FROM goals',rows:[[0]]}], send: '\x01\x0b6\r'},
        ] : [{wait: 'Goal turn allowance', send: mode === 'custom' ? '12\r' : '\r'}]),
        {wait: korean?'목표가 저장됨':'Goal saved', queries: [...empty,
            {sql: "SELECT state, json_extract(data,'$.objective'),json_extract(data,'$.criteria'),json_extract(data,'$.turnLimit'),json_extract(data,'$.startedAttempts') FROM goals", rows: [['READY',objective,JSON.stringify(criteria),mode === 'custom' ? 12 : mode === 'default' ? 8 : 6,0]]}], send: '\x07q'},
    ];
    await fs.writeFile(file, JSON.stringify({command: [process.env.GITJIG_TEST_NODE ?? process.execPath, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'), process.env.GITJIG_TEST_CLI_ENTRY ?? path.join(packageRoot,'dist/cli/entry.js'), 'conversation','ui','--home',home,'--conversation',cid], cwd: root,
        env: {PATH:'/usr/bin:/bin',HOME:root,USER:'fixture',LOGNAME:'fixture',LANG:'en_US.UTF-8',TERM:'xterm-256color',TMPDIR:path.join(home,'artifacts')}, steps, timeoutSeconds:8, gracefulShutdownSeconds:3, database:path.join(home,'state/controller.sqlite'), output:file+'.terminal'}),{mode:0o600});
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    passed = true;
});
