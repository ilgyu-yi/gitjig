// Controlled exact-original software-standing premise for terminal mechanics.
// Does not qualify actual procedure production or live credentials/hosting.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import './merge-target-preload.mjs';
import {Controller} from '../../dist/controller/controller.js';
const expected=JSON.parse(fs.readFileSync(process.env.TEST_MERGE_SEND_STANDING_FILE,'utf8'));
for(const method of ['prepareRetainedOwnerMerge','reauthorizeOwnerMerge']){
 const original=Controller.prototype[method];
 Controller.prototype[method]=function(input,...rest){
  assert.equal(input.operationId,expected.operationId);
  this.changes.currentEvidence=async id=>{assert.equal(id,expected.workId);return structuredClone(expected.evidence);};
  this.changes.assertCurrentEvidence=value=>assert.deepEqual(value,expected.evidence);
  return Reflect.apply(original,this,[input,...rest]);
 };
}
