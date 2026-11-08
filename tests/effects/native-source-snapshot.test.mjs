import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Store} from '../../dist/controller/store.js';
import {acquireOwner} from '../../dist/controller/ownership.js';
import {freeze} from '../../dist/controller/change-files.js';
import {SourceBranchPreviewRuntime} from '../../dist/controller/source-branch-preview-runtime.js';
import {SourceBranchPreviews} from '../../dist/controller/source-branch-previews.js';
import {reconcileOwnedGitProcesses} from '../../dist/effects/native-git.js';
const git='/opt/homebrew/bin/git';

async function fixture(t,{format='sha1',count=0,emptySubtree=false,emptyProduct=false,newFileCases=false,geometryConflict=null}={}) {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-snapshot-')));
    const home=path.join(root,'app space 한글'),source=path.join(root,'source'),operator=path.join(root,'operator');
    for(const directory of [home,source,operator])await fs.mkdir(directory,{mode:0o700});
    await fs.mkdir(path.join(home,'state'),{mode:0o700});
    const env={HOME:operator,PATH:'/opt/homebrew/bin:/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Owned fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Owned fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
    // Fixture setup/oracle commands are NOT product-owned process receipts.
    const setup=(args,input)=>new Promise((resolve,reject)=>{
        const child=spawn(git,['-c','gc.auto=0','-c','maintenance.auto=false',...args],{cwd:source,env,stdio:['pipe','pipe','pipe']});
        const out=[],errors=[];const timer=setTimeout(()=>child.kill('SIGTERM'),5000);
        child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>errors.push(b));
        child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(out)):reject(Error(Buffer.concat(errors).toString()));});child.stdin.end(input);
    });
    await setup(['init','--template=','--initial-branch=main',`--object-format=${format}`]);
    await fs.writeFile(path.join(source,'code.txt'),'base\n');
    await fs.writeFile(path.join(source,'picture.png'),Buffer.from([137,80,78,71,0,255]));
    await fs.writeFile(path.join(source,'opaque.dat'),Buffer.from([255,254,253]));
    await fs.writeFile(path.join(source,'script.sh'),'#!/bin/sh\nexit 0\n');await fs.chmod(path.join(source,'script.sh'),0o700);
    for(let i=0;i<count;i++) {
        const directory=path.join(source,'many',String(i%40),'nested');await fs.mkdir(directory,{recursive:true});
        await fs.writeFile(path.join(directory,'file-'+i+'.txt'),i%5===0?'repeated subset content\n':`unique source file ${i} with actual text\n`);
    }
    await setup(['add','.']);
    if(emptyProduct)await setup(['rm','--cached','-r','.']);
    await setup(['-c','commit.gpgsign=false','commit','--allow-empty','-m','Original tracked basis']);
    let basis=(await setup(['rev-parse','HEAD'])).toString().trim();
    if(emptySubtree) {
        const empty=(await setup(['mktree'],Buffer.alloc(0))).toString().trim();
        const rows=await setup(['ls-tree','-z',basis]);
        const tree=(await setup(['mktree','-z'],Buffer.concat([rows,Buffer.from(`040000 tree ${empty}\tempty-native-subtree\0`)]))).toString().trim();
        basis=(await setup(['commit-tree',tree,'-p',basis],Buffer.from('Original explicit empty subtree\n'))).toString().trim();
        await setup(['update-ref','refs/heads/main',basis]);
    }
    await fs.writeFile(path.join(source,'private.env'),'UNCHANGED PRIVATE CONTEXT\n');
    await fs.mkdir(path.join(source,'node_modules/pkg'),{recursive:true});await fs.writeFile(path.join(source,'node_modules/pkg/index.js'),'private dependency context\n');
    await fs.mkdir(path.join(source,'node_modules/.bin'),{recursive:true});await fs.symlink('../pkg/index.js',path.join(source,'node_modules/.bin/pkg'));
    if(newFileCases) {
        for(const name of ['existing-untracked.txt','deleted-untracked.txt','mode-untracked.txt','unchanged-untracked.txt'])
            await fs.writeFile(path.join(source,name),'preexisting whole file '+name+'\n');
        await fs.chmod(path.join(source,'mode-untracked.txt'),0o644);
        await fs.mkdir(path.join(source,'private-dir'));
        await fs.writeFile(path.join(source,'private-dir','old.txt'),'original private context\n');
    }
    if(geometryConflict) {
        const name=geometryConflict==='ancestor'?'code.txt':'many';
        await fs.rm(path.join(source,name),{recursive:true,force:true});
        if(geometryConflict==='ancestor'){
            await fs.mkdir(path.join(source,name));await fs.writeFile(path.join(source,name,'notes.txt'),'original untracked text\n');
        }else await fs.writeFile(path.join(source,name),'original untracked text\n');
    }
    const capture=async(side)=>{
        const artifact=path.join(root,side+'-'+randomUUID());return{versionId:side,root:artifact,...await freeze(source,artifact,{})};
    };
    const base=await capture('base');
    const lease=await acquireOwner(path.join(home,'state')),store=new Store(path.join(home,'state/controller.sqlite'));
    store.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)','P',source,'{}');
    store.run('INSERT INTO sources VALUES(?,?,?,?)','owner',null,'{"kind":"controlled-source-snapshot-fixture"}','Original scoped request');
    store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W','P','owner',null,'W','DELIVERED',1,1,null,'{}');
    for(const kind of ['execution','resolution'])store.run('INSERT INTO budgets VALUES(?,?,?,?,?)','W',kind,0,0,0);
    const runtime=new SourceBranchPreviewRuntime(store,home,lease),registry=new SourceBranchPreviews(store,home);
    t.after(async()=>{await runtime.close();store.close();await lease();});await runtime.recover();
    const ledger=()=>JSON.stringify(['works','runs','budgets','effect_targets','effect_delegations','effect_operations'].map(table=>[table,store.all(`SELECT * FROM ${table} ORDER BY rowid`)]));
    const run=async(candidate,allowed,options={})=>{
        const recipe={base,candidate,basisCommit:basis,authorizedDeltaPaths:allowed,
            // JS extra operands cannot override trusted facade injection.
            operationId:'foreign',previewId:'foreign',sourceInputDigest:'foreign'};
        const before=ledger(),fullStarted=performance.now();
        const result=await runtime.run({workId:'W',sourceId:'owner',epoch:1,generation:1,inputDigest:'b'.repeat(64),profile:{gitBinary:git,objectFormat:format},validate(){options.validate?.();},signal:options.signal},async tools=>{
            const target=await tools.observeSourceBranchTarget({targetId:'owned-preview',path:source,destinationRef:'refs/heads/never-published'},{home:operator});
            await tools.fetchSourceBasis(target,basis);
            return tools.projectSourceSnapshot(recipe);
        });
        const fullRunElapsedMs=performance.now()-fullStarted;
        const observed=registry.inspect(result.previewId);
        const sidecar=path.join(root,'source-snapshot-return-'+result.previewId+'.json');
        await fs.writeFile(sidecar,JSON.stringify({requested:recipe,actual:{previewId:result.previewId,inputDigest:observed.admission.inputDigest},returned:result,fullRunElapsedMs}),{flag:'wx',mode:0o600});
        t.diagnostic(JSON.stringify({sourceSnapshotSidecar:sidecar}));
        assert.equal(ledger(),before,'private proposal allocates no work, budget, target, grant or operation');
        const row=registry.inspect(result.previewId),{admissionSourceId,...proof}=row.root;
        assert.equal(row.state,'SETTLED');assert.equal((await reconcileOwnedGitProcesses(proof.clientRoot,0,proof)).cleanup,'confirmed');
        const commandIds=await fs.readdir(proof.runsDirectory);
        for(const id of commandIds){
            const directory=path.join(proof.runsDirectory,id),descriptor=JSON.parse(await fs.readFile(path.join(directory,'descriptor.json'),'utf8'));
            assert.equal(descriptor.argv.includes('push'),false);
            const terminal=JSON.parse(await fs.readFile(path.join(directory,'terminal.json'),'utf8'));
            if(terminal.producer==='controller-no-launch'){assert.equal(terminal.gitStarted,false);continue;}
            const outcome=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8'));
            assert.equal(outcome.cleanup,'confirmed');
            for(const pid of [outcome.identity.pid,...(outcome.gitPid?[outcome.gitPid,-outcome.gitPid]:[])])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
        }
        t.diagnostic(JSON.stringify({fixtureRoot:root,previewId:result.previewId,clientRoot:proof.clientRoot,commandIds,format,result:result.value.kind,fullRunElapsedMs,metrics:result.value.receipt?.metrics}));
        return{...result,commandIds,clientRoot:proof.clientRoot,fullRunElapsedMs,sidecar};
    };
    return{root,home,source,base,basis,capture,run,setup,ledger,runtime,registry,store};
}

