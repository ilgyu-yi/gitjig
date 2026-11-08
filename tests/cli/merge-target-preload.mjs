import '../normal-hosted/no-external.mjs';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
const entry=process.env.GITJIG_TEST_CLI_ENTRY;
const controller=entry?pathToFileURL(path.resolve(path.dirname(realpathSync(entry)),'../controller/controller.js')).href
 :'../../dist/controller/controller.js';
const {Controller}=await import(controller);
const origin=process.env.TEST_OWNED_MERGE_ORIGIN;
if(!origin||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Explicit owned native merge fixture required');
Controller.prototype.configureMergeCredential=function(options){configureOwnedMergeFixture(this,{...options,origin});};
