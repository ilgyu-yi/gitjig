import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {DatabaseSync} from 'node:sqlite';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {openController} from '../../dist/controller/index.js';
import {managedWorld} from './managed-change-fixture.mjs';
import {nodePreloads} from '../helpers/node-preloads.mjs';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);

test('Korean terminal describes a held original account repair and preserves the existing work on Back', {timeout:20000}, async t=>{
    const f=await managedWorld(t);
    const draft='기존 작업을 이어갈 때 참고할 메모', provider='managed-fixture';
    await f.accounts.configure({providers:{[provider]:{
        api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'original'},{id:'future'}],
    }}});
    const choice=f.c.getConversationModelChoice(f.cid);
    const baseline={...await f.models.baseline('P',choice),source:{kind:'conversation',conversationId:f.cid,choiceRevision:choice.revision}};
    const work=await f.c.startConversationChange({
        conversationId:f.cid,expectedGeneration:0,expectedModelRevision:choice.revision,
        projectId:'P',request:'Existing task whose account is unavailable',applicationModelBaseline:baseline,
    });
    const view=f.c.inspectConversation(f.cid);
    f.c.setDraft({conversationId:f.cid,expectedRevision:view.draft.revision,text:draft});
    f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:view.generation,expectedRevision:0,replyLanguage:'ko'});
    const budgets=f.c.store.all('SELECT * FROM budgets ORDER BY rowid');
    await f.c.close();

    const observation=path.join(f.root,'current'), output=path.join(f.root,'terminal'), file=path.join(f.root,'held-repair.json');
    const next='다음 단계 · 기존 작업의 모델·계정 요건 확인';
    const step=(editorFocused,contains,send,extra={})=>({editorFocused,contains,send,draft,unchanged:true,...extra});
    const steps=[
        step(true,['진행 불가: 계정 연결 필요','plan: '+provider],'\x07t',{unchanged:false,baseline:true}),
        step(false,[next],'\r'),
        step(false,['기존 작업: '+work.workId,'계정과 역할 설정을 바꿀 수 없습니다','/change cancel '+work.workId],
            '\x1b',{absent:['/login '+provider]}),
        step(false,['복구 동작 선택','기존 작업과 위임 실행의 취소 검토','설정 개요로 돌아가기'],
            '\r',{absent:['기존 제공자 '+provider+' 계정 연결']}),
        step(false,[next],'\x1b'),
        step(true,['진행 불가: 계정 연결 필요'],'\x07'),
        step(false,['명령 · Ctrl+G'],'q'),
    ];
    await fs.writeFile(file,JSON.stringify({cid:f.cid,observation,output,steps,timeoutSeconds:12,
        command:[process.execPath,
            ...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
            '--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
            process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.cid],
        env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,LANG:'ko_KR.UTF-8',LC_ALL:'ko_KR.UTF-8',TERM:'xterm-256color',
            NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},
    }));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    const retained=await openController({installationHome:f.home});
    try{
        assert.equal(retained.inspectConversation(f.cid).draft.text,draft);
        assert.equal(retained.inspectWork(work.workId).state,'ACTIVE');
        assert.deepEqual(retained.getConversationModelChoice(f.cid),choice);
        assert.deepEqual(retained.store.all('SELECT * FROM budgets ORDER BY rowid'),budgets);
    }finally{await retained.close();}
    f.pass();
});

test('retained managed work points to a separate new project conversation and capture review', {timeout:14000}, async t=>{
    const f=await managedWorld(t);
    const choice=f.c.getConversationModelChoice(f.cid);
    const baseline={...await f.models.baseline('P',choice),source:{kind:'conversation',conversationId:f.cid,choiceRevision:choice.revision}};
    const {workId}=await f.c.startConversationChange({conversationId:f.cid,expectedGeneration:0,
        expectedModelRevision:choice.revision,projectId:'P',request:'Original managed request',applicationModelBaseline:baseline});
    const draft='/change start Review the next independent request';
    const oldView=f.c.inspectConversation(f.cid);
    f.c.setDraft({conversationId:f.cid,expectedRevision:oldView.draft.revision,text:draft});
    const database=path.join(f.home,'state/controller.sqlite');
    const originalWork=[
        {sql:'SELECT id FROM works',rows:[[workId]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[1]]},
    ];
    const newProject=[...originalWork,{
        sql:'SELECT project FROM conversations JOIN interaction_view ON conversations.id=selected WHERE conversations.id!=?',params:[f.cid],rows:[['P']],
    }];
    await f.c.close();
    const file=path.join(f.root,'managed-next-change.json');
    const sourceSummary='Snapshot source: '+JSON.stringify(path.join(f.root,'project'));
    const steps=[
        {wait:draft,expectedSelected:f.cid,assertDraft:draft,send:'\r'},
        {wait:'For new work, open /new project',queries:originalWork,expectedSelected:f.cid,assertDraft:draft,send:'\x15/new project\x1b\r'},
        {wait:'Model: future',queries:newProject,assertDraft:'',send:draft+'\x1b\r'},
        {wait:sourceSummary,queries:newProject,send:'\x1b'},
        {wait:'INPUT · Conversation idle',queries:newProject,send:'\x07q'},
    ];
    const command=[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.cid];
    await fs.writeFile(file,JSON.stringify({command,env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,
        LC_ALL:'C',LANG:'C',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,database,output:file+'.terminal',timeoutSeconds:9,
        columns:Math.max(140,sourceSummary.length+4),expectedInputs:0}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000})).stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    const db=new DatabaseSync(database,{readOnly:true});
    try {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n,1);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversation_inputs').get().n,0);
    } finally {db.close();}
    f.pass();
});

