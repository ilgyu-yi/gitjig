// Controlled standing premise for the terminal mechanics consumer only. This is
// not evidence that terminal entry produced agent procedures or current review.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import './merge-target-preload.mjs';
import {Controller} from '../../dist/controller/controller.js';
const expected=JSON.parse(fs.readFileSync(process.env.TEST_MERGE_OWNER_STANDING_FILE,'utf8'));
const prepare=Controller.prototype.prepareOwnerMerge;
Controller.prototype.prepareOwnerMerge=function(work,target,branch,...rest){
 assert.equal(work,expected.workId);assert.equal(target,expected.targetId);assert.equal(branch,expected.branchOperationId);
 this.changes.currentEvidence=async id=>{assert.equal(id,work);return structuredClone(expected.evidence);};
 this.changes.assertCurrentEvidence=evidence=>assert.deepEqual(evidence,expected.evidence);
 return Reflect.apply(prepare,this,[work,target,branch,...rest]);
};
