import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
import {inspectionFixture} from '../platform/repository-inspect-fixture.mjs';
import {waitFile} from './integration-send-fixture.mjs';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';
const execute=promisify(execFile);
const installedEntry=process.env.GITJIG_TEST_CLI_ENTRY;
const guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
const repositoryPreloads=[...guard,'--import','./tests/ui/repository-no-execution.mjs'];
const repositoryTerminal=[process.execPath,...repositoryPreloads,installedEntry??'dist/cli/entry.js'];
const repositoryManagement=[...repositoryPreloads,installedEntry??'dist/cli/main.js','repo'];
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
 await fs.writeFile(file,JSON.stringify({command:repositoryTerminal,env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);passed=true;
});
test('actual model-free repository terminal registers, previews, applies, audits and reads branch policy for the original target',{timeout:25000},async t=>{
 const tls=await repositoryTlsFixture(t),home=path.join(tls.root,'home'),credential=path.join(tls.root,'credential.json'),file=path.join(tls.root,'repository-pty.json');
 const reader=path.join(tls.root,'reader.json'),branch='release/verify',readerToken='fixture-branch-reader';
 const readEntered=path.join(tls.root,'branch-read-entered'),readStopped=path.join(tls.root,'branch-read-stopped');
 let holdPolicy=true;
 const server=await nativeConfigurationFixture('gitea',{tls:tls.tls,intercept:async({req,res,relative,send,state})=>{
  if(!req.headers.authorization?.endsWith(readerToken)) return false;
  if(req.method!=='GET'){send({},403);return true;}
  if(holdPolicy){
   holdPolicy=false;
   res.once('close',()=>{void fs.writeFile(readStopped,'stopped');});
   await fs.writeFile(readEntered,'entered');
   return true;
  }
  if(relative==='/repos/owner/repo'){send({...state.repository,default_branch:'main',permissions:{admin:false}});return true;}
  if(relative==='/repos/owner/repo/branches/'+encodeURIComponent(branch)){
   send({name:branch,commit:{id:'a'.repeat(40)},protected:true,effective_branch_protection_name:'main',required_approvals:state.protection.required_approvals});return true;
  }
  return false;
 }});
 let passed=false;t.after(async()=>{await server.close();});
 await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});
 await fs.writeFile(reader,JSON.stringify({token:readerToken}),{mode:0o600});
 const missingCredential=path.join(tls.root,'missing-credential.json');
 const beforeApply=[
  {sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]},
  {sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[1,0]]},
  {sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-attempt'",rows:[[0]]},
 ];
 const afterAudit=[
  {sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[3,0]]},
  {sql:'SELECT phase FROM effect_operations',rows:[['CONFIRMED']]},
  {sql:'SELECT COUNT(*) FROM works',rows:[[1]]},
 ];
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management',send:'Register repository\r'},
  {wait:'Repository provider',send:'gitea\r'},
  {wait:'Canonical trusted HTTPS API base',send:'\x15'+server.target.apiBase+'\r'},
  {wait:'Repository owner',send:'owner\r'},
  {wait:'Repository name',send:'repo\r'},
  {wait:'Private repository credential JSON file',send:'\x1b[200~'+path.join(tls.root,'invalid\u0085credential.json')+'\x1b[201~\r'},
  {wait:'Enter one line without control characters',queries:['effect_targets','works','runs','budgets'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]})),send:credential+'\r'},
  {wait:'Repository management',queries:[{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[1]]},{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'Registered targets\r'},
  {wait:'Registered repository targets',send:'\r'},
  {wait:'retained identity only',send:'New configuration preview\r'},
  {wait:'New configuration preview',send:'Edit recommendation fields\r'},
  {wait:'Native protection operation',send:'Update existing rule\r'},
  {wait:'Literal branch / native protection rule',send:'\r'},
  {wait:'Repository profile',send:'required_approvals\r'},
  {wait:'staged value',send:'Edit value\r'},
  {wait:'whole number from 0',send:'\x15101\r'},
  {wait:'Use a whole number from 0 to 100',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'\x150\r'},
  {wait:'Repository profile',send:'Use staged profile\r'},
  {wait:'Staged profile',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'\x1b'},
  {wait:'Repository profile · staged only',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'Use staged profile\r'},
  {wait:'Continue to preview credentials',send:'\r'},
  {wait:'Private repository credential JSON file',send:'\x1b'},
  {wait:'Repository profile · staged only',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'Use staged profile\r'},
  {wait:'Continue to preview credentials',send:'\r'},
  {wait:'Private repository credential JSON file',send:path.join(tls.root,'missing-credential.json')+'\r'},
  {wait:'Credential file could not be read',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'\x1b'},
  {wait:'Repository profile · staged only',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'Use staged profile\r'},
  {wait:'Continue to preview credentials',send:'\r'},
  {wait:'Private repository credential JSON file',send:path.join(tls.root,'missing-credential.json')+'\r'},
  {wait:'Choose another credential file',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'\r'},
  {wait:'Private repository credential JSON file',send:'\x15'+credential+'\r'},
  {wait:'Open original configuration plan',queries:beforeApply,send:'\r'},
  {wait:'Repository plan · owner/repo',queries:beforeApply,send:'Review changes for application\r'},
  {wait:'Review configuration changes',send:'\x1b'},
  {wait:'Repository plan',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]},{sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-attempt'",rows:[[0]]}],send:'Review changes for application\r'},
  {wait:'Open Apply confirmation',send:'\r'},
  {wait:'Explicit owner action',send:'\r'},
  {wait:'Repository plan',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]},{sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-attempt'",rows:[[0]]}],send:'Review changes for application\r'},
  {wait:'Open Apply confirmation',send:'\r'},
  {wait:'Explicit owner action',send:'Apply original\r'},
  {wait:'Private repository credential JSON file',send:'\x1b'},
  {wait:'Repository plan · owner/repo',queries:beforeApply,send:'Review changes for application\r'},
  {wait:'Open Apply confirmation',send:'\r'},
  {wait:'Explicit owner action',send:'Apply original\r'},
  {wait:'Private repository credential JSON file',send:missingCredential+'\r'},
  {wait:'Choose another credential file',queries:beforeApply,send:'\x1b'},
  {wait:'Repository plan · owner/repo',queries:beforeApply,send:'Review changes for application\r'},
  {wait:'Open Apply confirmation',send:'\r'},
  {wait:'Explicit owner action',send:'Apply original\r'},
  {wait:'Private repository credential JSON file',send:missingCredential+'\r'},
  {wait:'Choose another credential file',queries:beforeApply,send:'\r'},
  {wait:'Private repository credential JSON file',send:'\x15'+credential+'\r'},
  {wait:'CONFIRMED · Selected settings were observed matching.',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['CONFIRMED']]}],send:'\x1b'},
  {wait:'Repository plan',send:'Audit selected settings\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Inspect current branch policy',queries:afterAudit,send:'\r'},
  {wait:'Existing branch · enter the name to inspect',queries:afterAudit,send:branch+'\r'},
  {wait:'Private repository credential JSON file',queries:afterAudit,send:reader+'\r'},
  {wait:'Esc stops this read. No work execution allowance is used.',waitFiles:[{path:readEntered,value:'entered'}],send:'\x1b'},
  {wait:'Branch policy read stopped',waitFiles:[{path:readStopped,value:'stopped'}],queries:afterAudit,send:'\r'},
  {wait:'Private repository credential JSON file',queries:afterAudit,send:reader+'\r'},
  {wait:'Selected branch: '+branch,queries:afterAudit,send:'\x1b'},
  {wait:'Repository plan',send:'Back\r'},
  {wait:'retained identity only',send:'Back\r'},
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management',send:'Close\r'},
  {wait:'INPUT',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'/quit\x1b\r'},
 ];
 const env={...process.env,HOME:tls.root,GITJIG_HOME:home,TMPDIR:tls.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_REPOSITORY_PORT:new URL(server.origin).port};
 await fs.writeFile(file,JSON.stringify({command:repositoryTerminal,env,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:22000,maxBuffer:2**20})).stdout);
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  const output=await fs.readFile(file+'.terminal','utf8');
  assert.doesNotMatch(output,/fixture-native-token|fixture-branch-reader/);
  assert.match(output,/AUDIT MATCH/);
  assert.match(output,/Required approvals · native effective rule: 0/);
  assert.doesNotMatch(output,/Reconcile original request \(read only\)/u);
  const reads=server.requests.filter(r=>r.token?.endsWith(readerToken));
  assert.ok(reads.some(r=>r.path.endsWith('/branches/'+encodeURIComponent(branch))));
  assert.ok(reads.every(r=>r.method==='GET'));
  assert.equal(server.requests.filter(r=>r.method!=='GET').length,1);
  assert.equal(server.state.protection.required_approvals,0);
  assert.equal(server.state.protection.dismiss_stale_approvals,true);
  passed=true;
 }finally{if(!passed){const output=await fs.readFile(file+'.terminal','utf8').catch(()=> '');t.diagnostic(output.slice(-18000));}}
});
test('actual terminal recovers a lost settings response and reviews only unstarted writes on the original',{timeout:25000},async t=>{
 const tls=await repositoryTlsFixture(t),home=path.join(tls.root,'home'),credential=path.join(tls.root,'credential.json'),profile=path.join(tls.root,'profile.json'),marker=path.join(tls.root,'native-handoff'),file=path.join(tls.root,'shutdown-pty.json');
 const readStarted=path.join(tls.root,'read-started'),readStopped=path.join(tls.root,'read-stopped');
 let holdRead=false, cancelledReadCount;
 const server=await nativeConfigurationFixture('gitlab',{tls:tls.tls,intercept:async({req,res,body,state,requests})=>{
  if(req.method==='PUT'){Object.assign(state.repository,body);await fs.writeFile(marker,'native-write-observed');return true;}
  if(holdRead&&req.method==='GET'){
   holdRead=false;
   cancelledReadCount=requests.length;
   res.once('close',()=>{void fs.writeFile(readStopped,'stopped');});
   await fs.writeFile(readStarted,'started');
   return true;
  }
  return false;
 }});t.after(()=>server.close());
 await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});await fs.writeFile(profile,JSON.stringify(server.profile),{mode:0o600});
 const env={...process.env,HOME:tls.root,GITJIG_HOME:home,TMPDIR:tls.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_REPOSITORY_PORT:new URL(server.origin).port};
 const cli=async(action,args)=>JSON.parse((await execute(process.execPath,[...repositoryManagement,action,'--home',home,...args],{env,timeout:8000})).stdout);
 const target=await cli('register-target',['--provider','gitlab','--api-base',server.target.apiBase,'--owner',server.target.owner,'--repo','repo','--credential-profile',credential]),plan=await cli('preview',['--target',target.targetId,'--profile',profile,'--credential-profile',credential]);
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management',send:'Retained configuration plans\r'},
  {wait:'Retained repository plans',send:'\r'},
  {wait:'Repository plan',send:'Review changes for application\r'},
  {wait:'Open Apply confirmation',send:'\r'},
  {wait:'Explicit owner action',send:'Apply original\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Working · Applying the selected repository settings',waitFiles:[{path:marker,value:'native-write-observed'}],send:'\x04'},
 ];
 await fs.writeFile(file,JSON.stringify({command:repositoryTerminal,env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const retained=await cli('plan',['--plan',plan.planId]);assert.equal(retained.phase,'UNKNOWN');assert.equal(retained.workId,plan.workId);assert.equal(server.requests.filter(r=>r.method!=='GET').length,1);
 const recoveryFile=path.join(tls.root,'reconcile-pty.json');
 holdRead=true;
 const checkpoint=(phase,spent,writes)=>[
  {sql:'SELECT phase,work FROM effect_operations',rows:[[phase,plan.workId]]},
  {sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[spent,0]]},
  {sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-attempt'",rows:[[writes]]},
 ];
 const recoverySteps=[
  {wait:'Model: not selected',assertDraft:'/repo',send:'\x07/'},
  {wait:'Gitjig commands · search',send:'/repo\r'},
  {wait:'Repository management',send:'Retained configuration plans\r'},
  {wait:plan.planId,send:plan.planId+'\r'},
  {wait:'Reconcile original request (read only)',queries:checkpoint('UNKNOWN',2,1),send:'Reconcile original request\r'},
  {wait:'Private repository credential JSON file',send:'\x1b'},
  {wait:'Reconcile original request (read only)',queries:checkpoint('UNKNOWN',2,1),send:'Reconcile original request\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Esc stops this read',waitFiles:[{path:readStarted,value:'started'}],send:'\x1b'},
  {wait:'Settings result read stop requested · original plan retained',waitFiles:[{path:readStopped,value:'stopped'}],
   queries:[...checkpoint('UNKNOWN',3,1),{sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-reconciliation'",rows:[[0]]}],assertDraft:'/repo',send:'\x1b'},
  {wait:'Reconcile original request (read only)',queries:checkpoint('UNKNOWN',3,1),send:'Reconcile original request\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Next: open this retained plan and choose Review changes for application',queries:checkpoint('PARTIAL',4,1),send:'\x1b'},
  {wait:'Repository plan · group/subgroup/repo · PARTIAL',send:'Review changes for application\r'},
  {wait:'Already confirmed · Apply skips this step.',queries:checkpoint('PARTIAL',4,1),send:'\r'},
  {wait:'Explicit owner action',send:'Apply original\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'CONFIRMED · Selected settings were observed matching.',queries:checkpoint('CONFIRMED',5,2),send:'\x1b'},
  {wait:'Repository plan',send:'Back\r'},
  {wait:'Retained repository plans',send:'Back\r'},
  {wait:'Repository management',send:'Close\r'},
  {wait:'INPUT',send:'\x15/quit\x1b\r'},
 ];
 await fs.writeFile(recoveryFile,JSON.stringify({command:repositoryTerminal,env,steps:recoverySteps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:recoveryFile+'.terminal'}));
 const recovered=await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',recoveryFile],{timeout:16000,maxBuffer:2**20})
  .then(({stdout})=>JSON.parse(stdout)).catch(async error=>{
   const progress=JSON.parse(await fs.readFile(recoveryFile+'.terminal.progress.json','utf8').catch(()=> '{}'));
   t.diagnostic('Reconciliation terminal stage '+progress.stage+' of '+recoverySteps.length);
   t.diagnostic((await fs.readFile(recoveryFile+'.terminal','utf8').catch(()=> '')).slice(-9000));
   throw error;
  });
 assert.equal(recovered.exitCode,0);assert.equal(recovered.stages,recoverySteps.length);assert.equal(recovered.terminalRestored,true);
 const final=await cli('plan',['--plan',plan.planId]);assert.equal(final.phase,'CONFIRMED');assert.equal(final.workId,plan.workId);
 assert.ok(cancelledReadCount>0);
 assert.deepEqual(server.requests.filter(r=>r.method!=='GET').map(request=>request.method),['PUT','PATCH']);
 for (const record of [file,recoveryFile]) assert.doesNotMatch(await fs.readFile(record+'.terminal','utf8'),/fixture-native-token/);
});
for(const changedAt of ['catalogue selection','audit outcome close'])test('actual repository terminal refuses configuration revision drift at '+changedAt,{timeout:20000},async t=>{
 const tls=await repositoryTlsFixture(t),home=path.join(tls.root,'home'),file=path.join(tls.root,'configuration-stale.json');
 const profile=path.join(tls.root,'profile.json'),credential=path.join(tls.root,'credential.json'),marker=path.join(tls.root,'revision-replaced'),output=file+'.terminal';
 const lateRequests=[];
 const server=await nativeConfigurationFixture('gitea',{tls:tls.tls,intercept:({req})=>{
  if(existsSync(marker))lateRequests.push({method:req.method,path:req.url});
  return false;
 }});
 t.after(()=>server.close());
 await fs.writeFile(credential,JSON.stringify({token:'fixture-stale-plan-credential'}),{mode:0o600});
 await fs.writeFile(profile,JSON.stringify({provider:'gitea',version:'stale-plan/v1',repository:{allow_merge_commits:true}}),{mode:0o600});
 const env={HOME:tls.root,GITJIG_HOME:home,TMPDIR:tls.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LC_ALL:'C.UTF-8',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_REPOSITORY_PORT:new URL(server.origin).port};
 const cli=async(action,args)=>JSON.parse((await execute(process.execPath,[...repositoryManagement,action,'--home',home,...args],{env,timeout:8000})).stdout);
 const target=await cli('register-target',['--provider','gitea','--api-base',server.target.apiBase,'--owner','owner','--repo','repo','--credential-profile',credential]);
 const plan=await cli('preview',['--target',target.targetId,'--profile',profile,'--credential-profile',credential]);
 assert.equal(plan.phase,'PREVIEWED');
 assert.deepEqual(plan.plan.steps,[]);
 const callsBefore=server.requests.length,database=path.join(home,'state/controller.sqlite');
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  const stored=db.prepare('SELECT * FROM effect_operations WHERE id=?').get(plan.planId);
  const revision=plan.revision+1,drift={
   releaseFile:marker,
   mutations:[{sql:"UPDATE effect_operations SET data=json_set(data,'$.revision',?) WHERE id=?",params:[revision,plan.planId]}],
  };
  const audit=changedAt==='audit outcome close';
  const spend=amount=>({sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[amount,0]]});
  const settled=amount=>({sql:"SELECT COUNT(*) FROM runs WHERE phase='SETTLED' AND reservation='consumed'",rows:[[amount]]});
  const noWrites={sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-attempt'",rows:[[0]]};
  const sameWork={sql:'SELECT id,work,target,grant_id,phase FROM effect_operations',rows:[[stored.id,stored.work,stored.target,stored.grant_id,'PREVIEWED']]};
  const revisionIs=current=>({sql:"SELECT json_extract(data,'$.revision') FROM effect_operations WHERE id=?",params:[stored.id],rows:[[current]]});
  const draft='KEEP ORIGINAL PLAN 한국어',stale='Original configuration plan changed while the action was open';
  const steps=[
   {wait:'Model: not selected',send:draft+'\x07/'},
   {wait:'Gitjig commands · search',send:'/repo\r'},
   {wait:'Repository management · owner actions',send:'Retained configuration plans\r'},
   {wait:'revision '+plan.revision+' · '+plan.planId,queries:[spend(1),settled(1),sameWork],send:plan.planId+'\r',...audit?{}:drift},
   ...audit?[
    {wait:'Repository plan · owner/repo',send:'Audit selected settings\r'},
    {wait:'Private repository credential JSON file',send:credential+'\r'},
    {wait:'AUDIT MATCH',queries:[spend(2),settled(2),sameWork,revisionIs(plan.revision)],send:'\x1b',...drift},
   ]:[],
   {wait:stale,assertDraft:draft,queries:[spend(audit?2:1),settled(audit?2:1),sameWork,revisionIs(revision),noWrites],send:'\x15/quit\x1b\r'},
  ];
  await fs.writeFile(file,JSON.stringify({command:repositoryTerminal,env,steps,timeoutSeconds:10,expectedInputs:0,database,output,gracefulShutdownSeconds:3}));
  try{
   const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14000,maxBuffer:2**20})).stdout);
   assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
   const after=db.prepare('SELECT * FROM effect_operations').all();
   assert.equal(after.length,1);
   assert.deepEqual({...after[0],data:JSON.parse(after[0].data)},{...stored,data:{...JSON.parse(stored.data),revision}});
   assert.deepEqual(lateRequests,[]);
   assert.ok(server.requests.every(request=>request.method==='GET'));
   if(audit)assert.ok(server.requests.length>callsBefore,'Owned audit must actually read the receiver');
   else assert.equal(server.requests.length,callsBefore);
   const screen=await fs.readFile(output,'utf8');
   assert.doesNotMatch(screen,/fixture-stale-plan-credential/);
   assert.ok(!screen.includes('Repository plan · owner/repo · PREVIEWED · revision '+revision),'Changed revision must not replace the reviewed plan in the current interaction');
  }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-12000));throw error;}
 }finally{db.close();}
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
  {wait:'Continue to preview credentials',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]}],send:'\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'PREVIEWED · Preview retained.',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]}],send:'\x1b'},
  {wait:'retained identity only',send:'\x1b'},
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management',send:'Retained configuration plans\r'},
  {wait:'Retained repository plans',send:'\r'},
  {wait:'Repository plan',send:'Review changes for application\r'},
  {wait:'Open Apply confirmation',send:'\r'},
  {wait:'Explicit owner action',send:'\r'},
  {wait:'Repository plan',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['PREVIEWED']]},{sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-step-attempt'",rows:[[0]]}],send:'Review changes for application\r'},
  {wait:'Open Apply confirmation',send:'\r'},
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
 await fs.writeFile(file,JSON.stringify({command:repositoryTerminal,env,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:22000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(output,/fixture-native-token/);assert.equal(server.requests.filter(r=>r.method==='POST').length,1);assert.equal(server.requests.filter(r=>r.method==='PUT').length,1);assert.equal(server.state.protection.merge_access_levels[0].access_level,30);assert.equal(server.state.protection.push_access_levels[0].access_level,0);assert.equal(server.state.protection.unprotect_access_levels[0].access_level,40);passed=true;}finally{if(!passed){const output=await fs.readFile(file+'.terminal','utf8').catch(()=> '');t.diagnostic(output.slice(-18000));}}
});

test('actual model-free terminal registers a read-only repository and inspects selected current policy without work or write authority',{timeout:20000},async t=>{
 const tls=await repositoryTlsFixture(t),home=path.join(tls.root,'policy-home'),credential=path.join(tls.root,'policy-credential.json'),file=path.join(tls.root,'policy-pty.json');
 const missingCredential=path.join(tls.root,'missing-credential.json');
 const arm=file+'.arm',policy=file+'.policy',identity=file+'.identity';
 let policyHeld=false;
 const server=await inspectionFixture('gitea',{tls:tls.tls,intercept:({relative,send})=>{
  const read=relative==='/user'&&!policyHeld&&existsSync(arm);
  if(!read&&relative!=='/repos/owner/missing')return false;
  if(read)policyHeld=true;
  const marker=read?policy:identity;
  void fs.writeFile(marker,'entered').then(()=>waitFile(marker+'.release')).then(()=>read?send({id:7,login:'owner'}):send({},404)).catch(()=>send({},500));
  return true;
 }});
 t.after(()=>server.close());await fs.writeFile(credential,'{"token":"fixture-only-token"}',{mode:0o600});
 const noWork=['works','runs','budgets','effect_operations'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const registerFields=[
  {wait:'저장소 관리',send:'저장소 등록\r'},
  {wait:'저장소 제공자 · 식별 정보 등록',send:'gitea\r'},
  {wait:'신뢰하는 HTTPS API 주소',send:'\x15'+server.apiBase+'\r'},
  {wait:'저장소 소유자',send:'owner\r'},
  {wait:'저장소 이름',send:'repo\r'},
  {wait:'저장소 자격 증명 JSON 파일',send:missingCredential+'\r'},
 ];
 const noTargets=[...noWork,{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[0]]}];
 const steps=[
  {wait:'모델: 선택되지 않음',send:'/repo\x1b\r'},
  ...registerFields,
  {wait:'다른 자격 증명 파일 선택',queries:noTargets,send:'\x1b'},
  ...registerFields,
  {wait:'다른 자격 증명 파일 선택',queries:noTargets,send:'\r'},
  {wait:'저장소 자격 증명 JSON 파일',send:'\x15'+credential+'\r'},
  {wait:'저장소 관리',send:'등록된 저장소\r'},
  {wait:'등록된 저장소 · 대화 프로젝트와 별개',send:'\r'},
  {wait:'등록된 식별 정보',send:'저장소 식별 정보 보기\r'},
  {wait:'등록된 저장소 식별 정보 · 현재 권한 미확인',queries:noWork,send:'\x1b'},
  {wait:'등록된 식별 정보',send:'새 설정 미리보기\r'},
  {wait:'New configuration preview',send:'\x1b'},
  {wait:'등록된 식별 정보',send:'현재 브랜치 정책 확인\r'},
  {wait:'정책을 확인할 브랜치 이름',send:'\r'},
  {wait:'브랜치 이름을 1~1024자로 입력하세요',queries:noWork,send:'\x1b'},
  {wait:'등록된 식별 정보',send:'이 저장소의 설정 계획 보기\r'},
  {wait:'보존된 저장소 설정 계획',queries:noWork,send:'뒤로\r'},
  {wait:'등록된 식별 정보',send:'현재 브랜치 정책 확인\r'},
  {wait:'정책을 확인할 브랜치 이름',send:'\r'},
  {wait:'브랜치 이름을 1~1024자로 입력하세요',queries:noWork,send:'feature/path\r'},
  {wait:'저장소 자격 증명 JSON 파일',send:missingCredential+'\r'},
  {wait:'다른 자격 증명 파일 선택',queries:noWork,send:'\x1b'},
  {wait:'등록된 식별 정보',send:'현재 브랜치 정책 확인\r'},
  {wait:'정책을 확인할 브랜치 이름',send:'feature/path\r'},
  {wait:'저장소 자격 증명 JSON 파일',send:missingCredential+'\r'},
  {wait:'다른 자격 증명 파일 선택',queries:noWork,send:'\r'},
  {wait:'저장소 자격 증명 JSON 파일',releaseFile:arm,send:'\x15'+credential+'\r'},
  {wait:'처리 중 · 현재 브랜치 정책 조회',waitFiles:[{path:policy,value:'entered'}],releaseFile:policy+'.release',send:''},
  {wait:'Selected branch: feature/path',queries:[{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[1]]},{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM budgets',rows:[[0]]}],send:'\x1b[6~'},
  {wait:'UNAVAILABLE',send:'\x1b'},
  {wait:'등록된 식별 정보',send:'뒤로\r'},
  {wait:'등록된 저장소 · 대화 프로젝트와 별개',send:'뒤로\r'},
  {wait:'저장소 관리',send:'닫기\r'},
  {wait:'입력 · 대화 대기',assertDraft:'',send:'/repo register\x1b\r'},
  {wait:'저장소 제공자 · 식별 정보 등록',send:'gitea\r'},
  {wait:'신뢰하는 HTTPS API 주소',send:'\x15'+server.apiBase+'\r'},
  {wait:'저장소 소유자',send:'owner\r'},
  {wait:'저장소 이름',send:'missing\r'},
  {wait:'저장소 자격 증명 JSON 파일',send:credential+'\r'},
  {wait:'처리 중 · 저장소와 계정 확인',waitFiles:[{path:identity,value:'entered'}],releaseFile:identity+'.release',send:''},
  {wait:'Repository identity unavailable (HTTP 404)',queries:[{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[1]]}],assertDraft:'/repo register',send:'\x15/quit\x1b\r'},
 ];
 const env={...process.env,HOME:tls.root,GITJIG_HOME:home,TMPDIR:tls.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LC_ALL:'ko_KR.UTF-8',LANG:'ko_KR.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_REPOSITORY_PORT:new URL(server.apiBase).port};await fs.writeFile(file,JSON.stringify({command:repositoryTerminal,env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
 let passed=false;try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.ok(server.requests.some(r=>r.path.includes('/branches/feature%2Fpath')));assert.ok(server.requests.every(r=>r.method==='GET'));const output=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(output,/fixture-only-token|server-secret/);assert.match(output,/not complete policy or permission/);
 const refusal=output.indexOf('Repository identity unavailable (HTTP 404)');
 assert.ok(refusal>=0);
 assert.match(output.slice(0,refusal),/처리 중 · 저장소와 계정 확인/);
 assert.match(output.slice(0,refusal),/처리 중 · 현재 브랜치 정책 조회/);
 assert.doesNotMatch(output.slice(refusal),/저장소와 계정 확인|Observing repository identity/);passed=true;}finally{if(!passed)t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-16000));}
});
