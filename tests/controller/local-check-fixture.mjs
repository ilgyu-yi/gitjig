import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
// Admission, original ledger and settlement are real. Capacity failure deliberately prevents a producer/engine.
export async function world(t,{runtime=true}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-local-checks-'))),project=path.join(root,'project'),other=path.join(root,'other'),home=path.join(root,'home');await fs.mkdir(project);await fs.mkdir(other);await fs.writeFile(path.join(project,'source.txt'),'original');
 const c=await openController({installationHome:home,...runtime?{runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',image:'sha256:'+'0'.repeat(64)}}:{}});t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});await c.registerProject({id:'p',sourceRoot:project});await c.registerProject({id:'q',sourceRoot:other});c.capacity.acquire=async()=>{throw Error('CONTROLLED_NO_PRODUCER');};return {root,home,project,c};
}
export const ledger=c=>JSON.stringify(['works','sources','requirements','runs','budgets','results','observations','capacity_leases'].map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
