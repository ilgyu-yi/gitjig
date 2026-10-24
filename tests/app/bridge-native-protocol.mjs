/** Synthetic producer only; original bridge/SDK, query, MCP and cleanup stay real. */
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';import {randomUUID,createHash} from 'node:crypto';import net from 'node:net';import http from 'node:http';import https from 'node:https';
const deny=()=>{throw Error('B_NATIVE_PROTOCOL_NETWORK_REFUSED');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;for(const api of[http,https])for(const key of['request','get'])api[key]=deny;
const mode=process.argv[2];if(!['healthy','startup-two'].includes(mode))throw Error('Unselected native fixture mode');const maxQueries=mode==='startup-two'?2:5;
const argv=process.argv.slice(3),value=key=>{const equal=argv.find(arg=>arg.startsWith(key+'='));if(equal)return equal.slice(key.length+1);const i=argv.indexOf(key);return i<0?undefined:argv[i+1];},model=value('--model'),effort=value('--effort'),resumeTarget=value('--resume'),sessionId=resumeTarget??randomUUID();
if(!model||!/^claude-/.test(model)||(effort!==undefined&&effort!=='high'))throw Error('Unexpected original model/effort arguments');
let inputFrames=0,inputBytes=0,outputBytes=0,maxInputFrameBytes=0,started=false,resultSent=false,stopping=false,servers,sequence=0;const pending=new Map(),record=value=>fs.appendFileSync(path.join(process.cwd(),'fixture-observation.json'),JSON.stringify({pid:process.pid,sessionId,model,effort,...value})+'\n',{mode:0o600});
const write=frame=>{const bytes=JSON.stringify(frame)+'\n';outputBytes+=Buffer.byteLength(bytes);if(outputBytes>256*1024)throw Error('Native fixture output budget');process.stdout.write(bytes);};
const call=(method,params)=>new Promise(resolve=>{const id=++sequence;if(id>2)throw Error('Native fixture MCP control budget');const key='fixture-'+id;pending.set(key,resolve);write({type:'control_request',request_id:key,request:{subtype:'mcp_message',server_name:'custom-tools',message:{jsonrpc:'2.0',id,method,params}}});});
const lines=readline.createInterface({input:process.stdin}),tail=setInterval(()=>{},1000);
process.once('SIGTERM',()=>{stopping=true;clearInterval(tail);lines.close();process.exit(0);});
// Original provider closes streamed stdin after a typed result; native must end stdout.
lines.once('close',()=>{clearInterval(tail);process.stdout.end(()=>process.exit(stopping||(resultSent&&pending.size===0)?0:2));});
lines.on('line',line=>{
 inputBytes+=Buffer.byteLength(line);if(++inputFrames>64||inputBytes>2*1024*1024)throw Error('Native fixture aggregate input budget');maxInputFrameBytes=Math.max(maxInputFrameBytes,Buffer.byteLength(line));if(maxInputFrameBytes>1024*1024)throw Error('Native fixture frame budget');const frame=JSON.parse(line);
 if(frame.type==='control_response'){const key=frame.response?.request_id;pending.get(key)?.(frame.response);pending.delete(key);return;}
 if(frame.type==='control_request'){
  if(frame.request?.subtype==='initialize'){servers=frame.request.sdkMcpServers??[];if(!Array.isArray(servers)||servers.some(s=>s!=='custom-tools')||servers.length>1)throw Error('Unexpected MCP roster');}
  write({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:{commands:[],models:[],output_style:'default',available_output_styles:[]}}});return;
 }
 if(frame.type!=='user'||started)return;started=true;
 void(async()=>{
  if(!servers)throw Error('Original initialize missing');let tools=[];
  if(servers.length){await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'native-app-fixture',version:'1'}});const listing=await call('tools/list',{});tools=listing.response?.mcp_response?.result?.tools;if(!Array.isArray(tools))throw Error('Original tools/list missing');}
  const text=JSON.stringify(frame.message?.content??frame.message??frame),summary=!servers.length;if(summary?effort!==undefined:effort!=='high')throw Error('Original summary/provider effort differs');
  let resumeHistory;
  if(mode==='startup-two'&&resumeTarget){
   if(!/^[a-f0-9-]{36}$/.test(resumeTarget))throw Error('Unexpected resume identity');
   const projects=path.join(process.env.CLAUDE_CONFIG_DIR??path.join(process.env.HOME,'.claude'),'projects'),files=fs.readdirSync(projects).map(name=>path.join(projects,name,resumeTarget+'.jsonl')).filter(file=>fs.existsSync(file));if(files.length!==1)throw Error('Original resumed native history missing or ambiguous');
   const file=files[0],info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||info.nlink!==1||fs.realpathSync(file)!==file||info.size>256*1024)throw Error('Native resume history bound');const bytes=fs.readFileSync(file);
   if(!bytes.includes(Buffer.from('B_NATIVE_TURN_1'))||!bytes.includes(Buffer.from('SYNTHETIC_BRIDGE_TURN_1')))throw Error('Original native resume history lacks first turn');
   resumeHistory={file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),containsFirst:true,containsFirstReply:true};
  }
  record({kind:'query',argv,resumeTarget,resumeHistory,summary,cwd:process.cwd(),environment:Object.fromEntries(['HOME','PI_CODING_AGENT_DIR','CLAUDE_CONFIG_DIR','TMPDIR'].map(key=>[key,process.env[key]])),maxInputFrameBytes,inputBytes:Buffer.byteLength(text),containsFirst:text.includes('B_NATIVE_TURN_1'),containsSecond:text.includes('B_NATIVE_TURN_2'),containsThird:text.includes('B_NATIVE_TURN_3_LONG'),tools:tools.map(t=>t.name)});
  const calls=fs.readFileSync(path.join(process.cwd(),'fixture-observation.json'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(e=>e.kind==='query');if(calls.length>maxQueries)throw Error('Unallocated native query, no response');
  write({type:'system',subtype:'init',session_id:sessionId,model,cwd:process.cwd(),tools:tools.map(t=>'mcp__custom-tools__'+t.name),mcp_servers:servers.map(name=>({name,status:'connected'})),plugins:process.env.CLAUDE_CONFIG_DIR?[]:[{name:'cc-plugin-sec-default',path:'builtin',source:'cc-plugin-sec-default@builtin'}]});
  const answer=summary?'## Goal\nKeep original first two turns.\n## Progress\nB_NATIVE_TURN_1 and B_NATIVE_TURN_2 completed.\n## Next\nPreserve the retained large third user.':mode==='startup-two'?'SYNTHETIC_BRIDGE_TURN_'+calls.length:'SYNTHETIC_BRIDGE_TURN';
  write({type:'assistant',session_id:sessionId,parent_tool_use_id:null,message:{id:randomUUID(),type:'message',role:'assistant',model,content:[{type:'text',text:answer}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}});
  write({type:'result',subtype:'success',is_error:false,session_id:sessionId,duration_ms:1,duration_api_ms:1,num_turns:1,result:answer,total_cost_usd:0,usage:{input_tokens:1,output_tokens:1}});resultSent=true;
 })().catch(error=>{record({kind:'failure',message:String(error).slice(0,300)});process.exit(2);});
});