for(const format of ['sha1','sha256'])test(format+' identity preserves checked private context, opaque tracked objects and exact owner exec; creates real marked H',{timeout:45000},async t=>{
    const f=await fixture(t,{format});
    await fs.writeFile(path.join(f.source,'code.txt'),'reviewed textual change 한글\n');
    await fs.writeFile(path.join(f.source,'.git','owned-administration'),'changed administration\n');
    const candidate=await f.capture('candidate'),result=await f.run(candidate,['code.txt']);
    assert.equal(result.value.kind,'projected',result.value.reason);
    const receipt=result.value.receipt;
    assert.equal(receipt.relation.kind,'identical');assert.equal(receipt.relation.candidateDigest,candidate.digest);
    assert.equal(receipt.previewId,result.previewId);assert.equal(receipt.operationId,'source-preview-'+result.previewId);
    assert.notEqual(receipt.projectedCommit,f.basis);
    assert.equal(receipt.blobs.find(b=>b.side==='candidate'&&b.path==='script.sh').effectiveMode,0o700);
    assert.ok(receipt.effectiveDifferences.some(d=>d.path==='private.env'));
    assert.ok(!receipt.projectedEntries.some(e=>e.path==='private.env'||e.path.startsWith('node_modules/')||e.path.startsWith('.git/')));
    const object=(await f.setup(['--git-dir='+path.join(result.clientRoot,'client.git'),'cat-file','commit',receipt.projectedCommit])).toString();
    assert.match(object,new RegExp('parent '+f.basis));assert.ok(object.endsWith(`Owned Gitjig integration\nOperation: ${receipt.operationId}\n`));
    assert.equal((await f.setup(['rev-parse','HEAD'])).toString().trim(),f.basis);
    assert.equal(receipt.projectedEntries.find(e=>e.path==='picture.png').objectId,receipt.basisEntries.find(e=>e.path==='picture.png').objectId);
});

