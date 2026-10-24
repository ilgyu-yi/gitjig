import fs from 'node:fs/promises';
import { openController, ControllerError } from '../../dist/controller/index.js';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const controller=await openController({installationHome:cfg.home});
const conversation=controller.createConversation();
controller.setDraft({conversationId:conversation.conversationId,expectedRevision:0,text:'Retained 한국어 draft'});
controller.createConversation=()=>{throw new ControllerError('RECOVERY_REQUIRED','Controlled operation refusal',Array.from({length:100},(_,i)=>'Retained recovery line '+i).join('\n')+'\nInspect original work; do not retry automatically','original-work','original-run');};
let mutation;
if(cfg.mutateFile){const project=cfg.home+'/../owned-project';await fs.mkdir(project);await controller.registerProject({id:'P',sourceRoot:await fs.realpath(project)});mutation=setInterval(async()=>{if(await fs.access(cfg.mutateFile).then(()=>true,()=>false)){clearInterval(mutation);controller.setConversationProject({conversationId:conversation.conversationId,expectedGeneration:0,projectId:'P'});console.log('OWNED_ERROR_SOURCE_CHANGED');}},10);}
const stopping=new AbortController(), stop=()=>stopping.abort();process.on('SIGTERM',stop);
try { const {startConversationUI}=await import('../../dist/ui/index.js');await startConversationUI({controller,conversationId:conversation.conversationId,signal:stopping.signal}); }
finally {if(mutation)clearInterval(mutation);process.removeListener('SIGTERM',stop);await controller.close();}
