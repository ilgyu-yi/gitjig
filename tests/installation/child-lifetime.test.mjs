import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {runInstallationCommand,reconcileInstallationChildren} from '../../dist/installation/child.js';
import {activateBundle,recoverActivation} from '../../dist/installation/activation.js';
import {nodeProfile,requiredPayload} from '../../dist/installation/bundle.js';
import {assetIdentity,inventoryTree} from '../../dist/installation/tree.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const execute=promisify(execFile);
const installer=new URL('../../dist/installation/cli.js',import.meta.url);
async function until(f,ms=5000){const end=Date.now()+ms;while(Date.now()<end){const value=await f();if(value)return value;await delay(20);}throw Error('Actual child barrier not reached');}
async function fixture(source,kind='migrate'){const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-install-child-'))),ownerId=randomUUID(),payloadId='a'.repeat(64);await fs.chmod(home,0o700);for(const p of ['bootstrap','state',`state/activation-${ownerId}`,`versions/${payloadId}/dist/installation`])await fs.mkdir(path.join(home,p),{recursive:true,mode:0o700});await fs.copyFile(process.execPath,path.join(home,'bootstrap/node'));await fs.chmod(path.join(home,'bootstrap/node'),0o500);await fs.copyFile(new URL('../../dist/installation/child-supervisor.js',import.meta.url),path.join(home,'bootstrap/child-supervisor.js'));await fs.writeFile(path.join(home,'package.json'),'{"type":"module"}',{mode:0o600});await fs.writeFile(path.join(home,`versions/${payloadId}/dist/installation/${kind}.js`),source,{mode:0o600});return{home,ownerId,payloadId,kind};}
async function clean(f){if(f.completed)await fs.rm(f.home,{recursive:true,force:true});else console.error('Preserved failed installation fixture: '+f.home);}
test('exited worker with inherited output outside its group settles UNKNOWN instead of hanging installation',{timeout:10000},async()=>{
 const f=await fixture("import fs from 'node:fs';import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','inherit','inherit']});fs.writeFileSync('escaped-output-holder',String(child.pid));child.unref();");
 let holder;const running=runInstallationCommand(f);void running.catch(()=>{});
 try{
  holder=Number(await until(()=>fs.readFile(path.join(f.home,'escaped-output-holder'),'utf8').catch(()=>null)));
  const refused=assert.rejects(running,/cleanup unknown/);
  const terminal=await until(async()=>{const commands=await fs.readdir(path.join(f.home,'state/installation-children',f.ownerId));if(commands.length!==1)return;return fs.readFile(path.join(f.home,'state/installation-children',f.ownerId,commands[0],'terminal.json'),'utf8').then(JSON.parse,()=>null);},6000);
  await refused;assert.equal(terminal.cleanup,'unknown');assert.equal(terminal.pipeDrainIncomplete,true);assert.equal(terminal.code,0);assert.match(terminal.reason,/output pipes/);
  assert.equal((await reconcileInstallationChildren(f.home,f.ownerId)).cleanup,'unknown');
  assert.throws(()=>process.kill(terminal.workerPid,0),{code:'ESRCH'});process.kill(holder,0);f.completed=true;
 }finally{
  // Test ownership knows the escaped holder; product supervision deliberately
  // retains UNKNOWN rather than claiming or killing an unproved process tree.
  const joined=new Set();
  if(holder){joined.add(-holder);try{process.kill(-holder,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  const root=path.join(f.home,'state/installation-children',f.ownerId);
  for(const entry of await fs.readdir(root).catch(()=>[]))for(const [file,key,group] of [['worker.json','workerPid',true],['identity.json','supervisorPid',false]]){
   const saved=await fs.readFile(path.join(root,entry,file),'utf8').then(JSON.parse,()=>null);if(saved?.[key]){const owned=group?-saved[key]:saved[key];joined.add(owned);try{process.kill(owned,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  }
  await running.catch(()=>{});
  for(const owned of joined)await until(()=>{try{process.kill(owned,0);return false;}catch(error){if(error.code==='ESRCH')return true;if(error.code==='EPERM')return false;throw error;}},2000);
  await clean(f);
 }
});
test('fixed migration returns actual output and settled exact helper journal',async()=>{const f=await fixture('console.log(JSON.stringify({actual:true}));');try{const result=await runInstallationCommand(f);assert.deepEqual(JSON.parse(result.stdout),{actual:true});assert.equal((await reconcileInstallationChildren(f.home,f.ownerId)).cleanup,'confirmed');f.completed=true;}finally{await clean(f);}});
test('SIGKILL updater: independent supervisor stops synchronous worker before activation recovery',async()=>{const f=await fixture("import fs from 'node:fs';fs.writeFileSync('worker-started',String(process.pid));while(true){}"),db=Buffer.from('untouched owner state');await fs.writeFile(path.join(f.home,'state/controller.sqlite'),db,{mode:0o600});await fs.writeFile(path.join(f.home,'controller.json'),JSON.stringify({format:'gitjig-controller-1',custom:'preserved'}),{mode:0o600});await fs.writeFile(path.join(f.home,'activation.json'),JSON.stringify({format:1,id:f.ownerId,phase:'SNAPSHOT',payloadId:f.payloadId,oldBinding:null,hadDatabase:true,databasePromoted:false,snapshotSha256:null,childProfile:'installation-child/v1',oldControllerMarker:{format:'gitjig-controller-1',custom:'preserved'}}),{mode:0o600});const parent=spawn(process.execPath,[new URL('./child-parent.mjs',import.meta.url).pathname,JSON.stringify(f)],{stdio:['ignore','pipe','pipe']});let diagnostic='';parent.stderr.on('data',b=>diagnostic+=b);try{const workerPid=Number(await until(()=>fs.readFile(path.join(f.home,'worker-started'),'utf8').catch(()=>null)));const ended=once(parent,'close');parent.kill('SIGKILL');await ended;const proof=await until(async()=>{const p=await reconcileInstallationChildren(f.home,f.ownerId,100);return p.cleanup==='confirmed'?p:null;});assert.equal(proof.commands.length,1);assert.throws(()=>process.kill(workerPid,0),{code:'ESRCH'});const dir=path.join(f.home,'state/installation-children',f.ownerId,proof.commands[0].commandId),terminal=JSON.parse(await fs.readFile(path.join(dir,'terminal.json'),'utf8'));assert.equal(terminal.workerStarted,true);assert.match(terminal.reason,/lifeline/);assert.equal((await recoverActivation(f.home)).recovered,'pre-admission-rollback');assert.deepEqual(await fs.readFile(path.join(f.home,'state/controller.sqlite')),db);assert.equal(JSON.parse(await fs.readFile(path.join(f.home,'controller.json'),'utf8')).custom,'preserved');assert.equal((await recoverActivation(f.home)).recovered,'nothing-pending');f.completed=true;}catch(e){e.message+=' '+diagnostic+' fixture='+f.home;throw e;}finally{parent.kill('SIGKILL');await clean(f);}});
test('descriptor admission without helper identity/terminal retains UNKNOWN and activation gate',async()=>{const f=await fixture('console.log("healthy")');try{const commandId=randomUUID(),directory=path.join(f.home,'state/installation-children',f.ownerId,commandId);await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.writeFile(path.join(directory,'descriptor.json'),JSON.stringify({...f,format:1,commandId,directory}),{mode:0o600});await fs.writeFile(path.join(f.home,'activation.json'),JSON.stringify({format:1,id:f.ownerId,phase:'PREPARED',payloadId:f.payloadId,oldBinding:null,hadDatabase:false,databasePromoted:false,snapshotSha256:null,childProfile:'installation-child/v1'}),{mode:0o600});assert.equal((await reconcileInstallationChildren(f.home,f.ownerId,30)).cleanup,'unknown');await assert.rejects(recoverActivation(f.home),/UNKNOWN/);assert.equal(JSON.parse(await fs.readFile(path.join(f.home,'activation.json'),'utf8')).phase,'PREPARED');f.completed=true;}finally{await clean(f);}});
test('output overflow refuses result while retaining affirmative cleanup',async()=>{const f=await fixture("process.stdout.write('x'.repeat(3*1024*1024));setInterval(()=>{},1000);");try{await assert.rejects(runInstallationCommand(f),/unavailable/);assert.equal((await reconcileInstallationChildren(f.home,f.ownerId)).cleanup,'confirmed');f.completed=true;}finally{await clean(f);}});
test('actual updater SIGKILL after durable descriptor before supervisor launch stays UNKNOWN',async()=>{const f=await fixture("console.log('must not start')");const parent=spawn(process.execPath,[new URL('./child-parent.mjs',import.meta.url).pathname,JSON.stringify(f),'cut-before-launch'],{stdio:['ignore','ignore','pipe']});try{const [code,signal]=await once(parent,'close');assert.equal(code,null);assert.equal(signal,'SIGKILL');const proof=await reconcileInstallationChildren(f.home,f.ownerId,30);assert.equal(proof.cleanup,'unknown');assert.equal(proof.commands.length,1);const dir=path.join(f.home,'state/installation-children',f.ownerId,proof.commands[0].commandId);await assert.rejects(fs.stat(path.join(dir,'identity.json')),{code:'ENOENT'});f.completed=true;}finally{parent.kill('SIGKILL');await clean(f);}});

test('fixed loaded-health home binding and parent-death cleanup use builtins bootstrap runner',async()=>{const f=await fixture("import fs from 'node:fs';if(process.argv[2]!==process.cwd())throw Error('wrong home');fs.writeFileSync('loaded-health-started',String(process.pid));while(true){}",'loaded-health');const parent=spawn(process.execPath,[new URL('./child-parent.mjs',import.meta.url).pathname,JSON.stringify(f)],{stdio:['ignore','ignore','pipe']});try{const pid=Number(await until(()=>fs.readFile(path.join(f.home,'loaded-health-started'),'utf8').catch(()=>null)));const ended=once(parent,'close');parent.kill('SIGKILL');await ended;const proof=await until(async()=>{const p=await reconcileInstallationChildren(f.home,f.ownerId,100);return p.cleanup==='confirmed'?p:null;});assert.equal(proof.commands.length,1);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});const descriptor=JSON.parse(await fs.readFile(path.join(f.home,'state/installation-children',f.ownerId,proof.commands[0].commandId,'descriptor.json'),'utf8'));assert.equal(descriptor.kind,'loaded-health');assert.equal(descriptor.argument,f.home);assert.equal(descriptor.module,path.join(f.home,`versions/${f.payloadId}/dist/installation/loaded-health.js`));f.completed=true;}finally{parent.kill('SIGKILL');await clean(f);}});
test('actual missing Node launch joins delayed no-launch terminal write before rejecting',async()=>{const f=await fixture("console.log('not started')");await fs.unlink(path.join(f.home,'bootstrap/node'));const originalOpen=fs.open.bind(fs);let release,entered;const held=new Promise(r=>release=r),barrier=new Promise(r=>entered=r);fs.open=async(file,...args)=>{const h=await originalOpen(file,...args);if(String(file).endsWith('/terminal.json')){const write=h.writeFile.bind(h);h.writeFile=async(...values)=>{entered();await held;return write(...values);};}return h;};let settled=false;try{const running=runInstallationCommand(f);running.then(()=>settled=true,()=>settled=true);await barrier;await delay(30);assert.equal(settled,false,'receipt-write tail remains owned after actual spawn close');release();await assert.rejects(running,{code:'ENOENT'});const proof=await reconcileInstallationChildren(f.home,f.ownerId);assert.equal(proof.cleanup,'confirmed');const terminal=JSON.parse(await fs.readFile(path.join(f.home,'state/installation-children',f.ownerId,proof.commands[0].commandId,'terminal.json'),'utf8'));assert.equal(terminal.producer,'controller-no-launch');assert.equal(terminal.workerStarted,false);f.completed=true;}finally{release();fs.open=originalOpen;await clean(f);}});

async function failSupervisorWrite(f, leaf, failSync = false) {
    const supervisor = path.join(f.home,'bootstrap/child-supervisor.js');
    await fs.writeFile(path.join(f.home,'bootstrap/write-fault.js'), `
        import fs from 'node:fs';
        import path from 'node:path';
        const open = fs.openSync, sync = fs.fsyncSync;
        const full = () => Object.assign(Error('ENOSPC: controlled private journal fault'), {code:'ENOSPC'});
        let target;
        fs.openSync = (file, ...args) => {
            if (path.basename(file) !== ${JSON.stringify(leaf)}) return open(file, ...args);
            if (!${failSync}) throw full();
            return target = open(file, ...args);
        };
        fs.fsyncSync = fd => { if (fd === target) throw full(); return sync(fd); };
    `, {mode:0o600});
    await fs.writeFile(supervisor, "import './write-fault.js';\n" + await fs.readFile(supervisor,'utf8'));
}

for (const [leaf, failSync] of [['stdout',false],['stderr',true]]) test(`failed ${leaf} retention refuses output but allows original activation rollback`, {timeout:12000}, async () => {
    const f = await fixture("console.log(JSON.stringify({ready:true}));");
    const db = Buffer.from('Untouched original activation database');
    const marker = {format:'gitjig-controller-1',custom:'preserved'};
    try {
        await fs.writeFile(path.join(f.home,'state/controller.sqlite'),db,{mode:0o600});
        await fs.writeFile(path.join(f.home,'controller.json'),JSON.stringify(marker),{mode:0o600});
        await fs.writeFile(path.join(f.home,'activation.json'),JSON.stringify({format:1,id:f.ownerId,phase:'SNAPSHOT',
            payloadId:f.payloadId,oldBinding:null,hadDatabase:true,databasePromoted:false,snapshotSha256:null,childProfile:'installation-child/v1',oldControllerMarker:marker}),{mode:0o600});
        await failSupervisorWrite(f,leaf,failSync);
        await assert.rejects(runInstallationCommand(f),{code:'ENOSPC',message:/Installation child unavailable:.*ENOSPC/s});
        const proof=await reconcileInstallationChildren(f.home,f.ownerId);
        assert.equal(proof.cleanup,'confirmed');
        assert.equal(proof.commands.length,1);
        const journal=path.join(f.home,'state/installation-children',f.ownerId,proof.commands[0].commandId);
        const terminal=JSON.parse(await fs.readFile(path.join(journal,'terminal.json'),'utf8'));
        assert.equal(terminal.code,0);
        assert.equal(terminal.cleanup,'confirmed');
        if (failSync) assert.deepEqual(JSON.parse(await fs.readFile(path.join(journal,'stdout'),'utf8')),{ready:true});
        assert.equal((await recoverActivation(f.home)).recovered,'pre-admission-rollback');
        assert.deepEqual(await fs.readFile(path.join(f.home,'state/controller.sqlite')),db);
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.home,'controller.json'),'utf8')),marker);
        f.completed=true;
    } finally { await clean(f); }
});

test('failed worker identity write stops and joins the detached installation worker', {timeout:10000}, async () => {
    const f = await fixture('setInterval(() => {}, 1000);');
    try {
        await failSupervisorWrite(f,'worker.json.tmp');
        await assert.rejects(runInstallationCommand(f),/Installation child unavailable:.*ENOSPC/s);
        const proof=await reconcileInstallationChildren(f.home,f.ownerId);
        assert.equal(proof.cleanup,'confirmed');
        const journal=path.join(f.home,'state/installation-children',f.ownerId,proof.commands[0].commandId);
        const terminal=JSON.parse(await fs.readFile(path.join(journal,'terminal.json'),'utf8'));
        assert.equal(terminal.workerStarted,true);
        assert.match(terminal.reason,/worker journal write failed/);
        assert.throws(()=>process.kill(-terminal.workerPid,0),{code:'ESRCH'});
        await assert.rejects(fs.stat(path.join(journal,'worker.json')),{code:'ENOENT'});
        f.completed=true;
    } finally { await clean(f); }
});

test('failed terminal receipt leaves child settlement unavailable for recovery', {timeout:10000}, async () => {
    const f = await fixture("console.log(JSON.stringify({ready:true}));");
    try {
        await failSupervisorWrite(f,'terminal.json.tmp');
        await assert.rejects(runInstallationCommand(f),{code:'ENOSPC',message:/Installation child cleanup unknown:.*ENOSPC/s});
        const proof=await reconcileInstallationChildren(f.home,f.ownerId,30);
        assert.equal(proof.cleanup,'unknown');
        assert.equal(proof.commands.length,1);
        const journal=path.join(f.home,'state/installation-children',f.ownerId,proof.commands[0].commandId);
        await assert.rejects(fs.stat(path.join(journal,'terminal.json')),{code:'ENOENT'});
        await assert.rejects(fs.stat(path.join(journal,'stdout')),{code:'ENOENT'});
        f.completed=true;
    } finally { await clean(f); }
});

for (const storageFull of [true, false]) test(`installer recovery classifies ${storageFull ? 'supervisor storage exhaustion' : 'worker stderr'}`, async () => {
    const f = await fixture(storageFull ? 'console.log("{}");' : 'console.error("ENOSPC"); process.exitCode = 1;', 'handshake');
    const activation = path.join(f.home,'activation.json');
    const journal = {format:1,id:f.ownerId,phase:'COMMITTED',payloadId:f.payloadId,hadDatabase:false,
        databasePromoted:false,childProfile:'installation-child/v1'};
    try {
        await fs.writeFile(activation,JSON.stringify(journal),{mode:0o600});
        if (storageFull) await failSupervisorWrite(f,'stdout');
        await assert.rejects(execute(process.execPath,[installer.pathname,'recover','--home',f.home]), error => {
            assert.equal(error.code,2);
            const report = JSON.parse(error.stderr);
            assert.equal(report.error,'INSTALLATION_UNAVAILABLE');
            assert.match(report.message,/ENOSPC/);
            assert.match(report.recovery,storageFull ? /Free space.*Recover any pending activation/ : /Retain owned state/);
            return true;
        });
        assert.deepEqual(JSON.parse(await fs.readFile(activation,'utf8')),journal);
        const proof=await reconcileInstallationChildren(f.home,f.ownerId);
        assert.equal(proof.cleanup,'confirmed');
        assert.equal(proof.commands.length,1);
        f.completed=true;
    } finally { await clean(f); }
});

for (const code of ['ENOSPC', 'ERR_SQLITE_ERROR']) test(`installer recovery finds ${code} in a compound maintenance error`, async () => {
    const f = await fixture('');
    try {
        const fault = path.join(f.home,'maintenance-fault.mjs');
        await fs.writeFile(fault,`
            import fs from 'node:fs/promises';
            const lstat = fs.lstat;
            fs.lstat = async (directory, ...args) => {
                if (directory !== ${JSON.stringify(f.home)}) return lstat(directory, ...args);
                const storage = Object.assign(Error('storage failed'), ${JSON.stringify(code === 'ENOSPC' ? {code} : {code,errcode:4874})});
                const original = Error('original failure');
                const rollback = Error('rollback failed', {cause:storage});
                const combined = new AggregateError([original, rollback], 'compound failure', {cause:original});
                original.cause = combined;
                throw combined;
            };
        `);
        await assert.rejects(execute(process.execPath,['--import',fault,installer.pathname,'recover','--home',f.home]), error => {
            assert.equal(error.code,2);
            assert.match(JSON.parse(error.stderr).recovery,code === 'ENOSPC' ? /Free space/ : /available and writable/);
            return true;
        });
        f.completed=true;
    } finally { await clean(f); }
});

async function offlineFixtureRoot(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig offline installation ')));
    t.after(async () => {
        for (const entry of await fs.readdir(root, {recursive: true, withFileTypes: true})) {
            if (entry.isDirectory()) await fs.chmod(path.join(entry.parentPath, entry.name), 0o700);
        }
        await fs.rm(root, {recursive: true, force: true});
    });
    return root;
}

async function offlineBundleFixture(bundle, label) {
    const payload = path.join(bundle, 'payload'), bootstrap = path.join(bundle, 'bootstrap');
    const install = path.join(bundle, 'install'), installBytes = 'offline staging fixture';
    for (const asset of requiredPayload) {
        const file = path.join(payload, asset);
        await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
        await fs.writeFile(file, 'owned payload ' + label, {mode: 0o400});
    }
    for (const asset of await inventoryTree(payload))
        if (asset.kind === 'directory') await fs.chmod(path.join(payload, asset.path), 0o500);
    await fs.mkdir(bootstrap, {mode: 0o700});
    for (const asset of ['NODE-LICENSE', 'bootstrap.js', 'tree.js', 'package.json', 'launcher', 'child.js', 'private-files.js', 'child-supervisor.js'])
        await fs.writeFile(path.join(bootstrap, asset), 'owned bootstrap ' + label, {mode: 0o400});
    const node = path.join(bootstrap, 'node');
    try {
        await fs.link(process.execPath, node);
    } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        await fs.copyFile(process.execPath, node);
    }
    await fs.writeFile(install, installBytes, {mode: 0o500});
    const assets = await inventoryTree(payload), payloadId = assetIdentity(assets);
    const payloadBytes = assets.reduce((sum, a) => sum + (a.kind === 'file' ? a.bytes : 0), 0);
    await fs.writeFile(path.join(bundle, 'bundle.json'), JSON.stringify({
        format: 1, platform: nodeProfile, payloadId, assets, bootstrap: await inventoryTree(bootstrap),
        installer: {path: 'install', mode: 0o500, sha256: createHash('sha256').update(installBytes).digest('hex')},
    }), {mode: 0o400});
    return {payloadId, payloadBytes};
}