test('same-tree snapshot still has an owned operation-marked commit without inventing a code change',{timeout:45000},async t=>{
    const f=await fixture(t),candidate=await f.capture('candidate'),result=await f.run(candidate,[]);
    assert.equal(result.value.kind,'projected',result.value.reason);
    assert.equal(result.value.receipt.projectedTree,result.value.receipt.basisTree);
    assert.notEqual(result.value.receipt.projectedCommit,f.basis);assert.equal(result.value.receipt.relation.kind,'identical');
});

test('unconsented .github changes and new opaque product remain scope holds; explicit K empty subtree is not silently dropped',{timeout:45000},async t=>{
    const f=await fixture(t);
    await fs.mkdir(path.join(f.source,'.github'));await fs.writeFile(path.join(f.source,'.github','workflow.yml'),'changed\n');
    let result=await f.run(await f.capture('candidate'),[]);assert.equal(result.value.kind,'unsupported-scope');
    await fs.rm(path.join(f.source,'.github'),{recursive:true});await fs.writeFile(path.join(f.source,'new.bin'),Buffer.from([0,1,255]));
    result=await f.run(await f.capture('candidate'),['new.bin']);assert.equal(result.value.kind,'unsupported-scope');
    await fs.rm(path.join(f.source,'new.bin'));
    await fs.writeFile(path.join(f.source,'invalid-utf8.dat'),Buffer.from([255,254]));
    result=await f.run(await f.capture('candidate'),['invalid-utf8.dat']);assert.equal(result.value.kind,'unsupported-scope');
    const empty=await fixture(t,{emptySubtree:true});result=await empty.run(await empty.capture('candidate'),[]);
    assert.equal(result.value.kind,'unavailable');assert.match(result.value.reason,/empty.*subtree/i);
});

