import fs from 'node:fs';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedPublicationFixture} from '../../.qualification/controller-testing.js';
const [home,op,origin,mode,marker]=process.argv.slice(2),c=await openController({installationHome:home});configureOwnedPublicationFixture(c,{origin,token:'fixture-original'});
if(mode==='before-native'){
 const session=c.publicationEngine.session,original=session.invokePreparedPublication;
 c.publicationEngine.session=Object.freeze({...session,invokePreparedPublication:function(handle){const phase=c.store.one('SELECT phase FROM effect_operations WHERE id=?',op).phase;fs.writeFileSync(marker,JSON.stringify({phase,point:'after durable commit, inside synchronous wrapper BEFORE native request construction'}));process.kill(process.pid,'SIGKILL');return original(handle);}});
}
await c.dispatchPublication({operationId:op});await c.close();
