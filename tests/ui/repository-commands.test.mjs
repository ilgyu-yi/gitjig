import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedRepositoryConfigurationFixture} from '../../.qualification/controller-testing.js';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import {editRepositoryProfile} from '../../dist/ui/repository-profile.js';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';
async function world(t,options={}){const server=await nativeConfigurationFixture('gitea',options),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-repo-ui-'))),home=path.join(root,'home'),c=await openController({installationHome:home}),source=c.createConversation().conversationId,file=path.join(root,'credential.json');await fs.writeFile(file,'{"token":"fixture-native-token"}',{mode:0o600});configureOwnedRepositoryConfigurationFixture(c,{origin:server.origin,token:'fixture-native-token'});const registered=c.registerRepositoryConfigurationTarget({target:server.target});
 // Controlled owner transport seam; original controller journal and UI remain in use.
 c.configureRepositoryConfigurationCredential=options=>configureOwnedRepositoryConfigurationFixture(c,{...options,origin:server.origin});
 t.after(async()=>{await c.close();await server.close();await fs.rm(root,{recursive:true,force:true});});return {c,server,source,file,targetId:registered.targetId};}
function command(f,choices,inputs=[],hooks={}){const shown=[],notices=[],choose=async(title,labels)=>{const next=choices.shift();if(typeof next==='function')return next(title,labels);if(next===undefined)return;const found=labels.find(label=>label.startsWith(next));assert.ok(found,'Missing '+next+' in '+JSON.stringify({title,labels}));return found;},ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose,input:async(title,value)=>{const next=inputs.shift();return typeof next==='function'?next(title,value):next;},show:async(title,text)=>shown.push({title,text}),notice:text=>notices.push(text),...hooks});return {ui,shown,notices,run:()=>ui.commands[0].run('',f.source)};}
const ledger=c=>JSON.stringify(['works','runs','sources','budgets','effect_operations','effect_receipts'].map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
test('repository field forms preserve false/zero/empty/unmanaged and cancellation without admitting work',async()=>{
 const choices=['protection.fields.required_approvals','Edit value','protection.fields.dismiss_stale_approvals','false','repository.allow_merge_commits','false','repository.allow_merge_commits','Leave unmanaged','protection.fields.status_check_contexts','Edit value','Save list','Use staged profile'];
 const value=await editRepositoryProfile({show:async()=>assert.fail('Unexpected validation error'),guard(){},input:async()=> '0',choose:async(_t,rows)=>{const pick=choices.shift(),found=rows.find(r=>r.startsWith(pick));assert.ok(found,String(pick));return found;}},'gitea','main');assert.equal(value.protection.fields.required_approvals,0);assert.equal(value.protection.fields.dismiss_stale_approvals,false);assert.deepEqual(value.protection.fields.status_check_contexts,[]);assert.equal(value.repository,undefined);
 assert.equal(await editRepositoryProfile({show:async()=>assert.fail('Unexpected validation error'),guard(){},input:async()=>assert.fail(),choose:async()=>undefined},'gitlab','main'),undefined);
 const ghChoices=['ruleset.pullRequest.approvingCount','Edit value','Use staged profile'];const gh=await editRepositoryProfile({show:async()=>assert.fail('Unexpected validation error'),guard(){},input:async()=> '0',choose:async(_t,rows)=>{const pick=ghChoices.shift();return rows.find(r=>r.startsWith(pick));}},'github','main');assert.equal(gh.ruleset.pullRequest.approvingCount,0);
});
test('opening targets/plan inspection is pure and keeps unrelated draft/model/ledger and requests',async t=>{
 const f=await world(t),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});f.c.setDraft({conversationId:f.source,expectedRevision:0,text:'한국어 original'});const before=ledger(f.c),requests=f.server.requests.length;
 const h=command(f,['Registered targets',(_t,rows)=>rows[0],'Inspect target identity','Back','Retained configuration plans',(_t,rows)=>rows[0],'Inspect original plan','Back','Back','Close']);await h.run();assert.equal(ledger(f.c),before);assert.equal(f.server.requests.length,requests);assert.equal(f.c.inspectConversation(f.source).draft.text,'한국어 original');assert.ok(h.shown.some(v=>v.text.includes(plan.planId)));await h.ui.close();
});
test('staged field preview needs no desired JSON and retains original plan without applying',async t=>{
 const f=await world(t),h=command(f,['Registered targets',(_t,r)=>r[0],'New configuration preview','Edit recommendation fields','Update existing rule','Use staged profile','Back','Close'],['main',f.file]);await h.run();const plans=f.c.listRepositoryConfigurationPlans().plans;assert.equal(plans.length,1);assert.equal(plans[0].recordedPhase,'PREVIEWED');assert.ok(h.notices.some(n=>n.includes(plans[0].planId)));assert.equal(f.server.requests.some(r=>r.method!=='GET'),false);assert.ok(h.shown.some(v=>v.title==='Staged profile · no work or requests yet'));assert.doesNotMatch(JSON.stringify(h.shown)+JSON.stringify(h.notices),/fixture-native-token/);await h.ui.close();
});
test('explicit selected original apply/audit uses existing journal and does not reset allowance',async t=>{
 const f=await world(t),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile}),h=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original','Audit selected','Back','Back','Close'],[f.file,f.file]);await h.run();assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'CONFIRMED');assert.equal(f.c.inspectWork(plan.workId).allowance.consumed,5);assert.equal(f.server.requests.filter(r=>r.method!=='GET').length,2);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,1);
 const outcomes=h.shown.filter(value=>value.title.startsWith('Repository outcome'));
 assert.match(outcomes[0].text,/^CONFIRMED · Selected settings were observed matching/);
 assert.match(outcomes[1].text,/^AUDIT MATCH · This audit observed all selected settings matching/);
 assert.match(outcomes[1].text,/Historical operation phase \(separate from this audit\): "CONFIRMED"/);
 await h.ui.close();
});

