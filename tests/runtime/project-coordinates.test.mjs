import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createScope, validateRuntimeProfile} from '../../dist/execution/container-scope.js';
import {initializePiHost} from '../../dist/pi/index.js';
import {PiArtifacts} from '../../dist/pi/host.js';
import {createProjectTools} from '../../dist/pi/tools.js';
import {runtimeFixtureProfile, runtimeFixtureConfig} from './profile.mjs';

const modes=[{readOnly:false,input:false},{readOnly:true,input:false},{readOnly:true,input:true}];
test('actual executor facts agree with project/scratch/input mounts', {timeout: 90000}, async t => {
    const profile = {...runtimeFixtureProfile(), dockerConfigDirectory: runtimeFixtureConfig()}; await validateRuntimeProfile(profile);
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT; assert.ok(parent && path.isAbsolute(parent)); assert.equal(await fs.realpath(parent), parent);
    const checkout = await fs.realpath('.'); assert.ok(parent !== checkout && !parent.startsWith(checkout + path.sep));
    const root = await fs.mkdtemp(path.join(parent, 'project-coordinates-')); await fs.chmod(root, 0o700);
    const stateRoot=path.join(root,'state'),artifactRoot=path.join(root,'artifacts'),connection=path.join(root,'native-host');
    for(const dir of [stateRoot,artifactRoot,connection])await fs.mkdir(dir,{mode:0o700});
    const hostOnly=path.join(connection,'host-only.txt');await fs.writeFile(hostOnly,'NATIVE_CONNECTION_ONLY');
    const oldTemp = process.env.TMPDIR; process.env.TMPDIR = artifactRoot;
    let scope, passed = false;
    t.after(async () => {
        try { if (scope) assert.equal((await scope.close()).state, 'removed'); if (passed && process.env.GITJIG_RETAIN_RUNTIME_FIXTURE !== '1') await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained coordinate runtime: ' + root); }
        finally { if (oldTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTemp; }
    });
    const host=await initializePiHost({stateRoot,artifactRoot});
    for(const [index,mode]of modes.entries()){
    const workRoot=path.join(root,'project-'+index),inputRoot=path.join(root,'input-'+index);await fs.mkdir(workRoot,{mode:0o700});
    await fs.writeFile(path.join(workRoot,'probe.txt'),'PROJECT_FILE\n');await fs.writeFile(path.join(workRoot,'locked.txt'),'PROTECTED');
    if(mode.input){await fs.mkdir(inputRoot,{mode:0o700});await fs.writeFile(path.join(inputRoot,'probe.txt'),'HOST_INPUT');}
    const config={...profile,workRoot,stateRoot,workId:'coordinate-observation',runId:path.basename(root)+'-'+index,uid:process.getuid(),gid:process.getgid(),readOnlyWork:mode.readOnly,protectedPaths:['locked.txt'],...(mode.input?{inputRoot}:{})};
    scope = await createScope(config);
    config.readOnlyWork=!mode.readOnly;config.protectedPaths.push('not-a-mounted-protection');
    assert.deepEqual(scope.executionContext,{projectRoot:'/work',shellCwd:'/work',projectAccess:mode.readOnly?'read-only':'read-write',readOnlyPaths:['/work/locked.txt'],scratchRoots:['/tmp','/scratch'],inputMountRoot:mode.input?'/input':null});
    assert.equal(Object.isFrozen(scope.executionContext),true);assert.equal(Object.isFrozen(scope.executionContext.scratchRoots),true);assert.equal(Object.isFrozen(scope.executionContext.readOnlyPaths),true);
    const artifacts = new PiArtifacts(host, 1024 * 1024), tools = createProjectTools(scope, artifacts, 1024 * 1024);
    const tool = name => tools.find(t => t.name === name);
    assert.ok(tool('bash').description.includes('Executor project access: '+scope.executionContext.projectAccess));
    assert.equal(tool('bash').description.includes(workRoot),false);
    assert.match(JSON.stringify(await tool('read').execute('relative-read', {path: 'probe.txt'})), /PROJECT_FILE/);
    const shell = await tool('bash').execute('relative-shell', {command: 'pwd; cat probe.txt'});
    assert.match(JSON.stringify(shell), /\/work/); assert.match(JSON.stringify(shell), /PROJECT_FILE/);
    await assert.rejects(tool('read').execute('host-path', {path: hostOnly}));
    const encodedPath = Buffer.from(hostOnly).toString('base64');
    const absent = await tool('bash').execute('host-unavailable', {command: `node -e "if(require('node:fs').existsSync(Buffer.from('${encodedPath}','base64').toString()))process.exit(9);console.log('HOST_SCOPE_UNAVAILABLE')"`});
    assert.equal(absent.structuredContent.exit_code, 0); assert.match(JSON.stringify(absent), /HOST_SCOPE_UNAVAILABLE/);
    const write=await tool('bash').execute('project-write',{command:`node -e "require('node:fs').writeFileSync('probe.txt','AUTHORED')"`});
    assert.equal(write.structuredContent.exit_code===0,!mode.readOnly);
    const protect=await tool('bash').execute('protected-write',{command:`node -e "require('node:fs').writeFileSync('locked.txt','CHANGED')"`});
    assert.notEqual(protect.structuredContent.exit_code,0);assert.equal(await fs.readFile(path.join(workRoot,'locked.txt'),'utf8'),'PROTECTED');
    const scratch=await tool('bash').execute('scratch-write',{command:`node -e "const fs=require('node:fs');for(const p of ['/tmp/context-probe','/scratch/context-probe']){fs.writeFileSync(p,'DISPOSABLE');if(fs.readFileSync(p,'utf8')!=='DISPOSABLE')process.exit(2)}console.log('SCRATCH_OK')"`});
    assert.equal(scratch.structuredContent.exit_code,0);assert.match(JSON.stringify(scratch),/SCRATCH_OK/);
    const input=await tool('bash').execute('input-mount',{command:`node -e "const fs=require('node:fs');const mounted=fs.readFileSync('/proc/self/mountinfo','utf8').split('\\n').some(l=>l.split(' ')[4]==='/input');if(mounted!==${mode.input})process.exit(3);if(mounted){if(fs.readFileSync('/input/probe.txt','utf8')!=='HOST_INPUT')process.exit(4);try{fs.writeFileSync('/input/probe.txt','WRONG');process.exit(5)}catch(e){if(e.code!=='EROFS')throw e}}console.log('INPUT_MOUNT_OK')"`});
    assert.equal(input.structuredContent.exit_code,0);assert.match(JSON.stringify(input),/INPUT_MOUNT_OK/);
    const large = await tool('bash').execute('large-output', {command: `node -e "console.log(('artifact-line-'+ 'x'.repeat(140)+'\\n').repeat(500))"`});
    const output = large.details.fullOutputPath; assert.equal(typeof output, 'string'); assert.ok(artifacts.has(output));
    assert.match(JSON.stringify(await tool('read').execute('registered-artifact', {path: output})), /artifact-line-/);
    assert.equal(await fs.readFile(hostOnly, 'utf8'), 'NATIVE_CONNECTION_ONLY');
    assert.equal((await scope.close()).state,'removed');scope=undefined;
    }
    passed=true;
});
