/** SOURCE-PREPARED: original public Claude SDK query through actual owned producer.
 * CURRENT built producer and current locked dependency closure only; historical128 source remains unchanged.
 * Never invokes native Claude or real credentials; all protocol usage is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

test('guardian original SDK typed result and actual independent pipe/group settlement', { timeout: 12000 }, async t => {
    const payload = await fs.realpath('.');
    const require = createRequire(path.join(payload, 'package.json'));
    const sdkFile = require.resolve('@anthropic-ai/claude-agent-sdk');
    const producerFile = path.join(payload, 'dist/pi/native-process.js');
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-producer-sdk-')));
    await fs.chmod(root, 0o700);
    t.diagnostic('Retained harmless original-SDK producer world: ' + root);
    const fixture = path.join(root, 'protocol.mjs');
    const fixtureBytes = await fs.readFile(new URL('./claude-producer-sdk-child.mjs', import.meta.url));
    await fs.writeFile(fixture, fixtureBytes, { flag: 'wx', mode: 0o600 });
    const executable = path.join(root, 'fixture-code');
    const node = await fs.realpath(process.execPath);
    // The wrapper is the selected executable, not a producer command translation.
    // Shell quoting supports installed copied Node paths containing spaces.
    const wrapper = '#!/bin/sh\nexec ' + quote(node) + ' ' + quote(fixture) + ' "$@"\n';
    await fs.writeFile(executable, wrapper, { flag: 'wx', mode: 0o700 });
    const original = { http: http.request, https: https.request, connect: net.Socket.prototype.connect, fetch: globalThis.fetch };
    let refusedNetwork = 0;
    const noNetwork = () => { refusedNetwork++; throw Error('Harmless protocol network unavailable'); };
    http.request = noNetwork; https.request = noNetwork; net.Socket.prototype.connect = noNetwork; globalThis.fetch = noNetwork;
    let producer, query, launch;
    const abort = new AbortController();
    const deadline = setTimeout(() => { abort.abort(); void producer?.close(); }, 8000);
    const requests = [], messages = [];
    let settled = false;
    try {
        const { createOwnedNativeProducer } = await import(pathToFileURL(producerFile).href);
        const { query: originalQuery } = await import(pathToFileURL(sdkFile).href);
        const state = path.join(root,'native-state'); await fs.mkdir(state,{mode:0o700});
        producer = await createOwnedNativeProducer({ file: executable, sha256: sha(wrapper) },undefined,state);
        query = originalQuery({ prompt: 'Synthetic original SDK protocol only.', options: {
            abortController: abort, cwd: root, model: 'claude-opus-5-5', tools: [], mcpServers: {}, strictMcpConfig: true,
            settingSources: [], persistSession: false, pathToClaudeCodeExecutable: executable,
            env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root, GITJIG_PROTOCOL_CANARY: 'owned-protocol-only' },
            spawnClaudeCodeProcess(options) {
                assert.equal(requests.length, 0, 'Exactly one actual harmless child');
                assert.equal(options.command, executable);
                assert.equal(options.cwd, root);
                assert.equal(options.env.GITJIG_PROTOCOL_CANARY, 'owned-protocol-only');
                requests.push(options);
                launch = producer.launch(options,{ownerSessionId:'synthetic-sdk-owner',purpose:'provider'});
                assert.equal('pid' in launch.process,false,'Guardian PID must never masquerade as native'); // exact original object, argv and pipes
                void launch.settled.then(() => { settled = true; });
                return launch.process;
            }
        } });
        for (;;) {
            const next = await query.next();
            assert.equal(next.done, false, 'Typed native result required');
            messages.push(next.value);
            if (next.value.type === 'result') break;
            assert.ok(messages.length < 12);
        }
        assert.equal(requests.length, 1);
        const init = messages.find(message => message.type === 'system' && message.subtype === 'init');
        const result = messages.at(-1);
        assert.equal(init.session_id, 'synthetic-native');
        assert.deepEqual(init.tools, []); assert.deepEqual(init.mcp_servers, []); assert.deepEqual(init.plugins, []);
        assert.equal(result.subtype, 'success'); assert.equal(result.is_error, false);
        assert.equal(result.session_id, init.session_id); assert.equal(result.result, 'SYNTHETIC_CONTROL');
        assert.equal(settled, false, 'Typed SDK result does not prove deliberately parked OS tail joined');
        const observation = JSON.parse(await fs.readFile(path.join(root, 'fixture-observation.json'), 'utf8'));
        assert.deepEqual(observation.argv, requests[0].args);
        assert.equal(observation.cwd, requests[0].cwd);
        assert.equal(observation.marker, requests[0].env.GITJIG_PROTOCOL_CANARY);
        query.close();
        const cleanup = await producer.close();
        const native = await launch.settled;
        assert.deepEqual(native, { cleanup: 'confirmed', exited: true, pipesClosed: true, scopeJoined: true });
        assert.deepEqual(cleanup, { cleanup: 'confirmed' });
        assert.equal(refusedNetwork, 0);
        await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({
            complete: true, syntheticOnly: true, payload, sdkFile, producerFile,
            hashes: { sdk: sha(await fs.readFile(sdkFile)), producer: sha(await fs.readFile(producerFile)),
                node: sha(await fs.readFile(node)), fixture: sha(fixtureBytes), executable: sha(wrapper) },
            originalCommand: requests[0].command, originalArgs: requests[0].args,
            sdkTypes: messages.map(message => message.type), typedResult: result.subtype,
            native, cleanup, refusedNetwork, realClaude: false, realAuth: false
        }, null, 2), { flag: 'wx', mode: 0o600 });
    } finally {
        clearTimeout(deadline);
        const cleanupErrors = [];
        try {
            try { query?.close(); } catch (error) { cleanupErrors.push(error); }
        } finally {
            try {
                try { await producer?.close(); } catch (error) { cleanupErrors.push(error); }
            } finally {
                http.request = original.http; https.request = original.https;
                net.Socket.prototype.connect = original.connect; globalThis.fetch = original.fetch;
            }
        }
        if (cleanupErrors.length === 1) throw cleanupErrors[0];
        if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'SDK and native producer cleanup failed');
    }
});
