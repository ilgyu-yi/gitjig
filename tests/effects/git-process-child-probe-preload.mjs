import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
const mode=process.env.GITJIG_OWNED_PROBE_MODE,log=process.env.GITJIG_OWNED_PROBE_LOG;
if(process.argv[1]===path.resolve('dist/effects/git-process-child.js')&&['transient','clock','persistent'].includes(mode)&&log){
 const descriptor=process.argv[2],bytes=fs.readFileSync(descriptor),d=JSON.parse(bytes),directory=path.dirname(descriptor),stat=fs.lstatSync(directory);
 if(d.commandId!=='group-cleanup'||d.directory!==directory||!path.basename(directory).startsWith('gitjig-supervisor-group-')||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)||fs.realpathSync(directory)!==directory||Object.keys(d.env).join(',')!=='PATH')throw Error('Owned original group fixture required');
 const wall=Date.now.bind(Date),emit=(stage,data={})=>fs.appendFileSync(log,JSON.stringify({stage,mode,pid:process.pid,directory,descriptorSha256:createHash('sha256').update(bytes).digest('hex'),wall:wall(),monotonic:performance.now(),...data})+'\n',{mode:0o600});
 const kill=process.kill;let injected=false;emit('admitted',{nativeEnvKeys:Object.keys(d.env)});
 process.kill=function(pid,signal){
  if(typeof pid!=='number'||pid>=0)return Reflect.apply(kill,this,arguments);
  if(signal===0&&(mode==='transient'&&!injected||mode==='persistent')){
   if(!injected){try{const alive=Reflect.apply(kill,this,arguments);emit('original-live-group',{group:-pid,alive});}catch(error){emit('original-first-probe-error',{group:-pid,code:error.code,errno:error.errno});if(mode!=='persistent')throw error;}}
   injected=true;const error=Object.assign(Error('Controlled owned read-only probe EPERM'),{code:'EPERM',errno:-1,syscall:'kill'});emit('injected-error',{group:-pid,code:error.code,errno:error.errno});throw error;
  }
  try{const result=Reflect.apply(kill,this,arguments);emit('returned',{group:-pid,signal,result});if(mode==='clock'&&signal===0&&!injected){injected=true;Date.now=()=>wall()+10000;emit('injected-forward-wall-jump',{group:-pid,offsetMs:10000});}return result;}catch(error){emit('original-error',{group:-pid,signal,code:error.code,errno:error.errno});throw error;}
 };
 const rename=fs.renameSync;fs.renameSync=function(from,to){const result=Reflect.apply(rename,this,arguments);if(to===path.join(directory,'result.json'))emit('result',{outcome:JSON.parse(fs.readFileSync(to,'utf8'))});return result;};
}
