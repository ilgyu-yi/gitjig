// Attribution tripwire for this owned installed fixture, not a general sandbox.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import net from 'node:net';
import workers from 'node:worker_threads';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {guardedProcessMethod} from './guarded-process-method.mjs';
const manifest=JSON.parse(fs.readFileSync(process.env.GITJIG_DISCOVERY_MANIFEST,'utf8'));
const payload=fs.realpathSync(manifest.payload),trace=manifest.trace;
const controls=new Map(manifest.controls.map(row=>[row.path,row.sha256]));
for(const [file,hash] of controls)if(fs.realpathSync(file)!==file||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error('Frozen installed discovery control changed');
let denied=0;
const record=(kind,value={})=>fs.appendFileSync(trace,JSON.stringify({pid:process.pid,kind,...value})+'\n',{mode:0o600});
const deny=boundary=>{denied++;record('denied',{boundary});throw Error('Installed discovery denied: '+boundary);};
registerHooks({resolve(specifier,context,next){
 const result=next(specifier,context);
 if(result.url.startsWith('file:')){
  const file=fs.realpathSync(fileURLToPath(result.url));
  if(file.startsWith(payload+path.sep))record('module',{file});
  else if(controls.has(file))record('control-module',{file});
  else deny('module outside installed payload');
 }
 return result;
}});
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const options=Array.isArray(args[0])?args[0][0]:args[0],port=typeof options==='object'?Number(options.port):Number(options),host=typeof options==='object'?(options.host??options.hostname):args[1];
 if(host!=='127.0.0.1'||port!==manifest.port)return deny('socket outside owned model fixture');
 record('model-socket',{host,port});return Reflect.apply(connect,this,args);
};
for(const method of ['spawn','execFile','execFileSync','spawnSync']){
 const actual=cp[method];
 cp[method]=guardedProcessMethod(actual,function(binary,args,...rest){
  let kind;
  if(binary==='/bin/ps')kind='process-observation';
  else if(binary===process.execPath&&args?.[0]===path.join(payload,'dist/effects/git-process-child.js'))kind='native';
  else if(binary===manifest.runtime.dockerBinary&&Array.isArray(args)&&args.slice(0,4).join('\0')===['--config',manifest.runtime.dockerConfigDirectory,'--context',manifest.runtime.dockerContext].join('\0')&&(!args.includes('create')&&!args.includes('run')||args.includes(manifest.runtime.image)))kind='engine';
  else return deny(method);
  record(kind,{method,binary,args});const result=Reflect.apply(actual,this,[binary,args,...rest]);
  const child=result?.child??result;if(Number.isSafeInteger(child?.pid))record('child-process',{owner:kind,method,childPid:child.pid});return result;
 });
}
for(const method of ['exec','execSync','fork'])cp[method]=()=>deny(method);
const Worker=workers.Worker;
workers.Worker=class extends Worker{constructor(file,options){
 const selected=fs.realpathSync(typeof file==='string'?file:fileURLToPath(file));
 if(selected!==path.join(payload,'dist/controller/capture-worker.js'))deny('worker outside installed payload');
 record('capture-worker',{file:selected});super(file,options);
}};
syncBuiltinESMExports();
process.on('exit',()=>{record('exit',{denied});if(denied)process.exitCode=1;});
