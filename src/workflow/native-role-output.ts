import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { freezeStructuredOutput, type StructuredOutputIntent } from '../pi/structured-output.js';
import { providerUsageLimit, validProviderReset, type ProviderUsageLimit } from './provider-failure.js';

export const nativeRoleEntries = Object.freeze({ intent: 'gitjig.native-role-intent/v1', sdk: 'gitjig.native-role-sdk/v1',
    settlement: 'gitjig.native-role-settlement/v1', material: 'gitjig.native-role-material/v1', final: 'gitjig.native-role-final/v1' });
export interface NativeRoleSource {
    kind: 'claude-sdk-formatter/v1';
    sessionId: string;
    intentEntryId: string;
    resultEntryId: string;
    settlementEntryId: string;
    argumentEntryId: string;
    assistantEntryId: string;
    carrierEntryId: string;
    queryId: string;
    nativeSessionId: string;
    rawDigest: string;
    stage: string;
    inputDigest: string;
    schemaDigest: string;
    requestDigest: string;
}
/** Captured by the controller before the original provider dispatch, independently
 * of final output metadata and retained provider records. */
export interface NativeRoleIntentReceipt {
    version: 1;
    launchId: string;
    role: string;
    stage: string;
    inputDigest: string;
    schemaDigest: string;
    requestDigest: string;
    maxNativeTurns: number;
}
export function nativeRoleIntentReceipt(intent: StructuredOutputIntent): Readonly<NativeRoleIntentReceipt> {
    return Object.freeze({version:1,launchId:intent.binding.launchId!,role:intent.binding.role!,stage:intent.binding.stage!,
        inputDigest:intent.binding.inputDigest!,schemaDigest:digest(intent.schema),requestDigest:digest(intent),maxNativeTurns:intent.maxNativeTurns});
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textDigest = (value: string) => createHash('sha256').update(value).digest('hex');
function unavailable(detail: string): never { throw Error('NATIVE_FORMAT_SOURCE_UNAVAILABLE: ' + detail); }
const object = (value: any) => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: any) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 200;
type Entry = { id: string; parentId?: string | null; type: string; customType?: string; data?: any; message?: any };
const custom = (entry: Entry | undefined, kind: string): entry is Entry & { data: any } => entry?.type === 'custom' && entry.customType === kind && object(entry.data);
const retractedNativeMessages = (sdk: Entry[]) => new Set(sdk.flatMap(e => [
    ...(Array.isArray(e.data.message?.supersedes) ? e.data.message.supersedes : []),
    ...(Array.isArray(e.data.message?.retracted_message_uuids) ? e.data.message.retracted_message_uuids : []),
]));

