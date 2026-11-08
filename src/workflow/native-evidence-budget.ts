/** Current host-selected policy, bound by the existing original request digest. */
export const nativeEvidencePolicy = Object.freeze({ id: 'raw-envelope/v1', eventBytes: 2 * 1024 * 1024,
    normalBytes: 8 * 1024 * 1024, progressBytes: 4 * 1024 * 1024 });

/** Prospective integrated candidate. Fresh framing remains raw-envelope/v1. */
export const embeddedEvidencePolicy = Object.freeze({id:'embedded-envelope/v2',eventBytes:2*1024*1024,
    encodedBytes:8*1024*1024,logicalBytes:32*1024*1024,packets:262144,reserveBytes:3*1024*1024});

/** Absence preserves historical source recipes; a present unknown marker never does. */
export function nativeEvidencePolicyId(binding: Record<string, unknown>): string | undefined {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding))
        throw Error('NATIVE_CAPTURE_POLICY_UNSUPPORTED: original binding unavailable');
    if (!Object.hasOwn(binding, 'nativeEvidencePolicy')) return undefined;
    if (binding.nativeEvidencePolicy !== nativeEvidencePolicy.id && binding.nativeEvidencePolicy !== embeddedEvidencePolicy.id)
        throw Error('NATIVE_CAPTURE_POLICY_UNSUPPORTED: unknown original evidence policy');
    return binding.nativeEvidencePolicy;
}

export interface NativeEvidenceUsage { normalBytes: number; progressBytes: number }
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 200;

/** Exact pinned SDK scalar contract. Unknown fields, including retractions, stay normal evidence. */
function progressCounter(message: Record<string, any>, sessionId: string | undefined): boolean {
    const keys = ['type', 'subtype', 'estimated_tokens', 'estimated_tokens_delta', 'uuid', 'session_id', 'user_message_uuid'];
    return sessionId !== undefined && message.type === 'system' && message.subtype === 'thinking_tokens' &&
        message.session_id === sessionId && nonempty(message.uuid) &&
        (!Object.hasOwn(message, 'user_message_uuid') || nonempty(message.user_message_uuid)) &&
        Number.isSafeInteger(message.estimated_tokens) && message.estimated_tokens >= 0 &&
        Number.isSafeInteger(message.estimated_tokens_delta) && message.estimated_tokens_delta >= 0 &&
        Object.keys(message).every(key => keys.includes(key));
}

/** Quote exact serialized cost before any append or accounting mutation. */
export function nativeEvidenceCharge(message: Record<string, any>, sessionId: string | undefined, usage: NativeEvidenceUsage) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('Native evidence envelope unavailable');
    const size = Buffer.byteLength(JSON.stringify(message));
    if (size > nativeEvidencePolicy.eventBytes)
        return {size, counter:false, budget:'single-event' as const, usedBytes:0, limitBytes:nativeEvidencePolicy.eventBytes, allowed:false};
    const counter = progressCounter(message,sessionId), usedBytes = counter ? usage.progressBytes : usage.normalBytes,
        limitBytes = counter ? nativeEvidencePolicy.progressBytes : nativeEvidencePolicy.normalBytes;
    return {size,counter,budget:counter?'progress-counter' as const:'provider-evidence' as const,usedBytes,limitBytes,allowed:usedBytes+size<=limitBytes};
}

export function acceptNativeEvidenceCharge(usage: NativeEvidenceUsage, charge: ReturnType<typeof nativeEvidenceCharge>): void {
    if (!charge.allowed) throw Error('Refused Native evidence cannot acquire accepted budget');
    if (charge.counter) usage.progressBytes += charge.size;
    else usage.normalBytes += charge.size;
}

/** The first retained root init establishes counter attribution, including a retained crossing init. */
export function nativeEvidenceSessionId(current: string | undefined, message: Record<string, any>): string | undefined {
    return current === undefined && message.type === 'system' && message.subtype === 'init' &&
        message.parent_tool_use_id == null && nonempty(message.session_id) ? message.session_id : current;
}
