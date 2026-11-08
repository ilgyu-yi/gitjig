import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {openNativeGit, assertInitializedNativeGitProof, assertSourceBranchNoLaunch, assertSourceBranchPrepared, reconcileOwnedGitProcesses} from '../../dist/effects/native-git.js';
import {createHash} from 'node:crypto';
import {freeze} from '../../dist/controller/change-files.js';

const exec = promisify(execFile), git = '/opt/homebrew/bin/git';
async function fixture(t, format = 'sha1', source = false) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-initialized-resume-')));
    const profile = {gitBinary: git, ownedClientRoot: path.join(root, 'client'), objectFormat: format};
    let current = true, client;
    const assertCurrent = () => { if (!current) throw Error('Original host source changed'); };
    client = await openNativeGit(profile, undefined, {exclusiveRoot: true, beforeFirstCommand() {}, assertCurrent});
    const proof = client.initializedProof();
    await fs.writeFile(path.join(root,'initialized-proof.json'),JSON.stringify(proof),{mode:0o600});
    const rows = async () => fs.readdir(path.join(profile.ownedClientRoot, 'runs'));
    const reopen = async (options = {}) => {
        await client.close();
        client = await openNativeGit({...profile, resumeOwned: true}, options.signal,
            {kind: 'initialized-resume/v1', initialized: proof, assertCurrent: options.assertCurrent ?? assertCurrent});
        return client;
    };
    t.after(async () => {
        await client.close();
        const cleanup = await reconcileOwnedGitProcesses(profile.ownedClientRoot, 0, proof.namespace);
        assert.equal(cleanup.cleanup, 'confirmed', JSON.stringify(cleanup));
        for (const id of await rows()) {
            const directory = path.join(profile.ownedClientRoot, 'runs', id);
            if (!fsSync.existsSync(path.join(directory, 'result.json'))) continue;
            const result = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
            for (const pid of [result.identity.pid, ...(result.gitPid ? [result.gitPid, -result.gitPid] : [])])
                assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
        }
        t.diagnostic(JSON.stringify({fixture: root, clientRoot: profile.ownedClientRoot, format, commands: await rows()}));
    });
    const f = {root, profile, proof, rows, reopen, assertCurrent,
        get client() { return client; }, stale() { current = false; }};
    if (!source) return f;
    const operator = path.join(root, 'operator'), repository = path.join(root, 'source');
    await fs.mkdir(operator, {mode: 0o700}); await fs.mkdir(repository, {mode: 0o700});
    const env = {HOME: operator, PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
        GIT_AUTHOR_NAME: 'Owned fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Owned fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'};
    const setup = async args => (await exec(git, args, {cwd: repository, env, timeout: 5000})).stdout.trim();
    await setup(['init', '--template=', '--initial-branch=main', `--object-format=${format}`]);
    await fs.writeFile(path.join(repository, 'code.txt'), 'base\n');
    await setup(['add', 'code.txt']); await setup(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Owned base']);
    const basis = await setup(['rev-parse', 'HEAD']);
    const target = await client.observeSourceBranchTarget({targetId: 'owned-source', path: repository, destinationRef: 'refs/heads/reviewed'}, {home: operator});
    await client.fetchSourceBasis(target, basis);
    const capture = async (name, body) => {
        const live = path.join(root, name), captured = live + '-frozen';
        await fs.mkdir(live, {mode: 0o700}); await fs.writeFile(path.join(live, 'code.txt'), body);
        return {versionId: name, root: captured, ...await freeze(live, captured, {})};
    };
    const projected = await client.project({operationId: 'original-source-operation', base: await capture('base', 'base\n'),
        candidate: await capture('candidate', 'reviewed\n'), basisCommit: basis, authorizedDeltaPaths: ['code.txt'], publicationInventory: ['code.txt']});
    assert.equal(projected.kind, 'projected', JSON.stringify(projected));
    f.input = {operationId: 'original-source-operation', target, integrationCommit: projected.receipt.projectedCommit,
        expectedSnapshot: {tree: projected.receipt.projectedTree, basisCommit: basis}};
    f.setup = setup;
    return f;
}