test('valid long native contexts refuse incomplete application review before confirmation or controller dispatch',async t=>{
 const f=await world(t),contexts=prefix=>Array.from({length:100},(_,index)=>(prefix+String(index).padStart(3,'0')).padEnd(256,'x'));
 f.server.state.protection.status_check_contexts=contexts('old-');
 const profile={provider:'gitea',version:'complete-review/v1',protection:{name:'main',fields:{status_check_contexts:contexts('new-')}}};
 const plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile});assert.equal(plan.phase,'PREVIEWED');
 assert.equal(plan.plan.steps[0].fields.find(value=>value.path==='protection.status_check_contexts'||value.path==='status_check_contexts').intended.length,100);
 const before=ledger(f.c),requests=f.server.requests.length;let confirmations=0,dispatches=0;
 const apply=f.c.applyRepositoryConfiguration.bind(f.c);f.c.applyRepositoryConfiguration=(...args)=>{dispatches++;return apply(...args);};
 const h=command(f,['Retained configuration plans',(_t,rows)=>rows[0],'Review changes',()=>{confirmations++;return 'Apply original';}],[()=>assert.fail('Incomplete review must refuse before credentials')]);
 await assert.rejects(h.run(),error=>/Complete repository application review.*36000/u.test(error.message)&&error.message.includes(plan.planId)&&error.message.includes(plan.workId)&&error.message.includes('repo plan --plan'));
 assert.equal(confirmations,0);assert.equal(dispatches,0);assert.equal(ledger(f.c),before);assert.equal(f.server.requests.length,requests);
 assert.equal(f.c.listRepositoryConfigurationPlans().plans[0].planId,plan.planId);assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'PREVIEWED');await h.ui.close();
});