test('missing managed source recovers to a moved project and reviews the preserved draft in one terminal', {timeout:16000}, async t=>{
    const f=await managedWorld(t,null);
    const draft='/change start Preserve the request for this project';
    f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
    await f.c.close();
    const project=path.join(f.root,'project'),moved=project+'-moved';
    await fs.rename(project,moved);
    const empty=['works','runs','budgets','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const selected=[...empty,
        {sql:'SELECT id,root FROM projects ORDER BY id',rows:[['P',project],['moved',moved]]},
        {sql:'SELECT project FROM conversations WHERE id=?',params:[f.cid],rows:[['moved']]},
    ];
    const file=path.join(f.root,'managed-missing-source.json');
    const sourceSummary='Snapshot source: '+JSON.stringify(moved);
    const steps=[
        {wait:draft,expectedSelected:f.cid,assertDraft:draft,queries:empty,send:'\r'},
        {wait:'The registered project folder is unavailable',assertDraft:draft,queries:empty,send:'\x07e'},
        {wait:'Select or register a project',assertDraft:draft,queries:empty,send:'Select or register a project\r'},
        {wait:'Project for this conversation',send:'Register a project\r'},
        {wait:'Project directory',send:'\x15'+moved+'\r'},
        {wait:'Project ID',send:'\x15moved\r'},
        {wait:'Project selected: moved',expectedSelected:f.cid,assertDraft:draft,queries:selected,send:'\r'},
        {wait:'Managed work needs an active runtime',assertDraft:draft,queries:selected,send:'Configure execution runtime\r'},
        {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
        {wait:'Docker executable',send:'/usr/bin/false\r'},
        {wait:'Docker context',send:'MOVED_PROJECT\r'},
        {wait:'Runtime image',send:'sha256:'+'a'.repeat(64)+'\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
        {wait:'Review runtime setup before applying',queries:selected,send:'\r'},
        {wait:'Explicit runtime setup action',queries:selected,send:'Save and apply runtime\r'},
        {wait:sourceSummary,expectedSelected:f.cid,assertDraft:draft,queries:selected,send:'\x1b'},
        {wait:'INPUT · Conversation idle',assertDraft:draft,queries:selected,send:'\x07'},
        {wait:'Commands · Ctrl+G, then a letter',send:'q'},
    ];
    const command=[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.cid];
    await fs.writeFile(file,JSON.stringify({command,env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,LC_ALL:'C',LANG:'C',
        TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',
        timeoutSeconds:11,columns:Math.max(140,sourceSummary.length+4)}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14000})).stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    const progress=JSON.parse(await fs.readFile(file+'.terminal.progress.json','utf8'));
    const terminalBytes=await fs.readFile(file+'.terminal');
    const closedReview=steps.findIndex(step=>step.wait===sourceSummary);
    const idle=terminalBytes.subarray(progress.actionOutputOffsets[closedReview],progress.actionOutputOffsets[closedReview+1]);
    assert.doesNotMatch(idle.toString('utf8'),/The registered project folder is unavailable/u);
    f.pass();
});

test('ordinary request to a missing project explains the source before runtime setup', {timeout:14000}, async t=>{
    const f=await managedWorld(t,null),draft='이 작업 요청은 그대로 보관해 줘';
    f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
    f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:0,expectedRevision:0,replyLanguage:'ko'});
    await f.c.close();
    const root=path.join(f.root,'project');
    await fs.rename(root,root+'-moved');
    const empty=['works','runs','budgets','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const file=path.join(f.root,'ordinary-missing-source.json');
    const restoreRequest=file+'.restore',restored=file+'.restored';
    const steps=[
        {wait:draft,assertDraft:draft,queries:empty,send:'\r'},
        {wait:'등록된 프로젝트 폴더를 열 수 없습니다',assertDraft:draft,queries:empty,send:'\x07e'},
        {wait:'작업할 프로젝트 선택 또는 등록',assertDraft:draft,queries:empty,send:'작업할 프로젝트 선택 또는 등록\r'},
        {wait:'이 대화의 프로젝트',assertDraft:draft,queries:empty,send:'\x1b'},
        {wait:'작업할 프로젝트 선택 또는 등록',assertDraft:draft,queries:empty,releaseFile:restoreRequest,send:'\x1b'},
        {wait:'Ctrl+G e · 오류 상세와 복구',waitFiles:[{path:restored,value:'restored'}],assertDraft:draft,queries:empty,send:'\r'},
        {wait:'요청을 보내지 않았습니다',assertDraft:draft,queries:empty,send:'\x1b'},
        {wait:'요청을 보존했습니다',assertDraft:draft,queries:empty,send:'\x07e'},
        {wait:'이전 오류 · 다음 동작 선택',assertDraft:draft,queries:empty,send:'\x1b'},
        {wait:draft,assertDraft:draft,queries:empty,send:'\x07q'},
    ];
    const command=[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.cid];
    await fs.writeFile(file,JSON.stringify({command,env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,LC_ALL:'C',LANG:'C',
        TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',timeoutSeconds:8}));
    const restoration=(async()=>{
        for await(const event of fs.watch(f.root,{signal:AbortSignal.timeout(9000)})){
            if(event.filename!==path.basename(restoreRequest))continue;
            await fs.rename(root+'-moved',root);
            await fs.writeFile(restored,'restored');
            return;
        }
    })();
    const [{stdout}]=await Promise.all([execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000}),restoration]);
    const result=JSON.parse(stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    f.pass();
});

async function terminal(f,name,steps,fail=false,failAdmission=false,holdBeforeCapture=false,gateStartReads=false){
 const file=path.join(f.root,name+'.json'),cfg={home:f.home,cid:f.cid,receipt:file+'.receipt',release:file+'.release',fail,failAdmission,holdBeforeCapture};
 const observation=file+'.observation', observe=gateStartReads||steps.some(step=>step.frame), preloads=[
  ...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
  ...(gateStartReads?['--import','./tests/ui/managed-start-reads.mjs']:[]),
  ...(observe?['--import','./tests/ui/inspection-pty-observer.mjs']:[])];
 await fs.writeFile(file,JSON.stringify({...cfg,command:[process.execPath,...nodePreloads(),...preloads,'--import','./tests/ui/readiness-no-execution.mjs','tests/ui/managed-change-entry.mjs',file],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:path.join(f.home,'artifacts'),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:'',...(gateStartReads?{GITJIG_MANAGED_START_READS:f.root}:{}),...(observe?{GITJIG_RESULT_OBSERVATION:observation}:{})},steps,timeoutSeconds:8,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',observation}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);return{file,result,receipt:JSON.parse(await fs.readFile(cfg.receipt,'utf8')),output:await fs.readFile(file+'.terminal','utf8')};
}

test('result and work show the same owned live operation over a retained blocker', {timeout:20000}, async t => {
 const f=await managedWorld(t), choice=f.c.getConversationModelChoice(f.cid), draft='Keep my separate draft';
 const baseline={...await f.models.baseline('P',choice),source:{kind:'conversation',conversationId:f.cid,choiceRevision:choice.revision}};
 const work=await f.c.startConversationChange({conversationId:f.cid,expectedGeneration:0,expectedModelRevision:choice.revision,
  projectId:'P',request:'Original managed result',applicationModelBaseline:baseline});
 const id=work.workId, blocker='Earlier attempt stopped before the plan was recorded';
 f.c.store.run("UPDATE change_state SET phase='BLOCKED',data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify([blocker]),id);
 const {execution,resolution}=f.c.inspectWorkAllowance(id);
 await f.c.close();
 const receipt=path.join(f.root,'live-result.json.receipt');
 const live=uiText('en','workRecovery.live'), recorded='Recorded blockers';
 const queries=[{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]},...Object.entries({execution,resolution}).map(([kind,value])=>({
  sql:'SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind=?',params:[id,kind],rows:[[value.limit,value.consumed,value.reserved]],
 }))];
 const hold={path:receipt,value:JSON.stringify({calls:1,active:true,settled:false,accountsClosed:false})};
 const step=(wait, send, extra={})=>({wait,send,queries,...extra});
 const result=await terminal(f,'live-result',[
  step('Model: original','/change resume '+id+'\x1b\r'),
  step(uiText('en','change.openResumeConfirmation'),'\r'),
  step(uiText('en','change.resumeAccept'),uiText('en','change.resumeAccept')+'\r'),
  step('','\x15'+draft+'\x07r',{waitFiles:[hold],assertDraft:'/change resume '+id}),
  step(live,'\r',{assertDraft:draft,frame:{contains:[live,recorded,blocker],draft,selected:f.cid}}),
  step(uiText('en','workRecovery.title',{id,state:'ACTIVE'}),'\x1b',{assertDraft:draft,frame:{contains:[live],draft,selected:f.cid}}),
  step(live,'\x1b',{assertDraft:draft,frame:{contains:[live,recorded,blocker],draft,selected:f.cid}}),
  step(draft,'\x07q',{assertDraft:draft}),
 ]);
 assert.deepEqual(result.receipt,{calls:1,active:false,settled:true,accountsClosed:true});
 assert.ok(!result.output.includes(uiText('en','workRecovery.resumeRoute',{id})));
 f.pass();
});

async function exhaustedOrdinary(f,locale){
 const s=f.c.store,workId='retained-ordinary';
 f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
 s.run('INSERT INTO sources VALUES(?,?,?,?)','retained-source',f.cid,'{}','Original owned work');
 s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',workId,'P','retained-source',null,workId,'ACTIVE',1,1,null,
  JSON.stringify({kind:'ordinary-conversation',conversation:f.cid,delegation:{rootWorkId:workId,projectIds:['P'],maxAssignments:4}}));
 s.run('INSERT INTO requirements VALUES(?,?,?,?)',workId,1,'Original owned work','{}');
 s.run('UPDATE conversation_state SET work=? WHERE conversation=?',workId,f.cid);
 s.run('INSERT INTO budgets VALUES(?,?,?,?,?)',workId,'execution',7,7,0);
 s.run('INSERT INTO budgets VALUES(?,?,?,?,?)',workId,'resolution',4,0,0);
 await f.c.close();
 return workId;
}

for (const locale of ['en','ko']) test(`managed start with no shared execution available opens original work recovery in ${locale}`,{timeout:14000},async t=>{
 const f=await managedWorld(t,null),workId=await exhaustedOrdinary(f,locale),request='/change start Keep original 한국어 request';
 const held=uiText(locale,'change.startExecutionExhausted'),error=uiText(locale,'error.title');
 const queries=[
  {sql:'SELECT id FROM works',rows:[[workId]]},
  {sql:'SELECT consumed,reserved FROM budgets WHERE kind=\'execution\'',rows:[[7,0]]},
  {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
 ];
 const step=(wait,send)=>({wait,send,queries,assertDraft:request});
 const actual=await terminal(f,'exhausted-before-start',[
  {wait:locale==='ko'?'모델: original':'Model: original',send:request+'\x1b\r'},
  step(held,'\x07e'),
  step(error,uiText(locale,'error.work',{id:workId})+'\r'),
  step(uiText(locale,'workRecovery.title',{id:workId,state:'ACTIVE'}),'\x1b'),
  step(error,'\x1b'),
  step(held,'\x07q'),
 ]);
 assert.equal(actual.receipt.calls,0);
 assert.ok(!actual.output.includes(uiText(locale,'change.openStartConfirmation')));
 f.pass();
});

test('extending an exhausted ordinary allowance preserves the draft until a fresh explicit managed start',{timeout:15000},async t=>{
 const locale='en',f=await managedWorld(t),workId=await exhaustedOrdinary(f,locale),request='/change start Keep original 한국어 request';
 const text=(key,args)=>uiText(locale,key,args),held=text('change.startExecutionExhausted');
 const kind=text('workRecovery.executionKind'),confirmedBalance='Execution: 7 consumed + 0 reserved / 11 · 4 available';
 const rows=(limit)=>[
  {sql:'SELECT id FROM works',rows:[[workId]]},
  {sql:"SELECT lim,consumed,reserved FROM budgets WHERE kind='execution'",rows:[[limit,7,0]]},
  {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
 ];
 const step=(wait,send,limit=7,extra={})=>({wait,send,queries:rows(limit),assertDraft:request,...extra});
 const backToDraft=step(text('workRecovery.extended',{kind}).split(' · ')[0],'\x07e',11,{frame:{editorFocused:true,draft:request,excludes:[held]}});
 const steps=[
  {wait:'Model: original',send:request+'\x1b\r'},
  step(held,'\x07e'),
  step(text('error.title'),text('error.work',{id:workId})+'\r'),
  step(text('workRecovery.title',{id:workId,state:'ACTIVE'}),text('workRecovery.execution')+'\r'),
  step(text('workRecovery.additional',{kind,available:0}),'\r'),
  step(text('workRecovery.allowanceReason'),'Allow this exact draft to reserve capture\r'),
  step(text('review.openConfirmation'),'\r'),
  step(text('workRecovery.confirmAllowance',{kind,additional:4}),text('workRecovery.confirmAllowance',{kind,additional:4})+'\r'),
  step(text('workRecovery.title',{id:workId,state:'ACTIVE'}),'\x1b',11),
  backToDraft,
  step(text('error.previousTitle'),text('error.details')+'\r',11),
  step(text('error.previousDetailsTitle'),'\x1b',11,{frame:{contains:[held]}}),
  step(text('error.previousTitle'),'\x1b',11),
  step('INPUT ·','\x1b\r',11,{frame:{editorFocused:true,draft:request,excludes:[held]}}),
  step(confirmedBalance,'\r',11),
  step(text('change.startAccept'),'\r',11),
  step(text('interaction.commandCancelled',{submit:'Enter'}).split(' · ')[0],'\x1b\r',11),
  step(confirmedBalance,'\r',11),
  step(text('change.startAccept'),'\x1b[B\r',11),
  {wait:'Recorded task stage: source captured',assertDraft:'',queries:[
   {sql:'SELECT predecessor,lineage FROM works WHERE id<>?',params:[workId],rows:[[workId,workId]]},
   {sql:"SELECT lim,consumed,reserved FROM budgets WHERE kind='execution'",rows:[[11,8,0]]},
  ],terminate:true,send:''},
 ];
 const actual=await terminal(f,'extend-then-start',steps);
 const frame=JSON.parse(await fs.readFile(actual.file+'.terminal.frame-'+steps.indexOf(backToDraft)+'.json','utf8')).frame.join('\n');
 assert.ok(!frame.includes(held),frame);
 assert.equal(actual.receipt.calls,1);
 f.pass();
});

for (const locale of ['en','ko']) test(`managed start offers model selection before runtime in ${locale}`, {timeout:14000}, async t => {
    const f = await managedWorld(t,null), cid = f.c.createConversation({projectId:'P'}).conversationId;
    const draft = '/change start Keep the original request · 한글';
    f.c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    await f.c.close();
    const text = (id, fields) => uiText(locale,id,fields);
    const missing = locale === 'ko' ? '관리형 작업을 시작하려면 모델을 선택하세요' : 'Choose a model before starting managed work';
    const empty = ['works','runs','budgets','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const choice = {sql:"SELECT json_extract(data,'$.modelChoice.modelId') FROM conversation_state WHERE conversation=?",params:[cid],rows:[['original']]};
    const step = (wait,send,queries=empty) => ({wait,send,queries,assertDraft:draft,expectedSelected:cid});
    const steps = [
        step(draft,'\x1b\r'),
        step(missing,'\r'),
        step(text('interaction.commandCancelled',{submit:'Enter'}),'\r'),
        step(missing,text('model.title')+'\r'),
        step(text('model.catalogue',{title:text('model.title')}),'managed-fixture/original\r'),
        step(locale === 'ko' ? '요청을 보존했습니다 · 관리형 작업을 다시 시작해 검토하세요' : 'Request kept · start managed work again to review it','\r',[...empty,choice]),
        step(text('change.runtimeRequired'),'\x1b',[...empty,choice]),
        step(text('interaction.commandCancelled',{submit:'Enter'}),'\x07q',[...empty,choice]),
    ];
    const actual = await terminal({...f,cid},'model-before-runtime',steps);
    assert.deepEqual(actual.receipt,{calls:0,active:false,settled:false,accountsClosed:true});
    await assert.rejects(fs.access(path.join(f.home,'config/startup.json')),{code:'ENOENT'});
    f.pass();
});

test('source terminal applies a missing runtime and returns to the exact managed start review without admission',{timeout:14000},async t=>{
 const f=await managedWorld(t,null);await f.c.close();
 const request='Keep this 한국어 owner request',command='/change start '+request;
 const empty=['works','runs','budgets','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const steps=[
  {wait:'Model: original',send:command+'\x1b\r'},
  {wait:'Managed work needs an active runtime',queries:empty,assertDraft:command,send:'Configure execution runtime\r'},
  {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'/usr/bin/false\r'},
  {wait:'Docker context',send:'MANAGED_HANDOFF\r'},
  {wait:'Runtime image',send:'sha256:'+'a'.repeat(64)+'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
  {wait:'Review runtime setup before applying',queries:empty,send:'\r'},
  {wait:'Explicit runtime setup action',queries:empty,send:'Save and apply runtime\r'},
  {wait:request,queries:empty,assertDraft:command,send:'\x03'},
  {wait:'INPUT',queries:empty,assertDraft:command,send:'\x15'+command+'\x1b\r'},
  {wait:'Open start confirmation',queries:empty,assertDraft:command,send:'\r'},
  {wait:'Start managed work',queries:empty,assertDraft:command,send:'\r'},
  {wait:'INPUT',queries:empty,assertDraft:command,send:'\x15/quit\x1b\r'},
 ];
 const actual=await terminal(f,'runtime-handoff',steps);
 assert.deepEqual(actual.receipt,{calls:0,active:false,settled:false,accountsClosed:true});
 assert.ok(actual.output.includes(request));
 assert.equal(JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8')).runtime.dockerContext,'MANAGED_HANDOFF');
 f.pass();
});

test('source terminal repairs runtime, preserves its ledger on Back and explicitly resumes the original work',{timeout:16000},async t=>{
 const f=await managedWorld(t),request='Original managed request 한국어',choice=f.c.getConversationModelChoice(f.cid);
 const baseline={...await f.models.baseline('P',choice),source:{kind:'conversation',conversationId:f.cid,choiceRevision:choice.revision}};
 const view=await f.c.startConversationChange({conversationId:f.cid,expectedGeneration:0,expectedModelRevision:choice.revision,projectId:'P',request,applicationModelBaseline:baseline});
 await ApplicationStartup.open(f.c).save({version:1});
 const command='/change resume '+view.workId;
 const frozen=['works','budgets','runs','conversation_inputs'].map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(Object.values)}));
 await f.c.close();
 const steps=[
  {wait:'Model: original',send:command+'\x1b\r'},
  {wait:'Managed work needs an active runtime',queries:frozen,assertDraft:command,send:'Configure execution runtime\r'},
  {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'/usr/bin/false\r'},
  {wait:'Docker context',send:'RESUME_HANDOFF\r'},
  {wait:'Runtime image',send:'sha256:'+'a'.repeat(64)+'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
  {wait:'Review runtime setup before applying',queries:frozen,send:'\r'},
  {wait:'Explicit runtime setup action',queries:frozen,send:'Save and apply runtime\r'},
  {wait:request,queries:frozen,assertDraft:command,send:'\x03'},
  {wait:'INPUT',queries:frozen,assertDraft:command,send:'\x15/quit\x1b\r'},
 ];
 const actual=await terminal(f,'resume-runtime-handoff',steps);
 assert.deepEqual(actual.receipt,{calls:0,active:false,settled:false,accountsClosed:true});
 assert.ok(actual.output.includes(request));
 assert.match(actual.output,/Open resume confirmation/);
 assert.match(actual.output,/Active Docker context: "RESUME_HANDOFF"/);
 const resumeFile=path.join(f.root,'resume-after-runtime-repair.json');
 const resumed=await terminal(f,'resume-after-runtime-repair',[
  {wait:'Model: original',queries:frozen,send:'\x15'+command+'\x1b\r'},
  {wait:'Open resume confirmation',queries:frozen,send:'\r'},
  {wait:uiText('en','change.resumeAccept'),queries:frozen,send:uiText('en','change.resumeAccept')+'\r'},
  {wait:'',waitFiles:[{path:resumeFile+'.receipt',value:JSON.stringify({calls:1,active:true,settled:false,accountsClosed:false})}],
   queries:[{sql:'SELECT id FROM works ORDER BY rowid',rows:[[view.workId]]}],releaseFile:resumeFile+'.release',send:''},
  {wait:'CONTROLLED_SOURCE_FAILURE',send:'\x07q'},
 ],true);
 assert.deepEqual(resumed.receipt,{calls:1,active:false,settled:true,accountsClosed:true});
 f.pass();
});

test('source CLI starts multiline menu intent; navigation remains independent and failure returns only to its source',{timeout:14000},async t=>{
 const f=await managedWorld(t),draft='Owner intent 한국어\nPreserve the second line';f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});await f.c.close();
 const release=path.join(f.root,'background.json.release');
 const steps=[
  {wait:'Model: original',send:'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details · current and saved configuration',send:'Managed changes\r'},
  {wait:'Managed changes',send:'Start a new\r'},
  {wait:'Managed owner request',send:'\r'},
  {wait:'Open start confirmation',send:'\r'},
  {wait:'Start managed work',send:'\x1b[B\r'},
  {wait:'Recorded task stage: source captured',assertDraft:draft,queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[1]]},{sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[draft]]}],send:'\x07c'},
  {wait:'Search: name, ID or project',send:f.other+'\r'},
  {wait:'Model: future',assertDraft:'',expectedSelected:f.other,releaseFile:release,send:'\x07c'},
  {wait:'Search: name, ID or project',send:f.cid+'\r'},
  {wait:'CONTROLLED_SOURCE_FAILURE',assertDraft:draft,expectedSelected:f.cid,send:'\x07e'},
  {wait:'Error recovery · choose a next step',send:'Error details · inspect\r'},
  {wait:'MANAGED_CHANGE_FAILED',send:'\x1b'},
  {wait:'Error recovery · choose a next step',send:'\x1b'},
  {wait:'Owner intent',assertDraft:draft,terminate:true,send:''},
 ];
 const actual=await terminal(f,'background',steps,true);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});
 const progress=JSON.parse(await fs.readFile(actual.file+'.terminal.progress.json','utf8')),offsets=progress.actionOutputOffsets;
 const bytes=await fs.readFile(actual.file+'.terminal'),released=steps.findIndex(step=>step.releaseFile);assert.ok(!bytes.subarray(offsets[released],offsets[released+1]).toString('utf8').includes('CONTROLLED_SOURCE_FAILURE'));
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n,1);assert.equal(db.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(f.cid).draft,draft);}finally{db.close();}f.pass();
});
test('source CLI closes held managed work before account teardown and restores terminal',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.c.close();const steps=[
  {wait:'Model: original',send:'/change start Bounded close test\x1b\r'},
  {wait:'Open start confirmation',send:'\r'},
  {wait:'Start managed work',send:'\x1b[B\r'},
  {wait:'Recorded task stage: source captured',assertDraft:'',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[1]]}],send:'/quit\x1b\r'},
 ];
 const actual=await terminal(f,'close',steps);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});f.pass();
});


