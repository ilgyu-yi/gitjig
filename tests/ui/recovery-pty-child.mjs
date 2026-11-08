import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const entry=process.env.GITJIG_TEST_CLI_ENTRY;
const dist=entry?path.resolve(path.dirname(realpathSync(entry)),'..'):fileURLToPath(new URL('../../dist',import.meta.url));
const {openController,ControllerError}=await import(pathToFileURL(path.join(dist,'controller/index.js')).href);
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const controller=await openController({installationHome:cfg.home});
const conversation=controller.createConversation();
if(cfg.language)controller.setConversationLanguage({conversationId:conversation.conversationId,expectedGeneration:0,expectedRevision:0,replyLanguage:cfg.language});
if(cfg.retainedRequest){
 const input=await controller.queueConversationInput({conversationId:conversation.conversationId,expectedGeneration:0,text:cfg.retainedRequest.text,mode:'idle'});
 const row=controller.store.one('SELECT * FROM conversation_inputs WHERE id=?',input.inputId);
 await fs.writeFile(cfg.retainedRequest.original,JSON.stringify(row),{mode:0o600});
}
controller.setDraft({conversationId:conversation.conversationId,expectedRevision:0,text:'Retained 한국어 draft'});
controller.createConversation=()=>{throw new ControllerError('RECOVERY_REQUIRED','Controlled operation refusal',Array.from({length:100},(_,i)=>'Retained recovery line '+i).join('\n')+'\nInspect original work; do not retry automatically','original-work','original-run');};
let mutation;
if(cfg.mutateFile){const project=cfg.home+'/../owned-project';await fs.mkdir(project);await controller.registerProject({id:'P',sourceRoot:await fs.realpath(project)});mutation=setInterval(async()=>{if(await fs.access(cfg.mutateFile).then(()=>true,()=>false)){clearInterval(mutation);controller.setConversationProject({conversationId:conversation.conversationId,expectedGeneration:0,projectId:'P'});console.log('OWNED_ERROR_SOURCE_CHANGED');}},10);}
const stopping=new AbortController(), stop=()=>stopping.abort();process.on('SIGTERM',stop);
try { const {startConversationUI}=await import(pathToFileURL(path.join(dist,'ui/index.js')).href);await startConversationUI({controller,conversationId:conversation.conversationId,signal:stopping.signal}); }
finally {if(mutation)clearInterval(mutation);process.removeListener('SIGTERM',stop);await controller.close();}
