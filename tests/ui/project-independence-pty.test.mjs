import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {ownerAssignmentCancellationWorld as world} from '../controller/owner-assignment-cancellation-fixture.mjs';
import {openController} from '../../dist/controller/index.js';
import {nodePreloads} from '../helpers/node-preloads.mjs';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);
const rows=s=>Object.fromEntries(['works','runs','budgets','obligations','role_launches','role_outputs','capacity_leases','conversation_inputs','conversation_assignments','conversation_dependencies','requirements','results','observations','effect_delegations','effect_operations','conversation_results','conversation_directions','change_state','change_versions'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]));
for (const locale of ['en', 'ko']) for (const variant of ['round trip', 'eight holds', 'activation failure', 'readiness']) test(
    `independent project navigation preserves held original tasks in ${locale} · ${variant}`, {timeout: 30000}, async t => {
    const crowded = variant === 'eight holds', activationFailure = variant === 'activation failure', readiness = variant === 'readiness';
    const f=await world(t),draft='Parent 한글 draft';
    if (crowded) {
        for (let index=1;index<8;index++) await f.assign();
        assert.equal(f.s.one("SELECT COUNT(*) n FROM conversation_dependencies WHERE waiting=? AND state='PENDING'",f.parent).n,8);
    }
    f.c.setDraft({conversationId:f.parent,expectedRevision:0,text:draft});
    const before=rows(f.s),sources=f.s.all('SELECT * FROM sources ORDER BY rowid'),conversations=f.s.all('SELECT * FROM conversations ORDER BY rowid'),states=f.s.all('SELECT * FROM conversation_state ORDER BY rowid'),views=f.s.all('SELECT * FROM conversation_views ORDER BY rowid'),relations=f.s.all('SELECT * FROM conversation_relations ORDER BY rowid');
    const database=f.s.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file;
    await f.c.close();
    const observation=path.join(f.root,'current'),output=path.join(f.root,'terminal'),config=path.join(f.root,'terminal.json'),guard=path.join(f.root,'no-execution.json');
    const copy=locale==='ko'?{project:'이 대화의 프로젝트',held:'프로젝트 변경 보류',error:'오류 복구 · 다음 동작 선택',details:'오류 상세 · 읽기 전용',independent:'Q 프로젝트를 새 독립 대화에서 열기',opened:'독립 대화를 열었습니다 · Q'}:{project:'Project for this conversation',held:'Project unchanged',error:'Error recovery',details:'Error details · inspection only',independent:'Open Q in an independent conversation',opened:'Independent conversation opened · Q'};
    const retry=locale==='ko'?'이 대화에서 Q 프로젝트로 다시 전환':'Retry switching this conversation to Q';
    const destination=uiText(locale,'error.requestedProject',{project:'"Q"'});
    const visibleActions=[copy.error,destination,copy.held,copy.independent,...crowded?[retry]:[]];
    const commandKey=locale==='ko'?'\x10':'\x07';
    const recoveryHint=locale==='ko'?'Ctrl+P e · Q 프로젝트 전환 보류':'Ctrl+G e · Project switch to Q on hold';
    const [returnHeading,returnCommand]=uiText(locale,'newConversation.returnToSource',{conversation:f.parent}).split('\n');
    const openCreated=uiText(locale,'error.openCreatedConversation');
    const activationDiagnostic='CONVERSATION_CREATED';
    const q=(sql,params,rows)=>({sql,params,rows});
    const parent=q('SELECT selected FROM interaction_view',[],[[f.parent]]);
    const step=(wait,send,contains,extra={})=>({wait,send,frame:{contains,...(extra.frame??{})},...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='frame'))});
    const ready = uiText(locale,'ready.title');
    const projectRow = uiText(locale,'ready.project',{project:'P'});
    const originalWorkUnavailable = uiText(locale,'ready.originalWorkUnavailable');
    const readyFrame = [ready,projectRow,originalWorkUnavailable];
    const registry = uiText(locale,'workRecovery.projectRegistryTitle',{project:'P'});
    const projectPicker = step(copy.project,'\x1b[B\r',[copy.project],{queries:[parent]});
    const holdBack = step(copy.error,'\x1b',visibleActions,{frame:{selected:f.parent,draft,editorFocused:false},queries:[parent,q('SELECT COUNT(*) FROM conversations',[],[[conversations.length]])]});
    const steps=[
        step('/ready',commandKey+(readiness?'t':'j'),['/ready'],{frame:{selected:f.parent,draft,editorFocused:true},queries:[parent]}),
        ...(readiness ? [
            step(ready,originalWorkUnavailable+'\r',readyFrame,{queries:[parent]}),
            step(registry,'\x1b',[registry],{queries:[parent]}),
            step(ready,projectRow+'\r',readyFrame,{queries:[parent]}),
            projectPicker, holdBack,
            step(ready,projectRow+'\r',readyFrame,{queries:[parent]}),
            projectPicker,
        ] : [
            projectPicker, holdBack,
            step(copy.held,commandKey+'e',[copy.held,recoveryHint],{frame:{selected:f.parent,draft,editorFocused:true}}),
        ]),
        ...crowded?[]:[
            step(copy.error,'\r',[copy.error],{queries:[parent]}),
            step('/new root','\x1b',[copy.details,'PROJECT_DEPENDENCY_PENDING','/new root','/project'],{queries:[parent]}),
            step(copy.error,uiText(locale,'error.allWork')+'\r',visibleActions,{queries:[parent]}),
            step(registry,'\x1b',[registry],{queries:[parent]}),
        ],
        step(copy.error,copy.independent+'\r',visibleActions,{queries:[parent]}),
        ...activationFailure?[
            step(activationDiagnostic,commandKey+'e',[activationDiagnostic],{frame:{selected:f.parent,draft,editorFocused:true},queries:[
                parent,q('SELECT COUNT(*) FROM conversations',[],[[conversations.length+1]])]}),
            step(copy.error,openCreated+'\r',[openCreated],{queries:[parent]}),
        ]:[],
        step(activationFailure?returnHeading:copy.opened,crowded?commandKey+'q':returnCommand+'\x1b\r',
            [...activationFailure?[]:[copy.opened],...crowded?[]:[returnHeading,returnCommand]],{frame:{draft:'',editorFocused:true},queries:[
            q("SELECT COUNT(*) FROM conversations c JOIN interaction_view v ON c.id=v.selected JOIN conversation_state s ON s.conversation=c.id WHERE c.id<>? AND c.project='Q' AND c.generation=0 AND c.history IS NULL AND s.work IS NULL AND NOT EXISTS(SELECT 1 FROM conversation_relations r WHERE r.child=c.id AND r.parent IS NOT NULL)",[f.parent],[[1]]),
            q('SELECT draft FROM conversation_views WHERE conversation=?',[f.parent],[[draft]]),
            q('SELECT COUNT(*) FROM runs',[],[[before.runs.length]]),q('SELECT COUNT(*) FROM conversation_inputs',[],[[before.conversation_inputs.length]])]}),
        ...crowded?[]:[
            step(activationFailure?activationDiagnostic:copy.held,commandKey+'e',
                activationFailure?[activationDiagnostic]:[copy.held,recoveryHint],{frame:{selected:f.parent,draft,editorFocused:true},queries:[parent]}),
            step(copy.error,'\x1b',activationFailure?[openCreated]:visibleActions,{queries:[parent]}),
            step(activationFailure?activationDiagnostic:copy.held,commandKey+'q',[],{frame:{selected:f.parent,draft,editorFocused:true},queries:[parent]}),
        ],
    ];
    await fs.writeFile(path.join(f.root,'before.json'),JSON.stringify({before,sources,conversations,states,views,relations}));
    await fs.writeFile(config,JSON.stringify({database,observation,output,columns:crowded||activationFailure?80:120,...crowded?{rows:24}:{},timeoutSeconds:20,gracefulShutdownSeconds:2,steps,
        command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/navigation-no-execution.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.parent,...locale==='ko'?['--command-key','ctrl+p']:[]],
        env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',SHELL:'/bin/sh',TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation,GITJIG_NAVIGATION_RECEIPT:guard,
            ...activationFailure?{GITJIG_TEST_FAIL_ACTIVATION_FROM:f.parent}:{}}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',config],{timeout:25000,maxBuffer:2**20})).stdout);
    assert.deepEqual(receipt,{exitCode:0,stages:steps.length,terminalRestored:true,alternateEntered:true,alternateExited:true});
    const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
    assert.equal(progress.forceKilled,false);assert.equal(progress.outputTruncated,false);assert.equal(progress.error,null);
    for(const [stage, action] of steps.entries()) {
        if (action.wait !== copy.error && action.wait !== copy.held) continue;
        const frame=JSON.parse(await fs.readFile(output+'.frame-'+stage+'.json','utf8')).frame.join('\n');
        assert.ok(!frame.includes('PROJECT_DEPENDENCY_PENDING'));
    }
    assert.deepEqual(JSON.parse(await fs.readFile(guard,'utf8')),{process:0,network:0,model:0,run:0});
    const reopened=await openController({installationHome:f.home});
    try{
        const s=reopened.store;assert.deepEqual(rows(s),before);
        for(const original of conversations)assert.deepEqual(s.one('SELECT * FROM conversations WHERE id=?',original.id),original);
        assert.equal(reopened.inspectConversation(f.parent).draft.text,draft);
        for(const original of states){
            const actual=s.one('SELECT * FROM conversation_state WHERE conversation=?',original.conversation);
            // Selecting the original conversation records its human-use timestamp.
            if(original.conversation===f.parent){assert.ok(actual.human_used>original.human_used);actual.human_used=original.human_used;}
            assert.deepEqual(actual,original);
        }
        for(const original of views)assert.deepEqual(s.one('SELECT * FROM conversation_views WHERE conversation=?',original.conversation),original);
        assert.deepEqual(s.all('SELECT * FROM conversation_relations ORDER BY rowid').slice(0,relations.length),relations);
        const selected=s.one('SELECT selected FROM interaction_view').selected;
        const created=s.one("SELECT id FROM conversations WHERE project='Q'").id;
        assert.equal(selected,crowded?created:f.parent);
        assert.deepEqual({...s.one('SELECT * FROM conversation_relations WHERE child=?',created)},{child:created,parent:null,revision:0});
        assert.equal(reopened.inspectConversation(created).projectId,'Q');
        assert.deepEqual(s.all('SELECT * FROM sources ORDER BY rowid'),sources);
        assert.equal(s.one('SELECT COUNT(*) AS n FROM conversations').n,conversations.length+1);
        await fs.writeFile(path.join(f.root,'result.json'),JSON.stringify({receipt,progress,selected,locale,before,after:rows(s)}));
    }finally{await reopened.close();}
    if(process.env.GITJIG_UI_EVIDENCE_ROOT){
        const destination=path.join(process.env.GITJIG_UI_EVIDENCE_ROOT,
            variant==='round trip'?locale:locale+'-'+variant.replaceAll(' ','-'));await fs.mkdir(destination,{recursive:true,mode:0o700});
        // A closed evidence copy, not a replacement runnable fixture or Native custody.
        await fs.cp(f.root,path.join(destination,'closed-fixture'),{recursive:true,errorOnExist:true,force:false});
    }
    f.pass();
});

