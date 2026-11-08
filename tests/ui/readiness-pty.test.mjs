import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {ApplicationKeybindings} from '../../dist/app/keybindings.js';
import {translator} from '../../dist/ui/i18n.js';
import {managedWorld} from './managed-change-fixture.mjs';
const execute=promisify(execFile);
const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
async function seedReadinessCurrentRequest(f,locale) {
    const {c,cid}=f,draft='Keep a separate unsent draft · 한글',request='Exact previously queued ordinary request';
    c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    const choice=c.getConversationModelChoice(cid);
    const baseline={...await f.models.baseline('P',choice),source:{kind:'conversation',conversationId:cid,choiceRevision:choice.revision}};
    const {workId}=await c.startConversationChange({conversationId:cid,expectedGeneration:0,expectedModelRevision:choice.revision,
        projectId:'P',request:'Earlier managed work',applicationModelBaseline:baseline});
    const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,text:request,mode:'idle'});
    c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    assert.equal(c.conversationChange(cid).workId,workId);
    const [input]=c.inspectConversationInputs(cid);
    assert.equal(input.inputId,inputId);
    assert.equal(input.eligible,false);
    const queries=['works','sources','runs','budgets','conversation_inputs','conversation_directions'].map(table=>({
        sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(Object.values),
    }));
    return {cid,workId,draft,request,queries};
}
function readinessCurrentRequestSteps(f,locale) {
    const tr=translator(locale), recommendation=tr('ready.heldNext');
    const step=(wait,send)=>({wait,send,assertDraft:f.draft,expectedSelected:f.cid,queries:f.queries});
    return [
        step(f.draft,'\x07t'),step(recommendation,'\r'),
        step(tr('input.recoveryList'),f.request+'\r'),step(tr('input.recoveryReview'),'\x1b'),
        step(tr('input.recoveryList'),'\x1b'),step(recommendation,tr('ready.returnRequest')+'\r'),
        step(f.draft,'\x07q'),
    ];
}
for(const locale of ['en','ko'])test('readiness opens the exact current request ahead of older managed work in '+locale,{timeout:14000},async t=>{
    const f=await managedWorld(t),original=await seedReadinessCurrentRequest(f,locale);
    await f.c.close();
    const file=path.join(f.root,'current-request.json'),steps=readinessCurrentRequestSteps(original,locale);
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs',
        process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',f.cid],
        env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
            LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,expectedInputs:1,database:path.join(f.home,'state/controller.sqlite'),
        output:file+'.terminal',timeoutSeconds:8,noForceKill:true}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11500,maxBuffer:2**20})).stdout);
    assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
    const terminal=await fs.readFile(file+'.terminal','utf8');
    assert.ok(terminal.includes(original.request));
    assert.ok(!terminal.includes(translator(locale)('input.recoveryRetry')));
    f.pass();
});
for (const locale of ['en','ko']) test(`readiness leads to a usable project folder before setup in ${locale}`, {timeout:14000}, async t => {
    const root = await temporaryDirectory('readiness-project-source'), home = path.join(root, 'home');
    const original = path.join(root, 'original'), replacement = path.join(root, 'replacement');
    const file = path.join(root, 'terminal.json'), draft = 'Keep the unsent request · 한글';
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained project-source readiness terminal ' + root);
    });
    await fs.mkdir(original);
    await fs.mkdir(replacement);
    const c = await openController({installationHome: home});
    let cid;
    try {
        await c.registerProject({id:'P',sourceRoot:original});
        await c.registerProject({id:'Q',sourceRoot:replacement});
        cid = c.createConversation({projectId:'P'}).conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    } finally { await c.close(); }
    await fs.rename(original, path.join(root, 'original-moved'));
    const tr = translator(locale);
    const unavailable = locale === 'ko' ? '프로젝트 폴더를 열 수 없음' : 'Project folder unavailable';
    const step = (wait, send, project = 'P') => ({wait, send, assertDraft:draft, queries:[
        {sql:'SELECT project FROM conversations WHERE id=?',params:[cid],rows:[[project]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
    ]});
    const steps = [
        step(draft, '\x07t'),
        step(unavailable, '\r'),
        step(tr('project.title',{project:'P'}), 'Q · ' + replacement + '\r'),
        step(tr('ready.title'), tr('ready.returnRequest')+'\r', 'Q'),
        step(draft, '\x07q', 'Q'),
    ];
    await fs.writeFile(file, JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs',
        process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',home,'--conversation',cid],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',timeoutSeconds:8,noForceKill:true}));
    const result = JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11500,maxBuffer:2**20})).stdout);
    assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
    passed = true;
});

