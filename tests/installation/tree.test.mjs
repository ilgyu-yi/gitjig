import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inventoryTree,copyAssetTree,assetIdentity} from '../../dist/installation/tree.js';
import {writeOwnedJson} from '../../dist/installation/transaction.js';
import {readPrivateBytes, readPrivateJson} from '../../dist/installation/private-files.js';
async function writable(root){for(const e of await fs.readdir(root,{withFileTypes:true})){const file=path.join(root,e.name);if(e.isDirectory()){await fs.chmod(file,0o700);await writable(file);}}}

test('owned metadata reads verify the opened leaf and bound its exact bytes', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-read-metadata-')));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const file = path.join(root, 'manifest.json');
    const bytes = Buffer.from('{"owner":"검증"}\n');
    await fs.writeFile(file, bytes, {mode: 0o600});
    const alias = path.join(root, 'alias');
    await fs.symlink(file, alias);
    await assert.rejects(readPrivateBytes(alias, 16384), {code: 'ELOOP'});
    const open = fs.open;
    let fault;
    t.mock.method(fs, 'open', async (filename, ...args) => {
        const handle = await open(filename, ...args);
        if (filename !== file) return handle;
        const read = handle.read.bind(handle);
        handle.read = async (buffer, offset, length, position) => {
            assert.equal(buffer.length, bytes.length + 1);
            if (fault === 'grow' && offset === bytes.length) {
                buffer[offset] = 0x0a;
                return {bytesRead: 1, buffer};
            }
            if (fault === 'shrink' && offset > 0) return {bytesRead: 0, buffer};
            return read(buffer, offset, Math.min(length, 4), position);
        };
        return handle;
    });
    assert.deepEqual(await readPrivateBytes(file, 16 * 1024 * 1024), bytes);
    assert.deepEqual(await readPrivateJson(file), {owner: '검증'});
    for (fault of ['grow', 'shrink'])
        await assert.rejects(readPrivateBytes(file, 16384), /metadata size changed during read/);
});

for (const point of ['write', 'file sync', 'close', 'write and close', 'rename', 'directory sync', 'replaced leaf', 'replaced parent']) {
    test(`owned metadata retains its publication boundary at ${point}`, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-owned-metadata-')));
        t.after(() => fs.rm(root, {recursive:true,force:true}));
        const parent = path.join(root,'storage'), moved = path.join(root,'moved');
        await fs.mkdir(parent,{mode:0o700});
        const destination = path.join(parent,'controller.json'), previous = {original:true}, next = {replacement:true};
        await writeOwnedJson(destination,previous);
        const unrelated = 'previous-attempt.tmp';
        await fs.writeFile(path.join(parent,unrelated),'Keep unrelated bytes');
        const full = Object.assign(Error('controlled storage failure'),{code:'ENOSPC'});
        const badClose = point === 'write and close' ? Error('controlled close failure') : full;
        const open = fs.open, rename = fs.rename;
        let temporary;
        t.mock.method(fs,'open',async (file,...args) => {
            const h = await open(file,...args);
            if (file === parent && point === 'directory sync') h.sync = async () => { throw full; };
            if (!String(file).startsWith(destination + '.') || args[0] !== 'wx') return h;
            temporary = file;
            if (point === 'file sync') h.sync = async () => { throw full; };
            if (point === 'close' || point === 'write and close') {
                const close = h.close.bind(h);
                h.close = async () => { await close(); throw badClose; };
            }
            if (['write','write and close','replaced leaf','replaced parent'].includes(point)) {
                const write = h.writeFile.bind(h);
                h.writeFile = async data => {
                    await write(data.slice(0,3));
                    if (point === 'replaced leaf') {
                        await rename(file,file + '.original');
                        await fs.writeFile(file,'Other owner bytes',{mode:0o600});
                    }
                    if (point === 'replaced parent') {
                        await rename(parent,moved);
                        await fs.symlink(moved,parent);
                    }
                    throw full;
                };
            }
            return h;
        });
        if (point === 'rename') t.mock.method(fs,'rename',async (from,to) => {
            if (to === destination) throw full;
            return rename(from,to);
        });
        const uncertain = ['replaced leaf','replaced parent'].includes(point);
        await assert.rejects(writeOwnedJson(destination,next), error => {
            if (point === 'write and close') {
                assert.deepEqual(error.errors,[full,badClose]);
                assert.equal(error.cause,full);
                return true;
            }
            if (!uncertain) return error === full;
            assert.ok(error instanceof AggregateError);
            assert.equal(error.cause,full);
            assert.match(error.message,/Unable to confirm cleanup of unfinished installation metadata/);
            return true;
        });
        t.mock.restoreAll();
        assert.deepEqual(JSON.parse(await fs.readFile(destination,'utf8')),point === 'directory sync' ? next : previous);
        assert.equal(await fs.readFile(path.join(parent,unrelated),'utf8'),'Keep unrelated bytes');
        if (point === 'replaced leaf') {
            assert.equal(await fs.readFile(temporary,'utf8'),'Other owner bytes');
            assert.equal(await fs.readFile(temporary + '.original','utf8'),'{\n ');
        } else if (point === 'replaced parent') {
            assert.equal(await fs.readlink(parent),moved);
            assert.equal(await fs.readFile(temporary,'utf8'),'{\n ');
        } else {
            assert.deepEqual((await fs.readdir(parent)).sort(),['controller.json',unrelated]);
            await writeOwnedJson(destination,next);
            assert.deepEqual(JSON.parse(await fs.readFile(destination,'utf8')),next);
        }
    });
}

