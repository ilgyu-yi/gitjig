import test from 'node:test';
import {assignedWireReply} from '../pi/assigned-report-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { selectControllerModel } from '../../dist/cli/selected-model.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';

test('original goal WAIT charges one resumed turn and preserves real child result provenance', { timeout: 25000 }, async () => {
  const base = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
  assert.ok(base && process.env.GITJIG_DOCKER_CONTEXT && process.env.GITJIG_RUNTIME_IMAGE, 'explicit qualified engine profile required');
  const root = await fs.realpath(await fs.mkdtemp(path.join(base, 'goal-wait-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
  await fs.mkdir(source); await fs.writeFile(path.join(source, 'observed.txt'), 'ACTUAL_GOAL_CHILD_SCOPE');
  const authPath = path.join(root, 'auth.json'), profile = path.join(root, 'model.json');
  await fs.writeFile(authPath, JSON.stringify({ openrouter: { type: 'api_key', key: 'DUMMY-GOAL-WAIT' } }), { mode: 0o600 });
  await fs.writeFile(profile, JSON.stringify({ provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', native: { kind: 'pi-stored', credentialType: 'api_key', authPath } }), { mode: 0o600 });
  const oldFetch = globalThis.fetch, oldTemp = process.env.TMPDIR;
  let c, calls = 0, entered, release, passed = false, childCalls = 0, parkResume = false, resumeEntered, reviewEntered, releaseReview, reproposal = false;
  const resumed = new Promise(resolve => { resumeEntered = resolve; }), reviewReady = new Promise(resolve => { reviewEntered = resolve; }), reviewHeld = new Promise(resolve => { releaseReview = resolve; });
  const ready = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions'); assert.ok(++calls <= 32);
    const body = JSON.parse(init.body), users = body.messages.filter(x => x.role === 'user').map(x => typeof x.content === 'string' ? x.content : x.content.filter(v => v.type === 'text').map(v => v.text).join(''));
    const last = body.messages.at(-1), first = users[0] ?? '', latest = users.at(-1) ?? '';
    const tool = (name, args) => wireResponse('openai-completions', body.model, { tool: { name, arguments: args } });
    if (body.tools.some(x => x.function.name === 'goal_review')) {
      if (last.role === 'tool') return wireResponse('openai-completions', body.model, { text: 'Independent current child evidence verified' });
      assert.match(first, /ACTUAL_GOAL_CHILD_SCOPE/); assert.doesNotMatch(first, /HISTORICAL_FAILED_NESTED/);
      return tool('goal_review', { verdict: 'pass', reason: 'Original child result includes actual project observation', findings: [], resolvedFindingIds: [] });
    }
    if (reproposal && body.tools.some(x => x.function.name === 'goal_progress')) {
      if (last.role === 'tool') return wireResponse('openai-completions', body.model, { text: 'Current refreshed observation verified after explicit recovery' });
      return tool('goal_progress', { disposition: 'propose-completion', plan: 'Verify refreshed exact result', nextAction: 'Independent review', reason: 'Owner explicitly resumed after current result repair', resultIds: [] });
    }
    if (first.startsWith('HISTORICAL_FAILED_NESTED')) return wireResponse('openai-completions', body.model, { text: '' });
    if (latest.startsWith('HISTORICAL_TARGET')) {
      if (last.role === 'tool') return wireResponse('openai-completions', body.model, assignedWireReply(body, { text: 'Historical owner run settled independently' }));
      return tool('conversation_assign', { projectId: 'P', instructions: 'HISTORICAL_FAILED_NESTED', resultDependency: false });
    }
    if (first.includes('CHILD_GOAL_OBSERVATION')) {
      if (++childCalls === 1) return tool('read', { path: 'observed.txt' });
      assert.match(JSON.stringify(body.messages), /ACTUAL_GOAL_CHILD_SCOPE/); entered(); await held;
      return wireResponse('openai-completions', body.model, assignedWireReply(body, { text: 'Observed ACTUAL_GOAL_CHILD_SCOPE in the original project scope' }));
    }
    if (latest.startsWith('Explicitly resumed authorized dependency outcomes (outcome is not success):')) {
      if (parkResume) { resumeEntered(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Owner stops original WAIT resume', 'AbortError')), { once: true })); }
      if (last.role === 'tool') return wireResponse('openai-completions', body.model, { text: 'Observed child result meets the goal criterion' });
      reviewEntered(); await reviewHeld;
      return tool('goal_progress', { disposition: 'propose-completion', plan: 'Read actual child result', nextAction: 'Independent review', reason: 'Original dependency delivered', resultIds: [] });
    }
    if (last.role === 'tool') {
      const receipt = JSON.parse(last.content); return tool('conversation_wait', { resultHandles: [receipt.assignmentId] });
    }
    return tool('conversation_assign', { projectId: 'P', instructions: 'CHILD_GOAL_OBSERVATION: read observed.txt and report actual content', resultDependency: true });
  };
  try {
    c = await openController({ installationHome: home, runtimeProfile: { dockerBinary: process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, image: process.env.GITJIG_RUNTIME_IMAGE }, interactionDelegation: { projectIds: ['P'], maxAssignments: 2 } });
    await c.registerProject({ id: 'P', sourceRoot: source }); process.env.TMPDIR = path.join(home, 'artifacts');
    const parent = c.createConversation(), goal = c.createGoal({ conversationId: parent.conversationId, objective: 'Read the actual delegated project observation', criteria: ['Actual child scope observation is retained and independently checked'], turnLimit: 4 });
    c.startGoal({ goalId: goal.goalId, expectedRevision: goal.revision, model: await selectControllerModel(profile, c) }); await ready;
    for (let i = 0; i < 200 && c.inspectGoal(goal.goalId).state !== 'WAITING_DEPENDENCY'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(c.inspectGoal(goal.goalId).state, 'WAITING_DEPENDENCY'); assert.equal(c.inspectGoal(goal.goalId).startedAttempts, 1);
    release(); await reviewReady;
    const assignments = c.store.all('SELECT * FROM conversation_assignments'); assert.equal(assignments.length, 1); assert.equal(assignments[0].state, 'COMPLETE');
    const child = c.inspectConversation(assignments[0].target); assert.equal(child.parentId, parent.conversationId); assert.match(await fs.readFile(child.historyRef, 'utf8'), /ACTUAL_GOAL_CHILD_SCOPE/);
    // After the exact assigned observation was delivered, an unrelated owner run
    // on that same work creates an unavailable nested task. It is not a goal edge.
    const model = await selectControllerModel(profile, c);
    await c.queueConversationInput({ conversationId: child.conversationId, expectedGeneration: child.generation, text: 'HISTORICAL_TARGET: create an unrelated nested observation after delivery', mode: 'idle' });
    const historical = await c.runConversation({ conversationId: child.conversationId, model }); assert.equal(historical.status, 'delivered'); assert.equal(historical.workId, child.workId);
    let unrelated; for (let i = 0; i < 500; i++) { unrelated = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=? ORDER BY rowid DESC LIMIT 1', child.conversationId); if (unrelated?.state === 'UNAVAILABLE') break; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.equal(unrelated.state, 'UNAVAILABLE'); assert.equal(JSON.parse(unrelated.data).source.runId, historical.runId);
    // Original assignment results track later target turns. Refresh its current
    // observation before the author proposes, retaining the unrelated middle run.
    const latestTarget = c.inspectConversation(child.conversationId); childCalls = 0;
    await c.queueConversationInput({ conversationId: child.conversationId, expectedGeneration: latestTarget.generation, text: 'CHILD_GOAL_OBSERVATION: refresh the current delivered observation', mode: 'idle' });
    const refreshed = await c.runConversation({ conversationId: child.conversationId, model }); assert.equal(refreshed.status, 'delivered'); assert.equal(refreshed.workId, historical.workId);
    assert.equal(JSON.parse(c.store.one('SELECT data FROM conversation_assignments WHERE id=?', assignments[0].id).data).result.runId, refreshed.runId);
    assert.equal(c.inspectGoal(goal.goalId).state, 'ACTIVE');
    // Original notices may add context while fetch is held. Keep the scripted
    // author in its proposal phase instead of assigning again on a new notice.
    reproposal = true; releaseReview();
    const done = await c.waitGoal(goal.goalId); assert.equal(done.state, 'COMPLETED', done.reason); assert.equal(done.startedAttempts, 3);
    assert.deepEqual(done.attempts.map(x => x.kind), ['author', 'author', 'reviewer']); assert.equal(JSON.parse(assignments[0].data).source.runId, done.attempts[0].runId);
    const recoveryWorks=c.goalRecoveryWorkIds(goal.goalId);
    assert.ok(recoveryWorks.includes(historical.workId),'Actual delegated child work remains discoverable for recovery');
    for(const attempt of done.attempts){const original=c.store.one('SELECT work FROM runs WHERE id=?',attempt.runId);assert.ok(recoveryWorks.includes(original.work),'Exact original goal attempt work remains linked');}
    const related = c.goalCore.links(goal.goalId); assert.equal(related.length, 1); assert.notEqual(related[0].id, unrelated.id); assert.equal(related[0].work, historical.workId);
    assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', unrelated.id).state, 'UNAVAILABLE');
    assert.equal(c.store.all('PRAGMA foreign_key_check').length, 0);
    // This original automatic run is not dispatched by Goals.dispatch().
    parkResume = true; childCalls = 0; reproposal = false;
    const other = c.createGoal({ conversationId: c.createConversation().conversationId, objective: 'Pause an original automatic WAIT continuation', criteria: ['The exact resumed producer is aborted and joined'], turnLimit: 4 });
    c.startGoal({ goalId: other.goalId, expectedRevision: other.revision, model: await selectControllerModel(profile, c) }); await resumed;
    const running = c.inspectGoal(other.goalId), resumedRun = running.attempts.at(-1); assert.equal(running.startedAttempts, 2); assert.equal(resumedRun.state, 'RUNNING');
    assert.equal(c.goalCore.signals.has(other.goalId), false, 'automatic WAIT is outside the explicit goal dispatch signal');
    const paused = await Promise.race([c.pauseGoal({ goalId: other.goalId, expectedRevision: running.revision, reason: 'Owner pauses the actual automatic continuation' }), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Automatic WAIT producer was not joined')), 2000); timer.unref(); })]);
    assert.equal(paused.state, 'PAUSED'); assert.equal(paused.startedAttempts, 2); assert.notEqual(paused.attempts.at(-1).state, 'RUNNING');
    assert.equal(c.getNativeHandle(other.conversationId), null); assert.equal(c.inspectConversation(other.conversationId).state, 'IDLE');
    assert.equal(c.store.one('SELECT phase FROM runs WHERE id=?', resumedRun.runId).phase, 'SETTLED');
    assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUEUED','QUARANTINED')").n, 0); passed = true;
  } finally {
    release(); releaseReview(); await c?.close(); globalThis.fetch = oldFetch; if (oldTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTemp;
    if (passed) await fs.rm(root, { recursive: true, force: true }); else console.error('Preserved goal WAIT fixture: ' + root);
  }
});