test('a fresh native audit conflict is readable while the original confirmed phase stays historical',async t=>{
 const f=await world(t),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});
 await f.c.applyRepositoryConfiguration({planId:plan.planId});f.server.state.protection.required_approvals=3;
 const writes=f.server.requests.filter(value=>value.method!=='GET').length,h=command(f,['Retained configuration plans',(_t,r)=>r[0],'Audit selected','Back','Back','Close'],[f.file]);
 await h.run();const outcome=h.shown.find(value=>value.title.startsWith('Repository outcome')).text.split('Original observation · details')[0];
 assert.match(outcome,/^AUDIT INCOMPLETE/);assert.match(outcome,/Historical operation phase \(separate from this audit\): "CONFIRMED"/);
 assert.match(outcome,/required_approvals: "conflicting" · current actual 3/);
 assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'CONFIRMED');assert.equal(f.server.requests.filter(value=>value.method!=='GET').length,writes);
 await h.ui.close();
});

test('empty target discovery offers existing registration and cancellation returns without effects or lost draft',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-empty-repo-ui-'))),c=await openController({installationHome:path.join(root,'home')}),source=c.createConversation().conversationId;let passed=false;
 t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained empty-target command evidence: '+root);});
 c.setDraft({conversationId:source,expectedRevision:0,text:'  Keep original 한국어 draft  '});
 const before=ledger(c),targets=c.listRepositoryConfigurationTargets();let emptyVisits=0;
 c.configureRepositoryConfigurationCredential=()=>assert.fail('Cancelled registration must not configure credentials');
 const h=command({c,source},['Registered targets',(title,labels)=>{emptyVisits++;assert.match(title,/none registered/);assert.deepEqual(labels,['Register repository','Back']);return 'Register repository';},undefined,(title,labels)=>{emptyVisits++;assert.match(title,/none registered/);assert.deepEqual(labels,['Register repository','Back']);return 'Back';},'Close']);
 await h.run();assert.equal(emptyVisits,2);assert.deepEqual(c.listRepositoryConfigurationTargets(),targets);assert.equal(ledger(c),before);
 assert.equal(c.inspectConversation(source).draft.text,'  Keep original 한국어 draft  ');assert.equal(h.shown.length,0);await h.ui.close();passed=true;
});
test('late source/profile and original revision changes refuse before credential configuration or requests',async t=>{
 const f=await world(t);let current=true;const cancelled=command(f,['Registered targets',(_t,r)=>r[0],'New configuration preview','Edit recommendation fields','Update existing rule'],[()=>{current=false;return 'main';}],{isCurrent:()=>current});await assert.rejects(cancelled.run(),/source changed/);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,0);assert.equal(f.server.requests.length,0);await cancelled.ui.close();
 const p=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile}),requests=f.server.requests.length,stale=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original'],[()=>{f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.revision',2) WHERE id=?",p.planId);return f.file;}]);await assert.rejects(stale.run(),/plan changed/);assert.equal(f.server.requests.length,requests);await stale.ui.close();
});
test('competing UI actions cannot replace an in-flight configuration credential session',async t=>{
 let hold=false,enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);const f=await world(t,{intercept:async({req})=>{if(hold&&req.method==='GET'){hold=false;enter();await gate;}return false;}}),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});hold=true;
 const first=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original','Back','Back','Close'],[f.file]),task=first.run();await entered;
 const second=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original'],[f.file]);try{await assert.rejects(second.run(),/owns the credential session/);}finally{release();}await task;assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'CONFIRMED');assert.equal(f.server.requests.filter(r=>r.method!=='GET').length,2);await first.ui.close();await second.ui.close();
});
test('UI shutdown after native handoff joins exact original request and retains UNKNOWN without later writes',async t=>{
 let enter;const entered=new Promise(r=>enter=r);const f=await world(t,{intercept:({req,body,state})=>{if(req.method==='PATCH'){Object.assign(state.repository,body);enter();return true;}return false;}}),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile}),h=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original'],[f.file]);const task=h.run();void task.catch(()=>{});await entered;await h.ui.close();await assert.rejects(task);assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'UNKNOWN');assert.equal(f.c.inspectWork(plan.workId).allowance.reserved,0);assert.equal(f.server.requests.filter(r=>r.method!=='GET').length,1);
});
test('source navigation after preview admission preserves discoverable original work and names it in recovery',async t=>{
 let current=true;const f=await world(t,{intercept:()=>{current=false;return false;}}),h=command(f,['Registered targets',(_t,r)=>r[0],'New configuration preview','Edit recommendation fields','Update existing rule','Use staged profile'],['main',f.file],{isCurrent:()=>current});
 await assert.rejects(h.run(),error=>{const original=f.c.listRepositoryConfigurationPlans().plans[0];assert.ok(original);assert.equal(original.recordedPhase,'PREVIEWED');return error.message.includes(original.planId)&&error.message.includes(original.workId);});assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,1);assert.equal(f.server.requests.some(r=>r.method!=='GET'),false);assert.equal(h.notices.some(n=>n.startsWith('Preview retained')),false);await h.ui.close();
});

