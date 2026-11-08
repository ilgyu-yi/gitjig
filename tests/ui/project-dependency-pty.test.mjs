import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {ownerAssignmentCancellationWorld as world} from '../controller/owner-assignment-cancellation-fixture.mjs';
const execute=promisify(execFile);
const entry=process.env.GITJIG_TEST_CLI_ENTRY;
const cli=await fs.realpath(entry??path.resolve('dist/cli/entry.js'));
const dist=path.resolve(path.dirname(cli),'..');
const controllerModule=pathToFileURL(path.join(dist,'controller/controller.js')).href;
const {openController}=await import(pathToFileURL(path.join(dist,'controller/index.js')).href);
const {uiText}=await import(pathToFileURL(path.join(dist,'ui/i18n.js')).href);
const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',path.resolve(process.env.GITJIG_UI_MODULE_GUARD)]:[];
const entryEnvironment=entry?{GITJIG_TEST_CLI_ENTRY:cli}:{};

for(const locale of ['en','ko'])for(const initial of [false,true])test(
    `project recovery refreshes unavailable reads ${initial?'from the first observation':'after capturing the original'} in ${locale}`,{timeout:22000},async t=>{
    const f=await world(t), second=await f.assign(), draft='Parent draft · 한글', otherDraft='Sibling draft · 한글';
    const first=f.c.inspectConversation(f.child.target), sibling=f.c.inspectConversation(second.target);
    f.c.setConversationName({conversationId:first.conversationId,expectedGeneration:first.generation,name:'First delegated task'});
    f.c.setConversationName({conversationId:sibling.conversationId,expectedGeneration:sibling.generation,name:'Readable delegated task'});
    f.c.setDraft({conversationId:f.parent,expectedRevision:f.c.inspectConversation(f.parent).draft.revision,text:draft});
    f.c.setDraft({conversationId:sibling.conversationId,expectedRevision:sibling.draft.revision,text:otherDraft});
    await f.c.close();
    const resume=path.join(f.root,'resume-reads'), observation=path.join(f.root,'observation'), attempts=path.join(f.root,'switch-attempts');
    const output=path.join(f.root,'terminal'), config=path.join(f.root,'terminal.json'), guard=path.join(f.root,'guard.mjs');
    await fs.writeFile(guard,`import fs from 'node:fs';
import {Controller} from ${JSON.stringify(controllerModule)};
const switchProject=Controller.prototype.changeConversationProject;
Controller.prototype.changeConversationProject=function(...args){
    fs.appendFileSync(${JSON.stringify(attempts)},'switch\\n');
    return switchProject.apply(this,args);
};
const dependencies=Controller.prototype.inspectConversationProjectDependencies;
let captured=false;
Controller.prototype.inspectConversationProjectDependencies=function(input){
    if(${initial}&&input.conversationId===${JSON.stringify(f.parent)}&&!fs.existsSync(${JSON.stringify(resume)}))
        throw Error('Controlled unavailable first dependency observation');
    if(input.conversationId===${JSON.stringify(f.parent)}&&input.lifecycleHolds){
        if(captured&&!fs.existsSync(${JSON.stringify(resume)}))throw Error('Controlled unavailable dependency observation');
        captured=true;
    }
    return dependencies.call(this,input);
};
const conversation=Controller.prototype.inspectConversation;
Controller.prototype.inspectConversation=function(id){
    if(id===${JSON.stringify(first.conversationId)}&&fs.existsSync(${JSON.stringify(resume)}))throw Error('Controlled unavailable related view');
    return conversation.call(this,id);
};
`);
    const tr=(key,values)=>uiText(locale,key,values);
    const unobserved=locale==='ko'?'현재 의존 관계를 확인할 수 없음':'Could not check current dependencies';
    const unreadable=locale==='ko'?'일부 관련 대화를 읽을 수 없음':'Some related conversations could not be read';
    const refresh=locale==='ko'?'복구 선택지 새로고침':'Refresh recovery choices';
    const firstLink=tr('error.openProjectDependency',{conversation:'First delegated task · '+first.conversationId});
    const siblingLink=tr('error.openProjectDependency',{conversation:'Readable delegated task · '+sibling.conversationId});
    const retry=tr('error.retryProjectSwitch',{project:'Q'});
    const destination=tr('error.requestedProject',{project:'"Q"'});
    const independent=tr('error.independentSelectedProject',{project:'Q'});
    const summary=initial?tr('project.lifecycleHeld'):'First delegated task';
    const steps=[
        {editorFocused:true,draft,baseline:true,send:'\x07j'},
        {editorFocused:false,draft,contains:[tr('project.title',{project:'P'})],unchanged:true,send:'\x1b[B\r'},
        {editorFocused:false,draft,contains:[unobserved,refresh,retry,destination,independent],absent:[firstLink,siblingLink],unchanged:true,releaseFile:resume,send:refresh+'\r'},
        {editorFocused:false,draft,contains:[unreadable,summary,siblingLink,refresh,retry],absent:[unobserved,firstLink],unchanged:true,send:siblingLink+'\r'},
        {editorFocused:true,draft:otherDraft,selected:sibling.conversationId,contains:['Readable delegated task',f.parent],unchanged:true,send:'\x07q'},
    ];
    await fs.writeFile(config,JSON.stringify({cid:f.parent,observation,output,columns:120,timeoutSeconds:10,steps,
        command:[process.execPath,...moduleGuard,'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),'--import',guard,
            '--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),cli,'conversation','ui','--home',f.home,'--conversation',f.parent],
        env:{...process.env,...entryEnvironment,TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',
            LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation}}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:15000,maxBuffer:2**20})).stdout);
    assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
    assert.equal(await fs.readFile(attempts,'utf8'),'switch\n');
    const reopened=await openController({installationHome:f.home});
    try{
        assert.equal(reopened.inspectConversation(f.parent).projectId,'P');
        assert.equal(reopened.inspectConversation(f.parent).draft.text,draft);
        assert.equal(reopened.inspectConversation(sibling.conversationId).draft.text,otherDraft);
    }finally{await reopened.close();}
    f.pass();
});

