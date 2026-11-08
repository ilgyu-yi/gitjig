import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { ApplicationStartup } from '../../dist/app/startup.js';
import { ApplicationKeybindings } from '../../dist/app/keybindings.js';
import { uiText } from '../../dist/ui/i18n.js';
import { scripted } from '../controller/effect-fixture.mjs';
const execute = promisify(execFile);
for(const locale of ['en','ko'])test('retained input preserves the exact review after cancelling or applying runtime setup in '+locale,{timeout:20000},async t=>{
    const root=await temporaryDirectory('retained-draft-hint'),home=path.join(root,'home'),file=path.join(root,'driver.json');
    const output=file+'.terminal',observation=file+'.frame',original='Original retained request',draft='This new request stays unsent 한국어';
    let passed=false,cid;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained draft handoff terminal '+root);});
    const c=await openController({installationHome:home});
    try {
        const project=path.join(root,'project');
        await fs.mkdir(project,{mode:0o700});
        await fs.writeFile(path.join(project,'reference.txt'),'Owned project file for completion\n');
        await c.registerProject({id:'P',sourceRoot:project});
        cid=c.createConversation({projectId:'P'}).conversationId;
        c.setConversationView({selectedId:cid});
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:original,mode:'idle'});
        const row=c.store.one('SELECT data FROM conversation_inputs WHERE id=?',inputId);
        c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),routeError:'Controlled original delivery refusal'}),inputId);
        const keys = new ApplicationKeybindings(c).file;
        await fs.mkdir(path.dirname(keys),{recursive:true,mode:0o700});
        await fs.writeFile(keys,JSON.stringify({'tui.input.submit':'ctrl+t'}),{mode:0o600});
    } finally {await c.close();}
    const hint=uiText(locale,'input.reviewBeforeSend',{submit:'ctrl+t'});
    const keep=uiText(locale,'activity.retained'),review=uiText(locale,'input.recoveryBlockedDraft');
    const setupBlockers=['blocker.model','blocker.runtime'].map(key=>uiText(locale,key).split(' · ')[0]);
    const withdrawn=locale==='ko'?'이전 요청을 철회했습니다':'Earlier request withdrawn';
    const absent=[hint];
    const fileDraft='Read @';
    const closeSuggestions=locale==='ko'?'Esc 자동완성 닫기':'Esc closes suggestions';
    const ready=uiText(locale,'footer.setup');
    const runtime = key => uiText(locale,'runtime.'+key);
    const inputCommand = '/inputs';
    const typed = (editorFocused, draft, contains, send) => ({editorFocused,draft,contains,send,unchanged:true});
    const steps=[
        {editorFocused:true,draft:'',contains:[keep],absent:[...absent,...setupBlockers,uiText(locale,'pane.firstRun')],baseline:true,send:'/help'},
        {editorFocused:true,draft:'/help',contains:[keep],absent,unchanged:true,send:'\x15'+fileDraft},
        {editorFocused:true,draft:fileDraft,autocomplete:true,contains:[keep,ready,closeSuggestions,'reference.txt'],absent,unchanged:true,send:'\x1b'},
        {editorFocused:true,draft:fileDraft,autocomplete:false,contains:[keep,ready,hint],absent:[closeSuggestions],unchanged:true,send:'\x1b[102;6u'},
        {editorFocused:false,draft:fileDraft,contains:['Find in transcript'],absent,unchanged:true,send:'\x1b'},
        {editorFocused:true,draft:fileDraft,autocomplete:false,contains:[keep,ready,hint],unchanged:true,send:'\x15'+draft},
        {editorFocused:true,draft,contains:[hint],unchanged:true,send:'\x14'},
        {editorFocused:false,draft,contains:[review,original],absent,unchanged:true,send:'\x1b'},
        {editorFocused:true,draft,contains:[hint],unchanged:true,send:'\x14'},
        {editorFocused:false,draft,contains:[review,original],unchanged:true,send:'\r'},
        {editorFocused:false,draft,contains:[uiText(locale,'input.recoveryOpenActions'),'Controlled original delivery refusal'],unchanged:true,send:'\r'},
        {editorFocused:false,draft,contains:[uiText(locale,'input.recoveryRuntimeRequired')],unchanged:true,send:'\r'},
        {editorFocused:false,draft,contains:[uiText(locale,'input.recoveryOpenActions'),original],unchanged:true,send:'\r'},
        {editorFocused:false,draft,contains:[uiText(locale,'input.recoveryRuntimeRequired')],unchanged:true,send:'\x1b'},
        {editorFocused:false,draft,contains:[uiText(locale,'input.recoveryOpenActions'),original],unchanged:true,send:'\r'},
        {editorFocused:false,draft,contains:[uiText(locale,'input.recoveryRuntimeRequired')],unchanged:true,send:uiText(locale,'requestSetup.openRuntime')+'\r'},
        {editorFocused:false,draft,contains:[uiText(locale,'runtime.title')],unchanged:true,send:'\x1b'},
        {editorFocused:false,draft,contains:[uiText(locale,'input.recoveryOpenActions'),'Controlled original delivery refusal'],unchanged:true,send:'\x1b'},
        typed(false,draft,[review,original],'\x1b'),
        typed(true,draft,[hint],'\x15'+inputCommand+'\x14'),
        typed(false,inputCommand,[uiText(locale,'input.recoveryList'),original],'\r'),
        typed(false,inputCommand,[uiText(locale,'input.recoveryOpenActions'),original],'\r'),
        typed(false,inputCommand,[uiText(locale,'input.recoveryRuntimeRequired')],uiText(locale,'requestSetup.openRuntime')+'\r'),
        typed(false,inputCommand,[runtime('title')],runtime('edit')+'\r'),
        typed(false,inputCommand,[runtime('dockerField')],'/usr/bin/false\r'),
        typed(false,inputCommand,[runtime('contextField')],'RETAINED_INPUT_RUNTIME\r'),
        typed(false,inputCommand,[runtime('imageField')],'sha256:'+'e'.repeat(64)+'\r'),
        typed(false,inputCommand,[runtime('configField')],'\r'),
        typed(false,inputCommand,[runtime('title'),'RETAINED_INPUT_RUNTIME'],runtime('review')+'\r'),
        typed(false,inputCommand,[uiText(locale,'common.openSettingsConfirmation')],'\r'),
        typed(false,inputCommand,[runtime('saveTitle')],runtime('save')+'\r'),
        typed(false,inputCommand,[uiText(locale,'input.recoveryOpenActions'),original],'\x1b'),
        typed(false,inputCommand,[uiText(locale,'input.recoveryList'),original],'\x1b'),
        typed(true,'',[runtime('saved'),keep],draft+'\x14'),
        typed(false,draft,[review,original],'\r'),
        typed(false,draft,[uiText(locale,'input.recoveryOpenActions'),original],'\r'),
        typed(false,draft,[uiText(locale,'input.recoveryModelRequired'),uiText(locale,'input.recoveryChooseModel')],uiText(locale,'input.recoveryWithdraw')+'\r'),
        {editorFocused:true,draft,contains:[withdrawn,setupBlockers[0]],absent:[hint,keep],send:'\x07q'},
    ];
    const entry=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js');
    const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
    await fs.writeFile(file,JSON.stringify({cid,observation,output,steps,columns:90,timeoutSeconds:12,
        command:[process.execPath,...moduleGuard,'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),entry,'conversation','ui','--home',home,'--conversation',cid],
        env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation}}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:18000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    const {snapshots}=JSON.parse(await fs.readFile(output+'.frames.json','utf8'));
    for (const {editorFocused, frame} of snapshots.slice(0,-1)) {
        if (!editorFocused) continue;
        assert.ok(frame[0].includes(keep),frame[0]);
        assert.ok(frame.slice(1).some(line=>line.includes(keep)));
    }
    const reopened=await openController({installationHome:home});
    try {
        assert.equal(reopened.inspectConversation(cid).draft.text,draft);
        assert.deepEqual(reopened.store.all('SELECT state,text FROM conversation_inputs').map(row=>({...row})),[{state:'CONFLICTED',text:original}]);
        assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
    } finally {await reopened.close();}
    passed=true;
});
for (const locale of ['en','ko']) test(`retained request can choose its first model without sending or losing the draft in ${locale}`, {timeout:20000}, async t => {
    const root=await temporaryDirectory('retained-first-model'),home=path.join(root,'home');
    const original='Earlier queued request',draft='A separate draft 한국어',model='retained-fixture/example';
    const file=path.join(root,'driver.json'),observation=path.join(root,'current'),output=path.join(root,'terminal');
    const c=await openController({installationHome:home});
    const viaReady=locale==='ko';
    let cid,inputId,passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained first-model terminal '+root);});
    try {
        await ApplicationAccounts.open(c).configure({providers:{'retained-fixture':{api:'openai-completions',
            apiKey:'DUMMY_RETAINED_FIXTURE',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'example'}]}}});
        cid=c.createConversation().conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        ({inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:original,mode:'idle'}));
        if(viaReady)c.store.run("UPDATE conversation_inputs SET data=json_set(data,'$.routeError','INPUT_DELIVERY_CHECK_STOPPED') WHERE id=?",inputId);
    } finally {await c.close();}
    const copy=key=>uiText(locale,key);
    const step=(editorFocused,contains,send,extra={})=>({editorFocused,draft,contains,send,unchanged:true,...extra});
    const chooseModel=copy('input.recoveryChooseModel')+'\r';
    const steps=[
        step(true,[copy('activity.retained')],viaReady?'\x07t':'\r',{baseline:true,unchanged:false}),
        step(false,viaReady?[copy('ready.failedRequestNext')]:[copy('input.recoveryBlockedDraft'),original],'\r'),
        step(false,[copy('input.recoveryModelNext'),copy('input.recoveryOpenActions')],'\r'),
        step(false,[copy('input.recoveryModelRequired')],chooseModel,{absent:[copy('input.recoveryRetry')]}),
        step(false,[copy('model.title'),model],'\x1b'),
        step(false,[copy('input.recoveryModelNext'),original],'\r'),
        step(false,[copy('input.recoveryModelRequired')],chooseModel),
        step(false,[copy('model.title'),model],model+'\r'),
        step(false,[original,copy('input.recoveryOpenActions')],'\r',{absent:[copy('input.recoveryModelNext')]}),
        step(false,[copy('input.recoveryChoose'),copy('input.recoveryRetry')],'\x1b'),
        step(false,[original,copy('input.recoveryOpenActions')],'\x1b',{absent:[copy('input.recoveryModelNext')]}),
        ...viaReady?[]:[step(false,[copy('input.recoveryBlockedDraft'),original],'\x1b')],
        step(true,[copy('activity.retained')],'\x07q'),
    ];
    const entry=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js');
    const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
    await fs.writeFile(file,JSON.stringify({cid,observation,output,steps,columns:100,timeoutSeconds:12,
        command:[process.execPath,...moduleGuard,'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),entry,'conversation','ui','--home',home,'--conversation',cid],
        env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',
            NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation}}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:18000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    const reopened=await openController({installationHome:home});
    try {
        const choice=reopened.getConversationModelChoice(cid);
        assert.deepEqual([choice.kind,choice.provider,choice.modelId,choice.revision],['managed','retained-fixture','example',1]);
        assert.equal(reopened.inspectConversation(cid).draft.text,draft);
        const [retained]=reopened.inspectConversationInputs(cid);
        assert.deepEqual([retained.state,retained.inputId,retained.text],['QUEUED',inputId,original]);
        assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM runs').n,0);
    } finally {await reopened.close();}
    passed=true;
});

