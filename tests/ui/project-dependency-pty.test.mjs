import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ownerAssignmentCancellationWorld as world} from '../controller/owner-assignment-cancellation-fixture.mjs';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);

for(const locale of ['en','ko'])test(`held parent project exposes child recovery, and explicit child cancellation permits scope change in ${locale}`,{timeout:25000},async t=>{
    const f=await world(t),draft='Parent 한글 draft';
    f.c.setDraft({conversationId:f.parent,expectedRevision:0,text:draft});
    f.c.setConversationName({conversationId:f.child.target,expectedGeneration:f.c.inspectConversation(f.child.target).generation,name:'Blocked delegated task'});
    const preserved={parent:f.s.one('SELECT * FROM works WHERE id=?',f.parentWork),sibling:f.s.one('SELECT * FROM works WHERE id=?',f.sibling.work),budgets:f.s.all('SELECT * FROM budgets ORDER BY rowid')};
    await f.c.close();
    const observation=path.join(f.root,'current'),output=path.join(f.root,'terminal'),config=path.join(f.root,'terminal.json');
    const copy=locale==='ko'?{project:'이 대화의 프로젝트',held:'프로젝트 변경 보류',selected:'프로젝트 선택됨: Q'}:{project:'Project for this conversation',held:'Project unchanged',selected:'Project selected: Q'};
    const step=(editorFocused,contains,send,extra={})=>({editorFocused,draft,contains,send,...extra});
    const steps=[
        step(true,[],'\x07j',{baseline:true}),
        step(false,[copy.project],'\x1b[B\r',{unchanged:true}),
        step(true,[copy.held,'Blocked delegated task'],'\x07e',{unchanged:true}),
        step(false,['Error recovery'],f.child.work+'\r',{unchanged:true}),
        step(false,['Work recovery','ACTIVE'],'Review cancellation\r',{unchanged:true}),
        step(false,['Cancel · P'],'Inspect full request and limits\r',{unchanged:true}),
        step(false,['Its unfinished original assignment and result wait are cancelled as well'],'\r',{unchanged:true}),
        step(false,['Cancel · P'],'Cancel this work and its delegated executions\r',{unchanged:true}),
        step(true,['Cancellation recorded'],'\x07j'),
        step(false,[copy.project],'\x1b[B\r'),
        step(true,[copy.selected],'\x07q',{absent:['PROJECT_DEPENDENCY_PENDING']}),
    ];
    await fs.writeFile(config,JSON.stringify({cid:f.parent,observation,output,timeoutSeconds:17,steps,
        command:[process.execPath,'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.parent],
        env:{...process.env,TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:22000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
    const reopened=await openController({installationHome:f.home});
    try{
        assert.equal(reopened.inspectConversation(f.parent).projectId,'Q');assert.equal(reopened.inspectConversation(f.parent).draft.text,draft);
        assert.equal(reopened.inspectConversation(f.child.target).projectId,'P');
        assert.equal(reopened.store.one('SELECT state FROM conversation_dependencies WHERE id=?',f.child.dependency).state,'CANCELLED');
        assert.equal(reopened.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignment).state,'CANCELLED');
        assert.deepEqual(reopened.store.one('SELECT * FROM works WHERE id=?',f.parentWork),preserved.parent);
        assert.deepEqual(reopened.store.one('SELECT * FROM works WHERE id=?',f.sibling.work),preserved.sibling);
        assert.deepEqual(reopened.store.all('SELECT * FROM budgets ORDER BY rowid'),preserved.budgets);
    }finally{await reopened.close();}
    f.pass();
});
