import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {subject} from './hosted-core-fixture.mjs';
test('actual close owns whole hosted registration admission and refuses late target insertion',{timeout:10000},async()=>{
 const f=await subject();try{f.configure();let settled=false;const pending=f.c.registerHostedIntegrationTarget(f.registration).then(()=>{settled=true;return'inserted';},e=>{settled=true;return String(e);});await f.c.close();assert.equal(settled,true);assert.notEqual(await pending,'inserted');assert.equal(f.native.requests.length,0);const db=new DatabaseSync(path.join(f.native.root,'home/state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM effect_targets').get().n,0);}finally{db.close();}f.pass();}finally{await f.close();}
});
