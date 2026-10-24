import fs from 'node:fs';
import path from 'node:path';
import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { TuiAltScreen, stripTerminalSequences } from '@earendil-works/pi-tui';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
import { ApplicationStartup } from '../../dist/app/startup.js';
import { startConversationUI } from '../../dist/ui/index.js';

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const controller = await openController({ installationHome: cfg.home });
process.env.TMPDIR = path.join(cfg.home, 'artifacts');
const conversation = controller.createConversation().conversationId;
let screen, completeResponse, removeHook, requestCalls = 0, nativeRequests = 0, hookCalls = 0;
let answer = null, held = false, released = false;
const start = TuiAltScreen.prototype.start;
TuiAltScreen.prototype.start = function (...args) { screen = this; return start.apply(this, args); };
const inspect = ApplicationStartup.prototype.inspect;
ApplicationStartup.prototype.inspect = async function (...args) {
    if (!held && fs.existsSync(cfg.gate)) {
        held = true;
        const native = controller.getNativeHandle(conversation);
        if (!native) throw Error('The held setup read requires an actual live native session');
        const ui = native.session.extensionRunner.getUIContext();
        removeHook = ui.onTerminalInput(() => { hookCalls++; return undefined; });
        nativeRequests++;
        void ui.confirm('Native confirmation arrived during setup', 'Answer only after returning from setup').then(value => {
            answer = value;
            removeHook();
            completeResponse();
        });
        const deadline = performance.now() + 5000;
        while (!fs.existsSync(cfg.gate + '.release')) {
            if (performance.now() > deadline) throw Error('Owned native modal gate was not released');
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        released = true;
    }
    return inspect.apply(this, args);
};
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const model = { provider: 'native-modal-owned', modelId: 'fixture', definition: {
    api: 'fixture-api', apiKey: 'fixture-only', baseUrl: 'http://unused.invalid',
    models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: usage.cost, contextWindow: 32000, maxTokens: 1000 }],
    streamSimple(selected) {
        requestCalls++;
        const stream = createAssistantMessageEventStream();
        completeResponse = () => {
            const message = { role: 'assistant', content: [{ type: 'text', text: 'Native modal response settled' }],
                api: selected.api, provider: selected.provider, model: selected.id, usage, stopReason: 'stop', timestamp: Date.now() };
            stream.push({ type: 'done', reason: 'stop', message });
            stream.end(message);
        };
        return stream;
    },
} };
const snapshot = () => ({ frame: screen?.getScreenLines().map(line => stripTerminalSequences(line)) ?? [],
    editorFocused: screen?.getFocusedComponent() instanceof CustomEditor,
    draft: controller.inspectConversation(conversation).draft.text,
    state: controller.inspectConversation(conversation).state,
    held, released, answer, hookCalls, requestCalls, nativeRequests,
    counts: Object.fromEntries(['works', 'runs', 'conversation_inputs'].map(table => [table,
        controller.store.one('SELECT COUNT(*) AS count FROM ' + table).count])),
});
const timer = setInterval(() => {
    try {
        fs.writeFileSync(cfg.control + '.next', JSON.stringify(snapshot()));
        fs.renameSync(cfg.control + '.next', cfg.control);
    } catch { /* Original startup/close owns errors. */ }
}, 5);
try {
    await startConversationUI({ controller, model, conversationId: conversation });
    clearInterval(timer);
    fs.writeFileSync(cfg.receipt, JSON.stringify(snapshot()));
} finally {
    clearInterval(timer);
    removeHook?.();
    ApplicationStartup.prototype.inspect = inspect;
    TuiAltScreen.prototype.start = start;
    await controller.close();
}
