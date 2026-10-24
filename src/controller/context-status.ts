import { createHash } from 'node:crypto';
import { contextRelativePath, parseFileReferences, type InputContextManifest, type PreparedContextComparison } from './input-context.js';
import { validateManifest } from './capture.js';
import type { Store } from './store.js';
export interface ConversationContextStatus {
    readonly rows: readonly string[];
    readonly more: boolean;
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const states: Record<string, string> = { QUEUED: 'queued', INITIAL_RESERVED: 'initial reserved', NATIVE_PENDING: 'native pending',
    CONSUMED: 'consumed', CANCELLED: 'cancelled', CONFLICTED: 'superseded', RECONCILIATION_REQUIRED: 'reconciliation required' };
const modes = new Set(['idle', 'steer', 'follow-up', 'manual']);
const invalid = () => { throw new Error('Invalid retained context'); };
function admittedManifest(store: Store, row: any): InputContextManifest {
    const m = JSON.parse(row.data).context as InputContextManifest, origin = JSON.parse(row.source_origin);
    if (!m || !uuid(m.operationId) || m.format !== 'gitjig-input-context-1' || JSON.stringify(m) !== JSON.stringify(origin.context) ||
        row.source_conversation !== row.conversation || m.conversationId !== row.conversation || m.inputId !== row.id || m.sourceId !== row.source ||
        !Number.isSafeInteger(m.submissionGeneration) || m.submissionGeneration < 0 || m.submissionGeneration > row.generation ||
        !Number.isSafeInteger(row.generation) || row.generation < 0 || !Object.hasOwn(states, row.state) || !modes.has(row.mode) ||
        m.rawSha256 !== sha(row.source_raw) || m.textSha256 !== sha(row.text) || !Array.isArray(m.files) || m.files.length > 16 ||
        JSON.stringify(parseFileReferences(row.source_raw).references) !== JSON.stringify(m.references) || parseFileReferences(row.source_raw).text !== row.text ||
        (m.projectId === null ? m.sourceRoot !== null || m.files.length > 0 : store.one('SELECT root FROM projects WHERE id=?', m.projectId)?.root !== m.sourceRoot))
        invalid();
    const seen = new Set<string>();
    let bytes = 0;
    for (const file of m.files) {
        contextRelativePath(file.path);
        if (!uuid(file.artifactId) || seen.has(file.path) || !/^[a-f0-9]{64}$/u.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 256 * 1024 ||
            (bytes += file.bytes) > 1024 * 1024)
            invalid();
        seen.add(file.path);
    }
    if (m.references.some(ref => !seen.has(ref.path)))
        invalid();
    return m;
}
/** Historical linkage, not current-work generation or current source contents. */
function preparedComparison(store: Store, input: any, m: InputContextManifest): PreparedContextComparison | undefined {
    const runs = store.all(`SELECT r.*,w.project AS work_project FROM runs r JOIN works w ON w.id=r.work
        WHERE json_extract(r.data,'$.conversation')=? AND (json_extract(r.data,'$.initialInputId')=? OR
        EXISTS(SELECT 1 FROM json_each(r.data,'$.routedInputs') x WHERE json_extract(x.value,'$.inputId')=?)) LIMIT 3`, input.conversation, input.id, input.id);
    if (runs.length > 1)
        invalid(); // A captured input belongs to one actual dispatch run.
    const run = runs[0];
    if (!run) {
        if (['INITIAL_RESERVED', 'NATIVE_PENDING', 'CONSUMED', 'RECONCILIATION_REQUIRED'].includes(input.state))
            invalid();
        return undefined;
    }
    const data = JSON.parse(run.data);
    if (run.work_project !== m.projectId || (input.work !== null && input.work !== run.work))
        invalid();
    const receipts: unknown[] = [];
    if (data.initialInputId === input.id && Object.hasOwn(data, 'initialInputComparison'))
        receipts.push(data.initialInputComparison);
    if (Object.hasOwn(data, 'routedInputs')) {
        if (!Array.isArray(data.routedInputs))
            invalid();
        for (const route of data.routedInputs)
            if (route?.inputId === input.id) {
                if (route.sourceId !== input.source || route.generation !== input.generation || JSON.stringify(route.context) !== JSON.stringify(m))
                    invalid();
                if (Object.hasOwn(route, 'comparison'))
                    receipts.push(route.comparison);
            }
    }
    if (!receipts.length)
        return undefined;
    if (new Set(receipts.map(value => JSON.stringify(value))).size !== 1)
        invalid();
    const comparison = receipts[0] as PreparedContextComparison;
    if (!comparison || comparison.format !== 'gitjig-context-comparison-1' || comparison.phase !== 'prepared' ||
        comparison.inputId !== input.id || comparison.sourceId !== input.source || comparison.runId !== run.id ||
        comparison.generation !== input.generation || comparison.submissionGeneration !== m.submissionGeneration ||
        comparison.inputManifestSha256 !== sha(JSON.stringify(m)) || data.attainedCapture !== true ||
        typeof data.nativeSessionId !== 'string' || !data.nativeSessionId || typeof data.historyRef !== 'string' || !data.historyRef ||
        !Array.isArray(comparison.files) || comparison.files.length !== m.files.length)
        invalid();
    const manifest = validateManifest(data.manifest);
    if (manifest.digest !== comparison.captureDigest)
        invalid();
    const actual = new Map(manifest.files.map(file => [file.path, file]));
    for (const [index, file] of m.files.entries()) {
        const entry = actual.get(file.path), expected = !entry ? 'missing' : entry.sha256 === file.sha256 && entry.size === file.bytes ? 'same' : 'different';
        if (comparison.files[index]?.path !== file.path || comparison.files[index]?.status !== expected)
            invalid();
    }
    return comparison;
}
function displayPath(value: string) {
    // Format controls can change the apparent direction or boundaries of a terminal label.
    const visible = value.replace(/\p{Cf}/gu, char => '\\u{' + char.codePointAt(0)!.toString(16) + '}');
    return JSON.stringify(visible.length > 240 ? visible.slice(0, 240) + '… (shortened)' : visible);
}
/** Only bounded presentation strings leave this synchronous controller read. */
export function inspectContextStatus(store: Store, conversationId: string, generation: number): ConversationContextStatus {
    return store.tx(() => {
        const target = store.one('SELECT generation FROM conversations WHERE id=?', conversationId);
        if (!target || target.generation !== generation)
            throw new Error('Conversation changed during context inspection');
        const rows = ['Captured inputs · recent records; comparison and input handling are separate'];
        let bytes = Buffer.byteLength(rows[0]!), more = false;
        const append = (line: string) => {
            if (bytes + Buffer.byteLength(line) + 1 > 16 * 1024 - 128) {
                more = true;
                return false;
            }
            rows.push(line);
            bytes += Buffer.byteLength(line) + 1;
            return true;
        };
        let inputs: any[];
        try {
            inputs = store.all(`SELECT i.*,s.conversation AS source_conversation,s.raw AS source_raw,s.origin AS source_origin
                FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.conversation=? AND
                (json_type(i.data,'$.context') IS NOT NULL OR json_type(s.origin,'$.context') IS NOT NULL) ORDER BY i.rowid DESC LIMIT 9`, conversationId);
        }
        catch {
            return { rows: [...rows, 'Captured context · unavailable (invalid retained record)'], more: false };
        }
        if (!inputs.length)
            append('Captured inputs · none');
        if (inputs.length > 8)
            more = true;
        for (const [index, input] of inputs.slice(0, 8).entries()) {
            try {
                const m = admittedManifest(store, input);
                if (input.generation > generation)
                    invalid();
                const comparison = m.files.length ? preparedComparison(store, input, m) : undefined;
                if (!append(`Captured input ${index + 1} · ${input.mode} · generation ${input.generation} · ${states[input.state]}`))
                    break;
                if (!m.files.length) {
                    append('Files · none captured');
                    continue;
                }
                append(comparison ? 'Comparison · prepared against recorded execution capture' : 'Comparison · not prepared');
                for (const file of m.files)
                    if (!append(`File · ${displayPath(file.path)} · ${comparison?.files.find(item => item.path === file.path)?.status ?? 'not compared'}`))
                        break;
            }
            catch {
                if (!append(`Captured input ${index + 1} · unavailable (invalid retained record)`))
                    break;
            }
        }
        if (more)
            rows.push('Captured context · additional records or file rows omitted');
        return { rows, more };
    });
}
