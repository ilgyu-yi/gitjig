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
