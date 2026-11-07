import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,git} from '../controller/local-evidence-fixture.mjs';
import {ApplicationLocalConventions,recommendedLocalConventions} from '../../dist/app/local-conventions.js';
import {listLocalCandidates} from '../../dist/controller/local-candidate.js';
import {localCommands} from '../../dist/ui/local-commands.js';
const first=(_title,rows)=>rows[0];
const originalDetails=text=>JSON.parse(text.split('\n\nOriginal observation · details\n\n')[1]);
async function setup(t){const f=await fixture(t,async()=>{},'sha1',false,false),messageFile=path.join(f.root,'message');await fs.writeFile(messageFile,'Implement correspondence\n',{mode:0o600});new ApplicationLocalConventions(f.controller).set('p',0,recommendedLocalConventions());return {...f,messageFile,sourceId:f.controller.createConversation({projectId:'p'}).conversationId};}
function host(f,choices,inputs=[],extra={}){const shown=[],notices=[],ui=localCommands({controller:f.controller,isCurrent:()=>true,choose:async(title,rows)=>{const choice=choices.shift();if(typeof choice==='function')return choice(title,rows);if(choice===undefined)return;const value=rows.find(row=>row.startsWith(choice));assert.ok(value,'Missing '+choice+' in '+JSON.stringify(rows));return value;},input:async()=>inputs.shift(),show:async(title,text)=>shown.push({title,text}),notice:text=>notices.push(text),...extra});return {shown,notices,ui,run:()=>ui.commands[0].run('',f.sourceId)};}
const original=()=>['Retained local checks',first];
const back=()=>['Back','Back','Close'];
test('original local terminal commands inspect actual correspondence, record exact candidate and audit native commit without another check',async t=>{
 const f=await setup(t),inspect=host(f,[...original(),'Inspect current check correspondence',...back()],[git]);await inspect.run();assert.match(inspect.shown[0].text,/^CURRENT · Current full source and index files match/);assert.equal(originalDetails(inspect.shown[0].text).status,'CURRENT');await inspect.ui.close();
 const record=host(f,[...original(),'Record exact commit candidate','Record exact candidate',...back()],[git,f.messageFile]);await record.run();const receipt=originalDetails(record.shown.find(s=>s.title.startsWith('Exact candidate retained')).text),id=receipt.candidate.id;assert.match(record.shown.find(s=>s.title.startsWith('Exact candidate retained')).text,/^RECORDED · Historical candidate receipt/);assert.ok(record.shown.find(s=>s.title.startsWith('Exact candidate retained')).text.includes(f.messageFile));assert.equal(receipt.status,'RECORDED');assert.equal(receipt.candidate.check.workId,'w');assert.ok(record.notices.some(n=>n.includes(id)));await record.ui.close();
 await f.native('commit','--cleanup=verbatim','-F',f.messageFile);
 const audit=host(f,['Retained candidates',first,'Inspect original candidate',first,'Audit native commit','Audit selected commit','Back','Close'],[git,'HEAD']);await audit.run();const result=originalDetails(audit.shown.find(s=>s.title.startsWith('Historical native')).text);assert.match(audit.shown.find(s=>s.title.startsWith('Historical native')).text,/^MATCH · Native commit matches this historical/);assert.equal(result.status,'MATCH');assert.equal(result.candidateId,id);assert.match(result.scope,/No current eligibility/);assert.equal(f.controller.inspectWork('w').allowance.consumed,1);assert.equal(f.controller.inspectWork('w').runs.length,1);await audit.ui.close();f.accept();
});
test('cancelled fields and recording review keep native Git and receipt storage unchanged',async t=>{
 const f=await setup(t),before=await f.native('status','--porcelain=v1');for(const inputs of [[undefined],[git,undefined],[git,f.messageFile]]){const h=host(f,[...original(),'Record exact commit candidate',...inputs.length===2&&inputs[1]!==undefined?['Back without recording']:[],...back()],inputs);await h.run();await h.ui.close();assert.deepEqual(listLocalCandidates(f.controller,'p').candidates,[]);assert.equal(await f.native('status','--porcelain=v1'),before);}await assert.rejects(fs.lstat(path.join(f.home,'local-candidates')),{code:'ENOENT'});f.accept();
});
test('reviewed original cannot be replaced during asynchronous native preparation and no receipt is written',async t=>{
 const f=await setup(t),h=host(f,['Retained local checks',first,'Record exact commit candidate','Record exact candidate'],[git,f.messageFile]);
 // Deliberately change the original after public controller dispatch begins, before its async import resumes.
 const dispatch=f.controller.localCommitCandidate.bind(f.controller);f.controller.localCommitCandidate=(options,guard)=>{const task=dispatch(options,guard);f.controller.store.run("UPDATE works SET generation=2 WHERE id='w'");return task;};await assert.rejects(h.run(),/changed|unavailable|failed/i);assert.deepEqual(listLocalCandidates(f.controller,'p').candidates,[]);await h.ui.close();f.accept();
});
test('receipt replacement during audit forms refuses without retargeting or altering native commit',async t=>{
 const f=await setup(t),receipt=await f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile:f.messageFile}),file=path.join(f.home,'local-candidates',receipt.candidate.id+'.json');await f.native('commit','--cleanup=verbatim','-F',f.messageFile);const commit=await f.native('rev-parse','HEAD');
 const h=host(f,['Retained candidates',first,'Audit native commit','Audit selected commit'],[git,'HEAD'],{input:async()=>{await fs.writeFile(file,JSON.stringify({...receipt.candidate,createdAt:'2000-01-01T00:00:00.000Z'}));return git;}});await assert.rejects(h.run(),/changed/);assert.equal(await f.native('rev-parse','HEAD'),commit);await h.ui.close();f.accept();
});
test('late navigation after receipt write retains its original candidate ID without new-view output',async t=>{
 const f=await setup(t);let current=true;const original=f.controller.localCommitCandidate.bind(f.controller);f.controller.localCommitCandidate=async(...args)=>{const result=await original(...args);current=false;return result;};const h=host(f,[...originalChoices(),'Record exact commit candidate','Record exact candidate'],[git,f.messageFile],{isCurrent:()=>current});await assert.rejects(h.run(),error=>{const id=listLocalCandidates(f.controller,'p').candidates[0].candidateId;return error.candidateId===id&&error.workId==='w'&&error.message.includes(id);});assert.equal(h.shown.some(s=>s.title.startsWith('Exact candidate retained')),false);await h.ui.close();f.accept();function originalChoices(){return ['Retained local checks',first];}
});

