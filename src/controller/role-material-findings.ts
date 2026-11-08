import { parseUniqueJson } from '../workflow/json.js';
import { createHash } from 'node:crypto';
import { roleShapes } from '../workflow/role-output-shape.js';
import type { Role } from '../workflow/types.js';

/** Literal accounting only. This reader never decodes an accepted RoleOutput. */
interface Member { key: string; ordinal: number; value?: Node }
interface Node { kind: 'object' | 'array' | 'scalar'; start: number; end: number; complete: boolean; members: Member[]; items: Node[] }
export type FormatterMaterialProfile = 1 | 2 | 3;
export type RoleMaterialProfile = FormatterMaterialProfile | 'rejected-submission/v1' | 'received-submission/v1';
export interface LiteralFinding {
    finding: unknown;
    findingPath: string;
    memberPath: { key: string; ordinal: number }[];
    index: number;
}
export interface NativeTextFindingRegion {
    version: 1;
    format: 'terminal-json-fence';
    sourceUtf8Sha256: string;
    sourceUtf8Bytes: number;
    fenceOrdinal: 0;
    openingStartByte: number;
    bodyStartByte: number;
    bodyEndByte: number;
    closingEndByte: number;
    bodyUtf8Sha256: string;
    innerLiteralComplete: boolean;
}
/** Partial observations only; callers must separately prove the original Native
 * source. Neither this locator nor a closed inner literal makes prose a reply. */
export function nativeTextFindingProjection(raw: string, role: Role): {
    read: ReturnType<typeof roleMaterialFindings>;
    region?: NativeTextFindingRegion;
} | undefined {
    const incomplete = { claims: [] as LiteralFinding[], complete: false, receivedClaimsComplete: false, roleAttempt: true };
    if (!/^```json[ \t]*(?:\r?\n|$)/m.test(raw)) return;
    if (Buffer.byteLength(raw) > 128 * 1024 || Buffer.from(raw).toString('utf8') !== raw)
        return { read: incomplete };
    const fences = [...raw.matchAll(/^```[^\r\n]*(?:\r?\n|$)/gm)];
    if (fences.length !== 2 || !/^```json[ \t]*\r?\n$/.test(fences[0]![0]) ||
        !/^```[ \t]*(?:\r?\n|$)$/.test(fences[1]![0]) ||
        !/^[ \t\r\n]*$/.test(raw.slice(fences[1]!.index! + fences[1]![0].length))) return { read: incomplete };
    const opening = fences[0]!, closing = fences[1]!, start = opening.index! + opening[0].length, end = closing.index!;
    const body = raw.slice(start, end), inner = roleMaterialFindings(body, role);
    if (!inner.roleAttempt) return { read: incomplete };
    const bytes = (at: number) => Buffer.byteLength(raw.slice(0, at));
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    return {
        read: { ...inner, complete: false, receivedClaimsComplete: false },
        region: { version: 1, format: 'terminal-json-fence', sourceUtf8Sha256: digest(raw), sourceUtf8Bytes: Buffer.byteLength(raw),
            fenceOrdinal: 0, openingStartByte: bytes(opening.index!), bodyStartByte: bytes(start), bodyEndByte: bytes(end),
            closingEndByte: bytes(closing.index! + closing[0].length), bodyUtf8Sha256: digest(body), innerLiteralComplete: inner.complete },
    };
}
export function roleMaterialFindings(raw: string, role?: Role, formatterArguments = false, formatterProfile: RoleMaterialProfile = 1): { claims: LiteralFinding[]; complete: boolean; receivedClaimsComplete: boolean; roleAttempt: boolean } {
    return readRoleMaterialFindings(raw, role, formatterArguments, false, formatterProfile);
}
/** Grammar proof only. The caller must separately authenticate the settled
 * assigned formatter source; this never repairs or accepts the role output. */