test('copy preserves exact symlink mode and payload identity under a different umask', {skip: process.platform !== 'darwin'}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-copy-umask-')));
    t.after(async () => { await writable(root); await fs.rm(root, {recursive: true, force: true}); });
    const source = path.join(root, 'source'), destination = path.join(root, 'copy');
    await fs.mkdir(source, {mode: 0o700});
    const executable = path.join(source, 'entry'), link = path.join(source, 'bin');
    await fs.writeFile(executable, 'entry bytes', {mode: 0o500});
    await fs.symlink('entry', link);
    await fs.lchmod(link, 0o755);
    const original = await inventoryTree(source), stat = await fs.stat(executable);
    const tree = new URL('../../dist/installation/tree.js', import.meta.url).href;
    const copied = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
        import {copyAssetTree} from ${JSON.stringify(tree)};
        process.umask(0o077);
        console.log(JSON.stringify(await copyAssetTree(process.argv[1], process.argv[2])));
    `, source, destination], {encoding: 'utf8', timeout: 5000}));
    assert.deepEqual(copied, original);
    assert.equal(assetIdentity(copied), assetIdentity(original));
    assert.equal((await fs.lstat(path.join(destination, 'bin'))).mode & 0o777, 0o755);
    assert.equal((await fs.stat(path.join(destination, 'bin'))).mode & 0o777, 0o500);
    assert.equal(await fs.readFile(path.join(destination, 'bin'), 'utf8'), 'entry bytes');
    const unchanged = await fs.stat(executable);
    assert.equal(unchanged.ino, stat.ino);
    assert.equal(unchanged.mode, stat.mode);
    assert.deepEqual(await inventoryTree(source), original);
});

for (const failure of ['source changed', 'copied mode changed', 'destination occupied', 'rename failed']) {
    test(`verified installation promotion withdraws its stage after ${failure}`, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-publish-tree-')));
        t.after(async () => { await writable(root); await fs.rm(root, {recursive: true, force: true}); });
        const source = path.join(root, 'source'), stage = path.join(root, '.stage'), version = path.join(root, 'version');
        const input = path.join(source, 'entry');
        await fs.mkdir(source, {mode: 0o700});
        await fs.writeFile(input, 'verified bytes', {mode: 0o400});
        const original = await inventoryTree(source);
        const promotion = {destination: version, expectedIdentity: assetIdentity(original)};
        const renameFailure = Object.assign(Error('Controlled failed promotion'), {code: 'EIO'});
        let expected;
        if (failure === 'source changed') {
            await fs.chmod(input, 0o500);
            expected = /Bundle assets changed before copying/;
        } else if (failure === 'copied mode changed') {
            const readdir = fs.readdir;
            t.mock.method(fs, 'readdir', async (file, ...args) => {
                if (file === stage) await fs.chmod(path.join(stage, 'entry'), 0o500);
                return readdir(file, ...args);
            });
            expected = /Copied bundle assets differ from the verified manifest/;
        } else if (failure === 'destination occupied') {
            await fs.mkdir(version);
            expected = /Installation promotion destination already exists/;
        } else {
            const rename = fs.rename;
            t.mock.method(fs, 'rename', async (from, to) => {
                if (from === stage && to === version) throw renameFailure;
                return rename(from, to);
            });
            expected = error => error === renameFailure;
        }
        await assert.rejects(copyAssetTree(source, stage, promotion), expected);
        t.mock.restoreAll();
        await assert.rejects(fs.lstat(stage), {code: 'ENOENT'});
        if (failure === 'destination occupied') {
            assert.deepEqual(await fs.readdir(version), []);
            await fs.rename(version, path.join(root, 'retained-version'));
        } else {
            await assert.rejects(fs.lstat(version), {code: 'ENOENT'});
        }
        assert.equal(await fs.readFile(input, 'utf8'), 'verified bytes');
        assert.equal((await fs.stat(input)).mode & 0o777, failure === 'source changed' ? 0o500 : 0o400);
        await fs.chmod(input, 0o400);
        assert.deepEqual(await copyAssetTree(source, stage, promotion), original);
        await assert.rejects(fs.lstat(stage), {code: 'ENOENT'});
        assert.deepEqual(await inventoryTree(version), original);
    });
}
test('explicit inventory copies untracked bytes/internal bins and breaks hardlinks; refuses outward/cyclic/special/case-colliding paths',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig asset tree '))),source=path.join(root,'source'),destination=path.join(root,'copy');await fs.mkdir(source);await fs.mkdir(path.join(source,'lib'));await fs.writeFile(path.join(source,'lib/untracked-worker.js'),'worker bytes',{mode:0o700});await fs.link(path.join(source,'lib/untracked-worker.js'),path.join(source,'hardlink-copy.js'));await fs.mkdir(path.join(source,'bin'));await fs.symlink('../lib/untracked-worker.js',path.join(source,'bin/worker'));
 let passed=false;t.after(async()=>{if(passed){await writable(root);await fs.rm(root,{recursive:true,force:true});}else t.diagnostic('Retained asset tree '+root);});
 const original=await inventoryTree(source),copied=await copyAssetTree(source,destination);assert.equal(copied.length,original.length);assert.match(assetIdentity(copied),/^[a-f0-9]{64}$/);assert.equal(await fs.readFile(path.join(destination,'bin/worker'),'utf8'),'worker bytes');
 assert.equal((await fs.stat(path.join(destination,'hardlink-copy.js'))).nlink,1);assert.equal((await fs.stat(path.join(destination,'lib/untracked-worker.js'))).nlink,1);assert.notEqual((await fs.stat(path.join(source,'lib/untracked-worker.js'))).ino,(await fs.stat(path.join(destination,'lib/untracked-worker.js'))).ino);
 for(const target of ['/etc/passwd','../outside','self']){await fs.writeFile(path.join(root,'outside'),'foreign');await fs.symlink(target,path.join(source,'self'));await assert.rejects(inventoryTree(source));await fs.unlink(path.join(source,'self'));}
 await fs.writeFile(path.join(source,'Case'),'a');await fs.writeFile(path.join(source,'case'),'b');
 // Case-sensitive volumes retain both names; case-insensitive hosts already collapse them.
 if((await fs.readdir(source)).includes('Case')&&(await fs.readdir(source)).includes('case'))await assert.rejects(inventoryTree(source),/Case-colliding/);
 await fs.rm(path.join(source,'Case'),{force:true});await fs.rm(path.join(source,'case'),{force:true});
 await fs.symlink('lib',path.join(source,'directory-alias'));assert.ok((await inventoryTree(source)).some(a=>a.path==='directory-alias'&&a.kind==='symlink'));passed=true;
});

test('asset inventory hashes bounded binary reads and rejects an incomplete or extra byte', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-inventory-digest-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, 'binary');
    const content = Buffer.alloc(512 * 1024);
    for (let i = 0; i < content.length; i++) content[i] = i % 251;
    await fs.writeFile(file, content);
    await fs.writeFile(path.join(root, 'empty'), '');
    const open = fs.open;
    let fault;
    const lengths = [];
    t.mock.method(fs, 'open', async (name, ...args) => {
        const handle = await open(name, ...args);
        if (name !== file) return handle;
        const read = handle.read.bind(handle);
        handle.read = async (buffer, offset, length, position) => {
            lengths.push(length);
            if (fault === 'incomplete' && position > 0) return { bytesRead: 0, buffer };
            if (fault === 'extra' && position === content.length) {
                assert.equal(length, 1);
                buffer[offset] = 255;
                return { bytesRead: 1, buffer };
            }
            return read(buffer, offset, Math.min(length, 27181), position);
        };
        return handle;
    });
    const entries = await inventoryTree(root);
    const digest = data => createHash('sha256').update(data).digest('hex');
    assert.deepEqual(entries.map(({path, bytes, sha256}) => [path, bytes, sha256]), [
        ['binary', content.length, digest(content)], ['empty', 0, digest('')],
    ]);
    assert.ok(Math.max(...lengths) < content.length);
    for (fault of ['incomplete', 'extra']) await assert.rejects(inventoryTree(root), /asset changed during read/);
});

for (const failureAt of ['write', 'sealed inventory', 'foreign entry', 'replaced directory', 'replaced staging parent']) {
 test(`failed installation copy preserves ownership during ${failureAt}`, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-copy-failure-')));
    const source = path.join(root,'source'), parent = path.join(root,'destination-parent');
    const destination = path.join(parent,'copy');
    const assets = path.join(destination,'assets'), payload = path.join(assets,'payload');
    const text = 'Full original package bytes';
    await fs.mkdir(path.join(source,'assets'), {recursive:true});
    await fs.mkdir(parent, {mode:0o700});
    await fs.writeFile(path.join(source,'assets','payload'), text);
    await fs.symlink('assets/payload', path.join(source,'alias'));
    t.after(async () => { await writable(root); await fs.rm(root, {recursive:true,force:true}); });
    const failure = Object.assign(Error('Controlled write failure'), {code:'ENOSPC'});
    const foreign = path.join(destination,'foreign');
    const movedParent = path.join(root,'moved-parent');
    if (failureAt === 'sealed inventory' || failureAt === 'replaced staging parent') {
        const readdir = fs.readdir;
        t.mock.method(fs,'readdir',async (file,...args) => {
            if (file === destination) {
                assert.equal((await fs.stat(file)).mode & 0o777,0o500);
                if (failureAt === 'replaced staging parent') {
                    await fs.rename(parent,movedParent);
                    await fs.symlink(movedParent,parent);
                }
                throw failure;
            }
            return readdir(file,...args);
        });
    } else {
        const open = fs.open;
        t.mock.method(fs,'open',async (file,...args) => {
            const handle = await open(file,...args);
            if (file === payload && args[0] === 'wx') {
                const write = handle.writeFile.bind(handle);
                handle.writeFile = async data => {
                    await write(data.subarray(0,3));
                    if (failureAt === 'foreign entry') await fs.writeFile(foreign,'Retain foreign file');
                    if (failureAt === 'replaced directory') {
                        await fs.rename(assets,path.join(destination,'moved'));
                        await fs.mkdir(assets,{mode:0o700});
                        await fs.writeFile(payload,'Retain replacement file');
                    }
                    throw failure;
                };
            }
            return handle;
        });
    }
    const uncertain = ['foreign entry','replaced directory','replaced staging parent'].includes(failureAt);
    await assert.rejects(copyAssetTree(source,destination), error => {
        if (!uncertain) return error === failure;
        assert.ok(error instanceof AggregateError);
        assert.equal(error.cause,failure);
        assert.equal(error.errors.length,2);
        return true;
    });
    t.mock.restoreAll();
    assert.equal(await fs.readFile(path.join(source,'assets','payload'),'utf8'),text);
    if (failureAt === 'foreign entry') {
        assert.equal(await fs.readFile(foreign,'utf8'),'Retain foreign file');
        assert.deepEqual(await fs.readdir(destination),['foreign']);
    } else if (failureAt === 'replaced directory') {
        assert.equal(await fs.readFile(payload,'utf8'),'Retain replacement file');
        assert.equal(await fs.readFile(path.join(destination,'moved','payload'),'utf8'),text.slice(0,3));
    } else if (failureAt === 'replaced staging parent') {
        const staged = path.join(movedParent,'copy');
        assert.equal((await fs.stat(staged)).mode & 0o777,0o500);
        assert.equal(await fs.readFile(path.join(staged,'assets','payload'),'utf8'),text);
        assert.equal(await fs.readlink(parent),movedParent);
    } else {
        await assert.rejects(fs.lstat(destination),{code:'ENOENT'});
        assert.equal((await copyAssetTree(source,destination)).length,3);
    }
    await assert.rejects(copyAssetTree(source,source),{code:'EEXIST'});
    assert.equal(await fs.readFile(path.join(source,'assets','payload'),'utf8'),text);
 });
}
