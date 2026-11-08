import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseUniqueJson} from './json.js';
import type {NativeRoleEntry, NativeRoleMaterial, SettledNativeRole, NativeRoleSourceBinding} from './native-role-output.js';

/** Explicit source proof; a provisional receipt never grants procedure standing. */
import {roleSubmissionToolName} from '../pi/structured-output.js';
export {roleSubmissionToolName} from '../pi/structured-output.js';
export const nativeSubmissionToolName = 'mcp__custom-tools__' + roleSubmissionToolName;
export interface NativeSubmissionSource extends NativeRoleSourceBinding {
    kind: 'claude-sdk-tool-submission/v1';
    argumentEntryId: string;
    acknowledgementEntryId: string;
    toolUseId: string;
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const digest = (value: unknown) => sha(JSON.stringify(value));
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 200;
function unavailable(reason: string): never { throw Error('NATIVE_FORMAT_SOURCE_UNAVAILABLE: submission ' + reason); }
function submissionReceipt(raw: string, request: unknown) {
    return {kind:'gitjig.role-submission/v1',rawSha256:sha(raw),requestDigest:digest(request),provisional:true} as const;
}
const submissionNextAction = 'Finish this query now with a brief plain final response and no further tool calls.';
/** This receipt is provisional. Only original query settlement can select its source. */
export function nativeSubmissionReceipt(raw: string, request: unknown): string {
    return JSON.stringify({...submissionReceipt(raw,request),nextAction:submissionNextAction});
}
export function assertNoSubmissionIssues(issues: readonly string[]): void {
    if (issues.length) throw Error('Role result rejected: ' + issues.slice(0,8).map(issue=>issue.slice(0,2048)).join('; '));
}
/** Codec only: no semantic RoleOutput approval, finding waiver or tool authority. */
export function proveNativeSubmissionSource(entries: NativeRoleEntry[], original: SettledNativeRole, materials: NativeRoleMaterial[]): NativeSubmissionSource {
    const {intent,request,sdk,terminal,result,settlement,a,initial} = original;
    if (request.version !== 3 || request.carrier !== 'tool-submission/v1' ||
        Object.keys(request).sort().join(',') !== 'binding,carrier,maxNativeTurns,requestId,schema,version' ||
        !Number.isSafeInteger(request.maxNativeTurns) || request.maxNativeTurns < 1 || request.maxNativeTurns > 100 ||
        Buffer.byteLength(JSON.stringify(request)) > 256 * 1024 || result.num_turns < 1 ||
        Object.hasOwn(result,'structured_output') || result.parent_tool_use_id != null || result.resume_reason || result.aborted || result.error ||
        result.terminal_reason !== undefined && result.terminal_reason !== 'completed') unavailable('request/terminal mismatch');
    const positions = new Map(entries.map((entry,index)=>[entry.id,index]));
    const root = (message: any) => message.session_id === a.nativeSessionId && message.parent_tool_use_id == null;
    const clean = (message: any) => root(message) && !message.resume_reason && !message.aborted && !message.error;
    if (!nonempty(initial.data.message.uuid) || !clean(initial.data.message) || !clean(result)) unavailable('initial/terminal identity');
    const inputs = entries.filter(entry=>entry.type === 'message' && entry.message?.role === 'user');
    if (inputs.length !== 1 || positions.get(inputs[0]!.id)! >= positions.get(initial.id)!) unavailable('fresh original input unavailable');
    const content = inputs[0]!.message.content;
    if (typeof content !== 'string' && (!Array.isArray(content) || content.some((block:any)=>block?.type !== 'text' || typeof block.text !== 'string')))
        unavailable('original input is not text-only');
    const input = typeof content === 'string' ? content : content.map((block:any)=>block.text).join('');
    if (Buffer.byteLength(input) > 2 * 1024 * 1024 || sha(input) !== request.binding.inputDigest) unavailable('original input changed');
    const init = initial.data.message;
    if (!Array.isArray(init.tools) || init.tools.filter((name:unknown)=>name === nativeSubmissionToolName).length !== 1 ||
        !Array.isArray(init.mcp_servers) || init.mcp_servers.filter((server:any)=>server?.name === 'custom-tools' && server.status === 'connected').length !== 1)
        unavailable('original served tool initialization');
    const ids = new Set<string>(), sdkById = new Map<string, NativeRoleEntry>();
    for (const entry of sdk) {
        if (!sdkById.has(entry.id)) sdkById.set(entry.id, entry);
        const message = entry.data.message;
        if (nonempty(message.uuid)) {if (ids.has(message.uuid)) unavailable('ambiguous envelope identity');ids.add(message.uuid);}
        if (message.supersedes?.length || message.retracted_message_uuids?.length) unavailable('retracted query');
    }
    // Check whole root message cohorts, including opaque non-answer blocks, without reading their content.
    let active: string | null = null;const messageIds = new Set<string>();let opened = new Set<number>(), closed = new Set<number>();
    const stops = new Map<string,number>();
    for (const entry of sdk) {
        const message = entry.data.message;
        if (message.type !== 'stream_event') continue;
        if (!nonempty(message.uuid) || !clean(message)) unavailable('stream identity');
        const event = message.event;
        if (event?.type === 'message_start') {
            if (active !== null || !nonempty(event.message?.id) || messageIds.has(event.message.id) || event.message.role !== 'assistant' ||
                !Array.isArray(event.message.content) || event.message.content.length) unavailable('owning message start');
            active = event.message.id;messageIds.add(event.message.id);opened = new Set();closed = new Set();
        } else if (event?.type === 'ping') continue;
        else if (active === null) unavailable('unowned stream event');
        if (['content_block_start','content_block_delta','content_block_stop'].includes(event?.type)) {
            if (!Number.isSafeInteger(event.index) || event.index < 0) unavailable('block index');
            if (event.type === 'content_block_start') {
                if (opened.has(event.index) || !['tool_use','text','thinking','redacted_thinking'].includes(event.content_block?.type)) unavailable('block start');
                opened.add(event.index);
            } else if (!opened.has(event.index) || closed.has(event.index)) unavailable('block order');
            if (event.type === 'content_block_stop') closed.add(event.index);
        }
        if (event?.type === 'message_stop') {
            if (opened.size !== closed.size || active === null) unavailable('open message blocks');
            stops.set(active,positions.get(entry.id)!);active = null;
        }
    }
    if (active !== null) unavailable('unfinished message');
    const retained = entries.filter(entry=>entry.type === 'custom' && entry.customType === 'gitjig.native-role-material/v1' && entry.data.intentEntryId === intent.id);
    if (!isDeepStrictEqual(retained.map(entry=>Object.fromEntries(Object.entries(entry.data).filter(([key])=>key !== 'intentEntryId'))),materials))
        unavailable('received material roster changed');
    if (materials.some(material=>material.selector.startsWith('decoded-submission-input:')))
        unavailable('decoded submission has no exact original raw counterpart');
    const calls = materials.filter(material=>material.selector === 'submission-arguments');
    if (!calls.length || calls.some(material=>!material.complete || material.invalid || material.nativeSessionId !== a.nativeSessionId || material.parentToolUseId != null))
        unavailable('complete original arguments unavailable');
    const callIds = new Set<string>(), accepted: Array<{material:NativeRoleMaterial; assistant:NativeRoleEntry; acknowledgement:NativeRoleEntry}> = [];
    for (const material of calls) {
        if (!nonempty(material.toolUseId) || callIds.has(material.toolUseId) || !nonempty(material.nativeMessageId) || !material.frames?.length ||
            Buffer.byteLength(material.raw) > 128 * 1024) unavailable('argument identity/bounds');
        callIds.add(material.toolUseId);
        const frames = material.frames.map(id=>sdkById.get(id));
        if (frames.length < 3 || frames.some((entry,index)=>!entry || !clean(entry.data.message) || entry.data.message.type !== 'stream_event' ||
            positions.get(entry.id)! <= positions.get(initial.id)! || positions.get(entry.id)! >= positions.get(terminal.id)! ||
            index > 0 && positions.get(entry.id)! <= positions.get(frames[index-1]!.id)!)) unavailable('argument frames');
        const first = frames[0]!.data.message.event, start = frames[1]!.data.message.event, end = frames.at(-1)!.data.message.event;
        if (first.type !== 'message_start' || first.message?.id !== material.nativeMessageId || start.type !== 'content_block_start' ||
            start.content_block?.type !== 'tool_use' || start.content_block.name !== nativeSubmissionToolName || start.content_block.id !== material.toolUseId ||
            end.type !== 'content_block_stop' || start.index !== end.index || frames.slice(2,-1).some(entry=>entry!.data.message.event?.type !== 'content_block_delta' ||
                entry!.data.message.event.index !== start.index || entry!.data.message.event.delta?.type !== 'input_json_delta') ||
            frames.slice(2,-1).map(entry=>entry!.data.message.event.delta.partial_json).join('') !== material.raw) unavailable('argument byte correspondence');
        const assistants = sdk.filter(entry=>entry.data.message.type === 'assistant' && entry.data.message.message?.id === material.nativeMessageId);
        // The SDK can emit separate typed packets for blocks of one message.
        // Every peer must be genuine; only the unique matching tool packet owns
        // this submission. A second copy is ambiguous even when its input agrees.
        if (!assistants.length || !stops.has(material.nativeMessageId) || assistants.some(entry=>
            !clean(entry.data.message) || entry.data.message.message.role !== 'assistant' ||
            !Array.isArray(entry.data.message.message.content))) unavailable('owning assistant/cohort');
        if (assistants.some(entry=>!nonempty(entry.data.message.uuid) ||
            positions.get(entry.id)! <= positions.get(frames[0]!.id)! || positions.get(entry.id)! >= positions.get(terminal.id)!))
            unavailable('owning assistant order/identity');
        const owners = assistants.filter(entry=>entry.data.message.message.content.some((block:any)=>block?.type === 'tool_use' && block.id === material.toolUseId));
        if (owners.length !== 1) unavailable('owning assistant/cohort');
        const assistant = owners[0]!;
        const blocks = assistant.data.message.message.content.filter((block:any)=>block?.type === 'tool_use' && block.id === material.toolUseId);
        if (blocks.length !== 1 || blocks[0].name !== nativeSubmissionToolName) unavailable('decoded tool identity');
        const responses = sdk.flatMap(entry=>Array.isArray(entry.data.message?.message?.content)
            ? entry.data.message.message.content.filter((block:any)=>block?.type === 'tool_result' && block.tool_use_id === material.toolUseId).map((block:any)=>({entry,block})) : []);
        if (responses.length !== 1) unavailable('missing/ambiguous original tool result');
        const {entry:acknowledgement,block} = responses[0]!, message = acknowledgement.data.message;
        const rejected = block.is_error === true;
        const afterArgumentsAndOwner = Math.max(positions.get(frames.at(-1)!.id)!, positions.get(assistant.id)!);
        const receiptPosition = positions.get(acknowledgement.id)!;
        if (message.type !== 'user' || message.message.role !== 'user' || !nonempty(message.uuid) || !clean(message) || Object.hasOwn(block,'is_error') && typeof block.is_error !== 'boolean' ||
            receiptPosition <= afterArgumentsAndOwner || !rejected && receiptPosition <= stops.get(material.nativeMessageId)! ||
            receiptPosition >= positions.get(terminal.id)!) unavailable('tool result origin/order');
        // An early rejection is material only. Selecting a success still
        // requires its receipt to follow the owning message's complete stream.
        if (rejected) continue;
        let decoded: unknown;try {decoded = parseUniqueJson(material.raw);}catch {unavailable('successful arguments are not unique JSON');}
        if (!isDeepStrictEqual(decoded,blocks[0].input)) unavailable('decoded arguments changed');
        const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) && block.content.length === 1 && block.content[0]?.type === 'text' ? block.content[0].text : undefined;
        if (text !== nativeSubmissionReceipt(material.raw,request) && text !== JSON.stringify(submissionReceipt(material.raw,request)))
            unavailable('provisional receipt mismatch');
        accepted.push({material,assistant,acknowledgement});
    }
    if (accepted.length !== 1) unavailable('one successful original submission required');
    const {material,assistant,acknowledgement} = accepted[0]!;
    const projections = entries.filter(entry=>entry.type === 'custom' && entry.customType === 'gitjig.native-role-material/v1' &&
        entry.data.intentEntryId === intent.id && entry.data.selector === material.selector && entry.data.sourceEntryId === material.sourceEntryId);
    if (projections.length !== 1 || !isDeepStrictEqual(material,Object.fromEntries(Object.entries(projections[0]!.data).filter(([key])=>key !== 'intentEntryId'))))
        unavailable('material projection changed');
    return {kind:'claude-sdk-tool-submission/v1',sessionId:intent.data.sessionId,intentEntryId:intent.id,argumentEntryId:projections[0]!.id,
        acknowledgementEntryId:acknowledgement.id,toolUseId:material.toolUseId!,assistantEntryId:assistant.id,resultEntryId:terminal.id,settlementEntryId:settlement.id,
        queryId:a.queryId,nativeSessionId:a.nativeSessionId,rawDigest:sha(material.raw),stage:request.binding.stage!,inputDigest:request.binding.inputDigest!,schemaDigest:digest(request.schema),requestDigest:digest(request)};
}
