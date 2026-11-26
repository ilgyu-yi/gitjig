// Original CLI/UI defaults. Only required account/request values are typed.
// Owned Docker metadata and controlled drive do not qualify an engine or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openController } from '../../dist/controller/index.js';
import { ApplicationModels } from '../../dist/app/models.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {dockerContextInspection} from '../helpers/docker-context-inspection.mjs';
const execute = promisify(execFile);
const image = 'sha256:' + '2'.repeat(64);
test('explicit setup applies runtime and admits original managed work despite a saved-only bridge change', { timeout: 25000 }, async (t) => {
    const root = await temporaryDirectory('enter-first-run');
    const home = path.join(root, 'app');
    const source = path.join(root, 'project');
    const config = path.join(root, '.docker');
    const binary = path.join(root, 'docker');
    const calls = path.join(root, 'calls');
    const drive = path.join(root, 'drive');
    const pendingBridge = path.join(root, 'save-bridge');
    const secret = 'DUMMY_ENTER_ACCOUNT';
    let passed = false;
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'hello.txt'), 'Owned first project');
    await fs.mkdir(config, { mode: 0o700 });
    const [host, agent, account] = ['bridge-host', 'bridge-agent', 'bridge-account'].map(name => path.join(root,name));
    for (const dir of [host,agent,account,path.join(agent,'home')])
        await fs.mkdir(dir, {mode:0o700});
    await fs.writeFile(path.join(agent,'claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
    const executable = await fs.realpath(process.execPath);
    const bridge = {profile:{kind:'installed-claude-bridge',cwd:host,agentDir:agent,executable:{
        file:executable,sha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},nativeAccountDirectory:account};
    await fs.writeFile(calls, '');
    const c = await openController({ installationHome: home });
    const chosen = (await new ApplicationModels(c).list()).models.find(model => model.provider === 'openai');
    assert.ok(chosen);
    await c.close();
    await fs.writeFile(binary, '#!' + process.execPath + '\n' + `import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');${await dockerContextInspection(config)}if(JSON.stringify(args)===JSON.stringify(['--config',${JSON.stringify(config)},'context','ls','--quiet']))process.stdout.write('owned\\n');else if(JSON.stringify(args)===JSON.stringify(['--config',${JSON.stringify(config)},'--context','owned','image','ls','--no-trunc','--format','{{json .}}']))process.stdout.write(JSON.stringify({ID:${JSON.stringify(image)},Repository:'gitjig-runtime',Tag:'prepared'})+'\\n');else if(JSON.stringify(args.slice(2))===JSON.stringify(['--context','owned','image','ls','--all','--no-trunc','--quiet','--filter','label=io.gitjig.runtime.recipe=1']))process.stdout.write(${JSON.stringify(image+'\n')});else if(JSON.stringify(args.slice(2))!==JSON.stringify(['--context','owned','image','ls','--no-trunc','--format','{{json .}}','--filter','dangling=true'])||args[0]!=='--config'||args[1]!==${JSON.stringify(config)})throw Error('Only explicit fixture metadata commands are allowed');`, { mode: 0o700 });
    const url = relative => new URL(relative, import.meta.url).href;
    const entry = await fs.realpath(process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js');
    const entryModule = relative => pathToFileURL(path.resolve(path.dirname(entry), '..', relative)).href;
    const guard = path.join(root, 'guard.mjs');
    await fs.writeFile(guard, `
import ${JSON.stringify(url('../cli/account-ui-no-network.mjs'))};
import fs from 'node:fs/promises';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
import {ApplicationStartup} from ${JSON.stringify(entryModule('app/startup.js'))};
import {suggestRuntimePaths} from ${JSON.stringify(entryModule('execution/runtime-paths.js'))};
import {ChangeCore} from ${JSON.stringify(entryModule('controller/change-core.js'))};
const captureInspection=ApplicationStartup.prototype.captureInspection;let bridgeSaved=false;
ApplicationStartup.prototype.captureInspection=async function(){
    if(!bridgeSaved&&await fs.access(${JSON.stringify(pendingBridge)}).then(()=>true,()=>false)){
        bridgeSaved=true;
        const {view:current}=await captureInspection.call(this);
        if(current.activation.runtime!=='current'||current.activation.bridge!=='current'||!current.saved?.runtime)throw Error('Expected applied runtime before staging saved-only bridge');
        await this.save({...current.saved,bridge:${JSON.stringify(bridge)}});
        const next=await captureInspection.call(this);
        if(next.view.activation.bridge!=='relaunch'||next.view.effective?.bridge)throw Error('Expected saved-only bridge');
        return next;
    }
    return captureInspection.call(this);
};
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
        { wait: 'Next step · Connect your model account', send: 'Project · none · select/register\r' },
        enter('Project for this conversation'),
        enter('Choose the existing project'),
        enter('Press Enter to accept the suggested name'),
        enter('Next step · Connect your model account'),
        { wait: 'Pi account login', queries: empty, send: '\x1b' },
        enter('Next step · Connect your model account', { queries: empty }),
        { wait: 'Pi account login', send: 'openai\r' },
        { wait: 'Login method', send: 'api_key\r' },
        { wait: 'Secret input (hidden)', send: secret + '\r' },
        enter('Next step · Choose a model for this conversation', { assertStored: true }),
        enter('Model for this conversation'),
        enter('Next step · Prepare the project execution environment'),
        enter('Runtime setup · staged'),
        enter('Suggested local Docker paths'),
        {wait:'Stage suggested paths?',send:'Use these paths\r'},
        enter('Runtime setup · staged'),
        enter('Explicit Docker discovery'),
        { wait: 'Use this Docker route for discovery?', send: 'Discover with this route\r' },
        enter('Observed contexts'),
        enter('Runtime setup · staged'),
        enter('Continue to confirmation', { queries: empty }),
        enter('Build execution image?', { queries: empty }),
        enter('Runtime setup · staged'),
        enter('Explicit Docker discovery'),
        { wait: 'Use this Docker route for discovery?', send: 'Discover with this route\r' },
        enter('Image contents are unchecked.', { queries: empty }),
        { wait: 'Runtime setup · staged', send: 'Review and save runtime\r' },
        enter('Review runtime setup before applying'),
        { wait: 'Explicit runtime setup action', send: 'Save and apply runtime\r' },
        enter('Next step · Choose how to give your request', { queries: empty }),
        { wait: 'Give your request · choose a method', queries: empty, send: 'How prompts\r' },
        { wait: 'Two ways to give your request', queries: empty, send: '\x1b' },
        enter('Give your request · choose a method', { queries: empty }),
        { wait: 'INPUT', queries: empty, releaseFile: pendingBridge, send: '\x15/ready\x1b\r' },
        enter('Next step · Choose how to give your request'),
        { wait: 'Give your request · choose a method', send: 'Managed task\r' },
        enter('Managed owner request'),
        { wait: 'task intent', send: request + '\r' },
        enter('Open start confirmation'),
        { wait: 'Start managed work', send: '\x1b[B\r' },
        {
            wait: 'Task stopped · /result for details and next steps',
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
    assert.deepEqual(saved.bridge, bridge);
    const inspect = await openController({ installationHome: home });
    const [conversation] = inspect.listConversations();
    assert.equal(conversation.projectId, 'project');
    assert.equal(inspect.getConversationModelChoice(conversation.conversationId).modelId, chosen.id);
    await inspect.close();
    assert.equal((await fs.readFile(calls, 'utf8')).trim().split('\n').length, 8);
    passed = true;
});
