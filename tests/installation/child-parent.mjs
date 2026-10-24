import fs from 'node:fs/promises';
import {runInstallationCommand} from '../../dist/installation/child.js';
const input=JSON.parse(process.argv[2]);
if(process.argv[3]==='cut-before-launch'){
 const open=fs.open.bind(fs);
 fs.open=async(file,...rest)=>{const handle=await open(file,...rest);if(String(file).includes('/installation-children/'+input.ownerId+'/')&&/^[a-f0-9-]{36}$/.test(String(file).split('/').at(-1))){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();process.kill(process.pid,'SIGKILL');};}return handle;};
}
await runInstallationCommand(input);
