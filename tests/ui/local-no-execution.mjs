import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
let attempted=0;const deny=()=>{attempted++;throw Error('Local terminal forbids model, engine and network execution');};
const original=cp.spawn;
for(const key of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny;
cp.spawn=(file,args,options,...rest)=>{
 if(file!==process.env.GITJIG_LOCAL_GIT_BINARY||!Array.isArray(args)||args[0]!=='--no-pager'||!args.includes('--no-optional-locks')||options?.env?.GIT_TERMINAL_PROMPT!=='0'||options?.detached!==true)return deny();
 return original(file,args,options,...rest);
};
http.request=deny;https.request=deny;globalThis.fetch=deny;syncBuiltinESMExports();process.on('exit',()=>{if(attempted)process.exitCode=1;});
