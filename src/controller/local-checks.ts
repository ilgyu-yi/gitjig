import type { Store } from './store.js';
import { workAllowance, workFamilyUnsettled } from './work-recovery.js';
export const initialWorkAllowance = 8;
const parse = (raw: string) => {
    if (Buffer.byteLength(raw) > 262144)
        throw Error('Local check record exceeds the supported view bound');
    return JSON.parse(raw);
};
const family = "(CASE WHEN json_valid(w.data) THEN json_extract(w.data,'$.kind')='command-observation' ELSE 1 END)";
export function inspectLocalCheck(store: Store, workId: string, busy: (id: string) => boolean) {
    const w = store.one('SELECT * FROM works WHERE id=?', workId);
    if (!w)
        throw Error('Original local check unavailable');
    const data = parse(w.data);
    if (data.kind !== 'command-observation' || typeof data.raw !== 'string' || data.latestRaw !== undefined && typeof data.latestRaw !== 'string' || !['work', 'scratch'].includes(data.cwd) || !store.one('SELECT id FROM projects WHERE id=?', w.project))
        throw Error('Original command check kind/project/inputs unavailable');
    const latest = store.one("SELECT id,phase,reservation,json_extract(data,'$.kind') AS kind,json_extract(data,'$.raw') AS command,json_extract(data,'$.cwd') AS cwd,json_extract(data,'$.profile') AS runtime,json_extract(data,'$.cleanup') AS cleanup,json_extract(data,'$.manifest.digest') AS captureDigest,json_extract(data,'$.resultId') AS resultId FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1", workId);
    const result = w.current_result ? store.one("SELECT id,run,json_extract(data,'$.workId') AS workId,json_extract(data,'$.runId') AS runId,json_extract(data,'$.kind') AS kind,json_extract(data,'$.status') AS status,json_extract(data,'$.exitCode') AS exitCode,json_extract(data,'$.actualCwd') AS actualCwd,json_extract(data,'$.cleanup') AS cleanup FROM results WHERE id=? AND work=?", w.current_result, workId) : null;
    if (!latest || latest.kind !== 'command-observation' || typeof latest.command !== 'string' || latest.cwd !== data.cwd)
        throw Error('Original command run binding unavailable');
    if (result && (result.workId !== workId || result.runId !== result.run || result.kind !== 'command-observation'))
        throw Error('Original command result binding unavailable');
    return { workId, projectId: w.project, kind: 'command-observation' as const, command: data.latestRaw ?? data.raw, cwd: data.cwd as 'work' | 'scratch', state: w.state, epoch: w.epoch, generation: w.generation, sourceId: w.source,
        allowance: workAllowance(store, workId), unsettled: workFamilyUnsettled(store, w.lineage, busy), latestRun: latest ? { runId: latest.id, phase: latest.phase, reservation: latest.reservation, runtime: latest.runtime ? JSON.parse(latest.runtime) : null, cleanup: latest.cleanup, captureDigest: latest.captureDigest, resultId: latest.resultId, command: latest.command, cwd: latest.cwd } : null,
        result: result ? { resultId: result.id, runId: result.run, status: result.status, exitCode: result.exitCode, actualCwd: result.actualCwd, cleanup: result.cleanup } : null };
}
export type LocalCheckView = ReturnType<typeof inspectLocalCheck>;
export function listLocalChecks(store: Store, projectId: string, options: {
    limit?: number;
    before?: string;
} = {}) {
    const limit = options.limit ?? 25;
    if (Object.keys(options).some(key => !['limit', 'before'].includes(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !store.one('SELECT id FROM projects WHERE id=?', projectId))
        throw Error('Select a registered project and a local check page limit from 1 to 100');
    const cursor = options.before === undefined ? undefined : store.one(`SELECT w.rowid AS position FROM works w WHERE w.id=? AND w.project=? AND ${family}`, options.before, projectId);
    if (options.before !== undefined && !cursor)
        throw Error('Local check cursor is unavailable in this project; reopen the first page');
    const rows = store.all(`SELECT w.id AS workId,w.state AS recordedState,substr(w.data,1,262145) AS data FROM works w WHERE w.project=? AND ${family} ${cursor ? 'AND w.rowid<?' : ''} ORDER BY w.rowid DESC LIMIT ?`, projectId, ...cursor ? [cursor.position] : [], limit + 1);
    return { checks: rows.slice(0, limit).map(row => {
            try {
                const data = parse(row.data), command = data.latestRaw ?? data.raw;
                if (data.kind !== 'command-observation' || typeof command !== 'string' || !['work', 'scratch'].includes(data.cwd))
                    throw Error();
                return { state: 'RETAINED' as const, workId: row.workId, recordedState: row.recordedState, commandPreview: command.slice(0, 300), cwd: data.cwd as 'work' | 'scratch' };
            }
            catch {
                return { state: 'UNAVAILABLE' as const, workId: row.workId, reason: 'Original local check metadata unavailable; no dispatch is offered' };
            }
        }), nextCursor: rows.length > limit ? rows[limit - 1]!.workId : null };
}