for (const locale of ['en','ko']) test(`project recovery keeps its destination after a selected dependency settles in ${locale}`, {timeout:18000}, async t => {
    const f = await world(t), draft = 'Parent 한글 draft stays on the source', name = 'Delegated task selected for inspection';
    const child = f.c.inspectConversation(f.child.target);
    f.c.setConversationName({conversationId:child.conversationId,expectedGeneration:child.generation,name});
    f.c.setDraft({conversationId:f.parent,expectedRevision:0,text:draft});
    const before = {
        budgets:f.s.all('SELECT * FROM budgets ORDER BY rowid'),
        runs:f.s.all('SELECT id FROM runs ORDER BY rowid'),
        sibling:f.s.one('SELECT * FROM works WHERE id=?',f.sibling.work),
    };
    const expectedEpoch = f.c.inspectWork(f.child.work).epoch;
    await f.c.close();
    const paths = Object.fromEntries(['config','observation','output','guard','release','settled'].map(file=>[file,path.join(f.root,file)]));
    await fs.writeFile(paths.guard + '.mjs',`import fs from 'node:fs';
import {Controller} from ${JSON.stringify(controllerModule)};
const subscribe = Controller.prototype.subscribeGoals;
let armed = false;
Controller.prototype.subscribeGoals = function (...args) {
    if (!armed) {
        armed = true;
        const timer = setInterval(async () => {
            if (!fs.existsSync(${JSON.stringify(paths.release)})) return;
            clearInterval(timer);
            await this.cancelWork(${JSON.stringify({workId:f.child.work,expectedEpoch})});
            fs.writeFileSync(${JSON.stringify(paths.settled)}, 'cancelled');
        }, 20);
        timer.unref();
    }
    return subscribe.apply(this,args);
};
`);
    const copy = (id,values) => uiText(locale,id,values);
    const related = copy('error.openProjectDependency',{conversation:name+' · '+f.child.target});
    const destination = copy('error.requestedProject',{project:'"Q"'});
    const retry = copy('error.retryProjectSwitch',{project:'Q'});
    const change = copy('error.recoveryUpdated');
    const originalChanged = locale==='ko'?'기록된 의존 관계가 바뀌었습니다':'The recorded dependency changed';
    const step = (editorFocused,contains,send,extra={}) => ({editorFocused,draft,contains,send,...extra});
    const steps = [
        step(true,[],'\x07j',{baseline:true}),
        step(false,[copy('project.title',{project:'P'})],'\x1b[B\r',{unchanged:true}),
        step(false,[destination,related],'',{releaseFile:paths.release,unchanged:true}),
        step(false,[destination,related],related+'\r',{waitFiles:[{path:paths.settled}],baseline:true}),
        step(false,[change,destination,retry,originalChanged],copy('error.details')+'\r',{absent:[related,name],unchanged:true}),
        step(false,[copy('error.previousDetailsTitle'),name],'\x1b',{unchanged:true}),
        step(false,[destination,retry,originalChanged],retry+'\r',{absent:[related,name],unchanged:true}),
        step(true,[copy('project.selected',{id:'Q'})],'\x07q'),
    ];
    const lang = locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8';
    await fs.writeFile(paths.config,JSON.stringify({cid:f.parent,...paths,steps,columns:150,timeoutSeconds:11,
        command:[process.execPath,...moduleGuard,'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',paths.guard+'.mjs',
            '--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),cli,'conversation','ui','--home',f.home,'--conversation',f.parent],
        env:{...entryEnvironment,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',
            TERM:'xterm-256color',LANG:lang,LC_ALL:lang,NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:paths.observation}}));
    const result = JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',paths.config],{timeout:16000,maxBuffer:2**20})).stdout);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    const reopened = await openController({installationHome:f.home});
    try {
        const source = reopened.inspectConversation(f.parent);
        assert.equal(source.projectId,'Q');
        assert.equal(source.draft.text,draft);
        assert.equal(reopened.inspectConversation(child.conversationId).projectId,'P');
        assert.equal(reopened.store.one('SELECT state FROM conversation_dependencies WHERE id=?',f.child.dependency).state,'CANCELLED');
        assert.equal(reopened.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignment).state,'CANCELLED');
        assert.deepEqual(reopened.store.all('SELECT id FROM runs ORDER BY rowid'),before.runs);
        assert.deepEqual(reopened.store.all('SELECT * FROM budgets ORDER BY rowid'),before.budgets);
        assert.deepEqual(reopened.store.one('SELECT * FROM works WHERE id=?',f.sibling.work),before.sibling);
    } finally {
        await reopened.close();
    }
    f.pass();
});

