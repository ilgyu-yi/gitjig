// Host permits only its original owned Git launcher; no SDK/provider process or network.
import '../cli/account-ui-no-network.mjs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
const spawn=cp.spawn,launcher=fileURLToPath(new URL('../../dist/effects/git-process-child.js',import.meta.url));let forbidden=0;
const deny=()=>{forbidden++;throw Error('Only original native Git launcher is allowed');};
for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=deny;
cp.spawn=(binary,args,...rest)=>binary===process.execPath&&args[0]===launcher?spawn(binary,args,...rest):deny();
syncBuiltinESMExports();process.on('exit',()=>{if(forbidden)process.exitCode=1;});
