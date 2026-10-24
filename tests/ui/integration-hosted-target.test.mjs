import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {hostedTargetWorld,hostedFields,hostedAccept,hostedInputs} from './integration-hosted-target-fixture.mjs';
import {readCommand} from './integration-command-fixture.mjs';
import {domain} from './hosted-registration-cleanup-fixture.mjs';
import {receiverSnapshot} from './integration-read-fixture.mjs';
import {heldInitializer,assertGone} from './integration-initialization-fixture.mjs';
import {waitFile} from './integration-send-fixture.mjs';

for(const configured of [true,false])test('reviewed GitHub receiver registration uses original native identity and creates no work/grant; configured='+configured,async t=>{
 const f=await hostedTargetWorld(t),before=domain(f.c),conversation=f.c.inspectConversation(f.conversation),receiver=await receiverSnapshot(f.native.receiver);if(!configured)delete f.c.options.effectsProfile;const defaults=structuredClone(f.c.options.effectsProfile);
 const h=readCommand(f,[...hostedAccept],[...hostedInputs(f),...configured?[]:[f.git],f.credential]);await h.run();await h.ui.close();
 const rows=f.c.listIntegrationTargets().targets.filter(row=>row.state==='RETAINED'&&row.family==='github-existing-ref');assert.equal(rows.length,1);const target=rows[0];assert.equal(target.projectId,'P');assert.equal(target.ref,'refs/heads/main');assert.deepEqual(target.configuration.publicationInventory,['file.txt']);assert.deepEqual(target.configuration.authorizedDeltaPaths,['file.txt']);assert.equal(target.configuration.repository.repositoryId,9);assert.equal(target.configuration.expectedUserId,7);assert.equal(target.configuration.basisCommit,f.native.B);
 const after=domain(f.c);for(const table of ['works','budgets','runs','effect_delegations','effect_operations','authority_observations'])assert.deepEqual(after[table],before[table]);assert.equal(after.sources.length,before.sources.length+1);assert.deepEqual(f.c.inspectConversation(f.conversation),conversation);assert.deepEqual(f.c.options.effectsProfile,defaults);assert.deepEqual(await receiverSnapshot(f.native.receiver),receiver);assert.ok(f.native.requests.length>0);assert.ok(f.rest.requests.every(row=>row.authorized));assert.match(h.shown[0].text,/public personal-owner/);assert.match(h.shown.at(-1).title,/registered/);assert.equal(JSON.stringify(h.shown).includes(f.native.token),false);
 const again=readCommand(f,[...hostedAccept],[...hostedInputs(f),...configured?[]:[f.git],f.credential]);await again.run();await again.ui.close();assert.equal(f.c.listIntegrationTargets().targets.filter(row=>row.state==='RETAINED'&&row.family==='github-existing-ref').length,1);assert.equal(f.c.store.all("SELECT id FROM effect_targets WHERE json_extract(data,'$.kind')='github-existing-ref'")[0].id,target.targetId);f.pass();
});

test('review Back, Git-input and credential cancellation remain pure and keep Back as default',async t=>{
 const f=await hostedTargetWorld(t),before=domain(f.c),native=f.native.requests.length,rest=f.rest.requests.length,client=f.c.effects.client.bind(f.c.effects);let opened=0;f.c.effects.client=(...args)=>{opened++;return client(...args);};
 const back=readCommand(f,[...hostedFields,(_title,rows)=>{assert.equal(rows[0],'Back without registering');return rows[0];},'Back without registration','Back','Close'],hostedInputs(f));await back.run();await back.ui.close();
 delete f.c.options.effectsProfile;
 for(const inputs of [[...hostedInputs(f)],[...hostedInputs(f),f.git]]){const h=readCommand(f,[...hostedFields,'Register this observed GitHub receiver','Back without registration','Back','Close'],inputs);await h.run();await h.ui.close();}
 assert.equal(opened,0);assert.equal(f.native.requests.length,native);assert.equal(f.rest.requests.length,rest);assert.deepEqual(domain(f.c),before);f.pass();
});

