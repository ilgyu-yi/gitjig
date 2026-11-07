import path from 'node:path';
export interface DependencyLink {
    path: string;
    target: string;
}
export const captureNormalization = 'private-owner-read-write-preserve-file-exec;directories0700';
export const dependencyLinkNormalization = captureNormalization + ';relative-dependency-links-v1';
function unsupportedLink(name: string): never {
    throw Error(`Unsupported dependency link: ${name}; require a relative, existing, acyclic target within the same node_modules tree`);
}
function relativeLinkTarget(target: string): boolean {
    return !!target && Buffer.byteLength(target) <= 4096 &&
        !path.posix.isAbsolute(target) && !/[\\\x00-\x1f\x7f]/u.test(target);
}
/** Resolve against the captured census, never by following a host filesystem alias. */
export function validateDependencyLinks(links: readonly DependencyLink[], files: readonly {
    path: string;
}[], directories: readonly {
    path: string;
}[]) {
    const aliases = new Map(links.map(link => [link.path, link.target]));
    const regular = new Set(files.map(file => file.path));
    const dirs = new Set(directories.map(directory => directory.path));
    const resolved = new Map<string, string>();
    if (aliases.size !== links.length)
        unsupportedLink('duplicate');
    for (const link of links) {
        const parts = link.path.split('/');
        const boundary = parts.indexOf('node_modules') + 1;
        if (!boundary || boundary === parts.length || !relativeLinkTarget(link.target))
            unsupportedLink(link.path);
        const root = parts.slice(0, boundary).join('/');
        const current = parts.slice(0, -1);
        const pending = link.target.split('/').reverse();
        let expansions = 0;
        while (pending.length) {
            const part = pending.pop()!;
            if (!part || part === '.')
                continue;
            if (part === '..') {
                if (current.length <= boundary)
                    unsupportedLink(link.path);
                current.pop();
                continue;
            }
            current.push(part);
            const name = current.join('/');
            const target = aliases.get(name);
            if (target !== undefined) {
                if (++expansions > 40 || !relativeLinkTarget(target))
                    unsupportedLink(link.path);
                current.pop();
                pending.push(...target.split('/').reverse());
            }
            else if (pending.length && !dirs.has(name)) {
                unsupportedLink(link.path);
            }
        }
        const name = current.join('/');
        if (!(name === root || name.startsWith(root + '/')) || !regular.has(name) && !dirs.has(name))
            unsupportedLink(link.path);
        resolved.set(link.path, name);
    }
    validateDirectoryGraph(dirs, resolved);
    return resolved;
}
function validateDirectoryGraph(dirs: ReadonlySet<string>, resolved: ReadonlyMap<string, string>): void {
    // Directory aliases must not introduce a recursive traversal cycle.
    const edges = new Map<string, string[]>();
    const edge = (from: string, to: string) => {
        const list = edges.get(from) ?? [];
        list.push(to);
        edges.set(from, list);
    };
    for (const dir of dirs)
        edge(path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir), dir);
    for (const [alias, target] of resolved)
        if (dirs.has(target))
            edge(path.posix.dirname(alias), target);
    const active = new Set<string>();
    const done = new Set<string>();
    const stack: {
        name: string;
        exit: boolean;
    }[] = [{ name: '', exit: false }];
    while (stack.length) {
        const item = stack.pop()!;
        if (item.exit) {
            active.delete(item.name);
            done.add(item.name);
            continue;
        }
        if (done.has(item.name))
            continue;
        if (active.has(item.name))
            unsupportedLink(item.name);
        active.add(item.name);
        stack.push({ name: item.name, exit: true });
        for (const name of edges.get(item.name) ?? [])
            stack.push({ name, exit: false });
    }
}