test('native hook changes are reported as historical MISMATCH and preserve the actual commit',async t=>{
 const f=await setup(t),receipt=await f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile:f.messageFile});await fs.writeFile(path.join(f.source,'.git/hooks/pre-commit'),'#!/bin/sh\ngit rm -f -- answer\n',{mode:0o700});await f.native('commit','--cleanup=verbatim','-F',f.messageFile);const oid=await f.native('rev-parse','HEAD'),h=host(f,['Retained candidates',first,'Audit native commit','Audit selected commit','Back','Close'],[git,'HEAD']);await h.run();const audit=originalDetails(h.shown.find(s=>s.title.startsWith('Historical native')).text);assert.match(h.shown.find(s=>s.title.startsWith('Historical native')).text,/^MISMATCH · Native commit differs/);assert.equal(audit.status,'MISMATCH');assert.equal(audit.candidateId,receipt.candidate.id);assert.equal(audit.checks.wholeTree,false);assert.equal(await f.native('rev-parse','HEAD'),oid);await h.ui.close();f.accept();
});
test('shutdown aborts and joins candidate preparation without creating a receipt',async t=>{
 const f=await setup(t);let entered,settled=false;const began=new Promise(r=>entered=r);f.controller.localCommitCandidate=async({signal})=>{entered();await new Promise((_r,reject)=>signal.addEventListener('abort',()=>{settled=true;reject(Error('CONTROLLED_CANCELLED_PREPARATION'));},{once:true}));};const h=host(f,['Retained local checks',first,'Record exact commit candidate','Record exact candidate'],[git,f.messageFile]),pending=h.run();void pending.catch(()=>{});await began;await h.ui.close();await assert.rejects(pending,/CONTROLLED_CANCELLED/);assert.equal(settled,true);assert.deepEqual(listLocalCandidates(f.controller,'p').candidates,[]);f.accept();
});

