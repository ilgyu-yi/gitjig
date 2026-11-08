import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './store.js';
import type { OwnerLease, OwnerWitness } from './ownership.js';

export const durablePreviewProtocol = 'source-preview-durable-store/v2' as const;
export interface PreviewWriterWitness {
    protocol: typeof durablePreviewProtocol;
    owner: Readonly<OwnerWitness>;
    database: { file: string; device: string; inode: string; ownerUid: number };
    journalMode: 'wal';
    synchronous: 2;
}
export function samePreviewDatabaseScope(before: PreviewWriterWitness, current: PreviewWriterWitness) {
    return JSON.stringify(before.database) === JSON.stringify(current.database) &&
        ['stateDirectory', 'stateDevice', 'stateInode', 'ownerUid'].every(key => before.owner[key as keyof OwnerWitness] === current.owner[key as keyof OwnerWitness]);
}
export function validPreviewWriterWitness(value: any, home: string): value is PreviewWriterWitness {
    const fields = (v: any, names: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === names.sort().join();
    const text = (v: unknown) => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= 4096 && !/[\x00-\x1f\x7f]/u.test(v);
    return fields(value, ['protocol', 'owner', 'database', 'journalMode', 'synchronous']) && value.protocol === durablePreviewProtocol && value.journalMode === 'wal' && value.synchronous === 2 &&
        fields(value.owner, ['stateDirectory', 'stateDevice', 'stateInode', 'ownerDevice', 'ownerInode', 'ownerUid', 'pid', 'nonce']) && value.owner.stateDirectory === path.join(home, 'state') &&
        ['stateDevice', 'stateInode', 'ownerDevice', 'ownerInode', 'nonce'].every(key => text(value.owner[key])) && Number.isSafeInteger(value.owner.pid) && value.owner.pid > 0 && Number.isSafeInteger(value.owner.ownerUid) && value.owner.ownerUid >= 0 &&
        fields(value.database, ['file', 'device', 'inode', 'ownerUid']) && value.database.file === path.join(home, 'state', 'controller.sqlite') && text(value.database.device) && text(value.database.inode) && value.database.ownerUid === value.owner.ownerUid;
}
/** One actual SQLite writer under the existing owner lease; no caller durability flags. */
export class SourcePreviewWriter {
    private readonly connection;
    private witness: PreviewWriterWitness | undefined;
    constructor(private readonly store: Store, private readonly home: string, private readonly owner: OwnerLease) {
        this.connection = store.db;
    }
    private identity() {
        const owner = this.owner.assertCurrent();
        if (this.store.db !== this.connection || owner.stateDirectory !== path.join(this.home, 'state'))
            throw Error('Original source preview writer/owner differs');
        const main = this.connection.prepare('PRAGMA database_list').all().find(row => row.name === 'main');
        const file = path.join(owner.stateDirectory, 'controller.sqlite');
        if (!main || main.file !== file || fs.realpathSync(file) !== file) throw Error('Canonical owned preview database required');
        const stat = fs.lstatSync(file);
        const opened = this.store.openedFile;
        if (!opened || opened.file !== file || opened.device !== String(stat.dev) || opened.inode !== String(stat.ino) || opened.ownerUid !== stat.uid)
            throw Error('Original Store opened database identity changed');
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== owner.ownerUid || (stat.mode & 0o022))
            throw Error('Owner-controlled original preview database required');
        return { owner, database: { file, device: String(stat.dev), inode: String(stat.ino), ownerUid: stat.uid } };
    }
    private observe(): PreviewWriterWitness {
        const { owner, database } = this.identity();
        const mode = this.connection.prepare('PRAGMA journal_mode').get(), sync = this.connection.prepare('PRAGMA synchronous').get();
        if (mode?.journal_mode !== 'wal' || sync?.synchronous !== 2) throw Error('Source preview actual writer requires WAL and FULL durability');
        return Object.freeze({ protocol: durablePreviewProtocol, owner: Object.freeze({ ...owner }), database: Object.freeze(database), journalMode: 'wal', synchronous: 2 });
    }
    prepare() {
        if (this.witness) return this.assertCurrent();
        const before = this.identity();
        if (this.connection.isTransaction) throw Error('Preview writer durability must be established outside a transaction');
        this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
        const witness = this.observe();
        if (JSON.stringify(before) !== JSON.stringify({ owner: witness.owner, database: witness.database })) throw Error('Preview writer identity changed during qualification');
        this.witness = witness;
        return this.witness;
    }
    /** Bind an already durable connection without PRAGMA writes, including in an owned TX. */
    bindCurrent(){
        if(this.witness)return this.assertCurrent();
        this.witness=this.observe();return this.witness;
    }
    assertCurrent() {
        if (!this.witness) throw Error('Source preview writer has not been qualified');
        const current = this.observe();
        if (JSON.stringify(current) !== JSON.stringify(this.witness)) throw Error('Original source preview writer identity changed');
        return current;
    }
}
