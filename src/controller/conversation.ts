import { SessionManager } from '@earendil-works/pi-coding-agent';
import { ensurePiSessionDirectory } from '../pi/host.js';
import { nativeCheckpoint } from './history.js';
import type { Controller } from './controller.js';
import type { ContainerScope } from '../execution/container-scope.js';
import type { PiModelSelection } from '../pi/session.js';
import { initializePiHost, createPiSession } from '../pi/index.js';
import type { PiProjectOperations } from '../pi/operations.js';
import { tmpdir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { userConversationLanguage } from '../pi/language-policy.js';
export async function runConversation(options: {
    controller: Controller;
    runId: string;
    workId: string;
    scope: ContainerScope;
    model: PiModelSelection;
    message: string;
    stateRoot: string;
    artifactRoot: string;
    signal: AbortSignal;
    historyRef?: string;
    sessionId?: string;
}) {
    const { controller, runId, scope, signal } = options;
    if (await realpath(tmpdir()) !== options.artifactRoot)
        throw new Error(`Start the process with TMPDIR=${options.artifactRoot} before native Pi helper initialization`);
    const host = await initializePiHost({ stateRoot: options.stateRoot, artifactRoot: options.artifactRoot });
    const entry = () => controller.assertRunEntry(runId);
    const combined = (other?: AbortSignal) => other ? AbortSignal.any([signal, other]) : signal;
    const ops: PiProjectOperations = { workspaceRoot: scope.workspaceRoot, validatePath: p => scope.validatePath(p),
        exec: async (command, cwd, opts) => {
            entry();
            const began = performance.now();
            try {
                const observed = await scope.execute(command, { cwd, timeoutMs: (opts.timeout ?? 60) * 1000, signal: combined(opts.signal), onData: opts.onData });
                controller.observeOperation(runId, { kind: 'experiment', command, cwd, scratchInput: 'mutable-or-unknown', durationMs: performance.now() - began, ...observed });
                return { exitCode: observed.exitCode };
            }
            catch (error) {
                controller.observeOperation(runId, { kind: 'experiment', command, cwd, status: 'unavailable', error: String(error) });
                throw error;
            }
        },
        readFile: async (p, o) => {
            entry();
            return scope.readFile(p, { ...o, signal: combined(o.signal) });
        }, access: async (p, m, s) => {
            entry();
            return scope.access(p, m, combined(s));
        }, writeFile: async (p, c, s) => {
            entry();
            return scope.writeFile(p, c, combined(s));
        }, mkdir: async (p, s) => {
            entry();
            return scope.mkdir(p, combined(s));
        } };
    const sessionManager = options.historyRef ? SessionManager.open(options.historyRef, await ensurePiSessionDirectory(host), scope.workspaceRoot) : undefined;
    if (sessionManager && sessionManager.getSessionId() !== options.sessionId)
        throw new Error('Retained native session identity changed');
    const pi = await createPiSession({ host, operations: ops, model: options.model, systemPrompt: userConversationLanguage + ' This is a read-only investigation. Retain the owner request and uncertainty; do not invent consequential intent. Scratch experiments are allowed but do not verify the captured candidate. Implementation, review-ready and publication are unavailable until planning/challenge/adjudication.', maxReadBytes: 1024 * 1024, beforeModelRequest: async (manager) => {
            entry();
            const checkpoint = await nativeCheckpoint(manager.getSessionFile()!);
            const leafId = manager.getLeafId();
            if (!leafId)
                throw new Error('Native request checkpoint leaf absent');
            controller.recordModelDispatch(runId, { ...checkpoint, leafId });
        }, onModelDispatch: model => { entry(); controller.observeOperation(runId, { type: 'resolved-model', model }); }, ...(sessionManager ? { sessionManager } : {}) });
    const limitations: string[] = [];
    let settled = false;
    const historyRef = pi.sessionManager.getSessionFile()!;
    controller.recordHistory(runId, historyRef, pi.sessionManager.getSessionId());
    const unsubscribe = pi.session.subscribe(event => {
        if (event.type === 'message_end' && event.message.role === 'user') {
            controller.recordNativeInput(runId);
        }
        else if (event.type === 'tool_execution_end') {
            const usable = Buffer.byteLength(JSON.stringify(event.result)) <= 2 * 1024 * 1024;
            if (!usable)
                limitations.push(`Native result ${event.toolCallId} unavailable: exceeds2MiB observation bound`);
            controller.observeOperation(runId, { kind: 'native-event', type: event.type, historyRef, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, ...(usable ? { result: event.result } : { resultStatus: 'unavailable-over-limit', limitBytes: 2 * 1024 * 1024 }) });
        }
        else if (event.type === 'agent_settled') {
            settled = true;
            controller.observeOperation(runId, { kind: 'native-event', type: event.type, historyRef, aborted: event.aborted });
        }
    });
    const abort = () => {
        void pi.session.abort();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
        entry();
        if (signal.aborted)
            throw new Error('conversation cancelled');
        const before = pi.session.messages.length;
        controller.recordNativePromptAttempt(runId);
        await pi.session.prompt(options.message);
        const checkpoint = await nativeCheckpoint(historyRef);
        const leafId = pi.sessionManager.getLeafId();
        if (!leafId)
            throw new Error('Native history has no checkpoint leaf');
        controller.recordNativeCheckpoint(runId, { ...checkpoint, leafId });
        entry();
        const assistants = pi.session.messages.slice(before).filter(m => m.role === 'assistant');
        const last = assistants.at(-1);
        if (!settled || !last || last.stopReason !== 'stop')
            throw new Error(`Native response unavailable: ${last?.stopReason ?? 'no-new-terminal-response'} ${last?.errorMessage ?? ''}`);
        const texts = last.content.filter(c => c.type === 'text').map(c => c.text);
        return { text: texts.join('\n'), historyRef, limitations };
    }
    finally {
        try {
            const checkpoint = await nativeCheckpoint(historyRef);
            const leafId = pi.sessionManager.getLeafId();
            if (leafId)
                controller.recordNativeCheckpoint(runId, { ...checkpoint, leafId });
        }
        catch (error) {
            controller.observeOperation(runId, { kind: 'native-checkpoint-unavailable', error: String(error) });
        }
        unsubscribe();
        signal.removeEventListener('abort', abort);
        await pi.closeOwned();
    }
}