test('candidate replacement while selecting the retained list cannot replace its reviewed byte identity',async t=>{
 const f=await setup(t),receipt=await f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile:f.messageFile}),file=path.join(f.home,'local-candidates',receipt.candidate.id+'.json');const h=host(f,['Retained candidates',async(_title,rows)=>{await fs.writeFile(file,JSON.stringify({...receipt.candidate,createdAt:'2000-01-01T00:00:00.000Z'}));return rows[0];}]);await assert.rejects(h.run(),/Selected candidate changed/);await h.ui.close();f.accept();
});
test('receipt replacement after original audit dispatch is refused across the backend import gap',async t=>{
 const f=await setup(t),receipt=await f.controller.localCommitCandidate({projectId:'p',workId:'w',gitBinary:git,messageFile:f.messageFile}),file=path.join(f.home,'local-candidates',receipt.candidate.id+'.json');await f.native('commit','--cleanup=verbatim','-F',f.messageFile);const dispatch=f.controller.auditLocalCommit.bind(f.controller);
 const h=host(f,['Retained candidates',first,'Audit native commit','Audit selected commit'],[git,'HEAD']);
 // Replace immediately after dispatch, before its dynamic import resumes.
 const {writeFileSync}=await import('node:fs');f.controller.auditLocalCommit=(options,guard)=>{const task=dispatch(options,guard);writeFileSync(file,JSON.stringify({...receipt.candidate,createdAt:'2000-01-01T00:00:00.000Z'}));return task;};await assert.rejects(h.run(),/changed/);await h.ui.close();f.accept();
});

test('shutdown propagates uncertain evidence cleanup after joining its original inspection',async t=>{
 const f=await setup(t);let entered;const began=new Promise(r=>entered=r),failure=Object.assign(Error('CONTROLLED_UNKNOWN_EVIDENCE_CLEANUP'),{code:'LOCAL_EVIDENCE_CLEANUP_UNKNOWN',recovery:'Retain exact private capture'});f.controller.inspectLocalCheckEvidence=async({signal})=>{entered();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(failure),{once:true}));};const h=host(f,['Retained local checks',first,'Inspect current check correspondence'],[git]),pending=h.run();void pending.catch(()=>{});await began;await assert.rejects(h.ui.close(),error=>error===failure);await assert.rejects(pending,error=>error===failure);f.accept();
});

test('overlapping local inspections retain every original uncertain-cleanup recovery without duplicate errors',async t=>{
 const f=await setup(t),failures=[0,1].map(n=>Object.assign(Error('UNKNOWN_CAPTURE_'+n),{code:'LOCAL_EVIDENCE_CLEANUP_UNKNOWN',recovery:'Retain exact private capture '+n}));let count=0,entered,firstEntered;const began=new Promise(r=>entered=r),firstBegan=new Promise(r=>firstEntered=r);f.controller.inspectLocalCheckEvidence=async({signal})=>{const index=count++;if(count===1)firstEntered();if(count===2)entered();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(failures[index]),{once:true}));};const h=host(f,['Retained local checks',first,'Inspect current check correspondence','Retained local checks',first,'Inspect current check correspondence'],[git,git]),a=h.run();void a.catch(()=>{});await firstBegan;const b=h.run();void b.catch(()=>{});await began;await assert.rejects(h.ui.close(),error=>{assert.ok(error instanceof AggregateError);assert.deepEqual(new Set(error.errors),new Set(failures));for(const failure of failures)assert.ok(error.message.includes(failure.recovery));return true;});await Promise.allSettled([a,b]);f.accept();
});