/** A namespaced source record is never an SDK message or an assistant answer. */
export class NativeRoleCollector {
    readonly intentEntryId: string;
    readonly intent: StructuredOutputIntent;
    private sequence = 0;
    private bytes = 0;
    private finalized = false;
    constructor(readonly manager: SessionManager, intent: StructuredOutputIntent) {
        this.intent = freezeStructuredOutput(intent);
        this.intentEntryId = manager.appendCustomEntry(nativeRoleEntries.intent, { sessionId: manager.getSessionId(), request: this.intent });
    }
    observe(data: unknown): void {
        if (this.finalized) unavailable('producer evidence collector already closed');
        if (!object(data)) unavailable('non-object provider event');
        const message: any = structuredClone(data), size = Buffer.byteLength(JSON.stringify(message));
        if (size > 2 * 1024 * 1024 || this.bytes + size > 8 * 1024 * 1024) unavailable('original provider evidence exceeds declared bounds');
        this.bytes += size;
        if (message.type === 'gitjig.native-query-settled/v1')
            this.manager.appendCustomEntry(nativeRoleEntries.settlement, { intentEntryId: this.intentEntryId, attestation: message });
        else {
            if (!nonempty(message.type)) unavailable('provider event type absent');
            this.manager.appendCustomEntry(nativeRoleEntries.sdk, { intentEntryId: this.intentEntryId, sequence: ++this.sequence, message });
        }
    }
    /** Retain raw findings on error/cancel as well as successful completion. */
    materialize(): void {
        if (this.finalized) return;
        this.finalized = true;
        const entries = this.manager.getBranch() as Entry[];
        const issues: string[] = [];
        const materials = nativeRoleMaterial(entries, this.intentEntryId, (_id, reason) => { if (issues.length < 64) issues.push(reason); });
        for (const material of materials)
            this.manager.appendCustomEntry(nativeRoleEntries.material, { intentEntryId: this.intentEntryId, ...material });
        if (issues.length) unavailable('original material extraction: ' + issues.join('; '));
    }
    select(): { entryId: string; raw: string; source: NativeRoleSource } {
        this.materialize();
        const entries = this.manager.getBranch() as Entry[];
        const source = proveNativeRoleSource(entries, this.intentEntryId);
        const entryId = this.manager.appendCustomEntry(nativeRoleEntries.final, source);
        const raw = readNativeRoleOutput(this.manager.getBranch() as Entry[], entryId, {
            sessionId: this.manager.getSessionId(), launchId: this.intent.binding.launchId!, role: this.intent.binding.role!, checkpointLeafId: entryId,
        }, source);
        return { entryId, raw, source };
    }
    /** Original closed-query display facts, independent of successful formatter output. */
    usageLimit(): ProviderUsageLimit | undefined {
        if (!this.finalized) return;
        const entries = this.manager.getBranch() as Entry[];
        const original = entries.find(e => e.id === this.intentEntryId);
        if (!custom(original, nativeRoleEntries.intent) || original.data.sessionId !== this.manager.getSessionId() ||
            !isDeepStrictEqual(original.data.request, this.intent)) return;
        const sdk = entries.filter(e => custom(e, nativeRoleEntries.sdk) && e.data.intentEntryId === this.intentEntryId);
        const settlements = entries.filter(e => custom(e, nativeRoleEntries.settlement) && e.data.intentEntryId === this.intentEntryId);
        if (settlements.length !== 1) return;
        const a = settlements[0]!.data.attestation;
        if (a?.nativeCleanup !== 'confirmed' || a.ownerSessionId !== this.manager.getSessionId() ||
            !isDeepStrictEqual(a.format?.request, this.intent)) return;
        const initial = sdk.filter(e => e.data.message?.type === 'system' && e.data.message.subtype === 'init');
        const results = sdk.filter(e => e.data.message?.type === 'result');
        const retracted = retractedNativeMessages(sdk);
        if (initial.length !== 1 || initial[0]!.data.message.session_id !== a.nativeSessionId || results.length !== 1 ||
            results[0]!.data.message.session_id !== a.nativeSessionId || results[0]!.data.message.is_error !== true ||
            retracted.has(initial[0]!.data.message.uuid) || retracted.has(results[0]!.data.message.uuid) ||
            entries.findIndex(e => e.id === this.intentEntryId) >= entries.indexOf(initial[0]!) ||
            entries.indexOf(results[0]!) >= entries.indexOf(settlements[0]!)) return;
        const rejectedWindows = new Map<unknown, Entry>();
        const identities = new Set<string>();
        for (const entry of sdk) {
            const message = entry.data.message;
            if (message?.type !== 'rate_limit_event') continue;
            if (message.session_id !== a.nativeSessionId || !nonempty(message.uuid) || identities.has(message.uuid)) return;
            identities.add(message.uuid);
            if (retracted.has(message.uuid)) continue;
            if (sdk.indexOf(entry) <= sdk.indexOf(initial[0]!) || sdk.indexOf(entry) >= sdk.indexOf(results[0]!)) return;
            const info = message.rate_limit_info;
            if (info?.status === 'rejected') rejectedWindows.set(info.rateLimitType, entry);
            else if (info?.status === 'allowed' || info?.status === 'allowed_warning') rejectedWindows.delete(info.rateLimitType);
            else return;
        }
        const rejected = sdk.findLast(entry => [...rejectedWindows.values()].includes(entry));
        if (!rejected) return;
        const message = rejected.data.message, info = message.rate_limit_info;
        return providerUsageLimit({ version: 1, kind: 'usage-limit', ownerSessionId: a.ownerSessionId,
            nativeSessionId: a.nativeSessionId, queryId: a.queryId, intentEntryId: this.intentEntryId,
            eventEntryId: rejected.id, eventId: message.uuid,
            ...(typeof info.rateLimitType === 'string' && /^[a-z0-9_]{1,64}$/.test(info.rateLimitType) ? { window: info.rateLimitType } : {}),
            ...(validProviderReset(info.resetsAt) ? { resetsAt: info.resetsAt } : {}) });
    }
}
interface Material {
    sourceEntryId: string; selector: string; raw: string; nativeMessageId?: string; toolUseId?: string;
    nativeSessionId?: string; parentToolUseId?: string | null; frames?: string[]; complete?: boolean; invalid?: boolean;
}
export const unownedNativeSelector = (selector: string) => ['unowned-input-json-delta', 'unowned-text-delta', 'unowned-text-start'].includes(selector);
/** Original text/arguments are separate claim sources. Transport copies are
 * recognized by native message/block/tool identity and complete correspondence,
 * never merely by equal findings or text from distinct original messages. */
