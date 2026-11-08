import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';

const execute=promisify(execFile);
for(const [key,character]of [['g','ㅎ'],['q','ㅂ'],['p','ㅔ']])for(const locale of ['en','ko'])
test(`actual terminal preserves Korean drafts and accepts Korean Ctrl+${key.toUpperCase()} in ${locale} UI`,{timeout:20000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-command-input-'))),home=path.join(root,'home');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained command input terminal '+root);});
    const controller=await openController({installationHome:home});
    const cid=controller.createConversation().conversationId;await controller.close();
    const file=path.join(root,'terminal.json'),observation=file+'.current',output=file+'.terminal';
    const draft='ㅎ한글 본문',title=locale==='ko'?'명령 ·':'Commands ·',chord=`\x1b[${character.codePointAt(0)};5u`;
    const step=(editorFocused,text,send,extra={})=>({editorFocused,draft:text,contains:editorFocused?[]:[title],send,...extra});
    const steps=[
        step(true,'','ㅎ',{baseline:true}),
        step(true,'ㅎ','\x1b[200~한글 본문\x1b[201~',{unchanged:true}),
        step(true,draft,`\x1b[${character.codePointAt(0)};5:3u`,{unchanged:true}),
        step(true,draft,`\x1b[${'ㅁ'.codePointAt(0)};5u`,{unchanged:true}),
        step(true,draft,`\x1b[${'ㅏ'.codePointAt(0)};5u`,{unchanged:true}),
        step(true,'',`\x1b[${'ㅛ'.codePointAt(0)};5u`,{unchanged:true}),
        step(true,draft,chord,{unchanged:true}),
        step(false,draft,chord,{unchanged:true}),
        step(true,draft,String.fromCharCode(key.charCodeAt(0)-96),{unchanged:true}),
        step(false,draft,'ㅂ',{unchanged:true}),
    ];
    await fs.writeFile(file,JSON.stringify({cid,observation,output,steps,timeoutSeconds:12,
        command:[process.execPath,'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('dist/cli/entry.js'),
            'conversation','ui','--home',home,'--conversation',cid,'--command-key',`ctrl+${key}`],
        env:{...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,GITJIG_RESULT_OBSERVATION:observation,
            LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
    const reopened=await openController({installationHome:home});
    try{assert.equal(reopened.inspectConversation(cid).draft.text,draft);assert.equal(reopened.inspectConversation(cid).workId,null);}
    finally{await reopened.close();}
    passed=true;
});
