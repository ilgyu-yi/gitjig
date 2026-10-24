import net from 'node:net';
import '../cli/merge-target-preload.mjs';
const connect=net.Socket.prototype.connect;
await import('./integration-read-native-only.mjs');
const origin=new URL(process.env.TEST_OWNED_MERGE_ORIGIN);let forbidden=0;
net.Socket.prototype.connect=function(...args){const value=Array.isArray(args[0])?args[0][0]:args[0],options=typeof value==='object'?value:{port:value,host:args[1]};if(options?.host!==origin.hostname||String(options.port)!==origin.port){forbidden++;throw Error('Only owned PR identity socket is allowed');}return Reflect.apply(connect,this,args);};
process.on('exit',()=>{if(forbidden)process.exitCode=1;});