for (const locale of ['en', 'ko']) for (const unavailable of [false, true]) test(`a cold terminal retains a project switch held by historical work with ${unavailable ? 'unavailable' : 'readable'} evidence in ${locale}`, {timeout: 25000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-project-settlement-pty-')));
    const home = path.join(root, 'home'), database = path.join(home, 'state/controller.sqlite');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained terminal fixture ' + root);
    });
    const controller = await openController({installationHome: home});
    const draft = '/project Q';
    const conversationId = controller.createConversation().conversationId;
    let workId, currentWorkId, before;
    try {
        for (const projectId of ['P', 'Q']) {
            const sourceRoot = path.join(root, projectId);
            await fs.mkdir(sourceRoot);
            await fs.writeFile(path.join(sourceRoot, 'file.txt'), 'Original project file');
            await controller.registerProject({id: projectId, sourceRoot});
        }
        controller.setConversationProject({conversationId, projectId: 'P', expectedGeneration: 0});
        controller.setDraft({conversationId, expectedRevision: 0, text: draft});
        ({workId} = await controller.beginChange({projectId: 'P', request: 'Inspect original retained cleanup'}));
        controller.store.run("UPDATE works SET state='QUARANTINED',data=json_set(data,'$.conversation',?) WHERE id=?", conversationId, workId);
        controller.store.run("UPDATE change_state SET phase='REVIEW_READY' WHERE work=?", workId);
        ({workId: currentWorkId} = await controller.beginChange({projectId: 'P', request: 'Current completed task'}));
        controller.store.run("UPDATE works SET state='DELIVERED',data=json_set(data,'$.conversation',?) WHERE id=?", conversationId, currentWorkId);
        controller.store.run("UPDATE change_state SET phase='REVIEW_READY' WHERE work=?", currentWorkId);
        controller.store.run('UPDATE conversation_state SET work=? WHERE conversation=?', currentWorkId, conversationId);
        before = rows(controller.store);
    } finally {
        await controller.close();
    }
    const observation = path.join(root, 'current'), output = path.join(root, 'terminal');
    const config = path.join(root, 'terminal.json'), guard = path.join(root, 'guard.json');
    const language = locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8';
    const held = uiText(locale, 'project.workUnknown'), originalWork = uiText(locale, 'error.work', {id: workId});
    const unreadable = locale === 'ko'
        ? '프로젝트 변경 보류 · 원래 작업의 상태를 읽을 수 없습니다'
        : 'Project unchanged · could not read the original work status';
    const independent = locale === 'ko' ? 'Q 프로젝트를 새 독립 대화에서 열기' : 'Open Q in an independent conversation';
    const opened = uiText(locale, 'newConversation.opened', {project: 'Q'}).split(' · ').slice(0, 2).join(' · ');
    const retry = uiText(locale, 'error.retryProjectSwitch', {project:'Q'});
    const preload = path.join(root, 'work-read.mjs'), release = path.join(root, 'allow-work-read');
    const cli = await fs.realpath(process.env.GITJIG_TEST_CLI_ENTRY ?? path.resolve('dist/cli/entry.js'));
    if (unavailable) await fs.writeFile(preload, `import { existsSync } from 'node:fs';
import { Controller } from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(cli), '../controller/controller.js')).href)};
const inspect = Controller.prototype.inspectConversationProjectWorkHolds;
Controller.prototype.inspectConversationProjectWorkHolds = function (...args) {
    if (!existsSync(${JSON.stringify(release)})) throw Error('Controlled unavailable work projection');
    return inspect.apply(this, args);
};
`);
    const steps = [
        {wait: draft, send: '\r'},
        ...(unavailable ? [
            {wait: unreadable, frame: {contains: [unreadable, retry, independent], draft, selected: conversationId, editorFocused: false}, releaseFile: release, send: retry+'\r'},
            {wait: held, frame: {contains: [held, originalWork, independent], draft, selected: conversationId, editorFocused: false}, send: '\x1b'},
            {wait: held, frame: {contains: [held], draft, selected: conversationId, editorFocused: true}, send: '\x07e'},
        ] : [
            {wait: uiText(locale, 'error.title'), frame: {contains: [held, originalWork, independent], draft, selected: conversationId, editorFocused: false}, send: originalWork + '\r'},
        ]),
        ...(unavailable ? [{wait: uiText(locale, 'error.title'), frame: {contains: [originalWork, independent]}, send: originalWork + '\r'}] : []),
        {wait: uiText(locale, 'workRecovery.settlementUnconfirmed'), send: '\x1b'},
        {wait: uiText(locale, 'error.title'), send: independent + '\r'},
        {wait: opened, send: '\x07q'},
    ];
    await fs.writeFile(config, JSON.stringify({database, observation, output, steps, columns: 120, timeoutSeconds: 16, gracefulShutdownSeconds: 2,
        command: [process.execPath, ...nodePreloads(), '--import', path.resolve('tests/ui/navigation-no-execution.mjs'),
            ...(unavailable ? ['--import', preload] : []),
            '--import', path.resolve('tests/ui/inspection-pty-observer.mjs'),
            cli, 'conversation', 'ui', '--home', home, '--conversation', conversationId],
        env: {HOME: root, GITJIG_HOME: home, TMPDIR: root, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', USER: 'gitjig-fixture',
            TERM: 'xterm-256color', LANG: language, LC_ALL: language, GITJIG_RESULT_OBSERVATION: observation, GITJIG_NAVIGATION_RECEIPT: guard}}));
    const receipt = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], {timeout: 20000})).stdout);
    assert.deepEqual(receipt, {exitCode: 0, stages: steps.length, terminalRestored: true, alternateEntered: true, alternateExited: true});
    if (unavailable) {
        const firstMenu = JSON.parse(await fs.readFile(output + '.frame-1.json', 'utf8')).frame.join('\n');
        assert.ok(!firstMenu.includes(originalWork), firstMenu);
        assert.ok(!firstMenu.includes(uiText(locale, 'error.work', {id: currentWorkId})), firstMenu);
    }
    const menu = JSON.parse(await fs.readFile(output + '.frame-' + (unavailable ? 4 : 1) + '.json', 'utf8')).frame.join('\n');
    assert.ok(!menu.includes(uiText(locale, 'error.work', {id: currentWorkId})), menu);
    assert.deepEqual(JSON.parse(await fs.readFile(guard, 'utf8')), {process: 0, network: 0, model: 0, run: 0});
    const reopened = await openController({installationHome: home});
    try {
        const original = reopened.inspectConversation(conversationId);
        assert.equal(original.projectId, 'P');
        assert.equal(original.generation, 1);
        assert.equal(original.workId, currentWorkId);
        assert.equal(original.draft.text, draft);
        const current = reopened.inspectConversation(reopened.store.one('SELECT selected FROM interaction_view').selected);
        assert.notEqual(current.conversationId, conversationId);
        assert.equal(current.projectId, 'Q');
        assert.equal(current.workId, null);
        assert.equal(current.parentId, null);
        assert.deepEqual(rows(reopened.store), before);
    } finally {
        await reopened.close();
    }
    passed = true;
});
