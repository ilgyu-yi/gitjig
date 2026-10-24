import { join } from 'node:path';
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import type { Controller } from '../controller/controller.js';
import { ControllerError } from '../controller/types.js';
import { directory, readObject, writeObject } from './storage.js';
import { parseUniqueJson } from '../workflow/json.js';
export interface LocalConventions {
    protectedBranches: string[];
    branchPrefixes: string[];
    commitTypes: string[];
    subjectMaxLength: number;
    requireBody: boolean;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable = (message: string) => new ControllerError('LOCAL_CONVENTIONS_UNAVAILABLE', message, 'Inspect local conventions and their owned configuration file. Repair invalid data or configure an explicit profile at the current revision; do not treat recommendations as applied rules.');
export function recommendedLocalConventions(): LocalConventions { return { protectedBranches: ['main', 'master'], branchPrefixes: [], commitTypes: [], subjectMaxLength: 72, requireBody: false }; }
export function validateLocalConventions(value: unknown): LocalConventions {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw unavailable('Local convention profile requires an object');
    const v = value as Record<string, unknown>, keys = ['protectedBranches', 'branchPrefixes', 'commitTypes', 'subjectMaxLength', 'requireBody'];
    if (Object.keys(v).length !== keys.length || keys.some(key => !Object.hasOwn(v, key)))
        throw unavailable('Local convention profile requires only protectedBranches, branchPrefixes, commitTypes, subjectMaxLength and requireBody');
    for (const key of keys.slice(0, 3)) {
        const list = v[key];
        if (!Array.isArray(list) || list.length > 32 || list.some(x => typeof x !== 'string' || !x || x.length > 128 || /[\s\u0000-\u001f\u007f*?\[\]\\]/u.test(x)) || new Set(list).size !== list.length)
            throw unavailable('Convention lists require at most 32 distinct nonempty literal values without whitespace, controls or glob syntax');
    }
    if (!(v.commitTypes as string[]).every(x => /^[a-z][a-z0-9-]{0,31}$/u.test(x)))
        throw unavailable('Commit types require lowercase names of at most 32 letters, digits or hyphens');
    if (!Number.isSafeInteger(v.subjectMaxLength) || Number(v.subjectMaxLength) < 1 || Number(v.subjectMaxLength) > 256 || typeof v.requireBody !== 'boolean')
        throw unavailable('Subject maximum requires 1..256 Unicode code points; requireBody requires a boolean');
    return { protectedBranches: [...(v.protectedBranches as string[])], branchPrefixes: [...(v.branchPrefixes as string[])], commitTypes: [...(v.commitTypes as string[])], subjectMaxLength: Number(v.subjectMaxLength), requireBody: v.requireBody };
}
/** Local developer preferences; never repository governance or agent standing. */
export class ApplicationLocalConventions {
    private readonly folder: string;
    constructor(private readonly controller: Controller) { this.folder = join(controller.applicationHome(), 'config'); directory(this.folder, true, true); }
    private owner = () => { this.controller.applicationHome(); directory(this.folder, true); };
    private snapshot(projectId: string) {
        this.owner();
        if (!/^[A-Za-z0-9_-]{1,100}$/u.test(projectId))
            throw unavailable('Invalid registered project identity');
        const project = this.controller.listProjects().find(p => p.id === projectId);
        if (!project)
            throw unavailable('Select a registered project before inspecting local conventions');
        let identity: {
            device: string;
            inode: string;
        };
        try {
            directory(project.sourceRoot, false);
            const st = statSync(project.sourceRoot, { bigint: true });
            identity = { device: st.dev.toString(), inode: st.ino.toString() };
        }
        catch {
            throw unavailable('Registered project source is unavailable or unsafe; restore its canonical directory or register a distinct project identity');
        }
        const file = join(this.folder, `local-conventions-${projectId}.json`);
        let bytes = Buffer.alloc(0), value: Record<string, unknown>;
        try {
            value = readObject(file, true, raw => {
                if (!isUtf8(raw))
                    throw Error('Invalid UTF-8');
                if (raw.length)
                    parseUniqueJson(raw.toString('utf8'));
                bytes = Buffer.from(raw);
            });
        }
        catch {
            throw unavailable('Owned local conventions are invalid, unsafe or oversized');
        }
        let revision = 0, rules: LocalConventions | null = null;
        if (bytes.length) {
            if (Object.keys(value).length !== 6 || value.version !== 1 || value.projectId !== projectId || value.sourceRoot !== project.sourceRoot || JSON.stringify(value.sourceIdentity) !== JSON.stringify(identity) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1)
                throw unavailable('Stored conventions no longer match this project/root or have an invalid revision; register a distinct project identity for a replacement repository');
            revision = Number(value.revision);
            rules = validateLocalConventions(value.rules);
        }
        return { project, file, identity, bytes, revision, rules };
    }
    prepare(projectId: string) {
        const source = this.snapshot(projectId);
        const assertCurrent = () => {
            const now = this.snapshot(projectId);
            if (now.project.sourceRoot !== source.project.sourceRoot || JSON.stringify(now.identity) !== JSON.stringify(source.identity) || !now.bytes.equals(source.bytes))
                throw unavailable('Local conventions or project source changed during preparation; reopen and retry');
        };
        return { project: structuredClone(source.project), view: { projectId, sourceRoot: source.project.sourceRoot, path: source.file, state: source.rules ? 'CONFIGURED' : 'NOT_CONFIGURED', revision: source.revision, rules: source.rules, hash: source.rules ? hash(source.rules) : null, scope: 'Developer-local preferences only; hosting rules and agent procedures remain separate' }, assertCurrent };
    }
    inspect(projectId: string) { return this.prepare(projectId).view; }
    set(projectId: string, expectedRevision: number, value: unknown) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
            throw unavailable('Expected convention revision must be a nonnegative safe integer');
        const source = this.snapshot(projectId), rules = validateLocalConventions(value);
        if (source.revision !== expectedRevision)
            throw unavailable('Local convention revision changed; inspect the current revision before configuring');
        const revision = expectedRevision + 1;
        if (!Number.isSafeInteger(revision))
            throw unavailable('Local convention revision exhausted');
        writeObject(source.file, { version: 1, projectId, sourceRoot: source.project.sourceRoot, sourceIdentity: source.identity, revision, rules }, () => {
            this.owner();
            const now = this.snapshot(projectId);
            if (now.project.sourceRoot !== source.project.sourceRoot || JSON.stringify(now.identity) !== JSON.stringify(source.identity) || !now.bytes.equals(source.bytes))
                throw unavailable('Local conventions or project source changed during configuration; inspect again');
        });
        return this.inspect(projectId);
    }
}
