/** Private source-PTY timing control; always invokes the original restore. */
import fs from 'node:fs/promises';
import { Controller } from '../../dist/controller/controller.js';
const control = process.env.GITJIG_UI_RESTORE_CONTROL;
if (!control) throw new Error('Explicit private lifecycle control path required');
let held = false, historyWhileHeld = 0;
const restore = Controller.prototype.restoreConversation, history = Controller.prototype.getConversationHistory;
Controller.prototype.getConversationHistory = function (...args) {
    if (held) { historyWhileHeld++; void fs.writeFile(control + '.history', String(historyWhileHeld)); }
    return history.apply(this, args);
};
Controller.prototype.restoreConversation = async function (...args) {
    held = true; await fs.writeFile(control + '.history', '0');
    process.stdout.write('OWNED_RESTORE_BARRIER\n');
    try {
        const deadline = Date.now() + 1500;
        while (true) {
            try { await fs.access(control + '.release'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (Date.now() >= deadline) throw new Error('Owned restore barrier release unavailable');
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        return await restore.apply(this, args);
    } finally { held = false; await fs.writeFile(control + '.history', String(historyWhileHeld)); }
};
