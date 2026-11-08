// Trusted source-UI driver: fixed logical GitHub traffic maps only to this owned TLS service.
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const port=process.env.GITJIG_PUBLICATION_PORT;
if(!port||!/^[0-9]+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('Explicit owned publication TLS port required');
let attempted=0;const deny=()=>{attempted++;throw Error('Publication terminal fixture forbids process/model/unowned network requests');};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny;
globalThis.fetch=deny;http.request=deny;const request=https.request;
https.request=(url,options,...args)=>{
 if(!(url instanceof URL)||url.protocol!=='https:'||url.hostname!=='api.github.com'||url.port||url.username||url.password||!(options?.method==='GET'||options?.method==='POST'&&url.pathname==='/repos/owner/repo/issues/8/comments'))return deny();
 const mapped=new URL(url);mapped.hostname='127.0.0.1';mapped.port=port;return request(mapped,options,...args);
};
syncBuiltinESMExports();process.on('exit',()=>{if(attempted)process.exitCode=1;});
