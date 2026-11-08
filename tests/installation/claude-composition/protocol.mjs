/** Fixed harmless original SDK/MCP protocol. Never reads the hidden project file. */
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';import {randomUUID} from 'node:crypto';
import http from 'node:http';import https from 'node:https';import net from 'node:net';
const refuse=()=>{throw Error('FIXTURE_NETWORK_REFUSED');};globalThis.fetch=refuse;for(const api of[http,https])for(const name of['request','get'])api[name]=refuse;net.Socket.prototype.connect=refuse;
const argv=process.argv.slice(2),resumeIndex=argv.indexOf('--resume'),resumed=resumeIndex<0?null:argv[resumeIndex+1];if(resumed&&!/^[a-f0-9-]{36}$/.test(resumed))throw Error('Invalid original resume identity');
const sessionId=resumed??randomUUID(),events=path.join(process.cwd(),'fixture-events.jsonl');
const record=value=>fs.appendFileSync(events,JSON.stringify({pid:process.pid,sessionId,...value})+'\n',{mode:0o600});record({kind:'birth',argv,resumed});
const write=v=>process.stdout.write(JSON.stringify(v)+'\n');let id=0,started=false,fixtureFailed=false,parkTimer,sdkMcpServers=null;const pending=new Map();
const call=(method,params)=>new Promise(resolve=>{const n=++id,key='fixture-'+n;pending.set(key,resolve);write({type:'control_request',request_id:key,request:{subtype:'mcp_message',server_name:'custom-tools',message:{jsonrpc:'2.0',id:n,method,params}}});});
const init=(tools=[],servers=[])=>write({type:'system',subtype:'init',session_id:sessionId,model:'claude-opus-5-5',cwd:process.cwd(),tools,mcp_servers:servers,plugins:[]});
const assistant=(content,stop='end_turn')=>write({type:'assistant',session_id:sessionId,parent_tool_use_id:null,message:{id:randomUUID(),type:'message',role:'assistant',model:'claude-opus-5-5',content,stop_reason:stop,usage:{input_tokens:1,output_tokens:1}}});
const finish=text=>{assistant([{type:'text',text}]);write({type:'result',subtype:'success',is_error:false,session_id:sessionId,duration_ms:1,duration_api_ms:1,num_turns:1,result:text,total_cost_usd:0,usage:{input_tokens:1,output_tokens:1}});record({kind:'result',text});};
const lines=readline.createInterface({input:process.stdin});const keep=setInterval(()=>{},1000);process.on('SIGTERM',()=>{clearInterval(keep);clearInterval(parkTimer);record({kind:'native-exit',resources:process.resourceUsage(),memory:process.memoryUsage()});lines.close();process.exit(fixtureFailed?2:0);});
lines.on('line',line=>{if(Buffer.byteLength(line)>524288)throw Error('Fixed protocol frame limit');const frame=JSON.parse(line);
 if(frame.type==='control_response'){const key=frame.response?.request_id;pending.get(key)?.(frame.response);pending.delete(key);return;}
 if(frame.type==='control_request'){if(frame.request?.subtype==='initialize'){const servers=frame.request.sdkMcpServers===undefined?[]:frame.request.sdkMcpServers;if(!Array.isArray(servers)||servers.some(x=>typeof x!=='string')||new Set(servers).size!==servers.length)throw Error('FIXTURE_INVALID_INITIALIZE_MCP_ROSTER');sdkMcpServers=[...servers];record({kind:'initialize',sdkMcpServers});}write({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:{commands:[],models:[],output_style:'default',available_output_styles:[]}}});return;}
 if(frame.type!=='user'||started)return;started=true;
 const text=JSON.stringify(frame.message?.content??frame.message??frame);
 void(async()=>{
  if(text.includes('[134:READ]')){
   if(JSON.stringify(sdkMcpServers)!==JSON.stringify(['custom-tools']))throw Error('FIXTURE_READ_MCP_ROSTER_MISMATCH');
   record({kind:'read-initial-input',message:frame.message});
   await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'harmless134',version:'1'}});
   const listing=await call('tools/list',{}),tools=listing.response?.mcp_response?.result?.tools;if(!Array.isArray(tools)||tools.length!==1||tools[0].name!=='read'||tools[0].inputSchema?.properties?.path?.type!=='string')throw Error('Actual role MCP listing differs');record({kind:'listing',tools});
   init(['mcp__custom-tools__read'],[{name:'custom-tools',status:'connected'}]);
   const toolId='tool-'+randomUUID(),arguments_={path:'hidden.txt'};
   const reply=call('tools/call',{name:'read',arguments:arguments_,_meta:{'claudecode/toolUseId':toolId}});
   assistant([{type:'tool_use',id:toolId,name:'mcp__custom-tools__read',input:arguments_}],'tool_use');
   const response=await reply,blocks=response.response?.mcp_response?.result?.content;if(!Array.isArray(blocks))throw Error('Actual MCP read result missing');const output=blocks.filter(x=>x.type==='text').map(x=>x.text).join('\n'),markers=output.match(/\b[a-f0-9]{64}\b/g);if(markers?.length!==1)throw Error('Read output has no unique marker');record({kind:'actual-tool-result',toolId,text:output});finish(markers[0]);
  }else if(text.includes('[134:PARK]')){init();record({kind:'parked'});parkTimer=setInterval(()=>{if(fs.existsSync(path.join(process.cwd(),'release-b'))){clearInterval(parkTimer);finish('SYNTHETIC_B_RELEASED');}},20);
  }else{init();finish(text.includes('[134:REOPEN]')?'SYNTHETIC_REOPEN':'SYNTHETIC_SUMMARY');}
 })().catch(error=>{record({kind:'fixture-failed',diagnostic:String(error?.message??'UNKNOWN').slice(0,200)});fixtureFailed=true;process.exitCode=2;process.kill(process.pid,'SIGTERM');});
});
