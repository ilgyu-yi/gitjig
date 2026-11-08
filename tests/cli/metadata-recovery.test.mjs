import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url));
const guard = fileURLToPath(new URL('./no-sdk-loader.mjs', import.meta.url));

test('invalid startup cannot hide retained metadata or authorize mutation and execution', {timeout: 30000}, async t => {
    const root = await temporaryDirectory('metadata-recovery'), home = path.join(root, 'home'), source = path.join(root, 'project');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained metadata recovery fixture: ' + root);
    });
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'owner.txt'), 'Original source input 한국어\n');
    const run = async (args, expected = 0) => {
        let result;
        try { result = {code: 0, ...await execute(process.execPath, ['--import', guard, cli, ...args, '--home', home], {timeout: 5000})}; }
        catch (error) {
            if (typeof error.code !== 'number') throw error;
            result = error;
        }
        assert.equal(result.code, expected, result.stderr);
        return JSON.parse(expected === 0 ? result.stdout : result.stderr);
    };
    await run(['project', 'register', '--id', 'P', '--root', source]);
    const conversation = await run(['conversation', 'create']);
    const scoped = await run(['conversation', 'project', '--conversation', conversation.conversationId, '--project', 'P', '--generation', String(conversation.generation)]);
    const work = await run(['change', 'prepare', '--project', 'P', '--message', 'Retain original incomplete change', '--execution-limit', '3']);
    assert.equal(work.phase, 'BASE_CAPTURED');
    assert.equal(work.reviewReady, false);
    const snapshot = () => {
        const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly: true});
        try {
            return Object.fromEntries(['projects', 'conversations', 'conversation_state', 'conversation_inputs', 'sources', 'works', 'runs', 'budgets', 'capacity_leases', 'change_state', 'change_versions', 'obligations', 'role_launches', 'effect_operations'].map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
        } finally { db.close(); }
    };
    const before = snapshot(), startup = path.join(home, 'config/startup.json');
    await fs.mkdir(path.dirname(startup), {recursive: true, mode: 0o700});
    for (const raw of ['{broken', '{"version":1,"runtime":"original-invalid-runtime"}']) {
        await fs.writeFile(startup, raw, {mode: 0o600});
        assert.equal((await run(['project', 'list']))[0].id, 'P');
        assert.equal((await run(['conversation', 'list']))[0].conversationId, conversation.conversationId);
        assert.equal((await run(['conversation', 'inspect', '--conversation', conversation.conversationId])).projectId, 'P');
        assert.equal((await run(['work', 'inspect', '--work', work.workId])).workId, work.workId);
        const retained = await run(['change', 'inspect', '--work', work.workId]);
        assert.equal(retained.phase, 'BASE_CAPTURED');
        assert.equal(retained.reviewReady, false);
        for (const args of [
            ['project', 'register', '--id', 'Q', '--root', source],
            ['conversation', 'create'],
            ['conversation', 'project', '--conversation', conversation.conversationId, '--project', 'P', '--generation', String(scoped.generation)],
            ['work', 'extend', '--work', work.workId, '--units', '1', '--reason', 'Must not spend or extend'],
            ['work', 'resume', '--work', work.workId, '--command', 'exit 0'],
        ]) assert.match((await run(args, 2)).message, /startup|Startup|setup|repair/);
        assert.equal(await fs.readFile(startup, 'utf8'), raw);
        assert.deepEqual(snapshot(), before, 'Inspection and refused mutations preserve original holds and allowances');
    }
    assert.equal(await fs.readFile(path.join(source, 'owner.txt'), 'utf8'), 'Original source input 한국어\n');
    passed = true;
});
