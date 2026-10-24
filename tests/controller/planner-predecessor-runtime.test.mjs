import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
const runtimeProfile={dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
test('actual replanning omits only unadjudicated failed-producer advocacy; J retains it and missing disposition blocks',{timeout:60000},async()=>{
 assert.ok(runtimeProfile.dockerContext&&runtimeProfile.image,'Explicit owned runtime required; unavailable is not a pass');
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/planner-context-'))),source=path.join(root,'source'),home=path.join(root,'home');await fs.mkdir(source);
 await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3}]}));\n"));
 process.env.TMPDIR=path.join(home,'artifacts');let c,passed=false;
 try{
  c=await openController({installationHome:home,runtimeProfile});await c.registerProject({id:'P',sourceRoot:source});
  const request='Consumer exports3; retain the original raw owner instruction.';
  const initial=await c.beginChange({projectId:'P',request,executionLimit:32,resolutionLimit:12}),workId=initial.workId;
  const finding={requirementId:'R1',severity:'blocking',repair:'substantive',description:'PREDECESSOR_ASSERTION: actual consumer exports2 rather than required3',evidence:['PREDECESSOR_EVIDENCE: current consumer source exports2']};
  let mode='unusable',oldOccurrence,oldOutput,oldOccurrenceBytes,oldOutputBytes,inputReceipt,plannerViews=0,judgeViews=0;
  const model=scripted(undefined,({role,body,result,context})=>{
   if(role==='planner'&&mode==='unusable'){result.findings=[finding];result.unexpectedField='Make this producer structurally unusable without deleting its raw finding';return;}
   if(role==='planner'){
    plannerViews++;const occurrence=body.context.occurrences.find(o=>o.id===oldOccurrence.id);assert.ok(occurrence);
    assert.equal(c.store.one('SELECT * FROM finding_occurrences WHERE id=?',oldOccurrence.id).data,oldOccurrenceBytes);
    assert.equal(JSON.stringify(c.store.one('SELECT * FROM role_outputs WHERE id=?',oldOutput.id)),oldOutputBytes);
    assert.equal(body.context.ownerRequest,request);assert.ok(body.sources.some(s=>s.id==='base:consumer.cjs'));
    assert.ok(JSON.stringify(context).includes('module.exports=2;'));
    assert.ok(body.context.sourceInputChain.some(i=>i.input_id===inputReceipt.inputId&&i.text.includes('RAW_OWNER_DIRECTION')));
    assert.ok(body.context.pendingObligations.some(o=>o.id===oldOccurrence.id));
    if(mode==='upheld-visible'){assert.deepEqual(occurrence.data.finding,finding);assert.equal(occurrence.findingBodyOmitted,undefined);}
    else{const {finding:_claim,...metadata}=JSON.parse(oldOccurrenceBytes);assert.deepEqual(occurrence,{id:oldOccurrence.id,output:oldOccurrence.output,ordinal:oldOccurrence.ordinal,work:workId,data:metadata,producerStatus:'unusable',findingBodyOmitted:true});assert.equal(JSON.stringify(context).includes('PREDECESSOR_ASSERTION'),false);assert.equal(JSON.stringify(context).includes('PREDECESSOR_EVIDENCE'),false);}
   }
   if(role==='adjudicator'&&body.context.stage==='planning-adjudication'){
    judgeViews++;assert.deepEqual(body.context.occurrences.find(o=>o.id===oldOccurrence.id).data.finding,finding);
    assert.ok(JSON.stringify(context).includes('PREDECESSOR_ASSERTION'));assert.ok(JSON.stringify(context).includes('PREDECESSOR_EVIDENCE'));
    result.decisions=mode==='omit-disposition'?[]:[{occurrenceId:oldOccurrence.id,disposition:'upheld',reason:'Actual base exports2; requirement still asks3',witnesses:['base:consumer.cjs']}];
   }
  });
  const first=await c.planChange({workId,model});assert.equal(first.phase,'BLOCKED');assert.equal(first.planVersion,null);oldOccurrence=c.store.one('SELECT * FROM finding_occurrences WHERE work=?',workId);assert.ok(oldOccurrence);oldOccurrenceBytes=oldOccurrence.data;oldOutput=c.store.one('SELECT * FROM role_outputs WHERE id=?',oldOccurrence.output);assert.equal(oldOutput.status,'unusable');oldOutputBytes=JSON.stringify(oldOutput);
  const conversation=c.listConversations().find(v=>v.workId===workId);assert.ok(conversation);inputReceipt=await c.queueConversationInput({conversationId:conversation.conversationId,expectedGeneration:conversation.generation,text:'RAW_OWNER_DIRECTION: the original exports3 requirement remains unchanged; assess actual current source.',mode:'idle'});
  mode='omit-disposition';const refused=await c.driveChange({workId,model,maximumSteps:1});assert.equal(refused.phase,'BLOCKED');assert.equal(refused.planVersion,null);assert.match(refused.blocked.join(),/Raw occurrence unaccounted/);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',oldOccurrence.id).data).state,'pending');
  mode='uphold';const upheld=await c.driveChange({workId,model,maximumSteps:1});assert.equal(upheld.phase,'BLOCKED');assert.equal(upheld.planVersion,null);assert.match(upheld.blocked.join(),/Planning cannot defer unaccounted obligations/);assert.equal(c.store.one('SELECT status FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1',oldOccurrence.id).status,'upheld');
  mode='upheld-visible';const replanned=await c.planChange({workId,model});assert.equal(replanned.phase,'BLOCKED');assert.equal(replanned.planVersion,null);assert.match(replanned.blocked.join(),/Planning cannot defer unaccounted obligations/);assert.equal(plannerViews,3);assert.equal(judgeViews,3);
  assert.equal(c.store.one('SELECT data FROM finding_occurrences WHERE id=?',oldOccurrence.id).data,oldOccurrenceBytes);assert.equal(JSON.stringify(c.store.one('SELECT * FROM role_outputs WHERE id=?',oldOutput.id)),oldOutputBytes);assert.ok(oldOutput.raw.includes('PREDECESSOR_ASSERTION'));assert.equal(replanned.reviewReady,false);passed=true;
 }finally{await c?.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Preserved '+root);}
});
