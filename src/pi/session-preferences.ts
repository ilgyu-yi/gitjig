export type SessionQueuePreferences = Readonly<{
    steeringMode: 'all' | 'one-at-a-time';
    followUpMode: 'all' | 'one-at-a-time';
}>;
/** Capture harmless session behavior, never disk discovery or authority. */
export function captureSessionPreferences(value: unknown): SessionQueuePreferences | undefined {
    if (value === undefined)
        return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 2 || !Object.hasOwn(value, 'steeringMode') || !Object.hasOwn(value, 'followUpMode'))
        throw new Error('Session preferences require a complete steeringMode/followUpMode pair');
    const pair = value as Record<string, unknown>;
    const steeringMode = pair.steeringMode, followUpMode = pair.followUpMode;
    if ((steeringMode !== 'all' && steeringMode !== 'one-at-a-time') || (followUpMode !== 'all' && followUpMode !== 'one-at-a-time'))
        throw new Error('Invalid session queue preference');
    return Object.freeze({ steeringMode, followUpMode });
}
