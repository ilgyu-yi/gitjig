/** Harmless finite SDK protocol, no auth/native Claude/network. */
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';import http from 'node:http';import https from 'node:https';import net from 'node:net';
const deny=()=>{throw Error('R3_FIXTURE_NETWORK_FORBIDDEN');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;for(const api of[http,https])for(const key of['request','get'])api[key]=deny;
let outputBytes=0,maxInputFrameBytes=0;const mode=process.argv[2],write=frame=>{const bytes=JSON.stringify(frame)+'\n';outputBytes+=Buffer.byteLength(bytes);if(outputBytes>256*1024)throw Error('R3 fixture output exceeds256KiB');process.stdout.write(bytes);};
if(!['healthy','eof'].includes(mode))throw Error('Undeclared harmless protocol mode');
const record=value=>fs.appendFileSync(path.join(process.cwd(),'fixture-observation.json'),JSON.stringify({pid:process.pid,...value})+'\n',{mode:0o600});
const lifecycle=value=>fs.appendFileSync(path.join(process.cwd(),'fixture-native-events.jsonl'),JSON.stringify({pid:process.pid,...value})+'\n',{mode:0o600});
let sent=false;const lines=readline.createInterface({input:process.stdin}),tail=setInterval(()=>{},1000);
process.once('SIGTERM',()=>{clearInterval(tail);lifecycle({kind:'sigterm-exit'});lines.close();process.exit(0);});
lines.on('line',line=>{
 maxInputFrameBytes=Math.max(maxInputFrameBytes,Buffer.byteLength(line));if(maxInputFrameBytes>1024*1024)throw Error('R3 fixture input exceeds selected1MiB frame budget');
 const frame=JSON.parse(line);
 if(frame.type==='control_request')write({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:{commands:[],models:[],output_style:'default',available_output_styles:[]}}});
 if(frame.type!=='user'||sent)return;sent=true;record({mode,argv:process.argv.slice(3),synthetic:true,maxInputFrameBytes});
 write({type:'system',subtype:'init',session_id:'synthetic-native',model:'claude-opus-5-5',cwd:process.cwd(),tools:[],mcp_servers:[],plugins:[]});
 write({type:'assistant',session_id:'synthetic-native',parent_tool_use_id:null,message:{id:'synthetic-message',type:'message',role:'assistant',model:'claude-opus-5-5',content:[{type:'text',text:'SYNTHETIC_CONTROL'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}});
 if(mode==='eof'){clearInterval(tail);lifecycle({kind:'natural-eof-no-result',outputBytes,emittedTypes:['system:init','assistant:text']});lines.close();process.stdin.destroy();process.stdout.end(()=>process.exit(0));return;}
 write({type:'result',subtype:'success',is_error:false,session_id:'synthetic-native',duration_ms:1,duration_api_ms:1,num_turns:1,result:'SYNTHETIC_CONTROL',total_cost_usd:0,usage:{input_tokens:1,output_tokens:1}});
 lifecycle({kind:'typed-result-native-tail-still-live',outputBytes});
});