export function settledFormatterPrefixWithoutFindings(raw: string, role: Role): boolean {
    return readRoleMaterialFindings(raw, role, false, true).receivedClaimsComplete;
}
function readRoleMaterialFindings(raw: string, role: Role | undefined, formatterArguments: boolean, settledPrefixOnly: boolean, formatterProfile: RoleMaterialProfile = 1): { claims: LiteralFinding[]; complete: boolean; receivedClaimsComplete: boolean; roleAttempt: boolean } {
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
    let roleAttempt = false;
    const pointer = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
    const roleRoot = (node: Node) => ['version', 'summary', 'findings', 'assessedScope'].every(key => node.members.some(m => m.key === key)) ||
        !node.complete && ['version', 'summary', 'findings'].every(key => node.members.some(m => m.key === key));
    const visit = (node: Node | undefined, path: string, memberPath: LiteralFinding['memberPath'], depth: number): boolean => {
        if (!node || node.kind !== 'object' || depth > 8) return false;
        // The direct root retains the existing literal findings behavior. A
        // recognized nested role root ends traversal before plan/example data.
        const recognized = roleRoot(node);
        if (recognized || depth === 0 && node.members.some(m => m.key === 'findings')) {
            roleAttempt = true;
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
    if (settledPrefixOnly) {
        const properties = role && roleShapes[role].properties;
        const noFindings = (node: Node): boolean => node.members.every(member => member.key !== 'findings' && !!member.value && noFindings(member.value)) && node.items.every(noFindings);
        const knownPrefix = Boolean(properties && lossless && outerCloseMissing && root?.kind === 'object' && root.members.length && noFindings(root) && root.members.every(member => {
            const node = member.value, shape = properties[member.key];
            if (member.ordinal || !shape || !node?.complete) return false;
            try {
                const value = parseUniqueJson(text.slice(node.start, node.end));
                const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
                return (kind === shape.type || shape.type === 'integer' && Number.isInteger(value)) && (shape.const === undefined || value === shape.const);
            } catch { return false; }
        }));
        return {claims:[],complete:false,receivedClaimsComplete:knownPrefix,roleAttempt:knownPrefix};
    }
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
    // Only an authenticated formatter caller may use this proof. A complete
    // direct assigned-role object can omit the required findings member without
    // losing any literal claims. It remains invalid protocol, and its raw must
    // remain retained. Profile2 takes role identity from the authenticated source,
    // so missing headers cannot hide literal claims. Legacy readers keep their
    // complete-header recipe. Neither profile interprets strings or wrappers.
    let emptyArgumentDomain = false;
    if (formatterArguments && role && valid && lossless && root?.kind === 'object' && root.complete && !claims.length && root.members.length > 0 &&
        (formatterProfile !== 1 || ['version', 'summary', 'assessedScope'].every(key => root!.members.some(member => member.key === key)))) {
        const {properties, required} = roleShapes[role];
        const noFindings = (node: Node): boolean => node.members.every(member => member.key !== 'findings' && !!member.value && noFindings(member.value)) && node.items.every(noFindings);
        try {
            parseUniqueJson(raw);
            const knownMembers = root.members.every(member => {
                const shape = Object.hasOwn(properties!, member.key) ? properties![member.key] : undefined, node = member.value;
                if (member.ordinal || !shape || !node?.complete || !noFindings(node)) return false;
                const value = parseUniqueJson(text.slice(node.start, node.end));
                const kind = value === null && formatterProfile !== 1 ? 'null' : Array.isArray(value) ? 'array' : typeof value;
                return (kind === shape.type || shape.type === 'integer' && Number.isInteger(value)) && (shape.const === undefined || value === shape.const);
            });
            if (formatterProfile === 'received-submission/v1') {
                const members = new Map(root.members.map(member => [member.key, member.value]));
                const findings = members.get('findings');
                emptyArgumentDomain = knownMembers && !members.has('version') &&
                    required!.every(key => key === 'version' || members.has(key)) &&
                    findings?.kind === 'array' && findings.items.length === 0;
            } else emptyArgumentDomain = knownMembers && !root.members.some(member => member.key === 'findings');
            // Profile3 additionally requires a separately authenticated rejected
            // formatter call. Unknown scalar fields cannot contain literal JSON
            // findings members; strings stay opaque. This never unwraps input,
            // accepts protocol, or covers unknown nested containers.
            if (!emptyArgumentDomain && (formatterProfile === 3 || formatterProfile === 'rejected-submission/v1')) emptyArgumentDomain = root.members.every(member => {
                if (member.ordinal || member.key === 'findings' || member.value?.kind !== 'scalar' || !member.value.complete) return false;
                const shape = Object.hasOwn(properties!, member.key) ? properties![member.key] : undefined;
                if (!shape) return true;
                const value = parseUniqueJson(text.slice(member.value.start, member.value.end));
                return (typeof value === shape.type && value !== null || shape.type === 'integer' && Number.isInteger(value)) &&
                    (shape.const === undefined || value === shape.const);
            });
        } catch { /* Missing, duplicate or malformed material remains unknown. */ }
    }
    return { claims, complete: wholeComplete, receivedClaimsComplete: wholeComplete || receivedPrefix || emptyArgumentDomain, roleAttempt: roleAttempt || emptyArgumentDomain };
}
