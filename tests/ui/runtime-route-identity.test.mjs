import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';
import { routeIdentity, buildImage } from '../../runtime/setup.mjs';
async function world(t) {
    const root = await temporaryDirectory('selected-docker-route'), config = path.join(root, 'config');
    await fs.mkdir(config, { mode: 0o700 });
    await fs.writeFile(path.join(config, 'config.json'), '{"auths":{}}\n', { mode: 0o600 });
    const contexts = {};
    for (const name of ['A', 'B']) {
        const meta = path.join(config, 'contexts/meta', name), tls = path.join(config, 'contexts/tls', name);
        await fs.mkdir(meta, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(meta, 'meta.json'), JSON.stringify({ Name: name, Endpoints: { docker: { Host: 'unix:///owned-' + name, SkipTLSVerify: false } } }), { mode: 0o600 });
        contexts[name] = { Name: name, Docker: { Host: 'unix:///owned-' + name, SkipTLSVerify: false }, Storage: { MetadataPath: meta, TLSPath: tls } };
    }
    const input = { dockerBinary: '/usr/bin/false', dockerConfigDirectory: config, dockerContext: 'A' }, calls = [], output = [];
    let passed = false;
    t.after(async () => { if (passed)
        await fs.rm(root, { recursive: true, force: true });
    else
        t.diagnostic('Retained selected route ' + root); });
    const options = { env: { HOME: root, PATH: '/usr/bin:/bin', DOCKER_HOST: 'tcp://unselected.invalid', DOCKER_CONTEXT: 'AMBIENT' }, onOutput: text => output.push(text), execute: async (file, args, options) => { assert.equal(file, input.dockerBinary); assert.deepEqual(args.slice(0, 4), ['--config', config, 'context', 'inspect']); assert.equal(options.env.DOCKER_HOST, undefined); assert.equal(options.env.DOCKER_CONTEXT, undefined); calls.push(args); const name = args.at(-1); return { stdout: JSON.stringify(name === 'default' ? { Name: 'default', Docker: { Host: 'unix:///var/run/docker.sock', SkipTLSVerify: false }, Storage: { MetadataPath: '<IN MEMORY>', TLSPath: '<IN MEMORY>' } } : contexts[name]) + '\n' }; } };
    return { root, config, input, contexts, calls, output, options, pass() { passed = true; } };
}
test('selected route ignores unrelated context bytes, auxiliaries and build cache without weakening selected metadata', async (t) => {
    const f = await world(t), before = await routeIdentity(f.input, f.options);
    await fs.symlink(f.root, path.join(f.contexts.B.Storage.MetadataPath, 'old-validation-link'));
    await fs.appendFile(path.join(f.contexts.B.Storage.MetadataPath, 'meta.json'), '\n');
    await fs.mkdir(path.join(f.config, 'buildx'));
    await fs.writeFile(path.join(f.contexts.A.Storage.MetadataPath, 'ignored-auxiliary'), 'does not select a route');
    assert.equal(await routeIdentity(f.input, f.options), before);
    assert.ok(f.calls.length >= 2);
    await fs.appendFile(path.join(f.contexts.A.Storage.MetadataPath, 'meta.json'), '\n');
    assert.notEqual(await routeIdentity(f.input, f.options), before);
    f.pass();
});
test('context catalogue binds metadata roster and files but never unrelated TLS or metadata auxiliaries', async (t) => {
    const f = await world(t), catalogue = { dockerBinary: f.input.dockerBinary, dockerConfigDirectory: f.config }, before = await routeIdentity(catalogue, f.options);
    await fs.mkdir(f.contexts.B.Storage.TLSPath, { recursive: true });
    await fs.symlink(f.root, path.join(f.contexts.B.Storage.TLSPath, 'old-link'));
    await fs.symlink(f.root, path.join(f.contexts.B.Storage.MetadataPath, 'old-aux-link'));
    assert.equal(await routeIdentity(catalogue, f.options), before);
    assert.equal(f.calls.length, 0);
    const meta = path.join(f.config, 'contexts/meta/C');
    await fs.mkdir(meta);
    await fs.writeFile(path.join(meta, 'meta.json'), '{"Name":"C"}', { mode: 0o600 });
    assert.notEqual(await routeIdentity(catalogue, f.options), before);
    f.pass();
});
test('default context uses only its actual in-memory route and common config', async (t) => {
    const f = await world(t), input = { ...f.input, dockerContext: 'default' }, before = await routeIdentity(input, f.options);
    await fs.symlink(f.root, path.join(f.contexts.A.Storage.MetadataPath, 'unrelated-link'));
    assert.equal(await routeIdentity(input, f.options), before);
    await fs.appendFile(path.join(f.config, 'config.json'), '\n');
    assert.notEqual(await routeIdentity(input, f.options), before);
    f.pass();
});
for (const kind of ['metadata', 'tls', 'parent'])
    test('selected unsafe ' + kind + ' refuses after metadata observation and before any engine work', async (t) => {
        const f = await world(t);
        if (kind === 'metadata') {
            const file = path.join(f.contexts.A.Storage.MetadataPath, 'meta.json');
            await fs.rm(file);
            await fs.symlink(path.join(f.contexts.B.Storage.MetadataPath, 'meta.json'), file);
        }
        else if (kind === 'tls') {
            await fs.mkdir(f.contexts.A.Storage.TLSPath, { recursive: true });
            await fs.symlink(f.root, path.join(f.contexts.A.Storage.TLSPath, 'key.pem'));
        }
        else {
            const meta = f.contexts.A.Storage.MetadataPath;
            await fs.rename(meta, meta + '-original');
            await fs.symlink(meta + '-original', meta);
        }
        let builds = 0;
        const execute = async (file, args, options) => { if (args.includes('inspect'))
            return f.options.execute(file, args, options); builds++; throw Error('Unsafe metadata reached engine build'); };
        await assert.rejects(buildImage(f.input, { ...f.options, execute }), /trusted|symbolic|canonical|directory/);
        assert.equal(builds, 0);
        f.pass();
    });
