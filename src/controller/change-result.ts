import {validateManifest} from './capture.js';
import {delta, effective, hash} from './change-files.js';
import type {ChangeResultView} from './change-types.js';

/** Keep full entry identities. An over-limit item is omitted, never shortened into another path/ID. */
export function resultEntries<T>(entries: readonly T[]) {
    const visible: T[] = [];
    let bytes = 0;
    for (const entry of entries) {
        const size = Buffer.byteLength(JSON.stringify(entry));
        if (visible.length >= 100 || bytes + size > 64 * 1024) break;
        bytes += size;
        visible.push(entry);
    }
    return {entries: visible, total: entries.length, omitted: entries.length - visible.length};
}

/** The comparison comes from retained worker manifests, not a later original project or artifact read. */
export function recordedResultChanges(base: {hash: string; data: Record<string, any>}, candidate: {hash: string; data: Record<string, any>}): ChangeResultView['changes'] {
    const before = validateManifest(base.data.manifest), after = validateManifest(candidate.data.manifest);
    if (hash(effective(before)) !== base.hash || hash(effective(after)) !== candidate.hash)
        throw Error('Selected snapshot manifest identity differs from its recorded version');
    const difference = delta(before, after);
    if (hash(difference) !== hash(candidate.data.delta))
        throw Error('Recorded candidate delta differs from its selected base and candidate manifests');
    const entries: ChangeResultView['changes']['entries'] = difference.files.map(file => ({
        path: file.path,
        kind: file.before === null ? 'added' : file.after === null ? 'removed' : file.before === file.after ? 'mode-changed' : 'modified',
    }));
    for (const link of difference.dependencyLinks ?? [])
        entries.push({path: link.path, kind: link.before === null ? 'link-added' : link.after === null ? 'link-removed' : 'link-modified'});
    const oldDirectories = new Set(difference.directories.before), newDirectories = new Set(difference.directories.after);
    for (const directory of oldDirectories) if (!newDirectories.has(directory)) entries.push({path: directory, kind: 'directory-removed'});
    for (const directory of newDirectories) if (!oldDirectories.has(directory)) entries.push({path: directory, kind: 'directory-added'});
    return {availability: 'recorded', ...resultEntries(entries)};
}