const pinnedOfflinePlatform = process.platform === nodeProfile.platform && process.arch === nodeProfile.arch;

test('offline activation retains its staged payload when the source bundle path is replaced', {
    skip: !pinnedOfflinePlatform,
}, async t => {
    const root = await offlineFixtureRoot(t);
    const bundleRoot = path.join(root, 'bundle'), replacement = path.join(root, 'replacement');
    const home = path.join(root, 'owned home'), versions = path.join(home, 'versions');
    const original = await offlineBundleFixture(bundleRoot, 'A');
    const alternate = await offlineBundleFixture(replacement, 'B');
    const stagedVersion = path.join(versions, original.payloadId);
    const rename = fs.rename, mkdir = fs.mkdir;
    t.mock.method(fs, 'rename', async (from, to) => {
        await rename(from, to);
        if (to === stagedVersion) {
            await rename(bundleRoot, path.join(root, 'retired original'));
            await rename(replacement, bundleRoot);
        }
    });
    t.mock.method(fs, 'mkdir', async (directory, ...args) => {
        assert.ok(!String(directory).startsWith(path.join(home, '.bootstrap-')),
            'The replacement bootstrap must be rejected before copying');
        return mkdir(directory, ...args);
    });
    await assert.rejects(activateBundle({installationHome: home, bundleRoot}), /Bundle assets changed before copying/);
    assert.equal(JSON.parse(await fs.readFile(path.join(bundleRoot, 'bundle.json'), 'utf8')).payloadId, alternate.payloadId);
    assert.deepEqual(await fs.readdir(versions), [original.payloadId]);
    const history = path.join(home, 'activation-history'), receipts = await fs.readdir(history);
    assert.equal(receipts.length, 1);
    const receipt = JSON.parse(await fs.readFile(path.join(history, receipts[0]), 'utf8'));
    assert.equal(receipt.phase, 'ROLLBACK');
    assert.equal(receipt.payloadId, original.payloadId);
    for (const entry of ['bootstrap', 'binding.json', 'activation.json'])
        await assert.rejects(fs.access(path.join(home, entry)), {code: 'ENOENT'});
});

