import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { ProjectProtectionBinding, ProjectProtectionView, SetProjectProtection } from './protection-types.js';
import { ControllerError } from './types.js';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex'), within = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
export function projectProtection(store: Store, projectId: string | null): ProjectProtectionBinding {
    if (projectId === null)
        return { version: 1, configured: false, revision: 0, protectedPaths: [], sourceEventId: null, hash: digest({ projectId: null, revision: 0, protectedPaths: [] }) };
    const row = store.one('SELECT execution_policy FROM projects WHERE id=?', projectId);
    if (!row)
        throw Error('Registered project protection unavailable');
    const value = row.execution_policy === null ? null : JSON.parse(row.execution_policy);
    if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.protectedPaths) || typeof value.sourceEventId !== 'string' || !value.sourceEventId))
        throw Error('Stored project protection malformed');
    const revision = value?.revision ?? 0, protectedPaths = value?.protectedPaths ?? [];
    if (value !== null && JSON.stringify(literals(protectedPaths)) !== JSON.stringify(protectedPaths))
        throw Error('Stored project protection paths are not canonical');
    return { version: 1, configured: value !== null, revision, protectedPaths: [...protectedPaths], sourceEventId: value?.sourceEventId ?? null, hash: digest({ projectId, revision, protectedPaths }) };
}
export function assertRunProtection(store: Store, runId: string) {
    const run = store.one('SELECT r.data,w.project FROM runs r JOIN works w ON w.id=r.work WHERE r.id=?', runId);
    if (!run)
        throw Error('Protection run missing');
    const data = JSON.parse(run.data);
    if (!['governed-role', 'governed-check', 'ordinary-conversation', 'command-observation', 'investigation', 'governed-change'].includes(data.kind))
        return;
    const current = projectProtection(store, run.project), bound = data.projectProtection as ProjectProtectionBinding | undefined;
    if (bound ? bound.hash !== current.hash || bound.revision !== current.revision || JSON.stringify(bound.protectedPaths) !== JSON.stringify(current.protectedPaths) : current.configured)
        throw new ControllerError('PROTECTION_STALE', 'Run project protection no longer current', 'Re-enter retained work under current project protection', undefined, runId);
}
function literals(value: readonly string[]) {
    if (!Array.isArray(value) || value.length > 64)
        throw Error('Protected paths must be a finite array of at most64 paths');
    const paths = value.map(p => {
        if (typeof p !== 'string' || !p || p.length > 1024 || path.isAbsolute(p) || /[\0\\*?\[\]{}!,]/.test(p) || p.split('/').some(part => !part || part === '.' || part === '..'))
            throw Error('Protected paths require literal existing relative paths; glob/future/root/unsupported spelling unavailable');
        return p;
    });
    if (new Set(paths).size !== paths.length)
        throw Error('Duplicate protected path');
    return paths.sort();
}
async function supported(root: string, paths: readonly string[]) {
    let entries = 0;
    async function visit(target: string, boundary: string): Promise<void> {
        if (++entries > 10000)
            throw Error('Protection population exceeds10000 entries');
        const st = await fs.lstat(target);
        if (st.isSymbolicLink()) {
            const actual = await fs.realpath(target);
            if (!within(boundary, actual))
                throw Error('Protected subtree outward alias unsupported: ' + target);
            return;
        }
        if (st.isFile()) {
            if (st.nlink !== 1)
                throw Error('Protected hardlink topology unsupported: ' + target);
            return;
        }
        if (!st.isDirectory())
            throw Error('Protected special entry unsupported: ' + target);
        const directory = await fs.opendir(target);
        for await (const entry of directory)
            await visit(path.join(target, entry.name), boundary);
    }
    for (const p of paths) {
        const target = await fs.realpath(path.join(root, p)).catch(() => {
            throw Error('Protected path absent from effective input: ' + p);
        });
        if (target === root || !within(root, target))
            throw Error('Protected path resolves outside project: ' + p);
        await visit(target, target);
    }
}
export async function scopeProtection(store: Store, runId: string, workRoot: string): Promise<string[]> {
    assertRunProtection(store, runId);
    const data = JSON.parse(store.one('SELECT data FROM runs WHERE id=?', runId).data), paths = data.projectProtection?.protectedPaths ?? [];
    await supported(await fs.realpath(workRoot), paths);
    assertRunProtection(store, runId);
    return [...paths];
}
export class ProjectProtection {
    constructor(private readonly store: Store, private readonly assertOpen: () => void, private readonly settle: (workIds: string[]) => Promise<void>) { }
    inspect(projectId: string): ProjectProtectionView {
        this.assertOpen();
        const binding = projectProtection(this.store, projectId), boundRuns = this.store.all('SELECT r.id,r.phase,r.data FROM runs r JOIN works w ON w.id=r.work WHERE w.project=? ORDER BY r.rowid DESC LIMIT 64', projectId).map(r => ({ r, b: JSON.parse(r.data).projectProtection })).filter(x => x.b).map(({ r, b }) => ({ runId: r.id, phase: r.phase, revision: b.revision, hash: b.hash }));
        return { projectId, ...binding, boundRuns, limitations: ['Existing literal paths only; no globs/future paths/hardlink topology', 'Configured policy is not a claim of actual loaded or verified enforcement; boundRuns retains up to64 admitted bindings', 'Criteria-file repair exception unavailable: explicit owner change and re-admission required'] };
    }
    async set(input: SetProjectProtection): Promise<ProjectProtectionView> {
        this.assertOpen();
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
            throw Error('Finite expected protection revision required');
        const protectedPaths = literals(input.protectedPaths), row = this.store.one('SELECT root FROM projects WHERE id=?', input.projectId);
        if (!row)
            throw Error('Project not registered');
        await supported(row.root, protectedPaths);
        this.assertOpen();
        const affected = this.store.tx(() => {
            const previous = projectProtection(this.store, input.projectId);
            if (previous.revision !== input.expectedRevision)
                throw Error('Project protection revision changed');
            const source = randomUUID(), revision = previous.revision + 1;
            if (!Number.isSafeInteger(revision))
                throw Error('Protection revision exhausted; forward repair required');
            this.store.run('INSERT INTO sources VALUES(?,NULL,?,?)', source, JSON.stringify({ kind: 'owner-project-protection', uid: process.getuid?.(), pid: process.pid, projectId: input.projectId, previousRevision: previous.revision }), JSON.stringify({ protectedPaths }));
            this.store.run('UPDATE projects SET execution_policy=? WHERE id=?', JSON.stringify({ version: 1, revision, protectedPaths, sourceEventId: source }), input.projectId);
            const works = this.store.all('SELECT * FROM works WHERE project=?', input.projectId);
            for (const w of works) {
                this.store.run('UPDATE works SET epoch=epoch+1,state=?,current_result=NULL WHERE id=?', ['CANCELLED', 'UNKNOWN'].includes(w.state) ? w.state : 'INTERRUPTED', w.id);
                const change = this.store.one('SELECT * FROM change_state WHERE work=?', w.id);
                if (change) {
                    const data = JSON.parse(change.data);
                    this.store.run('UPDATE change_state SET phase=?,epoch=epoch+1,plan=NULL,verification=NULL,data=? WHERE work=?', 'BLOCKED', JSON.stringify({ ...data, selection: {}, carry: null, pendingNit: null, blocked: ['Project protection changed; old runtime standing invalidated'], resumeStage: 'plan', protectionChange: { source, revision, previous: previous.hash }, nextAction: 'Explicit same-work resume under current policy; captured protected path must exist' }), w.id);
                }
            }
            return works.map(w => w.id);
        });
        await this.settle(affected);
        return this.inspect(input.projectId);
    }
}