async function policyWorld(t,options={}){
 const f=await world(t,{intercept:async args=>{if(await options.intercept?.(args))return true;if(args.relative==='/repos/owner/repo/branches/main'){args.send({name:'main',commit:{id:'1'.repeat(40)},protected:true,effective_branch_protection_name:'main',required_approvals:0});return true;}return false;}});f.server.state.repository.default_branch='main';return f;
}
const policyChoices=()=>['Registered targets',(_t,r)=>r[0],'Inspect current branch policy','Back','Close'];
test('current policy UI reads original target and branch without changing a pending write or its allowance',async t=>{
 const f=await policyWorld(t,{intercept:({req,res,body,state})=>{if(req.method==='PATCH'){Object.assign(state.repository,body);res.destroy();return true;}return false;}}),p=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});assert.equal((await f.c.applyRepositoryConfiguration({planId:p.planId})).phase,'UNKNOWN');const before=ledger(f.c),writes=f.server.requests.filter(r=>r.method!=='GET').length,h=command(f,policyChoices(),['main',f.file]);await h.run();assert.equal(ledger(f.c),before);assert.equal(f.server.requests.filter(r=>r.method!=='GET').length,writes);const result=h.shown.find(v=>v.title.startsWith('Current branch policy'));assert.ok(result);assert.match(result.text,new RegExp(f.targetId));assert.match(result.text,/Selected branch: main/);assert.match(result.text,/UNAVAILABLE/);assert.match(result.text,/required_approvals/);assert.match(result.text,/not complete|Visible current observations/);assert.doesNotMatch(result.text,/fixture-native-token|fixture-private-native/);await h.ui.close();
});
test('policy form cancellation sends no requests or credential substitution and pure target inspection allocates nothing',async t=>{
 const f=await policyWorld(t),before=ledger(f.c);let configurations=0;f.c.configureRepositoryConfigurationCredential=()=>configurations++;
 for(const inputs of [[undefined],['main',undefined]]){const h=command(f,policyChoices(),inputs);await h.run();await h.ui.close();}assert.equal(configurations,0);assert.equal(f.server.requests.length,0);assert.equal(ledger(f.c),before);assert.equal(f.c.inspectRepositoryConfigurationTarget(f.targetId).state,'RETAINED');assert.equal(ledger(f.c),before);assert.throws(()=>f.c.inspectRepositoryConfigurationTarget('missing'),/unavailable/);
});
test('changed selected target refuses before configuring credentials and remote actor substitution cannot yield policy',async t=>{
 const f=await policyWorld(t);let configurations=0;const configure=f.c.configureRepositoryConfigurationCredential;f.c.configureRepositoryConfigurationCredential=options=>{configurations++;configure(options);};
 const row=f.c.store.one('SELECT data FROM effect_targets WHERE id=?',f.targetId),h=command(f,policyChoices(),['main',()=>{f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.repositoryId',10) WHERE id=?",f.targetId);return f.file;}]);await assert.rejects(h.run(),/Selected repository target changed/);assert.equal(configurations,0);assert.equal(f.server.requests.length,0);await h.ui.close();f.c.store.run('UPDATE effect_targets SET data=? WHERE id=?',row.data,f.targetId);
 f.server.state.actorId=8;const substituted=command(f,policyChoices(),['main',f.file]);await assert.rejects(substituted.run(),/registered|identity|target/i);assert.equal(substituted.shown.length,0);assert.equal(substituted.notices.at(-1),'');assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,0);assert.equal(f.server.requests.some(r=>r.method!=='GET'),false);await substituted.ui.close();
});
test('concurrent policy reads share the configuration credential lease without replacing original request',async t=>{
 let enter,release,hold=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),f=await policyWorld(t,{intercept:async({req})=>{if(hold&&req.method==='GET'){hold=false;enter();await gate;}return false;}}),h=command(f,policyChoices(),['main',f.file]),task=h.run();await entered;assert.match(h.notices.at(-1),/Repository request in progress/);const competing=command(f,policyChoices(),['main',f.file]);try{await assert.rejects(competing.run(),/owns the credential session/);}finally{release();}await task;assert.equal(h.notices.at(-1),'');assert.equal(h.shown.length,1);assert.equal(competing.shown.length,0);await h.ui.close();await competing.ui.close();
});
test('navigation during policy observation suppresses results for another view and names original target and branch',async t=>{
 let current=true;const f=await policyWorld(t,{intercept:()=>{current=false;return false;}}),h=command(f,policyChoices(),['main',f.file],{isCurrent:()=>current}),before=ledger(f.c);await assert.rejects(h.run(),error=>error.message.includes(f.targetId)&&error.message.includes('main')&&error.message.includes('source changed'));assert.equal(h.shown.length,0);assert.equal(ledger(f.c),before);assert.equal(f.server.requests.some(r=>r.method!=='GET'),false);await h.ui.close();
});
test('UI shutdown aborts and joins an in-flight read without settling existing ledger or dispatching writes',async t=>{
 let enter;const entered=new Promise(r=>enter=r),f=await policyWorld(t,{intercept:({req})=>{if(req.method==='GET'){enter();return true;}return false;}}),before=ledger(f.c),h=command(f,policyChoices(),['main',f.file]),task=h.run();void task.catch(()=>{});await entered;await h.ui.close();await assert.rejects(task,/Policy read/);assert.equal(ledger(f.c),before);assert.equal(f.server.requests.length,1);assert.equal(h.shown.length,0);
});

for(const failure of ['number','preview'])test('policy '+failure+' validation retains prior staged edits for correction',async()=>{
 const choices=['ruleset.name','Edit value',...(failure==='number'?['ruleset.pullRequest.approvingCount','Edit value','ruleset.pullRequest.approvingCount','Edit value']:['Use staged profile','ruleset.name','Edit value']),'Use staged profile'];
 const inputs=failure==='number'?['Retained policy','11','2']:['','Corrected policy'];let errors=0;
 const result=await editRepositoryProfile({guard(){},show:async(title)=>{errors++;assert.match(title,/retained|not staged/);},input:async()=>inputs.shift(),choose:async(_title,rows)=>{const next=choices.shift();assert.ok(next,'Unexpected menu');if(failure==='number'&&errors&&next==='ruleset.pullRequest.approvingCount')assert.ok(rows.includes('ruleset.name · "Retained policy"'));const row=rows.find(r=>r.startsWith(next));assert.ok(row,next);return row;}},'github','main');
 assert.equal(errors,1);assert.equal(result.ruleset.name,failure==='number'?'Retained policy':'Corrected policy');if(failure==='number')assert.equal(result.ruleset.pullRequest.approvingCount,2);assert.equal(choices.length,0);
});

test('duplicate policy context retains staged list and source failures still escape',async()=>{
 const picks=['protection.fields.status_check_contexts','Edit value','Add context','Add context','Save list','Use staged profile'];let errors=0;
 const forms={guard(){},show:async()=>{errors++;},input:async()=> 'lint',choose:async(_title,rows)=>{const next=picks.shift();assert.ok(next);const value=rows.find(r=>r.startsWith(next));assert.ok(value,next);return value;}};
 const result=await editRepositoryProfile(forms,'gitea','main');assert.deepEqual(result.protection.fields.status_check_contexts,['lint']);assert.equal(errors,1);
 const changed=Error('Source changed');await assert.rejects(editRepositoryProfile({...forms,guard(){throw changed;}},'gitea','main'),e=>e===changed);
});