for (const format of ['sha1', 'sha256']) test(format + ' original initialized proof resumes exact custody and requires exact H/tree/sole K parent', {timeout: 30000}, async t => {
    const f = await fixture(t, format, true), marker = await fs.readFile(path.join(f.profile.ownedClientRoot, 'native-owner.json'));
    await f.reopen();
    assert.deepEqual(f.client.initializedProof(), f.proof);
    assert.deepEqual(await fs.readFile(path.join(f.profile.ownedClientRoot, 'native-owner.json')), marker);
    await assert.rejects(f.client.prepareSourceBranchCreate({...f.input, expectedSnapshot: undefined}, new AbortController().signal), /tree\/basis required/);
    await assert.rejects(f.client.prepareSourceBranchCreate({...f.input, expectedSnapshot: {...f.input.expectedSnapshot, tree: f.input.integrationCommit}}, new AbortController().signal), /correspondence differs/);
    await assert.rejects(f.client.prepareSourceBranchCreate({...f.input, expectedSnapshot: {...f.input.expectedSnapshot, basisCommit: f.input.integrationCommit}}, new AbortController().signal), /correspondence differs/);
    const abort = new AbortController(), prepared = await f.client.prepareSourceBranchCreate(f.input, abort.signal);
    const reference=f.client.preparedSourceReference(prepared),descriptorFile=path.join(f.profile.ownedClientRoot,'runs',reference.commandId,'descriptor.json');
    assert.equal(Object.isFrozen(reference),true);assert.equal(reference.descriptorSha256,createHash('sha256').update(await fs.readFile(descriptorFile)).digest('hex'));
    assertSourceBranchPrepared(f.proof,f.input,reference);assert.throws(()=>f.client.preparedSourceReference({...prepared}),/unused initialized/);
    assert.throws(()=>assertSourceBranchPrepared(f.proof,{...f.input,expectedSnapshot:{...f.input.expectedSnapshot,tree:f.input.integrationCommit}},reference),/reference differs/);
    assert.throws(()=>assertSourceBranchPrepared(f.proof,{...f.input,expectedSnapshot:{...f.input.expectedSnapshot,basisCommit:f.input.integrationCommit}},reference),/reference differs/);
    await fs.writeFile(path.join(f.root,'prepared-aborted.json'),JSON.stringify({input:f.input,reference}),{mode:0o600});
    abort.abort();
    const receipt = await f.client.spawnPreparedSourceBranchCreate(prepared);
    assert.equal(receipt.handoff, 'not-started'); assert.ok(receipt.notStarted);
    assert.equal(receipt.notStarted.commandId,reference.commandId);assert.equal(receipt.notStarted.descriptorSha256,reference.descriptorSha256);assertSourceBranchPrepared(f.proof,f.input,reference);
    assert.throws(()=>f.client.preparedSourceReference(prepared),/unused initialized/);
    assertSourceBranchNoLaunch(f.proof, f.input, receipt.notStarted);
    assert.throws(() => assertSourceBranchNoLaunch(f.proof, {...f.input, operationId: 'foreign'}, receipt.notStarted), /correspondence/);
    assert.throws(() => assertSourceBranchNoLaunch(f.proof, f.input, {...receipt.notStarted, terminalSha256: '0'.repeat(64)}), /reference differs/);
    assert.equal((await f.client.spawnPreparedSourceBranchCreate(prepared)).notStarted, undefined);
    // A current policy hold cannot erase the original durable no-send observation.
    await f.setup(['config', '--global', 'receive.denyDeletes', 'true']);
    assertSourceBranchNoLaunch(f.proof, f.input, receipt.notStarted);
    await f.setup(['config', '--global', '--unset', 'receive.denyDeletes']);
    // Restore this initially absent, disposable operator file before a separate valid action.
    await fs.unlink(path.join(f.input.target.environment.home, '.gitconfig'));
    const finalPrepared=await f.client.prepareSourceBranchCreate(f.input,new AbortController().signal),finalReference=f.client.preparedSourceReference(finalPrepared);
    await fs.writeFile(path.join(f.root,'prepared-created.json'),JSON.stringify({input:f.input,reference:finalReference}),{mode:0o600});
    const send = await f.client.spawnPreparedSourceBranchCreate(finalPrepared);
    assert.equal(send.outcome, 'created', JSON.stringify(send));
    assert.equal(send.command.commandId,finalReference.commandId);assertSourceBranchPrepared(f.proof,f.input,finalReference);assert.throws(()=>f.client.preparedSourceReference(finalPrepared),/unused initialized/);
    assert.equal((await f.client.reconcileSourceBranchCreate(f.input, send)).kind, 'confirmed-creation');
    assert.equal((await f.client.reconcileSourceBranchCreate(f.input, finalReference)).kind,'confirmed-creation');
    await f.reopen();assert.equal((await f.client.reconcileSourceBranchCreate(f.input,finalReference)).kind,'confirmed-creation','a new client reconstructs original evidence without the old handle or live receipt');
    const directory=path.join(f.profile.ownedClientRoot,'runs',finalReference.commandId),ackFile=path.join(directory,'parent-closed.json'),ack=await fs.readFile(ackFile);
    await fs.unlink(ackFile);
    try{assert.equal((await f.client.reconcileSourceBranchCreate(f.input,finalReference)).kind,'confirmed-creation','a missing parent reply is recovered only from the complete original journal chain');}finally{await fs.writeFile(ackFile,ack,{mode:0o600});}
    const originals=new Map(await Promise.all(['parent-closed.json','git-start.json','result.json','terminal.json','stdout.bin'].map(async name=>[name,await fs.readFile(path.join(directory,name))])));
    for(const fault of ['ack','git-pid','start-identity','truthy-flag','equal-output','extra-column','missing-terminal']){
     const update=async(name,change)=>{const value=JSON.parse(originals.get(name));change(value);await fs.writeFile(path.join(directory,name),JSON.stringify(value));};
     try{
      if(fault==='ack')await update('parent-closed.json',v=>{v.resultHash='0'.repeat(64);});
      else if(fault==='git-pid')await update('git-start.json',v=>{v.gitPid++;});
      else if(fault==='start-identity')await update('terminal.json',v=>{v.startIdentity+=' foreign';});
      else if(fault==='truthy-flag'){await update('result.json',v=>{v.settled='yes';});const raw=await fs.readFile(path.join(directory,'result.json'));await update('parent-closed.json',v=>{v.resultHash=createHash('sha256').update(raw).digest('hex');});}
      else if(fault==='missing-terminal')await fs.unlink(path.join(directory,'terminal.json'));
      else{const output=originals.get('stdout.bin').toString(),changed=Buffer.from(fault==='equal-output'?output.replace('*\t','=\t'):output.replace('[new branch]\n','[new branch]\textra\n'));assert.notEqual(changed.toString(),output);await fs.writeFile(path.join(directory,'stdout.bin'),changed);await update('result.json',v=>{v.stdout=changed.toString();v.stdoutBytes=changed.length;v.stdoutSha256=createHash('sha256').update(changed).digest('hex');});const raw=await fs.readFile(path.join(directory,'result.json'));await update('parent-closed.json',v=>{v.resultHash=createHash('sha256').update(raw).digest('hex');});}
      assert.equal((await f.client.reconcileSourceBranchCreate(f.input,finalReference)).kind,'observed-desired-state',fault+' cannot prove original creation from H alone');
     }finally{for(const [name,bytes]of originals)await fs.writeFile(path.join(directory,name),bytes,{mode:0o600});}
    }
    await f.setup(['update-ref',f.input.target.destinationRef,f.input.expectedSnapshot.basisCommit]);
    try{assert.equal((await f.client.reconcileSourceBranchCreate(f.input,finalReference)).kind,'unknown','original creation does not imply the current ref still names H');}finally{await f.setup(['update-ref',f.input.target.destinationRef,f.input.integrationCommit]);}
    assert.throws(() => assertSourceBranchNoLaunch(f.proof, f.input, {...receipt.notStarted, commandId: send.command.commandId}));
});

