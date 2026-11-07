import './composer-readiness-observer.mjs';
import fs from 'node:fs';
import { ApplicationStartup } from '../../dist/app/startup.js';

const gate = process.env.GITJIG_MODAL_GATE;
const inspect = ApplicationStartup.prototype.inspect;
let held = false;
ApplicationStartup.prototype.inspect = async function (...args) {
    // Arm only after the real getting-started guide is open. The next original
    // readiness read must settle before the existing command can continue/close.
    if (!held && fs.existsSync(gate)) {
        held = true;
        fs.writeFileSync(gate + '.entered', 'original startup inspection held');
        const deadline = performance.now() + 5000;
        while (!fs.existsSync(gate + '.release')) {
            if (performance.now() > deadline) throw Error('Owned modal inspection gate was not released');
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        fs.writeFileSync(gate + '.settled', 'original startup inspection released');
    }
    return inspect.apply(this, args);
};
