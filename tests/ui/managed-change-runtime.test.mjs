// Explicit owned local engine, synthetic provider response through original Pi codec.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {managedWorld} from './managed-change-fixture.mjs';import {runtimeFixtureProfile,runtimeFixtureConfig,runtimeFixtureRoot} from '../runtime/profile.mjs';import {withValueCases} from '../controller/effect-fixture.mjs';import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {scripted} from '../controller/effect-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);
const state=(editorFocused,draft,contains,send,extra={})=>({editorFocused,draft,contains,send,...extra});
const paste=value=>'\x1b[200~'+value+'\x1b[201~';
const ownerRequest='Consumer must export3 using its existing simple implementation.';
const coordinatorDraft='Keep this parent draft';
function assertSingleStatus(frames, label){
 const frame=frames.find(snapshot=>snapshot.editorFocused&&snapshot.frame.some(line=>line.trim()===label));
 assert.ok(frame,`Current composer must show ${label}`);
 assert.equal(frame.frame.filter(line=>line.trim()===label).length,1,`Current composer must show ${label} once`);
 return frame;
}
async function terminal(f,config){
 const file=path.join(f.root,config.name??(config.inspectOnly?'result-reopen.json':'runtime.json')),output=file+'.terminal',observation=file+'.current';
 await fs.writeFile(file,JSON.stringify({...config,cid:f.cid,home:f.home,observation,output,
  command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),'tests/ui/managed-change-runtime-entry.mjs',file],
  env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:path.join(f.home,'artifacts'),GITJIG_RESULT_OBSERVATION:observation,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''}}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:80000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,config.steps.length);assert.equal(result.terminalRestored,true);
 return {...result,frames:JSON.parse(await fs.readFile(output+'.frames.json','utf8')).snapshots};
}
function resultSteps(draft,badCandidate){
 const absent=badCandidate?['Checks and required review passed','Passed · "value"','Review clear']:[];
 return [
  state(false,draft,['Task result','Saved output','Registered project folder','Opening this result applies no files.',
   badCandidate?'No review-ready result is currently confirmed':'Checks and required review passed'], '',{unchanged:true}),
  state(false,draft,['Task result',badCandidate?'Checks that need attention':'Checks for this candidate and verification plan',
   ...(badCandidate?['Failed · "value"','Failed assertions · "three"']:['Passed · "value"'])], '',
   {unchanged:true,scrollUntil:true,scrollByLine:true,absent}),
  state(false,draft,['Task result','Selected review evidence',...(badCandidate?[]:['Review clear'])],'',
   {unchanged:true,scrollUntil:true,scrollByLine:true,absent}),
  state(false,draft,['Task result','Publication, merge and current destination state are not inspected here.'],'\r',{unchanged:true,scrollUntil:true}),
  state(false,draft,['Next step for this result','Back to task result'],'\r',{unchanged:true}),
  ...(badCandidate?[
   state(false,draft,['Task result','Publication, merge and current destination state are not inspected here.'],'\r',{unchanged:true}),
   state(false,draft,['Next step for this result'],'Inspect original work and recovery\r',{unchanged:true}),
   state(false,draft,['Work recovery · #'],'\x1b',{unchanged:true}),
  ]:[]),
  state(false,draft,['Task result','Publication, merge and current destination state are not inspected here.'],'\x1b',{unchanged:true}),
 ];
}
async function journey(t,badCandidate=false){
 const configured=runtimeFixtureProfile();
 const runtime={...configured,dockerBinary:await fs.realpath(configured.dockerBinary),dockerConfigDirectory:runtimeFixtureConfig()};
 const f=await managedWorld(t,runtime,await runtimeFixtureRoot()),source=path.join(f.root,'project');
 if (!badCandidate) {
  f.c.setConversationParent({childId:f.cid,parentId:f.other,expectedRevision:0});
  f.c.setConversationName({conversationId:f.other,expectedGeneration:0,name:'Project coordinator'});
  f.c.setDraft({conversationId:f.other,expectedRevision:0,text:coordinatorDraft});
 }
 await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n" + (badCandidate ? '' : 'setTimeout(() => {}, 3000);\n')));
 if(!badCandidate)await ApplicationStartup.open(f.c).save({version:1});
 await f.c.close();
 const configure=badCandidate?[]:[
  state(true,'',['Model: original'],'/ready\x1b\r',{baseline:true}),
  state(false,'/ready',['Next step · Prepare the project execution environment','Active runtime · not configured'],'\r',{unchanged:true}),
  state(false,'/ready',['Runtime setup · staged values'],'Edit runtime fields\r',{unchanged:true}),
  ...[['Docker executable',configured.dockerBinary],['Docker context',runtime.dockerContext],['Runtime image',runtime.image],
   ['Docker configuration directory',runtime.dockerConfigDirectory]].map(([label,value])=>state(false,'/ready',[label],'\x15'+value+'\r',{unchanged:true})),
  state(false,'/ready',['Runtime setup · staged values'],'Review and save runtime\r',{unchanged:true}),
  state(false,'/ready',['Review runtime setup before applying','Open settings confirmation'],'\r',{unchanged:true}),
  state(false,'/ready',['Explicit runtime setup action'],'Save and apply runtime\r',{unchanged:true}),
  state(false,'/ready',['Next step · Choose how to give your request',runtime.dockerContext],'Return to request\r',{unchanged:true}),
 ];
 const receipt=path.join(f.root,'runtime.receipt'),request=ownerRequest,command='/change start '+request;
 const check=badCandidate?null:{preparing:path.join(f.root,'check-preparing'),running:path.join(f.root,'check-output'),settling:path.join(f.root,'check-cleanup')};
 const steps=[
  ...configure,
  state(true,'',['Model: original'],command+'\x1b\r'),
  state(false,command,['Open start confirmation'],'\r'),
  state(false,command,['Start managed work'],'\x1b[B\r'),
  ...check?[
   state(true,'',['Task in progress','Preparing project check · value'],'\x07p',{waitFiles:[{path:check.preparing}],absent:['Running project check · value']}),
   state(true,coordinatorDraft,['Related work in progress: 1','Preparing project check · value'],'',{selected:f.other,releaseFile:check.preparing+'.release'}),
   state(true,coordinatorDraft,['Related work in progress: 1','Running project check · value'],'\x07c',{selected:f.other,waitFiles:[{path:check.running}]}),
   state(false,coordinatorDraft,['Conversations'],f.cid+'\r',{selected:f.other}),
   state(true,'',['Task in progress','Running project check · value'],'',{selected:f.cid,waitFiles:[{path:check.running}]}),
   state(true,'',['Task in progress','Cleaning up after check · value'],'\x07p',{waitFiles:[{path:check.settling}],absent:['Running project check · value']}),
   state(true,coordinatorDraft,['Related work in progress: 1','Cleaning up after check · value'],'',{selected:f.other,releaseFile:check.settling+'.release'}),
   state(true,coordinatorDraft,['Review-ready result recorded'],'\x07c',{selected:f.other,absent:['Related work in progress: 1','Cleaning up after check · value']}),
   state(false,coordinatorDraft,['Conversations'],f.cid+'\r',{selected:f.other}),
  ]:[],
  state(true,'',[badCandidate?'Change blocked · /result for details and next steps':'Review-ready result recorded'],'/result\x1b\r',{baseline:true}),
  ...resultSteps('',badCandidate),
  state(true,'',['Model: original'],'\x07',{unchanged:true}),
  state(false,'',['Commands · Ctrl+G'],'q',{unchanged:true}),
 ];
 const result=await terminal(f,{receipt,badCandidate,steps,timeoutSeconds:60,...check?{observeCheck:check,releaseFilesOnFailure:[check.preparing+'.release',check.settling+'.release']}: {}});
 if(!badCandidate)assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8')).runtime,runtime);
 return {runtime,f,source,receipt,request,result};
}
async function reopenResult(f,runtime,receipt,first,badCandidate=false){
 const wire=await fs.readFile(receipt),draft='  Keep this unsent follow-up 한국어  ',result=await terminal(f,{
  receipt,badCandidate,inspectOnly:true,expectedLedger:first.ledger,timeoutSeconds:15,steps:[
   state(true,'',['Model: original'],paste(draft),{unchanged:true}),
   state(true,draft,['Model: original'],'\x07',{unchanged:true}),
   state(false,draft,['Commands · Ctrl+G'],'c',{unchanged:true}),
   state(false,draft,['Conversations',ownerRequest],'\x1b',{unchanged:true}),
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
async function resumeCompletedWork(f,runtime,receipt){
 const c=await openController({installationHome:f.home,runtimeProfile:runtime});
 let id,draft;
 try{
  id=c.listChanges().changes[0].workId;
  const work=c.inspectWork(id);
  await c.cancelWork({workId:id,expectedEpoch:work.epoch});
  draft=c.inspectConversation(f.cid).draft.text;
 }finally{await c.close();}
 const held=path.join(f.root,'managed-settlement'),command='/change resume '+id;
 const result=await terminal(f,{name:'resume-completed.json',receipt,inspectOnly:true,holdManagedSettlement:held,timeoutSeconds:15,steps:[
  state(true,draft,['Model: original'],'\x15'+command+'\x1b\r',{baseline:true}),
  state(false,command,['Open resume confirmation'],'\r',{unchanged:true}),
  state(false,command,['Resume · P · #'],'Recover and resume this original work\r',{unchanged:true}),
  state(true,command,['Finishing the current task'],'',{waitFiles:[{path:held}],releaseFile:held+'.release',absent:['Review-ready result recorded']}),
  state(true,'',['Review-ready result recorded'],'/quit\x1b\r'),
 ]});
 assertSingleStatus(result.frames,'Finishing the current task');
}
test('actual CLI applies runtime and reaches review-ready in one session with real sandbox verification',{timeout:100000},async t=>{
 const {runtime,f,source,receipt,request,result}=await journey(t);
 const settled=assertSingleStatus(result.frames,'Review-ready result recorded · /result to inspect; publication and merge are separate');
 const related=settled.frame.find(line=>line.startsWith('↓ Children ('));
 assert.ok(related,'Retained role conversations must be visible after work settles');
 assert.doesNotMatch(related,/Review-ready/);
 assert.match(related,/\[IDLE\]/);
 const wire=JSON.parse(await fs.readFile(receipt,'utf8'));assert.ok(wire.models.length>5);assert.ok(wire.models.every(m=>m==='original'));assert.ok(wire.tools.includes('write'));for(const role of ['planner','challenger','implementer','reviewer','adjudicator'])assert.ok(wire.roles.includes(role),role);
 const c=await openController({installationHome:f.home,runtimeProfile:runtime});try{
  const rows=c.listChanges().changes;assert.equal(rows.length,1);const work=c.inspectWork(rows[0].workId),view=c.inspectChange(work.workId);assert.equal(work.source.raw,request);assert.equal(view.reviewReady,true,JSON.stringify(view.blocked));assert.equal(view.phase,'REVIEW_READY');assert.equal(c.getWorkApplicationModelBaseline(work.workId).choice.modelId,'original');assert.equal(c.inspectConversation(f.cid).workId,work.workId);
  const producers=c.store.all("SELECT data,phase FROM runs WHERE work=? AND json_extract(data,'$.kind') IN ('governed-role','governed-check')",work.workId);
  assert.ok(producers.length>5);
  const effectiveRuntime={...runtime,uid:process.getuid(),gid:process.getgid()};
  for(const row of producers){assert.equal(row.phase,'SETTLED');assert.deepEqual(JSON.parse(row.data).runtimeProfile,effectiveRuntime);}
  assert.equal(new Set(producers.map(row=>JSON.parse(row.data).controllerPid)).size,1);
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
  assert.equal(c.inspectConversation(f.cid).parentId,f.other);
  assert.equal(c.inspectConversation(f.other).draft.text,coordinatorDraft);
  assert.equal(c.store.one('SELECT COUNT(*) AS n FROM conversation_dependencies').n,0);
 }finally{await c.close();}
 const reopened=await reopenResult(f,runtime,receipt,result);assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');
 await resumeCompletedWork(f,runtime,receipt);
 t.diagnostic(JSON.stringify({scope:'original source CLI/UI + managed selection + Pi codec + workflow + local engine + read-only result/reopen; synthetic provider only',stages:result.stages,reopenStages:reopened.stages,roles:wire.roles,root:f.root}));
 if(process.env.GITJIG_KEEP_RUNTIME_FIXTURE!=='1')f.pass();
 else t.diagnostic('Retained verified source runtime fixture for independent operator: '+f.root);
});

test('actual source CLI refuses review-ready when the synthetic author repeatedly emits an incorrect candidate',{timeout:100000},async t=>{
 const {runtime,f,source,receipt,result}=await journey(t,true),wire=JSON.parse(await fs.readFile(receipt,'utf8'));
 let workId, failed;
 const c=await openController({installationHome:f.home,runtimeProfile:runtime});try{
  const rows=c.listChanges().changes;assert.equal(rows.length,1);const view=c.inspectChange(rows[0].workId);assert.equal(view.reviewReady,false);assert.notEqual(view.phase,'REVIEW_READY');assert.ok(view.checks.some(check=>check.status==='fail'&&check.data.actual.exitCode===0));assert.ok(view.blocked.length||view.nextAction.includes('resume'));assert.equal(wire.reviews.length,0);assert.ok(wire.tools.includes('write'));assert.ok(wire.models.every(m=>m==='original'));assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');assert.equal(view.execution.reserved,0);assert.equal(view.resolution.reserved,0);await assertClean(c,f);
  workId=rows[0].workId;failed=view.checks;
  assert.equal(view.phase,'BLOCKED');assert.equal(view.checks.length,2);assert.equal(view.launches.filter(row=>row.role==='repairer').length,1);
  assert.equal(new Set(view.versions.filter(row=>row.kind==='candidate').map(row=>row.hash)).size,1);
  const [first,last]=view.checks, repeated=()=>c.changes.repeatsCheckFailure(workId,last.data.check,'fail');
  assert.equal(repeated(),true);
  for(const [table, id, patch] of [
   ['check_runs',first.id,{cwd:'/different'}],['check_runs',first.id,{error:'retained execution error'}],
   ['runs',first.run,{role:'reviewer'}],
  ]){
   const {data}=c.store.one(`SELECT data FROM ${table} WHERE id=?`,id);
   c.store.run(`UPDATE ${table} SET data=? WHERE id=?`,JSON.stringify({...JSON.parse(data),...patch}),id);
   try{assert.equal(repeated(),false);}finally{c.store.run(`UPDATE ${table} SET data=? WHERE id=?`,data,id);}
  }
  const readable=c.inspectChangeResult(rows[0].workId);assert.equal(readable.reviewReady,false);assert.equal(readable.checks.entries.find(row=>row.checkId==='value').status,'fail');assert.ok(readable.checks.entries.every(row=>!row.passed));assert.ok(readable.reviews.entries.every(row=>row.outcome!=='clear'));
 }finally{await c.close();}
 await reopenResult(f,runtime,receipt,result,true);
 const draft='  Keep this unsent follow-up 한국어  ',command='/change resume '+workId;
 await terminal(f,{name:'resume.json',receipt:path.join(f.root,'resume.receipt'),timeoutSeconds:30,steps:[
  state(true,draft,['Model: original'],'\x15'+command+'\x1b\r',{baseline:true}),
  state(false,command,['Open resume confirmation'],'\r',{unchanged:true}),
  state(false,command,['Resume this original work'],'Resume this original work\r',{unchanged:true}),
  state(true,'',['Review-ready result recorded'],'/result\x1b\r',{baseline:true}),
  ...resultSteps('',false),
  state(true,'',['Model: original'],'\x07',{unchanged:true}),
  state(false,'',['Commands · Ctrl+G'],'q',{unchanged:true}),
 ]});
 const resumed=await openController({installationHome:f.home,runtimeProfile:runtime});
 try {
  assert.equal(resumed.listChanges().changes.length,1);
  const view=resumed.inspectChange(workId);
  assert.equal(view.reviewReady,true);assert.equal(view.checks.at(-1).status,'pass');
  assert.deepEqual(view.checks.filter(row=>row.status==='fail'),failed);
  assert.equal(view.launches.filter(row=>row.role==='repairer').length,2);
  await assertClean(resumed,f);
 } finally { await resumed.close(); }
 assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');
 if(process.env.GITJIG_KEEP_RUNTIME_FIXTURE!=='1')f.pass();
});

test('actual Docker checker stderr is visible in the original result terminal without retry', {timeout:35000}, async t => {
    const configured = runtimeFixtureProfile();
    const runtime = {...configured, dockerBinary:await fs.realpath(configured.dockerBinary), dockerConfigDirectory:runtimeFixtureConfig()};
    const f = await managedWorld(t,runtime,await runtimeFixtureRoot());
    const source = path.join(f.root,'project');
    const consumer = 'module.exports=2;\n', checker = "require('./missing-check-fixture.cjs');\n";
    await fs.writeFile(path.join(source,'consumer.cjs'),consumer);
    await fs.writeFile(path.join(source,'check.cjs'),checker);
    const model = scripted(()=>({text:'unused'}));
    const previousTemp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(f.home,'artifacts');
    let workId, receipt;
    try {
        ({workId} = await f.c.beginChange({projectId:'P',request:ownerRequest}));
        const planned = await f.c.planChange({workId,model});
        assert.equal(planned.phase,'PLAN_READY',JSON.stringify(planned.blocked));
        const implemented = await f.c.implementChange({workId,model});
        assert.equal(implemented.phase,'CANDIDATE_CAPTURED',JSON.stringify(implemented.blocked));
        const checked = await f.c.checkChange({workId});
        assert.equal(checked.phase,'BLOCKED');
        const [check] = checked.checks;
        assert.equal(check.status,'unavailable');
        assert.equal(check.data.actual.exitCode,1);
        assert.match(check.data.actual.stderr,/Cannot find module '\.\/missing-check-fixture\.cjs'/u);
        assert.equal(check.data.parsed.value,null);
        assert.equal(check.data.cleanup,'removed');
        const [recorded] = f.c.inspectChangeResult(workId).checks.entries;
        assert.equal(recorded.unavailableReason,'output-contract');
        assert.equal(recorded.stderrExcerpt,undefined);
        receipt = f.c.store.one('SELECT * FROM check_runs WHERE id=?',check.id);
        await assertClean(f.c,f);
    } finally {
        if (previousTemp===undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR=previousTemp;
        await f.c.close();
    }
    const title = uiText('en','result.check.stderr');
    const diagnostic = "Cannot find module './missing-check-fixture.cjs'";
    const result = await terminal(f,{name:'read-rejected-check.json',inspectOnly:true,timeoutSeconds:12,steps:[
        state(true,'',['Model: original'],'/result '+workId+'\x1b\r',{baseline:true}),
        state(false,'',['Task result',title,diagnostic,'Recorded exit code 1','Report parsing rejected'],'\x1b',
            {unchanged:true,absent:['Checks and required review passed','Review clear']}),
        state(true,'',['Model: original'],'\x07q',{unchanged:true}),
    ]});
    const checkFrame = result.frames[1].frame.join('\n');
    assert.ok(checkFrame.indexOf(title)<checkFrame.indexOf(diagnostic));
    const reopened = await openController({installationHome:f.home,runtimeProfile:runtime});
    try {
        assert.deepEqual(reopened.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt);
        assert.equal(reopened.inspectChange(workId).reviewReady,false);
        assert.equal(reopened.inspectConversation(f.cid).draft.text,'');
        assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),consumer);
        assert.equal(await fs.readFile(path.join(source,'check.cjs'),'utf8'),checker);
        await assertClean(reopened,f);
    } finally {
        await reopened.close();
    }
    if (process.env.GITJIG_KEEP_RUNTIME_FIXTURE!=='1') f.pass();
});