test('final host callback cannot replace or mutate an initialized prepared send descriptor before native birth',{timeout:60000},async t=>{
 for(const fault of ['bytes','identical-copy','fifo','symlink','directory']){
  const f=await fixture(t,'sha1',true);let armed=false,changed=false,file,original,retained,commandDir;
  await f.reopen({assertCurrent(){
   if(!armed||changed)return;changed=true;
   if(fault==='bytes')fsSync.writeFileSync(file,Buffer.alloc(original.length,120));
   else if(fault==='directory'){retained=commandDir+'-original';fsSync.renameSync(commandDir,retained);fsSync.mkdirSync(commandDir,{mode:0o700});fsSync.writeFileSync(path.join(commandDir,'foreign'),'preserve');}
   else{retained=file+'-original';fsSync.renameSync(file,retained);if(fault==='identical-copy')fsSync.writeFileSync(file,original,{mode:0o600});else if(fault==='symlink')fsSync.symlinkSync(retained,file);else assert.equal(spawnSync('/usr/bin/mkfifo',['-m','600',file]).status,0);}
  }});
  const prepared=await f.client.prepareSourceBranchCreate(f.input,new AbortController().signal),reference=f.client.preparedSourceReference(prepared);
  commandDir=path.join(f.profile.ownedClientRoot,'runs',reference.commandId);file=path.join(commandDir,'descriptor.json');original=await fs.readFile(file);
  await fs.writeFile(path.join(f.root,'prepared-fault-'+fault+'.json'),JSON.stringify({input:f.input,reference,fault}),{mode:0o600});
  armed=true;
  try{
   if(fault==='directory')await assert.rejects(async()=>f.client.spawnPreparedSourceBranchCreate(prepared),/directory changed/);
   else{const result=await f.client.spawnPreparedSourceBranchCreate(prepared);assert.equal(result.handoff,'not-started');assert.equal(result.notStarted,undefined);assert.equal(result.command,undefined);}
   assert.equal(changed,true);assert.throws(()=>assertSourceBranchPrepared(f.proof,f.input,reference));
   assert.equal(fsSync.existsSync(path.join(commandDir,'lifecycle.json')),false);assert.equal(fsSync.existsSync(path.join(commandDir,'result.json')),false);
   if(fault==='directory'){assert.deepEqual(await fs.readdir(commandDir),['foreign']);assert.equal(await fs.readFile(path.join(commandDir,'foreign'),'utf8'),'preserve');}
   assert.deepEqual((await f.setup(['for-each-ref','--format=%(refname)','refs/heads'])).split('\n'),['refs/heads/main']);
  }finally{
   armed=false;
   if(fault==='bytes')await fs.writeFile(file,original);
   else if(fault==='directory'){await fs.rename(commandDir,path.join(f.root,'foreign-command-preserved'));await fs.rename(retained,commandDir);}
   else{await fs.unlink(file);await fs.rename(retained,file);}
  }
 }
});

