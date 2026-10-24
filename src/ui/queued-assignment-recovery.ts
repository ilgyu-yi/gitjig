import type { Controller } from '../controller/controller.js';
import type { HostCommandOutcome } from './host-commands.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { showExactReview } from './exact-review.js';
import { translator, type UiLocale } from './i18n.js';

type Review = ReturnType<Controller['inspectQueuedAssignmentCancellation']>;
export type QueuedTaskRecovery = { assignmentId: string } & (
    { review: Review; unavailable?: never } | { review?: never; unavailable: string }
);

/** Project hold discovery supplies identities; only the controller can qualify cancellation. */
export function inspectQueuedTaskRecovery(controller: Controller, conversationId: string, generation: number): QueuedTaskRecovery[] {
    const holds = controller.inspectConversationProjectDependencies({ conversationId, expectedGeneration: generation });
    const ids = [...new Set(holds.items.filter(item => item.assignmentId && !item.workId && item.assignmentState === 'QUEUED').map(item => item.assignmentId!))];
    return ids.map(assignmentId => {
        try {
            return { assignmentId, review: controller.inspectQueuedAssignmentCancellation({ conversationId, expectedGeneration: generation, assignmentId }) };
        }
        catch (error) {
            return { assignmentId, unavailable: error instanceof Error ? error.message : String(error) };
        }
    });
}

interface Host extends UiChoiceHost {
    controller: Controller;
    locale: UiLocale;
    guard(): void;
    show(title: string, text: string): Promise<void>;
    notice(text: string): void;
}

/** Review an original unallocated assignment; never turn its input into an ordinary retry. */
export async function recoverQueuedTask(host: Host, entry: QueuedTaskRecovery): Promise<HostCommandOutcome> {
    const t = translator(host.locale);
    host.guard();
    if (!entry.review) {
        await host.show(t('queuedTask.unavailable', { id: entry.assignmentId }), entry.unavailable);
        host.guard();
        return 'cancelled';
    }
    const review = entry.review;
    const input = { conversationId: review.conversationId, expectedGeneration: review.generation, assignmentId: review.assignmentId };
    const fresh = () => {
        host.guard();
        if (host.controller.inspectQueuedAssignmentCancellation(input).fingerprint !== review.fingerprint)
            throw Error('Queued task changed; reopen /error before reviewing cancellation');
    };
    fresh();
    await showExactReview(host, t('queuedTask.review'), {
        scope: t('queuedTask.scope'),
        assignmentId: review.assignmentId,
        originalCoordinator: review.sourceConversationId,
        taskConversation: review.targetConversationId,
        project: review.projectId,
        taskKind: review.operation,
        originalQueuedInput: review.inputId,
        resultWaitsToCancel: review.pendingDependencyCount,
        originalInstructions: review.instructions,
    }, fresh, 'no cancellation yet');
    const action = await chooseUiItem(host, t('queuedTask.confirm'), [
        { value: 'back', label: t('queuedTask.back') },
        { value: 'cancel', label: t('queuedTask.cancel') },
    ]);
    fresh();
    if (!action || action === 'back')
        return 'cancelled';
    await host.controller.cancelQueuedAssignment({
        ...input, expectedFingerprint: review.fingerprint,
        reason: 'Owner cancelled the exact unstarted delegated task after reviewing its queued assignment',
        validate: host.guard,
    });
    // The committed cancellation changes the old assignment snapshot.
    try { host.guard(); } catch { return 'completed'; }
    host.notice(t('queuedTask.cancelled'));
    return 'completed';
}
