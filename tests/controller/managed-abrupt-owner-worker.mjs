import fs from 'node:fs/promises';
import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
import {scripted} from './effect-fixture.mjs';
process.once('message',async input=>{
 const deadline=setTimeout(()=>process.exit(2),60000);
 try{
  const c=await openController(input.controller),model=scripted(),stream=model.definition.streamSimple;let held=false,work;
  model.definition.streamSimple=function(m,context){
   const user=context.messages.find(message=>message.role==='user'),text=user?.content?.filter(part=>part.type==='text').map(part=>part.text).join('')??'',writes=context.messages.filter(message=>message.role==='toolResult'&&message.toolName==='write');
   if(!held&&text.startsWith('Perform the assigned implementer task')&&writes.length){held=true;const receipt={toolResults:writes,writeCalls:context.messages.flatMap(message=>message.role==='assistant'?message.content.filter(part=>part.type==='toolCall'&&part.name==='write'):[])};void fs.writeFile(path.join(input.root,'held-native-write.json'),JSON.stringify(receipt),{mode:0o600}).then(()=>process.send({phase:'write-held',workId:work.workId}));return createAssistantMessageEventStream();}
   return stream.call(this,m,context);
  };
  work=await c.beginChange({projectId:'P',request:'Recover abrupt SDK write and export3 with original work and actual checks',executionLimit:80,resolutionLimit:24});process.send({phase:'created',workId:work.workId});const result=await c.driveChange({workId:work.workId,model});process.send({phase:'unexpected-return',result});await c.close();clearTimeout(deadline);
 }catch(error){clearTimeout(deadline);process.send({phase:'error',error:String(error)});process.exitCode=1;process.disconnect();}
});
