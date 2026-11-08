import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createScope, reconcileScope, settleRejectedScopeCreate} from '../../dist/execution/container-scope.js';
import {classifyCreateRejection, classifyLegacyCreateRejection} from '../../dist/execution/create-rejection.js';

const missingSourceError = source => 'Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ' + source + '\n';
const legacyError = (journal, staging) => 'Error: scope create uncertain/failed; retained ' + journal + ': ' + missingSourceError(staging);

test('only a complete original create refusal for one exact supplied mount is classified', () => {
    const source = '/original/capture';
    const result = {exitCode: 1, stdout: '', stderr: missingSourceError(source)};
    const evidence = classifyCreateRejection(result, [source]);
    assert.equal(evidence.kind, 'bind-source-missing-before-create');
    assert.equal(evidence.mountSource, source);
    assert.deepEqual(evidence.original, {kind: 'native-result', result});
    for (const changed of [
        {...result, exitCode: 0},
        {...result, exitCode: -1},
        {...result, exitCode: 125},
        {...result, exitCode: 130},
        {...result, stdout: 'a'.repeat(64) + '\n'},
        {...result, stdout: '\n'},
        {...result, termination: 'timeout'},
        {...result, termination: 'aborted'},
        {...result, termination: 'output-limit'},
        {...result, stderr: result.stderr.trimEnd()},
        {...result, stderr: result.stderr + 'another failure\n'},
        {...result, stderr: 'inspect failed: ' + result.stderr},
        {...result, stderr: missingSourceError(source + '-other')},
    ]) assert.equal(classifyCreateRejection(changed, [source]), undefined);
    assert.equal(classifyCreateRejection(result, ['/unrelated/capture']), undefined);
    assert.equal(classifyCreateRejection({...result, stderr: missingSourceError('/bad\npath')}, ['/bad\npath']), undefined);
});

test('legacy reconstruction binds the complete original controller error to journal and capture', () => {
    const journal = '/owner/state/runtime/original.json', staging = '/owner/inputs/original';
    const error = legacyError(journal, staging);
    const evidence = classifyLegacyCreateRejection(error, journal, staging);
    assert.equal(evidence.mountSource, staging);
    assert.deepEqual(evidence.original, {kind: 'legacy-controller-observation', journalPath: journal, error});
    for (const altered of [error.trimEnd(), error + 'later output\n', 'prefix ' + error, error.replace('Error:', 'Error: Error:')])
        assert.equal(classifyLegacyCreateRejection(altered, journal, staging), undefined);
    assert.equal(classifyLegacyCreateRejection(error, journal + '-other', staging), undefined);
    assert.equal(classifyLegacyCreateRejection(error, journal, staging + '-other'), undefined);
});

async function fixture(t, mode = 'missing') {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/create-rejection-')));
    const workRoot = path.join(root, 'work'), stateRoot = path.join(root, 'runtime'), config = path.join(root, 'config');
    for (const directory of [workRoot, stateRoot, config]) await fs.mkdir(directory, {mode: 0o700});
    const calls = path.join(root, 'calls.json'), binary = path.join(root, 'docker.mjs');
    await fs.writeFile(calls, '[]', {mode: 0o600});
    const script = [
        '#!' + process.execPath,
        "import fs from 'node:fs';",
        'const log=' + JSON.stringify(calls) + ',args=process.argv.slice(2),command=args.slice(args.indexOf("--context")+2);',
        'const calls=JSON.parse(fs.readFileSync(log,"utf8"));calls.push(command);fs.writeFileSync(log,JSON.stringify(calls));',
        'if(command[0]==="info")process.stdout.write(JSON.stringify("ORIGINAL-DAEMON")+"\\n");',
        'else if(command[0]==="create"){',
        'process.stderr.write(' + JSON.stringify(missingSourceError(workRoot)) + (mode === 'extra-output' ? '+"more output\\n"' : '') + ');',
        ...(mode === 'allocated-id' ? ['process.stdout.write("a".repeat(64)+"\\n");'] : []),
        'process.exitCode=' + (mode === 'exit-zero' ? '0' : '1') + ';',
        '}else{process.stderr.write("Unexpected native command");process.exitCode=2;}',
    ].join('\n');
    await fs.writeFile(binary, script, {mode: 0o700});
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const options = {
        dockerBinary: binary, dockerContext: 'fixture', dockerConfigDirectory: config,
        image: 'sha256:' + '1'.repeat(64), workRoot, stateRoot, workId: 'work-original', runId: 'run-original',
    };
    return {
        root, binary, config, calls, workRoot, stateRoot, options,
        journal: async () => path.join(stateRoot, (await fs.readdir(stateRoot)).find(name => name.endsWith('.json'))),
    };
}

