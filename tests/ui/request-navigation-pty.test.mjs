import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {uiText} from '../../dist/ui/i18n.js';
import {nodePreloads} from '../helpers/node-preloads.mjs';
const execute=promisify(execFile);
for(const locale of ['en','ko'])for(const boundary of ['preparing','accepted','edited','dispatch',...locale==='en'?['sync-refusal']:[]])test(`actual terminal ${locale} ${boundary}: preserve original request admission and acknowledgement`,{timeout:12000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-request-navigation-'))),home=path.join(root,'home');
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained request navigation fixture '+root);});
    const c=await openController({installationHome:home}),a=c.createConversation(),b=c.createConversation();await c.close();
    const entered=path.join(root,'entered'),release=path.join(root,'release'),receipt=path.join(root,'receipt.json'),observation=path.join(root,'observation'),config=path.join(root,'config.json');
    const original='Original 한국어 request',newer='Newer unsent 한국어 draft';
    const editor=(id,draft,send,extra={})=>({selected:id,editorFocused:true,draft,send,...extra});
    const selector=(from,draft,to)=>({selected:from,editorFocused:false,draft,send:to+'\r'});
    const queued=locale==='ko'?'요청 접수됨 · 실행 시작 대기':'Request received · waiting to start';
    const stopping=locale==='ko'?'요청 중단 중':'Stopping request';
    const kept=locale==='ko'?'이미 접수된 입력':'Send already received';
    const checking=locale==='ko'?'요청과 파일 참조 확인 중':'Checking request and file references';
    const received=locale==='ko'?'요청 접수됨':'Request received';
    const routing=uiText(locale,'input.stage.routing');
    const idle=locale==='ko'?'대화 대기':'Conversation idle';
    const extraInput='Enter queue additional input';
    const steps=[editor(a.conversationId,'',original+'\r')];
    if(boundary==='sync-refusal')steps.push(
        editor(a.conversationId,'',newer+'\r',{contains:['Controlled synchronous admission refusal 1'],absent:[queued,extraInput]}),
        {editorFocused:false,draft:newer,contains:['Earlier received request needs review'],send:'\r'},
        {editorFocused:false,draft:newer,contains:['Open recovery actions'],send:'\r'},
        {editorFocused:false,draft:newer,contains:['This exact request · choose explicitly'],send:'Retry original request\r'},
        editor(a.conversationId,newer,'\x07q',{contains:['Controlled synchronous admission refusal 2'],absent:[queued,extraInput]}));
    else steps.push(editor(a.conversationId,['dispatch','accepted'].includes(boundary)?'':original,boundary==='edited'?'\x15'+newer:boundary==='accepted'?newer:'\x1bOQ',{
        waitFiles:[{path:entered}],...boundary==='dispatch'?{contains:[queued]}:boundary==='accepted'?{contains:[received],absent:[routing,queued]}:{}}));
    if(boundary==='edited')steps.push(editor(a.conversationId,newer,'',{releaseFile:release}),editor(a.conversationId,newer,'\x07q',{contains:['Input target or exact draft changed before file capture']}));
    else if(boundary==='dispatch')steps.push(
        {...selector(a.conversationId,'',b.conversationId),contains:[queued]},editor(b.conversationId,'','\x1bOQ',{absent:[queued]}),
        {...selector(b.conversationId,'',a.conversationId),contains:[queued]},editor(a.conversationId,'','\x15'+newer+'\x1b',{contains:[queued]}),
        editor(a.conversationId,newer,'\x1bOQ',{contains:[stopping]}),
        {...selector(a.conversationId,newer,b.conversationId),contains:[stopping]},
        editor(b.conversationId,'','\x1bOQ',{absent:[queued,stopping,kept]}),
        {selected:b.conversationId,editorFocused:false,draft:'',contains:[stopping],send:a.conversationId},
        {selected:b.conversationId,editorFocused:false,draft:'',contains:[a.conversationId,stopping],releaseFile:release,send:''},
        {selected:b.conversationId,editorFocused:false,draft:'',contains:[a.conversationId,idle+(locale==='ko'?' · 프로젝트 없음':' · no project')],waitFiles:[{path:release+'.pruned'}],absent:[queued,stopping,kept],send:'\r'},
        editor(a.conversationId,newer,'\x1bOQ',{absent:[queued,stopping,kept]}),
        selector(a.conversationId,newer,b.conversationId),editor(b.conversationId,'','\x07q'));
    else if(boundary!=='sync-refusal')steps.push(
        ...boundary==='accepted'?[editor(a.conversationId,newer,'\x1bOQ',{contains:[received],absent:[routing,queued]})]:[],
        {...selector(a.conversationId,boundary==='accepted'?newer:original,b.conversationId),contains:boundary==='preparing'?[checking]:boundary==='accepted'?[received]:[],
            ...(boundary==='accepted'?{absent:[routing,queued]}:{})},
        editor(b.conversationId,'','',{releaseFile:release}),editor(b.conversationId,'','\x1bOQ'),selector(b.conversationId,'',a.conversationId),editor(a.conversationId,boundary==='accepted'?newer:'','\x07q',{contains:['Controlled stop after original input admission']}));
    const env={HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',SHELL:'/bin/sh',TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation};
    await fs.writeFile(config,JSON.stringify({home,source:a.conversationId,other:b.conversationId,boundary,entered,release,receipt,cid:a.conversationId,observation,output:path.join(root,'terminal'),timeoutSeconds:7,releaseFilesOnFailure:[release],command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('tests/ui/request-navigation-child.mjs'),config],env,steps}));
    const actual=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:10000,maxBuffer:2**20})).stdout);
    await fs.writeFile(path.join(root,'driver-receipt.json'),JSON.stringify(actual));
    assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);
    const frames=JSON.parse(await fs.readFile(path.join(root,'terminal.frames.json'),'utf8'));
    if(boundary!=='sync-refusal')assert.ok(frames.snapshots[1].frame[0].includes(boundary==='dispatch'?queued:boundary==='accepted'?received:checking),frames.snapshots[1].frame[0]);
    if(!['edited','sync-refusal'].includes(boundary))assert.ok(!frames.snapshots[3].frame[0].includes(checking),frames.snapshots[3].frame[0]);
    const result=JSON.parse(await fs.readFile(receipt,'utf8'));assert.equal(result.runs.length,0);assert.equal(result.other.draft.text,'');
    assert.equal(result.dispatches,boundary==='edited'?0:boundary==='sync-refusal'?2:1);assert.equal(result.inputs.length,boundary==='edited'?0:1);assert.equal(result.source.draft.text,['accepted','edited','dispatch','sync-refusal'].includes(boundary)?newer:'');
    if(boundary==='dispatch')assert.deepEqual(result.cacheIds,[b.conversationId]);
    if(boundary!=='edited'){assert.equal(result.inputs[0].conversation,a.conversationId);assert.equal(result.inputs[0].text,original);assert.equal(result.inputs[0].state,'QUEUED');}
    if(process.env.GITJIG_UI_EVIDENCE_ROOT){const destination=path.join(process.env.GITJIG_UI_EVIDENCE_ROOT,locale+'-'+boundary);await fs.mkdir(destination,{recursive:true,mode:0o700});await fs.cp(root,path.join(destination,'closed-fixture'),{recursive:true,errorOnExist:true,force:false});}
    passed=true;
});
for (const locale of ['en','ko']) test(`actual terminal ${locale} can cancel an explicit retry of a later retained request before a run starts`, {timeout:15000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-request-retry-')));
    const home = path.join(root,'home'), files = Object.fromEntries(
        ['entered','release','receipt','observation','config','terminal'].map(name => [name,path.join(root,name)]));
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained request retry fixture '+root);
    });
    const c = await openController({installationHome:home});
    const earlier = 'An older retained request', chosen = 'The selected retained request', draft = 'Separate 한국어 draft';
    const diagnostic = locale === 'ko' ? 'Earlier request delivery diagnostic' : '';
    let cid, other, earlierId, chosenId;
    try {
        cid = c.createConversation().conversationId;
        other = c.createConversation().conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        const queue = text => c.queueConversationInput({conversationId:cid,expectedGeneration:0,text,mode:'idle'});
        earlierId = (await queue(earlier)).inputId;
        chosenId = (await queue(chosen)).inputId;
        if (diagnostic)
            c.store.run("UPDATE conversation_inputs SET data=json_set(data,'$.routeError',?) WHERE id=?",diagnostic,earlierId);
    } finally {
        await c.close();
    }
    const copy = key => uiText(locale,key);
    const editor = (contains,send,extra={}) => ({editorFocused:true,draft,contains,send,...extra});
    const review = (contains,send) => ({editorFocused:false,draft,contains,send,unchanged:true});
    const queued = copy('activity.queued'), stopping = copy('activity.cancelling');
    const steps = [
        editor([copy('activity.retained')],'\r',{baseline:true}),
        review([copy('input.recoveryBlockedDraft'),earlier,chosen],chosen+'\r'),
        review([copy('input.recoveryOpenActions'),chosen],'\r'),
        review([copy('input.recoveryChoose'),copy('input.recoveryRetry')],copy('input.recoveryRetry')+'\r'),
        editor([queued,copy('footer.interrupt'),diagnostic || earlier],'\x1b',{waitFiles:[{path:files.entered}],baseline:true}),
        editor([stopping,diagnostic || earlier],'',{releaseFile:files.release,unchanged:true}),
        editor([copy('activity.retained'),copy('input.receivedCancelled')],'\x07q',{absent:[queued,stopping],unchanged:true}),
    ];
    await fs.writeFile(files.config,JSON.stringify({home,source:cid,other,boundary:'retry-non-head',cid,
        ...files,output:files.terminal,timeoutSeconds:8,releaseFilesOnFailure:[files.release],steps,
        command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
            path.resolve('tests/ui/request-navigation-child.mjs'),files.config],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
            LANG:'C.UTF-8',LC_ALL:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:files.observation}}));
    const actual = JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',files.config],{timeout:13000,maxBuffer:2**20})).stdout);
    assert.equal(actual.stages,steps.length);
    assert.equal(actual.terminalRestored,true);
    const result = JSON.parse(await fs.readFile(files.receipt,'utf8'));
    assert.equal(result.dispatches,1);
    assert.equal(result.interrupts,0);
    assert.deepEqual(result.runs,[]);
    assert.deepEqual(result.inputs.map(row => [row.id,row.text,row.state,JSON.parse(row.data).ownerRecovery?.action]),
        [[earlierId,earlier,'QUEUED',undefined],[chosenId,chosen,'QUEUED','retry']]);
    assert.equal(result.source.draft.text,draft);
    passed = true;
});
for (const locale of ['en','ko']) test(`actual terminal ${locale} preserves an additional draft until the original managed response is admitted`, {timeout:16000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-managed-admission-')));
    const home = path.join(root,'home'), files = Object.fromEntries(
        ['entered','release','reserved','settle','receipt','observation','config','terminal'].map(name => [name,path.join(root,name)]));
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained managed admission fixture '+root);
    });
    const c = await openController({installationHome:home});
    const accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c);
    const original = 'First request to admit', draft = 'Second request 한국어';
    let cid, other;
    try {
        await accounts.configure({providers:{'navigation-fixture':{
            api:'openai-completions',apiKey:'DUMMY_NAVIGATION_FIXTURE',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'example'}],
        }}});
        const choice = await models.choice('navigation-fixture','example');
        cid = (await models.newConversation({choice})).conversationId;
        other = c.createConversation().conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    } finally {
        await c.close();
    }
    const copy = (key,params) => uiText(locale,key,params);
    const editor = (draft,contains,send,extra={}) => ({editorFocused:true,draft,contains,send,...extra});
    const queued = copy('activity.queued');
    const kept = copy('input.waitForAdmission');
    const hint = copy('footer.queueInput',{submit:'Enter'});
    const steps = [
        editor('',[copy('activity.ready',{submit:'Enter'})],original+'\r'),
        editor('',[queued],draft+'\r',{waitFiles:[{path:files.entered}],baseline:true}),
        editor(draft,[queued,kept],'\x1b\r',{absent:[hint],unchanged:true}),
        editor(draft,[queued,kept],'',{releaseFile:files.release,unchanged:true}),
        editor(draft,[hint],'\r',{waitFiles:[{path:files.reserved}]}),
        editor('',[draft],'',{releaseFile:files.settle}),
        editor('',[original,'Controlled stop after exact run reservation'],'\x07q'),
    ];
    await fs.writeFile(files.config,JSON.stringify({home,source:cid,other,boundary:'managed-dispatch',cid,
        ...files,output:files.terminal,columns:172,timeoutSeconds:9,releaseFilesOnFailure:[files.release,files.settle],steps,
        command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
            path.resolve('tests/ui/request-navigation-child.mjs'),files.config],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
            LANG:'C.UTF-8',LC_ALL:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:files.observation}}));
    const actual = JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',files.config],{timeout:14000,maxBuffer:2**20})).stdout);
    assert.equal(actual.stages,steps.length);
    assert.equal(actual.terminalRestored,true);
    const result = JSON.parse(await fs.readFile(files.receipt,'utf8'));
    assert.equal(result.dispatches,1);
    assert.equal(result.runs.length,1);
    assert.equal(JSON.parse(result.runs[0].data).initialInputId,result.inputs[0].id);
    assert.equal(JSON.parse(result.runs[0].data).cleanup,'not-allocated');
    assert.deepEqual(result.inputs.map(row => [row.text,row.state,row.mode]),
        [[original,'INITIAL_RESERVED','idle'],[draft,'QUEUED','steer']]);
    assert.equal(result.source.draft.text,'');
    assert.equal(result.source.directionRevision,2);
    passed = true;
});
for (const locale of ['en','ko']) test(`a recorded request stays reviewable after routing fails in ${locale}`, {timeout:26000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-routing-receipt-')));
    const home = path.join(root,'home'), files = Object.fromEntries(
        ['entered','release','receipt','observation','config','terminal'].map(name=>[name,path.join(root,name)]));
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained routing receipt fixture '+root);
    });
    const c = await openController({installationHome:home});
    const {conversationId:cid} = c.createConversation(), {conversationId:other} = c.createConversation();
    c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    await c.close();
    const copy = key => uiText(locale,key);
    const original = 'Original accepted request', newer = 'Newer 한국어 draft';
    const cancelled = locale === 'en', failure = copy('error.inputRouting');
    const diagnostic = copy('input.deliveryCheckStopped');
    const received = locale === 'ko' ? '요청 접수됨' : 'Request received';
    const beforeDispatch = {contains:[received],absent:[copy('input.stage.routing'),copy('activity.queued')]};
    const steps = [
        {editorFocused:true,draft:'',send:original+'\r'},
        {editorFocused:true,draft:'',...beforeDispatch,waitFiles:[{path:files.entered}],baseline:true,send:newer},
        {editorFocused:true,draft:newer,...beforeDispatch,unchanged:true,
            ...(cancelled ? {send:'\x1b'} : {send:'',releaseFile:files.release})},
        ...(cancelled ? [{editorFocused:true,draft:newer,contains:[copy('input.stoppingReceived')],unchanged:true,releaseFile:files.release,send:''}] : []),
        {editorFocused:true,draft:newer,contains:[failure],absent:[copy('input.cancelled'),'File context unavailable'],baseline:true,send:'\x07e'},
        {editorFocused:false,draft:newer,contains:[failure,copy('error.originalInput')],unchanged:true,send:copy('error.originalInput')+'\r'},
        {editorFocused:false,draft:newer,contains:[copy('input.recoveryReview'),original],unchanged:true,send:'\x1b'},
        {editorFocused:false,draft:newer,contains:[failure,copy('error.back')],unchanged:true,send:copy('error.back')+'\r'},
        {editorFocused:true,draft:newer,contains:[failure],unchanged:true,send:'\x07q'},
    ];
    const config = {home,cid,source:cid,other,boundary:'routing-fault',...files,
        output:files.terminal,steps,columns:150,timeoutSeconds:9,releaseFilesOnFailure:[files.release],
        command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
            path.resolve('tests/ui/request-navigation-child.mjs'),files.config],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',
            TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:files.observation}};
    await fs.writeFile(files.config,JSON.stringify(config));
    const result = JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',files.config],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    const end = JSON.parse(await fs.readFile(files.receipt,'utf8'));
    assert.deepEqual(end.inputs.map(row=>[row.text,row.state]),[[original,'QUEUED']]);
    assert.equal(end.dispatches,0);
    assert.equal(end.source.directionRevision,1);
    assert.equal(end.source.draft.text,newer);
    assert.deepEqual(end.runs,[]);
    assert.equal(JSON.parse(end.inputs[0].data).routeError,'INPUT_DELIVERY_CHECK_STOPPED');

    const reopen = Object.fromEntries(['config','observation','receipt','terminal'].map(name=>[name,path.join(root,'reopened-'+name)]));
    const originalNext = locale === 'ko' ? '다음 단계 · 원래 요청과 실패 원인 확인' : 'Next step · Review the original request and its failure';
    const reopenedSteps = [
        {editorFocused:true,draft:newer,contains:[diagnostic,'/inputs'],baseline:true,send:'\x07t'},
        {editorFocused:false,draft:newer,contains:[originalNext],absent:[copy('ready.inputsNext')],unchanged:true,send:'\r'},
        {editorFocused:false,draft:newer,contains:[copy('input.recoveryReview'),original,diagnostic],absent:[copy('input.recoveryList')],unchanged:true,send:'\x1b'},
        {editorFocused:false,draft:newer,contains:[originalNext],unchanged:true,send:'\x1b'},
        {editorFocused:true,draft:newer,contains:[diagnostic,'/inputs'],unchanged:true,send:'\r'},
        {editorFocused:false,draft:newer,contains:[original,copy('input.recoveryBlockedDraft')],unchanged:true,send:'\r'},
        {editorFocused:false,draft:newer,contains:[original,diagnostic],unchanged:true,send:'\x1b'},
        {editorFocused:false,draft:newer,contains:[original,copy('input.recoveryBlockedDraft')],unchanged:true,send:'\x1b'},
        {editorFocused:true,draft:newer,contains:[diagnostic],unchanged:true,send:'\x07q'},
    ];
    await fs.writeFile(reopen.config,JSON.stringify({...config,...reopen,output:reopen.terminal,steps:reopenedSteps,
        command:[...config.command.slice(0,-1),reopen.config],
        env:{...config.env,GITJIG_RESULT_OBSERVATION:reopen.observation}}));
    const reopened = JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',reopen.config],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(reopened.stages,reopenedSteps.length);
    assert.equal(reopened.terminalRestored,true);
    const restored = JSON.parse(await fs.readFile(reopen.receipt,'utf8'));
    assert.deepEqual(restored.inputs,end.inputs);
    assert.deepEqual(restored.runs,end.runs);
    assert.equal(restored.dispatches,0);
    assert.equal(restored.source.draft.text,newer);
    passed = true;
});

