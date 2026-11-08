import { Type } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { GoalProgress, GoalVerdict } from '../controller/goal-types.js';
export interface PiGoalControls {
    status(): unknown;
    progress?(input: GoalProgress): unknown;
    review?(input: GoalVerdict): unknown;
}
/** Identity is captured by the controller; model arguments never select a goal or producer. */
export function createGoalTools(captured: PiGoalControls): ToolDefinition[] {
    const text = () => Type.String({
        minLength: 1,
        maxLength: 4096
    });
    const ids = () => Type.Array(Type.String({
        minLength: 1,
        maxLength: 150
    }), {
        maxItems: 64,
        uniqueItems: true
    });
    const result = (value: unknown) => ({
        content: [{
                type: 'text' as const,
                text: JSON.stringify(value)
            }],
        details: {}
    });
    const tools: ToolDefinition[] = [{
            name: 'goal_status',
            label: 'Inspect current goal',
            description: 'Read the exact current goal and pending findings. Goal state is not task/action authority.',
            parameters: Type.Object({}, {
                additionalProperties: false
            }),
            async execute(_id, _args, signal) {
                signal?.throwIfAborted();
                return result(captured.status());
            }
        }];
    if (captured.progress)
        tools.push({
            name: 'goal_progress',
            label: 'Report goal progress',
            description: 'Record one provisional report for this turn. A completion proposal requires a distinct original reviewer and current evidence; this tool does not complete the goal or edit owner criteria.',
            parameters: Type.Object({
                disposition: Type.Union(['continue', 'need-owner', 'wait-external', 'propose-completion'].map(x => Type.Literal(x))),
                plan: text(),
                nextAction: text(),
                reason: text(),
                resultIds: ids()
            }, {
                additionalProperties: false
            }),
            async execute(_id, args, signal) {
                signal?.throwIfAborted();
                return result(captured.progress!(args as GoalProgress));
            }
        });
    if (captured.review)
        tools.push({
            name: 'goal_review',
            label: 'Record independent goal review',
            description: 'Assess the supplied frozen criteria and evidence, accounting for every pending finding ID. Finding criterion is the zero-based index in the frozen criteria array. Pass with findings is invalid. This verdict remains provisional until the exact review turn settles.',
            parameters: Type.Object({
                verdict: Type.Union([Type.Literal('pass'), Type.Literal('reject')]),
                reason: text(),
                findings: Type.Array(Type.Object({
                    criterion: Type.Unsafe<number>({
                        type: 'integer',
                        minimum: 0,
                        maximum: 15
                    }),
                    description: text()
                }, {
                    additionalProperties: false
                }), {
                    maxItems: 32
                }),
                resolvedFindingIds: ids()
            }, {
                additionalProperties: false
            }),
            async execute(_id, args, signal) {
                signal?.throwIfAborted();
                return result(captured.review!(args as GoalVerdict));
            }
        });
    return tools;
}
