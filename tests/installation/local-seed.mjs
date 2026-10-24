// Test-only synthetic prior-check injection. Run the copied probe outside checkout ancestry.
// The installed product performs capture and all later evidence/receipt/audit operations.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [payload,home,source]=process.argv.slice(2),base=pathToFileURL(payload+path.sep);
const {openController}=await import(new URL('dist/controller/index.js',base)),{capture}=await import(new URL('dist/controller/capture.js',base));
const controller=await openController({installationHome:home},{managementOnly:true});
try{
 const staging=path.join(home,'inputs/synthetic-installed-prior');await fs.mkdir(staging,{mode:0o700});const manifest=await capture(source,staging,{}).result;
 const ids={workId:'installed-prior-check',runId:'installed-prior-run',resultId:'installed-prior-result',observationId:'installed-prior-observation',capacityId:'installed-prior-capacity'},command='synthetic prior command; no producer executed';
 const result={workId:ids.workId,runId:ids.runId,kind:'command-observation',status:'succeeded',exitCode:0,captureRef:manifest.digest,actualCwd:'/work',scratchInput:'mutable-or-unknown',cleanup:'removed',limitations:['Fixture-authored successful prior-check status; no engine or command execution qualification'],stdout:'',stderr:''},store=controller.store;
 store.tx(()=>{
  store.run('INSERT INTO sources VALUES(?,?,?,?)','installed-prior-source',null,JSON.stringify({kind:'synthetic-installed-prior'}),command);
  store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',ids.workId,'p','installed-prior-source',null,ids.workId,'DELIVERED',1,1,ids.resultId,JSON.stringify({kind:'command-observation',raw:command,cwd:'work'}));
  store.run('INSERT INTO requirements VALUES(?,?,?,?)',ids.workId,1,command,JSON.stringify({status:'not-applicable-local-command'}));
  for(const kind of ['execution','resolution'])store.run('INSERT INTO budgets VALUES(?,?,?,?,?)',ids.workId,kind,8,kind==='execution'?1:0,0);
  store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',ids.runId,ids.workId,1,1,'SETTLED',staging,'consumed',JSON.stringify({kind:'command-observation',cwd:'work',raw:command,manifest,resultId:ids.resultId,cleanup:'removed',capacityId:ids.capacityId,profile:{dockerBinary:'/fixture/not-an-engine',dockerContext:'SYNTHETIC_NOT_EXECUTED',image:'sha256:'+'0'.repeat(64)}}));
  store.run('INSERT INTO results VALUES(?,?,?,?)',ids.resultId,ids.workId,ids.runId,JSON.stringify(result));
  store.run('INSERT INTO observations VALUES(?,?,?)',ids.observationId,ids.runId,JSON.stringify({kind:'owner-command',command,cwd:'/work',input:manifest.digest,exitCode:0}));
  store.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',ids.capacityId,ids.workId,ids.runId,1,1,'RELEASED',JSON.stringify({kind:'local-check',admitted:true,synthetic:true}));
 });
 console.log(JSON.stringify({ids,capture:manifest.digest,installedCapture:fileURLToPath(new URL('dist/controller/capture.js',base)),installedWorker:fileURLToPath(new URL('dist/controller/capture-worker.js',base)),fixtureAuthored:['source','work','requirement','budgets','settled run status/runtime','result status','owner-command observation','released capacity'],scope:'Synthetic prior-check ledger; capture is real installed code, command/engine execution did not occur. No candidate receipt or audit outcome injected.'}));
}finally{await controller.close();}
