import { parseUniqueJson } from '../workflow/json.js';
import { roleShapes } from '../workflow/role-output-shape.js';
import type { Role } from '../workflow/types.js';

/** Literal accounting only. This reader never decodes an accepted RoleOutput. */
interface Member { key: string; ordinal: number; value?: Node }
interface Node { kind: 'object' | 'array' | 'scalar'; start: number; end: number; complete: boolean; members: Member[]; items: Node[] }
export interface LiteralFinding {
    finding: unknown;
    findingPath: string;
    memberPath: { key: string; ordinal: number }[];
    index: number;
}
export function roleMaterialFindings(raw: string, role?: Role): { claims: LiteralFinding[]; complete: boolean; receivedClaimsComplete: boolean } {
    const limit = 128 * 1024, text = Buffer.from(raw).subarray(0, limit).toString('utf8');
    let at = 0, nodes = 0, root: Node | undefined, valid = Buffer.byteLength(raw) <= limit;
    const lossless = valid && Buffer.from(raw).toString('utf8') === raw;
    let outerCloseMissing = false;
    const ws = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at]!)) at++; };
    const string = () => {
        const start = at++;
        while (at < text.length) {
            const char = text[at++];
            if (char === '"') return JSON.parse(text.slice(start, at)) as string;
            if (char === '\\') at++;
        }
        throw Error('Incomplete literal string');
    };
    const read = (assign: (node: Node) => void, depth = 0): void => {
        if (++nodes > 8192 || depth > 64) throw Error('Literal material exceeds bounded structure');
        ws();
        const node: Node = { kind: text[at] === '{' ? 'object' : text[at] === '[' ? 'array' : 'scalar', start: at, end: at, complete: false, members: [], items: [] };
        assign(node);
        if (node.kind === 'scalar') {
            if (text[at] === '"') string();
            else { const start = at; while (at < text.length && !/[\x20\t\r\n,}\]]/.test(text[at]!)) at++; if (start === at) throw Error('Missing literal'); JSON.parse(text.slice(start, at)); }
        } else {
            const close = text[at++] === '{' ? '}' : ']', ordinals = new Map<string, number>(); ws();
            if (text[at] !== close) while (true) {
                if (node.kind === 'object') {
                    if (text[at] !== '"') throw Error('Missing literal member');
                    const key = string(), member: Member = { key, ordinal: ordinals.get(key) ?? 0 };
                    ordinals.set(key, member.ordinal + 1);
                    ws(); if (text[at++] !== ':') throw Error('Missing literal colon');
                    node.members.push(member); read(value => { member.value = value; }, depth + 1);
                } else read(value => { node.items.push(value); }, depth + 1);
                ws(); if (text[at] !== ',') break; at++; ws();
            }
            if (depth === 0 && node.kind === 'object' && at === text.length) outerCloseMissing = true;
            if (text[at++] !== close) throw Error('Incomplete literal container');
        }
        node.end = at; node.complete = true;
    };
    try { read(node => { root = node; }); ws(); if (at !== text.length) valid = false; }
    catch { valid = false; }
    const claims: LiteralFinding[] = [];
    const pointer = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
    const roleRoot = (node: Node) => ['version', 'summary', 'findings', 'assessedScope'].every(key => node.members.some(m => m.key === key)) ||
        !node.complete && ['version', 'summary', 'findings'].every(key => node.members.some(m => m.key === key));
    const visit = (node: Node | undefined, path: string, memberPath: LiteralFinding['memberPath'], depth: number): boolean => {
        if (!node || node.kind !== 'object' || depth > 8) return false;
        // The direct root retains the existing literal findings behavior. A
        // recognized nested role root ends traversal before plan/example data.
        const recognized = roleRoot(node);
        if (recognized || depth === 0 && node.members.some(m => m.key === 'findings')) {
            let complete = node.complete;
            for (const member of node.members.filter(m => m.key === 'findings')) {
                const value = member.value, location = [...memberPath, { key: member.key, ordinal: member.ordinal }];
                if (!value || value.kind !== 'array') { complete = false; continue; }
                for (const [index, item] of value.items.entries()) {
                    if (!item.complete) { complete = false; continue; }
                    try {
                        const literal = text.slice(item.start, item.end);
                        try { parseUniqueJson(literal); } catch { complete = false; }
                        claims.push({ finding: JSON.parse(literal), findingPath: path + '/findings', memberPath: location, index }); }
                    catch { complete = false; }
                }
                if (!value.complete) complete = false;
            }
            if (!recognized) for (const member of node.members.filter(m => m.key !== 'findings')) {
                if (member.value?.kind !== 'object') continue;
                complete = false;
                if (roleRoot(member.value)) visit(member.value, path + '/' + pointer(member.key), [...memberPath, {key:member.key,ordinal:member.ordinal}], depth + 1);
            }
            return complete;
        }
        if (!node.members.length) return node.complete;
        const transparent = new Set(node.members.map(m => m.key)).size === 1 && node.members.every(m => m.value?.kind === 'object');
        let complete = node.complete && transparent;
        for (const member of node.members) {
            // Siblings make the envelope unavailable. Still retain a directly
            // recognizable role root; never search arbitrary sibling contents.
            if (transparent || member.value?.kind === 'object' && roleRoot(member.value)) {
                if (!visit(member.value, path + '/' + pointer(member.key), [...memberPath, { key: member.key, ordinal: member.ordinal }], depth + 1)) complete = false;
            }
        }
        return complete;
    };
    const complete = visit(root, '', [], 0);
    const wholeComplete = valid && complete;
    // This is a proof about received claim-domain bytes, never a repaired role
    // value. Only the missing outer terminator is permitted; all received values
    // must already be closed, unique and inside the assigned role's domains.
    let receivedPrefix = false;
    if (role && lossless && outerCloseMissing && root?.kind === 'object' && roleRoot(root) &&
        ['version', 'summary', 'findings', 'assessedScope'].every(key => root!.members.some(m => m.key === key))) {
        const properties = roleShapes[role].properties!;
        const noNestedFindings = (node: Node): boolean => node.members.every(m => m.key !== 'findings' && !!m.value && noNestedFindings(m.value)) && node.items.every(noNestedFindings);
        receivedPrefix = root.members.every(member => {
            const node = member.value, shape = properties[member.key];
            if (member.ordinal || !shape || !node?.complete || !noNestedFindings(node)) return false;
            try {
                const value = parseUniqueJson(text.slice(node.start, node.end));
                const kind = Array.isArray(value) ? 'array' : value !== null && typeof value === 'object' ? 'object' : typeof value;
                return (kind === shape.type || shape.type === 'integer' && Number.isInteger(value)) && (shape.const === undefined || value === shape.const);
            } catch { return false; }
        });
    }
    return { claims, complete: wholeComplete, receivedClaimsComplete: wholeComplete || receivedPrefix };
}
