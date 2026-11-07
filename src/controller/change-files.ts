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
}, side: 'base' | 'candidate', requiredPaths: string[] = [], selectedOnly = false, optionalPackingBytes = 1024 * 1024): Promise<SourceInput[]> {
    let total = 0, packed = 0;
    const list: SourceInput[] = [];
    // Reserve the finite input for mandatory paths before optional entry seeds.
    const required = new Set(requiredPaths);
    const files = [...version.data.manifest.files].sort((a, b) => Number(required.has(b.path)) - Number(required.has(a.path)));
    for (const file of files) {
        const forced = required.has(file.path);
        if (selectedOnly && !forced)
            continue;
        if (!forced && (/^(\.git|node_modules|dist|build|vendor)(\/|$)/.test(file.path) || !/(\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|ya?ml|toml|py|go|rs|sh|html|css|c|h|cc|cpp|java|kt|swift)|(^|\/)(Makefile|Dockerfile|LICENSE))$/.test(file.path)))
            continue;
        const actualPath = path.join(version.artifact, file.path), stat = await fs.stat(actualPath);
        if (stat.size + total > 1024 * 1024) {
            if (forced)
                throw new Error('initial review source text exceeds1MiB');
            continue;
        }
        const metadata = { id: `${side}:${file.path}`, version: version.id, side, path: file.path, sha256: file.sha256, exposeInPrompt: true };
        const overhead = Buffer.byteLength(JSON.stringify(metadata)) * 2 + 128;
        if (!forced && packed + stat.size + overhead > optionalPackingBytes)
            continue;
        const bytes = await fs.readFile(actualPath);
        if (total + bytes.length > 1024 * 1024) {
            if (forced)
                throw new Error('initial review source text exceeds1MiB');
            continue;
        }
        if (!forced && packed + bytes.length + overhead > optionalPackingBytes)
            continue;
        if (bytes.includes(0) && !forced)
            continue;
        if (bytes.includes(0))
            throw new Error('binary review source unsupported');
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (hash(bytes.toString()) !== file.sha256)
            throw new Error('version artifact changed');
        total += bytes.length;
        packed += bytes.length + overhead;
        list.push({ ...metadata, content });
    }
    return list;
}
export function safePath(root: string, relative: string) {
    const target = path.resolve(root, relative);
    if (!relative || path.isAbsolute(relative) || !inside(root, target) || target === root)
        throw new Error('invalid exact remedy path');
    return target;
}
