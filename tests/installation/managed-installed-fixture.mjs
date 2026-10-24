import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {inventoryTree} from '../../dist/installation/tree.js';
import {runtimeFixtureProfile, runtimeFixtureConfig} from '../runtime/profile.mjs';
import {scripted, withValueCases} from '../controller/effect-fixture.mjs';
import {wireResponse} from '../pi/provider-wire-fixture.mjs';

export const receiverBase = '// User local choice: 10\n' + Array.from({length: 8}, (_, i) => '// Context ' + i + '\n').join('') + 'module.exports=2;\n';
export const sourceBase = receiverBase.replace('choice: 10', 'choice: 11');
export const sourceCandidate = sourceBase.replace('exports=2', 'exports=3');
export const receiverCandidate = receiverBase.replace('exports=2', 'exports=3');

// Mechanics only: explicit prerequisites, immutable payload, public setup, owned HTTP/process cleanup.
export async function managedFixtureInputs() {
    const runtime = {...runtimeFixtureProfile(), dockerConfigDirectory: runtimeFixtureConfig()};
    const shared = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(shared && path.isAbsolute(shared), 'Explicit already-shared private fixture root');
    for (const directory of [shared, runtime.dockerConfigDirectory]) {
        assert.equal(await fs.realpath(directory), directory);
        const stat = await fs.stat(directory);
        assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700);
    }
    assert.ok(process.env.GITJIG_CLI_FINAL_BUILD_RECEIPT, 'Explicit frozen current bundle receipt required');
    const built = JSON.parse(await fs.readFile(process.env.GITJIG_CLI_FINAL_BUILD_RECEIPT, 'utf8'));
    const bytes = await fs.readFile(path.join(built.destination, 'bundle.json'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), built.manifestSha256);
    const manifest = JSON.parse(bytes);
    assert.deepEqual(await inventoryTree(path.join(built.destination, 'payload')), manifest.assets);
    await assertCurrentBuild(built);
    return {runtime, shared, built, manifest};
}

export async function assertCurrentBuild(built) {
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    for (const [name, digest] of built.compileInputs) assert.equal(sha(await fs.readFile(name)), digest, 'Current compilation input: ' + name);
    for (const input of built.sourceInputs.filter(input => !input.path.startsWith('dist/')))
        assert.equal(sha(await fs.readFile(input.path)), input.sha256, 'Current frozen shipping input: ' + input.path);
    for (const directory of ['src', 'runtime', 'docs']) {
        const actual = (await inventoryTree(await fs.realpath(directory))).filter(asset => asset.kind === 'file').map(asset => directory + '/' + asset.path).sort();
        const declared = built.sourceInputs.filter(input => input.path.startsWith(directory + '/')).map(input => input.path).sort();
        assert.deepEqual(actual, declared, 'Current shipping file roster: ' + directory);
    }
}

