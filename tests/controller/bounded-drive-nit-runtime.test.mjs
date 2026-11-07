import test from 'node:test';import assert from 'node:assert/strict';
import {openController} from '../../dist/controller/index.js';
import {scopeJournalsRemoved} from '../runtime/fixture-cleanup.mjs';import path from 'node:path';
import {typedNitModel,prepareTypedNitFixture,assertTypedNitEvidence} from './typed-nit-fixture.mjs';
test('bounded typed nit reopen performs only ordinary repair before fresh checks and review',{timeout:30000},async()=>{
 const {root,home,source,runtimeProfile}=await prepareTypedNitFixture('bounded-nit-');let c=await openController({installationHome:home,runtimeProfile});
 try{await c.registerProject({id:'P',sourceRoot:source});let view=await c.beginChange({projectId:'P',request:'Export3, reject contradictory value claims and fix prose typos while preserving actual fenced executable extraction.',executionLimit:32,resolutionLimit:6});view=await c.driveChange({workId:view.workId,model:typedNitModel(),maximumSteps:5});assert.equal(view.phase,'REPAIR_REQUIRED',JSON.stringify(view.blocked));assert.equal(view.resolution.consumed,4);assert.equal(c.changeCore.row(view.workId).data.pendingNit,null);const before=view.execution.consumed;await c.close();c=await openController({installationHome:home,runtimeProfile});
 view=await c.driveChange({workId:view.workId,model:typedNitModel(),maximumSteps:1});assert.equal(view.phase,'CANDIDATE_CAPTURED');assert.equal(view.reviewReady,false);assert.equal(view.execution.consumed,before+1);assert.equal(view.resolution.consumed,4);assert.equal(view.launches.filter(launch=>launch.role==='repairer').length,1);assert.equal(view.launches.filter(launch=>launch.role==='reviewer').length,1);assert.equal(view.checks.filter(check=>check.status==='pass').length,1);
 view=await c.driveChange({workId:view.workId,model:typedNitModel()});await assertTypedNitEvidence(c,view);assert.equal(await scopeJournalsRemoved(path.join(home,'state','runtime')),true);
 }finally{await c.close();console.log('RETAINED_BOUNDED_TYPED_NIT_EVIDENCE '+root);}
});
