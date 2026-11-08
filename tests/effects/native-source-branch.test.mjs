import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {openNativeGit} from '../../dist/effects/index.js';
import {freeze} from '../../dist/controller/change-files.js';
import {captureSourceGitEnvironment} from '../../dist/effects/source-policy.js';
const exec=promisify(execFile),git='/opt/homebrew/bin/git',sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,options={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-branch-'))),home=path.join(root,'operator'),source=path.join(root,'source'),clientRoot=path.join(root,'client');
 await fs.mkdir(home,{mode:0o700});await fs.mkdir(source,{mode:0o700});
 const env={HOME:home,PATH:'/opt/homebrew/bin:/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_AUTHOR_NAME:'Owned fixture',GIT_AUTHOR_EMAIL:'owned@example.invalid',GIT_COMMITTER_NAME:'Owned fixture',GIT_COMMITTER_EMAIL:'owned@example.invalid'};
 const run=async(args,cwd=source)=>(await exec(git,args,{cwd,env,timeout:10000,maxBuffer:1024*1024})).stdout.trim();
 await run(['init','--template=','--initial-branch=main']);await fs.writeFile(path.join(source,'a.txt'),'base\n');await run(['add','a.txt']);await run(['-c','commit.gpgsign=false','commit','-m','Owned basis']);
 const basis=await run(['rev-parse','HEAD']);await fs.writeFile(path.join(source,'.env'),'PRIVATE_CAPTURE_ONLY\n');
 let selectedGit=git;
 if(options.wrapper){selectedGit=path.join(root,options.binaryName??'selected-git');await fs.writeFile(selectedGit,options.wrapper(root,git),{mode:0o700});}
 let client=await openNativeGit({gitBinary:selectedGit,ownedClientRoot:clientRoot});
 t.after(async()=>{await client.close();});
 const environment=captureSourceGitEnvironment({HOME:home});
 const target=await client.observeSourceBranchTarget({targetId:'source-fixture',path:source,destinationRef:'refs/heads/reviewed'},environment);
 await client.fetchSourceBasis(target,basis);
 const captured=async(name,value)=>{const live=path.join(root,name),dest=path.join(root,name+'-frozen');await fs.mkdir(live,{mode:0o700});await fs.writeFile(path.join(live,'a.txt'),value);return{versionId:name,root:dest,...await freeze(live,dest,{})};};
 const before=await captured('before','base\n'),after=await captured('after','reviewed\n'),operationId='source-owned-operation';
 const projected=await client.project({operationId,base:before,candidate:after,basisCommit:basis,authorizedDeltaPaths:['a.txt'],publicationInventory:['a.txt']});assert.equal(projected.kind,'projected',JSON.stringify(projected));
 const input={operationId,target,integrationCommit:projected.receipt.projectedCommit};
 const state=async()=>({head:await run(['rev-parse','HEAD']),index:sha(await fs.readFile(path.join(source,'.git/index'))),work:await fs.readFile(path.join(source,'a.txt'),'utf8'),private:await fs.readFile(path.join(source,'.env'),'utf8')});
 return{root,home,source,clientRoot,selectedGit,get client(){return client;},target,input,run,state,async reopen(){await client.close();client=await openNativeGit({gitBinary:selectedGit,ownedClientRoot:clientRoot,resumeOwned:true});}};
}

test('source create-only native push preserves HEAD/index/worktree and durable original receipt survives reopen',async t=>{
 const f=await fixture(t),before=await f.state(),prepared=await f.client.prepareSourceBranchCreate(f.input,new AbortController().signal);
 const receipt=await f.client.spawnPreparedSourceBranchCreate(prepared);assert.equal(receipt.outcome,'created',JSON.stringify(receipt));
 assert.equal((await f.client.reconcileSourceBranchCreate(f.input,receipt)).kind,'confirmed-creation');
 assert.equal(await f.run(['rev-parse','refs/heads/reviewed']),f.input.integrationCommit);assert.deepEqual(await f.state(),before);
 await assert.rejects(f.run(['show','refs/heads/reviewed:.env']));
 assert.equal((await f.client.spawnPreparedSourceBranchCreate(prepared)).handoff,'not-started');
 await f.reopen();assert.equal((await f.client.reconcileSourceBranchCreate(f.input,receipt)).kind,'confirmed-creation');
 await assert.rejects(f.client.reconcileSourceBranchCreate({...f.input,operationId:'different-operation'},{...receipt,operationId:'different-operation'}),/exact operation identity/);
 t.diagnostic(JSON.stringify({fixture:f.root,commandId:receipt.command.commandId,cleanup:receipt.command.cleanup}));
});

test('foreign same-H create and forged causal scalars never establish original creation',async t=>{
 const f=await fixture(t),prepared=await f.client.prepareSourceBranchCreate(f.input,new AbortController().signal);
 await f.run(['fetch','--no-tags','--',path.join(f.clientRoot,'client.git'),f.input.integrationCommit]);await f.run(['update-ref','refs/heads/reviewed',f.input.integrationCommit]);
 const receipt=await f.client.spawnPreparedSourceBranchCreate(prepared);assert.equal(receipt.handoff,'started');assert.equal(receipt.outcome,'unknown',JSON.stringify(receipt));
 const forged={operationId:f.input.operationId,integrationCommit:f.input.integrationCommit,destinationRef:f.target.destinationRef,handoff:'started',outcome:'created'};
 assert.equal((await f.client.reconcileSourceBranchCreate(f.input,forged)).kind,'observed-desired-state');
 assert.equal((await f.client.reconcileSourceBranchCreate(f.input,{...forged,command:receipt.command})).kind,'observed-desired-state');
});

test('source route honors effective global hooks and unsafe receiver policy by refusing, with no hook bypass',async t=>{
 const f=await fixture(t),hooks=path.join(f.root,'operator-hooks'),marker=path.join(f.root,'hook-ran');await fs.mkdir(hooks,{mode:0o700});
 await fs.writeFile(path.join(hooks,'pre-push'),`#!/bin/sh\nprintf ran > '${marker}'\nexit 1\n`,{mode:0o700});
 await f.run(['config','--global','core.hooksPath',hooks]);
 await assert.rejects(f.client.observeSourceBranchTarget({targetId:'hooks',path:f.source,destinationRef:'refs/heads/hooks'},f.target.environment),/hooks/);
 await assert.rejects(fs.stat(marker),{code:'ENOENT'});
 await f.run(['config','--global','--unset','core.hooksPath']);await f.run(['config','receive.denyCurrentBranch','updateInstead']);
 await assert.rejects(f.client.observeSourceBranchTarget({targetId:'unsafe',path:f.source,destinationRef:'refs/heads/unsafe'},f.target.environment),/policy/);
});

test('private config payload is absent from every owned native journal; source argv retains declared ownership controls only',async t=>{
 const f=await fixture(t),secret='PRIVATE_CONFIG_SENTINEL_7ce169';await f.run(['config','--global','credential.https://private.invalid.helper',secret]);
 const target=await f.client.observeSourceBranchTarget({targetId:'private',path:f.source,destinationRef:'refs/heads/private'},f.target.environment);
 assert.ok(target.policyFingerprint);const runs=await fs.readdir(path.join(f.clientRoot,'runs'));let configSeen=false;
 for(const id of runs){for(const name of ['descriptor.json','stdout.bin','stderr.bin','result.json']){const file=path.join(f.clientRoot,'runs',id,name);let bytes;try{bytes=await fs.readFile(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}assert.equal(bytes.includes(Buffer.from(secret)),false,file);if(name==='descriptor.json'){const d=JSON.parse(bytes);if(d.sourceDiagnostics){assert.equal(Object.hasOwn(d.env,'GIT_CONFIG_NOSYSTEM'),false);assert.equal(Object.hasOwn(d.env,'GIT_CONFIG_GLOBAL'),false);assert.equal(d.argv.some(a=>a.startsWith('core.hooksPath=')||a==='--no-verify'),false);if(d.sourcePolicyOutput)configSeen=true;}}}}
 assert.equal(configSeen,true);
});

test('changed source configuration or cancellation refuses before prepared push birth',async t=>{
 const f=await fixture(t),abort=new AbortController(),prepared=await f.client.prepareSourceBranchCreate(f.input,abort.signal);abort.abort();
 assert.equal((await f.client.spawnPreparedSourceBranchCreate(prepared)).handoff,'not-started');
 const second=await f.client.prepareSourceBranchCreate(f.input,new AbortController().signal);await f.run(['config','--global','receive.denyDeletes','true']);
 assert.equal((await f.client.spawnPreparedSourceBranchCreate(second)).handoff,'not-started');await assert.rejects(f.run(['rev-parse','refs/heads/reviewed']));
});

test('an absent destination attached to another unborn worktree is refused',async t=>{
 const f=await fixture(t),other=path.join(f.root,'other-worktree');await f.run(['worktree','add','--detach',other,'HEAD']);await f.run(['symbolic-ref','HEAD','refs/heads/unborn'],other);
 await assert.rejects(f.client.observeSourceBranchTarget({targetId:'unborn',path:f.source,destinationRef:'refs/heads/unborn'},f.target.environment),/unborn worktree/);
});

test('source environment captures explicit absence and refuses Git redirections instead of suppressing them',()=>{
 assert.deepEqual(captureSourceGitEnvironment({HOME:'/owned/operator'}),{home:'/owned/operator'});
 assert.throws(()=>captureSourceGitEnvironment({HOME:'/owned/operator',GIT_CONFIG_GLOBAL:'/secret/config'}),/redirection/);
 assert.throws(()=>captureSourceGitEnvironment({HOME:'/owned/operator',XDG_CONFIG_HOME:''}),/unsupported/);
});


test('original source push cancellation joins its exact native process group without source ref creation',async t=>{
 const f=await fixture(t,{wrapper:(root,binary)=>`#!/bin/sh
case " $* " in *" push --porcelain "*) printf started > '${root}/push-started'; sleep 30; exit 1;; esac
exec '${binary}' "$@"
`});
 const abort=new AbortController(),prepared=await f.client.prepareSourceBranchCreate(f.input,abort.signal),pending=f.client.spawnPreparedSourceBranchCreate(prepared);
 const until=Date.now()+5000;while(true){try{await fs.stat(path.join(f.root,'push-started'));break;}catch(e){if(e.code!=='ENOENT')throw e;}if(Date.now()>until){abort.abort();await pending;assert.fail('owned push did not reach controlled native boundary');}await new Promise(r=>setTimeout(r,10));}
 abort.abort();const receipt=await pending;assert.equal(receipt.handoff,'started');assert.equal(receipt.outcome,'unknown');assert.equal(receipt.command.cleanup,'confirmed');assert.equal(receipt.command.aborted,true);
 if(receipt.command.gitPid)assert.throws(()=>process.kill(-receipt.command.gitPid,0),{code:'ESRCH'});
 await assert.rejects(f.run(['rev-parse','refs/heads/reviewed']));
});

test('declared housekeeping controls reach local receive child and no detached maintenance is launched',async t=>{
 const f=await fixture(t,{wrapper:(root,binary)=>`#!/bin/sh
export GIT_TRACE2_EVENT='${root}/native-trace.jsonl'
export GIT_TRACE2_CONFIG_PARAMS='gc.auto,maintenance.auto,receive.autogc'
exec '${binary}' "$@"
`});
 await f.run(['config','gc.auto','1']);await f.run(['config','maintenance.auto','true']);await f.run(['config','receive.autogc','true']);
 const target=await f.client.observeSourceBranchTarget({targetId:'housekeeping',path:f.source,destinationRef:'refs/heads/reviewed'},f.target.environment),input={...f.input,target};
 const receipt=await f.client.spawnPreparedSourceBranchCreate(await f.client.prepareSourceBranchCreate(input,new AbortController().signal));assert.equal(receipt.outcome,'created',JSON.stringify(receipt));
 const events=(await fs.readFile(path.join(f.root,'native-trace.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)),receivers=new Set(events.filter(e=>e.event==='cmd_name'&&e.name==='receive-pack').map(e=>e.sid));
 assert.ok(receivers.size>0,'actual native receive-pack child observed');
 for(const sid of receivers){const start=events.find(e=>e.sid===sid&&e.event==='start');assert.deepEqual(start.argv.slice(1,8),['-c','gc.auto=0','-c','maintenance.auto=false','-c','receive.autogc=false','receive-pack']);const values=new Map(events.filter(e=>e.sid===sid&&e.event==='def_param').map(e=>[e.param,e.value]));assert.equal(values.get('gc.auto'),'0');assert.equal(values.get('maintenance.auto'),'false');assert.equal(values.get('receive.autogc'),'false');}
 assert.equal(events.some(e=>e.event==='child_start'&&e.argv?.some(a=>a==='gc'||a==='maintenance')),false,'no GC/maintenance descendant birth');assert.equal(receipt.command.cleanup,'confirmed');
});


test('a configured remote alias matching the literal source path refuses before any redirected helper birth',async t=>{
 const f=await fixture(t);await f.run(['config','--global',`remote.${f.source}.url`,'ext::false']);
 await assert.rejects(f.client.observeSourceBranchTarget({targetId:'redirect',path:f.source,destinationRef:'refs/heads/redirect'},f.target.environment),/policy/);
 await assert.rejects(f.run(['rev-parse','refs/heads/redirect']));
});


test('observed configuration ancestor may be group-writable, with mode/replacement/world-write drift held',async t=>{
 const f=await fixture(t),xdg=path.join(f.root,'selected-xdg'),ancestor=path.join(xdg,'git');await fs.mkdir(xdg,{mode:0o700});await fs.mkdir(ancestor,{mode:0o775});await fs.chmod(ancestor,0o775);
 const environment=captureSourceGitEnvironment({HOME:f.home,XDG_CONFIG_HOME:xdg});
 const target=await f.client.observeSourceBranchTarget({targetId:'ancestor',path:f.source,destinationRef:'refs/heads/reviewed'},environment);
 const observed=target.identity.find(row=>row.path===ancestor);assert.equal(observed?.configurationAncestor,true);assert.equal(observed.mode&0o777,0o775);
 const prepared=await f.client.prepareSourceBranchCreate({...f.input,target},new AbortController().signal);await fs.chmod(ancestor,0o755);assert.equal((await f.client.spawnPreparedSourceBranchCreate(prepared)).handoff,'not-started');
 await fs.chmod(ancestor,0o775);const fresh=await f.client.observeSourceBranchTarget({targetId:'ancestor',path:f.source,destinationRef:'refs/heads/reviewed'},environment),next=await f.client.prepareSourceBranchCreate({...f.input,target:fresh},new AbortController().signal);
 await fs.rename(ancestor,ancestor+'-original');await fs.mkdir(ancestor,{mode:0o775});await fs.chmod(ancestor,0o775);assert.equal((await f.client.spawnPreparedSourceBranchCreate(next)).handoff,'not-started');
 await fs.chmod(ancestor,0o777);await assert.rejects(f.client.observeSourceBranchTarget({targetId:'world',path:f.source,destinationRef:'refs/heads/world'},environment),/permissions/);
});


test('fixed receive command quotes spaces and apostrophes in the canonical selected executable',async t=>{
 const f=await fixture(t,{binaryName:"selected git's executable",wrapper:(root,binary)=>`#!/bin/sh
exec '${binary}' "$@"
`});
 const before=await f.state(),receipt=await f.client.spawnPreparedSourceBranchCreate(await f.client.prepareSourceBranchCreate(f.input,new AbortController().signal));
 assert.equal(receipt.outcome,'created',JSON.stringify(receipt));assert.equal((await f.client.reconcileSourceBranchCreate(f.input,receipt)).kind,'confirmed-creation');assert.deepEqual(await f.state(),before);
 assert.ok(receipt.command.argv.some(arg=>arg.startsWith('--receive-pack=')&&arg.includes("'\\''")));
});

test('invalid literal branch operands refuse before any source-native observation',async t=>{
 const f=await fixture(t),sourceCommands=async()=>{const rows=[];for(const id of await fs.readdir(path.join(f.clientRoot,'runs'))){const d=JSON.parse(await fs.readFile(path.join(f.clientRoot,'runs',id,'descriptor.json'),'utf8'));if(d.sourceDiagnostics)rows.push(id);}return rows.sort();},before=await sourceCommands();
 for(const destinationRef of ['--help','refs/tags/unowned','refs/heads/'+'x'.repeat(1024),'refs/heads/line\nbreak'])await assert.rejects(f.client.observeSourceBranchTarget({targetId:'invalid',path:f.source,destinationRef},f.target.environment),/bounded literal/);
 assert.deepEqual(await sourceCommands(),before);
});

test('detached normal root saves the immutable reviewed snapshot without changing HEAD/index/worktree',async t=>{
 const f=await fixture(t);await f.run(['checkout','--detach','HEAD']);const before=await f.state(),target=await f.client.observeSourceBranchTarget({targetId:'detached',path:f.source,destinationRef:'refs/heads/reviewed'},f.target.environment);assert.equal(target.observedHeadRef,null);
 const input={...f.input,target},receipt=await f.client.spawnPreparedSourceBranchCreate(await f.client.prepareSourceBranchCreate(input,new AbortController().signal));assert.equal(receipt.outcome,'created',JSON.stringify(receipt));assert.equal((await f.client.reconcileSourceBranchCreate(input,receipt)).kind,'confirmed-creation');assert.deepEqual(await f.state(),before);await assert.rejects(f.run(['symbolic-ref','--quiet','HEAD']));
});
