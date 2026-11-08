import fs from 'node:fs/promises';
import path from 'node:path';
import {registrationWorld} from './hosted-registration-cleanup-fixture.mjs';
export const hostedRef='refs/heads/release/next';
export async function hostedTargetWorld(t){
 const f=await registrationWorld(t,hostedRef),conversation=f.c.createConversation().conversationId,credential=path.join(f.root,'receiver-credential.json'),registeredRepository=f.c.registerRepositoryConfigurationTarget({target:{host:'github.com',...f.request.repository,actorUserId:f.request.expectedUserId}}).targetId;
 await fs.writeFile(credential,JSON.stringify({token:f.native.token}),{mode:0o600});
 f.c.configureHostedIntegrationCredential=token=>f.configure(token.token);
 return {...f,conversation,credential,registeredRepository};
}
export const hostedFields=['Integration targets','Register GitHub branch receiver','Project ·','P ·','Repository ·','github · owner/repo','Branch ref','Pinned basis commit','Publication paths','Add literal path','Done','Authorized delta paths','Add literal path','Done','Review registration'];
export const hostedAccept=[...hostedFields,'Register this observed GitHub receiver','Back','Close'];
export const hostedInputs=f=>[hostedRef,f.native.B,'file.txt','file.txt'];
