// Original CLI/UI defaults. Only required account/request values are typed.
// Owned Docker metadata and controlled drive do not qualify an engine or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationModels } from '../../dist/app/models.js';
const execute = promisify(execFile);
const image = 'sha256:' + '2'.repeat(64);
test('explicit setup applies runtime and admits original managed work without restarting the application', { timeout: 25000 }, async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/enter-first-run-')));
    const home = path.join(root, 'app');
    const source = path.join(root, 'project');
    const config = path.join(root, '.docker');
    const binary = path.join(root, 'docker');
    const calls = path.join(root, 'calls');
    const drive = path.join(root, 'drive');
    const secret = 'DUMMY_ENTER_ACCOUNT';
    let passed = false;
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'hello.txt'), 'Owned first project');
    await fs.mkdir(config, { mode: 0o700 });
    await fs.writeFile(calls, '');
    const c = await openController({ installationHome: home });
    const chosen = (await new ApplicationModels(c).list()).models.find(model => model.provider === 'openai');
    assert.ok(chosen);
    await c.close();
    await fs.writeFile(binary, '#!' + process.execPath + '\n' + `import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');if(JSON.stringify(args)===JSON.stringify(['--config',${JSON.stringify(config)},'context','ls','--quiet']))process.stdout.write('owned\\n');else if(JSON.stringify(args)===JSON.stringify(['--config',${JSON.stringify(config)},'--context','owned','image','ls','--no-trunc','--format','{{json .}}']))process.stdout.write(JSON.stringify({ID:${JSON.stringify(image)},Repository:'gitjig-runtime',Tag:'prepared'})+'\\n');else throw Error('Only explicit fixture metadata commands are allowed');`, { mode: 0o700 });
    const url = relative => new URL(relative, import.meta.url).href;
    const entry = path.resolve('dist/cli/entry.js');
    const guard = path.join(root, 'guard.mjs');
    await fs.writeFile(guard, `
import ${JSON.stringify(url('../cli/account-ui-no-network.mjs'))};
import fs from 'node:fs/promises';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
import {ApplicationStartup} from ${JSON.stringify(url('../../dist/app/startup.js'))};
import {suggestRuntimePaths} from ${JSON.stringify(url('../../dist/execution/runtime-paths.js'))};
import {ChangeCore} from ${JSON.stringify(url('../../dist/controller/change-core.js'))};
const prepare=ApplicationStartup.prototype.prepareRuntimeEdit;ApplicationStartup.prototype.prepareRuntimeEdit=async function(...args){const edit=await prepare.apply(this,args);return {...edit,suggestPaths:guard=>suggestRuntimePaths({guard:()=>{edit.assertCurrent();guard();},checkPath:()=>{}},[${JSON.stringify(binary)}],${JSON.stringify(config)})};};
const spawn=cp.spawn;let denied=0;const no=()=>{denied++;throw Error('Unexpected execution during Enter setup');};cp.spawn=(file,args,options)=>file===${JSON.stringify(binary)}?spawn(file,args,options):no();for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=no;syncBuiltinESMExports();
let drives=0;ChangeCore.prototype.drive=async function(input){if(++drives!==1)throw Error('Duplicate managed admission');await fs.writeFile(${JSON.stringify(drive)},String(drives));return this.inspect(input.workId);};process.on('exit',()=>{if(denied)process.exitCode=1;});
`, { mode: 0o600 });
    t.after(async () => {
        if (passed)
            await fs.rm(root, { recursive: true, force: true });
        else
            t.diagnostic('Retained Enter scenario ' + root);
    });
    const empty = [{ sql: 'SELECT COUNT(*) FROM works', rows: [[0]] }, { sql: 'SELECT COUNT(*) FROM runs', rows: [[0]] }];
    const run = async (name, steps) => {
        const file = path.join(root, name + '.json');
        await fs.writeFile(file, JSON.stringify({
            command: [process.execPath, '--import', guard, entry],
            cwd: source,
            env: {
                PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
                HOME: root,
                GITJIG_HOME: home,
                TERM: 'xterm-256color',
                LANG: 'C.UTF-8',
                NODE_OPTIONS: '',
                NODE_PATH: ''
            },
            steps,
            secret,
            authFile: path.join(home, 'config/auth.json'),
            database: path.join(home, 'state/controller.sqlite'),
            output: file + '.terminal',
            expectedInputs: 0,
            timeoutSeconds: 10,
            gracefulShutdownSeconds: 3
        }));
        const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], { timeout: 15000, maxBuffer: 2 ** 20 })).stdout);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stages, steps.length);
        assert.equal(result.terminalRestored, true);
        const terminal = await fs.readFile(file + '.terminal', 'utf8');
        assert.ok(!terminal.includes(secret));
        return terminal;
    };
    const enter = (wait, extra = {}) => ({ wait, send: '\r', ...extra });
    const request = 'Make the first project change';
    await run('setup', [
        { wait: 'Start with /ready', send: '/ready\r' },
        enter('Next step · Choose your project folder'),
        enter('Project for this conversation'),
        enter('Choose the existing project'),
        enter('Press Enter to accept the suggested name'),
        enter('Next step · Connect your model account'),
        { wait: 'Choose model account source', send: 'Pi-managed provider account\r' },
        { wait: 'Pi account login', send: 'openai\r' },
        { wait: 'Login method', send: 'api_key\r' },
        { wait: 'Secret input (hidden)', send: secret + '\r' },
        enter('Next step · Choose a model for this conversation', { assertStored: true }),
        enter('Model for this conversation'),
        enter('Next step · Prepare the project execution environment'),
        enter('Runtime setup · staged'),
        enter('Suggested local Docker paths'),
        enter('Stage suggested paths?'),
        enter('Runtime setup · staged'),
        enter('Explicit Docker discovery'),
        enter('Docker executable'),
        enter('Docker configuration directory'),
        enter('Observed contexts'),
        enter('Runtime setup · staged'),
        enter('Explicit Docker discovery'),
        enter('Docker executable'),
        enter('Docker context'),
        enter('Docker configuration directory'),
        enter('Observed images'),
        enter('Runtime setup · staged'),
        enter('Review runtime setup before applying'),
        enter('Explicit runtime setup action'),
        enter('Next step · Choose how to give your request', { queries: empty }),
        { wait: 'Give your request · choose a method', queries: empty, send: 'How prompts\r' },
        { wait: 'Two ways to give your request', queries: empty, send: '\x1b' },
        enter('Give your request · choose a method', { queries: empty }),
        { wait: 'INPUT', queries: empty, send: '\x15/ready\x1b\r' },
        enter('Next step · Choose how to give your request'),
        { wait: 'Give your request · choose a method', send: 'Managed task\r' },
        enter('Managed owner request'),
        { wait: 'task intent', send: request + '\r' },
        enter('Start managed work'),
        {
            wait: 'Stopped · BASE_CAPTURED',
            queries: [
                { sql: 'SELECT COUNT(*) FROM works', rows: [[1]] },
                { sql: 'SELECT raw FROM sources WHERE id=(SELECT source FROM works LIMIT 1)', rows: [[request]] }
            ],
            waitFiles: [{ path: drive, value: '1' }],
            terminate: true,
            send: ''
        },
    ]);
    const saved = JSON.parse(await fs.readFile(path.join(home, 'config/startup.json'), 'utf8'));
    assert.deepEqual(saved.runtime, { dockerBinary: binary, dockerConfigDirectory: config, dockerContext: 'owned', image });
    const inspect = await openController({ installationHome: home });
    const [conversation] = inspect.listConversations();
    assert.equal(conversation.projectId, 'project');
    assert.equal(inspect.getConversationModelChoice(conversation.conversationId).modelId, chosen.id);
    await inspect.close();
    assert.equal((await fs.readFile(calls, 'utf8')).trim().split('\n').length, 2);
    passed = true;
});
