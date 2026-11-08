import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {createScope,validateRuntimeProfile} from '../../dist/execution/container-scope.js';

async function world(t) {
    const root = await temporaryDirectory('scope-preflight');
    const workRoot = path.join(root, 'work'), stateRoot = path.join(root, 'runtime');
    await fs.mkdir(workRoot);await fs.mkdir(stateRoot);
    const calls = path.join(root, 'native-calls'), dockerBinary = path.join(root, 'docker.mjs');
    await fs.writeFile(dockerBinary, '#!' + process.execPath + '\nimport fs from "node:fs";fs.appendFileSync(' + JSON.stringify(calls) + ',JSON.stringify(process.argv.slice(2))+"\\n");process.exitCode=17;\n', {mode: 0o700});
    const options = {dockerBinary,dockerContext:'fixture',image:'sha256:'+'1'.repeat(64),workRoot,stateRoot,workId:'owned-work',runId:'owned-run',protectedPaths:[]};
    t.after(() => fs.rm(root, {recursive:true,force:true}));
    return {root,options,async noAllocation(){assert.deepEqual(await fs.readdir(stateRoot),[]);await assert.rejects(fs.stat(calls),{code:'ENOENT'});}};
}

for (const kind of ['context','image','work','protected','aborted','during-preflight']) test('original preflight refusal allocates no journal or native scope: '+kind, async t => {
    const f = await world(t), options = {...f.options};let attempts = 0;
    const abort = new AbortController();options.signal = abort.signal;
    if (kind === 'context') options.dockerContext = undefined;
    if (kind === 'image') options.image = {toString(){return f.options.image;}};
    if (kind === 'work') options.workRoot = path.join(f.root, 'missing');
    if (kind === 'protected') options.protectedPaths = ['missing'];
    if (kind === 'aborted') abort.abort();
    const pending = createScope(options, () => {attempts++;});
    if (kind === 'during-preflight') abort.abort();
    await assert.rejects(pending);
    assert.equal(attempts,0);await f.noAllocation();
});

test('scope and standalone profile capture caller operands before async metadata reads', async t => {
    const f = await world(t), profile = {...f.options};
    const pending = validateRuntimeProfile(profile);profile.dockerContext = 'changed';profile.image = 'changed';
    const captured = await pending;assert.equal(captured.dockerContext,'fixture');assert.equal(captured.image,f.options.image);
    const options = {...f.options,protectedPaths:[]}, sentinel = new Error('ORIGINAL_ADMISSION_REFUSAL');let attempts = 0;
    const scope = createScope(options, () => {attempts++;throw sentinel;});
    options.workRoot = path.join(f.root,'missing');options.protectedPaths.push('../outside');options.image = 'changed';
    await assert.rejects(scope,error => error === sentinel);assert.equal(attempts,1);await f.noAllocation();
});

test('journal attempt is reported before journal open failure and keeps native untouched', async t => {
    const f = await world(t);await fs.chmod(f.options.stateRoot,0o500);let attempts = 0;
    try {await assert.rejects(createScope(f.options, () => {attempts++;}));assert.equal(attempts,1);await f.noAllocation();}
    finally {await fs.chmod(f.options.stateRoot,0o700);}
});

test('post-journal native uncertainty retains the journal and exactly one admission marker', async t => {
    const f = await world(t);let attempts = 0;
    await assert.rejects(createScope(f.options, () => {attempts++;}));
    assert.equal(attempts,1);
    const files = (await fs.readdir(f.options.stateRoot)).filter(name => name.endsWith('.json'));
    assert.equal(files.length,1);
    const journal = JSON.parse(await fs.readFile(path.join(f.options.stateRoot,files[0]),'utf8'));
    assert.equal(journal.runId,'owned-run');assert.notEqual(journal.state,'removed');
    const calls = (await fs.readFile(path.join(f.root,'native-calls'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(args=>args.includes('create')));
});
