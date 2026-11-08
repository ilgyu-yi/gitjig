import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {createHash} from 'node:crypto';
import {fixture as acceptanceFixture} from '../platform/acceptance-fixture.mjs';
import {installedQualification} from './qualification-sidecar.mjs';

const execute = promisify(execFile);
test('one-command installer produces an independent global snapshot, preserves homes on update/removal and refuses bound state', { timeout: 180000 }, async t => {
    const source = await fs.realpath('.');
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-npm-global-')));
    const prefix = path.join(root, 'prefix with spaces'), user = path.join(root, 'user'), home = path.join(root, 'application home');
    await fs.mkdir(user, { mode: 0o700 });
    const env = { ...process.env, HOME: user, GITJIG_HOME: home, TMPDIR: root,
        PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
        npm_config_cache: process.env.npm_config_cache ?? path.join(os.homedir(), '.npm'), npm_config_offline: 'true',
        npm_config_userconfig: path.join(root, 'empty-npmrc'), NODE_OPTIONS: '', NODE_PATH: '' };
    const command = path.join(prefix, 'bin/gitjig');
    const run = (file, args, extra = {}) => execute(file, args, { cwd: root, env, timeout: 90000, maxBuffer: 2 ** 22, ...extra });
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained npm global fixture: ' + root); });
    const install = await run(process.execPath, [path.join(source, 'install.mjs'), '--prefix', prefix]);
    assert.match(install.stdout, /Installed:/);
    assert.match(install.stdout, /PATH setup remains:/);
    await assert.rejects(fs.access(home), { code: 'ENOENT' });
    const payload = path.join(prefix, 'lib/node_modules/gitjig');
    assert.ok((await fs.realpath(command)).startsWith(payload + path.sep), 'command uses installed snapshot, not checkout');
    for (const file of ['dist/cli/entry.js', 'docs/requirements.md', 'MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'node_modules/@gitjig/pi-claude-bridge-host/package.json']) await fs.access(path.join(payload, file));
    for (const file of ['src', 'tests', 'qualification', '.qualification', 'dist/controller/testing.js', 'dist/controller/acceptance.js', 'dist/platform/github-acceptance.js', 'dist/effects/acceptance-synthetic.js', 'development', '.git', 'AGENTS.md', 'CONTRIBUTING.md', 'node_modules/typescript']) await assert.rejects(fs.access(path.join(payload, file)), { code: 'ENOENT' });
    // Copy only installed recipe assets to a dedicated context outside checkout ancestry.
    const recipe = ['Dockerfile', 'Dockerfile.dockerignore', 'io-helper.mjs'];
    const context = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-image-context-')));
    t.after(async () => { if (passed) await fs.rm(context, {recursive:true, force:true}); else t.diagnostic('Retained image context: ' + context); });
    for (const name of recipe) {
        const installed = await fs.readFile(path.join(payload, 'runtime', name));
        assert.deepEqual(installed, await fs.readFile(path.join(source, 'runtime', name)), 'packaged runtime bytes ' + name);
        await fs.writeFile(path.join(context, name), installed, {mode:0o600});
    }
    assert.deepEqual((await fs.readdir(context)).sort(), recipe.sort());
    assert.equal(await fs.readFile(path.join(context, 'Dockerfile.dockerignore'), 'utf8'), '**\n!Dockerfile\n!Dockerfile.dockerignore\n!io-helper.mjs\n');
    const dockerfile = await fs.readFile(path.join(context, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /^FROM node@sha256:[a-f0-9]{64}$/m);
    assert.match(dockerfile, /^COPY io-helper\.mjs \/opt\/gitjig\/io-helper\.mjs$/m);
    assert.doesNotMatch(dockerfile, /(?:COPY|ADD)\s+\.|src\//);
    await run(process.execPath, ['--check', path.join(context, 'io-helper.mjs')], {cwd:context});
    const helper = path.join(context, 'io-helper.mjs'), protectedFile = path.join(root, 'must-remain');
    await fs.writeFile(protectedFile, 'UNCHANGED');
    for (const op of ['read', 'write']) {
        const result = spawnSync(process.execPath, [helper], {cwd:context, env, input:JSON.stringify({op, path:protectedFile, data:Buffer.from('changed').toString('base64'), maxBytes:1024}), timeout:2000, maxBuffer:65536, encoding:'utf8'});
        assert.equal(result.error, undefined); assert.equal(result.status, 1);
        assert.deepEqual(JSON.parse(result.stdout), {ok:false, error:'path outside declared access', code:'IO_ERROR'});
        assert.equal(await fs.readFile(protectedFile, 'utf8'), 'UNCHANGED');
    }
    const identity = JSON.parse((await run(command, ['--version'])).stdout);
    assert.equal(identity.application, 'gitjig'); assert.equal(identity.piSdkVersion, '1.3.0');
    assert.match((await run(command, ['--help'], { env: { ...env, GITJIG_HOME: 'invalid-relative-home' } })).stdout, /gitjig/);
    const diagnosis = JSON.parse((await run(command, ['doctor'])).stdout);
    assert.equal(diagnosis.node.compatible, true); assert.equal(diagnosis.applicationReady, true);
    assert.equal(diagnosis.projectExecutionReady, false); assert.equal(diagnosis.prerequisitesReady, true);
    // Explicit external qualification uses actual installed modules; nothing is copied into the payload.
    const qualified = installedQualification(payload), fixture = await acceptanceFixture();
    t.after(() => fixture.close());
    const snapshot = async () => {
        const rows = [];
        async function visit(relative) {
            const file = path.join(payload, relative), info = await fs.lstat(file);
            if (info.isSymbolicLink()) rows.push([relative, 'symlink', info.mode, await fs.readlink(file)]);
            else if (info.isDirectory()) { rows.push([relative, 'directory', info.mode]); for (const name of (await fs.readdir(file)).sort()) await visit(path.join(relative, name)); }
            else rows.push([relative, info.mode, createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
        }
        await visit(''); return rows;
    };
    const payloadBefore = await snapshot(), worker = path.join(root, 'installed-qualification.mjs');
    await fs.writeFile(worker, `
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const payload = ${JSON.stringify(pathToFileURL(payload + path.sep).href)}, loaded = [];
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url?.includes('/dist/')||result.url?.includes('/node_modules/@earendil-works/')){assert.ok(result.url.startsWith(payload),'No checkout product/SDK fallback: '+result.url);loaded.push(result.url);}return result;}});
const {openController} = await import(${JSON.stringify(pathToFileURL(path.join(payload,'dist/controller/index.js')).href)});
const {createOwnedAcceptanceSetup,acceptanceContextResources} = await import(${JSON.stringify(pathToFileURL(path.join(payload,'dist/platform/hosted-context.js')).href)});
const {configureCreatedAcceptance} = await import(${JSON.stringify(qualified.url('controller-acceptance.js'))});
assert.throws(()=>acceptanceContextResources({kind:'local-exact-created-acceptance/v1',credentialSessionId:'forged',target:{}}));
const options=${JSON.stringify(fixture.setupOptions)}, pending=createOwnedAcceptanceSetup(options);
options.token='caller-mutation-before-sidecar-load';
const setup=await pending; let controller;
try{const context=await setup.create();controller=await openController({installationHome:${JSON.stringify(path.join(root,'qualification home'))}});const result=configureCreatedAcceptance(controller,context);assert.equal(result.credentialSessionId,context.credentialSessionId);assert.equal(result.activation,'created-private-local-acceptance');await controller.close();controller=undefined;await setup.close();assert.throws(()=>acceptanceContextResources(context));assert.ok(loaded.length>10);console.log(JSON.stringify({installed:true,modules:loaded.length,externalQualification:true}));}finally{await controller?.close();await setup.close();}
`, {mode:0o600});
    const qualifiedResult = JSON.parse((await run(process.execPath, ['--import', qualified.preload, worker])).stdout);
    assert.equal(qualifiedResult.installed, true);
    assert.equal(fixture.state.calls.filter(call => call.method === 'POST' && call.path === '/user/repos').length, 1);
    assert.ok(fixture.state.calls.every(call => call.auth === 'Bearer fixture-literal-original'));
    assert.deepEqual(await snapshot(), payloadBefore, 'External qualification leaves every installed payload byte and mode unchanged');
    // Explicit --home wins; the launcher needs no manually exported owned TMPDIR.
    await run(command, ['setup', 'inspect', '--home', home], { env: { ...env, GITJIG_HOME: 'ignored-relative-home', TMPDIR: '/not-the-owned-root' } });
    const marker = path.join(home, 'controller.json'), original = await fs.readFile(marker);
    await fs.writeFile(marker, JSON.stringify({ format: 'gitjig-controller-1', installation: { format: 1, state: 'active' } }), { mode: 0o600 });
    const db = path.join(home, 'state/controller.sqlite'), before = await fs.readFile(db);
    await assert.rejects(run(command, ['conversation', 'list']), error => /INSTALLATION_BINDING_INVALID|Managed state has no active binding/.test(error.stderr));
    assert.deepEqual(await fs.readFile(db), before, 'refusal precedes Store changes');
    await fs.writeFile(marker, original);
    // A package update replaces code, not the application home or its state.
    const sentinel = path.join(home, 'preserve.txt'); await fs.writeFile(sentinel, 'owner data');
    await fs.writeFile(path.join(payload, 'README.md'), 'stale package payload');
    await run(process.execPath, [path.join(source, 'install.mjs'), '--prefix', prefix]);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'owner data');
    assert.deepEqual(await fs.readFile(path.join(payload, 'README.md')), await fs.readFile(path.join(source, 'README.md')), 'update installs fresh package bytes');
    await run(command, ['conversation', 'list']);
    await run('npm', ['uninstall', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', 'gitjig']);
    await assert.rejects(fs.access(command), { code: 'ENOENT' });
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'owner data');
    assert.deepEqual(await fs.readFile(marker), original);
    passed = true;
});

test('source changes during a real build refuse global installation', { timeout: 90000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/npm drift ')));
    const source = path.join(root, 'checkout'), prefix = path.join(root, 'must-not-install');
    await fs.mkdir(source);
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    const inputs = [...new Set(['src', 'runtime', 'qualification', 'tools/build.mjs', 'tsconfig.qualification.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'install.mjs', 'install.sh', ...pkg.files.filter(p => p !== 'dist/').map(p => p.replace(/\/$/, ''))])];
    for (const name of inputs) await fs.cp(name, path.join(source, name), { recursive: true });
    const hook = path.join(root, 'change-during-build.mjs');
    await fs.writeFile(hook, `import fs from 'node:fs';if(process.env.npm_lifecycle_event==='build')fs.appendFileSync('README.md','\\nChanged during compilation\\n');`);
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained source drift fixture: ' + root); });
    await assert.rejects(execute(process.execPath, [path.join(source, 'install.mjs'), '--prefix', prefix], {
        cwd: source, timeout: 85000, maxBuffer: 2 ** 22,
        env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
            npm_config_offline: 'true', TMPDIR: root, NODE_OPTIONS: '--import=' + pathToFileURL(hook).href },
    }), error => /Source\/build inputs changed during packaging/.test(error.stderr));
    await assert.rejects(fs.access(path.join(prefix, 'bin/gitjig')), { code: 'ENOENT' });
    assert.match(await fs.readFile(path.join(source, 'README.md'), 'utf8'), /Changed during compilation/);
    passed = true;
});
