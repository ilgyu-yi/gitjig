import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {createPiSession,initializePiHost} from '../../dist/pi/index.js';import {readModelProfile} from '../../dist/cli/model-profile.js';import {createOwnedPiProvider} from '../../dist/pi/native-provider.js';import {modelConfigurationIdentity} from '../../dist/pi/model-identity.js';
import{wireResponse,builtinRoutes}from'./provider-wire-fixture.mjs';
const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'gitjig-builtin-profiles-'))),work=join(root,'work'),state=join(root,'state'),artifacts=join(root,'artifacts');for(const dir of[work,state,artifacts])await fs.mkdir(dir,{mode:0o700});
const originalFetch=globalThis.fetch,originalTemp=process.env.TMPDIR,ambient={OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY};process.env.TMPDIR=artifacts;process.env.OPENAI_API_KEY='sk-DUMMY-AMBIENT-NOT-SELECTED';process.env.OPENROUTER_API_KEY='sk-DUMMY-AMBIENT-NOT-SELECTED';
let unexpected=0;const deny=async()=>{unexpected++;throw Error('No unselected transport');};globalThis.fetch=deny;
after(async()=>{globalThis.fetch=originalFetch;if(originalTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTemp;for(const[key,value]of Object.entries(ambient))if(value===undefined)delete process.env[key];else process.env[key]=value;await fs.rm(root,{recursive:true,force:true});assert.equal(unexpected,0);});
const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts});let reads=0,serial=0;
const operations={workspaceRoot:work,validatePath:p=>resolve(work,p),async exec(){throw Error('NO_EXEC');},async readFile(p){assert.equal(p,join(work,'owned.txt'));reads++;return Buffer.from('OWNED_FROM_EXECUTOR');},async access(){},async writeFile(){throw Error('NO_WRITE');},async mkdir(){throw Error('NO_MKDIR');}};
async function fixture(route,key='sk-DUMMY-SELECTED-A'){
 const authPath=join(root,'auth-'+serial+'.json'),profileFile=join(root,'profile-'+serial+++'.json');
 await fs.writeFile(authPath,JSON.stringify({[route.provider]:{type:'api_key',key}}),{mode:0o600});await fs.writeFile(profileFile,JSON.stringify({provider:route.provider,modelId:route.modelId,native:{kind:'pi-stored',credentialType:'api_key',authPath}}),{mode:0o600});
 return{authPath,profileFile,model:await readModelProfile(profileFile,[work])};
}
const options=model=>({host,operations,model,systemPrompt:'Owned builtin profile consumer; use only supplied tools.',maxReadBytes:1024,beforeModelRequest:async()=>{}});
for(const route of builtinRoutes){
 test(route.provider+' native catalogue/codec/tool and selected-record rotation/reopen',{timeout:10000},async()=>{
  const f=await fixture(route),keyA='sk-DUMMY-SELECTED-A',keyB='sk-DUMMY-SELECTED-B';let expectedKey=keyA,calls=0;const readBefore=reads;
  globalThis.fetch=async(url,init)=>{assert.equal(String(url),route.url);const headers=new Headers(init.headers);assert.equal(headers.get('authorization'),'Bearer '+expectedKey);if(route.provider==='openrouter'){assert.equal(headers.get('http-referer'),'https://pi.dev');assert.equal(headers.get('x-openrouter-title'),'pi');assert.equal(headers.get('x-openrouter-categories'),'cli-agent');}const body=JSON.parse(init.body);assert.equal(body.model,route.modelId);calls++;if(calls===2)assert.match(JSON.stringify(body),/OWNED_FROM_EXECUTOR/);return wireResponse(route.api,route.modelId,{tool:calls===1,text:'SYNTHETIC builtin '+calls});};
  let pi=await createPiSession(options(f.model));const id=pi.sessionManager.getSessionId(),file=pi.sessionManager.getSessionFile();
  try{
   assert.equal(pi.session.model.api,route.api);assert.equal(pi.modelRuntime.getRegisteredProviderIds().length,0,'No compatibility provider definition replaces the builtin');
   await pi.session.prompt('Read owned.txt with the admitted tool.');assert.equal(calls,2);assert.equal(reads,readBefore+1);assert.equal(pi.session.messages.find(m=>m.role==='toolResult').toolCallId,route.api==='openai-responses'?'call_owned|fc_owned':'call_owned');
   await fs.writeFile(f.authPath,JSON.stringify({unrelated:{type:'api_key',key:'sk-DUMMY-UNRELATED'},[route.provider]:{key:keyA,type:'api_key'}},null,2),{mode:0o600});await pi.session.prompt('Unrelated record edits do not change selected semantics.');assert.equal(calls,3);
   await fs.writeFile(f.authPath,JSON.stringify({[route.provider]:{type:'api_key',key:keyB}}),{mode:0o600});let refusal;try{await pi.modelRuntime.getAuth(pi.session.model);}catch(error){refusal=String(error);}assert.match(refusal,/changed.*fresh execution/);assert.ok(!refusal.includes(keyA)&&!refusal.includes(keyB));assert.equal(calls,3);
   await pi.closeOwned();expectedKey=keyB;pi=await createPiSession({...options(await readModelProfile(f.profileFile,[work])),sessionManager:SessionManager.open(file)});assert.equal(pi.sessionManager.getSessionId(),id);await pi.session.prompt('Fresh execution uses the deliberately rotated source.');assert.equal(calls,4);assert.match(JSON.stringify(pi.session.messages),/Unrelated record edits/);
   const identity=JSON.stringify(modelConfigurationIdentity(f.model));assert.ok(identity.includes('credentialType'));assert.ok(!identity.includes(keyA)&&!identity.includes(keyB));const history=await fs.readFile(file,'utf8');assert.ok(!history.includes(keyA)&&!history.includes(keyB));
   pi.sealOwned();await pi.joinIdleOwned();
  }finally{await pi.closeOwned();globalThis.fetch=deny;}
 });
 test(route.provider+' original native manual summary preserves selected credential source',{timeout:10000},async()=>{
  const f=await fixture(route),pi=await createPiSession(options(f.model));let calls=0;
  globalThis.fetch=async(url,init)=>{assert.equal(String(url),route.url);assert.equal(new Headers(init.headers).get('authorization'),'Bearer sk-DUMMY-SELECTED-A');calls++;return wireResponse(route.api,route.modelId,{text:'SYNTHETIC retained summary '+calls});};
  try{pi.session.settingsManager.applyOverrides({compaction:{enabled:false,keepRecentTokens:20,reserveTokens:100}});for(let i=0;i<4;i++)await pi.session.prompt('Owned real history '+i+' '+('history words '.repeat(80)));const before=calls,result=await pi.compactOwned();assert.match(result.summary,/SYNTHETIC retained summary/);assert.ok(calls>before&&calls<=before+2);assert.ok(pi.sessionManager.getEntries().some(e=>e.type==='compaction'));}finally{await pi.closeOwned();globalThis.fetch=deny;}
 });
 test(route.provider+' missing/empty/wrong/helper/env credentials never inherit ambient auth',{timeout:10000},async()=>{
  const f=await fixture(route);for(const credential of[undefined,{type:'api_key',key:''},{type:'api_key',key:'!helper-command'},{type:'api_key',key:'$OPENAI_API_KEY'},{type:'api_key',key:'sk-DUMMY',env:{OTHER:'unselected'}},{type:'oauth',access:'DUMMY',refresh:'DUMMY',expires:Date.now()+100000}]){
   await fs.writeFile(f.authPath,JSON.stringify(credential?{[route.provider]:credential}:{}),{mode:0o600});await assert.rejects(createPiSession(options(f.model)),/literal API key/);
  }
  await fs.writeFile(f.authPath,JSON.stringify({[route.provider]:{type:'api_key',key:'sk-DUMMY-SELECTED-A'}}),{mode:0o600});const pi=await createPiSession(options(f.model));try{await assert.rejects(pi.modelRuntime.getAuth(pi.session.model,{apiKey:'sk-DUMMY-FOREIGN'}),/cannot select another/);await assert.rejects(pi.modelRuntime.getAuth(pi.session.model,{env:{OPENAI_API_KEY:'sk-DUMMY-FOREIGN'}}),/cannot select another/);await fs.writeFile(f.authPath,'{}',{mode:0o600});await assert.rejects(pi.modelRuntime.getAuth(pi.session.model),/literal API key/);assert.equal(unexpected,0);}finally{await pi.closeOwned();}
 });
 test(route.provider+' explicit zero-retry policy reaches original codec on retryable failure',{timeout:10000},async()=>{
  const f=await fixture(route),pi=await createPiSession(options(f.model));let calls=0;globalThis.fetch=async(url)=>{assert.equal(String(url),route.url);calls++;return Response.json({error:{message:'OWNED_RETRYABLE_FAILURE',type:'server_error'}},{status:503});};
  try{const message=await pi.modelRuntime.streamSimple(pi.session.model,{messages:[{role:'user',content:'Owned retry control',timestamp:0}]}).result();assert.equal(message.stopReason,'error');assert.equal(calls,1);pi.sealOwned();await assert.rejects(pi.joinIdleOwned(),/idle/);}finally{await pi.closeOwned();globalThis.fetch=deny;}
 });
 test(route.provider+' selected source survives both original stream header boundaries',{timeout:10000},async()=>{
  const f=await fixture(route),owner=await createOwnedPiProvider(route.provider,route.modelId,f.model.native,[work]);let calls=0;
  globalThis.fetch=async(url,init)=>{assert.equal(String(url),route.url);assert.equal(new Headers(init.headers).get('authorization'),'Bearer sk-DUMMY-SELECTED-A');calls++;return wireResponse(route.api,route.modelId,{text:'SYNTHETIC selected headers'});};
  const context={messages:[{role:'user',content:'Owned header source control',timestamp:0}]};
  try{
   for(const method of['streamSimple','stream']){
    for(const override of[{headers:{Authorization:'Bearer sk-DUMMY-FOREIGN'}},{headers:{aUtHoRiZaTiOn:'Bearer sk-DUMMY-FOREIGN'}},{headers:{authorization:null}},{headers:{Authorization:'Bearer sk-DUMMY-FOREIGN',authorization:'Bearer sk-DUMMY-SELECTED-A'}},{headers:{'X-Arbitrary':'unsupported'}},{transformHeaders:headers=>({...headers,AUTHORIZATION:'Bearer sk-DUMMY-FOREIGN'})},{transformHeaders:headers=>({...headers,'X-Unknown-Source':'unsupported'})}]){
     const before=calls;let failure;try{const result=await owner.runtime[method](owner.selected,context,override).result();assert.equal(result.stopReason,'error');failure=result.errorMessage;}catch(error){failure=String(error);}assert.match(failure,/original Pi authentication headers/);assert.ok(!failure.includes('sk-DUMMY-FOREIGN')&&!failure.includes('sk-DUMMY-SELECTED-A'));assert.equal(calls,before);
    }
    const supplied={},callbackOutput={};const stream=owner.runtime[method](owner.selected,context,{headers:supplied,transformHeaders:headers=>{Object.assign(callbackOutput,headers);return callbackOutput;},onPayload:()=>{callbackOutput.Authorization='Bearer sk-DUMMY-LATE-CALLBACK';}});supplied.Authorization='Bearer sk-DUMMY-LATE';assert.equal((await stream.result()).stopReason,'stop');
   }
   assert.equal(calls,2);
  }finally{await owner.close();globalThis.fetch=deny;}
 });
}
test('mutating a public catalogue object cannot retarget an admitted native endpoint',{timeout:10000},async()=>{
 const f=await fixture(builtinRoutes[0]),pi=await createPiSession(options(f.model)),selected=pi.modelRuntime.getModel(f.model.provider,f.model.modelId),original=selected.baseUrl;
 try{selected.baseUrl='https://unselected.invalid';await assert.rejects(pi.modelRuntime.getAuth(selected),/endpoint fallback/);assert.equal(unexpected,0);}finally{selected.baseUrl=original;await pi.closeOwned();}
});
test('unsupported catalogue/API/auth/source selection refuses and host scope cannot be supplied through JSON',{timeout:10000},async()=>{
 const f=await fixture(builtinRoutes[1]);for(const patch of[{provider:'unqualified-provider'},{modelId:'missing-owned-model'},{modelId:'anthropic/claude-sonnet-4.5'},{native:{...f.model.native,credentialType:'oauth'}}])await assert.rejects(createPiSession(options({...f.model,...patch})),/unavailable|authentication kind/);
 const json={provider:'openrouter',modelId:f.model.modelId,native:{kind:'pi-stored',credentialType:'api_key',authPath:f.authPath,projectRoots:[]}};await fs.writeFile(f.profileFile,JSON.stringify(json),{mode:0o600});await assert.rejects(readModelProfile(f.profileFile,[work]),/explicit credential kind/);
 assert.equal(unexpected,0);
});
test('new catalogue-selected OAuth profile retains old shorthand and source without model-id lifecycle hardcoding',{timeout:10000},async()=>{
 const authPath=join(root,'oauth.json'),access='DUMMY.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'DUMMY_ACCOUNT'}})).toString('base64url')+'.DUMMY';await fs.writeFile(authPath,JSON.stringify({'openai-codex':{type:'oauth',access,refresh:'DUMMY_REFRESH',expires:Date.now()+86400000}}),{mode:0o600});
 const native={kind:'pi-stored',credentialType:'oauth',authPath,projectRoots:[work]},owner=await createOwnedPiProvider('openai-codex','gpt-6-sol',native,[work]);try{assert.equal(owner.selected.id,'gpt-6-sol');assert.equal((await owner.runtime.getAuth(owner.selected)).auth.apiKey,access);}finally{await owner.close();}
 const pi=await createPiSession(options({provider:'openai-codex',modelId:'gpt-6-sol',native}));let requests=0;globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://chatgpt.com/backend-api/codex/responses');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+access);requests++;return wireResponse('openai-codex-responses','gpt-6-sol',{text:'SYNTHETIC selected OAuth summary'});};try{pi.session.settingsManager.applyOverrides({compaction:{enabled:false,keepRecentTokens:20,reserveTokens:100}});for(let i=0;i<4;i++)await pi.session.prompt('Owned OAuth summary context '+('history words '.repeat(80)));const before=requests,summary=await pi.compactOwned();assert.match(summary.summary,/SYNTHETIC selected OAuth summary/);assert.ok(requests>before&&requests<=before+2);}finally{await pi.closeOwned();globalThis.fetch=deny;}
 await assert.rejects(createOwnedPiProvider('openai-codex','gpt-6-sol',{kind:'pi-oauth',authPath,projectRoots:[work]},[work]),/selected openai-codex/);
 const a=modelConfigurationIdentity({provider:'openai-codex',modelId:'gpt-6.1-sol',native}),b=modelConfigurationIdentity({provider:'openai-codex',modelId:'gpt-6.1-sol',native:{kind:'pi-oauth',authPath,projectRoots:[work]}});assert.notDeepEqual(a,b);assert.ok(!JSON.stringify(a).includes(access));assert.equal(unexpected,0);
});
