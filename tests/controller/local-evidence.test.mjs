import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';

import {fixture} from './local-evidence-fixture.mjs';
test('native deletion/mode mapping and raw CRLF mismatch distinguish current source from staged correspondence',async t=>{
 const f=await fixture(t,async({source,native})=>{await fs.chmod(path.join(source,'answer'),0o755);await native('add','answer');});
 const current=await f.inspect();assert.equal(current.status,'CURRENT');assert.equal(current.scratchInput,'mutable-or-unknown');assert.equal(current.index.entries,1);assert.deepEqual(current.index.mismatchedPaths,[]);
 const g=await fixture(t,async({source,native})=>{await native('config','core.autocrlf','true');await fs.writeFile(path.join(source,'answer'),'good\r\n');await native('add','answer');});
 const eol=await g.inspect();assert.equal(eol.status,'STALE');assert.equal(eol.sourceMatches,true);assert.deepEqual(eol.index.mismatchedPaths,['answer']);f.accept();g.accept();
});
test('intent-to-add, gitlinks, symlinks and unmerged index stages never acquire source correspondence',async t=>{
 for(const kind of ['intent','gitlink','symlink','conflict']){
  const f=await fixture(t);
  if(kind==='intent'){await fs.writeFile(path.join(f.source,'empty'),'');await f.native('add','-N','empty');await f.native('update-index','--assume-unchanged','empty');}
  if(kind==='gitlink'){const oid=(await f.native('rev-parse','HEAD')).trim();await f.native('update-index','--add','--cacheinfo','160000,'+oid+',sub');}
  if(kind==='symlink'){await fs.symlink('answer',path.join(f.source,'alias'));await f.native('add','alias');}
  if(kind==='conflict'){await f.native('commit','-m','staged');await f.native('checkout','-b','other');await fs.writeFile(path.join(f.source,'answer'),'other');await f.native('commit','-am','other');await f.native('checkout','feat/evidence');await fs.writeFile(path.join(f.source,'answer'),'main');await f.native('commit','-am','main');await assert.rejects(f.native('merge','other'));}
  await assert.rejects(f.inspect(),error=>error.code==='LOCAL_EVIDENCE_UNAVAILABLE'&&/Index contains/.test(error.message),kind);f.accept();
 }
});
test('genuine reader refuses mixed run/result/observation/capacity provenance without executing another command',async t=>{
 const f=await fixture(t);const update=(table,id,change)=>f.mutate(db=>{const row=db.prepare('SELECT data FROM '+table+' WHERE id=?').get(id),data=JSON.parse(row.data);db.prepare('UPDATE '+table+' SET data=? WHERE id=?').run(JSON.stringify(change(data)),id);});
 const original=f.controller.inspectWork('w').currentResult.captureRef;
 update('observations','observation',d=>({...d,input:'0'.repeat(64)}));await assert.rejects(f.inspect(),/bindings disagree/);update('observations','observation',d=>({...d,input:original}));
 f.mutate(db=>db.prepare("UPDATE capacity_leases SET state='QUARANTINED' WHERE id='capacity'").run());await assert.rejects(f.inspect(),/fully settled/);f.mutate(db=>db.prepare("UPDATE capacity_leases SET state='RELEASED' WHERE id='capacity'").run());
 f.mutate(db=>db.prepare("UPDATE results SET run='wrong' WHERE id='result'").run());await assert.rejects(f.inspect(),/fully settled/);f.mutate(db=>db.prepare("UPDATE results SET run='r' WHERE id='result'").run());
 const recovered=await f.inspect();assert.equal(recovered.status,'CURRENT');f.accept();
});
test('controller close aborts a live original capture, joins the worker and removes owned temporary input before releasing home',async t=>{
 const f=await fixture(t,async({source})=>{await fs.mkdir(path.join(source,'bulky'));for(let i=0;i<300;i++)await fs.writeFile(path.join(source,'bulky',String(i)),Buffer.alloc(4096,42));});
 const inputs=path.join(f.home,'inputs');let nested,seen;
 const started=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Original capture file never appeared')),5000);seen=watch(inputs,(_event,name)=>{if(!nested&&name?.toString().startsWith('local-evidence-')){try{nested=watch(path.join(inputs,name.toString()),()=>{clearTimeout(timer);resolve();});}catch{}}});});
 const task=f.inspect();const outcome=task.then(value=>({value}),error=>({error}));
 try{await started;await f.controller.close();const result=await outcome;assert.ok(result.error);assert.equal(result.error.code,'LOCAL_EVIDENCE_UNAVAILABLE');assert.deepEqual((await fs.readdir(inputs)).filter(n=>n.startsWith('local-evidence-')),[]);const reopened=await openController({installationHome:f.home},{managementOnly:true});await reopened.close();}
 finally{seen?.close();nested?.close();await outcome;}
 f.accept();
});
test('same-lineage ACTIVE lease, unfinished run and unknown sibling hold settled selected work without reserved counters',async t=>{
 const f=await fixture(t);
 f.mutate(db=>{
  db.prepare('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)').run('sibling','p','s',null,'w','DELIVERED',1,1,null,JSON.stringify({kind:'command-observation'}));
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run('sibling-run','sibling',1,1,'SETTLED',path.join(f.home,'inputs/sibling'),'consumed',JSON.stringify({cleanup:'removed'}));
  db.prepare('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)').run('sibling-capacity','sibling','sibling-run',1,2,'ACTIVE',JSON.stringify({kind:'local-check',admitted:true}));
 });
 await assert.rejects(f.inspect(),/fully settled/);
 f.mutate(db=>{db.prepare("UPDATE capacity_leases SET state='RELEASED' WHERE id='sibling-capacity'").run();db.prepare("UPDATE runs SET phase='UNKNOWN' WHERE id='sibling-run'").run();});await assert.rejects(f.inspect(),/fully settled/);
 f.mutate(db=>{db.prepare("UPDATE runs SET phase='SETTLED' WHERE id='sibling-run'").run();db.prepare("UPDATE works SET state='UNKNOWN' WHERE id='sibling'").run();});await assert.rejects(f.inspect(),/fully settled/);
 f.mutate(db=>db.prepare("UPDATE works SET state='DELIVERED' WHERE id='sibling'").run());assert.equal((await f.inspect()).status,'CURRENT');f.accept();
});
