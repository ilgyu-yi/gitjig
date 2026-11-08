import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readLocalGitProcess} from '../../dist/controller/local-git-process.js';
const literal=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function held(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-git-group-'))),file=path.join(root,'trusted-read'),parent=path.join(root,'parent'),descendant=path.join(root,'descendant');await fs.writeFile(file,'#!/bin/sh\ntrap "" TERM\necho $$ > '+literal(parent)+'\n/bin/sleep 30 &\necho $! > '+literal(descendant)+'\nwait\n',{mode:0o700});
 let group;const realKill=process.kill.bind(process),cleanup=async()=>{if(!group)return;try{realKill(-group,0);}catch(e){if(e.code==='ESRCH'){group=undefined;return;}throw e;}realKill(-group,'SIGKILL');const until=Date.now()+2000;while(Date.now()<until){try{realKill(-group,0);}catch(e){if(e.code==='ESRCH'){group=undefined;return;}throw e;}await new Promise(r=>setTimeout(r,10));}throw Error('Owned fixture group remains after cleanup: '+group);};
 t.after(async()=>{await cleanup();await fs.rm(root,{recursive:true,force:true});});
 return {file,root,cleanup,async ready(){const until=Date.now()+2000;while(Date.now()<until){const values=await Promise.all([parent,descendant].map(file=>fs.readFile(file,'utf8').catch(()=>'')));if(values.every(value=>/^[1-9][0-9]*\n$/u.test(value))){group=Number(values[0]);const child=Number(values[1]);assert.ok(Number.isSafeInteger(group)&&group>1&&Number.isSafeInteger(child)&&child>1);return {group,descendant:child};}await new Promise(r=>setTimeout(r,10));}throw Error('Owned process IDs not ready');}};
}
for(const mode of ['abort','timeout'])test('native read '+mode+' joins the whole process group including inherited-pipe descendants',{timeout:10000},async t=>{
 const f=await held(t),abort=new AbortController(),started=performance.now(),task=readLocalGitProcess(f.file,[],{cwd:f.root,env:{PATH:'/usr/bin:/bin'},signal:abort.signal});void task.catch(()=>{});const ids=await f.ready();if(mode==='abort')abort.abort();await assert.rejects(task,mode==='abort'?/cancelled/:/deadline/);assert.ok(performance.now()-started<(mode==='abort'?3000:7500));for(const pid of [ids.group,ids.descendant])assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');
});
test('unconfirmable group cleanup has an explicit error and recorded group instead of successful cancellation',{timeout:7000},async t=>{
 const f=await held(t),abort=new AbortController(),task=readLocalGitProcess(f.file,[],{cwd:f.root,env:{PATH:'/usr/bin:/bin'},signal:abort.signal});void task.catch(()=>{});const {group}=await f.ready(),original=process.kill;
 process.kill=(pid,signal)=>{if(pid===-group){const e=Error('Owned fixture denies group observation/termination');e.code='EPERM';throw e;}return original(pid,signal);};
 try{abort.abort();await assert.rejects(task,error=>error.code==='LOCAL_GIT_CLEANUP_UNKNOWN'&&error.recovery.includes(String(group)));}finally{process.kill=original;await f.cleanup();}
});
