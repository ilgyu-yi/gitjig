import { createHash } from 'node:crypto';
import type { HostedQuery } from './host.js';
// Query state: QueryContext class.
//
// All per-query and per-turn mutable state lives here. Reentrant queries
// (subagents) each get their own QueryContext instance, managed by index.ts.
// Adding a new field = one property on the class.
//
// Extracted from index.ts so tests can import without activating the extension.

import type { AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { McpResult } from "./extract-tool-results.js";
import type { PromptStream } from "./prompt-stream.js";

export interface PendingToolCall {
	toolName: string;
	resolve: (result: McpResult) => void;
}

type NativeTool = { id: string; name: string; messageId?: string; discarded?: boolean; cohortComplete?: boolean; input?: Record<string, unknown>; digest: string; staged: boolean; reserved: boolean; published: boolean };
function capturedInput(input: unknown): { input: Record<string, unknown>; digest: string } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('BRIDGE_HOST_TOOL_INPUT_UNAVAILABLE');
    const text = JSON.stringify(input, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('BRIDGE_HOST_TOOL_INPUT_UNAVAILABLE');
    return { input: parsed, digest: createHash('sha256').update(text).digest('hex') };
}

export class QueryContext {
    // Native proposals and actual MCP invocations rendezvous here. These records
    // outlive a Pi turn; consumed IDs keep only a digest to reject late replay.
    private nativeTools = new Map<string, NativeTool>();
    private nativeToolsClosed = false;
    readonly nativeResultsOutstanding = new Set<string>();
    nativeToolFailure?: Error;
    onNativeToolsReady?: () => void;
    onNativeToolFailure?: (error: Error) => void;
    nativeToolDeliveryHeld = false;
    nativeStreamTools = new Map<number, { id: string; name: string; input: Record<string, unknown>; partial: string }>();
    nativeStreamMessageId?: string;
    nativeStreamedMessages = new Set<string>();
    private nativeTool(id: string, name: string, input: unknown): NativeTool {
        if (this.nativeToolsClosed) throw Error('BRIDGE_HOST_TOOL_ADMISSION_CLOSED');
        if (typeof id !== 'string' || !id || typeof name !== 'string' || !name) throw Error('BRIDGE_HOST_TOOL_IDENTITY_UNAVAILABLE');
        const captured = capturedInput(input), old = this.nativeTools.get(id);
        if (old && (old.discarded || old.name !== name || old.digest !== captured.digest)) throw Error('BRIDGE_HOST_TOOL_INVOCATION_MISMATCH');
        if (old) return old;
        const call = { id, name, ...captured, staged: false, reserved: false, published: false };
        this.nativeTools.set(id, call); return call;
    }
    failNativeTool(error: unknown): Error {
        const failure = error instanceof Error ? error : Error('BRIDGE_HOST_TOOL_INVOCATION_UNAVAILABLE');
        if (!this.nativeToolFailure) {
            this.nativeToolFailure = failure; this.nativeToolsClosed = true;
            this.onNativeToolFailure?.(failure);
        }
        return failure;
    }
    stageNativeTool(id: string, name: string, input: unknown, messageId?: string, cohortComplete = true): void {
        try {
            const call = this.nativeTool(id, name, input); call.staged = true; call.messageId ??= messageId; call.cohortComplete ||= cohortComplete;
            this.onNativeToolsReady?.();
        } catch (error) { throw this.failNativeTool(error); }
    }
    reserveNativeTool(id: string, name: string, input: unknown): void {
        try {
            const call = this.nativeTool(id, name, input);
            if (call.reserved || call.published) throw Error('BRIDGE_HOST_TOOL_INVOCATION_DUPLICATE');
            call.reserved = true; this.onNativeToolsReady?.();
        } catch (error) { throw this.failNativeTool(error); }
    }
    completeNativeCohort(messageId: string | undefined): void {
        for (const call of this.nativeTools.values()) {
            if (call.staged && call.messageId === messageId) call.cohortComplete = true;
        }
        this.onNativeToolsReady?.();
    }
    consumeNativeResults(ids: readonly string[]): void {
        for (const id of ids) this.nativeResultsOutstanding.delete(id);
    }
    discardNativeProposals(messageId: string | undefined): void {
        if (!messageId) return;
        for (const call of this.nativeTools.values()) {
            if (call.messageId !== messageId || call.reserved || call.published) continue;
            call.discarded = true; call.input = undefined;
        }
    }
    takeAdmittedNativeTools(): Array<{ id: string; name: string; input: Record<string, unknown> }> {
        if (this.nativeToolFailure) throw this.nativeToolFailure;
        if (this.nativeToolsClosed || this.nativeToolDeliveryHeld) return [];
        const ready: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        for (const call of this.nativeTools.values()) {
            if (call.discarded || !call.staged || !call.cohortComplete || !call.reserved || call.published) continue;
            call.published = true; this.nativeResultsOutstanding.add(call.id); ready.push({ id: call.id, name: call.name, input: call.input! });
            call.input = undefined;
        }
        return ready;
    }
    assertNativeToolsInvoked(): void {
        if (this.nativeToolFailure) throw this.nativeToolFailure;
        if ([...this.nativeTools.values()].some(call => !call.published && !call.discarded)) throw Error('BRIDGE_HOST_TOOL_NOT_INVOKED');
    }
    openNativeTools(): void {
        this.nativeTools.clear(); this.nativeResultsOutstanding.clear(); this.nativeToolsClosed = false; this.nativeToolFailure = undefined;
        this.nativeStreamTools.clear(); this.nativeStreamedMessages.clear(); this.nativeStreamMessageId = undefined;
        this.nativeToolDeliveryHeld = false; this.onNativeToolsReady = undefined; this.onNativeToolFailure = undefined;
    }
    closeNativeTools(): void {
        this.nativeToolsClosed = true; this.onNativeToolsReady = undefined; this.onNativeToolFailure = undefined;
        this.nativeStreamTools.clear();
        for (const call of this.nativeTools.values()) call.input = undefined;
    }
	hostQuery?: HostedQuery;
	// Query-scoped (fully isolated per query)
	activeQuery: unknown | null = null;
	currentPiStream: AssistantMessageEventStream | null = null;
	latestCursor = 0;
	pendingToolCalls = new Map<string, PendingToolCall>();
	pendingResults = new Map<string, McpResult>();
	/** tool_use ids emitted this turn. Sole purpose is routing a delivered result
	 *  to the owning query when several queries are in flight — pairing a result
	 *  to its call is done by id from Claude's tools/call _meta, not from here. */
	turnToolCallIds: string[] = [];
	/** Streaming-input handle for the active query — how steers reach CC mid-turn. */
	promptStream: PromptStream | null = null;
	/** Host language guidance last acknowledged by this native query. */
	languageSection: string | null = null;
	languageFailure: Error | undefined;
	/** Last rate-limit rejection seen on this query. Claude Code sends it just before the
	 *  failure it caused, which is the only thing tying the two together. */
	rateLimitRejection: { rateLimitType?: string; resetsAt?: number } | null = null;
	/** Highest 5% utilization bucket we notified for, so repeat rate_limit_event spam is suppressed. */
	lastRateLimitWarnStep: number | null = null;
	lastRateLimitWarnThreshold: number | undefined;
	/** pi session this query serves, from SimpleStreamOptions.sessionId at fresh-query
	 *  setup. A bridge process serves several pi sessions at once (subagents run their
	 *  own AgentSessions), and history rewrites must only discard the rewriting
	 *  session's parked queries — this is the match key. Null when the host did not
	 *  supply an id.
	 */
	piSessionId: string | null = null;
	/** pi rewrote the history this query was built from (session_compact,
	 *  session_tree in its own pi session). Set by markRebuildForSession, consumed
	 *  by the tool-result delivery that discards the query. Not session-wide state:
	 *  it dies with the context it belongs to, so it cannot leak into later turns
	 *  the way a module flag does.
	 */
	historyStale = false;
	/** A steer never reached CC. A first query has no session mirror yet, so
	 *  completion must carry this into the mirror it creates. */
	missedSteer = false;

	// Per-turn (reset together)
	turnOutput: AssistantMessage | null = null;
	turnStarted = false;
	turnSawStreamEvent = false;
	turnSawToolCall = false;
	/** API message id from the last message_start, and whether its message_stop has
	 *  arrived. An `assistant` message under a different id while the stream is still
	 *  open is Claude Code's non-streaming fallback for a stalled stream. */
	turnStreamMessageId: string | undefined;
	turnStreamOpen = false;
	/** turnBlocks length at that message_start: where an abandoned attempt's blocks begin. */
	turnStreamBlockStart = 0;

	get turnBlocks(): Array<any> {
		if (!this.turnOutput) throw new Error("turnBlocks accessed before resetTurnState");
		return this.turnOutput.content;
	}

	/** Answer every parked MCP handler with `reason` and forget the turn's queued
	 *  results. Called when the query it belongs to is going away (abort, error,
	 *  normal end). Handlers must be *resolved*, not rejected: an error reply is
	 *  still a reply, and a handler left awaiting a subprocess that is gone keeps
	 *  CC's tools/call open forever, which wedges pi's turn behind it. */
	releasePendingToolCalls(reason: string): void {
		for (const pending of this.pendingToolCalls.values()) pending.resolve({ content: [{ type: "text", text: reason }] });
		this.pendingToolCalls.clear();
		this.pendingResults.clear();
	}

	resetTurnState(model: Model<any>): void {
		this.turnOutput = {
			role: "assistant", content: [],
			api: model.api, provider: model.provider, model: model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop", timestamp: Date.now(),
		};
		this.turnStarted = false;
		this.turnSawStreamEvent = false;
		this.turnSawToolCall = false;
		this.turnStreamMessageId = undefined;
		this.turnStreamOpen = false;
		this.turnStreamBlockStart = 0;
		// turnToolCallIds is NOT reset — it persists across tool-result delivery
		// callbacks within the same assistant message so results can be routed to
		// this query while its handlers are still pending.
	}
}

let _ctx = new QueryContext();

export function ctx(): QueryContext { return _ctx; }

// Test-only: replace the module-level context so test files start clean.
// Not called from production.
export function resetCtx(): void {
	_ctx = new QueryContext();
}
