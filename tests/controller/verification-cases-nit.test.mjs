import test from 'node:test';import fs from 'node:fs/promises';
import {openController} from '../../dist/controller/index.js';
import {scopeJournalsRemoved} from '../runtime/fixture-cleanup.mjs';
import assert from 'node:assert/strict';import path from 'node:path';
import {typedNitModel,prepareTypedNitFixture,assertTypedNitEvidence} from './typed-nit-fixture.mjs';
test('typed nit ordinary repair reruns paired cases on actual after candidate and requires distinct fresh review',{timeout:20000},async()=>{
 const {root,home,source,runtimeProfile}=await prepareTypedNitFixture('case-nit-'),c=await openController({installationHome:home,runtimeProfile});let success=false;
 try{await c.registerProject({id:'P',sourceRoot:source});let view=await c.beginChange({projectId:'P',request:'Export3, reject contradictory value claims and fix prose typos while preserving actual fenced executable extraction.',executionLimit:32,resolutionLimit:6});view=await c.driveChange({workId:view.workId,model:typedNitModel()});await assertTypedNitEvidence(c,view);assert.equal(await scopeJournalsRemoved(path.join(home,'state','runtime')),true);success=true;}
 finally{await c.close();if(success)await fs.rm(root,{recursive:true,force:true});else console.error('Preserved '+root);}
});
