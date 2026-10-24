import { verificationCommandContract } from './verification-contract.js';
import { internalResultLanguage } from '../pi/language-policy.js';
import { roleInputPrefix, planningSourceFitRequirements, planningCriteriaRefreshRequirement, verificationReviewRequirements, requirementSourceIds, planningVerificationProfile } from './role-input.js';
import path from 'node:path';
import { createPiSession, type PiSession } from '../pi/session.js';
import type { PiProjectOperations } from '../pi/operations.js';
import { nativeCheckpoint } from '../controller/history.js';
import { parseRoleOutput, MAX_FINAL_BYTES } from './protocol.js';
import { roleOutputSchema } from './role-output-shape.js';
import { exposureIssues, hashText, promptExposures, readExposure, validateBundle } from './exposure.js';
import type { RunRoleOptions, RoleExecution, RoleObservation, SourceFitRequirement } from './types.js';
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
function promptFor(o: RunRoleOptions): string {
    const sources = o.inputBundle.sources.map(({ content, ...metadata }) => ({ ...metadata, lineCount: content.split('\n').length }));
    const body = JSON.stringify({ requirements: o.inputBundle.requirements, contracts: o.inputBundle.contracts, context: o.inputBundle.context, sources, requiredScope: o.inputBundle.requiredScope });
    const supplied = o.inputBundle.sources.filter(s => s.exposeInPrompt).map(s => `\nSOURCE ${JSON.stringify({ id: s.id, version: s.version, side: s.side, path: s.path, sha256: s.sha256, lineCount: s.content.split('\n').length })}\n${s.content}\nEND SOURCE\n`).join('');
    const prompt = `${roleInputPrefix(o.role)}${body}\n${supplied}`;
    if (Buffer.byteLength(prompt) > 2 * 1024 * 1024)
        throw new Error('Role prompt exceeds2MiB profile');
    return prompt;
}
// Cases execute under the existing check command; read /input/verification-cases.json and return CheckOutput.cases [{id,inputDigest,observed:{kind,value}}], including expected rejections as successful observations. Exact literals/values are UTF8 bytes, never trimmed. Case declarations do not prove semantic adequacy.
const implementationCarrySemantics = `Only in planning-adjudication, implementationCarries may explicitly assign a currently upheld BASE implementation defect to this output's accepted plan while leaving its finding pending. Name every pending occurrence, including equivalent duplicates, with its actual initial BASE version and current accepted requirement IDs; explain historical-to-current requirement mapping. Initial BASE observations come from distinct prior planning, planning-challenge or planning-adjudication executions with no candidate. An equivalent chain needs an upheld target and every pending member explicitly carried. Unresolved intent, plan objections, diagnostics, checks and missing source operands still block. Assess mandatory claim meaning independently against actual source; malformed optional raw patch/reproduction fields grant no authority or proof and the old producer remains unusable. Carry is not repair, completion or permission. Omit carries when unsupported; never invent identities.`;
const roleSemantics = `Every material behavioral guarantee needs actual healthy and adverse consumer cases. Other admitted baseline and scope duties require their typed historical or host-predicate evidence; an unavailable necessary oracle must be reported. Expectation paths name exact expectation files: [] means inline; omitted means unknown. Only an upheld decision may declare resolution repaired. In planning/review adjudication only, an upheld host-generated producer diagnosis duty may use resolution diagnosed with the supplied outputId, exact rawSha256, inputReceiptHash and exact materialOccurrenceIds. This completes independent diagnosis only; the old producer stays unusable, no task code is repaired and every material claim needs its separate current decision. Explain whether additional meaningful claims remain; if newly identified claims lack actual retained/accountable identities, report them as ordinary findings and hold diagnosis rather than invent IDs. Never use semantic equivalence to a synthetic diagnostic to waive material work. Supplied receipt metadata certifies input selection, not comprehension or semantic completeness. Consume every current held input against its actual raw source chain and accepted requirements; author acknowledgement alone never releases effects. When assigned publication source-fit, assess the ACTUAL final sealed payload bytes and current complete raw source/requirements; fit is fallible and does not clear raw findings, authorize effects, or choose owner scope. Only supplied payloadHash/sourceFingerprint identities may be echoed. Do not invent missing authority or a review-ready claim. Only actual current healthy and base-derived adverse receipts plus fresh review can close the exact old check; a planning amendment never closes it. Only echo actual owned criteria refresh inputs in planning-adjudication; this never changes task requirements by itself. The finite mixed profile admits only exhaustive verification.strategies: consumer-cases require actual healthy/adverse candidate consumer coverage; base-execution-duty requires concrete subject-observation cases executed on the original immutable base BEFORE the first editing producer, never any crash/nonzero or a candidate-pass alias; manifest-scope-duty requires complete host manifest actual/adverse evidence and its named independent reviewer. There is no generic qualitative waiver. Preserve every actual owner requirement and report unsupported necessary oracles. Requirement.source must be exactly one context.requirementSourceIds value, never a prose composite. Required verificationDecisions assess actual supplied strategy digests and witnesses independently; unavailable is not satisfied. Structural schema guidance does not certify semantics. Strict host parsing additionally enforces unique JSON keys and IDs, bounded exact UTF8 bytes, relative owned paths, actual source-range validity, nonblank bounded text, and cross-field lifecycle constraints. Case literals and expected values are exact UTF8, never trimmed.`;
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
    const maxProviderRequests = o.maxProviderRequests ?? 16, timeoutMs = o.timeoutMs ?? 180000;
    const reads = new Map<string, string>();
    const toolArgs = new Map<string, {
        path?: unknown;
        offset?: unknown;
        limit?: unknown;
    }>();
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
    const ops: PiProjectOperations = { workspaceRoot: o.operations.workspaceRoot, validatePath: p => { entry(); return o.operations.validatePath(p); },
        exec: (command, cwd, options) => { entry(); const signal = combined(options.signal); return o.operations.exec(command, cwd, { ...options, ...(signal ? { signal } : {}) }); },
        readFile: async (p, options) => { entry(); const signal = combined(options.signal); const bytes = await o.operations.readFile(p, { ...options, ...(signal ? { signal } : {}) }); reads.set(o.operations.validatePath(p), hashText(bytes.toString('utf8'))); return bytes; },
        access: (p, m, s) => { entry(); return o.operations.access(p, m, combined(s)); },
        writeFile: (p, c, s) => { entry(); return o.operations.writeFile(p, c, combined(s)); }, mkdir: (p, s) => { entry(); return o.operations.mkdir(p, combined(s)); } };
    try {
        o.inputBundle = structuredClone(o.inputBundle);
        entry();
        if (!Number.isSafeInteger(maxProviderRequests) || maxProviderRequests < 1 || maxProviderRequests > 100)
            throw new Error('Provider request cap must be1..100');
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
        sourceFit = planningSourceFitRequirements(o.role, o.inputBundle.context);
        const criteriaRefresh = planningCriteriaRefreshRequirement(o.role, o.inputBundle.context);
        const verificationFit = verificationReviewRequirements(o.role, o.inputBundle.context);
        const sourceIds = requirementSourceIds(o.inputBundle.context);
        const constraints = { ...(verificationFit !== undefined ? { verificationFit } : {}), ...(sourceIds ? { sourceIds } : {}),
            ...(criteriaRefresh ? { criteriaRefresh } : {}),
            ...(Object.hasOwn(o.inputBundle.context, 'planningVerificationProfile') ? { planningProfile: planningVerificationProfile(o.role, o.inputBundle.context)! } : {}) };
        const prompt = promptFor(o);
        pi = await createPiSession({ host: o.host, operations: ops, model: o.model, maxReadBytes: o.maxReadBytes ?? 1024 * 1024,
            systemPrompt: `${internalResultLanguage} You are the assigned ${o.role}, in a fresh context. Your own final assistant message must be exactly one RoleOutput JSON object for this assigned role, with the common fields and role-specific fields below. Verification-command CheckOutput is not your role answer. Do not claim authority, account approval, or other roles. Only implementer/repairer may author changes in their admitted writable scope. Other roles inspect and produce evidence. Author advocacy is not a substitute for source/requirements. Final RoleOutput JSON Schema: ${JSON.stringify(roleOutputSchema(o.role, typeof o.inputBundle.context.stage === 'string' ? o.inputBundle.context.stage : undefined, sourceFit, constraints))}. ${o.role === 'implementer' || o.role === 'repairer' || o.role === 'reviewer' ? "Verification-command protocol only: the host supplies readonly /input/verification-cases.json when it executes a declared check command. The descriptor contains case declarations, actual consumerFiles/fixtureFiles hashes and host-generated inputDigest. When planning, propose case declarations in the plan; do not assume a future check descriptor exists in your role workspace or invent its inputDigests or observed results. One check command may execute the ordered healthy/adverse cases internally. Only that executable check command emits CheckOutput on stdout: {version:1,assertions:[{id,passed,actual?}],cases:[{id,inputDigest,observed:{kind:\"return\"|\"rejection\",value}}]}. The verification stdout contract is separate from the RoleOutput schema above. Expected rejection is a successful observation when it matches the retained expected kind/value; timeout or crash is not a case observation. " : "Planning/assessment command contract (for later host execution, not your role response): the host supplies readonly /input/verification-cases.json when it executes a declared check command. The descriptor contains case declarations, actual consumerFiles/fixtureFiles hashes and host-generated inputDigest. When planning, propose case declarations in the plan; do not assume a future check descriptor exists in your role workspace or invent its inputDigests or observed results. One check command may execute the ordered healthy/adverse cases internally. Declared check commands must report assertion IDs/pass states and ordered case IDs, host-supplied inputDigests, and observed return/rejection kind/value; these are executable observations, not planning claims. The verification stdout contract is separate from the RoleOutput schema above. Expected rejection is a successful observation when it matches the retained expected kind/value; timeout or crash is not a case observation. "}Never invent coverage or claim internal routing is host-attested. Findings can be mistaken; state evidence and uncertainty. Verified frozen-candidate reproduction is supported only for reviewer executions. Author and other roles' mutable-work observations remain unverified until required immutable host checks and independent adjudication; a reproduction declaration alone is not certified proof. Every raw finding still requires an independent disposition. The final assistant message must contain exactly one JSON object, no Markdown/prose, maximum128KiB. Owned check execution contract: ${JSON.stringify(verificationCommandContract)}. ${roleSemantics} ${o.role === 'adjudicator' && o.inputBundle.context.stage === 'planning-adjudication' ? implementationCarrySemantics : ''} Do not emit worker-chosen launch/work/producer IDs. Scope claims must describe actually supplied/read source ranges.`,
            ...(o.coordination ? { coordination: o.coordination } : {}),
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
                await o.beforeModelRequest(manager);
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
                toolArgs.set(event.toolCallId, event.args && typeof event.args === 'object' ? event.args : {});
                observe({ type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
            }
            if (event.type === 'tool_execution_end') {
                observe({ type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, result: event.result });
                if (!event.isError && event.toolName === 'read' && !collectorFailed) {
                    const args = toolArgs.get(event.toolCallId);
                    if (args && typeof args.path === 'string') {
                        try {
                            const effective = o.operations.validatePath(path.resolve(o.operations.workspaceRoot, args.path));
                            for (const source of o.inputBundle.sources) {
                                const toolPath = source.toolPath ?? (source.side === 'candidate' ? source.path : undefined);
                                if (toolPath && effective === o.operations.validatePath(path.resolve(o.operations.workspaceRoot, toolPath)) && reads.get(effective) === source.sha256) {
                                    const exposure = readExposure(o.launchId, source, args, event.result, event.toolCallId);
                                    if (exposure)
                                        result.exposures.push(exposure);
                                }
                            }
                        }
                        catch { /* Unmapped/unsupported read is ordinary evidence, not source exposure. */ }
                    }
                }
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
        else if (!settled || !last || last.stopReason !== 'stop') {
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
            else {
                result.selectedFinalEntryId = finalEntry!.id;
                const raw = finalTexts[0]!.text;
                result.rawFinalTruncated = Buffer.byteLength(raw) > MAX_FINAL_BYTES;
                result.rawFinal = result.rawFinalTruncated ? boundedPrefix(raw) : raw;
                if (result.rawFinalTruncated)
                    result.issues.push('PROTOCOL: final exceeds128KiB; retained prefix only');
                else {
                    const parsed = parseRoleOutput(raw, o.role, sourceFit, constraints);
                    result.protocol = parsed.value;
                    result.issues.push(...parsed.issues);
                    if (parsed.value?.implementationCarries !== undefined && o.inputBundle.context.stage !== 'planning-adjudication')
                        result.issues.push('PROTOCOL: implementation carry is only valid in planning-adjudication');
                    if (parsed.value)
                        result.issues.push(...exposureIssues(parsed.value.assessedScope, o.inputBundle.requiredScope, o.inputBundle, result.exposures));
                }
            }
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
                result.nativeCheckpoint = await nativeCheckpoint(pi.sessionManager.getSessionFile()!);
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
    return result;
}