test('dirty tracked baseline restoration is a real product nonidentity; actual capture tampering cannot inherit identity',{timeout:45000},async t=>{
    const f=await fixture(t);
    await fs.writeFile(path.join(f.base.root,'code.txt'),'tampered');
    let result=await f.run(await f.capture('candidate'),[]);assert.equal(result.value.kind,'unavailable');assert.match(result.value.reason,/Captured|capture/i);
    const dirty=await fixture(t);
    await fs.writeFile(path.join(dirty.source,'code.txt'),'preexisting dirty baseline\n');
    dirty.base=await dirty.capture('base');
    // The callback closes over fixture's original base, so use a fresh capture pair
    // directly through the guarded facade to exercise dirty S/K correspondence.
    const before=dirty.ledger(),fullStarted=performance.now();
    let recipe;
    const proposal=await dirty.runtime.run({workId:'W',sourceId:'owner',epoch:1,generation:1,inputDigest:'c'.repeat(64),profile:{gitBinary:git},validate(){}},async tools=>{
        const target=await tools.observeSourceBranchTarget({targetId:'dirty',path:dirty.source,destinationRef:'refs/heads/never-published'},{home:path.join(dirty.root,'operator')});
        await tools.fetchSourceBasis(target,dirty.basis);
        recipe={base:dirty.base,candidate:await dirty.capture('candidate'),basisCommit:dirty.basis,authorizedDeltaPaths:[]};
        return tools.projectSourceSnapshot(recipe);
    });
    const fullRunElapsedMs=performance.now()-fullStarted;
    const observed=dirty.registry.inspect(proposal.previewId);
    const sidecar=path.join(dirty.root,'source-snapshot-return-'+proposal.previewId+'.json');
    await fs.writeFile(sidecar,JSON.stringify({requested:recipe,actual:{previewId:proposal.previewId,inputDigest:observed.admission.inputDigest},returned:proposal,fullRunElapsedMs}),{flag:'wx',mode:0o600});
    t.diagnostic(JSON.stringify({sourceSnapshotSidecar:sidecar}));
    assert.equal(dirty.ledger(),before);assert.equal(proposal.value.kind,'projected',proposal.value.reason);
    assert.equal(proposal.value.receipt.relation.kind,'nonidentity');
});

test('cold1000-file many-directory repeated-body snapshot remains bounded and batches native work',{timeout:60000},async t=>{
    const f=await fixture(t,{count:1000});await fs.writeFile(path.join(f.source,'code.txt'),'one actual textual delta\n');
    const result=await f.run(await f.capture('candidate'),['code.txt']);
    assert.equal(result.value.kind,'projected',result.value.reason);const receipt=result.value.receipt;
    assert.equal(receipt.relation.kind,'identical');assert.equal(receipt.projectedEntries.length,1004);
    assert.ok(result.commandIds.length<60,'command count scales by batch/depth, not files');
    assert.ok(receipt.metrics.elapsedMs<30000);assert.ok(receipt.metrics.spoolPeakBytes<=8*1024*1024);
    t.diagnostic(JSON.stringify({coldScale:1000,commandCount:result.commandIds.length,fullRunElapsedMs:result.fullRunElapsedMs,...receipt.metrics}));
});

