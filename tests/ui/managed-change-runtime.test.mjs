// Explicit owned local engine, synthetic provider response through original Pi codec.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {managedWorld} from './managed-change-fixture.mjs';import {runtimeFixtureProfile,runtimeFixtureConfig} from '../runtime/profile.mjs';import {withValueCases} from '../controller/effect-fixture.mjs';import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
const state=(editorFocused,draft,contains,send,extra={})=>({editorFocused,draft,contains,send,...extra});
const paste=value=>'\x1b[200~'+value+'\x1b[201~';
async function terminal(f,config){
 const file=path.join(f.root,config.inspectOnly?'result-reopen.json':'runtime.json'),output=file+'.terminal',observation=file+'.current';
 await fs.writeFile(file,JSON.stringify({...config,cid:f.cid,home:f.home,observation,output,
  command:[process.execPath,'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),'tests/ui/managed-change-runtime-entry.mjs',file],
  env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:path.join(f.home,'artifacts'),GITJIG_RESULT_OBSERVATION:observation,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''}}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:80000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,config.steps.length);assert.equal(result.terminalRestored,true);
 return {...result,frames:JSON.parse(await fs.readFile(output+'.frames.json','utf8')).snapshots};
}
function resultSteps(draft,badCandidate){
 return [
  state(false,draft,['Task result','Saved output','Registered project folder','Opening this result applies no files.',
   badCandidate?'No review-ready result is currently confirmed':'Checks and required review passed'], '',{unchanged:true}),
  state(false,draft,['Task result','Checks for this candidate and verification plan','Selected review evidence',
   badCandidate?'Not recorded · "value"':'Passed · "value"',...(badCandidate?[]:['Review clear'])], '\x1b',
   {unchanged:true,scrollUntil:true,...badCandidate?{absent:['Checks and required review passed','Passed · "value"','Review clear']}: {}}),
 ];
}
async function journey(t,badCandidate=false){
 const runtime={...runtimeFixtureProfile(),dockerConfigDirectory:runtimeFixtureConfig()},f=await managedWorld(t,runtime,process.env.GITJIG_RUNTIME_FIXTURE_ROOT??path.resolve('.runtime-fixtures')),source=path.join(f.root,'project');
 await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));await f.c.close();
 const receipt=path.join(f.root,'runtime.receipt'),request='Consumer must export3 using its existing simple implementation.',command='/change start '+request,steps=[
  state(true,'',['Model: original'],command+'\x1b\r'),
  state(false,command,['Start managed work'],'\r'),
  state(true,'',[badCandidate?'Stopped ·':'Review-ready result recorded'],'/result\x1b\r',{baseline:true}),
  ...resultSteps('/result',badCandidate),
  state(true,'',['Model: original'],'\x07',{unchanged:true}),
  state(false,'',['Commands · Ctrl+G'],'q',{unchanged:true}),
 ];
 const result=await terminal(f,{receipt,badCandidate,steps,timeoutSeconds:60});
 return {runtime,f,source,receipt,request,result};
}
async function reopenResult(f,runtime,receipt,first,badCandidate=false){
 const wire=await fs.readFile(receipt),draft='  Keep this unsent follow-up 한국어  ',result=await terminal(f,{
  receipt,badCandidate,inspectOnly:true,expectedLedger:first.ledger,timeoutSeconds:15,steps:[
   state(true,'',['Model: original'],paste(draft),{unchanged:true}),
   state(true,draft,['Model: original'],'\x07',{unchanged:true}),
   state(false,draft,['Commands · Ctrl+G'],'r',{unchanged:true}),
   ...resultSteps(draft,badCandidate),
   state(true,draft,['Model: original'],'\x07',{unchanged:true}),
   state(false,draft,['Commands · Ctrl+G'],'q',{unchanged:true}),
  ],
 });
 assert.deepEqual(await fs.readFile(receipt),wire,'Read-only result reopening must not call the provider');
 const c=await openController({installationHome:f.home,runtimeProfile:runtime});
 try{assert.equal(c.inspectConversation(f.cid).draft.text,draft);await assertClean(c,f);}finally{await c.close();}
 return result;
}
async function assertClean(c,f){
 for(const name of await fs.readdir(path.join(f.home,'state/runtime')))if(name.endsWith('.json'))assert.equal(JSON.parse(await fs.readFile(path.join(f.home,'state/runtime',name),'utf8')).state,'removed');
 assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','ACTIVE','QUEUED','SETTLING','QUARANTINED')").n,0);
}
test('actual source CLI managed start reaches review-ready with original selected model and real sandbox verification',{timeout:100000},async t=>{
 const {runtime,f,source,receipt,request,result}=await journey(t);
 const wire=JSON.parse(await fs.readFile(receipt,'utf8'));assert.ok(wire.models.length>5);assert.ok(wire.models.every(m=>m==='original'));assert.ok(wire.tools.includes('write'));for(const role of ['planner','challenger','implementer','reviewer','adjudicator'])assert.ok(wire.roles.includes(role),role);
 const c=await openController({installationHome:f.home,runtimeProfile:runtime});try{
  const rows=c.listChanges().changes;assert.equal(rows.length,1);const work=c.inspectWork(rows[0].workId),view=c.inspectChange(work.workId);assert.equal(work.source.raw,request);assert.equal(view.reviewReady,true,JSON.stringify(view.blocked));assert.equal(view.phase,'REVIEW_READY');assert.equal(c.getWorkApplicationModelBaseline(work.workId).choice.modelId,'original');assert.equal(c.inspectConversation(f.cid).workId,work.workId);
  const candidate=view.versions.find(v=>v.id===view.candidateVersion);assert.equal(await fs.readFile(path.join(candidate.artifact,'consumer.cjs'),'utf8'),'module.exports=3;\n');assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');assert.ok(view.checks.length>0);assert.ok(view.execution.consumed>0);assert.equal(view.execution.reserved,0);assert.equal(view.resolution.reserved,0);
  const displayed=result.frames.filter(frame=>frame.frame.some(line=>line.includes('Task result'))).flatMap(frame=>frame.frame).map(line=>line.trim()).join('');
  assert.ok(displayed.includes(candidate.artifact),'The recorded saved candidate path must be visible in the original result UI');
  assert.ok(displayed.includes('Modified · "consumer.cjs"'));assert.ok(displayed.includes('Publication, merge and current destination state are not inspected here.'));
  const readable=c.inspectChangeResult(work.workId);assert.equal(readable.reviewReady,true);assert.equal(readable.checks.entries.find(row=>row.checkId==='value').passed,true);assert.ok(readable.reviews.entries.some(row=>row.state==='selected'&&row.outcome==='clear'));
  const author=view.launches.find(l=>l.role==='implementer'),review=view.launches.find(l=>l.role==='reviewer');assert.ok(author&&review);assert.notEqual(author.run,review.run);
  const judged=view.launches.filter(l=>['planner','challenger','adjudicator','implementer','reviewer'].includes(l.role));assert.equal(new Set(judged.map(l=>l.data.nativeSessionId)).size,judged.length);assert.equal(new Set(judged.map(l=>l.data.historyRef)).size,judged.length);
  for(const launch of judged){assert.ok(launch.data.nativeSessionId&&launch.data.historyRef);assert.equal(launch.data.cleanup,'removed');assert.equal(c.store.one('SELECT phase FROM runs WHERE id=?',launch.run).phase,'SETTLED');await fs.access(launch.data.historyRef);}
  assert.equal(review.data.inputVersions.candidate,view.candidateVersion);const selected=JSON.parse(c.store.one('SELECT data FROM change_state WHERE work=?',work.workId).data);assert.equal(review.data.inputVersions.requirements,selected.requirementVersion);assert.equal(review.data.inputVersions.contracts,selected.contractsVersion);assert.equal(wire.reviews.length,1);assert.equal(wire.reviews[0].candidateVersion,view.candidateVersion);assert.equal(wire.reviews[0].consumer,'module.exports=3;\n');
  await assertClean(c,f);assert.equal(c.inspectConversation(f.cid).draft.text,'');
 }finally{await c.close();}
 const reopened=await reopenResult(f,runtime,receipt,result);assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');
 t.diagnostic(JSON.stringify({scope:'original source CLI/UI + managed selection + Pi codec + workflow + local engine + read-only result/reopen; synthetic provider only',stages:result.stages,reopenStages:reopened.stages,roles:wire.roles,root:f.root}));
 if(process.env.GITJIG_KEEP_RUNTIME_FIXTURE!=='1')f.pass();
 else t.diagnostic('Retained verified source runtime fixture for independent operator: '+f.root);
});

