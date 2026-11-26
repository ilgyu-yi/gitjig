import { nativeConversationResult, type ResultRead } from './conversation-result.js';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { PublicationAction } from '../platform/github-publication.js';
import { assertNonFractionalInteger } from './tool-arguments.js';
/** Trusted closures capture source identity and authority; tool arguments cannot choose either. */
export type PiAssignment = {
    projectId: string;
    instructions: string;
    resultDependency?: boolean;
    operation?: 'investigate' | 'change';
} & ({
    conversationId: string;
    observedDirectionRevision: number;
    assignmentId?: string;
} | {
    conversationId?: never;
    observedDirectionRevision?: never;
    assignmentId?: never;
});
export type PiAssignmentResume = { assignmentId: string; conversationId: string; projectId: string; resultId: string; observedDirectionRevision: number; checkpoint: string };
export interface PiCoordination {
    report?(input: {
        text: string;
    }, toolCallId: string): unknown | Promise<unknown>;
    result?(input: ResultRead): unknown | Promise<unknown>;
    status(input: {
        conversationId?: string;
    }): unknown | Promise<unknown>;
    address(input: {
        conversationId: string;
        expectedGeneration: number;
        text: string;
        mode: 'steer' | 'follow-up';
        observedDirectionRevision: number;
    }): unknown | Promise<unknown>;
    assign(input: PiAssignment): unknown | Promise<unknown>;
    resumeAssignment?(input: PiAssignmentResume): unknown | Promise<unknown>;
    acknowledgeInput(input: {
        inputId: string;
        classification: 'explanation' | 'scope-change' | 'ambiguous';
        requirementIds: string[];
        summary: string;
    }): unknown | Promise<unknown>;
    integrate?(input: {
        reviewedAssignmentId: string;
        targetId: string;
    }): unknown | Promise<unknown>;
    merge?(input: {
        reviewedAssignmentId: string;
        targetId: string;
        branchOperationId: string;
    }): unknown | Promise<unknown>;
    publish?(input: {
        targetId: string;
        action: PublicationAction;
        reviewedAssignmentId?: string;
    }): unknown | Promise<unknown>;
    publishContribution?(input: {
        resourceId: string;
        revisionId: string;
        targetId: string;
    }): unknown | Promise<unknown>;
    effectInspect?(input: {
        operationId: string;
    }): unknown | Promise<unknown>;
    effectReconcile?(input: {
        operationId: string;
    }, signal?: AbortSignal): Promise<unknown>;
    recoverAssignment?(input: {
        assignmentId: string;
        expectedWorkEpoch: number;
        observedDirectionRevision: number;
        reason: string;
    }): unknown | Promise<unknown>;
    cancel?(input: {
        assignmentId: string;
        reason: string;
    }): unknown | Promise<unknown>;
    parent?(input: {
        childId: string;
        parentId: string | null;
        expectedRelationRevision: number;
    }): unknown | Promise<unknown>;
    /** Ordinary coordinator only. Must quiesce/reconcile sole native slot before returning. */
    wait?(input: {
        resultHandles: string[];
    }): Promise<unknown>;
}
const id = () => Type.String({ minLength: 1, maxLength: 512 });
const revision = () => Type.Unsafe<number>({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const exactRevisionFields = ['expectedGeneration', 'observedDirectionRevision', 'expectedWorkEpoch', 'expectedRelationRevision'] as const;
const exactRevisionTools = new Set(['conversation_address', 'conversation_assign', 'conversation_resume_assignment',
    'conversation_recover_assignment', 'conversation_parent', 'conversation_publish']);
const text = () => Type.String({ minLength: 1, maxLength: 128 * 1024 });
const strict = { additionalProperties: false };
const publicationAction = () => Type.Union([
    Type.Object({ kind: Type.Literal('create-issue'), title: Type.String({ minLength: 1, maxLength: 1024 }), body: Type.String({ maxLength: 128 * 1024 }) }, strict),
    Type.Object({ kind: Type.Literal('create-draft-pr'), title: Type.String({ minLength: 1, maxLength: 1024 }), body: Type.String({ maxLength: 128 * 1024 }), headRef: id(), headCommit: Type.String({ pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' }), baseRef: id() }, strict),
    Type.Object({ kind: Type.Literal('create-comment'), parent: Type.Object({ kind: Type.Union([Type.Literal('issue'), Type.Literal('pull-request')]), number: Type.Unsafe<number>({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), nodeId: id() }, strict), body: Type.String({ maxLength: 128 * 1024 }), purpose: Type.Union([Type.Literal('bootstrap'), Type.Literal('reviewed-summary')]) }, strict),
]);
export function createCoordinationTools(callbacks: PiCoordination, onWait: () => void): ToolDefinition[] {
    const captured = {
        ...(callbacks.report ? { report: callbacks.report.bind(callbacks) } : {}),
        ...(callbacks.result ? { result: callbacks.result.bind(callbacks) } : {}), status: callbacks.status.bind(callbacks), address: callbacks.address.bind(callbacks), assign: callbacks.assign.bind(callbacks),
        acknowledgeInput: callbacks.acknowledgeInput.bind(callbacks), ...(callbacks.integrate ? { integrate: callbacks.integrate.bind(callbacks) } : {}), ...(callbacks.merge ? { merge: callbacks.merge.bind(callbacks) } : {}), ...(callbacks.publish ? { publish: callbacks.publish.bind(callbacks) } : {}), ...(callbacks.publishContribution ? { publishContribution: callbacks.publishContribution.bind(callbacks) } : {}), ...(callbacks.effectInspect ? { effectInspect: callbacks.effectInspect.bind(callbacks) } : {}), ...(callbacks.effectReconcile ? { effectReconcile: callbacks.effectReconcile.bind(callbacks) } : {}), ...(callbacks.recoverAssignment ? { recoverAssignment: callbacks.recoverAssignment.bind(callbacks) } : {}), ...(callbacks.cancel ? { cancel: callbacks.cancel.bind(callbacks) } : {}), ...(callbacks.parent ? { parent: callbacks.parent.bind(callbacks) } : {}), ...(callbacks.wait ? { wait: callbacks.wait.bind(callbacks) } : {}),
    };
    const output = (value: unknown) => {
        const body = JSON.stringify(value);
        if (typeof body !== 'string' || Buffer.byteLength(body) > 128 * 1024)
            throw new Error('Coordination result unavailable: JSON output exceeds128KiB or is undefined');
        return { content: [{ type: 'text' as const, text: body }], details: {} };
    };
    const tools: ToolDefinition[] = [
        { name: 'conversation_status', label: 'Conversation status', description: 'Inspect registered conversation metadata. For current continuation, read assignments[].resume, reentry and the owner-action fields. On an explicit owner request to continue, use the applicable exact route and let its admission result decide. A named conversation can include recordedResult with temporalScope publication-only: it preserves the original governed publication. Its phase, blocked reasons, budgets and provider limits or reset times describe that attempt, even if its epoch still matches. They do not establish a current hold or current provider availability. Lists omit that snapshot. A named status can also include originalRecovery for the exact original assignment. A local-model-request-limit is the gitjig host ceiling. Current-result-unreadable or failure-cause-unverified asks the owner to inspect the retained evidence. A named direct coordinator can expose descendantRecovery with bounded publication-only outcomes and the original coordinatorConversationId. This does not supply current resume operands. Use conversation_resume_assignment when the original instructions still apply and conversation_assign for new instructions. Unavailable or omitted metadata does not mean no work occurred. Report retained isolated candidates separately from unchanged original files. Formal check counts do not describe manual author activity; observedCounts, when present, count actual assertions and cases in a selected passing report. Count assignment identities, not repeated reentry calls, as tasks. This read does not change focus, execute work, grant completion standing or authorize a retry.', parameters: Type.Object({ conversationId: Type.Optional(id()) }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.status(args as Parameters<PiCoordination['status']>[0])); } },
        { name: 'conversation_address', label: 'Address conversation', description: 'Queue attributed input to an explicit registered conversation/generation under existing authority. Never routes by selected pane.', parameters: Type.Object({ conversationId: id(), expectedGeneration: Type.Unsafe<number>({ type: 'integer', minimum: 0 }), text: text(), mode: Type.Union([Type.Literal('steer'), Type.Literal('follow-up')]), observedDirectionRevision: revision() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.address(args as Parameters<PiCoordination['address']>[0])); } },
        { name: 'conversation_assign', label: 'Assign conversation', description: 'Assign bounded project instructions under captured delegation. Include the child’s work and applicable owner constraints. Keep coordinator duties such as waiting, reading the result and reporting to the owner in the coordinator conversation. Keep your interpretation and implementation choices distinct from actual owner wording; quote source text exactly and do not turn an agent paraphrase into amended owner requirements. Omit conversationId to atomically create an ordinary child after validation; existing targets require their observed direction revision. A new-assignment limit does not report remaining execution or resolution allowance for existing work. For a retained governed task, inspect conversation_status. When the original instructions still apply, pass its available resume to conversation_resume_assignment. Use conversation_assign for new instructions on the original task, with the exact reentry assignmentId when supplied, conversationId, observedDirectionRevision, projectId, operation: change and explicit bounded instructions. A completed task requires that assignmentId to distinguish corrective feedback from a new task in the same conversation. Omitting the target requests a new assignment. Reentry still checks current authority, procedure and original work allowance. Choose operation explicitly: investigate is read-only; change queues the existing governed planning/implementation/review workflow for code changes after this tool returns. Accepted receipts include wait:{resultHandles:[assignmentId]}: pass that wait object unchanged to conversation_wait to await this task and end the turn, rather than polling with shell sleep. conversationId selects conversation_status; it is not a result handle. A retained-task owner-action hold returns accepted:false and instructionsAccepted:false without queuing. Retain those instructions, report the original outcome and ownerAction, and do not retry while that hold is current. Returns promptly; does not await the child or grant permissions from parenthood.', parameters: Type.Union([Type.Object({ conversationId: id(), assignmentId: Type.Optional(id()), projectId: id(), instructions: text(), observedDirectionRevision: revision(), resultDependency: Type.Optional(Type.Boolean()), operation: Type.Union([Type.Literal('investigate'), Type.Literal('change')]) }, strict), Type.Object({ projectId: id(), instructions: text(), resultDependency: Type.Optional(Type.Boolean()), operation: Type.Union([Type.Literal('investigate'), Type.Literal('change')]) }, strict)], { type: 'object' }), async execute(_id, args, signal) {
                signal?.throwIfAborted();
                const input = args as Parameters<PiCoordination['assign']>[0];
                if (!input || !Object.hasOwn(input, 'operation') || input.operation !== 'investigate' && input.operation !== 'change')
                    throw Error('ASSIGNMENT_OPERATION_REQUIRED: choose investigate for read-only work or change for governed implementation');
                return output(await captured.assign(input));
            } },
        { name: 'conversation_acknowledge_input', label: 'Acknowledge source input', description: 'Record a fallible interpretation of an actual input. Explanation does not release effects hold; required non-author source-fit decision remains mandatory.', parameters: Type.Object({ inputId: id(), classification: Type.Union([Type.Literal('explanation'), Type.Literal('scope-change'), Type.Literal('ambiguous')]), requirementIds: Type.Array(id(), { maxItems: 256, uniqueItems: true }), summary: text() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.acknowledgeInput(args as Parameters<PiCoordination['acknowledgeInput']>[0])); } },
    ];
    const resumeAssignment = callbacks.resumeAssignment?.bind(callbacks);
    if (resumeAssignment)
        tools.push({ name: 'conversation_resume_assignment', label: 'Resume original assignment',
            description: 'Continue an unfinished governed assignment within its original instructions and retained findings. Use the exact resume fields from conversation_status and pass the returned wait object to conversation_wait. Current authority, holds and remaining allowance still apply. Use conversation_assign when supplying new instructions.',
            parameters: Type.Object({ assignmentId: id(), conversationId: id(), projectId: id(), resultId: id(), observedDirectionRevision: revision(), checkpoint: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, strict),
            async execute(_id, args, signal) {
                signal?.throwIfAborted();
                return output(await resumeAssignment(args as PiAssignmentResume));
            } });
    if (captured.report)
        tools.push({ name: 'conversation_report', label: 'Report assigned result in English', description: 'Record the English result for the assigning coordinator separately from the human-facing assistant reply. Submit or update after the latest input and before your final reply. The host binds native provenance and does not translate the human reply or grant authority.', parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 65536 }) }, strict), async execute(id, args, signal) {
                signal?.throwIfAborted();
                return output(await captured.report!(args as {
                    text: string;
                }, id));
            } });
    if (captured.result)
        tools.push({ name: 'conversation_result', label: 'Read exact conversation result', description: 'Read one immutable observation by exact result ID under captured consumer scope. Use recordedResult to report the captured outcome, candidate, selected checks and review. The selected check count is the number of entries in the check roster before omission; an isolated control is paired with its check, not another roster entry. A row with consumerControl=matched records a separate isolated execution matching the planned outcome: consumerControlExpectedPass=true means it passed, otherwise the predicted fault was observed. Cite consumerControlReceiptId when present. When naming a verified behavior, use the actual evidence for that behavior. Attribute review judgments separately and disclose material behaviors the required check did not observe or whose coverage the supplied evidence cannot establish. A read of the original project does not inspect an isolated candidate. If recordedResult is absent in an older result, its evidence is unknown. New assigned runs expose a separately bound English coordinatorReport, not the human final answer. Unavailable reports cannot complete assignments. Large results return a bounded summary and fullJSON cursor/fingerprint. Read exact full JSON with both cursor and fingerprint on this same tool; concatenate page text. Use governed detail pages only for material facts missing from recordedResult. For exact retained details pass detail governed-work-detail/v1, fingerprint detailRef.sha256 and cursor 0, then follow nextCursor. If the needed evidence is unavailable, report that limit and give the inspection command. Detail pages never select current work. Never read native overflow files. For a failed active original task, inspect conversation_status for its same-task options. Use an available resume pointer with conversation_resume_assignment when existing instructions still apply. Only the independent governed producer can supply judgment. Historical v1 results retain their original meaning. Never selects latest, grants standing, or reads private history.', parameters: Type.Object({ resultId: id(), detail: Type.Optional(Type.Literal('governed-work-detail/v1')), cursor: Type.Optional(Type.Number({ minimum: 0, maximum: 16 * 1024 * 1024 - 1, multipleOf: 1 })), fingerprint: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })) }, strict), async execute(_id, args, signal) {
                signal?.throwIfAborted();
                const request = args as ResultRead;
                const value = await captured.result!(request.detail ? request : { resultId: request.resultId });
                signal?.throwIfAborted();
                return { content: [{ type: 'text' as const, text: nativeConversationResult(value, request) }], details: {} };
            } });
    if (captured.integrate)
        tools.push({ name: 'conversation_integrate', label: 'Integrate reviewed assignment', description: 'Ordinary coordinator: queue an existing reviewed assignment for one registered target under captured original delegation. Returns an operation/result handle promptly; actual current procedure, projection and authority are checked by the existing host. Does not await the child or grant merge permission.', parameters: Type.Object({ reviewedAssignmentId: id(), targetId: id() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.integrate!(args as Parameters<NonNullable<PiCoordination['integrate']>>[0])); } });
    if (captured.merge)
        tools.push({ name: 'conversation_merge', label: 'Merge reviewed existing PR', description: 'Ordinary coordinator: queue one exact reviewed assignment and its confirmed branch publication for an existing registered PR under a separate finite ordinary merge grant. Native policy, destination restriction, current evidence and separate platform approvals remain mandatory. Returns original result handle promptly; no grant, override, queue or stack permission.', parameters: Type.Object({ reviewedAssignmentId: id(), targetId: id(), branchOperationId: id() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.merge!(args as Parameters<NonNullable<PiCoordination['merge']>>[0])); } });
    if (captured.publish)
        tools.push({ name: 'conversation_publish', label: 'Queue scoped publication', description: 'Ordinary coordinator: queue one finite issue/draft PR/comment under captured original source/delegation. Returns a durable handle promptly. Host owns operation identity and current owner/source/payload procedure; this tool grants no permission or review-ready status.', parameters: Type.Object({ targetId: id(), action: publicationAction(), reviewedAssignmentId: Type.Optional(id()) }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.publish!(args as Parameters<NonNullable<PiCoordination['publish']>>[0])); } });
    if (captured.publishContribution)
        tools.push({ name: 'conversation_publish_contribution', label: 'Publish contribution revision', description: 'Queue a complete host-collected immutable contribution summary revision under captured original delegation. Host resolves exact body/native parent/provenance; fresh independent payload/source judgment and current authority remain mandatory. Returns promptly; no owner-mode bypass or model body/proof accepted.', parameters: Type.Object({ resourceId: id(), revisionId: id(), targetId: id() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.publishContribution!(args as Parameters<NonNullable<PiCoordination['publishContribution']>>[0])); } });
    if (captured.effectInspect)
        tools.push({ name: 'effect_inspect', label: 'Inspect owned effect', description: 'Inspect one operation under captured ownership. No new send, approval or focus change.', parameters: Type.Object({ operationId: id() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.effectInspect!(args as Parameters<NonNullable<PiCoordination['effectInspect']>>[0])); } });
    if (captured.effectReconcile)
        tools.push({ name: 'effect_reconcile', label: 'Reconcile owned effect', description: 'Read exact target/outcome for one owned operation without automatically retrying its send.', parameters: Type.Object({ operationId: id() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.effectReconcile!(args as Parameters<NonNullable<PiCoordination['effectReconcile']>>[0], signal)); } });
    if (captured.recoverAssignment)
        tools.push({ name: 'conversation_recover_assignment', label: 'Recover original assigned task', description: 'Current ordinary coordinator: explicitly restore admission for one cancelled direct governed assignment under the same original owner root. Preserves task/source/model/usage/findings. Does not launch work, resume dependencies, renew a grant or reauthorize any old integration. A separate original assignment reentry and current procedures are required.', parameters: Type.Object({ assignmentId: id(), expectedWorkEpoch: Type.Unsafe<number>({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), observedDirectionRevision: revision(), reason: Type.String({ minLength: 1, maxLength: 4096 }) }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.recoverAssignment!(args as Parameters<NonNullable<PiCoordination['recoverAssignment']>>[0])); } });
    if (captured.cancel)
        tools.push({ name: 'conversation_cancel', label: 'Cancel owned assignment', description: 'Cancel an explicit assignment handle and its provenance-owned subtree under captured authority. Graph parenthood grants no cancellation permission; no arbitrary process control.', parameters: Type.Object({ assignmentId: id(), reason: text() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.cancel!(args as Parameters<NonNullable<PiCoordination['cancel']>>[0])); } });
    if (captured.parent)
        tools.push({ name: 'conversation_parent', label: 'Conversation parent', description: 'Change an explicit graph edge under captured scope, without changing permissions, cancellation provenance, or human focus.', parameters: Type.Object({ childId: id(), parentId: Type.Union([id(), Type.Null()]), expectedRelationRevision: revision() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.parent!(args as Parameters<NonNullable<PiCoordination['parent']>>[0])); } });
    if (captured.wait)
        tools.push({ name: 'conversation_wait', label: 'Wait for results', description: 'Ordinary coordinator: pass the accepted conversation_assign or conversation_resume_assignment receipt\'s wait object unchanged. resultHandles are assignmentId values, never conversationId or workId. Successful admission quiesces native input and ends this turn; do not substitute shell sleep or status polling. Cancelled or unavailable originals instead return recovery guidance without ending the turn. Strict workflow roles do not have this tool.', parameters: Type.Object({ resultHandles: Type.Array(id(), { minItems: 1, maxItems: 64, uniqueItems: true, description: 'Assignment IDs from an accepted assignment or resume receipt. Use wait.resultHandles. Conversation IDs and work IDs are not wait handles.' }) }, strict), async execute(_id, args, signal) {
            signal?.throwIfAborted();
            const value = await captured.wait!(args as Parameters<NonNullable<PiCoordination['wait']>>[0]);
            if (!value || typeof value !== 'object' || !('waiting' in value) || typeof value.waiting !== 'boolean') throw new Error('Original wait admission receipt unavailable');
            const result = output(value);
            if (!value.waiting) return result;
            onWait();
            return { ...result, terminate: true };
        } });
    for (const tool of tools) {
        if (!exactRevisionTools.has(tool.name)) continue;
        tool.prepareArguments = args => {
            const input = args as Record<string, unknown> | null;
            for (const field of exactRevisionFields)
                assertNonFractionalInteger(input?.[field]);
            if (tool.name === 'conversation_publish') {
                const action = input?.action as {kind?: string; parent?: {number?: unknown}} | undefined;
                if (action?.kind === 'create-comment') assertNonFractionalInteger(action.parent?.number);
            }
            return args;
        };
    }
    return tools;
}
