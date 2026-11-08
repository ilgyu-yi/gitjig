import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {fixture as acceptanceFixture} from '../platform/acceptance-fixture.mjs';
import {installedQualification} from './qualification-sidecar.mjs';
import {checkout, inventory, offlineSourceInstallation} from './offline-source-fixture.mjs';

const execute = promisify(execFile);
test('one-command installer activates a private snapshot, refuses bound state and preserves the home on removal', {timeout: 180000}, async t => {
    const installed = await offlineSourceInstallation(t, 'npm-global');
    const {root, source, prefix, home, command, payload} = installed;
    const env = {...installed.env,
        PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
        npm_config_cache: installed.cache, npm_config_offline: 'true',
        npm_config_userconfig: path.join(root, 'empty-npmrc'), npm_config_globalconfig: path.join(root, 'empty-global-npmrc')};
    const run = (file, args, extra = {}) => execute(file, args, {cwd: root, env, timeout: 90000, maxBuffer: 2 ** 22, ...extra});
    const installOutput = installed.invocations.find(invocation => invocation.label === 'install').out;
    assert.match(installOutput, /Installed:/);
    assert.match(installOutput, /PATH setup remains:/);
    const activePackage = path.join(prefix, 'lib/node_modules/gitjig');
    assert.equal(await fs.realpath(path.join(activePackage, 'dist/cli/entry.js')), await fs.realpath(command));
    for (const file of ['dist/cli/entry.js', 'docs/requirements.md', 'MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'node_modules/@gitjig/pi-claude-bridge-host/package.json']) await fs.access(path.join(payload, file));
    for (const file of ['src', 'tests', 'qualification', '.qualification', 'dist/controller/testing.js', 'dist/controller/acceptance.js', 'dist/platform/github-acceptance.js', 'dist/effects/acceptance-synthetic.js', 'development', '.git', 'AGENTS.md', 'CONTRIBUTING.md', 'node_modules/typescript']) await assert.rejects(fs.access(path.join(payload, file)), { code: 'ENOENT' });
    // Copy only installed recipe assets to a dedicated context outside checkout ancestry.
    const recipe = ['Dockerfile', 'Dockerfile.dockerignore', 'io-helper.mjs'];
    const context = path.join(root, 'image context');
    await fs.mkdir(context, {mode:0o700});
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
    assert.equal(identity.application, 'gitjig'); assert.equal(identity.piSdkVersion, installed.pkg.dependencies['@earendil-works/pi-coding-agent']);
    assert.match((await run(command, ['--help'], { env: { ...env, GITJIG_HOME: 'invalid-relative-home' } })).stdout, /gitjig/);
    const diagnosis = JSON.parse((await run(command, ['doctor'])).stdout);
    assert.equal(diagnosis.node.compatible, true); assert.equal(diagnosis.applicationReady, true);
    assert.equal(diagnosis.projectExecutionReady, false); assert.equal(diagnosis.prerequisitesReady, true);
    // Explicit external qualification uses actual installed modules; nothing is copied into the payload.
    const qualified = installedQualification(payload), fixture = await acceptanceFixture();
    t.after(() => fixture.close());
    const payloadBefore = installed.payloadBefore, worker = path.join(root, 'installed-qualification.mjs');
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
    assert.deepEqual(await inventory(payload), payloadBefore, 'External qualification leaves every installed payload byte and mode unchanged');
    // Explicit --home wins; the launcher needs no manually exported owned TMPDIR.
    await run(command, ['setup', 'inspect', '--home', home], { env: { ...env, GITJIG_HOME: 'ignored-relative-home', TMPDIR: '/not-the-owned-root' } });
    const marker = path.join(home, 'controller.json'), original = await fs.readFile(marker);
    await fs.writeFile(marker, JSON.stringify({ format: 'gitjig-controller-1', installation: { format: 1, state: 'active' } }), { mode: 0o600 });
    const db = path.join(home, 'state/controller.sqlite'), before = await fs.readFile(db);
    await assert.rejects(run(command, ['conversation', 'list']), error => /INSTALLATION_BINDING_INVALID|Managed state has no active binding/.test(error.stderr));
    assert.deepEqual(await fs.readFile(db), before, 'refusal precedes Store changes');
    await fs.writeFile(marker, original);
    // Removal unlinks the active command and registration, while the canonical version and home remain.
    const sentinel = path.join(home, 'preserve.txt');
    await fs.writeFile(sentinel, 'owner data');
    await run('npm', ['uninstall', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', 'gitjig']);
    for (const file of [command, activePackage])
        await assert.rejects(fs.lstat(file), {code: 'ENOENT'});
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'owner data');
    assert.deepEqual(await fs.readFile(marker), original);
    assert.deepEqual(await fs.readFile(db), before);
    assert.deepEqual(await inventory(payload), payloadBefore, 'Removal preserves the canonical version');
    await installed.assertCurrent();
    installed.pass();
});

test('source changes during a real build refuse global installation', { timeout: 90000 }, async t => {
    assert.ok(process.env.npm_config_cache, 'Explicit prepared offline npm_config_cache required');
    const cache = await fs.realpath(process.env.npm_config_cache);
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-npm-drift-')));
    const source = path.join(root, 'checkout'), prefix = path.join(root, 'must-not-install');
    await fs.mkdir(source);
    const pkg = JSON.parse(await fs.readFile(path.join(checkout, 'package.json'), 'utf8'));
    const inputs = [...new Set(['src', 'runtime', 'qualification', 'tools/build.mjs', 'tsconfig.qualification.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'install.mjs', 'install.sh', ...pkg.files.filter(p => p !== 'dist/').map(p => p.replace(/\/$/, ''))])];
    for (const name of inputs) await fs.cp(path.join(checkout, name), path.join(source, name), { recursive: true });
    const hook = path.join(root, 'change-during-build.mjs');
    await fs.writeFile(hook, `import fs from 'node:fs';if(process.env.npm_lifecycle_event==='build')fs.appendFileSync('README.md','\\nChanged during compilation\\n');`);
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained source drift fixture: ' + root); });
    await assert.rejects(execute(process.execPath, [path.join(source, 'install.mjs'), '--prefix', prefix], {
        cwd: source, timeout: 85000, maxBuffer: 2 ** 22,
        env: {HOME: root, TMPDIR: root, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
            npm_config_cache: cache, npm_config_offline: 'true',
            npm_config_userconfig: path.join(root, 'empty-npmrc'), npm_config_globalconfig: path.join(root, 'empty-global-npmrc'),
            NODE_OPTIONS: '--import=' + pathToFileURL(hook).href},
    }), error => /Source\/build inputs changed during packaging/.test(error.stderr));
    await assert.rejects(fs.access(path.join(prefix, 'bin/gitjig')), { code: 'ENOENT' });
    assert.match(await fs.readFile(path.join(source, 'README.md'), 'utf8'), /Changed during compilation/);
    passed = true;
});
