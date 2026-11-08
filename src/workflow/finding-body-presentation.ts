import { createHash } from 'node:crypto';
import type { Role } from './types.js';

const limit = 2 * 1024 * 1024;
const meaning = 'Each occurrence.data.findingBodyIndex selects its exact zero-based finding body in bodies. All bodies are inline. IDs, order, metadata, source duties and independent decisions remain separate; shared literal bytes imply no equivalence, validity or closure.';
const valueMeaning = meaning + ' Version3 additionally shares exact inline JSON values through sole-key {valueRef:index} references only at mechanicalPatch, evidence string entries, reproduction.command and reproduction.assertions string entries. Dictionary values are opaque literals, never recursively interpreted; expand them before judging or producing literal output.';
const sharesValues = (version: number | undefined) => version === 3 || version === 4;
const encodedMeaning = (version: number) => sharesValues(version) ? version === 4 ? valueMeaning.replace('Version3', 'Version4') : valueMeaning : meaning;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const invalid = (): never => { throw Error('Finding body presentation unavailable or malformed'); };
const profile = (context: Record<string, unknown>, role: Role) => {
    if (Object.hasOwn(context, 'findingBodyInput')) {
        const input = context.findingBodyInput;
        if (!record(input) || Object.keys(input).join(',') !== 'version') return invalid();
        if (input.version === 4) {
            if (role === 'planner' && context.stage === 'planning' || role === 'challenger' && context.stage === 'planning-challenge') return 4;
            return invalid();
        }
        if (role !== 'adjudicator') return invalid();
        if (input.version === 2 && context.stage === 'review-adjudication') return 2;
        if (input.version === 3 && (context.stage === 'planning-adjudication' || context.stage === 'review-adjudication')) return 3;
        if (input.version === 5 && context.stage === 'planning-adjudication') return 5;
        if (input.version === 6 && context.stage === 'review-adjudication') return 6;
        return invalid();
    }
    return role === 'adjudicator' && context.stage === 'planning-adjudication' ? 1 : undefined;
};
const replace = (row: Record<string, unknown>, from: string, to: string, value: unknown) => ({ ...row,
    data: Object.fromEntries(Object.entries(row.data as Record<string, unknown>).map(([key, item]) => key === from ? [to, value] : [key, item])) });

/** Visit only declared positions. Unknown fields and dictionary contents stay opaque. */
function valueSlots(body: unknown, visit: (parent: Record<string, unknown> | unknown[], key: string | number, text: boolean) => void): void {
    if (!record(body)) return;
    if (Object.hasOwn(body, 'mechanicalPatch')) visit(body, 'mechanicalPatch', false);
    if (Array.isArray(body.evidence)) body.evidence.forEach((_, i) => visit(body.evidence as unknown[], i, true));
    if (record(body.reproduction)) {
        const reproduction = body.reproduction;
        if (Object.hasOwn(reproduction, 'command')) visit(reproduction, 'command', true);
        if (Array.isArray(reproduction.assertions)) reproduction.assertions.forEach((_, i) => visit(reproduction.assertions as unknown[], i, true));
    }
}
const slotValue = (parent: Record<string, unknown> | unknown[], key: string | number): unknown => (parent as Record<string | number, unknown>)[key];
const setSlot = (parent: Record<string, unknown> | unknown[], key: string | number, value: unknown): void => { (parent as Record<string | number, unknown>)[key] = value; };
const reserved = (value: unknown) => record(value) && Object.hasOwn(value, 'valueRef');

function shareValues(bodies: unknown[]): { bodies: unknown[]; values: unknown[] } | undefined {
    const counts = new Map<string, number>();
    let collision = false;
    for (const body of bodies) valueSlots(body, (parent, key, text) => {
        const value = slotValue(parent, key);
        if (reserved(value)) collision = true;
        if (text && typeof value !== 'string') return;
        const literal = JSON.stringify(value);
        if (literal === undefined) return invalid();
        counts.set(literal, (counts.get(literal) ?? 0) + 1);
    });
    if (collision) return;
    const indices = new Map<string, number>(), values: unknown[] = [];
    for (const [literal, count] of counts) {
        const referenceBytes = bytes({ valueRef: values.length });
        if (count > 1 && count * (Buffer.byteLength(literal) - referenceBytes) > Buffer.byteLength(literal) + 1) {
            indices.set(literal, values.length);
            values.push(JSON.parse(literal));
        }
    }
    const shared = bodies.map(body => JSON.parse(JSON.stringify(body)));
    for (const body of shared) valueSlots(body, (parent, key, text) => {
        const value = slotValue(parent, key);
        if (text && typeof value !== 'string') return;
        const index = indices.get(JSON.stringify(value));
        if (index !== undefined) setSlot(parent, key, { valueRef: index });
    });
    return { bodies: shared, values };
}