for(const mode of ['source-drift','abort','close'])test('actual '+mode+' at spool boundary joins filesystem tail without publication or leftover invocation spool',{timeout:45000},async t=>{
    const f=await fixture(t);await fs.writeFile(path.join(f.source,'code.txt'),'reviewed change\n');
    const candidate=await f.capture('candidate'),before=f.ledger(),abort=new AbortController();
    const originalOpen=fs.open;let reached=false,valid=true,closing,outputClosed=false;
    fs.open=async(...args)=>{
        const handle=await originalOpen(...args);
        if(!reached&&String(args[0]).includes('/gitjig-source-spool/')&&args[1]==='wx'){
            reached=true;
            const originalClose=handle.close.bind(handle);
            handle.close=async()=>{await originalClose();outputClosed=true;};
            if(mode==='source-drift')valid=false;
            else if(mode==='abort')abort.abort(Error('Owned spool abort'));
            else closing=f.runtime.close(); // deliberately do not await the tail from inside itself
        }
        return handle;
    };
    try{
        await assert.rejects(f.run(candidate,['code.txt'],{signal:abort.signal,validate(){if(!valid)throw Error('Owned original source drift');}}));
    }finally{fs.open=originalOpen;await closing;}
    assert.equal(reached,true);assert.equal(outputClosed,true);assert.equal(f.ledger(),before);
    const rows=f.store.all('SELECT id FROM source_branch_previews');assert.equal(rows.length,1);
    const row=f.registry.inspect(rows[0].id);assert.equal(row.state,'SETTLED');
    const parent=path.join(row.admission.clientRoot,'client.git','gitjig-source-spool');
    assert.deepEqual(await fs.readdir(parent),[]);
    const {admissionSourceId,...proof}=row.root;
    assert.equal((await reconcileOwnedGitProcesses(proof.clientRoot,0,proof)).cleanup,'confirmed');
    t.diagnostic(JSON.stringify({fixtureRoot:f.root,boundary:mode,previewId:row.id,clientRoot:proof.clientRoot,outputClosed}));
});

test('foreign spool parent symlink refuses before creating any foreign descendant',{timeout:45000},async t=>{
    const f=await fixture(t),candidate=await f.capture('candidate'),foreign=path.join(f.root,'foreign');
    await fs.mkdir(foreign,{mode:0o700});await fs.writeFile(path.join(foreign,'marker'),'foreign-owned');
    const proposal=await f.runtime.run({workId:'W',sourceId:'owner',epoch:1,generation:1,inputDigest:'d'.repeat(64),profile:{gitBinary:git},validate(){}},async tools=>{
        const target=await tools.observeSourceBranchTarget({targetId:'spool-parent',path:f.source,destinationRef:'refs/heads/never-published'},{home:path.join(f.root,'operator')});
        await tools.fetchSourceBasis(target,f.basis);
        const row=f.registry.active().previews[0];
        await fs.symlink(foreign,path.join(row.admission.clientRoot,'client.git','gitjig-source-spool'));
        return tools.projectSourceSnapshot({base:f.base,candidate,basisCommit:f.basis,authorizedDeltaPaths:[]});
    });
    assert.equal(proposal.value.kind,'unavailable');assert.match(proposal.value.reason,/namespace/);
    assert.deepEqual(await fs.readdir(foreign),['marker']);assert.equal(await fs.readFile(path.join(foreign,'marker'),'utf8'),'foreign-owned');
});

test('replaced empty spool namespace survives guarded cleanup as explicit inert residue',{timeout:45000},async t=>{
    const f=await fixture(t);await fs.writeFile(path.join(f.source,'code.txt'),'reviewed text\n');
    const candidate=await f.capture('candidate'),original=fs.open;let replacement,retained,identity;
    fs.open=async(...args)=>{
        const handle=await original(...args);
        if(!replacement&&String(args[0]).includes('/gitjig-source-spool/')&&args[1]==='wx'){
            replacement=path.dirname(String(args[0]));retained=replacement+'-retained';
            await fs.rename(replacement,retained);await fs.mkdir(replacement,{mode:0o700});identity=(await fs.lstat(replacement)).ino;
        }
        return handle;
    };
    let result;
    try{result=await f.run(candidate,['code.txt']);}finally{fs.open=original;}
    assert.equal(result.value.kind,'unavailable');assert.match(result.value.reason,/namespace|residue/);
    assert.equal((await fs.lstat(replacement)).ino,identity);assert.deepEqual(await fs.readdir(replacement),[]);
    assert.ok((await fs.readdir(retained)).length>0,'owned old descriptor residue remains explicit, not attributed to replacement');
    assert.equal((await fs.stat(path.join(retained,'0'))).size,0,'post-open drift is refused before writing captured bytes');
    t.diagnostic(JSON.stringify({fixtureRoot:f.root,replacement,retained}));
});