export function nativeRoleMaterial(entries: Entry[], intentEntryId: string, onIssue: (entryId: string, reason: string) => void = () => {}, onPrefixConflict: (sourceEntryId: string | null) => void = () => {}): Material[] {
    type Stream = {nativeMessageId: string; start: string; blocks: Map<number, Material>; started: Set<number>; ended: Set<number>; stopped: boolean; invalid: boolean};
    const materials: Material[] = [], contexts = new Map<string, Stream>(), streams: Stream[] = [], seen = new Map<string, any>();
    const sdkTexts = new Map<string, Material[]>();
    const typedInputs: Array<{material: Material; value: any}> = [];
    for (const entry of entries) {
        if (!custom(entry, nativeRoleEntries.sdk) || entry.data.intentEntryId !== intentEntryId) continue;
        try {
        const m = entry.data.message;
        if (m?.type !== 'stream_event' && nonempty(m?.uuid)) {
            const key = m.type + ':' + m.uuid, prior = seen.get(key);
            if (prior && isDeepStrictEqual(prior, m)) continue;
            if (prior) onIssue(entry.id, 'conflicting original SDK message identity');
            // Preserve both original claims without allowing conflicting source selection.
            seen.set(key, m);
        }
        const identity = {nativeSessionId: m?.session_id, parentToolUseId: m?.parent_tool_use_id ?? null};
        if (m?.type === 'assistant') {
            for (const [index, block] of (Array.isArray(m.message?.content) ? m.message.content : []).entries()) {
                if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
                    const material: Material = {sourceEntryId:entry.id,selector:'assistant-text:'+index,raw:block.text,nativeMessageId:m.message.id,...identity};
                    materials.push(material);
                    const key = JSON.stringify([identity.nativeSessionId, identity.parentToolUseId, m.message.id]);
                    sdkTexts.set(key, [...sdkTexts.get(key) ?? [], material]);
                }
                if (block?.type === 'tool_use' && block.name === 'StructuredOutput' && object(block.input)) {
                    const material: Material = {sourceEntryId:entry.id,selector:'decoded-formatter-input:'+index,raw:JSON.stringify(block.input),nativeMessageId:m.message.id,toolUseId:block.id,...identity};
                    materials.push(material); typedInputs.push({material,value:block.input});
                }
            }
        }
        if (m?.type === 'result') {
            if (typeof m.result === 'string' && m.result) materials.push({sourceEntryId:entry.id,selector:'result-text',raw:m.result,...identity});
            if (object(m.structured_output)) materials.push({sourceEntryId:entry.id,selector:'decoded-result-value',raw:JSON.stringify(m.structured_output),...identity});
        }
        if (m?.type !== 'stream_event') continue;
        const event = m.event, parent = JSON.stringify([identity.nativeSessionId, identity.parentToolUseId]);
        if (event?.type === 'message_start') {
            const stream: Stream = {nativeMessageId:event.message?.id ?? '',start:entry.id,blocks:new Map(),started:new Set(),ended:new Set(),stopped:false,invalid:false};
            const prior = contexts.get(parent);
            if (prior && !prior.stopped) { prior.invalid = true; for (const material of prior.blocks.values()) { material.invalid = true; onPrefixConflict(material.sourceEntryId); } }
            contexts.set(parent,stream); streams.push(stream);
        }
        const stream = contexts.get(parent);
        const publicDelta = event?.type === 'content_block_delta' &&
            (event.delta?.type === 'input_json_delta' || event.delta?.type === 'text_delta');
        // Unowned public bytes cannot prove a later prefix complete. Track starts
        // even for non-material blocks without inspecting their private content.
        const validIndex = Number.isSafeInteger(event?.index) && event.index >= 0;
        if (publicDelta && (!validIndex || !stream || !stream.started.has(event.index))) {
            onPrefixConflict(null);
            const raw = event.delta.type === 'input_json_delta' ? event.delta.partial_json : event.delta.text;
            if (typeof raw !== 'string') onIssue(entry.id, 'invalid unowned public native delta');
            else materials.push({sourceEntryId:entry.id,selector:event.delta.type === 'input_json_delta' ? 'unowned-input-json-delta' : 'unowned-text-delta',
                raw,...identity,frames:[entry.id],complete:false,invalid:true});
        }
        if (!stream && event?.type === 'content_block_start' && event.content_block?.type === 'text') {
            if (typeof event.content_block.text !== 'string') onIssue(entry.id, 'invalid unowned public native text');
            else materials.push({sourceEntryId:entry.id,selector:'unowned-text-start',raw:event.content_block.text,...identity,frames:[entry.id],complete:false,invalid:true});
        }
        if (!stream) continue;
        const repeatedStart = event?.type === 'content_block_start' && stream.started.has(event.index);
        if (event?.type === 'content_block_start') {
            if (validIndex) stream.started.add(event.index);
            else onPrefixConflict(null);
            if (repeatedStart) onPrefixConflict(null);
        }
        if (event?.type === 'content_block_start' && (event.content_block?.type === 'text' || event.content_block?.type === 'tool_use' && event.content_block.name === 'StructuredOutput')) {
            const formatter = event.content_block.type === 'tool_use';
            if (!formatter && typeof event.content_block.text !== 'string') { onIssue(entry.id, 'invalid original native text'); stream.invalid = true; }
            const material: Material = {sourceEntryId:entry.id,selector:formatter?'formatter-arguments':'stream-text',nativeMessageId:stream.nativeMessageId,...identity,
                ...(formatter ? {toolUseId:event.content_block.id} : {}),raw:formatter?'':typeof event.content_block.text === 'string'?event.content_block.text:'',frames:[stream.start,entry.id],complete:false};
            if (stream.stopped || stream.invalid || stream.blocks.has(event.index)) {
                material.invalid = true; stream.invalid = true;
                for (const previous of stream.blocks.values()) { previous.invalid = true; onPrefixConflict(previous.sourceEntryId); }
                onPrefixConflict(material.sourceEntryId);
            }
            materials.push(material); stream.blocks.set(event.index,material);
        }
        const block = stream.blocks.get(event?.index);
        if (publicDelta && stream.ended.has(event.index)) onPrefixConflict(block?.sourceEntryId ?? null);
        if (event?.type === 'content_block_stop') {
            if (!validIndex || !stream.started.has(event.index) || stream.ended.has(event.index)) onPrefixConflict(null);
            if (validIndex) stream.ended.add(event.index);
        }
        if (stream.stopped) {
            stream.invalid = true;
            for (const material of stream.blocks.values()) { material.invalid = true; onPrefixConflict(material.sourceEntryId); }
            if (block) block.invalid = true;
        }
        if (block && event.type === 'content_block_delta') {
            const part = block.selector === 'formatter-arguments' && event.delta?.type === 'input_json_delta' ? event.delta.partial_json :
                block.selector === 'stream-text' && event.delta?.type === 'text_delta' ? event.delta.text : undefined;
            if (typeof part === 'string') { block.raw += part; block.frames!.push(entry.id); }
            else { onIssue(entry.id, 'invalid original native delta'); block.invalid = true; block.frames!.push(entry.id); }
        }
        if (block && event.type === 'content_block_stop') { block.complete = true; block.frames!.push(entry.id); }
        if (event?.type === 'message_stop') {
            for (const material of stream.blocks.values()) if (!material.complete) { material.invalid = true; onPrefixConflict(material.sourceEntryId); }
            stream.stopped = true;
        }
        } catch {
            // Producer decoding cannot unwind controller resource settlement.
            // Already decoded material remains available; original envelopes stay retained.
            onIssue(entry.id, 'unreadable original native material');
        }
    }
    for (const stream of streams) if (!stream.stopped || stream.invalid)
        for (const material of stream.blocks.values()) material.invalid = true;
    const aliases = new Set<Material>();
    for (const {material,value} of typedInputs) {
        const arguments_ = materials.filter(m => m.selector === 'formatter-arguments' && m.complete && !m.invalid &&
            m.nativeMessageId === material.nativeMessageId && m.toolUseId === material.toolUseId && m.nativeSessionId === material.nativeSessionId && m.parentToolUseId === material.parentToolUseId);
        if (arguments_.length === 1) {
            try { if (isDeepStrictEqual(JSON.parse(arguments_[0]!.raw),value)) aliases.add(material); } catch { /* Raw bytes remain retained. */ }
        }
    }
    for (const [key,texts] of sdkTexts) {
        const matches = streams.filter(stream => {
            const blocks = [...stream.blocks.values()].filter(m=>m.selector==='stream-text');
            return blocks.length && JSON.stringify([blocks[0]!.nativeSessionId,blocks[0]!.parentToolUseId,stream.nativeMessageId]) === key;
        });
        if (matches.length !== 1 || !matches[0]!.stopped) continue;
        const blocks = [...matches[0]!.blocks.values()].filter(m=>m.selector==='stream-text');
        if (blocks.every(m=>m.complete && !m.invalid) && isDeepStrictEqual(blocks.map(m=>m.raw),texts.map(m=>m.raw)))
            blocks.forEach(m=>aliases.add(m)); // Exact stream/full representations of the same ordered blocks.
    }
    return materials.filter(material=>material.raw && !aliases.has(material));
}
/** Proof of exact received public bytes, never a selected RoleOutput or an
 * inferred message/block. Requires the original settled-query attestation,
 * without requiring a successful terminal RoleOutput. */