test('actual source CLI refuses review-ready when the synthetic author repeatedly emits an incorrect candidate',{timeout:100000},async t=>{
 const {runtime,f,source,receipt,result}=await journey(t,true),wire=JSON.parse(await fs.readFile(receipt,'utf8'));
 const c=await openController({installationHome:f.home,runtimeProfile:runtime});try{
  const rows=c.listChanges().changes;assert.equal(rows.length,1);const view=c.inspectChange(rows[0].workId);assert.equal(view.reviewReady,false);assert.notEqual(view.phase,'REVIEW_READY');assert.ok(view.checks.some(check=>check.status==='fail'&&check.data.actual.exitCode===0));assert.ok(view.blocked.length||view.nextAction.includes('resume'));assert.equal(wire.reviews.length,0);assert.ok(wire.tools.includes('write'));assert.ok(wire.models.every(m=>m==='original'));assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');assert.equal(view.execution.reserved,0);assert.equal(view.resolution.reserved,0);await assertClean(c,f);
  // The bounded drive stops on a later captured candidate. Older failed receipts
  // must not masquerade as the selected candidate's check or approval.
  const readable=c.inspectChangeResult(rows[0].workId);assert.equal(readable.reviewReady,false);assert.equal(readable.checks.entries.find(row=>row.checkId==='value').status,'missing');assert.ok(readable.checks.entries.every(row=>!row.passed));assert.ok(readable.reviews.entries.every(row=>row.outcome!=='clear'));
 }finally{await c.close();}
 await reopenResult(f,runtime,receipt,result,true);assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');f.pass();
});