for(const locale of ['en','ko'])test(`held parent project exposes child recovery, and explicit child cancellation permits scope change in ${locale}`,{timeout:25000},async t=>{
    const f=await world(t),second=await f.assign(),draft='Parent 한글 draft',childDraft='Second child 한글 draft';
    f.c.setDraft({conversationId:f.parent,expectedRevision:0,text:draft});
    const child=f.c.inspectConversation(second.target);
    f.c.setDraft({conversationId:second.target,expectedRevision:child.draft.revision,text:childDraft});
    f.c.setConversationName({conversationId:f.child.target,expectedGeneration:f.c.inspectConversation(f.child.target).generation,name:'Blocked delegated task'});
    f.c.setConversationName({conversationId:second.target,expectedGeneration:child.generation,name:'Second delegated task'});
    const preserved={parent:f.s.one('SELECT * FROM works WHERE id=?',f.parentWork),sibling:f.s.one('SELECT * FROM works WHERE id=?',f.sibling.work),budgets:f.s.all('SELECT * FROM budgets ORDER BY rowid')};
    await f.c.close();
    const observation=path.join(f.root,'current'),output=path.join(f.root,'terminal'),config=path.join(f.root,'terminal.json');
    const copy=locale==='ko'?{project:'이 대화의 프로젝트',held:'프로젝트 변경 보류',selected:'프로젝트 선택됨: Q',details:'오류 상세 확인',identity:'연결된 대화'}:
        {project:'Project for this conversation',held:'Project unchanged',selected:'Project selected: Q',details:'Error details · inspect',identity:'Related conversation'};
    const errorTitle=locale==='ko'?'오류 복구 · 다음 동작 선택':'Error recovery';
    const historical=uiText(locale,'error.previousTitle');
    const retryHeldTitle=locale==='ko'?'프로젝트 전환이 계속 보류 중 · 다음 동작 선택':'Project switch still on hold';
    const retry=locale==='ko'?'이 대화에서 Q 프로젝트로 다시 전환':'Retry switching this conversation to Q';
    const openRelated=locale==='ko'?'이 보류와 연결된 대화 열기':'Open related conversation';
    const related=openRelated+' · Blocked delegated task · '+f.child.target;
    const secondRelated=openRelated+' · Second delegated task · '+second.target;
    const openCancel=uiText(locale,'change.openCancelConfirmation');
    const back=locale==='ko'?'변경 없이 돌아가기':'Back without changes';
    const recovery=locale==='ko'?'작업 복구':'Work recovery',cancelRoute=locale==='ko'?'취소 검토':'Review cancellation';
    const cancellation=locale==='ko'?'취소 검토 · P':'Cancel · P';
    const scope=locale==='ko'?'미완료 상태의 원래 위임 및 결과 대기를 취소합니다':'any unfinished original assignment and result wait';
    const accept=locale==='ko'?'이 작업과 위임 실행을 취소하기':'Cancel this work and its delegated executions';
    const cancelled=locale==='ko'?'취소를 기록했습니다':'Cancellation recorded';
    const key=locale==='ko'?'\x10':'\x07';
    const returnHint=locale==='ko'?'Ctrl+P c · 원래 대화 찾기':'Ctrl+G c · Find the original conversation';
    const step=(editorFocused,contains,send,extra={})=>({editorFocused,draft,contains,send,...extra});
    const steps=[
        step(true,[],key+'j',{baseline:true}),
        step(false,[copy.project],'\x1b[B\r',{unchanged:true}),
        step(false,[errorTitle,copy.held,'Blocked delegated task',copy.details],copy.details+'\r',{unchanged:true}),
        step(false,[copy.identity+' Blocked delegated task · '+f.child.target],'\x1b',{unchanged:true}),
        step(false,[errorTitle,related,secondRelated],secondRelated+'\r',{unchanged:true}),
        step(true,['Second delegated task',returnHint,f.parent],key+'c',{selected:second.target,draft:childDraft,unchanged:true}),
        step(false,[uiText(locale,'navigation.title'),f.parent.slice(0,8)],f.parent+'\r',{selected:second.target,draft:childDraft,unchanged:true}),
        step(true,[copy.held],key+'e',{unchanged:true}),
        step(false,[errorTitle,retry],retry+'\r',{unchanged:true}),
        step(false,[retryHeldTitle,copy.held,'Blocked delegated task'],f.child.work+'\r',{unchanged:true}),
        step(false,[recovery,'ACTIVE'],cancelRoute+'\r',{unchanged:true}),
        step(false,[cancellation,scope,openCancel],'\r',{unchanged:true}),
        step(false,[cancellation,back],'\r',{unchanged:true}),
        step(false,[recovery,f.child.work,'ACTIVE'],'\r',{unchanged:true}),
        step(false,[retryHeldTitle],f.child.work+'\r',{unchanged:true}),
        step(false,[recovery,f.child.work,'ACTIVE'],'\x1b',{unchanged:true}),
        step(false,[retryHeldTitle],f.child.work+'\r',{unchanged:true}),
        step(false,[recovery,'ACTIVE'],cancelRoute+'\r',{unchanged:true}),
        step(false,[cancellation,scope,openCancel],'\r',{unchanged:true}),
        step(false,[cancellation],accept+'\r',{unchanged:true}),
        step(true,[cancelled],key+'e'),
        step(false,[historical,secondRelated],second.work+'\r'),
        step(false,[recovery,'ACTIVE'],cancelRoute+'\r'),
        step(false,[cancellation,scope,openCancel],'\r'),
        step(false,[cancellation],accept+'\r'),
        step(true,[cancelled],key+'e'),
        step(false,[historical,retry],retry+'\r'),
        step(true,[copy.selected],key+'q',{absent:['PROJECT_DEPENDENCY_PENDING']}),
    ];
    await fs.writeFile(config,JSON.stringify({cid:f.parent,observation,output,columns:110,timeoutSeconds:17,steps,
        command:[process.execPath,...moduleGuard,'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),cli,'conversation','ui','--home',f.home,'--conversation',f.parent,...locale==='ko'?['--command-key','ctrl+p']:[]],
        env:{...process.env,...entryEnvironment,TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:22000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
    const reopened=await openController({installationHome:f.home});
    try{
        assert.equal(reopened.inspectConversation(f.parent).projectId,'Q');assert.equal(reopened.inspectConversation(f.parent).draft.text,draft);
        assert.equal(reopened.inspectConversation(f.child.target).projectId,'P');
        assert.equal(reopened.inspectConversation(second.target).projectId,'P');
        assert.equal(reopened.inspectConversation(second.target).draft.text,childDraft);
        assert.equal(reopened.store.one('SELECT state FROM conversation_dependencies WHERE id=?',f.child.dependency).state,'CANCELLED');
        assert.equal(reopened.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignment).state,'CANCELLED');
        assert.equal(reopened.store.one('SELECT state FROM conversation_dependencies WHERE id=?',second.dependency).state,'CANCELLED');
        assert.equal(reopened.store.one('SELECT state FROM conversation_assignments WHERE id=?',second.assignment).state,'CANCELLED');
        assert.deepEqual(reopened.store.one('SELECT * FROM works WHERE id=?',f.parentWork),preserved.parent);
        assert.deepEqual(reopened.store.one('SELECT * FROM works WHERE id=?',f.sibling.work),preserved.sibling);
        assert.deepEqual(reopened.store.all('SELECT * FROM budgets ORDER BY rowid'),preserved.budgets);
    }finally{await reopened.close();}
    f.pass();
});

for (const locale of ['en', 'ko']) test('project recovery refreshes the original queued assignment when its worker starts in ' + locale, {timeout: 18000}, async t => {
    const f = await world(t), name = 'Original delegated worker';
    const draft = 'Parent draft · 한글', childDraft = 'Worker draft · 한글';
    const parent = f.c.inspectConversation(f.parent), child = f.c.inspectConversation(f.child.target);
    f.c.setConversationName({conversationId: child.conversationId, expectedGeneration: child.generation, name});
    f.c.setDraft({conversationId: parent.conversationId, expectedRevision: parent.draft.revision, text: draft});
    f.c.setDraft({conversationId: child.conversationId, expectedRevision: child.draft.revision, text: childDraft});
    const recordedChild = f.s.one('SELECT work,data FROM conversation_state WHERE conversation=?', child.conversationId);
    const recordedAssignment = f.s.one('SELECT * FROM conversation_assignments WHERE id=?', f.child.assignment);
    const recordedInput = f.s.one('SELECT * FROM conversation_inputs WHERE id=?', f.child.input);
    const advance = [
        {sql: "UPDATE conversation_assignments SET work=?,state='RUNNING' WHERE id=?", params: [f.child.work, f.child.assignment]},
        {sql: 'UPDATE conversation_state SET work=?,data=? WHERE conversation=?', params: [recordedChild.work, recordedChild.data, child.conversationId]},
        {sql: 'UPDATE conversation_inputs SET work=?,state=? WHERE id=?', params: [recordedInput.work, recordedInput.state, f.child.input]},
    ];
    // Show the queue phase of this original relationship before exposing its already allocated fixture work.
    f.s.tx(() => {
        f.s.run("UPDATE conversation_assignments SET work=NULL,state='QUEUED',data=json_remove(data,'$.result') WHERE id=?", f.child.assignment);
        f.s.run("UPDATE conversation_state SET work=NULL,data=json_remove(data,'$.runId') WHERE conversation=?", child.conversationId);
        f.s.run("UPDATE conversation_inputs SET work=NULL,state='QUEUED' WHERE id=?", f.child.input);
    });
    const queued = f.c.inspectConversationProjectDependencies({conversationId: parent.conversationId, expectedGeneration: parent.generation});
    assert.deepEqual(queued.items.map(item => [item.assignmentId, item.dependencyId, item.assignmentState, item.workId]),
        [[f.child.assignment, f.child.dependency, 'QUEUED', null]]);
    assert.equal(recordedAssignment.work, f.child.work);
    const unchanged = ['works', 'runs', 'budgets', 'sources', 'conversation_dependencies', 'effect_delegations'].map(table => {
        const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
        return {sql, rows: f.s.all(sql).map(Object.values)};
    });
    unchanged.push({sql: 'SELECT project,generation FROM conversations WHERE id=?', params: [parent.conversationId], rows: [['P', parent.generation]]});
    unchanged.push({sql: 'SELECT draft FROM conversation_views WHERE conversation=?', params: [child.conversationId], rows: [[childDraft]]});
    const expectedInputs = f.s.one('SELECT COUNT(*) AS count FROM conversation_inputs').count;
    await f.c.close();

    const paths = Object.fromEntries(['config', 'observation', 'output'].map(file => [file, path.join(f.root, file)]));
    const tr = (key, values) => uiText(locale, key, values);
    const identity = name + ' · ' + child.conversationId;
    const initial = tr('project.childQueued', {child: identity});
    const active = (locale === 'ko' ? '현재 위임 상태' : 'Current delegation state') + ' · ' + tr('state.RUNNING');
    const related = tr('error.openProjectDependency', {conversation: identity});
    const independent = tr('error.independentSelectedProject', {project: 'Q'});
    const destination = tr('error.requestedProject', {project: '"Q"'}), retry = tr('error.retryProjectSwitch', {project: 'Q'});
    const work = tr('error.work', {id: f.child.work}), details = tr('error.details'), previous = tr('error.previousDetailsTitle');
    const workTitle = tr('workRecovery.title', {id: f.child.work, state: 'ACTIVE'});
    const phase = running => ({
        sql: 'SELECT assignment.id,assignment.target,assignment.state,assignment.work FROM conversation_assignments assignment WHERE assignment.id=?',
        params: [f.child.assignment], rows: [[f.child.assignment, child.conversationId, running ? 'RUNNING' : 'QUEUED', running ? f.child.work : null]],
    });
    const step = (wait, editorFocused, contains, send, running = false, excludes = []) => ({
        wait, send, assertDraft: draft, expectedSelected: parent.conversationId,
        frame: {selected: parent.conversationId, draft, editorFocused, contains, excludes},
        queries: [...unchanged, phase(running)],
    });
    const updated = tr('error.recoveryUpdated'), opened = tr('newConversation.opened', {project: 'Q'});
    const steps = [
        step(draft, true, [draft], '\x07j'),
        step(tr('project.title', {project: 'P'}), false, [tr('project.title', {project: 'P'})], '\x1b[B\r'),
        {...step(initial, false, [initial, related, destination, retry, independent], related + '\r', false, [work]), mutations: advance},
        step(updated, false, [updated, active, related, destination, retry, independent, work], details + '\r', true, [initial]),
        step(previous, false, [previous, initial, 'QUEUED'], '\x1b', true, [f.child.work]),
        step(work, false, [active, destination, independent, work], f.child.work + '\r', true, [initial]),
        step(workTitle, false, [workTitle], '\x1b', true),
        step(independent, false, [active, related, destination, independent, work], independent + '\r', true, [initial]),
        {wait: opened, send: '\x07q', assertDraft: '', frame: {draft: '', editorFocused: true, contains: [opened]},
            queries: [...unchanged, phase(true), {sql: 'SELECT project FROM conversations JOIN interaction_view ON conversations.id=selected', rows: [['Q']]}]},
    ];
    const database = path.join(f.home, 'state/controller.sqlite');
    const lang = locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8';
    await fs.writeFile(paths.config, JSON.stringify({...paths, database, steps, columns: 180, timeoutSeconds: 10,
        noForceKill: true, expectedInputs,
        command: [process.execPath, ...moduleGuard, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import', path.resolve('tests/ui/inspection-pty-observer.mjs'), cli, 'conversation', 'ui', '--home', f.home, '--conversation', f.parent],
        env: {...entryEnvironment, HOME: f.root, GITJIG_HOME: f.home, TMPDIR: f.root, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
            TERM: 'xterm-256color', LANG: lang, LC_ALL: lang, NODE_OPTIONS: '', NODE_PATH: '', GITJIG_RESULT_OBSERVATION: paths.observation},
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', paths.config], {timeout: 15000, maxBuffer: 2 ** 20})).stdout);
    assert.deepEqual([result.exitCode, result.stages, result.terminalRestored], [0, steps.length, true]);
    const reopened = await openController({installationHome: f.home});
    try {
        assert.deepEqual(reopened.store.one('SELECT * FROM conversation_inputs WHERE id=?', f.child.input), recordedInput);
        for (const {sql, params = [], rows} of unchanged) assert.deepEqual(reopened.store.all(sql, ...params).map(Object.values), rows);
        assert.equal(reopened.inspectConversation(parent.conversationId).draft.text, draft);
        assert.equal(reopened.inspectConversation(child.conversationId).workId, f.child.work);
        assert.equal(reopened.listConversations().filter(view => view.projectId === 'Q').length, 1);
    } finally { await reopened.close(); }
    f.pass();
});

for (const locale of ['en', 'ko']) test('project recovery refreshes an unreadable original blocking work in ' + locale, {timeout: 18000}, async t => {
    const f = await world(t), draft = 'Parent keeps this unsent draft · 한글';
    const parent = f.c.inspectConversation(f.parent), child = f.c.inspectConversation(f.child.target), name = 'Original blocking worker';
    f.c.setDraft({conversationId: parent.conversationId, expectedRevision: parent.draft.revision, text: draft});
    f.c.setConversationName({conversationId: child.conversationId, expectedGeneration: child.generation, name});

    const workId = f.child.work;
    const original = f.s.one('SELECT * FROM requirements WHERE work=? ORDER BY version DESC LIMIT 1', workId);
    const unavailable = '!' + original.interpretation;
    const update = interpretation => ({
        sql: 'UPDATE requirements SET interpretation=? WHERE work=? AND version=?', params: [interpretation, workId, original.version],
    });
    const apply = ({sql, params}) => f.s.run(sql, ...params);
    f.s.tx(() => {
        apply(update(unavailable));
        assert.throws(() => f.c.inspectWork(workId));
        const observed = f.c.inspectConversationProjectDependencies({conversationId: parent.conversationId, expectedGeneration: parent.generation});
        assert.deepEqual(observed.items.map(item => [item.dependencyId, item.assignmentId, item.workId]), [[f.child.dependency, f.child.assignment, workId]]);
        apply(update(original.interpretation));
    });
    const work = f.c.inspectWork(workId);
    const unchanged = ['works', 'runs', 'budgets', 'sources', 'conversation_dependencies', 'conversation_assignments', 'conversation_inputs', 'effect_delegations'].map(table => {
        const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
        return {sql, rows: f.s.all(sql).map(Object.values)};
    });
    unchanged.push({sql: 'SELECT project,generation FROM conversations WHERE id=?', params: [parent.conversationId], rows: [['P', parent.generation]]});
    const expectedInputs = f.s.one('SELECT COUNT(*) AS count FROM conversation_inputs').count;
    await f.c.close();

    const paths = Object.fromEntries(['config', 'observation', 'output'].map(file => [file, path.join(f.root, file)]));
    const tr = (key, values) => uiText(locale, key, values);
    const destination = tr('error.requestedProject', {project: '"Q"'}), retry = tr('error.retryProjectSwitch', {project: 'Q'});
    const independent = tr('error.independentSelectedProject', {project: 'Q'});
    const workRoute = tr('error.work', {id: workId}), details = tr('error.details'), detailsTitle = tr('error.detailsTitle');
    const cannotRead = locale === 'ko' ? '일부 작업 기록을 읽을 수 없습니다' : 'Some work records could not be read';
    const refresh = tr('error.refreshProjectRecovery'), updated = tr('error.recoveryUpdated');
    const workTitle = tr('workRecovery.title', {id: workId, state: work.state});
    const exactRecord = interpretation => ({sql: 'SELECT * FROM requirements WHERE work=? AND version=?',
        params: [workId, original.version], rows: [Object.values({...original, interpretation})]});
    const step = (wait, editorFocused, contains, send, interpretation = original.interpretation, excludes = []) => ({
        wait, send, assertDraft: draft, expectedSelected: parent.conversationId,
        frame: {selected: parent.conversationId, draft, editorFocused, contains, excludes}, queries: [...unchanged, exactRecord(interpretation)],
    });
    const held = [destination, retry, independent, details];
    const unavailablePicker = [...held, cannotRead, refresh];
    const steps = [
        step(draft, true, [draft], '\x07j'),
        step(tr('project.title', {project: 'P'}), false, [tr('project.title', {project: 'P'})], '\x1b[B\r'),
        {...step(workRoute, false, [...held, workRoute, name], workId + '\r'), mutations: [update(unavailable)]},
        step(updated, false, [...unavailablePicker, updated], details + '\r', unavailable, [workRoute, 'Unexpected token']),
        step(detailsTitle, false, [detailsTitle, 'PROJECT_DEPENDENCY_PENDING', workId, f.child.dependency], '\x1b', unavailable),
        {...step(cannotRead, false, unavailablePicker, refresh + '\r', unavailable, [workRoute]), mutations: [update(original.interpretation)]},
        step(workRoute, false, [...held, workRoute], workId + '\r', original.interpretation, [cannotRead]),
        step(workTitle, false, [workTitle], '\x1b'),
        step(workRoute, false, [...held, workRoute], tr('error.back') + '\r'),
        step(draft, true, [draft], '\x07q'),
    ];
    const database = path.join(f.home, 'state/controller.sqlite'), lang = locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8';
    await fs.writeFile(paths.config, JSON.stringify({...paths, database, steps, columns: 180, timeoutSeconds: 10, expectedInputs, noForceKill: true,
        command: [process.execPath, ...moduleGuard, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import', path.resolve('tests/ui/inspection-pty-observer.mjs'), cli, 'conversation', 'ui', '--home', f.home, '--conversation', f.parent],
        env: {...entryEnvironment, HOME: f.root, GITJIG_HOME: f.home, TMPDIR: f.root, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
            TERM: 'xterm-256color', LANG: lang, LC_ALL: lang, NODE_OPTIONS: '', NODE_PATH: '', GITJIG_RESULT_OBSERVATION: paths.observation},
    }));
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', paths.config], {timeout: 15000, maxBuffer: 2 ** 20})).stdout);
    assert.deepEqual([result.exitCode, result.stages, result.terminalRestored], [0, steps.length, true]);
    const reopened = await openController({installationHome: f.home});
    try {
        for (const {sql, params = [], rows} of [...unchanged, exactRecord(original.interpretation)]) {
            assert.deepEqual(reopened.store.all(sql, ...params).map(Object.values), rows);
        }
        assert.equal(reopened.inspectConversation(parent.conversationId).draft.text, draft);
        assert.equal(reopened.inspectWork(workId).workId, workId);
    } finally { await reopened.close(); }
    f.pass();
});
