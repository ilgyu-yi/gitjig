// Test-only exact synthetic procedure checkpoint. All transport still uses the
// owned native launcher; the unmodified gate is independently required to refuse.
import './integration-read-native-only.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Controller} from '../../dist/controller/controller.js';
const fixture=JSON.parse(fs.readFileSync(process.env.GITJIG_TEST_SEND_CHECKPOINT,'utf8'));
const dispatch=Controller.prototype.dispatchRetainedIntegration;
Controller.prototype.dispatchRetainedIntegration=async function(options,...rest){
 assert.equal(options.operationId,fixture.operationId);
 const original=this.changeCore.assertCurrentEvidence;
 this.changeCore.assertCurrentEvidence=value=>assert.deepEqual(value,fixture.evidence);
 try{return await dispatch.call(this,options,...rest);}finally{this.changeCore.assertCurrentEvidence=original;}
};
