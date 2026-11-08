// Model-free owner delegation may not create any native process or worker.
import '../cli/account-ui-no-network.mjs';
import cp from 'node:child_process';import wt from 'node:worker_threads';import {syncBuiltinESMExports} from 'node:module';
let forbidden=0;const deny=()=>{forbidden++;throw Error('Owner delegation may not launch native/model/runtime work');};for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=deny;wt.Worker=class{constructor(){deny();}};syncBuiltinESMExports();process.on('exit',()=>{if(forbidden)process.exitCode=1;});