test('Korean original terminal opens the exact work for an unreconciled request and returns to the preserved draft', {timeout:20000}, async t=>{
    const root=await temporaryDirectory('input-work-inspection'),home=path.join(root,'home');
    const original='Original request whose delivery is uncertain',draft='새로 작성한 요청 초안';
    const work=randomUUID(),run=randomUUID();
    let passed=false,cid;
    t.after(async()=>{
        if(passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained input work inspection terminal '+root);
    });
    const controller=await openController({installationHome:home});
    try{
        cid=controller.createConversation().conversationId;
        const {inputId}=await controller.queueConversationInput({conversationId:cid,expectedGeneration:0,mode:'idle',text:original});
        const queued=await controller.queueConversationInput({conversationId:cid,expectedGeneration:0,mode:'follow-up',text:'Separate queued request'});
        const {store}=controller,source=store.one('SELECT source FROM conversation_inputs WHERE id=?',inputId).source;
        const queuedRow=store.one('SELECT data FROM conversation_inputs WHERE id=?',queued.inputId);
        store.run('UPDATE conversation_inputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(queuedRow.data),
            routeError:'Separate queued request routing problem'}),queued.inputId);
        // Persist the recorded process-loss boundary. The terminal must only read it.
        store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',work,null,source,null,work,'UNKNOWN',1,1,null,
            JSON.stringify({kind:'ordinary-conversation',conversation:cid}));
        store.run('INSERT INTO budgets VALUES(?,?,?,?,?)',work,'execution',3,1,0);
        store.run('INSERT INTO budgets VALUES(?,?,?,?,?)',work,'resolution',2,0,0);
        store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,work,1,1,'INTERRUPTED',path.join(home,'inputs',run),'consumed',
            JSON.stringify({kind:'ordinary-conversation',conversation:cid,initialInputId:inputId,nativeInputObserved:true,modelDispatchAttempted:true,cleanup:'removed'}));
        store.run('UPDATE conversations SET generation=1 WHERE id=?',cid);
        store.run("UPDATE conversation_state SET resource='UNKNOWN',work=?,data=? WHERE conversation=?",work,JSON.stringify({runId:run}),cid);
        store.run("UPDATE conversation_inputs SET state='RECONCILIATION_REQUIRED',work=?,generation=1 WHERE id=?",work,inputId);
        controller.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        assert.equal(controller.inspectConversationInputs(cid)[0].interruptedBoundary,'modelAttempt');
    }finally{await controller.close();}
    const observation=path.join(root,'current'),output=path.join(root,'terminal'),file=path.join(root,'terminal.json');
    const workTitle='작업 복구 · #'+work;
    const step=(editorFocused,contains,send,extra={})=>({editorFocused,draft,contains,send,unchanged:true,...extra});
    const steps=[
        step(true,['요청 전달 여부를 확인할 수 없음 · 1개','/inputs'],'\x07/',{
            unchanged:false,baseline:true,absent:['입력 전달 확인 필요','Separate queued request routing problem'],
        }),
        step(false,['gitjig 명령 검색'],'/inputs\r'),
        step(false,['보관된 요청 확인',original],'Separate queued request\r'),
        step(false,['Separate queued request routing problem'],'\x1b'),
        step(false,['보관된 요청 확인',original],'\r'),
        step(false,['Separate queued request routing problem'],'\x1b'),
        step(false,['보관된 요청 확인',original],original+'\r'),
        step(false,['전달 상태 확인 필요','기존 작업 확인',original],'\r',{
            absent:['복구 동작 열기','원래 요청 다시 시도','원래 요청 이어서 실행','원래 요청 철회'],
        }),
        step(false,[workTitle,'보존된 작업과 한도 보기'],'보존된 작업과 한도 보기\r'),
        step(false,['원래 작업 · 조회만 수행',work,original],'\x1b'),
        step(false,[workTitle],'\x1b'),
        step(false,['전달 상태 확인 필요','기존 작업 확인',original],'\x1b'),
        step(false,['보관된 요청 확인',original],'\x1b'),
        step(true,[],'\x07'),
        step(false,['명령 · Ctrl+G'],'q'),
    ];
    await fs.writeFile(file,JSON.stringify({cid,observation,output,steps,timeoutSeconds:12,
        command:[process.execPath,
            ...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
            '--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
            process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],
        env:{...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,LANG:'ko_KR.UTF-8',LC_ALL:'ko_KR.UTF-8',TERM:'xterm-256color',
            NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},
    }));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    const retained=await openController({installationHome:home});
    try{
        assert.equal(retained.inspectConversation(cid).draft.text,draft);
        const [request,queued]=retained.inspectConversationInputs(cid);
        assert.equal(request.state,'RECONCILIATION_REQUIRED');
        assert.equal(request.workId,work);
        assert.equal(request.runId,run);
        assert.equal(queued.state,'QUEUED');
        assert.equal(queued.queuedDeliveryIssue,'Separate queued request routing problem');
        assert.equal(retained.inspectWorkAllowance(work).execution.consumed,1);
        assert.equal(retained.store.one('SELECT COUNT(*) AS n FROM runs').n,1);
    }finally{await retained.close();}
    passed=true;
});

