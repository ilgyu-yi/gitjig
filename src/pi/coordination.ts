import { nativeConversationResult, type ResultRead } from './conversation-result.js';
import { Type } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { PublicationAction } from '../platform/github-publication.js';
/** Trusted closures capture source identity and authority; tool arguments cannot choose either. */
export type PiAssignment = {
    projectId: string;
    instructions: string;
    resultDependency?: boolean;
    operation?: 'investigate' | 'change';
} & ({
    conversationId: string;
    observedDirectionRevision: number;
} | {
    conversationId?: never;
    observedDirectionRevision?: never;
});
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
// Pi converts Type.Integer fractions by truncation. Opaque public integer
// schemas preserve the native wire contract and reject those lossy operands.
const revision = () => Type.Unsafe<number>({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
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
        { name: 'conversation_status', label: 'Conversation status', description: 'Inspect registered conversation metadata. No focus change or new execution.', parameters: Type.Object({ conversationId: Type.Optional(id()) }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.status(args as Parameters<PiCoordination['status']>[0])); } },
        { name: 'conversation_address', label: 'Address conversation', description: 'Queue attributed input to an explicit registered conversation/generation under existing authority. Never routes by selected pane.', parameters: Type.Object({ conversationId: id(), expectedGeneration: Type.Unsafe<number>({ type: 'integer', minimum: 0 }), text: text(), mode: Type.Union([Type.Literal('steer'), Type.Literal('follow-up')]), observedDirectionRevision: revision() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.address(args as Parameters<PiCoordination['address']>[0])); } },
        { name: 'conversation_assign', label: 'Assign conversation', description: 'Assign bounded project instructions under captured delegation. Omit conversationId to atomically create an ordinary child after validation; existing targets require their observed direction revision. Operation defaults to investigate; explicit change queues the existing governed planning/implementation/review workflow after this tool returns. Returns promptly; does not await the child or grant permissions from parenthood.', parameters: Type.Union([Type.Object({ conversationId: id(), projectId: id(), instructions: text(), observedDirectionRevision: revision(), resultDependency: Type.Optional(Type.Boolean()), operation: Type.Optional(Type.Union([Type.Literal('investigate'), Type.Literal('change')])) }, strict), Type.Object({ projectId: id(), instructions: text(), resultDependency: Type.Optional(Type.Boolean()), operation: Type.Optional(Type.Union([Type.Literal('investigate'), Type.Literal('change')])) }, strict)], { type: 'object' }), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.assign(args as Parameters<PiCoordination['assign']>[0])); } },
        { name: 'conversation_acknowledge_input', label: 'Acknowledge source input', description: 'Record a fallible interpretation of an actual input. Explanation does not release effects hold; required non-author source-fit decision remains mandatory.', parameters: Type.Object({ inputId: id(), classification: Type.Union([Type.Literal('explanation'), Type.Literal('scope-change'), Type.Literal('ambiguous')]), requirementIds: Type.Array(id(), { maxItems: 256, uniqueItems: true }), summary: text() }, strict), async execute(_id, args, signal) { signal?.throwIfAborted(); return output(await captured.acknowledgeInput(args as Parameters<PiCoordination['acknowledgeInput']>[0])); } },
    ];
    if (captured.report)
        tools.push({ name: 'conversation_report', label: 'Report assigned result in English', description: 'Record the English result for the assigning coordinator separately from the human-facing assistant reply. Submit or update after the latest input and before your final reply. The host binds native provenance and does not translate the human reply or grant authority.', parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 65536 }) }, strict), async execute(id, args, signal) {
                signal?.throwIfAborted();
                return output(await captured.report!(args as {
                    text: string;
                }, id));
            } });
    if (captured.result)
        tools.push({ name: 'conversation_result', label: 'Read exact conversation result', description: 'Read one immutable observation by exact result ID under captured consumer scope. New assigned runs expose a separately bound English coordinatorReport, not the human final answer. Unavailable reports cannot complete assignments. Large results return a bounded summary and fullJSON cursor/fingerprint. Read exact full JSON with both cursor and fingerprint on this same tool; concatenate page text. For governed-work-observation/v1, detailRef names the exact retained snapshot: pass detail governed-work-detail/v1, fingerprint detailRef.sha256 and cursor 0, then follow nextCursor. Detail pages never select current work. Never read native overflow files. For a failed active original task, inspect conversation_status for a same-task request; only the independent governed producer can supply judgment. Historical v1 results retain their original meaning. Never selects latest, grants standing, or reads private history.', parameters: Type.Object({ resultId: id(), detail: Type.Optional(Type.Literal('governed-work-detail/v1')), cursor: Type.Optional(Type.Number({ minimum: 0, maximum: 16 * 1024 * 1024 - 1, multipleOf: 1 })), fingerprint: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })) }, strict), async execute(_id, args, signal) {
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
        tools.push({ name: 'conversation_wait', label: 'Wait for results', description: 'Ordinary coordinator: wait for original results by quiescing native input and ending this turn. Cancelled or unavailable originals instead return recovery guidance without ending the turn. Strict workflow roles do not have this tool.', parameters: Type.Object({ resultHandles: Type.Array(id(), { minItems: 1, maxItems: 64, uniqueItems: true }) }, strict), async execute(_id, args, signal) {
            signal?.throwIfAborted();
            const value = await captured.wait!(args as Parameters<NonNullable<PiCoordination['wait']>>[0]);
            if (!value || typeof value !== 'object' || !('waiting' in value) || typeof value.waiting !== 'boolean') throw new Error('Original wait admission receipt unavailable');
            const result = output(value);
            if (!value.waiting) return result;
            onWait();
            return { ...result, terminate: true };
        } });
    return tools;
}
