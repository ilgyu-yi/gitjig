import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {subject} from '../controller/merge-controller-fixture.mjs';
const execute=promisify(execFile);
// Real CLI discovery of actual native merge; software/publication premises are
// controlled as declared by the source fixture. No installed-workflow claim.
test('public merge reads reopen exact native original without model, engine, authority renewal or another send', {timeout:30000},async t=>{
 const f=await subject(t);f.grant();const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),merged=await f.c.dispatchMerge(prepared.operationId);assert.equal(merged.phase,'CONFIRMED');
 assert.equal(f.c.listIntegrations().operations.some(row=>row.operationId===merged.operationId),false,'Merge is not an unavailable branch integration');assert.equal(f.c.listIntegrationTargets().targets.some(row=>row.targetId===f.targetId),false);
 await f.c.close();const database=path.join(f.home,'state','controller.sqlite'),snapshot=()=>{const db=new DatabaseSync(database,{readOnly:true});try{return JSON.stringify(Object.fromEntries(['works','runs','budgets','sources','effect_operations','effect_delegations','effect_receipts','authority_observations','conversation_assignments','conversation_inputs'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));}finally{db.close();}},before=snapshot();
 const env={PATH:'/usr/bin:/bin',HOME:f.native.root,TMPDIR:path.join(f.home,'artifacts'),LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
 const cli=async(args)=>{const result=await execute(process.execPath,['dist/cli/main.js',...args,'--home',f.home],{env,timeout:10000,maxBuffer:1024*1024});return JSON.parse(result.stdout);};
 const list=await cli(['merge','list','--limit','1']);assert.equal(list.operations.length,1);assert.equal(list.operations[0].state,'RETAINED');assert.equal(list.operations[0].view.phase,'CONFIRMED');assert.equal(list.operations[0].operationId,merged.operationId);
 assert.equal((await cli(['merge','inspect','--operation',merged.operationId])).mergedCommit,merged.mergedCommit);
 assert.equal((await cli(['merge','targets'])).targets[0].targetId,f.targetId);assert.equal((await cli(['merge','target-inspect','--target',f.targetId])).configuration.identity.pullId,120);
 await assert.rejects(cli(['merge','list','--limit','0']),error=>error.code===2);await assert.rejects(cli(['merge','inspect','--operation',merged.operationId,'--credential-profile','unused']),error=>error.code===2);
 assert.equal(snapshot(),before);assert.equal(f.native.puts(),1);f.native.pass();
});
