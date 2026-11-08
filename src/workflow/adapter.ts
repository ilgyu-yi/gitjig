import { roleInputEvidenceManifests } from './role-input-evidence.js';
import { renderedReadRange } from '../pi/read-range.js';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeRoleCollector, readNativeRoleOutput, nativeRoleIntentReceipt } from './native-role-output.js';
import type { StructuredOutputIntent } from '../pi/structured-output.js';
import { defaultRoleBounds } from './execution-bounds.js';
import { roleFraming } from './role-framing.js';
import path from 'node:path';
import { createPiSession, type PiSession } from '../pi/session.js';
import type { PiProjectOperations } from '../pi/operations.js';
import { captureProjectExecutionContext } from '../execution/project-context.js';
import { nativeCheckpoint } from '../controller/history.js';
import { parseRoleOutput, MAX_FINAL_BYTES } from './protocol.js';
import { exposureIssues, hashText, promptExposures, readExposure, validateBundle } from './exposure.js';
import type { RunRoleOptions, RoleExecution, RoleObservation, SourceFitRequirement, SourceCatalogue, ObservedSourceIdentity } from './types.js';
function boundedPrefix(raw: string): string {
    const bytes = Buffer.from(raw).subarray(0, MAX_FINAL_BYTES);
    for (let end = bytes.length; end >= bytes.length - 3; end--) {
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
        }
        catch { }
    }
    throw new Error('Unable to retain valid UTF-8 final prefix');
}
/** A native role runner, not a workflow controller or an approval authority.
 * Caller owns scope lifecycle and must not select this result before cleanup. */
