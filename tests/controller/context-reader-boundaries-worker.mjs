import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { inside } from '../../dist/controller/ownership.js';
import { contextRelativePath, parseFileReferences, listContextPaths } from '../../dist/controller/input-context.js';
const root = process.argv[2], home = path.join(root, 'app'), user = await fs.realpath(os.homedir()), project = path.join(user, 'project');
await fs.mkdir(project, { mode: 0o700 });
const c = await openController({ installationHome: home });
let socket, closedSocket = false, rootEnumerations = 0, closedTimedDirectory = false;
const originalOpendir = fs.opendir;
// Refuse before touching root directory entries even if the product guard regresses.
fs.opendir = async function (name, ...args) { if (name === '/') { rootEnumerations++; throw Error('Forbidden fixture root enumeration'); } return originalOpendir.call(this, name, ...args); };
try {
    for (const [a, b, expected] of [['/', '/Users/a', true], ['/', '/', true], ['/a', '/a/b', true], ['/a', '/ab', false], ['/a', '/a', true], [project, user, false], [user, project, true], [home, home + '/state', true], [home + '/state', home, false]]) assert.equal(inside(a, b), expected);
    const beforeProjects = c.listProjects();
    for (const candidate of ['/', home, root, path.join(home, 'state')]) await assert.rejects(c.registerProject({ id: 'REFUSED', sourceRoot: candidate }), e => e.code === 'PROJECT_ROOT');
    assert.deepEqual(c.listProjects(), beforeProjects);
    await assert.rejects(listContextPaths({ root: '/', privateRoot: home }, ''), /outside home roots/);
    await assert.rejects(listContextPaths({ root: user, privateRoot: home }, ''), /outside home roots/);
    await assert.rejects(listContextPaths({ root: home, privateRoot: home }, ''), /outside home roots/);
    assert.equal(rootEnumerations, 0);
    await c.registerProject({ id: 'P', sourceRoot: project });
    const v = c.createConversation({ projectId: 'P' }), cid = v.conversationId;
    await fs.writeFile(path.join(project, 'safe'), 'SAFE');
    const positive = await c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 0, text: '@safe', mode: 'idle' });
    assert.ok(positive.inputId); // Missing AGENTS and an ordinary HOME-child project are supported.
    c.setDraft({ conversationId: cid, expectedRevision: 0, text: 'UNCHANGED_DRAFT' });
    const snapshot = () => ({ tables: Object.fromEntries(['sources', 'conversation_inputs', 'works', 'runs', 'conversation_directions', 'conversation_state'].map(name => [name, c.store.all('SELECT * FROM ' + name + ' ORDER BY rowid')])), draft: c.inspectConversation(cid).draft });
    const refuse = async text => { const before = snapshot(); await assert.rejects(c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 0, text, mode: 'idle' })); assert.deepEqual(snapshot(), before); };
    await fs.mkdir(path.join(project, 'dir')); await fs.symlink(path.join(project, 'dir'), path.join(project, 'aliasdir'));
    await fs.writeFile(path.join(project, 'dir/file'), 'CHILD');
    await promisify(execFile)('/usr/bin/mkfifo', [path.join(project, 'fifo')], { timeout: 500 });
    const socketPath = path.join(root, 's'); assert.ok(Buffer.byteLength(socketPath) < 104);
    socket = net.createServer(); await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(socketPath, resolve); });
    await fs.writeFile(path.join(project, 'utf8'), Buffer.from([0xc3, 0x28]));
    await fs.rename(socketPath, path.join(project, 'socket'));
    for (const text of ['@aliasdir/file', '@fifo', '@socket', '@dir', '@utf8']) await refuse(text);
    const agents = path.join(project, 'AGENTS.md');
    await fs.symlink(path.join(project, 'safe'), agents); await refuse('@safe'); await fs.unlink(agents);
    await fs.mkdir(agents); await refuse('@safe'); await fs.rmdir(agents);
    await fs.writeFile(agents, Buffer.alloc(256 * 1024 + 1, 65)); await refuse('@safe'); await fs.unlink(agents);
    await fs.writeFile(agents, 'ROOT');
    for (let i = 0; i < 16; i++) await fs.writeFile(path.join(project, 'f' + i), 'TEXT');
    await refuse(Array.from({ length: 16 }, (_, i) => '@f' + i).join(' '));
    // Failed capture may retain explicitly unregistered preparation artifacts, never authority rows.
    const staged = await fs.readdir(path.join(home, 'state/input-context'));
    assert.ok(staged.length >= 2);
    const preparations = await Promise.all(staged.map(name => fs.readFile(path.join(home, 'state/input-context', name, 'preparation.json'), 'utf8')));
    assert.ok(preparations.every(value => JSON.parse(value).registration.startsWith('unregistered')));
    assert.equal(contextRelativePath(Array(16).fill('a').join('/')).split('/').length, 16);
    assert.throws(() => contextRelativePath(Array(17).fill('a').join('/')));
    assert.equal(contextRelativePath('a'.repeat(4096)).length, 4096); assert.throws(() => contextRelativePath('a'.repeat(4097)));
    assert.equal(parseFileReferences(Array(512).fill('@safe').join(' ')).references.length, 512); assert.throws(() => parseFileReferences(Array(513).fill('@safe').join(' ')), /Too many/);
    const scope = { root: project, privateRoot: home };
    assert.ok((await listContextPaths(scope, 'sa')).paths.some(item => item.path === 'safe'));
    const population = path.join(project, 'population'); await fs.mkdir(population);
    // Real directory entries; the nonmatching prefix prevents the50-item display cap masking enumeration.
    for (let base = 0; base < 2048; base += 64) await Promise.all(Array.from({ length: 64 }, (_, j) => fs.writeFile(path.join(population, 'entry' + (base + j)), '')));
    assert.deepEqual(await listContextPaths(scope, 'population/zz'), { paths: [], bounded: false });
    await fs.writeFile(path.join(population, 'entry2048'), '');
    await assert.rejects(listContextPaths(scope, 'population/zz'), /exceeds2048/);
    const beforeClock = Object.getOwnPropertyDescriptor(performance, 'now'); let calls = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => calls++ === 0 ? 0 : 101 });
    fs.opendir = async (...args) => { const handle = await originalOpendir(...args), close = handle.close.bind(handle); handle.close = async () => { await close(); closedTimedDirectory = true; }; return handle; };
    try { await assert.rejects(listContextPaths(scope, 'sa'), /100ms/); assert.equal(closedTimedDirectory, true); }
    finally { if (beforeClock) Object.defineProperty(performance, 'now', beforeClock); else delete performance.now; fs.opendir = originalOpendir; }
} finally {
    fs.opendir = originalOpendir;
    if (socket?.listening) await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    closedSocket = !socket?.listening;
    await c.close();
}
console.log(JSON.stringify({ outcome: 'passed', requests: 0, rootEnumerations, closedTimedDirectory, closedSocket, permissionDenial: 'unproven' }));
