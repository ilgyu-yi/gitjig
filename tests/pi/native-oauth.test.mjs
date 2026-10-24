import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { readModelProfile } from '../../dist/cli/model-profile.js';
import { createOwnedNativeOAuth } from '../../dist/pi/native-oauth.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
const root = await realpath(await mkdtemp(join(tmpdir(), 'gitjig-native-oauth-')));
const work = join(root, 'project'), state = join(root, 'state'), artifacts = join(root, 'artifacts');
for (const dir of [work, state, artifacts]) await mkdir(dir, {mode:0o700});
const originalTemp = process.env.TMPDIR, originalFetch = globalThis.fetch;
process.env.TMPDIR = artifacts;
const host = await initializePiHost({stateRoot:state,artifactRoot:artifacts});
let unexpected = 0;
const deny = async () => {unexpected++;throw Error('External transport is forbidden in this DUMMY test');};
globalThis.fetch = deny;
after(async()=>{globalThis.fetch=originalFetch;if(originalTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTemp;await rm(root,{recursive:true,force:true});assert.equal(unexpected,0);});
const jwt=tag=>'DUMMY.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'DUMMY_ACCOUNT'},tag})).toString('base64url')+'.DUMMY';
const credential=(expired=false)=>({type:'oauth',access:jwt('before'),refresh:'DUMMY_REFRESH',expires:expired?1:Date.now()+86400000,accountId:'DUMMY_ACCOUNT'});
let counter=0;
async function selection(value=credential()){
 const authPath=join(root,'auth-'+counter+++'.json');await writeFile(authPath,JSON.stringify({'openai-codex':value}),{mode:0o600});
 return {provider:'openai-codex',modelId:'gpt-6.1-sol',native:{kind:'pi-oauth',authPath,projectRoots:[work]}};
}
function operations(){return {workspaceRoot:work,validatePath(p){const f=resolve(work,p),r=relative(work,f);if(isAbsolute(r)||r==='..'||r.startsWith('../'))throw Error('outside');return f;},async exec(){throw Error('No project process in this fixture');},async readFile(){throw Error('No project read in this fixture');},async access(){},async writeFile(){throw Error('No project write in this fixture');},async mkdir(){throw Error('No project mkdir in this fixture');}};}
const options=model=>({host,operations:operations(),model,systemPrompt:'DUMMY native OAuth session: use only owned tools.',maxReadBytes:1024});
const turn=()=>new Promise(r=>setImmediate(r));
function refreshBarrier({fail=false}={}){
 let release,entered;const started=new Promise(r=>entered=r),barrier=new Promise(r=>release=r);let auth=0,generation=0;
 globalThis.fetch=async(url,init)=>{
  if(String(url)!=='https://auth.openai.com/oauth/token'){generation++;throw Error('Generation forbidden in protected refresh test');}
  auth++;assert.equal(init.signal.aborted,false);entered();await barrier;
  return fail?new Response('{}',{status:400}):Response.json({access_token:jwt('rotated'),refresh_token:'DUMMY_ROTATED_REFRESH',expires_in:86400});
 };
 return {started,release,counts:()=>({auth,generation})};
}

test('owner profile and programmatic entry enforce selected OAuth metadata outside project inputs, legacy literal path retained',async()=>{
 const model=await selection(),file=join(root,'profile.json');await writeFile(file,JSON.stringify({provider:model.provider,modelId:model.modelId,native:{kind:'pi-oauth',authPath:model.native.authPath}}),{mode:0o600});
 assert.deepEqual(await readModelProfile(file,[work]),model);
 for(const change of [{provider:'other'},{modelId:'other'},{definition:{apiKey:'not-allowed'}},{native:{kind:'pi-oauth',authPath:model.native.authPath,projectRoots:[]}}]){
  await writeFile(file,JSON.stringify({...model,native:{kind:'pi-oauth',authPath:model.native.authPath},...change}),{mode:0o600});await assert.rejects(readModelProfile(file,[work]));
 }
 const inProject=join(work,'auth.json');await writeFile(inProject,JSON.stringify({'openai-codex':credential()}),{mode:0o600});await assert.rejects(createPiSession(options({...model,native:{...model.native,authPath:inProject}})),/outside/);
 const alias=join(root,'alias.json');await symlink(model.native.authPath,alias);await assert.rejects(createOwnedNativeOAuth({...model.native,authPath:alias},[work]));
 await chmod(model.native.authPath,0o644);await assert.rejects(createPiSession(options(model)),/owner-only/);await chmod(model.native.authPath,0o600);
 await assert.rejects(createPiSession(options({...model,native:{...model.native,authPath:join(root,'missing.json')}})));await assert.rejects(readFile(join(root,'missing.json')));
 await writeFile(file,JSON.stringify({provider:'legacy',modelId:'x',definition:{apiKey:'DUMMY_LITERAL',baseUrl:'https://unused.invalid',models:[{id:'x'}]}}),{mode:0o600});assert.equal((await readModelProfile(file,[work])).definition.apiKey,'DUMMY_LITERAL');
 globalThis.fetch=deny;
});

test('shipping native factory resolves only exact selected OAuth and refuses missing, wrong or replaced credential types without transport',async()=>{
 for(const stored of [{type:'api_key',key:'DUMMY_NOT_OAUTH'},undefined]){
  const model=await selection(stored??{});if(!stored)await writeFile(model.native.authPath,'{}',{mode:0o600});await assert.rejects(createOwnedNativeOAuth(model.native,[work]),/credential is unavailable/);
 }
 const model=await selection(),owned=await createOwnedNativeOAuth(model.native,[work]);
 try{assert.equal(owned.selected.api,'openai-codex-responses');assert.ok(await owned.runtime.getAuth(owned.selected));await writeFile(model.native.authPath,JSON.stringify({'openai-codex':{type:'api_key',key:'DUMMY_NOT_OAUTH'}}),{mode:0o600});await assert.rejects(owned.runtime.getAuth(owned.selected),/credential is unavailable/);}finally{await owned.close();}
});

test('actual SDK refresh persists rotation after caller abort, session owned-close waits full original tail and no generation dispatch follows',async()=>{
 const model=await selection(credential(true)),pi=await createPiSession(options(model)),barrier=refreshBarrier();
 const prompted=pi.session.prompt('DUMMY prompt only; no real transport');await barrier.started;
 let joined=false;const closing=pi.closeOwned().then(()=>joined=true);await turn();assert.equal(joined,false);assert.deepEqual(barrier.counts(),{auth:1,generation:0});
 barrier.release();await Promise.allSettled([prompted,closing]);assert.equal(joined,true);assert.deepEqual(barrier.counts(),{auth:1,generation:0});
 const stored=JSON.parse(await readFile(model.native.authPath,'utf8'))['openai-codex'];assert.equal(stored.refresh,'DUMMY_ROTATED_REFRESH');assert.equal(stored.access,jwt('rotated'));await pi.closeOwned();await assert.rejects(pi.modelRuntime.getAuth(pi.modelRuntime.getModel(model.provider,model.modelId)));
 globalThis.fetch=deny;
});

test('failed original SDK refresh is joined and leaves original synthetic credential intact',async()=>{
 const model=await selection(credential(true)),owned=await createOwnedNativeOAuth(model.native,[work]),barrier=refreshBarrier({fail:true});const auth=owned.runtime.getAuth(owned.selected);await barrier.started;
 let joined=false;const closed=owned.close().then(()=>joined=true);await turn();assert.equal(joined,false);barrier.release();await assert.rejects(auth);await closed;assert.equal(joined,true);assert.equal(JSON.parse(await readFile(model.native.authPath,'utf8'))['openai-codex'].refresh,'DUMMY_REFRESH');assert.deepEqual(barrier.counts(),{auth:1,generation:0});globalThis.fetch=deny;
});

test('construction failure releases its native owner without fallback or credential mutation',async()=>{
 const model=await selection(),before=await readFile(model.native.authPath,'utf8');
 const sessions=join(state,'sessions');await mkdir(sessions,{mode:0o700,recursive:true});await chmod(sessions,0o755);
 try{await assert.rejects(createPiSession(options(model)),/owner-only/);}finally{await chmod(sessions,0o700);}
 assert.equal(await readFile(model.native.authPath,'utf8'),before);
});

test('ordinary actual SDK native session healthy uses original SSE client and callbacks; copied profile cannot drift during async admission',async()=>{
 const model=await selection(),selectedPath=model.native.authPath,bad=await selection({type:'api_key',key:'DUMMY_OTHER'});
 let prepares=0;const creating=createPiSession({...options(model),beforeModelRequest:async()=>{prepares++;}});model.native.authPath=bad.native.authPath;model.native.projectRoots.length=0;
 const pi=await creating;let requests=0;
 globalThis.fetch=async(url)=>{
  assert.equal(String(url),'https://chatgpt.com/backend-api/codex/responses');requests++;
  const item={id:'owned-msg',type:'message',role:'assistant',content:[{type:'output_text',text:'owned healthy native reply',annotations:[]}]};
  const events=[{type:'response.created',response:{id:'owned-response'}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:'owned healthy native reply'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'owned-response',status:'completed',output:[item],usage:{input_tokens:7,output_tokens:5,total_tokens:12,input_tokens_details:{cached_tokens:0}}}}];
  return new Response(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
 };
 try{
  await pi.session.prompt('DUMMY healthy ordinary entry');assert.equal(requests,1);assert.equal(prepares,1);const last=pi.session.messages.filter(x=>x.role==='assistant').at(-1);assert.equal(last.stopReason,'stop');assert.equal(last.content.find(x=>x.type==='text').text,'owned healthy native reply');assert.equal(pi.modelRuntime.getModel('openai-codex','gpt-6.1-sol').api,'openai-codex-responses');assert.equal(JSON.parse(await readFile(selectedPath,'utf8'))['openai-codex'].type,'oauth');
 }finally{await pi.closeOwned();globalThis.fetch=deny;}
});

test('normal owner-profile selection reaches actual governed native role and preserves strict RoleOutput/history',async()=>{
 const {runRole}=await import('../../dist/workflow/adapter.js');
 const model=await selection(),file=join(root,'managed-profile.json');await writeFile(file,JSON.stringify({provider:model.provider,modelId:model.modelId,native:{kind:'pi-oauth',authPath:model.native.authPath}}),{mode:0o600});
 const selected=await readModelProfile(file,[work]),final=JSON.stringify({version:1,summary:'Owned scripted native assessment',findings:[],assessedScope:[]});let requests=0,checkpoints=0;
 globalThis.fetch=async(url)=>{
  assert.equal(String(url),'https://chatgpt.com/backend-api/codex/responses');requests++;
  const item={id:'owned-role-msg',type:'message',role:'assistant',content:[{type:'output_text',text:final,annotations:[]}]},events=[{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:final},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'owned-role-response',status:'completed',output:[item],usage:{input_tokens:7,output_tokens:5,total_tokens:12,input_tokens_details:{cached_tokens:0}}}}];
  return new Response(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
 };
 try{
  const result=await runRole({launchId:'owned-native-launch',role:'reviewer',inputBundle:{requirements:'Assess the owned fixture',contracts:'Retain actual evidence',context:{stage:'review'},sources:[],requiredScope:[]},operations:operations(),host,model:selected,beforeModelRequest:async()=>{checkpoints++;},assertEntry:()=>{}});
  assert.equal(result.usable,true,result.issues.join(';'));assert.equal(result.rawFinal,final);assert.equal(result.protocol.summary,'Owned scripted native assessment');assert.ok(result.selectedFinalEntryId);assert.equal(requests,1);assert.equal(checkpoints,1);
 }finally{globalThis.fetch=deny;}
});


test('programmatic native actual selectors refuse before runtime/auth/provider construction',async()=>{
 const model=await selection();
 for(const wrong of [{provider:'anthropic'},{modelId:'gpt-6.1-other'}]){
  const before=await readFile(model.native.authPath,'utf8');
  await assert.rejects(createPiSession(options({...model,...wrong})),/selected openai-codex\/gpt-6.1-sol OAuth/);
  assert.equal(await readFile(model.native.authPath,'utf8'),before);
 }
 assert.equal(unexpected,0);
});
