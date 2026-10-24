import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openController } from '../../dist/controller/index.js';
test('real process death retains admitted goal attempt and never dispatches on reopen', { timeout: 10000 }, async () => {
  const root = await fs.mkdtemp(path.resolve('.runtime-fixtures/goal-crash-')), home = path.join(root, 'home'), profile = path.join(root, 'model.json'), authPath = path.join(root, 'auth.json'), entered = path.join(root, 'entered.json'), config = path.join(root, 'config.json');
  await fs.writeFile(authPath, JSON.stringify({ openrouter: { type: 'api_key', key: 'DUMMY-CRASH' } }), { mode: 0o600 });
  await fs.writeFile(profile, JSON.stringify({ provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', native: { kind: 'pi-stored', credentialType: 'api_key', authPath } }), { mode: 0o600 });
  await fs.writeFile(config, JSON.stringify({ home, profile, entered }));
  const child = spawn(process.execPath, [path.resolve('tests/controller/goal-crash-child.mjs'), config], { stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = '', c, passed = false;
  child.stderr.on('data', bytes => { stderr += bytes; }); const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  const oldFetch = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw Error('Reopen must not dispatch'); };
  try {
    let before; for (let i = 0; i < 500; i++) { try { before = JSON.parse(await fs.readFile(entered, 'utf8')); break; } catch {} await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.ok(before, stderr); assert.equal(before.startedAttempts, 1); assert.equal(before.attempts[0].state, 'RUNNING');
    child.kill('SIGKILL'); assert.equal((await ended).signal, 'SIGKILL');
    c = await openController({ installationHome: home }); const after = c.inspectGoal(before.goalId);
    assert.equal(after.state, 'INTERRUPTED'); assert.equal(after.startedAttempts, 1); assert.equal(after.attempts[0].runId, before.attempts[0].runId); assert.equal(after.objective, before.objective);
    assert.equal(after.turnLimit, before.turnLimit); assert.deepEqual(after.criteria, before.criteria); assert.equal(calls, 0); await c.close(); c = undefined;
    c = await openController({ installationHome: home, managementOnly: true }); assert.equal(c.inspectGoal(before.goalId).startedAttempts, 1); assert.equal(calls, 0); passed = true;
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await ended; await c?.close(); globalThis.fetch = oldFetch; if (passed) await fs.rm(root, { recursive: true, force: true }); else console.error('Preserved goal crash fixture: ' + root); }
});
