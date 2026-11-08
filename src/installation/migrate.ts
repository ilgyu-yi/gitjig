import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from '../controller/store.js';
export async function migrateClone(file: string) {
    if (!path.isAbsolute(file) || await fs.realpath(file) !== file)
        throw Error('Canonical owned migration clone required');
    const s = await fs.lstat(file);
    if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0)
        throw Error('Private exclusively owned migration clone required');
    const store = new Store(file);
    try {
        const integrity = store.db.prepare('PRAGMA integrity_check').all();
        if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== 'ok' || store.db.prepare('PRAGMA foreign_key_check').all().length)
            throw Error('Migrated clone integrity failed');
        store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        return { schema: store.db.prepare('PRAGMA user_version').get(), integrity: 'ok', workCount: store.db.prepare('SELECT COUNT(*) AS count FROM works').get() };
    }
    finally {
        store.close();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 3)
            throw Error('Explicit clone path required');
        console.log(JSON.stringify(await migrateClone(process.argv[2]!)));
    }
    catch (e) {
        console.error(JSON.stringify({ error: 'CLONE_MIGRATION_UNAVAILABLE', message: (e as Error).message }));
        process.exitCode = 2;
    }
}
