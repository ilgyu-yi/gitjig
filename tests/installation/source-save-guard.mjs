import {guardedProcessMethod} from './tests/cli/guarded-process-method.mjs';
// Attribution tripwire for this owned fixture, not a general sandbox.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import net from 'node:net';
import workers from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
const payload=fs.realpathSync(process.env.GITJIG_INSTALLED_SOURCE_PAYLOAD),manifest=JSON.parse(fs.readFileSync(process.env.GITJIG_INSTALLED_SOURCE_MANIFEST,'utf8')),mode=process.env.GITJIG_INSTALLED_SOURCE_MODE,trace=process.env.GITJIG_INSTALLED_SOURCE_TRACE;
if(!['seed','ui'].includes(mode))throw Error('Explicit installed source qualification mode required');
const files=new Map(manifest.files.map(row=>[row.path,row]));
const sha=data=>createHash('sha256').update(data).digest('hex');
for(const row of files.values())if(fs.realpathSync(row.path)!==row.path||sha(fs.readFileSync(row.path))!==row.sha256)throw Error('Frozen fixture control changed');
const record=(kind,value)=>fs.appendFileSync(trace,JSON.stringify({pid:process.pid,mode,kind,...value})+'\n',{mode:0o600});
let denied=0;
const deny=boundary=>{denied++;record('denied',{boundary});throw Error('Installed source qualification denied: '+boundary);};
const mapped=new Map(manifest.imports.map(row=>[pathToFileURL(row.parent).href+'\0'+row.specifier,row.target]));
const sdkParent=pathToFileURL(manifest.provider).href;
registerHooks({resolve(specifier,context,next){
 let target=specifier,scope=context;
 if(mode==='seed'&&context.parentURL===sdkParent&&specifier==='@earendil-works/pi-ai/compat')scope={...context,parentURL:pathToFileURL(path.join(payload,'package.json')).href};
 else if(mode==='seed'&&mapped.has(context.parentURL+'\0'+specifier))target=pathToFileURL(mapped.get(context.parentURL+'\0'+specifier)).href;
 const result=next(target,scope);
 if(result.url.startsWith('file:')){
  const file=fs.realpathSync(fileURLToPath(result.url));
  if(file.startsWith(payload+path.sep))record('module',{file});
  else if(files.has(file)&&(mode==='seed'||files.get(file).ui===true))record('fixture-module',{file});
  else return deny('module outside installed payload');
 }
 return result;
}});
globalThis.fetch=()=>deny('fetch');net.Socket.prototype.connect=()=>deny('socket');
const cfg=mode==='seed'?JSON.parse(fs.readFileSync(process.env.GITJIG_INSTALLED_SOURCE_CASE,'utf8')):null;
const readonlyGit=args=>Array.isArray(args)&&args.slice(0,4).join('\0')===['-c','gc.auto=0','-c','maintenance.auto=false'].join('\0')&&(
 args.length===6&&args[4]==='rev-parse'&&(args[5]==='HEAD'||args[5]==='refs/heads/terminal-'+cfg.locale)||args.length===7&&args.slice(4).join('\0')===['--no-optional-locks','status','--porcelain=v1'].join('\0'));
for(const method of ['spawn','execFile','execFileSync','spawnSync']){
 const actual=cp[method];
 cp[method]=guardedProcessMethod(actual,function(binary,args,...rest){
  let kind;
  if(binary==='/bin/ps')kind='process-observation';
  else if(binary===process.execPath&&args?.[0]===path.join(payload,'dist/effects/git-process-child.js'))kind='native';
  else if(mode==='seed'&&binary===cfg.runtime.dockerBinary&&Array.isArray(args)&&args.slice(0,4).join('\0')===['--config',cfg.runtime.dockerConfigDirectory,'--context',cfg.runtime.dockerContext].join('\0')&&(!args.includes('create')&&!args.includes('run')||args.includes(cfg.runtime.image)))kind='engine';
  else if(mode==='seed'&&method==='execFile'&&binary===cfg.git&&readonlyGit(args)&&rest[0]?.cwd===cfg.source)kind='fixture-oracle';
  else if(mode==='seed'&&method==='execFile'&&binary==='/usr/bin/python3'&&args?.[0]===manifest.python&&path.dirname(args[1])===cfg.root)kind='fixture-pty';
  else return deny(method);
  record(kind,{method,binary,args});return Reflect.apply(actual,this,[binary,args,...rest]);
 });
}
for(const method of ['exec','execSync','fork'])cp[method]=()=>deny(method);
const Worker=workers.Worker;
workers.Worker=class extends Worker{constructor(file,options){const name=fs.realpathSync(typeof file==='string'?file:fileURLToPath(file));if(mode!=='seed'||name!==path.join(payload,'dist/controller/capture-worker.js'))deny('worker');record('capture-worker',{file:name});super(file,options);}};
syncBuiltinESMExports();
process.on('exit',()=>{record('exit',{denied});if(denied)process.exitCode=1;});
