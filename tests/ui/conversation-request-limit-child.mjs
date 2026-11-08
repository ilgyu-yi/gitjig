import fs from 'node:fs/promises';
import {openController} from '../../dist/controller/index.js';
import {startConversationUI} from '../../dist/ui/index.js';
import {scripted} from '../controller/effect-fixture.mjs';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
process.env.TMPDIR=cfg.home+'/artifacts';
const controller=await openController({installationHome:cfg.home});let requests=0,receipt;
const model=scripted(()=>{requests++;return{tool:{name:'conversation_status',arguments:{}}};});
model.provider='request-limit-pty-'+cfg.identity;model.definition.api='request-limit-pty-api-'+cfg.identity;
const run=controller.runConversation.bind(controller);
controller.runConversation=async(...args)=>{const result=await run(...args);await fs.writeFile(cfg.entered,JSON.stringify(result));if(cfg.releaseFile){const deadline=Date.now()+12000;while(!(await fs.access(cfg.releaseFile).then(()=>true,()=>false))){if(Date.now()>deadline)throw Error('Controlled result delivery was not released');await new Promise(resolve=>setTimeout(resolve,10));}setImmediate(()=>{void fs.writeFile(cfg.delivered,'Original result promise delivered before this event-loop turn.');});}return result;};
try{
 await startConversationUI({controller,model,conversationId:cfg.cid});
 receipt={requests,failure:controller.inspectConversationRequestFailure(cfg.cid),runs:controller.store.all('SELECT id,phase,reservation FROM runs'),inputs:controller.store.all('SELECT id,text,state FROM conversation_inputs'),budgets:controller.store.all('SELECT * FROM budgets ORDER BY lineage,kind')};
}finally{await controller.close();if(receipt)await fs.writeFile(cfg.receipt,JSON.stringify({...receipt,ownerClosed:true}));}
