import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
let attempted=0;const deny=()=>{attempted++;throw Error('Repository terminal fixture forbids model/process/unowned network execution');};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny;
globalThis.fetch=deny;http.request=deny;
const request=https.request;https.request=(url,...args)=>{if(url.protocol!=='https:'||url.hostname!=='127.0.0.1'||url.port!==process.env.GITJIG_REPOSITORY_PORT)return deny();return request(url,...args);};syncBuiltinESMExports();
process.on('exit',()=>{if(attempted)process.exitCode=1;});
