import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { showExactReview } from './exact-review.js';
import type { Controller } from '../controller/controller.js';
import type { HostCommand, HostCommandContext, HostCommandOutcome } from './host-commands.js';
interface InputHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    retry(target: string, inputId: string, fingerprint: string): Promise<void | boolean>;
    inspectWork(target: string, workId: string, context?: HostCommandContext): Promise<void | HostCommandOutcome>;
    notice(text: string): void;
}
export function inputCommands(host: InputHost): HostCommand[] {
    return [{ name: 'inputs', description: 'Inspect sent requests; review safe retry or withdrawal', run: async (_argument, target, context) => {
                const current = () => {
                    if (!host.isCurrent(target))
                        throw Error('Conversation changed; reopen /inputs');
                };
                while (true) {
                    current();
                    const inputs = host.controller.inspectConversationInputs(target);
                    if (!inputs.length) {
                        host.notice('No pending sent requests. Use /ready to choose your next step.');
                        return 'completed';
                    }
                    const labels = inputs.map((input, i) => {
                        const status = input.eligible
                            ? input.interrupted ? 'Interrupted request' : 'Not sent to model'
                            : input.undispatched ? 'Not sent to model · recovery held' : 'Awaiting response or reconciliation';
                        const preview = stripTerminalSequences(input.text ?? 'Retained input')
                            .replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ').slice(0, 80);
                        return `${i + 1}. ${status} · ${preview}`;
                    });
                    const selected = await host.choose('Sent requests · retained independently of model history', [...labels, 'Back']);
                    current();
                    if (!selected || selected === 'Back')
                        return 'cancelled';
                    const input = inputs[labels.indexOf(selected)];
                    if (!input)
                        throw Error('Unknown sent request');
                    const fresh = () => {
                        current();
                        if (host.controller.inspectConversationInputs(target).find(row => row.inputId === input.inputId)?.fingerprint !== input.fingerprint)
                            throw Error('Sent request changed; reopen /inputs');
                    };
                    await showExactReview(host, 'Original sent request · review before action', {
                        request: input.text,
                        lastAttempt: input.failure ?? 'No startup failure recorded',
                        explanation: input.explanation,
                        inputId: input.inputId,
                        workId: input.workId,
                        runId: input.runId ?? 'not started',
                        recoveryEntry: input.blockingWorkIds.map(id => '/work ' + id).join(' · ') || '/work · /error',
                        effects: 'Withdrawal retains original text, history, attempts and spent allowance; it starts no task. Retry can use model credits and remaining execution allowance.',
                    }, fresh, 'no action yet');
                    fresh();
                    if (!input.eligible) {
                        if (input.blockingWorkIds.length) {
                            const labels = input.blockingWorkIds.map(id => 'Inspect blocking work · ' + id);
                            const action = await host.choose('Retained request · recovery held', ['Back without changes', ...labels]);
                            fresh();
                            if (!action || action === 'Back without changes')
                                continue;
                            const id = input.blockingWorkIds[labels.indexOf(action)];
                            if (!id)
                                throw Error('Unknown blocking work');
                            return await host.inspectWork(target, id, context) ?? 'completed';
                        }
                        continue;
                    }
                    const action = await host.choose('This exact request · choose explicitly', ['Back without changes', 'Retry original request', 'Withdraw original request']);
                    fresh();
                    if (action === 'Retry original request') {
                        if (await host.retry(target, input.inputId, input.fingerprint) === false)
                            return 'cancelled';
                        context?.acknowledgeSubmission?.();
                        return 'started';
                    }
                    if (action === 'Withdraw original request') {
                        host.controller.recoverConversationInput({ conversationId: target, inputId: input.inputId, expectedContext: input.fingerprint, action: 'withdraw' });
                        host.notice('Request withdrawn; original evidence retained. Open /ready for the next step.');
                    }
                }
            } }];
}