/** Validate lengths and types without parsing or materializing any expansion. */
function valueExpansion(bodies: unknown[], values: unknown[]) {
    const literals = values.map(value => JSON.stringify(value));
    if (literals.some(value => value === undefined) || new Set(literals).size !== literals.length) return invalid();
    const used = new Set<number>();
    const indexOf = (value: unknown, text: boolean): number | undefined => {
        if (!reserved(value)) return;
        const ref = (value as Record<string, unknown>).valueRef;
        if (Object.keys(value as object).length !== 1 || typeof ref !== 'number' || !Number.isSafeInteger(ref) || ref < 0 || ref >= values.length || (text && typeof values[ref] !== 'string')) return invalid();
        used.add(ref);
        return ref;
    };
    const lengths = bodies.map(body => {
        let length = bytes(body);
        valueSlots(body, (parent, key, text) => {
            const value = slotValue(parent, key), index = indexOf(value, text);
            if (index !== undefined) length += Buffer.byteLength(literals[index]!) - bytes(value);
        });
        return length;
    });
    if (used.size !== values.length) return invalid();
    return { lengths, expand: (body: unknown) => {
        const decoded: unknown = JSON.parse(JSON.stringify(body));
        valueSlots(decoded, (parent, key, text) => {
            const index = indexOf(slotValue(parent, key), text);
            if (index !== undefined) setSlot(parent, key, JSON.parse(literals[index]!));
        });
        return JSON.stringify(decoded);
    } };
}

/** Wire presentation only. Canonical bundles, rows and input-scope receipts stay literal. */
export function presentFindingBodies(context: Record<string, unknown>, role: Role): Record<string, unknown> {
    const version = profile(context, role);
    if (!version) return context;
    if (Object.hasOwn(context, 'findingBodyEncoding')) return invalid();
    if (bytes(context) > limit) return invalid();
    // A captured literal policy keeps each current claim beside its own identity.
    // Old sharing profiles retain their exact encoder and discriminator.
    if (version === 5 || version === 6) return context;
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
    const shared = sharesValues(version) ? shareValues(bodies) : undefined;
    if (sharesValues(version) && !shared) return context;
    const declaration = sharesValues(version) ? { version, meaning: encodedMeaning(version), ...shared! } : { version, meaning, bodies };
    const projected = { ...context, occurrences, findingBodyEncoding: declaration };
    return bytes(projected) < bytes(context) ? projected : context;
}

/** Decode before historical body/census interpretation, never before raw-byte attestation. */
export function restoreFindingBodies(context: Record<string, unknown>, role: Role): Record<string, unknown> {
    // Absence has its original literal meaning, including unknown historical metadata.
    if (!Object.hasOwn(context, 'findingBodyEncoding')) {
        if (record(context.findingBodyInput) && [5, 6].includes(context.findingBodyInput.version as number)) {
            const version = profile(context, role);
            if ((version !== 5 && version !== 6) || bytes(context) > limit) return invalid();
        }
        return context;
    }
    const version = profile(context, role);
    if (!version || version === 5 || version === 6 || bytes(context) > limit) return invalid();
    const declaration = context.findingBodyEncoding;
    if (!record(declaration) || Object.keys(declaration).length !== (sharesValues(version) ? 4 : 3) || declaration.version !== version || declaration.meaning !== encodedMeaning(version) ||
        !Array.isArray(declaration.bodies) || !declaration.bodies.length || !Array.isArray(context.occurrences)) return invalid();
    const literals = declaration.bodies.map(body => JSON.stringify(body));
    if (literals.some(text => text === undefined) || new Set(literals).size !== literals.length) return invalid();
    if (sharesValues(version) && !Array.isArray(declaration.values)) return invalid();
    const expansion = sharesValues(version) ? valueExpansion(declaration.bodies, declaration.values as unknown[]) : undefined;
    const bodyBytes = expansion?.lengths ?? literals.map(text => Buffer.byteLength(text)), used = new Set<number>();
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
    const canonical = expansion ? declaration.bodies.map(expansion.expand) : literals;
    if (new Set(canonical).size !== canonical.length) return invalid();
    return { ...literalContext, occurrences: context.occurrences.map(row => Object.hasOwn(row.data, 'findingBodyIndex')
        ? replace(row, 'findingBodyIndex', 'finding', JSON.parse(canonical[row.data.findingBodyIndex]!)) : structuredClone(row)) };
}

/** Private canonical field binding for explicitly versioned receivers; never a verdict. */
export function findingBodyFootprint(context: Record<string, unknown>, role: Role): string | undefined {
    const version = profile(context, role);
    if (version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6) return;
    if (!Array.isArray(context.occurrences) || bytes(context) > limit) return invalid();
    return createHash('sha256').update(JSON.stringify({input:context.findingBodyInput,occurrences:context.occurrences})).digest('hex');
}
