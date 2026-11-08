import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { selectControllerModel } from '../../dist/cli/selected-model.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';

// Real original SDK codec, tool dispatch, ordinary admission and cleanup. No service.
test('durable goals use original turns, fresh strict review and finite owner controls', { timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(path.resolve('.runtime-fixtures/goal-native-'));
  const home = path.join(root, 'home'), oldFetch = globalThis.fetch, oldTemp = process.env.TMPDIR;
  const profile = path.join(root, 'model.json'), authPath = path.join(root, 'auth.json');
  await fs.writeFile(authPath, JSON.stringify({ openrouter: { type: 'api_key', key: 'DUMMY-GOAL-ONLY' } }), { mode: 0o600 });
  await fs.writeFile(profile, JSON.stringify({ provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', native: { kind: 'pi-stored', credentialType: 'api_key', authPath } }), { mode: 0o600 });
  let c, script = [], requests = [], success = false, passed = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer DUMMY-GOAL-ONLY');
    const body = JSON.parse(init.body); requests.push(body);
    assert.ok(requests.length <= 50, 'finite total request cap');
    assert.ok(script.length, 'no undeclared provider request');
    const response = script.shift();
    if (typeof response === 'function') return response(body, init);
    return wireResponse('openai-completions', body.model, response);
  };
  const progress = (disposition = 'propose-completion', resultIds = []) => ({ tool: { name: 'goal_progress', arguments: { disposition, plan: 'Verify the answer', nextAction: 'Assess evidence', reason: 'Synthetic observable result', resultIds } } });
  const verdict = (value = 'pass', findings = [], resolvedFindingIds = []) => ({ tool: { name: 'goal_review', arguments: { verdict: value, reason: 'Independent criterion assessment', findings, resolvedFindingIds } } });
  const reply = { text: 'SYNTHETIC settled answer' };
  const goal = (limit = 8) => c.createGoal({ conversationId: c.createConversation().conversationId, objective: 'Explain a fixture result', criteria: ['Answer explains the observed fixture result'], turnLimit: limit });
  const run = async g => { c.startGoal({ goalId: g.goalId, expectedRevision: g.revision, model: await selectControllerModel(profile, c) }); return c.waitGoal(g.goalId); };
  try {
    c = await openController({ installationHome: home }); process.env.TMPDIR = path.join(home, 'artifacts');
    await t.test('Korean goal retains human language across English automatic continuation while strict review stays internal English',async()=>{
      const objective='검증된 결과를 한국어로 설명해줘.',g=c.createGoal({conversationId:c.createConversation().conversationId,objective,criteria:['Answer describes the observed result'],turnLimit:6});
      const ownerPolicy=body=>{const system=body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');assert.match(system,/English is mandatory/);assert.match(system,/Conversation language:/);assert.match(system,/Generated English goal\/dependency continuations/);assert.ok(system.includes(objective));};
      script=[body=>{ownerPolicy(body);return wireResponse('openai-completions',body.model,{text:'진행 상황을 확인하고 있습니다.'});},body=>{ownerPolicy(body);return wireResponse('openai-completions',body.model,progress());},{text:'검증된 결과를 설명합니다.'},body=>{
        const system=body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');assert.match(system,/Internal audience:/);assert.ok(!system.includes('Conversation language:'));return wireResponse('openai-completions',body.model,verdict());
      },reply];
      const result=await run(g);assert.equal(result.state,'COMPLETED',result.reason);assert.equal(result.startedAttempts,3);assert.equal(script.length,0);passed++;
    });
    await t.test('prose-only continuation cannot self-complete; review has fresh context and reduced tools', async () => {
      const g = goal(); script = [{ text: 'PRIVATE_PREVIOUS_PROGRESS_ONLY' }, progress(), reply, (body) => {
        const tools = body.tools.map(x => x.function.name).sort();
        assert.deepEqual(tools, ['goal_review', 'goal_status', 'read']);
        assert.ok(!JSON.stringify(body.messages).includes('PRIVATE_PREVIOUS_PROGRESS_ONLY'), 'author private transcript is not copied');
        return wireResponse('openai-completions', body.model, verdict());
      }, reply];
      const result = await run(g);
      assert.equal(result.state, 'COMPLETED', result.reason); assert.equal(result.startedAttempts, 3);
      assert.deepEqual(result.attempts.map(x => x.kind), ['author', 'author', 'reviewer']);
      assert.notEqual(result.reviewConversationId, g.conversationId);
      assert.equal(c.inspectConversation(result.reviewConversationId).parentId, g.conversationId);
      assert.equal(result.acceptedReview.runId, result.attempts.at(-1).runId);
      assert.equal(script.length, 0); passed++;
    });
    await t.test('rejection retains a host finding until explicit independent resolution', async () => {
      const g = goal(); script = [progress(), reply, verdict('reject', [{ criterion: 0, description: 'Explain the missing observation' }]), reply,
        (body) => { assert.match(JSON.stringify(body.messages), /Explain the missing observation/); return wireResponse('openai-completions', body.model, progress()); }, reply,
        body => { const pending = c.inspectGoal(g.goalId).findings.filter(x => x.state === 'pending'); assert.equal(pending.length, 1); return wireResponse('openai-completions', body.model, verdict('pass', [], [pending[0].id])); }, reply];
      const result = await run(g); assert.equal(result.state, 'COMPLETED', result.reason); assert.equal(result.startedAttempts, 4);
      assert.equal(result.findings.length, 1); assert.equal(result.findings[0].state, 'resolved'); assert.equal(script.length, 0); passed++;
    });
    await t.test('last author proposal exhausts allowance without a fabricated review', async () => {
      const g = goal(1); script = [progress(), reply]; const result = await run(g);
      assert.equal(result.state, 'BUDGET_EXHAUSTED'); assert.equal(result.startedAttempts, 1); assert.equal(result.reviewConversationId, null); assert.equal(script.length, 0); passed++;
    });
    await t.test('foreign evidence blocks before review dispatch', async () => {
      const g = goal(); script = [progress('propose-completion', ['foreign-result']), reply]; const result = await run(g);
      assert.equal(result.state, 'BLOCKED'); assert.match(result.reason, /Foreign or stale/); assert.equal(result.startedAttempts, 1); assert.equal(script.length, 0); passed++;
    });
    await t.test('pause joins only its own actual turn and restart retains monotonic spend', async () => {
      const a = goal(), b = goal(); let entered = 0, release;
      const both = new Promise(resolve => { release = resolve; });
      const held = (_body, init) => new Promise((_resolve, reject) => {
        if (++entered === 2) release();
        assert.ok(init.signal); init.signal.addEventListener('abort', () => reject(new DOMException('Owned stop', 'AbortError')), { once: true });
      });
      script = [held, held]; const model = await selectControllerModel(profile, c);
      c.startGoal({ goalId: a.goalId, expectedRevision: a.revision, model });
      c.startGoal({ goalId: b.goalId, expectedRevision: b.revision, model }); await both;
      const current = c.inspectGoal(a.goalId);
      const paused = await Promise.race([c.pauseGoal({ goalId: a.goalId, expectedRevision: current.revision, reason: 'Owner stops A' }), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('A pause joined unrelated B')), 2000); timer.unref(); })]);
      assert.equal(paused.state, 'PAUSED'); assert.equal(paused.startedAttempts, 1);
      assert.equal(c.inspectGoal(b.goalId).state, 'ACTIVE', 'B still owns its held request');
      await c.close(); c = await openController({ installationHome: home });
      assert.equal(c.inspectGoal(a.goalId).state, 'PAUSED'); assert.equal(c.inspectGoal(b.goalId).state, 'INTERRUPTED');
      assert.equal(c.inspectGoal(b.goalId).startedAttempts, 1); assert.equal(script.length, 0);
      const count = requests.length; await new Promise(resolve => setImmediate(resolve)); assert.equal(requests.length, count, 'reopening never dispatches');
      script = [progress(), reply, verdict(), reply];
      const retained = c.inspectGoal(a.goalId), originalInput = c.pendingGoalInput(a.goalId);
      assert.equal(originalInput.length, 1);
      c.startGoal({goalId:retained.goalId, expectedRevision:retained.revision, reconcileInputId:originalInput[0].inputId, model:await selectControllerModel(profile,c)});
      const resumed = await c.waitGoal(a.goalId); assert.equal(resumed.state, 'COMPLETED', resumed.reason); assert.equal(resumed.startedAttempts, 3);
      assert.equal(script.length, 0); passed++;
    });
    await t.test('owner direction during a real held review prevents stale completion', async () => {
      const g = goal(); let release, entered;
      const ready = new Promise(resolve => { entered = resolve; });
      script = [progress(), reply, (body) => new Promise(resolve => { release = () => resolve(wireResponse('openai-completions', body.model, verdict())); entered(); })];
      c.startGoal({ goalId: g.goalId, expectedRevision: g.revision, model: await selectControllerModel(profile, c) }); await ready;
      const review = c.inspectGoal(g.goalId).reviewConversationId, handle = c.getNativeHandle(review);
      assert.ok(handle); await assert.rejects(handle.executeUserBash('printf forbidden-review-exec'), /review is read-only/);
      const owner = c.inspectConversation(g.conversationId);
      await c.queueConversationInput({ conversationId: g.conversationId, expectedGeneration: owner.generation, text: 'Owner changes the question; retain this input', mode: 'idle' });
      release(); const result = await c.waitGoal(g.goalId);
      assert.notEqual(result.state, 'COMPLETED'); assert.ok(['BLOCKED', 'WAITING_INPUT'].includes(result.state), result.reason);
      assert.equal(result.acceptedReview, undefined); assert.equal(c.pendingGoalInput(g.goalId).length, 1); assert.equal(script.length, 0); passed++;
    });
    await t.test('reviewer input during the original final evidence await cannot accept an old verdict', async () => {
      const g = goal(); let entered, release;
      const ready = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
      // Controlled scheduling seam only: retain the exact result of original evidence().
      // No source, evidence or verdict is supplied by this wrapper.
      const core = c.goalCore, evidence = core.evidence.bind(core);
      core.evidence = async a => { const value = await evidence(a); const view = c.inspectGoal(g.goalId); if (view.state === 'REVIEWING' && view.attempts.at(-1)?.state === 'SETTLED') { entered(); await held; } return value; };
      try {
        script = [progress(), reply, verdict(), reply]; c.startGoal({ goalId: g.goalId, expectedRevision: g.revision, model: await selectControllerModel(profile, c) }); await ready;
        const view = c.inspectGoal(g.goalId), reviewer = c.inspectConversation(view.reviewConversationId), ownerDirection = c.inspectConversation(g.conversationId).directionRevision;
        await c.queueConversationInput({ conversationId: reviewer.conversationId, expectedGeneration: reviewer.generation, text: 'Reviewer owner adds a new unresolved question', mode: 'idle' });
        assert.equal(c.inspectConversation(g.conversationId).directionRevision, ownerDirection, 'only reviewer CID changed');
        release(); const result = await c.waitGoal(g.goalId); assert.equal(result.state, 'BLOCKED'); assert.match(result.reason, /review producer|reviewer native\/input|reviewer changed/);
        assert.equal(result.acceptedReview, undefined); assert.equal(script.length, 0); passed++;
      } finally { release(); core.evidence = evidence; }
    });
    await t.test('unavailable reviewer must reconcile its own cleanup before explicit resumed work', async () => {
      const g = goal(); script = [progress(), reply, { text: '' }]; const failed = await run(g);
      assert.equal(failed.state, 'BLOCKED'); const reviewer = failed.attempts.at(-1); assert.equal(reviewer.kind, 'reviewer'); assert.equal(reviewer.state, 'UNAVAILABLE');
      const runRow = c.store.one('SELECT data FROM runs WHERE id=?', reviewer.runId), producer = c.store.one('SELECT resource FROM conversation_state WHERE conversation=?', reviewer.conversationId), charged = failed.startedAttempts;
      // Explicit negative storage fault, not manufactured successful cleanup/authority.
      c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(runRow.data), cleanup: 'quarantined-native' }), reviewer.runId);
      c.store.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?", reviewer.conversationId);
      const model = await selectControllerModel(profile, c);
      assert.throws(() => c.startGoal({ goalId: g.goalId, expectedRevision: failed.revision, model }), /producer\/native cleanup remains unavailable/);
      assert.equal(c.inspectGoal(g.goalId).startedAttempts, charged); assert.equal(script.length, 0);
      // Restore the exact actually observed original cleanup bytes, then use original admission.
      c.store.run('UPDATE runs SET data=? WHERE id=?', runRow.data, reviewer.runId); c.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', producer.resource, reviewer.conversationId);
      script = [progress(), reply, verdict(), reply]; const result = await run(c.inspectGoal(g.goalId)); assert.equal(result.state, 'COMPLETED', result.reason); assert.equal(result.startedAttempts, charged + 2); assert.equal(script.length, 0); passed++;
    });
    await t.test('normal close retains unstarted goals; management reopening does not dispatch', async () => {
      const g = goal(); await c.close(); c = await openController({ installationHome: home, managementOnly: true });
      const result = c.inspectGoal(g.goalId); assert.equal(result.state, 'READY'); assert.equal(result.startedAttempts, 0);
      assert.throws(() => c.createGoal({ conversationId: g.conversationId, objective: 'duplicate', criteria: ['duplicate'] }), /without an unfinished goal/); passed++;
    });
    assert.equal(passed, 10, 'all selected causal cases passed');
    success = true;
  } finally {
    await c?.close(); globalThis.fetch = oldFetch;
    if (oldTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTemp;
    if (success) await fs.rm(root, { recursive: true, force: true }); else console.error('Preserved goal fixture: ' + root);
  }
});
