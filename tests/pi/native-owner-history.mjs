import fs from 'node:fs/promises';
import path from 'node:path';

/** Historical evidence only; process cleanup must inspect outstanding owners separately. */
export async function nativeOwnerHistory(ownerRoot) {
    const records = (await fs.readdir(ownerRoot)).map(nonce => ({
        nonce, dir: path.join(ownerRoot, nonce),
    }));
    const archive = path.join(path.dirname(ownerRoot), 'archive-v1');
    const shards = await fs.readdir(archive).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    for (const shard of shards) {
        for (const nonce of await fs.readdir(path.join(archive, shard))) {
            records.push({nonce, dir: path.join(archive, shard, nonce, 'records')});
        }
    }
    return records;
}
