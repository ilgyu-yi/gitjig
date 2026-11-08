import type { Controller } from '../controller/controller.js';

/** Recorded result correspondence only. Native delivery eligibility belongs to its original action. */
export function captureResultDelivery(c: Controller, workId: string) {
    const read = () => {
        const work = c.inspectWork(workId), result = c.inspectChangeResult(workId);
        if (work.workId !== workId || result.workId !== workId || work.projectId !== result.projectId)
            throw Error('Original result project correspondence unavailable');
        const workIdentity = JSON.stringify({ workId, projectId: work.projectId, epoch: work.epoch,
            lineageRoot: work.lineageRoot, source: work.source, sourceRoot: result.registeredSourceRoot });
        return { result, workIdentity, identity: JSON.stringify({ workIdentity, result }) };
    };
    const captured = read();
    return {
        workId, projectId: captured.result.projectId, result: captured.result,
        assertCurrent() {
            if (read().identity !== captured.identity)
                throw Error('Original result changed; reopen /result before reviewing delivery');
        },
        assertWorkCurrent() {
            if (read().workIdentity !== captured.workIdentity)
                throw Error('Original result work or source changed; reopen /result');
        },
    };
}