test('offline staging identifies the destination volume only after a clean storage failure', {
    skip: !pinnedOfflinePlatform,
}, async t => {
    const root = await offlineFixtureRoot(t), bundle = path.join(root, 'bundle');
    const home = path.join(root, 'owned home'), versions = path.join(home, 'versions');
    const {payloadId, payloadBytes} = await offlineBundleFixture(bundle, 'storage');
    const fault = path.join(root, 'storage-fault.mjs');
    await fs.writeFile(fault, `
        import fs from 'node:fs/promises';
        const stagePrefix = process.env.GITJIG_TEST_STAGE_PREFIX;
        const open = fs.open;
        fs.open = async (file, ...args) => {
            const handle = await open(file, ...args);
            if (args[0] === 'wx' && String(file).startsWith(stagePrefix)) {
                const write = handle.writeFile.bind(handle);
                handle.writeFile = async data => {
                    await write(data.subarray(0, 1));
                    throw Object.assign(Error('ENOSPC: controlled stage write'), {code: 'ENOSPC', syscall: 'write'});
                };
            }
            return handle;
        };
        const unlink = fs.unlink;
        fs.unlink = async (file, ...args) => {
            if (process.env.GITJIG_TEST_REFUSE_STAGE_CLEANUP === '1' && String(file).startsWith(stagePrefix))
                throw Error('Controlled ownership cleanup failure');
            return unlink(file, ...args);
        };
    `);
    const command = operation => [installer.pathname, operation, '--bundle', bundle, '--home', home];
    for (const operation of ['stage', 'activate']) {
        await assert.rejects(execute(process.execPath, ['--import', fault, ...command(operation)], {
            env: {...process.env, GITJIG_TEST_STAGE_PREFIX: versions + '/.stage-'},
        }), error => {
            assert.equal(error.code, 2);
            const report = JSON.parse(error.stderr);
            assert.equal(report.error, 'INSTALLATION_UNAVAILABLE');
            assert.ok(report.message.includes(versions));
            assert.match(report.message, /ENOSPC: controlled stage write/);
            assert.ok(report.recovery.includes('Free space on the filesystem containing ' + versions));
            assert.ok(report.recovery.includes('retry the same ' + operation + ' command'));
            assert.ok(report.recovery.includes(payloadBytes + ' bytes of file data'));
            return true;
        });
        assert.deepEqual(await fs.readdir(versions), []);
        await assert.rejects(fs.access(path.join(home, 'activation.json')), {code: 'ENOENT'});
    }
    const stage = command('stage');
    assert.equal(JSON.parse((await execute(process.execPath, stage)).stdout).payloadId, payloadId);
    assert.deepEqual(await fs.readdir(versions), [payloadId]);
    const anotherHome = path.join(root, 'cleanup home'), anotherVersions = path.join(anotherHome, 'versions');
    await assert.rejects(execute(process.execPath, ['--import', fault, ...stage.slice(0, -1), anotherHome], {
        env: {...process.env, GITJIG_TEST_STAGE_PREFIX: anotherVersions + '/.stage-', GITJIG_TEST_REFUSE_STAGE_CLEANUP: '1'},
    }), error => {
        const report = JSON.parse(error.stderr);
        assert.match(report.message, /controlled stage write.*Controlled ownership cleanup failure/);
        assert.match(report.recovery, /Recover any pending activation/);
        assert.doesNotMatch(report.recovery, /retry the same stage command/);
        return true;
    });
    assert.match((await fs.readdir(anotherVersions))[0], /^\.stage-/);
});

