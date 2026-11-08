import './no-external.mjs';
/** Test preload only: identical normal profile with localhost native transport.
 * No production argv/env origin option exists. Credential/profile parsing stays real. */
import {Controller} from '../../dist/controller/controller.js';
import {configureOwnedNormalPublicPublicationFixture,configureOwnedNormalPublicConfigurationFixture} from '../../.qualification/controller-testing.js';
const origin=process.env.TEST_OWNED_NORMAL_ORIGIN;
if(!origin||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Owned CLI test origin required');
Controller.prototype.configurePublicationCredential=function(options){return configureOwnedNormalPublicPublicationFixture(this,{...options,origin});};
Controller.prototype.configureRepositoryConfigurationCredential=function(options){return configureOwnedNormalPublicConfigurationFixture(this,{...options,origin});};
