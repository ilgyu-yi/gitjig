import fs from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../../dist/controller/store.js';
import { Controller, openController } from '../../dist/controller/index.js';
import { inspectStartupCleanupRecovery } from '../../dist/controller/startup-cleanup-recovery.js';

export async function createStartupCleanupFixture(t, optionalHome) {
    if (optionalHome) await fs.mkdir(optionalHome, {recursive: true, mode: 0o700});
    const home = await fs.realpath(optionalHome ?? await fs.mkdtemp(path.resolve('.runtime-fixtures/startup-cleanup-')));
    const directory = path.join(home, 'state', 'runtime');
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    await fs.writeFile(path.join(home, 'controller.json'), JSON.stringify({format: 'gitjig-controller-1'}), {mode: 0o600});
    const store = new Store(path.join(home, 'state', 'controller.sqlite'));
    let controller;
    t.after(async () => {
        if (controller) await controller.close();
        else store.close();
        await fs.rm(home, {recursive: true, force: true});
    });
    const nonce = '12345678-1234-1234-1234-123456789abc';
    const journalFile = path.join(directory, nonce + '.json');
    const staging = path.join(home, 'inputs', 'R');
    const runtime = {dockerBinary: '/trusted/docker', dockerContext: 'original', dockerConfigDirectory: '/private/docker-config'};
    const journal = {
        version: 1, context: runtime.dockerContext, dockerConfigDirectory: runtime.dockerConfigDirectory,
        name: 'gitjig-' + nonce, nonce, workId: 'W', runId: 'R', state: 'quarantined',
        creationBinding: {version: 1, state: 'UNAVAILABLE', reason: 'Original daemon binding not yet confirmed'},
        reason: 'retained scope not conclusively inspected',
    };
    await fs.writeFile(journalFile, JSON.stringify(journal), {mode: 0o600});
    store.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)', 'P', '/owned/project', '{}');
    store.run('INSERT INTO conversations VALUES(?,?,?,?,?)', 'C', 'P', null, 1, '{}');
    store.run('INSERT INTO sources VALUES(?,?,?,?)', 'S', 'C', JSON.stringify({kind: 'owner-conversation-input', uid: process.getuid()}), 'Original request');
    store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', 'S', null, 'W', 'UNKNOWN', 1, 1, null,
        JSON.stringify({kind: 'ordinary-conversation', conversation: 'C', assignmentId: null}));
    store.run('INSERT INTO conversation_state(conversation,work,resource,data) VALUES(?,?,?,?)', 'C', 'W', 'UNKNOWN', JSON.stringify({runId: 'R'}));
    store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', 'I', 'C', 1, 'W', 'S', 'INITIAL_RESERVED', 'idle', 'Original request', '{}');
    const runData = {
        kind: 'ordinary-conversation', conversation: 'C', initialInputId: 'I', capacityId: 'L',
        attainedCapture: true, manifest: {files: [], directories: []}, runtimeProfile: runtime,
        cleanup: 'quarantined', outcome: 'unavailable',
    };
    store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 1, 1, 'UNKNOWN', staging, 'consumed', JSON.stringify(runData));
    const error = `Error: scope create uncertain/failed; retained ${journalFile}: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ${staging}\n`;
    store.run('INSERT INTO observations VALUES(?,?,?)', 'O', 'R', JSON.stringify({kind: 'ordinary-response-unavailable', error}));
    store.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)', 'L', 'W', 'R', 1, 1, 'QUARANTINED', JSON.stringify({admitted: true}));
    for (const [kind, consumed] of [['execution', 1], ['resolution', 0]])
        store.run('INSERT INTO budgets VALUES(?,?,?,?,?)', 'W', kind, 8, consumed, 0);
    const inspect = (busy = () => false) => inspectStartupCleanupRecovery(store, home, 'W', busy);
    const changeRun = patch => store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({...runData, ...patch}), 'R');
    return {
        home, store, journal, journalFile, staging, runtime, error, inspect, changeRun,
        controller: () => controller ??= new Controller({installationHome: home}, store, async () => {}),
        reopen: async () => {
            if (controller) await controller.close();
            else store.close();
            controller = await openController({installationHome: home});
            return controller;
        },
    };
}
