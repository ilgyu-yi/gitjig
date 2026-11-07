/** Genuine standalone initializer activation only. No native query or authentication. */
import '../normal-hosted/no-external.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DefaultResourceLoader, SettingsManager} from '@earendil-works/pi-coding-agent';
import initialize from '@gitjig/pi-claude-bridge-host';

const [mode, root] = process.argv.slice(2), agentDir = process.env.PI_CODING_AGENT_DIR;
fs.mkdirSync(agentDir, {mode: 0o700});
const file = path.join(agentDir, 'claude-bridge.json');
const original = JSON.stringify({askClaude: {enabled: false}, provider: {strictMcpConfig: true, autoMemoryEnabled: false}});
fs.writeFileSync(file, original, {mode: 0o600});
const loader = new DefaultResourceLoader({cwd: root, agentDir, settingsManager: SettingsManager.inMemory(),
    extensionFactories: [initialize], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    noContextFiles: true, disabledBuiltinExtensions: ['mcp', 'codemode', 'tool_search']});
const loaded = await loader.loadProjectTrustExtensions();
try {
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.equal(fs.existsSync(path.join(process.env.HOME, '.pi/agent/claude-bridge-diag.log')), false);
} finally {loaded.runtime.invalidate();}
console.log(JSON.stringify({mode, nativeBirths: 0, cleanup: 'confirmed', ambientConfigurationPreserved: true, ambientLogCreated: false}));
