// Harmless root-local control only. No prompt, native query, auth file, or model call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [mode, outputRoot, productRoot] = process.argv.slice(2);
const root=fs.realpathSync(outputRoot), cwd=path.join(root,'host'), state=path.join(root,'state'), artifacts=path.join(root,'artifacts'), project=path.join(root,'project');
for(const dir of [cwd,state,artifacts,project])fs.mkdirSync(dir,{mode:0o700});
for(const name of Object.keys(process.env))if(!['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','SHELL'].includes(name))delete process.env[name];
process.env.PI_CODING_AGENT_DIR=cwd;process.env.TMPDIR=artifacts;process.chdir(cwd);
fs.writeFileSync(path.join(cwd,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
const moduleUrl=relative=>pathToFileURL(path.join(productRoot,relative)).href;
const {createOwnedClaudeHost}=await import(moduleUrl('pi/claude-host.js'));
const executable={file:fs.realpathSync(process.execPath),sha256:createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex')};
if(mode==='hostile'||mode==='config'){
 if(mode==='hostile')process.env.ANTHROPIC_API_KEY='DUMMY_MUST_NOT_RESOLVE';
 else fs.writeFileSync(path.join(cwd,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:true},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
 await assert.rejects(createOwnedClaudeHost({cwd,agentDir:cwd,executable}),mode==='hostile'?/Ambient provider/:/fixed no-helper/);
 assert.equal(fs.existsSync(path.join(cwd,'auth.json')),false);
 console.log(JSON.stringify({mode,complete:true,selected:false,scope:'pre-registration refusal'}));
}else{
 const resource=await createOwnedClaudeHost({cwd,agentDir:cwd,executable});
 assert.deepEqual(Object.keys(resource.modelSelection),['provider','modelId','bridgeProfile']);
 assert.equal(JSON.stringify(resource.modelSelection).includes('executable'),true);
 assert.equal(JSON.stringify(resource.modelSelection).includes('"bridge":'),false);
 assert.equal(JSON.stringify(resource).includes('DUMMY'),false);
 const {initializePiHost,createPiSession}=await import(moduleUrl('pi/index.js'));
 const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts});
 const operations={workspaceRoot:project,validatePath:p=>{const result=path.resolve(project,p);assert.ok(result===project||result.startsWith(project+'/'));return result;},
  async exec(){throw Error('NO_EXEC_EXPECTED');},async readFile(){throw Error('NO_READ_EXPECTED');},async access(){throw Error('NO_ACCESS_EXPECTED');},async writeFile(){throw Error('NO_WRITE_EXPECTED');},async mkdir(){throw Error('NO_MKDIR_EXPECTED');}};
 const options={host,operations,model:resource.modelSelection,systemPrompt:'Harmless public construction only; do not prompt.',maxReadBytes:1024};
 let sessions=[];
 try{
  const {SessionManager}=await import('@earendil-works/pi-coding-agent');
  await assert.rejects(createPiSession({...options,sessionManager:SessionManager.inMemory(project)}),/Native session history/);
  sessions=await Promise.all([createPiSession(options),createPiSession(options)]);
  assert.notEqual(sessions[0].sessionManager.getSessionId(),sessions[1].sessionManager.getSessionId());
  assert.throws(()=>resource.models(),/legacy startup already entered.*restart/);
  for(const item of sessions){assert.equal(item.session.model.provider,'claude-bridge');assert.equal(item.session.model.id,'claude-opus-5-5');assert.equal(item.resourceLoader.getExtensions().extensions.length,2);}
  await sessions[0].closeOwned();
  assert.equal(sessions[1].session.model.id,'claude-opus-5-5');
  const third=await createPiSession(options);sessions.push(third);await third.closeOwned();
  await sessions[1].closeOwned();
  // Same controlled process, separate explicit DUMMY OAuth resource, no refresh or dispatch.
  const authPath=path.join(root,'dummy-oauth.json');
  const access='DUMMY.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'DUMMY'}})).toString('base64url')+'.DUMMY';
  fs.writeFileSync(authPath,JSON.stringify({'openai-codex':{type:'oauth',access,refresh:'DUMMY',expires:Date.now()+86400000,accountId:'DUMMY'}}),{mode:0o600});
  const gpt=await createPiSession({...options,model:{provider:'openai-codex',modelId:'gpt-6.1-sol',native:{kind:'pi-oauth',authPath,projectRoots:[project]}}});
  assert.equal(gpt.session.model.id,'gpt-6.1-sol');
  const {openController}=await import(moduleUrl('controller/controller.js'));
  const controller=await openController({installationHome:path.join(root,'temporary-controller')});
  await controller.adoptModelResource(resource);await controller.adoptModelResource(resource);
  const secondController=await openController({installationHome:path.join(root,'other-temporary-controller')});
  await assert.rejects(secondController.adoptModelResource(resource),/another controller/);
  await secondController.close();
  await controller.close();await controller.close();
  assert.ok(await gpt.modelRuntime.getAuth('openai-codex'));
  await gpt.closeOwned();
  await assert.rejects(createPiSession(options),/closing/);
  assert.equal(fs.existsSync(path.join(cwd,'auth.json')),false);
  console.log(JSON.stringify({mode,complete:true,owners:3,selectedModel:'claude-opus-5-5',scope:'public unprompted construction',hostAuthFileCreated:false}));
 }finally{for(const item of sessions)await item.closeOwned();await resource.close();}
}