test('reference getter cannot return an unused fact after its host guard consumes the actual handle',{timeout:30000},async t=>{
 const f=await fixture(t,'sha1',true);let armed=false,prepared,send;
 await f.reopen({assertCurrent(){if(armed){armed=false;send=f.client.spawnPreparedSourceBranchCreate(prepared);}}});
 prepared=await f.client.prepareSourceBranchCreate(f.input,new AbortController().signal);const reference=f.client.preparedSourceReference(prepared);
 await fs.writeFile(path.join(f.root,'prepared-reentrant-created.json'),JSON.stringify({input:f.input,reference}),{mode:0o600});
 armed=true;assert.throws(()=>f.client.preparedSourceReference(prepared),/unused.*after host guard/);
 const result=await send;assert.equal(result.outcome,'created',JSON.stringify(result));assert.equal(result.command.commandId,reference.commandId);
 assertSourceBranchPrepared(f.proof,f.input,reference);assert.equal((await f.client.reconcileSourceBranchCreate(f.input,result)).kind,'confirmed-creation');
});

test('original initialized proof refuses changed marker/control/support and replacement repository before any new native admission', {timeout: 30000}, async t => {
    for (const mode of ['marker', 'config', 'support', 'repository']) {
        const f = await fixture(t), before = await f.rows(); await f.client.close();
        const root = f.profile.ownedClientRoot;
        if (mode === 'marker') {
            const file = path.join(root, 'native-owner.json'), data = JSON.parse(await fs.readFile(file, 'utf8'));
            data.metadataDate = '2020-01-01T00:00:00.000Z'; await fs.writeFile(file, JSON.stringify(data));
        } else if (mode === 'config') await fs.appendFile(path.join(root, 'client.git/config'), '\n# retained mutation\n');
        else if (mode === 'support') await fs.writeFile(path.join(root, 'home', 'foreign'), 'not original');
        else {
            const saved = path.join(f.root, 'original-repository'), replacement = path.join(root, 'client.git');
            await fs.rename(replacement, saved); await fs.cp(saved, replacement, {recursive: true});
            const stat = await fs.stat(replacement), file = path.join(root, 'native-owner.json');
            const marker = JSON.parse(await fs.readFile(file, 'utf8'));
            marker.repoDevice = String(stat.dev); marker.repoInode = String(stat.ino);
            await fs.writeFile(file, JSON.stringify(marker));
        }
        await assert.rejects(openNativeGit({...f.profile, resumeOwned: true}, undefined, {kind: 'initialized-resume/v1', initialized: f.proof, assertCurrent() {}}));
        assert.deepEqual(await f.rows(), before);
    }
});

