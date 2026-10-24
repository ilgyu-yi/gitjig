import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {openController} from '../../dist/controller/index.js';
import {capture} from '../../dist/controller/capture.js';
const execute=promisify(execFile),git=await fs.realpath((await execute('/usr/bin/which',['git'])).stdout.trim());

// Fault-injection ledger fixture, not evidence of command execution. The separate runtime consumer runs actual checks.
export async function fixture(t,prepare=async()=>{},format='sha1',unborn=false,managementOnly=true){
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/evidence-boundary-'))),source=path.join(root,'source'),home=path.join(root,'home');let accepted=false,controller;
 t.after(async()=>{await controller?.close();if(accepted)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained synthetic evidence boundary '+root);});await fs.mkdir(source);
 const native=async(...args)=>(await execute(git,args,{cwd:source,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout;
 await native('init','--object-format='+format,'-b','feat/evidence');await native('config','user.name','Fixture');await native('config','user.email','fixture@example.invalid');await fs.writeFile(path.join(source,'answer'),'base');await fs.writeFile(path.join(source,'deleted'),'delete');await native('add','.');if(!unborn)await native('commit','-m','base');await fs.writeFile(path.join(source,'answer'),'good');await native('add','answer');await native('rm','-f','deleted');
 await prepare({source,native});
 const initial=await openController({installationHome:home});try{await initial.registerProject({id:'p',sourceRoot:source});}finally{await initial.close();}
 const staging=path.join(home,'inputs/original-fixture');await fs.mkdir(staging,{mode:0o700});const manifest=await capture(source,staging,{}).result;
 const mutate=fn=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'));try{fn(db);}finally{db.close();}};
 const result={workId:'w',runId:'r',kind:'command-observation',status:'succeeded',exitCode:0,captureRef:manifest.digest,actualCwd:'/work',scratchInput:'mutable-or-unknown',cleanup:'removed',limitations:['Synthetic command fixture; no execution qualification'],stdout:'',stderr:''};
 mutate(db=>{
  db.prepare('INSERT INTO sources VALUES(?,?,?,?)').run('s',null,JSON.stringify({kind:'synthetic-owner-fixture'}),'fixture-command');
  db.prepare('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)').run('w','p','s',null,'w','DELIVERED',1,1,'result',JSON.stringify({kind:'command-observation',raw:'fixture-command',cwd:'work'}));
  db.prepare('INSERT INTO requirements VALUES(?,?,?,?)').run('w',1,'fixture-command',JSON.stringify({status:'not-applicable-local-command'}));
  db.prepare('INSERT INTO budgets VALUES(?,?,?,?,?)').run('w','execution',8,1,0);
  db.prepare('INSERT INTO budgets VALUES(?,?,?,?,?)').run('w','resolution',8,0,0);
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run('r','w',1,1,'SETTLED',staging,'consumed',JSON.stringify({kind:'command-observation',cwd:'work',raw:'fixture-command',manifest,resultId:'result',cleanup:'removed',capacityId:'capacity',profile:{dockerBinary:'/fixture/docker',dockerContext:'fixture',image:'sha256:'+'0'.repeat(64)}}));
  db.prepare('INSERT INTO results VALUES(?,?,?,?)').run('result','w','r',JSON.stringify(result));
  db.prepare('INSERT INTO observations VALUES(?,?,?)').run('observation','r',JSON.stringify({kind:'owner-command',command:'fixture-command',cwd:'/work',input:manifest.digest,exitCode:0}));
  db.prepare('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)').run('capacity','w','r',1,1,'RELEASED',JSON.stringify({kind:'local-check',admitted:true}));
 });
 controller=await openController({installationHome:home},{managementOnly});
 const inspect=(extra={})=>controller.inspectLocalCheckEvidence({projectId:'p',workId:'w',gitBinary:git,...extra});
 return {root,source,home,native,controller,mutate,inspect,accept:()=>{accepted=true;}};
}

export {git};