for (const kind of ['name', 'outside', 'memory'])
    test('public context observation refuses mismatched ' + kind + ' storage without fallback', async (t) => {
        const f = await world(t);
        if (kind === 'name')
            f.contexts.A.Name = 'B';
        if (kind === 'outside')
            f.contexts.A.Storage.MetadataPath = f.root;
        if (kind === 'memory')
            f.contexts.A.Storage = { MetadataPath: '<IN MEMORY>', TLSPath: '<IN MEMORY>' };
        await assert.rejects(routeIdentity(f.input, f.options), /selected|context|storage/iu);
        assert.equal(f.calls.length, 1);
        f.pass();
    });
test('metadata observation cancellation and unknown local cleanup remain original outcomes', async (t) => {
    const f = await world(t), abort = new AbortController();
    abort.abort(Error('ORIGINAL_OWNER_CANCELLED'));
    await assert.rejects(routeIdentity(f.input, { ...f.options, signal: abort.signal }), /ORIGINAL_OWNER_CANCELLED/);
    assert.equal(f.calls.length, 0);
    const unknown = Object.assign(Error('ORIGINAL_GROUP_UNSETTLED'), { code: 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN' });
    await assert.rejects(routeIdentity(f.input, { ...f.options, execute: async () => { throw unknown; } }), error => error === unknown);
    f.pass();
});

test('late cancellation leaves an already rejected metadata observation attributable', async t => {
    const f = await world(t), owner = new AbortController();
    const first = Error('First observation failed'), late = Error('Owner cancelled after failure');
    await assert.rejects(routeIdentity(f.input,{...f.options,signal:owner.signal,execute:()=>{
        const failure = Promise.reject(first);
        queueMicrotask(()=>owner.abort(late));
        return failure;
    }}),error=>error.code==='RUNTIME_ROUTE_METADATA_UNAVAILABLE'&&error.cause===first);
    f.pass();
});
test('failed metadata inspection never publishes opaque native diagnostics or routes', async (t) => {
    const f = await world(t);
    await assert.rejects(routeIdentity(f.input, { ...f.options, execute: async () => { throw Object.assign(Error('PRIVATE_NATIVE_DIAGNOSTIC'), { code: 'RUNTIME_PREPARATION_COMMAND_FAILED' }); } }), error => { assert.ok(!error.message.includes('PRIVATE_NATIVE_DIAGNOSTIC')); assert.match(error.message, /context|metadata/); return true; });
    assert.ok(!f.output.join('').includes('PRIVATE_NATIVE_DIAGNOSTIC'));
    f.pass();
});
test('absent selected TLS retains existing parent authority without binding unrelated children', async (t) => {
    const f = await world(t);
    const parent = path.dirname(f.contexts.A.Storage.TLSPath);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const before = await routeIdentity(f.input, f.options);
    await fs.mkdir(path.join(parent, 'unrelated'));
    assert.equal(await routeIdentity(f.input, f.options), before);
    await fs.rename(parent, parent + '-previous');
    await fs.mkdir(parent, { mode: 0o700 });
    assert.notEqual(await routeIdentity(f.input, f.options), before);
    f.pass();
});
test('owner revocation during metadata inspection retains its original error', async (t) => {
    const f = await world(t);
    const revoked = Error('ORIGINAL_SOURCE_REVOKED');
    let current = true;
    const options = {
        ...f.options,
        guard() { if (!current)
            throw revoked; },
        async execute() { current = false; throw Error('Native observer stopped'); },
    };
    await assert.rejects(routeIdentity(f.input, options), error => error === revoked);
    f.pass();
});
test('catalogue ignores direct non-directory auxiliaries without following them', async (t) => {
    const f = await world(t);
    const input = { dockerBinary: f.input.dockerBinary, dockerConfigDirectory: f.config };
    const before = await routeIdentity(input, f.options);
    const meta = path.join(f.config, 'contexts/meta');
    await fs.symlink(f.root, path.join(meta, 'old-validation-link'));
    await fs.writeFile(path.join(meta, 'auxiliary'), 'not context metadata', { mode: 0o666 });
    assert.equal(await routeIdentity(input, f.options), before);
    assert.equal(f.calls.length, 0);
    f.pass();
});
test('unconfirmed cleanup takes precedence over concurrent source revocation', async (t) => {
    const f = await world(t);
    const unknown = Object.assign(Error('ORIGINAL_GROUP_UNSETTLED'), { code: 'RUNTIME_DISCOVERY_CLEANUP_UNKNOWN' });
    let current = true;
    await assert.rejects(routeIdentity(f.input, {
        ...f.options,
        guard() { if (!current)
            throw Error('SOURCE_REVOKED'); },
        async execute() { current = false; throw unknown; },
    }), error => error === unknown);
    f.pass();
});

test('a named context with missing saved metadata stops before engine and build dispatch',async t=>{
    const f=await world(t);
    await fs.unlink(path.join(f.contexts.A.Storage.MetadataPath,'meta.json'));
    await assert.rejects(buildImage(f.input,{...f.options,temporaryRoot:f.root}),{code:'RUNTIME_ROUTE_METADATA_UNAVAILABLE'});
    assert.deepEqual(f.calls.map(args=>args[3]),['inspect']);
    f.pass();
});

test('route recheck preserves an owner cancellation even when the abort reason is null',async t=>{
    const f=await world(t),owner=new AbortController();
    await assert.rejects(buildImage(f.input,{...f.options,signal:owner.signal,temporaryRoot:f.root,execute:async(file,args,options)=>{
        if (args[2]==='context') return f.options.execute(file,args,options);
        if (args[4]==='version') return {stdout:'"owned-engine"'};
        assert.equal(args[4],'build');
        owner.abort(null);
    }}),error=>error===null);
    f.pass();
});

test('metadata loss after the build handoff refuses staging without treating the build as unstarted',async t=>{
    const f=await world(t);
    const phases=[];
    const rejected=Error('PRIVATE_CONTEXT_OBSERVATION');
    let buildRan=false;
    await assert.rejects(buildImage(f.input,{...f.options,temporaryRoot:f.root,execute:async(file,args,options)=>{
        const phase=args[2]==='context'?'inspect':args[4];
        phases.push(phase);
        if (phase==='inspect') {
            if (buildRan) throw rejected;
            return f.options.execute(file,args,options);
        }
        if (phase==='version') return {stdout:'"owned-engine"'};
        assert.equal(phase,'build');
        buildRan=true;
        await fs.writeFile(args[args.indexOf('--iidfile')+1], 'sha256:'+'a'.repeat(64));
    }}),error=>{
        assert.equal(error.code,'RUNTIME_PREPARATION_ROUTE_CHANGED');
        assert.equal(error.cause?.code,'RUNTIME_ROUTE_METADATA_UNAVAILABLE');
        assert.doesNotMatch(error.message,/PRIVATE_CONTEXT_OBSERVATION|build did not start/);
        return true;
    });
    assert.deepEqual(phases,['inspect','version','inspect','build','inspect']);
    f.pass();
});
