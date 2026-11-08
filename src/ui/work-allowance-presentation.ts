import type { Controller } from '../controller/controller.js';
import { availableWorkAllowance, type BudgetView } from '../controller/work-recovery.js';
import { uiText, type UiLocale } from './i18n.js';

export { availableWorkAllowance };

export type ContinuationAllowanceHold = ReturnType<Controller['inspectChangeContinuationPrerequisites']>['allowanceHold'];

/** A depleted balance warrants a stage-specific read; it does not establish which allowance is needed. */
export function inspectDepletedContinuationAllowance(controller: Controller, workId: string,
    allowance: { execution: BudgetView; resolution: BudgetView } | undefined): ContinuationAllowanceHold {
    if (!allowance || availableWorkAllowance(allowance.execution) && availableWorkAllowance(allowance.resolution))
        return undefined;
    return controller.inspectChangeContinuationPrerequisites(workId).allowanceHold;
}

export function workAllowanceText(locale: UiLocale, kind: 'execution' | 'resolution', budget: BudgetView | null): string {
    const name = uiText(locale, kind === 'execution' ? 'workRecovery.executionName' : 'workRecovery.resolutionName');
    return budget
        ? uiText(locale, 'workRecovery.budget', { name, ...budget, available: availableWorkAllowance(budget) })
        : uiText(locale, 'workRecovery.budgetNone', { name });
}

/** Display facts when either shared balance has no currently available units. */
export function limitedSharedAllowanceText(locale: UiLocale, { execution, resolution }: { execution: BudgetView; resolution: BudgetView }): string[] {
    if (availableWorkAllowance(execution) && availableWorkAllowance(resolution)) return [];
    return [workAllowanceText(locale, 'execution', execution), workAllowanceText(locale, 'resolution', resolution)];
}
