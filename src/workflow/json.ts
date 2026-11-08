/** A complete whole-answer JSON fence, not a JSON snippet in narration.
 * Callers must independently declare whether their captured grammar permits it.
 * Byte positions always refer to the unchanged original UTF-8 source. */
export function wholeJsonFence(raw: string): { body: string; openingStartByte: number; bodyStartByte: number; bodyEndByte: number; closingEndByte: number } | undefined {
    if (Buffer.byteLength(raw) > 128 * 1024 || Buffer.from(raw).toString('utf8') !== raw) return;
    const match = /^([ \t\r\n]*)(```json[ \t]*\r?\n)([\s\S]*?\r?\n)(```[ \t]*(?:\r?\n|$))([ \t\r\n]*)$/.exec(raw);
    if (!match || /^[ \t]*```/m.test(match[3]!)) return;
    const opening = match[1]!.length, start = opening + match[2]!.length, end = start + match[3]!.length;
    const bytes = (at: number) => Buffer.byteLength(raw.slice(0, at));
    return { body: match[3]!, openingStartByte: bytes(opening), bodyStartByte: bytes(start), bodyEndByte: bytes(end), closingEndByte: bytes(end + match[4]!.length) };
}

/** JSON.parse silently drops duplicate object members. Reject those before
 * consuming a role/check claim, including escaped spellings of the same key. */
export function parseUniqueJson(raw: string): unknown {
    let at = 0;
    const whitespace = () => {
        while (at < raw.length && /[\x20\t\r\n]/.test(raw[at]!))
            at++;
    };
    const error = (reason: string): never => { throw new Error(`Invalid strict JSON at${at}: ${reason}`); };
    function string(): string {
        if (raw[at] !== '"')
            error('expected string');
        const start = at++;
        while (at < raw.length) {
            const c = raw[at++];
            if (c === '"')
                return JSON.parse(raw.slice(start, at)) as string;
            if (c === '\\')
                at++;
        }
        return error('unterminated string');
    }
    function value(depth: number): void {
        if (depth > 64)
            error('nesting exceeds64');
        whitespace();
        const c = raw[at];
        if (c === '"') {
            string();
            return;
        }
        if (c === '{') {
            at++;
            whitespace();
            const keys = new Set<string>();
            if (raw[at] === '}') {
                at++;
                return;
            }
            while (true) {
                whitespace();
                const key = string();
                if (keys.has(key))
                    error(`duplicate key ${JSON.stringify(key)}`);
                keys.add(key);
                whitespace();
                if (raw[at++] !== ':')
                    error('expected colon');
                value(depth + 1);
                whitespace();
                const end = raw[at++];
                if (end === '}')
                    return;
                if (end !== ',')
                    error('expected object delimiter');
            }
        }
        if (c === '[') {
            at++;
            whitespace();
            if (raw[at] === ']') {
                at++;
                return;
            }
            while (true) {
                value(depth + 1);
                whitespace();
                const end = raw[at++];
                if (end === ']')
                    return;
                if (end !== ',')
                    error('expected array delimiter');
            }
        }
        const start = at;
        while (at < raw.length && !/[\x20\t\r\n,}\]]/.test(raw[at]!))
            at++;
        if (start === at)
            error('expected value');
        JSON.parse(raw.slice(start, at));
    }
    value(0);
    whitespace();
    if (at !== raw.length)
        error('trailing bytes');
    return JSON.parse(raw);
}
