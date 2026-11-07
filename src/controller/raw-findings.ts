/** Conservative occurrence collection: retains every literal top-level findings
 * array, including duplicate members rejected by the protocol consumer. */
export function rawFindings(raw: string | null): {
    findings: unknown[];
    complete: boolean;
} {
    if (!raw)
        return { findings: [], complete: true };
    let at = 0;
    const findings: unknown[] = [];
    const ws = () => {
        while (/\s/.test(raw[at] ?? '') && at < raw.length)
            at++;
    };
    const str = () => {
        const start = at++;
        while (at < raw.length) {
            const c = raw[at++];
            if (c === '"')
                return JSON.parse(raw.slice(start, at)) as string;
            if (c === '\\')
                at++;
        }
        throw new Error('string');
    };
    const val = (depth = 0): void => {
        if (depth > 64)
            throw new Error('depth');
        ws();
        if (raw[at] === '"') {
            str();
            return;
        }
        if (raw[at] === '[' || raw[at] === '{') {
            const close = raw[at++] === '[' ? ']' : '}';
            while (at < raw.length) {
                ws();
                if (raw[at] === close) {
                    at++;
                    return;
                }
                if (raw[at] === ',' || raw[at] === ':') {
                    at++;
                    continue;
                }
                val(depth + 1);
            }
            throw new Error('unterminated');
        }
        const start = at;
        while (at < raw.length && !/[\s,}\]]/.test(raw[at]!))
            at++;
        if (start === at)
            throw new Error('value');
        JSON.parse(raw.slice(start, at));
    };
    try {
        ws();
        if (raw[at++] !== '{')
            throw new Error('object');
        while (true) {
            ws();
            if (raw[at] === '}') {
                at++;
                break;
            }
            if (raw[at] !== '"')
                throw new Error('key');
            const key = str();
            ws();
            if (raw[at++] !== ':')
                throw new Error('colon');
            ws();
            const start = at;
            val();
            if (key === 'findings') {
                const value = JSON.parse(raw.slice(start, at));
                if (!Array.isArray(value))
                    throw new Error('findings');
                findings.push(...value);
            }
            ws();
            if (raw[at] === ',') {
                at++;
                continue;
            }
            if (raw[at] !== '}')
                throw new Error('delimiter');
        }
        ws();
        if (at !== raw.length)
            throw new Error('trailing');
        return { findings, complete: true };
    }
    catch {
        return { findings, complete: false };
    }
}
