import '../normal-hosted/no-external.mjs';
import {Controller} from '../../dist/controller/controller.js';
import {configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
const origin=process.env.TEST_OWNED_MERGE_ORIGIN;
if(!origin||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Explicit owned native merge fixture required');
Controller.prototype.configureMergeCredential=function(options){configureOwnedMergeFixture(this,{...options,origin});};
