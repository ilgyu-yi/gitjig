import {retainFixtureChannel} from '../helpers/owned-fixture-channel.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {initializePiHost} from '../../dist/pi/host.js';
import {NativeRoleCollector,nativeRoleIntentReceipt} from '../../dist/workflow/native-role-output.js';
import {nativeCheckpoint} from '../../dist/controller/history.js';
const [stateRoot,artifactRoot,directory,mode]=process.argv.slice(2),host=await initializePiHost({stateRoot,artifactRoot});
const intent=await new Promise(resolve=>process.once('message',resolve));
// Preserve the buffered initial request before adding the persistent lifetime listener.
retainFixtureChannel();
const memory=SessionManager.inMemory('/controlled-original-recovery');memory.appendMessage({role:'user',content:'Original controlled request',timestamp:1});
const file=path.join(directory,'original.jsonl');await fs.writeFile(file,[memory.getHeader(),...memory.getBranch()].map(e=>JSON.stringify(e)+'\n').join(''),{mode:0o600});
const manager=SessionManager.open(file,directory),collector=await NativeRoleCollector.create(manager,intent,host),dispatchCheckpoint=await nativeCheckpoint(file),raw=JSON.stringify({version:1,summary:'Controlled interrupted original',findings:[{requirementId:'R1',severity:'blocking',repair:'unknown',description:'Retain original crash claim',evidence:['original source']}],assessedScope:[]});
for(const message of [{type:'system',subtype:'init',uuid:randomUUID(),session_id:'native-controlled',tools:[],plugins:[],mcp_servers:[]},{type:'assistant',uuid:randomUUID(),session_id:'native-controlled',parent_tool_use_id:null,message:{id:'message-original',role:'assistant',content:[{type:'text',text:raw}]}}])await collector.observe(message);
const ready=()=>process.send({file,sessionId:manager.getSessionId(),intent:nativeRoleIntentReceipt(intent),dispatchCheckpoint,allocation:collector.transport.allocation,raw});
if(mode==='partial'){
 const write=collector.transport.handle.write.bind(collector.transport.handle);let first=true;
 collector.transport.handle.write=async(buffer,offset,length,position)=>{if(!first)return new Promise(()=>{});first=false;const written=await write(buffer,offset,Math.max(1,length-5),position);ready();return written;};
 await collector.observe({type:'assistant',uuid:randomUUID(),session_id:'native-controlled',message:{content:[{type:'text',text:'Incomplete next original packet'}]}});
}else ready();
await new Promise(()=>{});
