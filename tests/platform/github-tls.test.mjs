import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeReadTransport} from '../../dist/platform/github-transport.js';

test('native HTTPS refuses an untrusted owned TLS endpoint even with ambient verification disabled',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'github-tls-negative-'))),key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem');
 await promisify(execFile)('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{timeout:5000,maxBuffer:16384});
 let credentialRequests=0;const sockets=new Set();const server=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(cert)},(_req,res)=>{credentialRequests++;res.writeHead(200,{'Content-Type':'application/json'});res.end('{"fixture":true}');});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const previous=process.env.NODE_TLS_REJECT_UNAUTHORIZED;process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
 try{
  const read=nativeReadTransport('fixture-only-not-a-real-token',{requestTimeoutMs:1000,responseBytes:4096,pages:2,collectionBytes:8192,collectionItems:100});
  await assert.rejects(read(new URL('https://127.0.0.1:'+server.address().port+'/user')),/transport unavailable/);
  assert.equal(credentialRequests,0);
  t.diagnostic(JSON.stringify({actualOwnedHttps:true,ambientVerificationDisabled:true,credentialRequests,liveCredentials:false,externalRequests:0}));
 }finally{if(previous===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=previous;for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