test('actual partial-spool chmod failure retains original diagnosis, closes FDs and leaves no untracked leaf',{timeout:45000},async t=>{
    const f=await fixture(t),candidate=await f.capture('candidate'),original=fs.open;let injected=false,closed=false;
    fs.open=async(...args)=>{
        const handle=await original(...args);
        if(!injected&&String(args[0]).includes('/gitjig-source-spool/')&&args[1]==='wx'){
            injected=true;const close=handle.close.bind(handle);
            handle.close=async()=>{await close();closed=true;};handle.chmod=async()=>{throw Error('OWNED_PARTIAL_SPOOL_CHMOD_FAILURE');};
        }
        return handle;
    };
    let result;
    try{result=await f.run(candidate,[]);}finally{fs.open=original;}
    assert.equal(injected,true);assert.equal(closed,true);assert.equal(result.value.kind,'unavailable');
    assert.match(result.value.reason,/OWNED_PARTIAL_SPOOL_CHMOD_FAILURE/);assert.doesNotMatch(result.value.reason,/ENOTEMPTY/);
    assert.deepEqual(await fs.readdir(path.join(result.clientRoot,'client.git','gitjig-source-spool')),[]);
});

test('repository replacement during prepared descriptor is refused before the next native Git birth',{timeout:45000},async t=>{
    const f=await fixture(t),candidate=await f.capture('candidate'),original=fs.open;
    let sawSpool=false,replaced=false,replacement,originalRepository;
    fs.open=async(...args)=>{
        const handle=await original(...args),file=String(args[0]);
        if(file.includes('/gitjig-source-spool/')&&args[1]==='wx')sawSpool=true;
        if(sawSpool&&!replaced&&file.endsWith('/descriptor.json')&&args[1]==='wx'){
            replaced=true;
            const row=f.registry.active().previews[0];replacement=path.join(row.admission.clientRoot,'client.git');
            originalRepository=replacement+'-retained';await fs.rename(replacement,originalRepository);await fs.mkdir(replacement,{mode:0o700});
        }
        return handle;
    };
    let result;
    try{result=await f.run(candidate,[]);}finally{fs.open=original;}
    assert.equal(replaced,true);assert.equal(result.value.kind,'unavailable');
    const runs=path.join(result.clientRoot,'runs');let blocked=false;
    for(const id of await fs.readdir(runs)){
        const directory=path.join(runs,id),descriptor=JSON.parse(await fs.readFile(path.join(directory,'descriptor.json'),'utf8'));
        if(descriptor.argv.includes('hash-object')){
            const terminal=JSON.parse(await fs.readFile(path.join(directory,'terminal.json'),'utf8'));
            assert.equal(terminal.producer,'controller-no-launch');assert.equal(terminal.gitStarted,false);blocked=true;
            assert.equal(await fs.stat(path.join(directory,'lifecycle.json')).then(()=>true,()=>false),false);
        }
    }
    assert.equal(blocked,true);assert.deepEqual(await fs.readdir(replacement),[]);
    assert.ok((await fs.readdir(originalRepository)).length>0);
    t.diagnostic(JSON.stringify({fixtureRoot:f.root,replacement,originalRepository,blockedBeforeBirth:blocked}));
});

