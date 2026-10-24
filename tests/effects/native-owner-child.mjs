import fs from 'node:fs/promises';
import {openNativeGit} from '../../dist/effects/index.js';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const client=await openNativeGit({...cfg.profile,resumeOwned:true});
try{
 const prepared=await client.prepareForwardSend(cfg.input,new AbortController().signal);
 process.send({phase:'prepared',pid:process.pid});
 await new Promise(resolve=>process.once('message',value=>{if(value==='go')resolve();}));
 const sending=client.spawnPreparedForwardSend(prepared);
 process.send({phase:'launcher-handed-off'});
 const receipt=await sending;process.send({phase:'completed',receipt});
}finally{await client.close();if(process.connected)process.disconnect();}
