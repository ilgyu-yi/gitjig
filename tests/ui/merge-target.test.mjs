import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
const tables=['works','runs','sources','budgets','effect_operations','effect_delegations','effect_receipts','conversation_assignments'];
const ledger=c=>JSON.stringify(Object.fromEntries(tables.map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')])));
const fields=['PR merge targets','Register existing PR merge target','Source branch target ·','P · owner/repo','Tracked pull request ·','owner/repo #12','Review registration'];
async function world(t,options={}){
 const f=await subject(t,{registerMerge:false,...options}),conversation=f.c.createConversation().conversationId,credential=path.join(f.native.root,'merge-credential.json');await fs.writeFile(credential,JSON.stringify({token:'owned-native-merge-only'}),{mode:0o600});
 f.c.configureMergeCredential=options=>configureOwnedMergeFixture(f.c,{...options,origin:f.native.origin});return {...f,conversation,credential};
}
function form(f,choices,inputs=[],hooks={}){
 const shown=[],notices=[],ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const picked=choices.shift();if(typeof picked==='function')return picked(title,rows);if(picked===undefined)return;const found=rows.find(row=>row.startsWith(picked));assert.ok(found,'Missing '+picked+' in '+JSON.stringify({title,rows}));return found;},input:async(title,value)=>{const next=inputs.shift();return typeof next==='function'?next(title,value):next;},show:async(title,text)=>shown.push({title,text}),notice:text=>notices.push(text),...hooks});
 return {ui,shown,notices,run:()=>ui.commands[0].run('',f.conversation)};
}

test('owner PR target form keeps staged fields on default Back and invalid branch without requests or authority',async t=>{
 const f=await world(t),before=ledger(f.c),requests=f.native.requests.length,observations=f.c.store.one('SELECT COUNT(*) AS n FROM authority_observations').n;
 const h=form(f,[...fields,'Back without registering',(_title,rows)=>{assert.ok(rows.some(row=>row.includes(f.registration.sourceBranchTargetId)));assert.ok(rows.some(row=>row.includes(f.registration.resourceId)));return rows.find(row=>row.startsWith('Destination branch ·'));},'Review registration','Destination branch ·','Review registration','Back without registering','Back without registration','Back','Close'],['bad branch','main']);
 await h.run();await h.ui.close();assert.equal(ledger(f.c),before);assert.equal(f.c.listMergeTargets().targets.length,0);assert.equal(f.native.requests.length,requests);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM authority_observations').n,observations);assert.ok(h.shown.some(row=>row.title==='Destination branch needs attention'));assert.equal(f.native.puts(),0);f.native.pass();
});

test('actual owner /repo registration and exact duplicate preserve one target and create no work/grant/run/send',async t=>{
 const f=await world(t),before=ledger(f.c),observations=f.c.store.one('SELECT COUNT(*) AS n FROM authority_observations').n;
 for(let round=0;round<2;round++){const h=form(f,[...fields,'Register this existing PR identity','Back','Close'],[f.credential]);assert.equal(await h.run(),'completed');await h.ui.close();assert.equal(ledger(f.c),before);assert.equal(f.c.listMergeTargets().targets.length,1);const record=JSON.parse(h.shown.find(row=>row.title.startsWith('PR merge target retained')).text);assert.equal(record.targetId,f.c.listMergeTargets().targets[0].targetId);assert.doesNotMatch(JSON.stringify(h.shown)+JSON.stringify(h.notices),/owned-native-merge-only/);}
 assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM authority_observations').n,observations+2);assert.equal(f.native.puts(),0);f.native.pass();
});