for(const mode of ['directory','leaf'])test('spool '+mode+' replacement during prepared descriptor prevents native Git birth',{timeout:45000},async t=>{
    const f=await fixture(t),candidate=await f.capture('candidate'),original=fs.open;
    let selected,replaced=false,replacement,retained;
    fs.open=async(...args)=>{
        const handle=await original(...args),file=String(args[0]);
        if(!selected&&file.includes('/gitjig-source-spool/')&&args[1]==='wx')selected=file;
        if(selected&&!replaced&&file.endsWith('/descriptor.json')&&args[1]==='wx'){
            replaced=true;replacement=mode==='directory'?path.dirname(selected):selected;retained=replacement+'-retained';
            await fs.rename(replacement,retained);
            if(mode==='directory')await fs.mkdir(replacement,{mode:0o700});
            else await fs.writeFile(replacement,'foreign replacement',{flag:'wx',mode:0o600});
        }
        return handle;
    };
    let result;
    try{result=await f.run(candidate,[]);}finally{fs.open=original;}
    assert.equal(replaced,true);assert.equal(result.value.kind,'unavailable');
    let blocked=false;
    for(const id of result.commandIds){
        const directory=path.join(result.clientRoot,'runs',id),descriptor=JSON.parse(await fs.readFile(path.join(directory,'descriptor.json'),'utf8'));
        if(descriptor.argv.includes('hash-object')){
            const terminal=JSON.parse(await fs.readFile(path.join(directory,'terminal.json'),'utf8'));
            assert.equal(terminal.producer,'controller-no-launch');assert.equal(terminal.gitStarted,false);blocked=true;
            assert.equal(await fs.stat(path.join(directory,'lifecycle.json')).then(()=>true,()=>false),false);
        }
    }
    assert.equal(blocked,true);assert.ok(await fs.lstat(replacement));assert.ok(await fs.lstat(retained));
    t.diagnostic(JSON.stringify({fixtureRoot:f.root,replacement,retained,blockedBeforeBirth:blocked}));
});

test('empty tracked K root and unchanged private context qualify duplicate empty-tree batch framing',{timeout:45000},async t=>{
    const f=await fixture(t,{emptyProduct:true}),candidate=await f.capture('candidate'),result=await f.run(candidate,[]);
    assert.equal(result.value.kind,'projected',result.value.reason);const receipt=result.value.receipt;
    assert.deepEqual(receipt.product,[]);assert.deepEqual(receipt.projectedEntries,[]);
    assert.equal(receipt.projectedTree,receipt.basisTree);assert.equal(receipt.relation.kind,'identical');
    assert.notEqual(receipt.projectedCommit,f.basis);assert.ok(receipt.effectiveDifferences.length>0);
    const body=(await f.setup(['--git-dir='+path.join(result.clientRoot,'client.git'),'cat-file','commit',receipt.projectedCommit])).toString();
    assert.ok(body.includes('parent '+f.basis+'\n'));assert.ok(body.endsWith(`Operation: ${receipt.operationId}\n`));
    assert.equal((await f.setup(['rev-parse','HEAD'])).toString().trim(),f.basis);
});

