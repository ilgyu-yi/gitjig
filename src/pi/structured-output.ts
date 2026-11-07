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
export function freezeStructuredOutput(intent: StructuredOutputIntent): StructuredOutputIntent {
    const captured = structuredClone(intent);
    const freeze = (value: unknown): void => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(captured);
    return captured;
}
