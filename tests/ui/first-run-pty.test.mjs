// Actual fresh CLI/UI, public setup/storage and original work admission.
// Docker discovery is an owned native shim; workflow drive is controlled after admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { dockerConfigurationPreparation } from '../../dist/ui/runtime-setup-help.js';
const execute = promisify(execFile), image = 'sha256:' + '1'.repeat(64);
test('fresh user follows on-screen next steps through project, login, model, image guidance, saved runtime and original task admission', { timeout: 30000 }, async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/first-run-'))), home = path.join(root, 'app'), source = path.join(root, 'my-project'), config = path.join(root, '.docker'), binary = path.join(root, 'docker'), calls = path.join(root, 'calls'), secret = 'DUMMY_FIRST_RUN_NO_ECHO';
    await fs.mkdir(source, { mode: 0o700 });
    await fs.writeFile(path.join(source, 'hello.txt'), 'Owned first project');
    await fs.writeFile(calls, '');
    // Only read catalogue metadata to choose a currently supplied built-in model; no config is seeded.
    const c = await openController({ installationHome: home });
    const model = (await new ApplicationModels(c).list()).models.find(model => model.provider === 'openai');
    assert.ok(model);
    await c.close();
    await fs.writeFile(binary, '#!' + process.execPath + '\n' + `
import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]!=='--config'||args[1]!==${JSON.stringify(config)})throw Error('Unexpected native route');
if(JSON.stringify(args.slice(2))===JSON.stringify(['context','ls','--quiet']))process.stdout.write('owned\\n');
else if(JSON.stringify(args.slice(2))===JSON.stringify(['--context','owned','image','ls','--no-trunc','--format','{{json .}}']))process.stdout.write(JSON.stringify({ID:${JSON.stringify(image)},Repository:'gitjig-runtime',Tag:'prepared'})+'\\n');
else throw Error('Only explicit owned discovery is permitted');
`, { mode: 0o700 });
    const guard = path.join(root, 'guard.mjs');
    await fs.writeFile(guard, `
import ${JSON.stringify(new URL('../cli/account-ui-no-network.mjs', import.meta.url).href)};
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const spawn=cp.spawn;let denied=0;const no=()=>{denied++;throw Error('Unexpected process in first-run setup');};
cp.spawn=(file,args,options)=>file===${JSON.stringify(binary)}?spawn(file,args,options):no();for(const key of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=no;syncBuiltinESMExports();process.on('exit',()=>{if(denied)process.exitCode=1;});
`, { mode: 0o600 });
    const env = {
        PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: root, GITJIG_HOME: home, TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: ''
    }, empty = [{ sql: 'SELECT COUNT(*) FROM works', rows: [[0]] }, { sql: 'SELECT COUNT(*) FROM runs', rows: [[0]] }];
    let passed = false;
    t.after(async () => {
        if (passed)
            await fs.rm(root, { recursive: true, force: true });
        else
            t.diagnostic('Retained first-run terminal ' + root);
    });
    const run = async (name, steps, entry = ['dist/cli/entry.js'], extra = {}) => {
        const file = path.join(root, name + '.json');
        await fs.writeFile(file, JSON.stringify({
            ...extra, secret, command: [process.execPath, '--import', guard, ...entry], env, steps, timeoutSeconds: 12, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), authFile: path.join(home, 'config/auth.json'), output: file + '.terminal', gracefulShutdownSeconds: 3
        }));
        try {
            const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], { timeout: 17000, maxBuffer: 2 ** 20 })).stdout);
            assert.equal(result.exitCode, 0);
            assert.equal(result.stages, steps.length);
            assert.equal(result.terminalRestored, true);
            return await fs.readFile(file + '.terminal', 'utf8');
        }
        catch (error) {
            t.diagnostic((await fs.readFile(file + '.terminal', 'utf8').catch(() => '')).slice(-10000));
            throw error;
        }
    };
    const requested = path.join(root, 'prepare-requested'), prepared = path.join(root, 'prepare-complete');
    let preparing = true;
    const preparation = (async () => {
        const deadline = Date.now() + 9000;
        while (preparing) {
            try {
                await fs.access(requested);
                break;
            }
            catch {
                if (Date.now() > deadline)
                    throw Error('Displayed Docker configuration preparation was not reached');
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
        if (!preparing)
            return;
        await execute('/bin/sh', ['-c', dockerConfigurationPreparation(config).command]);
        await fs.writeFile(prepared, 'ready');
    })();
    void preparation.catch(() => { });
    t.after(() => { preparing = false; });
    const setup = await run('setup', [
        { wait: 'Start with /ready', send: '/ready\x1b\r' },
        { wait: 'Next step · Choose your project folder', queries: empty, send: 'Getting started\r' },
        { wait: 'Defaults you can keep', queries: empty, send: '\x1b' },
        { wait: 'Next step · Choose your project folder', send: '\r' },
        { wait: 'Project for this conversation', send: '\r' },
        { wait: 'Choose the existing project', send: '\x15' + source + '\r' },
        { wait: 'Press Enter to accept the suggested name', send: '\r' },
        { wait: 'Next step · Connect your model account', queries: empty, send: '\r' },
        { wait: 'Choose model account source', queries: empty, send: 'Pi-managed provider account\r' },
        { wait: 'Pi account login', send: 'openai\r' },
        { wait: 'Login method', send: 'api_key\r' },
        { wait: 'Secret input (hidden)', send: secret + '\r' },
        { wait: 'Next step · Choose a model for this conversation', assertStored: true, send: '\r' },
        { wait: 'Model for this conversation', send: 'openai/' + model.id + '\r' },
        { wait: 'Next step · Prepare the project execution environment', queries: empty, send: '\r' },
        { wait: 'Runtime setup · staged', send: 'Runtime setup help\r' },
        { wait: 'mkdir -p -m 700', queries: empty, releaseFile: requested, send: '\x1b' },
        { wait: 'Runtime setup · staged', waitFiles: [{ path: prepared, value: 'ready' }], send: 'Suggest local Docker paths\r' },
        { wait: 'Suggested local Docker paths', queries: empty, send: '\x1b' },
        { wait: 'Stage suggested paths?', send: 'Use these paths\r' },
        { wait: 'Runtime setup · staged', send: 'Edit runtime fields\r' },
        { wait: 'Use command -v docker', send: '\x15' + binary + '\r' },
        { wait: 'Named connection to the Docker backend', send: '\r' },
        { wait: 'Prepared Linux image with project tools', send: '\r' },
        { wait: 'Existing Docker client configuration directory', send: '\r' },
        { wait: 'Runtime setup · staged', send: 'Choose Docker context\r' },
        { wait: 'Explicit Docker discovery', send: '\x1b' },
        { wait: 'Docker executable', send: '\r' },
        { wait: 'Docker configuration directory', send: '\r' },
        { wait: 'Observed contexts', send: '\r' },
        { wait: 'Runtime setup · staged', send: 'Prepare an execution image\r' },
        { wait: 'Review execution image build', queries: empty, send: '\x1b' },
        { wait: 'Build execution image?', queries: empty, send: '\r' },
        { wait: 'Runtime setup · staged', send: 'Choose existing runtime image\r' },
        { wait: 'Explicit Docker discovery', send: '\x1b' },
        { wait: 'Docker executable', send: '\r' },
        { wait: 'Docker context', send: '\r' },
        { wait: 'Docker configuration directory', send: '\r' },
        { wait: 'Observed images', send: '\r' },
        { wait: 'Runtime setup · staged', send: 'Review and save runtime\r' },
        { wait: 'Review runtime setup before applying', queries: empty, send: '\x1b' },
        { wait: 'Explicit runtime setup action', send: 'Save and apply runtime\r' },
        { wait: 'Next step · Choose how to give your request', queries: empty, send: '\x1b' },
        { wait: 'INPUT', send: '\x15/quit\x1b\r' },
    ]);
    await preparation;
    assert.ok(!setup.includes(secret));
    assert.equal((await fs.readFile(calls, 'utf8')).trim().split('\n').length, 2);
    const saved = JSON.parse(await fs.readFile(path.join(home, 'config/startup.json')));
    assert.deepEqual(saved.runtime, { dockerBinary: binary, dockerConfigDirectory: config, dockerContext: 'owned', image });
    const reopened = await openController({ installationHome: home });
    const [conversation] = reopened.listConversations();
    assert.equal(reopened.getConversationModelChoice(conversation.conversationId).modelId, model.id);
    assert.equal(reopened.listProjects()[0].sourceRoot, source);
    await reopened.close();
    const broken = '{"PRIVATE_BROKEN_MODEL_CONFIG';
    await fs.writeFile(path.join(home, 'config/models.json'), broken, { mode: 0o600 });
    const file = path.join(root, 'start.json'), request = 'Start this first project task', receipt = file + '.receipt';
    const output = await run('start', [
        { wait: '/ready setup', send: '/ready\x1b\r' },
        { wait: 'Next step · Repair unavailable model or account configuration', queries: empty, send: '\r' },
        { wait: 'Model/account recovery · exact files', send: '\x1b' },
        { wait: 'Select the unavailable file to repair', send: 'models.json\r' },
        { wait: 'Reset only', queries: empty, send: 'Back up and reset this models file\r' },
        { wait: 'Configuration repair saved', send: '\x1b' },
        { wait: 'Next step · Choose how to give your request', queries: empty, send: '\r' },
        { wait: 'Give your request · choose a method', queries: empty, send: 'Managed task\r' },
        { wait: 'Managed owner request', send: 'Write a request\r' },
        { wait: 'task intent', send: request + '\r' },
        { wait: 'Start managed work', queries: empty, send: '\r' },
        {
            wait: 'Recorded task stage: source captured', queries: [
                { sql: 'SELECT COUNT(*) FROM works', rows: [[1]] }, { sql: 'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)', rows: [[request]] }
            ], terminate: true, send: ''
        },
    ], ['tests/ui/managed-change-entry.mjs', file], { home, cid: conversation.conversationId, receipt, release: file + '.release' });
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes(broken));
    const backup = (await fs.readdir(path.join(home, 'config'))).find(name => name.startsWith('models.json.recovery-'));
    assert.equal(await fs.readFile(path.join(home, 'config', backup), 'utf8'), broken);
    assert.deepEqual(JSON.parse(await fs.readFile(receipt)), { calls: 1, active: false, settled: true, accountsClosed: true });
    assert.equal((await fs.readFile(calls, 'utf8')).trim().split('\n').length, 2);
    passed = true;
});
