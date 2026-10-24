import fs from 'node:fs/promises';import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';import {ApplicationModels} from '../../dist/app/models.js';import {ApplicationStartup} from '../../dist/app/startup.js';
export async function managedWorld(t,runtime={dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)},fixtureRoot=path.resolve('.runtime-fixtures')){
 await fs.mkdir(fixtureRoot,{recursive:true});
 const root=await fs.realpath(await fs.mkdtemp(path.join(fixtureRoot,'managed-ui-'))),home=path.join(root,'home'),source=path.join(root,'project');await fs.mkdir(source);await fs.writeFile(path.join(source,'file.txt'),'Owned source');
 const c=await openController({installationHome:home,runtimeProfile:runtime});let passed=false;
 t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained managed UI world: '+root);});
 await c.registerProject({id:'P',sourceRoot:source});const accounts=ApplicationAccounts.open(c),models=new ApplicationModels(c);await accounts.configure({providers:{'managed-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',apiKey:'UNUSED_MODEL_FIXTURE',models:[{id:'original'},{id:'future'}]}}});await accounts.setDefault('managed-fixture','future');
 const sourceView=await models.newConversation({projectId:'P',choice:await models.choice('managed-fixture','original')}),other=await models.newConversation();await ApplicationStartup.open(c).save({version:1,runtime});models.install();
 const calls=[];c.changes.drive=async input=>{calls.push(input);return c.inspectChange(input.workId);};
 return{root,home,c,models,accounts,cid:sourceView.conversationId,other:other.conversationId,calls,pass(){passed=true;}};
}
