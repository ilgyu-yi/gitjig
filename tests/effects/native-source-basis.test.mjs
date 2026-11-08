import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {Store} from '../../dist/controller/store.js';
import {SourceBranchPreviews} from '../../dist/controller/source-branch-previews.js';
import {SourceBranchPreviewRuntime} from '../../dist/controller/source-branch-preview-runtime.js';
import {freeze} from '../../dist/controller/change-files.js';
import {resolveCapturedGitBasis} from '../../dist/controller/source-save-basis.js';
import {acquireOwner} from '../../dist/controller/ownership.js';
import {reconcileOwnedGitProcesses} from '../../dist/effects/native-git.js';
const git='/opt/homebrew/bin/git';
async function fixture(t,format){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-native-source-basis-'))),home=path.join(root,'app'),source=path.join(root,'source'),operator=path.join(root,'operator');for(const name of [home,source,operator])await fs.mkdir(name,{mode:0o700});await fs.mkdir(path.join(home,'state'),{mode:0o700});
 const env={HOME:operator,PATH:'/opt/homebrew/bin:/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Owned fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Owned fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 // Setup/oracle commands are disposable fixture work, NOT product-owned native receipts.
 const fixtureGit=(args,input)=>new Promise((resolve,reject)=>{const child=spawn(git,['-c','gc.auto=0','-c','maintenance.auto=false',...args],{cwd:source,env,stdio:['pipe','pipe','pipe']});const out=[],err=[];const timer=setTimeout(()=>child.kill('SIGTERM'),5000);child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(out)):reject(Error(Buffer.concat(err).toString()));});child.stdin.end(input);});
 await fixtureGit(['init','--template=','--initial-branch=main',`--object-format=${format}`]);await fs.writeFile(path.join(source,'text.txt'),'original\n');await fs.writeFile(path.join(source,'binary.bin'),Buffer.from([0,255,1,10]));await fs.symlink('text.txt',path.join(source,'link'));await fixtureGit(['add','text.txt','binary.bin','link']);await fixtureGit(['-c','commit.gpgsign=false','commit','-m','Owned basis']);
 const original=(await fixtureGit(['rev-parse','HEAD'])).toString().trim(),empty=(await fixtureGit(['mktree'],Buffer.alloc(0))).toString().trim(),rows=await fixtureGit(['ls-tree','-z',original]),tree=(await fixtureGit(['mktree','-z'],Buffer.concat([rows,Buffer.from(`040000 tree ${empty}\tempty-directory\0`)]))).toString().trim(),basis=(await fixtureGit(['commit-tree',tree,'-p',original],Buffer.from('Owned pinned empty-subtree basis\n'))).toString().trim();await fixtureGit(['update-ref','refs/heads/main',basis]);
 const emptyCommit=(await fixtureGit(['commit-tree',empty,'-p',basis],Buffer.from('Owned empty tree basis\n'))).toString().trim();await fixtureGit(['update-ref','refs/heads/empty-fixture',emptyCommit]);
 // K deliberately retains the tracked symlink for native metadata coverage.
 // Remove only its live worktree leaf before the real full capture: ordinary
 // source symlinks are outside capture's supported profile. This controlled
 // dirty deletion qualifies captured metadata -> pinned K, not governed fit.
 await fs.unlink(path.join(source,'link'));
 const captured=await freeze(source,path.join(root,'captured-base'),{}),capturedBase={kind:'base',versionId:'original-base',root:path.join(root,'captured-base'),...captured};
 await fs.writeFile(path.join(source,'later.txt'),'later current main\n');await fixtureGit(['add','later.txt']);await fixtureGit(['-c','commit.gpgsign=false','commit','-m','Later main']);const later=(await fixtureGit(['rev-parse','HEAD'])).toString().trim();assert.notEqual(later,basis);
 const capturedBasis=await resolveCapturedGitBasis(capturedBase);assert.equal(capturedBasis.commit,basis);assert.equal(capturedBasis.objectFormat,format);
 const lease=await acquireOwner(path.join(home,'state')),store=new Store(path.join(home,'state/controller.sqlite'));store.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)','P',source,'{}');store.run('INSERT INTO sources VALUES(?,?,?,?)','owner',null,'{"kind":"controlled-source-basis-fixture"}','Original source request');store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W','P','owner',null,'W','DELIVERED',1,1,null,'{}');for(const kind of ['execution','resolution'])store.run('INSERT INTO budgets VALUES(?,?,?,?,?)','W',kind,0,0,0);
 const registry=new SourceBranchPreviews(store,home),runtime=new SourceBranchPreviewRuntime(store,home,lease);t.after(async()=>{await runtime.close();store.close();await lease();});await runtime.recover();
 const ledger=()=>JSON.stringify(['works','runs','budgets','effect_targets','effect_delegations','effect_operations'].map(table=>[table,store.all(`SELECT * FROM ${table} ORDER BY rowid`)]));
 return{root,home,source,operator,registry,runtime,store,basis,tree,emptyCommit,empty,later,format,capturedBasis,fixtureGit,ledger};
}
for(const format of ['sha1','sha256'])test('owned '+format+' pinned source metadata observes binary/leaves/empty trees without live HEAD retargeting',{timeout:30000},async t=>{
 const f=await fixture(t,format),before=f.ledger();const result=await f.runtime.run({workId:'W',sourceId:'owner',epoch:1,generation:1,inputDigest:'b'.repeat(64),profile:{gitBinary:git,objectFormat:f.capturedBasis.objectFormat},validate(){}},async tools=>{
  assert.equal(Object.hasOwn(tools,'spawnPreparedSourceBranchCreate'),false);assert.equal(Object.hasOwn(tools,'materializeVerifiedTree'),false);
  const target=await tools.observeSourceBranchTarget({targetId:'factual-owned',path:f.source,destinationRef:'refs/heads/factual-preview'},{home:f.operator});assert.equal(target.observedHead,f.later);
  const basis=await tools.inspectSourceBasis(target,f.capturedBasis.commit),empty=await tools.inspectSourceBasis(target,f.emptyCommit);assert.equal(basis.basisCommit,f.basis);assert.equal(basis.tree,f.tree);assert.equal(basis.objectFormat,format);assert.deepEqual(basis.entries.map(e=>e.path).sort(),['binary.bin','link','text.txt']);assert.equal(basis.entries.find(e=>e.path==='binary.bin').size,4);assert.equal(basis.entries.find(e=>e.path==='binary.bin').type,'blob');assert.equal(basis.entries.find(e=>e.path==='link').mode,'120000');assert.equal(basis.entries.find(e=>e.path==='link').size,8);assert.ok(basis.entries.every(e=>e.objectId.length===(format==='sha1'?40:64)));assert.deepEqual(empty.entries,[]);assert.equal(empty.tree,f.empty);
  const active=f.registry.active().previews.find(row=>row.work==='W'),beforeBad=await fs.readdir(active.root.runsDirectory);await assert.rejects(tools.inspectSourceBasis(target,'--help'),/identity/);assert.deepEqual(await fs.readdir(active.root.runsDirectory),beforeBad);
  return{basis,empty};
 });
 assert.equal(f.ledger(),before);const owned=f.registry.inspect(result.previewId),{admissionSourceId,...proof}=owned.root;assert.equal(owned.state,'SETTLED');assert.equal((await reconcileOwnedGitProcesses(proof.clientRoot,0,proof)).cleanup,'confirmed');const commandIds=await fs.readdir(proof.runsDirectory);let metadataQueries=0;
 for(const id of commandIds){const directory=path.join(proof.runsDirectory,id),descriptor=JSON.parse(await fs.readFile(path.join(directory,'descriptor.json'),'utf8')),terminal=JSON.parse(await fs.readFile(path.join(directory,'terminal.json'),'utf8'));assert.equal(terminal.cleanup,'confirmed');assert.equal(descriptor.argv.includes('push'),false);assert.equal(descriptor.argv.some((a,i)=>a==='cat-file'&&descriptor.argv[i+1]==='blob'),false,'roster cannot read every blob body');if(descriptor.argv.includes('ls-tree'))metadataQueries++;if(terminal.producer==='controller-no-launch'){assert.equal(terminal.gitStarted,false);}else{const outcome=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8')),lifecycle=JSON.parse(await fs.readFile(path.join(directory,'lifecycle.json'),'utf8'));assert.equal(outcome.identity.pid,lifecycle.pid);assert.equal(terminal.pid,lifecycle.pid);assert.equal(outcome.cleanup,'confirmed');for(const pid of [lifecycle.pid,...(outcome.gitPid?[outcome.gitPid,-outcome.gitPid]:[])])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});}}
 assert.equal(metadataQueries,2);assert.equal((await f.fixtureGit(['rev-parse','HEAD'])).toString().trim(),f.later);assert.equal(await f.fixtureGit(['show-ref','--verify','--quiet','refs/heads/factual-preview']).then(()=>true,()=>false),false);
 t.diagnostic(JSON.stringify({fixtureRoot:f.root,applicationHome:f.home,previewId:result.previewId,clientRoot:proof.clientRoot,commandIds,basis:f.basis,tree:f.tree,emptyTree:f.empty,leafRosterOnly:true,capturedCommit:f.capturedBasis.commit,capturedFormat:f.capturedBasis.objectFormat,controlledWorktreeDeletion:'link; pinned K and later HEAD retain the tracked Git entry',scope:'Captured metadata to owned native K observation; no governed standing claim',setupGitCommands:'owned fixture setup/oracles, not product receipts'}));
});