test('source CLI admission failure preserves the exact command request and creates no orphan task',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.c.close();const command='/change start Keep failed 한국어 request',steps=[
  {wait:'Model: original',send:command+'\x1b\r'},
  {wait:'Open start confirmation',send:'\r'},
  {wait:'Start managed work',send:'\x1b[B\r'},
  {wait:'CONTROLLED_ADMISSION_FAILURE',assertDraft:command,queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],terminate:true,send:''},
 ];
 const actual=await terminal(f,'admission',steps,false,true);assert.deepEqual(actual.receipt,{calls:0,active:false,settled:false,accountsClosed:true});f.pass();
});

// Menu invocation does not submit the retained editor text, even if it is a command.
test('menu start preserves an unrelated slash draft after actual admission',{timeout:14000},async t=>{
 const f=await managedWorld(t),draft='/model managed-fixture/future',request='Separate menu owner request',correction=' after correction';f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});await f.c.close();
 const steps=[
  {wait:'Model: original',send:'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details · current and saved configuration',send:'Managed changes\r'},
  {wait:'Managed changes',send:'Start a new\r'},
  {wait:'Managed owner request',send:'Write a request\r'},
  {wait:'task intent',send:request+'\r'},
  {wait:'Open start confirmation',send:'\r'},
  {wait:'Back to task intent',send:'\r'},
  {wait:'task intent',frame:{contains:[request],draft,selected:f.cid},send:correction+'\r'},
  {wait:'Open start confirmation',frame:{contains:[request+correction],draft,selected:f.cid},send:'\r'},
  {wait:'Start managed work',send:'\x1b[B\r'},
  {wait:'Recorded task stage: source captured',assertDraft:draft,queries:[{sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[request+correction]]}],terminate:true,send:''},
 ];
 const actual=await terminal(f,'slash-draft',steps);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});f.pass();
});
test('closing managed start review and confirmation returns to the separately written request', {timeout:14000}, async t => {
 const f = await managedWorld(t), draft = '/model managed-fixture/future';
 const request = 'Separate owner request', edited = request + ' with a correction';
 f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
 await f.c.close();
 const empty = ['works','runs','budgets','conversation_inputs'].map(table => ({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const step = (wait, send, extra = {}) => ({wait,send,queries:empty,assertDraft:draft,...extra});
 const intent = (text, send) => step('task intent',send,{frame:{contains:['task intent',text],draft,selected:f.cid}});
 const steps = [
  step('Model: original','\x07t'),
  step('Setup and next actions','More settings\r'),
  step('More settings and details · current and saved configuration','Managed changes\r'),
  step('Managed changes','Start a new\r'),
  step('Managed owner request','Write a request\r'),
  step('task intent',request+'\r'),
  step('Open start confirmation','\x1b'),
  intent(request,'\x1b[200~\u2028unexpected second line\x1b[201~\r'),
  step('Enter a nonempty request on a single line',edited.slice(request.length)+'\r',{
   frame:{contains:['task intent',request],excludes:['unexpected second line'],draft,selected:f.cid},
  }),
  step('Open start confirmation','\r',{frame:{contains:[edited],draft,selected:f.cid}}),
  step('Back to task intent','\r'),
  intent(edited,'\r'),
  step('Open start confirmation','\r',{frame:{contains:[edited],draft,selected:f.cid}}),
  step('Back to task intent','\x1b'),
  intent(edited,'\x1b'),
  step('More settings and details · current and saved configuration','Return to request\r'),
  step('INPUT · Conversation idle','\x07q',{frame:{editorFocused:true,draft,selected:f.cid}}),
 ];
 const actual = await terminal(f,'managed-request-back',steps);
 assert.equal(actual.receipt.calls,0);
 f.pass();
});
for (const replaced of [true, false]) test('managed start recovers the written request when the folder is ' + (replaced ? 'replaced before confirmation' : 'removed at confirmation'), {timeout:14000}, async t => {
 const f = await managedWorld(t), draft = '/model managed-fixture/future', request = 'Review this exact owner request';
 f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
 await f.c.close();
 const root = path.join(f.root,'project'), moved = root+'-moved';
 const moveRequest = path.join(f.root,'move-project'), movedReceipt = path.join(f.root,'moved-project');
 const restoreRequest = path.join(f.root,'restore-project'), restoredReceipt = path.join(f.root,'restored-project');
 const empty = ['works','runs','budgets','conversation_inputs'].map(table => ({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const step = (wait, send, extra = {}) => ({wait,send,queries:empty,assertDraft:draft,...extra});
 const review = {contains:[request],draft,selected:f.cid};
 const issue = replaced ? 'The registered folder changed' : 'The registered folder is unavailable';
 const steps = [
  step('Model: original','\x07t'),
  step('Setup and next actions','More settings\r'),
  step('More settings and details · current and saved configuration','Managed changes\r'),
  step('Managed changes','Start a new\r'),
  step('Managed owner request','Write a request\r'),
  step('task intent',request+'\r'),
  ...(replaced ? [
   step('Open start confirmation','',{frame:review,releaseFile:moveRequest,resize:{rows:36,columns:141}}),
   step('Open start confirmation','\r',{frame:review,waitFiles:[{path:movedReceipt,value:'ready'}]}),
  ] : [
   step('Open start confirmation','\r',{frame:review}),
   step('Back to task intent','',{releaseFile:moveRequest,resize:{rows:36,columns:141}}),
   step('Back to task intent','\x1b[B\r',{waitFiles:[{path:movedReceipt,value:'ready'}]}),
  ]),
  step(issue,replaced ? '\r' : '',{
   frame:{...review,contains:['task intent',request],excludes:['Start workflow to review-ready']},
   ...(replaced ? {} : {releaseFile:restoreRequest}),
  }),
  ...(!replaced ? [
   step('','\r',{frame:{...review,contains:['task intent',request,issue]},waitFiles:[{path:restoredReceipt,value:'ready'}]}),
  ] : []),
  step('Open start confirmation','\r',{frame:review}),
  step('Back to task intent','\x1b[B\r'),
  {wait:'Recorded task stage: source captured',assertDraft:draft,queries:[
   {sql:'SELECT COUNT(*) FROM works',rows:[[1]]},
   {sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[request]]},
  ],terminate:true,send:''},
 ];
 const mutate = (async () => {
  let sourceMoved = false;
  for await (const event of fs.watch(f.root,{signal:AbortSignal.timeout(9000)})) {
   if (!sourceMoved && event.filename === path.basename(moveRequest)) {
    await fs.rename(root,moved);
    sourceMoved = true;
    if (replaced) await fs.cp(moved,root,{recursive:true});
    await fs.writeFile(movedReceipt,'ready');
    if (replaced) return;
   } else if (event.filename === path.basename(restoreRequest)) {
    await fs.rename(moved,root);
    await fs.writeFile(restoredReceipt,'ready');
    return;
   }
  }
 })();
 const [actual] = await Promise.all([terminal(f,'request-folder-drift',steps),mutate]);
 assert.equal(actual.receipt.calls,1);
 f.pass();
});
test('typed readiness forwards submission provenance and acknowledges only its submitted command',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.c.close();const request='Readiness owner request',steps=[
  {wait:'Model: original',send:'/ready\x1b\r'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details · current and saved configuration',send:'Managed changes\r'},
  {wait:'Managed changes',send:'Start a new\r'},
  {wait:'Managed owner request',send:'Write a request\r'},
  {wait:'task intent',send:request+'\r'},
  {wait:'Open start confirmation',send:'\r'},
  {wait:'Start managed work',send:'\x1b[B\r'},
  {wait:'Recorded task stage: source captured',assertDraft:'',queries:[{sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[request]]}],terminate:true,send:''},
 ];
 const actual=await terminal(f,'typed-ready',steps);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});f.pass();
});
test('typed help forwards only its actual submission through discovery into managed start',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.c.close();const request='Discovered managed owner request',steps=[
  {wait:'Model: original',send:'/help\x1b\r'},
  {wait:'Gitjig commands · search',send:'/change\r'},
  {wait:'Managed changes',send:'Start a new\r'},
  {wait:'Managed owner request',send:'Write a request\r'},
  {wait:'task intent',send:request+'\r'},
  {wait:'Open start confirmation',send:'\r'},
  {wait:'Start managed work',send:'\x1b[B\r'},
  {wait:'Recorded task stage: source captured',assertDraft:'',queries:[{sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[request]]}],terminate:true,send:''},
 ];
 const actual=await terminal(f,'typed-help',steps);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});f.pass();
});


