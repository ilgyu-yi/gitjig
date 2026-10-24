import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareClaudeBridgeConnection, captureClaudeOperatorEnvironment } from '../../dist/app/bridge-connection.js';

async function fixture(t, options = {}) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-bridge-connection-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const home = path.join(root, 'app'), operatorHome = path.join(root, 'operator'), bin = path.join(root, 'bin');
    for (const dir of [home, path.join(home, 'artifacts'), operatorHome, path.join(operatorHome, '.claude'), bin]) await fs.mkdir(dir, { mode: 0o700 });
    const control = path.join(root, 'control.json'), log = path.join(root, 'calls.jsonl'), executable = path.join(bin, 'claude');
    await fs.writeFile(control, '{}', { mode: 0o600 });
    await fs.writeFile(executable, `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');
const c=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),env:process.env,cwd:process.cwd()})+'\\n');
if(process.argv.includes('--version')){console.log('2.1.0 (Claude Code)');process.exit(0)}
if(c.replaceManaged){const agent=path.resolve(process.cwd(),'../agent');fs.renameSync(agent,agent+'.old');fs.mkdirSync(agent,{mode:448});fs.mkdirSync(path.join(agent,'home'),{mode:448});fs.copyFileSync(path.join(agent+'.old','claude-bridge.json'),path.join(agent,'claude-bridge.json'));fs.chmodSync(path.join(agent,'claude-bridge.json'),384)}
if(c.hold){setInterval(()=>{},1000);return}
if(c.raw){console.log(c.raw);process.exit(0)}
if(c.loggedOut){console.log(JSON.stringify({loggedIn:false}));process.exit(1)}
console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:'fixture@example.invalid',orgId:c.orgId||'org-one',orgName:'Fixture',subscriptionType:process.env.USER==='fixture-user'&&process.env.LOGNAME==='fixture-login'&&!Object.hasOwn(process.env,'CLAUDE_CONFIG_DIR')?'team':'max'}));
`, { mode: 0o700 });
    const operator = { home: operatorHome, path: bin, user: 'fixture-user', logname: 'fixture-login', shell: '/bin/sh', lang: 'ko_KR.UTF-8', lcAll: '', term: 'xterm', ...options.operator };
    let open = true, saved; const controller = new AbortController();
    const host = { home, operator, savedBridge: options.savedBridge, runtimeCompatible: options.runtimeCompatible ?? true,
        assertCurrent() { if (!open) throw Error('Setup closed'); }, checkPath(file) { assert.ok(file.startsWith(root + path.sep) || file.startsWith('/usr/') || file.startsWith('/opt/')); },
        async run(action, guard) { this.assertCurrent(); guard?.(); return action(controller.signal); },
        async save(bridge, guard) { await options.beforeSave?.(bridge); guard?.(); this.assertCurrent(); saved = bridge; },
    };
    const edit = prepareClaudeBridgeConnection(host);
    return { root, home, operatorHome, executable, control, log, edit, host, get saved() { return saved; },
        async calls() { return (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse); },
        async configure(value) { await fs.writeFile(control, JSON.stringify(value)); },
        async selection() { const found = await edit.discover(); return { found, candidate: found.candidates.find(x => x.label === executable), route: found.routes.find(x => x.kind === 'default-home') }; },
        close() { open = false; controller.abort(); },
    };
}

test('operator snapshot preserves safe native identity fields and explicit empty config presence', () => {
    const source = { HOME: '/original', PATH: '', CLAUDE_CONFIG_DIR: '', USER: 'u', LOGNAME: 'l', SHELL: '/bin/sh', LANG: '', LC_ALL: 'C', TERM: 'xterm', ANTHROPIC_API_KEY: 'private' };
    const captured = captureClaudeOperatorEnvironment(source); source.HOME = '/projected';
    assert.deepEqual(captured, { home: '/original', path: '', configDirectory: '', user: 'u', logname: 'l', shell: '/bin/sh', lang: '', lcAll: 'C', term: 'xterm' });
    assert.ok(Object.isFrozen(captured)); assert.equal(Object.hasOwn(captureClaudeOperatorEnvironment({}), 'configDirectory'), false);
});

