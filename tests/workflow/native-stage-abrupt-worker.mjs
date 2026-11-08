import {retainFixtureChannel} from '../helpers/owned-fixture-channel.mjs';
import {createHash} from 'node:crypto';
import {NativeTransportWriter} from '../../dist/workflow/native-transport.js';
retainFixtureChannel();
const writer=await NativeTransportWriter.open(process.argv[2],{intentEntryId:'intent00',sessionId:'owner',requestDigest:createHash('sha256').update('controlled request').digest('hex')});
for(let i=0;i<2;i++)await writer.append('intent00',{type:'assistant',session_id:'native',uuid:'packet-'+i,message:{content:[{type:'text',text:'Original controlled source '+i+' 한글'}]}});
if(process.argv[3]==='partial'){
 const write=writer.handle.write.bind(writer.handle);let first=true;
 writer.handle.write=async(buffer,offset,length,position)=>{
  if(!first)return new Promise(()=>{});
  first=false;const result=await write(buffer,offset,Math.max(1,length-5),position);
  process.send({allocation:writer.allocation,acknowledged:2});return result;
 };
 await writer.append('intent00',{type:'assistant',session_id:'native',uuid:'packet-2',message:{content:[{type:'text',text:'Partial original write stays unknown'}]}});
}else process.send({allocation:writer.allocation,acknowledged:2});
await new Promise(()=>{});
