import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ordinaryTaskWorld as world} from './ordinary-task-cancellation-fixture.mjs';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
for(const locale of ['en','ko'])test(`ordinary delegated child cancellation is reachable from a held project in ${locale}`,{timeout:25000},async t=>{
    const f=await world(t);const draft='Preserved parent draft';
    f.c.setDraft({conversationId:f.parent,expectedRevision:f.c.inspectConversation(f.parent).draft.revision,text:draft});
    f.c.setConversationName({conversationId:f.child.conversationId,expectedGeneration:f.c.inspectConversation(f.child.conversationId).generation,name:'Ordinary delegated task'});
    await f.c.close();const observation=path.join(f.root,'current'),output=path.join(f.root,'terminal'),config=path.join(f.root,'pty.json');
    const step=(editorFocused,contains,send,extra={})=>({editorFocused,draft,contains,send,...extra});
    const steps=[
        step(true,[],'\x07j',{baseline:true}),
        step(false,[locale==='ko'?'이 대화의 프로젝트':'Project for this conversation'],'\r',{unchanged:true}),
        step(true,[locale==='ko'?'프로젝트 변경 보류':'Project unchanged','Ordinary delegated task'],'\x07e',{unchanged:true}),
        step(false,['Error recovery'],f.child.workId+'\r',{unchanged:true}),
        step(false,['Work recovery'],'Review cancellation of this original work\r',{unchanged:true}),
        step(false,['Review original work cancellation','Parent and sibling work','kept. Preserve input'],'\r',{unchanged:true}),
        step(false,['Cancel original work','Back without cancellation'],'Cancel this original work and its delegated tasks\r',{unchanged:true}),
        step(true,['Work cancellation recorded'],'\x07j'),
        step(false,[locale==='ko'?'이 대화의 프로젝트':'Project for this conversation'],'\r'),
        step(true,[locale==='ko'?'프로젝트 선택됨: P':'Project selected: P'],'\x07q',{absent:['PROJECT_DEPENDENCY_PENDING']}),
    ];
    await fs.writeFile(config,JSON.stringify({cid:f.parent,observation,output,steps,timeoutSeconds:12,
        command:[process.execPath,'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.parent],
        env:{...process.env,TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',GITJIG_RESULT_OBSERVATION:observation,NODE_OPTIONS:'',NODE_PATH:''}}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:22000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    const c=await openController({installationHome:f.home});try{
        assert.equal(c.inspectConversation(f.parent).projectId,'P');assert.equal(c.inspectConversation(f.parent).draft.text,draft);
        assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignmentId).state,'CANCELLED');
        assert.equal(c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',f.child.assignmentId).state,'CANCELLED');
    }finally{await c.close();}f.pass();
});
