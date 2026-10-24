import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
const root = process.argv[2], home = path.join(root, 'app'), execute = promisify(execFile);
const stock = path.join(process.env.PI_CODING_AGENT_DIR, 'auth.json');
const stockBytes = '{"openai":{"type":"api_key","key":"DUMMY_STOCK_UNADMITTED"}}';
await fs.writeFile(stock, stockBytes, { mode: 0o600 });
let network = 0, checked = 0, resolved = 0, fileDenied = 0, envDenied = 0, loginOptions, delayed;
globalThis.fetch = async () => { network++; throw Error('No network'); };
net.Socket.prototype.connect = function () { network++; throw Error('No sockets'); };
const originalCreate = ModelRuntime.create;
// Controlled producer instrumentation, while the consumer remains the original
// ModelRuntime/Models login, credential lock, synchronization and logout.
ModelRuntime.create = async function (...args) {
    const runtime = await originalCreate.apply(this, args), provider = runtime.getProvider('openai'), api = provider.auth.apiKey;
    const login = api.login, check = api.check, resolve = api.resolve;
    provider.auth.apiKey = { ...api,
        async login(...args) { if (delayed) { delayed.enter(); await delayed.wait; } return login.apply(api, args); },
        async check(input) { checked++; if (!await input.ctx.fileExists('~/.aws/credentials')) fileDenied++; if (!await input.ctx.env('OPENAI_API_KEY')) envDenied++; return check.call(api, input); },
        async resolve(input) { resolved++; return resolve.call(api, input); },
    };
    // This controlled OAuth producer observes app options and original consumer
    // persistence; it is not a claim of a vendor's remote OAuth protocol.
    provider.auth.oauth = { name: 'Owned OAuth fixture',
        async login(_interaction, options) { loginOptions = { agent: options.agentName, id: options.getDeviceId() }; return { type: 'oauth', access: 'DUMMY_ACCESS', refresh: 'DUMMY_REFRESH', expires: Date.now() + 3600000 }; },
        async refresh() { throw Error('Unexpected OAuth refresh in this fixture'); },
        async toAuth(value) { return { apiKey: value.access }; },
    };
    return runtime;
};
const config = { providers: { openai: { baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'managed-fixture', api: 'openai-completions', contextWindow: 8192, maxTokens: 256, headers: { 'x-model': 'literal' } }], headers: { 'x-provider': 'literal' }, modelOverrides: { 'managed-fixture': { headers: { 'x-override': 'literal' } } } } } };
const interaction = { prompt: async prompt => { assert.equal(prompt.type, 'secret'); return 'DUMMY_APP_KEY'; }, notify() {} };
let controller = await openController({ installationHome: home }), accounts = ApplicationAccounts.open(controller);
try {
    await accounts.configure(config);
    const status = await accounts.status();
    assert.equal(status.find(account => account.provider === 'openai').stored, null);
    assert.equal(status.find(account => account.provider === 'openai').verification, 'not-checked');
    const list = await accounts.models('managed-fixture');
    assert.equal(list.models.length, 1); assert.equal(list.models[0].contextWindow, 8192);
    assert.equal(checked + resolved, 0); // Browsing/scoping must not resolve ambient auth.
    await accounts.setScope(['openai/managed-fixture:high']);
    assert.equal(checked + resolved, 0);
    await accounts.setDefault('openai', 'managed-fixture');
    await assert.rejects(accounts.setDefault('openai', 'missing-model'), /absent/);
    assert.equal((await accounts.login('openai', 'api_key', interaction)).committed, true);
    const auth = path.join(home, 'config/auth.json');
    assert.equal(JSON.parse(await fs.readFile(auth, 'utf8')).openai.key, 'DUMMY_APP_KEY');
    assert.ok(envDenied > 0 && fileDenied > 0);
    assert.ok(!JSON.stringify(await accounts.status()).includes('DUMMY_APP_KEY'));
    await accounts.logout('openai'); assert.equal(JSON.parse(await fs.readFile(auth, 'utf8')).openai, undefined);
    await accounts.login('openai', 'oauth', interaction);
    assert.equal(loginOptions.agent, 'gitjig'); const firstId = loginOptions.id;
    assert.match(firstId, /^[a-f0-9-]{36}$/); await accounts.logout('openai');
    await accounts.login('openai', 'oauth', interaction); assert.equal(loginOptions.id, firstId); await accounts.logout('openai');
    const prior = await fs.readFile(path.join(home, 'config/models.json'), 'utf8');
    for (const mutate of [p => { p.apiKey = '!must-not-run'; }, p => { p.headers.bad = '$SECRET'; }, p => { p.models[0].headers.bad = '!must-not-run'; }, p => { p.modelOverrides['managed-fixture'].headers.bad = '${SECRET}'; }]) {
        const bad = structuredClone(config); mutate(bad.providers.openai);
        await assert.rejects(accounts.configure(bad), /literal/);
        assert.equal(await fs.readFile(path.join(home, 'config/models.json'), 'utf8'), prior);
    }
    // The complete-replacement command repairs invalid prior model data while
    // preserving the previous bytes when the *candidate* is invalid.
    const modelsFile = path.join(home, 'config/models.json');
    for (const broken of ['{"providers":', 'null', JSON.stringify({ providers: { openai: { apiKey: '!must-not-run' } } })]) {
        await fs.writeFile(modelsFile, broken, { mode: 0o600 });
        await accounts.configure(config);
        assert.equal((await accounts.models('managed-fixture')).models.length, 1);
    }
    const conversation = controller.createConversation();
    controller.queueConversationInput({ conversationId: conversation.conversationId, expectedGeneration: conversation.generation, text: 'retained input', mode: 'idle' });
    await assert.rejects(accounts.logout('openai'), /Settle/);
} finally { await controller.close(); }
// H1: hold an actual selected provider login, then try conflicting admission
// before credential persistence. Release it and prove healthy admission resumes.
const raceHome = path.join(root, 'race');
controller = await openController({ installationHome: raceHome }); accounts = ApplicationAccounts.open(controller);
await accounts.configure(config);
const raceConversation = controller.createConversation();
let raceEnter, raceRelease;
const raceStarted = new Promise(resolve => raceEnter = resolve), raceWait = new Promise(resolve => raceRelease = resolve);
delayed = { enter: raceEnter, wait: raceWait };
const pendingLogin = accounts.login('openai', 'api_key', interaction);
await raceStarted;
const conflictingInput = { conversationId: raceConversation.conversationId, expectedGeneration: raceConversation.generation, text: 'must not enter during login', mode: 'idle' };
assert.throws(() => controller.queueConversationInput(conflictingInput), /change is settling/);
assert.throws(() => controller.runConversation({ conversationId: raceConversation.conversationId, model: { provider: 'openai', modelId: 'managed-fixture' } }), /change is settling/);
// This reaches the governed public operation's admission guard before work
// lookup/allocation. Actual engine/role execution remains its separate lane.
await assert.rejects(async () => controller.planChange({ workId: 'not-allocated-during-login', model: { provider: 'openai', modelId: 'managed-fixture' } }), /change is settling/);
raceRelease(); assert.equal((await pendingLogin).committed, true); delayed = undefined;
await controller.queueConversationInput(conflictingInput);
await assert.rejects(accounts.logout('openai'), /Settle/);
await controller.close();
// A separate home isolates the cancellation proof from retained queued work.
const cancelHome = path.join(root, 'cancel');
controller = await openController({ installationHome: cancelHome }); accounts = ApplicationAccounts.open(controller);
await accounts.configure(config);
let entered, release;
const started = new Promise(resolve => entered = resolve), waiting = new Promise(resolve => release = resolve);
delayed = { enter: entered, wait: waiting };
const abort = new AbortController();
const loginTask = accounts.login('openai', 'api_key', { ...interaction, signal: abort.signal });
const settled = loginTask.then(() => 'success', () => 'cancelled');
await started; abort.abort();
let closeDone = false; const closing = controller.close().then(() => closeDone = true);
await new Promise(resolve => setImmediate(resolve)); assert.equal(closeDone, false);
const peer = await execute(process.execPath, ['--input-type=module', '-e', `
import {openController} from './dist/controller/index.js';
try {const c=await openController({installationHome:process.argv[1]});await c.close();process.exitCode=9;}
catch(e){if(e.code!=='OWNER_BUSY')throw e;console.log('owner-held');}`, cancelHome], { env: process.env, timeout: 3000 });
assert.equal(peer.stdout.trim(), 'owner-held');
release(); assert.equal(await settled, 'cancelled'); await closing; assert.equal(closeDone, true);
delayed = undefined;
controller = await openController({ installationHome: home }); accounts = ApplicationAccounts.open(controller);
try {
    const list = await accounts.models('managed-fixture'); assert.equal(list.default.model, 'managed-fixture'); assert.equal(list.scope.models[0], 'openai/managed-fixture');
} finally { await controller.close(); }
assert.equal(await fs.readFile(stock, 'utf8'), stockBytes);
// Actual CLI consumer, separate pristine home and no management monkeypatch.
const cliHome = path.join(root, 'cli');
for (const args of [['auth', 'status'], ['models', 'list', '--search', 'gpt'], ['--version']]) {
    const run = await execute(process.execPath, ['dist/cli/main.js', ...args, ...(args[0] === '--version' ? [] : ['--home', cliHome])], { env: process.env, timeout: 4000 });
    const view = JSON.parse(run.stdout); assert.ok(view);
    assert.ok(!run.stdout.includes('DUMMY_'));
}
for (const [file, args] of [['auth.json', ['auth', 'status']], ['models.json', ['models', 'list']]]) {
    const selected = path.join(cliHome, 'config', file);
    await fs.writeFile(selected, '{DUMMY_MALFORMED_SECRET_EXCERPT', { mode: 0o600 });
    const result = await execute(process.execPath, ['dist/cli/main.js', ...args, '--home', cliHome], { env: process.env, timeout: 4000 }).then(() => { throw Error('Expected malformed source refusal'); }, error => error);
    assert.equal(result.code, 2); assert.ok(!result.stderr.includes('DUMMY_MALFORMED'));
    assert.match(result.stderr, /valid JSON/);
    if (file === 'auth.json') await fs.writeFile(selected, '{}', { mode: 0o600 });
}
const repairFile = path.join(root, 'replacement-models.json');
await fs.writeFile(repairFile, JSON.stringify(config), { mode: 0o600 });
const repaired = await execute(process.execPath, ['dist/cli/main.js', 'models', 'configure', '--home', cliHome, '--file', repairFile], { env: process.env, timeout: 4000 });
assert.equal(JSON.parse(repaired.stdout).savedScope, 'application');
assert.equal(network, 0);
console.log(JSON.stringify({ outcome: 'passed', network, generation: 0, envDenied, fileDenied, underlyingLoginJoined: true, originalConsumerOAuthIdentity: true }));
