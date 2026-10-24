import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {DatabaseSync} from 'node:sqlite';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';
test('actual source UI finds retained work and closes bounded detail without dispatch',{timeout:10000},async t=>{
 const f=await registryWorld(t,'change-registry-ui-','\x1b]52;c;MUST_NOT_EMIT\x07'),before=workLedger(f.c);await f.c.close();const file=path.join(f.root,'pty.json');
 const steps=[
  {wait:'Model: not selected',send:'PRESERVE\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'}, {wait:'More settings and details',send:'Managed changes\r'},
  {wait:'Managed changes',send:'Owner request 0\r'},
  {wait:'Managed change',send:'\x1b[6~'.repeat(4)},
  {wait:'Inspection does not retry work',assertDraft:'PRESERVE',send:'\x1b'},
  {wait:'More settings and details',send:'Return to request\r'},
  {wait:'PRESERVE',assertDraft:'PRESERVE',send:'\x15/quit\x1b\r'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js'],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:6,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:8000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const output=await fs.readFile(file+'.terminal','utf8');assert.ok(!output.includes('\x1b]52;'));assert.ok(!output.includes('MUST_NOT_EMIT'));
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows.map(row=>({...row})));}finally{db.close();}
});