test('actual terminal keeps the exact unsent draft when its admission write is refused', {timeout:12000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-atomic-send-')));
    const home = path.join(root,'home');
    const files = Object.fromEntries(['entered','release','receipt','observation','config','terminal'].map(name=>[name,path.join(root,name)]));
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained atomic send fixture '+root);
    });
    const c = await openController({installationHome:home});
    const {conversationId:cid} = c.createConversation(), {conversationId:other} = c.createConversation();
    await c.close();
    const original = 'Exact 한국어 request for atomic admission';
    const failure = uiText('en','error.draftAdmission');
    const steps = [
        {editorFocused:true,draft:'',baseline:true,send:original+'\r'},
        {editorFocused:true,draft:original,contains:[original,failure],unchanged:true,releaseFile:files.release,send:''},
        {editorFocused:true,draft:original,contains:[failure],unchanged:true,waitFiles:[{path:files.entered}],send:'\r'},
        {editorFocused:true,draft:'',contains:['Controlled stop after original input admission'],send:'\x07q'},
    ];
    await fs.writeFile(files.config,JSON.stringify({home,cid,source:cid,other,boundary:'draft-ack-refusal',...files,
        output:files.terminal,steps,timeoutSeconds:8,
        command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
            path.resolve('tests/ui/request-navigation-child.mjs'),files.config],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',
            TERM:'xterm-256color',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',GITJIG_RESULT_OBSERVATION:files.observation}}));
    const result = JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',files.config],{timeout:11000,maxBuffer:2**20})).stdout);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    const end = JSON.parse(await fs.readFile(files.receipt,'utf8'));
    assert.deepEqual(end.inputs.map(row=>[row.text,row.state]),[[original,'QUEUED']]);
    assert.equal(end.dispatches,1);
    assert.equal(end.source.directionRevision,1);
    assert.equal(end.source.draft.text,'');
    assert.equal(end.runs.length,0);
    passed = true;
});
test('draft revisions change only for changed text while stale same-text writes still refuse',async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-draft-revision-'))),c=await openController({installationHome:path.join(root,'home')});
    t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});
    const {conversationId}=c.createConversation();
    const first=c.setDraft({conversationId,expectedRevision:0,text:'Original'});
    assert.equal(first.revision,1);assert.deepEqual(c.setDraft({conversationId,expectedRevision:1,text:'Original'}),first);
    assert.throws(()=>c.setDraft({conversationId,expectedRevision:0,text:'Original'}),/Draft revision conflict/);
    const edited=c.setDraft({conversationId,expectedRevision:1,text:'Edited'});assert.equal(edited.revision,2);
    assert.throws(()=>c.setDraft({conversationId,expectedRevision:1,text:'Edited'}),/Draft revision conflict/);
});
