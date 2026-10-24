import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {createScope} from '../../dist/execution/container-scope.js';
import {initializePiHost, createPiSession} from '../../dist/pi/index.js';

test('actual public SDK model/direct shell/file algorithms use the restricted engine and retain native history', {timeout: 30000}, async t => {
  assert.ok(process.env.GITJIG_DOCKER_CONTEXT && process.env.GITJIG_RUNTIME_IMAGE, 'Real selected engine/image required');
  const base = path.resolve('.runtime-fixtures'); await fs.mkdir(base, {recursive: true});
  const root = await fs.mkdtemp(path.join(base, 'sdk-engine-'));
  const workRoot = path.join(root, 'work'), stateRoot = path.join(root, 'state'), artifactRoot = path.join(root, 'artifacts');
  for (const dir of [workRoot, stateRoot, artifactRoot]) await fs.mkdir(dir, {mode: 0o700});
  const oldTemp = process.env.TMPDIR; process.env.TMPDIR = artifactRoot; // One host-process startup root, never per conversation.
  const scope = await createScope({
    dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE,
    dockerBinary: '/opt/homebrew/bin/docker', workRoot, stateRoot, workId: 'sdk-integration', runId: path.basename(root),
    uid: process.getuid(), gid: process.getgid(),
  });
  let product;
  t.after(async () => {
    if (product) { await product.session.abort(); product.session.dispose(); }
    assert.equal((await scope.close()).state, 'removed');
    if (oldTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTemp;
    await fs.rm(root, {recursive: true, force: true});
  });
  let turn = 0;
  const steps = [
    {name: 'write', args: {path: '한글.txt', content: 'alpha\n'}},
    {name: 'read', args: {path: '한글.txt'}},
    {name: 'edit', args: {path: '한글.txt', edits: [{oldText: 'alpha', newText: 'beta'}]}},
    {name: 'bash', args: {command: "node -e \"require('node:assert/strict').equal(6*7,42); console.log('REAL_TEST_OK')\""}},
    {name: 'bash', args: {command: 'printf forbidden > /opt/gitjig/forbidden'}},
  ];
  const definition = {
    baseUrl: 'http://unused.invalid', apiKey: 'fixture-only', api: 'sdk-engine-fixture',
    models: [{id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 32000, maxTokens: 1000}],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(async () => {
        await options?.onPayload?.({fixture: true}, model);
        const step = steps[turn++];
        const message = {
          role: 'assistant', content: step ? [{type: 'toolCall', id: `tool-${turn}`, name: step.name, arguments: step.args}] : [{type: 'text', text: 'fixture-complete'}],
          api: model.api, provider: model.provider, model: model.id,
          usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
          stopReason: step ? 'toolUse' : 'stop', timestamp: Date.now(),
        };
        stream.push({type: 'done', reason: message.stopReason, message}); stream.end(message);
      });
      return stream;
    },
  };
  const host = await initializePiHost({stateRoot, artifactRoot});
  product = await createPiSession({host, operations: scope, model: {provider: 'sdk-engine-fixture', modelId: 'fixture', definition}, systemPrompt: 'Fixture: only supplied project tools; commands execute in /work.', maxReadBytes: 1024 * 1024});
  const events = []; product.session.subscribe(event => events.push(event));
  await product.session.prompt('Execute the five fixed fixture steps; this is not workflow approval.');
  assert.equal(await fs.readFile(path.join(workRoot, '한글.txt'), 'utf8'), 'beta\n');
  const results = product.session.messages.filter(message => message.role === 'toolResult');
  assert.equal(results.length, 5);
  assert.equal(results.slice(0, 4).every(result => !result.isError), true);
  assert.match(JSON.stringify(results[3]), /REAL_TEST_OK/);
  assert.equal(results[4].isError, true);
  // Native history omits structuredContent. The actual producer end event
  // retains the machine result; do not manufacture it from a prose transcript.
  const failedExecution = events.find(event => event.type === 'tool_execution_end' && event.toolCallId === results[4].toolCallId);
  assert.ok(failedExecution); assert.equal(failedExecution.isError, true);
  assert.notEqual(failedExecution.result.structuredContent.exit_code, 0);
  assert.ok(events.some(event => event.type === 'agent_settled'));
  assert.ok(product.sessionManager.getEntries().length > 5);
  const direct = await product.executeUserBash('printf DIRECT_OK');
  assert.equal(direct.exitCode, 0); assert.equal(direct.output, 'DIRECT_OK');
  const hook = await product.session.extensionRunner.emitUserBash({type: 'user_bash', command: 'printf HOOK_OK', excludeFromContext: false, cwd: workRoot});
  assert.ok(hook.operations);
  const hooked = await product.session.executeBash('printf HOOK_OK', undefined, {operations: hook.operations});
  assert.equal(hooked.exitCode, 0); assert.equal(hooked.output, 'HOOK_OK');
  t.diagnostic(JSON.stringify({actualTools: 5, directShellRoutes: 2, liveProviderCalls: 0, hostMaxRssKiB: process.resourceUsage().maxRSS, scope: 'SDK-to-engine composition only; not independent review or standing'}));
});
