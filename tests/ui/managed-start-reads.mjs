// Gate actual criteria and snapshot reads in the private CLI fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isMainThread } from 'node:worker_threads';

const root = process.env.GITJIG_MANAGED_START_READS;
async function gate(stage) {
    await fs.writeFile(path.join(root, stage + '.entered'), 'entered');
    const release = path.join(root, stage + '.release');
    while (!await fs.access(release).then(() => true, () => false))
        await delay(20);
}
if (root && isMainThread) {
    const readFile = fs.readFile;
    fs.readFile = async function (file, ...args) {
        if (file instanceof URL && file.pathname.endsWith('/MISSION.md'))
            await gate('rules');
        return readFile.call(this, file, ...args);
    };
}
if (root && !isMainThread) {
    const lstat = fs.lstat, sourceFile = path.join(root, 'project', 'file.txt');
    fs.lstat = async function (file, ...args) {
        if (file === sourceFile)
            await gate('capture');
        return lstat.call(this, file, ...args);
    };
}
