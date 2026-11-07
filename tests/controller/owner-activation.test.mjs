import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);

async function world(t) {
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/owner-activation-'))),home=path.join(root,'home'),source=path.join(root,'source');
 await fs.mkdir(source);await fs.writeFile(path.join(source,'input.txt'),'Original owner input');
 let c=await openController({installationHome:home});
 t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});
 await c.registerProject({id:'P',sourceRoot:source});
 // Registered finite descriptors only; no Git execution or remote activity.
 for(const target of ['local-a','local-b'])c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',target,'P',JSON.stringify({kind:'local-git',target:{targetId:target,canonicalPath:path.join(root,'recorded-'+target),device:'1',inode:target==='local-a'?'10':'11',ownerUid:process.getuid(),objectFormat:'sha1',ref:'refs/heads/main'},ownerUid:process.getuid(),basisCommit:'a'.repeat(40),publicationInventory:['input.txt'],authorizedDeltaPaths:['input.txt']}));
 const publication=c.registerPublicationTarget({projectId:'P',visibility:'public',target:{host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',actorUserId:7}}).targetId;
 const integrations=[{projectId:'P',targetId:'local-a',operationLimit:2},{projectId:'P',targetId:'local-b',operationLimit:2}],publications=[{targetId:publication,actions:['create-issue'],operationLimit:2}];
 async function reopen({integration=integrations,pub=publications,managementOnly=false}={}){await c.close();c=await openController({installationHome:home,effectDelegations:integration},{managementOnly});c.configurePublicationDelegations(pub);return c;}
 await reopen();
 return {root,home,integrations,publications,publication,reopen,get c(){return c;}};
}
const row=(f,id)=>f.c.store.one('SELECT * FROM works WHERE id=?',id);
const data=(f,id)=>JSON.parse(row(f,id).data);
const ledger=f=>Object.fromEntries(['works','sources','runs','budgets','effect_delegations','effect_operations','change_state'].map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
async function failedBegin(f,failAt=1){
 const s=f.c.store,run=s.run.bind(s);let writes=0;
 s.run=(sql,...args)=>{const result=run(sql,...args);if(sql.startsWith('INSERT INTO effect_delegations')&&++writes===failAt)throw Error('Injected grant storage failure');return result;};
 try{await assert.rejects(f.c.beginChange({projectId:'P',request:'Preserve this original work'}),error=>{assert.equal(error.code,'OWNER_ACTIVATION_REQUIRED');assert.ok(error.workId);f.workId=error.workId;return true;});}
 finally{s.run=run;}
 assert.equal(writes,failAt);return f.workId;
}

for(const failAt of [1,2,3])test(`grant failure after insert ${failAt} rolls back both families and grant sources; original work remains recoverable`,async t=>{
 const f=await world(t),id=await failedBegin(f,failAt),s=f.c.store;
 assert.equal(data(f,id).ownerRootActivation.state,'PENDING');assert.equal(data(f,id).publicationDelegationCaptured,undefined);
 assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_delegations').n,0);assert.equal(s.one("SELECT COUNT(*) AS n FROM sources WHERE json_extract(origin,'$.kind')='owner-effect-grant'").n,0);
 const view=f.c.inspectChange(id);assert.equal(view.ownerActivation,'pending');assert.equal(view.phase,'BLOCKED');assert.match(view.nextAction,/change activate/);
 const before=ledger(f);await assert.rejects(f.c.driveChange({workId:id}),e=>e.code==='OWNER_ACTIVATION_REQUIRED');await assert.rejects(f.c.planChange({workId:id}),e=>e.code==='OWNER_ACTIVATION_REQUIRED');
 assert.throws(()=>f.c.effects.delegate({workId:id,targetId:'local-a',mode:'ordinary',operationLimit:2}),e=>e.code==='OWNER_ACTIVATION_REQUIRED');
 assert.throws(()=>f.c.publicationEngine.delegate({workId:id,targetId:f.publication,actions:['create-issue'],operationLimit:2}),e=>e.code==='OWNER_ACTIVATION_REQUIRED');
 assert.throws(()=>f.c.effects.grantContext(id),e=>e.code==='OWNER_ACTIVATION_REQUIRED');assert.throws(()=>f.c.publicationEngine.grantContext(id),e=>e.code==='OWNER_ACTIVATION_REQUIRED');assert.deepEqual(ledger(f),before);
 await f.reopen({managementOnly:true});const budgets=f.c.store.all('SELECT * FROM budgets'),recovered=f.c.activateChangeOwner({workId:id,expectedEpoch:row(f,id).epoch});
 assert.equal(recovered.ownerActivation,'complete');assert.equal(recovered.workId,id);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,1);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_delegations').n,3);assert.deepEqual(f.c.store.all('SELECT * FROM budgets'),budgets);
});

test('restart requires captured profile; completed activation ignores changed defaults without resetting spent operations',async t=>{
 const f=await world(t),id=await failedBegin(f,2);await f.reopen({integration:[],pub:[],managementOnly:true});
 const before=ledger(f);assert.throws(()=>f.c.activateChangeOwner({workId:id,expectedEpoch:row(f,id).epoch}),e=>e.workId===id&&/original captured profile/.test(e.message));assert.deepEqual(ledger(f),before);
 await f.reopen({integration:[...f.integrations].reverse(),managementOnly:true});f.c.activateChangeOwner({workId:id,expectedEpoch:row(f,id).epoch});
 // Real finite operation allocator; input is explicitly not review evidence, and never dispatched.
 const grant=f.c.effects.grant(id,'local-a');f.c.effects.allocate(id,'local-a',{fixture:'UNEXECUTED_NOT_REVIEW_EVIDENCE'});assert.equal(f.c.effects.grantContext(id).find(g=>g.targetId==='local-a').remainingOperations,1);
 await f.reopen({integration:[],pub:[],managementOnly:true});const completed=ledger(f);f.c.activateChangeOwner({workId:id,expectedEpoch:row(f,id).epoch});assert.deepEqual(ledger(f),completed);assert.equal(f.c.effects.grant(id,'local-a').id,grant.id);assert.equal(f.c.effects.grantContext(id).find(g=>g.targetId==='local-a').remainingOperations,1);
});

test('cancelled pending work requires explicit epoch-bound recovery and never resets budgets or executes a stage',async t=>{
 const f=await world(t),id=await failedBegin(f,2);await f.c.cancelWork({workId:id});assert.equal(row(f,id).state,'CANCELLED');
 const before=ledger(f),epoch=row(f,id).epoch;assert.throws(()=>f.c.activateChangeOwner({workId:id,expectedEpoch:epoch}),/resume-cancelled/);assert.throws(()=>f.c.activateChangeOwner({workId:id,expectedEpoch:epoch-1,resumeCancelled:true}),/epoch changed/);assert.deepEqual(ledger(f),before);
 const after=f.c.activateChangeOwner({workId:id,expectedEpoch:epoch,resumeCancelled:true});assert.equal(after.ownerActivation,'complete');assert.equal(row(f,id).state,'ACTIVE');assert.equal(row(f,id).epoch,epoch+1);assert.deepEqual(ledger(f).budgets,before.budgets);assert.deepEqual(ledger(f).runs,before.runs);
});

test('unknown cleanup and active capture cannot acquire owner grants',async t=>{
 const f=await world(t),id=await failedBegin(f,2),s=f.c.store;
 f.c.active.set(id,{abort:new AbortController(),done:Promise.resolve()});try{assert.throws(()=>f.c.activateChangeOwner({workId:id,expectedEpoch:row(f,id).epoch}),/operation active/);}finally{f.c.active.delete(id);}
 s.run("UPDATE works SET state='UNKNOWN' WHERE id=?",id);const before=ledger(f);assert.throws(()=>f.c.activateChangeOwner({workId:id,expectedEpoch:row(f,id).epoch,resumeCancelled:true}),/reconciled first/);assert.deepEqual(ledger(f),before);
 // Restore fixture state solely for normal test resource cleanup.
 s.run("UPDATE works SET state='CANCELLED' WHERE id=?",id);
});

test('pre-aborted admission creates no work, source, run or allowance',async t=>{
 const f=await world(t),abort=new AbortController();abort.abort();const before=ledger(f);await assert.rejects(f.c.beginChange({projectId:'P',request:'Do not admit',signal:abort.signal}),/abort/i);assert.deepEqual(ledger(f),before);
});

test('actual activation CLI bypasses broken startup and has no engine, provider or network activity', {timeout:10000},async t=>{
 const f=await world(t),id=await failedBegin(f,3),epoch=row(f,id).epoch,budgets=ledger(f).budgets;
 await f.c.close();await fs.mkdir(path.join(f.home,'config'),{recursive:true,mode:0o700});const setup=path.join(f.home,'config/startup.json'),invalid='{"version":1,"bridge":{"MUST_NOT_LOAD":"invalid"}}';await fs.writeFile(setup,invalid,{mode:0o600});
 const profile=path.join(f.root,'publications.json');await fs.writeFile(profile,JSON.stringify(f.publications),{mode:0o600});
 const result=await execute(process.execPath,['--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js','change','activate','--home',f.home,'--work',id,'--epoch',String(epoch),'--delegate-integrations','P:local-a:2,P:local-b:2','--git-binary',process.execPath,'--delegate-publications',profile],{timeout:7000,env:{...process.env,TMPDIR:f.root}});
 assert.equal(JSON.parse(result.stdout).ownerActivation,'complete');assert.equal(await fs.readFile(setup,'utf8'),invalid);await f.reopen({managementOnly:true});assert.deepEqual(ledger(f).budgets,budgets);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,1);
});

test('restart refuses unfinished persisted capture until ordinary recovery settles the original run before granting',async t=>{
 const f=await world(t),id=await failedBegin(f,1),s=f.c.store;
 // Crash boundary: retained original capture run has no live in-memory owner.
 s.run("UPDATE runs SET phase='CAPTURING' WHERE work=?",id);await f.reopen({managementOnly:true});
 const before=ledger(f);assert.throws(()=>f.c.activateChangeOwner({workId:id,expectedEpoch:row(f,id).epoch}),/unsettled capture or cleanup/);assert.deepEqual(ledger(f),before);
 await f.reopen();assert.equal(row(f,id).state,'INTERRUPTED');assert.equal(f.c.store.one('SELECT phase FROM runs WHERE work=?',id).phase,'INTERRUPTED');
 f.c.activateChangeOwner({workId:id,expectedEpoch:row(f,id).epoch,resumeCancelled:true});const grant=f.c.effects.grant(id,'local-a');assert.equal(grant.data.rootEpoch,row(f,id).epoch);
 const publication=f.c.publicationEngine.grant(id,f.publication,'create-issue');assert.equal(publication.data.rootEpoch,row(f,id).epoch);
 await f.reopen();assert.equal(row(f,id).state,'ACTIVE');assert.equal(f.c.effects.grant(id,'local-a').id,grant.id);assert.equal(f.c.publicationEngine.grant(id,f.publication,'create-issue').id,publication.id);
});

test('completion marker storage failure rolls back all grant families and source records',async t=>{
 const f=await world(t),s=f.c.store,run=s.run.bind(s);let id;
 s.run=(sql,...args)=>{const result=run(sql,...args);if(sql==='UPDATE works SET data=? WHERE id=?'&&JSON.parse(args[0]).ownerRootActivation?.state==='COMPLETE')throw Error('Injected completion storage failure');return result;};
 try{await assert.rejects(f.c.beginChange({projectId:'P',request:'Atomic marker and all grants'}),e=>{id=e.workId;return e.code==='OWNER_ACTIVATION_REQUIRED';});}finally{s.run=run;}
 assert.ok(id);assert.equal(data(f,id).ownerRootActivation.state,'PENDING');assert.equal(data(f,id).publicationDelegationCaptured,undefined);assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_delegations').n,0);assert.equal(s.one("SELECT COUNT(*) AS n FROM sources WHERE json_extract(origin,'$.kind')='owner-effect-grant'").n,0);
});

test('empty-profile activation refuses after controller close',async t=>{
 const f=await world(t);await f.reopen({integration:[],pub:[]});const begun=await f.c.beginChange({projectId:'P',request:'Empty profile closing boundary'}),effects=f.c.effects;
 await f.c.close();assert.throws(()=>effects.activateOwnerRoot(begun.workId),/closed|closing/i);assert.throws(()=>effects.publications.activateOwnerRoot(begun.workId),/closed|closing/i);
});

test('abort during actual capture retains cancelled pending work without activating owner grants',async t=>{
 const f=await world(t),abort=new AbortController(),s=f.c.store,run=s.run.bind(s);let observed=false;
 s.run=(sql,...args)=>{const result=run(sql,...args);if(sql.startsWith('UPDATE runs SET')&&args.includes('CAPTURING')&&!observed){observed=true;queueMicrotask(()=>abort.abort());}return result;};
 let begun;try{begun=await f.c.beginChange({projectId:'P',request:'Cancel admitted capture',signal:abort.signal});}finally{s.run=run;}
 assert.equal(observed,true);assert.equal(row(f,begun.workId).state,'CANCELLED');assert.equal(begun.ownerActivation,'pending');assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_delegations').n,0);
 const before=ledger(f);f.c.activateChangeOwner({workId:begun.workId,expectedEpoch:row(f,begun.workId).epoch,resumeCancelled:true});assert.deepEqual(ledger(f).budgets,before.budgets);assert.equal(row(f,begun.workId).state,'ACTIVE');
});
