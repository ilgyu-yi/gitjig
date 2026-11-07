// Real owned ChildProcess events with controlled filesystem/engine premises.
// No Docker daemon, account or model request is used.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
const [root, mode] = process.argv.slice(2);
const binary = path.join(root, 'docker'), workRoot = path.join(root, 'work'), stateRoot = path.join(root, 'runtime'), config = path.join(root, 'config'), state = path.join(root, 'shim-state.json');
for (const file of [workRoot, stateRoot, config]) fs.mkdirSync(file, {mode: 0o700});
fs.writeFileSync(state, '{}');
const script = `#!${process.execPath}
import fs from 'node:fs';
const file=${JSON.stringify(state)},mode=${JSON.stringify(mode)},args=process.argv.slice(2),a=args.slice(args.indexOf('--context')+2),s=JSON.parse(fs.readFileSync(file));
if(a[0]==='info')console.log(JSON.stringify('OWNED-DAEMON'));
else if(a[0]==='create'){
 if(mode==='launched-127'){console.error('spawn client ENOENT');process.exitCode=127;}
 else{s.id='a'.repeat(64);s.labels=Object.fromEntries(a.flatMap((v,i)=>v==='--label'?[a[i+1].split('=')]:[]));fs.writeFileSync(file,JSON.stringify(s));console.log(s.id);}
}else if(a[0]==='inspect')console.log(JSON.stringify([{Id:s.id,Image:'owned',Config:{Labels:s.labels},State:{Running:false}}]));
else if(a[0]==='start')console.log(s.id);
else if(a[0]==='rm')console.log(s.id);
else if(a[0]==='exec')console.log('EXECUTED');
else process.exitCode=2;
`;
fs.writeFileSync(binary, ['missing-interpreter','governed-reopen','directory-sync-failure'].includes(mode) ? '#!' + path.join(root, 'absent-interpreter') + '\n' : script, {mode: 0o700});
if (mode === 'directory-sync-failure') {
    const open=fsp.open;
    let injected=false;
    fsp.open=async function(file,...args) {
        const handle=await open.call(this,file,...args);
        const journal=fs.readdirSync(stateRoot).find(name=>name.endsWith('.json'));
        if(!injected&&file===stateRoot&&journal&&JSON.parse(fs.readFileSync(path.join(stateRoot,journal))).state==='removed') {
            injected=true;
            return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{throw Error('CONTROLLED_DIRECTORY_SYNC_FAILURE');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
        }
        return handle;
    };
}
const originalSpawn = cp.spawn, events = [], originalPids = new Set();
let creates = 0;
cp.spawn = (file, args, options) => {
    assert.equal(file, binary);
    const command = args[args.indexOf('--context') + 2];
    if (command === 'create') {
        creates++;
        if (mode.endsWith('removed-before-create')) fs.unlinkSync(binary);
        if (mode.endsWith('permission-before-create')) fs.chmodSync(binary, 0o600);
        if (mode === 'persistence-failure') {
            fs.writeFileSync(binary, '#!' + path.join(root, 'absent-interpreter') + '\n');
            const name = fs.readdirSync(stateRoot).find(name => name.endsWith('.json'));
            fs.mkdirSync(path.join(stateRoot, name + '.next'));
        }
        if (mode === 'synchronous-lookalike') {
            const error = Object.assign(Error('spawn ' + binary + ' ENOENT'), {code:'ENOENT',errno:-2,syscall:'spawn '+binary,path:binary,spawnargs:args});
            throw error;
        }
    }
    if (command === 'exec' && mode === 'exec-not-started') fs.unlinkSync(binary);
    const child = originalSpawn(file, args, options);
    if (child.pid) originalPids.add(child.pid);
    events.push({event:'returned',command,pid:child.pid??null});
    for (const event of ['spawn','error','close']) child.on(event, (value, signal) => {
        events.push({event,command,pid:child.pid??null,...(event==='error'?{code:value.code,syscall:value.syscall,path:value.path}:{value,signal})});
    });
    return child;
};
syncBuiltinESMExports();
const {createScope, reconcileScope} = await import('../../dist/execution/container-scope.js');
const options = {dockerBinary:binary,dockerContext:'owned',...(mode==='missing-interpreter'?{}:{dockerConfigDirectory:config}),image:'sha256:'+'0'.repeat(64),workRoot,stateRoot,workId:'original-work',runId:'original-run'};
let error, scope, cleanup, governed, journalRoot = stateRoot;
try {
    if (mode.startsWith('governed-')) {
        const {openController} = await import('../../dist/controller/index.js');
        const {selectControllerModel} = await import('../../dist/cli/selected-model.js');
        globalThis.fetch = () => { throw Error('Provider request forbidden in no-start fixture'); };
        const home = path.join(root,'home'), auth = path.join(root,'dummy-auth.json'), profile = path.join(root,'model.json');
        fs.writeFileSync(path.join(workRoot,'consumer.txt'),'Original source');
        fs.writeFileSync(auth,JSON.stringify({openrouter:{type:'api_key',key:'DUMMY-NO-REQUEST'}}),{mode:0o600});
        fs.writeFileSync(profile,JSON.stringify({provider:'openrouter',modelId:'openai/gpt-4.1-mini',native:{kind:'pi-stored',credentialType:'api_key',authPath:auth}}),{mode:0o600});
        const runtime = {dockerBinary:binary,dockerContext:'owned',image:options.image};
        const c = await openController({installationHome:home,runtimeProfile:runtime});
        let workId;
        try {
            await c.registerProject({id:'P',sourceRoot:workRoot});
            ({workId}=await c.beginChange({projectId:'P',request:'Retain original failed-start work',executionLimit:6}));
            const model=await selectControllerModel(profile,c), view=await c.planChange({workId,model});
            assert.equal(view.state,'ACTIVE');assert.equal(view.phase,'BLOCKED');assert.equal(view.execution.consumed,2);assert.equal(view.execution.reserved,0);
            const launch=c.store.one('SELECT * FROM role_launches WHERE work=?',workId), run=c.store.one('SELECT * FROM runs WHERE id=?',launch.run);
            assert.equal(launch.status,'UNUSABLE');assert.equal(run.phase,'SETTLED');assert.equal(JSON.parse(run.data).cleanup,'removed');
            assert.equal(c.store.one('SELECT state FROM capacity_leases WHERE run=?',run.id).state,'RELEASED');
            governed={home,workId,view,launch,run};
        } finally { await c.close(); }
        // Reopening reads original settled records without executing the client
        // or creating another work/role. It does not fabricate role success.
        const eventCount=events.length,reopened=await openController({installationHome:home});
        try {
            const view=reopened.inspectChange(workId);assert.equal(view.state,'ACTIVE');assert.equal(view.execution.consumed,2);
            assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM works').n,1);
            assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM role_launches').n,1);
            assert.equal(events.length,eventCount);governed.reopened=view;
        } finally { await reopened.close(); }
        journalRoot=path.join(home,'state/runtime');
    } else {
        scope = await createScope(options);
        if (mode === 'exec-not-started') {
            await assert.rejects(scope.execute('owned command'), /ENOENT/);
            cleanup = await scope.close();
        }
    }
} catch (value) { error = {message:value.message,causeCode:value.cause?.code,errors:value.errors?.map(e=>e.message)}; }
const file = path.join(journalRoot,fs.readdirSync(journalRoot).find(n=>n.endsWith('.json'))), journal = JSON.parse(fs.readFileSync(file));
if (['missing-interpreter','removed-before-create','permission-before-create','directory-sync-failure'].includes(mode)) {
    if(mode==='directory-sync-failure') {
        assert.match(error.message,/settlement could not be persisted/);
        assert.ok(error.errors.some(message=>/ENOENT/.test(message)));
        assert.ok(error.errors.includes('CONTROLLED_DIRECTORY_SYNC_FAILURE'));
        assert.equal(journal.nativeCleanupUnknown,undefined);
    } else assert.match(error.message, /ENOENT|EACCES/);
    assert.equal(journal.state,'removed');
    assert.equal(journal.createAdmission.kind,'native-executable-not-started');
    assert.deepEqual(journal.createAdmission.observed,{spawn:false,pid:null,closed:true,outputBytes:0});
    if(mode!=='directory-sync-failure') assert.equal(journal.createAdmission.error.code,error.causeCode);
    // A durable terminal receipt needs no executable or engine on reopen.
    assert.equal((await reconcileScope(file,binary,options.dockerConfigDirectory)).state,'removed');
} else {
    if(mode.startsWith('governed-')) { assert.equal(error,undefined);assert.equal(journal.state,'removed');assert.equal(journal.createAdmission.kind,'native-executable-not-started'); }
    else assert.equal(journal.createAdmission,undefined);
    if (mode === 'exec-not-started') { assert.equal(cleanup.state,'quarantined');assert.equal(journal.id,'a'.repeat(64)); }
    else if (mode === 'launched-127') { assert.equal(journal.state,'quarantined');assert.equal(journal.createOutcome.exitCode,127); }
    else if(!mode.startsWith('governed-')) assert.equal(journal.state,'creating');
}
assert.equal(creates,1);
for (const pid of originalPids) for (const operand of [pid,-pid]) assert.throws(()=>process.kill(operand,0),{code:'ESRCH'});
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({mode,journal,error,cleanup,governed,events,originalPids:[...originalPids],limits:'Owned actual native exec-error events and controlled engine replies only. No real container/provider or original Team work recovery.'},null,2));
