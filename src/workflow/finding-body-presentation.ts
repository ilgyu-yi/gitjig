import type { Role } from './types.js';

const limit = 2 * 1024 * 1024;
const meaning = 'Each occurrence.data.findingBodyIndex selects its exact zero-based finding body in bodies. All bodies are inline. IDs, order, metadata, source duties and independent decisions remain separate; shared literal bytes imply no equivalence, validity or closure.';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const invalid = (): never => { throw Error('Finding body presentation unavailable or malformed'); };
const assigned = (context: Record<string, unknown>, role: Role) => role === 'adjudicator' && context.stage === 'planning-adjudication';
const replace = (row: Record<string, unknown>, from: string, to: string, value: unknown) => ({ ...row,
    data: Object.fromEntries(Object.entries(row.data as Record<string, unknown>).map(([key, item]) => key === from ? [to, value] : [key, item])) });

/** Wire presentation only. Canonical bundles, rows and input-scope receipts stay literal. */
export function presentFindingBodies(context: Record<string, unknown>, role: Role): Record<string, unknown> {
    if (!assigned(context, role)) return context;
    if (Object.hasOwn(context, 'findingBodyEncoding')) return invalid();
    if (bytes(context) > limit) return invalid();
    const rows = context.occurrences;
    if (!Array.isArray(rows)) return context;
    // An unknown historical metadata key must not silently acquire reference meaning.
    if (rows.some(row => !record(row) || !record(row.data) || Object.hasOwn(row.data, 'findingBodyIndex'))) return context;
    const bodies: unknown[] = [], positions = new Map<string, number>();
    const occurrences = rows.map(row => {
        if (!Object.hasOwn(row.data, 'finding')) return row;
        const text = JSON.stringify(row.data.finding);
        if (text === undefined) return invalid();
        if (!positions.has(text)) { positions.set(text, bodies.length); bodies.push(row.data.finding); }
        return replace(row, 'finding', 'findingBodyIndex', positions.get(text));
    });
    if (!bodies.length) return context;
    const projected = { ...context, occurrences, findingBodyEncoding: { version: 1, meaning, bodies } };
    return bytes(projected) < bytes(context) ? projected : context;
}

/** Decode before historical body/census interpretation, never before raw-byte attestation. */
export function restoreFindingBodies(context: Record<string, unknown>, role: Role): Record<string, unknown> {
    // Absence has its original literal meaning, including unknown historical metadata.
    if (!Object.hasOwn(context, 'findingBodyEncoding')) return context;
    if (!assigned(context, role) || bytes(context) > limit) return invalid();
    const declaration = context.findingBodyEncoding;
    if (!record(declaration) || Object.keys(declaration).length !== 3 || declaration.version !== 1 || declaration.meaning !== meaning ||
        !Array.isArray(declaration.bodies) || !declaration.bodies.length || !Array.isArray(context.occurrences)) return invalid();
    const literals = declaration.bodies.map(body => JSON.stringify(body));
    if (literals.some(text => text === undefined) || new Set(literals).size !== literals.length) return invalid();
    const bodyBytes = literals.map(text => Buffer.byteLength(text)), used = new Set<number>();
    const { findingBodyEncoding: _declaration, ...literalContext } = context;
    // Bound expansion using null placeholders BEFORE cloning/materializing any repeated body.
    let expandedBytes = bytes({ ...literalContext, occurrences: [] });
    for (const [ordinal, row] of context.occurrences.entries()) {
        if (!record(row) || !record(row.data) || Object.hasOwn(row.data, 'finding')) return invalid();
        if (Object.hasOwn(row.data, 'findingBodyIndex')) {
            const index = row.data.findingBodyIndex;
            if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= literals.length) return invalid();
            used.add(index);
            expandedBytes += bytes(replace(row, 'findingBodyIndex', 'finding', null)) - 4 + bodyBytes[index]!;
        } else expandedBytes += bytes(row);
        if (ordinal) expandedBytes++;
        if (expandedBytes > limit) return invalid();
    }
    if (used.size !== literals.length) return invalid();
    return { ...literalContext, occurrences: context.occurrences.map(row => Object.hasOwn(row.data, 'findingBodyIndex')
        ? replace(row, 'findingBodyIndex', 'finding', JSON.parse(literals[row.data.findingBodyIndex]!)) : structuredClone(row)) };
}
