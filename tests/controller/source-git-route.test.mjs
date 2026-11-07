import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {captureSourceGitRoute,retainSourceGitRoute} from '../../dist/effects/source-policy.js';
import {openController} from '../../dist/controller/index.js';

test('original Git route is captured before private HOME projection and immutable',()=>{
 const env={HOME:'/original/operator',XDG_CONFIG_HOME:'/original/config'},route=captureSourceGitRoute(env);
 env.HOME='/private/application';assert.deepEqual(route,{kind:'available',environment:{home:'/original/operator',xdgConfigHome:'/original/config'}});
 assert.ok(Object.isFrozen(route));assert.ok(Object.isFrozen(route.environment));
 assert.deepEqual(retainSourceGitRoute(route),route);
});
test('unsupported redirection is explicitly unavailable and malformed present route cannot downgrade',()=>{
 const route=captureSourceGitRoute({HOME:'/operator',GIT_CONFIG_GLOBAL:'/another/config'});
 assert.deepEqual(route,{kind:'unavailable',reason:'unsupported-operator-route'});
 for(const bad of [null,{}, {kind:'available'}, {kind:'unavailable',reason:'anything'}, {kind:'available',environment:{home:'/operator',extra:1}}])assert.throws(()=>retainSourceGitRoute(bad),/route/);
});
test('unavailable original route permits ordinary controller startup and refuses source action without native admission',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-route-'))),c=await openController({installationHome:path.join(root,'home'),sourceGitRoute:{kind:'unavailable',reason:'unsupported-operator-route'}});
 try{assert.ok(c.createConversation().conversationId);const result=await c.prepareSourceSnapshot({workId:'missing',destinationBranch:'reviewed'});assert.equal(result.kind,'held');assert.match(result.reason,/operator Git route unavailable/);assert.equal(c.store.one('SELECT count(*) AS n FROM source_branch_previews').n,0);}
 finally{await c.close();await fs.rm(root,{recursive:true,force:true});}
});

test('explicit invalid source profiles refuse synchronously at every outer action without fallback or allocation',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-profile-'))),c=await openController({installationHome:path.join(root,'home'),effectsProfile:{gitBinary:'/opt/homebrew/bin/git'}});
 try{const before=JSON.stringify(c.store.all('SELECT * FROM runs'));for(const profile of [undefined,null,[],{}, {gitBinary:'/bin/false',extra:true}]){
  const controls={profile,validate(){}};
  for(const action of [()=>c.prepareSourceSnapshot({workId:'missing',destinationBranch:'reviewed'},controls),()=>c.sourceActions.review({workId:'missing',proposalId:'missing'},controls),()=>c.sourceActions.adopt({},controls),()=>c.effects.dispatchSourceSnapshot('missing',controls),()=>c.sourceActions.reviewReconciliation('missing',controls),()=>c.effects.reconcileSourceSnapshot({},controls)])assert.throws(action,/closed trusted Git recipe/);
 }assert.equal(JSON.stringify(c.store.all('SELECT * FROM runs')),before);}finally{await c.close();await fs.rm(root,{recursive:true,force:true});}
});
