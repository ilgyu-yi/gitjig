import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createScope} from '../../dist/execution/container-scope.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const gone=pid=>{try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}};
async function until(predicate,ms=5000){const end=performance.now()+ms;while(!await predicate()){if(performance.now()>=end)throw Error('Original observation deadline');await wait(10);}}
async function fixture(t,mode){
 const root=await temporaryDirectory('start-cancellation'),workRoot=path.join(root,'work'),stateRoot=path.join(root,'runtime'),state=path.join(root,'engine.json'),calls=path.join(root,'calls.jsonl'),binary=path.join(root,'docker');
 await fs.mkdir(workRoot);await fs.mkdir(stateRoot);await fs.writeFile(state,'{}');await fs.writeFile(calls,'');
 await fs.writeFile(binary,`#!${process.execPath}
import fs from 'node:fs';import {spawn} from 'node:child_process';
const root=${JSON.stringify(root)},mode=${JSON.stringify(mode)},state=${JSON.stringify(state)},calls=${JSON.stringify(calls)},a=process.argv.slice(2).slice(2),s=JSON.parse(fs.readFileSync(state));
fs.appendFileSync(calls,JSON.stringify({command:a[0],pid:process.pid,args:a})+'\\n');
const save=()=>fs.writeFileSync(state,JSON.stringify(s)),out=()=>{console.log(s.id);};
if(a[0]==='create'){
 s.id='a'.repeat(64);s.labels=Object.fromEntries(a.flatMap((v,i)=>v==='--label'?[a[i+1].split('=')]:[]));save();
 if(mode==='create')setInterval(()=>{if(fs.existsSync(root+'/release-create')){out();process.exit(0);}},10);else out();
}else if(a[0]==='start'){
 if(mode==='escaped'){
  const helper=spawn(process.execPath,['-e',"const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},10)",root+'/release-helper'],{detached:true,stdio:['ignore',1,2]});
  fs.writeFileSync(root+'/helper.json',JSON.stringify({pid:helper.pid}));
 }
 fs.writeFileSync(root+'/start-ready',String(process.pid));
 setInterval(()=>{if(fs.existsSync(root+'/release-start')){out();process.exit(0);}},10);
}else if(a[0]==='inspect')console.log(JSON.stringify([{Id:s.id,Config:{Labels:s.labels},State:{Running:false}}]));
else if(a[0]==='rm'){if(mode==='cleanup-failure'){console.error('OWNED_REMOVE_REFUSED');process.exitCode=1;}else out();}
else process.exitCode=2;
`,{mode:0o700});
 const log=async()=> (await fs.readFile(calls,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 let passed=false;
 t.after(async()=>{
  for(const name of ['release-create','release-start','release-helper'])await fs.writeFile(path.join(root,name),'release');
  let helper;try{helper=JSON.parse(await fs.readFile(path.join(root,'helper.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
  const pids=[...(await log()).map(row=>row.pid),...(helper?[helper.pid]:[])];
  await until(()=>pids.every(pid=>gone(pid)&&gone(-pid)));
  if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original cancellation fixture: '+root);
 });
 return {root,log,pass:()=>{passed=true;},options:{dockerBinary:binary,dockerContext:'owned',image:'sha256:'+'0'.repeat(64),workRoot,stateRoot,workId:'original-work',runId:'original-run'},journal:async()=>JSON.parse(await fs.readFile(path.join(stateRoot,(await fs.readdir(stateRoot)).find(n=>n.endsWith('.json')))))};
}

test('canceled held create keeps its original full-ID outcome then cleans without starting',async t=>{
 const f=await fixture(t,'create'),abort=new AbortController();let settled=false;
 const pending=createScope({...f.options,signal:abort.signal}).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
 await until(async()=> (await f.log()).some(row=>row.command==='create'));
 abort.abort();await wait(100);assert.equal(settled,false,'Do not discard an in-flight create identity');
 await fs.writeFile(path.join(f.root,'release-create'),'release');const result=await pending;
 assert.match(result.error?.message??'',/aborted before start/);assert.equal(result.value,undefined);
 const log=await f.log(),journal=await f.journal();assert.ok(!log.some(row=>row.command==='start'));assert.equal(journal.id,'a'.repeat(64));assert.equal(journal.state,'removed');f.pass();
});

for(const mode of ['start','cleanup-failure','escaped'])test('cancel original held start: '+mode,async t=>{
 const f=await fixture(t,mode),abort=new AbortController();let settled=false;
 const pending=createScope({...f.options,signal:abort.signal}).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
 await until(async()=>{try{await fs.access(path.join(f.root,'start-ready'));return true;}catch{return false;}});
 abort.abort();
 // The owner intentionally withholds the original start reply. If observation
 // expires, release and join THIS original, then retain the failed observation.
 const budget=mode==='escaped'?4000:1500,end=performance.now()+budget;
 while(!settled&&performance.now()<end)await wait(10);
 const neededRelease=!settled;
 if(neededRelease)await fs.writeFile(path.join(f.root,'release-start'),'release');
 if(mode==='escaped')await fs.writeFile(path.join(f.root,'release-helper'),'release');
 const result=await pending;assert.equal(neededRelease,false,'Cancellation must not await the withheld start reply');assert.equal(result.value,undefined);
 const journal=await f.journal();assert.equal(journal.id,'a'.repeat(64));
 if(mode==='escaped') {assert.match(result.error?.message??'',/Native process cleanup unconfirmed/);assert.equal(journal.state,'quarantined');assert.ok(journal.nativeCleanupUnknown);}
 else {assert.match(result.error?.message??'',/aborted after start/);assert.equal(journal.state,mode==='cleanup-failure'?'quarantined':'removed');}
 assert.ok((await f.log()).some(row=>row.command==='rm'),'Known owned cleanup is not canceled by user signal');f.pass();
});
