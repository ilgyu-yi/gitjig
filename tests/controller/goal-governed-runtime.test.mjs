import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { selectControllerModel } from '../../dist/cli/selected-model.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
import { scripted, withValueCases } from './effect-fixture.mjs';
test('goal consumes actual governed evidence and refuses a changed original obligation', { timeout: 60000 }, async () => {
  assert.ok(process.env.GITJIG_RUNTIME_FIXTURE_ROOT && process.env.GITJIG_DOCKER_CONTEXT && process.env.GITJIG_RUNTIME_IMAGE);
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.GITJIG_RUNTIME_FIXTURE_ROOT, 'goal-governed-'))), home = path.join(root, 'home'), source = path.join(root, 'source'), authPath = path.join(root, 'auth.json'), profile = path.join(root, 'model.json');
  await fs.mkdir(source); await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n'); await fs.writeFile(path.join(source, 'check.cjs'), withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
  await fs.writeFile(authPath, JSON.stringify({ openrouter: { type: 'api_key', key: 'DUMMY-GOAL-GOVERNED' } }), { mode: 0o600 }); await fs.writeFile(profile, JSON.stringify({ provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', native: { kind: 'pi-stored', credentialType: 'api_key', authPath } }), { mode: 0o600 });
  const oldFetch = globalThis.fetch, oldTemp = process.env.TMPDIR, roles = [], producer = scripted(undefined, info => roles.push(info.role));
  let c, calls = 0, release, entered, passed = false, evidenceCalls = 0, actualEvidence;
  const held = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions'); assert.ok(++calls <= 40);
    const body = JSON.parse(init.body), texts = body.messages.filter(x => x.role === 'user').map(x => typeof x.content === 'string' ? x.content : x.content.filter(v => v.type === 'text').map(v => v.text).join('')), first = texts[0], last = body.messages.at(-1), latest = texts.at(-1);
    const tool = (name, args) => wireResponse('openai-completions', body.model, { tool: { name, arguments: args } });
    if (body.tools.some(x => x.function.name === 'goal_review')) { entered(); await held; return tool('goal_review', { verdict: 'pass', reason: 'Attempted stale governed completion', findings: [], resolvedFindingIds: [] }); }
    if (first.startsWith('Perform the assigned ')) {
      const result = await producer.definition.streamSimple({ api: 'openai-completions', provider: 'openrouter', id: body.model }, { messages: [{ role: 'user', content: [{ type: 'text', text: first }] }] }).result();
      const call = result.content.find(x => x.type === 'toolCall'); return call ? tool(call.name, call.arguments) : wireResponse('openai-completions', body.model, { text: result.content.find(x => x.type === 'text').text });
    }
    if (latest.startsWith('Explicitly resumed authorized dependency outcomes')) {
      if (last.role === 'tool') return wireResponse('openai-completions', body.model, { text: 'Original governed assignment reached review ready with real checks' });
      return tool('goal_progress', { disposition: 'propose-completion', plan: 'Verify actual governed result', nextAction: 'Independent completion assessment', reason: 'Original workflow reported its current endpoint', resultIds: [] });
    }
    if (last.role === 'tool') return tool('conversation_wait', { resultHandles: [JSON.parse(last.content).assignmentId] });
    return tool('conversation_assign', { projectId: 'P', operation: 'change', instructions: 'Consumer must export3 using its existing simple implementation.', resultDependency: true });
  };
  try {
    c = await openController({ installationHome: home, runtimeProfile: { dockerBinary: process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, image: process.env.GITJIG_RUNTIME_IMAGE }, interactionDelegation: { projectIds: ['P'], maxAssignments: 2 } });
    await c.registerProject({ id: 'P', sourceRoot: source }); process.env.TMPDIR = path.join(home, 'artifacts');
    const original = c.changeCore.currentEvidence.bind(c.changeCore); c.changeCore.currentEvidence = async work => { const value = await original(work); evidenceCalls++; actualEvidence = value; return value; };
    const parent = c.createConversation(), goal = c.createGoal({ conversationId: parent.conversationId, objective: 'Make consumer export3 through the original governed workflow', criteria: ['Original candidate, checks and reviews are current'], turnLimit: 4 });
    c.startGoal({ goalId: goal.goalId, expectedRevision: goal.revision, model: await selectControllerModel(profile, c) }); await ready;
    const assignment = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=?', parent.conversationId); assert.equal(assignment.state, 'COMPLETE');
    const current = c.inspectChange(assignment.work); assert.equal(current.reviewReady, true, JSON.stringify(current.blocked)); assert.ok(current.checks.some(x => x.status === 'pass' && x.data.caseResults.complete));
    assert.ok(evidenceCalls >= 2); assert.ok(actualEvidence); assert.ok(roles.includes('implementer') && roles.includes('reviewer'));
    const target = c.inspectConversation(assignment.target), ownerDirection = c.inspectConversation(parent.conversationId).directionRevision;
    await c.queueConversationInput({ conversationId: target.conversationId, expectedGeneration: target.generation, text: 'Owner now requires value4; this changed obligation needs original fit and verification', mode: 'idle' });
    assert.equal(c.inspectConversation(parent.conversationId).directionRevision, ownerDirection, 'goal owner tuple is unchanged');
    await assert.rejects(original(assignment.work), /source|input|hold|ready|current|evidence|review/i);
    release(); const refused = await c.waitGoal(goal.goalId); assert.equal(refused.state, 'BLOCKED', refused.reason); assert.equal(refused.acceptedReview, undefined);
    assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n'); assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUEUED','QUARANTINED')").n, 0); passed = true;
  } finally { release(); await c?.close(); globalThis.fetch = oldFetch; if (oldTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTemp; if (passed) await fs.rm(root, { recursive: true, force: true }); else console.error('Preserved goal governed fixture: ' + root); }
});
