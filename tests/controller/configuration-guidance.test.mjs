import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {openController} from '../../dist/controller/index.js';import {configureOwnedRepositoryConfigurationFixture} from '../../.qualification/controller-testing.js';import {configurationServer,configurationTarget,configurationProfile} from './configuration-fixture.mjs';
test('a stopped GitHub branch read does not return partial observations', {timeout:5000}, async t=>{
 const fixture=await configurationServer();
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-guide-stop-')));
 const c=await openController({installationHome:path.join(root,'home')});
 t.after(async()=>{await c.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});});
 const {targetId}=c.registerRepositoryConfigurationTarget({target:configurationTarget});
 configureOwnedRepositoryConfigurationFixture(c,{origin:fixture.origin,token:'fixture-original'});
 const hold=fixture.holdNext('/repos/owner/repo/git/ref/heads/main','GET'),abort=new AbortController(),reason=Error('Owner stopped the branch read');
 const pending=c.guideRepositoryConfiguration({targetId,branch:'main',signal:abort.signal});
 const rejected=assert.rejects(pending,error=>error===reason);
 try {await hold.entered;abort.abort(reason);await rejected;} finally {hold.release();}
 assert.deepEqual(fixture.requests.map(({method,path})=>[method,path]),[['GET','/repos/owner/repo/git/ref/heads/main']]);
 assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);
 assert.equal(c.store.one('SELECT COUNT(*) n FROM works').n,0);
 const current=await c.guideRepositoryConfiguration({targetId,branch:'main'});
 assert.equal(current.branch,'main');
 assert.equal(current.targetId,targetId);
 assert.ok(current.observation.policy);
});
test('actual Controller guidance observes current normalized active rules and merge tuple; audit distinguishes external drift from retained desired recommendation',{timeout:5000},async()=>{const f=await configurationServer(),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-config-guide-'))),c=await openController({installationHome:path.join(root,'home')});let passed=false;try{const t=c.registerRepositoryConfigurationTarget({target:configurationTarget});configureOwnedRepositoryConfigurationFixture(c,{origin:f.origin,token:'fixture-original'});const p=await c.previewRepositoryConfiguration({targetId:t.targetId,profile:configurationProfile()});assert.equal((await c.applyRepositoryConfiguration({planId:p.planId})).phase,'CONFIRMED');const before=f.requests.filter(r=>['POST','PUT','PATCH'].includes(r.method)&&r.path!=='/graphql').length,guide=await c.guideRepositoryConfiguration({targetId:t.targetId,branch:'main'});assert.ok(guide.observation.policy,JSON.stringify(guide));assert.equal(guide.observation.policy.completeVisibleInputs,true,JSON.stringify(guide));assert.equal(guide.observation.policy.applicableSetKeys.length,1);assert.equal(guide.observation.mergeMethods.allow_rebase_merge,true);assert.equal(guide.observation.policy.classic.visibility,'not-established');const actual=[...f.rules.values()].find(r=>r.id!==99);actual.enforcement='disabled';f.repo.allow_rebase_merge=false;const drift=await c.auditRepositoryConfiguration({planId:p.planId});assert.equal(drift.complete,false);assert.ok(drift.unknowns.length);const current=await c.guideRepositoryConfiguration({targetId:t.targetId,branch:'main'});assert.equal(current.observation.policy.applicableSetKeys.length,0);assert.equal(current.observation.mergeMethods.allow_rebase_merge,false);assert.equal(c.inspectRepositoryConfiguration(p.planId).plan.profile.ruleset.enforcement,'active');const missing=await c.guideRepositoryConfiguration({targetId:t.targetId,branch:'missing'});assert.equal(missing.observation.policy,null);assert.ok(missing.observation.conditions.length);assert.equal(f.requests.filter(r=>['POST','PUT','PATCH'].includes(r.method)&&r.path!=='/graphql').length,before);passed=true;}finally{await c.close();await f.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Retained config guide '+root);}});