test('metadata discovery prioritizes explicit original configuration and keeps empty config distinct', async t => {
    const f = await fixture(t, { operator: { configDirectory: '/explicit/account' } });
    const found = await f.edit.discover();
    assert.equal(found.routes[0].kind, 'explicit-directory'); assert.equal(found.routes[1].kind, 'default-home'); assert.deepEqual(await f.calls(), []);
    const empty = prepareClaudeBridgeConnection({ ...f.host, operator: { ...f.host.operator, configDirectory: '' } });
    const result = await empty.discover(); assert.equal(result.routes.length, 1); assert.match(result.diagnostic, /empty or unsupported/);
});

test('original native identity environment selects Team, cleanly checks and saves reviewed private setup', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection();
    const checked = await f.edit.check(candidate.id, route.id); assert.equal(checked.ready, true); assert.equal(checked.account.plan, 'team');
    const again = await f.edit.check(candidate.id, route.id); assert.equal(again.review.managedDirectory, checked.review.managedDirectory);
    assert.equal(f.saved, undefined); assert.deepEqual(await f.edit.connect(checked.id), { saved: true });
    assert.equal(f.saved.nativeAccountHome, f.operatorHome); assert.equal(f.saved.nativeAccountDirectory, path.join(f.operatorHome, '.claude'));
    for (const call of await f.calls()) {
        assert.equal(call.env.HOME, f.operatorHome); assert.equal(Object.hasOwn(call.env, 'CLAUDE_CONFIG_DIR'), false);
        for (const [key, value] of Object.entries({ USER: 'fixture-user', LOGNAME: 'fixture-login', PATH: f.host.operator.path, SHELL: '/bin/sh', LANG: 'ko_KR.UTF-8', LC_ALL: '', TERM: 'xterm' })) assert.equal(call.env[key], value);
        for (const [key, value] of Object.entries({ ENABLE_CLAUDEAI_MCP_SERVERS: '0', DISABLE_AUTO_COMPACT: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDE_AGENT_SDK_VERSION: '0.3.284' })) assert.equal(call.env[key], value);
        assert.equal(call.env.TMPDIR, path.join(f.home, 'artifacts')); assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
    }
});

test('explicit config route keeps private future HOME and saved Team route remains first', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection();
    const checked = await f.edit.check(candidate.id, route.id); await f.edit.connect(checked.id);
    const next = prepareClaudeBridgeConnection({ ...f.host, savedBridge: f.saved, operator: { ...f.host.operator, configDirectory: path.join(f.operatorHome, '.claude') } });
    const discovery = await next.discover(); assert.match(discovery.routes[0].label, /Saved Claude login/); assert.equal(discovery.routes[0].kind, 'default-home');
    const explicit = discovery.routes.find(x => x.kind === 'explicit-directory');
    const result = await next.check(discovery.candidates.find(x => x.label === f.executable).id, explicit.id);
    assert.equal(result.account.plan, 'max'); const calls = await f.calls(), last = calls.at(-1);
    assert.equal(last.env.HOME, path.join(result.review.managedDirectory, 'agent', 'home')); assert.equal(last.env.CLAUDE_CONFIG_DIR, path.join(f.operatorHome, '.claude'));
});

test('org identity drift blocks Connect even with unchanged displayed email and plan', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection(), checked = await f.edit.check(candidate.id, route.id);
    await f.configure({ orgId: 'different-org' }); await assert.rejects(f.edit.connect(checked.id), /changed after review/); assert.equal(f.saved, undefined);
});

