import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {shared,target} from '../contributions/publication-fixture.mjs';
const execute=promisify(execFile);
test('actual no-execution terminal discovers and inspects original publication without credentials or IDs',{timeout:12000},async t=>{
    const f=await shared();let passed=false;t.after(()=>f.close({preserve:!passed}));const targetId=f.c.registerPublicationTarget({target,visibility:'public'}).targetId;
    const op=await f.c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body:'Original immutable owner request'}}),source=f.c.createConversation().conversationId,home=f.c.applicationHome(),file=path.join(f.root,'publication-ui.json');
    const tables=['effect_operations','effect_targets','effect_delegations','effect_receipts','works','runs','budgets','sources','obligations'];
    const checks=tables.map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(row=>Object.values(row))})),calls=f.requests.length;await f.c.close();
    const steps=[
        {wait:'Model: not selected',send:'KEEP 한국어\x07t'},
        {wait:'Setup and next actions',send:'More settings\r'}, {wait:'More settings and details',send:'Repository management\r'},
        {wait:'Repository management · owner actions',send:'Retained publications\r'},
        {wait:'Retained publications · recorded facts',queries:checks,send:'owner/repo\r'},
        {wait:'Original publication · '+op.operationId,send:'Inspect original publication facts\r'},
        {wait:'Original publication · phase, transport and observation remain separate',queries:checks,send:'\x1b'},
        {wait:'Retained publications · recorded facts',send:'Back\r'},
        {wait:'Repository management · owner actions',send:'Close\r'},
        {wait:'More settings and details',assertDraft:'KEEP 한국어',queries:checks,send:'Return to request\r'},
        {wait:'KEEP 한국어',assertDraft:'KEEP 한국어',queries:checks,send:'\x15/quit\x1b\r'},
    ];
    const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js','conversation','ui','--conversation',source],env,steps,timeoutSeconds:6,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
    try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(f.requests.length,calls);assert.doesNotMatch(await fs.readFile(file+'.terminal','utf8'),/fixture-original/);passed=true;}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}
});
