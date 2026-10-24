// Explicit INJECTED early Controller-close failure; not an observed native leak.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [rootArg,productRoot]=process.argv.slice(2),root=fs.realpathSync(rootArg);
const cwd=path.join(root,'host'),state=path.join(root,'state'),artifacts=path.join(root,'artifacts'),project=path.join(root,'project');
for(const p of [cwd,state,artifacts,project])fs.mkdirSync(p,{mode:0o700});
for(const key of Object.keys(process.env))if(!['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','SHELL'].includes(key))delete process.env[key];
process.chdir(cwd);process.env.PI_CODING_AGENT_DIR=cwd;process.env.TMPDIR=artifacts;
fs.writeFileSync(path.join(cwd,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
const product=relative=>pathToFileURL(path.join(productRoot,relative)).href;
const {createOwnedClaudeHost}=await import(product('pi/claude-host.js'));
const owner=await createOwnedClaudeHost({cwd,agentDir:cwd,executable:{file:fs.realpathSync(process.execPath),sha256:createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex')}});
const {createPiSession,initializePiHost}=await import(product('pi/index.js'));
const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts});
const operations={workspaceRoot:project,validatePath:p=>path.resolve(project,p),async exec(){throw Error('NO_EXEC');},async readFile(){throw Error('NO_READ');},async access(){throw Error('NO_ACCESS');},async writeFile(){throw Error('NO_WRITE');},async mkdir(){throw Error('NO_MKDIR');}};
const options={host,operations,model:owner.modelSelection,systemPrompt:'Close ownership control; never prompt.',maxReadBytes:1024};
const pi=await createPiSession(options);
const {createProvider}=await import('@earendil-works/pi-ai');
let entered,release;const started=new Promise(resolve=>entered=resolve),barrier=new Promise(resolve=>release=resolve);
pi.modelRuntime.registerNativeProvider(createProvider({id:'owned-close-barrier',models:[],auth:{apiKey:{name:'DUMMY auth-check barrier',async resolve(){entered();await barrier;return undefined;}}},api:{stream(){throw Error('NO_STREAM');},streamSimple(){throw Error('NO_STREAM');}}}));
await started;
const {openController}=await import(product('controller/controller.js'));
const home=path.join(root,'temporary-controller'),controller=await openController({installationHome:home,modelResource:owner});
try{controller.inspectContributions({resourceId:'missing'});}catch{}
assert.ok(controller.contributionsCore);
const originalFailure=new Error('INJECTED_EARLY_CONTRIBUTIONS_CLOSE_FAILURE');
controller.contributionsCore.close=async()=>{throw originalFailure;};
let settled=false,seen;
const closing=controller.close().then(()=>{settled=true;},error=>{settled=true;seen=error;});
try{
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'early rejection must still join actual owned registration tail');
 await assert.rejects(createPiSession(options),/closing/);
 release();await closing;assert.equal(seen,originalFailure);
 // Preserve the existing early-failure store/owner-retention behavior.
 assert.equal(fs.existsSync(path.join(home,'state/owner.json')),true);
 assert.deepEqual(controller.store.all('SELECT id FROM projects'),[]);
 console.log(JSON.stringify({complete:true,scope:'INJECTED early close failure',originalErrorPreserved:true,tailJoined:true,hostAdmissionClosed:true,originalStoreOwnerRetained:true}));
}finally{release();await closing;await pi.closeOwned();await owner.close();}
