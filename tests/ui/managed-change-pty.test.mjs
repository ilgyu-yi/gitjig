import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {DatabaseSync} from 'node:sqlite';
import {managedWorld} from './managed-change-fixture.mjs';
const execute=promisify(execFile);
async function terminal(f,name,steps,fail=false,failAdmission=false,holdBeforeCapture=false){
 const file=path.join(f.root,name+'.json'),cfg={home:f.home,cid:f.cid,receipt:file+'.receipt',release:file+'.release',fail,failAdmission,holdBeforeCapture};
 await fs.writeFile(file,JSON.stringify({...cfg,command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','tests/ui/managed-change-entry.mjs',file],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:path.join(f.home,'artifacts'),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:8,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);return{file,result,receipt:JSON.parse(await fs.readFile(cfg.receipt,'utf8')),output:await fs.readFile(file+'.terminal','utf8')};
}
test('source CLI starts multiline menu intent; navigation remains independent and failure returns only to its source',{timeout:14000},async t=>{
 const f=await managedWorld(t),draft='Owner intent 한국어\nPreserve the second line';f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});await f.c.close();
 const release=path.join(f.root,'background.json.release');
 const steps=[
  {wait:'Model: original',send:'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details',send:'Managed changes\r'},
  {wait:'Managed changes',send:'Start a new\r'},
  {wait:'Managed owner request',send:'\r'},
  {wait:'Start managed work',send:'\r'},
  {wait:'Recorded task stage: source captured',assertDraft:draft,queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[1]]},{sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[draft]]}],send:'\x07c'},
  {wait:'Conversations',send:f.other+'\r'},
  {wait:'Model: future',assertDraft:'',expectedSelected:f.other,releaseFile:release,send:'\x07c'},
  {wait:'Conversations',send:f.cid+'\r'},
  {wait:'CONTROLLED_SOURCE_FAILURE',assertDraft:draft,expectedSelected:f.cid,send:'\x07e'},
  {wait:'Error recovery · choose a next step',send:'Error details · inspect\r'},
  {wait:'MANAGED_CHANGE_FAILED',send:'\x1b'},
  {wait:'Owner intent',assertDraft:draft,terminate:true,send:''},
 ];
 const actual=await terminal(f,'background',steps,true);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});
 const progress=JSON.parse(await fs.readFile(actual.file+'.terminal.progress.json','utf8')),offsets=progress.actionOutputOffsets;
 const bytes=await fs.readFile(actual.file+'.terminal'),released=steps.findIndex(step=>step.releaseFile);assert.ok(!bytes.subarray(offsets[released],offsets[released+1]).toString('utf8').includes('CONTROLLED_SOURCE_FAILURE'));
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n,1);assert.equal(db.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(f.cid).draft,draft);}finally{db.close();}f.pass();
});
test('source CLI closes held managed work before account teardown and restores terminal',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.c.close();const steps=[
  {wait:'Model: original',send:'/change start Bounded close test\x1b\r'},
  {wait:'Start managed work',send:'\r'},
  {wait:'Recorded task stage: source captured',assertDraft:'',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[1]]}],send:'/quit\x1b\r'},
 ];
 const actual=await terminal(f,'close',steps);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});f.pass();
});


test('source CLI admission failure preserves the exact command request and creates no orphan task',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.c.close();const command='/change start Keep failed 한국어 request',steps=[
  {wait:'Model: original',send:command+'\x1b\r'},
  {wait:'Start managed work',send:'\r'},
  {wait:'CONTROLLED_ADMISSION_FAILURE',assertDraft:command,queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],terminate:true,send:''},
 ];
 const actual=await terminal(f,'admission',steps,false,true);assert.deepEqual(actual.receipt,{calls:0,active:false,settled:false,accountsClosed:true});f.pass();
});

// Menu invocation does not submit the retained editor text, even if it is a command.
test('menu start preserves an unrelated slash draft after actual admission',{timeout:14000},async t=>{
 const f=await managedWorld(t),draft='/model managed-fixture/future',request='Separate menu owner request';f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});await f.c.close();
 const steps=[
  {wait:'Model: original',send:'\x07t'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details',send:'Managed changes\r'},
  {wait:'Managed changes',send:'Start a new\r'},
  {wait:'Managed owner request',send:'Write a request\r'},
  {wait:'task intent',send:request+'\r'},
  {wait:'Start managed work',send:'\r'},
  {wait:'Recorded task stage: source captured',assertDraft:draft,queries:[{sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[request]]}],terminate:true,send:''},
 ];
 const actual=await terminal(f,'slash-draft',steps);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});f.pass();
});
test('typed readiness forwards submission provenance and acknowledges only its submitted command',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.c.close();const request='Readiness owner request',steps=[
  {wait:'Model: original',send:'/ready\x1b\r'},
  {wait:'Setup and next actions',send:'More settings\r'},
  {wait:'More settings and details',send:'Managed changes\r'},
  {wait:'Managed changes',send:'Start a new\r'},
  {wait:'Managed owner request',send:'Write a request\r'},
  {wait:'task intent',send:request+'\r'},
  {wait:'Start managed work',send:'\r'},
  {wait:'Recorded task stage: source captured',assertDraft:'',queries:[{sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[request]]}],terminate:true,send:''},
 ];
 const actual=await terminal(f,'typed-ready',steps);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});f.pass();
});
test('typed help forwards only its actual submission through discovery into managed start',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.c.close();const request='Discovered managed owner request',steps=[
  {wait:'Model: original',send:'/help\x1b\r'},
  {wait:'Gitjig commands · search',send:'/change\r'},
  {wait:'Managed changes',send:'Start a new\r'},
  {wait:'Managed owner request',send:'Write a request\r'},
  {wait:'task intent',send:request+'\r'},
  {wait:'Start managed work',send:'\r'},
  {wait:'Recorded task stage: source captured',assertDraft:'',queries:[{sql:'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)',rows:[[request]]}],terminate:true,send:''},
 ];
 const actual=await terminal(f,'typed-help',steps);assert.deepEqual(actual.receipt,{calls:1,active:false,settled:true,accountsClosed:true});f.pass();
});


test('original terminal keeps elapsed preparation visible before a managed capture allocates work',{timeout:12000},async t=>{
 const f=await managedWorld(t,undefined,await fs.realpath(await fs.mkdtemp('/tmp/gitjig-managed-preparation-')));await f.c.close();
 const empty=[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}];
 const steps=[
  {wait:'Model: original',send:'/change start Slow capture feedback\x1b\r'},
  {wait:'Start managed work',send:'\r'},
  {wait:'Preparing task',queries:empty,send:''},
  {wait:'1s',queries:empty,send:'',terminate:true},
 ];
 const actual=await terminal(f,'preparing',steps,false,false,true);
 assert.deepEqual(actual.receipt,{calls:0,active:false,settled:true,accountsClosed:true});
 assert.match(actual.output,/Preparing task/);f.pass();
});