test('permission repair is explicit metadata-only, then native login can be checked', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection(); await fs.chmod(path.join(f.operatorHome, '.claude'), 0o755);
    const checked = await f.edit.check(candidate.id, route.id); assert.equal(checked.ready, false); assert.ok(checked.permissionRepair); assert.deepEqual(await f.calls(), []);
    await f.edit.repairPermissions(checked.permissionRepair.id); assert.equal((await fs.stat(path.join(f.operatorHome, '.claude'))).mode & 0o777, 0o700);
    assert.equal((await f.edit.check(candidate.id, route.id)).ready, true);
});

test('logged-out native exit one without authMethod offers exact login route without saving', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection(); await f.configure({ loggedOut: true });
    const checked = await f.edit.check(candidate.id, route.id); assert.equal(checked.ready, false); assert.equal(checked.account.authMethod, 'none'); assert.match(checked.loginCommand, /env -u CLAUDE_CONFIG_DIR HOME=/); assert.equal(f.saved, undefined);
});

test('malformed private status keys never escape through diagnostic errors', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection(); await f.configure({ raw: '{"private-secret-key":1,"private-secret-key":2}' });
    await assert.rejects(f.edit.check(candidate.id, route.id), error => /login status is unavailable or malformed/.test(error.message) && !error.message.includes('private-secret-key'));
});

test('deleted reviewed policy is refused, never recreated by Connect', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection(), checked = await f.edit.check(candidate.id, route.id);
    await fs.unlink(checked.review.policyFile); await assert.rejects(f.edit.connect(checked.id)); await assert.rejects(fs.stat(checked.review.policyFile), { code: 'ENOENT' }); assert.equal(f.saved, undefined);
});

test('final native probe replacing managed agent identity cannot save', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection(), checked = await f.edit.check(candidate.id, route.id);
    await f.configure({ replaceManaged: true }); await assert.rejects(f.edit.connect(checked.id), /directory changed|unsafe/); assert.equal(f.saved, undefined);
});

test('final synchronous save guard rejects policy drift during async save validation', async t => {
    const f = await fixture(t, { async beforeSave(bridge) { await fs.writeFile(path.join(bridge.profile.agentDir, 'claude-bridge.json'), '{}'); } });
    const { candidate, route } = await f.selection(), checked = await f.edit.check(candidate.id, route.id);
    await assert.rejects(f.edit.connect(checked.id), /policy changed/); assert.equal(f.saved, undefined);
});

test('malformed saved bridge is not prefilled and runtime incompatibility preserves existing configuration', async t => {
    const f = await fixture(t, { savedBridge: { profile: 'malformed' }, runtimeCompatible: false }); assert.equal(f.edit.savedBridge, undefined);
    const { candidate, route } = await f.selection(), checked = await f.edit.check(candidate.id, route.id); assert.equal(checked.ready, false); assert.match(checked.diagnostic, /setup runtime/); assert.equal(f.saved, undefined);
});

test('closed setup and already canceled Check do not launch native work or save', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection(); const abort = new AbortController(); abort.abort();
    await assert.rejects(f.edit.check(candidate.id, route.id, undefined, abort.signal)); assert.deepEqual(await f.calls(), []);
    f.close(); await assert.rejects(f.edit.discover(), /closed/); assert.equal(f.saved, undefined);
});


test('canceling an active login check joins its owned native observer before returning', async t => {
    const f = await fixture(t), { candidate, route } = await f.selection(); await f.configure({ hold: true });
    const abort = new AbortController(), pending = f.edit.check(candidate.id, route.id, undefined, abort.signal);
    const deadline = Date.now() + 3000;
    while (!(await f.calls()).some(call => call.args.includes('status'))) {
        assert.ok(Date.now() < deadline, 'owned status fixture did not start'); await new Promise(resolve => setTimeout(resolve, 10));
    }
    abort.abort(); await assert.rejects(pending, /abort|cancel/i); assert.equal(f.saved, undefined);
    await f.configure({}); assert.equal((await f.edit.check(candidate.id, route.id)).ready, true);
});
