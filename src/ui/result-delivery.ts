import type { Controller } from '../controller/controller.js';
import type { ChangeResultOptions } from '../controller/change-types.js';
import { uiText, type UiLocale } from './i18n.js';

/** Original custody only. Current assessment and delivery admission are separate. */
export function captureDeliveryWork(c: Controller, workId: string, locale: UiLocale = 'en',
    unavailableMessage = uiText(locale, 'result.correspondenceUnavailable')) {
    const work = c.inspectDeliveryWork(workId);
    if (!work || work.workId !== workId)
        throw Error(unavailableMessage);
    return {
        ...work,
        assertCurrent() {
            if (c.inspectDeliveryWork(workId)?.fingerprint !== work.fingerprint)
                throw Error(uiText(locale, 'result.workChanged'));
        },
    };
}

/** Recorded result correspondence only. Native delivery eligibility belongs to its original action. */
export function captureResultDelivery(c: Controller, workId: string, { locale = 'en', ...options }:
    Pick<ChangeResultOptions, 'caseValues' | 'checkStderr'> & {locale?: UiLocale} = {}) {
    const work = captureDeliveryWork(c, workId, locale);
    const readResult = () => {
        const result = c.inspectChangeResult(workId, {...options, retainedChecks: true});
        if (result.workId !== workId || result.projectId !== work.projectId || result.registeredSourceRoot !== work.sourceRoot)
            throw Error(uiText(locale, 'result.correspondenceUnavailable'));
        return result;
    };
    const result = readResult(), identity = JSON.stringify(result);
    return {
        workId, projectId: work.projectId, result,
        assertCurrent() {
            work.assertCurrent();
            if (JSON.stringify(readResult()) !== identity)
                throw Error(uiText(locale, 'result.changed'));
        },
        assertWorkCurrent: work.assertCurrent,
    };
}
