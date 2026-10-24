import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {integrationWorld} from '../controller/integration-registry-fixture.mjs';
const execute=promisify(execFile);
test('actual no-execution terminal discovers retained integration and preserves source draft and ledger',{timeout:12000},async t=>{
 const f=await integrationWorld(t),op=await f.prepare(),conversation=f.c.createConversation().conversationId,file=path.join(f.root,'integration-ui.json'),tables=['effect_operations','effect_targets','effect_delegations','effect_receipts','works','runs','budgets','sources','obligations'],checks=tables.map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(row=>Object.values(row))}));await f.c.close();
 const steps=[{wait:'Model: not selected',send:'KEEP 한국어\x07t'},{wait:'Setup and next actions',send:'More settings\r'}, {wait:'More settings and details',send:'Repository management\r'},{wait:'Repository management · owner actions',send:'Retained integrations\r'},{wait:'Retained integrations · recorded facts',queries:checks,send:'local-git\r'},{wait:'Original integration · '+op.operationId,send:'Inspect original integration facts\r'},{wait:'Original integration · phase, transport and containment remain separate',queries:checks,send:'\x1b'},{wait:'Retained integrations · recorded facts',send:'Back\r'},{wait:'Repository management · owner actions',send:'Close\r'},{wait:'More settings and details',send:'Return to request\r'},{wait:'KEEP 한국어',assertDraft:'KEEP 한국어',queries:checks,send:'\x15/quit\x1b\r'}];
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js','conversation','ui','--conversation',conversation],env,steps,timeoutSeconds:6,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);f.pass();}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-8000));throw error;}
});
