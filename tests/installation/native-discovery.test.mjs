// Read-only existing-engine qualification through the bound installed terminal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {managedFixtureInputs, assertCurrentBuild} from './managed-installed-fixture.mjs';

const execute = promisify(execFile);
test('installed terminal discovers existing native contexts/images, cancels safely and saves for relaunch without execution authority', {timeout: 120000}, async t => {
    const {runtime, shared, built} = await managedFixtureInputs();
    const root = await fs.realpath(await fs.mkdtemp(path.join(shared, 'native-discovery-installed-')));
    t.diagnostic('Retained actual native discovery world: ' + root);
    const home = path.join(root, 'application'), user = path.join(root, 'user');
    await fs.mkdir(user, {mode: 0o700});
    const env = {HOME: user, PATH: '/usr/bin:/bin', TMPDIR: path.join(home, 'artifacts'), USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture',
        DOCKER_HOST: 'tcp://127.0.0.1:1', DOCKER_CONTEXT: 'AMBIENT_MUST_NOT_USE', DOCKER_CONFIG: '/AMBIENT_MUST_NOT_USE',
        LANG: 'C.UTF-8', TERM: 'xterm-256color', SHELL: '/bin/sh', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: ''};
    await execute(path.join(built.destination, 'install'), ['activate', '--bundle', built.destination, '--home', home], {cwd: root, env, timeout: 60000, maxBuffer: 2 ** 20});
    const payload = path.join(home, 'versions', built.payloadId), node = path.join(home, 'bootstrap/node');
    const binary = await fs.realpath(runtime.dockerBinary), config = runtime.dockerConfigDirectory;
    const savedFile = path.join(home, 'config/startup.json'), calls = path.join(root, 'native-calls.jsonl');
    await assert.rejects(fs.access(savedFile), {code: 'ENOENT'});
    const guard = path.join(root, 'guard.mjs');
    await fs.writeFile(guard, `import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import net from 'node:net';import {registerHooks,syncBuiltinESMExports} from 'node:module';import {fileURLToPath} from 'node:url';
const payload=${JSON.stringify(payload)},calls=${JSON.stringify(calls)},binary=${JSON.stringify(binary)},config=${JSON.stringify(config)},context=${JSON.stringify(runtime.dockerContext)},spawn=cp.spawn;
let denied=0;const no=()=>{denied++;throw Error('Only explicitly selected native discovery reads allowed');};globalThis.fetch=no;net.Socket.prototype.connect=no;
registerHooks({load(url,ctx,next){if(url.startsWith('file:')){if(!fileURLToPath(url).startsWith(payload+path.sep))throw Error('Payload-only module required: '+url);fs.appendFileSync(${JSON.stringify(path.join(root, 'modules.jsonl'))},JSON.stringify({phase:process.env.GITJIG_DISCOVERY_PHASE,pid:process.pid,url})+'\\n',{mode:0o600});}return next(url,ctx);}});
cp.spawn=function(file,args,options){const contexts=['--config',config,'context','ls','--quiet'],images=['--config',config,'--context',context,'image','ls','--no-trunc','--format','{{json .}}'];if(file!==binary||![contexts,images].some(expected=>JSON.stringify(args)===JSON.stringify(expected)))return no();if(options.env.DOCKER_HOST||options.env.DOCKER_CONTEXT||options.env.DOCKER_CONFIG)return no();const started=Date.now(),child=spawn.call(this,file,args,options);let stdout='';child.stdout.on('data',bytes=>{if(stdout.length<1048576)stdout+=bytes;});fs.appendFileSync(calls,JSON.stringify({kind:'start',pid:process.pid,child:child.pid,file,args,environment:options.env})+'\\n',{mode:0o600});child.once('close',(code,signal)=>fs.appendFileSync(calls,JSON.stringify({kind:'close',pid:process.pid,child:child.pid,code,signal,stdout,milliseconds:Date.now()-started})+'\\n',{mode:0o600}));return child;};
for(const key of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=no;syncBuiltinESMExports();process.on('exit',()=>{fs.appendFileSync(${JSON.stringify(path.join(root, 'processes.jsonl'))},JSON.stringify({phase:process.env.GITJIG_DISCOVERY_PHASE,pid:process.pid,node:process.execPath,denied})+'\\n',{mode:0o600});if(denied)process.exitCode=1;});`, {mode: 0o600});
    const empty = ['works', 'runs', 'budgets', 'conversation_inputs'].map(table => ({sql: 'SELECT COUNT(*) FROM ' + table, rows: [[0]]}));
    const receipts = [];
    const run = async (label, steps) => {
        const file = path.join(root, label + '.json'), started = performance.now();
        await fs.writeFile(file, JSON.stringify({command: [node, '--import', guard, path.join(payload, 'dist/installation/entry.js')], env: {...env,GITJIG_DISCOVERY_PHASE:label}, steps,
            timeoutSeconds: 14, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output: file + '.terminal', gracefulShutdownSeconds: 3}), {mode: 0o600});
        try {
            const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout: 20000, maxBuffer: 2 ** 20})).stdout);
            assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
            const processes = (await fs.readFile(path.join(root, 'processes.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).filter(row => row.phase === label);
            assert.equal(processes.length, 1); const bound = processes[0]; assert.equal(bound.node, node); assert.equal(bound.denied, 0);
            assert.throws(() => process.kill(bound.pid, 0), {code: 'ESRCH'});
            const modules = (await fs.readFile(path.join(root, 'modules.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).filter(row => row.phase === label);
            assert.ok(modules.length > 0); assert.ok(modules.every(row => row.pid === bound.pid && row.url.startsWith('file://' + payload + '/')));
            for (const name of ['installation/entry.js','ui/runtime-fields.js','execution/runtime-discovery.js','app/startup.js']) assert.ok(modules.some(row => row.url.endsWith('/dist/' + name)), label + ' actual module ' + name);
            receipts.push({label, milliseconds: performance.now() - started, ...result, bound, loadedModules: modules.length});
        } catch (error) {t.diagnostic((await fs.readFile(file + '.terminal', 'utf8').catch(() => '')).slice(-4500)); throw error;}
    };
    const discover = [
        {wait: 'Model: not selected', send: '\x15/setup runtime\x1b\r'},
        {wait: 'Runtime setup · staged', send: 'Choose Docker context\r'},
        {wait: 'Explicit Docker discovery', send: '\x1b'},
        {wait: 'Docker executable', send: binary + '\r'},
        {wait: 'Docker configuration directory', send: config + '\r'},
        {wait: 'Observed contexts', send: runtime.dockerContext + '\r'},
        {wait: 'Runtime setup · staged', send: 'Choose existing runtime image\r'},
        {wait: 'Explicit Docker discovery', send: '\x1b'},
        {wait: 'Docker executable', send: '\r'},
        {wait: 'Docker context', send: '\r'},
        {wait: 'Docker configuration directory', send: '\r'},
        {wait: 'Observed images', send: runtime.image.slice(7, 19) + '\r'}
    ];
    await run('cancel', [...discover, {wait: 'Runtime setup · staged', queries: empty, send: 'Cancel\r'}, {wait: 'INPUT', assertDraft: '/setup runtime', send: '\x15/quit\x1b\r'}]);
    await assert.rejects(fs.access(savedFile), {code: 'ENOENT'});
    await run('save', [...discover,
        {wait: 'Runtime setup · staged', send: 'Review and save runtime\r'},
        {wait: 'Review next-launch runtime setup', queries: empty, send: '\x1b'},
        {wait: 'Explicit runtime setup action', send: 'Save runtime for next launch\r'},
        {wait: 'Runtime saved for next launch', queries: empty, send: '\x15/setup inspect\x1b\r'},
        {wait: 'Startup · restart required', send: '\x1b'}, {wait: 'INPUT', send: '\x15/quit\x1b\r'}]);
    const saved = JSON.parse(await fs.readFile(savedFile, 'utf8'));
    assert.deepEqual(saved.runtime, {dockerBinary: binary, dockerConfigDirectory: config, dockerContext: runtime.dockerContext, image: runtime.image});
    const before = await fs.readFile(calls);
    await run('relaunch', [{wait: 'Model: not selected', send: '\x15/setup inspect\x1b\r'},
        {wait: 'Sources · {"runtime":"saved","bridge":"none"}', queries: empty, send: '\x1b'}, {wait: 'INPUT', send: '\x15/quit\x1b\r'}]);
    assert.deepEqual(await fs.readFile(calls), before, 'Relaunch does not discover or execute automatically');
    const native = before.toString().trim().split('\n').map(JSON.parse);
    assert.equal(native.filter(row => row.kind === 'start').length, 4);
    const starts = native.filter(row => row.kind === 'start');
    const closed = native.filter(row => row.kind === 'close'); assert.equal(closed.length, 4);
    for (const row of closed) {assert.equal(row.code, 0); assert.equal(row.signal, null); assert.throws(() => process.kill(row.child, 0), {code: 'ESRCH'});}
    for (const row of starts) {const observed = closed.find(item => item.child === row.child);
        assert.ok(observed);
        if (row.args[2] === 'context') assert.ok(observed.stdout.trim().split('\n').includes(runtime.dockerContext));
        else assert.ok(observed.stdout.trim().split('\n').map(JSON.parse).some(image => image.ID === runtime.image));
    }
    const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly: true});
    try {for (const table of ['works', 'runs', 'budgets', 'conversation_inputs', 'effect_operations', 'effect_delegations']) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0);}
    finally {db.close();}
    await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({root, payload, payloadId: built.payloadId, runtime, saved, receipts, native}, null, 2), {mode: 0o600});
    await assertCurrentBuild(built);
});