for (const locale of ['en', 'ko']) test('readiness keeps setup available while a retained request is unreadable · '+locale,{timeout:16000},async t=>{
    const f=await managedWorld(t),{c,cid}=f,tr=translator(locale);
    const draft='Keep this independent draft · 한글',request='Original queued readiness request 한국어';
    c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:request,mode:'idle'});
    c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    const [retained]=c.inspectConversationInputs(cid);
    assert.equal(retained.inputId,inputId);
    assert.equal(retained.eligible,true);
    const unchanged=['works','sources','runs','budgets','conversation_directions'].map(table=>{
        const sql='SELECT * FROM '+table+' ORDER BY rowid';
        return {sql,rows:c.store.all(sql).map(Object.values)};
    });
    const inputSql='SELECT * FROM conversation_inputs ORDER BY rowid',original=c.store.one('SELECT * FROM conversation_inputs WHERE id=?',inputId);
    const evidence=data=>[...unchanged,{sql:inputSql,rows:[Object.values({...original,data})]}];
    const setData=data=>[{sql:'UPDATE conversation_inputs SET data=? WHERE id=?',params:[data,inputId]}];
    const damaged='!'+original.data;
    await c.close();
    const step=(wait,send,data=original.data)=>({wait,send,queries:evidence(data),assertDraft:draft,expectedSelected:cid});
    const pending=tr('ready.inputsNext'),back=tr('ready.returnRequest');
    const unavailable=tr('ready.inputsUnavailable');
    const openMore=step(unavailable,tr('ready.more')+'\r',damaged);
    const restoredReview=step(tr('input.recoveryReview'),'\x1b');
    const steps=[
        step(draft,'\x07t'),
        {...step(pending,back+'\r'),mutations:setData(damaged)},
        step(draft,'\x07t',damaged),
        openMore,
        {...step(tr('ready.detailsTitle'),tr('ready.backCurrent')+'\r',damaged),mutations:setData(original.data)},
        step(pending,'\r'),
        step(tr('input.recoveryList'),request+'\r'),restoredReview,
        step(tr('input.recoveryList'),'\x1b'),
        step(pending,back+'\r'),
        step(draft,'\x07q'),
    ];
    const entry=process.env.GITJIG_TEST_CLI_ENTRY;
    const file=path.join(f.root,'unreadable-readiness.json'),output=file+'.terminal';
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs',
        entry??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
        env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
            LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}},
        steps,expectedInputs:1,database:path.join(f.home,'state/controller.sqlite'),output,timeoutSeconds:10,gracefulShutdownSeconds:3,noForceKill:true}));
    try{
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13500,maxBuffer:2**20})).stdout);
        assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
        const bytes=await fs.readFile(output),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
        const pickerBefore=stage=>{const index=steps.indexOf(stage);return bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');};
        const recovery=pickerBefore(openMore);
        assert.ok(recovery.includes(tr('ready.title')));
        for(const label of [tr('request.next'),tr('request.chatNext'),tr('request.chatDraftNext'),tr('request.title')]) assert.ok(!recovery.includes(label),'Unreadable input must suppress '+label);
        assert.ok(pickerBefore(restoredReview).includes(request),'Re-entering the current setup must restore the exact original request');
        f.pass();
    }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-10000));throw error;}
});

for (const locale of ['en', 'ko']) for (const fault of ['delegated lookup', 'unrelated interpretation', 'original assessment', 'owner provenance']) test(
    `readiness retains original work after ${fault} failure in ${locale}`, {timeout: 14000}, async t => {
    const f = await managedWorld(t, null), {c, cid} = f, tr = translator(locale);
    const draft = 'Keep this separate draft · 원문';
    const choice = c.getConversationModelChoice(cid);
    const {workId} = await c.beginChange({
        projectId: 'P', request: 'Retain the actual original task',
        applicationModelBaseline: await f.models.baseline('P', choice),
    });
    c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?", cid, workId);
    c.setConversationLanguage({conversationId: cid, expectedGeneration: 0, expectedRevision: 0, replyLanguage: locale});
    c.setDraft({conversationId: cid, expectedRevision: 0, text: draft});
    if (fault === 'unrelated interpretation') {
        c.store.run("UPDATE works SET data=json_set(data,'$.ownerRootActivation.state','PENDING') WHERE id=?", workId);
        c.store.run("UPDATE requirements SET interpretation='{' WHERE work=?", workId);
        assert.throws(() => c.inspectWork(workId), SyntaxError);
    }
    if (fault === 'original assessment') {
        c.store.run("UPDATE change_state SET data='{' WHERE work=?", workId);
        assert.throws(() => c.inspectWorkRecovery(workId));
    }
    if (fault === 'owner provenance') {
        const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Earlier historical request',mode:'idle'});
        c.store.run("UPDATE conversation_inputs SET state='CONSUMED',data='{' WHERE id=?",inputId);
        assert.deepEqual(c.inspectConversationInputs(cid),[]);
        assert.throws(()=>c.conversationChange(cid),/malformed JSON/);
    } else {
        assert.equal(c.conversationChange(cid).workId, workId);
    }
    assert.equal(c.inspectConversation(cid).workId, null);
    const file = path.join(f.root, 'original-readiness.json');
    const evidence = ['runs', 'budgets', 'change_state', 'conversation_inputs', 'requirements'].map(table => {
        const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
        return {sql, rows: c.store.all(sql).map(Object.values)};
    });
    await c.close();
    const entry = path.resolve(process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js');
    const controllerModule = pathToFileURL(path.resolve(path.dirname(entry), '../controller/controller.js')).href;
    const unavailable = path.join(f.root, 'unavailable-delegation.mjs');
    if (fault === 'delegated lookup') await fs.writeFile(unavailable, `
        import { Controller } from ${JSON.stringify(controllerModule)};
        const original = Controller.prototype.inspectConversationProjectDependencies;
        Controller.prototype.inspectConversationProjectDependencies = function(input) {
            const work = this.store.one("SELECT json_extract(data,'$.ownerRootActivation.state') AS activation FROM works WHERE id=?", ${JSON.stringify(workId)});
            if (input.conversationId === ${JSON.stringify(cid)} && work?.activation === 'PENDING')
                throw Error('Controlled delegated lookup failure');
            return original.call(this, input);
        };
    `);
    const step = (wait, send) => ({wait, send, queries: evidence, assertDraft: draft, expectedSelected: cid});
    const next = tr(fault === 'owner provenance' ? 'ready.originalWorkUnavailable' :
        fault === 'original assessment' ? 'ready.assessmentUnavailable' : 'ready.originalNext');
    const steps = [
        step(draft, '\x07t'),
        ...(fault === 'delegated lookup' ? [{
            ...step(tr('ready.runtimeNext'), '\r'),
            mutations: [{
                sql: "UPDATE works SET data=json_set(data,'$.ownerRootActivation.state','PENDING') WHERE id=?",
                params: [workId],
            }],
        }] : []),
        step(next, '\r'),
        ...(fault === 'owner provenance' ? [
            step(tr('workRecovery.projectRegistryTitle',{project:'P'}), workId+'\r'),
        ] : []),
        step(fault === 'original assessment' ? tr('workRecovery.recordUnavailableTitle', {id: workId}) :
            tr('workRecovery.title', {id: workId, state: 'ACTIVE'}), '\x1b'),
        ...(fault === 'owner provenance' ? [
            step(tr('workRecovery.projectRegistryTitle',{project:'P'}),'\x1b'),
        ] : []),
        step(next, tr('ready.returnRequest') + '\r'),
        step(draft, '\x07q'),
    ];
    await fs.writeFile(file, JSON.stringify({
        command: [process.execPath, ...moduleGuard, '--import', './tests/ui/readiness-no-execution.mjs',
            ...(fault === 'delegated lookup' ? ['--import', unavailable] : []),
            entry, 'conversation', 'ui', '--home', f.home, '--conversation', cid],
        env: {HOME: f.root, GITJIG_HOME: f.home, TMPDIR: f.root, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
            TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: ''},
        steps, expectedInputs: fault === 'owner provenance' ? 1 : 0, database: path.join(f.home, 'state/controller.sqlite'), output: file + '.terminal',
        timeoutSeconds: 8, noForceKill: true,
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout: 11500, maxBuffer: 2 ** 20})).stdout);
    assert.deepEqual([result.exitCode, result.stages, result.terminalRestored], [0, steps.length, true]);
    if (fault === 'delegated lookup')
        assert.ok((await fs.readFile(file + '.terminal', 'utf8')).includes(tr('ready.queuedUnavailable')));
    f.pass();
});