test('source target drift while credential input is open refuses before native observation',async t=>{
 const f=await world(t),before=ledger(f.c),requests=f.native.requests.length,h=form(f,[...fields,'Register this existing PR identity'],[()=>{f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.basisCommit',?) WHERE id=?",'b'.repeat(40),f.registration.sourceBranchTargetId);return f.credential;}]);
 await assert.rejects(h.run(),/source target or project changed/);await h.ui.close();assert.equal(f.native.requests.length,requests);assert.equal(f.c.listMergeTargets().targets.length,0);assert.equal(ledger(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});

for(const boundary of ['navigation','close'])test(`held native PR observation ${boundary} cannot admit a late target or authority`,{timeout:15000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let hold=false,current=true;
 const f=await world(t,{intercept:async({req})=>{if(hold&&req.url==='/repos/owner/repo/pulls/12'){hold=false;entered.resolve();await release.promise;}return false;}}),before=ledger(f.c),observations=f.c.store.one('SELECT COUNT(*) AS n FROM authority_observations').n;
 hold=true;const h=form(f,[...fields,'Register this existing PR identity'],[f.credential],{isCurrent:()=>current}),task=h.run();void task.catch(()=>{});await entered.promise;
 try{if(boundary==='navigation'){current=false;release.resolve();await assert.rejects(task,/source changed/);}else{await h.ui.close();release.resolve();await assert.rejects(task);}}finally{release.resolve();await h.ui.close();}
 assert.equal(ledger(f.c),before);assert.equal(f.c.listMergeTargets().targets.length,0);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM authority_observations').n,observations);assert.equal(f.native.puts(),0);f.native.pass();
});

test('navigation after target commit reports its retained original ID rather than losing it',async t=>{
 const f=await world(t),before=ledger(f.c);let current=true;const register=f.c.registerMergeTarget.bind(f.c);f.c.registerMergeTarget=async(...args)=>{const result=await register(...args);current=false;return result;};
 const h=form(f,[...fields,'Register this existing PR identity'],[f.credential],{isCurrent:()=>current});await assert.rejects(h.run(),error=>{const target=f.c.listMergeTargets().targets[0];assert.equal(target.state,'RETAINED');assert.match(error.message,new RegExp('Original PR merge target '+target.targetId));return true;});await h.ui.close();assert.equal(ledger(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});


test('changed native contribution observations with the same discovery row refuse a reviewed target',async t=>{
 const f=await world(t);await f.c.refreshContributions({resourceIds:[f.registration.resourceId]});const before=ledger(f.c),selected=JSON.stringify(f.c.listTrackedResources().resources),h=form(f,[...fields,'Register this existing PR identity'],[async()=>{f.native.options.title='Changed while the reviewed credential form was open';f.native.options.updatedAt='2026-10-22T00:01:00Z';await f.c.refreshContributions({resourceIds:[f.registration.resourceId]});assert.equal(JSON.stringify(f.c.listTrackedResources().resources),selected,'Discovery identity stays the same while exact observations change');return f.credential;}]);
 await assert.rejects(h.run(),/PR, source target or project changed/);await h.ui.close();assert.equal(ledger(f.c),before);assert.equal(f.c.listMergeTargets().targets.length,0);assert.equal(f.native.puts(),0);f.native.pass();
});


test('close after committed target reports the retained identity and joins the original form',async t=>{
 const f=await world(t),before=ledger(f.c),register=f.c.registerMergeTarget.bind(f.c);let closing,h;f.c.registerMergeTarget=async(...args)=>{const result=await register(...args);closing=h.ui.close();return result;};
 h=form(f,[...fields,'Register this existing PR identity'],[f.credential]);await assert.rejects(h.run(),error=>{const target=f.c.listMergeTargets().targets[0];assert.equal(target.state,'RETAINED');assert.match(error.message,new RegExp('Original PR merge target '+target.targetId));return true;});await closing;assert.equal(ledger(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});


test('unselected historical observation append neither invalidates bounded current identity nor enters owner review',async t=>{
 const f=await world(t),before=ledger(f.c),captured=f.c.inspectMergeRegistration(f.registration);assert.ok(Object.isFrozen(captured));assert.ok(Object.isFrozen(captured.identity.target));
 const h=form(f,[...fields,'Register this existing PR identity','Back','Close'],[()=>{const id=randomUUID();f.c.store.run('INSERT INTO contribution_observations VALUES(?,?,?,?,?,?,?)',id,f.registration.resourceId,'UNSELECTED-HISTORY',id,'diagnostic','unselected-'+id,'{UNSELECTED_HISTORY_BODY');assert.equal(f.c.inspectMergeRegistration(f.registration).fingerprint,captured.fingerprint);return f.credential;}]);
 assert.equal(await h.run(),'completed');await h.ui.close();assert.equal(ledger(f.c),before);assert.equal(f.c.listMergeTargets().targets.length,1);assert.doesNotMatch(JSON.stringify(h.shown),/UNSELECTED_HISTORY_BODY|producer_key|payload_hash/);assert.equal(f.native.puts(),0);f.native.pass();
});

test('oversized current project context refuses before credential reading and native observation',async t=>{
 const f=await world(t),before=ledger(f.c),requests=f.native.requests.length,project=f.c.store.one('SELECT profile FROM projects WHERE id=?','P').profile,h=form(f,[...fields,'Register this existing PR identity'],[()=>{f.c.store.run('UPDATE projects SET profile=? WHERE id=?',JSON.stringify({controlledOversizedCurrentProfile:'x'.repeat(131072)}),'P');return path.join(f.native.root,'CREDENTIAL_MUST_NOT_BE_READ.json');}]);
 try{await assert.rejects(h.run(),/Original bounded registered project unavailable/);}finally{f.c.store.run('UPDATE projects SET profile=? WHERE id=?',project,'P');await h.ui.close();}
 assert.equal(ledger(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.c.listMergeTargets().targets.length,0);assert.equal(f.native.puts(),0);f.native.pass();
});
