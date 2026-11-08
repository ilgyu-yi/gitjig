import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';
const execute=promisify(execFile);
async function run(args,cert,hook){try{return {code:0,...await execute(process.execPath,[...hook?['--import',hook]:[],'--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),...args],{timeout:10000,env:{...process.env,NODE_EXTRA_CA_CERTS:cert}})};}catch(e){if(typeof e.code==='number')return {code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}}
function counts(home){const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{return Object.fromEntries(['works','sources','runs','effect_operations','effect_targets'].map(table=>[table,db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n]));}finally{db.close();}}
test('original GitHub registration CLI uses fixed-host native client through owned TLS connection mapping and rejects non-User/error/drift identities',async t=>{
 const tls=await repositoryTlsFixture(t),credential=path.join(tls.root,'credential.json'),hook=path.join(tls.root,'owned-github-connection.mjs');await fs.writeFile(credential,'{"token":"fixture-registration-only"}',{mode:0o600});
 let mode='healthy',reads=0;const requests=[],server=https.createServer(tls.tls,(req,res)=>{requests.push({method:req.method,path:req.url,token:req.headers.authorization});res.setHeader('content-type','application/json');if(mode==='denied')res.statusCode=403;if(req.url==='/user'){reads++;res.end(JSON.stringify({id:mode==='drift'&&reads===2?8:7,login:'owner',type:mode==='non-user'?'Bot':'User'}));}else res.end(JSON.stringify({id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',visibility:'public',private:false}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 // Trusted test driver changes only the TCP/TLS destination. The production factory,
 // request headers, JSON codec, fixed logical URL and CLI remain original.
 await fs.writeFile(hook,`import https from 'node:https';\nconst original=https.request;\nhttps.request=(url,...args)=>{if(url.hostname!=='api.github.com'||url.protocol!=='https:')throw Error('Unexpected test network destination');const mapped=new URL(url);mapped.hostname='127.0.0.1';mapped.port='${server.address().port}';return original(mapped,...args);};\n`,{mode:0o600});
 for(const variant of ['healthy','non-user','denied','drift']){
  mode=variant;reads=0;const home=path.join(tls.root,variant),start=requests.length,result=await run(['repo','register-target','--home',home,'--provider','github','--owner','owner','--repo','repo','--credential-profile',credential],tls.cert,hook);
  if(mode==='healthy'){assert.equal(result.code,0,result.stderr);const actual=JSON.parse(result.stdout);assert.equal(actual.target.repositoryNodeId,'R9');assert.equal(actual.target.actorUserId,7);assert.match(actual.scope,/no write permission/);assert.equal(requests.length-start,4);assert.deepEqual(counts(home),{works:0,sources:0,runs:0,effect_operations:0,effect_targets:1});}else{assert.equal(result.code,2,result.stderr);assert.deepEqual(counts(home),{works:0,sources:0,runs:0,effect_operations:0,effect_targets:0});}
  assert.doesNotMatch(result.stdout+result.stderr,/fixture-registration-only/);
 }
 assert.ok(requests.every(r=>r.method==='GET'&&r.token==='Bearer fixture-registration-only'));
});
test('original native CLI identity drift refuses before target registration and allocates no work',async t=>{
 const tls=await repositoryTlsFixture(t),credential=path.join(tls.root,'credential.json');await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});
 for(const provider of ['gitea','gitlab']){
  let users=0;const f=await nativeConfigurationFixture(provider,{tls:tls.tls,intercept:({relative,state})=>{if(relative==='/user'&&++users===2)state.actorId=8;return false;}});
  try{const home=path.join(tls.root,provider),result=await run(['repo','register-target','--home',home,'--provider',provider,'--api-base',f.target.apiBase,'--owner',f.target.owner,'--repo','repo','--credential-profile',credential],tls.cert);assert.equal(result.code,2);assert.match(result.stderr,/changed during registration/);assert.deepEqual(counts(home),{works:0,sources:0,runs:0,effect_operations:0,effect_targets:0});assert.ok(f.requests.every(r=>r.method==='GET'));}finally{await f.close();}
 }
});
