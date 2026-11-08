import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {registryWorld,workLedger} from './change-registry-fixture.mjs';
const execute=promisify(execFile);
test('durable registry pages stable identities and filters without altering work, budgets or sources',async t=>{
 const f=await registryWorld(t),before=workLedger(f.c),first=f.c.listChanges({limit:1});assert.deepEqual(first.changes.map(w=>w.workId),[f.works[2].workId]);assert.equal(first.nextCursor,f.works[2].workId);
 const second=f.c.listChanges({limit:1,before:first.nextCursor});assert.equal(second.changes[0].workId,f.works[1].workId);const last=f.c.listChanges({limit:1,before:second.nextCursor});assert.equal(last.changes[0].workId,f.works[0].workId);assert.equal(last.nextCursor,null);
 assert.deepEqual(f.c.listChanges({projectId:'A'}).changes.map(w=>w.workId),[f.works[2].workId,f.works[0].workId]);
 assert.equal(first.changes[0].recordedPhase,'BASE_CAPTURED');assert.equal(first.changes[0].requestPreview,'Owner request 2 한국어');assert.equal(first.changes[0].model,null);
 for(const limit of [0,101,1.5])assert.throws(()=>f.c.listChanges({limit}),/limit/);
 assert.throws(()=>f.c.listChanges({before:'missing'}),/cursor/);assert.throws(()=>f.c.listChanges({projectId:'missing'}),e=>e.code==='MISSING_PROJECT');assert.deepEqual(workLedger(f.c),before);
});
test('source CLI registry bypasses invalid startup and leaves retained work unchanged across restart',{timeout:8000},async t=>{
 const f=await registryWorld(t),before=workLedger(f.c);await f.c.close();await fs.mkdir(path.join(f.home,'config'),{recursive:true,mode:0o700});const setup=path.join(f.home,'config/startup.json'),invalid='{"version":1,"bridge":{"PRIVATE_SETUP_MUST_NOT_LOAD":"invalid"}}';await fs.writeFile(setup,invalid,{mode:0o600});
 const result=await execute(process.execPath,['--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js','change','list','--home',f.home,'--limit','1'],{timeout:5000,env:{...process.env,TMPDIR:f.root}});
 const listed=JSON.parse(result.stdout);assert.equal(listed.changes[0].workId,f.works[2].workId);assert.equal(await fs.readFile(setup,'utf8'),invalid);
 const {openController}=await import('../../dist/controller/index.js');const reopened=await openController({installationHome:f.home},{managementOnly:true});try{assert.deepEqual(workLedger(reopened),before);}finally{await reopened.close();}
});
test('origin conversation changes do not retarget a listed captured project or model',async t=>{
 const f=await registryWorld(t),{ApplicationAccounts}=await import('../../dist/app/accounts.js'),{ApplicationModels}=await import('../../dist/app/models.js'),accounts=ApplicationAccounts.open(f.c),models=new ApplicationModels(f.c);
 await accounts.configure({providers:{'registry-fixture':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'original'},{id:'later'}]}}});
 const conversation=await models.newConversation({projectId:'A'});await models.select({conversationId:conversation.conversationId,expectedGeneration:0,expectedRevision:f.c.getConversationModelChoice(conversation.conversationId).revision,provider:'registry-fixture',modelId:'original'});
 const choice=f.c.getConversationModelChoice(conversation.conversationId),baseline=await models.baseline('A',choice);
 const work=await f.c.beginChange({projectId:'A',request:'Keep captured provenance',applicationModelBaseline:{...baseline,source:{kind:'conversation',conversationId:conversation.conversationId,choiceRevision:choice.revision}}});
 f.c.setConversationProject({conversationId:conversation.conversationId,projectId:'B',expectedGeneration:0});await models.select({conversationId:conversation.conversationId,expectedGeneration:1,expectedRevision:f.c.getConversationModelChoice(conversation.conversationId).revision,provider:'registry-fixture',modelId:'later'});
 const row=f.c.listChanges().changes.find(item=>item.workId===work.workId);assert.equal(row.projectId,'A');assert.deepEqual(row.model,{provider:'registry-fixture',modelId:'original'});assert.equal(row.originConversationId,conversation.conversationId);assert.equal(f.c.listChanges({projectId:'B'}).changes.some(item=>item.workId===work.workId),false);
});

test('retained blocked budget guidance names explicit same-original recovery without rewriting stage or usage',async t=>{
 const f=await registryWorld(t),id=f.works[0].workId;
 f.c.store.run("UPDATE budgets SET lim=8,consumed=8 WHERE lineage=? AND kind='execution'",id);
 const data=JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?',id).data);
 f.c.store.run("UPDATE change_state SET phase='BLOCKED',data=? WHERE work=?",JSON.stringify({...data,resumeStage:'resolve',nextAction:'resolveChange',blocked:['Execution allowance exhausted']}),id);
 const before=workLedger(f.c),view=f.c.inspectChange(id);
 assert.match(view.nextAction,/^resolveChange\./);assert.match(view.nextAction,new RegExp('/work '+id));assert.match(view.nextAction,/Extend shared execution allowance/);assert.match(view.nextAction,new RegExp('/change resume '+id));
 assert.deepEqual({...view.execution},{limit:8,consumed:8,reserved:0});assert.deepEqual(workLedger(f.c),before);
 const expected=f.c.inspectWorkAllowance(id);f.c.extendWorkAllowance({expected,kind:'execution',additional:4,reason:'Explicit retained owner recovery'});
 assert.deepEqual({...f.c.inspectChange(id).execution},{limit:12,consumed:8,reserved:0});
 assert.equal(JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?',id).data).resumeStage,'resolve');
 assert.equal(f.c.inspectChange(id).nextAction,'resolveChange');
 f.c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=?",id);
 const held=JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?',id).data);
 f.c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...held,nextAction:'Restore exact interrupted history'}),id);
 const both=f.c.inspectChange(id).nextAction;assert.match(both,/^Restore exact interrupted history/);assert.match(both,/Extend shared execution allowance; Extend shared resolution allowance/);
});
