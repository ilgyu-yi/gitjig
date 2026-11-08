// Observe the original CLI's active frame and focus without replacing its UI or admission.
import './readiness-no-execution.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const product = path.resolve(path.dirname(fs.realpathSync(process.argv[1])), '../..');
const load = relative => import(pathToFileURL(path.join(product, relative)).href);
const [{ CustomEditor }, { TuiAltScreen, stripTerminalSequences }, { Controller }] = await Promise.all([
    load('node_modules/@earendil-works/pi-coding-agent/dist/index.js'),
    load('node_modules/@earendil-works/pi-tui/dist/index.js'),
    load('dist/controller/controller.js'),
]);

let controller, screen, sequence = 0;
const subscribe = Controller.prototype.subscribeGoals;
Controller.prototype.subscribeGoals = function (...args) {
    controller = this;
    return subscribe.apply(this, args);
};
const start = TuiAltScreen.prototype.start;
TuiAltScreen.prototype.start = function (...args) {
    screen = this;
    return start.apply(this, args);
};
const timer = setInterval(() => {
    if (!controller || !screen) return;
    try {
        const selected = controller.store.one('SELECT selected FROM interaction_view')?.selected;
        if (!selected) return;
        const view = controller.inspectConversation(selected);
        const snapshot = {
            sequence: ++sequence,
            frame: screen.getScreenLines().map(line => stripTerminalSequences(line)),
            editorFocused: screen.getFocusedComponent() instanceof CustomEditor,
            draft: view.draft.text,
            modelChoice: controller.getConversationModelChoice(selected),
            counts: Object.fromEntries(['works', 'runs', 'conversation_inputs'].map(table => [
                table, controller.store.one('SELECT COUNT(*) AS count FROM ' + table).count,
            ])),
        };
        fs.writeFileSync(process.env.GITJIG_COMPOSER_OBSERVATION + '.next', JSON.stringify(snapshot));
        fs.renameSync(process.env.GITJIG_COMPOSER_OBSERVATION + '.next', process.env.GITJIG_COMPOSER_OBSERVATION);
    } catch {
        // The existing controller owns startup/close failures; observation grants no authority.
    }
}, 5);
timer.unref();
process.on('exit', () => clearInterval(timer));
