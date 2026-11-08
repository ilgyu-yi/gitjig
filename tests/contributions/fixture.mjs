import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openController } from '../../dist/controller/controller.js';
import { configureOwnedContributionFixture } from '../../.qualification/controller-testing.js';
import { contributionServer } from './native-server.mjs';
export const repository={owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9'};
export async function fixture(options={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'contributions-'))),endpoint=await contributionServer(options);
 let c;try{c=await openController({installationHome:path.join(root,'home')});}catch(error){await endpoint.close();throw error;}
 if(!options.tls)configureOwnedContributionFixture(c,{origin:endpoint.origin,token:'fixture-only'});
 return{root,c,...endpoint,get calls(){return endpoint.calls;},async close({preserve=false}={}){await c.close();await endpoint.close();if(preserve)console.error('Retained contribution fixture '+root);else await fs.rm(root,{recursive:true,force:true});}};
}
export const resource=n=>({repository,kind:'pull-request',number:n});
