import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {inspectionFixture} from '../platform/repository-inspect-fixture.mjs';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
const execute=promisify(execFile);
const cli=async(args,env={})=>{try{return {code:0,...await execute(process.execPath,['--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),...args],{timeout:15000,env:{...process.env,...env}})};}catch(error){if(typeof error.code==='number')return {code:error.code,stdout:error.stdout,stderr:error.stderr};throw error;}};
test('original model-free CLI observes each provider over explicitly trusted owned HTTPS despite invalid saved runtime',async t=>{
 const tls=await repositoryTlsFixture(t),credential=path.join(tls.root,'credential.json');await fs.writeFile(credential,JSON.stringify({token:'fixture-only-token'}),{mode:0o600});
 for(const provider of ['gitea','gitlab']){
  const f=await inspectionFixture(provider,{tls:tls.tls}),home=path.join(tls.root,provider),source=path.join(tls.root,provider+'-project');await fs.mkdir(source);
  try{
   assert.equal((await cli(['project','register','--home',home,'--id','p','--root',source])).code,0);await fs.mkdir(path.join(home,'config'),{mode:0o700});await fs.writeFile(path.join(home,'config/startup.json'),'{broken',{mode:0o600});
   const args=['repo','inspect','--home',home,'--provider',provider,'--api-base',f.apiBase,'--owner',f.namespace,'--repo','repo','--credential-profile',credential];
   const actual=await cli(args,{NODE_EXTRA_CA_CERTS:tls.cert});assert.equal(actual.code,0,actual.stderr+actual.stdout);const view=JSON.parse(actual.stdout);assert.equal(view.provider,provider);assert.equal(view.status,'OBSERVED');assert.equal(view.repository.fullName,f.namespace+'/repo');assert.ok(f.requests.length>5);assert.ok(f.requests.every(r=>r.method==='GET'));if(provider==='gitea'){const inventory=f.requests.filter(r=>r.path.includes('/branch_protections'));assert.equal(inventory.length,1);assert.equal(inventory[0].path,'/forge/api/v1/repos/owner/repo/branch_protections');}assert.equal(actual.stdout.includes('fixture-only-token'),false);assert.equal(actual.stdout.includes('server-secret'),false);
   const requests=f.requests.length,unsafe=path.join(source,'credential.json');await fs.writeFile(unsafe,JSON.stringify({token:'fixture-only-token'}),{mode:0o600});const rejected=await cli([...args.slice(0,-1),unsafe],{NODE_EXTRA_CA_CERTS:tls.cert});assert.equal(rejected.code,2);assert.match(rejected.stderr,/outside registered project/);assert.equal(f.requests.length,requests);
   await fs.writeFile(credential,'{"token":"a","token":"b"}',{mode:0o600});const duplicate=await cli(args,{NODE_EXTRA_CA_CERTS:tls.cert});assert.equal(duplicate.code,2);assert.equal(f.requests.length,requests);await fs.writeFile(credential,JSON.stringify({token:'fixture-only-token'}),{mode:0o600});
   const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{for(const table of ['works','sources','runs','effect_operations','effect_targets','effect_receipts'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);}finally{db.close();}
  }finally{await f.close();}
 }
});
test('original CLI reports partial protected-rule visibility and rejects untrusted TLS even with ambient verification disabled',async t=>{
 const tls=await repositoryTlsFixture(t),credential=path.join(tls.root,'credential.json');await fs.writeFile(credential,'{"token":"fixture-only-token"}',{mode:0o600});
 const f=await inspectionFixture('gitlab',{tls:tls.tls,intercept:({relative,send})=>{if(relative.endsWith('/approval_rules')){send({private:'server-secret'},403);return true;}}});
 try{
  const args=['repo','inspect','--home',path.join(tls.root,'home'),'--provider','gitlab','--api-base',f.apiBase,'--owner',f.namespace,'--repo','repo','--credential-profile',credential];
  const partial=await cli(args,{NODE_EXTRA_CA_CERTS:tls.cert});assert.equal(partial.code,1,partial.stderr);const view=JSON.parse(partial.stdout);assert.equal(view.status,'PARTIAL');assert.equal(view.observations.approvalRules.state,'UNAVAILABLE');assert.equal(partial.stdout.includes('server-secret'),false);
  const count=f.requests.length,rejected=await cli(args,{NODE_EXTRA_CA_CERTS:'',NODE_TLS_REJECT_UNAUTHORIZED:'0'});assert.equal(rejected.code,2);assert.match(rejected.stderr,/transport unavailable/);assert.equal(f.requests.length,count,'No token-bearing request reached the untrusted server');
 }finally{await f.close();}
});
test('original native guide uses complete native inventory and refuses actor/repository identity substitution',async t=>{
 const tls=await repositoryTlsFixture(t),credential=path.join(tls.root,'credential.json');await fs.writeFile(credential,'{"token":"fixture-only-token"}',{mode:0o600});
 for(const provider of ['gitea','gitlab']){
  const f=await inspectionFixture(provider,{tls:tls.tls}),home=path.join(tls.root,provider),file=path.join(tls.root,provider+'-target.json');
  try{
   const register=async target=>{await fs.writeFile(file,JSON.stringify(target),{mode:0o600});const result=await cli(['repo','register-target','--home',home,'--target-profile',file],{NODE_EXTRA_CA_CERTS:tls.cert});assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout).targetId;};
   const original={provider,apiBase:f.apiBase,repositoryId:9,actorUserId:7,owner:f.namespace,repository:'repo'},id=await register(original),guide=target=>cli(['repo','guide','--home',home,'--target',target,'--branch',f.selected,'--credential-profile',credential],{NODE_EXTRA_CA_CERTS:tls.cert});
   const result=await guide(id);assert.equal(result.code,0,result.stderr);const view=JSON.parse(result.stdout);assert.equal(view.targetId,id);assert.equal(view.observation.observations.protectionInventory.value.length,2);assert.equal(view.observation.actor.id,7);assert.equal(view.observation.repository.id,9);
   if(provider==='gitea'){const inventory=f.requests.filter(r=>r.path.includes('/branch_protections'));assert.equal(inventory.length,1);assert.equal(inventory[0].path,'/forge/api/v1/repos/owner/repo/branch_protections');}
   for(const changed of [{actorUserId:8},{repositoryId:10}]){const other=await register({...original,...changed}),refused=await guide(other);assert.equal(refused.code,2);assert.match(refused.stderr,/differs from the registered target/);}
   assert.ok(f.requests.every(r=>r.method==='GET'));assert.equal(JSON.stringify(view).includes('fixture-only-token'),false);assert.equal(JSON.stringify(view).includes('server-secret'),false);
   const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{for(const table of ['works','sources','runs','effect_operations','effect_receipts'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);}finally{db.close();}
  }finally{await f.close();}
 }
});
