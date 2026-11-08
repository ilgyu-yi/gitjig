import type { Context } from '@earendil-works/pi-ai';
import { createHash } from 'node:crypto';

/** Public maintained-bridge metadata contract; the binding is host-selected. */
export const roleSubmissionToolName = 'gitjig_submit_role_result';
export const structuredOutputMetadataKey = 'gitjig.structured-output/v1';
interface RoleResponseBinding {
    requestId: string;
    binding: Record<string, string>;
    schema: Record<string, unknown>;
    maxNativeTurns: number;
}
export type StructuredOutputIntent = RoleResponseBinding & (
    { version: 1 } | { version: 2; carrier: 'assistant-json/v1' } | { version: 3; carrier: 'tool-submission/v1' }
);
/** Estimate provider-added input, not another executable Pi/project tool.
 * Count the formatter schema even when the role instruction references the
 * native channel instead of repeating its complete schema text. */
export function structuredOutputContext(context: Context, intent: StructuredOutputIntent): Context {
    // Text includes the schema inline; submission carries it in the actual SDK tool declaration.
    if (intent.version === 2 || intent.version === 3) return context;
    return { ...context, tools: [...context.tools ?? [], {
        name: 'StructuredOutput', description: 'Provide the requested structured output.', parameters: intent.schema,
    }] };
}
/** Current native admission only; historical capture must retain its original schema. */
export function assertNativeFormatterSchema(schema: Record<string, unknown>): void {
    const invalidRoot = !schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object';
    const unsupported = invalidRoot ? [] : ['oneOf', 'anyOf', 'allOf'].filter(key => Object.hasOwn(schema, key));
    if (invalidRoot || unsupported.length)
        throw Error(`NATIVE_FORMATTER_SCHEMA_UNSUPPORTED: ${unsupported.length ? 'root ' + unsupported.join(', ') : 'object root required'}. Update gitjig before retrying; This formatter request was not sent.`);
}
/** Text JSON uses the host schema, without the formatter's tool vocabulary. */
export function assertNativeResponseSchema(intent: StructuredOutputIntent): void {
    if (intent.version === 1) return assertNativeFormatterSchema(intent.schema);
    if (!(intent.version === 2 && intent.carrier === 'assistant-json/v1' || intent.version === 3 && intent.carrier === 'tool-submission/v1')) throw Error('NATIVE_RESPONSE_CARRIER_UNSUPPORTED');
    if (!intent.schema || typeof intent.schema !== 'object' || Array.isArray(intent.schema) || intent.schema.type !== 'object')
        throw Error('NATIVE_ROLE_SCHEMA_UNSUPPORTED: object root required');
}
/** A fresh text role has one original text input, including across tool results. */
export function assertNativeResponseInput(context: { messages: readonly {role: string; content?: unknown}[] }, intent: StructuredOutputIntent): void {
    if (intent.version !== 2 && intent.version !== 3) return;
    const messages = Array.from(context.messages);
    if (messages.some(message=>!message || typeof message.role !== 'string')) throw Error('NATIVE_ROLE_INPUT_MISMATCH: malformed original messages');
    const users = messages.filter(message=>message.role === 'user');
    if (users.length !== 1) throw Error('NATIVE_ROLE_INPUT_MISMATCH: one original text input required');
    const content = users[0]!.content;
    if (typeof content !== 'string' && (!Array.isArray(content) || Array.from(content).some(block=>block?.type !== 'text' || typeof block.text !== 'string')))
        throw Error('NATIVE_ROLE_INPUT_MISMATCH: original input is not text-only');
    const text = typeof content === 'string' ? content : content.map(block=>block.text).join('');
    if (Buffer.byteLength(text) > 2 * 1024 * 1024 || createHash('sha256').update(text).digest('hex') !== intent.binding.inputDigest)
        throw Error('NATIVE_ROLE_INPUT_MISMATCH: original text differs from frozen request');
}
export function freezeStructuredOutput(intent: StructuredOutputIntent): StructuredOutputIntent {
    const captured = structuredClone(intent);
    const freeze = (value: unknown): void => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(captured);
    return captured;
}
