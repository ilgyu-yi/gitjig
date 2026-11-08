/** One finite admission limit shared by controller validation and owner input correction. */
export const maximumGoalTurns = 1000;
export function goalAllowance(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximumGoalTurns)
        throw Error('Goal allowance must be 1..1000 admitted turns');
    return value;
}
