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
function attemptComparison(run: any, data: any, input: any, m: InputContextManifest, value: unknown, manifestText: string): PreparedContextComparison {
    const comparison = value as PreparedContextComparison;
    if (!comparison || comparison.format !== 'gitjig-context-comparison-1' || comparison.phase !== 'prepared' ||
        comparison.inputId !== input.id || comparison.sourceId !== input.source || comparison.runId !== run.id ||
        comparison.submissionGeneration !== m.submissionGeneration ||
        comparison.inputManifestSha256 !== sha(manifestText) || data.attainedCapture !== true ||
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

const maxAttempts = 8;
const boundInputStates = new Set(['INITIAL_RESERVED', 'NATIVE_PENDING', 'CONSUMED', 'RECONCILIATION_REQUIRED']);

/** A retained input can be prepared in several runs. Each comparison proves only its own capture. */
function preparedComparisons(store: Store, input: any, m: InputContextManifest) {
    const runs = store.all(`SELECT r.id,r.work,r.phase,r.data,w.project AS work_project FROM runs r JOIN works w ON w.id=r.work
        WHERE json_extract(r.data,'$.conversation')=? AND (json_extract(r.data,'$.initialInputId')=? OR
        EXISTS(SELECT 1 FROM json_each(r.data,'$.routedInputs') x WHERE json_extract(x.value,'$.inputId')=?))
        ORDER BY r.rowid DESC LIMIT ?`, input.conversation, input.id, input.id, maxAttempts + 1);
    if (!runs.length && boundInputStates.has(input.state))
        invalid();
    const omitted = runs.length > maxAttempts, manifestText = JSON.stringify(m);
    let previousGeneration = m.submissionGeneration - 1;
    const recent = runs.slice(0, maxAttempts).reverse();
    const attempts = recent.map((run, index) => {
        const latest = index === recent.length - 1;
        if (run.work_project !== m.projectId || run.work !== recent[0]!.work || (input.work !== null && input.work !== run.work) ||
            (!latest && !['SETTLED', 'INTERRUPTED'].includes(run.phase)))
            invalid();
        const data = JSON.parse(run.data), initial = data.initialInputId === input.id;
        if (Object.hasOwn(data, 'routedInputs') && !Array.isArray(data.routedInputs))
            invalid();
        const routes = data.routedInputs?.filter((route: any) => route?.inputId === input.id) ?? [];
        if (initial ? routes.length !== 0 : routes.length !== 1)
            invalid();
        const route = routes[0];
        if (initial) {
            if ((runs.length > 1 || Object.hasOwn(data, 'inputContext')) && JSON.stringify(data.inputContext) !== manifestText ||
                Object.hasOwn(data, 'raw') && data.raw !== input.text)
                invalid();
        }
        else if (route.sourceId !== input.source || JSON.stringify(route.context) !== manifestText)
            invalid();
        const carrier = initial ? data : route, field = initial ? 'initialInputComparison' : 'comparison';
        const comparison = Object.hasOwn(carrier, field) ? attemptComparison(run, data, input, m, carrier[field], manifestText) : undefined;
        const generation = initial ? comparison?.generation : route.generation;
        if (!initial && comparison && comparison.generation !== generation)
            invalid();
        if (!initial || comparison) {
            if (!Number.isSafeInteger(generation) || generation < 1 || generation > input.generation ||
                generation <= previousGeneration || latest && boundInputStates.has(input.state) && generation !== input.generation)
                invalid();
            previousGeneration = generation;
        }
        return comparison;
    });
    return { attempts, omitted };
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
                const { attempts, omitted } = m.files.length ? preparedComparisons(store, input, m) : { attempts: [], omitted: false };
                if (!append(`Captured input ${index + 1} · ${input.mode} · generation ${input.generation} · ${states[input.state]}`))
                    break;
                if (!m.files.length) {
                    append('Files · none captured');
                    continue;
                }
                if (omitted)
                    more = true;
                const multiple = attempts.length > 1;
                for (const [index, comparison] of (attempts.length ? attempts : [undefined]).entries()) {
                    const attempt = multiple ? `${omitted ? 'Recent attempt' : 'Attempt'} ${index + 1} · ` : '';
                    const heading = attempt ? attempt + 'comparison' : 'Comparison';
                    if (!append(heading + (comparison ? ' · prepared against recorded execution capture' : ' · not prepared')))
                        break;
                    if (comparison || !multiple)
                        for (const [fileIndex, file] of m.files.entries())
                            if (!append(`${attempt}File · ${displayPath(file.path)} · ${comparison?.files[fileIndex]?.status ?? 'not compared'}`))
                                break;
                }
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
