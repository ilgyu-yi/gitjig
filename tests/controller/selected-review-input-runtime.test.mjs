import {runtimeFixtureProfile} from '../runtime/profile.mjs';
/** ROOT-RUN ONLY: actual public DUMMY reviewer -> J input, owned Docker; no provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
test('actual current public reviewer nonempty raw/native/scope reaches original current J provider input',{timeout:90000},async()=>{
 const runtimeProfile=runtimeFixtureProfile();
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/review-evidence-127-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
 const c=await openController({installationHome:home,runtimeProfile});process.env.TMPDIR=path.join(home,'artifacts');let received,reviewRaw;
 const model=scripted(undefined,({role,body,result})=>{
  if(role==='reviewer'){result.summary='DISTINCTIVE PUBLIC REVIEW 127';result.findings=[{requirementId:'R1',severity:'blocking',repair:'unknown',description:'DUMMY transport discriminator, not a real semantic defect',evidence:['candidate:consumer.cjs:1']}];result.outcome='findings';reviewRaw=JSON.stringify(result);}
  if(role==='adjudicator'&&body.context.stage==='review-adjudication'){
   const evidence=body.context.selectedReviewEvidence;assert.ok(evidence&&evidence.reviews.length===1);const review=evidence.reviews[0];assert.equal(review.raw,reviewRaw);assert.equal(JSON.parse(review.raw).findings.length,1);assert.equal(review.inputVersions.candidate,body.context.candidateVersion);assert.equal(review.launchId,body.context.reviews.general);assert.ok(review.outputId&&review.native.selectedEntryId&&review.native.sessionId);assert.ok(review.assessedScope.length&&review.requiredScope.length&&review.exposures.length);received=evidence;
   result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'rejected',reason:'Controlled DUMMY fixture claim only; validates transport, no real defect judgment',witnesses:['candidate:consumer.cjs:1']}));
  }
 });
 try{await c.registerProject({id:'P',sourceRoot:source});const begun=await c.beginChange({projectId:'P',request:'Export3 with real checks and independent review',executionLimit:16,resolutionLimit:8});const after=await c.driveChange({workId:begun.workId,model});assert.ok(received,JSON.stringify(after.blocked));assert.equal(after.reviewReady,true,JSON.stringify(after.blocked));await fs.writeFile(path.join(root,'review-evidence-result.json'),JSON.stringify({workId:begun.workId,after,evidence:received},null,2),{flag:'wx',mode:0o600});console.log('RETAINED 127 PUBLIC WORLD '+root);}finally{await c.close();}
});
