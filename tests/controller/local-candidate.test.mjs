import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture,git} from './local-evidence-fixture.mjs';
import {ApplicationLocalConventions,recommendedLocalConventions} from '../../dist/app/local-conventions.js';
import {listLocalCandidates} from '../../dist/controller/local-candidate.js';
import {localRoster} from '../../dist/controller/local-git.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function setup(t,format='sha1',unborn=false,prepare){
 const f=await fixture(t,prepare,format,unborn),messageFile=path.join(f.root,'message');await fs.writeFile(messageFile,'Implement local check\n\nLiteral # body\n',{mode:0o600});
 const conventions=new ApplicationLocalConventions(f.controller);conventions.set('p',0,recommendedLocalConventions());
 const candidate=()=>f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile});
 const audit=(candidateId,commitRef='HEAD')=>f.controller.auditLocalCommit({projectId:'p',candidateId,commitRef,gitBinary:git});
 return {...f,messageFile,conventions,candidate,audit};
}
test('healthy native Git commit matches complete index roster for both object formats and historical evidence survives later work/policy',async t=>{
 for(const format of ['sha1','sha256']){
  const f=await setup(t,format),recorded=await f.candidate(),id=recorded.candidate.id;assert.equal(recorded.status,'RECORDED');assert.equal(listLocalCandidates(f.controller,'p').candidates[0].candidateId,id);
  assert.equal(recorded.candidate.index.roster.entries,1);assert.equal(recorded.candidate.messageSha256,hash(await fs.readFile(f.messageFile)));
  await f.native('commit','--cleanup=verbatim','-F',f.messageFile);const commit=(await f.native('rev-parse','HEAD')).trim();
  const actual=await f.audit(id);assert.equal(actual.status,'MATCH',JSON.stringify(actual));assert.equal(actual.actual.oid,commit);assert.deepEqual(Object.values(actual.checks),[true,true,true,true]);assert.match(actual.scope,/unverified Git metadata/);
  f.mutate(db=>{db.prepare("UPDATE works SET state='FAILED',epoch=2,generation=2,current_result=NULL WHERE id='w'").run();});
  f.conventions.set('p',1,{...recommendedLocalConventions(),subjectMaxLength:90});await f.native('checkout','-b','another');
  const historical=await f.audit(id,commit);assert.equal(historical.status,'MATCH');assert.equal(historical.current.work.state,'FAILED');assert.equal(historical.current.policy.matchesOriginal,false);assert.equal(historical.current.branch,'another');assert.equal(historical.expected.index.intendedBranch,'feat/evidence');
  f.mutate(db=>{const data=JSON.parse(db.prepare("SELECT data FROM observations WHERE id='observation'").get().data);db.prepare("UPDATE observations SET data=? WHERE id='observation'").run(JSON.stringify({...data,command:'wrong'}));});
  await assert.rejects(f.audit(id,commit),/bindings disagree|no longer matches/);f.accept();
 }
});
test('whole roster detects native hook deleting a checked file, added files, mode changes and empty tree entries',async t=>{
 for(const kind of ['delete','add','mode','empty-tree']){
  const f=await setup(t),recorded=await f.candidate();
  if(kind==='delete')await fs.writeFile(path.join(f.source,'.git/hooks/pre-commit'),'#!/bin/sh\ngit rm -f -- answer\n',{mode:0o700});
  if(kind==='add'){await fs.writeFile(path.join(f.source,'unexpected'),'new');await f.native('add','unexpected');}
  if(kind==='mode')await f.native('update-index','--chmod=+x','answer');
  if(kind==='empty-tree'){
   const empty=(await f.native('hash-object','-w','-t','tree','/dev/null')).trim();
   const answer=(await f.native('rev-parse',':answer')).trim();
   // Native plumbing constructs an unusual but valid semantic tree with an empty directory.
   const {execFile}=await import('node:child_process');const tree=await new Promise((resolve,reject)=>{const child=execFile(git,['mktree'],{cwd:f.source},(e,out)=>e?reject(e):resolve(out.trim()));child.stdin.end(`100644 blob ${answer}\tanswer\n040000 tree ${empty}\tempty\n`);});
   const parent=(await f.native('rev-parse','HEAD')).trim();const oid=(await f.native('commit-tree',tree,'-p',parent,'-F',f.messageFile)).trim();const result=await f.audit(recorded.candidate.id,oid);assert.equal(result.status,'MISMATCH');assert.equal(result.checks.wholeTree,false);f.accept();continue;
  }
  await f.native('commit','--cleanup=verbatim','-F',f.messageFile);const oid=(await f.native('rev-parse','HEAD')).trim(),result=await f.audit(recorded.candidate.id);assert.equal(result.status,'MISMATCH',kind);assert.equal(result.checks.wholeTree,false);assert.equal(result.checks.message,true);assert.equal((await f.native('rev-parse','HEAD')).trim(),oid,'Audit retains the native commit');f.accept();
 }
});
test('native message hook and root/merge parent changes mismatch; original message file is not rewritten',async t=>{
 const f=await setup(t),recorded=await f.candidate(),bytes=await fs.readFile(f.messageFile);
 await fs.writeFile(path.join(f.source,'.git/hooks/commit-msg'),'#!/bin/sh\nprintf "Changed by hook\\n" > "$1"\n',{mode:0o700});await f.native('commit','--cleanup=verbatim','-F',f.messageFile);
 const changed=await f.audit(recorded.candidate.id);assert.equal(changed.status,'MISMATCH');assert.equal(changed.checks.message,false);assert.equal(changed.checks.wholeTree,true);assert.deepEqual(await fs.readFile(f.messageFile),bytes);
 const tree=(await f.native('rev-parse','HEAD^{tree}')).trim(),base=recorded.candidate.index.parent,current=(await f.native('rev-parse','HEAD')).trim();
 for(const parents of [[],['-p',base,'-p',current]]){const oid=(await f.native('commit-tree',tree,...parents,'-F',f.messageFile)).trim();const result=await f.audit(recorded.candidate.id,oid);assert.equal(result.status,'MISMATCH');assert.equal(result.checks.parents,false);assert.equal(result.checks.message,true);}
 f.accept();
});
test('message byte requirements, stale source, unsafe/mixed/changed receipt and source replacement refuse without another command',async t=>{
 const f=await setup(t);
 for(const text of ['No final LF','CRLF\r\n']){await fs.writeFile(f.messageFile,text);await assert.rejects(f.candidate(),/LF line endings and a final LF/);}
 await fs.writeFile(f.messageFile,'Healthy message\n');await fs.writeFile(path.join(f.source,'answer'),'stale');await assert.rejects(f.candidate(),/stale/);await fs.writeFile(path.join(f.source,'answer'),'good');
 const recorded=await f.candidate(),file=path.join(f.home,'local-candidates',recorded.candidate.id+'.json'),bytes=await fs.readFile(file);
 await f.native('commit','--cleanup=verbatim','-F',f.messageFile);
 await fs.writeFile(file,'{"version":1,"version":1}');assert.equal(listLocalCandidates(f.controller,'p').unavailableRecords[0].candidateId,recorded.candidate.id);await assert.rejects(f.audit(recorded.candidate.id),/malformed|Malformed/);await fs.writeFile(file,bytes);
 for(const malformed of [{},[],{...recorded.candidate,projectId:0}]){await fs.writeFile(file,JSON.stringify(malformed));assert.equal(listLocalCandidates(f.controller,'p').unavailableRecords[0].candidateId,recorded.candidate.id);}
 await fs.writeFile(file,bytes);
 await fs.chmod(file,0o644);await assert.rejects(f.audit(recorded.candidate.id),/unsafe/);await fs.chmod(file,0o600);
 await fs.writeFile(file,JSON.stringify({...recorded.candidate,home:{...recorded.candidate.home,identity:{device:'0',inode:'0'}}}));await assert.rejects(f.audit(recorded.candidate.id),/another home/);await fs.writeFile(file,bytes);
 await assert.rejects(f.audit('../anything'),/UUID/);await assert.rejects(f.audit(recorded.candidate.id,'missing-ref'),/Git inspection failed/);
 await fs.rename(f.source,f.source+'-old');await fs.mkdir(f.source);await assert.rejects(f.audit(recorded.candidate.id),/directory identity/);
 assert.equal(f.controller.inspectWork('w').allowance.consumed,1);assert.equal(f.controller.inspectWork('w').runs.length,1);f.accept();
});
test('roster normalization discards index-only fields and canonicalizes ordering including directory entries',()=>{
 const oid='0'.repeat(40),index=[{mode:'100644',oid,stage:0,path:'z/a'},{oid,path:'z.b',mode:'100755',stage:0}];
 const tree=[{path:'z.b',mode:'100755',oid},{oid,path:'z',mode:'040000'},{path:'z/a',oid,mode:'100644'}];
 assert.deepEqual(localRoster(index,true),localRoster(tree));assert.notDeepEqual(localRoster(index,true),localRoster([...tree,{path:'empty',mode:'040000',oid}]));
});