test('actual create refusal records native evidence and requires no later engine cleanup or execution', async t => {
    const f = await fixture(t);
    await assert.rejects(createScope(f.options), /scope create uncertain\/failed/);
    const journal = await f.journal(), record = JSON.parse(await fs.readFile(journal, 'utf8'));
    assert.equal(record.state, 'removed');
    assert.equal(record.createRejection.mountSource, f.workRoot);
    assert.deepEqual(record.createRejection.original.result, record.createOutcome);
    assert.equal(record.createOutcome.exitCode, 1);
    assert.equal((await reconcileScope(journal, f.binary, f.config)).state, 'removed');
    assert.deepEqual(JSON.parse(await fs.readFile(f.calls, 'utf8')).map(args => args[0]), ['info', 'create']);
});

for (const mode of ['allocated-id', 'extra-output', 'exit-zero']) test('ambiguous create remains quarantined: ' + mode, async t => {
    const f = await fixture(t, mode);
    await assert.rejects(createScope(f.options), /scope create uncertain\/failed/);
    const record = JSON.parse(await fs.readFile(await f.journal(), 'utf8'));
    assert.equal(record.state, 'quarantined');
    assert.equal(record.createRejection, undefined);
    assert.deepEqual(JSON.parse(await fs.readFile(f.calls, 'utf8')).map(args => args[0]), ['info', 'create']);
});

test('reviewed legacy journal settlement preserves identity and refuses changed or contradictory evidence', async t => {
    const f = await fixture(t), nonce = '12345678-1234-1234-1234-123456789abc';
    const journal = path.join(f.stateRoot, nonce + '.json');
    const original = {
        version: 1, context: 'fixture', name: 'gitjig-' + nonce, nonce,
        workId: f.options.workId, runId: f.options.runId, state: 'quarantined',
        creationBinding: {version: 1, state: 'UNAVAILABLE', reason: 'Original daemon binding not yet confirmed'},
        reason: 'retained scope not conclusively inspected',
    };
    const raw = JSON.stringify(original) + '\n';
    await fs.writeFile(journal, raw, {mode: 0o600});
    const evidence = classifyLegacyCreateRejection(legacyError(journal, f.workRoot), journal, f.workRoot);
    await assert.rejects(settleRejectedScopeCreate(journal, raw + ' ', evidence), /journal changed/);
    await assert.rejects(settleRejectedScopeCreate(journal, raw, {...evidence, mountSource: '/other'}), /evidence/);
    await assert.rejects(settleRejectedScopeCreate(journal, raw, evidence, () => {throw Error('Owner changed');}), /Owner changed/);
    assert.equal(await fs.readFile(journal, 'utf8'), raw);
    for (const conflicting of [
        {...original, id: 'a'.repeat(64)},
        {...original, nativeCleanupUnknown: {processGroup: 123}},
        {...original, state: 'created'},
    ]) {
        const changed = JSON.stringify(conflicting);
        await fs.writeFile(journal, changed);
        await assert.rejects(settleRejectedScopeCreate(journal, changed, evidence), /not an unallocated rejected create/);
        assert.equal(await fs.readFile(journal, 'utf8'), changed);
    }
    await fs.writeFile(journal, raw);
    let validated = false;
    const result = await settleRejectedScopeCreate(journal, raw, evidence, () => {validated = true;});
    assert.equal(result.state, 'removed');
    assert.equal(validated, true);
    const settledRaw = await fs.readFile(journal, 'utf8');
    assert.equal(result.journalHash, createHash('sha256').update(settledRaw).digest('hex'));
    const settled = JSON.parse(settledRaw);
    assert.equal(settled.workId, original.workId);
    assert.equal(settled.runId, original.runId);
    assert.deepEqual(settled.creationBinding, original.creationBinding);
    assert.deepEqual(settled.createRejection, evidence);
    assert.deepEqual(JSON.parse(await fs.readFile(f.calls, 'utf8')), []);
});
