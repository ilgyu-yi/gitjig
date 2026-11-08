import fs from 'node:fs';
import path from 'node:path';

const identity = info => ({device: info.dev, inode: info.ino, type: info.mode & fs.constants.S_IFMT});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Metadata only. Never follows the fixture namespace or its children. */
export function snapshotCheckoutFixtures(checkout) {
    const root = path.join(checkout, '.runtime-fixtures');
    let info;
    try { info = fs.lstatSync(root); }
    catch (error) {
        if (error.code === 'ENOENT') return {root: null, entries: []};
        throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink())
        throw Error('Checkout fixture observation requires an ordinary .runtime-fixtures directory');
    const entries = [];
    const directory = fs.opendirSync(root);
    try {
        let entry;
        while ((entry = directory.readSync())) {
            if (entries.length === 4096)
                throw Error('Checkout fixture observation exceeds its 4096 direct-entry limit');
            entries.push({name: entry.name, ...identity(fs.lstatSync(path.join(root, entry.name)))});
        }
    } finally { directory.closeSync(); }
    if (!same(identity(info), identity(fs.lstatSync(root))))
        throw Error('Checkout fixture namespace changed during observation');
    return {root: identity(info), entries: entries.sort((a, b) => a.name.localeCompare(b.name))};
}

/** Detect retained top-level additions/replacements, not all nested mutations. */
export function compareCheckoutFixtures(before, after) {
    const previous = new Map(before.entries.map(entry => [entry.name, entry]));
    const entries = after.entries.filter(entry => !same(previous.get(entry.name), entry));
    const namespaceCreated = !before.root && !!after.root;
    const namespaceReplaced = !!before.root && !!after.root && !same(before.root, after.root);
    return {outcome: entries.length || namespaceCreated || namespaceReplaced ? 'RESIDUE' : 'CLEAN', namespaceCreated, namespaceReplaced, entries};
}