for(const drift of ['source','repository','project'])test('GitHub receiver form refuses '+drift+' drift during actual native pinned fetch',async t=>{
 const f=await hostedTargetWorld(t),before=domain(f.c),client=f.c.effects.client.bind(f.c.effects);let current=true;
 f.c.effects.client=async(...args)=>{const native=await client(...args),fetch=native.fetchHttpsPinnedBasis.bind(native);native.fetchHttpsPinnedBasis=async(...input)=>{const result=await fetch(...input);if(drift==='source')current=false;if(drift==='repository')f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.actorUserId',99) WHERE id=?",f.registeredRepository);if(drift==='project')f.c.store.run("UPDATE projects SET profile='{} ' WHERE id='P'");return result;};return native;};
 const h=readCommand(f,[...hostedAccept],[...hostedInputs(f),f.credential],{isCurrent:()=>current});await assert.rejects(h.run(),/source changed|repository identity changed|project changed/i);await h.ui.close();const after=domain(f.c);assert.equal(after.effect_targets.length,before.effect_targets.length);for(const table of ['sources','works','budgets','runs','effect_delegations','effect_operations'])assert.deepEqual(after[table],before[table]);f.pass();
});

test('late source navigation names the actually committed GitHub receiver rather than implying rollback',async t=>{
 const f=await hostedTargetWorld(t),register=f.c.registerHostedIntegrationTarget.bind(f.c);let current=true,id;
 f.c.registerHostedIntegrationTarget=async(...args)=>{const result=await register(...args);id=result.targetId;current=false;return result;};
 const h=readCommand(f,[...hostedAccept],[...hostedInputs(f),f.credential],{isCurrent:()=>current});await assert.rejects(h.run(),error=>id&&error.message.includes('Original integration target '+id));await h.ui.close();assert.equal(f.c.inspectIntegrationTarget(id).state,'RETAINED');f.pass();
});

test('unsupported private/native-provider and missing repository identities give explicit recovery without registration',async t=>{
 const f=await hostedTargetWorld(t),before=domain(f.c);f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.visibility','private') WHERE id=?",f.registeredRepository);
 const h=readCommand(f,['Integration targets','Register GitHub branch receiver','Repository ·','github · owner/repo','Back','Back without registration','Back','Close']);await h.run();await h.ui.close();assert.match(h.shown[0].text,/private repository integration/);assert.equal(domain(f.c).sources.length,before.sources.length);
 for(const provider of ['gitea','gitlab']){const row=f.c.registerRepositoryConfigurationTarget({target:{provider,apiBase:provider==='gitea'?'https://forge.example/api/v1':'https://gitlab.example/api/v4',owner:'owner',repository:'repo',repositoryId:9,actorUserId:7}});const unavailable=readCommand(f,['Integration targets','Register GitHub branch receiver','Repository ·',provider+' · owner/repo','Back','Back without registration','Back','Close']);await unavailable.run();await unavailable.ui.close();assert.match(unavailable.shown[0].text,/Gitea, GitLab/);f.c.store.run('DELETE FROM effect_targets WHERE id=?',row.targetId);}
 f.c.store.run('DELETE FROM effect_targets WHERE id=?',f.registeredRepository);const empty=readCommand(f,['Integration targets','Register GitHub branch receiver','Repository ·','Back without registration','Back','Close']);await empty.run();await empty.ui.close();assert.match(empty.shown[0].text,/Register repository/);f.pass();
});

for(const stage of ['--version','fetch'])test('hosted form close joins '+stage+' descendants and holds credential ownership through settlement',{timeout:12000},async t=>{
 const f=await hostedTargetWorld(t),before=domain(f.c),held=await heldInitializer(f,stage);delete f.c.options.effectsProfile;
 const first=readCommand(f,[...hostedAccept],[...hostedInputs(f),held.binary,f.credential]),task=first.run();void task.catch(()=>{});await waitFile(held.marker);
 const competing=readCommand(f,[...hostedAccept],[...hostedInputs(f),f.git,f.credential]);await assert.rejects(competing.run(),/owns the credential session/);await competing.ui.close();
 await first.ui.close();await assert.rejects(task);await assertGone(held.pids);assert.deepEqual(domain(f.c),before);f.pass();
});
