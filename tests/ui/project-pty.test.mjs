import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('fresh UI registers/selects a project with Korean command keys and retains cancelled slash input without a model',{timeout:12000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/project-pty-'))),home=path.join(root,'home'),source=path.join(root,'한글 project');
    await fs.mkdir(source);const file=path.join(root,'pty.json');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained project PTY '+root);});
    const rows=[['demo',source]];
    const steps=[
        {wait:'Model: not selected',send:'\x07'},
        {wait:'Project: select or register',send:'ㅓ'},
        {wait:'Project for this conversation',send:'\r'},
        {wait:'Project directory',send:'\x15'+source+'\r'},
        {wait:'Project ID',send:'\x15demo\r'},
        {wait:'Project selected: demo',queries:[{sql:'SELECT id,root FROM projects',rows}],send:'\x07'},
        {wait:'Project: select or register',send:'ㅓ'},
        {wait:'Project for this conversation',send:'\r'},
        {wait:'Project already selected: demo',send:'/project\x1b\r'},
        {wait:'Project for this conversation',send:'\x1b'},
        {wait:'Command cancelled; draft kept',assertDraft:'/project',queries:[{sql:'SELECT project,generation FROM conversations',rows:[['demo',1]]}],send:'\x15/quit\x1b\r'},
    ];
    const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/cli/account-ui-no-network.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:8,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
    const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);passed=true;
});

for (const locale of ['en', 'ko']) test('original ' + locale + ' terminal retains launch-directory default and corrects staged registration under an active bridge', {timeout: 20000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-project-launch-ui-')));
    const home = path.join(root, 'application'), launch = path.join(root, 'launch-project'), corrected = path.join(root, 'corrected-project');
    for (const name of ['launch-project', 'corrected-project', 'host', 'agent', 'agent/home', 'account'])
        await fs.mkdir(path.join(root, name), {mode: 0o700});
    const executable = path.join(root, 'owned-native');
    await fs.writeFile(executable, '#!/bin/sh\nexit 90\n', {mode: 0o700});
    await fs.writeFile(path.join(root, 'agent/claude-bridge.json'), '{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}', {mode: 0o600});
    const c = await openController({installationHome: home});
    try {
        await ApplicationStartup.open(c).save({version: 1, bridge: {
            profile: {kind: 'installed-claude-bridge', cwd: path.join(root, 'host'), agentDir: path.join(root, 'agent'), executable: {file: executable, sha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},
            nativeAccountDirectory: path.join(root, 'account'),
        }});
    }
    finally { await c.close(); }
    const copy = locale === 'ko' ? {
        menu: '이 대화의 프로젝트', register: '프로젝트 등록…', directory: '프로젝트 폴더 · 절대 경로', id: '프로젝트 ID',
        selected: '프로젝트 선택됨:', failed: '프로젝트를 등록하지 못했습니다', edit: '프로젝트 폴더 수정', retry: '이 프로젝트 값으로 다시 등록',
    } : {
        menu: 'Project for this conversation', register: 'Register a project…', directory: 'Project directory', id: 'Project ID',
        selected: 'Project selected:', failed: 'Project not registered', edit: 'Edit project directory', retry: 'Retry these project fields',
    };
    const empty = [{sql: 'SELECT COUNT(*) FROM works', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM runs', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM conversation_inputs', rows: [[0]]}];
    const steps = [
        {wait: '/ready', send: '/project\x1b\r'},
        {wait: copy.menu, send: '\r'},
        {wait: copy.directory, send: '\r'},
        {wait: copy.id, send: '\r'},
        {wait: copy.selected + ' launch-project', queries: [...empty, {sql: 'SELECT id,root FROM projects', rows: [['launch-project', launch]]}], send: '/project\x1b\r'},
        {wait: copy.menu, send: copy.register + '\r'},
        {wait: copy.directory, send: '\x15relative/invalid\r'},
        {wait: copy.id, send: '\x15retained-id\r'},
        {wait: copy.failed, send: '\x1b'},
        {wait: copy.edit, send: copy.edit + '\r'},
        {wait: copy.directory, send: '\x15' + corrected + '\r'},
        {wait: copy.retry, queries: [{sql: 'SELECT COUNT(*) FROM projects', rows: [[1]]}], send: copy.retry + '\r'},
        {wait: copy.selected + ' retained-id', queries: [...empty, {sql: 'SELECT id,root FROM projects ORDER BY id', rows: [['launch-project', launch], ['retained-id', corrected]]}], assertDraft: '', send: '/quit\x1b\r'},
    ];
    const config = path.join(root, 'terminal.json'), output = config + '.terminal'; let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained project launch/correction terminal ' + root); });
    await fs.writeFile(config, JSON.stringify({command: [process.execPath, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'), path.resolve('dist/cli/entry.js')], cwd: launch,
        env: {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: root, USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture', GITJIG_HOME: home, TMPDIR: root, TERM: 'xterm-256color', LANG: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', LC_ALL: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', NODE_OPTIONS: '', NODE_PATH: ''},
        steps, timeoutSeconds: 12, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output, gracefulShutdownSeconds: 3}));
    try {
        const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], {timeout: 16000, maxBuffer: 2 ** 20})).stdout);
        assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
        passed = true;
    }
    catch (error) { t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-6000)); throw error; }
});
