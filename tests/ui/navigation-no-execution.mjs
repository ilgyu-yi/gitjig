// Deny and count execution attempts in an owned navigation-only CLI fixture.
import fs from 'node:fs';
import cp from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
const entry = path.dirname(fs.realpathSync(process.argv[1]));
const product = path.basename(entry) === 'cli' && path.basename(path.dirname(entry)) === 'dist'
    ? path.resolve(entry, '../..') : fileURLToPath(new URL('../../', import.meta.url));
const {Controller} = await import(pathToFileURL(path.join(product, 'dist/controller/controller.js')).href);
const {ApplicationModels} = await import(pathToFileURL(path.join(product, 'dist/app/models.js')).href);
const attempted={process:0,network:0,model:0,run:0};
const deny=kind=>()=>{attempted[kind]++;throw Error('Navigation fixture forbids '+kind+' execution');};
for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[method]=deny('process');
globalThis.fetch=deny('network');net.Socket.prototype.connect=deny('network');
Controller.prototype.runConversation=deny('run');ApplicationModels.prototype.resolve=deny('model');
const failActivationFrom = process.env.GITJIG_TEST_FAIL_ACTIVATION_FROM;
if (failActivationFrom) {
    const select = Controller.prototype.setConversationView;
    let failed = false;
    Controller.prototype.setConversationView = function (options) {
        if (!failed && options.selectedId !== failActivationFrom) {
            failed = true;
            throw Error('Controlled first destination activation failure');
        }
        return select.call(this, options);
    };
}
syncBuiltinESMExports();
process.on('exit',()=>{
    fs.writeFileSync(process.env.GITJIG_NAVIGATION_RECEIPT,JSON.stringify(attempted),{mode:0o600,flag:'wx'});
    if(Object.values(attempted).some(Boolean))process.exitCode=1;
});
