/** Informational Native reports, never execution or failure authority. */
export type NativeProviderActivity =
    | { kind: 'retry'; attempt: number; maxAttempts: number; delayMs: number; status?: number }
    | { kind: 'rate-limit'; resetsAt?: number };

const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const finite = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

export function captureNativeProviderActivity(value: unknown): NativeProviderActivity | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const activity = value as Record<string, unknown>;
    if (activity.kind === 'retry' && integer(activity.attempt, 1000000) && integer(activity.maxAttempts, 1000000) && activity.attempt <= activity.maxAttempts && finite(activity.delayMs, 604800000)) {
        const status = integer(activity.status, 599) && activity.status >= 100 ? activity.status : undefined;
        return { kind: 'retry', attempt: activity.attempt, maxAttempts: activity.maxAttempts, delayMs: activity.delayMs, ...(status === undefined ? {} : { status }) };
    }
    if (activity.kind === 'rate-limit') return { kind: 'rate-limit', ...(finite(activity.resetsAt, 8640000000000) ? { resetsAt: activity.resetsAt } : {}) };
}

/** undefined ignores an event; null clears a previously reported wait. */
export function nativeProviderActivity(value: unknown): NativeProviderActivity | null | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const event = value as Record<string, unknown>;
    if (event.parent_tool_use_id != null) return;
    if (event.type === 'system' && event.subtype === 'api_retry') {
        return captureNativeProviderActivity({ kind: 'retry', attempt: event.attempt, maxAttempts: event.max_retries, delayMs: event.retry_delay_ms, status: event.error_status });
    }
    if (event.type === 'rate_limit_event') {
        const info = event.rate_limit_info;
        if (!info || typeof info !== 'object' || Array.isArray(info)) return;
        const report = info as Record<string, unknown>;
        if (report.status === 'allowed' || report.status === 'allowed_warning') return null;
        if (report.status === 'rejected') return captureNativeProviderActivity({ kind: 'rate-limit', resetsAt: report.resetsAt });
    }
    if (event.type === 'assistant' || event.type === 'result') return null;
    if (event.type === 'stream_event') {
        const stream = event.event;
        if (stream && typeof stream === 'object' && (stream as Record<string, unknown>).type === 'message_start') return null;
    }
}

/** One reporter per Pi session. A Native query can span several Pi tool turns. */
export function createNativeProviderActivityReporter(observer: (activity: NativeProviderActivity | null) => void) {
    let current = 0, next = 0, closed = false, last: string | undefined;
    const ignore = () => {};
    const report = (activity: NativeProviderActivity | null) => {
        const key = JSON.stringify(activity);
        if (key === last) return;
        last = key;
        try { void Promise.resolve(observer(activity ? { ...activity } : null)).catch(() => {}); }
        catch { /* Optional presentation cannot replace the original result. */ }
    };
    return {
        /** Capture scalar facts before the source observer; deliver only after it succeeds. */
        begin(): (value: unknown) => () => void {
            const owner = ++next;
            let session: string | undefined, sealed = false;
            let retry: NativeProviderActivity | undefined;
            const limits = new Map<string, NativeProviderActivity>();
            const clear = () => { retry = undefined; limits.clear(); report(null); };
            return value => {
                if (closed || sealed || !value || typeof value !== 'object' || Array.isArray(value)) return ignore;
                try {
                    const event = value as Record<string, unknown>;
                    if (event.parent_tool_use_id != null) return ignore;
                    const init = event.type === 'system' && event.subtype === 'init';
                    const settled = event.type === 'gitjig.native-query-settled/v1';
                    const terminal = event.type === 'result';
                    const sid = settled ? event.nativeSessionId : event.session_id;
                    if (typeof sid !== 'string' || !sid.length || sid.length > 200) return ignore;
                    const activity = nativeProviderActivity(value);
                    const info = event.type === 'rate_limit_event' ? event.rate_limit_info as Record<string, unknown> | undefined : undefined;
                    const allowed = info?.status === 'allowed' || info?.status === 'allowed_warning';
                    const windows = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage'];
                    const window = info?.rateLimitType === undefined ? 'unnamed' : typeof info?.rateLimitType === 'string' && windows.includes(info.rateLimitType) ? info.rateLimitType : 'unknown';
                    return () => {
                        if (closed || sealed) return;
                        if (init) {
                            if (session !== undefined || owner <= current) return;
                            session = sid;
                            current = owner;
                            clear();
                            return;
                        }
                        if (current !== owner || session !== sid) return;
                        if (settled || terminal) { sealed = true; clear(); return; }
                        if (allowed) {
                            // An unidentified window cannot discharge a different rejection.
                            if (window !== 'unknown') limits.delete(window);
                            report(retry ?? [...limits.values()].at(-1) ?? null);
                        } else if (activity?.kind === 'retry') {
                            retry = activity;
                            report(retry);
                        } else if (activity?.kind === 'rate-limit') {
                            retry = undefined;
                            limits.set(window, activity);
                            report(activity);
                        } else if (activity === null) clear();
                    };
                } catch { return ignore; }
            };
        },
        reset(): void { current = ++next; report(null); },
        close(): void {
            if (closed) return;
            closed = true;
            report(null);
        },
    };
}