test('original terminal keeps elapsed preparation visible before a managed capture allocates work',{timeout:12000},async t=>{
 const f=await managedWorld(t,undefined,await fs.realpath(await fs.mkdtemp('/tmp/gitjig-managed-preparation-')));await f.c.close();
 const empty=[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}];
 const steps=[
  {wait:'Model: original',send:'/change start Slow capture feedback\x1b\r'},
  {wait:'Open start confirmation',send:'\r'},
  {wait:'Start managed work',send:'\x1b[B\r'},
  {wait:'Reading workflow rules',queries:empty,send:''},
  {wait:'1s',queries:empty,send:'',terminate:true},
 ];
 const actual=await terminal(f,'preparing',steps,false,false,true);
 assert.deepEqual(actual.receipt,{calls:0,active:false,settled:true,accountsClosed:true});
 assert.match(actual.output,/Reading workflow rules/);f.pass();
});

for (const {locale, model, review, confirmation, rules, capture, seconds, captured, allowance} of [
    {locale:'en',model:'Model: original',review:'Open start confirmation',confirmation:'Start managed work',
        rules:'Reading workflow rules',capture:'Capturing project snapshot',seconds:'s',captured:'Recorded task stage: source captured',
        allowance:['New work allowance','Execution: 0 consumed + 0 reserved / 32','Resolution: 0 consumed + 0 reserved / 8']},
    {locale:'ko',model:'모델: original',review:'시작 확인 열기',confirmation:'관리형 작업 시작',
        rules:'작업 규칙 읽는 중',capture:'프로젝트 스냅샷 만드는 중',seconds:'초',captured:'기록된 작업 단계: 소스 캡처됨',
        allowance:['새 작업 한도','실행: 0회 사용 + 0회 예약 / 32회','해결: 0회 사용 + 0회 예약 / 8회']},
]) test(`original terminal in ${locale} shows one clock across actual rules and snapshot reads`,{timeout:12000},async t=>{
    const f=await managedWorld(t);
    f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    await f.c.close();
    const command='/change start Wait for both original reads';
    const empty=['works','runs','budgets','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const runState=(change,run,reservation,used,reserved)=>[{
        sql:"SELECT c.phase,r.phase,r.reservation,b.consumed,b.reserved FROM change_state c JOIN works w ON w.id=c.work JOIN runs r ON r.work=w.id JOIN budgets b ON b.lineage=w.lineage AND b.kind='execution'",
        rows:[[change,run,reservation,used,reserved]],
    },{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}];
    const entered=stage=>[{path:path.join(f.root,stage+'.entered'),value:'entered'}];
    const release=stage=>path.join(f.root,stage+'.release');
    const steps=[
        {wait:model,send:command+'\x1b\r'},
        {wait:review,frame:{contains:allowance},queries:empty,send:'\r'},
        {wait:confirmation,send:'\x1b[B\r'},
        {wait:rules,waitFiles:entered('rules'),queries:empty,assertDraft:command,send:''},
        {wait:'2'+seconds,frame:{contains:[rules+' · 2'+seconds]},queries:empty,releaseFile:release('rules'),send:''},
        {wait:capture,frame:{contains:[capture]},waitFiles:entered('capture'),queries:runState('BASE_CAPTURING','CAPTURING','reserved',0,1),
            releaseFile:release('capture'),send:''},
        {wait:captured,frame:{contains:[captured]},queries:runState('BASE_CAPTURED','SETTLED','consumed',1,0),terminate:true,send:''},
    ];
    const actual=await terminal(f,'actual-start-reads',steps,false,false,false,true);
    const frame=async index=>JSON.parse(await fs.readFile(actual.file+'.terminal.frame-'+index+'.json','utf8')).frame.join('\n');
    const elapsed=(await frame(5)).match(new RegExp(capture+' · (\\d+)'+seconds));
    assert.ok(elapsed&&Number(elapsed[1])>=2,'snapshot capture must retain the rules clock');
    assert.equal((await frame(6)).includes(capture),false,'live preparation must end with the actual capture');
    assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});
    f.pass();
});

