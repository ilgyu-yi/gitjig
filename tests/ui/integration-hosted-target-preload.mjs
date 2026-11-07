import net from 'node:net';
import '../cli/normal-hosted-adapter.mjs';
// Reuse the original native-launcher/model tripwire, allowing only this owned
// REST fixture's loopback socket in the host. Native TLS is owned by Git.
const connect=net.Socket.prototype.connect;
await import('./integration-read-native-only.mjs');
const rest=new URL(process.env.TEST_NORMAL_REST_ORIGIN);let forbidden=0;
net.Socket.prototype.connect=function(...args){const value=Array.isArray(args[0])?args[0][0]:args[0],options=typeof value==='object'?value:{port:value,host:args[1]};if(options?.host!==rest.hostname||String(options.port)!==rest.port){forbidden++;throw Error('Only original owned REST fixture socket allowed');}return Reflect.apply(connect,this,args);};
process.on('exit',()=>{if(forbidden)process.exitCode=1;});
