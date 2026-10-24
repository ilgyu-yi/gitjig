// Actual public factory admission discriminator. No prompt/native process/auth/engine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [rootArg,productRoot]=process.argv.slice(2),root=fs.realpathSync(rootArg);
const cwd=path.join(root,'host'),state=path.join(root,'state'),artifacts=path.join(root,'artifacts'),project=path.join(root,'project');
for(const p of [cwd,state,artifacts,project])fs.mkdirSync(p,{mode:0o700});
for(const key of Object.keys(process.env))if(!['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','SHELL'].includes(key))delete process.env[key];
process.chdir(cwd);process.env.PI_CODING_AGENT_DIR=cwd;process.env.TMPDIR=artifacts;
fs.writeFileSync(path.join(cwd,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
const product=relative=>pathToFileURL(path.join(productRoot,relative)).href;
const {createOwnedClaudeHost,admitOwnedClaudeSelection}=await import(product('pi/claude-host.js'));
// This *real* invalid executable pin arms the very first acquisition. It must
// remain unreached by wrong selectors, then demonstrably reject a correct one.
const owner=await createOwnedClaudeHost({cwd,agentDir:cwd,executable:{file:fs.realpathSync(process.execPath),sha256:'0'.repeat(64)}});
const {createPiSession,initializePiHost}=await import(product('pi/index.js'));
const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts});
const operations={workspaceRoot:project,validatePath:p=>path.resolve(project,p),async exec(){throw Error('NO_EXEC');},async readFile(){throw Error('NO_READ');},async access(){throw Error('NO_ACCESS');},async writeFile(){throw Error('NO_WRITE');},async mkdir(){throw Error('NO_MKDIR');}};
const base={host,operations,systemPrompt:'Admission control only; never prompt.',maxReadBytes:1024};
try{
 const canonical=admitOwnedClaudeSelection({provider:'claude-bridge',modelId:'claude-opus-5-5',bridge:owner});
 assert.equal(canonical,owner.modelSelection);assert.equal(canonical.bridgeProfile,owner.modelSelection.bridgeProfile);
 for(const patch of [{provider:'openai-codex',modelId:'gpt-6.1-sol'},{modelId:'invented-model'},{bridgeProfile:{...owner.modelSelection.bridgeProfile,cwd:project}}]){
  const model={...owner.modelSelection,bridge:owner,...patch};
  await assert.rejects(createPiSession({...base,model}),/Bridge selector does not match admitted owner/);
 }
 await assert.rejects(createPiSession({...base,model:owner.modelSelection}),/Native executable identity changed/);
 console.log(JSON.stringify({complete:true,wrongSelectors:3,armedProducerAdmissionRefused:true,scope:'no prompt/native launch'}));
}finally{await owner.close();}
