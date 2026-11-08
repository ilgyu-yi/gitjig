import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspectSourceSnapshotRecord} from '../../dist/controller/source-snapshot-records.js';
const execute=promisify(execFile);

/** Read-only actual-world observer; ready permits an Esc, never receiver release. */
export async function observeOriginalSender({home,root,workId,branch,git,proxy,ready}) {
 const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true}),store={one:(sql,...params)=>db.prepare(sql).get(...params),all:(sql,...params)=>db.prepare(sql).all(...params)};
 let last='Receiver gate not reached';
 try {
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
   let marker;
   try{marker=JSON.parse(await fs.readFile(proxy.receiverMarker,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
   if(marker){
    assert.equal(marker.nonce,proxy.nonce);assert.ok(Number.isSafeInteger(marker.pid)&&marker.pid>0);
    const rows=store.all('SELECT id FROM effect_operations WHERE work=?',workId);
    if(rows.length===1){
     const original=inspectSourceSnapshotRecord(store,home,rows[0].id);
     if(original.state==='RETAINED'&&original.recordedPhase==='INVOKING'&&original.nativeAttempt?.intent){
      const attempt=original.nativeAttempt,prepared=attempt.intent.prepared,directory=path.join(prepared.clientRoot,'runs',prepared.commandId);
      let start;
      try{start=JSON.parse(await fs.readFile(path.join(directory,'git-start.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(start?.gitStarted){
       const run=store.one('SELECT * FROM runs WHERE id=?',attempt.attempt.runId),lease=store.one('SELECT * FROM capacity_leases WHERE run=?',run.id),budget=store.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",workId);
       assert.equal(run.phase,'RUNNING');assert.equal(run.reservation,'reserved');assert.equal(lease.state,'ADMITTED');assert.deepEqual({...budget},{lim:9,consumed:8,reserved:1});
       assert.equal(original.binding.destinationRef,'refs/heads/'+branch);assert.equal(original.workId,workId);
       const descriptor=await fs.readFile(path.join(directory,'descriptor.json')),parsed=JSON.parse(descriptor);
       assert.equal(createHash('sha256').update(descriptor).digest('hex'),prepared.descriptorSha256);assert.equal(parsed.commandId,prepared.commandId);assert.ok(parsed.argv.includes('push'));assert.ok(parsed.argv.some(a=>a.includes(original.binding.projectedCommit)&&a.includes(original.binding.destinationRef)));
       const trace=(await fs.readFile(proxy.nativeTrace,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),senders=trace.filter(r=>r.kind==='sender');assert.equal(senders.length,1);assert.equal(start.gitPid,senders[0].pid);
       for(const pid of [start.pid,start.gitPid,marker.pid])process.kill(pid,0);
       const ps=await execute('/bin/ps',['-p',String(start.gitPid),'-o','command='],{env:{PATH:'/usr/bin:/bin',LANG:'C'},timeout:2000});assert.ok(ps.stdout.includes(await fs.realpath(git)));assert.match(ps.stdout,/ push /);
       const observed={original,run,lease,budget,start,marker,descriptor:parsed,descriptorSha256:prepared.descriptorSha256,senderCommand:ps.stdout.trim(),trace};
       await fs.writeFile(path.join(root,'original-sender-held.json'),JSON.stringify(observed,null,2),{flag:'wx',mode:0o600});
       await fs.writeFile(ready,proxy.nonce,{flag:'wx',mode:0o600});return observed;
      }
      last='Original INVOKING but durable Git start not yet visible';
     }else last='Original phase '+original.state+'/'+original.recordedPhase;
    }
   }
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error('Original sender observation deadline: '+last);
 } finally{db.close();}
}
