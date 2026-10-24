import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {managedWorld} from './managed-change-fixture.mjs';
import {workLedger} from '../controller/change-registry-fixture.mjs';
import {openController} from '../../dist/controller/index.js';

const execute=promisify(execFile);

test('actual work discovery carries resume to its original review; Cancel preserves both drafts and dispatches nothing', {timeout:30000}, async t=>{
    const f=await managedWorld(t),choice=f.c.getConversationModelChoice(f.cid);
    // Real original admission/capture. Only the fixture's drive boundary is held;
    // this test makes no successful planning, model or runtime execution claim.
    const begun=await f.c.startConversationChange({conversationId:f.cid,expectedGeneration:0,expectedModelRevision:choice.revision,
        projectId:'P',request:'Original resume handoff intent',applicationModelBaseline:{...await f.models.baseline('P',choice),
            source:{kind:'conversation',conversationId:f.cid,choiceRevision:choice.revision}}});
    assert.equal(f.calls.length,1);
    const ownerDraft='  ORIGINAL unsent 한국어 request\nKeep this exact second line  ',otherDraft='  OTHER unrelated 한국어 request  ';
    for(const [conversationId,text] of [[f.cid,ownerDraft],[f.other,otherDraft]])
        f.c.setDraft({conversationId,expectedRevision:0,text});
    const before=workLedger(f.c),file=path.join(f.root,'resume-handoff.json'),observation=file+'.current',output=file+'.terminal';
    await f.c.close();
    const step=(selected,editorFocused,draft,contains,send,extra={})=>({selected,editorFocused,draft,contains,send,...extra});
    const other=(editorFocused,contains,send,extra)=>step(f.other,editorFocused,otherDraft,contains,send,extra);
    const owner=(editorFocused,contains,send,extra)=>step(f.cid,editorFocused,ownerDraft,contains,send,extra);
    const unchanged={unchanged:true},clean={...unchanged,absent:['Recovery source changed','Change inspection target changed','Original source opened; choose Resume again']};
    const steps=[
        other(true,['Model: future'],'\x07',{baseline:true}),
        other(false,['Commands · Ctrl+G'],'/',unchanged),
        other(false,['Gitjig commands · search'],'/work\r',unchanged),
        other(false,['Original work and allowances'],'Original resume handoff intent\r',unchanged),
        other(false,['Work recovery · #'+begun.workId],'Review resume\r',unchanged),
        other(false,['Resume uses its original conversation','no execution yet'],'\r',unchanged),
        owner(false,['Resume · P · #'+begun.workId,'Resume this original work','Cancel'],'Cancel\r',unchanged),
        owner(true,['Model: original'],'\x07',clean),
        owner(false,['Commands · Ctrl+G'],'c',clean),
        owner(false,['Conversations'],f.other+'\r',clean),
        other(true,['Model: future'],'\x07',clean),
        other(false,['Commands · Ctrl+G'],'q',clean),
    ];
    await fs.writeFile(file,JSON.stringify({cid:f.other,observation,output,steps,timeoutSeconds:12,
        command:[process.execPath,'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
            path.resolve('dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.other],
        env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:path.join(f.home,'artifacts'),GITJIG_RESULT_OBSERVATION:observation,
            LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''}}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:28000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    const c=await openController({installationHome:f.home});
    try{
        assert.deepEqual(workLedger(c),before,'Opening and cancelling original resume must preserve the execution ledger');
        assert.equal(c.inspectConversation(f.cid).draft.text,ownerDraft);
        assert.equal(c.inspectConversation(f.other).draft.text,otherDraft);
        assert.equal(c.inspectConversation(f.cid).workId,begun.workId);
        assert.equal(c.inspectConversation(f.other).workId,null);
    }finally{await c.close();}
    f.pass();
});
