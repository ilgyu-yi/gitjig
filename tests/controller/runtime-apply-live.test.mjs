import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {runtimeFixtureProfile, runtimeFixtureConfig, runtimeFixtureRoot} from '../runtime/profile.mjs';

const exec = promisify(execFile);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const ready = '/tmp/gitjig-runtime-switch-ready', release = '/tmp/gitjig-runtime-switch-release';
const command = label => 'node hold.cjs ' + label;

test('live runtime replacement isolates two real local checks and cleans up on their original routes', {timeout:60000}, async t => {
    const selected = runtimeFixtureProfile(), selectedConfig = runtimeFixtureConfig();
    const root = await fs.mkdtemp(path.join(await runtimeFixtureRoot(),'live-runtime-replacement-'));
    const controllerAbort = new AbortController(), tasks = [];
    let c, passed = false;
    t.after(async () => {
        controllerAbort.abort();
        try {
            await Promise.allSettled(tasks);
            await c?.close();
        } finally {
            if (passed) await fs.rm(root,{recursive:true,force:true});
            else t.diagnostic('Retained real runtime replacement fixture '+root);
        }
    });
    const home = path.join(root,'home'), source = path.join(root,'source');
    const docker = await fs.realpath(selected.dockerBinary), nativeTrace = path.join(root,'native.trace');
    const env = {HOME:root,PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
    const run = async (args) => (await exec(docker,args,{env,timeout:4000,maxBuffer:2**20})).stdout.trim();
    const onSelected = (...args) => run(['--config',selectedConfig,'--context',selected.dockerContext,...args]);
    const inventory = async () => (await onSelected('ps','--all','--quiet','--no-trunc')).split('\n').filter(Boolean);
    const endpoint = await onSelected('context','inspect',selected.dockerContext,'--format','{{.Endpoints.docker.Host}}');
    assert.match(endpoint,/^unix:\/\/\/[^\r\n]+$/u,'Live replacement fixture requires an explicit local Unix Docker endpoint');
    const engine = await onSelected('info','--format','{{.ID}}');
    assert.ok(engine);
    assert.equal(await onSelected('image','inspect','--format','{{.Id}}',selected.image),selected.image);
    const before = await inventory();
    await fs.mkdir(source,{mode:0o700});
    const script = [
        "const fs = require('node:fs');",
        "const label = process.argv[2];",
        "fs.writeFileSync("+JSON.stringify(ready)+",label);",
        "const deadline = Date.now() + 25000;",
        "const poll = setInterval(() => {",
        "    if (Date.now() >= deadline) process.exit(3);",
        "    if (!fs.existsSync("+JSON.stringify(release)+")) return;",
        "    clearInterval(poll);",
        "    console.log('original '+label+' completed');",
        "},25);",
    ].join('\n');
    await fs.writeFile(path.join(source,'hold.cjs'),script);
    const client = path.join(root,'reviewed-docker');
    await fs.writeFile(client,[
        '#!/bin/sh',
        '{ printf "%s\\t" "$@"; printf "\\n"; } >> '+quote(nativeTrace),
        'exec '+quote(docker)+' "$@"',
    ].join('\n')+'\n',{mode:0o700});

    async function route(label, cpus, memoryMiB) {
        const config = path.join(root,'docker-'+label), context = 'runtime-switch-'+label.toLowerCase();
        await fs.mkdir(config,{mode:0o700});
        await run(['--config',config,'context','create',context,'--docker','host='+endpoint]);
        const native = (...args) => run(['--config',config,'--context',context,...args]);
        assert.equal(await native('info','--format','{{.ID}}'),engine);
        return {native, profile:{dockerBinary:client,dockerContext:context,dockerConfigDirectory:config,image:selected.image,cpus,memoryMiB}};
    }
    const a = await route('A',0.5,128), b = await route('B',1,192);
    c = await openController({installationHome:home,runtimeProfile:a.profile,capacityLimit:2});
    const startup = ApplicationStartup.open(c);
    await c.registerProject({id:'P',sourceRoot:source});
    const cid = c.createConversation({projectId:'P'}).conversationId, draft = 'Unsent original request · 한글';
    c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    await startup.save({version:1,runtime:a.profile});

    async function inspect(scope, id) {
        return JSON.parse(await scope.native('inspect','--format','{{json .}}',id));
    }
    async function park(label, scope) {
        const pending = c.runLocalCheck({projectId:'P',command:command(label),signal:controllerAbort.signal});
        tasks.push(pending);
        let terminal;
        void pending.then(result=>{terminal=result;},error=>{terminal=error;});
        const deadline = Date.now()+12000;
        while (Date.now()<deadline && !terminal) {
            const row = c.store.one("SELECT id,work,data FROM runs WHERE json_extract(data,'$.raw')=?",command(label));
            if (row) {
                const id = await scope.native('ps','--quiet','--no-trunc','--filter','label=gitjig.run='+row.id);
                if (/^[0-9a-f]{64}$/u.test(id) && await scope.native('exec',id,'node','-p',
                    'require("fs").existsSync('+JSON.stringify(ready)+')').catch(()=>false) === 'true') {
                    const item = await inspect(scope,id);
                    assert.equal(item.Config.Labels['gitjig.work'],row.work);
                    assert.equal(item.Image,scope.profile.image);
                    assert.equal(item.HostConfig.NanoCpus,scope.profile.cpus*1e9);
                    assert.equal(item.HostConfig.Memory,scope.profile.memoryMiB*1024*1024);
                    const captured = JSON.parse(row.data).profile;
                    for (const [key,value] of Object.entries(scope.profile)) assert.equal(captured[key],value,key);
                    return {scope,id,runId:row.id,pending};
                }
            }
            await delay(50);
        }
        assert.fail('Local check did not reach its owned running scope: '+JSON.stringify(terminal));
    }
    const original = await park('A',a);
    await (await startup.prepareRuntimeEdit()).save(b.profile);
    assert.equal((await startup.inspect()).effective.runtime.dockerContext,b.profile.dockerContext);
    const replacement = await park('B',b);
    assert.notEqual(original.id,replacement.id);

    async function finish(held, label) {
        await held.scope.native('exec',held.id,'node','-e','require("fs").writeFileSync('+JSON.stringify(release)+',"done")');
        const result = await held.pending;
        assert.equal(result.runId,held.runId);
        assert.equal(result.status,'succeeded',result.stderr);
        assert.equal(result.cleanup,'removed');
        assert.match(result.stdout,new RegExp('original '+label+' completed'));
        const journalFiles = await fs.readdir(path.join(home,'state/runtime'));
        const journals = await Promise.all(journalFiles.filter(name=>name.endsWith('.json')).map(async name=>
            JSON.parse(await fs.readFile(path.join(home,'state/runtime',name),'utf8'))));
        const record = journals.find(item=>item.runId===held.runId);
        assert.equal(record?.state,'removed');
        assert.equal(record.id,held.id);
        assert.equal(record.context,held.scope.profile.dockerContext);
        assert.equal(record.dockerConfigDirectory,held.scope.profile.dockerConfigDirectory);
        assert.ok(!(await inventory()).includes(held.id));
    }
    await finish(replacement,'B');
    const remaining = await inspect(a,original.id);
    assert.equal(remaining.State.Running,true);
    assert.equal(remaining.HostConfig.NanoCpus,a.profile.cpus*1e9);
    assert.equal(remaining.HostConfig.Memory,a.profile.memoryMiB*1024*1024);
    await finish(original,'A');
    const argv = (await fs.readFile(nativeTrace,'utf8')).trimEnd().split('\n').map(line=>line.trimEnd().split('\t'));
    for (const {scope,id,runId} of [original,replacement]) {
        const applies = args => args[1]===scope.profile.dockerConfigDirectory && args[3]===scope.profile.dockerContext;
        assert.ok(argv.some(args=>applies(args) && args[4]==='create' && args.includes('gitjig.run='+runId)));
        const removals = argv.filter(args=>args[4]==='rm' && args.includes(id));
        assert.equal(removals.length,1);
        assert.ok(applies(removals[0]));
    }
    assert.ok(before.every(id => id !== original.id && id !== replacement.id));
    const after = await inventory();
    assert.ok(before.every(id=>after.includes(id)));
    assert.equal(c.inspectConversation(cid).draft.text,draft);
    assert.deepEqual(await fs.readdir(source),['hold.cjs']);
    assert.equal(await fs.readFile(path.join(source,'hold.cjs'),'utf8'),script);
    assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n,2);
    await c.close();
    passed = true;
});
