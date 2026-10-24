import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {readConfigurationProfile,readConfigurationTarget} from '../../dist/cli/configuration-profile.js';
const execute=promisify(execFile);
async function run(args){try{return{code:0,...await execute(process.execPath,['--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),...args],{timeout:5000})};}catch(e){if(typeof e.code==='number')return{code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}}
test('SDK-free owner repo ingress rejects missing/forged authority and ambiguous/private input; exact target survives reopening without work allocation',async t=>{
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/config-cli-')));let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained configuration CLI '+root);});
 const home=path.join(root,'home'),absent=path.join(root,'absent'),file=path.join(root,'target.json'),profileFile=path.join(root,'profile.json');
 const target={host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',actorUserId:7,visibility:'public'};
 for(const args of [['register-target'],['preview','--target','x','--profile',profileFile],['apply','--plan','x'],['reconcile','--credential-profile',file],['audit','--plan','x'],['guide','--target','x','--credential-profile',file],['plan'],['preview','--target','x','--profile',profileFile,'--credential-profile',file,'--enabled','true'],['register-target','--target-profile',file,'--actor','human']])assert.equal((await run(['repo',args[0],'--home',absent,...args.slice(1)])).code,2);
 await assert.rejects(fs.access(absent),{code:'ENOENT'});
 await fs.writeFile(file,JSON.stringify(target),{mode:0o600});assert.deepEqual(await readConfigurationTarget(file,[]),target);
 const registered=await run(['repo','register-target','--home',home,'--target-profile',file]);assert.equal(registered.code,0,registered.stderr);assert.ok(JSON.parse(registered.stdout).targetId);
 const unknown=await run(['repo','plan','--home',home,'--plan','unknown']);assert.equal(unknown.code,2);assert.doesNotMatch(unknown.stderr,/SDK_LOADED/);
 await fs.writeFile(file,JSON.stringify({...target,ownedRuleset:{id:2,nodeId:'claimed'}}));await assert.rejects(readConfigurationTarget(file,[]),/only the exact canonical/);
 await fs.writeFile(file,JSON.stringify(target).replace('"repositoryId":9','"repositoryId":9,"repositoryId":10'));await assert.rejects(readConfigurationTarget(file,[]),/ambiguous JSON/);
 const profile={version:'권장안을 수정한 owner profile',mergeMethods:{merge:true,rebase:false}};await fs.writeFile(profileFile,JSON.stringify(profile),{mode:0o600});assert.deepEqual(await readConfigurationProfile(profileFile,[]),profile);
 await fs.chmod(profileFile,0o644);await assert.rejects(readConfigurationProfile(profileFile,[]),/owner-only/);await fs.chmod(profileFile,0o600);
 await assert.rejects(readConfigurationProfile(profileFile,[root]),/outside registered/);
 await fs.writeFile(profileFile,'{"version":"v1","mergeMethods":{"merge":true,"merge":false}}');await assert.rejects(readConfigurationProfile(profileFile,[]),/ambiguous JSON/);
 const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{for(const table of ['works','sources','runs','role_launches','effect_operations'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM effect_targets WHERE json_extract(data,'$.kind')='github-configuration'").get().n,1);}finally{db.close();}passed=true;
});