test('cancellation or new obligation during final native read refuses candidate allocation',async t=>{
 for(const kind of ['cancel','obligation']){
  const f=await setup(t),driver=path.join(f.root,'racing-git.cjs'),counter=path.join(f.root,'reads');
  const sql=kind==='cancel'?"UPDATE works SET state='CANCELLED' WHERE id='w'":"INSERT INTO obligations VALUES('pending','w','{}')";
  await fs.writeFile(driver,`#!${process.execPath}\nconst {spawnSync}=require('node:child_process'),fs=require('node:fs'),{DatabaseSync}=require('node:sqlite');const args=process.argv.slice(2),r=spawnSync(${JSON.stringify(git)},args,{env:process.env});if(args.includes('--show-toplevel')){const file=${JSON.stringify(counter)},n=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8'))+1:1;fs.writeFileSync(file,String(n));if(n===4){const db=new DatabaseSync(${JSON.stringify(path.join(f.home,'state/controller.sqlite'))});db.exec(${JSON.stringify(sql)});db.close();}}process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;\n`,{mode:0o700});
  await assert.rejects(f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:driver,messageFile:f.messageFile}),/fully settled/);
  assert.deepEqual(await fs.readdir(path.join(f.home,'local-candidates')),[]);assert.equal(await fs.readFile(counter,'utf8'),'4');f.accept();
 }
});
test('audit resolves a supplied reference once and ignores native replacement ancestry/message',async t=>{
 const f=await setup(t),recorded=await f.candidate();await f.native('commit','--cleanup=verbatim','-F',f.messageFile);
 const expected=(await f.native('rev-parse','HEAD')).trim(),tree=(await f.native('rev-parse','HEAD^{tree}')).trim(),replacement=(await f.native('commit-tree',tree,'-m','Different message')).trim();
 await f.native('replace',expected,replacement);assert.equal((await f.audit(recorded.candidate.id,expected)).status,'MATCH');await f.native('replace','-d',expected);
 await f.native('update-ref','refs/tags/audit-target',expected);
 const driver=path.join(f.root,'moving-ref.cjs');await fs.writeFile(driver,`#!${process.execPath}\nconst {spawnSync}=require('node:child_process'),args=process.argv.slice(2),r=spawnSync(${JSON.stringify(git)},args,{env:process.env});if(args.includes('--verify')){const write=spawnSync(${JSON.stringify(git)},['update-ref','refs/tags/audit-target',${JSON.stringify(replacement)}],{env:process.env});if(write.status!==0)process.exit(89);}process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;\n`,{mode:0o700});
 const result=await f.controller.auditLocalCommit({projectId:'p',candidateId:recorded.candidate.id,commitRef:'refs/tags/audit-target',gitBinary:driver});assert.equal(result.status,'MATCH');assert.equal(result.actual.oid,expected);assert.equal((await f.native('rev-parse','refs/tags/audit-target')).trim(),replacement);f.accept();
});