for (const locale of ['en','ko']) for (const scenario of ['INITIAL_RESERVED', 'RECONCILIATION_REQUIRED', 'delivery changes in picker']) test(
    `readiness opens the applicable original recovery in ${locale} · ${scenario}`, {timeout:14000}, async t => {
    const root = await temporaryDirectory('readiness-unresolved'), home = path.join(root,'home');
    const file = path.join(root,'terminal.json'), draft = 'Preserve original unsent draft · 한글';
    const c = await openController({installationHome:home});
    const work = 'unsettled-original';
    const changesInPicker = scenario === 'delivery changes in picker';
    const inputState = changesInPicker ? 'INITIAL_RESERVED' : scenario;
    let cid, passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained unresolved readiness terminal '+root);
    });
    try {
        cid = c.createConversation().conversationId;
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        // Controlled retained resource state. Inspection uses the original real controller and UI.
        c.store.run('INSERT INTO sources VALUES(?,?,?,?)','original-source',cid,'{}','Earlier request');
        c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',work,null,'original-source',null,work,
            'UNKNOWN',1,1,null,JSON.stringify({kind:'ordinary-conversation',conversation:cid}));
        c.store.run('INSERT INTO budgets VALUES(?,?,?,?,?),(?,?,?,?,?)',work,'execution',32,1,0,work,'resolution',8,0,0);
        c.store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', 'original-input', cid, 0, work,
            'original-source', inputState, 'initial', 'Earlier request', '{}');
        c.store.run("UPDATE conversation_state SET resource='UNKNOWN',work=? WHERE conversation=?",work,cid);
    } finally { await c.close(); }
    const tr = translator(locale), deliveryUnknown = changesInPicker || inputState === 'RECONCILIATION_REQUIRED';
    const recommendation = tr(deliveryUnknown ? 'ready.heldNext' : 'ready.unknownWorkNext');
    const destination = deliveryUnknown ? tr('input.recoveryList') : tr('workRecovery.title',{id:work,state:'UNKNOWN'});
    const unchanged = [
        {sql:'SELECT resource,work FROM conversation_state WHERE conversation=?',params:[cid],rows:[['UNKNOWN',work]]},
        {sql:'SELECT kind,consumed,reserved FROM budgets ORDER BY kind',rows:[['execution',1,0],['resolution',0,0]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
    ];
    const step = (wait,send,state = deliveryUnknown ? 'RECONCILIATION_REQUIRED' : inputState) => ({wait,send,assertDraft:draft,
        queries:[...unchanged,{sql:'SELECT id,work,state FROM conversation_inputs WHERE conversation=?',params:[cid],rows:[['original-input',work,state]]}],
    });
    const steps = [
        step(tr('activity.unknown'),'\x07t',inputState),
        ...(changesInPicker ? [{
            ...step(tr('ready.unknownWorkNext'),'\r',inputState),
            mutations:[{sql:"UPDATE conversation_inputs SET state='RECONCILIATION_REQUIRED' WHERE id='original-input'"}],
        }] : []),
        step(recommendation,'\r'),
        step(destination,'\x1b'),
        step(recommendation,tr('ready.returnRequest')+'\r'),
        step(tr('activity.unknown'),'\x07q'),
    ];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs',
        process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',home,'--conversation',cid],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
            LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,expectedInputs:1,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',timeoutSeconds:8,noForceKill:true}));
    const result = JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11500,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    if (changesInPicker) assert.doesNotMatch(await fs.readFile(file+'.terminal','utf8'), /#unsettled-original · UNKNOWN/u);
    passed = true;
});

for (const locale of ['en','ko']) for (const unreadable of [false,true]) test(
    'readiness opens the original goal '+(unreadable?'with unavailable input':'at its turn ceiling')+' in '+locale,{timeout:14000},async t=>{
    const root=await temporaryDirectory('readiness-goal'),home=path.join(root,'home'),source=path.join(root,'project');
    const file=path.join(root,'terminal.json'),draft='Keep the owner draft · 한글';
    const c=await openController({installationHome:home});
    let cid,goal,stored,inputs,passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained goal readiness terminal '+root);});
    try{
        await fs.mkdir(source);await c.registerProject({id:'P',sourceRoot:source});
        cid=c.createConversation({projectId:'P'}).conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        goal=c.createGoal({conversationId:cid,objective:'Original goal remains recoverable',criteria:['Preserve admitted turns'],turnLimit:1});
        if (unreadable) {
            c.store.run("UPDATE goals SET state='PAUSED' WHERE id=?",goal.goalId);
            const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original pending goal request',mode:'idle'});
            c.store.run("UPDATE conversation_inputs SET data='{' WHERE id=?",inputId);
            assert.equal(c.pendingGoalInput(goal.goalId)[0].inputId,inputId);
            assert.throws(()=>c.inspectConversationInputs(cid));
        } else {
            c.store.run("UPDATE goals SET state='BUDGET_EXHAUSTED',data=json_set(data,'$.startedAttempts',1) WHERE id=?",goal.goalId);
        }
        stored=c.store.one('SELECT state,revision,data FROM goals WHERE id=?',goal.goalId);
        inputs=c.store.all('SELECT * FROM conversation_inputs ORDER BY rowid').map(Object.values);
    }finally{await c.close();}
    const tr=translator(locale),recommendation=tr('ready.goalNext');
    const queries=[{sql:'SELECT state,revision,data FROM goals WHERE id=?',params:[goal.goalId],rows:[[stored.state,stored.revision,stored.data]]},
        {sql:'SELECT * FROM conversation_inputs ORDER BY rowid',rows:inputs},
        {sql:'SELECT COUNT(*) FROM goal_attempts',rows:[[0]]},{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}];
    const step=(wait,send)=>({wait,send,queries,assertDraft:draft});
    const goalSteps=unreadable?[
        step(tr('input.recoveryListUnavailable'),tr('goal.inspectInputs')+'\r'),
        step(tr('input.recoveryRefresh'),'\x1b'),
        step(tr('input.recoveryListUnavailable'),tr('goal.details')+'\r'),
        step(tr('goal.objective',{value:goal.objective}),'\x1b'),
        step(tr('input.recoveryListUnavailable'),tr('goal.close')+'\r'),
    ]:[step(tr('goal.exhaustedExtend'),tr('goal.close')+'\r')];
    const steps=[step(draft,'\x07t'),step(recommendation,'\r'),...goalSteps,
        step(recommendation,tr('ready.returnRequest')+'\r'),step(draft,'\x07q')];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
        '--import','./tests/ui/readiness-no-execution.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',home,'--conversation',cid],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,expectedInputs:inputs.length,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',timeoutSeconds:8}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11500,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    await assert.rejects(fs.access(path.join(home,'config/startup.json')),{code:'ENOENT'});
    passed=true;
});