export async function withInstalledManagedFixture(t, {runtime, shared, built, manifest, badCandidate = false}, action) {
    const checkout = await fs.realpath('.');
    assert.ok(shared !== checkout && !shared.startsWith(checkout + path.sep));
    const root = await fs.realpath(await fs.mkdtemp(path.join(shared, 'installed-managed-')));
    const home = path.join(root, 'application'), project = path.join(root, 'project'), user = path.join(root, 'user');
    for (const directory of [project, user]) await fs.mkdir(directory, {mode: 0o700});
    await fs.writeFile(path.join(project, 'consumer.cjs'), sourceBase);
    await fs.writeFile(path.join(project, 'check.cjs'), withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
    const env = {HOME: user, PATH: '/usr/bin:/bin', TMPDIR: root, TERM: 'xterm-256color',
        LANG: 'C.UTF-8', USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture', SHELL: '/bin/sh',
        NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'};
    const groups = new Set(), invocations = [], requests = [], roles = [], reviews = [], sockets = new Set();
    const result = {};
    let passed = false, server, ordinaryResponder = null, roleResponseGate = null;
    const absent = pid => {try {process.kill(-pid, 0); return false;} catch (error) {if (error.code === 'ESRCH') return true; throw error;}};
    const run = async (file, args, label, timeout = 15000, expected = 0) => {
        const child = spawn(file, args, {cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        if (child.pid) groups.add(child.pid);
        let stdout = '', stderr = '', size = 0, expired = false, overflow = false;
        const kill = () => {if (child.pid) try {process.kill(-child.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}};
        const timer = setTimeout(() => {expired = true; kill();}, timeout);
        const collect = (part, error) => {size += part.length; if (size > 4 * 1024 * 1024) {overflow = true; kill();} else if (error) stderr += part; else stdout += part;};
        child.stdout.on('data', part => collect(part, false)); child.stderr.on('data', part => collect(part, true));
        let result;
        try {result = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal}));});}
        finally {clearTimeout(timer);}
        const receipt = {label, pid: child.pid, ...result, expired, overflow, stdout, stderr};
        invocations.push(receipt);
        await fs.writeFile(path.join(root, label + '.result.json'), JSON.stringify(receipt), {mode: 0o600});
        assert.equal(expired, false, label + ' deadline'); assert.equal(overflow, false, label + ' output cap');
        if(typeof expected==='number'){assert.equal(result.signal,null,stderr);assert.equal(result.code,expected,label+' '+stderr+stdout);}else{assert.deepEqual(result,expected,label+' exact owned termination');}
        assert.equal(absent(child.pid), true, label + ' owned group settled'); groups.delete(child.pid);
        return stdout;
    };
    try {
        await run(path.join(built.destination, 'install'), ['activate', '--bundle', built.destination, '--home', home], 'activate', 60000);
        const launcher = path.join(home, 'gitjig'), payload = path.join(home, 'versions', built.payloadId);
        const cli = async (args, label) => JSON.parse(await run(launcher, args, label));
        await cli(['project', 'register', '--id', 'P', '--root', project], 'project');
        const producer = scripted(() => {throw Error('Unexpected ordinary model request');}, ({role, body, context}) => {
            roles.push(role);
            if (role === 'reviewer') {
                const text = context.messages.find(message => message.role === 'user').content.filter(part => part.type === 'text').map(part => part.text).join('');
                const sources = [...text.matchAll(/\nSOURCE ([^\n]+)\n([\s\S]*?)\nEND SOURCE\n/g)].map(match => ({metadata: JSON.parse(match[1]), content: match[2]}));
                const consumer = sources.find(source => source.metadata.side === 'candidate' && source.metadata.path === 'consumer.cjs');
                assert.ok([sourceCandidate, receiverCandidate].includes(consumer?.content), 'Exact source or projected candidate bytes'); assert.ok(body.requiredScope.length);
                reviews.push({candidateVersion: body.context.candidateVersion, scope: body.requiredScope, consumer: consumer.content});
            }
        });
        server = http.createServer(async (request, response) => {
            try {
                assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/chat/completions');
                assert.equal(request.headers.authorization, 'Bearer OWNED_SCRIPTED_ONLY');
                const chunks = []; let size = 0;
                for await (const chunk of request) {size += chunk.length; assert.ok(size <= 2 ** 20); chunks.push(chunk);}
                assert.ok(requests.length < 100, 'Finite synthetic model turn budget');
                const body = JSON.parse(Buffer.concat(chunks)); assert.equal(body.model, 'original');
                requests.push({model: body.model});
                const ordinal = requests.length;
                const userMessage = body.messages.find(message => message.role === 'user');
                const text = typeof userMessage.content === 'string' ? userMessage.content : userMessage.content.filter(part => part.type === 'text').map(part => part.text).join('');
                let answer;
                if (text.startsWith('Perform the assigned ')) {
                    const output = await producer.definition.streamSimple({api: 'openai-completions', provider: 'installed-managed', id: body.model}, {messages: [{role: 'user', content: [{type: 'text', text}]}]}).result();
                    const tool = output.content.find(part => part.type === 'toolCall');
                    if (badCandidate && tool?.name === 'write' && tool.arguments.path === 'consumer.cjs') tool.arguments.content = sourceBase;
                    answer = tool ? {tool: {name: tool.name, arguments: tool.arguments}} : {text: output.content.find(part => part.type === 'text').text};
                } else {
                    assert.ok(ordinaryResponder, 'Ordinary model input requires the explicit installed coordinator scenario');
                    answer = await ordinaryResponder(body);
                }
                if (roleResponseGate && text.startsWith('Perform the assigned ')) await roleResponseGate({text, body, answer, response});
                if (response.destroyed) return;
                const wire = wireResponse('openai-completions', body.model, answer);
                response.writeHead(200, Object.fromEntries(wire.headers));
                // Each native SDK tool call has its own ID across retained turns.
                response.end((await wire.text()).replaceAll('call_owned', 'call_installed_' + ordinal));
            } catch (error) {requests.push({error: String(error)}); response.destroy(error);}
        });
        server.on('connection', socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        // Custom localhost provider declaration is advanced configuration; runtime
        // setup below exercises the actual common plain-field owner interface.
        const modelFile = path.join(root, 'models.json');
        await fs.writeFile(modelFile, JSON.stringify({providers: {'installed-managed': {api: 'openai-completions', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', apiKey: 'OWNED_SCRIPTED_ONLY', models: [{id: 'original'}, {id: 'future'}]}}}), {mode: 0o600});
        await cli(['models', 'configure', '--file', modelFile], 'models');
        await cli(['models', 'default', '--provider', 'installed-managed', '--model', 'future'], 'future-default');
        const terminal = async (label, steps, timeoutSeconds = 12, args = []) => {
            const file = path.join(root, label + '.json');
            await fs.writeFile(file, JSON.stringify({command: [launcher, ...args], env, steps, timeoutSeconds,
                expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output: file + '.terminal', gracefulShutdownSeconds: 8}), {mode: 0o600});
            const receipt = JSON.parse(await run('/usr/bin/python3', [path.join(checkout, 'tests/cli/fork-ui-pty.py'), file], label, (timeoutSeconds + 12) * 1000));
            assert.equal(receipt.exitCode, 0); assert.equal(receipt.stages, steps.length); assert.equal(receipt.terminalRestored, true);
        };
        const priorSetup = await cli(['setup', 'inspect'], 'setup-before');
        assert.equal(priorSetup.effective?.runtime, undefined); assert.equal(priorSetup.saved?.runtime, undefined);
        const empty = [{sql: 'SELECT COUNT(*) FROM works', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM runs', rows: [[0]]}];
        await terminal('runtime-fields', [
            {wait: 'Model: future', send: '/model installed-managed/original\x1b\r'},
            {wait: 'Model: original', send: '/project P\x1b\r'},
            {wait: 'Project selected: P', send: '/setup runtime\x1b\r'},
            {wait: 'Runtime setup · staged values', send: 'Edit runtime fields\r'},
            {wait: 'Docker executable', send: runtime.dockerBinary + '\r'},
            {wait: 'Docker context', send: runtime.dockerContext + '\r'},
            {wait: 'Runtime image', send: runtime.image + '\r'},
            {wait: 'Docker configuration directory', send: runtime.dockerConfigDirectory + '\r'},
            {wait: 'Runtime setup · staged values', send: 'Review and save runtime\r'},
            {wait: 'Review next-launch runtime setup', send: '\x1b'},
            {wait: 'Explicit runtime setup action', send: 'Save runtime for next launch\r'},
            {wait: 'Runtime saved for next launch; close normally and relaunch', queries: empty, send: '\x15/quit\x1b\r'}
        ]);
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, 'config/startup.json'), 'utf8')).runtime, {...runtime, dockerBinary: await fs.realpath(runtime.dockerBinary)});
        await assert.rejects(fs.access(path.join(user, '.gitjig')), {code: 'ENOENT'});
        assert.equal(requests.length, 0, 'Setup is model-free');
        Object.assign(result, await action({root, home, project, user, launcher, payload, env, run, cli, terminal,
            badCandidate, roles, reviews, requests, invocations, result,
            setOrdinaryResponder: responder => {ordinaryResponder = responder;},
            setRoleResponseGate: gate => {roleResponseGate = gate;}}));
        const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly: true});
        try {
            const retained=result.retainedInterruptedRunIds??[];assert.equal(new Set(retained).size,retained.length);
            const interrupted=db.prepare("SELECT id,phase,reservation,data FROM runs WHERE phase!='SETTLED' ORDER BY id").all();assert.deepEqual(interrupted.map(row=>row.id),[...retained].sort());
            for(const row of interrupted){assert.equal(row.phase,'INTERRUPTED');assert.equal(row.reservation,'consumed');assert.equal(JSON.parse(row.data).cleanup,'removed');}
            assert.equal(db.prepare("SELECT COUNT(*) AS n FROM capacity_leases WHERE state!='RELEASED'").get().n, 0);
            assert.equal(db.prepare("SELECT COUNT(*) AS n FROM budgets WHERE reserved!=0").get().n, 0);
        } finally {db.close();}
        for (const name of await fs.readdir(path.join(home, 'state/runtime'))) if (name.endsWith('.json'))
            assert.equal(JSON.parse(await fs.readFile(path.join(home, 'state/runtime', name), 'utf8')).state, 'removed');
        assert.deepEqual(await inventoryTree(payload), manifest.assets);
        passed = true;
        t.diagnostic(JSON.stringify({root, home, badCandidate, requests: requests.length, ...result}));
    } finally {
        for (const socket of sockets) socket.destroy();
        if (server) await new Promise(resolve => server.close(resolve));
        for (const pid of groups) if (!absent(pid)) try {process.kill(-pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
        await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({passed, root, home, badCandidate, ...result, requests, roles, reviews, invocations,
            cleanup: [...groups].map(pid => ({pid, absent: absent(pid)})), scope: 'Installed actual managed fixture; scenario result is scoped, not original delivery completion'}, null, 2), {mode: 0o600});
        t.diagnostic('Retained installed managed fixture: ' + root);
    }
}
