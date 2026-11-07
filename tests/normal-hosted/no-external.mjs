/** Owned test tripwire, never a product route. No canonical dummy-token egress. */
import http from'node:http';import https from'node:https';
let forbiddenAttempts=0;
process.on('exit',()=>{if(forbiddenAttempts){console.error('Forbidden external test attempts: '+forbiddenAttempts);process.exitCode=1;}});
for(const api of[http,https])for(const method of['request','get']){const original=api[method];api[method]=function(...args){const x=args[0];let host;if(typeof x==='string'||x instanceof URL)host=new URL(x).hostname;else host=x?.hostname??x?.host;if(!['127.0.0.1','localhost','::1'].includes(host)){forbiddenAttempts++;throw Error('TEST_EXTERNAL_NETWORK_REFUSED');}return Reflect.apply(original,this,args);};}
