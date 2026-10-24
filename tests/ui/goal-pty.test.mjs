import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
test('actual goal UI stays responsive through child navigation and owner pause', { timeout: 20000 }, async () => {
  const root = await fs.mkdtemp(path.resolve('.runtime-fixtures/goal-ui-')), home = path.join(root, 'home'), profile = path.join(root, 'model.json'), authPath = path.join(root, 'auth.json');
  await fs.writeFile(authPath, JSON.stringify({ openrouter: { type: 'api_key', key: 'DUMMY-UI-GOAL' } }), { mode: 0o600 });
  await fs.writeFile(profile, JSON.stringify({ provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', native: { kind: 'pi-stored', credentialType: 'api_key', authPath } }), { mode: 0o600 });
  const cfg = { home, profile, control: path.join(root, 'control.json'), receipt: path.join(root, 'receipt.json'), output: path.join(root, 'terminal.bin') };
  const file = path.join(root, 'driver.json'); await fs.writeFile(file, JSON.stringify({ ...cfg, command: [process.execPath, path.resolve('tests/ui/goal-child.mjs'), file] }));
  let passed = false;
  try {
    const actual = JSON.parse((await promisify(execFile)('python3', [path.resolve('tests/ui/goal-pty.py'), file], { timeout: 17000, maxBuffer: 1024 * 1024 })).stdout);
    assert.equal(actual.exitCode, 0); assert.equal(actual.stage, 'left'); assert.equal(actual.terminalRestored, true);
    const receipt = JSON.parse(await fs.readFile(cfg.receipt, 'utf8')); assert.equal(receipt.goal.state, 'PAUSED'); assert.equal(receipt.goal.startedAttempts, 1); assert.equal(receipt.calls, 1); passed = true;
  } finally { if (passed) await fs.rm(root, { recursive: true, force: true }); else console.error('Preserved goal UI fixture: ' + root); }
});
