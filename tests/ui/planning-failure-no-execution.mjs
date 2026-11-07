import './readiness-no-execution.mjs';
import {Controller} from '../../dist/controller/controller.js';
let attempts=0;
const deny=()=>{attempts++;throw Error('Planning failure inspection cannot dispatch or change work');};
for(const name of ['beginChange','startConversationChange','resumeConversationChange','driveChange','cancelWork','refreshChangeCriteria','extendExecutionAllowance','extendResolutionAllowance'])
 if(typeof Controller.prototype[name]==='function')Controller.prototype[name]=deny;
process.on('exit',()=>{if(attempts)process.exitCode=1;});