test('resume captures proof/profile/callback before await and rejects async, stale and reentrant-close guards without native birth', {timeout: 30000}, async t => {
    const f = await fixture(t, 'sha1', true); await f.client.close();
    const request = {...f.profile, resumeOwned: true}, proof = structuredClone(f.proof);
    const lifecycle = {kind: 'initialized-resume/v1', initialized: proof, assertCurrent() {}};
    const pending = openNativeGit(request, undefined, lifecycle);
    request.ownedClientRoot = path.join(f.root, 'foreign'); proof.owner.metadataDate = '2020-01-01T00:00:00.000Z';
    lifecycle.assertCurrent = () => { throw Error('mutated callback must not replace capture'); };
    const actual = await pending; await actual.close();
    for (const assertCurrent of [async () => { throw Error('async refusal'); }, () => { throw Error('stale refusal'); }]) {
        const before = await f.rows();
        await assert.rejects(openNativeGit({...f.profile, resumeOwned: true}, undefined,
            {kind: 'initialized-resume/v1', initialized: f.proof, assertCurrent}), /synchronously|stale refusal/);
        assert.deepEqual(await f.rows(), before);
    }
    await f.reopen(); let closed;
    const staleClient = f.client;
    // Mutable closure state is intentionally live; the callback object itself is captured.
    await staleClient.close();
    let active;
    active = await openNativeGit({...f.profile, resumeOwned: true}, undefined,
        {kind: 'initialized-resume/v1', initialized: f.proof, assertCurrent() { if (active) closed = active.close(); }});
    const before = await f.rows();
    await assert.rejects(active.prepareSourceBranchCreate(f.input, new AbortController().signal), /closed/);
    await closed; await active.close(); assert.deepEqual(await f.rows(), before);
});

test('paused initialized resume rechecks original controls and host after descriptor fsync, before every native launcher', {timeout: 30000}, async t => {
    for (const mode of ['host', 'repository', 'marker', 'config']) {
        const f = await fixture(t), before = await f.rows(); await f.client.close();
        const original = fs.open; let release, entered;
        const gate = new Promise(resolve => { release = resolve; });
        const ready = new Promise(resolve => { entered = resolve; });
        let paused = false;
        fs.open = async (...args) => {
            const handle = await original(...args);
            if (!paused && args[0] === f.proof.namespace.runsDirectory) {
                paused = true;
                return new Proxy(handle, {get(target, key) {
                    if (key === 'sync') return async () => { await target.sync(); entered(); await gate; };
                    const value = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                }});
            }
            return handle;
        };
        const pending = f.reopen();
        try {
            await Promise.race([ready, pending.then(() => { throw Error('resume completed before actual gate'); }, error => { throw error; }),
                new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('finite descriptor gate timeout')), 5000); timer.unref(); })]);
            if (mode === 'host') f.stale();
            else if (mode === 'repository') {
                await fs.rename(path.join(f.profile.ownedClientRoot, 'client.git'), path.join(f.root, 'original-client.git'));
                await fs.mkdir(path.join(f.profile.ownedClientRoot, 'client.git'), {mode: 0o700});
            } else await fs.appendFile(path.join(f.profile.ownedClientRoot, mode === 'marker' ? 'native-owner.json' : 'client.git/config'), '\n');
            release(); await assert.rejects(pending);
            const added = (await f.rows()).filter(id => !before.includes(id));
            assert.equal(added.length, 1);
            const directory = path.join(f.proof.namespace.runsDirectory, added[0]);
            assert.equal(fsSync.existsSync(path.join(directory, 'lifecycle.json')), false);
            assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'terminal.json'), 'utf8')).producer, 'controller-no-launch');
        } finally { release(); fs.open = original; await pending.catch(() => {}); }
    }
});

test('legacy two-argument clients cannot mint original gated custody; fresh third mode still refuses resume', async t => {
    const f = await fixture(t); await f.client.close();
    const legacy = await openNativeGit({...f.profile, resumeOwned: true});
    assert.throws(() => legacy.initializedProof(), /unavailable/); await legacy.close();
    await assert.rejects(openNativeGit({...f.profile, resumeOwned: true}, undefined,
        {exclusiveRoot: true, beforeFirstCommand() {}, assertCurrent() {}}), /Fresh trusted/);
    await assert.rejects(openNativeGit(f.profile, undefined,
        {kind: 'initialized-resume/v1', initialized: f.proof, assertCurrent() {}}), /Exact initialized/);
    const before = await f.rows();
    for (const malformed of [null, false, 0])
        await assert.rejects(openNativeGit({...f.profile, resumeOwned: true}, undefined, malformed), /Malformed present/);
    assert.deepEqual(await f.rows(), before);
    assertInitializedNativeGitProof(f.proof, {clientRoot: f.profile.ownedClientRoot, gitBinary: f.proof.owner.gitBinary, objectFormat: 'sha1'});
});