export function readUnownedNativeMaterials(entries: Entry[], expected: {sessionId:string; launchId:string; role:string; intent:NativeRoleIntentReceipt}): Material[] {
    const intents = entries.filter(e => custom(e,nativeRoleEntries.intent));
    if (intents.length !== 1) unavailable('ambiguous original dispatch intent');
    const intent = intents[0]!, request = intent.data.request as StructuredOutputIntent;
    if (intent.data.sessionId !== expected.sessionId || !object(request) || request.version !== 1 || request.requestId !== expected.launchId ||
        request.binding?.launchId !== expected.launchId || request.binding?.role !== expected.role || !isDeepStrictEqual(nativeRoleIntentReceipt(request),expected.intent))
        unavailable('unowned material dispatch mismatch');
    const sdk = entries.filter(e => custom(e,nativeRoleEntries.sdk) && e.data.intentEntryId === intent.id);
    const settlements = entries.filter(e => custom(e,nativeRoleEntries.settlement) && e.data.intentEntryId === intent.id);
    if (settlements.length !== 1) unavailable('unowned material original settlement unavailable');
    const settlement = settlements[0]!, a = settlement.data.attestation;
    if (a?.nativeCleanup !== 'confirmed' || !nonempty(a.queryId) || !nonempty(a.nativeSessionId) || a.ownerSessionId !== expected.sessionId ||
        !isDeepStrictEqual(a.format?.request,request) || a.format?.requestDigest !== digest(request) || a.format?.schemaDigest !== digest(request.schema))
        unavailable('unowned material original query mismatch');
    const initial = sdk.filter(e => e.data.message?.type === 'system' && e.data.message.subtype === 'init');
    if (initial.length !== 1 || initial[0]!.data.message.session_id !== a.nativeSessionId) unavailable('unowned material initialization unavailable');
    const hash = createHash('sha256'), positions = new Map(entries.map((entry,index)=>[entry,index]));
    for (const [index,e] of sdk.entries()) {
        if (e.data.sequence !== index + 1 || positions.get(e)! <= positions.get(intent)! || positions.get(e)! >= positions.get(settlement)!)
            unavailable('unowned material trace order mismatch');
        hash.update(JSON.stringify(e.data.message) + '\n');
    }
    if (a.messages !== sdk.length || a.messageDigest !== hash.digest('hex')) unavailable('unowned material settled trace mismatch');
    const issues:string[] = [], materials = nativeRoleMaterial(entries,intent.id,(_id,reason)=>issues.push(reason)).filter(m=>unownedNativeSelector(m.selector));
    if (issues.length) unavailable('unowned material original bytes unavailable or conflicting');
    const byId = new Map<string,Entry[]>();
    for (const entry of sdk) byId.set(entry.id,[...(byId.get(entry.id) ?? []),entry]);
    for (const material of materials) {
        const source = byId.get(material.sourceEntryId);
        if (source?.length !== 1 || source[0]!.data.message?.session_id !== a.nativeSessionId) unavailable('unowned material original entry/session mismatch');
    }
    return materials;
}
export function readUnownedNativeMaterial(entries: Entry[], expected: {sessionId:string; launchId:string; role:string; intent:NativeRoleIntentReceipt}, entryId:string, selector:string): Material {
    if (!unownedNativeSelector(selector)) unavailable('unsupported unowned selector');
    const matches = readUnownedNativeMaterials(entries,expected).filter(m=>m.sourceEntryId===entryId && m.selector===selector);
    if (matches.length !== 1) unavailable('unowned material original bytes unavailable or conflicting');
    return matches[0]!;
}
function proveNativeRoleSource(entries: Entry[], intentEntryId: string): NativeRoleSource {
    const intent = entries.find(e => e.id === intentEntryId);
    if (!custom(intent, nativeRoleEntries.intent)) unavailable('original intent missing');
    const sdk = entries.filter(e => custom(e, nativeRoleEntries.sdk) && e.data.intentEntryId === intentEntryId);
    const terminals = sdk.filter(e => e.data.message?.type === 'result');
    const settlements = entries.filter(e => custom(e, nativeRoleEntries.settlement) && e.data.intentEntryId === intentEntryId);
    if (terminals.length !== 1 || settlements.length !== 1) unavailable('missing or ambiguous original terminal/settlement');
    const terminal = terminals[0]!, result = terminal.data.message, settlement = settlements[0]!, a = settlement.data.attestation;
    const request = intent.data.request as StructuredOutputIntent;
    if (request?.version !== 1 || !nonempty(request.requestId) || !object(request.binding) || !nonempty(request.binding.launchId) ||
        request.requestId !== request.binding.launchId || !nonempty(request.binding.role) || !nonempty(request.binding.stage) ||
        !/^[a-f0-9]{64}$/.test(request.binding.inputDigest ?? '') || !object(request.schema)) unavailable('original role binding missing');
    if (result.subtype !== 'success' || result.is_error !== false || !nonempty(result.uuid) || !object(result.structured_output) ||
        !Array.isArray(result.permission_denials) || result.permission_denials.length || !Number.isSafeInteger(result.num_turns) || result.num_turns < 0 || result.num_turns > request.maxNativeTurns) unavailable('original SDK terminal is not successful structured output');
    if (a?.type !== 'gitjig.native-query-settled/v1' || a.nativeCleanup !== 'confirmed' || !nonempty(a.queryId) ||
        a.ownerSessionId !== intent.data.sessionId || a.nativeSessionId !== result.session_id ||
        !isDeepStrictEqual(a.format?.request, request) || a.format?.requestDigest !== digest(request) || a.format?.schemaDigest !== digest(request.schema))
        unavailable('original settlement/request/session mismatch');
    const hash = createHash('sha256'), identities = new Map<string, unknown>();
    for (const [index, e] of sdk.entries()) {
        if (e.data.sequence !== index + 1) unavailable('original SDK trace sequence missing/ambiguous');
        const message = e.data.message;
        if (message?.type !== 'stream_event' && nonempty(message?.uuid)) {
            const key = message.type + ':' + message.uuid;
            if (identities.has(key) && !isDeepStrictEqual(identities.get(key), message)) unavailable('conflicting original SDK message identity');
            identities.set(key, message);
        }
        hash.update(JSON.stringify(message) + '\n');
    }
    if (a.messages !== sdk.length || a.messageDigest !== hash.digest('hex')) unavailable('original SDK trace differs from settled producer');
    const initial = sdk.filter(e => e.data.message?.type === 'system' && e.data.message.subtype === 'init');
    if (initial.length !== 1 || initial[0]!.data.message.session_id !== result.session_id) unavailable('original native initialization/session mismatch');
    if (sdk.at(-1) !== terminal || entries.indexOf(settlement) <= entries.indexOf(terminal) || entries.indexOf(initial[0]!) <= entries.indexOf(intent))
        unavailable('original initialization/result/settlement order contradicts completion');
    const materials = entries.filter(e => custom(e, nativeRoleEntries.material) && e.data.intentEntryId === intentEntryId && e.data.selector === 'formatter-arguments' && e.data.complete && !e.data.invalid);
    const retracted = retractedNativeMessages(sdk);
    const position = new Map(sdk.map((e,index)=>[e.id,index]));
    const candidates: NativeRoleSource[] = [];
    for (const argument of materials) {
        const material = argument.data;
        if (!nonempty(material.nativeMessageId) || !nonempty(material.toolUseId) || typeof material.raw !== 'string' ||
            material.nativeSessionId !== result.session_id || material.parentToolUseId != null || !Array.isArray(material.frames) || material.frames.length < 3) continue;
        const framePositions = material.frames.map((id:string)=>position.get(id));
        if (framePositions[0]! <= sdk.indexOf(initial[0]!)) continue;
        if (framePositions.some((at:number|undefined,index:number)=>at===undefined || index>0 && at <= framePositions[index-1]) ||
            material.frames.some((id:string)=>{const m=sdk[position.get(id)!]?.data.message;return m?.type!=='stream_event' || m.session_id!==result.session_id || m.parent_tool_use_id!=null || m.resume_reason;})) continue;
        const originalFrames = material.frames.map((id:string)=>sdk[position.get(id)!]?.data.message.event);
        const start = originalFrames[0], blockStart = originalFrames[1];
        if (start?.type !== 'message_start' || start.message?.id !== material.nativeMessageId || blockStart?.type !== 'content_block_start' ||
            !Number.isSafeInteger(blockStart.index) || blockStart.index < 0 || blockStart.content_block?.type !== 'tool_use' ||
            blockStart.content_block.name !== 'StructuredOutput' || blockStart.content_block.id !== material.toolUseId ||
            originalFrames.at(-1)?.type !== 'content_block_stop' || originalFrames.slice(2).some((event:any)=>event.index!==blockStart.index ||
                !['content_block_delta','content_block_stop'].includes(event.type)) || originalFrames.slice(2,-1).some((event:any)=>event.type!=='content_block_delta' || event.delta?.type!=='input_json_delta')) continue;
        let decoded: unknown;
        // Correspondence only. Strict unique-key/role acceptance happens later.
        try { decoded = JSON.parse(material.raw); } catch { continue; }
        if (!isDeepStrictEqual(decoded, result.structured_output)) continue;
        const assistants = sdk.filter(e => e.data.message?.type === 'assistant' && e.data.message.parent_tool_use_id == null && e.data.message.session_id === result.session_id && !e.data.message.resume_reason && e.data.message.message?.id === material.nativeMessageId &&
            Array.isArray(e.data.message.message.content) && e.data.message.message.content.some((b: any) => b.type === 'tool_use' && b.name === 'StructuredOutput' && b.id === material.toolUseId && isDeepStrictEqual(b.input, decoded)));
        const carriers = sdk.filter(e => e.data.message?.type === 'user' && e.data.message.parent_tool_use_id == null && e.data.message.session_id === result.session_id && !e.data.message.isReplay &&
            Array.isArray(e.data.message.message?.content) && e.data.message.message.content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === material.toolUseId && (b.is_error === undefined || b.is_error === false)));
        if (assistants.length !== 1 || carriers.length !== 1 || retracted.has(assistants[0]?.data.message.uuid) || retracted.has(carriers[0]?.data.message.uuid) || sdk.indexOf(assistants[0]!) >= sdk.indexOf(carriers[0]!) || sdk.indexOf(carriers[0]!) >= sdk.indexOf(terminal)) continue;
        // Completed block may precede the forwarded block-stop event; all
        // original argument deltas must precede it, and stop precedes carrier.
        const deltas = material.frames.map((id:string)=>sdk[position.get(id)!]).filter((e:Entry)=>e.data.message.event?.type==='content_block_delta');
        if (!deltas.length || deltas.some((e:Entry)=>position.get(e.id)! >= position.get(assistants[0]!.id)!) ||
            framePositions.at(-1)! >= position.get(carriers[0]!.id)!) continue;
        const cohort = sdk.filter(e => e.data.message?.type === 'assistant' && e.data.message.message?.id === material.nativeMessageId);
        if (cohort.some(e => e.data.message.aborted || e.data.message.error || retracted.has(e.data.message.uuid) || !Array.isArray(e.data.message.message.content) || e.data.message.message.content.some((b: any) => b.type === 'tool_use' && (b.name !== 'StructuredOutput' || b.id !== material.toolUseId)))) continue;
        if (assistants[0]!.data.message.aborted || assistants[0]!.data.message.error) continue;
        candidates.push({kind:'claude-sdk-formatter/v1',sessionId:intent.data.sessionId,intentEntryId,resultEntryId:terminal.id,settlementEntryId:settlement.id,
            argumentEntryId:argument.id,assistantEntryId:assistants[0]!.id,carrierEntryId:carriers[0]!.id,queryId:a.queryId,nativeSessionId:a.nativeSessionId,rawDigest:textDigest(material.raw),stage:request.binding.stage!,inputDigest:request.binding.inputDigest!,schemaDigest:digest(request.schema),requestDigest:digest(request)});
    }
    if (candidates.length !== 1) unavailable('missing or ambiguous complete original formatter arguments/assistant/carrier');
    return candidates[0]!;
}
/** Kept-branch correspondence is required even when the source bytes are invalid
 * RoleOutput. This function never grants protocol validity or standing. */