test('project switch during managed preparation keeps the exact independent destination available',{timeout:14000},async t=>{
 const f=await managedWorld(t),destination=path.join(f.root,'destination');
 await fs.mkdir(destination);
 await f.c.registerProject({id:'Q',sourceRoot:destination});
 await f.c.close();
 const draft='/change start Keep the original managed request';
 const unchanged=[{sql:'SELECT project,generation FROM conversations WHERE id=?',params:[f.cid],rows:[['P',0]]},
  {sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[f.cid],rows:[[draft]]},
  ...['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}))];
 const steps=[
  {wait:'Model: original',send:draft+'\x1b\r'},
  {wait:'Open start confirmation',send:'\r'},
  {wait:'Start managed work',send:'\x1b[B\r'},
  {wait:'Reading workflow rules',assertDraft:draft,queries:unchanged,send:'\x07j'},
  {wait:'Project for this conversation · P',send:'\x1b[B\r'},
  {wait:'a managed task is active in this conversation',assertDraft:draft,queries:unchanged,send:'Open Q in an independent conversation\r'},
  {wait:'Independent conversation opened · Q',assertDraft:'',queries:[...unchanged,
   {sql:'SELECT project FROM conversations JOIN interaction_view ON selected=conversations.id',rows:[['Q']]}],send:'\x1bOQ'},
  {wait:'Conversations',send:f.cid+'\r'},
  {wait:'Reading workflow rules',assertDraft:draft,expectedSelected:f.cid,queries:unchanged,send:'\x07q'},
 ];
 const actual=await terminal(f,'managed-project-hold',steps,false,false,true);
 assert.deepEqual(actual.receipt,{calls:0,active:false,settled:true,accountsClosed:true});
 f.pass();
});
