import '../cli/account-ui-no-network.mjs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
let attempted=0;
const deny=()=>{attempted++;throw Error('No engine or provider process is allowed during setup inspection');};
for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[method]=deny;
syncBuiltinESMExports();
process.on('exit',()=>{if(attempted)process.exitCode=1;});