for (const locale of ['en','ko']) for (const stage of ['plan','checks','accepted-plan','resolution-plan']) test(`readiness and work offer the original allowance before ${stage} in ${locale}`,{timeout:18000},async t=>{
    const f=await managedWorld(t),cid=f.cid,draft='Keep this unsent draft · 한글';
    f.c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    const choice=f.c.getConversationModelChoice(cid);
    const baseline={...await f.models.baseline('P',choice),source:{kind:'conversation',conversationId:cid,choiceRevision:choice.revision}};
    const work=await f.c.startConversationChange({conversationId:cid,expectedGeneration:0,expectedModelRevision:choice.revision,projectId:'P',request:'Original managed request',applicationModelBaseline:baseline});
    const id=work.workId;
    const kindKey=stage==='resolution-plan'?'resolution':'execution';
    const otherKind=kindKey==='resolution'?'execution':'resolution';
    if (stage==='checks'||stage==='accepted-plan') {
        // Bind the controlled plan to the real captured artifact and a selected required command.
        const check={id:'check',command:'false',guaranteeIds:['req'],assertions:['value'],fixturePaths:[],timeoutMs:1000,
            cases:[{id:'healthy',kind:'healthy',guaranteeIds:['req']},{id:'adverse',kind:'adverse',guaranteeIds:['req']}]};
        const verification={checks:[check]},plan={requirements:[{id:'req'}],verification};
        const s=f.c.store;
        s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)','plan',id,'plan',work.baseVersion,null,'controlled-plan',JSON.stringify({plan}));
        s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)','verification',id,'verification','plan',null,'controlled-verification',JSON.stringify({verification}));
        if (stage==='checks') {
            s.run("INSERT INTO change_versions SELECT 'candidate',work,'candidate',id,artifact,hash,data FROM change_versions WHERE id=?",work.baseVersion);
            s.run("UPDATE change_state SET phase='CANDIDATE_CAPTURED',plan='plan',verification='verification',candidate='candidate' WHERE work=?",id);
            assert.deepEqual(f.c.inspectChangeModelPrerequisites(id),{stage:'checks',roles:[]});
        } else {
            s.run("UPDATE change_state SET phase='PLAN_READY',plan='plan',verification='verification' WHERE work=?",id);
            assert.deepEqual(f.c.inspectChangeModelPrerequisites(id),{stage:'implement',roles:['implementer']});
            assert.deepEqual(f.c.inspectChangeResult(id).blocked,[]);
        }
        s.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='resolution'",id);
    }
    f.c.store.run('UPDATE budgets SET lim=consumed WHERE lineage=? AND kind=?',id,kindKey);
    const balance=f.c.inspectChange(id),allowance=balance[kindKey],otherAllowance=balance[otherKind];
    await ApplicationStartup.open(f.c).clear();
    await f.c.close();
    const tr=translator(locale),reason=tr('managedRepair.allowance.'+kindKey,{command:'/work '+id}),kind=tr('workRecovery.'+kindKey+'Kind');
    const unchanged=[{sql:'SELECT COUNT(*) FROM works',rows:[[1]]}, {sql:'SELECT COUNT(*) FROM runs',rows:[[1]]},
        {sql:'SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind=?',params:[id,otherKind],
            rows:[[otherAllowance.limit,otherAllowance.consumed,otherAllowance.reserved]]}];
    const step=(wait,send,added=0)=>({wait,send,assertDraft:draft,queries:[...unchanged,
        {sql:'SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind=?',params:[id,kindKey],rows:[[allowance.limit+added,allowance.consumed,allowance.reserved]]}]});
    const next=tr('workRecovery.allowanceNeeded',{action:tr('workRecovery.'+kindKey)});
    const resultInspection=[
        step(draft,'\x07r'),
        step(next,'\r'), ...(stage==='accepted-plan' ? [step(tr('result.nextTitle'),tr('result.recovery')+'\r')] : []),
        step(next,tr('result.view')+'\r'),step(next,'\x1b'),step(next,'\x1b'),
        step(next,'\x1b'),
    ];
    const restoredResume=stage==='accepted-plan' ? [
        step(draft,'\x07r',2),step(tr('result.nextAcceptedPlan'),'\r',2),
        step(tr('result.reviewResume'),'\x1b',2),step(tr('result.nextAcceptedPlan'),'\x1b',2),
    ] : [];
    const added=kindKey==='resolution'?1:2;
    const confirmation=step(tr('workRecovery.extendTitle',{kind,id,lineage:id}).split(' · ')[0],tr('workRecovery.confirmAllowance',{kind,additional:added})+'\r');
    const refreshedWork=step(tr('workRecovery.title',{id,state:''}),'\x1b',added);
    const steps=[...resultInspection,step(draft,'\x07t'),step(reason,'\r'),
        step(next,tr('workRecovery.'+kindKey)+'\r'),step(tr('workRecovery.additional',{kind,available:0}),added+'\r'),
        step(tr('workRecovery.allowanceReason'),'Owner reviews the original execution allowance\r'),step(tr('workRecovery.reviewAllowance'),'\r'),
        confirmation,refreshedWork,
        step(tr('ready.runtimeNext'),tr('ready.returnRequest')+'\r',added),...restoredResume,step(draft,'\x07q',added)];
    const file=path.join(f.root,'allowance-priority.json');
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
        '--import','./tests/ui/readiness-no-execution.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
        env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',timeoutSeconds:12}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    const terminal=await fs.readFile(file+'.terminal');
    const progress=JSON.parse(await fs.readFile(file+'.terminal.progress.json','utf8'));
    const beforeExtension=terminal.subarray(0,progress.actionOutputOffsets[steps.indexOf(confirmation)]);
    assert.ok(!beforeExtension.includes(tr('workRecovery.resumeRoute',{id})), 'The known-inoperable Resume route must stay out of the picker');
    if (stage==='accepted-plan') {
        const refreshed=terminal.subarray(progress.actionOutputOffsets[steps.indexOf(confirmation)],progress.actionOutputOffsets[steps.indexOf(refreshedWork)]);
        assert.ok(refreshed.includes(tr('workRecovery.resumeRoute',{id})));
        assert.ok(terminal.includes(tr('result.planAccepted')));
        assert.ok(!terminal.subarray(0,progress.actionOutputOffsets[resultInspection.length-1]).includes(tr('result.reviewResume')));
        assert.ok(terminal.includes(tr('result.reviewResume')));
    }
    f.pass();
});

