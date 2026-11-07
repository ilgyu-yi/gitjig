// Actual CLI startup must not invoke dependency resumption merely to register models.
import './readiness-no-execution.mjs';
import {Ordinary} from '../../dist/controller/ordinary.js';
let attempts=0;
Ordinary.prototype.resumeAuthorized=function(){attempts++;throw Error('View-only startup attempted dependency resumption');};
process.on('exit',()=>{if(attempts)process.exitCode=1;});
