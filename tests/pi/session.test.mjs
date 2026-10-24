import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,rename,unlink,readdir,link,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {initializePiHost,createPiSession} from '../../dist/pi/index.js';
import {PiArtifacts} from '../../dist/pi/host.js';
import {createProjectTools} from '../../dist/pi/tools.js';

const outer=await realpath(await mkdtemp(join(tmpdir(),'gitjig-pi-test-')));
const artifactRoot=join(outer,'artifacts'),stateRoot=join(outer,'state'),workspace=join(outer,'work');
for(const p of [artifactRoot,stateRoot,workspace])await mkdir(p,{mode:0o700});
const originalTemp=process.env.TMPDIR;const artifactTemp=artifactRoot.replace(/^\/private\/var\//,'/var/');process.env.TMPDIR=artifactTemp;
const host=await initializePiHost({stateRoot,artifactRoot});

function executor(){
 const files=new Map(),calls=[];
 const ops={workspaceRoot:workspace,calls,files,
  validatePath(p){const full=resolve(workspace,p),rel=relative(workspace,full);if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('outside owned scope');return full;},
  async exec(command,cwd,options){calls.push({kind:'exec',command,cwd,options});options.signal?.throwIfAborted();options.onData(Buffer.from('executor:'+command+'\n'));return {exitCode:0};},
  async readFile(p,{maxBytes,signal}){signal?.throwIfAborted();calls.push({kind:'read',path:p,maxBytes});if(!files.has(p))throw Error('executor read refused');const b=Buffer.from(files.get(p));if(b.length>maxBytes)throw Error('executor read cap');return b;},
  async access(p,mode,signal){signal?.throwIfAborted();calls.push({kind:'access',path:p,mode});if(!files.has(p))throw Error('executor access refused');},
  async writeFile(p,content,signal){signal?.throwIfAborted();calls.push({kind:'write',path:p});files.set(p,Buffer.from(content));},
  async mkdir(p,signal){signal?.throwIfAborted();calls.push({kind:'mkdir',path:p});},
 };return ops;
}
function definition(steps=[]){let turn=0;return {baseUrl:'http://unused.invalid',apiKey:'fixture-only',api:'fixture-api',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(model,context,options){
 const stream=createAssistantMessageEventStream();void(async()=>{
  await options?.onPayload?.({fixture:true},model);await new Promise(r=>setTimeout(r,3));
  const step=steps[turn++];const msg={role:'assistant',content:step?[{type:'toolCall',id:'call-'+turn,name:step.name,arguments:step.args}]:[{type:'text',text:'fixture-complete'}],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:step?'toolUse':'stop',timestamp:Date.now()};
  stream.push({type:'done',reason:msg.stopReason,message:msg});stream.end(msg);
 })();return stream;
}};}
const options=(ops,steps=[])=>({host,operations:ops,model:{provider:'fixture',modelId:'fixture',definition:definition(steps)},systemPrompt:'Fixture: use only supplied project tools.',maxReadBytes:1024});

test('P0 Pi adapter has explicit producers and no host project fallback',async t=>{
 await t.test('read-only reduction rejects native mutation dispatch and actual user-bash operations',async()=>{
  const ops=executor();ops.files.set(join(workspace,'known.txt'),Buffer.from('READ_ONLY_KNOWN'));
  const product=await createPiSession({...options(ops,[{name:'write',args:{path:'known.txt',content:'forbidden'}},{name:'edit',args:{path:'known.txt',edits:[{oldText:'READ_ONLY_KNOWN',newText:'forbidden'}]}},{name:'bash',args:{command:'forbidden'}},{name:'read',args:{path:'known.txt'}}]),readOnly:true});
  try{
   assert.deepEqual(product.session.getActiveToolNames(),['read']);await product.session.prompt('Try forbidden operations and then an allowed read');
   assert.equal(product.session.messages.filter(m=>m.role==='toolResult'&&m.isError).length,3);
   assert.equal(ops.files.get(join(workspace,'known.txt')).toString(),'READ_ONLY_KNOWN');assert.ok(ops.calls.some(c=>c.kind==='read'));assert.ok(!ops.calls.some(c=>['write','mkdir','exec'].includes(c.kind)));
   await assert.rejects(product.executeUserBash('forbidden'),/review is read-only/);
   const hook=await product.session.extensionRunner.emitUserBash({type:'user_bash',command:'forbidden-hook',excludeFromContext:false,cwd:workspace});assert.ok(hook.operations);
   await assert.rejects(product.session.executeBash('forbidden-hook',undefined,{operations:hook.operations}),/review is read-only/);assert.ok(!ops.calls.some(c=>c.kind==='exec'));
  }finally{await product.closeOwned();}
 });
 await t.test('actual SDK model calls all four injected native tool algorithms',async()=>{
  const ops=executor();const product=await createPiSession(options(ops,[
   {name:'write',args:{path:'file.txt',content:'alpha\n'}},{name:'read',args:{path:'file.txt'}},
   {name:'edit',args:{path:'file.txt',edits:[{oldText:'alpha',newText:'beta'}]}},
   {name:'bash',args:{command:'run-fixture',timeout:2}},
  ]));
  try{
   assert.deepEqual(product.session.getActiveToolNames().sort(),['bash','edit','read','write']);
   const events=[];product.session.subscribe(e=>events.push(e.type));await product.session.prompt('execute fixture');
   assert.equal(ops.files.get(join(workspace,'file.txt')).toString(),'beta\n');
   assert.ok(ops.calls.some(c=>c.kind==='read'&&c.maxBytes===1024));
   const shell=ops.calls.find(c=>c.kind==='exec');assert.equal(shell.options.timeout,2);assert.equal(shell.options.env,undefined);assert.ok(shell.options.signal instanceof AbortSignal);
   assert.equal(product.session.messages.filter(m=>m.role==='toolResult').length,4);assert.ok(events.includes('agent_settled'));
   await assert.rejects(readFile(join(workspace,'file.txt'))); // executor's virtual file is not host I/O.
   const user=await product.executeUserBash('human-bash');assert.match(user.output,/executor:human-bash/);
   const hook=await product.session.extensionRunner.emitUserBash({type:'user_bash',command:'hook-bash',excludeFromContext:false,cwd:workspace});assert.ok(hook.operations);
   const viaHook=await product.session.executeBash('hook-bash',undefined,{operations:hook.operations});assert.match(viaHook.output,/executor:hook-bash/);
   const abort=new AbortController();abort.abort();await assert.rejects(product.executeUserBash('aborted',abort.signal));
  }finally{await product.session.abort();product.session.dispose();}
 });
 await t.test('planting project resources does not load host code or leak fallback file bytes',async()=>{
  const hidden=join(workspace,'.pi','extensions');await mkdir(hidden,{recursive:true});const marker=join(outer,'plant-ran');
  await writeFile(join(hidden,'plant.mjs'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'ran');export default()=>{};`);
  await writeFile(join(workspace,'host-only.txt'),'HOST_PRIVATE');
  const product=await createPiSession(options(executor(),[{name:'read',args:{path:'host-only.txt'}}]));
  try{
   await product.session.prompt('try executor read');
   const result=product.session.messages.find(m=>m.role==='toolResult');assert.equal(result.isError,true);assert.doesNotMatch(JSON.stringify(result),/HOST_PRIVATE/);
   await assert.rejects(readFile(marker));assert.equal(product.resourceLoader.getExtensions().extensions.length,1);
   assert.deepEqual(product.resourceLoader.getSkills().skills,[]);assert.throws(()=>product.resourceLoader.extendResources({skillPaths:[{path:workspace}]}));
  }finally{await product.session.abort();product.session.dispose();}
 });
 await t.test('bounded text read rejects binary/oversize and arbitrary host artifacts',async()=>{
  const ops=executor();const artifacts=new PiArtifacts(host,1024);const tools=createProjectTools(ops,artifacts,1024),read=tools.find(x=>x.name==='read');
  ops.files.set(join(workspace,'binary'),Buffer.from([0,255]));await assert.rejects(read.execute('binary',{path:'binary'}),/Binary\/image/);
  ops.files.set(join(workspace,'large'),Buffer.alloc(1025,65));await assert.rejects(read.execute('large',{path:'large'}),/cap/);
  const arbitrary=join(artifactRoot,'unregistered');await writeFile(arbitrary,'private',{mode:0o600});await assert.rejects(read.execute('outside',{path:arbitrary}),/outside owned scope/);
  assert.match(read.description,/Binary and image inputs are unsupported/);
  process.env.TMPDIR=workspace;
  try { await assert.rejects(tools.find(x=>x.name==='bash').execute('drift',{command:'no effect'}),/temp routing changed/); }
  finally { process.env.TMPDIR=artifactTemp; }
 });
 await t.test('native large-output file must be explicitly admitted before bounded read',async()=>{
  const ops=executor();ops.exec=async(command,cwd,{onData})=>{onData(Buffer.from(('x'.repeat(140)+'\n').repeat(500)));return{exitCode:0};};
  const artifacts=new PiArtifacts(host,100000),tools=createProjectTools(ops,artifacts,100000);
  const result=await tools.find(x=>x.name==='bash').execute('large',{command:'large-output'});
  const path=result.details.fullOutputPath;assert.equal(typeof path,'string');assert.ok(artifacts.has(path));const actualPath=await realpath(path);assert.ok(relative(artifactRoot,actualPath)&&!relative(artifactRoot,actualPath).startsWith('..'));
  const read=await tools.find(x=>x.name==='read').execute('read-output',{path});assert.match(read.content[0].text,/x{100}/);
  ops.exec=async(command,cwd,{onData})=>{onData(Buffer.from('x'.repeat(70000)));return{exitCode:0};};
  const longLine=await createProjectTools(ops,artifacts,100000).find(x=>x.name==='bash').execute('long-line',{command:'one-long-line'});
  await assert.rejects(tools.find(x=>x.name==='read').execute('unsupported',{path:longLine.details.fullOutputPath}),/host-artifact shell access is unsupported/);
 });
 await t.test('native history retains session identity and isolated conversation messages',async()=>{
  const a=await createPiSession(options(executor())),b=await createPiSession(options(executor()));
  try{
   await Promise.all([a.session.prompt('A only'),b.session.prompt('B only')]);
   assert.notEqual(a.sessionManager.getSessionId(),b.sessionManager.getSessionId());assert.doesNotMatch(JSON.stringify(a.session.messages),/B only/);
   const id=a.sessionManager.getSessionId(),file=a.sessionManager.getSessionFile();a.session.dispose();
   const resumed=await createPiSession({...options(executor()),sessionManager:SessionManager.open(file)});
   try{assert.equal(resumed.sessionManager.getSessionId(),id);assert.match(JSON.stringify(resumed.session.messages),/A only/);await resumed.session.prompt('followup');}finally{await resumed.session.abort();resumed.session.dispose();}
  }finally{await a.session.abort();a.session.dispose();await b.session.abort();b.session.dispose();}
 });
 await t.test('incomplete executor and credential-command fallback refuse before model activity',async()=>{
  await assert.rejects(createPiSession({...options(executor()),operations:undefined}),/executor/);
  await assert.rejects(createPiSession({...options(executor()),model:{provider:'fixture',modelId:'fixture',definition:{...definition(),apiKey:'!host-command'}}}),/literal key/);
  const link=join(outer,'state-link');await symlink(stateRoot,link);await assert.rejects(initializePiHost({stateRoot:link,artifactRoot}),/owner-only/);
 });
 await t.test('history directory and supplied leaf aliases cannot put state in author work',async()=>{
  const workspaceAlias=join(outer,'workspace-alias');await symlink(workspace,workspaceAlias);
  const aliasOps=executor();aliasOps.workspaceRoot=workspaceAlias;aliasOps.validatePath=p=>resolve(p);
  await assert.rejects(createPiSession(options(aliasOps)),/canonical real path/);
  const sessions=join(stateRoot,'sessions'),backup=join(stateRoot,'sessions-safe'),foreign=join(workspace,'sessions');
  await mkdir(foreign,{mode:0o700});await rename(sessions,backup);await symlink(foreign,sessions);
  try{await assert.rejects(createPiSession(options(executor())),/owner-only/);assert.deepEqual(await readdir(foreign),[]);}
  finally{await unlink(sessions);await rename(backup,sessions);}
  const original=await createPiSession(options(executor()));let history;
  try{await original.session.prompt('retained native history');history=original.sessionManager.getSessionFile();}finally{await original.session.abort();original.session.dispose();}
  const alias=join(sessions,'leaf-alias.jsonl');await symlink(history,alias);
  try{await assert.rejects(createPiSession({...options(executor()),sessionManager:SessionManager.open(alias)}));}finally{await unlink(alias);}
  const hard=join(workspace,'history-hardlink.jsonl');await link(history,hard);
  try{await assert.rejects(createPiSession({...options(executor()),sessionManager:SessionManager.open(history)}),/exclusively owned/);}finally{await unlink(hard);}
  const recovered=await createPiSession({...options(executor()),sessionManager:SessionManager.open(history)});
  try{assert.match(JSON.stringify(recovered.session.messages),/retained native history/);await recovered.session.prompt('recovered followup');}
  finally{await recovered.session.abort();recovered.session.dispose();}
 });
});
test.after(async()=>{if(originalTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTemp;await rm(outer,{recursive:true,force:true});});
