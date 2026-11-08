import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
const execute=promisify(execFile);
const entry=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/main.js');
const guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
async function cli(args,cert){try{return {code:0,...await execute(process.execPath,[...guard,'--import',path.resolve('tests/cli/no-sdk-loader.mjs'),entry,...args],{timeout:15000,env:{...process.env,NODE_EXTRA_CA_CERTS:cert}})};}catch(e){if(typeof e.code==='number')return {code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}}
test('original model-free native configuration CLI previews, applies and audits across reopen over owned trusted HTTPS',async t=>{
 const tls=await repositoryTlsFixture(t),credential=path.join(tls.root,'credential.json');await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});
 for(const provider of ['gitea','gitlab']){
  const server=await nativeConfigurationFixture(provider,{tls:tls.tls});try{
   const home=path.join(tls.root,provider),target=path.join(tls.root,provider+'-target.json'),profile=path.join(tls.root,provider+'-profile.json');await fs.writeFile(target,JSON.stringify(server.target),{mode:0o600});await fs.writeFile(profile,JSON.stringify(server.profile),{mode:0o600});
   const call=(action,args=[])=>cli(['repo',action,'--home',home,...args],tls.cert),decode=(result,code=0)=>{assert.equal(result.code,code,result.stderr+result.stdout);assert.doesNotMatch(result.stdout,/fixture-native-token|fixture-private-native/);return JSON.parse(result.stdout);};
   const registered=decode(await call('register-target',['--provider',provider,'--api-base',server.target.apiBase,'--owner',server.target.owner,'--repo',server.target.repository,'--credential-profile',credential]));await fs.mkdir(path.join(home,'config'),{mode:0o700});await fs.writeFile(path.join(home,'config/startup.json'),'{broken',{mode:0o600});
   assert.equal(decode(await call('register-target',['--target-profile',target])).targetId,registered.targetId);assert.deepEqual(registered.target,server.target);assert.equal(server.requests.length,4);assert.equal(decode(await call('targets')).targets[0].targetId,registered.targetId);
   const preview=decode(await call('preview',['--target',registered.targetId,'--profile',profile,'--credential-profile',credential]));assert.equal(preview.phase,'PREVIEWED');assert.equal(decode(await call('plans')).plans[0].planId,preview.planId);assert.equal(preview.activation,'explicit-owner-native/v1');assert.equal(server.requests.some(r=>r.method!=='GET'),false);
   const args=['--plan',preview.planId,'--credential-profile',credential];
   const refuseWithoutTransmission=async (expected,guidance)=>{
    const before=server.requests.length,result=await call('reconcile',args);
    assert.notEqual(result.code,0);
    assert.match(result.stderr,/No unresolved native configuration transmission/);
    assert.ok(result.stderr.includes('repo '+guidance+' --plan '+preview.planId));
    assert.equal(server.requests.length,before);
    assert.deepEqual(decode(await call('plan',['--plan',preview.planId])),expected);
   };
   await refuseWithoutTransmission(preview,'plan');
   const applied=decode(await call('apply',args));assert.equal(applied.phase,'CONFIRMED');assert.equal(applied.workId,preview.workId);assert.equal(server.requests.filter(r=>r.method!=='GET').length,2);
   const matching=decode(await call('audit',args));assert.equal(matching.complete,true);
   if (provider==='gitea') server.state.protection.required_approvals=2;
   else server.state.protection.allow_force_push=true;
   await refuseWithoutTransmission(matching.view,'audit');
   const audit=decode(await call('audit',args),2);
   assert.equal(audit.complete,false);
   assert.equal(audit.view.phase,'CONFIRMED');
   assert.deepEqual(audit.view.steps,applied.steps);
   assert.equal(server.requests.filter(r=>r.method!=='GET').length,2);
   const recommended=decode(await cli(['repo','recommend','--branch','main','--provider',provider],tls.cert));assert.equal(recommended.provider,provider);
   const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM role_launches').get().n,0);assert.equal(db.prepare("SELECT consumed FROM budgets WHERE kind='execution'").get().consumed,7);}finally{db.close();}
  }finally{await server.close();}
 }
});
