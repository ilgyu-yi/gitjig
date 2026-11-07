// Read-only sampling of the actual CLI screen and original controller ledger.
// This helper does not replace UI dispatch, workflow, runtime or provider behavior.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {CustomEditor} from '@earendil-works/pi-coding-agent';
import {TuiAltScreen, stripTerminalSequences} from '@earendil-works/pi-tui';
import {Controller} from '../../dist/controller/controller.js';

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
const tables = ['works', 'sources', 'requirements', 'change_state', 'change_versions', 'runs', 'budgets',
    'obligations', 'role_launches', 'role_outputs', 'conversation_inputs', 'effect_delegations', 'capacity_leases', 'results', 'observations'];
const timer = setInterval(() => {
    if (!controller || !screen) return;
    try {
        const selected = controller.store.one('SELECT selected FROM interaction_view')?.selected;
        if (!selected) return;
        const view = controller.inspectConversation(selected);
        const ledger = Object.fromEntries(tables.map(table => [table, controller.store.all('SELECT * FROM ' + table + ' ORDER BY rowid')]));
        const snapshot = {
            sequence: ++sequence, selected, draft: view.draft.text,
            editorFocused: screen.getFocusedComponent() instanceof CustomEditor,
            autocomplete: screen.getFocusedComponent() instanceof CustomEditor && screen.getFocusedComponent().isShowingAutocomplete(),
            frame: screen.getScreenLines().map(stripTerminalSequences),
            ledger: createHash('sha256').update(JSON.stringify(ledger)).digest('hex'),
        };
        const file = process.env.GITJIG_RESULT_OBSERVATION;
        fs.writeFileSync(file + '.next', JSON.stringify(snapshot));
        fs.renameSync(file + '.next', file);
    } catch {
        // Startup/close remains owned by the original CLI; an unavailable sample cannot pass.
    }
}, 20);
timer.unref();
process.on('exit', () => clearInterval(timer));
