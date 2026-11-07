import {installedQualificationModule} from './qualification-sidecar.mjs';
/** Prepared installed-A composition; never runs against a checkout Controller/SDK.
 * Requires a fresh final A+B installation. No product source edits or DB resets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const execute = promisify(execFile), sha = value => createHash('sha256').update(value).digest('hex');
const acceptedSources = {
    "tests/normal-hosted/fixture.mjs": "45072d459bb83cb7cc6b4761b5968a6b5b9ac50aa72dabd9e652104853901ea7",
    "tests/controller/configuration-fixture.mjs": "6a34de5b426bcf56538d0e441b27d99e8667480e4ffc60eb543719efcaba719e",
    "tests/normal-hosted/no-external.mjs": "df429cdb08a39e5e1f20adfb9c12a39089f1516beb1ed4a2ba767933b4496d3c",
    "tests/cli/no-sdk-loader.mjs": "d5e1e6eb3e0e719c45f8a58e5f97ea608ba8edcdeec78d7717f55ad8550dcb0f",
    "tests/normal-hosted/cli-adapter.mjs": "5c38c05a7bb9a6674709c20a6542897686d8e6743970cffabef9114bae41cc8c",
    "tests/normal-hosted/cli.test.mjs": "9c4176bd53227dfc3317c9d61122d77607906cfcbfe2b707e4b9334947cd5202",
    "tests/normal-hosted/agent-model.mjs": "cc9c86700337d0cbed54f846ceb7bb60a67ea6215e3d9d5d19004379b467cb52",
    "tests/controller/effect-fixture.mjs": "0f3e8d505c970da9e48207c31fba96fafd916dfccc156d5e8a735c55f0af7b3c",
    "tests/normal-hosted/agent.test.mjs": "7e3f0d5dcb4b28831544ec3ebefb40532eff7773a708fa09f3c0b365156d80ac"
};

test('final installed normal PUBLIC A: SDK-free owner CLI and real SDK parents WAIT on retained same home', { timeout: 30000 }, async t => {
    if (!process.env.GITJIG_INSTALL_RECEIPT) throw Error('Explicit final installed A+B receipt required; installed09 lacks A');
    const receiptPath = await fs.realpath(process.env.GITJIG_INSTALL_RECEIPT), selected = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    const { home, payloadId } = selected;
    assert.ok(path.isAbsolute(home) && await fs.realpath(home) === home, 'Canonical actual installed home required');
    assert.match(payloadId, /^[a-f0-9]{64}$/);
    const binding = JSON.parse(await fs.readFile(path.join(home, 'binding.json'), 'utf8'));
    assert.equal(binding.payloadId, payloadId, 'Receipt must match current immutable binding');
    const payload = path.join(home, 'versions', payloadId), node = path.join(home, 'bootstrap/node');
    const nodeInfo = await fs.lstat(node); assert.ok(nodeInfo.isFile() && !nodeInfo.isSymbolicLink());
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/installed normal A ')));
    t.diagnostic('Retained installed normal PUBLIC A harness: ' + root);
    await fs.mkdir(path.join(root, '.runtime-fixtures')); await fs.mkdir(path.join(root, 'cli')); await fs.mkdir(path.join(root, 'agent'));
    const env = { ...process.env, TMPDIR: path.join(home, 'artifacts'), NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' };
    delete env.NODE_TEST_CONTEXT; delete env.TEST_OWNED_NORMAL_ORIGIN;
    const originals = {}, generated = {}, substitutions = [];
    const read = async file => { const value = await fs.readFile(file, 'utf8'); originals[file] = sha(value); assert.equal(originals[file], acceptedSources[file], 'Accepted source consumer changed; independently review adaptation before execution: ' + file); return value; };
    const write = async (relative, value) => { const file = path.join(root, relative); await fs.writeFile(file, value); generated[relative] = sha(value); return file; };
    const replace = (label, source, from, to, exactCount = 1) => {
        const count = source.split(from).length - 1;
        if (exactCount === null) assert.ok(count > 0, 'Required adaptation absent: ' + label);
        else assert.equal(count, exactCount, 'Exact adaptation count: ' + label);
        substitutions.push({ label, from, to, count }); return source.split(from).join(to);
    };
    const url = relative => pathToFileURL(path.join(payload, relative)).href;
    const files = {};
    const run = async (label, args, timeout = 15000) => {
        try { const result = await execute(node, args, { cwd: root, env, timeout, maxBuffer: 3 * 2 ** 20 }); await fs.writeFile(path.join(root, label + '.log'), result.stdout + result.stderr); return result; }
        catch (error) { await fs.writeFile(path.join(root, label + '.log'), String(error.stdout ?? '') + String(error.stderr ?? '') + '\n' + String(error.message)); throw error; }
    };
    const evidence = { status: 'PREPARED', home, payloadId, receiptPath, root, node, originals, generated, substitutions,
        scope: 'Installed normal PUBLIC A over exact owned localhost native transport; no acceptance context, account operation, paid model, B landing or P7 claim' };
    try {
        const resolve = await run('bound-asset-resolve', [path.join(home, 'bootstrap/bootstrap.js'), '--resolve']);
        assert.equal(resolve.stdout.trim(), payloadId);
        const critical = ['dist/cli/main.js', 'dist/controller/index.js', 'dist/controller/controller.js', 'dist/controller/publication.js', 'dist/controller/configuration.js', 'dist/platform/github-publication-session.js', 'dist/platform/github-publication.js', 'dist/platform/github-configuration.js', 'dist/platform/github-capability.js', 'node_modules/@earendil-works/pi-ai/dist/compat.js'];
        evidence.installedModules = Object.fromEntries(await Promise.all(critical.map(async file => [file, sha(await fs.readFile(path.join(payload, file)))])));
        evidence.nodeSha256 = sha(await fs.readFile(node));
        const beforeFile = path.join(root, 'before.json');
        const before = await write('before.mjs', `import fs from 'node:fs';import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';\nconst file=${JSON.stringify(path.join(home, 'state/controller.sqlite'))};let counts={works:0,effect_operations:0,change_state:0,role_launches:0,projects:0};if(fs.existsSync(file)){const d=new DatabaseSync(file,{readOnly:true});try{for(const key of Object.keys(counts))counts[key]=d.prepare('SELECT COUNT(*) n FROM '+key).get().n;}finally{d.close();}}for(const[key,value]of Object.entries(counts))assert.equal(value,0,'Run normal A FIRST on a fresh home: '+key);fs.writeFileSync(${JSON.stringify(beforeFile)},JSON.stringify({...counts,runtimeNode:process.execPath}));\n`);
        await run('fresh-home-prerequisite', [before]); evidence.before = JSON.parse(await fs.readFile(beforeFile, 'utf8'));

        // Distinct canonical synthetic repository identities prevent independent HTTP
        // worlds from pretending to reuse the same native resource IDs in this home.
        const namespace = (label, source, repository, id, nodeId, numericResources = false) => {
            let s = replace(label + ': repository literal', source, "repository:'repo'", 'repository:' + JSON.stringify(repository));
            s = replace(label + ': canonical paths', s, 'owner/repo', 'owner/' + repository, null);
            if (s.includes('owner\\/repo')) s = replace(label + ': regex paths', s, 'owner\\/repo', 'owner\\/' + repository, null);
            s = replace(label + ': target numeric ID', s, 'repositoryId:9', 'repositoryId:' + id);
            s = replace(label + ': native numeric ID', s, 'id:9,', 'id:' + id + ',', null);
            s = replace(label + ': native node ID', s, "'R9'", JSON.stringify(nodeId), null);
            if (numericResources) { s = replace(label + ': native resource IDs', s, 'id=100+n', 'id=' + (id * 1000) + '+n'); s = replace(label + ': native resource nodes', s, "node_id:'N'+n", 'node_id:' + JSON.stringify(nodeId + '-resource-') + '+n'); }
            return s;
        };
        const fixture = await read('tests/normal-hosted/fixture.mjs'), configurationFixture = await read('tests/controller/configuration-fixture.mjs');
        const suffix = sha(root).slice(0, 10);
        files.cliFixture = await write('cli/fixture.mjs', namespace('owner-publication fixture', fixture, 'installed-a-public-' + suffix, 901, 'Installed-A-public-' + suffix, true));
        files.configurationFixture = await write('cli/configuration-fixture.mjs', namespace('owner-settings fixture', configurationFixture, 'installed-a-settings-' + suffix, 902, 'Installed-A-settings-' + suffix));
        files.agentFixture = await write('agent/fixture.mjs', namespace('agent-publication fixture', fixture, 'installed-a-agent-' + suffix, 903, 'Installed-A-agent-' + suffix, true));
        const guard = await read('tests/normal-hosted/no-external.mjs');
        files.guard = await write('no-external.mjs', guard); await write('cli/no-external.mjs', guard);
        files.noSDK = await write('no-sdk-loader.mjs', await read('tests/cli/no-sdk-loader.mjs'));
        let adapter = await read('tests/normal-hosted/cli-adapter.mjs');
        adapter = replace('CLI adapter actual installed Controller', adapter, "'../../dist/controller/controller.js'", JSON.stringify(url('dist/controller/controller.js')));
        adapter = replace('CLI adapter actual installed testing seam', adapter, "'../../.qualification/controller-testing.js'", JSON.stringify(installedQualificationModule(payload,'controller-testing.js')));
        const cliRuntime = path.join(root, 'cli-runtime.jsonl');
        const adapterTrace = `\nimport {appendFileSync as recordInstalledCLI} from 'node:fs';recordInstalledCLI(${JSON.stringify(cliRuntime)},JSON.stringify({node:process.execPath,command:process.argv.slice(2,4),controllerModule:${JSON.stringify(url('dist/controller/controller.js'))},testingModule:${JSON.stringify(installedQualificationModule(payload,'controller-testing.js'))}})+'\\n',{mode:0o600});\n`;
        substitutions.push({ label: 'CLI child actual loaded-node/module receipt', operation: 'append', from: null, to: adapterTrace, count: 1 }); adapter += adapterTrace;
        files.adapter = await write('cli/cli-adapter.mjs', adapter);

        const ownerResult = path.join(root, 'owner-publication.json'), configResult = path.join(root, 'owner-configuration.json');
        let cli = await read('tests/normal-hosted/cli.test.mjs');
        cli = replace('CLI actual installed entry', cli, "path.resolve('dist/cli/main.js')", JSON.stringify(path.join(payload, 'dist/cli/main.js')));
        cli = replace('CLI exact SDK-free guard path', cli, "path.resolve('tests/cli/no-sdk-loader.mjs')", JSON.stringify(files.noSDK));
        cli = replace('CLI exact owned same-body transport adapter', cli, "path.resolve('tests/normal-hosted/cli-adapter.mjs')", JSON.stringify(files.adapter));
        cli = replace('CLI configuration native fixture import', cli, "'../controller/configuration-fixture.mjs'", "'./configuration-fixture.mjs'");
        cli = replace('CLI same actual installed home, no replacement home', cli, "home:path.join(root,'home')", 'home:' + JSON.stringify(home));
        cli = replace('CLI nested process strips test context and ambient preloads', cli, 'env:{...process.env,TEST_OWNED_NORMAL_ORIGIN:origin}', 'env:installedCLIEnv(origin)');
        const cliEnvHelper = "function installedCLIEnv(origin){const env={...process.env,TMPDIR:" + JSON.stringify(path.join(home, 'artifacts')) + ",NODE_OPTIONS:'',NODE_PATH:'',PI_PACKAGE_DIR:'',TEST_OWNED_NORMAL_ORIGIN:origin};delete env.NODE_TEST_CONTEXT;return env;}\n";
        substitutions.push({ label: 'CLI nested process env helper', operation: 'prepend', from: null, to: cliEnvHelper, count: 1 }); cli = cliEnvHelper + cli;
        cli = replace('owner exact outcome receipt only; original assertions retained', cli,
            "assert.equal(JSON.parse(recovered.stdout).transportOutcome,'uncertain');assert.equal(f.rows.length,1);",
            "assert.equal(JSON.parse(recovered.stdout).transportOutcome,'uncertain');assert.equal(f.rows.length,1);await fs.writeFile(" + JSON.stringify(ownerResult) + ",JSON.stringify({prepared:p,recovered:JSON.parse(recovered.stdout),postAttempts:f.requests.filter(r=>r.method==='POST').length,nativeRows:f.rows}));");
        cli = replace('owner configuration receipt only; original assertions retained', cli,
            "assert.equal(f.requests.filter(r=>r.method==='PATCH').length,1);",
            "assert.equal(f.requests.filter(r=>r.method==='PATCH').length,1);await fs.writeFile(" + JSON.stringify(configResult) + ",JSON.stringify({planId:p.planId,applied:JSON.parse(apply.stdout),audit:JSON.parse(audit.stdout),nativeRepo:f.repo,nativeRules:[...f.rules.values()]}));");
        files.cli = await write('cli/consumer.test.mjs', cli);
        // Owner CLI runs first. All sources/logs and the live installed home remain.
        await fs.writeFile(path.join(root, 'adaptations.json'), JSON.stringify(evidence, null, 2));
        await run('owner-public-cli', ['--import', files.guard, '--test', '--test-concurrency=1', files.cli]);
        evidence.ownerPublication = JSON.parse(await fs.readFile(ownerResult, 'utf8'));
        evidence.ownerConfiguration = JSON.parse(await fs.readFile(configResult, 'utf8'));
        evidence.cliRuntime = (await fs.readFile(cliRuntime, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        assert.equal(evidence.cliRuntime.length, 9);
        assert.deepEqual(evidence.cliRuntime.map(row=>row.command.join(' ')), ['publication register-target','publication prepare','publication dispatch','publication dispatch','publication reconcile','repo register-target','repo preview','repo apply','repo audit']);
        for (const observed of evidence.cliRuntime) assert.equal(await fs.realpath(observed.node), await fs.realpath(node));

        let model = await read('tests/normal-hosted/agent-model.mjs');
        model = replace('actual installed official SDK in native provider', model, "'@earendil-works/pi-ai/compat'", JSON.stringify(url('node_modules/@earendil-works/pi-ai/dist/compat.js')));
        await write('agent/agent-model.mjs', model);
        let helper = await read('tests/controller/effect-fixture.mjs');
        helper = replace('actual installed official SDK in unchanged settledRoot helper', helper, "'@earendil-works/pi-ai/compat'", JSON.stringify(url('node_modules/@earendil-works/pi-ai/dist/compat.js')));
        await write('agent/effect-fixture.mjs', helper);
        const agentResult = path.join(root, 'agent-publication.json');
        let agent = await read('tests/normal-hosted/agent.test.mjs');
        agent = replace('agent actual installed Controller', agent, "'../../dist/controller/index.js'", JSON.stringify(url('dist/controller/index.js')));
        agent = replace('agent actual installed normal profile transport seam', agent, "'../../.qualification/controller-testing.js'", JSON.stringify(installedQualificationModule(payload,'controller-testing.js')));
        agent = replace('agent unchanged actual settlement helper import', agent, "'../controller/effect-fixture.mjs'", "'./effect-fixture.mjs'");
        agent = replace('agent same actual installed home', agent, "home=path.join(root,'home')", 'home=' + JSON.stringify(home));
        agent = replace('agent current empty software-state prerequisite, no reset', agent, "const c=await openController({installationHome:home});", "const c=await openController({installationHome:home});assert.equal(c.store.one('SELECT COUNT(*) n FROM change_state').n,0,'Normal A must precede B; no DB reset is permitted');");
        agent = replace('agent outcome receipt only; all original budget/J/settlement assertions retained', agent,
            "'resolution').consumed,1);}}finally",
            "'resolution').consumed,1);}await fs.writeFile(" + JSON.stringify(agentResult) + ",JSON.stringify({parents:parents.map(p=>p.conversationId),works:runs.map(r=>r.workId),operations:c.store.all('SELECT id,work,phase FROM effect_operations WHERE work IN (?,?)',...runs.map(r=>r.workId)),judgments:c.store.all('SELECT id,work,role,status FROM role_launches WHERE work IN (?,?)',...runs.map(r=>r.workId)),postAttempts:f.requests.filter(r=>r.method==='POST').length,nativeRows:f.rows}));}finally");
        files.agent = await write('agent/consumer.test.mjs', agent);
        await fs.writeFile(path.join(root, 'adaptations.json'), JSON.stringify(evidence, null, 2));
        await run('actual-native-sdk-agent', ['--import', files.guard, '--test', files.agent]);
        evidence.agentPublication = JSON.parse(await fs.readFile(agentResult, 'utf8'));
        assert.equal(evidence.ownerPublication.postAttempts, 1);
        assert.equal(evidence.agentPublication.postAttempts, 2);
        assert.equal(evidence.agentPublication.judgments.length, 2);
        assert.ok(evidence.agentPublication.judgments.every(j => j.role === 'adjudicator' && j.status === 'COMPLETE'));
        // Read retained live rows with copied installed Node after all joined closes.
        const afterFile = path.join(root, 'after.json'), after = await write('after.mjs', `import fs from'node:fs';import{DatabaseSync}from'node:sqlite';import assert from'node:assert/strict';const d=new DatabaseSync(${JSON.stringify(path.join(home, 'state/controller.sqlite'))},{readOnly:true});try{const workIds=${JSON.stringify([evidence.ownerPublication.prepared.workId, evidence.ownerConfiguration.applied.workId, ...evidence.agentPublication.works])};for(const id of workIds)assert.ok(d.prepare('SELECT id FROM works WHERE id=?').get(id),'Earlier actual work must survive');assert.equal(d.prepare('SELECT COUNT(*) n FROM change_state').get().n,0);fs.writeFileSync(${JSON.stringify(afterFile)},JSON.stringify({runtimeNode:process.execPath,works:d.prepare('SELECT id,state,epoch FROM works').all(),operations:d.prepare('SELECT id,work,phase FROM effect_operations').all(),budgets:d.prepare('SELECT * FROM budgets').all(),activeRuns:d.prepare("SELECT COUNT(*) n FROM runs WHERE phase NOT IN ('SETTLED','INTERRUPTED')").get().n}));}finally{d.close();}\n`);
        await run('retained-actual-live-ledger', [after]); evidence.after = JSON.parse(await fs.readFile(afterFile, 'utf8'));
        assert.equal(evidence.after.activeRuns, 0);
        assert.equal(await fs.realpath(evidence.after.runtimeNode), await fs.realpath(node));
        assert.equal(JSON.parse(await fs.readFile(path.join(home, 'binding.json'), 'utf8')).payloadId, payloadId);
        evidence.status = 'PASSED OWNED INSTALLED NORMAL A';
    } catch (error) { evidence.status = 'FAILED; retained for diagnosis, no state reset'; evidence.error = String(error.message); throw error; }
    finally {
        await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify(evidence, null, 2));
        await fs.writeFile(path.join(root, 'adaptations.json'), JSON.stringify({ originals, generated, substitutions }, null, 2));
        if (process.env.GITJIG_INSTALLED_NORMAL_PUBLICATION_RECEIPT) await fs.writeFile(process.env.GITJIG_INSTALLED_NORMAL_PUBLICATION_RECEIPT, JSON.stringify(evidence, null, 2));
    }
});