test('fresh source UI edits runtime with fields and relaunch shows active setup without executing a client',{timeout:15000},async t=>{
 const root=await temporaryDirectory('readiness-ui'),home=path.join(root,'home');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained readiness UI '+root);});
 const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
 const run=async(name,steps,args=[],scenarioHome=home)=>{
  const file=path.join(root,name+'.json');
  const command=[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js',...args];
  await fs.writeFile(file,JSON.stringify({command,env:{...env,GITJIG_HOME:scenarioHome},steps,timeoutSeconds:5,expectedInputs:0,database:path.join(scenarioHome,'state/controller.sqlite'),output:file+'.terminal'}));
  const actual=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:7000,maxBuffer:2**20})).stdout);
  assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);
 };
 const invocationHome=path.join(root,'invocation-home');
 await run('invocation',[
  {wait:'/ready setup',send:'\x07t'},
  {wait:'Active runtime',send:'Active runtime\r'},
  {wait:'Staged Docker context · "INVOCATION"',send:'Review and save runtime\r'},
  {wait:'"dockerContext": "INVOCATION"',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'Runtime setup · staged values',send:'Cancel\r'},
  {wait:'Setup and next actions · configuration facts',send:'Return to request\r'},
  {wait:'INPUT',send:'\x07'},
  {wait:'Commands · Ctrl+G',send:'q'},
 ],['conversation','ui','--docker-binary','/usr/bin/false','--docker-context','INVOCATION','--image','sha256:'+'0'.repeat(64)],invocationHome);
 await assert.rejects(fs.access(path.join(invocationHome,'config/startup.json')),{code:'ENOENT'});
 await run('save',[
  {wait:'Start with /ready to check setup',send:'KEEP 한국어\x07t'},
  {wait:'Setup and next actions',send:'More settings and details\r'},
  {wait:'More settings and details · current and saved configuration',send:'Active runtime\r'},
  {wait:'Runtime setup · staged values',assertDraft:'KEEP 한국어',send:'\x1b'},
  {wait:'More settings and details · current and saved configuration',assertDraft:'KEEP 한국어',send:'Active runtime\r'},
  {wait:'Runtime setup · staged values',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'/usr/bin/false\r'},
  {wait:'Docker context',send:'NO_ENGINE\r'},
  {wait:'Runtime image',send:'latest\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged values',send:'Review and save runtime\r'},
  {wait:'Runtime setup unavailable · staged values retained',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'Runtime setup · staged values',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\r'},
  {wait:'Docker context',send:'\r'},
  {wait:'Runtime image',send:'\x15sha256:'+'0'.repeat(64)+'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged values',send:'Review and save runtime\r'},
  {wait:'Review runtime setup before applying',send:'\r'},
  {wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},
  {wait:'More settings and details · current and saved configuration',send:'Startup'},
  {wait:'current process kept',assertDraft:'KEEP 한국어',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'More settings and details',send:'Return to request\r'},
  {wait:'KEEP 한국어',assertDraft:'KEEP 한국어',send:'\x15/quit\x1b\r'},
 ]);
 assert.ok((await fs.readFile(path.join(root,'save.json.terminal'),'utf8')).includes('/ready setup'));
 const saved=JSON.parse(await fs.readFile(path.join(home,'config/startup.json'),'utf8'));assert.equal(saved.runtime.dockerContext,'NO_ENGINE');
 await run('relaunch',[
  {wait:'/ready setup',send:'KEEP runtime draft\x07t'},
  {wait:'Active runtime',send:'Active runtime\r'},
  {wait:'Runtime setup · staged values',assertDraft:'KEEP runtime draft',send:'Inspect current runtime\r'},
  {wait:'Current runtime · read only',assertDraft:'KEEP runtime draft',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'Runtime setup · staged values',assertDraft:'KEEP runtime draft',send:'\x1b'},
  {wait:'Setup and next actions · configuration facts',assertDraft:'KEEP runtime draft',send:'Return to request\r'},
  {wait:'INPUT',send:'\x15/quit\x1b\r'},
 ]);
 const output=await fs.readFile(path.join(root,'relaunch.json.terminal'),'utf8');assert.ok(output.includes('NO_ENGINE'));
 await run('language-save',[
  {wait:'/ready setup',send:'/language ko\x1b\r'},
  {wait:'대화 언어 · ko',queries:[{sql:"SELECT json_extract(data,'$.language.replyLanguage') FROM conversation_state JOIN interaction_view ON conversation=selected",rows:[['ko']]}],send:'/quit\x1b\r'},
 ]);
 await run('language-reopen',[
  {wait:'/ready 설정',send:'/ready\x1b\r'},
  {wait:'설정과 다음 동작',send:'추가 설정과 상세 정보\r'},
  {wait:'추가 설정과 상세 정보 · 현재 설정과 저장된 설정',send:'대화 언어\r'},
  {wait:'대화 언어 · 현재 대화 · ko',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\x1b'},
  {wait:'추가 설정과 상세 정보 · 현재 설정과 저장된 설정',send:'현재 설정으로 돌아가기\r'},
  {wait:'설정과 다음 동작',send:'요청으로 돌아가기\r'},
  {wait:'입력',queries:[{sql:"SELECT json_extract(data,'$.language.replyLanguage') FROM conversation_state JOIN interaction_view ON conversation=selected",rows:[['ko']]}],send:'\x07'},
  {wait:'명령 · Ctrl+G',send:'q'},
 ]);passed=true;
});

