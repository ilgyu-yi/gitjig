import {applyCurrentVerificationFixture} from '../workflow/current-verification-fixture.mjs';
import {validateRuntimeProfile} from '../../dist/execution/container-scope.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url));
async function run(args, env = process.env) {
  try { const result = await exec(process.execPath, [cli, ...args], {env, timeout: 60000, maxBuffer: 4 * 1024 * 1024}); return {...result, code: 0}; }
  catch (error) { if (typeof error.code !== 'number') throw error; return error; }
}

async function runtimeRoot(prefix) {
  assert.ok(process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, 'Explicit private Docker configuration required');
  await validateRuntimeProfile({dockerBinary: process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, image: process.env.GITJIG_RUNTIME_IMAGE});
  const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT ?? path.resolve('.runtime-fixtures');
  assert.ok(path.isAbsolute(parent)); await fs.mkdir(parent, {recursive: true});
  return fs.realpath(await fs.mkdtemp(path.join(parent, prefix)));
}

test('public governed CLI reviews and conditionally integrates exact projection through owned HTTP and native Git', {timeout: 90000}, async t => {
  const root = await runtimeRoot('cli-change-');
  const home = path.join(root, 'home'), project = path.join(root, 'project'), profile = path.join(root, 'model.json');
  await fs.mkdir(project, {mode: 0o700});
  const basisSource = 'module.exports.owner = 10;\n\n\nmodule.exports.answer = 1;\n';
  const original = basisSource.replace('owner = 10', 'owner = 11');
  const producedSource = original.replace('answer = 1', 'answer = 2');
  await fs.writeFile(path.join(project, 'consumer.cjs'), basisSource);
  await fs.writeFile(path.join(project, 'check.cjs'), "const d=JSON.parse(require('fs').readFileSync('/input/verification-cases.json','utf8'));const cases=d.cases.map(c=>{const actual=require('./consumer.cjs').answer;return{id:c.id,inputDigest:c.inputDigest,observed:{kind:actual===Number(c.declaration.input.literalUtf8)?'return':'rejection',value:String(actual)}}});console.log(JSON.stringify({version:1,cases,assertions:[{id:'answer',passed:require('./consumer.cjs').answer===2}]}));\n");
  const git = process.env.GITJIG_GIT_BINARY ?? '/opt/homebrew/bin/git';
  await exec(git, ['init', '--quiet', '--initial-branch=main', project]);
  await exec(git, ['-C', project, 'add', '.']);
  await exec(git, ['-C', project, '-c', 'user.name=Owned fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '--no-gpg-sign', '--no-verify', '-m', 'Owned basis']);
  const basisCommit = (await exec(git, ['-C', project, 'rev-parse', 'HEAD'])).stdout.trim();
  const receiver = path.join(root, 'receiver.git');
  await exec(git, ['init', '--bare', '--quiet', '--template=', receiver]);
  await exec(git, ['--git-dir', receiver, 'fetch', '--quiet', '--no-tags', project, 'refs/heads/main']);
  await exec(git, ['--git-dir', receiver, 'update-ref', 'refs/heads/main', basisCommit]);
  await fs.writeFile(path.join(project, 'consumer.cjs'), original);
  const requests = [], sockets = new Set(); let accepted = false;
  const server = http.createServer(async (req, res) => {
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 3 * 1024 * 1024) throw Error('Fixture request bound exceeded'); chunks.push(chunk); }
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      const user = payload.messages.find(m => m.role === 'user');
      const text = typeof user.content === 'string' ? user.content : user.content.filter(c => c.type === 'text').map(c => c.text).join('');
      const role = text.match(/assigned (\w+) task/)[1], body = JSON.parse(text.split('\n')[1]);
      requests.push({role, stage: body.context.stage, ownerRequest: body.context.ownerRequest});
      const output = {version: 1, summary: 'Owned deterministic transport fixture', findings: [], assessedScope: body.requiredScope};
      if (role === 'planner') output.plan = {
        intent: 'Change the consumer answer to two and verify its actual exported value.',
        requirements: [{id: 'R1', text: 'The exported answer must be two.', source: body.context.ownerSource}],
        approach: 'Change the single constant.', simplerAlternative: 'A single constant edit is sufficient.',
        factualSources: ['base:consumer.cjs'], ambiguities: [],
        verification: {checks: [{id: 'actual-answer', guaranteeIds: ['R1'], command: 'node check.cjs', assertions: ['answer'], timeoutMs: 2000, fixturePaths: ['consumer.cjs', 'check.cjs'], expectationPaths: ['check.cjs']}], requiredPaths: ['consumer.cjs', 'check.cjs'], reviewRoles: [{key: 'general', kind: 'reviewer', purpose: 'Inspect exported behavior and actual check.', requiredPaths: ['consumer.cjs', 'check.cjs']}]},
      };
      if(role==='planner')output.plan.verification.checks[0].cases=[
        {id:'answer-healthy',kind:'healthy',guaranteeIds:['R1'],derivation:'Actual exported answer accepts required2',consumerPaths:['consumer.cjs'],input:{literalUtf8:'2',fixturePaths:[]},expected:{kind:'return',value:'2'}},
        {id:'answer-adverse',kind:'adverse',guaranteeIds:['R1'],derivation:'Actual exported answer rejects contradictory3',consumerPaths:['consumer.cjs'],input:{literalUtf8:'3',fixturePaths:[]},expected:{kind:'rejection',value:'2'}}];
      if (role === 'challenger') output.alternatives = ['The one constant edit is sufficient; preserve the existing consumer.'];
      if (role === 'adjudicator') {
        output.decisions = [];
        if (body.context.stage === 'planning-adjudication') { output.planAccepted = true; output.acceptedPlan = body.context.planProposal; }
      }
      if (role === 'reviewer') output.outcome = 'clear';
      applyCurrentVerificationFixture(output, body.context);
      const needsWrite = role === 'implementer' && !payload.messages.some(m => m.role === 'tool');
      const delta = needsWrite ? {role: 'assistant', tool_calls: [{index: 0, id: 'fixture-write', type: 'function', function: {name: 'write', arguments: JSON.stringify({path: 'consumer.cjs', content: producedSource})}}]} : {role: 'assistant', content: JSON.stringify(output)};
      const chunk = (value, finish_reason = null) => ({id: 'owned-cli-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{index: 0, delta: value, finish_reason}]});
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk({}, needsWrite ? 'tool_calls' : 'stop'))}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (error) { res.destroy(error); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); if (accepted) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic(`Failed CLI fixture retained: ${root}`); });
  await fs.writeFile(profile, JSON.stringify({provider: 'owned-cli-http', modelId: 'fixture', definition: {baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-only', api: 'openai-completions', models: [{id: 'fixture', name: 'Owned fixture', reasoning: false, input: ['text'], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 100000, maxTokens: 10000}]}}), {mode: 0o600});
  const registered = await run(['project', 'register', '--home', home, '--id', 'P', '--root', project]);
  assert.equal(registered.code, 0, registered.stderr);
  const request = 'consumer의 answer를 2로 고치고 실제 반환값을 검증하라.';
  const result = await run(['change', 'start', '--home', home, '--project', 'P', '--message', request, '--model-profile', profile, '--docker-binary', process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', '--docker-context', process.env.GITJIG_DOCKER_CONTEXT, '--docker-config-directory', process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, '--image', process.env.GITJIG_RUNTIME_IMAGE], {...process.env, TMPDIR: path.join(home, 'artifacts')});
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const view = JSON.parse(result.stdout);
  assert.equal(view.reviewReady, true); assert.equal(view.phase, 'REVIEW_READY');
  assert.ok(view.checks.some(check => check.status === 'pass' && check.data.actual.exitCode === 0));
  assert.deepEqual(requests.map(r => r.role), ['planner', 'challenger', 'adjudicator', 'implementer', 'implementer', 'reviewer', 'adjudicator']);
  assert.ok(requests.every(r => r.ownerRequest === request));
  const candidate = view.versions.find(v => v.id === view.candidateVersion);
  assert.equal(await fs.readFile(path.join(candidate.artifact, 'consumer.cjs'), 'utf8'), producedSource);
  assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), original);
  const inspected = await run(['change', 'inspect', '--home', home, '--work', view.workId]);
  assert.equal(inspected.code, 0, inspected.stderr); assert.equal(JSON.parse(inspected.stdout).candidateVersion, view.candidateVersion);
  assert.equal(view.resolution.consumed, 4); assert.equal(view.resolution.reserved, 0);
  const targetProfile = path.join(root, 'target.json');
  await fs.writeFile(targetProfile, JSON.stringify({ projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit,
    publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs'] }), { mode: 0o600 });
  const registeredTarget = await run(['effect', 'register-target', '--home', home, '--target-profile', targetProfile, '--git-binary', git]);
  assert.equal(registeredTarget.code, 0, registeredTarget.stdout + registeredTarget.stderr);
  const targetId = JSON.parse(registeredTarget.stdout).targetId;
  const runtime = ['--docker-binary', process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', '--docker-context', process.env.GITJIG_DOCKER_CONTEXT, '--docker-config-directory', process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, '--image', process.env.GITJIG_RUNTIME_IMAGE];
  const prepareArgs = ['effect', 'prepare-integration', '--home', home, '--work', view.workId, '--target', targetId, '--model-profile', profile, '--git-binary', git, ...runtime];
  const denied = await run(prepareArgs, { ...process.env, TMPDIR: path.join(home, 'artifacts') });
  assert.equal(denied.code, 2); assert.equal(requests.length, 7);
  assert.equal((await exec(git, ['--git-dir', receiver, 'rev-parse', 'refs/heads/main'])).stdout.trim(), basisCommit);
  const delegated = await run(['effect', 'delegate-integration', '--home', home, '--work', view.workId, '--target', targetId, '--operation-limit', '1']);
  assert.equal(delegated.code, 0, delegated.stdout + delegated.stderr);
  const preparing = await run(prepareArgs, { ...process.env, TMPDIR: path.join(home, 'artifacts') });
  assert.equal(preparing.code, 0, preparing.stdout + preparing.stderr);
  const prepared = JSON.parse(preparing.stdout); assert.equal(prepared.phase, 'RESERVED'); assert.notEqual(prepared.candidateVersion, view.candidateVersion);
  assert.ok(requests.length > 7, 'Projected actual context must receive fresh independent review');
  const dispatched = await run(['effect', 'dispatch', '--home', home, '--operation', prepared.operationId, '--git-binary', git]);
  assert.equal(dispatched.code, 0, dispatched.stdout + dispatched.stderr);
  const landed = JSON.parse(dispatched.stdout); assert.equal(landed.phase, 'CONFIRMED');
  assert.equal((await exec(git, ['--git-dir', receiver, 'show', 'refs/heads/main:consumer.cjs'])).stdout, basisSource.replace('answer = 1', 'answer = 2'));
  assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), original);
  const offline = await exec(process.execPath, ['--import', fileURLToPath(new URL('./no-sdk-loader.mjs', import.meta.url)), cli, 'effect', 'inspect', '--home', home, '--operation', prepared.operationId], { timeout: 10000 });
  assert.equal(JSON.parse(offline.stdout).phase, 'CONFIRMED');
  const repeated = await run(['effect', 'reconcile', '--home', home, '--operation', prepared.operationId, '--git-binary', git]);
  assert.equal(repeated.code, 0, repeated.stdout + repeated.stderr); assert.equal(JSON.parse(repeated.stdout).integrationCommit, landed.integrationCommit);
  assert.equal((await exec(git, ['--git-dir', receiver, 'rev-parse', 'refs/heads/main'])).stdout.trim(), landed.integrationCommit);
  t.diagnostic(JSON.stringify({actualOfficialHTTPRequests: requests.length, externalCalls: 0, endpoint: 'CONFIRMED_LOCAL_INTEGRATION', operationId: landed.operationId, basisCommit, headCommit: landed.headCommit, integrationCommit: landed.integrationCommit, currentCandidate: landed.candidateVersion, receiptIds: landed.receiptIds, transportOutcome: landed.transportOutcome, observedOutcome: landed.observedOutcome, ownerSourcePreserved: true, preexistingOwnerEditPublished: false, offlineInspectionNoSDK: true}));
  accepted = true;
});

test('public governed CLI SIGINT stops an actual active official provider request without launching the next role', {timeout: 30000}, async t => {
  const root = await runtimeRoot('cli-change-cancel-');
  const home = path.join(root, 'home'), project = path.join(root, 'project'), profile = path.join(root, 'model.json');
  await fs.mkdir(project, {mode: 0o700}); await fs.writeFile(path.join(project, 'source.txt'), 'Original owner bytes\n');
  let requests = 0, accepted = false, receive;
  const received = new Promise(resolve => { receive = resolve; }), sockets = new Set();
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* Drain the actual native SDK request. */ }
    requests++; res.writeHead(200, {'content-type': 'text/event-stream'}); res.flushHeaders(); receive();
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let child, ended;
  t.after(async () => {
    let timer;
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGINT');
        await Promise.race([ended, new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Original CLI cleanup remains UNKNOWN after graceful join; no forced termination')), 20000);})]);
      }
    } finally {
      clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      const unsettled = child && child.exitCode === null && child.signalCode === null;
      if (accepted && !unsettled) await fs.rm(root, {recursive: true, force: true});
      else {
        await fs.writeFile(path.join(root, 'cleanup-disposition.json'), JSON.stringify({pid: child?.pid ?? null, unsettled: Boolean(unsettled), forceKill: false, disposition: 'Retained original fixture; inspect actual owned run and runtime cleanup before retry'}));
        t.diagnostic(`Failed cancellation fixture retained: ${root}`);
      }
    }
  });
  await fs.writeFile(profile, JSON.stringify({provider: 'owned-cancel-http', modelId: 'fixture', definition: {baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-only', api: 'openai-completions', models: [{id: 'fixture', name: 'Owned fixture', reasoning: false, input: ['text'], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 100000, maxTokens: 10000}]}}), {mode: 0o600});
  assert.equal((await run(['project', 'register', '--home', home, '--id', 'P', '--root', project])).code, 0);
  const runtime = ['--docker-binary', process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', '--docker-context', process.env.GITJIG_DOCKER_CONTEXT, '--docker-config-directory', process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, '--image', process.env.GITJIG_RUNTIME_IMAGE];
  child = spawn(process.execPath, [cli, 'change', 'start', '--home', home, '--project', 'P', '--message', 'Inspect and improve the source without losing owner content.', '--model-profile', profile, ...runtime], {env: {...process.env, TMPDIR: path.join(home, 'artifacts')}, shell: false});
  const stdout = [], stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk));
  ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal})); });
  let deadline; await Promise.race([received, new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Provider request barrier not reached')), 15000); })]).finally(() => clearTimeout(deadline));
  assert.equal(child.kill('SIGINT'), true);
  const ending = await ended;
  assert.equal(ending.code, 2, JSON.stringify(ending) + Buffer.concat(stdout).toString() + Buffer.concat(stderr).toString());
  const view = JSON.parse(Buffer.concat(stdout).toString());
  assert.equal(view.reviewReady, false); assert.equal(requests, 1); assert.equal(view.candidateVersion, null);
  const inspected = await run(['work', 'inspect', '--home', home, '--work', view.workId]);
  assert.equal(inspected.code, 0, inspected.stderr);
  const work = JSON.parse(inspected.stdout);
  assert.equal(work.state, 'CANCELLED'); assert.equal(work.allowance.reserved, 0);
  assert.ok(work.runs.some(run => run.data.cleanup === 'removed'));
  const listing = await exec(process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', ['--config', process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, '--context', process.env.GITJIG_DOCKER_CONTEXT, 'ps', '-aq', '--filter', `label=gitjig.work=${view.workId}`]);
  assert.equal(listing.stdout.trim(), '');
  assert.equal(await fs.readFile(path.join(project, 'source.txt'), 'utf8'), 'Original owner bytes\n');
  t.diagnostic(JSON.stringify({actualOfficialHTTPRequests: requests, externalCalls: 0, state: work.state, ownedScopesRemaining: 0}));
  accepted = true;
});