test('unborn named branch candidate matches an actual initial commit with complete nested directories',async t=>{
 const f=await setup(t,'sha1',true,async({source,native})=>{await fs.mkdir(path.join(source,'nested/deeper'),{recursive:true});await fs.writeFile(path.join(source,'nested/deeper/file'),'nested');await native('add','nested');});
 const recorded=await f.candidate();assert.equal(recorded.candidate.index.parent,null);assert.equal(recorded.candidate.index.roster.directories,2);await f.native('commit','--cleanup=verbatim','-F',f.messageFile);
 const actual=await f.audit(recorded.candidate.id);assert.equal(actual.status,'MATCH');assert.deepEqual(actual.actual.parents,[]);assert.equal(actual.actual.roster.directories,2);f.accept();
});

test('candidate discovery on an empty home does not create candidate storage or change ledger',async t=>{
 const f=await setup(t),before=f.controller.store.all('SELECT * FROM works'),folder=path.join(f.home,'local-candidates');await assert.rejects(fs.lstat(folder),{code:'ENOENT'});const view=listLocalCandidates(f.controller,'p');assert.deepEqual(view.candidates,[]);assert.deepEqual(view.unavailableRecords,[]);await assert.rejects(fs.lstat(folder),{code:'ENOENT'});assert.deepEqual(f.controller.store.all('SELECT * FROM works'),before);f.accept();
});