for(const locale of ['en','ko'])test('terminal shows distinct pending runtime and bridge and applies only the runtime in '+locale,{timeout:15000},async t=>{
 const root=await temporaryDirectory('startup-guidance'),home=path.join(root,'home');
 let passed=false;
 t.after(async()=>{if(passed&&process.env.GITJIG_KEEP_STARTUP_GUIDANCE_FIXTURE!=='1')await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained startup guidance UI '+root);});
 const [project,cwd,agent,account,docker,savedDocker]=['project','bridge-host','bridge-agent','bridge-account','docker','saved-docker'].map(name=>path.join(root,name));
 for(const dir of [project,cwd,agent,account,docker,savedDocker,path.join(agent,'home')])await fs.mkdir(dir,{mode:0o700});
 await fs.writeFile(path.join(agent,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
 const file=await fs.realpath(process.execPath),sha256=createHash('sha256').update(await fs.readFile(file)).digest('hex');
 const bridge={profile:{kind:'installed-claude-bridge',cwd,agentDir:agent,executable:{file,sha256}},nativeAccountDirectory:account};
 const runtime={dockerBinary:'/usr/bin/false',dockerConfigDirectory:docker,dockerContext:'same-context',image:'sha256:'+'0'.repeat(64),memoryMiB:1024};
 const replacement={...runtime,dockerBinary:'/usr/bin/true',dockerConfigDirectory:savedDocker,memoryMiB:2048};
 const controller=await openController({installationHome:home});
 let cid;
 try {
  const models=new ApplicationModels(controller),accounts=ApplicationAccounts.open(controller);
  await accounts.configure({providers:{'ready-fixture':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'current'}]}}});
  cid=(await models.newConversation()).conversationId;
  await controller.registerProject({id:'P',sourceRoot:project});
  controller.setConversationProject({conversationId:cid,projectId:'P',expectedGeneration:0});
  const generation=controller.inspectConversation(cid).generation;
  controller.setConversationLanguage({conversationId:cid,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
  await models.select({conversationId:cid,expectedGeneration:generation,expectedRevision:controller.getConversationModelChoice(cid).revision,provider:'ready-fixture',modelId:'current'});
  await ApplicationStartup.open(controller).save({version:1,runtime});
 } finally {await controller.close();}

 const tr=translator(locale),en=locale==='en';
 const routeDifference=tr('runtime.routeDifferences',{fields:[tr('runtime.dockerExecutableName'),tr('runtime.dockerConfigurationName')].join(' · ')});
 const runtimeCue=en?'Runtime · saved execution environment available to review and apply':'실행 환경 · 저장된 실행 환경 검토 및 적용 가능';
 const activeRow=en?'Active runtime · review and edit':'현재 실행 환경 · 검토 및 편집';
 const bridgeCue=en?'Model bridge · restart required to apply saved changes':'모델 브리지 · 저장된 변경 사항을 적용하려면 재시작 필요';
 const empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const activation=JSON.stringify({version:1,runtime:replacement,bridge});
 const draft='Unsent original runtime draft · 한글';
 const observation=path.join(root,'observation.json'),scenario=path.join(root,'guidance.json');
 const applied={wait:tr('ready.title'),frame:{contains:[bridgeCue,'same-context',tr('request.next'),tr('runtime.saved'),tr('startup.applyBridgeOnRestart')]},queries:empty,assertDraft:draft,send:tr('ready.returnRequest')+'\r'};
 const steps=[
  {wait:en?'/ready setup':'/ready 설정',send:'/setup save '+activation+'\x1b\r'},
  {wait:en?'Future startup saved':'시작 설정을 저장했습니다',frame:{contains:en
   ? ['Apply the saved runtime now with /setup runtime','Restart to apply the bridge settings']
   : ['/setup runtime에서 저장된 실행 환경을 지금 적용할 수 있습니다','브리지 설정을 적용하려면 재시작하세요']},queries:empty,send:draft+'\x07t'},
  {wait:tr('ready.title'),frame:{contains:[tr('request.next'),runtimeCue,bridgeCue]},queries:empty,send:bridgeCue+'\r'},
  {wait:en?'Close normally with /quit':'/quit로 정상 종료',queries:empty,send:'\x1b'},
  {wait:tr('ready.title'),frame:{contains:[activeRow,runtimeCue,bridgeCue]},send:activeRow+'\r'},
  {wait:tr('runtime.title'),frame:{contains:[
   tr('runtime.stagedContext',{value:'"same-context"'}),tr('runtime.currentDraft'),tr('runtime.replacesSaved'),
  ]},queries:empty,assertDraft:draft,send:tr('runtime.inspectActive')+'\r'},
  {wait:tr('runtime.inspectActiveTitle'),frame:{contains:['"dockerBinary": "/usr/bin/false"']},queries:empty,send:'\x1b'},
  {wait:tr('runtime.title'),send:tr('runtime.inspectSaved')+'\r'},
  {wait:tr('runtime.inspectSavedTitle'),frame:{contains:['"dockerBinary": "/usr/bin/true"','"memoryMiB": 2048']},queries:empty,send:'\x1b'},
  {wait:tr('runtime.title'),send:tr('runtime.cancel')+'\r'},
  {wait:tr('ready.title'),frame:{contains:[runtimeCue,bridgeCue]},queries:empty,assertDraft:draft,send:runtimeCue+'\r'},
  {wait:tr('runtime.title'),frame:{contains:[
   tr('runtime.stagedContext',{value:'"same-context"'}),routeDifference,
   tr('runtime.savedDraft'),tr('runtime.noCheckResult'),
  ]},send:tr('runtime.review')+'\r'},
  {wait:tr('common.openSettingsConfirmation'),send:'\r'},
  {wait:tr('runtime.saveTitle'),send:tr('runtime.save')+'\r'},
  applied,
  {wait:draft,assertDraft:draft,queries:empty,send:'\x07q'},
 ];
 const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,GITJIG_RESULT_OBSERVATION:observation,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
 const command=[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
  '--import','./tests/ui/readiness-no-execution.mjs','--import','./tests/ui/inspection-pty-observer.mjs',
  process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',home,'--conversation',cid];
 const output=scenario+'.terminal';
 await fs.writeFile(scenario,JSON.stringify({command,env,steps,observation,output,columns:80,timeoutSeconds:10,database:path.join(home,'state/controller.sqlite')}));
 const actual=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',scenario],{timeout:12000,maxBuffer:2**20})).stdout);
 assert.equal(actual.exitCode,0);
 assert.equal(actual.stages,steps.length);
 assert.equal(actual.terminalRestored,true);
 const appliedFrame=JSON.parse(await fs.readFile(output+'.frame-'+steps.indexOf(applied)+'.json','utf8'));
 assert.ok(!appliedFrame.frame.some(line=>line.includes(runtimeCue)));
 assert.ok(!appliedFrame.frame.some(line=>line.includes(tr('startup.applyRuntimeNow'))));
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(home,'config/startup.json'),'utf8')),{version:1,runtime:replacement,bridge});
 passed=true;
});

for (const [scope,locale] of [['unbound','en'],['unbound','ko'],['active runtime','en'],['active runtime','ko'],['missing runtime','en']]) {
    test('terminal readiness separates saved setup from the current route · ' + scope + ' · ' + locale, {timeout: 12000}, async t => {
        const root = await temporaryDirectory('current-startup-route');
        const home = path.join(root, 'home'), profile = path.join(root, 'model.json');
        const savedFile = path.join(home, 'config/startup.json');
        const saved = '{"version":1,"bridge":"PRIVATE_UNUSED_SAVED_SETTING"}';
        const draft = '  Keep this 한국어 request  ';
        let passed = false;
        t.after(async () => {
            if (passed) await fs.rm(root, {recursive: true, force: true});
            else t.diagnostic('Retained current-route terminal ' + root);
        });
        const controller = await openController({installationHome: home});
        let cid;
        try {
            if (scope !== 'unbound') {
                const project = path.join(root, 'project');
                await fs.mkdir(project);
                await controller.registerProject({id: 'P', sourceRoot: project});
            }
            cid = controller.createConversation(scope === 'unbound' ? {} : {projectId: 'P'}).conversationId;
            controller.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
            const bindings = new ApplicationKeybindings(controller).file;
            await fs.mkdir(path.dirname(bindings),{recursive:true,mode:0o700});
            await fs.writeFile(bindings,JSON.stringify({'tui.input.submit':'ctrl+t'}),{mode:0o600});
        } finally { await controller.close(); }
        await fs.mkdir(path.dirname(savedFile), {recursive: true, mode: 0o700});
        await fs.writeFile(savedFile, saved, {mode: 0o600});
        await fs.writeFile(profile, JSON.stringify({
            provider: 'ready-explicit', modelId: 'current',
            definition: {
                api: 'openai-completions', apiKey: 'OWNED_READINESS_ONLY', baseUrl: 'http://127.0.0.1:9/v1',
                models: [{id: 'current', reasoning: false, input: ['text'], contextWindow: 8192, maxTokens: 256,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}}],
            },
        }), {mode: 0o600});
        const command = [process.execPath, ...(process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : []),
            '--import', './tests/ui/readiness-no-execution.mjs', '--import', './tests/ui/inspection-pty-observer.mjs',
            process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js', 'conversation', 'ui',
            '--home', home, '--conversation', cid, '--model-profile', profile];
        if (scope === 'active runtime') {
            command.push('--docker-binary', '/usr/bin/false', '--docker-context', 'CURRENT_RUNTIME', '--image', 'sha256:' + '0'.repeat(64));
        }
        const tr = translator(locale);
        const submit = {submit:'ctrl+t'};
        const draftNext = locale==='ko'?'다음 단계 · 초안으로 돌아가기':'Next step · Return to your draft';
        const draftAction = locale==='ko'?'초안으로 돌아가기 · ctrl+t로 별도 전송':'Return to draft · send separately with ctrl+t';
        const next = scope === 'unbound' ? draftNext : tr(scope === 'active runtime' ? 'request.next' : 'ready.setupNext');
        const steps = [
            {editorFocused: true, draft: '', contains: [tr('model.footer', {model: 'current', provider: 'ready-explicit'})], baseline: true,
                send: '\x1b[200~' + draft + '\x1b[201~\x07t'},
            {editorFocused: false, draft, contains: [next, 'Saved startup setup requires repair'],
                absent: ['PRIVATE_UNUSED_SAVED_SETTING', ...(scope === 'missing runtime' ? [tr('request.next')] : [tr('ready.setupNext'),tr('request.chatNext')])],
                unchanged: true, send: scope === 'missing runtime' ? tr('ready.returnRequest') + '\r' : '\r'},
            ...(scope === 'active runtime' ? [{editorFocused: false, draft,
                contains: [tr('request.title'), draftAction, tr('request.managed')], absent:[tr('request.prompt')], unchanged: true,
                send: draftAction + '\r'}] : []),
            {editorFocused: true, draft, contains: [tr('model.footer', {model: 'current', provider: 'ready-explicit'}),
                ...(scope === 'missing runtime' ? [] : [tr('activity.ready',submit)])], unchanged: true, send: '\x07q'},
        ];
        const file = path.join(root, 'driver.json'), observation = file + '.current';
        const env = {...process.env, HOME: root, GITJIG_HOME: home, TMPDIR: root, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
            TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: '', GITJIG_RESULT_OBSERVATION: observation};
        await fs.writeFile(file, JSON.stringify({command, env, cid, observation, steps, columns: 100,
            output: file + '.terminal', timeoutSeconds: 6}));
        const result = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/inspection-pty.py', file], {timeout: 10000})).stdout);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stages, steps.length);
        assert.equal(result.terminalRestored, true);
        assert.equal(await fs.readFile(savedFile, 'utf8'), saved);
        passed = true;
    });
}
