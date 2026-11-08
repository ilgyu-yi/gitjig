import {nativeRoleEntries,nativeHistoryByteLimit} from './native-role-records.js';
import {statSync} from 'node:fs';
export {nativeRoleEntries} from './native-role-records.js';
import {NativeTransportWriter,projectNativePackets,expandNativeTransport,nativeCaptureBinding,nativeCaptureFits} from './native-transport.js';
import type {PiHostEnvironment} from '../pi/host.js';
import path from 'node:path';
import {nativeEvidencePolicy,nativeEvidencePolicyId,embeddedEvidencePolicy,nativeEvidenceCharge,acceptNativeEvidenceCharge,nativeEvidenceSessionId,type NativeEvidenceUsage} from './native-evidence-budget.js';
import {nativeSubmissionToolName, nativeSubmissionReceipt, assertNoSubmissionIssues, proveNativeSubmissionSource, type NativeSubmissionSource} from './native-submission-source.js';
import { createHash,randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { freezeStructuredOutput, assertNativeResponseInput, type StructuredOutputIntent } from '../pi/structured-output.js';
import {parseUniqueJson} from './json.js';
import { providerUsageLimit, validProviderReset, type ProviderUsageLimit } from './provider-failure.js';

export interface NativeRoleSourceBinding {
    capture?: {kind:'embedded-envelope/v2';entryId:string;sha256:string};
    sessionId: string;
    intentEntryId: string;
    resultEntryId: string;
    settlementEntryId: string;
    assistantEntryId: string;
    queryId: string;
    nativeSessionId: string;
    rawDigest: string;
    stage: string;
    inputDigest: string;
    schemaDigest: string;
    requestDigest: string;
}
export type NativeRoleSource = NativeRoleSourceBinding & (
    { kind: 'claude-sdk-formatter/v1'; argumentEntryId: string; carrierEntryId: string } |
    { kind: 'claude-sdk-assistant-json/v1'; textEntryId: string } | NativeSubmissionSource
);
/** The material projection is carrier-specific; unknown retained kinds refuse. */
export function nativeRoleSourceMaterialId(source: NativeRoleSource): string {
    if (source.kind === 'claude-sdk-formatter/v1' || source.kind === 'claude-sdk-tool-submission/v1') return source.argumentEntryId;
    if (source.kind === 'claude-sdk-assistant-json/v1') return source.textEntryId;
    return unavailable('unsupported original source kind');
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
    nativeEvidencePolicyId(intent.binding);
    return Object.freeze({version:1,launchId:intent.binding.launchId!,role:intent.binding.role!,stage:intent.binding.stage!,
        inputDigest:intent.binding.inputDigest!,schemaDigest:digest(intent.schema),requestDigest:digest(intent),maxNativeTurns:intent.maxNativeTurns});
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textDigest = (value: string) => createHash('sha256').update(value).digest('hex');
function unavailable(detail: string): never { throw Error('NATIVE_FORMAT_SOURCE_UNAVAILABLE: ' + detail); }
const object = (value: any) => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: any) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 200;
/** Collector-owned quota facts only; never provider content or retry authority. */
const captureQuotaFacts = (budget: 'single-event' | 'provider-evidence' | 'progress-counter', usedBytes: number, nextBytes: number, limitBytes: number, sdkMessagesBefore: number) =>
    JSON.stringify({budget,usedBytes,nextBytes,limitBytes,sdkMessagesBefore});
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
    private transport?:NativeTransportWriter;
    private sealing:Promise<void>|undefined;
    private intakeClosed=false;
    private observations=new Set<Promise<void>>();
    private pendingSubmission:{check:()=>void;reject:(error:Error)=>void}|undefined;
    private readonly stagingName:string|undefined;
    private sequence = 0;
    private evidenceUsage: NativeEvidenceUsage = {normalBytes:0,progressBytes:0};
    private nativeSessionId: string | undefined;
    private finalized = false;
    private submittedToolUseId: string | undefined;
    private stopped = false;
    private retainedStop = false;
    private cleanupRecorded = false;
    private nativeResultObserved=false;
    private sdkDigest = createHash('sha256');
    constructor(readonly manager: SessionManager, intent: StructuredOutputIntent) {
        this.intent = freezeStructuredOutput(intent);
        nativeEvidencePolicyId(this.intent.binding);
        this.stagingName=nativeEvidencePolicyId(this.intent.binding)===embeddedEvidencePolicy.id?`native-capture-${randomUUID()}.deflate`:undefined;
        this.intentEntryId = manager.appendCustomEntry(nativeRoleEntries.intent, { sessionId: manager.getSessionId(), request: this.intent,
            ...(this.stagingName?{capture:{kind:embeddedEvidencePolicy.id,stagingName:this.stagingName}}:{}) });
    }
    static async create(manager:SessionManager,intent:StructuredOutputIntent,host:PiHostEnvironment):Promise<NativeRoleCollector>{
        const embedded=nativeEvidencePolicyId(intent.binding)===embeddedEvidencePolicy.id;
        if(embedded){
            const {assertPiHistoryPath}=await import('../pi/host.js');
            const file=manager.getSessionFile();
            if(!file)unavailable('embedded capture requires owned persisted history');
            await assertPiHistoryPath(host,file);
        }
        const collector=new NativeRoleCollector(manager,intent);
        if(embedded){
            collector.transport=await NativeTransportWriter.open(path.join(path.dirname(manager.getSessionFile()!),collector.stagingName!),{intentEntryId:collector.intentEntryId,sessionId:manager.getSessionId(),requestDigest:createHash('sha256').update(JSON.stringify(collector.intent)).digest('hex')});
            try{
                const id=collector.appendBoundedRecord(nativeRoleEntries.staging,collector.transport.allocation);
                const {readNativeHistorySnapshot}=await import('../controller/history.js');
                const snapshot=await readNativeHistorySnapshot(manager.getSessionFile()!);
                const allocation=snapshot.entries.find(e=>e.type==='custom'&&e.id===id);
                if(allocation?.type!=='custom'||!isDeepStrictEqual(allocation.data,collector.transport.allocation))unavailable('staging allocation was not persisted; original file retained');
            }
            catch(error){
                try{await collector.transport.finish(collector.intentEntryId,manager.getSessionId(),collector.intent);}
                catch(cleanupError){throw new AggregateError([error,cleanupError],'Native staging setup and cleanup failed; original file retained');}
                throw error;
            }
        }
        return collector;
    }
    private entries():Entry[]{return this.transport?projectNativePackets(this.manager.getBranch() as Entry[],this.intentEntryId,this.transport.records.slice(0,this.sequence)):this.manager.getBranch() as Entry[];}
    seal():Promise<void>{
        if(!this.transport)return Promise.resolve();
        return this.sealing??=this.sealOwned();
    }
    private async sealOwned():Promise<void>{
        const transport=this.transport;if(!transport)unavailable('embedded staging owner absent');
        this.intakeClosed=true;
        this.pendingSubmission?.reject(Error('Original submission observation closed'));
        await Promise.allSettled([...this.observations]);
        const capsule=await transport.finish(this.intentEntryId,this.manager.getSessionId(),this.intent);
        const control=(this.manager.getBranch() as Entry[]).findLast(e=>e.type==='custom'&&e.customType===nativeRoleEntries.settlement)?.data;
        capsule.stopped ||= this.stopped||!control||!nativeCaptureFits(capsule,control.attestation);
        const id=this.appendBoundedRecord(nativeRoleEntries.capture,capsule);
        const {readNativeHistorySnapshot}=await import('../controller/history.js');
        const snapshot=await readNativeHistorySnapshot(this.manager.getSessionFile()!);
        const recorded=snapshot.entries.find(e=>e.type==='custom'&&e.id===id);
        if(recorded?.type!=='custom'||!isDeepStrictEqual(recorded.data,capsule))unavailable('capsule was not persisted; staging retained');
        if(!isDeepStrictEqual(expandNativeTransport(snapshot.entries),projectNativePackets(snapshot.entries,this.intentEntryId,transport.records)))
            unavailable('persisted capsule differs from received packets; staging retained');
        await transport.removeStaging();
    }
    private async observeEmbedded(message:Record<string,any>):Promise<void>{
        if(!this.transport)unavailable('embedded capture requires its owned asynchronous factory');
        if(message.type==='gitjig.native-query-settled/v1'){
            if(this.cleanupRecorded||Buffer.byteLength(JSON.stringify(message))>embeddedEvidencePolicy.eventBytes)unavailable('embedded cleanup unavailable');
            if(this.stopped&&this.retainedStop)this.retainStoppedCleanup(message,embeddedEvidencePolicy.eventBytes);
            else this.append(message);
            this.pendingSubmission?.check();return;
        }
        if(this.stopped)unavailable('embedded capture intake stopped');
        const before=this.transport.records.length;
        try{await this.transport.append(this.manager.getLeafId()!,message);}
        catch(error){this.stopped=true;this.retainedStop=this.transport.records.length>before;throw error;}
        finally{
            if(this.transport.records.length>before){this.sequence++;this.sdkDigest.update(JSON.stringify(message)+'\n');this.nativeSessionId=nativeEvidenceSessionId(this.nativeSessionId,message);if(message.type==='result')this.nativeResultObserved=true;}
            if(this.stopped)this.notifySubmission(message);
        }
        this.assertClosedSubmissionCustody(message);
        this.notifySubmission(message);
    }
    observe(data: unknown): void | Promise<void> {
        if (this.finalized||this.intakeClosed) unavailable('producer evidence collector already closed');
        if (!object(data)) unavailable('non-object provider event');
        const message: any = structuredClone(data);
        if(nativeEvidencePolicyId(this.intent.binding)===embeddedEvidencePolicy.id){
            const task=this.observeEmbedded(message);this.observations.add(task);void task.then(()=>this.observations.delete(task),()=>this.observations.delete(task));return task;
        }
        if (this.stopped) {
            // A failed-result cleanup tail can still supply its original control
            // receipt. It is not another SDK packet or a successful role result.
            if (this.retainedStop && !this.cleanupRecorded && message.type === 'gitjig.native-query-settled/v1') {
                this.retainStoppedCleanup(message,nativeEvidencePolicy.eventBytes);
                return;
            }
            unavailable('producer evidence capture already stopped; no further SDK intake admitted');
        }
        const sdkMessagesBefore = this.sequence;
        const charge = nativeEvidenceCharge(message,this.nativeSessionId,this.evidenceUsage), {size,usedBytes,limitBytes} = charge;
        if (charge.budget === 'single-event') {
            this.stopped = true;
            unavailable('original provider evidence exceeds declared bounds: single event exceeds2MiB; captureQuota=' +
                captureQuotaFacts(charge.budget,usedBytes,size,limitBytes,sdkMessagesBefore));
        }
        if (!charge.allowed) {
            this.stopped = true;
            // One reserved supported-size packet prevents losing the event that
            // crossed the aggregate quota. The awaited observer then stops Native.
            this.append(message);
            this.retainedStop = true;
            unavailable('NATIVE_CAPTURE_LIMIT_RETAINED: original provider evidence exceeds declared bounds; captureQuota=' +
                captureQuotaFacts(charge.budget,usedBytes,size,limitBytes,sdkMessagesBefore) +
                '; crossing event retained and capture stopped');
        }
        acceptNativeEvidenceCharge(this.evidenceUsage,charge);
        this.append(message);
        this.assertClosedSubmissionCustody(message);
        this.notifySubmission(message);
    }
    /** A retained original custody fault cannot be repaired by another tool call. */
    private assertClosedSubmissionCustody(message:Record<string,any>):void {
        if(this.intent.version!==3||this.intent.carrier!=='tool-submission/v1'||message.type!=='stream_event'||message.event?.type!=='message_stop')return;
        const {diagnostics}=nativePacketMaterial(this.entries(),this.intentEntryId);
        if(!diagnostics.extraction.count&&!diagnostics.prefix.count)return;
        const error=Error('NATIVE_MATERIAL_CUSTODY_STOPPED: Original response material is incomplete or conflicting; original evidence retained. This query cannot be corrected by resubmission.');
        this.stopped=true;this.retainedStop=true;
        this.pendingSubmission?.reject(error);
        throw error;
    }
    private retainStoppedCleanup(message:Record<string,any>,limit:number):void {
        this.cleanupRecorded=true;
        if(Buffer.byteLength(JSON.stringify(message))>limit)unavailable('original cleanup receipt exceeds declared bounds; receipt unavailable');
        this.append(message);
        if(!this.originalCleanupReceipt(message))unavailable('original cleanup receipt is invalid; original receipt retained without cleanup authority');
    }
    private originalCleanupReceipt(message: any): boolean {
        return message.type === 'gitjig.native-query-settled/v1' && message.nativeCleanup === 'confirmed' &&
            nonempty(message.queryId) && message.ownerSessionId === this.manager.getSessionId() &&
            this.nativeSessionId !== undefined && message.nativeSessionId === this.nativeSessionId &&
            isDeepStrictEqual(message.format?.request, this.intent) && message.format?.requestDigest === digest(this.intent) &&
            message.format?.schemaDigest === digest(this.intent.schema) && message.messages === this.sequence &&
            message.messageDigest === this.sdkDigest.copy().digest('hex');
    }
    private append(message: any): void {
        if(message.type==='result')this.nativeResultObserved=true;
        if (message.type === 'gitjig.native-query-settled/v1') {
            this.manager.appendCustomEntry(nativeRoleEntries.settlement, { intentEntryId: this.intentEntryId, attestation: message });
            this.cleanupRecorded = true;
        } else {
            if (!nonempty(message.type)) unavailable('provider event type absent');
            this.manager.appendCustomEntry(nativeRoleEntries.sdk, { intentEntryId: this.intentEntryId, sequence: ++this.sequence, message });
            this.sdkDigest.update(JSON.stringify(message) + '\n');
            this.nativeSessionId = nativeEvidenceSessionId(this.nativeSessionId,message);
        }
    }
    private notifySubmission(message:Record<string,any>):void {
        if(message.type==='assistant'||message.type==='result'||message.type==='gitjig.native-query-settled/v1'||message.type==='stream_event'&&message.event?.type==='message_stop')this.pendingSubmission?.check();
    }
    /** Native tool RPC and streamed custody can arrive on different SDK channels. */
    async submitObserved(id:string,args:unknown,validate:(raw:string)=>readonly string[],signal:AbortSignal):Promise<string>{
        signal.throwIfAborted();this.assertSubmissionEligible();
        if(this.pendingSubmission)unavailable('another original submission is awaiting source custody');
        await new Promise<void>((resolve,reject)=>{
            const finish=(error?:Error)=>{signal.removeEventListener('abort',aborted);this.pendingSubmission=undefined;error?reject(error):resolve();};
            const aborted=()=>finish(signal.reason instanceof Error?signal.reason:Error('Original submission observation aborted'));
            const check=()=>{
                if(this.stopped||this.cleanupRecorded||this.finalized||this.nativeResultObserved){finish(Error('Original submission source closed before complete custody'));return;}
                const active=new Map<unknown,string>(),closed=new Set<string>(),owners=new Set<string>();
                for(const entry of this.entries()){if(entry.customType!==nativeRoleEntries.sdk)continue;const m=entry.data.message,e=m.type==='stream_event'?m.event:undefined;
                    if(e?.type==='message_start')active.set(m.parent_tool_use_id??null,e.message?.id);
                    if(e?.type==='content_block_start'&&e.content_block?.id===id){const mid=active.get(m.parent_tool_use_id??null);if(mid)owners.add(mid);}
                    if(m.type==='assistant'&&m.message?.content?.some((b:any)=>b.type==='tool_use'&&b.id===id)&&typeof m.message.id==='string')owners.add(m.message.id);
                    if(e?.type==='message_stop'){const mid=active.get(m.parent_tool_use_id??null);if(mid)closed.add(mid);}}
                if([...owners].some(mid=>closed.has(mid)))finish();
            };
            this.pendingSubmission={check,reject:finish};signal.addEventListener('abort',aborted,{once:true});check();if(signal.aborted)aborted();
        });
        signal.throwIfAborted();return this.submit(id,args,validate);
    }
    /** Nonfinal inspection keeps subsequent SDK/tool/error material intake open. */
    private assertSubmissionEligible():void {
        if (this.finalized || this.stopped || this.intent.version !== 3 || this.intent.carrier !== 'tool-submission/v1')
            unavailable('submission requires its active original collector');
        if (this.submittedToolUseId !== undefined)
            throw Error('A role result was already submitted; a second successful submission cannot replace it. Finish this query with a plain final response and no further tool calls.');
    }
    submit(toolUseId: string, args: unknown, validate: (raw: string) => readonly string[]): string {
        this.assertSubmissionEligible();
        const {materials,diagnostics} = nativePacketMaterial(this.entries(),this.intentEntryId);
        const calls = materials.filter(material=>material.selector === 'submission-arguments' && material.toolUseId === toolUseId);
        if (diagnostics.extraction.count || diagnostics.prefix.count || calls.length !== 1 || !calls[0]!.complete || calls[0]!.invalid ||
            calls[0]!.parentToolUseId != null || calls[0]!.nativeSessionId !== this.nativeSessionId || Buffer.byteLength(calls[0]!.raw) > 128 * 1024)
            unavailable('complete original submission arguments unavailable');
        const raw = calls[0]!.raw, original = parseUniqueJson(raw);
        if (!isDeepStrictEqual(original,args)) throw Error('Role result rejected: SDK-normalized arguments differ from the original strict JSON.');
        assertNoSubmissionIssues(validate(raw));
        this.submittedToolUseId = toolUseId;
        return nativeSubmissionReceipt(raw,this.intent);
    }
    private appendBoundedRecord(kind:string,data:unknown):string {
        const file=this.manager.getSessionFile();
        // The pinned public Pi record envelope fits this conservative metadata allowance.
        if(file&&statSync(file).size+Buffer.byteLength(JSON.stringify(data))+1024>nativeHistoryByteLimit)
            unavailable('NATIVE_HISTORY_STORAGE_LIMIT: original evidence retained; record exceeds history capacity');
        return this.manager.appendCustomEntry(kind,data);
    }
    /** Retain raw findings on error/cancel as well as successful completion. */
    materialize(): void {
        if (this.finalized) return;
        this.finalized = true;
        const entries = this.entries();
        const {materials,diagnostics} = nativePacketMaterial(entries, this.intentEntryId);
        const issues = diagnostics.extraction.sample.map(d=>d.reason);
        for (const material of materials)
            this.appendBoundedRecord(nativeRoleEntries.material, { intentEntryId: this.intentEntryId, ...material });
        if (issues.length) unavailable('original material extraction: ' + issues.join('; '));
    }
    select(): { entryId: string; raw: string; source: NativeRoleSource } {
        this.materialize();
        if (this.stopped) unavailable('producer evidence capture stopped; selected output unavailable');
        const entries = this.entries();
        const source = proveNativeRoleSource(entries, this.intentEntryId);
        const entryId = this.appendBoundedRecord(nativeRoleEntries.final, source);
        const raw = readNativeRoleOutput(this.entries(), entryId, {
            sessionId: this.manager.getSessionId(), launchId: this.intent.binding.launchId!, role: this.intent.binding.role!, checkpointLeafId: entryId,
        }, source);
        return { entryId, raw, source };
    }
    /** Shared original failed-query proof for display facts, never output authority. */
    private closedFailure() {
        if (!this.finalized) return;
        const entries = this.entries();
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
        return { sdk, a, initial: initial[0]!, result: results[0]!, retracted };
    }
    /** Original closed-query display facts, independent of successful formatter output. */
    usageLimit(): ProviderUsageLimit | undefined {
        const proof = this.closedFailure();
        if (!proof) return;
        const { sdk, a, initial, result, retracted } = proof;
        const rejectedWindows = new Map<unknown, Entry>();
        const identities = new Set<string>();
        for (const entry of sdk) {
            const message = entry.data.message;
            if (message?.type !== 'rate_limit_event') continue;
            if (message.session_id !== a.nativeSessionId || !nonempty(message.uuid) || identities.has(message.uuid)) return;
            identities.add(message.uuid);
            if (retracted.has(message.uuid)) continue;
            if (sdk.indexOf(entry) <= sdk.indexOf(initial) || sdk.indexOf(entry) >= sdk.indexOf(result)) return;
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
    /** A correlated earlier formatter rejection, not the cause or validity of a final answer. */
    formatterError(): { message: string; toolUseId: string; sourceEntryId: string } | undefined {
        if (this.intent.version !== 1) return;
        const proof = this.closedFailure();
        if (!proof) return;
        const { sdk, a, initial, result, retracted } = proof;
        if (![a.nativeSessionId, a.queryId, this.manager.getSessionId(), initial.data.message.uuid, result.data.message.uuid].every(nonempty) ||
            [initial, result].some(entry => sdk.filter(e => e.data.message?.uuid === entry.data.message.uuid).length !== 1)) return;
        if (a.format.requestDigest !== digest(this.intent) || a.format.schemaDigest !== digest(this.intent.schema) ||
            a.messages !== sdk.length || a.messageDigest !== textDigest(sdk.map(e => JSON.stringify(e.data.message) + '\n').join(''))) return;
        const window = sdk.slice(sdk.indexOf(initial) + 1, sdk.indexOf(result));
        const topLevel = (entry: Entry, type: string) => {
            const m = entry.data.message;
            return m?.type === type && m.session_id === a.nativeSessionId &&
                (m.parent_tool_use_id === undefined || m.parent_tool_use_id === null) &&
                nonempty(m.uuid) && !retracted.has(m.uuid) && window.filter(e => e.data.message?.uuid === m.uuid).length === 1;
        };
        const calls = window.filter(e => topLevel(e, 'assistant')).flatMap(entry => {
            const m = entry.data.message;
            return m.message?.role === 'assistant' && Array.isArray(m.message.content)
                ? m.message.content.filter((b: any) => b?.type === 'tool_use' && nonempty(b.id)).map((b: any) => ({ entry, id: b.id, name: b.name })) : [];
        });
        const episodes: { call: typeof calls[number]; entry: Entry; block: any }[] = [];
        for (const call of calls.filter(c => c.name === 'StructuredOutput')) {
            if (calls.filter(c => c.id === call.id).length !== 1) return;
            const carriers = window.filter(e => topLevel(e, 'user') && e.data.message.message?.role === 'user' &&
                Array.isArray(e.data.message.message.content)).flatMap(entry => entry.data.message.message.content
                    .filter((b: any) => b?.type === 'tool_result' && b.tool_use_id === call.id).map((block: any) => ({ entry, block })));
            if (carriers.length !== 1 || window.indexOf(carriers[0]!.entry) <= window.indexOf(call.entry) || ![undefined, false, true].includes(carriers[0]!.block.is_error)) return;
            episodes.push({ call, ...carriers[0]! });
        }
        const lastSuccess = Math.max(-1, ...episodes.filter(e => e.block.is_error !== true).map(e => window.indexOf(e.entry)));
        for (const { call, entry, block } of episodes) {
            if (block.is_error !== true || window.indexOf(entry) <= lastSuccess) continue;
            if (![call.id, entry.id].every(id => /^[a-zA-Z0-9_-]{1,200}$/.test(id))) return;
            const content = block.content;
            const text = typeof content === 'string' ? content : Array.isArray(content) && content.every(b => b?.type === 'text' && typeof b.text === 'string')
                ? content.map(b => b.text).join(' ') : '';
            const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').trim();
            if (!cleaned) continue;
            const bytes = Buffer.from(cleaned), suffix = '… [see original role history]';
            let message = cleaned;
            if (bytes.length > 512) {
                const limit = 512 - Buffer.byteLength(suffix);
                message = '';
                for (let end = limit; end >= limit - 3; end--) {
                    try { message = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)) + suffix; break; } catch { }
                }
                if (!message) return;
            }
            return { message, toolUseId: call.id, sourceEntryId: entry.id };
        }
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
export type NativeMaterialIssueReason =
    'conflicting original SDK message identity' | 'original submission input is not JSON' |
    'invalid unowned public native delta' | 'invalid unowned public native text' |
    'invalid original native text' | 'invalid original native delta' | 'unreadable original native material';
export type NativeMaterialPrefixReason =
    'message-restarted' | 'unowned-public-delta' | 'invalid-block-index' | 'repeated-block-start' |
    'conflicting-block-start' | 'delta-after-block-stop' | 'invalid-block-stop' |
    'event-after-message-stop' | 'message-stopped-with-open-block';
export interface NativeMaterialRead {
    materials:Material[];
    diagnostics:{
        extraction:{count:number;sample:Array<{entryId:string;reason:NativeMaterialIssueReason}>};
        prefix:{count:number;sample:Array<{entryId:string;sourceEntryId:string|null;reason:NativeMaterialPrefixReason}>;
            /** null denotes global uncertainty; source IDs retain exact affected membership. */
            sources:Set<string|null>};
    };
}
export function nativeRoleMaterial(entries: Entry[], intentEntryId: string, options: { includeTextStreamAliases?: boolean } = {}): NativeMaterialRead {
    return nativePacketMaterial(expandNativeTransport(entries),intentEntryId,options);
}
function nativePacketMaterial(entries: Entry[], intentEntryId: string, options: { includeTextStreamAliases?: boolean } = {}): NativeMaterialRead {
    const diagnostics:NativeMaterialRead['diagnostics']={extraction:{count:0,sample:[]},prefix:{count:0,sample:[],sources:new Set()}};
    const issue=(entryId:string,reason:NativeMaterialIssueReason)=>{
        diagnostics.extraction.count++;
        if(diagnostics.extraction.sample.length<64) diagnostics.extraction.sample.push({entryId,reason});
    };
    const conflict=(entryId:string,sourceEntryId:string|null,reason:NativeMaterialPrefixReason)=>{
        diagnostics.prefix.count++;diagnostics.prefix.sources.add(sourceEntryId);
        if(diagnostics.prefix.sample.length<64) diagnostics.prefix.sample.push({entryId,sourceEntryId,reason});
    };
    type Stream = {nativeMessageId: string; start: string; blocks: Map<number, Material>; started: Set<number>; ended: Set<number>; stopped: boolean; invalid: boolean};
    const materials: Material[] = [], contexts = new Map<string, Stream>(), streams: Stream[] = [], seen = new Map<string, any>();
    const request = entries.find(entry=>entry.id === intentEntryId)?.data?.request;
    const submission = request?.version === 3 && request.carrier === 'tool-submission/v1';
    const toolName = submission ? nativeSubmissionToolName : 'StructuredOutput';
    const argumentSelector = submission ? 'submission-arguments' : 'formatter-arguments';
    const decodedSelector = submission ? 'decoded-submission-input:' : 'decoded-formatter-input:';
    const sdkTexts = new Map<string, Material[]>();
    const typedInputs: Array<{material: Material; value: any}> = [];
    for (const entry of entries) {
        if (!custom(entry, nativeRoleEntries.sdk) || entry.data.intentEntryId !== intentEntryId) continue;
        try {
        const m = entry.data.message;
        if (m?.type !== 'stream_event' && nonempty(m?.uuid)) {
            const key = m.type + ':' + m.uuid, prior = seen.get(key);
            if (prior && isDeepStrictEqual(prior, m)) continue;
            if (prior) issue(entry.id, 'conflicting original SDK message identity');
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
                if (block?.type === 'tool_use' && block.name === toolName && (submission || object(block.input))) {
                    if (submission && (!Object.hasOwn(block,'input') || typeof JSON.stringify(block.input) !== 'string')) {
                        issue(entry.id,'original submission input is not JSON');
                        continue;
                    }
                    const material: Material = {sourceEntryId:entry.id,selector:decodedSelector+index,raw:JSON.stringify(block.input),nativeMessageId:m.message.id,toolUseId:block.id,...identity};
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
            if (prior && !prior.stopped) { prior.invalid = true; for (const material of prior.blocks.values()) { material.invalid = true; conflict(entry.id,material.sourceEntryId,'message-restarted'); } }
            contexts.set(parent,stream); streams.push(stream);
        }
        const stream = contexts.get(parent);
        const publicDelta = event?.type === 'content_block_delta' &&
            (event.delta?.type === 'input_json_delta' || event.delta?.type === 'text_delta');
        // Unowned public bytes cannot prove a later prefix complete. Track starts
        // even for non-material blocks without inspecting their private content.
        const validIndex = Number.isSafeInteger(event?.index) && event.index >= 0;
        if (publicDelta && (!validIndex || !stream || !stream.started.has(event.index))) {
            conflict(entry.id,null,'unowned-public-delta');
            const raw = event.delta.type === 'input_json_delta' ? event.delta.partial_json : event.delta.text;
            if (typeof raw !== 'string') issue(entry.id, 'invalid unowned public native delta');
            else materials.push({sourceEntryId:entry.id,selector:event.delta.type === 'input_json_delta' ? 'unowned-input-json-delta' : 'unowned-text-delta',
                raw,...identity,frames:[entry.id],complete:false,invalid:true});
        }
        if (!stream && event?.type === 'content_block_start' && event.content_block?.type === 'text') {
            if (typeof event.content_block.text !== 'string') issue(entry.id, 'invalid unowned public native text');
            else materials.push({sourceEntryId:entry.id,selector:'unowned-text-start',raw:event.content_block.text,...identity,frames:[entry.id],complete:false,invalid:true});
        }
        if (!stream) continue;
        const repeatedStart = event?.type === 'content_block_start' && stream.started.has(event.index);
        if (event?.type === 'content_block_start') {
            if (validIndex) stream.started.add(event.index);
            else conflict(entry.id,null,'invalid-block-index');
            if (repeatedStart) conflict(entry.id,null,'repeated-block-start');
        }
        if (event?.type === 'content_block_start' && (event.content_block?.type === 'text' || event.content_block?.type === 'tool_use' && event.content_block.name === toolName)) {
            const formatter = event.content_block.type === 'tool_use';
            if (!formatter && typeof event.content_block.text !== 'string') { issue(entry.id, 'invalid original native text'); stream.invalid = true; }
            const material: Material = {sourceEntryId:entry.id,selector:formatter?argumentSelector:'stream-text',nativeMessageId:stream.nativeMessageId,...identity,
                ...(formatter ? {toolUseId:event.content_block.id} : {}),raw:formatter?'':typeof event.content_block.text === 'string'?event.content_block.text:'',frames:[stream.start,entry.id],complete:false};
            if (stream.stopped || stream.invalid || stream.blocks.has(event.index)) {
                material.invalid = true; stream.invalid = true;
                for (const previous of stream.blocks.values()) { previous.invalid = true; conflict(entry.id,previous.sourceEntryId,'conflicting-block-start'); }
                conflict(entry.id,material.sourceEntryId,'conflicting-block-start');
            }
            materials.push(material); stream.blocks.set(event.index,material);
        }
        const block = stream.blocks.get(event?.index);
        if (publicDelta && stream.ended.has(event.index)) conflict(entry.id,block?.sourceEntryId ?? null,'delta-after-block-stop');
        if (event?.type === 'content_block_stop') {
            if (!validIndex || !stream.started.has(event.index) || stream.ended.has(event.index)) conflict(entry.id,null,'invalid-block-stop');
            if (validIndex) stream.ended.add(event.index);
        }
        if (stream.stopped) {
            stream.invalid = true;
            for (const material of stream.blocks.values()) { material.invalid = true; conflict(entry.id,material.sourceEntryId,'event-after-message-stop'); }
            if (block) block.invalid = true;
        }
        if (block && event.type === 'content_block_delta') {
            const part = block.selector === argumentSelector && event.delta?.type === 'input_json_delta' ? event.delta.partial_json :
                block.selector === 'stream-text' && event.delta?.type === 'text_delta' ? event.delta.text : undefined;
            if (typeof part === 'string') { block.raw += part; block.frames!.push(entry.id); }
            else { issue(entry.id, 'invalid original native delta'); block.invalid = true; block.frames!.push(entry.id); }
        }
        if (block && event.type === 'content_block_stop') { block.complete = true; block.frames!.push(entry.id); }
        if (event?.type === 'message_stop') {
            for (const material of stream.blocks.values()) if (!material.complete) { material.invalid = true; conflict(entry.id,material.sourceEntryId,'message-stopped-with-open-block'); }
            stream.stopped = true;
        }
        } catch {
            // Producer decoding cannot unwind controller resource settlement.
            // Already decoded material remains available; original envelopes stay retained.
            issue(entry.id, 'unreadable original native material');
        }
    }
    for (const stream of streams) if (!stream.stopped || stream.invalid)
        for (const material of stream.blocks.values()) material.invalid = true;
    const aliases = new Set<Material>();
    for (const {material,value} of typedInputs) {
        const arguments_ = materials.filter(m => m.selector === argumentSelector && m.complete && !m.invalid &&
            m.nativeMessageId === material.nativeMessageId && m.toolUseId === material.toolUseId && m.nativeSessionId === material.nativeSessionId && m.parentToolUseId === material.parentToolUseId);
        if (arguments_.length === 1) {
            try { if (isDeepStrictEqual(JSON.parse(arguments_[0]!.raw),value)) aliases.add(material); } catch { /* Raw bytes remain retained. */ }
        }
    }
    const textStreams=new Map<string,Array<{stream:Stream;blocks:Material[]}>>();
    for(const stream of streams){
        const blocks=[...stream.blocks.values()].filter(m=>m.selector==='stream-text');
        if(!blocks.length)continue;
        const key=JSON.stringify([blocks[0]!.nativeSessionId,blocks[0]!.parentToolUseId,stream.nativeMessageId]);
        const bucket=textStreams.get(key),match={stream,blocks};
        if(bucket)bucket.push(match);else textStreams.set(key,[match]);
    }
    for (const [key,texts] of sdkTexts) {
        const matches=textStreams.get(key);
        if (!matches || matches.length !== 1 || !matches[0]!.stream.stopped) continue;
        const {blocks}=matches[0]!;
        if (!options.includeTextStreamAliases && blocks.every(m=>m.complete && !m.invalid) && isDeepStrictEqual(blocks.map(m=>m.raw),texts.map(m=>m.raw)))
            blocks.forEach(m=>aliases.add(m)); // Exact stream/full representations of the same ordered blocks.
    }
    return {materials:materials.filter(material=>material.raw && !aliases.has(material)),diagnostics};
}
/** Proof of exact received public bytes, never a selected RoleOutput or an
 * inferred message/block. Requires the original settled-query attestation,
 * without requiring a successful terminal RoleOutput. */
export function readUnownedNativeMaterials(entries: Entry[], expected: {sessionId:string; launchId:string; role:string; intent:NativeRoleIntentReceipt}): Material[] {
    entries=expandNativeTransport(entries);
    const intents = entries.filter(e => custom(e,nativeRoleEntries.intent));
    if (intents.length !== 1) unavailable('ambiguous original dispatch intent');
    const intent = intents[0]!, request = intent.data.request as StructuredOutputIntent;
    if (intent.data.sessionId !== expected.sessionId || !object(request) ||
        !(request.version === 1 || request.version === 2 && request.carrier === 'assistant-json/v1' || request.version === 3 && request.carrier === 'tool-submission/v1') || request.requestId !== expected.launchId ||
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
    const read = nativePacketMaterial(entries,intent.id);
    const materials = read.materials.filter(m=>unownedNativeSelector(m.selector));
    if (read.diagnostics.extraction.count) unavailable('unowned material original bytes unavailable or conflicting');
    const byId = new Map<string,Entry[]>();
    for (const entry of sdk) byId.set(entry.id,[...(byId.get(entry.id) ?? []),entry]);
    for (const material of materials) {
        const source = byId.get(material.sourceEntryId);
        if (source?.length !== 1 || source[0]!.data.message?.session_id !== a.nativeSessionId) unavailable('unowned material original entry/session mismatch');
    }
    return materials;
}
export function readUnownedNativeMaterial(entries: Entry[], expected: {sessionId:string; launchId:string; role:string; intent:NativeRoleIntentReceipt}, entryId:string, selector:string): Material {
    entries=expandNativeTransport(entries);
    if (!unownedNativeSelector(selector)) unavailable('unsupported unowned selector');
    const matches = readUnownedNativeMaterials(entries,expected).filter(m=>m.sourceEntryId===entryId && m.selector===selector);
    if (matches.length !== 1) unavailable('unowned material original bytes unavailable or conflicting');
    return matches[0]!;
}
/** Historical received bytes only, never a selected result, query settlement,
 * producer completion, diagnosis or semantic census. The caller authenticates
 * the original file/checkpoint before supplying these entries. */
type HistoricalArgumentExpected = {
    sessionId:string; launchId:string; role:string; intent:NativeRoleIntentReceipt; checkpointLeafId:string;
};
export function readHistoricalFormatterAttempt(entries: Entry[], expected: HistoricalArgumentExpected, entryId:string): {material:Material; querySettlement:'verified'|'not-attested'} {
    entries=expandNativeTransport(entries);
    return historicalArgumentMaterial(entries,expected,entryId,'formatter-attempt');
}
/** Complete received submission custody, including original failed queries.
 * This neither selects a RoleOutput nor grants semantic or action authority. */
export function readHistoricalSubmissionAttempt(entries: Entry[], expected: HistoricalArgumentExpected, entryId:string): {material:Material; querySettlement:'verified'} {
    entries=expandNativeTransport(entries);
    const original = historicalArgumentMaterial(entries,expected,entryId,'submission-attempt');
    if (original.querySettlement !== 'verified') unavailable('submission needs original settled-query custody');
    return {material:original.material,querySettlement:'verified'};
}
/** Authenticates closed argument bytes within an already verified controller
 * checkpoint. This supplies literal accounting only, even without settlement. */
export function readReceivedSubmissionArguments(entries: Entry[], expected: HistoricalArgumentExpected, entryId:string): Material {
    return historicalArgumentMaterial(expandNativeTransport(entries),expected,entryId,'received-submission').material;
}
export function readRejectedSubmissionAttempt(entries: Entry[], expected: HistoricalArgumentExpected, entryId:string): {material:Material; rejectionEntryId:string} {
    entries=expandNativeTransport(entries);
    return rejectedNativeAttempt(entries,expected,readHistoricalSubmissionAttempt(entries,expected,entryId));
}
/** Literal-material custody only. A rejected call supplies no selected result. */
export function readRejectedFormatterAttempt(entries: Entry[], expected: HistoricalArgumentExpected, entryId:string): {material:Material; rejectionEntryId:string} {
    entries=expandNativeTransport(entries);
    return rejectedNativeAttempt(entries,expected,readHistoricalFormatterAttempt(entries,expected,entryId));
}
function rejectedNativeAttempt(entries: Entry[], expected: HistoricalArgumentExpected, original: {material:Material; querySettlement:'verified'|'not-attested'}): {material:Material; rejectionEntryId:string} {
    const material = original.material, label = material.selector==='submission-arguments'?'submission':'formatter';
    if (original.querySettlement !== 'verified' || !material.complete || material.invalid || !material.toolUseId)
        unavailable('rejected '+label+' requires complete settled original call');
    const prefix = entries.slice(0,entries.findIndex(entry => entry.id === expected.checkpointLeafId) + 1);
    const sdk = prefix.filter(entry => custom(entry,nativeRoleEntries.sdk));
    const settlement = prefix.find(entry => custom(entry,nativeRoleEntries.settlement))!;
    const retracted = retractedNativeMessages(sdk);
    const results = sdk.flatMap(entry => Array.isArray(entry.data.message?.message?.content)
        ? entry.data.message.message.content.filter((block:any) => block?.type === 'tool_result' && block.tool_use_id === material.toolUseId)
            .map((block:any) => ({entry,block})) : []);
    if (results.length !== 1) unavailable('rejected '+label+' result unavailable or ambiguous');
    const {entry,block} = results[0]!, message = entry.data.message;
    // Historical call proof has already required exactly one SDK entry per frame ID.
    const frameIds = new Set(material.frames);
    const end = sdk.findLastIndex(frame => frameIds.has(frame.id));
    if (message.type !== 'user' || message.message?.role !== 'user' || block.is_error !== true ||
        message.session_id !== material.nativeSessionId || (message.parent_tool_use_id ?? null) !== null ||
        !nonempty(message.uuid) || sdk.filter(frame => frame.data.message?.uuid === message.uuid).length !== 1 ||
        message.resume_reason || message.aborted || message.error || retracted.has(message.uuid) || retracted.has(message.message?.id) ||
        sdk.indexOf(entry) <= end || prefix.indexOf(entry) >= prefix.indexOf(settlement))
        unavailable('rejected '+label+' result identity or order mismatch');
    if (material.selector==='submission-arguments') {
        // Historical submission custody already authenticated the closed owning message.
        const typed=sdk.filter(frame=>frame.data.message?.type==='assistant' && frame.data.message.message?.id===material.nativeMessageId &&
            Array.isArray(frame.data.message.message.content) && frame.data.message.message.content.some((call:any)=>call?.type==='tool_use'&&call.id===material.toolUseId));
        if (typed.length!==1 || sdk.indexOf(entry)<=sdk.indexOf(typed[0]!))
            unavailable('rejected submission receipt precedes the typed call');
    }
    return {material,rejectionEntryId:entry.id};
}
/** Received prefix only. The caller must prove the original owner terminated
 * and retain file/checkpoint currentness; this cannot attest a completed call. */
export function readTerminatedFormatterPrefix(entries: Entry[], expected: HistoricalArgumentExpected, entryId:string): {material:Material} {
    entries=expandNativeTransport(entries);
    const {material}=historicalArgumentMaterial(entries,expected,entryId,'terminated-formatter-prefix');
    return {material};
}
/** Received-prefix custody never supplies a complete call or selected result. */
export function readStoppedSubmissionPrefix(entries:Entry[],expected:HistoricalArgumentExpected,entryId:string):Material {
    const {material,querySettlement}=historicalArgumentMaterial(expandNativeTransport(entries),expected,entryId,'stopped-submission-prefix');
    if(querySettlement!=='verified'||Buffer.byteLength(material.raw)>128*1024||Buffer.from(material.raw).toString('utf8')!==material.raw)
        unavailable('stopped submission prefix original bounded custody unavailable');
    return material;
}
function historicalArgumentMaterial(entries: Entry[], expected: HistoricalArgumentExpected, entryId:string, purpose:'formatter-attempt'|'submission-attempt'|'terminated-formatter-prefix'|'stopped-submission-prefix'|'received-submission'): {material:Material; querySettlement:'verified'|'not-attested'} {
    const receivedSubmission = purpose === 'received-submission';
    const submission=purpose==='submission-attempt'||purpose==='stopped-submission-prefix'||receivedSubmission;
    const terminatedPrefix=purpose==='terminated-formatter-prefix',stoppedPrefix=purpose==='stopped-submission-prefix',incomplete=terminatedPrefix||stoppedPrefix;
    const label = submission ? 'submission' : 'formatter';
    const selector = submission ? 'submission-arguments' : 'formatter-arguments', toolName = submission ? nativeSubmissionToolName : 'StructuredOutput';
    const decodedSelector = submission ? 'decoded-submission-input:' : 'decoded-formatter-input:';
    const leaf=entries.filter(entry=>entry.id===expected.checkpointLeafId),end=entries.findIndex(entry=>entry.id===expected.checkpointLeafId);
    if (leaf.length!==1||end<1) unavailable('historical '+label+' checkpoint unavailable');
    const prefix=entries.slice(0,end+1),header=entries[0];
    if (header?.type!=='session'||header.id!==expected.sessionId) unavailable('historical '+label+' session mismatch');
    const intents=prefix.filter(entry=>entry.type==='custom'&&entry.customType===nativeRoleEntries.intent);
    if (intents.length!==1||!custom(intents[0],nativeRoleEntries.intent)) unavailable('historical '+label+' dispatch ambiguous');
    const intent=intents[0]!,request=intent.data.request as StructuredOutputIntent;
    if (intent.data.sessionId!==expected.sessionId||!object(request)||(submission ? request.version!==3 || request.carrier!=='tool-submission/v1' : request.version!==1)||!object(request.binding)||!object(request.schema)||
        !nonempty(request.binding.stage)||typeof request.binding.inputDigest!=='string'||!/^[a-f0-9]{64}$/.test(request.binding.inputDigest)||
        !Number.isSafeInteger(request.maxNativeTurns)||request.maxNativeTurns<1||request.requestId!==expected.launchId||
        request.binding?.launchId!==expected.launchId||request.binding?.role!==expected.role||!isDeepStrictEqual(nativeRoleIntentReceipt(request),expected.intent))
        unavailable('historical '+label+' dispatch mismatch');
    const taggedSdk=prefix.filter(entry=>entry.type==='custom'&&entry.customType===nativeRoleEntries.sdk);
    if (taggedSdk.some(entry=>!custom(entry,nativeRoleEntries.sdk)||!object(entry.data.message)||!nonempty(entry.data.message.type)))
        unavailable('historical '+label+' SDK wrapper malformed');
    const sdk=taggedSdk.filter(entry=>entry.data.intentEntryId===intent.id);
    const positions=new Map(prefix.map((entry,index)=>[entry,index]));
    if (!sdk.length||prefix.some(entry=>custom(entry,nativeRoleEntries.sdk)&&entry.data.intentEntryId!==intent.id)||
        sdk.some((entry,index)=>entry.data.sequence!==index+1||positions.get(entry)!<=positions.get(intent)!))
        unavailable('historical '+label+' trace prefix mismatch');
    const initial=sdk.filter(entry=>entry.data.message?.type==='system'&&entry.data.message.subtype==='init');
    if (initial.length!==1||!nonempty(initial[0]!.data.message.session_id)) unavailable('historical '+label+' initialization unavailable');
    const sid=initial[0]!.data.message.session_id;
    if (submission) {
        if (terminatedPrefix || request.maxNativeTurns>100 || request.schema.type!=='object' ||
            Object.keys(request).sort().join(',')!=='binding,carrier,maxNativeTurns,requestId,schema,version' || Buffer.byteLength(JSON.stringify(request))>256*1024)
            unavailable('historical submission request unsupported');
        const init = initial[0]!.data.message;
        if (!Array.isArray(init.tools) || init.tools.filter((name:unknown)=>name===nativeSubmissionToolName).length!==1 ||
            !Array.isArray(init.mcp_servers) || init.mcp_servers.filter((server:any)=>server?.name==='custom-tools'&&server.status==='connected').length!==1)
            unavailable('historical submission original tool initialization unavailable');
        const users=prefix.filter(entry=>entry.type==='message'&&entry.message?.role==='user');
        if (users.length!==1 || prefix.indexOf(users[0]!)>=prefix.indexOf(initial[0]!)) unavailable('historical submission fresh input unavailable');
        assertNativeResponseInput({messages:users.map(entry=>entry.message)},request);
    }
    const settlements=prefix.filter(entry=>entry.type==='custom'&&entry.customType===nativeRoleEntries.settlement);
    if (settlements.length>1) unavailable('historical '+label+' settlement ambiguous');
    if (settlements.some(entry=>!custom(entry,nativeRoleEntries.settlement)||entry.data.intentEntryId!==intent.id||
        entry.data.attestation?.type!=='gitjig.native-query-settled/v1'))
        unavailable('historical '+label+' settlement malformed or foreign');
    // Preserve the stronger original settled-query checks when one was recorded.
    if (submission && !receivedSubmission && settlements.length!==1) unavailable('historical submission original settlement unavailable');
    if (settlements.length) readUnownedNativeMaterials(prefix,expected);
    const {materials,diagnostics}=nativePacketMaterial(prefix,intent.id);
    if (terminatedPrefix&&(diagnostics.extraction.count || diagnostics.prefix.count)) unavailable('terminated formatter source conflicts');
    if (receivedSubmission && (diagnostics.extraction.count || diagnostics.prefix.count)) unavailable('received submission source conflicts');
    if(stoppedPrefix&&(diagnostics.prefix.sources.size!==1||!diagnostics.prefix.sources.has(entryId)))
        unavailable('stopped submission prefix has unrelated source uncertainty');
    const matches=materials.filter(material=>material.selector===selector&&material.sourceEntryId===entryId);
    if (matches.length!==1) unavailable('historical '+label+' call unavailable or ambiguous');
    const material=matches[0]!;
    if ((incomplete ? material.complete!==false||material.invalid!==true : material.complete!==true||material.invalid)||material.nativeSessionId!==sid||material.parentToolUseId!==null||
        !nonempty(material.nativeMessageId)||!nonempty(material.toolUseId)||!material.frames?.length)
        unavailable('historical '+label+' call incomplete or foreign');
    if (materials.some(other=>other!==material&&other.nativeSessionId===sid&&other.toolUseId===material.toolUseId&&
        (other.selector===selector||other.selector.startsWith(decodedSelector))))
        unavailable('historical '+label+' call has conflicting aliases');
    const sdkPositions = new Map<string, number>(), uuidCounts = new Map<string, number>();
    for (const [index, entry] of sdk.entries()) {
        // An ambiguous entry ID cannot authenticate any material frame.
        sdkPositions.set(entry.id, sdkPositions.has(entry.id) ? -1 : index);
        const uuid = entry.data.message.uuid;
        if (typeof uuid === 'string') uuidCounts.set(uuid, (uuidCounts.get(uuid) ?? 0) + 1);
    }
    const start=sdk[sdkPositions.get(entryId) ?? -1];
    const event=start?.data.message?.event;
    if (!start||event?.type!=='content_block_start'||!Number.isSafeInteger(event.index)||event.index<0||
        event.content_block?.type!=='tool_use'||event.content_block.name!==toolName||event.content_block.id!==material.toolUseId)
        unavailable('historical '+label+' source entry mismatch');
    if ((stoppedPrefix || receivedSubmission) && (!object(event.content_block.input) || Object.keys(event.content_block.input).length))
        unavailable(stoppedPrefix ? 'stopped submission prefix initial arguments unsupported' : 'received submission initial arguments unsupported');
    for (const id of material.frames) {
        const frame=sdk[sdkPositions.get(id) ?? -1];
        if (!frame||frame.data.message.session_id!==sid||(frame.data.message.parent_tool_use_id??null)!==null)
            unavailable('historical '+label+' frame identity mismatch');
    }
    // Material extraction preserves claims even under malformed streams. Source
    // authentication additionally needs a coherent *owning* message, including
    // opaque blocks and stop frames which are not part of the public raw bytes.
    // A later unrelated incomplete response is not this call's completion duty.
    const retracted=retractedNativeMessages(sdk),validMessage=(entry:Entry) => {
        const m=entry.data.message;
        return nonempty(m?.uuid)&&uuidCounts.get(m.uuid)===1&&
            m.session_id===sid&&(m.parent_tool_use_id??null)===null&&!m.resume_reason&&!m.aborted&&!m.error&&!retracted.has(m.uuid);
    };
    if((stoppedPrefix || receivedSubmission)&&sdk.filter(entry=>entry.data.message?.type==='stream_event'&&entry.data.message.event?.type==='message_start'&&
        entry.data.message.session_id===sid&&(entry.data.message.parent_tool_use_id??null)===null&&entry.data.message.event.message?.id===material.nativeMessageId).length!==1)
        unavailable(stoppedPrefix ? 'stopped submission prefix owning message ambiguous' : 'received submission owning message ambiguous');
    const first=sdkPositions.get(material.frames[0]!) ?? -1;
    if (first<1||sdk.indexOf(initial[0]!)>=first||!validMessage(initial[0]!)||retracted.has(material.nativeMessageId))
        unavailable('historical '+label+' owning message identity unavailable');
    const started=new Set<number>(),ended=new Set<number>(),toolIds=new Set<string>();let stopped=false,stopPosition=-1;
    for (const entry of sdk.slice(first)) {
        const m=entry.data.message;
        if (m?.type!=='stream_event'||m.session_id!==sid||(m.parent_tool_use_id??null)!==null) continue;
        if (!validMessage(entry)) unavailable('historical '+label+' owning frame unavailable');
        const e=m.event;
        if (entry===sdk[first]) {
            if (e?.type!=='message_start'||e.message?.id!==material.nativeMessageId||e.message?.role!=='assistant')
                unavailable('historical '+label+' owning start mismatch');
        } else if (e?.type==='message_start') unavailable('historical '+label+' owning message interrupted');
        if (['content_block_start','content_block_delta','content_block_stop'].includes(e?.type)) {
            if (!Number.isSafeInteger(e.index)||e.index<0) unavailable('historical '+label+' owning block index unavailable');
            if (e.type==='content_block_start') {
                if (started.has(e.index)) unavailable('historical '+label+' repeated owning block');
                started.add(e.index);
                if (e.content_block?.type==='tool_use') {
                    if (!nonempty(e.content_block.id)||toolIds.has(e.content_block.id)) unavailable('historical '+label+' owning tool identity collision');
                    toolIds.add(e.content_block.id);
                }
            } else if (!started.has(e.index)||ended.has(e.index)) unavailable('historical '+label+' owning block order mismatch');
            if (e.type==='content_block_stop') ended.add(e.index);
        }
        if (e?.type==='message_stop') {
            if(stoppedPrefix ? started.size!==ended.size+1||!started.has(event.index)||ended.has(event.index) : started.size!==ended.size)
                unavailable('historical '+label+' owning message has open blocks');
            stopped=true;stopPosition=sdk.indexOf(entry);break;
        }
    }
    if(stoppedPrefix&&material.frames.some(id=>(sdkPositions.get(id) ?? -1)>=stopPosition))
        unavailable('stopped submission prefix has public frames after owner stop');
    if (terminatedPrefix) {
        if (stopped||started.size!==ended.size+1||!started.has(event.index)||ended.has(event.index))
            unavailable('terminated formatter needs one open owning argument block');
    } else if (!stopped) unavailable('historical '+label+' owning message not stopped');
    const assistants=sdk.filter(entry=>entry.data.message?.type==='assistant'&&entry.data.message.message?.id===material.nativeMessageId);
    let typedCalls=0;
    for (const entry of assistants) {
        const message=entry.data.message.message;
        if (!validMessage(entry)||message.role!=='assistant'||!Array.isArray(message.content)) unavailable('historical '+label+' owning assistant unavailable');
        if (receivedSubmission && sdk.indexOf(entry) <= first) unavailable('received submission owning assistant precedes its stream');
        // The SDK may emit separate text and tool packets for one message ID.
        // Narration does not have to repeat a later tool block.
        for (const block of message.content.filter((block:any)=>block?.type==='tool_use')) {
            if (!toolIds.has(block.id)) unavailable('historical '+label+' owning assistant tool mismatch');
            if (block.id!==material.toolUseId) continue;
            if (terminatedPrefix) unavailable('terminated formatter has a decoded owning call');
            if (receivedSubmission && positions.get(entry)! <= positions.get(start)!)
                unavailable('received submission typed call precedes its argument block');
            try {
                if (++typedCalls>1||block.name!==toolName||!isDeepStrictEqual(block.input,JSON.parse(material.raw)))
                    unavailable('historical '+label+' owning assistant call mismatch');
            } catch { unavailable('historical '+label+' owning assistant call mismatch'); }
        }
    }
    if (submission && !stoppedPrefix && typedCalls!==1) unavailable('historical submission decoded owning call unavailable');
    return {material,querySettlement:settlements.length?'verified':'not-attested'};
}
/** Shared original producer proof; carrier-specific selection adds no authority
 * to another request version. Historical formatter checks remain unchanged. */
function settledNativeRole(entries: Entry[], intentEntryId: string) {
    const intent = entries.find(e => e.id === intentEntryId);
    if (!custom(intent, nativeRoleEntries.intent)) unavailable('original intent missing');
    const sdk = entries.filter(e => custom(e, nativeRoleEntries.sdk) && e.data.intentEntryId === intentEntryId);
    const terminals = sdk.filter(e => e.data.message?.type === 'result');
    const settlements = entries.filter(e => custom(e, nativeRoleEntries.settlement) && e.data.intentEntryId === intentEntryId);
    if (terminals.length !== 1 || settlements.length !== 1) unavailable('missing or ambiguous original terminal/settlement');
    const terminal = terminals[0]!, result = terminal.data.message, settlement = settlements[0]!, a = settlement.data.attestation;
    const request = intent.data.request as StructuredOutputIntent;
    if (!(request?.version === 1 || request?.version === 2 && request.carrier === 'assistant-json/v1' || request?.version === 3 && request.carrier === 'tool-submission/v1') || !nonempty(request.requestId) || !object(request.binding) || !nonempty(request.binding.launchId) ||
        request.requestId !== request.binding.launchId || !nonempty(request.binding.role) || !nonempty(request.binding.stage) ||
        !/^[a-f0-9]{64}$/.test(request.binding.inputDigest ?? '') || !object(request.schema)) unavailable('original role binding missing');
    const policy=nativeEvidencePolicyId(request.binding);
    if (result.subtype !== 'success' || result.is_error !== false || !nonempty(result.uuid) || request.version === 1 && !object(result.structured_output) ||
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
    // Carrier codecs consume this one authenticated trace gate. Literal historical
    // text/submission captures retain their combined quota; formatter history is unchanged.
    if (request.version !== 1) {
        if (entries.indexOf(sdk[0]!) <= entries.indexOf(intent) || entries.indexOf(sdk.at(-1)!) >= entries.indexOf(settlement))
            unavailable('original source trace exceeds bounds or query order');
        if (policy===undefined) {
            let bytes = 0;
            for (const entry of sdk) {
                const size = Buffer.byteLength(JSON.stringify(entry.data.message));bytes += size;
                if (size > nativeEvidencePolicy.eventBytes || bytes > nativeEvidencePolicy.normalBytes)
                    unavailable('original source trace exceeds bounds or query order');
            }
        }
    }
    if (policy===nativeEvidencePolicy.id) {
        const usage: NativeEvidenceUsage = {normalBytes:0,progressBytes:0};let sessionId: string | undefined;
        for (const message of [...sdk.map(entry=>entry.data.message),a]) {
            const charge = nativeEvidenceCharge(message,sessionId,usage);
            if (!charge.allowed) unavailable('original declared evidence policy exceeded: ' + charge.budget);
            acceptNativeEvidenceCharge(usage,charge);
            sessionId = nativeEvidenceSessionId(sessionId,message);
        }
    }
    const capture=policy===embeddedEvidencePolicy.id?nativeCaptureBinding(entries,intent,a):undefined;
    return {intent,request,sdk,terminal,result,settlement,a,initial:initial[0]!,capture};
}
function proveNativeTextSource(entries: Entry[], intentEntryId: string, original: ReturnType<typeof settledNativeRole>): NativeRoleSource {
    const {intent,request,sdk,terminal,result,settlement,a,initial} = original;
    const entryPosition = new Map(entries.map((e,index)=>[e,index]));
    const keys = Object.keys(request).sort().join(',');
    if (keys !== 'binding,carrier,maxNativeTurns,requestId,schema,version' ||
        !Number.isSafeInteger(request.maxNativeTurns) || request.maxNativeTurns < 1 || request.maxNativeTurns > 100 ||
        Buffer.byteLength(JSON.stringify(request)) > 256 * 1024 || !nonempty(a.nativeSessionId) ||
        !nonempty(initial.data.message.uuid) || initial.data.message.parent_tool_use_id != null || initial.data.message.resume_reason || initial.data.message.aborted || initial.data.message.error ||
        result.parent_tool_use_id != null || result.resume_reason || result.aborted || result.error ||
        result.terminal_reason !== undefined && result.terminal_reason !== 'completed' ||
        typeof result.result !== 'string' || !result.result || result.num_turns < 1 || Object.hasOwn(result,'structured_output'))
        unavailable('original text request/terminal is not complete');
    const identities = new Set<string>(), retracted = retractedNativeMessages(sdk);
    for (const e of sdk) {
        const m = e.data.message;
        if (nonempty(m.uuid)) {
            if (identities.has(m.uuid)) unavailable('ambiguous original text message identity');
            identities.add(m.uuid);
        }
    }
    if (retracted.has(initial.data.message.uuid) || retracted.has(result.uuid)) unavailable('retracted original text query');
    // The public role checkpoint runs after Pi appends its original user input;
    // an explicit collector may also be installed before that append. Both are
    // predispatch. Bind the one fresh input, never infer it from intent ordering.
    const inputs = entries.filter(e=>e.type === 'message' && e.message?.role === 'user');
    if (inputs.length !== 1 || entryPosition.get(inputs[0]!)! >= entryPosition.get(initial)!) unavailable('ambiguous original text input');
    const content = inputs[0]!.message.content;
    if (typeof content !== 'string' && (!Array.isArray(content) || Array.from(content).some((b:any)=>b?.type !== 'text' || typeof b.text !== 'string')))
        unavailable('invalid original text input');
    const input = typeof content === 'string' ? content : content.map((b:any)=>b.text).join('');
    if (textDigest(input) !== request.binding.inputDigest) unavailable('original text input differs from dispatch');
    const root = (m: any) => m.session_id === a.nativeSessionId && m.parent_tool_use_id == null;
    const assistants = sdk.filter(e => e.data.message.type === 'assistant' && root(e.data.message));
    const last = assistants.at(-1), mid = last?.data.message.message?.id;
    if (!nonempty(mid) || retracted.has(mid)) unavailable('original final text message unavailable');
    // All SDK representations of this message participate, including a corrupt
    // foreign/replayed cohort. Filtering first could hide a conflicting copy.
    const cohort = sdk.filter(e => e.data.message.type === 'assistant' && e.data.message.message?.id === mid);
    const texts: {entry: Entry; index: number; raw: string}[] = [];
    for (const e of cohort) {
        const m = e.data.message;
        if (!root(m) || !nonempty(m.uuid) || m.resume_reason || m.aborted || m.error || retracted.has(m.uuid) ||
            m.message.stop_reason != null && m.message.stop_reason !== 'end_turn' ||
            m.message.role !== 'assistant' || !Array.isArray(m.message.content) ||
            m.message.content.some((b: any) => !b || !['text','thinking','redacted_thinking'].includes(b.type)))
            unavailable('original final text cohort is not authoritative');
        m.message.content.forEach((b: any,index: number) => {
            if (b.type === 'text') {
                if (typeof b.text !== 'string') unavailable('invalid original final text');
                texts.push({entry:e,index,raw:b.text});
            }
        });
    }
    if (texts.length !== 1 || texts[0]!.raw !== result.result) unavailable('ambiguous original final text/result correspondence');
    const text = texts[0]!;
    const {materials,diagnostics} = nativePacketMaterial(entries,intentEntryId,{includeTextStreamAliases:true});
    const streams = materials.filter(m=>m.selector === 'stream-text' && m.nativeMessageId === mid);
    if (diagnostics.extraction.count || diagnostics.prefix.count || streams.length !== 1) unavailable('original final text stream is ambiguous');
    const stream = streams[0]!;
    if (!stream.complete || stream.invalid || stream.raw !== text.raw || stream.nativeSessionId !== a.nativeSessionId ||
        stream.parentToolUseId != null || !stream.frames || stream.frames.length < 3)
        unavailable('original final text stream is incomplete');
    const positions = new Map(sdk.map((e,index)=>[e.id,index]));
    const frames = stream.frames.map(id=>sdk[positions.get(id)!]);
    const initialPosition=positions.get(initial.id)!,terminalPosition=positions.get(terminal.id)!;
    if (frames.some((e,index)=>!e || positions.get(e.id)! <= initialPosition || positions.get(e.id)! >= terminalPosition ||
        index > 0 && positions.get(e.id)! <= positions.get(frames[index-1]!.id)! ||
        e.data.message.type !== 'stream_event' || !root(e.data.message)) ||
        frames.filter((e): e is Entry=>e?.data.message.event?.type === 'content_block_delta').some(e=>positions.get(e.id)! >= positions.get(text.entry.id)!))
        unavailable('original text frame order/session mismatch');
    // The material reader owns byte assembly; this small lifecycle check proves
    // that those bytes belong to the final, fully stopped root message, including
    // opaque thinking blocks. It does not decode or synthesize answer bytes.
    let active: string | null = null, finalMessage: string | null = null, starts = 0, stops = 0, reasons = 0;
    const open = new Set<number>(), started = new Set<number>();
    for (const e of sdk) {
        const m = e.data.message;
        if (m.type !== 'stream_event' || !root(m)) continue;
        if (!nonempty(m.uuid) || m.resume_reason || m.aborted || m.error || retracted.has(m.uuid)) unavailable('unavailable original root stream identity');
        const event = m.event;
        if (event?.type === 'message_start') {
            if (active !== null || !nonempty(event.message?.id)) unavailable('overlapping original root stream');
            active = event.message.id; finalMessage = active;
            if (active === mid) {
                starts++;
                if (event.message.role !== 'assistant' || !Array.isArray(event.message.content) || event.message.content.length)
                    unavailable('invalid original final stream start');
            }
        } else if (active === null && event?.type !== 'ping') unavailable('unowned original root stream event');
        if (active === mid && ['content_block_start','content_block_stop','content_block_delta'].includes(event?.type)) {
            if (!Number.isSafeInteger(event.index) || event.index < 0) unavailable('invalid original final block index');
            if (event.type === 'content_block_start') {
                if (started.has(event.index) || !['text','thinking','redacted_thinking'].includes(event.content_block?.type)) unavailable('invalid original final block start');
                started.add(event.index); open.add(event.index);
            } else if (!open.has(event.index)) unavailable('unowned original final block event');
            if (event.type === 'content_block_stop') open.delete(event.index);
        }
        if (active === mid && event?.type === 'message_delta') {
            if (++reasons !== 1 || event.delta?.stop_reason !== 'end_turn') unavailable('original final text did not end normally');
        }
        if (event?.type === 'message_stop') {
            if (active === null) unavailable('unowned original message stop');
            if (active === mid) {
                if (open.size) unavailable('unclosed original final block');
                stops++;
            }
            active = null;
        }
    }
    if (active !== null || finalMessage !== mid || starts !== 1 || stops !== 1 || reasons !== 1 ||
        entryPosition.get(text.entry)! <= entryPosition.get(frames[0]!)! || entryPosition.get(text.entry)! >= entryPosition.get(terminal)!)
        unavailable('original text is not the complete final root response');
    const selected = entries.filter(e=>custom(e,nativeRoleEntries.material) && e.data.intentEntryId === intentEntryId &&
        e.data.selector === 'assistant-text:'+text.index && e.data.sourceEntryId === text.entry.id);
    const projection = nativePacketMaterial(entries,intentEntryId).materials.filter(m=>m.selector === 'assistant-text:'+text.index && m.sourceEntryId === text.entry.id);
    if (selected.length !== 1 || projection.length !== 1 || !isDeepStrictEqual(projection[0],
        Object.fromEntries(Object.entries(selected[0]!.data).filter(([key])=>key !== 'intentEntryId'))))
        unavailable('original text material projection changed');
    return {kind:'claude-sdk-assistant-json/v1',sessionId:intent.data.sessionId,intentEntryId,
        textEntryId:selected[0]!.id,assistantEntryId:text.entry.id,resultEntryId:terminal.id,settlementEntryId:settlement.id,
        queryId:a.queryId,nativeSessionId:a.nativeSessionId,rawDigest:textDigest(text.raw),stage:request.binding.stage!,
        inputDigest:request.binding.inputDigest!,schemaDigest:digest(request.schema),requestDigest:digest(request)};
}
function proveNativeRoleSource(entries: Entry[], intentEntryId: string): NativeRoleSource {
    const original=settledNativeRole(entries,intentEntryId),source=proveNativeCarrierSource(entries,intentEntryId,original);
    return original.capture?{...source,capture:original.capture}:source;
}
function proveNativeCarrierSource(entries: Entry[], intentEntryId: string,original:ReturnType<typeof settledNativeRole>): NativeRoleSource {
    if (original.request.version === 3) {
        const {materials,diagnostics} = nativePacketMaterial(entries,intentEntryId);
        if (diagnostics.extraction.count || diagnostics.prefix.count) unavailable('submission original material unavailable');
        return proveNativeSubmissionSource(entries,original,materials);
    }
    if (original.request.version === 2) return proveNativeTextSource(entries,intentEntryId,original);
    const {intent,request,sdk,terminal,result,settlement,a,initial} = original;
    const materials = entries.filter(e => custom(e, nativeRoleEntries.material) && e.data.intentEntryId === intentEntryId && e.data.selector === 'formatter-arguments' && e.data.complete && !e.data.invalid);
    const retracted = retractedNativeMessages(sdk);
    const position = new Map(sdk.map((e,index)=>[e.id,index]));
    const candidates: NativeRoleSource[] = [];
    for (const argument of materials) {
        const material = argument.data;
        if (!nonempty(material.nativeMessageId) || !nonempty(material.toolUseId) || typeof material.raw !== 'string' ||
            material.nativeSessionId !== result.session_id || material.parentToolUseId != null || !Array.isArray(material.frames) || material.frames.length < 3) continue;
        const framePositions = material.frames.map((id:string)=>position.get(id));
        if (framePositions[0]! <= sdk.indexOf(initial)) continue;
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
    entries=expandNativeTransport(entries);
    const byId = new Map(entries.filter(e => e.type !== 'session').map(e => [e.id,e]));
    if (byId.size !== entries.filter(e => e.type !== 'session').length || expected.checkpointLeafId !== entryId) unavailable('ambiguous selected kept checkpoint');
    const kept: Entry[] = [], visited = new Set<string>();
    let cursor: string | null | undefined = entryId;
    while (cursor) {
        if (visited.has(cursor)) unavailable('cyclic original branch');
        visited.add(cursor);
        const e = byId.get(cursor); if (!e) unavailable('original kept branch entry missing');
        kept.push(e); cursor = e.parentId;
    }
    kept.reverse();
    const final = kept.at(-1);
    if (!custom(final, nativeRoleEntries.final) || source && !isDeepStrictEqual(source, final.data)) unavailable('selected source proof differs');
    const proof = final.data as NativeRoleSource, intent = byId.get(proof.intentEntryId);
    if (!custom(intent, nativeRoleEntries.intent) || intent.data.sessionId !== expected.sessionId || intent.data.request?.requestId !== expected.launchId ||
        intent.data.request?.binding?.launchId !== expected.launchId || intent.data.request?.binding?.role !== expected.role) unavailable('selected role/session/intent mismatch');
    for (const key of ['stage','inputDigest','schemaDigest','requestDigest'] as const)
        if (expected[key] !== undefined && proof[key] !== expected[key]) unavailable('selected original '+key+' changed');
    const recomputed = proveNativeRoleSource(kept, proof.intentEntryId);
    if (!isDeepStrictEqual(proof,recomputed)) unavailable('original result provenance changed');
    const material = kept.find(e => e.id === nativeRoleSourceMaterialId(proof))!;
    const original = nativeRoleMaterial(kept, proof.intentEntryId).materials.find(m =>
        m.selector === material.data.selector && m.sourceEntryId === material.data.sourceEntryId);
    if (!original || !isDeepStrictEqual(original, Object.fromEntries(Object.entries(material.data).filter(([key]) => key !== 'intentEntryId')))) unavailable('original formatter bytes/frames changed');
    return original.raw;
}

export type NativeRoleEntry = Entry;
export type NativeRoleMaterial = Material;
export type SettledNativeRole = ReturnType<typeof settledNativeRole>;
