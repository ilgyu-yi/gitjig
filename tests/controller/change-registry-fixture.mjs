import fs from 'node:fs/promises';import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
export async function registryWorld(t,prefix='change-registry-',suffix=''){
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/'+prefix))),home=path.join(root,'home'),c=await openController({installationHome:home});
 t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});
 for(const id of ['A','B']){const source=path.join(root,id);await fs.mkdir(source);await fs.writeFile(path.join(source,'file.txt'),'input '+id);await c.registerProject({id,sourceRoot:source});}
 const works=[];for(let i=0;i<3;i++)works.push(await c.beginChange({projectId:i===1?'B':'A',request:'Owner request '+i+' 한국어'+(i===0?suffix:'')}));
 return {root,home,c,works};
}
export const workLedger=c=>Object.fromEntries(['works','sources','requirements','change_state','change_versions','runs','budgets','obligations','effect_delegations'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
