import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{execFile}from'node:child_process';import{promisify}from'node:util';import{publicServer,target}from'./fixture.mjs';import{configurationServer,configurationTarget,configurationProfile}from'../controller/configuration-fixture.mjs';
import {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile);
const adapter=path.resolve('tests/normal-hosted/cli-adapter.mjs');
const installedEntry=process.env.GITJIG_TEST_CLI_ENTRY;
const guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
async function call(origin,args){try{return{code:0,...await execute(process.execPath,[...guard,'--import',path.resolve('tests/cli/no-sdk-loader.mjs'),'--import',adapter,installedEntry??path.resolve('dist/cli/main.js'),...args],{timeout:4000,env:{...process.env,TEST_OWNED_NORMAL_ORIGIN:origin}})};}catch(e){if(typeof e.code==='number')return{code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}}
async function setup(t){const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/normal-public-cli-')));t.diagnostic('Retained CLI normal-profile fixture '+root);const write=async(n,v)=>{const file=path.join(root,n);await fs.writeFile(file,JSON.stringify(v),{mode:0o600});return file;};return{root,home:path.join(root,'home'),write};}
test('SDK-free public CLI prepare/process dispatch/reconcile uses real private inputs and same op',async t=>{const f=await publicServer({drop:true,weakAdminFalse:true}),x=await setup(t);try{const targetFile=await x.write('target.json',{target,visibility:'public'}),payload=await x.write('payload.json',{kind:'create-issue',title:'literal 한글 $&',body:'  exact\n{"x":1}  '}),strong=await x.write('strong.json',{token:'fixture-original'}),weak=await x.write('weak.json',{token:'weak'});const run=args=>call(f.origin,[args[0],args[1],'--home',x.home,...args.slice(2)]);const registered=await run(['publication','register-target','--target-profile',targetFile]);assert.equal(registered.code,0,registered.stderr);const{targetId}=JSON.parse(registered.stdout),prepared=await run(['publication','prepare','--target',targetId,'--payload-file',payload,'--credential-profile',strong]);assert.equal(prepared.code,0,prepared.stderr+prepared.stdout);const p=JSON.parse(prepared.stdout);assert.equal(p.phase,'RESERVED');const denied=await run(['publication','dispatch','--operation',p.operationId,'--credential-profile',weak]);assert.equal(denied.code,2);assert.equal(f.rows.length,0);const sent=await run(['publication','dispatch','--operation',p.operationId,'--credential-profile',strong]);assert.equal(sent.code,2);assert.equal(JSON.parse(sent.stdout).phase,'UNKNOWN');assert.equal(f.rows.length,1);const recovered=await run(['publication','reconcile','--operation',p.operationId,'--credential-profile',weak]);assert.equal(recovered.code,0,recovered.stderr+recovered.stdout);assert.equal(JSON.parse(recovered.stdout).phase,'CONFIRMED');assert.equal(JSON.parse(recovered.stdout).transportOutcome,'uncertain');assert.equal(f.rows.length,1);}finally{await f.close();}});
test('SDK-free public repo CLI preview/apply/audit across processes preserves unrelated fields',async t=>{const f=await configurationServer(),x=await setup(t);try{const targetFile=await x.write('target.json',configurationTarget),profile=await x.write('profile.json',configurationProfile()),credential=await x.write('credential.json',{token:'fixture-original'});const run=args=>call(f.origin,['repo',args[0],'--home',x.home,...args.slice(1)]),register=await run(['register-target','--target-profile',targetFile]);assert.equal(register.code,0,register.stderr);const{targetId}=JSON.parse(register.stdout),preview=await run(['preview','--target',targetId,'--profile',profile,'--credential-profile',credential]);assert.equal(preview.code,0,preview.stdout+preview.stderr);const p=JSON.parse(preview.stdout),apply=await run(['apply','--plan',p.planId,'--credential-profile',credential]);assert.equal(apply.code,0,apply.stdout+apply.stderr);assert.equal(JSON.parse(apply.stdout).phase,'CONFIRMED');const audit=await run(['audit','--plan',p.planId,'--credential-profile',credential]);assert.equal(audit.code,0,audit.stdout+audit.stderr);assert.equal(JSON.parse(audit.stdout).complete,true);assert.equal(f.repo.description,'unrelated-preserved');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(f.requests.filter(r=>r.method==='PATCH').length,1);}finally{await f.close();}});

test('ordinary private GitHub preview offers inspection and refuses writes before requests or allowance', {timeout:18000}, async t=>{
 const fixture=await configurationServer(),x=await setup(t);
 let passed=false;
 t.after(async()=>{await fixture.close();if(passed)await fs.rm(x.root,{recursive:true,force:true});});
 Object.assign(fixture.repo,{private:true,visibility:'private'});
 const targetFile=await x.write('target.json',{...configurationTarget,visibility:'private'});
 const profile=await x.write('profile.json',{version:'private-preview',mergeMethods:{rebase:true}});
 const credential=await x.write('credential.json',{token:'fixture-original'});
 const auth=['--credential-profile',credential];
 const run=(action,args)=>call(fixture.origin,['repo',action,'--home',x.home,...args]);
 const read=async (action,args,code=0)=>{
  const result=await run(action,args);
  assert.equal(result.code,code,result.stderr+result.stdout);
  return JSON.parse(result.stdout);
 };
 const {targetId}=await read('register-target',['--target-profile',targetFile]);
 const plan=await read('preview',['--target',targetId,'--profile',profile,...auth]);
 assert.equal(plan.phase,'PREVIEWED');
 assert.equal(plan.plan.steps.length,1);
 const before=fixture.requests.length,draft='Retain this separate 한국어 draft';
 const output=path.join(x.root,'private-preview.terminal');
 const noSpend=[{sql:'SELECT consumed,reserved FROM budgets WHERE kind=\'execution\'',rows:[[1,0]]}];
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07/'},
  {wait:'Gitjig commands · search',send:'/repo\r'},
  {wait:'Repository management',send:'Retained configuration plans\r'},
  {wait:plan.planId,send:plan.planId+'\r'},
  {wait:'Private GitHub settings are read-only here.',assertDraft:draft,queries:noSpend,send:'Inspect original plan\r'},
  {wait:'Original configuration · no dispatch',send:'\x1b'},
  {wait:'Repository plan · owner/repo',send:'Back\r'},
  {wait:'Retained repository plans',send:'Back\r'},
  {wait:'Repository management',send:'Registered targets\r'},
  {wait:'Registered repository targets',send:targetId+'\r'},
  {wait:'Inspect current branch policy',send:'Inspect current branch policy\r'},
  {wait:'Existing branch · enter the name to inspect',assertDraft:draft,send:'\x1b'},
  {wait:'retained identity only',send:'Back\r'},
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management',send:'Close\r'},
  {wait:'INPUT',assertDraft:draft,queries:noSpend,send:'\x07q'},
 ];
 const spec=await x.write('private-terminal.json',{
  command:[process.execPath,...guard,'--import',adapter,installedEntry??path.resolve('dist/cli/entry.js')],
  env:{...process.env,HOME:x.root,GITJIG_HOME:x.home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',TEST_OWNED_NORMAL_ORIGIN:fixture.origin},
  steps,output,expectedInputs:0,timeoutSeconds:8,gracefulShutdownSeconds:2,database:path.join(x.home,'state/controller.sqlite'),
 });
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',spec],{timeout:12000})).stdout);
 assert.equal(result.stages,steps.length);
 assert.equal(result.exitCode,0);
 assert.equal(result.terminalRestored,true);
 const terminal=await fs.readFile(output,'utf8');
 assert.doesNotMatch(terminal,/Review changes for application|fixture-original/);
 assert.deepEqual(await read('plan',['--plan',plan.planId]),plan);
 const refused=await read('apply',['--plan',plan.planId,...auth],2);
 assert.equal(refused.phase,'REFUSED');
 assert.match(refused.blocked.join('\n'),/private GitHub settings/);
 assert.equal(fixture.requests.length,before);
 assert.deepEqual(refused.steps,plan.steps);
 assert.deepEqual(refused.receiptIds,plan.receiptIds);
 const db=new DatabaseSync(path.join(x.home,'state/controller.sqlite'),{readOnly:true});
 try {
  const allowance=db.prepare("SELECT consumed,reserved FROM budgets WHERE kind='execution'").get();
  assert.deepEqual([allowance.consumed,allowance.reserved],[1,0]);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM runs').get().total,1);
 } finally {db.close();}
 const unchanged=await x.write('no-op.json',{version:'private-no-op',mergeMethods:{rebase:false}});
 const noop=await read('preview',['--target',targetId,'--profile',unchanged,...auth]);
 assert.equal(noop.plan.steps.length,0);
 assert.equal((await read('apply',['--plan',noop.planId,...auth])).phase,'CONFIRMED');
 assert.equal(fixture.requests.filter(request=>request.method!=='GET').length,0);
 passed=true;
});
