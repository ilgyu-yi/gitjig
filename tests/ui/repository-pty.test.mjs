import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
import {inspectionFixture} from '../platform/repository-inspect-fixture.mjs';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';
const execute=promisify(execFile);
test('actual empty repository list reaches registration and returns on cancel with exact draft and no effects',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-empty-repository-pty-'))),home=path.join(root,'home'),file=path.join(root,'terminal.json'),draft='  Keep this repository question 한국어  ';let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained empty-target terminal evidence: '+root);});
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07/'},
  {wait:'Gitjig commands · search',send:'/repo\r'},
  {wait:'Repository management',send:'Registered targets\r'},
  {wait:'Registered repository targets · none registered',send:'Register repository\r'},
  {wait:'Repository provider',send:'\x1b'},
  {wait:'Registered repository targets · none registered',assertDraft:draft,queries:['effect_targets','works','runs','budgets'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]})),send:'Back\r'},
  {wait:'Repository management',send:'Close\r'},
  {wait:'INPUT',assertDraft:draft,send:'\x07'},
  {wait:'Commands · Ctrl+G',send:'q'},
 ];
 const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_REPOSITORY_PORT:'0'};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/repository-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);passed=true;
});
test('actual model-free repository terminal registers, edits plain zero, previews, declines apply then explicitly applies and audits original work',{timeout:25000},async t=>{
 const tls=await repositoryTlsFixture(t),server=await nativeConfigurationFixture('gitea',{tls:tls.tls}),home=path.join(tls.root,'home'),credential=path.join(tls.root,'credential.json'),file=path.join(tls.root,'repository-pty.json');let passed=false;t.after(async()=>{await server.close();});await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management',send:'Register repository\r'},
  {wait:'Repository provider',send:'gitea\r'},
  {wait:'Canonical trusted HTTPS API base',send:'\x15'+server.target.apiBase+'\r'},
  {wait:'Repository owner',send:'owner\r'},
  {wait:'Repository name',send:'repo\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Repository management',queries:[{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[1]]},{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'Registered targets\r'},
  {wait:'Registered repository targets',send:'\r'},
  {wait:'retained identity only',send:'New configuration preview\r'},
  {wait:'New configuration preview',send:'Edit recommendation fields\r'},
  {wait:'Native protection operation',send:'Update existing rule\r'},
  {wait:'Literal branch / native protection rule',send:'\r'},
  {wait:'Repository profile',send:'required_approvals\r'},
  {wait:'staged value',send:'Edit value\r'},
  {wait:'whole number from 0',send:'\x150\r'},
  {wait:'Repository profile',send:'Use staged profile\r'},
  {wait:'Staged profile',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'\x1b'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'PREVIEWED · Preview retained.',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]}],send:'\x1b'},
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management',send:'Retained configuration plans\r'},
  {wait:'Retained repository plans',send:'\r'},
  {wait:'Repository plan',send:'Review changes for application\r'},
  {wait:'Review configuration changes',send:'\x1b'},
  {wait:'Explicit owner action',send:'\r'},
  {wait:'Repository plan',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]},{sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-attempt'",rows:[[0]]}],send:'Review changes for application\r'},
  {wait:'Review configuration changes',send:'\x1b'},
  {wait:'Explicit owner action',send:'Apply original\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'CONFIRMED · Selected settings were observed matching.',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['CONFIRMED']]}],send:'\x1b'},
  {wait:'Repository plan',send:'Audit selected settings\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'AUDIT MATCH · This audit observed all selected settings matching.',queries:[{sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[3,0]]}],send:'\x1b'},
  {wait:'Repository plan',send:'Back\r'},
  {wait:'Retained repository plans',send:'Back\r'},
  {wait:'Repository management',send:'Close\r'},
  {wait:'INPUT',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'/quit\x1b\r'},
 ];
 const env={...process.env,HOME:tls.root,GITJIG_HOME:home,TMPDIR:tls.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_REPOSITORY_PORT:new URL(server.origin).port};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/repository-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:22000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(output,/fixture-native-token/);assert.equal(server.requests.filter(r=>r.method!=='GET').length,1);assert.equal(server.state.protection.required_approvals,0);assert.equal(server.state.protection.dismiss_stale_approvals,true);passed=true;}finally{if(!passed){const output=await fs.readFile(file+'.terminal','utf8').catch(()=> '');t.diagnostic(output.slice(-18000));}}
});
test('actual terminal shutdown after owned native handoff joins UNKNOWN and original CLI reconciliation never replays',{timeout:20000},async t=>{
 const tls=await repositoryTlsFixture(t),home=path.join(tls.root,'home'),credential=path.join(tls.root,'credential.json'),profile=path.join(tls.root,'profile.json'),marker=path.join(tls.root,'native-handoff'),file=path.join(tls.root,'shutdown-pty.json');
 await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});await fs.writeFile(profile,JSON.stringify({provider:'gitea',version:'shutdown-original',protection:{name:'main',fields:{dismiss_stale_approvals:true}}}),{mode:0o600});
 const server=await nativeConfigurationFixture('gitea',{tls:tls.tls,intercept:async({req,body,state})=>{if(req.method==='PATCH'){Object.assign(state.protection,body);await fs.writeFile(marker,'native-write-observed');return true;}return false;}});t.after(()=>server.close());
 const env={...process.env,HOME:tls.root,GITJIG_HOME:home,TMPDIR:tls.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_REPOSITORY_PORT:new URL(server.origin).port};
 const cli=async(action,args)=>JSON.parse((await execute(process.execPath,['--import','./tests/ui/repository-no-execution.mjs','dist/cli/main.js','repo',action,'--home',home,...args],{env,timeout:8000})).stdout);
 const target=await cli('register-target',['--provider','gitea','--api-base',server.target.apiBase,'--owner','owner','--repo','repo','--credential-profile',credential]),plan=await cli('preview',['--target',target.targetId,'--profile',profile,'--credential-profile',credential]);
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management',send:'Retained configuration plans\r'},
  {wait:'Retained repository plans',send:'\r'},
  {wait:'Repository plan',send:'Review changes for application\r'},
  {wait:'Review configuration changes',send:'\x1b'},
  {wait:'Explicit owner action',send:'Apply original\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Repository request in progress',waitFiles:[{path:marker,value:'native-write-observed'}],terminate:true,send:''},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/repository-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const retained=await cli('plan',['--plan',plan.planId]);assert.equal(retained.phase,'UNKNOWN');assert.equal(retained.workId,plan.workId);assert.equal(server.requests.filter(r=>r.method!=='GET').length,1);
 const reconciled=await cli('reconcile',['--plan',plan.planId,'--credential-profile',credential]);assert.equal(reconciled.phase,'CONFIRMED');assert.equal(reconciled.workId,plan.workId);assert.equal(server.requests.filter(r=>r.method!=='GET').length,1);assert.doesNotMatch(await fs.readFile(file+'.terminal','utf8'),/fixture-native-token/);
});
test('actual model-free terminal creates a missing GitLab rule with explicit typed roles and audits original work',{timeout:25000},async t=>{
 const tls=await repositoryTlsFixture(t),server=await nativeConfigurationFixture('gitlab',{tls:tls.tls,absent:true}),home=path.join(tls.root,'home'),credential=path.join(tls.root,'credential.json'),file=path.join(tls.root,'repository-pty.json');let passed=false;t.after(async()=>{await server.close();});await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management',send:'Register repository\r'},
  {wait:'Repository provider',send:'gitlab\r'},
  {wait:'Canonical trusted HTTPS API base',send:'\x15'+server.target.apiBase+'\r'},
  {wait:'Repository namespace',send:'group/subgroup\r'},
  {wait:'Repository name',send:'repo\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Repository management',queries:[{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[1]]},{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'Registered targets\r'},
  {wait:'Registered repository targets',send:'\r'},
  {wait:'retained identity only',send:'New configuration preview\r'},
  {wait:'New configuration preview',send:'Edit recommendation fields\r'},
  {wait:'Native protection operation',send:'Create new rule\r'},
  {wait:'Literal branch / native protection rule',send:'\r'},
  {wait:'Repository profile',send:'protection.initial.merge_access_level\r'},
  {wait:'staged value',send:'30\r'},
  {wait:'Repository profile',send:'Use staged profile\r'},
  {wait:'Staged profile',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'\x1b'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'PREVIEWED · Preview retained.',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]}],send:'\x1b'},
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management',send:'Retained configuration plans\r'},
  {wait:'Retained repository plans',send:'\r'},
  {wait:'Repository plan',send:'Review changes for application\r'},
  {wait:'Review configuration changes',send:'\x1b'},
  {wait:'Explicit owner action',send:'\r'},
  {wait:'Repository plan',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]},{sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-attempt'",rows:[[0]]}],send:'Review changes for application\r'},
  {wait:'Review configuration changes',send:'\x1b'},
  {wait:'Explicit owner action',send:'Apply original\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'CONFIRMED · Selected settings were observed matching.',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['CONFIRMED']]}],send:'\x1b'},
  {wait:'Repository plan',send:'Audit selected settings\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'AUDIT MATCH · This audit observed all selected settings matching.',queries:[{sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[5,0]]}],send:'\x1b'},
  {wait:'Repository plan',send:'Back\r'},
  {wait:'Retained repository plans',send:'Back\r'},
  {wait:'Repository management',send:'Close\r'},
  {wait:'INPUT',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'/quit\x1b\r'},
 ];
 const env={...process.env,HOME:tls.root,GITJIG_HOME:home,TMPDIR:tls.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_REPOSITORY_PORT:new URL(server.origin).port};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/repository-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:22000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(output,/fixture-native-token/);assert.equal(server.requests.filter(r=>r.method==='POST').length,1);assert.equal(server.requests.filter(r=>r.method==='PUT').length,1);assert.equal(server.state.protection.merge_access_levels[0].access_level,30);assert.equal(server.state.protection.push_access_levels[0].access_level,0);assert.equal(server.state.protection.unprotect_access_levels[0].access_level,40);passed=true;}finally{if(!passed){const output=await fs.readFile(file+'.terminal','utf8').catch(()=> '');t.diagnostic(output.slice(-18000));}}
});

