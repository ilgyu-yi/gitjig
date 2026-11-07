import {freeze} from '../../dist/controller/change-files.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';

const tables=['sources','works','requirements','budgets','runs','change_state','change_versions','effect_delegations'];
const ledger=c=>Object.fromEntries(tables.map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/change-admission-'))),home=path.join(root,'home'),source=path.join(root,'source');
 await fs.mkdir(source);await fs.writeFile(path.join(source,'input.txt'),'Original source');
 const c=await openController({installationHome:home});await c.registerProject({id:'P',sourceRoot:source});
 t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});return{root,home,source,c};
}

for(const boundary of ['sources','works','budgets','requirements','runs','change_state','change_versions','initial-phase'])test(`admission failure after ${boundary} leaves no orphan source, work, run, budget or governed state`,async t=>{
 const f=await fixture(t),s=f.c.store,before=ledger(f.c),run=s.run.bind(s);let injected=false;
 s.run=(sql,...args)=>{const result=run(sql,...args);if(!injected&&(boundary==='initial-phase'?sql==='UPDATE change_state SET phase=?,data=? WHERE work=?':sql.startsWith('INSERT INTO '+boundary+' VALUES'))){injected=true;throw Error('Injected admission storage failure: '+boundary);}return result;};
 try{await assert.rejects(f.c.beginChange({projectId:'P',request:'Atomic first work',executionLimit:3,resolutionLimit:2}),/Injected admission storage failure/);}finally{s.run=run;}
 assert.equal(injected,true);assert.deepEqual(ledger(f.c),before);assert.deepEqual(f.c.listChanges().changes,[]);
 // Verify rollback survives reopening rather than only an in-process projection.
 await f.c.close();const reopened=await openController({installationHome:f.home},{managementOnly:true});try{assert.deepEqual(ledger(reopened),before);}finally{await reopened.close();}
});

test('healthy admission captures criteria, source and allowances once; failed capture remains discoverable on the same work',async t=>{
 const f=await fixture(t),first=await f.c.beginChange({projectId:'P',request:'Original 한국어 intent',ownerRequirements:['Preserve source'],executionLimit:3,resolutionLimit:2});
 assert.equal(first.phase,'BASE_CAPTURED');assert.equal(first.execution.limit,3);assert.equal(first.execution.consumed,1);assert.equal(first.execution.reserved,0);assert.equal(first.resolution.limit,2);
 const s=f.c.store,w=s.one('SELECT * FROM works WHERE id=?',first.workId),state=JSON.parse(s.one('SELECT data FROM change_state WHERE work=?',w.id).data),criteria=s.one('SELECT * FROM change_versions WHERE id=?',state.contractsVersion);
 assert.equal(criteria.work,w.id);assert.equal(criteria.kind,'contracts');assert.equal(s.one('SELECT raw FROM sources WHERE id=?',w.source).raw,'Original 한국어 intent');assert.deepEqual(state.ownerRequirements,['Preserve source']);
 await fs.symlink('input.txt',path.join(f.source,'unsupported-alias'));const failed=await f.c.beginChange({projectId:'P',request:'Unsupported source remains recoverable'});
 assert.equal(failed.phase,'BLOCKED');assert.equal(failed.baseVersion,null);assert.equal(failed.execution.consumed,1);assert.equal(failed.execution.reserved,0);assert.ok(f.c.listChanges().changes.some(item=>item.workId===failed.workId));assert.equal(s.one('SELECT raw FROM sources WHERE id=(SELECT source FROM works WHERE id=?)',failed.workId).raw,'Unsupported source remains recoverable');assert.ok(JSON.parse(s.one('SELECT data FROM change_state WHERE work=?',failed.workId).data).contractsVersion);
});


test('admitted dependency links and link-only candidate changes reach original role review context',async t=>{
 const f=await fixture(t),bin=path.join(f.source,'node_modules/.bin'),pkg=path.join(f.source,'node_modules/pkg');
 await fs.mkdir(bin,{recursive:true});await fs.mkdir(pkg);await fs.writeFile(path.join(pkg,'one.js'),'first');await fs.writeFile(path.join(pkg,'two.js'),'second');await fs.symlink('../pkg/one.js',path.join(bin,'tool'));
 const view=await f.c.beginChange({projectId:'P',request:'Inspect dependency tool context'}),core=f.c.changeCore;
 assert.equal(view.phase,'BASE_CAPTURED');
 const original=await core.bundle(view.workId,{stage:'planning'},'planner');
 assert.equal(original.context.sourceInventory.baseDependencyLinkCount,1);assert.equal(original.context.sourceInventory.baseDependencyLinkSample[0].target,'../pkg/one.js');
 await fs.unlink(path.join(bin,'tool'));await fs.symlink('../pkg/two.js',path.join(bin,'tool'));
 const target=path.join(f.home,'inputs','changed-dependency'),receipt=await freeze(f.source,target,{});
 const candidate=core.newVersion(view.workId,'candidate',target,{manifest:receipt.manifest},receipt.digest,view.baseVersion);
 f.c.store.run('UPDATE change_state SET candidate=? WHERE work=?',candidate,view.workId);
 const reviewed=await core.bundle(view.workId,{stage:'fresh-review'},'reviewer');
 assert.equal(reviewed.context.sourceInventory.dependencyLinkDeltaCount,1);
 assert.deepEqual(reviewed.context.sourceInventory.dependencyLinkDeltaSample,[{path:'node_modules/.bin/tool',before:'../pkg/one.js',after:'../pkg/two.js'}]);
});


for(const state of ['ACTIVE','CANCELLED'])test('pre-aborted public drive preserves original '+state+' work and every retained ledger row',async t=>{
 const f=await fixture(t),initial=await f.c.beginChange({projectId:'P',request:'Original pre-aborted drive must remain retained'});
 assert.equal(initial.phase,'BASE_CAPTURED');
 if(state==='CANCELLED')await f.c.cancelWork({workId:initial.workId});
 assert.equal(f.c.inspectWork(initial.workId).state,state);
 const retained=()=>Object.fromEntries([...tables,'obligations','role_launches','role_outputs','effect_operations','effect_receipts','capacity_leases'].map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
 const before=retained(),reason=Error('Cancelled before original drive dispatch');
 await assert.rejects(f.c.driveChange({workId:initial.workId,model:{provider:'unused-fixture',modelId:'must-not-dispatch'},signal:AbortSignal.abort(reason),maximumSteps:1}),error=>error===reason);
 assert.deepEqual(retained(),before);
});
