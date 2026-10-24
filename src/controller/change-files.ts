import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { capture, type Manifest } from './capture.js';
import { privateDirectory, inside } from './ownership.js';
import type { CaptureProfile } from './types.js';
import type { SourceInput } from '../workflow/types.js';
export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function effective(manifest: Manifest) {
    return { files: manifest.files.map(f => ({ path: f.path, sha256: f.sha256, executable: f.effectiveMode & 0o111 })), directories: manifest.directories.map(d => d.path), ...(manifest.dependencyLinks?.length ? { dependencyLinks: manifest.dependencyLinks } : {}) };
}
export async function freeze(source: string, target: string, profile: CaptureProfile, signal?: AbortSignal) {
    await privateDirectory(target);
    const job = capture(source, target, profile, signal);
    const manifest = await job.result;
    return { manifest, digest: hash(effective(manifest)) };
}
export async function materialize(source: string, target: string, profile: CaptureProfile, expected: string, signal?: AbortSignal) {
    const receipt = await freeze(source, target, profile, signal);
    if (receipt.digest !== expected)
        throw new Error('materialized effective input mismatch');
    return receipt;
}
export function delta(before: Manifest, after: Manifest) {
    const a = new Map(before.files.map(f => [f.path, f])), b = new Map(after.files.map(f => [f.path, f]));
    const changes = [...new Set([...a.keys(), ...b.keys()])].sort().filter(p => a.get(p)?.sha256 !== b.get(p)?.sha256 || ((a.get(p)?.effectiveMode ?? 0) & 0o111) !== ((b.get(p)?.effectiveMode ?? 0) & 0o111)).map(p => ({ path: p, before: a.get(p)?.sha256 ?? null, after: b.get(p)?.sha256 ?? null, beforeExec: (a.get(p)?.effectiveMode ?? 0) & 0o111, afterExec: (b.get(p)?.effectiveMode ?? 0) & 0o111 }));
    const beforeLinks = new Map((before.dependencyLinks ?? []).map(link => [link.path, link.target])), afterLinks = new Map((after.dependencyLinks ?? []).map(link => [link.path, link.target]));
    const dependencyLinks = [...new Set([...beforeLinks.keys(), ...afterLinks.keys()])].sort().filter(name => beforeLinks.get(name) !== afterLinks.get(name)).map(name => ({ path: name, before: beforeLinks.get(name) ?? null, after: afterLinks.get(name) ?? null }));
    return { files: changes, ...(dependencyLinks.length ? { dependencyLinks } : {}), directories: { before: before.directories.map(d => d.path), after: after.directories.map(d => d.path) } };
}
export async function sources(version: {
    id: string;
    artifact: string;
    hash: string;
    data: {
        manifest: Manifest;
    };
}, side: 'base' | 'candidate', requiredPaths: string[] = [], selectedOnly = false): Promise<SourceInput[]> {
    let total = 0;
    const list: SourceInput[] = [];
    for (const file of version.data.manifest.files) {
        const forced = requiredPaths.includes(file.path);
        if (selectedOnly && !forced)
            continue;
        if (!forced && (/^(\.git|node_modules|dist|build|vendor)(\/|$)/.test(file.path) || !/(\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|ya?ml|toml|py|go|rs|sh|html|css|c|h|cc|cpp|java|kt|swift)|(^|\/)(Makefile|Dockerfile|LICENSE))$/.test(file.path)))
            continue;
        const actualPath = path.join(version.artifact, file.path), stat = await fs.stat(actualPath);
        if (stat.size + total > 1024 * 1024)
            throw new Error('initial review source text exceeds1MiB');
        const bytes = await fs.readFile(actualPath);
        total += bytes.length;
        if (total > 1024 * 1024)
            throw new Error('initial review source text exceeds1MiB');
        if (bytes.includes(0) && !forced)
            continue;
        if (bytes.includes(0))
            throw new Error('binary review source unsupported');
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (hash(bytes.toString()) !== file.sha256)
            throw new Error('version artifact changed');
        list.push({ id: `${side}:${file.path}`, version: version.id, side, path: file.path, content, sha256: file.sha256, exposeInPrompt: true });
    }
    return list;
}
export function safePath(root: string, relative: string) {
    const target = path.resolve(root, relative);
    if (!relative || path.isAbsolute(relative) || !inside(root, target) || target === root)
        throw new Error('invalid exact remedy path');
    return target;
}
