import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {integrationWorld} from '../controller/integration-registry-fixture.mjs';
export const execute=promisify(execFile);
export async function receiverSnapshot(root){const rows=[];async function visit(relative){for(const entry of (await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const rel=path.join(relative,entry.name);if(entry.isDirectory())await visit(rel);else rows.push([rel,createHash('sha256').update(await fs.readFile(path.join(root,rel))).digest('hex')]);}}await visit('');return rows;}
export async function integrationReadWorld(t,{contained=true,later=false}={}){
 const f=await integrationWorld(t),op=await f.prepare();
 const cmd=args=>execute(f.git,['--git-dir='+f.receiver,...args],{env:f.env,timeout:4000});
 const tree=(await cmd(['rev-parse',f.basis+'^{tree}'])).stdout.trim(),integration=(await cmd(['commit-tree',tree,'-p',f.basis,'-m','Owned Gitjig integration\nOperation: '+op.operationId])).stdout.trim();let head=integration;
 if(later)head=(await cmd(['commit-tree',tree,'-p',integration,'-m','Later independent advancement'])).stdout.trim();
 if(contained)await cmd(['update-ref','refs/heads/main',head]);
 // Uncertainty/procedure state is synthetic. Native commit identity, ancestry,
 // receiver reads and controller run/allowance/cleanup are actual consumers.
 f.c.store.run("UPDATE effect_operations SET phase='UNKNOWN',data=json_set(data,'$.expectedBase',?,'$.integrationCommit',?,'$.headCommit',?,'$.dispatchRun',1) WHERE id=?",f.basis,integration,f.basis,op.operationId);
 return {...f,op,integration,head,cmd};
}
export const originalSnapshot=f=>({op:f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.op.operationId),grants:f.c.store.all('SELECT * FROM effect_delegations ORDER BY rowid'),work:f.c.store.one('SELECT * FROM works WHERE id=?',f.op.workId),sources:f.c.store.all('SELECT * FROM sources ORDER BY rowid'),budget:f.c.inspectIntegrationReconciliation(f.op.operationId).execution});
