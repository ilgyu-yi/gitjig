import { roleInputEvidenceManifests } from './role-input-evidence.js';
import { renderedReadRange } from '../pi/read-range.js';
import { assessedLineCount } from './source-scope.js';
import { NativeRoleCollector, readNativeRoleOutput, nativeRoleIntentReceipt } from './native-role-output.js';
import { assertNoSubmissionIssues } from './native-submission-source.js';
import type { StructuredOutputIntent } from '../pi/structured-output.js';
import { defaultNativeRoleTurns, defaultRoleBounds } from './execution-bounds.js';
import { roleFraming, nativeRoleFraming } from './role-framing.js';
import { sourceFitAuthorityIssue, sourceFitRequirementDomain } from './role-input.js';
import path from 'node:path';
import { createPiSession, type PiSession } from '../pi/session.js';
import type { PiProjectOperations } from '../pi/operations.js';
import { captureProjectExecutionContext } from '../execution/project-context.js';
import { readNativeHistorySnapshot } from '../controller/history.js';
import { parseRoleOutput, assertDispositionEvidence, dispositionAccountingState, implementationCarryProposals, MAX_FINAL_BYTES } from './protocol.js';
import { equivalenceAccounting, assertResolvedEquivalenceEvidence, captureCurrentPendingSubjects, assertCurrentPendingAccounting, type AccountingState, type DispositionHead } from './adjudication-accounting.js';
import { latestDispositionFootprint } from './disposition-history.js';
import { consumerControlInputConflict, coverageIssue, hasCompleteStrategyAccounting, pendingCheckForAmendment, verificationReferenceDiagnostics } from './verification-strategy.js';
import { changedPlanningRepairHash } from './planning-repair.js';
import { protocolEnums } from './role-output-shape.js';
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
        o.nativeLifecycle = { ready: options.nativeLifecycle.ready.bind(options.nativeLifecycle), settling: options.nativeLifecycle.settling.bind(options.nativeLifecycle), released: options.nativeLifecycle.released.bind(options.nativeLifecycle), ...(options.nativeLifecycle.activity ? { activity: options.nativeLifecycle.activity.bind(options.nativeLifecycle) } : {}) };
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
    const maxProviderRequests = o.maxProviderRequests ?? defaultRoleBounds.maxProviderRequests, timeoutMs = o.timeoutMs ?? defaultRoleBounds.timeoutMs, maxNativeTurns = o.maxNativeTurns ?? defaultNativeRoleTurns;
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
        if (o.nativeCarrier && !nativeStructured) throw Error('NATIVE_SUBMISSION_PROVIDER_UNSUPPORTED: an explicit submission carrier requires the owned Claude bridge');
        if (!Number.isSafeInteger(maxProviderRequests) || maxProviderRequests < 1 || maxProviderRequests > 100)
            throw new Error('Provider request cap must be1..100');
        if (!Number.isSafeInteger(maxNativeTurns) || maxNativeTurns < 1 || maxNativeTurns > 100 || o.maxNativeTurns !== undefined && !nativeStructured)
            throw new Error('Native turn bound1..100 requires an owned Claude role');
        if (timeoutMs !== null) {
            if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000)
                throw new Error('Role timeout must be null or1..600000ms');
            timer = setTimeout(() => deadline.abort(new Error('Role deadline exceeded')), timeoutMs);
            timer.unref();
        }
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
        if (Boolean(evidence) !== Boolean(manifests.length) || evidence && (manifests.some(manifest => manifest.role !== o.role || manifest.stage !== o.inputBundle.context.stage) || evidence.launchId !== o.launchId || hashText(JSON.stringify(evidence.manifests)) !== hashText(JSON.stringify(manifests)))) throw Error('Original role evidence binding unavailable');
        if (evidence) {
            evidence.manifests = manifests;
            if (o.nativeIdentity && manifests.some(manifest => o.nativeIdentity!.workId !== manifest.workId)) throw Error('Original role evidence receiver changed');
            result.evidenceReads = [];
        }
        const native = nativeStructured ? nativeRoleFraming(o.role,o.inputBundle,o.launchId,maxNativeTurns,o.nativeCarrier,maxProviderRequests) : undefined;
        const framing = native ?? roleFraming(o.role,o.inputBundle,false,{maxProviderRequests});
        sourceFit = framing.sourceFit;
        const { prompt, systemPrompt, constraints } = framing;
        // Capture canonical host operands, before wire-only body/identity sharing.
        // Standalone callers without original subjects provide no effect-domain
        // precheck; the eventual host remains authoritative in every case.
        const references = constraints.decisionReferences;
        const currentPending = o.role === 'adjudicator' && o.inputBundle.context.stage === 'planning-adjudication'
            ? captureCurrentPendingSubjects(references, o.inputBundle.context.producerDiagnostics) : undefined;
        const pendingObligations = o.inputBundle.context.pendingObligations;
        const subjectRows = o.inputBundle.context.occurrences;
        const subjects = new Map<string, {finding: unknown; synthetic: boolean}>();
        if (o.role === 'adjudicator' && references && Array.isArray(subjectRows)) {
            const seen = new Set<string>();
            for (const row of subjectRows) {
                if (!row || typeof row !== 'object' || !references.occurrenceIds.includes(row.id)) continue;
                if (seen.has(row.id)) { subjects.delete(row.id); continue; }
                seen.add(row.id);
                if (!row.data || typeof row.data !== 'object' || !Object.hasOwn(row.data,'finding')) continue;
                const finding = structuredClone(row.data.finding);
                if (finding && typeof finding==='object') {
                    if (Array.isArray(finding.evidence)) Object.freeze(finding.evidence);
                    Object.freeze(finding);
                }
                subjects.set(row.id, Object.freeze({finding,synthetic:references.diagnosisOccurrenceIds.includes(row.id)}));
            }
        }
        const priorHeads = new Map<string, DispositionHead>(), priorStates = new Map<string, AccountingState>();
        // Only an explicitly captured latest view supplies historical topology.
        // A retention choice alone cannot prove that an old edge stays closed.
        if (o.role === 'adjudicator' && references && latestDispositionFootprint(o.inputBundle.context, o.role)) {
            const known = new Set(references.occurrenceIds), seenHeads = new Set<string>(), ambiguousStates = new Set<string>();
            for (const row of o.inputBundle.context.dispositions as any[]) {
                if (!known.has(row.occurrence)) continue;
                if (seenHeads.has(row.occurrence)) {
                    priorHeads.delete(row.occurrence); continue;
                }
                seenHeads.add(row.occurrence);
                const data = row.data;
                if (!data || !protocolEnums.disposition.includes(data.disposition) || data.disposition !== row.status ||
                    data.disposition === 'equivalent' && !known.has(data.equivalentTo)) continue;
                priorHeads.set(row.occurrence, Object.freeze({disposition: data.disposition,
                    ...(data.disposition === 'equivalent' ? {equivalentTo: data.equivalentTo} : {})}));
            }
            const states = o.inputBundle.context.obligationStates;
            if (Array.isArray(states)) for (const row of states) {
                if (!row || !known.has(row.id)) continue;
                if (priorStates.has(row.id) || ambiguousStates.has(row.id)) {
                    priorStates.delete(row.id); ambiguousStates.add(row.id); continue;
                }
                const state = row.data?.state;
                priorStates.set(row.id, state === 'resolved' && row.currentPending === false ? 'resolved' :
                    state === 'pending' && row.currentPending === true ? 'pending' : 'unknown');
            }
        }
        const outputAdmissionIssues = (protocol: NonNullable<RoleExecution['protocol']>): string[] => {
            const issues:string[]=[];
            try { assertCurrentPendingAccounting(protocol, currentPending); }
            catch (error) { issues.push(`PLANNING_ACCOUNTING: ${String(error)}`); }
            // Only a submission tool can return this feedback to the original planner.
            const planner = intent?.version === 3 && o.role === 'planner' && o.inputBundle.context.stage === 'planning' ? protocol.plan : undefined;
            const proposal = planner && hasCompleteStrategyAccounting(planner) ? planner :
                o.role === 'adjudicator' && o.inputBundle.context.stage === 'planning-adjudication' &&
                protocol.planAccepted === true && !protocol.ownerDecisionRequired?.length ?
                    protocol.acceptedPlan ?? constraints.proposalApproval?.proposal : undefined;
            if (intent?.version === 3 && (constraints.planningProfile?.version ?? 0) >= 12 && Array.isArray(pendingObligations)) {
                const amendments = (planner ?? proposal)?.verification.checkAmendments ?? [];
                for (const [index, amendment] of amendments.entries()) {
                    try { pendingCheckForAmendment(pendingObligations, amendment.obligationId); }
                    catch (error) { issues.push(`PLAN_VERIFICATION: verification.checkAmendments[${index}]: ${String(error)}`); break; }
                }
            }
            if (constraints.planningProfile?.supported && proposal) {
                const issue = coverageIssue(proposal) ?? (intent?.version === 3 && constraints.planningProfile.version >= 11
                    ? consumerControlInputConflict(proposal) : undefined);
                if (issue) issues.push('PLAN_VERIFICATION: ' + JSON.stringify({issue:issue.slice(0,256),
                    omittedMessageCharacters:Math.max(0,issue.length-256), referenceDiagnostics:verificationReferenceDiagnostics(proposal)}));
            }
            const sourceFit = constraints.sourceFitReferences;
            if (intent?.version === 3 && sourceFit && sourceFitRequirementDomain(sourceFit, protocol, constraints.proposalApproval)) {
                const chain = o.inputBundle.context.sourceInputChain;
                for (const decision of protocol.inputDecisions ?? []) {
                    const origin = Array.isArray(chain) ? chain.find(input => input?.input_id === decision.inputId &&
                        input.revision === decision.directionRevision && input.data?.effectHold === true)?.sourceOrigin : undefined;
                    const issue = sourceFitAuthorityIssue(decision.impact, origin);
                    if (issue) { issues.push('SOURCE_FIT_AUTHORITY: ' + issue); break; }
                }
            }
            const planRepairs = protocol.decisions?.filter(decision => decision.repair);
            if (planRepairs?.length) {
                try {
                    if (!proposal) throw Error('To resolve a plan defect as repaired, set planAccepted:true for your corrected plan and supply the complete acceptedPlan. Use planAccepted:false if the proposal remains unaccepted, with the defect still pending.');
                    changedPlanningRepairHash(proposal, planRepairs);
                } catch (error) { issues.push(`PLAN_REPAIR: ${String(error)}`); }
            }
            const assigned = new Set(implementationCarryProposals(protocol,constraints.decisionCarry).map(carry=>carry.occurrenceId));
            for (const decision of protocol.decisions??[]) {
                const subject=subjects?.get(decision.occurrenceId);
                if (!subject) continue; // Absent/omitted source is not an invented core.
                // The decoder already matched this typed operand against the captured receipt and sibling decisions.
                const diagnosis = constraints.diagnosisEligibility?.version === 2 ? decision.diagnosis : undefined;
                try { assertDispositionEvidence(decision, subject.finding, subject.synthetic, diagnosis); }
                catch (error) { issues.push(`DECISION_EVIDENCE: ${String(error)}`); }
                if (assigned.has(decision.occurrenceId) && dispositionAccountingState(decision,subject.finding,{}) === 'resolved')
                    issues.push(`DECISION_ACCOUNTING: Implementation carry requires a finding that remains pending: ${decision.occurrenceId}. This decision resolves it. Preserve the actual judgment and witnesses. Use implementation with kind 'none' for a required explicit action, or omit the legacy implementationCarry. Do not invent a pending duty.`);
            }
            if (subjects?.size) try {
                const fresh = new Map((protocol.decisions ?? []).map(decision => [decision.occurrenceId, decision]));
                const heads = new Map<string, DispositionHead | undefined>(priorHeads);
                for (const [id, decision] of fresh) heads.set(id, subjects.has(id) ? decision : undefined);
                const states = equivalenceAccounting(heads, (id, head) => {
                    if (!head) return 'unknown';
                    const decision = fresh.get(id), subject = subjects.get(id);
                    return decision ? subject ? dispositionAccountingState(decision, subject.finding, {}) : 'unknown'
                        : priorStates.get(id) ?? 'unknown';
                });
                assertResolvedEquivalenceEvidence((protocol.decisions ?? []).filter(decision => subjects.has(decision.occurrenceId)), states);
            } catch (error) { issues.push(`DECISION_EVIDENCE: ${String(error)}`); }
            return issues;
        };
        intent = native?.intent;
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
                if (parsed.value) result.issues.push(...outputAdmissionIssues(parsed.value));
                if (parsed.value) result.issues.push(...exposureIssues(parsed.value.assessedScope, o.inputBundle.requiredScope, o.inputBundle, result.exposures, observedSources));
            }
        };
        pi = await createPiSession({ host: o.host, operations: ops, model: o.model,
            ...(o.nativeIdentity && o.nativeLifecycle?.activity ? { onProviderActivity: activity => o.nativeLifecycle!.activity!(o.nativeIdentity!, activity) } : {}),
            roleContextBudget: { assertEntry: entry, ...(intent ? {structuredOutput:{intent,async observe(data: unknown, manager) {
                if (!nativeCollector || nativeCollector.manager !== manager) throw Error('Native role observer has no original dispatch checkpoint');
                try { await nativeCollector.observe(data); }
                catch (error) {
                    collectorFailed = true;
                    result.issues.push(`NATIVE_COLLECTOR:${String(error)}`);
                    throw error;
                }
            }, ...(intent.version === 3 ? {
                checkSubmission(args: unknown) {
                    entry();
                    const candidate = JSON.stringify(args);
                    if (candidate === undefined) return;
                    // Report the protocol reason before Pi's conditional schema validation.
                    assertNoSubmissionIssues(parseRoleOutput(candidate, o.role, sourceFit, constraints).issues);
                },
                submit(id: string, args: unknown, manager, toolSignal) {
                    entry();
                    if (!nativeCollector || nativeCollector.manager !== manager) throw Error('Role submission has no original dispatch checkpoint');
                    return nativeCollector.submitObserved(id,args,raw=>{
                        const parsed = parseRoleOutput(raw,o.role,sourceFit,constraints);
                        if (!parsed.value) return parsed.issues;
                        return [...outputAdmissionIssues(parsed.value),...exposureIssues(parsed.value.assessedScope,o.inputBundle.requiredScope,o.inputBundle,
                            [...result.exposures,...promptExposures(o.launchId,o.inputBundle)],observedSources)];
                    },toolSignal?AbortSignal.any([signal,toolSignal]):signal);
                }} : {})}} : {}) }, maxReadBytes: o.maxReadBytes ?? 1024 * 1024,
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
                                sha256: source.sha256, lineCount: assessedLineCount(observation.text, o.inputBundle.context) };
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
                if (result.providerRequests >= maxProviderRequests) {
                    result.requestLimit = {version: 1, kind: 'role-request-limit', used: result.providerRequests, limit: maxProviderRequests};
                    throw new Error(`Provider request cap exceeded:${maxProviderRequests}`);
                }
                if (intent && !nativeCollector) nativeCollector = await NativeRoleCollector.create(manager, intent, o.host);
                entry();
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
        const finalEntry = pi.sessionManager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant');
        const last = finalEntry?.type === 'message' && finalEntry.message.role === 'assistant' ? finalEntry.message : undefined;
        // Retain the provider's last display cause even when an observer failed;
        // entry still refuses selection and the collector issue prevents attribution.
        if (collectorFailed && last?.stopReason === 'error') result.issues.push(`PROVIDER:${last.errorMessage ?? 'error'}`);
        entry();
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
            await nativeCollector.seal();
            entry();
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
            try { await pi.closeOwned(); }
            catch(error) { result.issues.push(`NATIVE_CLOSE:${String(error)}`); }
            try {
                await nativeCollector?.seal();
                nativeCollector?.materialize();
                const snapshot = await readNativeHistorySnapshot(pi.sessionManager.getSessionFile()!);
                result.nativeCheckpoint = snapshot.checkpoint;
                if (result.nativeSource && result.selectedFinalEntryId) {
                    if (readNativeRoleOutput(snapshot.entries, result.selectedFinalEntryId,
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
    if (result.terminal === 'complete' && result.protocol !== null && result.issues.length === 0) {
        try { entry(); }
        catch (error) {
            result.terminal = signal.aborted ? 'aborted' : 'error';
            result.issues.push(String(error));
        }
    }
    result.usable = result.terminal === 'complete' && result.protocol !== null && result.issues.length === 0;
    // Extra collector/checkpoint/lifecycle failures keep cause attribution generic.
    if (result.terminal === 'error' && result.nativeCheckpoint && result.issues.length === 1 && result.issues[0]!.startsWith('PROVIDER:')) {
        const failure = nativeCollector?.usageLimit();
        if (failure) result.providerFailure = failure;
        const formatter = nativeCollector?.formatterError();
        if (formatter) result.issues.unshift(`EARLIER_NATIVE_FORMATTER: ${formatter.message} (tool ${formatter.toolUseId}, original entry ${formatter.sourceEntryId})`);
    }
    return result;
}
