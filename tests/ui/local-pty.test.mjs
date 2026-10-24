import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile),git=await fs.realpath((await execute('/usr/bin/which',['git'])).stdout.trim());
test('actual model-free local terminal edits plain conventions and inspects/prepares staged native Git without executing a check or commit',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-local-terminal-'))),source=path.join(root,'project'),home=path.join(root,'home'),message=path.join(root,'message.txt'),file=path.join(root,'terminal.json');let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained local terminal fixture '+root);});await fs.mkdir(source);
 const native=(...args)=>execute(git,args,{cwd:source,timeout:5000,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});await native('init','-b','feat/local');await fs.writeFile(path.join(source,'한글.txt'),'staged source\n');await native('add','.');await fs.writeFile(message,'feat(local): Keep intent\n\nPRIVATE_LOCAL_MESSAGE_BODY\n',{mode:0o600});
 const c=await openController({installationHome:home});try{await c.registerProject({id:'p',sourceRoot:source});}finally{await c.close();}
 const originals=await Promise.all(['index','HEAD','config'].map(name=>fs.readFile(path.join(source,'.git',name))));
 const steps=[
  {wait:'Model: not selected',send:'/project p\x1b\r'},
  {wait:'Project selected: p',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],send:'/local\x1b\r'},
  {wait:'Local development',send:'Edit local conventions\r'},
  {wait:'Local conventions',send:'Allowed branch prefixes\r'},
  {wait:'exact literals',send:'Add literal\r'},
  {wait:'one literal',send:'feat/\r'},
  {wait:'exact literals',send:'Use staged list\r'},
  {wait:'Local conventions',send:'Maximum subject\r'},
  {wait:'whole number 1..256',send:'\x1540\r'},
  {wait:'Local conventions',send:'Save staged conventions\r'},
  {wait:'Saved local conventions',send:'\x1b'},
  {wait:'Local development',send:'Inspect Git changes\r'},
  {wait:'Trusted Git executable',send:'\x15'+git+'\r'},
  {wait:'Local Git observation',send:'\x1b'},
  {wait:'Local development',send:'Prepare staged change\r'},
  {wait:'Trusted Git executable',send:'\r'},
  {wait:'Owned UTF-8 commit message file',send:message+'\r'},
  {wait:'Staged preparation',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM role_launches',rows:[[0]]}],send:'\x1b'},
  {wait:'Local development',send:'Close\r'},
  {wait:'INPUT',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'/quit\x1b\r'},
 ];
 const env={...process.env,HOME:root,GITJIG_HOME:home,PATH:path.dirname(process.execPath),TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_LOCAL_GIT_BINARY:git};await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/local-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.match(output,/PASS/);assert.match(output,/한글.txt/);assert.doesNotMatch(output,/PRIVATE_LOCAL_MESSAGE_BODY/);const policy=JSON.parse(await fs.readFile(path.join(home,'config/local-conventions-p.json'),'utf8'));assert.equal(policy.revision,1);assert.equal(policy.rules.subjectMaxLength,40);assert.deepEqual(policy.rules.branchPrefixes,['feat/']);for(let i=0;i<3;i++)assert.deepEqual(await fs.readFile(path.join(source,'.git',['index','HEAD','config'][i])),originals[i]);passed=true;}finally{if(!passed)t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-14000));}
});