for(const format of ['sha1','sha256'])test(format+' new-file publication uses absent K baseline but retains full captured S/C and whole-file consent',{timeout:45000},async t=>{
    const f=await fixture(t,{format,newFileCases:true});
    const old=await fs.readFile(path.join(f.source,'existing-untracked.txt'));
    await fs.appendFile(path.join(f.source,'existing-untracked.txt'),'reviewed appended line\n');
    await fs.writeFile(path.join(f.source,'fresh.txt'),'entire fresh candidate text\n');
    await fs.unlink(path.join(f.source,'deleted-untracked.txt'));
    await fs.chmod(path.join(f.source,'mode-untracked.txt'),0o700);
    await fs.writeFile(path.join(f.source,'code.txt'),'tracked reviewed change\n');
    const candidate=await f.capture('candidate');
    const allowed=['existing-untracked.txt','fresh.txt','deleted-untracked.txt','mode-untracked.txt','code.txt','unchanged-untracked.txt'];
    const noConsent=await f.run(candidate,allowed.filter(name=>name!=='existing-untracked.txt'));
    assert.equal(noConsent.value.kind,'unsupported-scope');assert.match(noConsent.value.reason,/Unconsented/);
    const head=(await f.setup(['rev-parse','HEAD'])).toString(),index=await fs.readFile(path.join(f.source,'.git','index'));
    const status=(await f.setup(['--no-optional-locks','status','--porcelain=v1'])).toString();
    const result=await f.run(candidate,allowed);assert.equal(result.value.kind,'projected',result.value.reason);
    const receipt=result.value.receipt,repo='--git-dir='+path.join(result.clientRoot,'client.git');
    assert.equal(receipt.protocol,'source-context-projection/v2');
    assert.equal(receipt.publicationBaselineProfile,'k-absent-whole-file/v1');
    assert.equal(receipt.relation.kind,'identical');
    assert.deepEqual(receipt.wholeFileAdditions.map(row=>[row.path,row.capturedBasePresent]),[
        ['existing-untracked.txt',true],['fresh.txt',false],['mode-untracked.txt',true]]);
    const publicationBase=(await f.setup([repo,'ls-tree','-r','--name-only',receipt.syntheticBase])).toString().trim().split('\n');
    assert.ok(publicationBase.includes('code.txt'));
    for(const name of ['existing-untracked.txt','fresh.txt','deleted-untracked.txt','mode-untracked.txt'])assert.equal(publicationBase.includes(name),false);
    assert.equal((await f.setup([repo,'rev-parse',receipt.syntheticBase+'^{tree}'])).toString().trim(),receipt.publicationBaseTree);
    const capturedBase=receipt.blobs.find(row=>row.side==='base'&&row.path==='existing-untracked.txt');
    assert.equal(capturedBase.sha256,f.base.manifest.files.find(row=>row.path==='existing-untracked.txt').sha256);
    assert.deepEqual(await f.setup([repo,'cat-file','blob',capturedBase.objectId]),old);
    for(const addition of receipt.wholeFileAdditions){
        const expected=await fs.readFile(path.join(candidate.root,addition.path));
        assert.deepEqual(await f.setup([repo,'cat-file','blob',receipt.projectedCommit+':'+addition.path]),expected);
        assert.equal(addition.candidateSha256,candidate.manifest.files.find(row=>row.path===addition.path).sha256);
        assert.equal(addition.candidateBlob,receipt.blobs.find(row=>row.side==='candidate'&&row.path===addition.path).objectId);
    }
    assert.equal(receipt.projectedEntries.some(row=>['deleted-untracked.txt','unchanged-untracked.txt'].includes(row.path)),false);
    assert.equal(receipt.product.some(row=>row.path==='unchanged-untracked.txt'),false);
    assert.equal(receipt.wholeFileAdditions.find(row=>row.path==='mode-untracked.txt').effectiveMode,0o700);
    assert.equal((await f.setup(['rev-parse','HEAD'])).toString(),head);
    assert.deepEqual(await fs.readFile(path.join(f.source,'.git','index')),index);
    assert.equal((await f.setup(['--no-optional-locks','status','--porcelain=v1'])).toString(),status);
});

test('K ancestor/descendant geometry is not discarded by absent publication-baseline repair',{timeout:45000},async t=>{
    for(const kind of ['ancestor','descendant']){
        const f=await fixture(t,{geometryConflict:kind,count:kind==='descendant'?1:0});
        const name=kind==='ancestor'?'code.txt/notes.txt':'many';
        await fs.appendFile(path.join(f.source,name),'reviewed edit\n');
        const result=await f.run(await f.capture('candidate'),[name]);
        assert.notEqual(result.value.kind,'projected','cannot silently discard K hierarchy');
        assert.ok(['conflict','unsupported-scope','unavailable'].includes(result.value.kind));
    }
    for(const conversion of ['file-to-directory','directory-to-file']){
        const f=await fixture(t,{newFileCases:true});
        const name=conversion==='file-to-directory'?'existing-untracked.txt':'private-dir';
        await fs.rm(path.join(f.source,name),{recursive:true});
        let allowed;
        if(conversion==='file-to-directory'){
            await fs.mkdir(path.join(f.source,name));await fs.writeFile(path.join(f.source,name,'child.txt'),'new child\n');
            allowed=[name,name+'/child.txt'];
        }else{
            await fs.writeFile(path.join(f.source,name),'replacement text\n');allowed=[name,name+'/old.txt'];
        }
        const result=await f.run(await f.capture('candidate'),allowed);
        assert.equal(result.value.kind,'unsupported-scope');assert.match(result.value.reason,/conversion|Directory-only/);
    }
});
