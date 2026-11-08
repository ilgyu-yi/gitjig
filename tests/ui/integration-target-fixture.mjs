import {integrationWorld} from '../controller/integration-registry-fixture.mjs';
export async function targetWorld(t){const f=await integrationWorld(t),conversation=f.c.createConversation({projectId:'P'}).conversationId;return {...f,conversation,request:{projectId:'P',path:f.receiver,ref:'refs/heads/main',basisCommit:f.basis,publicationInventory:['file.txt'],authorizedDeltaPaths:['file.txt']}};}
export const registrationChoices=['Integration targets','Register local bare receiver','Receiver path','Pinned basis commit','Publication paths','Add literal path','Done','Authorized delta paths','Add literal path','Done','Review registration','Register this observed local receiver','Back','Close'];
export const registrationInputs=f=>[f.receiver,f.basis,'file.txt','file.txt'];
