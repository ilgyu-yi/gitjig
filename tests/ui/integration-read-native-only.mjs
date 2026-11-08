// Host permits only its original owned Git launcher; no SDK/provider process or network.
import '../cli/account-ui-no-network.mjs';
import cp from 'node:child_process';
import {realpathSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const entry=process.env.GITJIG_TEST_CLI_ENTRY;
export const fixtureDist=entry?path.resolve(path.dirname(realpathSync(entry)),'..')
 :fileURLToPath(new URL('../../dist',import.meta.url));
const launcher=path.join(fixtureDist,'effects/git-process-child.js');
const spawn=cp.spawn;let forbidden=0;
const deny=()=>{forbidden++;throw Error('Only original native Git launcher is allowed');};
for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=deny;
cp.spawn=(binary,args,...rest)=>binary===process.execPath&&args[0]===launcher?spawn(binary,args,...rest):deny();
syncBuiltinESMExports();process.on('exit',()=>{if(forbidden)process.exitCode=1;});
