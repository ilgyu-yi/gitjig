import type { Context } from '@earendil-works/pi-ai';

/** Public maintained-bridge metadata contract; the binding is host-selected. */
export const structuredOutputMetadataKey = 'gitjig.structured-output/v1';
export interface StructuredOutputIntent {
    version: 1;
    requestId: string;
    binding: Record<string, string>;
    schema: Record<string, unknown>;
    maxNativeTurns: number;
}
/** Estimate provider-added input, not another executable Pi/project tool.
 * Count the formatter schema even when the role instruction references the
 * native channel instead of repeating its complete schema text. */
export function structuredOutputContext(context: Context, intent: StructuredOutputIntent): Context {
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
export function freezeStructuredOutput(intent: StructuredOutputIntent): StructuredOutputIntent {
    const captured = structuredClone(intent);
    const freeze = (value: unknown): void => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(captured);
    return captured;
}
