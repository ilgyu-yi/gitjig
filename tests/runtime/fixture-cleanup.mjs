import fs from 'node:fs/promises';
import path from 'node:path';

/** Returned handles alone cannot account for a create which failed before return. */
export async function scopeJournalsRemoved(stateRoot) {
    const entries = await fs.readdir(stateRoot);
    for (const entry of entries) {
        if (entry.endsWith('.json.next')) return false;
        if (!entry.endsWith('.json')) continue; // E.g. the controlled authority fixture.
        const file = path.join(stateRoot, entry), stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return false;
        let record;
        try { record = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return false; }
        if (record?.version !== 1 || record.state !== 'removed' || !/^[a-f0-9-]{36}$/u.test(record.nonce) ||
            entry !== record.nonce + '.json' || !/^[a-zA-Z0-9_.-]{1,100}$/u.test(record.context) ||
            !/^[a-zA-Z0-9_-]{1,100}$/u.test(record.workId) || !/^[a-zA-Z0-9_-]{1,100}$/u.test(record.runId) ||
            !(typeof record.id === 'string' && (/^[a-f0-9]{64}$/u.test(record.id) || (record.id === '' && record.reason === 'aborted-before-create')))) return false;
    }
    return true;
}
