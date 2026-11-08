import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedRepositoryConfigurationFixture} from '../../.qualification/controller-testing.js';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';
const execute=promisify(execFile);
async function cli(args){try{return {code:0,...await execute(process.execPath,['--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),...args],{timeout:10000})};}catch(e){if(typeof e.code==='number')return {code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}}
function snapshot(file){const db=new DatabaseSync(file,{readOnly:true});try{return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));}finally{db.close();}}
test('original target/plan discovery is bounded and stays a pure retained read even with pending crash recovery',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-config-discovery-'))),home=path.join(root,'home'),server=await nativeConfigurationFixture('gitea');let c=await openController({installationHome:home},{managementOnly:true});t.after(async()=>{await c.close();await server.close();await fs.rm(root,{recursive:true,force:true});});
 configureOwnedRepositoryConfigurationFixture(c,{origin:server.origin,token:'fixture-native-token'});const target=c.registerRepositoryConfigurationTarget({target:server.target}),other=c.registerRepositoryConfigurationTarget({target:{...server.target,actorUserId:8}}),plans=[];
 for(let i=0;i<3;i++)plans.push(await c.previewRepositoryConfiguration({targetId:target.targetId,profile:{provider:'gitea',version:'private-profile-not-listed-'+i,repository:{allow_merge_commits:false}}}));
 await c.close();const file=path.join(home,'state/controller.sqlite'),db=new DatabaseSync(file);try{
  db.prepare("UPDATE budgets SET reserved=1 WHERE lineage=? AND kind='execution'").run(plans[0].workId);
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run('crash',plans[0].workId,1,1,'RUNNING',path.join(home,'state'),'reserved',JSON.stringify({kind:'configuration-http',operationId:plans[0].planId,stage:'apply-step'}));
  db.prepare("UPDATE effect_operations SET phase='UNKNOWN',data=json_set(data,'$.steps[0].state','INVOKING','$.steps[0].intent',json(?)) WHERE id=?").run(JSON.stringify({runId:'crash',revision:1}),plans[0].planId);
 }finally{db.close();}
 await fs.mkdir(path.join(home,'config'),{mode:0o700});await fs.writeFile(path.join(home,'config/startup.json'),'{broken',{mode:0o600});
 const before=snapshot(file),requests=server.requests.length,call=(action,args=[])=>cli(['repo',action,'--home',home,...args]),decode=result=>{assert.equal(result.code,0,result.stderr);assert.doesNotMatch(result.stdout,/fixture-native-token|private-profile-not-listed|fixture-private-native/);return JSON.parse(result.stdout);};
 const targets=decode(await call('targets',['--limit','1']));assert.equal(targets.targets[0].targetId,other.targetId);assert.equal(targets.nextCursor,other.targetId);const second=decode(await call('targets',['--limit','1','--before',targets.nextCursor]));assert.equal(second.targets[0].targetId,target.targetId);assert.equal(second.nextCursor,null);
 const page=decode(await call('plans',['--target',target.targetId,'--limit','2']));assert.deepEqual(page.plans.map(p=>p.planId),[plans[2].planId,plans[1].planId]);const rest=decode(await call('plans',['--target',target.targetId,'--limit','2','--before',page.nextCursor]));assert.equal(rest.plans[0].planId,plans[0].planId);assert.equal(rest.plans[0].workId,plans[0].workId);assert.equal(rest.plans[0].recordedPhase,'UNKNOWN');assert.equal(decode(await call('plans',['--target',other.targetId])).plans.length,0);
 for(const args of [['plans','--target',other.targetId,'--before',plans[0].planId],['targets','--before',plans[0].planId],['plans','--limit','101']])assert.equal((await call(args[0],args.slice(1))).code,2);
 assert.equal(snapshot(file),before,'Discovery must not recover pending runs, settle allowance or change any ledger table');assert.equal(server.requests.length,requests);
 c=await openController({installationHome:home},{managementOnly:true});assert.throws(()=>c.listRepositoryConfigurationTargets({limit:0}));assert.throws(()=>c.listRepositoryConfigurationPlans({unexpected:1}));
 c.store.run("UPDATE effect_targets SET data=json_set(data,'$.kind','github-configuration') WHERE id=?",target.targetId);assert.equal(c.listRepositoryConfigurationTargets().targets.find(t=>t.targetId===target.targetId).state,'UNAVAILABLE');
 c.store.run("UPDATE effect_targets SET data=json_set(data,'$.kind','native-repository-configuration') WHERE id=?",target.targetId);
 c.store.run("UPDATE works SET data=json_set(data,'$.kind','ordinary') WHERE id=?",plans[1].workId);assert.equal(c.listRepositoryConfigurationPlans().plans.find(p=>p.planId===plans[1].planId).state,'UNAVAILABLE');
 c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.repositoryId','broken') WHERE id=?",target.targetId);assert.equal(c.listRepositoryConfigurationTargets().targets.find(t=>t.targetId===target.targetId).state,'UNAVAILABLE');assert.ok(c.listRepositoryConfigurationPlans({targetId:target.targetId}).plans.every(p=>p.state==='UNAVAILABLE'));
});
test('mixed/incomplete observed registration and invalid list bounds refuse before allocating a home',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-config-ingress-')),home=path.join(root,'absent');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const args of [
  ['register-target','--target-profile','/private/target.json','--provider','gitea'],
  ['register-target','--provider','gitea','--owner','o','--repo','r','--credential-profile','/private/token.json'],
  ['register-target','--provider','unknown','--owner','o','--repo','r','--credential-profile','/private/token.json'],
  ['register-target','--provider','github','--api-base','https://other.example/api/v1','--owner','o','--repo','r','--credential-profile','/private/token.json'],
  ['register-target','--provider','github','--owner','bad/path','--repo','r','--credential-profile','/private/token.json'],
  ['targets','--limit','0'],['plans','--limit','101']
 ])assert.equal((await cli(['repo',args[0],'--home',home,...args.slice(1)])).code,2,args.join(' '));
 await assert.rejects(fs.access(home),{code:'ENOENT'});
});