for(const locale of ['en','ko'])test('retained request returns from exact blocking work to the same recovery actions in '+locale,{timeout:16000},async t=>{
    const root=await temporaryDirectory('retained-blocking-work'),home=path.join(root,'home'),project=path.join(root,'project');
    const draft='Owner draft stays separate 한국어',request='Retained request we are inspecting',file=path.join(root,'terminal.json');
    const observation=file+'.current',output=file+'.terminal';
    await fs.mkdir(project,{mode:0o700});
    await fs.writeFile(path.join(project,'file.txt'),'Original project source');
    let passed=false,cid,workId,inputId;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained blocking work terminal '+root);});
    const c=await openController({installationHome:home});
    try{
        await c.registerProject({id:'P',sourceRoot:project});
        cid=c.createConversation({projectId:'P'}).conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        ({inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:request,mode:'idle'}));
        ({workId}=await c.beginChange({projectId:'P',request:'Original managed blocker'}));
        // Bind a real retained change to the same fixture conversation without executing it.
        c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?",cid,workId);
        const [pending]=c.inspectConversationInputs(cid);
        assert.equal(pending.inputId,inputId);assert.equal(pending.eligible,false);
        assert.deepEqual(pending.blockingWorkIds,[workId]);
    }finally{await c.close();}
    const held=uiText(locale,'input.recoveryHeldMenu'),action=uiText(locale,'input.recoveryInspectWork',{id:workId});
    const detail=uiText(locale,'input.recoveryOpenActions'),list=uiText(locale,'input.recoveryList');
    const work=uiText(locale,'workRecovery.title',{id:workId,state:'ACTIVE'});
    const step=(contains,send,extra={})=>({editorFocused:false,draft,unchanged:true,contains,send,...extra});
    const steps=[
        {editorFocused:true,draft,baseline:true,send:'\x07/'},
        step([uiText(locale,'command.discovery.title')],'/inputs\r'),
        step([list,request],'\r'),
        step([detail,request],'\r'),
        step([held,action],action+'\r'),
        step([work,uiText(locale,'workRecovery.backToSource')],'\r'),
        step([held,action],action+'\r'),
        step([work],'\x1b'),
        step([held,action],'\x1b'),
        step([detail,request],'\x1b'),
        step([list,request],'\x1b'),
        step([],'\x07q',{editorFocused:true}),
    ];
    const command=[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
        '--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid];
    const language=locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8';
    await fs.writeFile(file,JSON.stringify({cid,command,observation,output,steps,timeoutSeconds:8,
        env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:language,LC_ALL:language,GITJIG_RESULT_OBSERVATION:observation}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:14500,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
    const reopened=await openController({installationHome:home});
    try{
        const [pending]=reopened.inspectConversationInputs(cid);
        assert.equal(pending.inputId,inputId);assert.deepEqual(pending.blockingWorkIds,[workId]);
        assert.equal(reopened.inspectConversation(cid).draft.text,draft);
    }finally{await reopened.close();}
    passed=true;
});

for (const verified of [true, false]) test(`original terminal offers exact Docker context repair only with verified startup evidence · ${verified}`, {timeout:35000}, async t => {
    const root=await temporaryDirectory('input-runtime-repair'), home=path.join(root,'home');
    const config=path.join(root,'docker-config'), savedConfig=path.join(root,'saved-docker-config'), project=path.join(root,'project');
    const client=path.join(root,'docker-fixture'), calls=path.join(root,'docker-calls');
    const file=path.join(root,'terminal.json'), output=path.join(root,'terminal');
    const draft='Separate unsent runtime-repair draft', request='Original request blocked by Docker';
    let passed=false;
    t.after(async()=>{if(passed) await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Runtime request repair PTY '+root);});
    await fs.mkdir(config,{mode:0o700});
    if (verified) await fs.mkdir(savedConfig,{mode:0o700});
    await fs.mkdir(project,{mode:0o700});
    await fs.writeFile(path.join(project,'readme.txt'),'Owned project for the runtime refusal\n');
    await fs.writeFile(client,'#!'+process.execPath+'\n'+`
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args.slice(0,5))+'\\n');
if(args[2]!=='--context'||args[3]!=='missing')process.exit(88);
if(args[4]==='info')process.exit(1);
if(args[4]!=='create')process.exit(89);
const id=createHash('sha256').update(args[3]).digest('hex');
const metadata=path.join(args[1],'contexts','meta',id,'meta.json');
console.error('Failed to initialize: unable to resolve docker endpoint: context "missing": context not found: open '+metadata+': no such file or directory');
process.exit(1);
`,{mode:0o700});
    const c=await openController({installationHome:home});
    try{
        const accounts=ApplicationAccounts.open(c);
        await accounts.configure({providers:{'input-fixture':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
        await accounts.setDefault('input-fixture','fixture');
        await c.registerProject({id:'P',sourceRoot:project});
        const conversation=await new ApplicationModels(c).newConversation({projectId:'P'});
        c.setConversationView({selectedId:conversation.conversationId});
        await ApplicationStartup.open(c).save({version:1,runtime:{dockerBinary:client,dockerConfigDirectory:verified?savedConfig:config,
            dockerContext:verified?'saved-route':'missing',image:'sha256:'+(verified?'b':'a').repeat(64)}});
    }finally{await c.close();}

    const entry=process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js';
    const controllerModule=new URL('../controller/controller.js',pathToFileURL(await fs.realpath(entry))).href;
    const guard=path.join(root,'guard.mjs');
    await fs.writeFile(guard,`
import ${JSON.stringify(new URL('../cli/account-ui-no-network.mjs',import.meta.url).href)};
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
${verified ? '' : `import {Controller} from ${JSON.stringify(controllerModule)};
Controller.prototype.inspectConversationStartupFailure = () => null;`}
let denied=0;
const spawn=cp.spawn;
const refuse=()=>{denied++;throw Error('Only the exact owned Docker fixture may run');};
cp.spawn=(file,...args)=>file===${JSON.stringify(client)}?spawn(file,...args):refuse();
for(const method of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[method]=refuse;
syncBuiltinESMExports();
process.on('exit',()=>{if(denied) process.exitCode=1;});
`,{mode:0o600});
    const original=[
        {sql:'SELECT state,text FROM conversation_inputs',rows:[['INITIAL_RESERVED',request]]},
        {sql:'SELECT phase,json_extract(data,\'$.cleanup\'),json_extract(data,\'$.modelDispatchAttempted\') FROM runs',rows:[['SETTLED','removed',null]]},
    ];
    const steps=[
        {wait:'Docker context missing was not found',assertDraft:draft,queries:original,send:'\x07e'},
        {wait:'Error recovery · choose a next step',assertDraft:draft,queries:original,send:'Correct the Docker context\r'},
        {wait:uiText('en','runtime.currentDraft'),assertDraft:draft,send:'\r'},
        {wait:'Explicit Docker discovery',assertDraft:draft,queries:original,send:'\x1b'},
        {wait:'Runtime setup · staged',assertDraft:draft,send:'Cancel\r'},
        {wait:'Error recovery · choose a next step',assertDraft:draft,queries:original,send:'\x1b'},
        {wait:'INPUT',assertDraft:draft,queries:original,send:'\r'},
        {wait:uiText('en','input.recoveryBlockedDraft'),assertDraft:draft,queries:original,send:'\r'},
        {wait:'Open recovery actions',assertDraft:draft,queries:original,send:'\r'},
        {wait:'Correct the Docker context',assertDraft:draft,queries:original,send:'Correct the Docker context\r'},
        {wait:uiText('en','runtime.currentDraft'),assertDraft:draft,send:'Edit runtime fields\r'},
        {wait:'Docker executable',send:'\r'},
        {wait:'Docker context',send:'\x15corrected\r'},
        {wait:'Runtime image',send:'\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
        {wait:'Review runtime setup before applying',send:'\r'},
        {wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},
        {wait:request,assertDraft:draft,queries:original,send:'\r'},
        {wait:'This exact request · choose explicitly',assertDraft:draft,queries:original,send:'Back without changes\r'},
        {wait:'Open recovery actions',assertDraft:draft,queries:original,send:'\x1b'},
        {wait:uiText('en','input.recoveryBlockedDraft'),assertDraft:draft,queries:original,send:'\x1b'},
        {wait:'INPUT',assertDraft:draft,queries:original,send:'\x07e'},
        {wait:'Error recovery · choose a next step',assertDraft:draft,queries:original,send:'Review original request\r'},
        {wait:'Open recovery actions',assertDraft:draft,queries:original,send:'\r'},
        {wait:'This exact request · choose explicitly',assertDraft:draft,queries:original,send:'Withdraw original request\r'},
        {wait:uiText('en','input.recoveryWithdrawn'),assertDraft:draft,queries:[
            {sql:'SELECT state,text FROM conversation_inputs',rows:[['CONFLICTED',request]]},
            original[1],
        ],send:'\x07e'},
        {wait:'Previous error · choose a next step',assertDraft:draft,send:'Error details\r'},
        {wait:'Previous error details · inspection only',assertDraft:draft,send:'\x1b'},
        {wait:'Previous error · choose a next step',assertDraft:draft,send:'\x1b'},
        {wait:'INPUT',assertDraft:draft,send:'\x07'},
        {wait:'Commands · Ctrl+G',send:'q'},
    ];
    const session={
        command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
            '--import',guard,entry,...verified?['conversation','ui','--docker-binary',client,'--docker-config-directory',config,
                '--docker-context','missing','--image','sha256:'+'a'.repeat(64)]:[]],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,timeoutSeconds:12,database:path.join(home,'state/controller.sqlite'),output,expectedInputs:1,gracefulShutdownSeconds:3,
    };
    const reason = verified ? 'Docker context missing was not found' : 'Docker context "missing" was not found';
    const start=[
        {wait:'/ready setup',send:request+'\x1b\r'},
        {wait:verified ? reason : 'Docker context',waitIdle:true,send:draft},
        {wait:draft,assertDraft:draft,queries:original,send:'\x07e'},
        {wait:'Error recovery · choose a next step',assertDraft:draft,queries:original,send:'\x1b'},
        {wait:'INPUT',assertDraft:draft,queries:original,send:'\x07q'},
    ];
    const run=async (setup, terminal)=>{
        await fs.writeFile(file,JSON.stringify({...session,steps:setup,output:terminal}));
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:18000,maxBuffer:2**20})).stdout);
        assert.equal(result.exitCode,0);assert.equal(result.stages,setup.length);assert.equal(result.terminalRestored,true);
    };
    try{
        await run(start,output+'-first');
        if (!verified) {
            const first = await fs.readFile(output+'-first', 'utf8');
            assert.ok(!first.includes('Correct the Docker context'));
            assert.ok(first.includes(reason));
            await run([
                {wait:reason,assertDraft:draft,queries:original,send:'\x07e'},
                {wait:'Review original request',assertDraft:draft,queries:original,send:'\x1b'},
                {wait:'INPUT',assertDraft:draft,queries:original,send:'\r'},
                {wait:uiText('en','input.recoveryBlockedDraft'),assertDraft:draft,queries:original,send:'\r'},
                {wait:'Open recovery actions',assertDraft:draft,queries:original,send:'\r'},
                {wait:'Retry original request',assertDraft:draft,queries:original,send:'\x1b'},
                {wait:'Open recovery actions',assertDraft:draft,queries:original,send:'\x1b'},
                {wait:uiText('en','input.recoveryBlockedDraft'),assertDraft:draft,queries:original,send:'\x1b'},
                {wait:'INPUT',assertDraft:draft,queries:original,send:'\x07q'},
            ],output);
            for (const terminal of [output+'-first', output]) {
                const text = await fs.readFile(terminal, 'utf8');
                assert.ok(text.includes('Review original request'));
                assert.ok(!text.includes('Correct the Docker context'));
            }
            assert.deepEqual((await fs.readFile(calls,'utf8')).trim().split('\n').map(row=>JSON.parse(row)[4]),['info','create']);
            passed=true;
            return;
        }
        await run(steps,output);
        const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
        const terminal=await fs.readFile(output);
        const reviewStep=steps.findIndex(step=>step.wait===request);
        const review=terminal.subarray(progress.actionOutputOffsets[reviewStep-1],progress.actionOutputOffsets[reviewStep]).toString('utf8');
        assert.ok(review.includes('Original request · review before action') && review.includes('Open recovery actions'),
            'The original request must be visible in its exact review before recovery actions');
        const previousStep=steps.findIndex(step=>step.wait==='Previous error · choose a next step');
        const previous=terminal.subarray(progress.actionOutputOffsets[previousStep-1],progress.actionOutputOffsets[previousStep]).toString('utf8');
        assert.match(previous,/Docker context missing was not found/);
        assert.doesNotMatch(previous,/Correct the Docker context/);
        const choices = terminal.subarray(progress.actionOutputOffsets[0], progress.actionOutputOffsets[1]).toString('utf8');
        assert.ok(choices.indexOf('Correct the Docker context') >= 0);
        assert.ok(choices.indexOf('Correct the Docker context') < choices.indexOf('Review original request'));
    }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-5000));throw error;}
    const saved=JSON.parse(await fs.readFile(path.join(home,'config/startup.json'),'utf8'));
    assert.equal(saved.runtime.dockerContext,'corrected');
    assert.equal(saved.runtime.dockerConfigDirectory,config);
    assert.equal(saved.runtime.image,'sha256:'+'a'.repeat(64));
    assert.deepEqual((await fs.readFile(calls,'utf8')).trim().split('\n').map(row=>JSON.parse(row)[4]),['info','create']);
    passed=true;
});

