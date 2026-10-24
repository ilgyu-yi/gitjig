/** Actual compactOwned/original SDK consumer; text and clean EOF are not summary credit. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const[candidate,root]=process.argv.slice(2),cwd=path.join(root,'host'),state=path.join(root,'state'),artifacts=path.join(root,'artifacts'),project=path.join(root,'project');for(const dir of[cwd,state,artifacts,project])fs.mkdirSync(dir,{mode:0o700});
for(const key of Object.keys(process.env))if(!['PATH','USER','LOGNAME','LANG','LC_ALL','SHELL'].includes(key))delete process.env[key];process.env.HOME=root;process.env.TMPDIR=artifacts;process.env.PI_CODING_AGENT_DIR=cwd;process.chdir(cwd);
fs.writeFileSync(path.join(cwd,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
const{createOwnedClaudeHost,createPiSession,initializePiHost}=await import(pathToFileURL(path.join(candidate,'dist/pi/index.js')).href);
const executable=path.join(candidate,'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),resource=await createOwnedClaudeHost({cwd,agentDir:cwd,executable:{file:executable,sha256:createHash('sha256').update(fs.readFileSync(executable)).digest('hex')}});
const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts}),operations={workspaceRoot:project,validatePath:p=>path.resolve(project,p),async exec(){throw Error('NO_EXEC');},async readFile(){throw Error('NO_READ');},async access(){throw Error('NO_ACCESS');},async writeFile(){throw Error('NO_WRITE');},async mkdir(){throw Error('NO_MKDIR');}};
let pi,checkpoints=0,failure,result;const notifications=[];
try{
 pi=await createPiSession({host,operations,model:resource.modelSelection,systemPrompt:'DUMMY resultless summary consumer',maxReadBytes:1024,beforeModelRequest:async()=>{checkpoints++;}});
 const ui=pi.session.extensionRunner.getUIContext();pi.session.extensionRunner.setUIContext({...ui,notify:(message,type)=>notifications.push({message,type})},'json');
 for(let i=0;i<8;i++){pi.sessionManager.appendMessage({role:'user',content:'DUMMY history '+i+' '+('x'.repeat(20000)),timestamp:i});pi.sessionManager.appendMessage({role:'assistant',content:[{type:'text',text:'DUMMY answer '+i+' '+('y'.repeat(20000))}],api:'claude-agent-sdk',provider:'claude-bridge',model:'claude-opus-5-5',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:i});}
 const before=pi.sessionManager.getEntries().filter(e=>e.type==='compaction').length;
 try{await pi.compactOwned();}catch(error){failure=String(error);}
 // The public takeover reports cancellation; its original diagnostic retains the causal terminal failure.
 assert.match(failure,/Compaction cancelled/);assert.ok(notifications.some(item=>/BRIDGE_HOST_SUMMARY_RESULT_INCOMPLETE/.test(item.message)));assert.equal(checkpoints,1);assert.equal(pi.sessionManager.getEntries().filter(e=>e.type==='compaction').length,before);
 const births=fs.readFileSync(path.join(cwd,'fixture-observation.json'),'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.equal(births.length,1);assert.equal(births[0].mode,'eof');
 const events=fs.readFileSync(path.join(cwd,'fixture-native-events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(events.map(e=>e.kind),['natural-eof-no-result']);
 result={complete:true,syntheticOnly:true,scope:'actual public compaction resultless EOF refusal',checkpoints,failure,notifications,historyRef:pi.sessionManager.getSessionFile(),historyCompactionsBefore:before,historyCompactionsAfter:before,owner:pi.sessionManager.getSessionId(),births,events};
}finally{await pi?.closeOwned();await resource.close();if(result){result.cleanup='joined';fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));}}
