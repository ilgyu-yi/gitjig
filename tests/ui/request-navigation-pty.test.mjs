import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
for(const boundary of ['preparing','accepted','edited'])test(`actual terminal ${boundary}: navigation preserves original request admission and acknowledgement`,{timeout:12000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-request-navigation-'))),home=path.join(root,'home');
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained request navigation fixture '+root);});
    const c=await openController({installationHome:home}),a=c.createConversation(),b=c.createConversation();await c.close();
    const entered=path.join(root,'entered'),release=path.join(root,'release'),receipt=path.join(root,'receipt.json'),observation=path.join(root,'observation'),config=path.join(root,'config.json');
    const original='Original 한국어 request',newer='Newer unsent 한국어 draft';
    const editor=(id,draft,send,extra={})=>({selected:id,editorFocused:true,draft,send,...extra});
    const selector=send=>({selected:a.conversationId,editorFocused:false,draft:original,send});
    const steps=[editor(a.conversationId,'',original+'\r'),editor(a.conversationId,original,boundary==='edited'?'\x15'+newer:'\x1bOQ',{waitFiles:[{path:entered}]})];
    if(boundary==='edited')steps.push(editor(a.conversationId,newer,'',{releaseFile:release}),editor(a.conversationId,newer,'\x07q',{contains:['Input target or exact draft changed before file capture']}));
    else steps.push(selector(b.conversationId+'\r'),editor(b.conversationId,'','',{releaseFile:release}),editor(b.conversationId,'','\x1bOQ'),{selected:b.conversationId,editorFocused:false,draft:'',send:a.conversationId+'\r'},editor(a.conversationId,'','\x07q',{contains:['Controlled stop after original input admission']}));
    const env={...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation};delete env.NODE_TEST_CONTEXT;
    await fs.writeFile(config,JSON.stringify({home,source:a.conversationId,other:b.conversationId,boundary,entered,release,receipt,cid:a.conversationId,observation,output:path.join(root,'terminal'),timeoutSeconds:7,releaseFilesOnFailure:[release],command:[process.execPath,'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('tests/ui/request-navigation-child.mjs'),config],env,steps}));
    const actual=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:10000,maxBuffer:2**20})).stdout);
    assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);
    const result=JSON.parse(await fs.readFile(receipt,'utf8'));assert.equal(result.runs.length,0);assert.equal(result.other.draft.text,'');
    assert.equal(result.dispatches,boundary==='edited'?0:1);assert.equal(result.inputs.length,boundary==='edited'?0:1);assert.equal(result.source.draft.text,boundary==='edited'?newer:'');
    if(boundary!=='edited'){assert.equal(result.inputs[0].conversation,a.conversationId);assert.equal(result.inputs[0].text,original);assert.equal(result.inputs[0].state,'QUEUED');}
    passed=true;
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