test('original terminal shows a failed first send, retains its text and routes readiness to explicit withdrawal', { timeout: 30000 }, async (t) => {
    const root = await temporaryDirectory('input-recovery');
    const home = path.join(root, 'home');
    let passed = false;
    t.after(async () => {
        if (passed)
            await fs.rm(root, { recursive: true, force: true });
        else
            t.diagnostic('Retained sent-request terminal ' + root);
    });
    const c = await openController({ installationHome: home });
    const accounts = ApplicationAccounts.open(c);
    await accounts.configure({
        providers: {
            'input-fixture': { api: 'openai-completions', apiKey: 'DUMMY', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixture' }] }
        }
    });
    await accounts.setDefault('input-fixture', 'fixture');
    await new ApplicationModels(c).newConversation();
    await c.close();
    const hold = path.join(root, 'hold-retry');
    const entered = path.join(root, 'retry-entered');
    const release = path.join(root, 'release-retry');
    const guard = path.join(root, 'guard.mjs');
    const cli = process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js';
    const cliDist = path.resolve(path.dirname(await fs.realpath(cli)), '..');
    const moduleUrl = file => JSON.stringify(pathToFileURL(path.join(cliDist, file)).href);
    await fs.writeFile(guard, `
import ${JSON.stringify(new URL('./readiness-no-execution.mjs', import.meta.url).href)};
import fs from 'node:fs/promises';
import {Capacity} from ${moduleUrl('controller/capacity.js')};
import {ApplicationModels} from ${moduleUrl('app/models.js')};
const [hold, entered, release] = ${JSON.stringify([hold, entered, release])};
const exists = file => fs.access(file).then(() => true, () => false);
Capacity.prototype.acquire = async () => { throw Error('Controlled startup prerequisite unavailable'); };
const original = ApplicationModels.prototype.resolve;
ApplicationModels.prototype.resolve = async function (...args) {
    if (await exists(hold)) {
        await fs.unlink(hold);
        await fs.rm(release, { force: true });
        await fs.writeFile(entered, 'entered');
        try {
            const deadline = Date.now() + 8000;
            while (!await exists(release)) {
                if (Date.now() >= deadline) throw Error('Controlled retry model check was never released');
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        } finally {
            await fs.unlink(entered);
        }
    }
    return original.apply(this, args);
};
`);
    const file = path.join(root, 'driver.json');
    const observation = path.join(root, 'withdrawn-frame.json');
    const observer = path.resolve('tests/ui/inspection-pty-observer.mjs');
    const draft = '  A separate unsent draft 한국어  ';
    const beforeReview = [
        { sql: 'SELECT state,text FROM conversation_inputs', rows: [['INITIAL_RESERVED', 'My original first request']] },
        { sql: 'SELECT COUNT(*) FROM runs', rows: [[1]] },
    ];
    const beforeRetry = {expectedInputs:1, queries:[beforeReview[0], {sql:'SELECT COUNT(*) FROM runs',rows:[[2]]}]};
    const checkingModel = uiText('en','input.stage.model');
    const modelHeld = [{path:entered,value:'entered'}];
    const retainedEntry = 'Earlier received request needs review · current draft kept';
    const steps = [
        { wait: '/ready setup', send: 'My original first request\x1b\r' },
        {
            wait: 'Controlled startup prerequisite unavailable',
            waitIdle: true,
            queries: [
                {
                    sql: "SELECT state,text FROM conversation_inputs",
                    rows: [['INITIAL_RESERVED', 'My original first request']]
                }
            ],
            send: '\x1b[200~' + draft + '\x1b[201~'
        },
        { wait: uiText('en','input.reviewBeforeSend',{submit:'Enter'}), assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\r' },
        { wait: retainedEntry, assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\r' },
        { wait: 'Original request · review before action', assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\x1b' },
        { wait: retainedEntry, assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\r' },
        { wait: 'Open recovery actions', assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\r' },
        { wait: 'This exact request · choose explicitly', assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\r' },
        { wait: 'Open recovery actions', assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\x1b' },
        { wait: retainedEntry, assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\x1b' },
        { wait: 'INPUT', assertDraft: draft, expectedInputs: 1, queries: beforeReview, send: '\x15/error\x1b\r' },
        { wait: 'Error recovery · choose a next step', send: 'Review retained requests\r' },
        { wait: 'Retained requests · separate', send: '\r' },
        { wait: 'Open recovery actions', send: '\r' },
        { wait: 'This exact request · choose explicitly', send: 'Retry original request\r' },
        {
            wait: 'Controlled startup prerequisite unavailable',
            waitIdle: true,
            assertDraft: '',
            expectedInputs: 1,
            queries: [{ sql: 'SELECT COUNT(*) FROM runs', rows: [[2]] }],
            send: '/inputs\x1b\r'
        },
        { wait: 'Retained requests · separate', send: '\r' },
        { wait: 'Open recovery actions', send: '\r' },
        { wait: 'This exact request · choose explicitly', releaseFile: hold, send: 'Retry original request\r' },
        { wait: checkingModel, waitFiles:modelHeld, assertDraft:'/inputs', ...beforeRetry, send:'\x15\x1b[200~'+draft+'\x1b[201~' },
        { wait: draft, assertDraft:draft, ...beforeRetry, send:'\x1b' },
        { wait: uiText('en','input.cancelling'), assertDraft:draft, ...beforeRetry, releaseFile:release, send:'' },
        { wait: uiText('en','input.retryCancelled'), assertDraft:draft, ...beforeRetry, send:'\x07e' },
        { wait: 'Error recovery · choose a next step', assertDraft:draft, ...beforeRetry, send:'Review original request\r' },
        { wait: 'Open recovery actions', assertDraft:draft, ...beforeRetry, send:'\r' },
        { wait: 'This exact request · choose explicitly', releaseFile:hold, send:'Retry original request\r' },
        { wait: checkingModel, waitFiles:modelHeld, assertDraft:draft, ...beforeRetry, send:'\x07e' },
        { wait: 'Error recovery · choose a next step', send: 'Review retained requests\r' },
        { wait: 'Retained requests · separate', send: '\r' },
        { wait: 'Open recovery actions', send: '\r' },
        { wait: 'This exact request · choose explicitly', send: 'Retry original request\r' },
        { wait: uiText('en','input.preparingExisting'), frame:{contains:['Error recovery · choose a next step']},
            assertDraft:draft, ...beforeRetry, send:'Error details\r' },
        { wait: 'Error details · inspection only', assertDraft:draft, ...beforeRetry, send:'\x1b' },
        { wait: 'Error recovery · choose a next step', assertDraft:draft, ...beforeRetry, send:'\x1b' },
        { wait: 'INPUT', assertDraft:draft, ...beforeRetry, send:'\x15NEWER exact draft' },
        {
            wait: 'NEWER exact draft',
            assertDraft: 'NEWER exact draft',
            expectedInputs: 1,
            releaseFile: release,
            send: ''
        },
        {
            wait: 'Controlled startup prerequisite unavailable',
            waitIdle: true,
            assertDraft: 'NEWER exact draft',
            expectedInputs: 1,
            queries: [{ sql: 'SELECT COUNT(*) FROM runs', rows: [[3]] }],
            send: '\r'
        },
        { wait: retainedEntry, assertDraft: 'NEWER exact draft', expectedInputs: 1, send: '\r' },
        { wait: 'Open recovery actions', send: '\r' },
        { wait: 'This exact request · choose explicitly', send: 'Withdraw original request\r' },
        {
            wait: 'Earlier request withdrawn',
            frame: { contains: ['Earlier request withdrawn'] },
            assertDraft: 'NEWER exact draft',
            expectedInputs: 1,
            queries: [
                { sql: "SELECT state,text FROM conversation_inputs", rows: [['CONFLICTED', 'My original first request']] },
                { sql: 'SELECT COUNT(*) FROM runs', rows: [[3]] }
            ],
            send: '\x07e'
        },
        { wait: 'Previous error · choose a next step', assertDraft: 'NEWER exact draft', expectedInputs: 1, send: 'Error details\r' },
        { wait: 'Previous error details · inspection only', assertDraft: 'NEWER exact draft', expectedInputs: 1, send: '\x1b' },
        { wait: 'Previous error · choose a next step', assertDraft: 'NEWER exact draft', expectedInputs: 1, send: '\x1b' },
        { wait: 'INPUT', assertDraft: 'NEWER exact draft', expectedInputs: 1, send: '\x07' },
        { wait: 'Commands · Ctrl+G', send: 'q' },
    ];
    await fs.writeFile(file, JSON.stringify({
        command: [process.execPath, ...(process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : []),
            '--import', guard, '--import', observer, cli],
        env: {
            HOME: root,
            PATH: path.dirname(process.execPath) + ":/usr/bin:/bin",
            USER: "fixture", LOGNAME: "fixture", SHELL: "/bin/sh",
            GITJIG_HOME: home,
            TMPDIR: root,
            TERM: 'xterm-256color',
            LANG: 'C.UTF-8',
            GITJIG_RESULT_OBSERVATION: observation,
            NODE_OPTIONS: '',
            NODE_PATH: ''
        },
        steps,
        observation,
        timeoutSeconds: 18,
        database: path.join(home, 'state/controller.sqlite'),
        output: file + '.terminal',
        gracefulShutdownSeconds: 3
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], { timeout: 23000, maxBuffer: 2 ** 20 })).stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stages, steps.length);
    assert.equal(result.terminalRestored, true);
    const terminal = await fs.readFile(file + '.terminal', 'utf8');
    const withdrawalStep = steps.findIndex(step => step.wait === 'Earlier request withdrawn');
    const withdrawalFrame = JSON.parse(await fs.readFile(`${file}.terminal.frame-${withdrawalStep}.json`, 'utf8')).frame.join('\n');
    assert.doesNotMatch(withdrawalFrame, /Controlled startup prerequisite unavailable|Error details and recovery|Response unavailable|Retained request ·/);
    assert.match(terminal.slice(terminal.lastIndexOf('Previous error details · inspection only')), /Controlled startup prerequisite unavailable/);
    assert.ok(terminal.includes('Retained request ·'));
    assert.ok(terminal.includes('My original first request'));
    assert.ok(terminal.includes('Controlled startup prerequisite unavailable'));
    const source = path.join(root, 'project');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'hello.txt'), 'owned');
    const setup = await openController({ installationHome: home });
    await setup.registerProject({ id: 'P', sourceRoot: source });
    const projectConversation = await new ApplicationModels(setup).newConversation({ projectId: 'P' });
    await setup.close();
    const missing = path.join(root, 'missing-runtime.json');
    const config = JSON.parse(await fs.readFile(file, 'utf8'));
    config.command.push('conversation', 'ui', '--conversation', projectConversation.conversationId);
    config.output = missing + '.terminal';
    config.steps = [
        { wait: '/ready setup', send: 'Keep my project request\x1b\r' },
        {
            wait: 'Request not sent · your text is kept',
            assertDraft: 'Keep my project request',
            expectedInputs: 1,
            queries: [{ sql: 'SELECT COUNT(*) FROM runs', rows: [[3]] }],
            send: '\x1b'
        },
        { wait: 'Setup needed · Enter for options', assertDraft: 'Keep my project request', expectedInputs: 1, queries: [{ sql: 'SELECT COUNT(*) FROM runs', rows: [[3]] }], send: '\x15/quit\x1b\r' },
    ];
    await fs.writeFile(missing, JSON.stringify(config));
    const refused = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', missing], { timeout: 23000, maxBuffer: 2 ** 20 })).stdout);
    assert.equal(refused.exitCode, 0);
    assert.equal(refused.stages, config.steps.length);
    assert.equal(refused.terminalRestored, true);

    const image = 'sha256:' + '0'.repeat(64);
    const configure = async value => {
        const owner = await openController({ installationHome: home });
        try { await ApplicationStartup.open(owner).save(value); }
        finally { await owner.close(); }
    };
    const runProject = async (label, steps) => {
        const scenario = path.join(root, label + '.json');
        await fs.writeFile(scenario, JSON.stringify({ ...config, output: scenario + '.terminal', steps, expectedInputs: 2 }));
        const receipt = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', scenario], { timeout: 23000, maxBuffer: 2 ** 20 })).stdout);
        assert.equal(receipt.exitCode, 0);
        assert.equal(receipt.stages, steps.length);
        assert.equal(receipt.terminalRestored, true);
    };
    const original = 'Original project request 한국어', separate = 'A separate project draft';
    const pending = count => [
        { sql: 'SELECT state,text FROM conversation_inputs WHERE conversation=?', params: [projectConversation.conversationId], rows: [['INITIAL_RESERVED', original]] },
        { sql: 'SELECT COUNT(*) FROM runs', rows: [[count]] },
    ];
    await configure({ version: 1, runtime: { dockerBinary: '/usr/bin/false', dockerContext: 'PREVIOUS', image } });
    await runProject('failed-project-send', [
        { wait: '/ready setup', expectedInputs: 1, send: '\x15' + original + '\x1b\r' },
        { wait: 'Controlled startup prerequisite unavailable', waitIdle: true, queries: pending(4), send: separate },
        { wait: separate, assertDraft: separate, send: '\x07q' },
    ]);
    await configure({ version: 1 });
    await runProject('apply-runtime-and-return-to-original', [
        { wait: '/ready setup', assertDraft: separate, queries: pending(4), send: '\r' },
        { wait: retainedEntry, assertDraft: separate, queries: pending(4), send: '\r' },
        { wait: 'Open recovery actions', assertDraft: separate, queries: pending(4), send: '\r' },
        { wait: 'Execution runtime is required before retry', send: 'Configure execution runtime\r' },
        { wait: 'Runtime setup · staged', send: 'Edit runtime fields\r' },
        { wait: 'Docker executable', send: '/usr/bin/false\r' },
        { wait: 'Docker context', send: 'REPAIRED\r' },
        { wait: 'Runtime image', send: image + '\r' },
        { wait: 'Docker configuration directory', send: '\r' },
        { wait: 'Runtime setup · staged', send: 'Review and save runtime\r' },
        { wait: 'Open settings confirmation', queries: pending(4), send: '\r' },
        { wait: 'Explicit runtime setup action', queries: pending(4), send: 'Save and apply runtime\r' },
        { wait: 'Open recovery actions', assertDraft: separate, queries: pending(4), send: '\r' },
        { wait: 'This exact request · choose explicitly', assertDraft: separate, queries: pending(4), send: 'Retry original request\r' },
        { wait: 'Controlled startup prerequisite unavailable', waitIdle: true, assertDraft: separate, expectedInputs: 2, queries: pending(5), send: '\x07q' },
    ]);
    passed = true;
});

for (const locale of ['en', 'ko']) test('unreadable retained request keeps both composer entry routes recoverable in ' + locale, {timeout: 18000}, async t => {
    const root = await temporaryDirectory('retained-input-refresh'), home = path.join(root, 'home');
    const database = path.join(home, 'state/controller.sqlite'), observation = path.join(root, 'current.json');
    const config = path.join(root, 'driver.json'), output = path.join(root, 'terminal');
    const original = 'Original queued request · 이전 요청', draft = 'Separate unsent draft · 새 초안';
    const text = key => uiText(locale, key);
    const unavailable = locale === 'ko' ? '보관된 요청을 읽을 수 없습니다' : 'Retained requests could not be read';
    const refresh = locale === 'ko' ? '보관된 요청 새로고침' : 'Refresh retained requests';
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained unreadable input terminal ' + root);
    });
    const controller = await openController({installationHome: home});
    const {conversationId: cid, generation} = controller.createConversation();
    let receipt, malformed, unchanged;
    try {
        controller.setConversationLanguage({conversationId: cid, expectedGeneration: generation, expectedRevision: 0, replyLanguage: locale});
        controller.setDraft({conversationId: cid, expectedRevision: 0, text: draft});
        const {inputId} = await controller.queueConversationInput({conversationId: cid, expectedGeneration: generation, text: original, mode: 'idle'});
        receipt = controller.store.one('SELECT * FROM conversation_inputs WHERE id=?', inputId);
        assert.deepEqual(controller.inspectConversationInputs(cid).map(input => [input.inputId, input.text, input.state]), [[inputId, original, 'QUEUED']]);
        malformed = '!' + receipt.data;
        controller.store.run('UPDATE conversation_inputs SET data=? WHERE id=?', malformed, inputId);
        assert.equal(controller.inspectConversationInputStatus(cid).count, 1);
        assert.throws(() => controller.inspectConversationInputs(cid));
        unchanged = ['works', 'runs', 'budgets', 'sources', 'conversation_directions', 'effect_delegations', 'effect_operations'].map(table => {
            const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
            return {sql, rows: controller.store.all(sql).map(Object.values)};
        });
    } finally { await controller.close(); }

    const state = (wait, editorFocused, contains, send, data = malformed) => ({
        wait, send, assertDraft: draft, expectedSelected: cid,
        frame: {selected: cid, draft, editorFocused, contains},
        queries: [...unchanged, {sql: 'SELECT * FROM conversation_inputs ORDER BY rowid', rows: [Object.values({...receipt, data})]}],
    });
    const retained = text('activity.retained'), back = text('input.recoveryBack');
    const list = text('input.recoveryBlockedDraft'), details = text('input.recoveryReview');
    const unavailableStep = send => {
        const step = state(unavailable, false, [unavailable, refresh, back], send);
        step.frame.excludes = [original, text('input.recoveryRetry'), text('input.recoveryWithdraw')];
        return step;
    };
    const steps = [
        state(retained, true, [retained], '\x07/'),
        state(text('command.discovery.title'), false, [text('command.discovery.title')], '/inputs\r'),
        unavailableStep(back + '\r'),
        state(retained, true, [retained], '\r'),
        {...unavailableStep(refresh + '\r'), mutations: [{sql: 'UPDATE conversation_inputs SET data=? WHERE id=?', params: [receipt.data, receipt.id]}]},
        state(list, false, [list, original], 'Original queued request\r', receipt.data),
        state(details, false, [details, original, receipt.id], '\x1b', receipt.data),
        state(list, false, [list, original], '\x1b', receipt.data),
        state(retained, true, [retained], '\x07q', receipt.data),
    ];
    const entry = process.env.GITJIG_TEST_CLI_ENTRY ?? path.resolve('dist/cli/entry.js');
    const guard = process.env.GITJIG_UI_MODULE_GUARD;
    await fs.writeFile(config, JSON.stringify({
        command: [process.execPath, ...(guard ? ['--import', guard] : []), '--import', path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import', path.resolve('tests/ui/inspection-pty-observer.mjs'), entry, 'conversation', 'ui', '--home', home, '--conversation', cid],
        env: {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: root, GITJIG_HOME: home, TMPDIR: root,
            TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', GITJIG_RESULT_OBSERVATION: observation},
        database, observation, output, steps, expectedInputs: 1, timeoutSeconds: 9, noForceKill: true,
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], {timeout: 14500, maxBuffer: 2 ** 20})).stdout);
    assert.deepEqual([result.exitCode, result.stages, result.terminalRestored], [0, steps.length, true]);
    const reopened = await openController({installationHome: home});
    try {
        assert.equal(reopened.inspectConversation(cid).draft.text, draft);
        assert.deepEqual(reopened.store.one('SELECT * FROM conversation_inputs WHERE id=?', receipt.id), receipt);
        for (const {sql, rows} of unchanged) assert.deepEqual(reopened.store.all(sql).map(Object.values), rows);
    } finally { await reopened.close(); }
    passed = true;
});

for (const locale of ['en', 'ko']) test(`retained request returns from its original execution allowance review in ${locale}`, { timeout: 30000 }, async t => {
    const root = await temporaryDirectory('retained-execution-allowance');
    const home = path.join(root, 'home'), observation = path.join(root, 'observation');
    const output = path.join(root, 'terminal'), file = path.join(root, 'driver.json');
    const original = 'Earlier request from original work', draft = 'Separate draft 한국어';
    const controller = await openController({ installationHome: home });
    let cid, workId, inputId, receipt, allowance, passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, { recursive: true, force: true });
        else t.diagnostic('Retained execution allowance terminal ' + root);
    });
    try {
        cid = controller.createConversation().conversationId;
        controller.setConversationLanguage({ conversationId: cid, expectedGeneration: 0, expectedRevision: 0, replyLanguage: locale });
        controller.setDraft({ conversationId: cid, expectedRevision: 0, text: draft });
        ({ inputId } = await controller.queueConversationInput({ conversationId: cid, expectedGeneration: 0, text: original, mode: 'idle' }));
        controller.capacity.acquire = async () => { throw Error('Controlled pre-dispatch refusal'); };
        const result = await controller.runConversation({
            conversationId: cid,
            initialInputId: inputId,
            model: scripted(() => assert.fail('Provider should not run')),
        });
        workId = result.workId;
        assert.equal(result.status, 'unavailable');
        const readReceipt = () => ({ ...controller.store.one('SELECT * FROM conversation_inputs WHERE id=?', inputId) });
        receipt = readReceipt();
        const [before] = controller.inspectConversationInputs(cid);
        assert.equal(before.retryEligible, true);
        controller.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='execution'", workId);
        allowance = controller.inspectWorkAllowance(workId).execution;
        const [held] = controller.inspectConversationInputs(cid);
        assert.equal(held.exhaustedRetryWorkId, workId);
        assert.equal(held.fingerprint, before.fingerprint);
        assert.throws(() => controller.recoverConversationInput({
            conversationId: cid, inputId, expectedContext: before.fingerprint, action: 'retry',
        }), { code: 'EXECUTION_ALLOWANCE_EXHAUSTED', workId });
        assert.deepEqual(readReceipt(), receipt);
    } finally { await controller.close(); }

    const copy = (key, params) => uiText(locale, key, params);
    const step = (editorFocused, contains, send, extra = {}) => ({ editorFocused, draft, contains, send, unchanged: true, ...extra });
    const held = copy('input.recoveryAllowanceRequired');
    const draftHint = copy('input.reviewBeforeSend', { submit: 'Enter' });
    const allowanceNext = copy('input.recoveryAllowanceNext').split('. ')[0];
    const review = copy('input.recoveryOpenActions');
    const action = copy('input.recoveryReviewAllowance');
    const title = copy('workRecovery.title', { id: workId, state: '' }).split(' · ').slice(0, 2).join(' · ');
    const execution = copy('workRecovery.execution');
    const kind = copy('workRecovery.executionKind');
    const steps = [
        step(true, [draftHint], '\x07/', { baseline: true, unchanged: false }),
        step(false, [copy('command.discovery.title').split(' · ')[0]], '/inputs\r'),
        step(false, [copy('input.recoveryList'), original], '\r'),
        step(false, [review, original, allowanceNext], '\r'),
        step(false, [held, action, copy('input.recoveryWithdraw')], action + '\r', {
            absent: [copy('input.recoveryRetry'), copy('input.recoveryChooseModel'), copy('requestSetup.openRuntime')],
        }),
        step(false, [title, execution], '\x1b'),
        step(false, [review, original, allowanceNext], '\r'),
        step(false, [held, action], action + '\r'),
        step(false, [title, execution], execution + '\r'),
        step(false, [copy('workRecovery.additional', { kind, available: 0 })], '\r'),
        step(false, [copy('workRecovery.allowanceReason')], 'Continue original request\r'),
        step(false, [copy('review.openConfirmation')], '\r'),
        step(false, [copy('workRecovery.confirmAllowance', { additional: 4, kind })],
            copy('workRecovery.confirmAllowance', { additional: 4, kind }) + '\r'),
        step(false, [title, copy('workRecovery.extended', { kind })], '\x1b', { baseline: true, unchanged: false }),
        step(false, [review, original], '\r', { absent: [allowanceNext] }),
        step(false, [copy('input.recoveryChoose'), copy('input.recoveryRetry')], '\x1b', { absent: [held] }),
        step(false, [review, original], '\x1b'),
        step(false, [copy('input.recoveryList'), original], '\x1b'),
        step(true, [draftHint], '\x07q'),
    ];
    const entry = process.env.GITJIG_TEST_CLI_ENTRY ?? path.resolve('dist/cli/entry.js');
    const guard = process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : [];
    await fs.writeFile(file, JSON.stringify({
        cid, observation, output, steps, columns: 120, timeoutSeconds: 20,
        command: [process.execPath, ...guard, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import', path.resolve('tests/ui/inspection-pty-observer.mjs'), entry, 'conversation', 'ui', '--home', home, '--conversation', cid],
        env: { PATH: path.dirname(process.execPath), HOME: root, GITJIG_HOME: home, TERM: 'xterm-256color', LANG: 'C.UTF-8',
            NODE_OPTIONS: '', NODE_PATH: '', GITJIG_RESULT_OBSERVATION: observation },
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/inspection-pty.py', file], { timeout: 25000, maxBuffer: 2 ** 20 })).stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stages, steps.length);
    assert.equal(result.terminalRestored, true);
    const reopened = await openController({ installationHome: home });
    try {
        assert.equal(reopened.inspectConversation(cid).draft.text, draft);
        assert.deepEqual({ ...reopened.store.one('SELECT * FROM conversation_inputs WHERE id=?', inputId) }, receipt);
        assert.deepEqual(reopened.inspectWorkAllowance(workId).execution, { ...allowance, limit: allowance.limit + 4 });
        assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM runs').n, 1);
    } finally { await reopened.close(); }
    passed = true;
});
