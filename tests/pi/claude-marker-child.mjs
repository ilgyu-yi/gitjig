// Constructor-only Darwin compatibility + guard boundary. No auth/model/native CLI.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const [mode, root, product] = process.argv.slice(2);
const nativeMarkerPresent = Boolean(process.env.__CF_USER_TEXT_ENCODING);
assert.equal(process.platform, 'darwin'); assert.equal(nativeMarkerPresent, true, 'Actual prespawn-whitelist Node adds marker; never manufacture healthy value');
for (const name of ['host','agent','state','artifacts','project']) fs.mkdirSync(path.join(root,name), { mode: 0o700 });
const cwd = path.join(root, 'host'), agentDir = path.join(root,'agent'), project = path.join(root,'project');
process.chdir(cwd); process.env.PI_CODING_AGENT_DIR = agentDir; process.env.TMPDIR = path.join(root,'artifacts');
fs.writeFileSync(path.join(agentDir,'claude-bridge.json'), JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}), {flag:'wx',mode:0o600});
let network = 0, processes = 0;
const noNetwork = () => { network++; throw Error('NETWORK_REFUSED'); }, noProcess = () => { processes++; throw Error('PROCESS_REFUSED'); };
for (const api of [http,https]) for (const method of ['request','get']) api[method] = noNetwork;
globalThis.fetch = noNetwork; net.connect = noNetwork; net.createConnection = noNetwork; net.Socket.prototype.connect = noNetwork;
for (const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[method] = noProcess;
noProcess[promisify.custom] = () => { processes++; return Promise.reject(Error('PROCESS_REFUSED')); };
syncBuiltinESMExports();
const url = file => pathToFileURL(path.join(product,file)).href;
const { createOwnedClaudeHost } = await import(url('pi/claude-host.js'));
const { initializePiHost, createPiSession } = await import(url('pi/index.js'));
const { assertNoClaudeRoutingSelectors } = await import(url('pi/claude-profile.js'));
if (mode === 'unknown') process.env.UNSELECTED_HOST_MARKER = 'DUMMY';
if (mode === 'provider') process.env.ANTHROPIC_API_KEY = 'DUMMY_NOT_A_CREDENTIAL';
if (mode === 'helper') process.env.CLAUDE_CODE_PROCESS_WRAPPER = 'DUMMY_NEVER_EXECUTED';
if (['provider','helper'].includes(mode)) assert.throws(assertNoClaudeRoutingSelectors, /Ambient provider or helper selector/);
let resource;
const output = { mode, nativeMarkerPresent, resourceReturned: false, assertionPassed: false };
try {
    const input = { cwd, agentDir, executable: { file: fs.realpathSync(process.execPath), sha256: '0'.repeat(64) } };
    if (['unknown','provider','helper'].includes(mode)) {
        await assert.rejects(createOwnedClaudeHost(input), /Ambient provider or helper selector/);
    } else {
        resource = await createOwnedClaudeHost(input); output.resourceReturned = true;
        assert.ok(!JSON.stringify(resource.modelSelection).includes('__CF_USER_TEXT_ENCODING'));
        if (mode === 'drift') {
            const host = await initializePiHost({stateRoot:path.join(root,'state'),artifactRoot:path.join(root,'artifacts')});
            process.env.__CF_USER_TEXT_ENCODING = 'DUMMY_CHANGED_STARTUP_MARKER';
            const refuse = () => { throw Error('NO_PROJECT_OPERATION'); };
            const operations = {workspaceRoot:project,validatePath:p=>path.resolve(project,p),exec:refuse,readFile:refuse,access:refuse,writeFile:refuse,mkdir:refuse};
            await assert.rejects(createPiSession({host,operations,model:resource.modelSelection,systemPrompt:'No prompt allowed',maxReadBytes:1024}), /Bridge startup environment changed/);
        }
    }
    output.assertionPassed = true;
} finally {
    await resource?.close();
    assert.equal(network,0); assert.equal(processes,0);
    output.networkRefused = network; output.processRefused = processes;
    output.hostAuthCreated = fs.existsSync(path.join(root,'state/auth.json'));
    assert.equal(output.hostAuthCreated,false);
    fs.writeFileSync(path.join(root,'observation.json'),JSON.stringify(output,null,2),{flag:'wx',mode:0o600});
}
console.log(JSON.stringify(output));