export async function runRole(options: RunRoleOptions): Promise<RoleExecution> {
    // Capture assigned identity synchronously. Caller mutation during native awaits
    // cannot relabel bytes already supplied to a reviewer. Do not freeze caller data.
    const o: RunRoleOptions = { ...options, ...(options.nativeIdentity ? { nativeIdentity: structuredClone(options.nativeIdentity) } : {}) };
    if (options.nativeLifecycle)
        o.nativeLifecycle = { ready: options.nativeLifecycle.ready.bind(options.nativeLifecycle), settling: options.nativeLifecycle.settling.bind(options.nativeLifecycle), released: options.nativeLifecycle.released.bind(options.nativeLifecycle) };
    const result: RoleExecution = { launchId: o.launchId, role: o.role, selectedFinalEntryId: null, rawFinal: null, rawFinalTruncated: false, protocol: null, usable: false, issues: [], historyRef: null, nativeSessionId: null, nativeCheckpoint: null, terminal: 'incomplete', providerRequests: 0, events: [], exposures: [] };
    let pi: PiSession | undefined, unsubscribe: (() => void) | undefined, settled = false, settledAborted = false, eventBytes = 0, collectorFailed = false;
    let sourceFit: readonly SourceFitRequirement[] = [];
    let nativeCollector: NativeRoleCollector | undefined;
    let intent: StructuredOutputIntent | undefined;
    const observedSources = new Map<string, ObservedSourceIdentity>();
    let catalogueFiles = new Map<string, SourceCatalogue['files'][number]>();
    let nativeRegistered = false, nativeSettling = false;
    const closeNativeAdmission = () => {
        if (nativeRegistered && !nativeSettling) {
            nativeSettling = true;
            o.nativeLifecycle!.settling(o.nativeIdentity!);
        }
    };
    const deadline = new AbortController();
    const signal = o.signal ? AbortSignal.any([o.signal, deadline.signal]) : deadline.signal;
    let timer: NodeJS.Timeout | undefined;
    const maxProviderRequests = o.maxProviderRequests ?? defaultRoleBounds.maxProviderRequests, timeoutMs = o.timeoutMs ?? defaultRoleBounds.timeoutMs, maxNativeTurns = o.maxNativeTurns ?? 16;
    const nativeStructured = Boolean(o.model.bridge || o.model.bridgeProfile);
    const abort = () => { void pi?.session.abort(); };
    const entry = () => {
        signal.throwIfAborted();
        if (collectorFailed)
            throw new Error('Role collector unavailable');
        o.assertEntry();
    };
    const observe = (event: RoleObservation) => {
        try {
            const bytes = Buffer.byteLength(JSON.stringify(event));
            if (bytes > 2 * 1024 * 1024 || eventBytes + bytes > 8 * 1024 * 1024)
                throw new Error('Role observation exceeds declared bounds');
            eventBytes += bytes;
            result.events.push(event);
            o.onObservation?.(event);
        }
        catch (error) {
            collectorFailed = true;
            result.issues.push(`COLLECTOR:${String(error)}`);
            abort();
        }
    };
    const combined = (inner?: AbortSignal) => inner ? AbortSignal.any([inner, signal]) : signal;
    const ops: PiProjectOperations = { ...(o.operations.executionContext ? { executionContext: captureProjectExecutionContext(o.operations.executionContext) } : {}), workspaceRoot: o.operations.workspaceRoot, validatePath: p => { entry(); return o.operations.validatePath(p); },
        exec: (command, cwd, options) => { entry(); const signal = combined(options.signal); return o.operations.exec(command, cwd, { ...options, ...(signal ? { signal } : {}) }); },
        readFile: async (p, options) => { entry(); const signal = combined(options.signal); return o.operations.readFile(p, { ...options, ...(signal ? { signal } : {}) }); },
        access: (p, m, s) => { entry(); return o.operations.access(p, m, combined(s)); },
        writeFile: (p, c, s) => { entry(); return o.operations.writeFile(p, c, combined(s)); }, mkdir: (p, s) => { entry(); return o.operations.mkdir(p, combined(s)); } };
    try {
        o.inputBundle = structuredClone(o.inputBundle);
        entry();
        if (!Number.isSafeInteger(maxProviderRequests) || maxProviderRequests < 1 || maxProviderRequests > 100)
            throw new Error('Provider request cap must be1..100');
        if (!Number.isSafeInteger(maxNativeTurns) || maxNativeTurns < 1 || maxNativeTurns > 100 || o.maxNativeTurns !== undefined && !nativeStructured)
            throw new Error('Native turn bound1..100 requires an owned Claude role');
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000)
            throw new Error('Role timeout must be1..600000ms');
        timer = setTimeout(() => deadline.abort(new Error('Role deadline exceeded')), timeoutMs);
        timer.unref();
        if (o.maxReadBytes !== undefined && (!Number.isSafeInteger(o.maxReadBytes) || o.maxReadBytes < 1 || o.maxReadBytes > 1024 * 1024))
            throw new Error('Role read bound must be1..1MiB');
        if (!o.launchId || typeof o.beforeModelRequest !== 'function')
            throw new Error('Assigned launch and durable checkpoint callback required');
        if (Boolean(o.nativeIdentity) !== Boolean(o.nativeLifecycle))
            throw new Error('Interactive identity and lifecycle must be supplied together');
        if (o.nativeIdentity && (!o.nativeIdentity.conversationId || !o.nativeIdentity.workId || !o.nativeIdentity.runId || !o.nativeIdentity.initialInputId || o.nativeIdentity.launchId !== o.launchId || !Number.isSafeInteger(o.nativeIdentity.generation) || o.nativeIdentity.generation < 1 || !Number.isSafeInteger(o.nativeIdentity.directionRevision) || o.nativeIdentity.directionRevision < 0))
            throw new Error('Invalid assigned interactive role identity');
        if (o.coordination && 'wait' in o.coordination && o.coordination.wait !== undefined)
            throw new Error('Strict workflow roles cannot install coordinator WAIT');
        if (o.coordination && ['integrate', 'effectInspect', 'effectReconcile', 'publish', 'publishContribution'].some(key => typeof (o.coordination as unknown as Record<string, unknown>)[key] !== 'undefined'))
            throw new Error('Strict workflow roles cannot install delegated effect controls');
        validateBundle(o.inputBundle);
        catalogueFiles = new Map(o.inputBundle.sourceCatalogue?.files.map(file => [file.path, file]) ?? []);
        const evidence = o.inputEvidence && structuredClone(o.inputEvidence);
        const manifests = roleInputEvidenceManifests(o.inputBundle.context);
        if (Boolean(evidence) !== Boolean(manifests.length) || evidence && (o.role !== 'adjudicator' || o.inputBundle.context.stage !== 'planning-adjudication' || evidence.launchId !== o.launchId || hashText(JSON.stringify(evidence.manifests)) !== hashText(JSON.stringify(manifests)))) throw Error('Original role evidence binding unavailable');
        if (evidence) {
            evidence.manifests = manifests;
            if (o.nativeIdentity && manifests.some(manifest => o.nativeIdentity!.workId !== manifest.workId)) throw Error('Original role evidence receiver changed');
            result.evidenceReads = [];
        }
        const framing = roleFraming(o.role, o.inputBundle, nativeStructured);
        sourceFit = framing.sourceFit;
        const { prompt, systemPrompt, constraints, schema } = framing;
        intent = nativeStructured ? {version:1,requestId:o.launchId,
            binding:{launchId:o.launchId,role:o.role,stage:typeof o.inputBundle.context.stage === 'string' && o.inputBundle.context.stage ? o.inputBundle.context.stage : 'unspecified',inputDigest:hashText(JSON.stringify(o.inputBundle))},schema,maxNativeTurns} : undefined;
        const selectRaw = (id: string, raw: string) => {
            result.selectedFinalEntryId = id;
            result.rawFinalTruncated = Buffer.byteLength(raw) > MAX_FINAL_BYTES;
            result.rawFinal = result.rawFinalTruncated ? boundedPrefix(raw) : raw;
            if (result.rawFinalTruncated) result.issues.push('PROTOCOL: final exceeds128KiB; retained prefix only');
            else {
                const parsed = parseRoleOutput(raw, o.role, sourceFit, constraints);
                result.protocol = parsed.value;
                result.issues.push(...parsed.issues);
                if (parsed.value && (parsed.value.implementationCarries !== undefined || parsed.value.implementationCarryGroups !== undefined || parsed.value.decisions?.some(d => Object.hasOwn(d, 'implementationCarry'))) && o.inputBundle.context.stage !== 'planning-adjudication')
                    result.issues.push('PROTOCOL: implementation carry is only valid in planning-adjudication');
                if (parsed.value) result.issues.push(...exposureIssues(parsed.value.assessedScope, o.inputBundle.requiredScope, o.inputBundle, result.exposures, observedSources));
            }
        };
        pi = await createPiSession({ host: o.host, operations: ops, model: o.model, roleContextBudget: { assertEntry: entry, ...(intent ? {structuredOutput:{intent,observe(data: unknown, manager) {
                if (!nativeCollector || nativeCollector.manager !== manager) throw Error('Native role observer has no original dispatch checkpoint');
                nativeCollector.observe(data);
            }}} : {}) }, maxReadBytes: o.maxReadBytes ?? 1024 * 1024,
            systemPrompt,
            ...(evidence ? { inputEvidence: { artifacts: evidence.manifests, onRead: observation => {
                entry();
                const expected = evidence.manifests.find(manifest => [path.resolve(manifest.path), path.join(o.host.artifactRoot, path.basename(manifest.path))].includes(observation.path));
                if (!expected || hashText(observation.text) !== expected.sha256 || Buffer.byteLength(observation.text) !== expected.bytes) throw Error('Original role evidence content changed');
                const range = renderedReadRange(observation.text, observation.args, observation.result);
                if (!range) return;
                const receipt = { boundary: 'host-rendered' as const, launchId: o.launchId, manifestId: expected.id, sha256: expected.sha256, toolCallId: observation.toolCallId, ...range };
                pi!.sessionManager.appendCustomEntry('gitjig.role-input-evidence-read', receipt);
                result.evidenceReads!.push(receipt);
                o.onObservation?.({ type: 'role-input-evidence-read', ...receipt });
                entry();
            } } } : {}),
            ...(o.coordination ? { coordination: o.coordination } : {}),
            onProjectRead: observation => {
                try {
                    entry();
                    const exposures: RoleExecution['exposures'] = [];
                    for (const source of o.inputBundle.sources) {
                        const toolPath = source.toolPath ?? (source.side === 'candidate' ? source.path : undefined);
                        let mapped = false;
                        try {
                            mapped = Boolean(toolPath && observation.path === o.operations.validatePath(path.resolve(o.operations.workspaceRoot, toolPath)));
                        }
                        catch { /* Unsupported mappings supply no source exposure. */ }
                        if (mapped && hashText(observation.text) === source.sha256) {
                            const exposure = readExposure(o.launchId, source, observation.args, observation.result, observation.toolCallId);
                            if (exposure)
                                exposures.push(exposure);
                        }
                    }
                    const catalogue = o.inputBundle.sourceCatalogue;
                    const relative = path.relative(o.operations.workspaceRoot, observation.path).split(path.sep).join('/');
                    const file = catalogueFiles.get(relative);
                    let discovered: ObservedSourceIdentity | undefined;
                    if (catalogue && file && observation.path === path.resolve(o.operations.workspaceRoot, file.path) &&
                        Buffer.byteLength(observation.text) === file.size && hashText(observation.text) === file.sha256) {
                        const source = { id: `${catalogue.side}:${file.path}`, version: catalogue.version, side: catalogue.side,
                            path: file.path, sha256: file.sha256, content: observation.text, exposeInPrompt: false };
                        const exposure = readExposure(o.launchId, source, observation.args, observation.result, observation.toolCallId);
                        if (exposure) {
                            discovered = { id: source.id, version: source.version, side: source.side, path: source.path,
                                sha256: source.sha256, lineCount: observation.text.split('\n').length };
                            if (!exposures.some(existing => existing.sourceId === exposure.sourceId))
                                exposures.push(exposure);
                        }
                    }
                    // Mapping invokes the executor. Admit all receipts together only
                    // after its last callback, without repeating expensive entry reads.
                    entry();
                    if (discovered)
                        observedSources.set(discovered.id, discovered);
                    result.exposures.push(...exposures);
                }
                catch (error) {
                    collectorFailed = true;
                    result.issues.push(`COLLECTOR:${String(error)}`);
                    abort();
                    throw error;
                }
            },
            onModelDispatch: model => {
                entry();
                observe({ type: 'resolved-model', model });
                if (collectorFailed)
                    throw new Error('Resolved model observation could not be retained');
            },
            beforeModelRequest: async (manager) => {
                entry();
                if (result.providerRequests >= maxProviderRequests)
                    throw new Error(`Provider request cap exceeded:${maxProviderRequests}`);
                if (intent && !nativeCollector) nativeCollector = new NativeRoleCollector(manager, intent);
                await o.beforeModelRequest(manager, intent ? nativeRoleIntentReceipt(intent) : undefined);
                entry();
                result.providerRequests++;
            } });
        // Inspection roles keep their existing coordination contract and runtime
        // restrictions; only author filesystem affordances are omitted.
        if (o.role !== 'implementer' && o.role !== 'repairer')
            pi.session.setActiveToolsByName(pi.session.getActiveToolNames().filter(name => name !== 'write' && name !== 'edit'));
        result.historyRef = pi.sessionManager.getSessionFile()!;
        result.nativeSessionId = pi.sessionManager.getSessionId();
        o.onHistory?.(result.historyRef, result.nativeSessionId);
        unsubscribe = pi.session.subscribe(event => {
            if (event.type === 'tool_execution_start') {
                observe({ type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
            }
            if (event.type === 'tool_execution_end') {
                observe({ type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, result: event.result });
            }
            else if (event.type === 'agent_settled') {
                try {
                    closeNativeAdmission();
                }
                catch (error) {
                    collectorFailed = true;
                    result.issues.push(`NATIVE_LIFECYCLE:${String(error)}`);
                    abort();
                }
                settled = true;
                settledAborted = event.aborted;
                observe({ type: event.type, aborted: event.aborted });
            }
        });
        if (o.nativeIdentity) {
            nativeRegistered = true;
            o.nativeLifecycle!.ready({ identity: o.nativeIdentity, session: pi.session, sessionManager: pi.sessionManager, executeUserBash: pi.executeUserBash });
        }
        signal.addEventListener('abort', abort, { once: true });
        entry();
        // Receipt means these exact bytes were supplied to native prompt, not that
        // an unreachable provider has read them. Usability additionally requires completion.
        await pi.session.prompt(prompt);
        result.exposures.push(...promptExposures(o.launchId, o.inputBundle));
        entry();
        const finalEntry = pi.sessionManager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant');
        const last = finalEntry?.type === 'message' && finalEntry.message.role === 'assistant' ? finalEntry.message : undefined;
        if (signal.aborted || settledAborted) {
            result.terminal = 'aborted';
            result.issues.push('ABORTED');
        }
        else if (last?.stopReason === 'error') {
            result.terminal = 'error';
            result.issues.push(`PROVIDER:${last.errorMessage ?? 'error'}`);
        }
        else if (!settled) {
            result.issues.push('INCOMPLETE:no-terminal-response');
        }
        else if (nativeStructured) {
            await pi.closeOwned();
            entry();
            if (!nativeCollector) throw Error('Native role source missing original producer');
            const selected = nativeCollector.select();
            result.nativeSource = selected.source;
            result.terminal = 'complete';
            selectRaw(selected.entryId, selected.raw);
        }
        else if (!last || last.stopReason !== 'stop') {
            result.issues.push(`INCOMPLETE:${last?.stopReason ?? 'no-terminal-response'}`);
        }
        else {
            result.terminal = 'complete';
            const finalTexts = last.content.filter(block => block?.type === 'text');
            const knownContent = last.content.every(block => block?.type === 'text' ? typeof block.text === 'string' :
                block?.type === 'thinking' && typeof block.thinking === 'string' &&
                    (block.thinkingSignature === undefined || typeof block.thinkingSignature === 'string') &&
                    (block.redacted === undefined || typeof block.redacted === 'boolean'));
            if (finalTexts.length !== 1 || !knownContent)
                result.issues.push('PROTOCOL: final must contain one text JSON record');
            else selectRaw(finalEntry!.id, finalTexts[0]!.text);
        }
    }
    catch (error) {
        result.terminal = signal.aborted ? 'aborted' : 'error';
        result.issues.push(String(error));
    }
    finally {
        if (timer)
            clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        try {
            closeNativeAdmission();
        }
        catch (error) {
            result.issues.push(`NATIVE_LIFECYCLE:${String(error)}`);
        }
        unsubscribe?.();
        if (pi) {
            try {
                await pi.closeOwned();
                nativeCollector?.materialize();
                result.nativeCheckpoint = await nativeCheckpoint(pi.sessionManager.getSessionFile()!);
                if (result.nativeSource && result.selectedFinalEntryId) {
                    const bytes = await fs.readFile(pi.sessionManager.getSessionFile()!);
                    if (createHash('sha256').update(bytes).digest('hex') !== result.nativeCheckpoint.sha256) throw Error('Native role history changed during selection');
                    const {parseSessionEntries} = await import('@earendil-works/pi-coding-agent');
                    if (readNativeRoleOutput(parseSessionEntries(bytes.toString('utf8')), result.selectedFinalEntryId,
                        {sessionId:result.nativeSessionId!,launchId:o.launchId,role:o.role,checkpointLeafId:result.nativeCheckpoint.leafId,...(intent ? nativeRoleIntentReceipt(intent) : {})}, result.nativeSource) !== result.rawFinal && !result.rawFinalTruncated)
                        throw Error('Native role persisted raw source differs');
                }
            }
            catch (error) {
                result.issues.push(`CHECKPOINT:${String(error)}`);
            }
            try {
                await pi.closeOwned();
                if (nativeRegistered)
                    o.nativeLifecycle!.released(o.nativeIdentity!);
            }
            catch (error) {
                result.issues.push(`NATIVE_RELEASE:${String(error)}`);
            }
        }
    }
    result.usable = result.terminal === 'complete' && result.protocol !== null && result.issues.length === 0;
    // Extra collector/checkpoint/lifecycle failures keep cause attribution generic.
    if (result.terminal === 'error' && result.nativeCheckpoint && result.issues.length === 1 && result.issues[0]!.startsWith('PROVIDER:')) {
        const failure = nativeCollector?.usageLimit();
        if (failure) result.providerFailure = failure;
    }
    return result;
}