export function readNativeRoleOutput(entries: Entry[], entryId: string, expected: {sessionId: string; launchId: string; role: string; checkpointLeafId: string; stage?: string; inputDigest?: string; schemaDigest?: string; requestDigest?: string}, source?: NativeRoleSource): string {
    const byId = new Map(entries.filter(e => e.type !== 'session').map(e => [e.id,e]));
    if (byId.size !== entries.filter(e => e.type !== 'session').length || expected.checkpointLeafId !== entryId) unavailable('ambiguous selected kept checkpoint');
    const kept: Entry[] = [], visited = new Set<string>();
    let cursor: string | null | undefined = entryId;
    while (cursor) {
        if (visited.has(cursor)) unavailable('cyclic original branch');
        visited.add(cursor);
        const e = byId.get(cursor); if (!e) unavailable('original kept branch entry missing');
        kept.unshift(e); cursor = e.parentId;
    }
    const final = kept.at(-1);
    if (!custom(final, nativeRoleEntries.final) || source && !isDeepStrictEqual(source, final.data)) unavailable('selected source proof differs');
    const proof = final.data as NativeRoleSource, intent = byId.get(proof.intentEntryId);
    if (!custom(intent, nativeRoleEntries.intent) || intent.data.sessionId !== expected.sessionId || intent.data.request?.requestId !== expected.launchId ||
        intent.data.request?.binding?.launchId !== expected.launchId || intent.data.request?.binding?.role !== expected.role) unavailable('selected role/session/intent mismatch');
    for (const key of ['stage','inputDigest','schemaDigest','requestDigest'] as const)
        if (expected[key] !== undefined && proof[key] !== expected[key]) unavailable('selected original '+key+' changed');
    const recomputed = proveNativeRoleSource(kept, proof.intentEntryId);
    if (!isDeepStrictEqual(proof,recomputed)) unavailable('original result provenance changed');
    const material = kept.find(e => e.id === proof.argumentEntryId)!;
    const original = nativeRoleMaterial(kept, proof.intentEntryId).find(m => m.selector === 'formatter-arguments' && m.sourceEntryId === material.data.sourceEntryId);
    if (!original || !isDeepStrictEqual(original, Object.fromEntries(Object.entries(material.data).filter(([key]) => key !== 'intentEntryId')))) unavailable('original formatter bytes/frames changed');
    return original.raw;
}