test('actual model-free terminal registers a read-only repository and inspects selected current policy without work or write authority',{timeout:20000},async t=>{
 const tls=await repositoryTlsFixture(t),server=await inspectionFixture('gitea',{tls:tls.tls}),home=path.join(tls.root,'policy-home'),credential=path.join(tls.root,'policy-credential.json'),file=path.join(tls.root,'policy-pty.json');t.after(()=>server.close());await fs.writeFile(credential,'{"token":"fixture-only-token"}',{mode:0o600});
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management',send:'Register repository\r'},
  {wait:'Repository provider',send:'gitea\r'},
  {wait:'Canonical trusted HTTPS API base',send:'\x15'+server.apiBase+'\r'},
  {wait:'Repository owner',send:'owner\r'},
  {wait:'Repository name',send:'repo\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Repository management',send:'Registered targets\r'},
  {wait:'Registered repository targets',send:'\r'},
  {wait:'retained identity only',send:'Inspect current branch policy\r'},
  {wait:'Existing branch',send:'\x15feature/path\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Selected branch: feature/path',queries:[{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[1]]},{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM budgets',rows:[[0]]}],send:'\x1b[6~'},
  {wait:'UNAVAILABLE',send:'\x1b'},
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management',send:'Close\r'},
  {wait:'INPUT',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'/quit\x1b\r'},
 ];
 const env={...process.env,HOME:tls.root,GITJIG_HOME:home,TMPDIR:tls.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_REPOSITORY_PORT:new URL(server.apiBase).port};await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/repository-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 let passed=false;try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.ok(server.requests.some(r=>r.path.includes('/branches/feature%2Fpath')));assert.ok(server.requests.every(r=>r.method==='GET'));const output=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(output,/fixture-only-token|server-secret/);assert.match(output,/not complete policy or permission/);passed=true;}finally{if(!passed)t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-16000));}
});
