import {guardedProcessMethod} from '../cli/guarded-process-method.mjs';
// Owned terminal qualification tripwire: actual local Native Git, no provider.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
const root=fs.realpathSync(process.env.GITJIG_SAVE_FIXTURE_PACKAGE_ROOT),trace=process.env.GITJIG_SAVE_FIXTURE_TRACE;
let denied=0;
const record=(kind,value)=>fs.appendFileSync(trace,JSON.stringify({pid:process.pid,kind,...value})+'\n',{mode:0o600});
const deny=kind=>{denied++;record('denied',{boundary:kind});throw Error('Source save qualification refused '+kind);};
globalThis.fetch=()=>deny('fetch');net.Socket.prototype.connect=()=>deny('socket');
const spawn=cp.spawn;
cp.spawn=(binary,args,options)=>{if(binary!==process.execPath||args?.[0]!==path.join(root,'dist/effects/git-process-child.js'))return deny('spawn');record('native',{binary,args});return spawn(binary,args,options);};
for(const method of ['execFile','execFileSync','spawnSync']){const original=cp[method];cp[method]=guardedProcessMethod(original,function(binary,...args){if(binary!=='/bin/ps')return deny(method);return Reflect.apply(original,this,[binary,...args]);});}
for(const method of ['exec','execSync','fork'])cp[method]=()=>deny(method);
syncBuiltinESMExports();
process.on('exit',()=>{record('exit',{denied,resourceUsage:process.resourceUsage(),resourceScope:'This UI PID only; not a process-tree peak'});if(denied)process.exitCode=1;});
