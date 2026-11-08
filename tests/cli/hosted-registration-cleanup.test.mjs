import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {registrationWorld,domain} from '../ui/hosted-registration-cleanup-fixture.mjs';
import {execute,receiverSnapshot} from '../ui/integration-read-fixture.mjs';
test('actual registration CLI preserves committed target and reports original cleanup recovery with nonzero exit',{timeout:15000},async t=>{
 const f=await registrationWorld(t),before=domain(f.c),bytes=await receiverSnapshot(f.native.receiver),profile=path.join(f.root,'hosted-target.json'),credential=path.join(f.root,'hosted-credential.json'),guard=path.join(f.root,'hosted-close-report.mjs');
 await fs.writeFile(profile,JSON.stringify({kind:'github-existing-ref',...f.request}),{mode:0o600});await fs.writeFile(credential,JSON.stringify({token:f.native.token}),{mode:0o600});
 await fs.writeFile(guard,`import ${JSON.stringify(new URL('./normal-hosted-adapter.mjs',import.meta.url).href)};
import {Effects} from ${JSON.stringify(new URL('../../dist/controller/effects.js',import.meta.url).href)};
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn,launcher=${JSON.stringify(new URL('../../dist/effects/git-process-child.js',import.meta.url).pathname)};let denied=0;
const refuse=()=>{denied++;throw Error('Owned CLI fixture permits only native Git launcher');};
for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=refuse;
cp.spawn=(binary,args,...rest)=>binary===process.execPath&&args[0]===launcher?spawn(binary,args,...rest):refuse();syncBuiltinESMExports();
globalThis.fetch=async()=>{throw Error('No model fetch in registration fixture');};
const original=Effects.prototype.client;
Effects.prototype.client=async function(...args){const client=await original.apply(this,args);if(client.root.startsWith(${JSON.stringify(f.home)}+'/effects/registration-')){const close=client.close.bind(client);client.close=async()=>{await close();throw Error('Controlled postcommit cleanup reporting failure');};}return client;};
process.on('exit',()=>{if(denied)process.exitCode=1;});
`,{mode:0o600});await f.c.close();
 let result;try{result={...await execute(process.execPath,['--import',guard,'dist/cli/main.js','effect','register-target','--home',f.home,'--git-binary',f.git,'--target-profile',profile,'--credential-profile',credential],{timeout:12000,maxBuffer:2**20,env:{PATH:path.dirname(process.execPath),HOME:f.root,TMPDIR:f.root,NODE_OPTIONS:'',NODE_PATH:'',TEST_NORMAL_REST_ORIGIN:f.rest.origin,TEST_NORMAL_HTTPS_PROFILE:JSON.stringify({origin:f.native.origin,caFile:f.native.ca,execPath:f.native.execPath})}}),code:0};}catch(error){result=error;}
 assert.equal(result.code,2);assert.equal(result.killed,false);assert.equal(result.stdout,'');const diagnostic=JSON.parse(result.stderr.split('\n').find(line=>line.startsWith('{"error":')));assert.equal(diagnostic.error,'INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN');assert.ok(!result.stderr.includes(f.native.token));
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{
  const target=db.prepare("SELECT id FROM effect_targets WHERE json_extract(data,'$.kind')='github-existing-ref'").get();assert.ok(target);assert.ok(diagnostic.message.includes(target.id+' remains registered'));const root=path.join(f.home,'effects','registration-'+target.id,'client');assert.ok(diagnostic.recovery.includes(root));
  for(const table of ['works','budgets','runs','effect_delegations','effect_operations'])assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),before[table]);assert.equal(db.prepare('SELECT COUNT(*) n FROM sources').get().n,before.sources.length+1);
 }finally{db.close();}
 assert.deepEqual(await receiverSnapshot(f.native.receiver),bytes);f.pass();
});