test('stable health does not interpret the fixed payload workers’ reserved exits', async () => {
    const f = await fixture('');
    try {
        await fs.writeFile(path.join(f.home,'bootstrap/bootstrap.js'),'process.exitCode = 73;',{mode:0o600});
        await assert.rejects(runInstallationCommand({...f,kind:'stable-health'}), error => {
            assert.match(error.message,/Installation child unavailable/);
            assert.equal(error.code,undefined);
            return true;
        });
        assert.equal((await reconcileInstallationChildren(f.home,f.ownerId)).cleanup,'confirmed');
        f.completed=true;
    } finally { await clean(f); }
});

for (const kind of ['full', 'io', 'untyped']) test(`actual handshake failure transports ${kind} to installation recovery`, async () => {
    const f = await fixture('', 'handshake');
    const activation = path.join(f.home,'activation.json');
    const journal = {format:1,id:f.ownerId,phase:'COMMITTED',payloadId:f.payloadId,hadDatabase:false,
        databasePromoted:false,childProfile:'installation-child/v1'};
    try {
        const dist = path.join(f.home,'versions',f.payloadId,'dist');
        await fs.mkdir(path.join(dist,'controller'),{mode:0o700});
        await fs.copyFile(new URL('../../dist/installation/handshake.js',import.meta.url),path.join(dist,'installation/handshake.js'));
        for (const module of ['controller/ownership','installation/child']) {
            const dependency = new URL('../../dist/'+module+'.js',import.meta.url);
            await fs.writeFile(path.join(dist,module+'.js'),`export * from ${JSON.stringify(dependency.href)};`,{mode:0o600});
        }
        const fault = {
            full: `import { DatabaseSync } from 'node:sqlite';
                export function openController() {
                    const db = new DatabaseSync(':memory:');
                    try { db.exec('CREATE TABLE fixture(value); PRAGMA max_page_count=2; INSERT INTO fixture VALUES (zeroblob(8192));'); }
                    finally { db.close(); }
                }`,
            io: `export function openController() { throw Object.assign(Error('disk I/O error'), {code:'ERR_SQLITE_ERROR', errcode:778}); }`,
            untyped: `export function openController() { throw Error('disk I/O error — mentions ENOSPC'); }`,
        }[kind];
        await fs.writeFile(path.join(dist,'controller/index.js'),fault,{mode:0o600});
        await fs.writeFile(activation,JSON.stringify(journal),{mode:0o600});
        await assert.rejects(execute(process.execPath,[installer.pathname,'recover','--home',f.home]), error => {
            assert.equal(error.code,2);
            const report = JSON.parse(error.stderr);
            assert.equal(report.error,'INSTALLATION_UNAVAILABLE');
            assert.match(report.message,/INSTALLED_HANDSHAKE_UNAVAILABLE/);
            assert.match(report.recovery,{full:/Free space.*SQLite/,io:/available and writable.*Recover any pending activation/,untyped:/Retain owned state/}[kind]);
            return true;
        });
        assert.deepEqual(JSON.parse(await fs.readFile(activation,'utf8')),journal);
        const proof = await reconcileInstallationChildren(f.home,f.ownerId);
        assert.equal(proof.cleanup,'confirmed');
        assert.equal(proof.commands.length,1);
        f.completed=true;
    } finally { await clean(f); }
});
